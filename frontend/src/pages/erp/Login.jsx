import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, errMsg, useMeta, asset, IS_DEMO } from "../../lib/api";
import { useAuth, homeFor } from "../../lib/auth";
import { Logo } from "../../components/brand/Logo";

// Each sign-in has its own page and words, so tenants, owners, buyers, investors and staff each land somewhere that
// speaks to them. They all use the same accounts API; the account's role decides where it goes after signing in.
export const KINDS = {
  customer: { title: "Customer login", img: "/images/apartment2.jpg", aside: "Rent, bills, statements, purchases and investments with Sellandiamman, in one place." },
  staff: { title: "Staff sign in", img: "/images/commercial.jpg", aside: "Leads, listings, leases and money for Sellandiamman Estates, in one place.",
    note: "For the Sellandiamman team. Customers sign in from the Customer login page." },
  tenant: { title: "Tenant sign in", img: "/images/apartment2.jpg", aside: "Your rent, receipts, EB and water bills, deposit and repair requests, in one place.",
    note: "Your login is created by your property manager. Ask them for an invite if you do not have one." },
  owner: { title: "Owner / lessor sign in", img: "/images/villa.jpg", aside: "Rent collected for you, monthly statements, bills, repairs and documents for every property we manage.",
    note: "Your login is created by our team when we manage or list your property." },
  buyer: { title: "Buyer sign in", img: "/images/house.jpg", aside: "Follow your purchase step by step: visits, homes picked for you, documents and help with loans and registration.",
    note: "Your login is created by your relationship manager." },
  investor: { title: "Investor sign in", img: "/images/estate.jpg", aside: "Your holdings, value, payouts and statements, with updates from every project.",
    note: "Your login is created by your relationship manager." },
};

export function Shell({ title, children, kind = "staff" }) {
  const k = KINDS[kind] || KINDS.staff;
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden lg:block"><img src={asset(k.img)} alt="" className="absolute inset-0 h-full w-full object-cover" /><div className="absolute inset-0 bg-slate-900/70" />
        <div className="relative flex h-full flex-col justify-between p-10"><Link to="/" aria-label="Sellandiamman Estates home"><Logo tone="dark" size="lg" /></Link><p className="max-w-md font-heading text-3xl text-white" data-testid="login-aside">{k.aside}</p></div>
      </div>
      <div className="flex items-center justify-center p-6"><div className="w-full max-w-sm"><div className="lg:hidden"><Link to="/" aria-label="Sellandiamman Estates home"><Logo /></Link></div><h1 className="mt-8 font-heading text-2xl font-semibold" data-testid="login-title">{title}</h1>{children}<Link to="/" className="mt-8 block text-xs text-slate-500 hover:underline">← Back to website</Link></div></div>
    </div>
  );
}

export function Login({ kind = "staff" }) {
  const k = KINDS[kind] || KINDS.staff;
  useMeta({ title: k.title, noindex: true });
  const { user, login, verifyMfa, expired } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [f, setF] = useState({ email: "", password: "" });
  const [st, setSt] = useState({ busy: false, err: "" });
  const [mode, setMode] = useState("login"); // login | forgot | mfa
  const [mfa, setMfa] = useState({ token: "", code: "" });
  const [sent, setSent] = useState("");
  const from = loc.state?.from || "";
  const dest = (u) => (from && from.startsWith(homeFor(u)) ? from : homeFor(u));
  if (user) return <Navigate to={dest(user)} replace />;
  const submit = async (e) => {
    e.preventDefault(); setSt({ busy: true, err: "" });
    try {
      if (mode === "forgot") { const { data } = await api.post("/auth/forgot-password", { email: f.email }); setSent(data.message); setSt({ busy: false, err: "" }); return; }
      if (mode === "mfa") { const u = await verifyMfa(mfa.token, mfa.code); nav(dest(u)); return; }
      const r = await login(f.email, f.password);
      if (r.mfa_required) { setMfa({ token: r.mfa_token, code: "" }); setMode("mfa"); setSt({ busy: false, err: "" }); return; }
      nav(dest(r));
    } catch (ex) { setSt({ busy: false, err: errMsg(ex) }); }
  };
  const title = { login: k.title, forgot: "Reset your password", mfa: "Enter your 6-digit code" }[mode];
  return (
    <Shell title={title} kind={kind}>
      {expired && mode === "login" && <p className="mt-4 bg-amber-50 p-3 text-sm text-amber-900" data-testid="session-expired">Your session ended. Please sign in again.</p>}
      <form onSubmit={submit} className="mt-6 space-y-4" data-testid="login-form">
        {mode !== "mfa" && <div><label className="lbl" htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" required className="inp" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="login-email-input" /></div>}
        {mode === "login" && <div><label className="lbl" htmlFor="pw">Password</label><input id="pw" type="password" autoComplete="current-password" required className="inp" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} data-testid="login-password-input" /></div>}
        {mode === "mfa" && <div>
          <p className="mb-3 text-sm text-slate-600">Open your authenticator app (Google Authenticator, Microsoft Authenticator or similar) and enter the code for Sellandiamman Estates. Lost your phone? Enter one of your recovery codes.</p>
          {IS_DEMO && <p className="mb-3 bg-amber-50 p-2 text-xs text-amber-900">Preview: any 6-digit code works (except 000000).</p>}
          <label className="lbl" htmlFor="code">Code</label><input id="code" className="inp text-center font-mono text-lg tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={11} value={mfa.code} onChange={(e) => setMfa({ ...mfa, code: e.target.value })} data-testid="mfa-code-input" />
        </div>}
        {st.err && <p className="text-sm text-red-700" role="alert" data-testid="login-error">{st.err}</p>}
        {sent && <p className="text-sm text-emerald-700" data-testid="forgot-success">{sent}</p>}
        <button className="btn-dark w-full" disabled={st.busy} data-testid="login-submit-btn">{st.busy ? "Please wait…" : { login: "Sign in", forgot: "Send reset link", mfa: "Verify" }[mode]}</button>
        {mode !== "mfa"
          ? <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => { setMode(mode === "forgot" ? "login" : "forgot"); setSent(""); setSt({ busy: false, err: "" }); }} data-testid="forgot-toggle">{mode === "forgot" ? "Back to sign in" : "Forgot password?"}</button>
          : <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => { setMode("login"); setSt({ busy: false, err: "" }); }}>Use a different account</button>}
        <p className="text-xs text-slate-400">{k.note} There is no public sign-up.</p>
        {kind === "staff" ? <Link to="/login" className="block text-xs text-slate-500 underline" data-testid="customer-login-link">Customer login</Link>
          : <Link to="/login" className="block text-xs text-slate-500 underline" data-testid="other-login-link">Not a {kind === "owner" ? "property owner" : kind}? Choose another login</Link>}
      </form>
    </Shell>
  );
}

