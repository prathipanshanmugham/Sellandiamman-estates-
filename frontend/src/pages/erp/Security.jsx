import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { api, errMsg, fmtDateTime, copyText, useMeta, IS_DEMO } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { PageHeader, Section, Badge } from "../../components/erp/kit";
import { Shell } from "./Login";

const svgSrc = (svg) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

export function TwoStepSetup({ onDone }) {
  const [s, setS] = useState(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const start = async () => { setErr(""); try { const { data } = await api.post("/auth/mfa/setup"); setS(data); } catch (e) { setErr(errMsg(e)); } };
  const enable = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { const { data } = await api.post("/auth/mfa/enable", { code }); setCodes(data.recovery_codes); } catch (ex) { setErr(errMsg(ex)); } finally { setBusy(false); }
  };
  if (codes) return (
    <div className="space-y-4" data-testid="mfa-recovery">
      <p className="text-sm font-semibold text-emerald-800">2-step sign-in is on.</p>
      <p className="text-sm text-slate-600">Save these recovery codes somewhere safe (not on the same phone). Each one signs you in once if you lose your phone.</p>
      <ul className="grid grid-cols-2 gap-2 bg-slate-50 p-4 font-mono text-sm">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <div className="flex gap-2"><button className="btn-line btn-sm" onClick={async () => { if (await copyText(codes.join("\n"))) toast.success("Recovery codes copied"); }}>Copy codes</button><button className="btn-dark btn-sm" onClick={onDone} data-testid="mfa-done-btn">I have saved them</button></div>
    </div>
  );
  if (!s) return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">After your password, you will also enter a 6-digit code from an authenticator app on your phone. Free apps: Google Authenticator, Microsoft Authenticator.</p>
      {err && <p className="text-sm text-red-700" role="alert">{err}</p>}
      <button className="btn-dark btn-sm" onClick={start} data-testid="mfa-start-btn">Set up 2-step sign-in</button>
    </div>
  );
  return (
    <form onSubmit={enable} className="space-y-4" data-testid="mfa-setup">
      <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700"><li>Open your authenticator app and add an account.</li><li>Scan this QR code, or type the key below.</li><li>Enter the 6-digit code the app shows.</li></ol>
      <div className="flex flex-wrap items-center gap-5"><img src={svgSrc(s.qr_svg)} alt="QR code for your authenticator app" className="h-44 w-44 border border-slate-200 bg-white p-2" data-testid="mfa-qr" />
        <div className="min-w-0"><p className="lbl">Key</p><p className="break-all font-mono text-sm" data-testid="mfa-secret">{s.secret.replace(/(.{4})/g, "$1 ").trim()}</p><button type="button" className="mt-2 text-xs underline" onClick={() => copyText(s.secret)}>Copy key</button></div></div>
      {IS_DEMO && <p className="bg-amber-50 p-2 text-xs text-amber-900">Preview: codes are not checked here, so any 6-digit number works.</p>}
      <div className="max-w-xs"><label className="lbl" htmlFor="mfa-code">Code from the app</label><input id="mfa-code" className="inp text-center font-mono text-lg tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} data-testid="mfa-enable-code" /></div>
      {err && <p className="text-sm text-red-700" role="alert">{err}</p>}
      <button className="btn-dark btn-sm" disabled={busy || code.length < 6} data-testid="mfa-enable-btn">Turn on</button>
    </form>
  );
}

export function ForcedSetup() {
  useMeta({ title: "Set up 2-step sign-in", noindex: true });
  const { refresh, logout } = useAuth();
  const nav = useNavigate();
  return (
    <Shell title="Set up 2-step sign-in">
      <p className="mt-3 text-sm text-slate-600">Your role requires a code from your phone each time you sign in. This takes about a minute.</p>
      <div className="mt-6"><TwoStepSetup onDone={async () => { await refresh(); nav("/erp"); }} /></div>
      <button className="mt-6 text-xs text-slate-500 underline" onClick={async () => { await logout(); nav("/erp/login"); }}>Sign out</button>
    </Shell>
  );
}

