# Quantex — Component Inventory & Screen Composition

Every component present on every screen, in the exact order they're arranged, top to bottom. This was built by extracting the real DOM structure from each working HTML mockup — not written from memory — so the ordering and nesting here is what's actually implemented, not an approximation.

**How to read this:** indentation shows nesting (a component listed under another sits inside it). Where a screen has repeating items (multiple bot cards, multiple transaction rows), one instance is shown with a note on how many appear and what varies between them.

**One correction made while building this document:** `quantex-bot-detail-screens.html` was found to contain a stale, duplicate copy of the 4-step bot creation wizard — left over from an earlier draft, missing the Step 0 balance gate and CSS fixes that exist in the real `quantex-bot-creation.html`. It's been removed; that file now contains only what its name promises (the 3 static bot detail screens).

---

## 1. Landing Page (`quantex-landing-page.html`)

```
nav
  nav-logo → nav-wordmark
  nav-links                          (hidden below 860px breakpoint)
  nav-actions
    nav-btn-ghost ("Log in")
    nav-btn-solid ("Get started")

hero
  hero-eyebrow
  h1 (headline)
  hero-sub
  hero-ctas
    cta-primary
    cta-secondary
  hero-trust                          (trust row, stacks vertically <860px)
  hero-visual
    hv-label
    hv-figure
    hv-delta
    hv-bot-row  × 3                   (name + figure pair, one per bot type shown)

strip                                 (marquee/ticker strip)
  strip-text

features
  features-head
    features-eyebrow
  feature-grid                        (3 → 1 column <860px)
    feature-card × 3
      feature-icon

promo-cta
  promo-inner
    cta-primary
footer-legal × 2
```

---

## 2. Signup & Onboarding (`quantex-signup-onboarding.html`)

Four screens in this file, each a full phone frame:

### 2a. Signup
```
status-bar
logo-mark
auth-title
auth-sub
btn btn-outline                       ("Continue with Google")
divider                               ("OR")
form-group → form-label + text-input  (email)
form-group → form-label + text-input(pw-input) + form-hint
btn btn-primary                       ("Create account")
switch-row                            ("Already have an account? Log in")
legal-text                            (Terms/Privacy/risk disclosure)
```

### 2b. Email Verification
```
status-bar
email-icon-wrap
auth-title
auth-sub
otp-row → otp-box × 6                 (3 filled, 1 cursor-active, 2 empty)
resend-row → resend-text + resend-link
btn btn-primary                       ("Verify email")
btn btn-secondary                     ("Use a different email")
```

### 2c. Welcome / Getting Started Checklist
```
status-bar
welcome-check                         (success icon, inside status-bar wrapper)
auth-title                            ("You're in, [name]")
auth-sub
checklist-item × 4                    (each: checklist-num + checklist-title)
btn btn-primary                       ("Make your first deposit")
switch-row                            ("or explore the app first")
```

### 2d. Login
```
status-bar
logo-mark
auth-title
auth-sub
btn btn-outline                       ("Continue with Google")
divider
form-group → form-label + text-input  (email)
form-group → form-label + text-input(pw-input)
btn btn-primary                       ("Log in")
switch-row                            ("New to Quantex? Create account")
```

---

## 3. Home & Menu (`quantex-home-menu-nav.html`)

### 3a. Home
```
status-bar
dash-top
  dash-greet
  bell
dash-hero                             (teal-deep balance card)
  hero-label
  hero-figure
  hero-delta
quick-row
  quick-btn × 3                       (Deposit / Withdraw / New bot — each: quick-icon + quick-label)
ticker-wrap
  ticker-track → ticker-item × 12     (scrolling price ticker)
scroll                                (everything below is in the scrollable area)
  promo-banner → promo-icon + promo-eyebrow + promo-text
  market-tabs → mtab × 4              (Hot/New/Gainers/Losers, one active)
  market-row × 3                      (each: market-left[coin-dot+coin-pair+coin-vol] + market-right[coin-price+pct-pill])
  section-label ("Active bots")
  bot-card × 2                        (each: bot-name + bot-figure, colored up/down)
  section-label ("Leaderboard")
  copy-card                           (trader-row[avatar+name+sub] + bot-figure)
  section-label ("News")
  news-card × 3                       (each: news-tag + news-title + news-meta)
tabbar
  tab-item × 5                        (Home[active] / Bots / Leaderboard / Wallet / Menu — each: tab-icon + tab-label)
```

