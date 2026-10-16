import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api, errMsg, useTitle } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Wordmark } from "../../components/public/SiteLayout";

function Shell({ title, children }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden lg:block"><img src="/images/commercial.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" /><div className="absolute inset-0 bg-slate-900/60" /><div className="relative p-10"><Wordmark dark /><p className="mt-[50vh] max-w-sm font-heading text-3xl text-white">Operations, CRM and finance for Sellandiamman Estates.</p></div></div>
      <div className="flex items-center justify-center p-6"><div className="w-full max-w-sm"><div className="lg:hidden"><Wordmark /></div><h1 className="mt-8 font-heading text-2xl font-semibold">{title}</h1>{children}<Link to="/" className="mt-8 block text-xs text-slate-500 hover:underline">← Back to website</Link></div></div>
    </div>
  );
}

export function Login() {
  useTitle("Staff login");
  const { user, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [f, setF] = useState({ email: "", password: "" });
  const [st, setSt] = useState({ busy: false, err: "" });
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState("");
  if (user) return <Navigate to={loc.state?.from || "/erp"} replace />;
  const submit = async (e) => {
    e.preventDefault(); setSt({ busy: true, err: "" });
    try {
      if (forgot) { const { data } = await api.post("/auth/forgot-password", { email: f.email }); setSent(data.message); setSt({ busy: false, err: "" }); return; }
      await login(f.email, f.password); nav(loc.state?.from || "/erp");
    } catch (ex) { setSt({ busy: false, err: errMsg(ex) }); }
  };
  return (
    <Shell title={forgot ? "Reset your password" : "Staff login"}>
      <form onSubmit={submit} className="mt-6 space-y-4" data-testid="login-form">
        <div><label className="lbl" htmlFor="email">Email</label><input id="email" type="email" required className="inp" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="login-email-input" /></div>
        {!forgot && <div><label className="lbl" htmlFor="pw">Password</label><input id="pw" type="password" required className="inp" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} data-testid="login-password-input" /></div>}
        {st.err && <p className="text-sm text-red-700" role="alert" data-testid="login-error">{st.err}</p>}
        {sent && <p className="text-sm text-emerald-700" data-testid="forgot-success">{sent}</p>}
        <button className="btn-dark w-full" disabled={st.busy} data-testid="login-submit-btn">{st.busy ? "Please wait…" : forgot ? "Send reset link" : "Sign in"}</button>
        <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => { setForgot(!forgot); setSent(""); }} data-testid="forgot-toggle">{forgot ? "Back to sign in" : "Forgot password?"}</button>
        <p className="text-xs text-slate-400">Accounts are created by an administrator. There is no public sign-up.</p>
      </form>
    </Shell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const [pw, setPw] = useState("");
  const [st, setSt] = useState({ busy: false, err: "", ok: false });
  const submit = async (e) => {
    e.preventDefault(); setSt({ busy: true, err: "", ok: false });
    try { await api.post("/auth/reset-password", { token: params.get("token"), password: pw }); setSt({ busy: false, err: "", ok: true }); }
    catch (ex) { setSt({ busy: false, err: errMsg(ex), ok: false }); }
  };
  return (
    <Shell title="Set a new password">
      {st.ok ? <p className="mt-6 text-sm text-emerald-700" data-testid="reset-success">Password updated. <Link to="/erp/login" className="underline">Sign in</Link></p> :
        <form onSubmit={submit} className="mt-6 space-y-4"><div><label className="lbl">New password (min 8 characters)</label><input type="password" minLength={8} required className="inp" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="reset-password-input" /></div>{st.err && <p className="text-sm text-red-700">{st.err}</p>}<button className="btn-dark w-full" disabled={st.busy} data-testid="reset-submit-btn">Update password</button></form>}
    </Shell>
  );
}
