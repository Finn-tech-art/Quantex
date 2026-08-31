// Visual "how to take this photo" guide shown above the ID/selfie upload
// fields on KycPage.jsx. There is no real photo we could show here — we
// have no legitimate source of stock photography, and using a real
// person's ID document or face as a UI example would be inappropriate
// even if we did. So instead, exactly like every real KYC flow (Binance,
// Coinbase, etc.) actually does it, this draws a simple GUIDE DIAGRAM: a
// stylised outline of "what a correctly framed photo looks like" plus a
// row of small "what to avoid" icons (glare / blur / cropped edges).
//
// All shapes here are hand-authored inline SVG, following the exact same
// line-art convention as Icon.jsx and AnimatedPsi.jsx (see Icon.jsx's own
// header comment): viewBox "0 0 24 24", stroke-based paths, round line
// caps/joins, 1.4-2px stroke weight, color driven by a prop rather than a
// hardcoded hex (per quantex-design-system-spec_2.md Section 7). These
// diagrams are deliberately kept local to this file rather than added to
// Icon.jsx's shared ICONS registry, because Icon.jsx is documented there
// as the "app shell" icon set (tab bar, top nav, menu, quick actions) —
// these are bigger, multi-part, single-purpose illustrations used only on
// this one screen, not reusable nav glyphs.
//
// To change the wording shown next to each diagram, edit the
// kyc.guide.* keys in i18n.js — nothing in this file has English text
// hardcoded into it, so a new locale added later only needs new i18n
// entries, no changes here.

