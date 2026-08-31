// Admin withdrawal approval queue (Phase 4, module 2) — mirrors
// AdminKycQueuePage.jsx's master-detail shape exactly: a list of PENDING
// withdrawals, and clicking one loads its full detail (approve/reject) in
// place of the list. Backend: GET /admin/withdrawals (queue), GET
// /admin/withdrawals/{id} (detail), POST .../approve, POST .../reject — see
// routers/admin.py's withdrawals section and withdrawal_service.py.
//
// IMPORTANT for whoever's clicking Approve: there is no on-chain broadcast
// worker yet (see withdrawal_service.py's module comment). Approve debits
// the user's ledger balance immediately and that's the end of the line —
// tx_hash stays empty forever on this row. The ApproveNotice banner below
// says this on-screen too, so it isn't a surprise mid-review.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminAuth } from "../context/AdminAuthContext";
import AdminNav from "../components/AdminNav";
import AnimatedPsi from "../components/AnimatedPsi";
import { ErrorText, PrimaryButton } from "../components/FormControls";
import { approveWithdrawal, getWithdrawalDetail, getWithdrawalQueue, rejectWithdrawal } from "../lib/api";

export default function AdminWithdrawalsQueuePage() {
  const { t } = useTranslation();
  const { admin, adminToken, logout } = useAdminAuth();

  const [queue, setQueue] = useState(null); // null = still loading
  const [selectedId, setSelectedId] = useState(null);

  function refreshQueue() {
    if (!adminToken) return;
    getWithdrawalQueue(adminToken).then((res) => setQueue(res.withdrawals));
  }

  useEffect(refreshQueue, [adminToken]);

  function handleDecided() {
    // A decided withdrawal is no longer PENDING, so it drops out of the
    // queue on its own — re-fetching rather than filtering locally keeps
    // this in sync with anything else that might have changed the queue.
    setSelectedId(null);
    refreshQueue();
  }

  return (
    <div className="flex min-h-screen justify-center px-5 py-8">
      <div className="w-full max-w-sm" style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "17px", color: "var(--ink-base)" }}>
            {t("admin.withdrawals.title")}
          </span>
          <button
            type="button"
            onClick={logout}
            style={{ background: "none", border: "none", fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)", cursor: "pointer" }}
          >
            {t("admin.withdrawals.logout")}
          </button>
        </div>

        {admin && (
          <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", color: "var(--ink-soft)" }}>{admin.email}</span>
        )}

        <AdminNav />

        {selectedId ? (
          <WithdrawalDetail
            withdrawalId={selectedId}
            adminToken={adminToken}
            onBack={() => setSelectedId(null)}
            onDecided={handleDecided}
            t={t}
          />
        ) : (
          <Queue queue={queue} onSelect={setSelectedId} t={t} />
        )}
      </div>
    </div>
  );
}

function Queue({ queue, onSelect, t }) {
  if (queue === null) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-16) 0" }}>
        <AnimatedPsi mode="working" size={28} color="var(--teal-base)" />
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div
        style={{
          background: "var(--cream-deep)",
          border: "1px solid var(--cream-line)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-8)",
        }}
      >
        <span style={{ fontFamily: "var(--font-body)", fontSize: "12.5px", color: "var(--ink-soft)" }}>
          {t("admin.withdrawals.empty")}
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {queue.map((w) => (
        <button
          key={w.id}
          type="button"
          onClick={() => onSelect(w.id)}
          style={{
            background: "var(--cream-deep)",
            border: "1px solid var(--cream-line)",
            borderRadius: "var(--radius-lg)",
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12.5px", color: "var(--ink-base)" }}>
            {w.user_email}
          </span>
          <span style={{ fontFamily: "var(--font-data)", fontSize: "11px", color: "var(--ink-base)" }}>
            {w.amount} {w.asset} · {w.network}
          </span>
          <span style={{ fontFamily: "var(--font-data)", fontSize: "9.5px", color: "var(--ink-soft)" }}>
            {t("admin.withdrawals.requestedAt", { date: new Date(w.created_at).toLocaleString() })}
          </span>
        </button>
      ))}
    </div>
  );
}

