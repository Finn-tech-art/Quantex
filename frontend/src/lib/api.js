// If VITE_API_BASE_URL is left unset (see frontend/.env), API_BASE falls
// back to "" — an empty string means every request path below (e.g.
// "/auth/login") gets requested as a RELATIVE URL, which the browser
// resolves against whatever origin actually served the page. In dev that's
// either http://localhost:5173 or your ngrok URL — either way, Vite's own
// dev server receives the request and, per the `proxy` list in
// vite.config.js, forwards it to the FastAPI backend on port 8000. This is
// what makes the same build work both on your dev machine and on a phone
// over ngrok, with no separate backend tunnel needed. Only set
// VITE_API_BASE_URL to an absolute URL (e.g. in production on Railway,
// where frontend and backend are different origins with no such proxy).
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
export const WS_BASE = API_BASE.replace(/^http/, "ws");

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.detail;
    const message = Array.isArray(detail) ? detail[0]?.msg : detail;
    throw new Error(message || "Something went wrong. Please try again.");
  }
  return data;
}

// Same error handling as request() above, but for a multipart/form-data
// body (file uploads — currently just KYC document submission). Never sets
// Content-Type itself: the browser has to generate that header on a
// FormData body (it includes a random multipart boundary string that has
// to match what's actually written into the body), so unlike request()
// above this deliberately passes NO Content-Type at all — setting one here
// would just be the wrong value and break the upload.
async function requestForm(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.detail;
    const message = Array.isArray(detail) ? detail[0]?.msg : detail;
    throw new Error(message || "Something went wrong. Please try again.");
  }
  return data;
}

export function signup(email, password, firstName, lastName, country) {
  return request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      first_name: firstName,
      last_name: lastName,
      country,
    }),
  });
}

export function login(email, password) {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function me(accessToken) {
  return request("/auth/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Backs the one-time country picker ProtectedRoute.jsx shows any signed-in
// user whose profile still has country = null — most commonly a Google
// OAuth signup, which never passes through signup() above at all.
export function setCountry(accessToken, country) {
  return request("/auth/country", {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ country }),
  });
}

export function sendVerifyEmailOtp(accessToken) {
  return request("/auth/verify-email/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function confirmVerifyEmailOtp(accessToken, code) {
  return request("/auth/verify-email/confirm", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ code }),
  });
}

