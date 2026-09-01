// The grid-of-avatars sheet used to change a user's chosen avatar — opened
// from MenuPage's header (tap the avatar directly, since Menu is already
// "manage your profile") and from HomePage's ProfileDetailsSheet (a
// "Change avatar" row inside the identity-details view). Both call sites
// share this one component rather than each wiring up their own copy of
// the PUT /auth/avatar call + BottomSheet + grid.
//
// Self-contained: this owns the actual save (calls setAvatar() then
// refreshUser() so every screen reading `user.avatar_id` from AuthContext
// picks up the change immediately) rather than handing a raw onChange back
// to the caller — there's only ever one real way to "save a chosen
// avatar" in this app, so there's nothing a call site would ever need to
// do differently.
import { useState } from "react";
import BottomSheet from "./BottomSheet";
import AvatarGlyph, { AVATAR_OPTIONS } from "./AvatarGlyph";
import { ErrorText } from "./FormControls";
import { setAvatar } from "../lib/api";

/**
 * <AvatarPicker
 *   open={pickerOpen}
 *   onClose={() => setPickerOpen(false)}
 *   accessToken={accessToken}
 *   currentAvatarId={user.avatar_id}
 *   refreshUser={refreshUser}
 * />
 */
export default function AvatarPicker({ open, onClose, accessToken, currentAvatarId, refreshUser }) {
  // Tracks the specific avatarId currently being saved (not just a plain
  // boolean) so the tapped option can show its own loading state without
  // needing a second piece of state — see the disabled/opacity styling
  // below.
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState(null);

  async function handleSelect(avatarId) {
    if (avatarId === currentAvatarId || savingId !== null) return;
    setError(null);
    setSavingId(avatarId);
    try {
      await setAvatar(accessToken, avatarId);
      await refreshUser();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "16px", color: "var(--ink-base)", marginBottom: "var(--space-6)" }}>
        Choose an avatar
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-6)", justifyItems: "center" }}>
        {AVATAR_OPTIONS.map((_, avatarId) => {
          const selected = avatarId === currentAvatarId;
          const saving = savingId === avatarId;
          return (
            <button
              key={avatarId}
              type="button"
              onClick={() => handleSelect(avatarId)}
              disabled={savingId !== null}
              style={{
                background: "none",
                border: "none",
                padding: 3,
                borderRadius: "50%",
                cursor: savingId !== null ? "default" : "pointer",
                // A ring around the currently-active avatar — same pattern
                // TradePage's old pair-tab accent ring and SelectField's
                // selected-row highlight already use elsewhere in this
                // app, so "this one is picked" reads consistently no
                // matter which picker you're looking at.
                boxShadow: selected ? "0 0 0 2.5px var(--teal-base)" : "none",
                opacity: saving ? 0.5 : 1,
                transition: "box-shadow 0.2s ease, opacity 0.2s ease",
              }}
            >
              <AvatarGlyph avatarId={avatarId} size={52} />
            </button>
          );
        })}
      </div>

      {error && (
        <div style={{ marginTop: "var(--space-6)" }}>
          <ErrorText message={error} />
        </div>
      )}
    </BottomSheet>
  );
}
