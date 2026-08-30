from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    redis_url: str = ""
    resend_api_key: str = ""
    resend_from_email: str = "Quantex <onboarding@resend.dev>"
    frontend_origin: str = "http://localhost:5173"

    # HD wallet master seed (BIP-39 mnemonic). In production this must come from
    # an offline-generated seed stored only in Railway's secrets — never commit
    # a real value. See wallet_service.py for how it's used.
    master_wallet_seed: str = ""

    # TronGrid (TRC-20 deposit detection). Defaults to the Nile testnet — swap
    # trongrid_base_url to https://api.trongrid.io for mainnet when that day comes.
    trongrid_api_key: str = ""
    trongrid_base_url: str = "https://nile.trongrid.io"

    # Alchemy (Base + Polygon deposit detection). Store the full RPC URL Alchemy
    # gives you per app (API key is embedded in the URL path) — currently the
    # testnet apps (Base Sepolia / Polygon Amoy); swap for the mainnet app URLs later.
    alchemy_base_rpc_url: str = ""
    alchemy_polygon_rpc_url: str = ""

    # Signing secret for admin session tokens (see utils/admin_auth.py). This
    # is intentionally a SEPARATE secret from anything Supabase issues — the
    # `admins` table lives outside Supabase Auth's user pool entirely, so the
    # backend signs and verifies these tokens itself. Generate a long random
    # value for real use (e.g. `python -c "import secrets; print(secrets.token_hex(32))"`)
    # and set it only in `.env` / Railway secrets, never commit a real value.
    admin_jwt_secret: str = ""

    # Private Supabase Storage bucket ID for KYC identity documents (see
    # migrations/009_kyc_documents_bucket.sql) — must match that migration's
    # `id` exactly if either one ever changes. See kyc_service.py.
    kyc_documents_bucket: str = "kyc-documents"

    # Tron gas/staking wallet (deposit consolidation, Module 2) — a single
    # standalone Tron account, deliberately NOT derived from
    # master_wallet_seed. It stakes TRX for Energy (Stake 2.0) and delegates
    # that Energy to a deposit address right before sweeping it, so the
    # sweep never has to burn TRX per-transfer. Generate a fresh keypair for
    # this (e.g. via tronpy.keys.PrivateKey.random()) — for testnet, fund
    # the resulting address from the Nile faucet; for mainnet, generate a
    # brand new key rather than reusing the testnet one. Raw 64-char hex
    # private key, never the mnemonic form. See custody_service.py.
    tron_gas_wallet_private_key: str = ""

    # EVM relayer wallet (deposit consolidation, Module 3) — one standalone
    # account, shared by both Base and Polygon, that submits each
    # transferWithAuthorization (EIP-3009) call on behalf of a deposit
    # address and pays its own gas. The deposit address never needs any
    # ETH/MATIC of its own — it only ever produces an off-chain signature.
    # Generate a fresh keypair (e.g. eth_account.Account.create()); fund it
    # with a small amount of Base Sepolia / Polygon Amoy testnet ETH/MATIC
    # from a faucet for dev. Raw hex private key. See custody_service.py.
    evm_relayer_private_key: str = ""


settings = Settings()
