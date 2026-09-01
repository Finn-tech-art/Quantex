# Admin-configurable destination addresses for the deposit consolidation
# sweep (Module 2 below; Module 3 will add the Base/Polygon EIP-3009 path)
# — one Bybit deposit address per network, read fresh from
# `consolidation_addresses` on every call rather than cached, since this is
# exactly the kind of value that gets changed live from the admin panel; an
# in-process cache here could silently keep sweeping to a stale address
# after a change. Only the `networks` lookup itself (which almost never
# changes) is cached, same pattern as every other service in this codebase
# — see wallet_service._network_id / chain_watcher_service._lookup.
#
# See the architecture doc's "Deposit consolidation" section for the full
# design this module implements, and the pre-build failure-mode review
# (same conversation) for why callers must treat "no address configured
# yet" as a hard refusal, never a silent no-op, and why every sweep starts
# by trusting the chain over our own `sweeps` table.

import logging
import secrets
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import httpx
from eth_account import Account
from eth_account.messages import encode_typed_data
from tronpy import Tron
from tronpy.abi import trx_abi
from tronpy.exceptions import AddressNotFound, TransactionNotFound
from tronpy.keys import PrivateKey, is_base58check_address, to_hex_address
from tronpy.providers import HTTPProvider
from web3 import Web3
from web3.exceptions import TimeExhausted

from app.config import settings
from app.services import wallet_service
from app.services.network_assets import NETWORK_CONFIG
from app.services.redis_client import get_redis_sync
from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

_lookup_cache: dict[str, int] = {}


class UnknownNetwork(ValueError):
    """Raised for a network code that isn't in the `networks` lookup table
    at all — e.g. a typo or a network this module hasn't been taught about."""


class InvalidDestinationAddress(ValueError):
    """Raised when a destination address doesn't match its network's address
    format — e.g. an EVM address pasted into the TRC-20 slot. Format-only:
    this cannot catch "right format, wrong intended chain" (a syntactically
    valid Base address that was actually meant for Polygon) — that residual
    human-error risk is exactly why the admin panel also requires retyping
    the address before it saves, not a substitute for this check."""


def _network_id(code: str) -> int:
    """Same cached-lookup pattern as wallet_service._network_id /
    chain_watcher_service._network_id — a plain dict rather than lru_cache
    so it's trivial to see and reason about, and cheap to repopulate if the
    process ever needs to (it doesn't in practice; the networks table is
    effectively static)."""
    if not _lookup_cache:
        rows = get_supabase().table("networks").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'networks' returned no rows")
        _lookup_cache.update({row["code"]: row["id"] for row in rows})
    if code not in _lookup_cache:
        raise UnknownNetwork(f"'{code}' is not a known network")
    return _lookup_cache[code]


_entry_type_id_cache: dict[str, int] = {}


def _entry_type_id(code: str) -> int:
    """Same cached-lookup pattern as _network_id/_asset_id above — used only
    to find which ledger_entries rows are deposits, for list_pending_sweeps."""
    if not _entry_type_id_cache:
        rows = get_supabase().table("ledger_entry_types").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'ledger_entry_types' returned no rows")
        _entry_type_id_cache.update({row["code"]: row["id"] for row in rows})
    return _entry_type_id_cache[code]


_asset_id_cache: dict[str, int] = {}


def _asset_id(code: str) -> int:
    """Same cached-lookup pattern as _network_id above — used by the Tron
    sweep to record which asset a `sweeps` row is for."""
    if not _asset_id_cache:
        rows = get_supabase().table("assets").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'assets' returned no rows")
        _asset_id_cache.update({row["code"]: row["id"] for row in rows})
    return _asset_id_cache[code]


def _validate_and_normalize(network_code: str, address: str) -> str:
    """Returns the address in its canonical stored form (EIP-55 checksummed
    for EVM networks, unchanged for TRC-20) — matching how the `wallets`
    table already stores EVM addresses checksummed (see chain_watcher_service's
    _known_addresses docstring)."""
    address = address.strip()
    if network_code == "TRC20":
        if not is_base58check_address(address):
            raise InvalidDestinationAddress(f"'{address}' is not a valid TRC-20 (base58check) address")
        return address

    # BASE and POLYGON are both EVM — same address format either way.
    if not Web3.is_address(address):
        raise InvalidDestinationAddress(f"'{address}' is not a valid EVM address")
    return Web3.to_checksum_address(address)


def validate_destination_address(network_code: str, address: str) -> str:
    """Public wrapper around _validate_and_normalize above — the sweep
    (consolidation addresses, this module) and user withdrawals
    (withdrawal_service.py) both need to reject a malformed destination
    address before it's ever stored, and both need the exact same
    TRC-20-base58 vs. EVM-checksum rule to do it. Rather than each module
    keeping its own copy of that rule (and risking them silently drifting
    apart), withdrawal_service.py calls this instead of re-implementing
    address-format validation. Raises UnknownNetwork for a network code this
    module has never heard of, or InvalidDestinationAddress for a
    wrong-shaped address — both are plain ValueError subclasses, so a
    caller that already does `except ValueError` (e.g. a router turning
    validation failures into a 400) catches either one without change."""
    _network_id(network_code)  # raises UnknownNetwork for a bad code, before touching the address at all
    return _validate_and_normalize(network_code, address)


def get_consolidation_address(network_code: str) -> str | None:
    """Returns the configured Bybit destination for this network, or None if
    no admin has set one yet. Callers (the sweep worker, once built) must
    treat None as "refuse to sweep this network," never as an empty string
    or a reason to skip validation."""
    rows = (
        get_supabase()
        .table("consolidation_addresses")
        .select("destination_address")
        .eq("network_id", _network_id(network_code))
        .limit(1)
        .execute()
        .data
    )
    return rows[0]["destination_address"] if rows else None


def get_all_consolidation_addresses() -> dict[str, str | None]:
    """{network_code: destination_address | None} for every known network —
    powers the admin settings screen, which shows all three networks at
    once regardless of how many are actually configured yet."""
    _network_id("TRC20")  # forces the lookup cache to populate if it hasn't yet
    id_to_code = {v: k for k, v in _lookup_cache.items()}

    rows = (
        get_supabase()
        .table("consolidation_addresses")
        .select("network_id,destination_address")
        .execute()
        .data
    )
    configured = {id_to_code[row["network_id"]]: row["destination_address"] for row in rows}
    return {code: configured.get(code) for code in id_to_code.values()}


def set_consolidation_address(network_code: str, address: str, admin_id: str) -> str:
    """Validates, normalizes, and upserts the destination address for one
    network. Raises UnknownNetwork or InvalidDestinationAddress — the router
    turns either into a 4xx before anything reaches the database. Returns
    the normalized address that was actually stored."""
    network_id = _network_id(network_code)
    normalized = _validate_and_normalize(network_code, address)

    get_supabase().table("consolidation_addresses").upsert(
        {
            "network_id": network_id,
            "destination_address": normalized,
            "updated_by_admin_id": admin_id,
        },
        on_conflict="network_id",
    ).execute()
    return normalized


