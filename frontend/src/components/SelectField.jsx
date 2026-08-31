// The Bybit-style dropdown pattern for picking ONE thing (a coin, a
// network) out of a short list, each option shown with its own real brand
// logo — replacing the earlier "row of toggle buttons" pattern this app
// used in three separate places (TradePage's old PairTabs, DepositPage's
// old NetworkSelector, WithdrawPage's old PillSelector). That pattern
// stopped scaling once an option needed a real icon next to it rather
// than just a short text label, and a row of N equal-width buttons gets
// visually cramped past 3-4 options.
//
// Reuses this app's existing BottomSheet primitive for the open list
// (rather than a native <select>, which can't render a custom icon per
// option, or a hand-rolled absolute-positioned dropdown menu, which would
// need its own click-outside/escape/z-index handling that BottomSheet
// already solves) — so the open list gets the same backdrop-tap/Escape/
// drag-handle behavior every other "pick one from a list" moment in this
// app already uses (see ConfirmSheet.jsx for the other thing built on the
// same shell).
import { useState } from "react";
import BottomSheet from "./BottomSheet";
import Icon from "./Icon";

/**
 * <SelectField
 *   label="Network"
 *   value={network}
 *   options={["TRC20", "BASE", "POLYGON"]}
 *   onChange={setNetwork}
 *   renderIcon={(opt) => <NetworkGlyph network={opt} size={20} />}
 * />
 *
 * label: shown above the collapsed field AND as the open sheet's title.
 *   Pass "" / omit to render neither (no current call site needs this,
 *   but nothing here requires a label to function).
 * value: the currently-selected option (must be one of `options`, or
 *   null/undefined for "nothing selected yet" — renders `placeholder`).
 * options: array of raw option values (this app's options are always
 *   plain strings — an asset code, a network code, a pair string — so
 *   each option IS its own identity; no separate {value, label} shape).
 * onChange(option): called with the raw option value when a row is tapped;
 *   this component closes its own sheet afterward, the caller doesn't need
 *   to.
 * renderIcon(option): returns the JSX for one option's logo — required,
 *   since showing a real brand icon per option is this whole component's
 *   reason to exist over the old plain-text toggle buttons.
 * renderLabel(option): optional, defaults to showing the option's raw
 *   value untouched (covers every current call site, e.g. "TRC20",
 *   "BTC/USDT") — pass this only if an option's displayed text needs to
 *   differ from its raw value.
 * placeholder: shown in the collapsed field when `value` is falsy.
 *
 * Renders nothing at all when `options` is empty — same short-circuit the
 * old PillSelector had, for the same reason (e.g. WithdrawPage's network
 * picker has nothing to show until an asset is chosen first).
 */
export default function SelectField({
  label,
  value,
  options,
  onChange,
  renderIcon,
  renderLabel = (opt) => opt,
  placeholder = "Select",
  renderTrigger,
}) {
  const [open, setOpen] = useState(false);

  if (options.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {label && !renderTrigger && (
        <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "11px", color: "var(--ink-soft)" }}>
          {label}
        </span>
      )}

      {/* renderTrigger is an escape hatch for a call site whose trigger
          can't use the default full-width form-field look below — e.g.
          HomePage/WalletPage's display-currency picker, which needs a
          compact inline "USD ▾" control sitting on a dark hero card
          instead of a light --cream-deep box. When provided, it's handed
          the current value and an `open` function to call on tap; this
          component still owns everything below (the open/close state and
          the BottomSheet option list), so a custom trigger only changes
          how the collapsed control LOOKS, never how selection works. Every
          existing call site (Trade/Deposit/Withdraw/CreateBot) omits this
          and gets the exact default button unchanged. */}
      {renderTrigger ? (
        renderTrigger({ value, open: () => setOpen(true) })
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-5)",
            width: "100%",
            background: "var(--cream-deep)",
            border: "1px solid var(--cream-line)",
            borderRadius: "var(--radius-lg)",
            padding: "10px 14px",
            fontFamily: "var(--font-body)",
            fontWeight: 600,
            fontSize: "13px",
            color: "var(--ink-base)",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          {value ? renderIcon(value) : null}
          <span style={{ flex: 1 }}>{value ? renderLabel(value) : placeholder}</span>
          {/* Rotates to point up while the sheet is open — a small hint that
              tapping again (well, tapping the backdrop, but this visually
              says "this control is currently expanded") would collapse it,
              matching a native <select>'s own arrow convention. */}
          <Icon
            name="chevronDown"
            size={16}
            color="var(--ink-soft)"
          />
        </button>
      )}

      <BottomSheet open={open} onClose={() => setOpen(false)}>
        {label && (
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "16px", color: "var(--ink-base)", marginBottom: "var(--space-6)" }}>
            {label}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {options.map((opt) => {
            const selected = opt === value;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-6)",
                  width: "100%",
                  background: selected ? "var(--teal-pale)" : "none",
                  border: selected ? "1.5px solid var(--teal-base)" : "1px solid transparent",
                  borderRadius: "var(--radius-lg)",
                  padding: "12px 14px",
                  fontFamily: "var(--font-body)",
                  fontWeight: 600,
                  fontSize: "13.5px",
                  color: "var(--ink-base)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                {renderIcon(opt)}
                <span style={{ flex: 1 }}>{renderLabel(opt)}</span>
                {selected && <Icon name="checkCircle" size={18} color="var(--teal-base)" />}
              </button>
            );
          })}
        </div>
      </BottomSheet>
    </div>
  );
}
