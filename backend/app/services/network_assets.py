# Per-network asset config shared by anything that needs to talk to a
# specific token contract — deposit detection (chain_watcher_service) and
# the consolidation sweep (custody_service) both need the exact same
# contract address and decimals for a given network. This lives in one
# place specifically so there's no risk of the two drifting apart (e.g. one
# module getting updated for the mainnet cutover and the other not) —
# previously this was a private dict duplicated only in chain_watcher_service.
#
# Currently one asset per network (TRC20->USDT, BASE->USDC, POLYGON->USDC) —
# not the two-assets-on-Polygon (USDC+USDT) combination mentioned as a
# possibility in the architecture doc's network table. Adding that later
# means restructuring this to key on (network, asset) instead of just
# network — a real change, not a config tweak, since `wallets` currently
# stores one deposit address per user per network, not per user per
# network per asset.

# Confirmation counts are technical safety margins, not product decisions —
# these are reasonable testnet defaults and worth revisiting with real
# research before mainnet (Polygon in particular has a history of deeper
# reorgs than Base/Tron, hence the higher bar here).
NETWORK_CONFIG = {
    "TRC20": {
        "asset_code": "USDT",
        "contract_address": "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",  # Nile testnet, verified on-chain
        "decimals": 6,
        "min_confirmations": 19,
    },
    "BASE": {
        "asset_code": "USDC",
        "contract_address": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",  # Base Sepolia, verified on-chain
        "decimals": 6,
        "min_confirmations": 20,
    },
    "POLYGON": {
        "asset_code": "USDC",
        "contract_address": "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",  # Polygon Amoy, verified on-chain
        "decimals": 6,
        "min_confirmations": 64,
    },
}
