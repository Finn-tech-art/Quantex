// Admin view for the deposit consolidation sweep (Module 4/5) — shows every
// address currently holding a real, unswept on-chain balance, and a
// "Sweep now" button that queues consolidation for all of them. See
// backend/app/services/custody_service.py's list_pending_sweeps /
// trigger_sweep_now for why this always re-checks live on-chain state
// rather than trusting anything cached, and why clicking it more than once
// is safe (an already-in-flight sweep is skipped, never duplicated).
// Sweeping is asynchronous — this button queues Celery tasks and returns
// immediately, it does not wait for on-chain confirmation, so "Refresh"
// under history is how progress actually gets watched.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminAuth } from "../context/AdminAuthContext";
import AdminNav from "../components/AdminNav";
import AnimatedPsi from "../components/AnimatedPsi";
import { ErrorText, PrimaryButton } from "../components/FormControls";
import { generateOperationalWallet, getPendingSweeps, getSweepHistory, runSweepNow } from "../lib/api";

const STATUS_KEY = {
  PENDING: "statusPending",
  BROADCAST: "statusBroadcast",
  CONFIRMED: "statusConfirmed",
  FAILED: "statusFailed",
};

const STATUS_COLOR = {
  PENDING: "var(--ink-soft)",
  BROADCAST: "var(--warning-text)",
  CONFIRMED: "var(--gain)",
  FAILED: "var(--loss)",
};

export default function AdminSweepsPage() {
  const { t } = useTranslation();
  const { admin, adminToken, logout } = useAdminAuth();

  const [pending, setPending] = useState(null); // null = still loading
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [queuedCount, setQueuedCount] = useState(null);

  function refresh() {
    if (!adminToken) return;
    getPendingSweeps(adminToken).then((res) => setPending(res.pending));
    getSweepHistory(adminToken).then((res) => setHistory(res.sweeps));
  }

  useEffect(refresh, [adminToken]);

  async function handleRun() {
    setError(null);
    setQueuedCount(null);
    setRunning(true);
    try {
      const res = await runSweepNow(adminToken);
      setQueuedCount(res.queued.length);
      refresh(); // pending list should now be empty (or shorter) — reflect that immediately
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex min-h-screen justify-center px-5 py-8">
      <div className="w-full max-w-sm" style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "17px", color: "var(--ink-base)" }}>
            {t("admin.sweeps.title")}
          </span>
          <button
            type="button"
            onClick={logout}
            style={{ background: "none", border: "none", fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)", cursor: "pointer" }}
          >
            {t("admin.sweeps.logout")}
          </button>
        </div>

        {admin && (
          <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", color: "var(--ink-soft)" }}>{admin.email}</span>
        )}

        <AdminNav />

        <OperationalWalletsSection adminToken={adminToken} t={t} />

        <PendingSection pending={pending} t={t} />

        {pending !== null && pending.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <span style={{ fontFamily: "var(--font-body)", fontSize: "10.5px", color: "var(--ink-soft)", lineHeight: 1.5 }}>
              {t("admin.sweeps.runNotice")}
            </span>
            <PrimaryButton onClick={handleRun} submitting={running}>
              {running ? t("admin.sweeps.running") : t("admin.sweeps.runButton")}
            </PrimaryButton>
          </div>
        )}

        {error && <ErrorText message={error} />}
        {queuedCount !== null && !error && (
          <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--gain)" }}>
            {t("admin.sweeps.queuedNotice", { count: queuedCount })}
          </span>
        )}

        <HistorySection history={history} onRefresh={refresh} t={t} />
      </div>
    </div>
  );
}

const secondaryButtonStyle = {
  flex: 1,
  background: "none",
  border: "1px solid var(--cream-line)",
  borderRadius: "var(--radius-md)",
  padding: "11px 12px",
  fontFamily: "var(--font-body)",
  fontWeight: 600,
  fontSize: "11.5px",
  color: "var(--ink-base)",
  cursor: "pointer",
};

