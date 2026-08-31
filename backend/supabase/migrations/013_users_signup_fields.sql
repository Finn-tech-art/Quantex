-- ============================================================================
-- Add public.users.first_name / last_name / country
-- ============================================================================
-- Three new profile fields collected on the manual (email/password) signup
-- form, primarily so the admin overview dashboard can report signups by
-- country and greet users by name. All three are NULLABLE at the database
-- level — not because they're optional on the form (the Pydantic
-- SignupRequest model in models/auth.py makes all three required for new
-- manual signups), but because two other paths never go through that form
-- and can never populate them:
--   1. Every user who already exists before this migration runs.
--   2. Google OAuth signups (see AuthContext.jsx's loginWithGoogle) skip our
--      SignupRequest entirely — Supabase creates the session directly from
--      Google's redirect, so there's no request body here to read these
--      fields from. Their profile row is created by ensure_user_profile()
--      the same as everyone else's, just with all three left null.
-- A NOT NULL constraint would make either case impossible to insert, so this
-- is enforced at the application layer (the request model) instead, exactly
-- like every other "required on the form, nullable in the table" field in
-- this schema.
--
-- country is stored as an ISO 3166-1 alpha-2 code (e.g. 'US', 'KE') rather
-- than a free-text country name — see frontend/src/data/countries.js for the
-- matching dropdown list the signup form is built from. Keeping it a fixed
-- 2-letter code (rather than a foreign key into a new countries table) is
-- deliberate: it never changes, so there's nothing to look up or join, and
-- the admin dashboard can group by it directly.
-- ============================================================================

alter table public.users
  add column first_name text,
  add column last_name  text,
  add column country     text;
