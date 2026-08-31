// KYC submission screen (Phase 4, module 1) — upload ID front/back + a
// selfie, see the current review status, and resubmit if a previous
// submission was rejected. Backend: routers/kyc.py (GET /kyc/status,
// POST /kyc/submit) — see that file and kyc_service.py for the full
// validation rules (5MB max per file, JPEG/PNG/PDF only) this form mirrors
// on the client side just for a faster error than waiting on the network
// round trip; the backend re-checks everything regardless, since a client
// check is only ever a UX nicety, never something to trust for real.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AnimatedPsi from "../components/AnimatedPsi";
import { ErrorText, PrimaryButton } from "../components/FormControls";
import KycPhotoGuide from "../components/KycPhotoGuide";
import { getKycStatus, submitKyc } from "../lib/api";

// Kept in sync with kyc_service.py's own constants by hand (there's no
// shared /shared import wired up between frontend and backend yet for
// plain constants like this) — if either limit ever changes on the
// backend, update both ALLOWED_TYPES/MAX_BYTES here to match, or this
// form's client-side check and the server's real check will disagree.
const ALLOWED_TYPES = "image/jpeg,image/png,application/pdf";
const MAX_BYTES = 5 * 1024 * 1024;

const STATUS_DOT_COLOR = {
  APPROVED: "var(--gain)",
  PENDING: "var(--pending-dot)",
  UNDER_REVIEW: "var(--pending-dot)",
  REJECTED: "var(--loss)",
  UNSUBMITTED: "var(--ink-soft)",
};

export default function KycPage() {
  const { t } = useTranslation();
  const { accessToken, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState(null); // null while loading

  function refresh() {
    if (!accessToken) return;
    getKycStatus(accessToken).then(setStatus);
  }

  useEffect(refresh, [accessToken]);

  async function handleSubmitted() {
    // The KYC status shown elsewhere in the app (WalletPage's KycStrip)
    // reads user.kyc_status straight off AuthContext, not a fresh fetch —
    // refreshUser() re-pulls /auth/me so that badge updates immediately too,
    // not just this page's own local `status` state.
    await refreshUser();
    refresh();
  }

  return (
    <div className="flex min-h-screen justify-center px-5 py-8">
      <div className="w-full max-w-sm" style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <TopNav t={t} />

        {status === null ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-16) 0" }}>
            <AnimatedPsi mode="working" size={28} color="var(--teal-base)" />
          </div>
        ) : (
          <>
            <StatusCard status={status} t={t} />
            {status.status === "APPROVED" && (
              // Without this, an approved user has no way forward off this
              // screen except the small back arrow in TopNav — easy to read
              // as a dead end, especially for whoever landed here by
              // clicking Withdraw before KYC caught up (see WalletPage's
              // Withdraw pill / WithdrawPage's own KYC gate). This is the
              // one obvious next action once verification is done.
              <PrimaryButton type="button" onClick={() => navigate("/withdraw")}>
                {t("kyc.continueToWithdraw")}
              </PrimaryButton>
            )}
            {(status.status === "UNSUBMITTED" || status.status === "REJECTED") && (
              <UploadForm accessToken={accessToken} onSubmitted={handleSubmitted} t={t} />
            )}
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
        {t("kyc.title")}
      </span>
    </div>
  );
}

function StatusCard({ status, t }) {
  const dotColor = STATUS_DOT_COLOR[status.status] || "var(--ink-soft)";
  const label = {
    UNSUBMITTED: t("kyc.statusUnsubmitted"),
    PENDING: t("kyc.statusPending"),
    UNDER_REVIEW: t("kyc.statusUnderReview"),
    APPROVED: t("kyc.statusApproved"),
    REJECTED: t("kyc.statusRejected"),
  }[status.status];

  return (
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
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-5)" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, display: "inline-block" }} />
        <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "13px", color: "var(--ink-base)" }}>
          {label}
        </span>
      </div>

      {status.status === "UNSUBMITTED" && (
        <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)", lineHeight: 1.5 }}>
          {t("kyc.intro")}
        </span>
      )}

      {(status.status === "PENDING" || status.status === "UNDER_REVIEW") && (
        <>
          <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)" }}>
            {t("kyc.pendingBody")}
          </span>
          {status.submitted_at && (
            <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", color: "var(--ink-soft)" }}>
              {t("kyc.submittedAt", { date: new Date(status.submitted_at).toLocaleString() })}
            </span>
          )}
        </>
      )}

      {status.status === "APPROVED" && (
        <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--gain)" }}>
          {t("kyc.approvedBody")}
        </span>
      )}

      {status.status === "REJECTED" && (
        <>
          <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--loss)" }}>
            {t("kyc.rejectedBody")} {status.rejection_reason}
          </span>
          <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)" }}>
            {t("kyc.rejectedRetry")}
          </span>
        </>
      )}
    </div>
  );
}

