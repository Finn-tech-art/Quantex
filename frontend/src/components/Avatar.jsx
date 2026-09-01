// Shared user-identity avatar — generalized out of the local `Avatar`
// component MenuPage.jsx used to define for itself, so HomePage's TopRow
// (which shows this same avatar in place of the old plain-text greeting)
// doesn't need its own second copy of this exact logic.
//
// Precedence, in order:
//   1. The chosen hand-drawn avatar (avatarId -> AvatarGlyph.jsx). This
//      ALWAYS wins when present, including a Google-linked account that's
//      never opened the picker — avatar_id's column default is 0 (see
//      018_usernames_and_avatars.sql), so every account has a real chosen
//      avatar from the moment it's created, not just once someone
//      explicitly picks one. An earlier version of this component let a
//      real Google photo (avatarUrl) win over this unconditionally, which
//      meant picking a new avatar via AvatarPicker.jsx never visibly did
//      anything for a Google-linked account — that's backwards from what
//      "you can have an avatar from a chosen list" means, so the chosen
//      avatar is the primary identity now, full stop.
//   2. A real Google profile photo (avatarUrl) — only ever reachable if
//      avatarId is somehow absent (shouldn't happen once `user` has
//      loaded, since that column always has a value, but `user` can be
//      null/mid-load before then).
//   3. A plain initial-letter circle — the original fallback this always
//      had, for when neither of the above is available at all.
//
// Same "img with onError fallback" pattern MarketsPage.jsx's CoinLogo uses
// for step 2 — a broken/expired Google photo URL degrades to step 3
// instead of a broken-image icon. `broken` deliberately isn't reset if
// avatarUrl changes; a full remount (this component unmounting/
// remounting, e.g. on logout+login as a different user) is what naturally
// clears it back to false.
import { useState } from "react";
import AvatarGlyph from "./AvatarGlyph";

/**
 * <Avatar avatarUrl={user.avatar_url} avatarId={user.avatar_id} initial={initial} size={56} />
 */
export default function Avatar({ avatarUrl, avatarId, initial, size = 56 }) {
  const [broken, setBroken] = useState(false);

  if (avatarId != null) {
    return <AvatarGlyph avatarId={avatarId} size={size} />;
  }

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
