We're going to build this thing following a modular approach ... Before you write any code you tell me how it is likely to affect the codebase ... whether it is going to break something or not ... thinking about this enables you to ensure nothing breaks the codebase ... You then tell me how we are going to implement the particular module ...

then after I approve your idea ... you write the code ... then you test it in your own sandbox and tell me how to test it using white box testing to check that the output (if the code gives an output is exactly what I want)

You will follow all instructions I give you ... no going against me ... since I am the senior engineer here ...

---

## Project

Quantex — custodial crypto trading bot platform. Users deposit crypto, deploy trading bots (Grid/DCA/Momentum) that trade from a single master Binance account, and withdraw after KYC approval. Full product/system decisions live in `quantex-definitive-architecture_1.md`; pixel-level design values live in `quantex-design-system-spec_2.md`; phase-by-phase build order lives in `quantex-build-plan-checklist.md`. Read all three at the start of a session before starting work.

## Monorepo layout

```
/frontend   React + Vite SPA (includes the /admin route — same codebase)
/backend    FastAPI (Python)
/shared     Code/types shared between frontend and backend
```

## Stack

- **Frontend:** React + Vite, TailwindCSS v4 (via `@tailwindcss/vite`), react-i18next (i18n scaffolded from day one, English only for now)
- **Backend:** FastAPI (Python 3.11, venv at `backend/.venv`), Supabase (PostgreSQL + Auth + private Storage for KYC docs), Upstash Redis (cache, pub-sub, Celery broker), Celery (background workers — **not BullMQ**, that was an earlier draft decision superseded in the architecture doc)
- **Execution:** Binance master account API — keys must be **read + trade only, never withdrawal**
- **Chains:** TRC-20 (Tron, via `tronpy`), Base + Polygon (EVM, via `web3.py`) — introduced in the wallet/deposit phase, not yet installed
- **Hosting:** Railway (frontend + backend as two services from this one repo)

## Conventions

- Python: `snake_case` for files, functions, variables
- JS/JSX: `camelCase` for variables/functions, `PascalCase` for components
- Backend structure: `app/routers`, `app/models`, `app/services`, `app/workers`, `app/utils` — new backend code goes in the matching folder, don't create new top-level dirs without asking
- All colors, spacing, radii, and fonts come from the CSS custom properties defined in `frontend/src/index.css` (mirrors Section 1 of the design system spec) — never hardcode a hex value or px spacing in a component when a token exists for it
- Env vars: `backend/.env` (never committed — see `.gitignore`), documented in `backend/.env.example` whenever a new one is added

## Never

- Hardcode API keys or secrets, or commit `.env`
- Use BullMQ (Node-only) — the queue is Celery
- Give the Binance API key withdrawal permission
- Build multiple modules/features in one task — one module at a time, per the workflow above
- Invent product decisions (fee amounts, strategy default parameters, KYC policy) that the build-plan checklist marks as a 🧍 human decision — ask instead of guessing