export function ResetPassword() {
  useMeta({ title: "Set a password", noindex: true });
  const [params] = useSearchParams();
  const [pw, setPw] = useState({ a: "", b: "" });
  const [st, setSt] = useState({ busy: false, err: "", ok: false });
  const submit = async (e) => {
    e.preventDefault();
    if (pw.a.length < 8) return setSt({ busy: false, err: "Use at least 8 characters.", ok: false });
    if (pw.a !== pw.b) return setSt({ busy: false, err: "The two passwords do not match.", ok: false });
    setSt({ busy: true, err: "", ok: false });
    try { const r = await api.post("/auth/reset-password", { token: params.get("token"), password: pw.a }); setSt({ busy: false, err: "", ok: true, portal: r.data?.portal }); }
    catch (ex) { setSt({ busy: false, err: errMsg(ex), ok: false }); }
  };
  return (
    <Shell title="Set your password">
      {st.ok ? <p className="mt-6 text-sm text-emerald-700" data-testid="reset-success">Password saved. <Link to={st.portal ? `/login/${st.portal}` : "/erp/login"} className="underline">Sign in</Link></p> :
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div><label className="lbl" htmlFor="np1">New password (at least 8 characters)</label><input id="np1" type="password" autoComplete="new-password" minLength={8} required className="inp" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} data-testid="reset-password-input" /></div>
          <div><label className="lbl" htmlFor="np2">Type it again</label><input id="np2" type="password" autoComplete="new-password" required className="inp" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} data-testid="reset-password-confirm" /></div>
          {st.err && <p className="text-sm text-red-700" role="alert">{st.err}</p>}
          <button className="btn-dark w-full" disabled={st.busy} data-testid="reset-submit-btn">Save password</button>
        </form>}
    </Shell>
  );
}

export { homeFor };

const CHOICES = [
  ["tenant", "Tenant", "I rent a home, shop or office managed by Sellandiamman.", "See rent and receipts, EB and water bills, your deposit, and raise repair or cleaning requests."],
  ["owner", "Owner / lessor", "Sellandiamman manages, lets or sells my property.", "Rent collected for you, statements, tenant bills, repairs and documents."],
  ["buyer", "Buyer", "I am buying or renting through Sellandiamman.", "Your purchase progress, site visits, homes picked for you, loan and registration help."],
  ["investor", "Investor", "I have invested in a Sellandiamman project.", "Holdings, value, payouts, statements and project updates."],
];

export function CustomerLogin() {
  useMeta({ title: "Customer login", description: "Sign in to your Sellandiamman Estates tenant, owner, buyer or investor account.", noindex: true });
  const { user } = useAuth();
  if (user && user.role) return <Navigate to={homeFor(user)} replace />;
  return (
    <Shell title="Customer login" kind="customer">
      <p className="mt-2 text-sm text-slate-600">Choose how you work with us.</p>
      <div className="mt-6 space-y-3" data-testid="login-choices">
        {CHOICES.map(([k, t, who, what]) => (
          <Link key={k} to={`/login/${k}`} className="block border border-slate-200 bg-white p-4 transition-colors hover:border-slate-900" data-testid={`login-choice-${k}`}>
            <p className="font-heading text-base font-semibold text-slate-900">{t}</p>
            <p className="mt-0.5 text-sm text-slate-600">{who}</p>
            <p className="mt-1 text-xs text-slate-500">{what}</p>
          </Link>
        ))}
      </div>
      <p className="mt-6 text-xs text-slate-500">Logins are created by our team, there is no public sign-up. Need one? Call or WhatsApp your branch from the <Link to="/contact" className="underline">contact page</Link>.</p>
    </Shell>
  );
}

export function LoginByType() {
  const { type } = useParams();
  if (!KINDS[type] || type === "staff" || type === "customer") return <Navigate to="/login" replace />;
  return <Login key={type} kind={type} />;
}
