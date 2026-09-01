// The "chosen from a list" avatar system — a small set of hand-drawn line
// icons, each paired with a background color, following the exact same
// hand-authored-SVG convention Icon.jsx already established (viewBox
// 0 0 24 24, stroke-based line art, round caps/joins) rather than pulling
// in an icon library or real photo assets. Kept as its own file rather
// than folded into Icon.jsx because these are USER-IDENTITY icons (what
// avatar am I) rather than app-chrome icons (what does this button do) —
// same reasoning CoinGlyph.jsx/NetworkGlyph.jsx already document for why
// THEY'RE separate files from Icon.jsx too.
//
// AVATAR_OPTIONS's length and order is a real backend contract, not just a
// frontend list — a user's chosen avatar is stored as `avatar_id`, a bare
// integer INDEX into this array (see 018_usernames_and_avatars.sql and
// auth_service.MAX_AVATAR_ID's own comments for the full reasoning on why
// that's a plain int and not a lookup-table foreign key). Rules that
// follow from that:
//   - Only ever APPEND new entries to the end. Reordering or deleting an
//     entry silently reassigns every existing user's avatar_id to a
//     DIFFERENT picture — nobody's stored choice moves with it.
//   - Update auth_service.MAX_AVATAR_ID (backend) to this array's new
//     highest index whenever an entry is added.
// `bg` cycles through index.css's six --avatar-N tokens (see that file's
// own comment on why these are a separate decorative palette, not reused
// semantic colors like --gain/--loss) — repeating is fine once there are
// more glyphs than colors, since the glyph's SHAPE is what tells two
// same-colored avatars apart in the picker grid.
const AVATAR_BG = ["var(--avatar-1)", "var(--avatar-2)", "var(--avatar-3)", "var(--avatar-4)", "var(--avatar-5)", "var(--avatar-6)"];

