# One-off CLI for seeding/updating the single superadmin account. There is no
# HTTP signup endpoint for admins on purpose (see admin_auth_service.py's
# module comment) — this is the only way an `admins` row ever gets created or
# has its password changed. Matches the build-plan checklist's "Set
# admin@quantex.com password" step.
#
# Run from backend/ with the venv active:
#   python -m app.utils.create_admin admin@quantex.com
#
# It prompts for the password interactively (getpass — never typed where
# shell history or a process list could capture it) and upserts by email: a
# fresh email creates a new admins row, an existing one just gets its
# password_hash replaced (e.g. to rotate the password later).

import argparse
import getpass
import sys

from app.services.admin_auth_service import hash_password
from app.services.supabase_client import get_supabase


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update the Quantex admin account")
    parser.add_argument("email", help="Admin login email, e.g. admin@quantex.com")
    args = parser.parse_args()

    password = getpass.getpass("New admin password: ")
    confirm = getpass.getpass("Confirm password: ")
    if password != confirm:
        print("Passwords did not match — aborted.", file=sys.stderr)
        sys.exit(1)
    if len(password) < 12:
        # Not the withdrawal-OTP-grade throttling this really deserves
        # eventually (see Phase 4's note on that), but a cheap floor against
        # an accidentally trivial password on the account that can move the
        # daily win rate.
        print("Password must be at least 12 characters — aborted.", file=sys.stderr)
        sys.exit(1)

    password_hash = hash_password(password)

    existing = (
        get_supabase().table("admins").select("id").eq("email", args.email).limit(1).execute().data
    )
    if existing:
        get_supabase().table("admins").update({"password_hash": password_hash}).eq(
            "email", args.email
        ).execute()
        print(f"Updated password for existing admin: {args.email}")
    else:
        get_supabase().table("admins").insert(
            {"email": args.email, "password_hash": password_hash}
        ).execute()
        print(f"Created new admin: {args.email}")


if __name__ == "__main__":
    main()
