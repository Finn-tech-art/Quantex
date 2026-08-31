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
import { useAuth } from "../context/AuthContext";
import AnimatedPsi from "../components/AnimatedPsi";
import CoinGlyph from "../components/CoinGlyph";
import NetworkGlyph from "../components/NetworkGlyph";
import SelectField from "../components/SelectField";
import { Field, ErrorText, PrimaryButton } from "../components/FormControls";
import { confirmWithdrawal, getBalances, getMyWithdrawals, getWithdrawalFeePreview, requestWithdrawal } from "../lib/api";

// Which network(s) each asset can be withdrawn over — kept in sync BY HAND
// with withdrawal_service.ASSET_NETWORKS on the backend (itself derived
// from network_assets.NETWORK_CONFIG: TRC20->USDT, BASE->USDC,
// POLYGON->USDC). If the backend ever adds a new asset/network pairing,
// mirror it here too or this screen simply won't offer the new network as
// an option — the backend's own validation is what actually enforces this,
// this is only what gets shown as a choice.
const ASSET_NETWORKS = {
  USDT: ["TRC20"],
  USDC: ["BASE", "POLYGON"],
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

  function refreshBalances() {
    if (!accessToken) return;
    getBalances(accessToken).then((res) => setBalances(res.balances));
  }

  function refreshWithdrawals() {
    if (!accessToken) return;
    getMyWithdrawals(accessToken).then((res) => setMyWithdrawals(res.withdrawals));
  }

  useEffect(refreshBalances, [accessToken]);
  useEffect(refreshWithdrawals, [accessToken]);

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
        <input
          type="number"
          min="0"
          step="any"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{
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
    </form>
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

      <PrimaryButton submitting={confirming}>
        {confirming ? t("withdraw.otpConfirming") : t("withdraw.otpConfirm")}
      </PrimaryButton>

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