### 3b. Menu
```
status-bar
menu-header
  menu-user → avatar-big + menu-name + menu-sub
scroll
  menu-group × 6                      (Trading / Manage assets / Rewards / Earn[Phase 2] / Account / More)
    menu-group-label
    menu-item × (2–4 per group)       (each: menu-item-left[menu-icon+menu-text] + chevron)
    — one group (Rewards) uses menu-quad instead: a 2×2 grid of quad-item, not a vertical list
tabbar                                (same 5 items, Menu active this time)
```

### 3c. Standalone reference sections in the same file
Two supporting sections exist purely for design reference, not as real screens: an uncropped **bottom nav detail** (`navdetail`, all 5 `tab-item`s shown large) and an uncropped **market list + news** section showing the promo/market/news block without the phone-frame clipping, so it can be inspected without scrolling.

---

## 4. Bot Creation Wizard (`quantex-bot-creation.html`)

Five screens: a balance gate that precedes the numbered sequence, then 4 numbered steps.

### 4a. Step 0 — Insufficient Balance Gate
```
status-bar
topnav → backbtn
gate-icon-wrap                        (warning icon)
bot-title                             (states the exact requirement)
gate-balance-card
  gate-balance-row × 2                (available balance / minimum required)
  gate-balance-row(total)             (the shortfall — visually separated)
action-row
  action-btn(secondary) "Not now"
  action-btn(primary) "Deposit more"
```

### 4b. Step 1 — Select Pair
```
status-bar
topnav → backbtn + "STEP 1/4"
progress bar (25% filled)
bot-title ("What should this bot trade?")
search input
pair-row × 4                          (BTC/ETH/SOL/XRP, first pre-selected — each shows pair name + config-val price)
action-row → action-btn(primary) "Continue"
```

### 4c. Step 2 — Select Strategy
```
status-bar
topnav → backbtn + "STEP 2/4"
progress bar (50% filled)
bot-title ("Choose how it should trade")
strategy option card × 4              (Grid[selected] / DCA / Momentum / Custom — each: title + description)
action-row → action-btn(secondary) "Back" + action-btn(primary) "Continue"
```

### 4d. Step 3 — Configure
```
status-bar
topnav → backbtn + "STEP 3/4"
progress bar (75% filled)
bot-title ("Set your parameters")
section-label ("Allocation") → allocation input (shows "min. $50")
section-label ("Grid range") → config-row × 3 (lower bound / upper bound / grid levels)
section-label ("Risk controls") → config-row × 2 (stop-loss / network)
action-row → action-btn(secondary) "Back" + action-btn(primary) "Continue"
```

### 4e. Step 4 — Review & Deploy
```
status-bar
topnav → backbtn + "STEP 4/4"
progress bar (100% filled)
bot-title ("Review & deploy")
summary card (teal-deep)              (bot-type-tag + pair + config summary line)
section-label ("Summary") → config-row × 3 (creation fee / allocation / total charged)
disclosure text                       (custodial framing — funds stay in Quantex custody, pause/stop returns allocation)
action-row → action-btn(secondary) "Save draft" + action-btn(primary) "Deploy bot"
```

---

## 5. AI Strategy / Bot Browsing (`quantex-ai-strategy-screen.html`)

