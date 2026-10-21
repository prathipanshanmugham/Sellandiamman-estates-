import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = checking, false = signed out
  const [expired, setExpired] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/session");
      setUser(data.user || false); return data.user || false;
    } catch (e) {
      // A role that now requires 2-step sign-in: fetch the profile so the app can send them to set it up
      if (e?.response?.data?.detail === "mfa_setup_required") { try { const { data } = await api.get("/auth/me"); setUser(data); return data; } catch { /* fall through */ } }
      setUser(false); return false;
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // A revoked or expired session, or a role that now requires 2-step sign-in, sends the person to the right screen.
  useEffect(() => {
    const id = api.interceptors.response.use((r) => r, (err) => {
      const st = err?.response?.status;
      const url = err?.config?.url || "";
      if (st === 401 && !url.startsWith("/auth/") && !url.startsWith("/public/")) { setExpired(true); setUser(false); }
      if (st === 403 && err?.response?.data?.detail === "mfa_setup_required") setUser((u) => (u ? { ...u, mfa_setup_required: true } : u));
      return Promise.reject(err);
    });
    return () => api.interceptors.response.eject(id);
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    if (data.mfa_required) return data;
    setExpired(false); setSignedOut(false); setUser(data); return data;
  };
  const verifyMfa = async (mfa_token, code) => {
    const { data } = await api.post("/auth/mfa/login", { mfa_token, code });
    setExpired(false); setSignedOut(false); setUser(data); return data;
  };
  const logout = async () => { try { await api.post("/auth/logout"); } catch { /* already signed out */ } finally { setSignedOut(true); setExpired(false); setUser(false); } };
  const can = useCallback((m, a = "r") => !!user && (user.permissions?.[m] || "").includes(a), [user]);
  const value = useMemo(() => ({ user, login, verifyMfa, logout, can, refresh, expired, signedOut }), [user, can, refresh, expired, signedOut]); // eslint-disable-line react-hooks/exhaustive-deps
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
// Customer sign-ins and where each one lands. Staff use /erp.
export const PORTALS = { owner: "/owner", investor: "/investor", tenant: "/tenant", buyer: "/buyer" };
export const isPortal = (u) => !!u && u.role in PORTALS;
export const homeFor = (u) => PORTALS[u?.role] || "/erp";

function Checking() {
  return <div className="flex min-h-screen items-center justify-center p-10 text-sm text-slate-500" data-testid="auth-loading">Checking your session…</div>;
}

// Staff area: signed-in staff only; customers go to their portal; roles that require 2-step sign-in set it up first.
export function Protected({ children }) {
  const { user, signedOut } = useAuth();
  const loc = useLocation();
  if (user === null) return <Checking />;
  // After an expired session, come back to the same page; after signing out on purpose, start from the dashboard.
  if (!user) return <Navigate to="/erp/login" replace state={signedOut ? undefined : { from: loc.pathname }} />;
  if (isPortal(user)) return <Navigate to={homeFor(user)} replace />;
  if (user.mfa_setup_required && loc.pathname !== "/erp/setup-2-step") return <Navigate to="/erp/setup-2-step" replace />;
  return children;
}

// A customer portal: only that kind of customer; others are sent to their own home. Signed-out visitors go to that
// portal's sign-in page and come back to the page they asked for.
export function PortalOnly({ role, children }) {
  const { user, signedOut } = useAuth();
  const loc = useLocation();
  if (user === null) return <Checking />;
  if (!user) return <Navigate to={`/login/${role}`} replace state={signedOut ? undefined : { from: loc.pathname }} />;
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;
  if (user.mfa_setup_required) return <Navigate to="/erp/setup-2-step" replace />;
  return children;
}

export const OwnerOnly = ({ children }) => <PortalOnly role="owner">{children}</PortalOnly>;
export const InvestorOnly = ({ children }) => <PortalOnly role="investor">{children}</PortalOnly>;

export function Gate({ module, action = "r", children }) {
  const { can } = useAuth();
  if (!can(module, action)) return <div className="p-10" data-testid="access-denied"><h2 className="font-heading text-xl">Access restricted</h2><p className="mt-2 text-sm text-slate-500">Your role does not include this section. Ask an administrator if you need it.</p></div>;
  return children;
}
