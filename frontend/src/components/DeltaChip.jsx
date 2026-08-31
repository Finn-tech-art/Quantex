// A small tinted-background pill for wrapping a gain/loss/neutral figure
// shown inline in a list or header — a 24hr % change (MarketsPage,
// TradePage) or a bot's running PnL in dollars (HomePage). Bybit tints a
// soft background behind figures like this so "up" vs "down" reads from
// the pill's shape/color at a glance in a dense, fast-scrolling list, not
// just from the text color alone (easy to miss when everything around it
// is also small colored text).
//
// This component ONLY wraps already-formatted text in the tinted pill —
// it does no number formatting itself (toFixed, the leading "+", a "%" or
// "$" suffix) because that varies per call site: MarketsPage wants 2
// decimals and a trailing "%", BotCard wants 2 decimals with no suffix
// (already inside a card labelled with the asset), and PnL specifically
// has a three-way neutral state (exactly 0) that a plain up/down comparison
// doesn't have. Pass whatever the call site already computed as `children`,
// and just tell this component which `tone` bucket it falls into.
export default function DeltaChip({ children, tone, fontSize = "11px" }) {
  // tone is one of "up" | "down" | "neutral" — deliberately not derived
  // from `children` here (e.g. by sniffing for a "-" prefix), since the
  // caller already has the real signed number on hand and sniffing
  // formatted text back apart for its sign would be more fragile than
  // just passing the three-way answer down directly.
  const color = tone === "up" ? "var(--gain)" : tone === "down" ? "var(--loss)" : "var(--ink-soft)";
  // Neutral gets a flat --cream-line wash (not a color-mix of --ink-soft)
  // since --ink-soft is a text-gray, not a color meant to be tinted as a
  // background — --cream-line is this app's existing "neutral divider/
  // border" token, which reads as "flat, nothing happening" exactly the
  // way a pnl-of-exactly-zero chip should.
  const background = tone === "neutral" ? "var(--cream-line)" : `color-mix(in srgb, ${color} 16%, transparent)`;

  return (
    <span
      style={{
        fontFamily: "var(--font-data)",
        fontSize,
        color,
        background,
        padding: "2px 6px",
        borderRadius: "var(--radius-xs)",
        display: "inline-block",
        lineHeight: 1.4,
      }}
    >
      {children}
    </span>
  );
}
