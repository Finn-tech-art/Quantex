import CoinGlyph from "./CoinGlyph";
import Icon from "./Icon";
import SelectField from "./SelectField";
import { DISPLAY_CURRENCIES } from "../hooks/useDisplayCurrency";

// The compact "USD ▾" control on HomePage's and WalletPage's hero cards
// for switching which currency the total balance is shown in. A thin
// wrapper around SelectField's `renderTrigger` escape hatch (see that
// file's own comment on it) so both hero cards share one implementation
// instead of two near-identical copies of the same trigger/sheet code.
//
// `onDark` styles the trigger's own text/icon in --teal-sage — the same
// fixed-on-dark token the rest of a --teal-deep hero card already uses for
// secondary text (see index.css's note on --on-accent/--teal-sage never
// flipping with the theme toggle) — so it stays legible sitting on that
// dark background in both light and dark mode. Both current call sites
// pass true; it's a parameter rather than hardcoded in case this picker
// is ever reused somewhere on a light (--cream-deep) surface instead.
export default function CurrencyPicker({ currency, onChange, onDark = true }) {
  const textColor = onDark ? "var(--teal-sage)" : "var(--ink-soft)";

  return (
    <SelectField
      label="Display currency"
      value={currency}
      options={DISPLAY_CURRENCIES}
      onChange={onChange}
      renderIcon={(c) => (c === "USD" ? <Icon name="dollar" size={18} color="var(--teal-base)" /> : <CoinGlyph asset={c} size={18} />)}
      renderTrigger={({ value, open }) => (
        <button
          type="button"
          onClick={open}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontFamily: "var(--font-data)",
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: "0.06em",
            color: textColor,
          }}
        >
          {value}
          <Icon name="chevronDown" size={11} color={textColor} />
        </button>
      )}
    />
  );
}
