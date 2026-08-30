# Quantex — Build Plan & Acquisition Checklist

A working document to follow phase by phase with Claude Code. Every phase is split into two tracks that run in parallel:

- **🔧 Build (with Claude Code)** — technical tasks, done in the repo
- **🧍 You / External** — accounts to create, things to buy, people to talk to, decisions only you can make

Nothing in the 🔧 track should start until the 🧍 items it depends on are done — Claude Code can't generate a Binance API key or register a business entity for you. Treat the 🧍 items as blockers, not background tasks.

---

## Master Acquisition List (everything at a glance)

| Item | Needed by | Cost | Notes |
|---|---|---|---|
| Domain name | Phase 0 | ~$10–15/yr | e.g. quantex.io / .com |
| GitHub account + repo | Phase 0 | Free | Monorepo: `/frontend` `/backend` `/shared` |
| Railway account | Phase 0 | Free tier → usage-based | Frontend + backend hosting |
| Supabase account | Phase 0 | Free tier → usage-based | DB + Auth + private Storage bucket |
| Upstash account | Phase 0 | Free tier → usage-based | Redis for cache, pub-sub, Celery broker |
| Binance account (verified) | Phase 0–3 | Free | Needs Binance's own KYC to unlock API trading |
| Bybit account (verified) | Phase 2 | Free | Consolidation destination for swept deposits — generate one deposit address per network |
| TRX for gas staking | Phase 2 | ~$50 one-time | Staked (Stake 2.0), not spent — powers the Tron consolidation sweep; lasts ~9 months at hobby-project volume |
| Resend or SendGrid account | Phase 0 | Free tier → usage-based | Transactional email |
| Business entity registration | Phase 0 (start early — this takes weeks) | Varies by jurisdiction | See Legal section below |
| Legal counsel (crypto/fintech) | Phase 0 (start early) | Paid | Custody, licensing, ToS/Privacy review |
| Business bank account | Phase 0–8 | Varies | For converting/holding platform revenue |
| Hardware wallet (Ledger/Trezor) | Before Phase 8 | ~$60–150 | Cold storage signer device |
| Gnosis Safe (or similar multisig) | Before Phase 8 | Free (gas only) | Cold wallet multi-sig setup |
| Security audit / pen test | Phase 8 | Paid, varies widely | Before real funds go live |
| Social accounts (X, Discord, etc.) | Phase 7 | Free | Community + support presence |

---

## Phase 0 — Project Setup

### 🔧 Build
- [ ] Create GitHub monorepo structure (`/frontend`, `/backend`, `/shared`)
- [ ] Write root `CLAUDE.md` (stack, conventions, "never do X" rules — see architecture doc Section 9)

### 🧍 You / External
- [ ] **Buy the domain** — do this first, several other steps reference it
- [ ] **Create accounts:** GitHub, Railway, Supabase, Upstash, Resend/SendGrid
- [ ] **Create and verify a Binance account** — this requires Binance's own identity verification before API trading is unlocked. Start this early; verification can take days.
- [ ] **Register a business entity** — you cannot legally hold custody of other people's money as an individual. This needs to happen before you accept real deposits, not right before launch. Start the paperwork now — entity registration timelines vary widely by jurisdiction and can take weeks.
- [ ] **Talk to a lawyer who handles crypto/fintech** — specifically about: whether operating a custodial trading platform requires a money-transmitter or virtual-asset-service-provider registration in your jurisdiction, what your KYC/AML obligations are given you're doing manual in-house review, and what your Terms of Service, Privacy Policy, and Risk Disclosure need to say to be enforceable. *This is not optional legal decoration — a custodial platform holding user funds is exactly the kind of business regulators pay attention to. I can't tell you what's required in your specific jurisdiction; a lawyer needs to.*
- [ ] **Open a business bank account** once the entity is registered — you'll need somewhere for platform revenue (fees) to eventually land if you convert any crypto to fiat.
- [ ] Set `admin@quantex.com` password once the domain and email are live

---

## Phase 1 — Foundation

### 🔧 Build
- [ ] Full Postgres schema (users, wallets, ledger_entries, bots, bot_fills, withdrawals, kyc_submissions, session_unlocks, referral_credits, admin_audit_log)
- [ ] FastAPI skeleton (`/routers`, `/models`, `/services`, `/workers`, `/utils`) + Supabase/Redis clients
- [ ] Auth backend — Supabase Auth (email/password + Google OAuth), JWT middleware
- [ ] Generic OTP service (Redis-backed) — `generate_and_send_otp(purpose, identifier, email, context)` / `verify_otp(...)`, sent via Resend directly from the backend. First consumer: email verification. **Built generically on purpose — Phase 4 (withdrawal confirmation) reuses this exact service, not a rebuild.** See architecture doc Section 5.
- [ ] Email verification — dashboard-driven "Verify Email" prompt + code entry, not a signup gate. Skipped entirely for Google/OAuth users (already provider-verified). On success, marks Supabase's `email_confirmed_at` via the admin API.
- [ ] Auth frontend — React+Vite, TailwindCSS, react-i18next scaffolded, Signup/Login/verify-email-code screens
- [ ] Welcome checklist screen

