-- ============================================================================
-- Phase 4 — private Supabase Storage bucket for KYC identity documents
-- ============================================================================
-- Every ID front/back photo and selfie a user uploads (see kyc_submissions'
-- id_front_url/id_back_url/selfie_url columns, which store OBJECT PATHS
-- within this bucket, not public URLs — there is no such thing as a public
-- URL for a private bucket) lands here. `public = false` means Supabase's
-- own anonymous/public file-serving endpoint refuses every request for an
-- object in this bucket outright, regardless of RLS — that's the first,
-- strongest layer of "nobody just guesses a URL and views someone's ID".
--
-- Deliberately NO storage.objects RLS policies are added here for this
-- bucket — same reasoning already used for admins / admin_audit_log /
-- daily_win_rate_settings in 006_admin_win_rate.sql: every read or write
-- this app ever does against this bucket goes through kyc_service.py using
-- the backend's service-role Supabase client (see supabase_client.py's
-- get_supabase()), which bypasses RLS entirely. Zero policies for the
-- anon/authenticated roles means those roles have zero access no matter
-- what — the only way to ever see a document is a short-expiry SIGNED URL
-- that kyc_service.py generates on demand for an authenticated admin
-- reviewing a submission (see admin_kyc_service's create_signed_url calls).
--
-- To rename the bucket, change the id/name below AND
-- app/config.py's kyc_documents_bucket setting to match — they must agree.
insert into storage.buckets (id, name, public)
values ('kyc-documents', 'kyc-documents', false)
on conflict (id) do nothing;
