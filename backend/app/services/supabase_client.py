from functools import lru_cache

from supabase import Client, create_client

from app.config import settings


@lru_cache
def get_supabase() -> Client:
    """Long-lived, service-role client for privileged table access and auth.admin.*
    calls. Never call auth.sign_up / sign_in_with_password / refresh_session / get_user
    on this client — supabase-py's gotrue layer saves the resulting session onto the
    client itself and overwrites its postgrest Authorization header with that end
    user's JWT, silently downgrading every later .table() query on this shared
    singleton from service_role to whichever user authenticated most recently.
    Use get_supabase_auth_client() for those instead."""
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def get_supabase_auth_client() -> Client:
    """Fresh, uncached client for a single user-facing auth operation (sign_up,
    sign_in_with_password, refresh_session, get_user). A new instance is created
    per call, on purpose, so the session it saves has nothing else to contaminate —
    see get_supabase()'s docstring."""
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