// ── The big "this is what a good photo looks like" diagram ────────────────
// One shared component covers both the "document" (ID front/back) and
// "selfie" cases via the `variant` prop, since they differ only in what's
// drawn inside the capture-frame corner brackets — the brackets themselves
// (the camera-viewfinder-style corner marks) are identical for both and
// are what visually say "this is a photo framing guide" at a glance.
function FrameDiagram({ variant, size = 64, color = "var(--ink-base)" }) {
  // The four L-shaped corner brackets that make this read as a "camera
  // capture frame" rather than a plain rectangle. Drawn as four separate
  // 2-segment paths (one per corner) rather than one clever path, purely
  // because that keeps each corner independently readable/editable if you
  // ever want to nudge just one bracket's size or position.
  const brackets = (
    <>
      <path d="M2 6V3.5A1.5 1.5 0 0 1 3.5 2H6" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M18 2h2.5A1.5 1.5 0 0 1 22 3.5V6" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M22 18v2.5a1.5 1.5 0 0 1-1.5 1.5H18" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M6 22H3.5A1.5 1.5 0 0 1 2 20.5V18" stroke={color} strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </>
  );

  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" style={{ flexShrink: 0 }}>
      {brackets}
      {variant === "selfie" ? (
        // A head-and-shoulders silhouette, centered in the frame — the
        // universal "put your face here" shape. The ellipse is the head;
        // the arc beneath it is the top of the shoulders, clipped by the
        // frame edge exactly like a real selfie would crop the shoulders.
        <>
          <ellipse cx="12" cy="10.5" rx="4.5" ry="5.5" stroke={color} strokeWidth="1.5" fill="none" />
          <path d="M4.5 21c0-3.5 3.5-6 7.5-6s7.5 2.5 7.5 6" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </>
      ) : (
        // An ID-card shape: rounded rect + a small "photo" square in the
        // corner + two short lines standing in for printed text rows —
        // just enough detail to read as "identity document" without
        // trying to draw a literal, specific ID card design.
        <>
          <rect x="4" y="7.5" width="16" height="9" rx="1.3" stroke={color} strokeWidth="1.5" fill="none" />
          <rect x="5.5" y="9" width="3.5" height="4.5" rx="0.6" stroke={color} strokeWidth="1.3" fill="none" />
          <path d="M10.5 10h6.5M10.5 12.3h5" stroke={color} strokeWidth="1.3" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

// ── The small "avoid this" thumbnails (glare / blur / cropped) ────────────
// Each one draws the MISTAKE itself (a glare streak, wavy out-of-focus
// lines, a document sliding off the edge of frame) rather than a generic
// document-plus-red-X, because at this small size a literal little picture
// of the problem reads faster than an abstract prohibition symbol.
function AvoidGlare({ color }) {
  return (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke={color} strokeWidth="1.4" fill="none" />
      {/* The glare streak: a filled parallelogram cutting diagonally across
          the card, like a camera-flash reflection off a laminated ID. */}
      <path d="M7 5 3 13v6l6-14Z" fill={color} stroke="none" opacity="0.55" />
    </>
  );
}

function AvoidBlur({ color }) {
  return (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke={color} strokeWidth="1.4" fill="none" />
      {/* Three wavy rows standing in for text that's out of focus — the
          same "text row" idea as FrameDiagram's document lines above, but
          drawn as a wobble (repeating Q-curves) instead of a straight
          line so it visibly reads as "blurred", not just "smaller". */}
      <path d="M6 9.5q1.2-1.4 2.4 0t2.4 0t2.4 0t2.4 0t2.4 0" stroke={color} strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <path d="M6 12.5q1.2-1.4 2.4 0t2.4 0t2.4 0t2.4 0t2.4 0" stroke={color} strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <path d="M6 15.5q1.2-1.4 2.4 0t2.4 0" stroke={color} strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </>
  );
}

function AvoidCropped({ color }) {
  return (
    <>
      {/* The dashed rect is "the edge of the photo" (what the camera
          actually captures); the solid card is drawn shifted right so it
          visibly runs past that edge and gets cut off by the svg's own
          viewBox — the clipping IS the mistake being illustrated. */}
      <rect x="2" y="5" width="16" height="14" rx="2" stroke={color} strokeWidth="1.2" strokeDasharray="2.5 2" fill="none" />
      <rect x="7" y="7.5" width="16" height="9" rx="1.3" stroke={color} strokeWidth="1.6" fill="none" />
    </>
  );
}

const AVOID_KINDS = { glare: AvoidGlare, blur: AvoidBlur, cropped: AvoidCropped };

// One "avoid" thumbnail + its caption, stacked vertically. `kind` selects
// which mistake-diagram from AVOID_KINDS to draw; `label` is the already-
// translated caption text passed down from the parent.
function AvoidItem({ kind, label }) {
  const Diagram = AVOID_KINDS[kind];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)", flex: 1 }}>
      <svg viewBox="0 0 24 24" width={30} height={30} fill="none">
        {/* All three "avoid" diagrams are drawn in --loss (the same red
            used everywhere else in the app for errors/negative states —
            see quantex-design-system-spec_2.md Section 3), so a user
            scanning the row recognizes "these are the bad ones" purely
            from color, before even reading the captions. */}
        <Diagram color="var(--loss)" />
      </svg>
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "10px",
          color: "var(--ink-soft)",
          textAlign: "center",
          lineHeight: 1.3,
        }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * <KycPhotoGuide variant="document" t={t} />
 * <KycPhotoGuide variant="selfie" t={t} />
 *
 * Renders one guidance card: a big frame diagram + 1-2 short "do" tips on
 * the left/top, and a row of three small "avoid" thumbnails underneath.
 *
 * variant: "document" (used once, above the ID front/back fields — the
 *   framing rules are identical for front and back so there's no need to
 *   repeat this card twice) or "selfie" (used once, above the selfie
 *   field).
 * t: the i18next translate function, passed down from KycPage so this
 *   component doesn't need its own useTranslation() call.
 *
 * To reword the tips or captions, edit the matching kyc.guide.* key in
 * i18n.js — see that file's `kyc.guide` block. To add a third "do" tip,
 * add another key there and another line to the `tips` array below.
 */
export default function KycPhotoGuide({ variant, t }) {
  const isSelfie = variant === "selfie";
  const title = t(isSelfie ? "kyc.guide.selfieTitle" : "kyc.guide.documentTitle");
  const tips = isSelfie
    ? [t("kyc.guide.selfieTip1"), t("kyc.guide.selfieTip2")]
    : [t("kyc.guide.documentTip1"), t("kyc.guide.documentTip2")];

  return (
    <div
      style={{
        background: "var(--cream-deep)",
        border: "1px solid var(--cream-line)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-6)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
        <FrameDiagram variant={variant} size={56} color="var(--ink-base)" />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", flex: 1 }}>
          <span style={{ fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12px", color: "var(--ink-base)" }}>
            {title}
          </span>
          {tips.map((tip) => (
            <div key={tip} style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)" }}>
              {/* Reuses the exact same plain "✓" character + --gain color
                  that FileField.jsx already uses for its own "file
                  selected" checkmark, rather than inventing a second
                  checkmark style for the same "this is correct" meaning. */}
              <span style={{ fontFamily: "var(--font-data)", fontSize: "10px", color: "var(--gain)", lineHeight: "1.6" }}>✓</span>
              <span style={{ fontFamily: "var(--font-body)", fontSize: "10.5px", color: "var(--ink-soft)", lineHeight: 1.5 }}>
                {tip}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: "var(--space-5)" }}>
        <AvoidItem kind="glare" label={t("kyc.guide.avoidGlare")} />
        <AvoidItem kind="blur" label={t("kyc.guide.avoidBlur")} />
        <AvoidItem kind="cropped" label={t("kyc.guide.avoidCropped")} />
      </div>
    </div>
  );
}
