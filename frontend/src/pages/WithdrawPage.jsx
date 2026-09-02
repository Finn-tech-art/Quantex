// Withdrawal screen (Phase 4, module 2) — the user-facing half of
// withdrawal_service.py. Mirrors DepositPage.jsx's overall shape (top nav,
// stacked cards) but adds the two-step request -> OTP confirm flow: filling
// the form and hitting Withdraw calls POST /withdrawals/request (which
// validates everything and emails a 6-digit code), then a second screen
// takes that code and calls POST /withdrawals/confirm, which is the moment
// a real `withdrawals` row is actually created (PENDING, awaiting admin
// approval — see AdminWithdrawalsQueuePage.jsx for the other half of that).
//
// KYC is gated on both ends: WalletPage's Withdraw pill already routes to
// /kyc instead of here for anyone not APPROVED, and this page checks again
// itself (via user.kyc_status from AuthContext) so landing here directly —
// a bookmarked URL, a stale tab — still can't reach the form. The backend
// re-checks a third time regardless (see withdrawal_service.create_request),
// since a client-side check like this is only ever a UX nicety.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { useAuth } from "../context/AuthContext";
import AnimatedPsi from "../components/AnimatedPsi";
import CoinGlyph from "../components/CoinGlyph";
import Icon from "../components/Icon";
import NetworkGlyph from "../components/NetworkGlyph";
import SelectField from "../components/SelectField";
import { Field, ErrorText, PrimaryButton } from "../components/FormControls";
import {
  confirmWithdrawal,
  getBalances,
  getMyUnlockFees,
  getMyWithdrawals,
  getWithdrawalFeePreview,
  payUnlockFee,
  requestWithdrawal,
  resendWithdrawalCode,
  WS_BASE,
} from "../lib/api";

// Which network(s) each asset can be withdrawn over — kept in sync BY HAND
// with withdrawal_service.ASSET_NETWORKS on the backend (itself derived
// from network_assets.NETWORK_CONFIG, filtered to _ACTIVE_NETWORKS).
// Narrowed to TRC-20 only for the mainnet launch — Base/Polygon (USDC) are
// disabled on the deposit side too (see migration
// 019_disable_evm_networks.sql and DepositPage.jsx's NETWORKS array), so
// there's no active network left to withdraw USDC over right now. Restore
// `USDC: ["BASE", "POLYGON"]` here (alongside the other files noted in
// that migration's comment) once they're reactivated. If the backend ever
// adds a new asset/network pairing, mirror it here too or this screen
// simply won't offer the new network as an option — the backend's own
// validation is what actually enforces this, this is only what gets shown
// as a choice.
const ASSET_NETWORKS = {
  USDT: ["TRC20"],
};

// Mirrors withdrawal_service.py's MIN_WITHDRAWAL_AMOUNT /
// BALANCE_FLOOR_AFTER_WITHDRAWAL — shown here purely so the form can preview
// the minimum/floor notice before the network round trip. The backend
// re-validates both for real; if either ever changes on the backend, update
// the matching value here too or this preview will just be wrong (harmless
// — the backend's own error message would still catch it — but confusing).
// The withdrawal FEE used to be a third hardcoded constant here too, but
// it's admin-configurable now (see AdminWithdrawalFeePage.jsx) — WithdrawForm
// below fetches the live value via getWithdrawalFeePreview instead, so this
// preview can never silently drift from whatever an admin last set.
const MIN_WITHDRAWAL_AMOUNT = 100;
const BALANCE_FLOOR = 20;

// Every status a withdrawal is done changing on its own — nothing in this
// codebase ever moves a row out of one of these once it lands there (see
// withdrawal_service.py's module docstring on why APPROVED is, in practice,
// the real end state today: there's no broadcast worker yet to carry it on
// to BROADCAST/COMPLETED). Used only to decide whether the polling effect
// below still has anything worth watching — PENDING is the only status
// reachable in the running app that ISN'T in this set.
const TERMINAL_WITHDRAWAL_STATUSES = new Set(["APPROVED", "COMPLETED", "FAILED", "REJECTED"]);

const STATUS_COLOR = {
  PENDING: "var(--pending-dot)",
  APPROVED: "var(--gain)",
  BROADCAST: "var(--gain)",
  COMPLETED: "var(--gain)",
  FAILED: "var(--loss)",
  REJECTED: "var(--loss)",
};

