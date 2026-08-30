// Admin KYC review queue (Phase 4, module 1) — mirrors AdminWinRatePage.jsx's
// overall shape (title/logout header, admin email, cards) but adds a simple
// master-detail flow: a list of PENDING submissions, and clicking one loads
// its full detail (signed document URLs + approve/reject) in place of the
// list. Backend: GET /admin/kyc (queue), GET /admin/kyc/{id} (detail with
// fresh signed URLs), POST /admin/kyc/{id}/approve, POST /admin/kyc/{id}/reject
// — see routers/admin.py's KYC section and kyc_service.py.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminAuth } from "../context/AdminAuthContext";
import AdminNav from "../components/AdminNav";
import AnimatedPsi from "../components/AnimatedPsi";
import { ErrorText, PrimaryButton } from "../components/FormControls";
import { approveKyc, getKycQueue, getKycSubmissionDetail, rejectKyc } from "../lib/api";

export default function AdminKycQueuePage() {
  const { t } = useTranslation();
  const { admin, adminToken, logout } = useAdminAuth();

  const [queue, setQueue] = useState(null); // null = still loading
  const [selectedId, setSelectedId] = useState(null);

  function refreshQueue() {
    if (!adminToken) return;
    getKycQueue(adminToken).then((res) => setQueue(res.submissions));
  }

  useEffect(refreshQueue, [adminToken]);

  function handleDecided() {
    // A decided submission is no longer PENDING, so it drops out of the
    // queue on its own — re-fetching (rather than locally filtering it out)
    // keeps this in sync with whatever else might have changed the queue
    // (e.g. another admin acting on a different submission concurrently).
    setSelectedId(null);
    refreshQueue();
  }

  return (
    <div className="flex min-h-screen justify-center px-5 py-8">
      <div className="w-full max-w-sm" style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "17px", color: "var(--ink-base)" }}>
            {t("admin.kyc.title")}
          </span>
          <button
            type="button"
            onClick={logout}
            style={{ background: "none", border: "none", fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)", cursor: "pointer" }}
          >
            {t("admin.winRate.logout")}
          </button>
        </div>

        {admin && (
          <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", color: "var(--ink-soft)" }}>{admin.email}</span>
        )}

        <AdminNav />

        {selectedId ? (
          <SubmissionDetail
            submissionId={selectedId}
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
          {t("admin.kyc.empty")}
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      {queue.map((sub) => (
        <button
          key={sub.id}
          type="button"
          onClick={() => onSelect(sub.id)}
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
            {sub.user_email}
          </span>
          <span style={{ fontFamily: "var(--font-data)", fontSize: "9.5px", color: "var(--ink-soft)" }}>
            {t("admin.kyc.submittedAt", { date: new Date(sub.submitted_at).toLocaleString() })}
          </span>
        </button>
      ))}
    </div>
  );
}

function SubmissionDetail({ submissionId, adminToken, onBack, onDecided, t }) {
  const [detail, setDetail] = useState(null); // null = still loading
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [deciding, setDeciding] = useState(null); // null | "approve" | "reject"

  useEffect(() => {
    getKycSubmissionDetail(adminToken, submissionId).then(setDetail);
  }, [adminToken, submissionId]);

  async function handleApprove() {
    setError(null);
    setDeciding("approve");
    try {
      await approveKyc(adminToken, submissionId);
      onDecided();
    } catch (err) {
      setError(err.message);
      setDeciding(null);
    }
  }

  async function handleReject() {
    if (!reason.trim()) {
      setError(t("admin.kyc.rejectReasonRequired"));
      return;
    }
    setError(null);
    setDeciding("reject");
    try {
      await rejectKyc(adminToken, submissionId, reason.trim());
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
        {t("admin.kyc.backToQueue")}
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
          {t("admin.kyc.submittedAt", { date: new Date(detail.submitted_at).toLocaleString() })}
        </span>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginTop: "var(--space-3)" }}>
          <DocLink href={detail.id_front_signed_url} label={t("admin.kyc.viewIdFront")} />
          <DocLink href={detail.id_back_signed_url} label={t("admin.kyc.viewIdBack")} />
          <DocLink href={detail.selfie_signed_url} label={t("admin.kyc.viewSelfie")} />
        </div>
        <span style={{ fontFamily: "var(--font-body)", fontSize: "10px", color: "var(--ink-soft)", fontStyle: "italic" }}>
          {t("admin.kyc.linkExpiryNotice")}
        </span>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "11px", color: "var(--ink-soft)" }}>
          {t("admin.kyc.rejectReasonLabel")}
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("admin.kyc.rejectReasonPlaceholder")}
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
          {deciding === "reject" ? t("admin.kyc.rejecting") : t("admin.kyc.reject")}
        </button>
        <div style={{ flex: 1 }}>
          <PrimaryButton type="button" onClick={handleApprove} submitting={deciding !== null}>
            {t("admin.kyc.approve")}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function DocLink({ href, label }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{
        fontFamily: "var(--font-body)",
        fontWeight: 500,
        fontSize: "12px",
        color: "var(--teal-base)",
        textDecoration: "none",
      }}
    >
      {label} →
    </a>
  );
}
