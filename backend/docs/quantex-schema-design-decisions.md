# Quantex — Postgres Schema Design Decisions

Companion to `quantex-schema.sql`. This captures the *why* behind the schema — every decision was made together through direct Q&A, and this document is the record of that reasoning so it doesn't get silently relitigated later.

**This schema has been executed against a real local Postgres 16 instance and validated** — not just written and assumed correct. See Section 7 for exactly what was tested and what the results were.

---

## 1. Primary Keys — Split Strategy

**Decision:** UUID for user-facing/security-sensitive tables (`users`, `wallets`, `bots`, `withdrawals`, `kyc_submissions`), BIGINT identity for high-volume append-only tables (`ledger_entries`, `bot_fills`, `admin_audit_log`).

**Why:** UUIDs mean nothing can be enumerated by guessing sequential IDs (important for anything security-sensitive), and they're required anyway for `users.id` to match Supabase Auth's own UUID user IDs. BIGINT on the high-volume tables keeps indexes smaller and inserts cheaper on the tables that will grow fastest and never stop growing.

---

## 2. Money Representation — NUMERIC(20,8)

**Decision:** All monetary/token amounts are `NUMERIC(20,8)`.

**Why:** Different assets have wildly different decimal precision (USDT=6, ETH=18, BTC=8). `NUMERIC` stores exact decimal values with no floating-point rounding error, and 20 total digits with 8 decimal places comfortably covers every asset Quantex supports without needing per-asset scaling logic at the database layer. The `assets.decimals` column exists purely for *display formatting* in the frontend — the database itself never needs to know an asset's "real" decimal count to store or compute with it correctly.

---

## 3. Row Level Security — Defense in Depth, Not the Only Gate

**Decision:** RLS enabled on every table, with SELECT-only policies scoped to `auth.uid()`.

**Important nuance:** the FastAPI backend connects to Supabase using the **service_role** key, which bypasses RLS entirely by design. This means RLS here is **not** what authorizes the backend's writes — FastAPI's own auth middleware does that. RLS exists specifically as a backstop: if the anon/authenticated key ever ends up somewhere it shouldn't (e.g. a future feature does client-side Supabase realtime subscriptions for live fill streaming, and a bug in that code path leaks the wrong query), a user still cannot physically retrieve another user's row, because Postgres itself refuses it.

**No INSERT/UPDATE/DELETE policies exist for the authenticated role on any table.** By default, that means those operations are silently denied for a regular user session — every write happens through the backend's service_role connection.

---

## 4. Lookup Tables vs. ENUMs — and the One Exception

**Decision:** Fixed-value fields (bot status, withdrawal status, KYC status, network, strategy type, ledger entry type) are lookup tables with foreign keys, not native Postgres ENUMs.

**Why:** Lookup tables let you attach metadata to a value — `is_terminal` on `withdrawal_statuses` so the app can ask "is this status final?" without hardcoding a list, `sort_order` on `networks` for consistent UI ordering. Adding a new status is an `INSERT`, not an `ALTER TYPE` migration.

**The one deliberate exception:** `bot_fills.side` uses a plain `CHECK (side IN ('BUY','SELL'))` instead of a lookup table. This is `bot_fills` — the single highest-volume table in the schema — and BUY/SELL is about as permanently fixed and metadata-free as a value can be; there will never be a third side, and there's nothing meaningful to attach to either value. Adding a lookup-table JOIN to the hottest table in the system for zero real benefit was the wrong tradeoff here specifically, even though it breaks the general rule. This exception is called out explicitly in the schema file's own comments so it reads as a decision, not an inconsistency.

---

## 5. Bot Configuration — Single JSONB Column

**Decision:** `bots.config JSONB` holds all strategy-specific parameters (grid levels, DCA interval, momentum MA period, etc.) rather than normalized columns per strategy type.

**Why:** With 3+ strategy types that each need different parameters, normalized columns mean every bot row has a pile of NULL columns for whichever strategies it *isn't*, and adding a new strategy type means a schema migration. JSONB means the Strategy Engine (Python) can validate the shape at the application layer per strategy type, and new strategies or parameters can ship without touching the database.

**Tradeoff accepted:** Postgres cannot enforce structure inside the JSONB blob. This is intentional — that validation responsibility lives in the FastAPI service layer (e.g. a Pydantic model per strategy type), not the database.

### 5a. Minimum bot allocation — $50, enforced as a real CHECK constraint (added after initial schema delivery)

This wasn't part of the original Q&A round that shaped this schema — it surfaced afterward as a standing product rule ("you cannot give a bot a trading amount less than $50") and was added retroactively:

```sql
allocation_amount numeric(20,8) not null check (allocation_amount >= 50)
```

