import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The exact list of path prefixes the FastAPI backend mounts its routers
// under (see backend/app/main.py — each router is included with its own
// APIRouter(prefix=...)). Vite's dev-server proxy below forwards any
// request starting with one of these prefixes straight to the backend on
// port 8000, so the browser only ever talks to ONE origin (the frontend's
// own dev server / its ngrok tunnel). If you add a new router in the
// backend with a new prefix, add that prefix to this list too, or its
// requests will 404 (Vite will try to serve it as a frontend route instead
// of forwarding it).
const backendRoutePrefixes = [
  '/health',
  '/auth',
  '/wallet',
  '/deposits',
  '/bots',
  '/kyc',
  '/withdrawals',
  '/admin',
  '/trade',
  '/market',
]

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,

    // Remote access setup (ngrok): the free ngrok plan only allows ONE
    // tunnel online at a time, so instead of tunneling the frontend (5173)
    // AND the backend (8000) separately, we tunnel only the frontend and
    // have Vite itself forward API calls to the backend over localhost.
    // This also sidesteps CORS entirely for the tunneled case, because the
    // browser only ever sees one origin (the ngrok URL) — the proxy hop
    // from Vite to FastAPI happens server-side, where CORS doesn't apply.
    proxy: Object.fromEntries(
      backendRoutePrefixes.map((prefix) => [
        prefix,
        {
          // Where the real backend lives. Change this if the backend ever
          // runs on a different port/host in your dev setup.
          //
          // Temporarily 8001, not the usual 8000 — port 8000 got stuck in a
          // Windows-level "phantom LISTENING" state after force-killing a
          // stray uvicorn process during Markets-page debugging (both PIDs
          // involved were confirmed dead, but the OS's TCP table kept the
          // port marked as bound anyway; a `netsh`-level reset or a reboot
          // is the actual fix for that, not anything in this repo). Switch
          // this back to 8000 once port 8000 is confirmed free again (e.g.
          // `netstat -ano | findstr :8000` comes back empty), and run
          // uvicorn on --port 8000 as usual.
          target: 'http://localhost:8001',
          // Rewrites the "Host" header on the proxied request to match the
          // target (localhost:8000) instead of forwarding the original
          // Host header (e.g. your ngrok domain). FastAPI doesn't care
          // either way here, but this is the standard/safe default.
          changeOrigin: true,
          // Also proxies WebSocket upgrade requests (not just plain HTTP)
          // through this same rule. Needed because /bots/:id/ws and
          // /deposits/ws (see lib/api.js's WS_BASE usage in BotDetailPage
          // and DepositPage) are WebSocket connections, not fetch() calls —
          // without this flag Vite only forwards regular HTTP and those two
          // live-update connections would fail to connect.
          ws: true,
          // Several of these prefixes are ALSO real frontend routes (e.g.
          // /bots is both the backend's "list bots" endpoint AND the
          // frontend's Bots tab page; /bots/create, /bots/demo, /bots/:id
          // are pushed frontend screens with no backend counterpart at
          // those exact paths). A plain prefix match can't tell those
          // apart, so a hard browser navigation/reload/deep-link to any of
          // these paths was being proxied straight to FastAPI — which
          // correctly 404s or 401s on a path that isn't one of its real
          // routes, serving that raw JSON instead of the React app.
          //
          // The fix: a real page navigation always sends `Accept:
          // text/html` (the browser asking for a document to render); a
          // plain API call from lib/api.js's fetch() never does. `bypass`
          // runs before proxying — returning the request path here tells
          // Vite's proxy to skip forwarding this one request and fall
          // through to Vite's own SPA handling instead, so only genuine
          // API traffic reaches the backend through this rule.
          //
          // WebSocket upgrades (/bots/:id/ws, /deposits/ws) are checked
          // and excluded FIRST, before the Accept-header check — a WS
          // handshake is technically still an HTTP GET, and this proxy's
          // `ws: true` option is what upgrades it, so bypassing it here
          // by mistake would silently drop it back to a plain HTTP
          // response Vite has no real handler for, closing the socket
          // before it ever connects. This was caught live: the first
          // version of this bypass (Accept-header check only, no
          // Upgrade-header guard) broke BotDetailPage's live-fill
          // WebSocket exactly this way.
          bypass(req) {
            const isWebSocketUpgrade = (req.headers.upgrade || '').toLowerCase() === 'websocket'
            if (isWebSocketUpgrade) return undefined
            if (req.headers.accept && req.headers.accept.includes('text/html')) {
              return req.url
            }
          },
        },
      ])
    ),

    // Vite 5+ rejects requests whose Host header isn't localhost/an IP by
    // default, as a DNS-rebinding protection — which would otherwise block
    // every request coming in through the ngrok tunnel. Add your ngrok
    // hostname(s) here explicitly. This one is a free static domain tied to
    // the ngrok account (via `ngrok http 5173 --domain=...`), so it won't
    // change between sessions — if you ever switch to a random/rotating
    // ngrok URL instead, you'd need to update this on every restart, or
    // just set this to `true` to allow any host (fine for a personal/hobby
    // dev tunnel, less safe if you ever expose this more broadly).
    allowedHosts: ['morality-unsubtly-viral.ngrok-free.dev'],
  },
})