### 5a. AI Strategies Tab
```
status-bar
topnav → topnav-left[backchev+bot-title-dd] + topnav-right
pair-row → pair-dd + pair-price
tf-row → tf × 6                       (timeframe selector, one active, includes a spacer)
ma-legend
chart-box → price-hi × 2              (candlestick chart with high markers)
date-row
toggle-pill → toggle-opt × 2          (AI Strategies / Manual, AI active)
ai-intro → ai-badge + ai-intro-text
verdict-card                          (top: verdict-label + verdict-tag[bearish/bullish] + verdict-meta)
verdict-card                          (second card: same header pattern + verdict-body — the detailed reasoning)
apply-row → apply-btn(secondary) + apply-btn(primary)
```

### 5b. Popular Bots Browse
```
status-bar
topnav → topnav-left[backchev+bot-title-dd] + topnav-right
popular-list
  popbot-card × 6                     (first pre-selected — each: popbot-icon + popbot-body[popbot-top+popbot-desc])
```

### 5c. Manual Config Tab
```
status-bar
topnav → topnav-left[backchev+bot-title-dd] + topnav-right
pair-row → pair-dd + pair-price
chart-box
toggle-pill → toggle-opt × 2          (Manual active this time)
form-group                            (price range: form-label-row[label+ai-autofill] + range-row[two range-inputs + dash])
form-group                            (single value input + form-sub)
form-group                            (single value input + slider-track[5 slider-dots, one filled] + form-sub)
reinvest-row → form-label + switch(off)
create-btn
```

---

## 6. Bot Detail — Static (`quantex-bot-detail-screens.html`)

Same structure repeats 3× (Grid / DCA / Momentum), only the numbers and chart type differ:
```
status-bar
topnav → backbtn + more-dots
bot-header → bot-type-tag + bot-title + bot-status
pnl-block → pnl-label + pnl-figure + pnl-sub
stat-grid → stat-box × 3
section-label
config-row × 3
action-row → action-btn(secondary) + action-btn(primary)
```

---

## 7. Bot Running — Live (`quantex-bot-running.html`)

Same structure repeats 3× (Grid / DCA / Momentum live views), plus one modal:

### 7a. Live Running (× 3 strategies)
```
status-bar
topnav → topnav-left + more-dots
live-header → live-status + live-title
pnl-live → pnl-live-label + pnl-live-figure + grid-chart-wrap[price-now-tag]
metric-row → metric-box × 3
reasoning-card → reasoning-label + reasoning-text     ("What it's doing now")
section-label → live-tag
scroll
  fill-row(new) → fill-left[fill-icon(buy/sell)+fill-title] + fill-right
  fill-why                            (the per-fill reasoning note, appears after the newest fill)
  fill-row × 2–3 more                 (older fills, no fill-why attached)
action-row → action-btn(secondary) + action-btn(primary)
```

### 7b. Pause/Stop Confirmation (modal, inline-styled rather than class-based)
```
[full-screen dim overlay]
  bottom sheet
    drag handle
    title ("Pause this bot?")
    body text (explains consequence + funds-safety reassurance)
    action row → Cancel (secondary) + Pause bot (primary)
```

---

## 8. Deposit / Withdraw / KYC (`quantex-deposit-withdraw.html`)

### 8a. Deposit
```
status-bar
topnav
net-select × 2                        (asset selector + network selector)
qr-card → qr-box + addr-row[addr-text+copy-chip] + memo-row[memo-label+memo-val]
info-box                              (minimum deposit / network fee disclosure)
status-card → status-left[status-dot-pending+status-text+status-sub] + status-count
```

### 8b. Withdraw
```
status-bar
topnav
net-select × 2
form-group → form-label + text-input              (destination address)
form-group → form-label + amount-input[figure+unit] + form-sub[form-sub-val]
warn-box                                            ($100 min / $20 floor disclosure)
fee-row × 3
submit-btn
```