export function getDepositAddress(accessToken, network) {
  return request(`/wallet/deposit-address?network=${network}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function getBalances(accessToken) {
  return request("/wallet/balances", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function expectDeposit(accessToken, network, expectedAmount) {
  return request("/deposits/expect", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ network, expected_amount: expectedAmount || null }),
  });
}

export function getActivity(accessToken) {
  return request("/wallet/activity", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Backend derives every point on demand from ledger_entries — there's no
// snapshot table behind this, so it's always exactly consistent with
// getBalances() above (see portfolio_history_service.py's module comment
// for why that's true). range: "24h" | "7d" | "30d" | "all". buckets:
// how many OHLC candles come back — the Home hero card asks for 12 to
// match the design spec's "12 candles"; pass a different number for a
// denser/sparser chart elsewhere without touching the backend.
export function getPortfolioHistory(accessToken, { range = "7d", buckets = 12 } = {}) {
  return request(`/wallet/portfolio-history?range=${range}&buckets=${buckets}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// ── KYC (Phase 4) ────────────────────────────────────────────────────────────
export function getKycStatus(accessToken) {
  return request("/kyc/status", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function submitKyc(accessToken, { idFront, idBack, selfie }) {
  // Each of idFront/idBack/selfie is a browser File object straight off an
  // <input type="file"> — FormData reads its filename/content-type directly
  // off that object, nothing to convert here. Field names ("id_front" etc.)
  // must match routers/kyc.py's submit() parameter names exactly — FastAPI
  // matches multipart fields by name, not position.
  const form = new FormData();
  form.append("id_front", idFront);
  form.append("id_back", idBack);
  form.append("selfie", selfie);
  return requestForm("/kyc/submit", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
}

export function listBots(accessToken) {
  return request("/bots", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function getBotDetail(accessToken, botId) {
  return request(`/bots/${botId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function getBotFills(accessToken, botId) {
  return request(`/bots/${botId}/fills`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function getBotChart(accessToken, botId) {
  return request(`/bots/${botId}/chart`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Backend endpoint: POST /bots/{bot_id}/stop — see routers/bots.py's
// stop_bot() docstring for exactly what this does for each bot kind (both
// close out whatever's still unrealized right now instead of leaving it
// behind, then flip the bot to the terminal STOPPED status). Returns
// { id, status, total_pnl } — BotDetailPage doesn't use the return value
// directly, it just re-fetches full bot detail afterward via refresh().
export function stopBot(accessToken, botId) {
  return request(`/bots/${botId}/stop`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function getFakeSession({
  targetMinReturn = 0.37,
  winRate = 0.9,
  sessionLengthMinutes = 10,
  allocationAmount = 500.0,
  initialPrice = 75000.0,
  pair = "BTC/USDT",
} = {}) {
  const params = new URLSearchParams({
    target_min_return: targetMinReturn,
    win_rate: winRate,
    session_length_minutes: sessionLengthMinutes,
    allocation_amount: allocationAmount,
    initial_price: initialPrice,
    pair,
  });
  // This endpoint is intentionally auth-free — it reads no DB data.
  return request(`/bots/demo/fake-session?${params}`);
}

export function createBot(accessToken, { pair = "BTC/USDT", allocationAmount, sessionLengthMinutes = 10, intervalSeconds = 900 } = {}) {
  // Module 4 — creates a persistent SCRIPTED (simulated) bot. allocationAmount
  // must be a decimal STRING (e.g. "100" or "100.50"), not a JS number — see
  // CreateSimulatedBotRequest.allocation_amount's comment in models/bot.py
  // for why (avoids binary float round-off on a value that goes straight
  // into a NUMERIC column and the ledger).
  return request("/bots", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      pair,
      allocation_amount: allocationAmount,
      session_length_minutes: sessionLengthMinutes,
      interval_seconds: intervalSeconds,
    }),
  });
}

// ── Markets tab — one snapshot of every USDT-quoted coin's 24hr
// performance, already sorted most-traded-first by the backend. See
// backend/app/routers/market.py — this is a completely different data path
// from getTradePrice below (which reads a single tracked symbol's live
// price for the manual Trade screen); this one powers the full coin list. ──
export function getMarkets(accessToken) {
  return request("/market/tickers", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// ── Manual Trade screen — see backend/app/services/trading_service.py for
// the fee model and why this is "simulated execution, real ledger effect"
// rather than either a fully-fake demo or a real Binance order. quoteAmount
// / quantity stay decimal STRINGS all the way to the backend, same
// reasoning as createBot's allocationAmount above. ─────────────────────────
export function getTradePrice(accessToken, pair) {
  return request(`/trade/price?pair=${encodeURIComponent(pair)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function getTradeChart(accessToken, pair) {
  return request(`/trade/chart?pair=${encodeURIComponent(pair)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function buyTrade(accessToken, pair, quoteAmount) {
  return request("/trade/buy", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ pair, quote_amount: quoteAmount }),
  });
}

export function sellTrade(accessToken, pair, quantity) {
  return request("/trade/sell", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ pair, quantity }),
  });
}

export function getTradeHistory(accessToken, pair) {
  const query = pair ? `?pair=${encodeURIComponent(pair)}` : "";
  return request(`/trade/history${query}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// ── Withdrawals (Phase 4, module 2) — see backend/app/services/
// withdrawal_service.py for the full two-step (request -> OTP confirm)
// design these three calls are the frontend half of. ───────────────────────
export function requestWithdrawal(accessToken, { asset, network, destinationAddress, amount }) {
  // amount stays a decimal STRING all the way to the backend, same reasoning
  // as createBot's allocationAmount above.
  return request("/withdrawals/request", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      asset,
      network,
      destination_address: destinationAddress,
      amount,
    }),
  });
}

export function confirmWithdrawal(accessToken, requestId, code) {
  return request("/withdrawals/confirm", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ request_id: requestId, code }),
  });
}

export function getMyWithdrawals(accessToken) {
  return request("/withdrawals", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Read-only preview of the current admin-set withdrawal fee — see
// WithdrawPage.jsx, which calls this instead of hardcoding a fee value so
// its pre-submit "you'll receive" estimate never drifts from whatever an
// admin last set via setWithdrawalFee below.
export function getWithdrawalFeePreview(accessToken) {
  return request("/withdrawals/fee", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// ── Notifications (the bell icon) — see backend/app/services/
// notification_service.py's module docstring for the full list of events
// that write a row here (KYC decisions, withdrawal decisions, deposit
// confirmations, bot start/stop) and NotificationBell.jsx for how these
// three calls get used (a poll timer for getNotifications, a tap on an
// unread row for markNotificationRead, the dropdown's header button for
// markAllNotificationsRead). ────────────────────────────────────────────────
export function getNotifications(accessToken) {
  return request("/notifications", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function markNotificationRead(accessToken, notificationId) {
  return request(`/notifications/${notificationId}/read`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function markAllNotificationsRead(accessToken) {
  return request("/notifications/read-all", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// ── Admin (separate credential from the regular user access token above —
// see backend/app/services/admin_auth_service.py's module comment for why
// admins aren't Supabase Auth users and need their own login/token). Every
// function here takes an ADMIN token, never the regular accessToken. ──────
export function adminLogin(email, password) {
  return request("/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function adminMe(adminToken) {
  return request("/admin/auth/me", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

export function getWinRate(adminToken, winDate) {
  const query = winDate ? `?win_date=${winDate}` : "";
  return request(`/admin/win-rate${query}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

export function setWinRate(adminToken, { winDate, winRate, targetMinReturn }) {
  return request("/admin/win-rate", {
    method: "PUT",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      win_date: winDate || null,
      win_rate: winRate,
      target_min_return: targetMinReturn,
    }),
  });
}

// ── Withdrawal fee setting ───────────────────────────────────────────────────
export function getWithdrawalFee(adminToken) {
  return request("/admin/withdrawal-fee", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

export function setWithdrawalFee(adminToken, feeAmount) {
  // feeAmount stays a decimal STRING all the way to the backend, same
  // reasoning as every other money-bearing value passed through this file.
  return request("/admin/withdrawal-fee", {
    method: "PUT",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ fee_amount: feeAmount }),
  });
}

// ── Dashboard overview ───────────────────────────────────────────────────────
export function getAdminOverview(adminToken) {
  return request("/admin/overview", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

export function getKycQueue(adminToken) {
  return request("/admin/kyc", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

export function getKycSubmissionDetail(adminToken, submissionId) {
  return request(`/admin/kyc/${submissionId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

export function approveKyc(adminToken, submissionId) {
  return request(`/admin/kyc/${submissionId}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

export function rejectKyc(adminToken, submissionId, reason) {
  return request(`/admin/kyc/${submissionId}/reject`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ reason }),
  });
}

// ── Withdrawal approval queue (Phase 4, module 2) ───────────────────────────
export function getWithdrawalQueue(adminToken) {
  return request("/admin/withdrawals", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

export function getWithdrawalDetail(adminToken, withdrawalId) {
  return request(`/admin/withdrawals/${withdrawalId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

export function approveWithdrawal(adminToken, withdrawalId) {
  return request(`/admin/withdrawals/${withdrawalId}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

export function rejectWithdrawal(adminToken, withdrawalId, reason) {
  return request(`/admin/withdrawals/${withdrawalId}/reject`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ reason }),
  });
}

// ── Deposit consolidation (module 1/4/5) — see backend/app/services/
// custody_service.py and the architecture doc's "Deposit consolidation"
// section for the full design these calls are the frontend half of. ────────
export function getConsolidationAddresses(adminToken) {
  return request("/admin/consolidation-addresses", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

export function setConsolidationAddress(adminToken, network, destinationAddress) {
  return request(`/admin/consolidation-addresses/${network}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ destination_address: destinationAddress }),
  });
}

export function getPendingSweeps(adminToken) {
  return request("/admin/sweeps/pending", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

// Fires the actual on-chain sweeps — see routers/admin.py's run_sweep_now
// and custody_service.trigger_sweep_now for why this is safe to call
// repeatedly (it re-checks real on-chain state every time, never trusts
// whatever this page last rendered) and why it queues rather than blocks
// (each sweep can take up to ~90s to confirm on-chain).
export function runSweepNow(adminToken) {
  return request("/admin/sweeps/run", {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

export function getSweepHistory(adminToken) {
  return request("/admin/sweeps", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

// A convenience keygen for the Tron gas wallet or EVM relayer wallet — see
// routers/admin.py's generate_operational_wallet. The returned private_key
// is shown exactly once and never retrievable again; it still has to be
// pasted into env vars and the backend restarted before it does anything.
// chain is "TRON" or "EVM".
export function generateOperationalWallet(adminToken, chain) {
  return request("/admin/wallets/generate", {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ chain }),
  });
}

export function saveDemoSession(accessToken, { sessionId, totalPnl, isWin }) {
  // Posts the session result to credit the user's real USDT balance if it was
  // a winning session. Idempotent — the same sessionId can be posted twice
  // without a double-credit (the backend's idempotency_key guard handles it).
  return request("/bots/demo/save-session", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      session_id: sessionId,
      total_pnl: totalPnl,
      is_win: isWin,
    }),
  });
}

