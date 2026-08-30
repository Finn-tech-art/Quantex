# Quantex — Definitive Architecture, Tech Stack & Flow Decisions

All decisions confirmed through the Q&A process. This is the single source of truth for the build.

---

## 1. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | React (Vite) | User's preference; pure SPA, faster builds than Next.js |
| Frontend hosting | Railway | Single-vendor ops — everything on Railway |
| Backend | Python (FastAPI) | User is familiar with Python; async-native, fast, great for the AI strategy layer later |
| Backend hosting | Railway | Same vendor as frontend — one dashboard, one billing |
| Database | PostgreSQL via Supabase | User is familiar; free tier, auth built in, real-time subscriptions |
| Cache / Pub-Sub / Queue | Redis via Upstash + BullMQ | BullMQ for bot worker queue; Upstash for price cache and pub-sub fan-out |
| KYC | In-house manual review | Users submit ID + selfie via upload screen; team reviews in admin panel. Supabase Storage (private bucket) for document storage. Can integrate a provider later without changing the user-facing flow. |
| Bot trade execution | Binance API (master account) | One master Quantex Binance account — all bots trade from it |
| Market data | Binance public WebSocket (prices/candles) + CryptoPanic API (news) | Free, low latency, same connection as execution |
| Blockchain / RPC | TronGrid (TRC-20), Alchemy (Base), Alchemy/Infura (Polygon) | One RPC provider per chain for deposit detection and withdrawal broadcasting |
| Notifications | Email (SendGrid/Resend free tier) + Web Push API (browser) | Email for critical events; Web Push for live in-app activity |
| Admin panel | Same React codebase, protected `/admin` route | Simpler to build and deploy; superadmin only |
| Secrets management | Railway environment variables → migrate to HashiCorp Vault or AWS KMS before mainnet | Never plaintext; Binance API keys and hot wallet keys especially |

---

## 2. Blockchain / Network Decisions

**Supported deposit/withdrawal networks:**
- **USDT on TRC-20 (Tron)** — primary; lowest fees (~$0.10–$0.50), most exchange users already know this
- **USDC on Base** — secondary; EVM-standard, low fees, Coinbase-backed
- **USDC/USDT on Polygon** — third; EVM-standard, established, wide support

**Deposit source:** Any exchange — users paste Quantex's generated address into their exchange's withdrawal screen. No guided flow tied to specific exchanges.

**Consolidation cost note:** every network above eventually gets swept to a single Quantex-controlled Bybit account (see Section 5, Custody / wallet architecture). This costs a small, real network fee for USDT (TRC-20 and Polygon) but is effectively free for USDC (Base and Polygon) via a gasless relay — see Section 5 for exactly how and why.

**Withdrawal fee model:** Fixed flat fee per withdrawal (amount TBD — suggest $2–$3 for TRC-20, $1 for Base/Polygon given gas differences).

---

## 3. Revenue Model

| Stream | Mechanic |
|---|---|
| Bot creation fee | One-time upfront payment before a bot is deployed |
| Session cap unlock | $20 flat fee per bot per day for unlimited 1-minute-interval checks beyond the 15 free sessions |
| Withdrawal fee | Fixed flat fee on every withdrawal, regardless of amount |

*Note: no per-trade fee, no performance fee, no subscription tier in v1.*

---

## 4. User Flow Decisions

**Signup:** Email + password OR Google OAuth. Open signup — anyone can join instantly: a session is issued immediately regardless of email-verification status, for both auth methods. This reverses an earlier interim decision (see decision history below) — verification is deliberately decoupled from account access.

**Email verification — revised design, supersedes the earlier "hard gate" decision.** An earlier pass through this decision concluded verification should block the account immediately after signup. That's now superseded: verification happens **after** signup, dashboard-driven, not blocking. A new user lands on their dashboard right away (Google or email/password, doesn't matter), sees a "Verify Email" prompt there, and clicking it sends a 6-digit code to their email; entering the code confirms it. Google/OAuth users don't see this prompt at all — Supabase auto-confirms OAuth sign-ins since the provider (Google) already vouches for the address, so there's nothing to verify.