**Why $50 specifically, not an arbitrary round number:** Binance's own minimum order size for USDT trading pairs is roughly $5–10. A Grid bot with 8–10 price levels needs to place that many individual orders — split $50 across 10 levels and each lands right around Binance's own floor per order. Go meaningfully lower and individual grid orders start failing on Binance's side before Quantex's own validation ever gets a chance to catch it. Applied as one uniform minimum across Grid/DCA/Momentum/Custom for simplicity, even though DCA/Momentum could technically tolerate a lower number.

**Real caveat, stated directly in the schema's own comment:** this check assumes `allocation_asset_id` is always a stablecoin (USDT/USDC) where 1 unit ≈ $1 USD. A raw `amount >= 50` check has no concept of live market price — if Quantex ever allows funding a bot directly in a volatile asset (BTC/ETH/SOL), this constraint stops being meaningful on its own (50 units of BTC is obviously not the same threshold as 50 USDT), and that validation would need to move into the application layer at bot-creation time, where a live price feed is actually available. Documented here so nobody is surprised by this limitation later.

**Downstream product gap this created, not a schema concern but worth noting here since it's the direct consequence of this constraint existing:** a user can have a fully valid Quantex balance between the $20 deposit minimum (see below) and this $50 bot minimum — real money, fully theirs, fully withdrawable — while still being blocked from creating a bot. The UI needs to communicate this gap explicitly and early (a dedicated "you need $X more to create a bot" screen), rather than letting someone reach the final step of the creation wizard only to fail there. This is a UI-layer responsibility, not something the database itself is asked to solve.

---

## 6. The Ledger — the Most Important Part of This Schema

### 6a. Materialized balance via trigger, not live SUM()

**Decision:** `balances` is a real table, kept in sync by an `AFTER INSERT` trigger (`maintain_balance()`) on `ledger_entries`, rather than computing balance as `SUM(amount)` on every read.

### 6b. Why this is safe with zero explicit locking

You raised the exact right concern: two Celery workers could touch the same bot/user near-simultaneously. The reason plain READ COMMITTED with **no explicit locking** is safe here comes down to one rule, stated directly in the schema's header comment and worth repeating: **every balance mutation is an atomic relative UPDATE, never an application-level read-then-write.**

```sql
-- What the trigger does (safe):
update balances set amount = amount + delta where ...

-- What it deliberately does NOT do (unsafe — classic lost-update race):
-- balance = SELECT amount FROM balances WHERE ...       (app reads 100)
-- UPDATE balances SET amount = :computed_value            (app writes 105)
```

Postgres serializes concurrent `UPDATE`s to the *same row* automatically — the second transaction simply waits for the first to commit, then applies its own delta on top of the now-current value. Two simultaneous +5 deposits to the same balance will always net to +10, never lose one. This only holds because the increment is expressed as `amount = amount + delta` inside a single statement — if any future code path ever does a fetch-then-compute-then-write from application code instead, this guarantee breaks. **This is the one rule that must never be violated anywhere balances are touched**, and it's worth stating explicitly to Claude Code every time new ledger-writing code is generated.

### 6c. Overdraw protection is a side effect of the CHECK constraint, not extra logic

`balances.amount >= 0` is a `CHECK` constraint. Because the trigger fires inside the same transaction as the `ledger_entries` insert, an attempt to debit more than the current balance makes the trigger's `UPDATE` violate the constraint — which fails the *entire* transaction, including the `ledger_entries` row that triggered it. **It is structurally impossible to insert a ledger entry that would overdraw a balance.** This was verified directly (Section 7) — attempting to withdraw more than the deposited balance raised a constraint violation and rolled back cleanly, with no manual overdraft-checking code required anywhere.

### 6d. Idempotency via dedup tables, not a constraint on the partitioned table

This is a real Postgres limitation worth understanding: **any unique constraint on a partitioned table must include the partition key.** Since `ledger_entries` is partitioned by `created_at`, a naive `UNIQUE (network_id, tx_hash)` constraint isn't possible directly — Postgres would require `UNIQUE (network_id, tx_hash, created_at)` instead, which doesn't actually prevent a duplicate deposit if the duplicate webhook fires with a *different* timestamp than the original (a very real scenario).

**Solution:** two small, deliberately *unpartitioned* tables — `ledger_tx_dedup` (network_id, tx_hash) and `ledger_idempotency_dedup` (idempotency_key) — each with a real, unqualified unique/primary key. The `record_ledger_entry()` function inserts into the relevant dedup table *first*, inside the same transaction as the ledger insert. If that insert hits a unique violation, the function catches it and returns `NULL` — the whole transaction rolls back cleanly, the duplicate is silently ignored, and the ledger stays untouched. This was verified directly: replaying the same `tx_hash` left the balance unchanged rather than double-crediting it.

### 6e. Single-entry, not double-entry bookkeeping

