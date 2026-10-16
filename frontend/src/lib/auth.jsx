import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const refresh = useCallback(async () => {
    try { const { data } = await api.get("/auth/me"); setUser(data); } catch { setUser(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const login = async (email, password) => { const { data } = await api.post("/auth/login", { email, password }); setUser(data); return data; };
  const logout = async () => { try { await api.post("/auth/logout"); } finally { setUser(false); } };
  const can = (m, a = "r") => !!user && (user.permissions?.[m] || "").includes(a);
  return <AuthCtx.Provider value={{ user, login, logout, can, refresh }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

export function Protected({ children }) {
  const { user } = useAuth();
  const loc = useLocation();
  if (user === null) return <div className="p-10 text-sm text-slate-500" data-testid="auth-loading">Checking session…</div>;
  if (!user) return <Navigate to="/erp/login" replace state={{ from: loc.pathname }} />;
  return children;
}

export function Gate({ module, action = "r", children }) {
  const { can } = useAuth();
  if (!can(module, action)) return <div className="p-10" data-testid="access-denied"><h2 className="font-heading text-xl">Access restricted</h2><p className="text-sm text-slate-500 mt-2">Your role does not have permission to view this section.</p></div>;
  return children;
}
