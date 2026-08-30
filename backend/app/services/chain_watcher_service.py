import logging
from decimal import Decimal

import httpx
from tronpy import Tron
from tronpy.keys import to_base58check_address
from tronpy.providers import HTTPProvider

from app.config import settings
from app.services.network_assets import NETWORK_CONFIG
from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

MIN_DEPOSIT_USD = Decimal("20")

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


def _credit_deposit(user_id: str, asset_code: str, network_code: str, amount: Decimal, tx_hash: str) -> bool:
    """Returns True if this was a genuinely new credit, False if it was a
    dedup no-op (already processed in an earlier sweep/check)."""
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

    # If a live session is watching this deposit (2.2b), resolve it instantly
    # instead of leaving it to time out its polling window. Harmless no-op if
    # nobody's watching (backstop sweep, or the live window already expired).
    from app.services.deposit_pending_service import clear_and_publish_sync

    clear_and_publish_sync(user_id, network_code, asset_code, str(amount), tx_hash)
    return True


def _scan_tron(addresses: dict[str, str]) -> list[dict]:
    """addresses: {base58_deposit_address: user_id}. Returns credited deposits."""
    if not addresses:
        return []

    cfg = NETWORK_CONFIG["TRC20"]
    credited = []

    client = Tron(HTTPProvider(endpoint_uri=settings.trongrid_base_url, api_key=settings.trongrid_api_key))
    latest_block = client.get_latest_block_number()

    resp = httpx.get(
        f"{settings.trongrid_base_url}/v1/contracts/{cfg['contract_address']}/events",
        params={"event_name": "Transfer", "limit": 200, "order_by": "block_timestamp,desc"},
        headers={"TRON-PRO-API-KEY": settings.trongrid_api_key},
        timeout=15,
    )
    resp.raise_for_status()

    for event in resp.json().get("data", []):
        to_hex = event["result"]["to"]
        to_base58 = to_base58check_address("41" + to_hex[2:])
        user_id = addresses.get(to_base58)
        if user_id is None:
            continue

        if latest_block - event["block_number"] < cfg["min_confirmations"]:
            continue

        amount = Decimal(event["result"]["value"]) / (10 ** cfg["decimals"])
        if amount < MIN_DEPOSIT_USD:
            continue

        if _credit_deposit(user_id, cfg["asset_code"], "TRC20", amount, event["transaction_id"]):
            credited.append({"user_id": user_id, "amount": amount, "tx_hash": event["transaction_id"]})

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


def sweep_all_networks() -> None:
    for network_code, sweep_fn in (
        ("TRC20", sweep_tron),
        ("BASE", lambda: sweep_evm("BASE")),
        ("POLYGON", lambda: sweep_evm("POLYGON")),
    ):
        try:
            sweep_fn()
        except Exception:
            # One network's outage must never block the others.
            logger.exception("Deposit sweep failed for network %s", network_code)