# ── Tron sweep (Module 2) ────────────────────────────────────────────────────

# ── Energy provisioning via GetBlock rental — what the live sweep flow
# actually uses (see sweep_tron_usdt_deposit below). The self-staked
# alternative further down (stake_gas_wallet/_delegate_energy/
# _undelegate_energy/TRON_ENERGY_DELEGATION_TRX) is left in place, dormant,
# not deleted — it's not broken, and the 12 TRX already staked through it
# is real money — but it turned out impractical: verified live via
# _estimate_transfer_energy below, a single real mainnet USDT transfer
# needs on the order of 130,000+ Energy (Tron's Dynamic Energy Model
# inflates heavily-used contracts like USDT well above generic-TRC20
# estimates), which would need roughly 2,000+ TRX self-staked to cover —
# not practical to lock up at this project's scale. GetBlock's pay-as-you
# -go rental (a few TRX-equivalent per transfer) is what's actually used
# instead. See config.py's getblock_energy_api_key comment for the account
# setup, and https://docs.getblock.io/tron-energy/ for their API docs.

GETBLOCK_ENERGY_BASE_URL = "https://services.getblock.io/v1/tron-energy"

# Safety margin over the EXACT Energy cost _estimate_transfer_energy
# measures via a free on-chain simulation, in case the real broadcast needs
# marginally more than predicted (e.g. a minor state change between
# simulating and broadcasting). Cheap insurance: a 15% overshoot costs a
# few extra TRX-cents in rental, while an undershoot fails the whole sweep
# attempt outright with OUT_OF_ENERGY and wastes the rental already paid
# for, needing a full retry (another rental purchase) regardless.
ENERGY_ESTIMATE_SAFETY_MARGIN = Decimal("1.15")


class EnergyRentalFailed(RuntimeError):
    """Raised when renting Energy via GetBlock fails — a missing/bad API
    key, insufficient GetBlock account balance, a network error, or
    GetBlock itself reporting a non-success status. Always raised before
    any USDT has moved, so this is a safe-fail exactly like
    ConsolidationNotConfigured/GasWalletNotConfigured below — the sweep
    just needs retrying later (after funding the GetBlock account, if
    that's why)."""