export const AVATAR_OPTIONS = [
  {
    // 0 — fox
    bg: AVATAR_BG[0],
    glyph: (color) => (
      <>
        <path d="M12 15.5 6 9l1.5 6.5L12 19l4.5-3.5L18 9l-6 6.5Z" stroke={color} strokeWidth="1.6" fill="none" strokeLinejoin="round" />
        <circle cx="10" cy="13.3" r="0.9" fill={color} stroke="none" />
        <circle cx="14" cy="13.3" r="0.9" fill={color} stroke="none" />
      </>
    ),
  },
  {
    // 1 — owl
    bg: AVATAR_BG[1],
    glyph: (color) => (
      <>
        <path d="M12 5c-3.6 0-6 2.7-6 6.5S8.4 19 12 19s6-3.2 6-7.5S15.6 5 12 5Z" stroke={color} strokeWidth="1.6" fill="none" />
        <circle cx="9.3" cy="11.5" r="1.7" stroke={color} strokeWidth="1.4" fill="none" />
        <circle cx="14.7" cy="11.5" r="1.7" stroke={color} strokeWidth="1.4" fill="none" />
        <circle cx="9.3" cy="11.5" r="0.5" fill={color} stroke="none" />
        <circle cx="14.7" cy="11.5" r="0.5" fill={color} stroke="none" />
        <path d="M11 15.5h2l-1 1.4-1-1.4Z" fill={color} stroke="none" />
      </>
    ),
  },
  {
    // 2 — cat
    bg: AVATAR_BG[2],
    glyph: (color) => (
      <>
        <path d="M7 6.5 8.5 11h7L17 6.5 13.6 9.2h-3.2L7 6.5Z" stroke={color} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
        <path d="M8.5 11c-2 0-3.3 1.7-3.3 3.8 0 2.8 2.6 4.7 6.8 4.7s6.8-1.9 6.8-4.7c0-2.1-1.3-3.8-3.3-3.8" stroke={color} strokeWidth="1.5" fill="none" />
        <path d="M4 14l3-.6M20 14l-3-.6" stroke={color} strokeWidth="1.1" strokeLinecap="round" />
        <circle cx="10" cy="15" r="0.8" fill={color} stroke="none" />
        <circle cx="14" cy="15" r="0.8" fill={color} stroke="none" />
      </>
    ),
  },
  {
    // 3 — robot
    bg: AVATAR_BG[3],
    glyph: (color) => (
      <>
        <line x1="12" y1="3.5" x2="12" y2="6" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="12" cy="3" r="1" fill={color} stroke="none" />
        <rect x="6" y="6" width="12" height="10" rx="3" stroke={color} strokeWidth="1.6" fill="none" />
        <circle cx="9.7" cy="11" r="1.2" fill={color} stroke="none" />
        <circle cx="14.3" cy="11" r="1.2" fill={color} stroke="none" />
        <path d="M9 20h6M12 16v4" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
  },
  {
    // 4 — rocket
    bg: AVATAR_BG[4],
    glyph: (color) => (
      <>
        <path d="M12 3.5c2.4 1.8 3.6 4.6 3.6 8.2 0 2.4-.6 4.3-1.3 5.6H9.7c-.7-1.3-1.3-3.2-1.3-5.6 0-3.6 1.2-6.4 3.6-8.2Z" stroke={color} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
        <circle cx="12" cy="10.5" r="1.5" stroke={color} strokeWidth="1.3" fill="none" />
        <path d="M9.5 15 7 19l2.7-1M14.5 15 17 19l-2.7-1" stroke={color} strokeWidth="1.4" fill="none" strokeLinejoin="round" />
        <path d="M10.5 17.3 10 20l2-1 2 1-.5-2.7" stroke={color} strokeWidth="1.2" fill="none" strokeLinejoin="round" />
      </>
    ),
  },
  {
    // 5 — compass
    bg: AVATAR_BG[5],
    glyph: (color) => (
      <>
        <circle cx="12" cy="12" r="8" stroke={color} strokeWidth="1.6" fill="none" />
        <path d="M14.5 9.5 13 13l-3.5 1.5L11 11l3.5-1.5Z" stroke={color} strokeWidth="1.3" fill="none" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="0.8" fill={color} stroke="none" />
      </>
    ),
  },
  {
    // 6 — mountain
    bg: AVATAR_BG[0],
    glyph: (color) => (
      <>
        <circle cx="17" cy="7" r="1.6" stroke={color} strokeWidth="1.3" fill="none" />
        <path d="M4 17.5 9 9l3 4.5L14.5 10 20 17.5H4Z" stroke={color} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
      </>
    ),
  },
  {
    // 7 — wave
    bg: AVATAR_BG[1],
    glyph: (color) => (
      <>
        <path d="M4 10c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path d="M4 14.5c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path d="M4 19c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  {
    // 8 — flame
    bg: AVATAR_BG[2],
    glyph: (color) => (
      <path
        d="M12 3.5c1 2.4-1.8 3.6-1.8 6 0 1 .6 1.7 1.3 1.7.9 0 1.4-.8 1.3-1.7 1.6 1 2.7 2.9 2.7 4.9 0 3-2.4 5.6-5.5 5.6S4.5 17.4 4.5 14.4c0-4.4 3.7-6.6 7.5-10.9Z"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        strokeLinejoin="round"
      />
    ),
  },
  {
    // 9 — star
    bg: AVATAR_BG[3],
    glyph: (color) => (
      <path
        d="m12 3.5 2.4 5 5.5.6-4.1 3.8 1.1 5.4L12 15.8l-4.9 2.5 1.1-5.4-4.1-3.8 5.5-.6L12 3.5Z"
        stroke={color}
        strokeWidth="1.4"
        fill="none"
        strokeLinejoin="round"
      />
    ),
  },
  {
    // 10 — beacon / lighthouse
    bg: AVATAR_BG[4],
    glyph: (color) => (
      <>
        <path d="M10 20h4l-1-9h-2l-1 9Z" stroke={color} strokeWidth="1.4" fill="none" strokeLinejoin="round" />
        <path d="M9.5 11h5l-1-6.5h-3L9.5 11Z" stroke={color} strokeWidth="1.4" fill="none" strokeLinejoin="round" />
        <path d="M4.5 8.5 9 10M19.5 8.5 15 10" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      </>
    ),
  },
  {
    // 11 — diamond
    bg: AVATAR_BG[5],
    glyph: (color) => (
      <path
        d="M7 5h10l3 4.5L12 20 4 9.5 7 5Z"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        strokeLinejoin="round"
      />
    ),
  },
];

/**
 * <AvatarGlyph avatarId={2} size={40} />
 *
 * avatarId: index into AVATAR_OPTIONS. An out-of-range value (e.g. an old
 *   client showing a newer account's avatar_id before a frontend deploy
 *   catches up) falls back to option 0 rather than rendering nothing.
 * size: render diameter in px — the circle and the glyph inside it both
 *   scale together.
 */
export default function AvatarGlyph({ avatarId, size = 40 }) {
  const option = AVATAR_OPTIONS[avatarId] || AVATAR_OPTIONS[0];

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: option.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none">
        {option.glyph("var(--on-accent)")}
      </svg>
    </div>
  );
}
