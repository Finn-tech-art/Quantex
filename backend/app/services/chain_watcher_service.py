import logging
from datetime import datetime, timezone
from decimal import Decimal

import httpx

from app.config import settings
from app.services import email_service, notification_service, withdrawal_unlock_fee_service
from app.services.network_assets import NETWORK_CONFIG
from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

MIN_DEPOSIT_USD = Decimal("20")

# Block-explorer transaction-URL format per network, keyed the same way
# NETWORK_CONFIG is — used only by _send_deposit_confirmed_email below to
# build a "view on-chain" link. Only TRC20 is live right now (see migration
# 019_disable_evm_networks.sql); add BASE -> Basescan and POLYGON ->
# Polygonscan's tx URL formats here once those networks come back, nothing
# else needs to change.
_EXPLORER_TX_URL = {
    "TRC20": "https://tronscan.org/#/transaction/{tx_hash}",
}

_lookup_cache: dict[str, dict[str, int]] = {}


def _lookup(table: str) -> dict[str, int]:
    """Same pattern as auth_service._lookup — static reference tables fetched
    once and cached for the process lifetime."""
    if table not in _lookup_cache:
        rows = get_supabase().table(table).select("id,code").execute().data
        if not rows:
            raise RuntimeError(f"Lookup table '{table}' returned no rows")
        _lookup_cache[table] = {row["code"]: row["id"] for row in rows}
    return _lookup_cache[table]


def _network_id(code: str) -> int:
    return _lookup("networks")[code]


def _asset_id(code: str) -> int:
    return _lookup("assets")[code]


def _entry_type_id(code: str) -> int:
    return _lookup("ledger_entry_types")[code]


def _known_addresses(network_code: str, lowercase: bool) -> dict[str, str]:
    """{deposit_address: user_id} for every wallet on this network. lowercase
    normalizes for EVM chains, where Alchemy returns lowercase addresses but
    our stored addresses are EIP-55 checksummed."""
    rows = (
        get_supabase()
        .table("wallets")
        .select("user_id,deposit_address")
        .eq("network_id", _network_id(network_code))
        .execute()
        .data
    )
    if lowercase:
        return {row["deposit_address"].lower(): row["user_id"] for row in rows}
    return {row["deposit_address"]: row["user_id"] for row in rows}


def _address_for_user(user_id: str, network_code: str) -> str | None:
    rows = (
        get_supabase()
        .table("wallets")
        .select("deposit_address")
        .eq("user_id", user_id)
        .eq("network_id", _network_id(network_code))
        .limit(1)
        .execute()
        .data
    )
    return rows[0]["deposit_address"] if rows else None


_network_name_cache: dict[str, str] = {}


def _network_name(code: str) -> str:
    """Human label for a network code (e.g. "Tron (TRC-20)" for "TRC20"),
    read from the `networks` table's own `name` column rather than
    hardcoded here — used only by the deposit-confirmed email below, so
    that label can never silently drift from whatever the rest of the app
    (admin panel, seed data) already calls each network."""
    if code not in _network_name_cache:
        rows = get_supabase().table("networks").select("code,name").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'networks' returned no rows")
        _network_name_cache.update({row["code"]: row["name"] for row in rows})
    return _network_name_cache[code]