def _estimate_transfer_energy(from_address: str, to_address: str, raw_amount: int) -> int:
    """Simulates the real TRC-20 transfer via TronGrid's
    triggerconstantcontract (free, read-only, no on-chain effect or cost)
    to find EXACTLY how much Energy THIS specific transfer will cost.
    Discovered live that a flat assumed constant (this codebase's original
    ~1.5 TRX estimate, still visible in stake_gas_wallet's history) is
    nowhere close to correct for real mainnet USDT: Tron's Dynamic Energy
    Model inflates heavily-used contracts like USDT well above generic-
    TRC20 baselines, and a transfer to a recipient that's never held this
    token before costs roughly double a transfer to an existing holder.
    Always measuring fresh rather than assuming a constant is what makes
    renting close to exactly enough Energy — not wildly too little, which
    fails with OUT_OF_ENERGY, or wildly too much, which wastes real money —
    reliable regardless of which of those factors is in play for a given
    sweep. See ENERGY_ESTIMATE_SAFETY_MARGIN above for the buffer applied
    on top of this function's return value before actually renting.
    """
    cfg = NETWORK_CONFIG["TRC20"]
    parameter = trx_abi.encode(["address", "uint256"], [to_hex_address(to_address), raw_amount]).hex()

    resp = httpx.post(
        f"{settings.trongrid_base_url}/wallet/triggerconstantcontract",
        json={
            "owner_address": to_hex_address(from_address),
            "contract_address": to_hex_address(cfg["contract_address"]),
            "function_selector": "transfer(address,uint256)",
            "parameter": parameter,
            "visible": False,
        },
        headers={"TRON-PRO-API-KEY": settings.trongrid_api_key},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()

    if not data.get("result", {}).get("result"):
        raise RuntimeError(f"Energy simulation for {from_address} -> {to_address} did not succeed: {data}")

    # energy_penalty (Tron's surcharge for callers relying on delegated/
    # rented rather than self-owned Energy) isn't always present — 0 when
    # absent, same "no penalty this time" outcome either way.
    return data["energy_used"] + data.get("energy_penalty", 0)


_ENERGY_ORDER_POLL_SECONDS = 2
_ENERGY_ORDER_MAX_ATTEMPTS = 15  # ~30s of polling — this codebase's first real order settled in ~3s


def _poll_energy_order(order_id: str) -> dict:
    """Polls GET /orders/{order_id} until it leaves the transient
    "accepted" state. Exists because of a real discrepancy between
    GetBlock's docs and its actual live behavior, found on this codebase's
    first real rental: the docs claim delegate-energy "completes
    immediately" with a status=="success" response, but the real response
    instead comes back status=="accepted" (order placed, not yet settled),
    empty txid/price_usd, settling into status=="charged" — their actual
    terminal-success value, never "success" — moments later once payment
    and delegation both complete. Treating that first "accepted" response
    as an outright failure was the exact bug this function fixes: it
    aborted a sweep whose Energy had, in fact, already been rented and
    charged for, wasting that real charge since the sweep never got to use
    the Energy it had just paid for.
    """
    for _ in range(_ENERGY_ORDER_MAX_ATTEMPTS):
        resp = httpx.get(
            f"{GETBLOCK_ENERGY_BASE_URL}/orders/{order_id}",
            headers={"Authorization": f"Bearer {settings.getblock_energy_api_key}"},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json().get("data", {})
        if data.get("status") != "accepted":
            return data
        time.sleep(_ENERGY_ORDER_POLL_SECONDS)
    raise EnergyRentalFailed(f"GetBlock order {order_id} did not settle within the poll window — still 'accepted'")


def _rent_energy(deposit_address: str, energy_amount: int) -> dict:
    """Rents energy_amount Energy from GetBlock's Energy Rental market,
    delegated directly to deposit_address for 1 hour — comfortably longer
    than a single sweep takes to complete, short enough not to pay for
    capacity that outlives its use.

    NOT actually synchronous despite GetBlock's own docs claiming it is —
    see _poll_energy_order's docstring for the real observed behavior this
    works around. Returns the final order dict once status=="charged".
    Raises EnergyRentalFailed for a genuine failure or an order that never
    settles — see that exception's docstring for why every raise here is
    safe to retry (a raise here always means either no charge happened, or
    the charge is directly visible in what's logged below for manual
    follow-up, never a silent unaccounted-for charge).
    """
    if not settings.getblock_energy_api_key:
        raise EnergyRentalFailed("GETBLOCK_ENERGY_API_KEY is not configured — see .env.example")

    try:
        resp = httpx.post(
            f"{GETBLOCK_ENERGY_BASE_URL}/delegate-energy",
            headers={
                "Authorization": f"Bearer {settings.getblock_energy_api_key}",
                "Content-Type": "application/json",
                # Recommended by GetBlock so a retried HTTP request (e.g.
                # this call's own response timing out even though GetBlock
                # received it) can never be double-charged — a fresh UUID
                # per attempt, not reused across retries of the same logical
                # sweep, so an intentional retry after a genuine failure
                # still pays for a genuinely new rental, exactly as it should.
                "Idempotency-Key": str(uuid.uuid4()),
            },
            json={"target_address": deposit_address, "volume": energy_amount, "duration": "1h"},
            timeout=15,
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise EnergyRentalFailed(f"GetBlock energy rental request failed: {exc}") from exc

    data = resp.json().get("data", {})
    if data.get("status") == "accepted":
        # Real field name from the POST response is "orderId" (camelCase)
        # — inconsistent with the GET /orders/{id} response's own "id"
        # field for the same value, but that's genuinely what each endpoint
        # returns, not a typo here.
        data = _poll_energy_order(data["orderId"])

    if data.get("status") != "charged":
        raise EnergyRentalFailed(f"GetBlock energy rental did not succeed: {data}")

    logger.info(
        "Rented %s Energy from GetBlock for %s (cost: $%s, order=%s, txid=%s)",
        energy_amount, deposit_address, data.get("price_usd"), data.get("id"), data.get("txid"),
    )
    return data


# ── Self-staked Energy delegation — DORMANT, superseded by GetBlock rental
# above. Left in place (not deleted) because it's not broken and the TRX
# already staked through stake_gas_wallet is real; sweep_tron_usdt_deposit
# no longer calls anything below this point, though — see the GetBlock
# section's header comment for the full story of why this stopped being
# what's actually used. ─────────────────────────────────────────────────────

# How much TRX-equivalent to delegate for Energy per sweep. Padding over
# the ~1.5 TRX a standard USDT transfer actually burns at the current ~100
# sun/energy price (see the architecture doc's "How a sweep moves funds"
# section) — congestion can push the real cost up, and a failed transfer
# from underestimating is more disruptive than a slightly oversized
# delegation. Raise this if sweeps start failing with an out-of-energy
# error; lower it once real usage shows it's comfortably oversized.
#
# Lowered from 15 to 10 for the initial mainnet gas wallet funding — the
# wallet was staked with ~12 TRX (see stake_gas_wallet's call site history),
# which can't cover a 15 TRX delegation with anything left as an unstaked
# fee buffer. 10 still leaves ~6-7x headroom over the real ~1.5 TRX cost, so
# this isn't a thinner safety margin in practice, just a smaller absolute
# number to match what's actually staked. Raise both the staked amount (via
# stake_gas_wallet) and this constant together if a larger cushion is ever
# wanted — they're not required to move in lockstep, but a delegation size
# larger than what's staked will always fail outright.
TRON_ENERGY_DELEGATION_TRX = Decimal("10")

# Below this, a deposit address's remaining on-chain USDT balance is treated
# as "already swept, nothing left worth another attempt" — same philosophy
# as chain_watcher_service.MIN_DEPOSIT_USD: not worth spending gas to chase.
TRON_SWEEP_DUST_THRESHOLD = Decimal("0.01")

# How long to wait for a broadcast transaction to confirm before giving up
# and marking the sweep FAILED. Safe to set conservatively short — a
# timeout here doesn't risk a double-sweep, since every future attempt
# re-checks the real on-chain balance rather than trusting this table.
_CONFIRMATION_POLL_SECONDS = 3
_CONFIRMATION_MAX_ATTEMPTS = 20  # ~1 minute total


class ConsolidationNotConfigured(RuntimeError):
    """Raised when a sweep is attempted for a network with no
    consolidation_addresses row yet — see get_consolidation_address's
    docstring for why this must be a hard refusal, never a silent no-op."""


class GasWalletNotConfigured(RuntimeError):
    """Raised when TRON_GAS_WALLET_PRIVATE_KEY isn't set — see .env.example."""


def _tron_client() -> Tron:
    return Tron(HTTPProvider(endpoint_uri=settings.trongrid_base_url, api_key=settings.trongrid_api_key))


def _gas_wallet_key() -> PrivateKey:
    if not settings.tron_gas_wallet_private_key:
        raise GasWalletNotConfigured("TRON_GAS_WALLET_PRIVATE_KEY is not configured — see .env.example")
    return PrivateKey(bytes.fromhex(settings.tron_gas_wallet_private_key))


def get_tron_usdt_balance(address: str) -> Decimal:
    """Reads a deposit address's USDT balance directly from the chain — the
    source of truth for whether a sweep is still needed, rather than
    trusting our own `sweeps` table (which is exactly what could be wrong
    after a crash between broadcast and recording — see the architecture
    doc's double-sweep failure-mode note)."""
    cfg = NETWORK_CONFIG["TRC20"]
    contract = _tron_client().get_contract(cfg["contract_address"])
    raw_balance = contract.functions.balanceOf(address)
    return Decimal(raw_balance) / (10 ** cfg["decimals"])


def stake_gas_wallet(trx_amount: Decimal) -> str:
    """One-off/occasional setup step — NOT part of the per-sweep flow, run
    this by hand (a short script, or a Python shell) to freeze TRX on the
    gas wallet for ENERGY, building the pool sweeps delegate from. Run it
    once with a starting amount, and again later if delegations start
    failing because the pool is exhausted. Returns the freeze tx's hash."""
    client = _tron_client()
    key = _gas_wallet_key()
    owner = key.public_key.to_base58check_address()
    amount_sun = int(trx_amount * 1_000_000)

    txn = client.trx.freeze_balance(owner, amount_sun, resource="ENERGY").build().sign(key)
    txn.broadcast()
    logger.info("Staked %s TRX for ENERGY on gas wallet %s (tx=%s)", trx_amount, owner, txn.txid)
    return txn.txid


# How much TRX a deposit address needs to have SITTING ON IT before a
# sweep can broadcast successfully — topped up to this amount (not by this
# amount) at the start of every sweep attempt, whether the address has
# never been touched or has been swept before. Covers two separate real
# costs discovered live, the hard way, across this codebase's actual first
# mainnet sweeps, not assumed from documentation:
#
#   1. Tron account creation. A deposit address that's only ever received
#      USDT (never any native TRX) has no entry in Tron's native account
#      registry at all — that's a completely separate thing from the TRC-20
#      contract's own internal balance mapping, which the deposit address
#      DOES appear in the moment it receives a deposit. Energy delegation
#      (whether self-staked or, now, GetBlock-rented — see _rent_energy)
#      requires the TARGET account to already exist in that native
#      registry, and fails outright with "Account not exists" otherwise.
#      Sending ANY native TRX transfer to a not-yet-existing address is
#      what creates its account record — there's a real ~1 TRX network fee
#      for this too, but that's charged to the SENDER (the gas wallet), not
#      deducted from the amount that lands on the deposit address.
#
#   2. The sweep transaction's own bandwidth. Once the account exists, its
#      free daily bandwidth allowance (~600 points) is NOT enough on its
#      own for a USDT transfer (~345 points needed) once even a little of
#      that allowance has already been spent (e.g. an earlier failed
#      attempt from the same address) — and Tron's bandwidth fallback isn't
#      "burn just the marginal shortfall," it's "burn for the WHOLE
#      transaction" once free bandwidth can't fully cover it. A real
#      successful sweep on this codebase burned exactly 345,000 sun (0.345
#      TRX) this way — verified directly from that transaction's own
#      receipt, not estimated. A too-small top-up (0.1 TRX was tried first)
#      fails with BANDWIDTH_ERROR right at the final broadcast step, after
#      Energy has already been rented and paid for — an expensive way to
#      fail, which is exactly why this is now generously padded rather than
#      minimal: 1 TRX comfortably covers the real 0.345 TRX cost with
#      margin for the bandwidth price or transaction shape ever shifting
#      slightly, at a cost of a fraction of a cent more per sweep than the
#      bare minimum would be.
TRON_ACCOUNT_READY_TRX = Decimal("1")


def _ensure_account_ready(deposit_address: str) -> None:
    """Tops a deposit address up to TRON_ACCOUNT_READY_TRX worth of native
    TRX if it currently has less — covers BOTH account creation (an
    address that's never existed natively at all) AND topping up an
    address that exists but has been drained below the working amount
    (e.g. a PREVIOUS sweep attempt's own fee already spent what little TRX
    it had, which is exactly what happened on this codebase's first real
    sweep and caused a second round of BANDWIDTH_ERROR failures even after
    the account existed). Treating "exists but underfunded" and "doesn't
    exist yet" as the same case — top up to the target either way — is
    what makes this safe to call unconditionally at the start of every
    sweep attempt, not just the very first one for a given address.

    A no-op (no transfer, no fee) if the address already has enough — reads
    the real on-chain balance every time rather than assuming a past
    top-up is still intact, since a previous failed sweep attempt could
    have spent some of it.
    """
    client = _tron_client()
    target_sun = int(TRON_ACCOUNT_READY_TRX * 1_000_000)

    try:
        current_sun = client.get_account(deposit_address).get("balance", 0)
    except AddressNotFound:
        current_sun = 0  # doesn't exist yet at all — same treatment as "exists but empty"

    if current_sun >= target_sun:
        return  # already has enough — nothing to do

    key = _gas_wallet_key()
    owner = key.public_key.to_base58check_address()
    top_up_sun = target_sun - current_sun

    txn = client.trx.transfer(owner, deposit_address, top_up_sun).build().sign(key)
    txn.broadcast()
    logger.info(
        "Topped up %s (had %s sun, sent %s sun to reach %s TRX target, tx=%s)",
        deposit_address, current_sun, top_up_sun, TRON_ACCOUNT_READY_TRX, txn.txid,
    )
    _wait_for_confirmation(client, txn.txid)


def _delegate_energy(deposit_address: str) -> str:
    """Delegates TRON_ENERGY_DELEGATION_TRX worth of Energy from the gas
    wallet to a deposit address, just before sweeping it. Whatever tronpy
    raises on broadcast failure (e.g. the gas wallet's staked pool is
    exhausted) propagates to the caller as a safe-fail: no USDT has moved
    yet, only the delegation attempt failed, so this sweep just needs
    retrying later (after re-staking via stake_gas_wallet if that's why)."""
    client = _tron_client()
    key = _gas_wallet_key()
    owner = key.public_key.to_base58check_address()
    amount_sun = int(TRON_ENERGY_DELEGATION_TRX * 1_000_000)

    txn = client.trx.delegate_resource(owner, deposit_address, amount_sun, resource="ENERGY").build().sign(key)
    txn.broadcast()
    return txn.txid


def _undelegate_energy(deposit_address: str) -> None:
    """Best-effort reclaim of the delegated Energy after a sweep completes
    — not on the critical path. A failure here only means the gas wallet's
    pool is smaller than it should be until this is retried or the
    delegation's own expiry reclaims it; it never affects a sweep that's
    already happened, so it's logged and swallowed rather than raised."""
    try:
        client = _tron_client()
        key = _gas_wallet_key()
        owner = key.public_key.to_base58check_address()
        amount_sun = int(TRON_ENERGY_DELEGATION_TRX * 1_000_000)
        client.trx.undelegate_resource(owner, deposit_address, amount_sun, resource="ENERGY").build().sign(key).broadcast()
    except Exception:
        logger.exception("Best-effort undelegate failed for %s — not fatal, continuing", deposit_address)


def _wait_for_confirmation(client: Tron, tx_id: str) -> bool:
    """Polls get_transaction_info until the transaction has a receipt.
    Returns True if it succeeded on-chain, False if it reverted or never
    confirmed within the wait window — callers must not treat False as
    proof nothing happened; the on-chain balance check in
    sweep_tron_usdt_deposit is the actual source of truth for that.

    get_transaction_info RAISES tronpy.exceptions.TransactionNotFound
    (rather than returning an empty/falsy result) for the first several
    seconds after a broadcast, before TronGrid has indexed it — this is the
    normal, expected state for at least the first poll or two, not a real
    error. Found live: this function had never actually been exercised
    against a real broadcast-and-wait before this codebase's first real
    mainnet sweep attempt, so this gap was never hit until then. Treating it
    as "keep polling" (same as the falsy-info case below) rather than
    letting it propagate is what fixes that — a transaction that genuinely
    never confirms still correctly falls through to `return False` once
    _CONFIRMATION_MAX_ATTEMPTS is exhausted, same as before.
    """
    for _ in range(_CONFIRMATION_MAX_ATTEMPTS):
        try:
            info = client.get_transaction_info(tx_id)
        except TransactionNotFound:
            info = None
        if info and "receipt" in info:
            return info["receipt"].get("result") == "SUCCESS"
        time.sleep(_CONFIRMATION_POLL_SECONDS)
    return False


_sweep_status_cache: dict[str, int] = {}


def _sweep_status_id(code: str) -> int:
    if not _sweep_status_cache:
        rows = get_supabase().table("sweep_statuses").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'sweep_statuses' returned no rows")
        _sweep_status_cache.update({row["code"]: row["id"] for row in rows})
    return _sweep_status_cache[code]


def _existing_in_flight_sweep(wallet_id: str) -> dict | None:
    """A wallet with a PENDING or BROADCAST sweep row already has an
    attempt in flight — used to refuse starting a second one concurrently
    (the "Sweep Now double-click" failure mode from the pre-build review)."""
    rows = (
        get_supabase()
        .table("sweeps")
        .select("id,status_id")
        .eq("wallet_id", wallet_id)
        .in_("status_id", [_sweep_status_id("PENDING"), _sweep_status_id("BROADCAST")])
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


def sweep_tron_usdt_deposit(wallet_row: dict) -> dict:
    """Sweeps one wallet's real on-chain USDT balance to the configured
    Bybit TRC-20 address. wallet_row needs: id, deposit_address,
    derivation_index.

    Safe to call again for a wallet that's already been fully swept, or
    whose previous attempt crashed partway through — every attempt starts
    by reading the address's actual on-chain balance rather than trusting
    the `sweeps` table, which is what makes retrying safe. See the
    architecture doc's "Deposit consolidation" section for the full design,
    and the pre-build failure-mode review for why this ordering matters.

    Returns {"status": "already_empty" | "confirmed" | "failed", ...}.
    Raises ConsolidationNotConfigured / GasWalletNotConfigured for setup
    problems that need a human to fix, not a retry.
    """
    destination = get_consolidation_address("TRC20")
    if destination is None:
        raise ConsolidationNotConfigured("No TRC-20 consolidation address configured — set one in the admin panel first")

    wallet_id = wallet_row["id"]
    deposit_address = wallet_row["deposit_address"]

    in_flight = _existing_in_flight_sweep(wallet_id)
    if in_flight is not None:
        logger.info("Sweep already in flight for wallet %s (sweep id %s) — skipping", wallet_id, in_flight["id"])
        return {"status": "already_in_flight", "sweep_id": in_flight["id"]}

    balance = get_tron_usdt_balance(deposit_address)
    if balance < TRON_SWEEP_DUST_THRESHOLD:
        logger.info("Wallet %s (%s) already empty on-chain (%s USDT) — nothing to sweep", wallet_id, deposit_address, balance)
        return {"status": "already_empty", "balance": balance}

    sweep_row = (
        get_supabase()
        .table("sweeps")
        .insert(
            {
                "wallet_id": wallet_id,
                "network_id": _network_id("TRC20"),
                "asset_id": _asset_id("USDT"),
                "status_id": _sweep_status_id("PENDING"),
                "amount": str(balance),
                "destination_address": destination,
            }
        )
        .execute()
        .data[0]
    )
    sweep_id = sweep_row["id"]

    try:
        # Must happen before renting Energy AND before the final transfer
        # broadcast — see _ensure_account_ready's docstring for the two
        # separate real failures this prevents (no native account yet, and
        # not enough TRX on the address to cover its own transfer's
        # bandwidth burn), both found live on this codebase's actual first
        # mainnet sweeps. A no-op if the address already has enough.
        _ensure_account_ready(deposit_address)

        cfg = NETWORK_CONFIG["TRC20"]
        raw_amount = int(balance * (10 ** cfg["decimals"]))

        # Measure exactly how much Energy THIS transfer needs, then rent
        # that much from GetBlock rather than self-staking — see
        # config.py's getblock_energy_api_key comment and this module's git
        # history for why: the original self-staked design
        # (stake_gas_wallet/_delegate_energy below, left in place but
        # dormant) turned out to need roughly 2,000+ TRX staked to cover a
        # single real mainnet USDT transfer, discovered live via this exact
        # simulation call returning ~130k Energy for this contract, well
        # above generic-TRC20 assumptions.
        simulated_energy = _estimate_transfer_energy(deposit_address, destination, raw_amount)
        energy_needed = max(30_000, int(simulated_energy * ENERGY_ESTIMATE_SAFETY_MARGIN))
        rental = _rent_energy(deposit_address, energy_needed)
        get_supabase().table("sweeps").update({"resource_tx_hash": rental.get("txid")}).eq("id", sweep_id).execute()

        # Re-derived on the spot, used immediately, then allowed to fall out
        # of scope — never stored, never logged. See wallet_service.derive_private_key.
        priv_key = PrivateKey(wallet_service.derive_private_key("TRC20", wallet_row["derivation_index"]))

        client = _tron_client()
        contract = client.get_contract(cfg["contract_address"])

        txn = (
            contract.functions.transfer(destination, raw_amount)
            .with_owner(deposit_address)
            .fee_limit(100_000_000)  # 100 TRX ceiling — far above what a transfer actually costs, just a broadcast-time safety cap
            .build()
            .sign(priv_key)
        )
        del priv_key  # explicit, even though Python's GC would reclaim it anyway

        txn.broadcast()
        get_supabase().table("sweeps").update(
            {"sweep_tx_hash": txn.txid, "status_id": _sweep_status_id("BROADCAST")}
        ).eq("id", sweep_id).execute()

        confirmed = _wait_for_confirmation(client, txn.txid)
        if confirmed:
            get_supabase().table("sweeps").update(
                {
                    "status_id": _sweep_status_id("CONFIRMED"),
                    "confirmed_at": datetime.now(tz=timezone.utc).isoformat(),
                }
            ).eq("id", sweep_id).execute()
            # No undelegate step needed here (unlike the old self-staked
            # design) — rented Energy belongs to GetBlock's pool, not ours;
            # it simply expires at the end of its rented duration on its own.
            logger.info("Swept %s USDT from wallet %s to %s (tx=%s)", balance, wallet_id, destination, txn.txid)
            return {"status": "confirmed", "sweep_id": sweep_id, "amount": balance, "tx_hash": txn.txid}

        get_supabase().table("sweeps").update(
            {"status_id": _sweep_status_id("FAILED"), "error_message": "Broadcast succeeded but confirmation timed out or reverted"}
        ).eq("id", sweep_id).execute()
        logger.warning("Sweep for wallet %s broadcast (tx=%s) but did not confirm — will show as failed, safe to retry", wallet_id, txn.txid)
        return {"status": "failed", "sweep_id": sweep_id, "tx_hash": txn.txid}

    except Exception as exc:
        get_supabase().table("sweeps").update(
            {"status_id": _sweep_status_id("FAILED"), "error_message": str(exc)}
        ).eq("id", sweep_id).execute()
        logger.exception("Sweep failed for wallet %s before/during broadcast — no funds moved if no sweep_tx_hash was recorded", wallet_id)
        return {"status": "failed", "sweep_id": sweep_id, "error": str(exc)}


# ── EVM sweep — Base & Polygon USDC via EIP-3009 (Module 3) ─────────────────
# The deposit address only ever produces an off-chain signature (free, no
# transaction); a single relayer wallet submits it on-chain and pays gas.
# Verified directly against the live testnet contracts before this was
# built — both expose authorizationState() (confirming EIP-3009 support)
# and return name()="USDC"/version()="2", which is why those are read from
# the contract below rather than hardcoded: real Circle mainnet USDC
# returns name()="USD Coin", a different string, and hardcoding either one
# would silently produce an invalid signature the moment this pointed at
# the other environment.

# How long a signed authorization stays valid before it expires — bounds
# the replay/expiry window per the pre-build failure-mode review. An
# expired authorization just means "sign a new one" next attempt, never a
# stuck state — nothing on-chain has happened yet at that point.
EVM_AUTHORIZATION_VALID_SECONDS = 3600

# Same "not worth chasing" dust philosophy as TRON_SWEEP_DUST_THRESHOLD —
# both assets are stablecoins at 6 decimals, so one threshold serves both.
EVM_SWEEP_DUST_THRESHOLD = Decimal("0.01")

_EIP712_DOMAIN_TYPE = [
    {"name": "name", "type": "string"},
    {"name": "version", "type": "string"},
    {"name": "chainId", "type": "uint256"},
    {"name": "verifyingContract", "type": "address"},
]

_EIP3009_TYPES = {
    "TransferWithAuthorization": [
        {"name": "from", "type": "address"},
        {"name": "to", "type": "address"},
        {"name": "value", "type": "uint256"},
        {"name": "validAfter", "type": "uint256"},
        {"name": "validBefore", "type": "uint256"},
        {"name": "nonce", "type": "bytes32"},
    ],
}

_USDC_ABI = [
    {"constant": True, "inputs": [], "name": "name", "outputs": [{"name": "", "type": "string"}], "type": "function"},
    {"constant": True, "inputs": [], "name": "version", "outputs": [{"name": "", "type": "string"}], "type": "function"},
    {
        "constant": True,
        "inputs": [{"name": "account", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "", "type": "uint256"}],
        "type": "function",
    },
    {
        "constant": False,
        "inputs": [
            {"name": "from", "type": "address"},
            {"name": "to", "type": "address"},
            {"name": "value", "type": "uint256"},
            {"name": "validAfter", "type": "uint256"},
            {"name": "validBefore", "type": "uint256"},
            {"name": "nonce", "type": "bytes32"},
            {"name": "v", "type": "uint8"},
            {"name": "r", "type": "bytes32"},
            {"name": "s", "type": "bytes32"},
        ],
        "name": "transferWithAuthorization",
        "outputs": [],
        "type": "function",
    },
]

# Cached per network for the process lifetime — a network's deployed
# contract, and therefore its name()/version(), never changes without a
# redeploy, so there's no correctness reason to re-fetch this every sweep.
_eip3009_domain_cache: dict[str, dict] = {}


class RelayerWalletNotConfigured(RuntimeError):
    """Raised when EVM_RELAYER_PRIVATE_KEY isn't set — see .env.example."""


# ── Operational wallet generation — admin convenience (Module 6) ────────────
# Generates a fresh Tron or EVM keypair on request, for the gas/staking
# wallet or the relayer wallet respectively. Deliberately does NOT persist
# the private key anywhere — not the database, not a cache, nowhere. It's
# returned once in the API response for an admin to copy into
# TRON_GAS_WALLET_PRIVATE_KEY / EVM_RELAYER_PRIVATE_KEY (.env locally,
# Railway secrets in production); it only takes effect after that manual
# step and a backend restart, since settings are read from the environment
# once at process startup (see config.py). This keeps the existing secrets
# model — private keys live only in env vars, never in Postgres — intact,
# rather than quietly expanding it as a side effect of a convenience button.


def generate_tron_keypair() -> dict:
    key = PrivateKey.random()
    return {"address": key.public_key.to_base58check_address(), "private_key": key.hex()}


def generate_evm_keypair() -> dict:
    account = Account.create()
    return {"address": account.address, "private_key": account.key.hex()}


def _evm_client(network_code: str) -> Web3:
    rpc_url = settings.alchemy_base_rpc_url if network_code == "BASE" else settings.alchemy_polygon_rpc_url
    return Web3(Web3.HTTPProvider(rpc_url))


def _relayer_account() -> Account:
    if not settings.evm_relayer_private_key:
        raise RelayerWalletNotConfigured("EVM_RELAYER_PRIVATE_KEY is not configured — see .env.example")
    return Account.from_key(settings.evm_relayer_private_key)


def _usdc_contract(w3: Web3, network_code: str):
    address = Web3.to_checksum_address(NETWORK_CONFIG[network_code]["contract_address"])
    return w3.eth.contract(address=address, abi=_USDC_ABI)


def _eip3009_domain(w3: Web3, network_code: str, contract) -> dict:
    if network_code not in _eip3009_domain_cache:
        _eip3009_domain_cache[network_code] = {
            "name": contract.functions.name().call(),
            "version": contract.functions.version().call(),
            "chainId": w3.eth.chain_id,
            "verifyingContract": contract.address,
        }
    return _eip3009_domain_cache[network_code]


def get_evm_usdc_balance(network_code: str, address: str) -> Decimal:
    """Reads a deposit address's USDC balance directly from the chain —
    same source-of-truth role as get_tron_usdt_balance for the Tron path."""
    w3 = _evm_client(network_code)
    cfg = NETWORK_CONFIG[network_code]
    contract = _usdc_contract(w3, network_code)
    raw = contract.functions.balanceOf(Web3.to_checksum_address(address)).call()
    return Decimal(raw) / (10 ** cfg["decimals"])


def sweep_evm_usdc_deposit(wallet_row: dict, network_code: str) -> dict:
    """Sweeps one wallet's real on-chain USDC balance to the configured
    Bybit address via an EIP-3009 gasless authorization. Same double-sweep
    protection and return shape as sweep_tron_usdt_deposit — see that
    function's docstring; the reasoning is identical, only the signing/
    broadcast mechanism differs. network_code is "BASE" or "POLYGON".
    """
    destination = get_consolidation_address(network_code)
    if destination is None:
        raise ConsolidationNotConfigured(
            f"No {network_code} consolidation address configured — set one in the admin panel first"
        )

    wallet_id = wallet_row["id"]
    deposit_address = Web3.to_checksum_address(wallet_row["deposit_address"])

    in_flight = _existing_in_flight_sweep(wallet_id)
    if in_flight is not None:
        logger.info("Sweep already in flight for wallet %s (sweep id %s) — skipping", wallet_id, in_flight["id"])
        return {"status": "already_in_flight", "sweep_id": in_flight["id"]}

    balance = get_evm_usdc_balance(network_code, deposit_address)
    if balance < EVM_SWEEP_DUST_THRESHOLD:
        logger.info("Wallet %s (%s) already empty on-chain (%s USDC) — nothing to sweep", wallet_id, deposit_address, balance)
        return {"status": "already_empty", "balance": balance}

    sweep_row = (
        get_supabase()
        .table("sweeps")
        .insert(
            {
                "wallet_id": wallet_id,
                "network_id": _network_id(network_code),
                "asset_id": _asset_id("USDC"),
                "status_id": _sweep_status_id("PENDING"),
                "amount": str(balance),
                "destination_address": destination,
            }
        )
        .execute()
        .data[0]
    )
    sweep_id = sweep_row["id"]

    try:
        w3 = _evm_client(network_code)
        contract = _usdc_contract(w3, network_code)
        domain = _eip3009_domain(w3, network_code, contract)
        cfg = NETWORK_CONFIG[network_code]

        raw_amount = int(balance * (10 ** cfg["decimals"]))
        valid_after = 0
        valid_before = int(time.time()) + EVM_AUTHORIZATION_VALID_SECONDS
        nonce = secrets.token_bytes(32)

        # Re-derived on the spot, used only to produce an off-chain
        # signature — never broadcasts anything itself, falls out of scope
        # right after. See wallet_service.derive_private_key.
        priv_key_bytes = wallet_service.derive_private_key(network_code, wallet_row["derivation_index"])
        full_message = {
            "types": {"EIP712Domain": _EIP712_DOMAIN_TYPE, **_EIP3009_TYPES},
            "domain": domain,
            "primaryType": "TransferWithAuthorization",
            "message": {
                "from": deposit_address,
                "to": destination,
                "value": raw_amount,
                "validAfter": valid_after,
                "validBefore": valid_before,
                "nonce": nonce,
            },
        }
        signable = encode_typed_data(full_message=full_message)
        signed_auth = Account.sign_message(signable, private_key=priv_key_bytes)
        del priv_key_bytes

        relayer = _relayer_account()
        # Concurrent sweeps on the same network share one relayer wallet, so
        # its transaction nonce must be assigned under a lock — two
        # simultaneous "what's my next nonce" reads is the classic way to
        # produce a stuck or rejected EVM transaction. Per the pre-build
        # failure-mode review.
        with get_redis_sync().lock(f"evm_relayer_tx_lock:{network_code}", timeout=60):
            tx = contract.functions.transferWithAuthorization(
                deposit_address,
                destination,
                raw_amount,
                valid_after,
                valid_before,
                nonce,
                signed_auth.v,
                signed_auth.r.to_bytes(32, "big"),
                signed_auth.s.to_bytes(32, "big"),
            ).build_transaction(
                {
                    "from": relayer.address,
                    "nonce": w3.eth.get_transaction_count(relayer.address, "pending"),
                    "gas": 200_000,  # generous ceiling — actual cost is usually a fraction of this
                    "gasPrice": w3.eth.gas_price,
                    "chainId": w3.eth.chain_id,
                }
            )
            signed_tx = relayer.sign_transaction(tx)
            tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction).hex()

        get_supabase().table("sweeps").update(
            {"sweep_tx_hash": tx_hash, "status_id": _sweep_status_id("BROADCAST")}
        ).eq("id", sweep_id).execute()

        try:
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=90)
        except TimeExhausted:
            get_supabase().table("sweeps").update(
                {"status_id": _sweep_status_id("FAILED"), "error_message": "Broadcast succeeded but confirmation timed out"}
            ).eq("id", sweep_id).execute()
            logger.warning("Sweep for wallet %s broadcast (tx=%s) but did not confirm in time — safe to retry", wallet_id, tx_hash)
            return {"status": "failed", "sweep_id": sweep_id, "tx_hash": tx_hash}

        if receipt.status == 1:
            get_supabase().table("sweeps").update(
                {"status_id": _sweep_status_id("CONFIRMED"), "confirmed_at": datetime.now(tz=timezone.utc).isoformat()}
            ).eq("id", sweep_id).execute()
            logger.info("Swept %s USDC from wallet %s to %s (tx=%s)", balance, wallet_id, destination, tx_hash)
            return {"status": "confirmed", "sweep_id": sweep_id, "amount": balance, "tx_hash": tx_hash}

        get_supabase().table("sweeps").update(
            {"status_id": _sweep_status_id("FAILED"), "error_message": "Transaction reverted on-chain"}
        ).eq("id", sweep_id).execute()
        return {"status": "failed", "sweep_id": sweep_id, "tx_hash": tx_hash}

    except Exception as exc:
        get_supabase().table("sweeps").update(
            {"status_id": _sweep_status_id("FAILED"), "error_message": str(exc)}
        ).eq("id", sweep_id).execute()
        logger.exception("Sweep failed for wallet %s before/during broadcast — no funds moved if no sweep_tx_hash was recorded", wallet_id)
        return {"status": "failed", "sweep_id": sweep_id, "error": str(exc)}


# ── Wiring it together for the admin — "Sweep Now" (Module 4) ───────────────
# There is deliberately no scheduled job anywhere in this module. Everything
# below exists to answer two questions on demand, only when an admin asks:
# "what's actually sitting unswept right now" and "go sweep it." Both
# re-check real on-chain balances every time they're called rather than
# trusting any cached or previously-computed list — see the "stale
# pending-list" failure mode from the pre-build review: a deposit landing
# between page-load and button-click must never be missed, and a wallet
# that's already been swept must never show up again just because a DB
# write lagged behind the chain.

_ASSET_BY_NETWORK = {"TRC20": "USDT", "BASE": "USDC", "POLYGON": "USDC"}


def _network_code_by_id() -> dict[int, str]:
    _network_id("TRC20")  # forces _lookup_cache to populate if it hasn't yet
    return {v: k for k, v in _lookup_cache.items()}


def _candidate_wallets() -> list[dict]:
    """Every wallet belonging to a (user, network) pair that has at least
    one DEPOSIT ledger entry — the universe list_pending_sweeps() checks
    real on-chain balances for. Filtering to "has ever had a deposit"
    first, rather than checking every wallet that merely exists, keeps this
    from making an RPC call per *never-used* address as the user base
    grows; it's a cheap DB-only prefilter, not a substitute for the
    on-chain balance check that follows."""
    deposit_rows = (
        get_supabase()
        .table("ledger_entries")
        .select("user_id,network_id")
        .eq("entry_type_id", _entry_type_id("DEPOSIT"))
        .execute()
        .data
    )
    pairs = {(r["user_id"], r["network_id"]) for r in deposit_rows if r["network_id"] is not None}
    if not pairs:
        return []

    user_ids = list({p[0] for p in pairs})
    wallet_rows = (
        get_supabase()
        .table("wallets")
        .select("id,user_id,network_id,deposit_address,derivation_index")
        .in_("user_id", user_ids)
        .execute()
        .data
    )
    code_by_id = _network_code_by_id()
    return [
        {**w, "network_code": code_by_id[w["network_id"]]}
        for w in wallet_rows
        if (w["user_id"], w["network_id"]) in pairs
    ]


def list_pending_sweeps() -> list[dict]:
    """Every wallet with a real, non-dust on-chain balance and no sweep
    already in flight — this is both what the admin panel's pending-sweeps
    view shows and, re-run fresh, exactly what trigger_sweep_now() acts on.
    A balance-check failure for one wallet (RPC hiccup) is logged and
    skipped rather than failing the whole listing — same "one failure can't
    block the rest" principle as chain_watcher_service.sweep_all_networks."""
    pending = []
    for wallet in _candidate_wallets():
        network_code = wallet["network_code"]
        if _existing_in_flight_sweep(wallet["id"]) is not None:
            continue
        try:
            if network_code == "TRC20":
                balance = get_tron_usdt_balance(wallet["deposit_address"])
                threshold = TRON_SWEEP_DUST_THRESHOLD
            else:
                balance = get_evm_usdc_balance(network_code, wallet["deposit_address"])
                threshold = EVM_SWEEP_DUST_THRESHOLD
        except Exception:
            logger.exception(
                "Skipping wallet %s (%s) in pending-sweeps listing — balance check failed", wallet["id"], network_code
            )
            continue

        if balance >= threshold:
            pending.append(
                {
                    "wallet_id": wallet["id"],
                    "network": network_code,
                    "asset": _ASSET_BY_NETWORK[network_code],
                    "deposit_address": wallet["deposit_address"],
                    "balance": balance,
                }
            )
    return pending


def trigger_sweep_now() -> list[dict]:
    """Re-lists pending sweeps fresh (never trusts whatever the admin's
    browser last rendered) and queues one Celery task per wallet. Returns
    what was queued so the admin panel can show it immediately rather than
    waiting for each sweep to finish — sweeps happen asynchronously, this
    call only starts them. Import is local to avoid a celery_app <->
    custody_service import cycle (workers import this module; this
    function is the one place custody_service needs to reach back into
    workers, only at call time)."""
    from app.workers.consolidate_deposits import sweep_evm_wallet, sweep_tron_wallet

    queued = []
    for item in list_pending_sweeps():
        if item["network"] == "TRC20":
            task = sweep_tron_wallet.delay(item["wallet_id"])
        else:
            task = sweep_evm_wallet.delay(item["wallet_id"], item["network"])
        queued.append({**item, "task_id": task.id})
    return queued


class WalletNotPending(RuntimeError):
    """Raised by trigger_sweep_one when the wallet it's asked to sweep
    isn't actually a valid pending-sweep candidate right now — no such
    wallet, no real on-chain balance worth sweeping, or a sweep for it is
    already in flight. Re-validated fresh here rather than trusting
    whatever the admin panel's browser last rendered, same "never trust
    cached state" principle list_pending_sweeps()/trigger_sweep_now() both
    already follow — the admin could click a per-row "Sweep" button on a
    stale page long after that row's real state changed."""


def trigger_sweep_one(wallet_id: str) -> dict:
    """Queues a consolidation sweep for exactly ONE wallet, admin-chosen —
    the single-deposit counterpart to trigger_sweep_now()'s "sweep
    everything pending at once" behavior. Exists because every sweep costs
    real money now (GetBlock Energy rental, see _rent_energy above) —
    letting an admin consolidate one cheap, urgent deposit without paying
    to sweep every other pending one in the same click is the whole point.

    Re-validates this wallet the same way list_pending_sweeps() validates
    every candidate (real on-chain balance above the dust threshold, no
    sweep already in flight) before queuing anything — raises
    WalletNotPending rather than silently queuing a sweep for a wallet
    that turns out to be empty or mid-sweep already. Returns the same
    shape as one entry from trigger_sweep_now()'s return list.
    """
    from app.workers.consolidate_deposits import sweep_evm_wallet, sweep_tron_wallet

    rows = (
        get_supabase()
        .table("wallets")
        .select("id,network_id,deposit_address")
        .eq("id", wallet_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise WalletNotPending(f"No wallet found with id {wallet_id}")
    wallet = rows[0]
    network_code = _network_code_by_id().get(wallet["network_id"])
    if network_code is None:
        raise WalletNotPending(f"Wallet {wallet_id} has an unrecognized network_id {wallet['network_id']}")

    if _existing_in_flight_sweep(wallet_id) is not None:
        raise WalletNotPending(f"Wallet {wallet_id} already has a sweep in flight")

    if network_code == "TRC20":
        balance = get_tron_usdt_balance(wallet["deposit_address"])
        threshold = TRON_SWEEP_DUST_THRESHOLD
    else:
        balance = get_evm_usdc_balance(network_code, wallet["deposit_address"])
        threshold = EVM_SWEEP_DUST_THRESHOLD

    if balance < threshold:
        raise WalletNotPending(f"Wallet {wallet_id} has no sweepable on-chain balance right now ({balance})")

    if network_code == "TRC20":
        task = sweep_tron_wallet.delay(wallet_id)
    else:
        task = sweep_evm_wallet.delay(wallet_id, network_code)

    return {
        "wallet_id": wallet_id,
        "network": network_code,
        "asset": _ASSET_BY_NETWORK[network_code],
        "deposit_address": wallet["deposit_address"],
        "balance": balance,
        "task_id": task.id,
    }


def list_recent_sweeps(limit: int = 50) -> list[dict]:
    """Recent sweep attempts across all networks, newest first — the admin
    panel's sweep-history view. Includes failed/in-flight ones deliberately,
    not just confirmed — a stuck sweep needs to be visible, not hidden."""
    code_by_id = _network_code_by_id()
    status_by_id = {v: k for k, v in _sweep_status_cache.items()} if _sweep_status_cache else {}
    if not status_by_id:
        _sweep_status_id("PENDING")
        status_by_id = {v: k for k, v in _sweep_status_cache.items()}
    asset_by_id = {v: k for k, v in _asset_id_cache.items()} if _asset_id_cache else {}
    if not asset_by_id:
        _asset_id("USDT")
        asset_by_id = {v: k for k, v in _asset_id_cache.items()}

    rows = (
        get_supabase()
        .table("sweeps")
        .select("id,wallet_id,network_id,asset_id,status_id,amount,destination_address,sweep_tx_hash,error_message,created_at,confirmed_at")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
    )
    return [
        {
            "id": r["id"],
            "wallet_id": r["wallet_id"],
            "network": code_by_id.get(r["network_id"]),
            "asset": asset_by_id.get(r["asset_id"]),
            "status": status_by_id.get(r["status_id"]),
            "amount": r["amount"],
            "destination_address": r["destination_address"],
            "sweep_tx_hash": r["sweep_tx_hash"],
            "error_message": r["error_message"],
            "created_at": r["created_at"],
            "confirmed_at": r["confirmed_at"],
        }
        for r in rows
    ]