**Decision:** each ledger row is one signed amount with a type — not a debit/credit pair. Simpler schema, matches the scale of what Quantex needs for v1. If a real accountant or auditor later requires formal double-entry books, that's a derivable view/report built from this data (every entry already has a type and an amount; a reporting layer could reconstruct debit/credit pairs from that) rather than something the core schema needs to carry from day one.

### 6f. `record_ledger_entry()` is the only sanctioned write path

No application code — Python, Celery, anything — should ever `INSERT INTO ledger_entries` directly. The function wraps dedup-checking and the insert into one atomic unit specifically so this can't be gotten wrong or forgotten in some new code path later. **Tell Claude Code this explicitly** whenever it's generating any service function that touches balances.

---

## 7. What Was Actually Tested (not just written)

This schema was run against a real local Postgres 16 instance (Ubuntu, with a minimal stub of Supabase's `auth.users` table and `auth.uid()` function) before being delivered. Specific things verified:

| Test | Result |
|---|---|
| Full schema file runs with zero errors (`ON_ERROR_STOP=1`) | ✅ Pass |
| A deposit via `record_ledger_entry()` correctly increments `balances` | ✅ Pass — balance went from 0 → 500.00 |
| Replaying the identical `tx_hash` (simulating a duplicate webhook) | ✅ Pass — function returned `NULL`, balance stayed at 500.00, not 1000.00 |
| Attempting to withdraw more than the current balance | ✅ Pass — transaction rejected with a `CHECK` constraint violation, no manual overdraft logic needed |
| A ledger row dated within the current month | ✅ Pass — landed in the correctly-named monthly partition (`ledger_entries_2026_08`) |
| A ledger row dated outside every declared partition range (e.g. 2027) | ✅ Pass — landed safely in the `_default` partition instead of erroring |
| RLS: querying `balances` with no authenticated session (`auth.uid()` = NULL) | ✅ Pass — zero rows visible |
| Attempting to create a bot with $30 allocation (below the $50 minimum) | ✅ Pass — rejected with a `CHECK` constraint violation before any row was written |

**One real bug this testing caught:** the first draft only declared partitions through June 2026. Since the actual current date is August 2026, the very first test deposit landed in the `_default` partition instead of a proper monthly one — a real gap that would have quietly degraded query performance in production. Partition coverage was extended through Q1 2027 and re-verified before delivery.

**Operational note this surfaces:** partition coverage needs to stay ahead of the calendar permanently. Set up a scheduled job (`pg_cron` inside Supabase, or a monthly Celery beat task) that creates the next month's partition automatically, well before the currently-covered range runs out — don't rely on remembering to do this manually.

---

## 8. Things Intentionally Left Out of Postgres

- **`bots.sessions_used_today`** — deliberately *not* a column here. Per the architecture doc, this lives in Redis (`sessions:{bot_id}:{date}`) for speed, maintained by the Celery worker. Duplicating it into Postgres would create two sources of truth that could drift. If historical session-count reporting is ever needed, derive it from `bot_fills` counts grouped by day rather than trusting a stored counter.
- **Admin role-based access** — `admins` is a flat table for the single-superadmin v1 design. Adding roles/permissions later is a new `admin_roles` table plus a join, not a rewrite of this table.
- **The $20 minimum deposit threshold** — unlike the $50 bot allocation minimum (Section 5a), this is *not* a database constraint anywhere, and shouldn't become one. A sub-$20 deposit isn't a rejected row — it's simply a deposit the chain watcher never calls `record_ledger_entry()` for in the first place. There's no `ledger_entries` row to reject with a `CHECK`, because the decision happens one layer up, in the watcher service, before the database is ever involved. The funds physically still arrive at the user's on-chain address regardless — Postgres has no way to know or care about that, and isn't the right layer to enforce this rule even if it could.

---

## 9. Known Follow-ups (not yet decided, flagged honestly)

- Exact withdrawal flat fee amount and bot creation fee amount are still placeholders in the application layer, not the schema — the schema just has `numeric` columns ready to hold whatever those turn out to be. (Note: the *deposit minimum* $20 and *bot allocation minimum* $50 are no longer in this category — both are confirmed and, where it made sense, enforced at the schema level. Only the fee amounts themselves remain open.)
- `admin_audit_log.target_id` is `TEXT` rather than a typed FK, to accommodate both UUID- and BIGINT-keyed target tables in one polymorphic column. This is a deliberate, contained looseness for a table that's inherently a reporting surface, not something transactionally joined — worth knowing if it ever needs to become a proper foreign key later.
- No indexes have been added yet for admin-panel-specific query patterns (e.g. "all pending withdrawals sorted by amount") beyond the basics — worth revisiting once the actual admin queries are written and can be measured.
- The bot-creation UI gap flagged in Section 5a (a dedicated screen for "you're between $20 and $50, here's what you need") has since been designed — see `quantex-bot-creation.html`, Step 0.