export default function WithdrawPage() {
  const { t } = useTranslation();
  const { accessToken, user } = useAuth();
  const [balances, setBalances] = useState(null);
  const [myWithdrawals, setMyWithdrawals] = useState(null);
  const [step, setStep] = useState("form"); // "form" | "otp" | "done"
  const [pendingRequest, setPendingRequest] = useState(null); // the /request response, held while on the OTP step
  // null while loading; an array (possibly empty) once loaded. Any
  // currently-active, unpaid withdrawal unlock fee — see
  // backend/app/services/withdrawal_unlock_fee_service.py's module comment
  // — blocks EVERY withdrawal request, so a non-empty list here takes over
  // this whole screen (see the render below) instead of showing the normal
  // withdraw form at all.
  const [unlockFees, setUnlockFees] = useState(null);

  function refreshBalances() {
    if (!accessToken) return;
    getBalances(accessToken).then((res) => setBalances(res.balances));
  }

  function refreshWithdrawals() {
    if (!accessToken) return;
    getMyWithdrawals(accessToken).then((res) => setMyWithdrawals(res.withdrawals));
  }

  function refreshUnlockFees() {
    if (!accessToken) return;
    getMyUnlockFees(accessToken).then((res) => setUnlockFees(res.fees));
  }

  useEffect(refreshBalances, [accessToken]);
  useEffect(refreshWithdrawals, [accessToken]);
  useEffect(refreshUnlockFees, [accessToken]);

  // Poll while any fee is still unpaid — a real on-chain payment can take
  // anywhere from seconds to hours to confirm (see
  // withdrawal_unlock_fee_service.py's INTENT_TTL comment), so this is what
  // notices a payment landing and clears the gate without the user having
  // to manually refresh the page. Stops polling on its own the moment the
  // list comes back empty (the effect's own dependency on `unlockFees`
  // means an empty result just doesn't re-arm the interval).
  useEffect(() => {
    if (!unlockFees || unlockFees.length === 0) return;
    const interval = setInterval(refreshUnlockFees, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, unlockFees]);

  // Backstop for the WebSocket below: an admin approving/rejecting a
  // request happens from a completely separate admin session, so normally
  // nothing pushes that change to this tab except the instant push the
  // effect below sets up. This just guards against the socket having
  // silently dropped (a network hiccup, a backgrounded tab, sleep/wake) —
  // in the common case the WS message arrives first and this fetches the
  // exact same already-current data a few seconds later as a no-op re-
  // render. Stops on its own once every request this user has is in a
  // terminal state — no open request left to watch, no reason to keep
  // polling. 20s (not the unlock-fees poll's 5s above) because this is
  // purely a backstop, not the primary update path.
  useEffect(() => {
    if (!myWithdrawals) return;
    const hasOpenRequest = myWithdrawals.some((w) => !TERMINAL_WITHDRAWAL_STATUSES.has(w.status));
    if (!hasOpenRequest) return;
    const interval = setInterval(refreshWithdrawals, 20000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, myWithdrawals]);

  // The actual real-time path: routers/withdrawals.py's /withdrawals/ws
  // pushes one message the instant an admin approves or rejects this
  // user's request (see withdrawal_service._publish_status_update), same
  // Redis-pub/sub-over-WebSocket mechanism DepositPage.jsx's own /deposits/
  // ws already uses for live deposit credits. The payload's actual content
  // is never read here — any message means "your withdrawal list just
  // changed," so this just refetches it, same as UnlockFeeCard's polling
  // does after a payment lands. One connection per mount; closed on
  // unmount. If it drops, the poll above still catches the change within
  // 20s — this isn't the only path, just the fast one.
  useEffect(() => {
    if (!accessToken) return;
    const ws = new WebSocket(`${WS_BASE}/withdrawals/ws?token=${accessToken}`);
    ws.onmessage = refreshWithdrawals;
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  function handleRequested(result, formInputs) {
    setPendingRequest({ ...result, ...formInputs });
    setStep("otp");
  }

  function handleConfirmed() {
    setStep("done");
    refreshBalances();
    refreshWithdrawals();
  }

  function handleStartOver() {
    setPendingRequest(null);
    setStep("form");
  }

  const kycApproved = user?.kyc_status === "APPROVED";

  return (
    <div className="flex min-h-screen justify-center px-5 py-8">
      <div className="w-full max-w-sm" style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <TopNav t={t} />

        {!kycApproved ? (
          <KycRequiredCard t={t} />
        ) : unlockFees === null ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-16) 0" }}>
            <AnimatedPsi mode="working" size={28} color="var(--teal-base)" />
          </div>
        ) : unlockFees.length > 0 ? (
          <UnlockFeesGate accessToken={accessToken} fees={unlockFees} t={t} />
        ) : (
          <>
            {step === "form" && (
              <WithdrawForm accessToken={accessToken} balances={balances} onRequested={handleRequested} t={t} />
            )}
            {step === "otp" && pendingRequest && (
              <OtpStep
                accessToken={accessToken}
                pendingRequest={pendingRequest}
                onConfirmed={handleConfirmed}
                onCancel={handleStartOver}
                t={t}
              />
            )}
            {step === "done" && <SuccessCard onStartOver={handleStartOver} t={t} />}

            <MyRequestsList withdrawals={myWithdrawals} t={t} />
          </>
        )}
      </div>
    </div>
  );
}

function TopNav({ t }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
      <Link to="/wallet" style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "16px", color: "var(--ink-base)", textDecoration: "none" }}>
        ←
      </Link>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "17px", color: "var(--ink-base)" }}>
        {t("withdraw.title")}
      </span>
    </div>
  );
}

