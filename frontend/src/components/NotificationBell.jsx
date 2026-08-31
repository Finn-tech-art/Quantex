// The bell icon in HomePage.jsx's TopRow, now wired up for real (it used to
// be a plain decorative div with a bell glyph inside — see HomePage.jsx's
// git history). This is a Bybit-style notification bell: a small red badge
// showing how many notifications are unread, and tapping the bell opens a
// dropdown panel — anchored just below-right of the bell, not a full-screen
// sheet — listing the most recent notifications, newest first.
//
// Where the data comes from: GET /notifications (see backend/app/routers/
// notifications.py) returns BOTH the list and the unread count in one
// response, backed by services/notification_service.py. That service is
// written to by four different backend events today — a KYC decision, a
// withdrawal decision, a confirmed deposit, and a bot starting/stopping —
// see its own module docstring for the exact call sites. This component
// has no idea any of that exists; it only ever calls the three plain
// functions in lib/api.js (getNotifications / markNotificationRead /
// markAllNotificationsRead) and renders whatever comes back.
//
// Live updates: this polls on a plain setInterval rather than opening a
// dedicated WebSocket — the same pattern MarketsPage.jsx and TradePage.jsx
// already use for their own periodic refreshes, chosen here over a
// WebSocket because a notification bell doesn't need sub-second latency;
// arriving within POLL_MS of the underlying event is plenty. To switch this
// to push-based updates later, replace the interval effect below with a
// WebSocket subscription (see BotDetailPage.jsx's bot_ws for the pattern)
// and leave everything else in this file untouched — the render logic only
// cares about the `notifications` and `unreadCount` state, not how they got
// set.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "../lib/api";
import Icon from "./Icon";

// How often the bell re-fetches while mounted, in milliseconds. This keeps
// polling even while the dropdown is closed, so the little red badge number
// on the bell itself stays current without the user ever having to open it
// — lower this for fresher badge counts at the cost of more API calls, or
// raise it if this ever shows up as unnecessary backend load.
const POLL_MS = 25_000;

// How long the dropdown's open/close fade+slide transition takes, one way.
// Same two-phase mounted/entered technique BottomSheet.jsx uses (see its
// own comment on ANIMATION_MS for the full reasoning) so the exit
// transition gets to actually play instead of the panel just vanishing.
const ANIMATION_MS = 160;

// Which Icon.jsx glyph and accent color each notification `type` (see
// models/notification.py's NotificationResponse.type — one of
// notification_types.code in migrations/015_notifications.sql) renders
// with in the dropdown list. Add a row here whenever a new type is added
// on the backend; UNKNOWN_TYPE_META below is what renders if this ever
// falls behind (e.g. a new backend type shipped before this map was
// updated) so an unrecognized type still renders something reasonable
// instead of crashing.
const TYPE_META = {
  KYC_APPROVED: { icon: "shield", color: "var(--gain)" },
  KYC_REJECTED: { icon: "alertCircle", color: "var(--loss)" },
  WITHDRAWAL_APPROVED: { icon: "withdraw", color: "var(--gain)" },
  WITHDRAWAL_REJECTED: { icon: "alertCircle", color: "var(--loss)" },
  DEPOSIT_CONFIRMED: { icon: "deposit", color: "var(--gain)" },
  BOT_STARTED: { icon: "newBot", color: "var(--teal-base)" },
  BOT_STOPPED: { icon: "newBot", color: "var(--ink-soft)" },
};
const UNKNOWN_TYPE_META = { icon: "infoCircle", color: "var(--teal-base)" };

// Turns an ISO timestamp (created_at, straight off the backend) into a
// short relative label like "5m", "3h", "2d" — matching the compact style
// NewsSection's sample data already uses elsewhere on this same screen
// ("2h ago"), just without the trailing " ago" so it fits a narrower
// column next to each notification row. Falls back to a plain date once
// something is more than a week old, since "9d" starts being a less useful
// answer than the actual date at that point.
function formatRelativeTime(isoString) {
  const then = new Date(isoString).getTime();
  const diffMs = Date.now() - then;
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) return "now";
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return new Date(isoString).toLocaleDateString();
}

