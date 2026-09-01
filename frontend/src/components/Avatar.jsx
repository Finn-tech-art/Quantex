// Shared user-identity avatar — generalized out of the local `Avatar`
// component MenuPage.jsx used to define for itself, so HomePage's TopRow
// (which shows this same avatar in place of the old plain-text greeting)
// doesn't need its own second copy of this exact logic.
//
// Precedence, in order:
//   1. A real Google profile photo (avatarUrl, only ever set for a
//      Google-OAuth login — see backend/app/utils/auth.py's
//      get_current_user) — never overridden automatically, so an existing
//      Google-linked account's look doesn't change on its own the moment
//      this feature ships. A user can still explicitly pick one of the
//      hand-drawn avatars instead via AvatarPicker.jsx, which is a
//      deliberate override stored in avatarId and always takes priority
//      the moment it's set... except this component has no way to tell
//      "never chosen" apart from "chose option 0" (avatar_id's column
//      default IS 0 — see 018_usernames_and_avatars.sql), so in practice a
//      Google user who has never opened the picker keeps seeing their
//      real photo here, and the instant they pick ANY avatar (including
//      option 0 itself) they'd need that choice tracked separately to
//      ever see it over their photo. That's out of scope for this pass —
//      today, a Google-linked account's photo always wins over avatarId
//      unless avatarUrl is missing/broken. Worth revisiting if that ever
//      feels wrong in practice.
//   2. The chosen hand-drawn avatar (avatarId -> AvatarGlyph.jsx).
//   3. A plain initial-letter circle — the original fallback this always
//      had, now only reachable if avatarId itself is somehow absent
//      (shouldn't happen once loaded, since that column always has a
//      value, but `user` can be null/mid-load).
//
// Same "img with onError fallback" pattern MarketsPage.jsx's CoinLogo uses
// — a broken/expired Google photo URL degrades to step 2 instead of a
// broken-image icon. `broken` deliberately isn't reset if avatarUrl
// changes; a full remount (this component unmounting/remounting, e.g. on
// logout+login as a different user) is what naturally clears it back to
// false.
import { useState } from "react";
import AvatarGlyph from "./AvatarGlyph";

/**
 * <Avatar avatarUrl={user.avatar_url} avatarId={user.avatar_id} initial={initial} size={56} />
 */
export default function Avatar({ avatarUrl, avatarId, initial, size = 56 }) {
  const [broken, setBroken] = useState(false);

  if (avatarUrl && !broken) {
    return (
      <img
        src={avatarUrl}
        alt=""
        width={size}
        height={size}
        onError={() => setBroken(true)}
        style={{ borderRadius: "var(--radius-full)", flexShrink: 0, objectFit: "cover" }}
      />
    );
  }

  if (avatarId != null) {
    return <AvatarGlyph avatarId={avatarId} size={size} />;
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "var(--radius-full)",
        background: "var(--teal-deep)",
        color: "var(--on-accent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-display)",
        fontWeight: 700,
        fontSize: size * 0.4,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}
