# Pydantic request/response models for the notification bell module. See
# services/notification_service.py's module docstring for the full design
# (why these are pre-formatted strings rather than a template+params pair,
# which four existing services write rows here, and the lookup-table
# convention notifications.type_id follows) and routers/notifications.py
# for the three endpoints that use these models.

from datetime import datetime

from pydantic import BaseModel


class NotificationResponse(BaseModel):
    id: str
    # One of notification_types.code (see migrations/014_notifications.sql's
    # seed data for the full list: KYC_APPROVED, KYC_REJECTED,
    # WITHDRAWAL_APPROVED, WITHDRAWAL_REJECTED, DEPOSIT_CONFIRMED,
    # BOT_STARTED, BOT_STOPPED) — a plain string here, same "never leak a
    # raw numeric database id to the frontend" convention as `status` on
    # WithdrawalResponse/BotSummary elsewhere in this codebase. The
    # frontend uses this to pick which Icon.jsx glyph to show next to each
    # row (see NotificationBell.jsx's TYPE_ICON map) — add a new case there
    # too if a new type is ever added on the backend.
    type: str
    title: str
    body: str
    is_read: bool
    created_at: datetime


class NotificationListResponse(BaseModel):
    notifications: list[NotificationResponse]
    # Computed server-side from the SAME query the list above came from
    # (see notification_service.unread_count) rather than the frontend
    # counting is_read=False client-side — this way the little red badge
    # number is correct even when the list itself is capped to the most
    # recent N rows (see list_for_user's `limit` default) and there happen
    # to be more than N unread.
    unread_count: int
