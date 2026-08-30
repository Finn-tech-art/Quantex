from bip_utils import Bip39SeedGenerator, Bip44, Bip44Changes, Bip44Coins
from postgrest.exceptions import APIError

from app.config import settings
from app.services.supabase_client import get_supabase

# Base and Polygon are both EVM-compatible chains — a standard secp256k1
# keypair derived the Ethereum way produces a valid, checksummed address on
# either one, so both map to the same BIP-44 coin type here. TRC-20 (Tron)
# uses its own coin type and address encoding.
_NETWORK_TO_COIN = {
    "TRC20": Bip44Coins.TRON,
    "BASE": Bip44Coins.ETHEREUM,
    "POLYGON": Bip44Coins.ETHEREUM,
}

_lookup_cache: dict[str, int] = {}


def _network_id(code: str) -> int:
    """Static lookup-table read, cached for the process lifetime — see the
    identical pattern (and the reasoning for a plain dict over lru_cache) in
    auth_service._lookup."""
    if not _lookup_cache:
        rows = get_supabase().table("networks").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'networks' returned no rows")
        _lookup_cache.update({row["code"]: row["id"] for row in rows})
    return _lookup_cache[code]


def _seed_bytes() -> bytes:
    if not settings.master_wallet_seed:
        raise RuntimeError(
            "MASTER_WALLET_SEED is not configured — see .env.example for how "
            "this must be generated and stored"
        )
    return Bip39SeedGenerator(settings.master_wallet_seed).Generate()


def derive_address(network_code: str, derivation_index: int) -> str:
    """Deterministically derives the deposit address for a given network and
    BIP-44 address index from the master seed. Same (seed, network, index)
    always reproduces the same address — this is what makes storing just the
    index (not the address or any key material) enough to regenerate it later."""
    coin = _NETWORK_TO_COIN.get(network_code)
    if coin is None:
        raise ValueError(f"Unsupported network: {network_code}")

    ctx = (
        Bip44.FromSeed(_seed_bytes(), coin)
        .Purpose()
        .Coin()
        .Account(0)
        .Change(Bip44Changes.CHAIN_EXT)
        .AddressIndex(derivation_index)
    )
    return ctx.PublicKey().ToAddress()


def derive_private_key(network_code: str, derivation_index: int) -> bytes:
    """Re-derives the raw 32-byte private key for a deposit address on
    demand — the counterpart to derive_address(), used only by the
    consolidation sweep (custody_service.py) to sign the transfer moving a
    deposit address's balance out. Never store this return value anywhere
    (DB, logs, a cache) — recompute it fresh each time it's needed, exactly
    like derive_address() already does for the public address, and let it
    go out of scope immediately after signing. Cross-checked directly
    against tronpy's own PrivateKey-to-address derivation before this was
    relied on for anything real — the same (seed, network, index) produces
    the exact same address both ways, confirming this is safe to sign with."""
    coin = _NETWORK_TO_COIN.get(network_code)
    if coin is None:
        raise ValueError(f"Unsupported network: {network_code}")

    ctx = (
        Bip44.FromSeed(_seed_bytes(), coin)
        .Purpose()
        .Coin()
        .Account(0)
        .Change(Bip44Changes.CHAIN_EXT)
        .AddressIndex(derivation_index)
    )
    return ctx.PrivateKey().Raw().ToBytes()


def _next_derivation_index() -> int:
    # Defensively unwrap: postgrest-py returns a bare scalar for a plain
    # `returns bigint` function, but this normalizes the (list/dict) shapes
    # some client versions use for RPC results too, since this hasn't been
    # exercised against a live project yet.
    result = get_supabase().rpc("next_wallet_derivation_index").execute().data
    if isinstance(result, list):
        result = result[0]
    if isinstance(result, dict):
        result = next(iter(result.values()))
    return int(result)


def get_or_create_deposit_address(user_id: str, network_code: str) -> str:
    network_id = _network_id(network_code)

    existing = (
        get_supabase()
        .table("wallets")
        .select("deposit_address")
        .eq("user_id", user_id)
        .eq("network_id", network_id)
        .limit(1)
        .execute()
    )
    if existing.data:
        return existing.data[0]["deposit_address"]

    # Reserve the next index atomically first — derivation_index has to be
    # known before the address can be computed, but its DB default only fires
    # at INSERT time. next_wallet_derivation_index() is the one sanctioned way
    # to pull it early (see the migration's own comment).
    index = _next_derivation_index()
    address = derive_address(network_code, index)

    try:
        inserted = (
            get_supabase()
            .table("wallets")
            .insert(
                {
                    "user_id": user_id,
                    "network_id": network_id,
                    "deposit_address": address,
                    "derivation_index": index,
                }
            )
            .execute()
        )
        return inserted.data[0]["deposit_address"]
    except APIError as exc:
        if exc.code == "23505":
            # A concurrent request for this same user/network won the race —
            # the reserved index above is simply left unused, which is fine,
            # indices don't need to be contiguous.
            existing = (
                get_supabase()
                .table("wallets")
                .select("deposit_address")
                .eq("user_id", user_id)
                .eq("network_id", network_id)
                .limit(1)
                .execute()
            )
            if existing.data:
                return existing.data[0]["deposit_address"]
        raise


_asset_code_cache: dict[int, str] = {}


def _asset_code(asset_id: int) -> str:
    if not _asset_code_cache:
        rows = get_supabase().table("assets").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'assets' returned no rows")
        _asset_code_cache.update({row["id"]: row["code"] for row in rows})
    return _asset_code_cache[asset_id]


def get_balances(user_id: str) -> list[dict]:
    rows = (
        get_supabase()
        .table("balances")
        .select("asset_id,amount")
        .eq("user_id", user_id)
        .execute()
        .data
    )
    return [{"asset": _asset_code(row["asset_id"]), "amount": str(row["amount"])} for row in rows]


_network_code_cache: dict[int, str] = {}
_entry_type_code_cache: dict[int, str] = {}


def _network_code(network_id: int) -> str:
    if not _network_code_cache:
        rows = get_supabase().table("networks").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'networks' returned no rows")
        _network_code_cache.update({row["id"]: row["code"] for row in rows})
    return _network_code_cache[network_id]


def _entry_type_code(entry_type_id: int) -> str:
    if not _entry_type_code_cache:
        rows = get_supabase().table("ledger_entry_types").select("id,code").execute().data
        if not rows:
            raise RuntimeError("Lookup table 'ledger_entry_types' returned no rows")
        _entry_type_code_cache.update({row["id"]: row["code"] for row in rows})
    return _entry_type_code_cache[entry_type_id]


def get_recent_activity(user_id: str, limit: int = 20) -> list[dict]:
    rows = (
        get_supabase()
        .table("ledger_entries")
        .select("entry_type_id,asset_id,network_id,amount,tx_hash,created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
    )
    return [
        {
            "entry_type": _entry_type_code(row["entry_type_id"]),
            "asset": _asset_code(row["asset_id"]),
            "network": _network_code(row["network_id"]) if row["network_id"] else None,
            "amount": str(row["amount"]),
            "tx_hash": row["tx_hash"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]
