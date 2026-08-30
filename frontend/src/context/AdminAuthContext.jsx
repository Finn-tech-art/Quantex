// Mirrors AuthContext.jsx in shape (token + profile + loading + login/logout)
// but tracks a COMPLETELY SEPARATE credential — an admin session token from
// POST /admin/auth/login, not a Supabase access token. There's no Supabase
// involvement here at all (no supabase-js, no OAuth, no getSession()) — see
// backend/app/services/admin_auth_service.py's module comment for why
// admins live outside Supabase Auth entirely. Stored under its own
// localStorage key so logging in/out of the admin panel can never interfere
// with a regular user's session in the same browser.

import { createContext, useContext, useEffect, useState } from "react";
import * as api from "../lib/api";

const AdminAuthContext = createContext(null);

const ADMIN_TOKEN_KEY = "qx_admin_token";

export function AdminAuthProvider({ children }) {
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_KEY));
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!adminToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .adminMe(adminToken)
      .then(setAdmin)
      .catch(() => {
        // Token expired/invalid (or the admin row was deleted) — same
        // "clear and fall back to logged-out" handling as AuthContext.
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        setAdminToken(null);
        setAdmin(null);
      })
      .finally(() => setLoading(false));
  }, [adminToken]);

  async function login(email, password) {
    const tokens = await api.adminLogin(email, password);
    localStorage.setItem(ADMIN_TOKEN_KEY, tokens.access_token);
    setAdminToken(tokens.access_token);
  }

  function logout() {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setAdminToken(null);
    setAdmin(null);
  }

  return (
    <AdminAuthContext.Provider value={{ adminToken, admin, loading, login, logout }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  return useContext(AdminAuthContext);
}