function KycRequiredCard({ t }) {
  return (
    <div
      style={{
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-8)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-5)",
      }}
    >
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "13px", color: "var(--ink-base)" }}>
        {t("withdraw.kycRequiredTitle")}
      </span>
      <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)", lineHeight: 1.5 }}>
        {t("withdraw.kycRequiredBody")}
      </span>
      <Link to="/kyc" style={{ textDecoration: "none" }}>
        <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12.5px", color: "var(--teal-base)" }}>
          {t("withdraw.kycRequiredLink")} →
        </span>
      </Link>
    </div>
  );
}

// One or more active withdrawal unlock fees this user hasn't paid yet —
// takes over the whole screen in place of the normal withdraw form/history
// (see the parent component's render) until every one of them is paid, at
// which point the next poll (see WithdrawPage's own polling effect) finds
// an empty list and this whole branch stops rendering on its own.
function UnlockFeesGate({ accessToken, fees, t }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      <div
        style={{
          background: "var(--teal-pale)",
          border: "1px solid var(--teal-base)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-8)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
        }}
      >
        <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "13px", color: "var(--teal-deep)" }}>
          {t("withdraw.unlockFees.gateTitle")}
        </span>
        <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-base)", lineHeight: 1.5 }}>
          {t("withdraw.unlockFees.gateBody")}
        </span>
      </div>

      {fees.map((f) => (
        <UnlockFeeCard key={f.id} accessToken={accessToken} fee={f} t={t} />
      ))}
    </div>
  );
}

