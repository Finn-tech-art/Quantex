-- ============================================================================
-- Add public.users.email_verified
-- ============================================================================
-- With Supabase's project-level "Confirm email" setting turned off (required for
-- the dashboard-driven signup flow), auth.users.email_confirmed_at gets set for
-- every user automatically at signup time, before any confirmation ever happens —
-- so it can no longer be used as the signal for "has this user completed our
-- custom OTP email-verification step." This column replaces it as that signal,
-- driven entirely by POST /auth/verify-email/confirm.
-- ============================================================================

alter table public.users
  add column email_verified boolean not null default false;
