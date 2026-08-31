import { createContext, useContext, useEffect, useState } from "react";
import * as api from "../lib/api";
import { supabase } from "../lib/supabase";

const AuthContext = createContext(null);

const ACCESS_TOKEN_KEY = "qx_access_token";

export function AuthProvider({ children }) {
  const [accessToken, setAccessToken] = useState(() =>
    localStorage.getItem(ACCESS_TOKEN_KEY)
  );
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Resolves whichever session is authoritative on first load: an existing
  // token from a previous email/password session, or one supabase-js just
  // picked up from a Google OAuth redirect's URL fragment. Only this bootstrap
  // is allowed to decide "no token" -> loading false, so a Google redirect
  // landing here with nothing in localStorage yet can't get raced into
  // ProtectedRoute bouncing it to /login before the session resolves.
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const token = data.session?.access_token || localStorage.getItem(ACCESS_TOKEN_KEY);
      if (token) {
        localStorage.setItem(ACCESS_TOKEN_KEY, token);
        setAccessToken(token);
      } else {
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    api
      .me(accessToken)
      .then(setUser)
      .catch(() => {
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        setAccessToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [accessToken]);

  // Google sign-in completes entirely client-side: the browser goes to
  // Google, then Supabase, then back here, and supabase-js detects that
  // callback in the URL and establishes its own session automatically. This
  // bridges that session into the same token our email/password flow uses,
  // so the rest of the app — and our backend's JWT check — never needs to
  // know which provider was used.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        localStorage.setItem(ACCESS_TOKEN_KEY, session.access_token);
        setAccessToken(session.access_token);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  function applyTokens(tokens) {
    localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
    setAccessToken(tokens.access_token);
  }

  async function signup(email, password, firstName, lastName, country) {
    // Signup returns a usable session immediately — Supabase's "Confirm
    // email" gate is off, so there's no confirmation step blocking login.
    // Our own email verification is a separate, dashboard-driven OTP prompt
    // that never blocks access.
    const tokens = await api.signup(email, password, firstName, lastName, country);
    applyTokens(tokens);
  }

  async function login(email, password) {
    const tokens = await api.login(email, password);
    applyTokens(tokens);
  }

  async function loginWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  }

  async function logout() {
    await supabase.auth.signOut();
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    setAccessToken(null);
    setUser(null);
  }

  async function refreshUser() {
    if (!accessToken) return;
    const profile = await api.me(accessToken);
    setUser(profile);
  }

  return (
    <AuthContext.Provider
      value={{
        accessToken,
        user,
        loading,
        signup,
        login,
        loginWithGoogle,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