// A convenience keygen for the Tron gas wallet / EVM relayer wallet — see
// custody_service.generate_tron_keypair / generate_evm_keypair and their
// module-6 header comment. Deliberately does NOT wire the result into the
// running system: the private key is shown once, here, and the admin has
// to paste it into env vars and restart the backend themselves. This
// component's whole job is just making "generate a keypair" less annoying
// than opening a Python shell — nothing more.
function OperationalWalletsSection({ adminToken, t }) {
  const [generated, setGenerated] = useState(null); // { chain, address, private_key } | null
  const [generating, setGenerating] = useState(null); // null | "TRON" | "EVM"
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate(chain) {
    setError(null);
    setCopied(false);
    setGenerating(chain);
    try {
      const res = await generateOperationalWallet(adminToken, chain);
      setGenerated(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(null);
    }
  }

  function handleCopy() {
    if (!generated) return;
    navigator.clipboard?.writeText(generated.private_key);
    setCopied(true);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <span style={{ fontFamily: "var(--font-data)", fontSize: "9px", letterSpacing: "0.08em", color: "var(--ink-soft)" }}>
        {t("admin.sweeps.walletsTitle").toUpperCase()}
      </span>
      <span style={{ fontFamily: "var(--font-body)", fontSize: "10.5px", color: "var(--ink-soft)", lineHeight: 1.5 }}>
        {t("admin.sweeps.walletsIntro")}
      </span>

      <div style={{ display: "flex", gap: "var(--space-4)" }}>
        <button type="button" onClick={() => handleGenerate("TRON")} disabled={generating !== null} style={secondaryButtonStyle}>
          {generating === "TRON" ? t("admin.sweeps.generating") : t("admin.sweeps.generateTron")}
        </button>
        <button type="button" onClick={() => handleGenerate("EVM")} disabled={generating !== null} style={secondaryButtonStyle}>
          {generating === "EVM" ? t("admin.sweeps.generating") : t("admin.sweeps.generateEvm")}
        </button>
      </div>

      {error && <ErrorText message={error} />}

      {generated && (
        <div
          style={{
            background: "var(--cream-deep)",
            border: "1px solid var(--warning-text)",
            borderRadius: "var(--radius-lg)",
            padding: "var(--space-8)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}
        >
          <span style={{ fontFamily: "var(--font-body)", fontWeight: 700, fontSize: "11px", color: "var(--warning-text)" }}>
            {t("admin.sweeps.oneTimeWarning")}
          </span>
          <KeyRow label={t("admin.sweeps.addressLabel")} value={generated.address} />
          <KeyRow label={t("admin.sweeps.privateKeyLabel")} value={generated.private_key} />
          <span style={{ fontFamily: "var(--font-body)", fontSize: "10px", color: "var(--ink-soft)" }}>
            {t(generated.chain === "TRON" ? "admin.sweeps.pasteHintTron" : "admin.sweeps.pasteHintEvm")}
          </span>
          <button type="button" onClick={handleCopy} style={secondaryButtonStyle}>
            {copied ? t("admin.sweeps.copied") : t("admin.sweeps.copyPrivateKey")}
          </button>
        </div>
      )}
    </div>
  );
}

function KeyRow({ label, value }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "10px", color: "var(--ink-soft)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-data)", fontSize: "10.5px", color: "var(--ink-base)", wordBreak: "break-all" }}>
        {value}
      </span>
    </div>
  );
}

function PendingSection({ pending, t }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <span style={{ fontFamily: "var(--font-data)", fontSize: "9px", letterSpacing: "0.08em", color: "var(--ink-soft)" }}>
        {t("admin.sweeps.pendingTitle").toUpperCase()}
      </span>

      {pending === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-8) 0" }}>
          <AnimatedPsi mode="working" size={24} color="var(--teal-base)" />
        </div>
      ) : pending.length === 0 ? (
        <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)" }}>
          {t("admin.sweeps.pendingEmpty")}
        </span>
      ) : (
        pending.map((item) => (
          <div
            key={item.wallet_id}
            style={{
              background: "var(--cream-deep)",
              border: "1px solid var(--cream-line)",
              borderRadius: "var(--radius-lg)",
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "var(--font-data)", fontWeight: 600, fontSize: "11.5px", color: "var(--ink-base)" }}>
                {item.network}
              </span>
              <span style={{ fontFamily: "var(--font-data)", fontWeight: 600, fontSize: "11.5px", color: "var(--ink-base)" }}>
                {item.balance} {item.asset}
              </span>
            </div>
            <span style={{ fontFamily: "var(--font-data)", fontSize: "9.5px", color: "var(--ink-soft)", wordBreak: "break-all" }}>
              {item.deposit_address}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function HistorySection({ history, onRefresh, t }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "var(--font-data)", fontSize: "9px", letterSpacing: "0.08em", color: "var(--ink-soft)" }}>
          {t("admin.sweeps.historyTitle").toUpperCase()}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          style={{
            background: "none",
            border: "none",
            fontFamily: "var(--font-body)",
            fontWeight: 600,
            fontSize: "11px",
            color: "var(--teal-base)",
            cursor: "pointer",
          }}
        >
          {t("admin.sweeps.refresh")}
        </button>
      </div>

      {history === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-8) 0" }}>
          <AnimatedPsi mode="working" size={24} color="var(--teal-base)" />
        </div>
      ) : history.length === 0 ? (
        <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)" }}>
          {t("admin.sweeps.historyEmpty")}
        </span>
      ) : (
        history.map((sweep) => (
          <div
            key={sweep.id}
            style={{
              background: "var(--cream-deep)",
              border: "1px solid var(--cream-line)",
              borderRadius: "var(--radius-lg)",
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "var(--font-data)", fontWeight: 600, fontSize: "11.5px", color: "var(--ink-base)" }}>
                {sweep.network} · {sweep.amount} {sweep.asset}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-data)",
                  fontSize: "9.5px",
                  fontWeight: 600,
                  color: STATUS_COLOR[sweep.status] || "var(--ink-soft)",
                }}
              >
                {t(`admin.sweeps.${STATUS_KEY[sweep.status] || "statusPending"}`)}
              </span>
            </div>
            <span style={{ fontFamily: "var(--font-data)", fontSize: "9.5px", color: "var(--ink-soft)" }}>
              {new Date(sweep.created_at).toLocaleString()}
            </span>
            {sweep.sweep_tx_hash && (
              <span style={{ fontFamily: "var(--font-data)", fontSize: "9px", color: "var(--ink-soft)", wordBreak: "break-all" }}>
                tx: {sweep.sweep_tx_hash}
              </span>
            )}
            {sweep.error_message && <ErrorText message={sweep.error_message} />}
          </div>
        ))
      )}
    </div>
  );
}
