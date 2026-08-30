import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { useAuth } from "../context/AuthContext";
import AnimatedPsi from "../components/AnimatedPsi";
import { expectDeposit, getBalances, getDepositAddress, WS_BASE } from "../lib/api";

const NETWORKS = ["TRC20", "BASE", "POLYGON"];

export default function DepositPage() {
  const { t } = useTranslation();
  const { accessToken } = useAuth();
  const [network, setNetwork] = useState("TRC20");
  const [address, setAddress] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [loadingAddress, setLoadingAddress] = useState(true);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState("watching"); // "watching" | "credited"
  const [credit, setCredit] = useState(null);
  const [balances, setBalances] = useState([]);
  const wsRef = useRef(null);

  // Load the address for the selected network and start (or restart) the
  // 10-minute live watch — matches the "reopening the Deposit screen starts
  // a fresh window" behavior from the architecture doc.
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setLoadingAddress(true);
    setStatus("watching");
    setCredit(null);

    getDepositAddress(accessToken, network)
      .then((res) => {
        if (cancelled) return;
        setAddress(res.deposit_address);
        return QRCode.toDataURL(res.deposit_address, { margin: 1, width: 220 });
      })
      .then((url) => {
        if (!cancelled && url) setQrDataUrl(url);
      })
      .finally(() => !cancelled && setLoadingAddress(false));

    expectDeposit(accessToken, network).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [accessToken, network]);

  // One WebSocket connection per session, receiving pushes for ANY network —
  // the sweep/live-watch backend already scopes each push by user, this just
  // filters to the network currently on screen.
  useEffect(() => {
    if (!accessToken) return;
    const ws = new WebSocket(`${WS_BASE}/deposits/ws?token=${accessToken}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setCredit(data);
      setStatus("credited");
      refreshBalances();
    };

    return () => ws.close();
  }, [accessToken]);

  function refreshBalances() {
    if (!accessToken) return;
    getBalances(accessToken).then((res) => setBalances(res.balances));
  }

  useEffect(() => {
    refreshBalances();
  }, [accessToken]);

  function copyAddress() {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex min-h-screen justify-center px-5 py-8">
      <div className="w-full max-w-sm" style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
        <TopNav />

        <NetworkSelector network={network} onChange={setNetwork} />

        <AddressCard
          address={address}
          qrDataUrl={qrDataUrl}
          loading={loadingAddress}
          copied={copied}
          onCopy={copyAddress}
          t={t}
        />

        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "11.5px",
            color: "var(--ink-soft)",
            margin: 0,
          }}
        >
          {t("deposit.minNotice")}
        </p>

        {status === "watching" ? (
          <WatchingCard t={t} />
        ) : (
          <CreditedCard credit={credit} t={t} />
        )}

        <BalancesCard balances={balances} t={t} />
      </div>
    </div>
  );
}

function TopNav() {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
      <Link
        to="/"
        style={{
          fontFamily: "var(--font-body)",
          fontWeight: 500,
          fontSize: "16px",
          color: "var(--ink-base)",
          textDecoration: "none",
        }}
      >
        ←
      </Link>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: "17px",
          color: "var(--ink-base)",
        }}
      >
        {t("deposit.title")}
      </span>
    </div>
  );
}

function NetworkSelector({ network, onChange }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-4)" }}>
      {NETWORKS.map((n) => {
        const selected = n === network;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            style={{
              flex: 1,
              background: selected ? "var(--teal-pale)" : "var(--cream-deep)",
              border: selected ? "1.5px solid var(--teal-base)" : "1px solid var(--cream-line)",
              borderRadius: "var(--radius-lg)",
              padding: "10px 8px",
              fontFamily: "var(--font-body)",
              fontWeight: 600,
              fontSize: "12.5px",
              color: "var(--ink-base)",
              cursor: "pointer",
            }}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

function AddressCard({ address, qrDataUrl, loading, copied, onCopy, t }) {
  return (
    <div
      style={{
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-xl)",
        padding: "var(--space-8)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-8)",
      }}
    >
      {loading || !qrDataUrl ? (
        <div style={{ padding: "40px 0" }}>
          <AnimatedPsi mode="working" size={32} color="var(--teal-base)" />
        </div>
      ) : (
        <img src={qrDataUrl} alt="Deposit address QR code" width={180} height={180} style={{ borderRadius: "var(--radius-sm)" }} />
      )}

      <span
        style={{
          fontFamily: "var(--font-body)",
          fontWeight: 500,
          fontSize: "11px",
          color: "var(--ink-soft)",
        }}
      >
        {t("deposit.addressLabel")}
      </span>

      <span
        style={{
          fontFamily: "var(--font-data)",
          fontSize: "12px",
          color: "var(--ink-base)",
          wordBreak: "break-all",
          textAlign: "center",
        }}
      >
        {loading ? t("deposit.loadingAddress") : address}
      </span>

      <button
        type="button"
        onClick={onCopy}
        disabled={loading}
        style={{
          background: "var(--teal-base)",
          color: "var(--on-accent)",
          border: "none",
          borderRadius: "var(--radius-md)",
          padding: "10px 16px",
          fontFamily: "var(--font-body)",
          fontWeight: 600,
          fontSize: "12.5px",
          cursor: loading ? "default" : "pointer",
        }}
      >
        {copied ? t("deposit.copied") : t("deposit.copy")}
      </button>
    </div>
  );
}

function WatchingCard({ t }) {
  return (
    <div
      style={{
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-8)",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-7)",
      }}
    >
      <AnimatedPsi mode="working" size={26} color="var(--teal-base)" />
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "13px", color: "var(--ink-base)" }}>
          {t("deposit.waiting")}
        </span>
        <span style={{ fontFamily: "var(--font-body)", fontSize: "11px", color: "var(--ink-soft)" }}>
          {t("deposit.watchingNotice")}
        </span>
      </div>
    </div>
  );
}

function CreditedCard({ credit, t }) {
  return (
    <div
      style={{
        background: "var(--teal-pale)",
        border: "1.5px solid var(--teal-base)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--space-8)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-3)",
      }}
    >
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "13px", color: "var(--teal-deep)" }}>
        {t("deposit.credited")}
      </span>
      {credit && (
        <span style={{ fontFamily: "var(--font-data)", fontSize: "12px", color: "var(--ink-base)" }}>
          {t("deposit.creditedBody", { amount: credit.amount, asset: credit.asset })}
        </span>
      )}
    </div>
  );
}

function BalancesCard({ balances, t }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: "14px",
          color: "var(--ink-base)",
        }}
      >
        {t("deposit.balancesTitle")}
      </span>

      {balances.length === 0 ? (
        <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--ink-soft)" }}>
          {t("deposit.noBalances")}
        </span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          {balances.map((b) => (
            <div
              key={b.asset}
              style={{
                background: "var(--cream-deep)",
                border: "1px solid var(--cream-line)",
                borderRadius: "var(--radius-lg)",
                padding: "12px 14px",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12.5px", color: "var(--ink-base)" }}>
                {b.asset}
              </span>
              <span style={{ fontFamily: "var(--font-data)", fontSize: "12.5px", color: "var(--ink-base)" }}>
                {b.amount}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
