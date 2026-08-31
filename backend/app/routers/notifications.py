# The bell icon's three endpoints — list (with the unread badge count
# bundled into the same response so the frontend never needs a second
# round-trip just to know the badge number), mark-one-read, and
# mark-all-read. See services/notification_service.py's module docstring
# for the full design and the list of event sites that actually write rows
# here (KYC decisions, withdrawal decisions, deposit confirmations, bot
# start/stop) — this router only ever reads/updates, it never creates a
# notification itself.

from fastapi import APIRouter, Depends, HTTPException

from app.models.notification import NotificationListResponse, NotificationResponse
from app.services import notification_service
from app.utils.auth import get_current_user

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationListResponse)
def list_notifications(user: dict = Depends(get_current_user)):
    # Two separate queries (list + count) rather than deriving unread_count
    # from the list in Python — see notification_service.unread_count's own
    # comment for why: the list is capped at DEFAULT_LIST_LIMIT, so counting
    # is_read=False entries in that capped list would under-report whenever
    # there are more unread notifications than the cap.
    return NotificationListResponse(
        notifications=[
            NotificationResponse(**n) for n in notification_service.list_for_user(user["id"])
        ],
        unread_count=notification_service.unread_count(user["id"]),
    )


@router.post("/{notification_id}/read", response_model=NotificationResponse)
def mark_notification_read(notification_id: str, user: dict = Depends(get_current_user)):
    # Fired the moment the frontend dropdown renders an unread row's tap
    # (see NotificationBell.jsx) — one call per notification, not a bulk
    # operation. See mark_all_notifications_read below for the "Mark all
    # read" button's endpoint instead.
    updated = notification_service.mark_read(notification_id, user["id"])
    if updated is None:
        # Covers both "no such notification" and "exists but belongs to
        # someone else" — see notification_service.mark_read's own comment
        # for why those two cases are indistinguishable on purpose.
        raise HTTPException(status_code=404, detail="Notification not found")
    return NotificationResponse(**updated)


@router.post("/read-all")
def mark_all_notifications_read(user: dict = Depends(get_current_user)):
    notification_service.mark_all_read(user["id"])
    return {"ok": True}