### 8c. KYC Gate
```
status-bar
topnav → topnav-title
warn-box
status-card × 3                                     (3-step progress: submit / review / decision)
submit-btn
```

---

## 9. Wallet (`quantex-wallet-screen.html`)

### 9a. Wallet Overview
```
status-bar
topnav → topnav-left
wallet-hero
  wallet-hero-label
  wallet-hero-figure
  wallet-actions → wallet-action-btn × 3            (Deposit/Withdraw/History — white-overlay pills on dark bg)
kyc-strip → kyc-strip-left + kyc-link
scroll
  section-label ("Assets")
  asset-row × 3                                     (each: asset-left[asset-dot+asset-name] + asset-right)
  section-label ("Recent activity")
  tx-row × 3                                        (each: tx-left[tx-icon+tx-title] + tx-right)
```

### 9b. Full Transaction History
```
status-bar
topnav → topnav-left
scroll → tx-row × 6                                 (tx-left + tx-right only, no icon detail shown at this density)
```

### 9c. Transaction Detail
```
status-bar
topnav → topnav-left + tx-status(completed)
fee-row × 5                                          (amount / network / fee / confirmations / hash)
wallet-action-btn                                    ("View on block explorer")
```

---

## 10. Failure States (`quantex-failure-states.html`)

Six rows, each containing 2–3 screens built from a small, consistent vocabulary of primitives:

**The primitives used throughout (defined once, reused everywhere in this file):**
- `banner` (+ `danger` variant) → `banner-text` — inline warning/error strip
- `center-state` → `state-icon`(error/warn) + `state-title` + `state-body` + optional `code-chip` — full-screen blocking failure
- `toast` → `toast-icon` + `toast-text` + optional `toast-action` — non-blocking bottom notification
- `field-err` — inline per-input validation message

### Row-by-row composition:
| Row | Screens | Primitives used |
|---|---|---|
| 1. Form-level validation | 2 | `text-input(err)` + `field-err`; `banner(danger)` + `text-input` |
| 2. Transaction failures | 2 | `center-state` (both) — full-screen, always with `code-chip` |
| 3. Bot & trading failures | 3 | `banner(danger)`; double `banner`; `banner` + `center-state(warn)` |
| 4. Account & session failures | 3 | `center-state(error)`; `center-state(warn)`; `center-state(error)` + `toast` |
| 5. Toast-style micro-errors | 2 | `toast` + `toast-action`, both screens |
| 6. Session cap / paywall | 3 | `banner`; `center-state(warn)` + `code-chip`; plain action buttons (the unlock-options screen) |

**The one rule that holds across all 6 rows, by design:** every failure state's body text includes an explicit funds-safety reassurance — this is treated as a non-negotiable trust mechanic (see the design system's Gate Card spec, which generalizes this same principle), not just error copy.

---

## Cross-Screen Component Reuse Reference

Some components appear across many screens with identical structure — worth knowing so a shared implementation makes sense:

| Component | Appears on |
|---|---|
| `status-bar` | Every single screen, no exceptions |
| `topnav` (in its various forms) | Every screen except the Home tab-bar root |
| `action-row` (secondary + primary button pair) | Bot Creation (all steps), Bot Detail, Bot Running, several Failure States |
| `config-row` (label/value pair) | Bot Creation, Bot Detail, Bot Running, Wallet transaction detail |
| `center-state` | Failure States only, but the shape (icon/title/body/action) matches the Gate Card pattern closely enough that a shared component is worth building |
| `tabbar` | Home, Menu (identical 5 items, different active state) |
| `toast` | Failure States (dedicated) + implied elsewhere for live async errors not yet mocked up |

This table is the practical argument for building a shared component library (extending `Icon.jsx`/`AnimatedPsi.jsx` with layout components like `<ActionRow>`, `<ConfigRow>`, `<CenterState>`, `<StatusBar>`) rather than each screen implementing its own version — the repetition here is real, not coincidental.