export default function Security() {
  useMeta({ title: "Security", noindex: true });
  const { user, refresh } = useAuth();
  const [pw, setPw] = useState({ current_password: "", new_password: "", confirm: "" });
  const [off, setOff] = useState({ password: "", code: "" });
  const [sessions, setSessions] = useState([]);
  const [setup, setSetup] = useState(false);
  const loadSessions = () => api.get("/auth/sessions").then((r) => setSessions(r.data)).catch(() => {});
  useEffect(() => { loadSessions(); }, []);
  const changePw = async (e) => {
    e.preventDefault();
    if (pw.new_password.length < 8) return toast.error("Use at least 8 characters for the new password.");
    if (pw.new_password !== pw.confirm) return toast.error("The new passwords do not match.");
    try { await api.post("/auth/change-password", { current_password: pw.current_password, new_password: pw.new_password }); toast.success("Password changed. Other devices were signed out."); setPw({ current_password: "", new_password: "", confirm: "" }); loadSessions(); } catch (ex) { toast.error(errMsg(ex)); }
  };
  const turnOff = async (e) => {
    e.preventDefault();
    try { await api.post("/auth/mfa/disable", off); toast.success("2-step sign-in turned off"); setOff({ password: "", code: "" }); refresh(); } catch (ex) { toast.error(errMsg(ex)); }
  };
  return (
    <div className="space-y-6" data-testid="security-page">
      <PageHeader title="Security" sub="Your password, 2-step sign-in and signed-in devices." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="2-step sign-in" testid="mfa-section" actions={<Badge v={user.mfa_enabled ? "on" : "off"} tone={user.mfa_enabled ? "green" : "amber"} testid="mfa-status" />}>
          {user.mfa_enabled ? (
            <form onSubmit={turnOff} className="space-y-3">
              <p className="flex items-center gap-2 text-sm text-slate-700"><ShieldCheck size={16} className="text-emerald-700" />A code from your phone is needed at every sign-in.</p>
              <p className="text-xs text-slate-500">Lost your phone? An administrator can reset 2-step sign-in from Users & Roles.</p>
              <div className="grid gap-3 sm:grid-cols-2"><div><label className="lbl" htmlFor="off-pw">Password</label><input id="off-pw" type="password" autoComplete="current-password" className="inp" value={off.password} onChange={(e) => setOff({ ...off, password: e.target.value })} /></div><div><label className="lbl" htmlFor="off-code">Code from the app</label><input id="off-code" className="inp" inputMode="numeric" value={off.code} onChange={(e) => setOff({ ...off, code: e.target.value })} /></div></div>
              <button className="btn-line btn-sm" disabled={!off.password || off.code.length < 6} data-testid="mfa-disable-btn">Turn off 2-step sign-in</button>
            </form>
          ) : setup ? <TwoStepSetup onDone={() => { setSetup(false); refresh(); loadSessions(); }} /> : (
            <div className="space-y-3"><p className="text-sm text-slate-600">Protect your account with a code from your phone in addition to your password.</p><button className="btn-dark btn-sm" onClick={() => setSetup(true)} data-testid="mfa-open-setup">Set up</button></div>
          )}
        </Section>
        <Section title="Change password" testid="password-section">
          <form onSubmit={changePw} className="grid gap-3 sm:grid-cols-3">
            <div><label className="lbl" htmlFor="cp-cur">Current</label><input id="cp-cur" type="password" autoComplete="current-password" className="inp" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} data-testid="current-password-input" /></div>
            <div><label className="lbl" htmlFor="cp-new">New (8+ characters)</label><input id="cp-new" type="password" autoComplete="new-password" className="inp" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} data-testid="new-password-input" /></div>
            <div><label className="lbl" htmlFor="cp-conf">New again</label><input id="cp-conf" type="password" autoComplete="new-password" className="inp" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} data-testid="confirm-password-input" /></div>
            <div className="sm:col-span-3"><button className="btn-dark btn-sm" disabled={!pw.current_password || !pw.new_password} data-testid="change-password-btn">Update password</button></div>
          </form>
        </Section>
      </div>
      <Section title="Signed-in devices" testid="sessions-section">
        <ul className="divide-y divide-slate-100">{sessions.map((s, i) => <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"><span className="min-w-0"><span className="block truncate text-slate-800">{s.user_agent || "Unknown device"}</span><span className="text-xs text-slate-500">{fmtDateTime(s.created_at)} · {s.ip}{s.mfa ? " · with 2-step code" : ""}</span></span>{s.current && <Badge v="this device" tone="green" />}</li>)}</ul>
      </Section>
    </div>
  );
}
