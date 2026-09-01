-- ============================================================================
-- Disable Base and Polygon for the mainnet launch — TRC-20 (Tron) only
-- ============================================================================
-- Product decision: launch mainnet with TRC-20/USDT deposits only. Base and
-- Polygon (USDC via EIP-3009) are fully built and already working end to end
-- against their testnets — see custody_service.py's "EVM sweep" section and
-- chain_watcher_service.py's _scan_evm — but going live on them right now
-- would require: a second Alchemy app per chain pointed at mainnet, a funded
-- EVM relayer wallet (real ETH + MATIC to pay gas), and fresh research on
-- their real-money contract addresses/confirmation depths. None of that is
-- ready yet, so we're deferring them rather than holding up the TRC-20
-- launch on them.
--
-- The `is_active` column on `networks` already existed for exactly this
-- purpose (see quantex-schema.sql) but nothing in the app read it until this
-- change — see chain_watcher_service.sweep_all_networks(), deposits.py, and
-- wallet.py, all updated alongside this migration to respect it.
--
-- To bring Base/Polygon back later (once an Alchemy mainnet app + funded
-- relayer wallet exist): flip these two rows back to is_active = true, and
-- restore "BASE"/"POLYGON" to the hardcoded network sets in deposits.py,
-- wallet.py, and the frontend's DepositPage.jsx NETWORKS array — nothing
-- else needs to change, since the EIP-3009 sweep code itself was never
-- touched by this migration.
-- ============================================================================

update networks
  set is_active = false
  where code in ('BASE', 'POLYGON');