// One fee's own card — collapsed to just its name/amount and a "Pay now"
// button until tapped, which reveals a network picker; picking one calls
// POST /withdrawal-fees/{id}/pay (creating the durable payment intent
// chain_watcher_service.py needs — see that endpoint's own comment) and
// shows the resulting deposit address + QR code, same visual language as
// DepositPage's own AddressCard. From there this card just sits and waits
// — the parent's polling effect is what notices the payment landing and
// removes this fee from the list, there is nothing more to click here.
function UnlockFeeCard({ accessToken, fee, t }) {
  const [expanded, setExpanded] = useState(false);
  const [network, setNetwork] = useState(ASSET_NETWORKS[fee.asset]?.[0] || null);
  const [payment, setPayment] = useState(null); // the /pay response, once requested
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleGetAddress() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await payUnlockFee(accessToken, fee.id, network);
      setPayment(res);
      const url = await QRCode.toDataURL(res.deposit_address, { margin: 1, width: 200 });
      setQrDataUrl(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function copyAddress() {
    if (!payment) return;
    navigator.clipboard.writeText(payment.deposit_address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      style={{
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-8)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-5)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "13px", color: "var(--ink-base)" }}>
            {fee.name}
          </span>
          <span className="qx-num" style={{ fontFamily: "var(--font-data)", fontSize: "12px", color: "var(--ink-soft)" }}>
            {fee.amount} {fee.asset}
          </span>
        </div>
        {!expanded && !payment && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            style={{
              background: "var(--teal-base)",
              color: "var(--on-accent)",
              border: "none",
              borderRadius: "var(--radius-md)",
              padding: "9px 14px",
              fontFamily: "var(--font-body)",
              fontWeight: 600,
              fontSize: "12.5px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {t("withdraw.unlockFees.payNow")}
          </button>
        )}
      </div>

      {expanded && !payment && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <SelectField
            label={t("withdraw.unlockFees.networkLabel")}
            options={ASSET_NETWORKS[fee.asset] || []}
            value={network}
            onChange={setNetwork}
            renderIcon={(n) => <NetworkGlyph network={n} size={20} />}
          />

          {error && <ErrorText message={error} />}

          <PrimaryButton submitting={submitting} type="button" onClick={handleGetAddress}>
            {submitting ? t("withdraw.unlockFees.gettingAddress") : t("withdraw.unlockFees.getAddress")}
          </PrimaryButton>
        </div>
      )}

      {payment && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-6)" }}>
          <span style={{ fontFamily: "var(--font-body)", fontSize: "11.5px", color: "var(--teal-deep)", fontWeight: 600, textAlign: "center" }}>
            {t("withdraw.unlockFees.sendExactly", { amount: fee.amount, asset: fee.asset, network: payment.network })}
          </span>

          {qrDataUrl && (
            <img src={qrDataUrl} alt="Payment address QR code" width={160} height={160} style={{ borderRadius: "var(--radius-sm)" }} />
          )}

          <span style={{ fontFamily: "var(--font-data)", fontSize: "11.5px", color: "var(--ink-base)", wordBreak: "break-all", textAlign: "center" }}>
            {payment.deposit_address}
          </span>

          <button
            type="button"
            onClick={copyAddress}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-4)",
              background: "var(--teal-base)",
              color: "var(--on-accent)",
              border: "none",
              borderRadius: "var(--radius-md)",
              padding: "9px 14px",
              fontFamily: "var(--font-body)",
              fontWeight: 600,
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            <Icon name={copied ? "checkCircle" : "copy"} size={13} color="var(--on-accent)" />
            {copied ? t("deposit.copied") : t("deposit.copy")}
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)" }}>
            <AnimatedPsi mode="working" size={18} color="var(--teal-base)" />
            <span style={{ fontFamily: "var(--font-body)", fontSize: "11px", color: "var(--ink-soft)" }}>
              {t("withdraw.unlockFees.waiting")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function WithdrawForm({ accessToken, balances, onRequested, t }) {
  const [asset, setAsset] = useState(null);
  const [network, setNetwork] = useState(null);
  const [destinationAddress, setDestinationAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // null while loading — the fee preview below stays hidden until this
  // resolves rather than flashing a wrong number first. Fetched fresh every
  // time this form mounts (never cached client-side), same reasoning
  // withdrawal_fee_service.py itself never caches this on the backend: it's
  // exactly the kind of value an admin can change live.
  const [fee, setFee] = useState(null);

  useEffect(() => {
    if (!accessToken) return;
    getWithdrawalFeePreview(accessToken).then((res) => setFee(Number(res.fee_amount)));
  }, [accessToken]);

  // Default to the first asset the user actually holds a balance in, and
  // its first eligible network, as soon as balances load — saves a user
  // with only one asset from having to click anything just to pick it.
  useEffect(() => {
    if (balances && balances.length > 0 && !asset) {
      setAsset(balances[0].asset);
    }
  }, [balances, asset]);

  useEffect(() => {
    if (asset) setNetwork(ASSET_NETWORKS[asset]?.[0] || null);
  }, [asset]);

  if (balances === null) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-16) 0" }}>
        <AnimatedPsi mode="working" size={28} color="var(--teal-base)" />
      </div>
    );
  }

  if (balances.length === 0) {
    return (
      <div
        style={{
          background: "var(--cream-deep)",
          border: "1px solid var(--cream-line)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-8)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-5)",
        }}
      >
        <span style={{ fontFamily: "var(--font-body)", fontSize: "12.5px", color: "var(--ink-soft)" }}>
          {t("withdraw.noBalance")}
        </span>
        <Link to="/deposit" style={{ textDecoration: "none" }}>
          <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12.5px", color: "var(--teal-base)" }}>
            {t("withdraw.depositLink")} →
          </span>
        </Link>
      </div>
    );
  }

  const availableEntry = balances.find((b) => b.asset === asset);
  const available = availableEntry ? Number(availableEntry.amount) : 0;
  const amountNumber = Number(amount) || 0;
  const netAmount = fee === null ? 0 : Math.max(amountNumber - fee, 0);

  // Whether the currently-picked asset actually has a withdrawal network at
  // all — false for BTC/ETH/SOL, which only exist as TradePage.jsx trading
  // pairs against USDT (see trading_service.py's SUPPORTED_PAIRS) with no
  // real wallet/custody/sweep infrastructure behind them, unlike ASSET_
  // NETWORKS' entries. Drives the placeholder branch below instead of
  // rendering a network SelectField with zero options in it.
  const isWithdrawable = Boolean(asset && ASSET_NETWORKS[asset]?.length);

  // The largest amount (in the same units as the amount FIELD, i.e. gross —
  // before the flat fee is taken out) that still leaves at least
  // BALANCE_FLOOR behind, matching withdrawal_service.py's own
  // BALANCE_FLOOR_AFTER_WITHDRAWAL check (`available - amount >= floor`,
  // where the full `amount` — not just net_amount — is what actually gets
  // debited once the fee's own separate ledger entry is added in). Clamped
  // to 0 rather than going negative when the user's whole balance is
  // already at or under the floor — see the Max button's `disabled` below.
  // .toFixed(6) matches USDT's on-chain decimals (network_assets.NETWORK_
  // CONFIG's TRC20 entry) — change this if a future withdrawable asset uses
  // a different decimal count.
  const maxAmount = Math.max(available - BALANCE_FLOOR, 0);

  function handleMax() {
    setAmount(maxAmount.toFixed(6));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await requestWithdrawal(accessToken, { asset, network, destinationAddress, amount });
      onRequested(result, { asset, network, destinationAddress, amount });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      <SelectField
        label={t("withdraw.assetLabel")}
        options={balances.map((b) => b.asset)}
        value={asset}
        onChange={setAsset}
        renderIcon={(a) => <CoinGlyph asset={a} size={20} />}
      />

      {asset && !isWithdrawable ? (
        <NotWithdrawableNotice asset={asset} t={t} />
      ) : (
        <>
          <SelectField
            label={t("withdraw.networkLabel")}
            options={asset ? ASSET_NETWORKS[asset] || [] : []}
            value={network}
            onChange={setNetwork}
            renderIcon={(n) => <NetworkGlyph network={n} size={20} />}
          />

          <Field
            label={t("withdraw.addressLabel")}
            type="text"
            value={destinationAddress}
            onChange={setDestinationAddress}
            autoComplete="off"
          />

          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "11px", color: "var(--ink-soft)" }}>
              {t("withdraw.amountLabel")}
            </span>
            <div style={{ display: "flex", gap: "var(--space-4)" }}>
              <input
                type="number"
                min="0"
                step="any"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "var(--cream-deep)",
                  border: "1px solid var(--cream-line)",
                  borderRadius: "var(--radius-md)",
                  padding: "13px 14px",
                  fontFamily: "var(--font-data)",
                  fontSize: "13px",
                  color: "var(--ink-base)",
                  outline: "none",
                }}
              />
              <button
                type="button"
                onClick={handleMax}
                disabled={maxAmount <= 0}
                style={{
                  background: "var(--cream-deep)",
                  border: "1px solid var(--cream-line)",
                  borderRadius: "var(--radius-md)",
                  padding: "0 14px",
                  fontFamily: "var(--font-body)",
                  fontWeight: 600,
                  fontSize: "12px",
                  color: maxAmount <= 0 ? "var(--ink-soft)" : "var(--teal-base)",
                  cursor: maxAmount <= 0 ? "default" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {t("withdraw.max")}
              </button>
            </div>
            {asset && (
              <span style={{ fontFamily: "var(--font-body)", fontSize: "10.5px", color: "var(--ink-soft)" }}>
                {t("withdraw.availableLabel", { amount: available, asset })}
              </span>
            )}
          </label>

          {asset && (
            <div
              style={{
                background: "var(--teal-pale)",
                border: "1px solid var(--teal-base)",
                borderRadius: "var(--radius-lg)",
                padding: "var(--space-6)",
              }}
            >
              <span style={{ fontFamily: "var(--font-body)", fontSize: "10.5px", color: "var(--teal-deep)", lineHeight: 1.5 }}>
                {t("withdraw.minNotice", { min: MIN_WITHDRAWAL_AMOUNT, floor: BALANCE_FLOOR, asset })}
              </span>
            </div>
          )}

          {asset && amountNumber > 0 && fee !== null && (
            <FeeBreakdown amount={amountNumber} fee={fee} net={netAmount} asset={asset} t={t} />
          )}

          {error && <ErrorText message={error} />}

          <PrimaryButton submitting={submitting}>
            {submitting ? t("withdraw.submitting") : t("withdraw.submit")}
          </PrimaryButton>
        </>
      )}
    </form>
  );
}

