// Admin management screen for withdrawal unlock fees — a named,
// admin-managed fee EVERY user must pay once (as a real, separate on-chain
// payment) before ANY of their withdrawals can be requested. See
// backend/app/services/withdrawal_unlock_fee_service.py's module comment
// for the full design; this page is purely CRUD over the library of fee
// types (create one, toggle it active/inactive) — it has no visibility
// into who has or hasn't paid a given one yet, which wasn't asked for.
//
// Distinct from AdminWithdrawalFeePage.jsx (the single flat fee
// auto-deducted from every withdrawal's amount) — that one edits a single
// value in place; this one manages a growing LIST of named fees, so it's
// shaped as a list + a create form rather than one number field.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminAuth } from "../context/AdminAuthContext";
import AdminNav from "../components/AdminNav";
import AnimatedPsi from "../components/AnimatedPsi";
import { Field, SelectField, ErrorText, PrimaryButton } from "../components/FormControls";
import { getUnlockFeeTypes, createUnlockFeeType, setUnlockFeeTypeActive } from "../lib/api";

// Kept in sync BY HAND with network_assets.NETWORK_CONFIG's asset codes on
// the backend — same convention WithdrawPage.jsx's own ASSET_NETWORKS
// comment already documents for why this isn't fetched from an API (there's
// no assets-listing endpoint, and this list changes about as often as the
// backend's own supported-network config does).
const ASSET_OPTIONS = [
  { value: "USDT", label: "USDT" },
  { value: "USDC", label: "USDC" },
];

export default function AdminUnlockFeesPage() {
  const { t } = useTranslation();
  const { admin, adminToken, logout } = useAdminAuth();

  const [feeTypes, setFeeTypes] = useState(null); // null = still loading
  const [name, setName] = useState("");
  const [asset, setAsset] = useState("USDT");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

  function refresh() {
    if (!adminToken) return;
    getUnlockFeeTypes(adminToken).then((res) => setFeeTypes(res.fee_types));
  }

  useEffect(refresh, [adminToken]);

  async function handleCreate(e) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await createUnlockFeeType(adminToken, { name, asset, amount });
      setName("");
      setAmount("");
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(feeType) {
    setTogglingId(feeType.id);
    try {
      await setUnlockFeeTypeActive(adminToken, feeType.id, !feeType.is_active);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setTogglingId(null);
    }
  }

  if (feeTypes === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <AnimatedPsi mode="working" size={30} color="var(--teal-base)" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen justify-center px-5 py-8">
      <div className="w-full max-w-sm" style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "17px", color: "var(--ink-base)" }}>
            {t("admin.unlockFees.title")}
          </span>
          <button
            type="button"
            onClick={logout}
            style={{ background: "none", border: "none", fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)", cursor: "pointer" }}
          >
            {t("admin.unlockFees.logout")}
          </button>
        </div>

        {admin && (
          <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", color: "var(--ink-soft)" }}>{admin.email}</span>
        )}

        <AdminNav />

        <p style={{ fontFamily: "var(--font-body)", fontSize: "11.5px", color: "var(--ink-soft)", lineHeight: 1.5, margin: 0 }}>
          {t("admin.unlockFees.intro")}
        </p>

        <FeeTypesList feeTypes={feeTypes} onToggle={handleToggle} togglingId={togglingId} t={t} />

        <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12.5px", color: "var(--ink-base)" }}>
            {t("admin.unlockFees.createTitle")}
          </span>
          <Field label={t("admin.unlockFees.nameLabel")} type="text" value={name} onChange={setName} autoComplete="off" />
          <SelectField label={t("admin.unlockFees.assetLabel")} value={asset} onChange={setAsset} options={ASSET_OPTIONS} />
          <AmountField label={t("admin.unlockFees.amountLabel")} value={amount} onChange={setAmount} />

          {error && <ErrorText message={error} />}

          <PrimaryButton submitting={creating}>
            {creating ? t("admin.unlockFees.creating") : t("admin.unlockFees.create")}
          </PrimaryButton>
        </form>
      </div>
    </div>
  );
}

function FeeTypesList({ feeTypes, onToggle, togglingId, t }) {
  if (feeTypes.length === 0) {
    return (
      <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)" }}>
        {t("admin.unlockFees.empty")}
      </span>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
      {feeTypes.map((f) => (
        <div
          key={f.id}
          style={{
            background: "var(--cream-deep)",
            border: "1px solid var(--cream-line)",
            borderRadius: "var(--radius-lg)",
            padding: "var(--space-7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-5)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "13px", color: "var(--ink-base)" }}>
              {f.name}
            </span>
            <span className="qx-num" style={{ fontFamily: "var(--font-data)", fontSize: "12px", color: "var(--ink-soft)" }}>
              {f.amount} {f.asset}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onToggle(f)}
            disabled={togglingId === f.id}
            style={{
              fontFamily: "var(--font-body)",
              fontWeight: 600,
              fontSize: "11px",
              padding: "7px 12px",
              borderRadius: "var(--radius-md)",
              border: `1px solid ${f.is_active ? "var(--teal-base)" : "var(--cream-line)"}`,
              background: f.is_active ? "var(--teal-base)" : "var(--cream-base)",
              color: f.is_active ? "var(--on-accent)" : "var(--ink-soft)",
              cursor: togglingId === f.id ? "default" : "pointer",
              opacity: togglingId === f.id ? 0.7 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {f.is_active ? t("admin.unlockFees.active") : t("admin.unlockFees.inactive")}
          </button>
        </div>
      ))}
    </div>
  );
}

// A plain decimal <input>, same shape as AdminWinRatePage.jsx's own
// NumberField — kept local here rather than shared since the two pages'
// step/min conventions differ slightly (fees are whole-dollar-ish amounts,
// win rate is a 0-1 fraction) and neither is reused a third place yet.
function AmountField({ label, value, onChange }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "11px", color: "var(--ink-soft)" }}>
        {label}
      </span>
      <input
        type="number"
        step="0.01"
        min="0"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "var(--cream-deep)",
          border: "1px solid var(--cream-line)",
          borderRadius: "var(--radius-md)",
          padding: "13px 14px",
          fontFamily: "var(--font-body)",
          fontSize: "13px",
          color: "var(--ink-base)",
          outline: "none",
        }}
      />
    </label>
  );
}