function WithdrawalDetail({ withdrawalId, adminToken, onBack, onDecided, t }) {
  const [detail, setDetail] = useState(null); // null = still loading
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [deciding, setDeciding] = useState(null); // null | "approve" | "reject"

  useEffect(() => {
    getWithdrawalDetail(adminToken, withdrawalId).then(setDetail);
  }, [adminToken, withdrawalId]);

  async function handleApprove() {
    setError(null);
    setDeciding("approve");
    try {
      await approveWithdrawal(adminToken, withdrawalId);
      onDecided();
    } catch (err) {
      setError(err.message);
      setDeciding(null);
    }
  }

  async function handleReject() {
    if (!reason.trim()) {
      setError(t("admin.withdrawals.rejectReasonRequired"));
      return;
    }
    setError(null);
    setDeciding("reject");
    try {
      await rejectWithdrawal(adminToken, withdrawalId, reason.trim());
      onDecided();
    } catch (err) {
      setError(err.message);
      setDeciding(null);
    }
  }

  if (detail === null) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-16) 0" }}>
        <AnimatedPsi mode="working" size={28} color="var(--teal-base)" />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      <button
        type="button"
        onClick={onBack}
        style={{ background: "none", border: "none", fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--teal-base)", cursor: "pointer", textAlign: "left", padding: 0 }}
      >
        {t("admin.withdrawals.backToQueue")}
      </button>

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
          {detail.user_email}
        </span>
        <span style={{ fontFamily: "var(--font-data)", fontSize: "9.5px", color: "var(--ink-soft)" }}>
          {t("admin.withdrawals.requestedAt", { date: new Date(detail.created_at).toLocaleString() })}
        </span>

        <DetailRow label={t("admin.withdrawals.amountLabel")} value={`${detail.amount} ${detail.asset}`} />
        <DetailRow label={t("admin.withdrawals.feeLabel")} value={`${detail.fee_amount} ${detail.asset}`} />
        <DetailRow label={t("admin.withdrawals.networkLabel")} value={detail.network} />
        <DetailRow label={t("admin.withdrawals.addressLabel")} value={detail.destination_address} mono />
      </div>

      <div
        style={{
          background: "var(--teal-pale)",
          border: "1px solid var(--teal-base)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-6)",
        }}
      >
        <span style={{ fontFamily: "var(--font-body)", fontSize: "10.5px", color: "var(--teal-deep)", lineHeight: 1.5 }}>
          {t("admin.withdrawals.approveNotice")}
        </span>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "11px", color: "var(--ink-soft)" }}>
          {t("admin.withdrawals.rejectReasonLabel")}
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("admin.withdrawals.rejectReasonPlaceholder")}
          rows={3}
          style={{
            background: "var(--cream-deep)",
            border: "1px solid var(--cream-line)",
            borderRadius: "var(--radius-md)",
            padding: "13px 14px",
            fontFamily: "var(--font-body)",
            fontSize: "12.5px",
            color: "var(--ink-base)",
            outline: "none",
            resize: "vertical",
          }}
        />
      </label>

      {error && <ErrorText message={error} />}

      <div style={{ display: "flex", gap: "var(--space-4)" }}>
        <button
          type="button"
          onClick={handleReject}
          disabled={deciding !== null}
          style={{
            flex: 1,
            background: "var(--cream-deep)",
            border: "1px solid var(--loss)",
            borderRadius: "var(--radius-md)",
            padding: "13px 14px",
            fontFamily: "var(--font-body)",
            fontWeight: 600,
            fontSize: "12.5px",
            color: "var(--loss)",
            cursor: deciding !== null ? "default" : "pointer",
            opacity: deciding !== null && deciding !== "reject" ? 0.5 : 1,
          }}
        >
          {deciding === "reject" ? t("admin.withdrawals.rejecting") : t("admin.withdrawals.reject")}
        </button>
        <div style={{ flex: 1 }}>
          <PrimaryButton type="button" onClick={handleApprove} submitting={deciding !== null}>
            {deciding === "approve" ? t("admin.withdrawals.approving") : t("admin.withdrawals.approve")}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <span style={{ fontFamily: "var(--font-body)", fontSize: "10px", color: "var(--ink-soft)" }}>{label}</span>
      <span
        style={{
          fontFamily: mono ? "var(--font-data)" : "var(--font-body)",
          fontSize: mono ? "11px" : "12px",
          color: "var(--ink-base)",
          wordBreak: mono ? "break-all" : "normal",
        }}
      >
        {value}
      </span>
    </div>
  );
}