def _send_deposit_confirmed_email(user_id: str, asset_code: str, network_code: str, amount: Decimal, tx_hash: str) -> None:
    """Best-effort, exactly like notification_service.create_notification's
    own "never raise" contract right above this function's only call site —
    by the time this runs, record_ledger_entry() has already committed the
    real credit, so a failure here (Resend down, a bad email on file, a
    lookup error) must only ever mean the user doesn't get an email, never
    a rolled-back or duplicated credit. Caught and logged here, once, so
    _credit_deposit's caller doesn't need its own try/except.
    """
    try:
        user_row = get_supabase().table("users").select("email").eq("id", user_id).limit(1).execute().data
        if not user_row:
            logger.warning("No user row found for %s — skipping deposit-confirmed email", user_id)
            return
        to_email = user_row[0]["email"]

        # Local import: wallet_service isn't otherwise a dependency of this
        # module, and importing it only where it's actually used (here, not
        # at module load time) sidesteps ever having to think about import
        # order between the two.
        from app.services import wallet_service

        new_balance = next(
            (b["amount"] for b in wallet_service.get_balances(user_id) if b["asset"] == asset_code),
            str(amount),  # fallback: shouldn't happen (the credit above just wrote this balance), but never let a lookup miss block the email
        )

        explorer_template = _EXPLORER_TX_URL.get(network_code)
        explorer_url = explorer_template.format(tx_hash=tx_hash) if explorer_template else None

        email_service.send_email_sync(
            to=to_email,
            subject=f"Deposit confirmed: {amount} {asset_code}",
            html=email_service.render_deposit_confirmed_email(
                amount=str(amount),
                asset_code=asset_code,
                network_name=_network_name(network_code),
                tx_hash=tx_hash,
                explorer_url=explorer_url,
                credited_at=datetime.now(tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                new_balance=new_balance,
            ),
        )
    except Exception:
        logger.exception("Failed to send deposit-confirmed email (user=%s tx=%s)", user_id, tx_hash)


def _credit_deposit(user_id: str, asset_code: str, network_code: str, amount: Decimal, tx_hash: str) -> bool:
    """Returns True if this was a genuinely new credit, False if it was a
    dedup no-op (already processed in an earlier sweep/check)."""
    # Withdrawal unlock fees (see withdrawal_unlock_fee_service.py's module
    # comment for the full mechanism) get first look at every incoming
    # transfer, before it's ever treated as an ordinary deposit — if this
    # user has an open "I'm about to pay fee X" intent on this network and
    # this transfer's amount matches it, it's claimed there instead: no
    # `balances`/`ledger_entries` row is written for it at all, which is
    # what keeps it a pure platform fee rather than withdrawable money. The
    # overwhelming common case (no fee pending) falls straight through.
    if withdrawal_unlock_fee_service.try_claim_as_fee_payment(user_id, network_code, asset_code, amount, tx_hash):
        logger.info(
            "Claimed as withdrawal-unlock-fee payment (not credited as balance): user=%s network=%s asset=%s amount=%s tx=%s",
            user_id, network_code, asset_code, amount, tx_hash,
        )
        return True

    # record_ledger_entry() is the only sanctioned ledger write path — its
    # own (network_id, tx_hash) dedup table makes it safe to call this again
    # for a transfer we've already credited before; it just no-ops. Known
    # accepted gap: dedup is keyed on tx_hash alone, so a single transaction
    # containing multiple relevant Transfer events (e.g. a batch call
    # touching two of our addresses) would only credit the first one
    # processed — inherited from the existing ledger schema, not something
    # this module works around.
    result = get_supabase().rpc(
        "record_ledger_entry",
        {
            "p_user_id": user_id,
            "p_asset_id": _asset_id(asset_code),
            "p_entry_type_id": _entry_type_id("DEPOSIT"),
            "p_amount": str(amount),
            "p_network_id": _network_id(network_code),
            "p_tx_hash": tx_hash,
        },
    ).execute()

    if result.data is None:
        return False

    logger.info("Credited deposit: user=%s network=%s asset=%s amount=%s tx=%s",
                user_id, network_code, asset_code, amount, tx_hash)

    # Notify the bell — see notification_service.py's module docstring for
    # why this call can never raise or block anything above; the ledger
    # entry has already landed for real by this point regardless of
    # whether this notification succeeds.
    notification_service.create_notification(
        user_id, "DEPOSIT_CONFIRMED",
        "Deposit received",
        f"{amount} {asset_code} was credited to your balance.",
    )

    # Detailed email receipt — same "never allowed to affect the credit
    # above" reasoning as the in-app notification just above; see
    # _send_deposit_confirmed_email's own docstring.
    _send_deposit_confirmed_email(user_id, asset_code, network_code, amount, tx_hash)

    # If a live session is watching this deposit (2.2b), resolve it instantly
    # instead of leaving it to time out its polling window. Harmless no-op if
    # nobody's watching (backstop sweep, or the live window already expired).
    from app.services.deposit_pending_service import clear_and_publish_sync

    clear_and_publish_sync(user_id, network_code, asset_code, str(amount), tx_hash)
    return True


def _scan_tron(addresses: dict[str, str]) -> list[dict]:
    """addresses: {base58_deposit_address: user_id}. Returns credited deposits.

    Queries TronGrid once PER ADDRESS (`/v1/accounts/{address}/transactions/
    trc20`, filtered to our USDT contract via `contract_address=`) rather
    than the single global "most recent 200 Transfer events on the whole
    USDT contract" call this used before the mainnet cutover. That worked
    fine against Nile testnet's near-zero volume, but silently failed on
    real mainnet USDT — one of the highest-throughput contracts on all of
    Tron — because a single deposit gets pushed out of the most-recent-200-
    events-contract-wide window within seconds by everyone else's transfers,
    long before this function next runs. Querying per-address instead scales
    with the number of OUR users, not the whole network's USDT volume, which
    is what this actually needs. Fine for a hobby-project user count; if
    this ever needs to scale to many thousands of addresses, batching or a
    webhook-based push model (TronGrid supports webhooks) would be the next
    step rather than one HTTP call per address per sweep tick.

    `only_confirmed=true` also replaces the old manual "latest_block -
    event_block >= min_confirmations" arithmetic — NETWORK_CONFIG["TRC20"]
    deliberately has no min_confirmations key anymore, since TronGrid itself
    already computes finality (whether a block has reached its solidity /
    irreversible node) and this defers to that rather than re-deriving the
    same thing less reliably ourselves.
    """
    if not addresses:
        return []

    cfg = NETWORK_CONFIG["TRC20"]
    credited = []

    for address, user_id in addresses.items():
        resp = httpx.get(
            f"{settings.trongrid_base_url}/v1/accounts/{address}/transactions/trc20",
            params={
                "limit": 20,  # plenty for a single deposit address between sweep ticks
                "only_confirmed": "true",
                "contract_address": cfg["contract_address"],
            },
            headers={"TRON-PRO-API-KEY": settings.trongrid_api_key},
            timeout=15,
        )
        resp.raise_for_status()

        for transfer in resp.json().get("data", []):
            if transfer["to"] != address:
                continue  # this endpoint returns the address's OUTGOING transfers too — only incoming ones are deposits

            amount = Decimal(transfer["value"]) / (10 ** cfg["decimals"])
            if amount < MIN_DEPOSIT_USD:
                continue

            if _credit_deposit(user_id, cfg["asset_code"], "TRC20", amount, transfer["transaction_id"]):
                credited.append({"user_id": user_id, "amount": amount, "tx_hash": transfer["transaction_id"]})

    return credited


def _scan_evm(network_code: str, addresses: dict[str, str]) -> list[dict]:
    """addresses: {lowercased_deposit_address: user_id}. Returns credited deposits."""
    if not addresses:
        return []

    cfg = NETWORK_CONFIG[network_code]
    credited = []
    rpc_url = settings.alchemy_base_rpc_url if network_code == "BASE" else settings.alchemy_polygon_rpc_url

    latest_resp = httpx.post(
        rpc_url, json={"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []}, timeout=15
    )
    latest_resp.raise_for_status()
    latest_block = int(latest_resp.json()["result"], 16)

    resp = httpx.post(
        rpc_url,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "alchemy_getAssetTransfers",
            "params": [
                {
                    "fromBlock": "0x0",
                    "toBlock": "latest",
                    "contractAddresses": [cfg["contract_address"]],
                    "category": ["erc20"],
                    "order": "desc",
                    "maxCount": "0x64",
                }
            ],
        },
        timeout=15,
    )
    resp.raise_for_status()

    for transfer in resp.json().get("result", {}).get("transfers", []):
        user_id = addresses.get(transfer["to"].lower())
        if user_id is None:
            continue

        block_num = int(transfer["blockNum"], 16)
        if latest_block - block_num < cfg["min_confirmations"]:
            continue

        raw_value = int(transfer["rawContract"]["value"], 16)
        decimals = int(transfer["rawContract"]["decimal"], 16)
        amount = Decimal(raw_value) / (10 ** decimals)
        if amount < MIN_DEPOSIT_USD:
            continue

        if _credit_deposit(user_id, cfg["asset_code"], network_code, amount, transfer["hash"]):
            credited.append({"user_id": user_id, "amount": amount, "tx_hash": transfer["hash"]})

    return credited


def sweep_tron() -> list[dict]:
    return _scan_tron(_known_addresses("TRC20", lowercase=False))


def sweep_evm(network_code: str) -> list[dict]:
    return _scan_evm(network_code, _known_addresses(network_code, lowercase=True))


def check_single_address(user_id: str, network_code: str) -> list[dict]:
    """Scoped to one user's one address — used by the 2.2b live poll, so a
    single active deposit session doesn't require scanning every wallet."""
    address = _address_for_user(user_id, network_code)
    if address is None:
        return []

    if network_code == "TRC20":
        return _scan_tron({address: user_id})
    return _scan_evm(network_code, {address.lower(): user_id})


_active_network_codes_cache: set[str] | None = None


def _active_network_codes() -> set[str]:
    """Which network codes currently have networks.is_active = true, read
    once per process and cached (same process-lifetime pattern as _lookup()
    above — a plain dict/set rather than lru_cache, cheap to reason about).

    Used only by sweep_all_networks() below, to skip a disabled network
    entirely rather than letting it call out to a blank or unconfigured
    RPC endpoint every sweep tick. Right now this means Base and Polygon are
    skipped — see migration 019_disable_evm_networks.sql, which flips
    is_active to false for both as part of narrowing the mainnet launch to
    TRC-20 only (ALCHEMY_BASE_RPC_URL / ALCHEMY_POLYGON_RPC_URL are left
    blank in production while they're disabled, so calling _scan_evm for
    them would just throw on every single tick — this avoids that noise
    rather than relying on sweep_all_networks's own try/except to swallow
    it silently).

    To bring a network back once it's actually ready (e.g. Base once an
    Alchemy mainnet app and a funded EVM relayer wallet exist): flip its row
    back to is_active = true in the `networks` table, then restart this
    worker process so the cache below re-reads it — it deliberately doesn't
    re-query on every call, matching every other cache in this module.
    """
    global _active_network_codes_cache
    if _active_network_codes_cache is None:
        rows = get_supabase().table("networks").select("code").eq("is_active", True).execute().data
        _active_network_codes_cache = {row["code"] for row in rows}
    return _active_network_codes_cache


def sweep_all_networks() -> None:
    active_codes = _active_network_codes()
    for network_code, sweep_fn in (
        ("TRC20", sweep_tron),
        ("BASE", lambda: sweep_evm("BASE")),
        ("POLYGON", lambda: sweep_evm("POLYGON")),
    ):
        if network_code not in active_codes:
            # Disabled network (e.g. Base/Polygon pre-mainnet-EVM-cutover) —
            # nothing to scan, and no RPC call worth making.
            continue
        try:
            sweep_fn()
        except Exception:
            # One network's outage must never block the others.
            logger.exception("Deposit sweep failed for network %s", network_code)