function UploadForm({ accessToken, onSubmitted, t }) {
  const [idFront, setIdFront] = useState(null);
  const [idBack, setIdBack] = useState(null);
  const [selfie, setSelfie] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // A file the browser itself already rejected via the `accept` attribute
  // can still slip through on some platforms (accept is a hint, not a hard
  // filter), and there's no client-side check for size until now — this is
  // deliberately checked at select-time (not just at submit-time) so a user
  // finds out about an oversized/wrong-type file immediately, not after
  // filling in the other two fields too.
  function validateAndSet(file, setter, fieldLabel) {
    setError(null);
    if (!file) {
      setter(null);
      return;
    }
    if (!ALLOWED_TYPES.split(",").includes(file.type)) {
      setError(`${fieldLabel}: only JPEG, PNG, or PDF files are accepted`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`${fieldLabel}: file is too large — 5MB maximum`);
      return;
    }
    setter(file);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!idFront || !idBack || !selfie) {
      setError("All three files are required.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await submitKyc(accessToken, { idFront, idBack, selfie });
      onSubmitted();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      {/* One guide card covers BOTH id-front and id-back — the "lay it
          flat, all 4 corners visible, no glare" rules are identical for
          either side of the document, so there's no reason to repeat the
          same card twice back to back. */}
      <KycPhotoGuide variant="document" t={t} />
      <FileField
        label={t("kyc.idFrontLabel")}
        file={idFront}
        onChange={(f) => validateAndSet(f, setIdFront, t("kyc.idFrontLabel"))}
        t={t}
      />
      <FileField
        label={t("kyc.idBackLabel")}
        file={idBack}
        onChange={(f) => validateAndSet(f, setIdBack, t("kyc.idBackLabel"))}
        t={t}
      />
      <KycPhotoGuide variant="selfie" t={t} />
      <FileField
        label={t("kyc.selfieLabel")}
        file={selfie}
        onChange={(f) => validateAndSet(f, setSelfie, t("kyc.selfieLabel"))}
        t={t}
      />

      {error && <ErrorText message={error} />}

      <PrimaryButton submitting={submitting}>
        {submitting ? t("kyc.submitting") : t("kyc.submit")}
      </PrimaryButton>
    </form>
  );
}

function FileField({ label, file, onChange, t }) {
  // A native file input can't be restyled directly (every browser renders
  // its button chrome differently), so this hides the real <input> and
  // drives it via a styled label instead — a standard, low-risk pattern:
  // clicking the label activates the input it's `htmlFor`-linked to.
  const inputId = `kyc-file-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "11px", color: "var(--ink-soft)" }}>
        {label}
      </span>
      <input
        id={inputId}
        type="file"
        accept={ALLOWED_TYPES}
        onChange={(e) => onChange(e.target.files?.[0] || null)}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
      />
      <label
        htmlFor={inputId}
        style={{
          background: "var(--cream-deep)",
          border: `1px solid ${file ? "var(--teal-base)" : "var(--cream-line)"}`,
          borderRadius: "var(--radius-md)",
          padding: "13px 14px",
          fontFamily: "var(--font-body)",
          fontSize: "12.5px",
          color: file ? "var(--ink-base)" : "var(--ink-soft)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>{file ? file.name : t("kyc.chooseFile")}</span>
        {file && (
          <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", color: "var(--gain)" }}>✓</span>
        )}
      </label>
      <span style={{ fontFamily: "var(--font-body)", fontSize: "10.5px", color: "var(--ink-soft)" }}>
        {t("kyc.fileHint")}
      </span>
    </div>
  );
}