### 🧍 You / External
- [ ] **Create a Google Cloud project + OAuth consent screen** to get Google OAuth client credentials (needed for "Continue with Google")
- [ ] Point your domain's DNS to Railway (or set up a staging subdomain first, e.g. `staging.quantex.io`)
- [ ] Decide the second language for i18n (structure goes in now even if translation comes later) — who will do the actual translation?

**✅ Checkpoint:** signup → verify email → log in → welcome screen, working end to end.

---

## Phase 2 — Wallet & Deposits

### 🔧 Build
- [ ] HD wallet derivation for TRC-20, Base, Polygon (`tronpy`, `web3.py`)
- [ ] Chain watchers / deposit detection (TronGrid, Alchemy webhooks)
- [ ] Internal ledger service (`get_balance`, `credit`, `debit`, $20 floor check)
- [ ] Deposit screen (network selector, address + QR)
- [ ] Wallet screen (balance, assets, activity)
- [x] `consolidation_addresses` + `sweeps` tables, `custody_service.py` (address get/set + validation, on-demand key derivation, sweep logic)
- [x] Deposit consolidation sweep worker — admin-triggered, never scheduled: Tron via Stake 2.0 resource delegation (built), Base/Polygon USDC via EIP-3009 gasless relay (built). Polygon-USDT plain top-up path not built — moot for now, since the running code currently only tracks USDC on Polygon, not USDT (see network_assets.py); revisit if that ever changes.
- [x] Admin endpoints: pending-sweeps list + "Sweep Now" trigger, consolidation-address get/set (retype-to-confirm, audit logged)
- [x] Admin panel pages for both of the above (`/admin/consolidation-addresses`, `/admin/sweeps`) — built ahead of Phase 6 since the sweep worker needed a working trigger to be usable at all; Phase 6 can still add polish (e.g. surfacing this on a general admin dashboard) later

### 🧍 You / External
- [ ] **Create a TronGrid API account** (free tier available) for TRC-20 deposit detection
- [ ] **Create an Alchemy account** (free tier available) for Base and Polygon deposit/withdrawal detection
- [ ] Generate and securely store the master wallet seed **offline** — this is the single most sensitive artifact in the entire system. Do not generate it inside a chat tool, a shared doc, or anywhere it could leak. Generate it on an air-gapped or trusted device and write down the recovery phrase physically.
- [ ] Decide who besides you (if anyone) has any access to wallet infrastructure, and document that decision
- [ ] **Create/verify a Bybit account** and generate a deposit address per network (TRC-20, Base, Polygon) — these are entered as the consolidation destinations once the admin panel supports it
- [ ] **Buy ~$50 of TRX and stake it (Stake 2.0)** into the dedicated Tron gas/staking wallet — generate that wallet's key with the same offline-generation caution as the master seed
- [ ] Fund the EVM relayer wallet with a small amount of ETH (Base) and MATIC/POL (Polygon) — covers the (rare) Polygon-USDT top-up path and relayer gas for EIP-3009 submissions

**✅ Checkpoint:** deposit on any of the three networks reflects correctly in balance.

---

## Phase 3 — Bot Engine

### 🔧 Build
- [ ] Binance service (persistent WebSocket, `place_order`, `cancel_order`, `get_open_orders`)
- [ ] Market data ingestion (Binance WS → Redis; CryptoPanic news → Redis)
- [ ] Grid strategy engine + reasoning text generation
- [ ] Celery worker queue (per-bot scheduled jobs, session counter, retry/pause logic)
- [ ] DCA strategy engine
- [ ] Momentum strategy engine
- [ ] Bot creation wizard (4 steps)
- [ ] Bot detail / live running screens