**Decision history — why this isn't built on Supabase's native email-confirmation flow.** Supabase Auth has its own built-in confirm-signup mechanism (magic link by default, or a numeric OTP if the project's email template is switched to use `{{ .Token }}`), and it was seriously considered — it needs no custom backend code, since Supabase generates, sends, and verifies the code itself. It was rejected for one specific reason: **this same code-verification mechanism is planned for reuse on withdrawal confirmation** (see Withdrawal flow below), and Supabase's native OTP is hard-wired to its own fixed set of auth-lifecycle actions (signup, magic-link login, password recovery, email change) — it has no way to attach arbitrary business context like "confirm this $500 withdrawal to address X," and can't be repurposed for that. Building a one-off Supabase-native flow for email verification would mean building a second, entirely separate custom system later for withdrawals anyway, with no shared code and two inconsistent verification UXs in the product. Instead, a single generic, reusable OTP service is being built once — see Section 5 for the mechanism — proven out on the lower-stakes case (email verification) first, then pointed at withdrawal confirmation later without rebuilding it.

**KYC gate:** KYC is only triggered before the user's first withdrawal. Deposits, bot creation, and trading are all available without KYC. Users submit government ID (front + back) + selfie via an in-app upload screen. Quantex's own team reviews submissions manually in the admin panel within the stated 4-day window and approves or rejects with a reason code.

**Deposit flow:**
1. User selects network (TRC-20 / Base / Polygon)
2. User sees their unique generated address + QR code
3. User goes to their own exchange (any exchange), pastes the address, sends funds
4. Backend detects the on-chain transaction, waits for confirmations, credits internal ledger
5. User gets notified (email + browser push) when funds land

**Important clarification — the "how much are you depositing" field is advisory only, not enforced.** Unlike a Stripe checkout or a Lightning invoice, a blockchain deposit address has no mechanism to lock in or require a specific amount. Whatever the user types into that field on the Deposit screen is pure UI convenience (it drives the "waiting for your ~50 USDT deposit..." polling state) — it is never validated against, and it cannot reject or hold a transaction, because by the time the chain watcher sees it, the transaction has already been broadcast and is final. **The system always credits exactly what actually arrives on-chain**, regardless of what amount the user stated beforehand. If they said 50 and sent 30, they get credited 30. If they said 50 and sent 80, they get credited 80.

**Minimum deposit threshold — confirmed: $20 flat, all networks.** This exists for a different reason than "enforcing the stated amount" — it's about dust-attack resistance and not processing amounts too small to be worth the review/compute cost. Reference point: Binance's technical minimum for USDT on TRC-20 is effectively near-zero (0.01 USDT), but their *practically meaningful* minimum is 5 USDT — tied to their minimum trade size. Quantex's $20 is set higher than Binance's reference point specifically to match the existing **$20 balance floor** (Section on withdrawals below) — this is deliberate: it guarantees nobody can deposit an amount that immediately leaves them stuck below the floor required to eventually withdraw. A flat $20 across TRC-20/Base/Polygon (rather than varying per network) keeps this simple to implement and communicate, since network fee differences between the three ($0.10–0.50 TRC-20 vs. cents on Base/Polygon) aren't large enough to justify different thresholds.

**Deposits below $20 are not credited** — no partial handling, no accumulation logic for v1. This matches standard exchange practice (Binance, Coinbase, Bybit all effectively do this) and must be clearly disclosed on the Deposit screen and in Terms, since the funds aren't lost on-chain, they're simply not reflected in the user's Quantex balance. Building an "accumulate sub-threshold deposits until they cross $20" system is a reasonable v2 idea if this turns out to affect meaningful numbers of users, but adds real complexity (a tracking table, a sweep job) not worth taking on for what should be a rare edge case at launch.

**This is separate from, and does not override, the $50 minimum bot allocation** (see Bot lifecycle below) — two independent thresholds answering different questions. A user can have a Quantex balance between $20 and $50 (fully valid, fully withdrawable subject to the normal withdrawal minimum) while still being unable to create a bot until they cross $50. **This gap needs an explicit UI state**: if a user attempts to start the bot-creation wizard with available balance under $50, they should be told clearly and early ("You need at least $50 available to create a bot — deposit $X more to continue") rather than discovering it by failing at the final deploy step. This screen does not yet exist in the current mockup set — flagged as a gap to design.

**Input validation on the amount field itself** is a separate, simpler concern — pure form validation, not financial logic:
- Reject negative numbers and non-numeric input client-side (`type="number" min="0"`) *and* re-validate server-side, since client-side checks can always be bypassed
- Cap unreasonably large typed values with a soft warning rather than silent acceptance
- Since this field never gates anything financial, server-side handling can be lightweight — validate it's a positive decimal in a sane range, or simply discard it if malformed. It was only ever going to drive a polling UI state, never determine what gets credited.

**Bot lifecycle:**
- **Minimum bot allocation: $50.** A user cannot deploy a bot with less than $50 allocated. This isn't arbitrary — it's roughly the practical floor for a Grid bot to function at all: Binance's own minimum order size for USDT pairs is ~$5–10, and a grid strategy with 8–10 price levels needs to place that many individual orders, so $50 split across 10 levels lands right around Binance's own floor per order. Go meaningfully lower and individual grid orders start failing on Binance's side before Quantex's own validation ever catches it. Applied as one uniform minimum across Grid/DCA/Momentum/Custom for simplicity, even though DCA/Momentum could technically tolerate less.
- User pays bot creation fee → configures bot (strategy, pair, interval, allocation) → deploys
- Bot runs indefinitely until: manually paused/stopped, a user-set profit target is hit, a user-set stop-loss is hit, or the session cap is reached and not unlocked
- **Profits:** user chooses per bot via a toggle — either stays in Quantex balance (withdraw manually) or auto-reinvests into the same bot

**Withdrawal flow:**
1. User submits amount + destination address + network
2. System validates: KYC must be approved, amount ≥ $100, balance won't drop below $20
3. Withdrawal is queued for **manual admin approval** regardless of amount
4. Admin reviews and approves in the admin panel
5. Backend broadcasts the on-chain transaction from the hot wallet
6. User notified on completion

**Flagged future addition — OTP confirmation step, not yet built, exact placement not yet decided.** The generic OTP service being built for email verification (Section 5) is planned to be reused here: the user confirms a withdrawal request with a 6-digit code emailed to them, tied to that specific withdrawal (`identifier` = withdrawal ID, not user ID), before or alongside admin approval. Unlike email verification, this is a genuinely security-sensitive use of the mechanism — real money leaving the platform — so it needs real attempt-throttling/lockout on the code check, not the relaxed handling acceptable for email verification. Where exactly this step lands in the numbered sequence above (before step 3's admin queue, or as a separate condition alongside it) is an open question for when Phase 4 is actually built, not decided here.

**Languages:** Multi-language from day one. Implement i18n (react-i18next) from the start rather than retrofitting — even if only English is translated initially, the structure needs to be there.

---

## 5. System Flow Decisions

**Bot execution architecture:**
- One master Quantex Binance account — all bots trade from it via Binance's REST + WebSocket API
- Each bot's capital is tracked as an internal ledger allocation, not as a separate Binance sub-account (though Binance sub-accounts are an option to investigate for isolation if needed at scale)
- BullMQ job fires on each bot's interval → Strategy Engine fetches current price from Redis cache (not directly from Binance each time) → evaluates rule → if action triggered, places order via Binance API → logs fill → publishes to Redis Pub-Sub → client receives live update

**Exchange downtime handling:**
- Bot keeps retrying silently every 2 minutes, up to 5 attempts
- After 5 failed attempts, bot pauses automatically
- User receives email + browser push notification that the bot paused due to exchange connectivity
- User can manually resume from the bot detail screen whenever ready

**Notification channels:**
- Email (SendGrid or Resend) — deposit confirmed, withdrawal approved, bot paused, KYC approved/rejected, stop-loss triggered
- Browser Push (Web Push API) — same events, plus live fill notifications for active bot watchers
- No SMS in v1

**Market data flow:**
- One persistent Binance WebSocket connection per tracked pair
- Prices + candles written to Redis on each tick
- All user clients read from Redis via your own API — never hit Binance directly from the browser
- News polled from CryptoPanic every 5 minutes, cached in Redis

**Custody / wallet architecture:**
- HD wallet derivation: one master seed → one unique deposit address per user per network (TRC-20, Base, Polygon)
- Hot wallet: holds enough for same-day withdrawal liquidity — all admin-approved withdrawals broadcast from here
- Cold wallet: remainder of custodied funds; manual/multi-sig release (do this before accepting real user funds)
- Master seed and hot wallet private keys stored in Railway environment secrets → migrate to proper KMS before launch
- **Individual deposit addresses are not where funds stay.** Once credited (see the deposit flow above), balances are later consolidated into a single Quantex-controlled Bybit account via the process below — this is what actually determines whether the hot/cold wallet split above ever needs to hold deposit funds directly, versus Bybit holding the consolidated balance instead. Where *withdrawals* get broadcast from (Bybit directly, or a Quantex hot wallet funded by transfers out of Bybit) is a related but still-open decision — not resolved here, revisit at Phase 4.

**Deposit consolidation (confirmed):**

**Why route through Bybit instead of building our own hot/cold wallet system for deposits:** self-hosting custody means building and securing private-key infrastructure for holding real crypto indefinitely. Routing consolidated funds into a Bybit account instead means an established exchange custodies the bulk balance; Quantex's own infrastructure only ever holds small, short-lived amounts — each deposit address, briefly, before it's swept.

**Consolidation destination — admin-configurable, not an env var.** A new `consolidation_addresses` table holds one row per network (TRC-20 / Base / Polygon), each with the Bybit deposit address funds should be swept to. This is a database value editable from the admin panel, not a Railway env var, specifically because env vars need a redeploy to change and this is something you'll want to update live. Because a wrong or tampered value here silently misdirects every future consolidated deposit, changing it requires: (1) client- and server-side address-format validation matching the network (TRC-20 base58 `T...`, EVM checksummed `0x...`), (2) retype-to-confirm before saving, and (3) an `admin_audit_log` entry recording who changed it and when.

**The sweep itself is admin-triggered, not automatic or scheduled.** The admin panel shows every deposit address currently holding a credited-but-unswept balance (comparing `ledger_entries` of type `deposit` against what's already recorded in `sweeps`), and a "Sweep Now" action consolidates only those addresses, only when clicked. A day with no deposits means an empty list and nothing to click — no gas spent.

**Invariant — sweeping never affects a user's balance.** `record_ledger_entry()` credits the user the moment the chain watcher (or its twice-daily backstop, below) detects a deposit, full stop, independent of anything that happens afterward. Consolidating into Bybit is a pure backend custody operation on whatever timing the admin chooses; it never re-touches the ledger. A delayed or indefinitely-deferred sweep never puts a user's credited balance at risk — it only means Quantex's own Bybit balance is temporarily behind what's already been promised to users, which the `sweeps` table plus a reconciliation check (sum of unswept credited deposits + `sweeps` totals vs. actual Bybit balance) makes visible rather than silent.

**How a sweep moves funds, per network/asset:**
- **TRC-20 (USDT):** a dedicated Tron account — separate from the master seed, its own private key stored as a secret the same way the master seed is — **stakes TRX (Stake 2.0) rather than spending it**. Staked TRX isn't consumed; it generates a renewable daily Energy allowance **delegated** to a specific deposit address right before that address's sweep, letting it execute the USDT transfer to the configured Bybit address without ever holding TRX of its own. The staked TRX stays fully owned and reclaimable — this is locked capital, not a per-sweep spend. (A plain "burn TRX directly" fallback works too if delegation is ever unavailable — roughly 1.5 TRX per transfer at the current post-August-2025 energy price of 100 sun/energy — but that TRX is genuinely spent, not reusable.)
- **Base / Polygon (USDC):** USDC's contract supports **EIP-3009 (`transferWithAuthorization`)** — the deposit address's key signs an off-chain authorization (free, no transaction), and a single dedicated relayer wallet (its own small ETH/MATIC balance, one wallet total rather than one per user address) submits it on-chain and pays the gas. No top-up step needed for USDC on either chain.
- **Polygon (USDT):** Tether's contract doesn't implement EIP-3009 on any chain it's deployed on, Polygon included, so USDT collected there falls back to a plain native-gas top-up (a small MATIC transfer to the address before it pays its own gas out) — same cost category as Tron, just without an energy market involved.
- In every case, the deposit address's own private key is **re-derived on demand** from the master seed at the moment it's needed to sign — never stored separately, standard HD wallet practice.

**Failure handling:** every sweep attempt retries with backoff, dead-letters and raises an admin alert after retries are exhausted, and is idempotent (a given deposit can't be swept twice). Since sweeping is admin-triggered rather than a silent background job, failures surface directly in the pending-sweeps view next time it's opened.

**Rejected alternative — generating deposit addresses via Binance's or Bybit's own sub-account API instead of our own HD wallet.** Would have eliminated on-chain sweep costs entirely, since deposits would already sit inside the exchange. Set aside because: (1) Binance is tightening KYC requirements on sub-accounts, which would force KYC at signup — directly contradicting the "no KYC until first withdrawal" decision above; (2) master/sub-account systems on these exchanges are built for institutional segmentation under one already-verified entity, not for minting one address per anonymous retail signup, and Binance caps accounts at 20 deposit addresses per network regardless; (3) it would trade full control over confirmation depth, minimum-deposit thresholds, and detection latency for whatever the exchange's internal policy happens to be. The self-hosted HD wallet avoids all three.

**Rejected alternative — Plasma (Tether's zero-fee USDT L1) as the TRC-20 replacement.** Would eliminate the Tron gas question entirely via a protocol-level paymaster that sponsors USDT transfers. Set aside due to: chain immaturity (mainnet launched late 2025, versus years of adversarial testing on Tron/Polygon/Ethereum), documented validator-centralization concerns, bridge risk (historically the most-exploited attack surface in crypto), an anti-abuse system on the paymaster specifically watching for the "many addresses repeatedly funneling to one destination" pattern our own sweep would produce, and at least one documented case (Bitget) of an exchange suspending Plasma-USDT withdrawal support after launch. The bounded, predictable cost of staking TRX on an established chain was judged the better trade at this project's scale.

**Deposit "waiting" polling state — Redis, not Postgres:**

Since the user-typed deposit amount is never enforced (see Section 4), the "waiting for your deposit..." state on the frontend is purely disposable UI state — it doesn't belong in the database, and it doesn't need to survive a server restart or be queryable/joinable with anything else. This makes it a natural fit for a Redis key with a TTL rather than a table:

```
Key:    deposit_pending:{user_id}:{network}
Value:  { "expected_amount": "50.00", "asset": "USDT", "created_at": "..." }
TTL:    10 minutes
```

**Flow:**
1. User opens the Deposit screen, optionally types an expected amount → frontend calls `POST /deposits/expect` → backend writes the Redis key with a TTL, no Postgres write
2. **Live detection window (first 10 minutes):** the chain watcher actively polls that specific address once every 1 minute — this tight interval is only affordable because it's bounded to 10 requests per deposit session, not run indefinitely (see the TronGrid rate-limit discussion this design is driven by)
3. **The moment a real deposit is detected on-chain** (regardless of amount, regardless of whether the Redis key even still exists), the chain watcher calls `record_ledger_entry()` as normal — the actual crediting logic never reads or depends on this Redis key at all
4. If a matching Redis key exists when the deposit lands, the backend publishes a Pub/Sub event so the frontend's "waiting..." screen resolves instantly to "Deposit received: 30 USDT" (showing the *real* amount, not the originally-typed one) instead of falling back to a slower poll
5. **If the Redis key expires before the deposit arrives (user took more than 10 minutes):** the frontend tells the user plainly that the live check has ended and a late deposit will simply take longer to be credited — no promise of instant crediting past this point. Reopening the Deposit screen starts a fresh 10-minute/1-per-minute live window, but does **not** trigger any special instant check on its own.
6. **Backstop — twice-daily full sweep:** a separate scheduled job (not the live per-session watcher) checks every address that still has no confirmed deposit, twice a day. This is what actually guarantees a late deposit is never missed once its 10-minute live window has expired — worst case, a deposit sent right after the window closes waits until the next scheduled sweep (up to ~12 hours) to be credited. This must be clearly disclosed on the Deposit screen so a user doesn't think a late deposit has vanished.

**Why this must never become the trigger for crediting funds:** it's tempting to make the flow "when this Redis key exists AND a deposit arrives, credit it" — resist that. It would mean a deposit sent after the TTL expires, or sent without ever visiting the Deposit screen first, silently fails to credit. The chain watcher (live or sweep) must always be the sole, unconditional trigger for `record_ledger_entry()`; this Redis key only ever improves the *speed and friendliness* of the UI reaction, never gates whether crediting happens.

**Generic OTP service — Redis-backed, built once, reused across features (planned, not yet built):**

A single reusable mechanism for "send this user a code tied to a specific thing, verify it later" — first consumer is email verification (Section 4), second planned consumer is withdrawal confirmation (Section 4). Not built on Supabase's native email-confirmation OTP; see Section 4's decision history for why (Supabase's version is hard-wired to its own fixed auth-lifecycle actions and can't carry arbitrary business context like a withdrawal amount/address).

```
Key:    otp:{purpose}:{identifier}
Value:  6-digit code
TTL:    short (exact window TBD per purpose — email verification can be generous,
        withdrawal confirmation should be tighter)
```

- `purpose` — `"email_verification"` today; `"withdrawal_confirmation"` once Phase 4 reuses this
- `identifier` — what the code is actually tied to: `user_id` for email verification, `withdrawal_id` for withdrawal confirmation (not `user_id` — a withdrawal-tied code that isn't scoped to the specific withdrawal request would be a real weakness)
- The email itself is sent via Resend, called directly from the backend — not through Supabase's SMTP relay, since Supabase's own confirmation pipeline isn't part of this flow at all
- On successful verification of the email-verification purpose specifically, the backend sets `public.users.email_verified = true`. This is *not* Supabase's own `email_confirmed_at` — with the project's "Confirm email" gate off (required so signup/login return a session immediately), Supabase sets `email_confirmed_at` on every user at signup time regardless of any real confirmation, so it no longer carries the meaning we need. `email_verified` on our own `users` row is the actual source of truth, driven entirely by this OTP flow.

**Security note — the two purposes are not equally sensitive, and the service needs to reflect that.** A 6-digit code is brute-forceable (1,000,000 combinations) without attempt-limiting. Relaxed handling (or none) is an acceptable risk for email verification alone. It is **not** acceptable once this same mechanism gates withdrawal confirmation — real money leaving the platform needs real throttling/lockout on repeated failed attempts before that reuse happens. The service should be designed with this hook in place from the start rather than retrofitted under pressure once withdrawals are being built.

---

## 6. Admin Panel

**Access:** Single superadmin account (`admin@quantex.com` + strong password set after domain is purchased). No role tiers in v1.

**Route:** `/admin` — protected by superadmin session check on every request, server-side.

**What the admin panel handles:**
| Function | Detail |
|---|---|
| KYC review queue | View submitted ID documents and selfies (stored in private Supabase Storage bucket), approve or reject with a reason code. Every decision logged with reviewer identity and timestamp. |
| Withdrawal approval queue | Every withdrawal regardless of amount needs manual sign-off here before funds move |
| User management | View accounts, balances, bot count, KYC status, suspend/unsuspend |
| Bot monitoring | See all active bots across all users, force-pause if needed |
| Platform analytics | Total deposits, total withdrawals, active bots, daily revenue, session-cap unlocks |
| Ledger audit log | Immutable record of every balance mutation — deposits, withdrawals, fees, bonuses |
| Referral management | Review referral credit claims, approve/reject disputes |
| Deposit consolidation | View every deposit address with a credited-but-unswept balance, trigger consolidation on demand via "Sweep Now," view sweep history/status. Manual/on-demand only — never scheduled. |
| Consolidation address settings | Per-network Bybit destination address, edited with retype-to-confirm and address-format validation, logged to the audit log on every change |

---

## 7. Data Models (Final, Confirmed)

| Entity | Key fields |
|---|---|
| `users` | id, email, password_hash, google_id, kyc_status, kyc_submitted_at, referral_code, created_at |
| `wallets` | user_id, network (TRC20/BASE/POLYGON), deposit_address, derivation_index |
| `ledger_entries` | id, user_id, asset, amount, type (deposit/withdraw/bot_alloc/fee/bonus/referral), status, tx_hash, network, created_at |
| `bots` | id, user_id, strategy_type, pair, config (jsonb), status, interval_seconds, sessions_used_today, profit_reinvest (bool), allocation_usdt, created_at |
| `bot_fills` | id, bot_id, side (BUY/SELL), price, quantity, reasoning_text, binance_order_id, created_at |
| `withdrawals` | id, user_id, amount, network, destination_address, status (pending/approved/broadcast/completed/failed), admin_approved_by, admin_approved_at, tx_hash, flat_fee, created_at |
| `kyc_submissions` | id, user_id, id_front_url, id_back_url, selfie_url, status (unsubmitted/pending/under_review/approved/rejected), submitted_at, reviewed_at, reviewed_by (admin email), rejection_reason |
| `session_unlocks` | id, bot_id, user_id, unlocked_at, fee_charged, valid_until (end of day UTC) |
| `referral_credits` | id, referrer_id, referred_id, amount_usdt, status, created_at |
| `admin_audit_log` | id, admin_email, action, target_type, target_id, metadata (jsonb), created_at |
| `consolidation_addresses` | id, network (TRC20/BASE/POLYGON), destination_address, updated_by (admin email), updated_at |
| `sweeps` | id, wallet_id, network, asset, amount, destination_address, gas_topup_tx_hash, sweep_tx_hash, status (pending/broadcast/confirmed/failed), created_at, confirmed_at |

---

## 8. Queue Choice — Important Correction

**BullMQ is a Node.js library and will not work with a Python backend.** Since the backend is FastAPI (Python), the queue must be Python-native:
- **`rq` (Redis Queue)** — pure Python, Redis-backed, simpler, fits FastAPI naturally
- **`Celery` + Redis** — more powerful, industry standard for Python background jobs, better for complex retry/scheduling logic

**Decision: Celery + Redis (Upstash)** for the bot worker queue. The same Redis instance powers the price cache and pub-sub, so no additional infrastructure is needed. Every reference to "BullMQ" elsewhere should be read as "Celery."

---

## 9. Build Plan — SDLC + Claude Code Agentic Engineering

### How Claude Code changes standard SDLC

Claude Code reads the repository's files, so the working style differs from typical development:
- **Specs are written before code is generated.** A well-written spec file in the repo produces far better output than an ad-hoc chat prompt. This document and `CLAUDE.md` are those specs.
- **One module at a time.** Agentic coding agents produce generic or confused output when too many concerns are in scope at once. Small, well-defined tasks produce production-quality code.
- **Tests are written alongside code**, not retrofitted. Ask Claude Code to write the test and the implementation in the same task.
- **Review at module boundaries, not line by line.** After each module works and its tests pass, review, then move on.

### Phase 0 — Project Setup (before any code)

Nothing gets built until the environment Claude Code works in is ready.

- [ ] Buy domain (e.g. `quantex.io`)
- [ ] Create GitHub monorepo — `/frontend`, `/backend`, `/shared`
- [ ] Set up Railway project — two services (frontend + backend) from the same repo
- [ ] Create Supabase project — connection strings + a **private** Storage bucket for KYC documents
- [ ] Create Upstash Redis instance
- [ ] Create Binance account → generate API keys with **read + trade only, NO withdrawal permission** → store in Railway env vars
- [ ] Set up Resend (email) → API key
- [ ] Write a root **`CLAUDE.md`** — the single most important file for agentic engineering. Without it, Claude Code makes assumptions about stack and conventions.

**`CLAUDE.md` starter contents:**
```
- Project: Quantex — custodial crypto trading bot platform
- Frontend: React + Vite, react-i18next, TailwindCSS
- Backend: FastAPI (Python), Supabase (PostgreSQL), Upstash Redis, Celery workers
- Auth: Supabase Auth (email/password + Google OAuth)
- Execution: Binance master account API (read + trade only)
- Networks: TRC-20 (Tron), Base, Polygon
- Conventions: snake_case in Python, camelCase in JS, all colors via CSS variables
- Never: hardcode API keys, commit .env, use BullMQ (use Celery), give withdrawal
  permission to the Binance API key
```

### Phase 1 — Foundation (Weeks 1–2)

Auth, schema, navigation shell. Nothing financial yet.

- **1.1 Database schema** — write the full SQL (Section 7 data models) as a `.sql` file, run against Supabase.
- **1.2 Backend skeleton** — FastAPI structure: `/routers`, `/models`, `/services`, `/workers`, `/utils`; Supabase + Redis clients; health check.
- **1.3 Auth (backend)** — Supabase Auth (email/password + Google OAuth); JWT middleware; signup hook that generates deposit addresses.
- **1.4 Auth (frontend)** — React+Vite scaffold, TailwindCSS, react-i18next wired from day one; Signup, Login, Email OTP screens; protected route wrapper.
- **1.5 Welcome checklist** — post-signup onboarding (deposit → create bot → KYC note).

**Review checkpoint:** signup → verify email → log in → welcome screen works end-to-end.

### Phase 2 — Wallet & Deposits (Weeks 3–4)

Users can deposit real funds. No bots yet.

- **2.1 HD wallet generation** — unique deposit address per network per user (`tronpy` for TRC-20, `web3.py` for Base + Polygon), master seed in env vars.
- **2.2 Chain watchers** — TronGrid / Alchemy / Alchemy-or-Infura webhooks; on confirmation, write `ledger_entries` + notify.
- **2.3 Deposit screen** — network selector, address + QR, pending status (from mockups).
- **2.4 Internal ledger service** — `get_balance`, `credit`, `debit` (with the $20 floor check).
- **2.5 Wallet screen** — total balance, assets, recent activity (from mockups).

**Review checkpoint:** deposit on any of the three networks reflects in balance.

### Phase 3 — Bot Engine (Weeks 5–7)

The core product. Bots created, deployed, running real Binance trades.

- **3.1 Binance service** — one persistent master WebSocket for prices; `place_order()`, `cancel_order()`, `get_open_orders()`.
- **3.2 Market data ingestion** — Binance WS → Redis on every tick; CryptoPanic news every 5 min → Redis; price/candle endpoints.
- **3.3 Strategy Engine — Grid** — evaluate price vs. grid levels, place orders, generate template-based `reasoning_text`, write `bot_fills`.
- **3.4 Celery worker queue** — one recurring task per active bot; session counter in Redis (`sessions:{bot_id}:{date}`, pause >15 without unlock); 5 silent retries on Binance failure then pause + notify.
- **3.5 Strategy Engine — DCA** — scheduled fixed buys, track avg entry.
- **3.6 Strategy Engine — Momentum** — MA-crossover or RSI signal entry/exit.
- **3.7 Bot creation wizard** — 4 steps (pair → strategy → configure → review & deploy); AI-suggest tab (template params from price + volatility); manual tab.
- **3.8 Bot detail / live screens** — live P&L, candlestick chart, fill feed, reasoning card; subscribe to Redis pub-sub for live updates.

**Review checkpoint:** a bot runs a full cycle on Binance and the user sees real fills live.

### Phase 4 — Withdrawals & KYC (Week 8)

Money leaves the platform, safely.

- **4.1 KYC submission screen** — ID front/back + selfie upload; validate (5MB max, JPEG/PNG/PDF); signed upload to the private Supabase bucket; status screen ("up to 4 days").
- **4.2 KYC admin review queue** — signed short-expiry document URLs, approve/reject with reason, log reviewer + timestamp, notify user.
- **4.3 Withdrawal flow (backend)** — validate KYC approved + amount ≥ $100 + balance stays ≥ $20; write `withdrawals` (pending); queue for admin.
- **4.4 Withdrawal admin approval** — every withdrawal reviewed; on approve, hot wallet signs + broadcasts → confirm → debit ledger → notify.
- **4.5 Withdrawal screen** — amount, destination, network, fee disclosure, $20 floor warning (from mockups).

**Review checkpoint:** submit KYC → admin approves → withdraw → admin approves → funds move.

### Phase 5 — Monetization (Week 9)

- **5.1 Bot creation fee** — charged at wizard Step 4, deducted before deploy.
- **5.2 Session cap + $20 unlock** — unlock deducts $20, writes `session_unlocks`, bot resumes; paywall screen from mockups.
- **5.3 Withdrawal flat fee** — deducted on submission, shown before confirm.

**Review checkpoint:** all three revenue streams charge correctly and show in admin analytics.

### Phase 6 — Admin Panel (Week 10)

- **6.1 Admin auth** — `/admin` protected by superadmin session check (`admin@quantex.com` + password; proper admin table post-launch).
- **6.2 / 6.3** — KYC queue and withdrawal queue (partly built in Phase 4).
- **6.4 User management** — list users, balances, bot count, KYC status, suspend/unsuspend.
- **6.5 Bot monitoring** — all active bots, force-pause.
- **6.6 Analytics dashboard** — deposits, withdrawals, active bots, revenue breakdown, user count + KYC conversion.
- **6.7 Audit log viewer** — searchable immutable log of ledger mutations + admin actions.

### Phase 7 — Growth Features (Weeks 11–12)

- **7.1 Leaderboard** — ranking service (return %, win rate, consistency) from `bot_fills`; public page + clone-bot flow.
- **7.2 Referral system** — unique codes, credit on referred user's first deposit.
- **7.3 20 USDT first-deposit bonus** — once per user on first confirmed deposit; `ledger_entries` type `bonus`.
- **7.4 Notifications polish** — Resend email templates for all events; Web Push service worker + subscription management.

### Phase 8 — Pre-Launch (Week 13)

- [ ] Security audit — injection checks, auth-bypass attempts, rate limiting on all endpoints
- [ ] **Hot/cold wallet split — non-negotiable before real user funds**
- [ ] Env var audit — nothing sensitive in code
- [ ] i18n — add a second language to prove the system works
- [ ] PWA manifest + service worker — installable
- [ ] `llms.txt` + `robots.txt` live on the domain
- [ ] Legal pages live — Terms, Privacy, Risk Disclosure
- [ ] Load test — 100 concurrent bots firing
- [ ] Staging end-to-end — full signup → withdrawal journey

### Working with Claude Code — the golden workflow

1. Open Claude Code in the repo root.
2. Start every session with: *"Read CLAUDE.md and quantex-definitive-architecture.md first."*
3. Give one module task at a time, e.g. *"Implement module 3.3 — the Grid Strategy class. Spec is in the architecture doc. Write the class, the unit tests, and a docstring explaining the decision logic."*
4. Review the output, run the tests.
5. Move to the next module.

**Never:** *"Build the entire backend."* Too large, output goes generic. Always one module, one task.

**Useful task patterns for this project:**
- *"Read the existing `bot_fills` schema and implement a `BotFillService` that inserts a fill, generates the reasoning text, and publishes to Redis pub-sub."*
- *"The Grid strategy is in `/backend/services/strategies/grid.py`. Add unit tests for: price inside range, price outside range, stop-loss trigger, session cap hit."*
- *"Read the deposit screen mockup `quantex-deposit-withdraw.html` and implement it as a React component using the existing design-token CSS variables."*