// Shown instead of the network/address/amount form when the picked asset
// has no withdrawal network at all (BTC/ETH/SOL today — see isWithdrawable's
// own comment above in WithdrawForm). Kept as a plain notice rather than
// hiding these assets from the picker entirely: they're real, spendable
// balances (from TradePage.jsx), so a user should be able to select one and
// immediately understand why they can't withdraw it from here, rather than
// wondering why it's missing.
function NotWithdrawableNotice({ asset, t }) {
  return (
    <div
      style={{
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-8)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-5)",
      }}
    >
      <span style={{ fontFamily: "var(--font-body)", fontSize: "12.5px", color: "var(--ink-base)", lineHeight: 1.5 }}>
        {t("withdraw.notWithdrawableBody", { asset })}
      </span>
      <Link to="/trade" style={{ textDecoration: "none" }}>
        <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12.5px", color: "var(--teal-base)" }}>
          {t("withdraw.tradeLink")} →
        </span>
      </Link>
    </div>
  );
}

function FeeBreakdown({ amount, fee, net, asset, t }) {
  const rowStyle = { display: "flex", justifyContent: "space-between" };
  const labelStyle = { fontFamily: "var(--font-body)", fontSize: "11.5px", color: "var(--ink-soft)" };
  const valueStyle = { fontFamily: "var(--font-data)", fontSize: "12px", color: "var(--ink-base)" };
  return (
    <div
      style={{
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-7)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}
    >
      <div style={rowStyle}>
        <span style={labelStyle}>{t("withdraw.feeAmount")}</span>
        <span style={valueStyle}>{amount} {asset}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>{t("withdraw.feeFee")}</span>
        <span style={valueStyle}>{fee} {asset}</span>
      </div>
      <div style={{ ...rowStyle, borderTop: "1px solid var(--cream-line)", paddingTop: "var(--space-4)" }}>
        <span style={{ ...labelStyle, fontWeight: 600, color: "var(--ink-base)" }}>{t("withdraw.feeReceive")}</span>
        <span style={{ ...valueStyle, fontWeight: 600 }}>{net} {asset}</span>
      </div>
    </div>
  );
}