### 🧍 You / External
- [ ] **Generate Binance API keys** — read + trade permissions ONLY, withdrawal permission OFF. Store in Railway secrets, never in code.
- [ ] **Create a CryptoPanic account** for the news API (free tier available)
- [ ] Fund the master Binance account with enough capital to cover early bot activity (this is real trading capital, separate from user custody funds — think through how much you're comfortable putting at risk while the system is new)
- [ ] Decide your actual Grid/DCA/Momentum default parameters (price ranges, grid counts, DCA intervals) — these are product decisions, not something Claude Code should invent alone

**✅ Checkpoint:** a bot runs a full cycle on Binance, user sees real fills live.

---

## Phase 4 — Withdrawals & KYC

### 🔧 Build
- [ ] KYC submission screen (ID front/back + selfie upload, validation, signed upload to private bucket)
- [ ] KYC admin review queue (signed short-expiry URLs, approve/reject, audit log)
- [ ] Withdrawal flow backend (validation, admin approval queue)
- [ ] **Withdrawal OTP confirmation** — reuse the generic OTP service from Phase 1 (`purpose="withdrawal_confirmation"`, `identifier=withdrawal_id`) — do not rebuild it. Needs real attempt-throttling/lockout added before this goes live; the email-verification usage in Phase 1 didn't need that, this one does. Exact placement in the withdrawal sequence not yet decided — see architecture doc Section 4.
- [ ] Withdrawal admin approval + hot wallet broadcast
- [ ] Withdrawal screen (frontend)

### 🧍 You / External
- [ ] **Write your internal KYC review policy** — since your team is doing manual review, they need a documented standard: what counts as an acceptable ID, what triggers a rejection, how to spot an obviously edited/fake document, how long to spend per review. This should exist as an actual document your reviewers follow, not tribal knowledge.
- [ ] **Set up the private Supabase Storage bucket permissions** — confirm only admin-authenticated requests can generate signed URLs to view documents
- [ ] Decide who on your team is authorized to review KYC submissions, and set up their admin panel access
- [ ] Confirm with your lawyer what your data retention policy needs to be for stored ID documents (how long you keep them, how you delete them)

**✅ Checkpoint:** submit KYC → team approves → withdraw → team approves → funds move.

---

## Phase 5 — Monetization

### 🔧 Build
- [ ] Bot creation fee charge at wizard Step 4
- [ ] Session cap counter + $20 unlock flow
- [ ] Withdrawal flat fee deduction

### 🧍 You / External
- [ ] **Decide the actual fee amounts** — bot creation fee, withdrawal flat fee exact number. These were left as placeholders throughout design; you need real numbers before this phase starts.
- [ ] Think through how platform revenue (collected in crypto) gets converted to fiat if/when you need to, and whether that needs its own exchange/OTC relationship

**✅ Checkpoint:** all three revenue streams charge correctly, visible in admin analytics.

---

## Phase 6 — Admin Panel

### 🔧 Build
- [ ] Admin auth (`/admin` route, superadmin session check)
- [ ] User management (list, suspend/unsuspend)
- [ ] Bot monitoring (force-pause capability)
- [ ] Analytics dashboard
- [ ] Audit log viewer

### 🧍 You / External
- [ ] Decide if it's still just you as superadmin at this point, or if your reviewing team needs their own admin accounts (if so, this needs a small scope addition — role-based access wasn't in the original design)

---

## Phase 7 — Growth Features

### 🔧 Build
- [ ] Leaderboard (ranking service + public page + clone-bot flow)
- [ ] Referral system
- [ ] 20 USDT first-deposit bonus
- [ ] Notification polish (email templates, Web Push)

### 🧍 You / External
- [ ] **Set up social/community presence** — X/Twitter, Discord or Telegram — before you have a Leaderboard worth sharing
- [ ] Write your actual referral program terms (how much credit, when it pays out, abuse prevention) — legal should glance at this per the earlier bonus-program flag
- [ ] Decide your launch marketing plan — this is entirely outside what Claude Code can help with directly

---

## Phase 8 — Pre-Launch

### 🔧 Build
- [ ] Security pass (injection checks, auth-bypass attempts, rate limiting)
- [ ] Env var / secrets audit
- [ ] PWA manifest + service worker
- [ ] `llms.txt` + `robots.txt` live
- [ ] Load test (100 concurrent bots)
- [ ] Staging end-to-end test

### 🧍 You / External — the big ones
- [ ] **Set up the hot/cold wallet split.** Buy a hardware wallet (Ledger or Trezor), set up a Gnosis Safe multi-sig for cold storage, decide who the signers are (this needs at least 2 people in practice, not just you, for real multi-sig security). **This is a hard blocker before accepting real user funds — do not skip or delay this to "after launch."**
- [ ] **Commission a security audit / penetration test** — even a lightweight paid audit from a reputable freelancer or small firm is far better than none, given this platform custodies real money
- [ ] **Finalize legal pages with your lawyer** — Terms of Service, Privacy Policy, Risk Disclosure need to be reviewed by counsel before going live, not just AI-drafted placeholder text
- [ ] Confirm your business entity, bank account, and any required licensing/registration are actually in place — not just in progress
- [ ] Decide your incident response plan — who gets paged if something breaks at 3am, and what the public communication process is (ties to the "public incident postmortem" trust idea from earlier)

---

## How to Use This With Claude Code

At the start of each phase:
1. Confirm every 🧍 item for that phase is actually done — don't let Claude Code start building against infrastructure that doesn't exist yet (e.g. don't start Phase 3 if Binance API keys aren't generated).
2. Point Claude Code at this file plus `quantex-definitive-architecture.md` and `quantex-design-system-spec.md` at the start of a session.
3. Work one 🔧 checklist item at a time — check it off, review, move to the next.
4. Re-read the "✅ Checkpoint" line for the phase before moving to the next phase — it's the acceptance test for "is this phase actually done."