export default function NotificationBell() {
  const { t } = useTranslation();
  const { accessToken } = useAuth();

  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  // Same "mounted vs entered" split as BottomSheet.jsx — see that file's
  // own comment on why this needs two booleans instead of one: `open`
  // going false has to keep the panel in the DOM for ANIMATION_MS so the
  // closing transition can actually play before it disappears.
  const [entered, setEntered] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Wraps the bell button + dropdown together so the outside-click
  // listener below can tell "was this click on any part of the bell UI"
  // from "was this click somewhere else on the page" with one ref, rather
  // than needing a separate ref for the button and the panel.
  const wrapperRef = useRef(null);

  const refresh = () => {
    if (!accessToken) return;
    getNotifications(accessToken).then((res) => {
      setNotifications(res.notifications);
      setUnreadCount(res.unread_count);
    });
    // No .catch() here deliberately — a failed poll just leaves the
    // previous state on screen until the next successful one, which reads
    // as "hasn't updated yet," not as a visible error. A notification bell
    // failing to refresh silently is the right failure mode; it doesn't
    // deserve a toast the way a failed Buy/Sell or withdrawal would.
  };

  // Initial load + the recurring poll. Runs once per mount (and again if
  // accessToken ever changes, e.g. after a fresh login) — see POLL_MS's
  // comment above for how to change the refresh cadence.
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  // Two-phase open/close animation — identical structure to BottomSheet.jsx's
  // own mount effect, just with a much shorter ANIMATION_MS since this is a
  // small dropdown, not a full sheet sliding up from the bottom of the
  // screen.
  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }
    if (mounted) {
      setEntered(false);
      const timer = setTimeout(() => setMounted(false), ANIMATION_MS);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Outside-click-to-close: a mousedown anywhere that isn't inside
  // wrapperRef (the bell button or the dropdown itself) closes the panel.
  // Only attached while the dropdown is actually open, so a closed bell
  // costs nothing extra on every click anywhere in the app.
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Escape closes it too, same as BottomSheet.jsx's own keyboard handling.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const handleRowClick = (notification) => {
    if (notification.is_read) return;
    // Optimistic — flips this row's is_read locally and drops the badge
    // count by one immediately, rather than waiting on the network
    // round-trip, since a tap-to-read action should feel instant. If the
    // request below actually fails, the next POLL_MS refresh() call
    // quietly corrects the count back — no error surfaced to the user for
    // the same reason refresh() itself has no .catch() above.
    setNotifications((prev) =>
      prev.map((n) => (n.id === notification.id ? { ...n, is_read: true } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
    markNotificationRead(accessToken, notification.id).catch(() => {});
  };

  const handleMarkAllRead = () => {
    if (unreadCount === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    markAllNotificationsRead(accessToken).catch(() => {});
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("notifications.title")}
        style={{
          width: 34,
          height: 34,
          borderRadius: "var(--radius-full)",
          background: "var(--cream-deep)",
          border: "1px solid var(--cream-line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          cursor: "pointer",
          position: "relative",
        }}
      >
        <Icon name="bell" size={17} color="var(--ink-soft)" />

        {/* The unread badge — only rendered at all when there's something
            to show, same "render nothing rather than an empty shell" rule
            Toast.jsx follows for its own container. Caps its label at "9+"
            once double digits would visually crowd a circle sized for a
            single character; the real unreadCount is never truncated in
            the backend response, only in this displayed label. */}
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: -2,
              right: -2,
              minWidth: 16,
              height: 16,
              padding: "0 3px",
              borderRadius: "var(--radius-full)",
              background: "var(--loss)",
              color: "var(--on-accent)",
              fontFamily: "var(--font-data)",
              fontSize: "9px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
              border: "1.5px solid var(--cream-base)",
            }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {mounted && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 320,
            // Clamps the panel so it never overflows a narrow phone
            // viewport when the bell itself sits close to the screen
            // edge — 100vw minus 2*20px matches HomePage's own left/right
            // page padding (see HomePage.jsx's outer div's `padding: "0
            // 20px"`), so the dropdown's edge lines up with the rest of
            // the page content instead of floating past it.
            maxWidth: "calc(100vw - 40px)",
            maxHeight: 420,
            display: "flex",
            flexDirection: "column",
            background: "var(--cream-base)",
            border: "1px solid var(--cream-line)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-dropdown)",
            zIndex: 50,
            opacity: entered ? 1 : 0,
            transform: entered ? "translateY(0)" : "translateY(-6px)",
            transition: `opacity ${ANIMATION_MS}ms ease, transform ${ANIMATION_MS}ms ease`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "var(--space-6) var(--space-8)",
              borderBottom: "1px solid var(--cream-line)",
              flexShrink: 0,
            }}
          >
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "13.5px", color: "var(--ink-base)" }}>
              {t("notifications.title")}
            </span>
            {/* Only shown when there's actually something unread to clear
                — an always-visible "Mark all read" that does nothing on
                tap would just be confusing. */}
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "11.5px",
                  color: "var(--teal-base)",
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                {t("notifications.markAllRead")}
              </button>
            )}
          </div>

          <div style={{ overflowY: "auto" }}>
            {notifications.length === 0 ? (
              <div style={{ padding: "var(--space-16) var(--space-8)", textAlign: "center" }}>
                <span style={{ fontFamily: "var(--font-body)", fontSize: "12.5px", color: "var(--ink-soft)" }}>
                  {t("notifications.empty")}
                </span>
              </div>
            ) : (
              notifications.map((n) => {
                const meta = TYPE_META[n.type] || UNKNOWN_TYPE_META;
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleRowClick(n)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "var(--space-6)",
                      padding: "var(--space-6) var(--space-8)",
                      background: "none",
                      border: "none",
                      borderBottom: "1px solid var(--cream-line)",
                      textAlign: "left",
                      cursor: n.is_read ? "default" : "pointer",
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        flexShrink: 0,
                        borderRadius: "var(--radius-full)",
                        background: "var(--cream-deep)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon name={meta.icon} size={14} color={meta.color} />
                    </div>

                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                        <span
                          style={{
                            fontFamily: "var(--font-body)",
                            fontWeight: n.is_read ? 500 : 700,
                            fontSize: "12.5px",
                            color: "var(--ink-base)",
                          }}
                        >
                          {n.title}
                        </span>
                        {/* Unread dot — the same visual role as the badge
                            on the bell itself, just per-row. Absent
                            entirely once a row is read, rather than
                            rendered in a "read" color, so scanning the
                            list for what's new is a quick visual scan for
                            dots rather than having to read every row. */}
                        {!n.is_read && (
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "var(--radius-full)",
                              background: "var(--teal-base)",
                              flexShrink: 0,
                            }}
                          />
                        )}
                      </div>
                      <span style={{ fontFamily: "var(--font-body)", fontSize: "11.5px", color: "var(--ink-soft)" }}>
                        {n.body}
                      </span>
                    </div>

                    <span
                      style={{
                        fontFamily: "var(--font-data)",
                        fontSize: "9.5px",
                        color: "var(--ink-soft)",
                        flexShrink: 0,
                        paddingTop: 1,
                      }}
                    >
                      {formatRelativeTime(n.created_at)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