function OtpStep({ accessToken, pendingRequest, onConfirmed, onCancel, t }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  // Separate from `confirming` so clicking Resend never disables/relabels
  // the Confirm button (and vice versa) — the two buttons hit different
  // endpoints and can fail independently. `resent` just flashes a brief
  // "check your email" confirmation; it isn't reset back to false anywhere
  // because the whole OtpStep unmounts (onConfirmed/onCancel) the moment
  // the user leaves this screen, so there's no stale state to worry about.
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  async function handleConfirm(e) {
    e.preventDefault();
    setError(null);
    setConfirming(true);
    try {
      await confirmWithdrawal(accessToken, pendingRequest.request_id, code);
      onConfirmed();
    } catch (err) {
      setError(err.message);
    } finally {
      setConfirming(false);
    }
  }

  async function handleResend() {
    // Backend enforces its own 60s cooldown (otp_service.OTP_RESEND_
    // COOLDOWN_SECONDS) and rejects a too-soon click with a 429 whose
    // message ("Please wait before requesting another code") lands in
    // `error` exactly like any other failure — no separate client-side
    // timer to keep in sync with that value.
    setError(null);
    setResent(false);
    setResending(true);
    try {
      await resendWithdrawalCode(accessToken, pendingRequest.request_id);
      setResent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setResending(false);
    }
  }

  return (
    <form onSubmit={handleConfirm} style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      <div
        style={{
          background: "var(--cream-deep)",
          border: "1px solid var(--cream-line)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-8)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
        }}
      >
        <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "13px", color: "var(--ink-base)" }}>
          {t("withdraw.otpTitle")}
        </span>
        <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)" }}>
          {t("withdraw.otpBody")}
        </span>
      </div>

      <FeeBreakdown
        amount={Number(pendingRequest.amount)}
        fee={Number(pendingRequest.fee_amount)}
        net={Number(pendingRequest.net_amount)}
        asset={pendingRequest.asset}
        t={t}
      />

      <Field label={t("withdraw.otpCodeLabel")} type="text" value={code} onChange={setCode} autoComplete="one-time-code" />

      {error && <ErrorText message={error} />}
      {resent && !error && (
        <span style={{ fontFamily: "var(--font-body)", fontSize: "11.5px", color: "var(--teal-base)" }}>
          {t("withdraw.otpResent")}
        </span>
      )}

      <PrimaryButton submitting={confirming}>
        {confirming ? t("withdraw.otpConfirming") : t("withdraw.otpConfirm")}
      </PrimaryButton>

      <button
        type="button"
        onClick={handleResend}
        disabled={resending}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          fontFamily: "var(--font-body)",
          fontWeight: 600,
          fontSize: "12px",
          color: "var(--teal-base)",
          cursor: resending ? "default" : "pointer",
          textAlign: "left",
        }}
      >
        {resending ? t("withdraw.otpResending") : t("withdraw.otpResend")}
      </button>

      <button
        type="button"
        onClick={onCancel}
        style={{ background: "none", border: "none", fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)", cursor: "pointer" }}
      >
        {t("withdraw.otpCancel")}
      </button>
    </form>
  );
}

