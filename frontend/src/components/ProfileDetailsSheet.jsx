// The sheet HomePage's TopRow opens when you tap the avatar — a quick
// "who am I logged in as" glance (username, real name if set, email)
// without leaving Home, plus a way into AvatarPicker if you want to change
// it from here rather than going to Menu. MenuPage remains the place that
// ALSO shows this info inline in its own header (email + username +
// member-since) — this sheet exists because HomePage's header no longer
// has room for any of that once the avatar replaced the old text
// greeting (see HomePage.jsx's TopRow for that change), not because Menu's
// version needed replacing.
import { useState } from "react";
import BottomSheet from "./BottomSheet";
import Avatar from "./Avatar";
import AvatarPicker from "./AvatarPicker";

/**
 * <ProfileDetailsSheet
 *   open={profileSheetOpen}
 *   onClose={() => setProfileSheetOpen(false)}
 *   user={user}
 *   accessToken={accessToken}
 *   refreshUser={refreshUser}
 * />
 */
export default function ProfileDetailsSheet({ open, onClose, user, accessToken, refreshUser }) {
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!user) return null;

  const initial = (user.email || "?").charAt(0).toUpperCase();
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");

  return (
    <>
      <BottomSheet open={open} onClose={onClose}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-5)", marginBottom: "var(--space-8)" }}>
          <Avatar avatarUrl={user.avatar_url} avatarId={user.avatar_id} initial={initial} size={72} />
          {/* Closes THIS sheet and opens AvatarPicker as its own separate
              sheet, rather than stacking one BottomSheet on top of another
              — simpler than teaching BottomSheet about nesting for a
              transition that only ever needs to go one level deep. */}
          <button
            type="button"
            onClick={() => {
              onClose();
              setPickerOpen(true);
            }}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontFamily: "var(--font-body)",
              fontWeight: 600,
              fontSize: "12.5px",
              color: "var(--teal-base)",
            }}
          >
            Change avatar
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
          <DetailRow label="Username" value={user.username ? `@${user.username}` : "—"} />
          {fullName && <DetailRow label="Name" value={fullName} />}
          <DetailRow label="Email" value={user.email} />
        </div>
      </BottomSheet>

      <AvatarPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        accessToken={accessToken}
        currentAvatarId={user.avatar_id}
        refreshUser={refreshUser}
      />
    </>
  );
}

function DetailRow({ label, value }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontFamily: "var(--font-body)", fontWeight: 500, fontSize: "11px", color: "var(--ink-soft)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-data)", fontSize: "13px", color: "var(--ink-base)" }}>{value}</span>
    </div>
  );
}
