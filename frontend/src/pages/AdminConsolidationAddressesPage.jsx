// Admin settings for the deposit consolidation sweep's destination address
// per network (Module 1/5) — see backend/app/services/custody_service.py
// and the architecture doc's "Deposit consolidation" section for the full
// design. Editing requires retyping the address to confirm before it
// saves: this value controls where every future swept deposit goes, and a
// typo here would silently misdirect funds rather than fail loudly, so the
// extra friction is deliberate, not an oversight — it's the one thing this
// screen can do that server-side format validation alone can't (a
// syntactically valid address for the wrong intended destination still
// passes format validation).

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAdminAuth } from "../context/AdminAuthContext";
import AdminNav from "../components/AdminNav";
import AnimatedPsi from "../components/AnimatedPsi";
import { ErrorText, PrimaryButton } from "../components/FormControls";
import { getConsolidationAddresses, setConsolidationAddress } from "../lib/api";

export default function AdminConsolidationAddressesPage() {
  const { t } = useTranslation();
  const { admin, adminToken, logout } = useAdminAuth();

  const [addresses, setAddresses] = useState(null); // null = still loading
  const [editingNetwork, setEditingNetwork] = useState(null);

  function refresh() {
    if (!adminToken) return;
    getConsolidationAddresses(adminToken).then((res) => setAddresses(res.addresses));
  }

  useEffect(refresh, [adminToken]);

  function handleSaved() {
    setEditingNetwork(null);
    refresh();
  }

  return (
    <div className="flex min-h-screen justify-center px-5 py-8">
      <div className="w-full max-w-sm" style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "17px", color: "var(--ink-base)" }}>
            {t("admin.consolidation.title")}
          </span>
          <button
            type="button"
            onClick={logout}
            style={{ background: "none", border: "none", fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)", cursor: "pointer" }}
          >
            {t("admin.consolidation.logout")}
          </button>
        </div>

        {admin && (
          <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", color: "var(--ink-soft)" }}>{admin.email}</span>
        )}

        <AdminNav />

        <span style={{ fontFamily: "var(--font-body)", fontSize: "11px", color: "var(--ink-soft)", lineHeight: 1.5 }}>
          {t("admin.consolidation.intro")}
        </span>

        {addresses === null ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-16) 0" }}>
            <AnimatedPsi mode="working" size={28} color="var(--teal-base)" />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {addresses.map((entry) =>
              editingNetwork === entry.network ? (
                <EditCard
                  key={entry.network}
                  network={entry.network}
                  adminToken={adminToken}
                  onCancel={() => setEditingNetwork(null)}
                  onSaved={handleSaved}
                  t={t}
                />
              ) : (
                <DisplayCard key={entry.network} entry={entry} onEdit={() => setEditingNetwork(entry.network)} t={t} />
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DisplayCard({ entry, onEdit, t }) {
  return (
    <div
      style={{
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-8)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: "var(--font-data)", fontWeight: 600, fontSize: "12px", color: "var(--ink-base)" }}>
          {entry.network}
        </span>
        <button
          type="button"
          onClick={onEdit}
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
          {t("admin.consolidation.editButton")}
        </button>
      </div>
      <span
        style={{
          fontFamily: "var(--font-data)",
          fontSize: "10.5px",
          color: entry.is_configured ? "var(--ink-base)" : "var(--warning-text)",
          wordBreak: "break-all",
        }}
      >
        {entry.is_configured ? entry.destination_address : t("admin.consolidation.notConfigured")}
      </span>
    </div>
  );
}

function EditCard({ network, adminToken, onCancel, onSaved, t }) {
  const [address, setAddress] = useState("");
  const [confirmAddress, setConfirmAddress] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    // Client-side retype-to-confirm — the server independently validates
    // address format, but has no way to know these two fields were
    // supposed to match, so that check has to happen here.
    if (address.trim() !== confirmAddress.trim()) {
      setError(t("admin.consolidation.mismatchError"));
      return;
    }

    setSaving(true);
    try {
      await setConsolidationAddress(adminToken, network, address.trim());
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: "var(--cream-deep)",
        border: "1px solid var(--teal-base)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-8)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}
    >
      <span style={{ fontFamily: "var(--font-data)", fontWeight: 600, fontSize: "12px", color: "var(--ink-base)" }}>
        {network}
      </span>

      <AddressField label={t("admin.consolidation.addressLabel")} value={address} onChange={setAddress} />
      <AddressField label={t("admin.consolidation.confirmLabel")} value={confirmAddress} onChange={setConfirmAddress} />

      {error && <ErrorText message={error} />}

      <div style={{ display: "flex", gap: "var(--space-4)" }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          style={{
            flex: 1,
            background: "none",
            border: "1px solid var(--cream-line)",
            borderRadius: "var(--radius-md)",
            padding: "13px 14px",
            fontFamily: "var(--font-body)",
            fontWeight: 600,
            fontSize: "12.5px",
            color: "var(--ink-soft)",
            cursor: saving ? "default" : "pointer",
          }}
        >
          {t("admin.consolidation.cancelButton")}
        </button>
        <div style={{ flex: 1 }}>
          <PrimaryButton submitting={saving}>{saving ? t("admin.consolidation.saving") : t("admin.consolidation.save")}</PrimaryButton>
        </div>
      </div>
    </form>
  );
}

function AddressField({ label, value, onChange }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "11px", color: "var(--ink-soft)" }}>
        {label}
      </span>
      <input
        type="text"
        required
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "var(--cream-base)",
          border: "1px solid var(--cream-line)",
          borderRadius: "var(--radius-md)",
          padding: "13px 14px",
          fontFamily: "var(--font-data)",
          fontSize: "11.5px",
          color: "var(--ink-base)",
          outline: "none",
        }}
      />
    </label>
  );
}