function SuccessCard({ onStartOver, t }) {
  return (
    <div
      style={{
        background: "var(--teal-pale)",
        border: "1.5px solid var(--teal-base)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-8)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-5)",
      }}
    >
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "13px", color: "var(--teal-deep)" }}>
        {t("withdraw.successTitle")}
      </span>
      <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-base)" }}>
        {t("withdraw.successBody")}
      </span>
      <button
        type="button"
        onClick={onStartOver}
        style={{ background: "none", border: "none", fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12.5px", color: "var(--teal-base)", cursor: "pointer", textAlign: "left", padding: 0 }}
      >
        {t("withdraw.newRequest")}
      </button>
    </div>
  );
}

function MyRequestsList({ withdrawals, t }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "14px", color: "var(--ink-base)" }}>
        {t("withdraw.myRequestsTitle")}
      </span>

      {withdrawals === null ? (
        <AnimatedPsi mode="working" size={22} color="var(--teal-base)" />
      ) : withdrawals.length === 0 ? (
        <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)" }}>
          {t("withdraw.noRequests")}
        </span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          {withdrawals.map((w) => (
            <div
              key={w.id}
              style={{
                background: "var(--cream-deep)",
                border: "1px solid var(--cream-line)",
                borderRadius: "var(--radius-lg)",
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12.5px", color: "var(--ink-base)" }}>
                  {w.amount} {w.asset} · {w.network}
                </span>
                <span style={{ fontFamily: "var(--font-data)", fontSize: "9.5px", color: "var(--ink-soft)" }}>
                  {new Date(w.created_at).toLocaleString()}
                </span>
              </div>
              <span
                style={{
                  background: "var(--cream-base)",
                  color: STATUS_COLOR[w.status] || "var(--ink-soft)",
                  borderRadius: "var(--radius-sm)",
                  padding: "2px 7px",
                  fontFamily: "var(--font-data)",
                  fontWeight: 600,
                  fontSize: "8.5px",
                }}
              >
                {t(`withdraw.status${w.status.charAt(0)}${w.status.slice(1).toLowerCase()}`).toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
