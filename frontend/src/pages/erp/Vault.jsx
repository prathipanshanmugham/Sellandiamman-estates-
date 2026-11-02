import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Copy, Eye, EyeOff, ExternalLink, KeyRound, Lock, LockOpen, RefreshCw, Timer, Plus, Trash2, History, Wand2 } from "lucide-react";
import { api, errMsg, fmtDate, fmtDateTime, label, copyText } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useDialog } from "../../lib/dialogs";
import { PageHeader, DataTable, Badge, Modal, Section, useList, act } from "../../components/erp/kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";

// ---------- Password generator and strength ----------
const SETS = { lower: "abcdefghijkmnopqrstuvwxyz", upper: "ABCDEFGHJKLMNPQRSTUVWXYZ", digits: "23456789", symbols: "!@#$%^&*-_=+?" };
export function generatePassword(len = 16, symbols = true) {
  const pools = [SETS.lower, SETS.upper, SETS.digits, ...(symbols ? [SETS.symbols] : [])];
  const all = pools.join("");
  const rnd = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  const out = pools.map((p) => p[rnd(p.length)]);
  while (out.length < len) out.push(all[rnd(all.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = rnd(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join("");
}
export function strength(pw) {
  if (!pw) return null;
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 20;
  const bits = pw.length * Math.log2(Math.max(pool, 2));
  return bits >= 75 ? ["Strong", "bg-emerald-600", 100] : bits >= 55 ? ["Good", "bg-emerald-500", 70] : bits >= 40 ? ["Fair", "bg-amber-500", 45] : ["Weak", "bg-red-600", 20];
}

function useCountdown(until) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!until) { setLeft(0); return undefined; }
    const tick = () => setLeft(Math.max(0, Math.round(until - Date.now() / 1000)));
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t);
  }, [until]);
  return left;
}

function Unlock({ open, onClose, mfa, onDone }) {
  const [v, setV] = useState({ password: "", code: "" });
  const [st, setSt] = useState({ busy: false, err: "" });
  useEffect(() => { if (open) { setV({ password: "", code: "" }); setSt({ busy: false, err: "" }); } }, [open]);
  const submit = async (e) => {
    e.preventDefault(); setSt({ busy: true, err: "" });
    try { const r = await api.post("/vault/unlock", { password: v.password, code: v.code || null }); onDone(r.data.until); onClose(); }
    catch (ex) { setSt({ busy: false, err: errMsg(ex) }); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Unlock the vault">
      <form onSubmit={submit} className="space-y-4" data-testid="vault-unlock-form">
        <p className="text-sm text-slate-600">Enter your own sign-in password{mfa ? " and the code from your authenticator app" : ""}. The vault stays open for 15 minutes on this browser; everything you open or copy is recorded.</p>
        <div><label className="lbl" htmlFor="vu-pw">Your password</label><input id="vu-pw" type="password" autoComplete="current-password" className="inp" required autoFocus value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} data-testid="vault-password" /></div>
        {mfa && <div><label className="lbl" htmlFor="vu-code">6-digit code</label><input id="vu-code" inputMode="numeric" className="inp font-mono tracking-[0.3em]" maxLength={6} required value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} data-testid="vault-code" /></div>}
        {st.err && <p className="text-sm text-red-700" role="alert" data-testid="vault-unlock-error">{st.err}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" className="btn-line" onClick={onClose}>Cancel</button><button className="btn-dark" disabled={st.busy} data-testid="vault-unlock-submit"><LockOpen size={15} />Unlock</button></div>
      </form>
    </Modal>
  );
}

const ROLE_SHORT = { branch_manager: "branch managers", sales_agent: "sales", property_manager: "property managers", accountant: "finance", marketing: "marketing", shortstay_ops: "short-stay team", auditor: "auditors" };
const EMPTY = { title: "", preset: "", category: "", url: "", username: "", password: "", totp_secret: "", notes: "", fields: [], share_roles: [], share_users: [], rotate_days: 0, property_ids: [] };

function ItemForm({ open, onClose, item, meta, users, props, onSaved, ensureUnlocked }) {
  const [v, setV] = useState(EMPTY);
  const [show, setShow] = useState(false);
  const [removeTotp, setRemoveTotp] = useState(false);
  const [st, setSt] = useState({ busy: false, err: "" });
  const editing = !!item;
  useEffect(() => {
    if (!open) return;
    setShow(false); setRemoveTotp(false); setSt({ busy: false, err: "" });
    if (!item) { setV(EMPTY); return; }
    const base = { ...EMPTY, ...item, password: "", totp_secret: "", notes: "", fields: (item.fields_public || []).map((f) => ({ ...f, secret: false })) };
    setV(base);
    // secret notes and fields are filled in from the vault so they can be edited (each read is logged)
    (async () => {
      const notes = item.has_notes ? (await api.post(`/vault/items/${item.id}/reveal`, { field: "notes" }).catch(() => null))?.data?.value || "" : "";
      const sec = [];
      for (const l of item.secret_labels || []) { const r = await api.post(`/vault/items/${item.id}/reveal`, { field: `field:${l}` }).catch(() => null); sec.push({ label: l, value: r?.data?.value || "", secret: true }); }
      setV((x) => ({ ...x, notes, fields: [...x.fields, ...sec] }));
    })();
  }, [open, item]);
  const pick = (key) => {
    const p = meta.presets.find((x) => x.key === key);
    if (!p) return setV({ ...v, preset: key });
    setV({ ...v, preset: key, title: v.title || p.name, url: v.url || p.url || "", category: p.category, rotate_days: p.rotate_days || 0,
      fields: v.fields.length ? v.fields : (p.fields || []).map((l) => ({ label: l, value: "", secret: false })) });
  };
  const s = strength(v.password);
  const preset = meta.presets.find((x) => x.key === v.preset);
  const submit = async (e) => {
    e.preventDefault();
    if (!(await ensureUnlocked())) return;
    setSt({ busy: true, err: "" });
    const body = { title: v.title, category: v.category || undefined, url: v.url || null, username: v.username || null, fields: v.fields.filter((f) => f.label.trim()),
      share_roles: v.share_roles, share_users: v.share_users, rotate_days: Number(v.rotate_days || 0), property_ids: v.property_ids, notes: v.notes || null };
    if (!editing || v.password) body.password = v.password || null;
    if (!editing || v.totp_secret) body.totp_secret = v.totp_secret || null;
    if (editing && removeTotp) body.totp_secret = null;
    try {
      const r = editing ? await api.patch(`/vault/items/${item.id}`, body) : await api.post("/vault/items", { ...body, preset: v.preset || "other" });
      onSaved(r.data); onClose(); toast.success(editing ? "Saved" : "Login added");
    } catch (ex) { setSt({ busy: false, err: errMsg(ex) }); }
  };
  const setField = (i, patch) => setV({ ...v, fields: v.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const toggle = (k, x) => setV({ ...v, [k]: v[k].includes(x) ? v[k].filter((y) => y !== x) : [...v[k], x] });
  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit ${item.title}` : "Add a login"} wide>
      <form onSubmit={submit} className="space-y-5" data-testid="vault-form">
        {!editing && <div><label className="lbl" htmlFor="vf-preset">Platform</label><select id="vf-preset" className="inp" value={v.preset} onChange={(e) => pick(e.target.value)} data-testid="vault-preset"><option value="">Choose…</option>{meta.categories.map((c) => <optgroup key={c.key} label={c.label}>{meta.presets.filter((p) => p.category === c.key).map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</optgroup>)}</select></div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="lbl" htmlFor="vf-title">Name *</label><input id="vf-title" className="inp" required minLength={2} maxLength={80} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="e.g. Airbnb – Thindal guest house" data-testid="vault-title" /></div>
          <div><label className="lbl" htmlFor="vf-url">Website</label><input id="vf-url" className="inp" value={v.url || ""} onChange={(e) => setV({ ...v, url: e.target.value })} placeholder="https://" /></div>
          <div><label className="lbl" htmlFor="vf-user">Login name</label><input id="vf-user" className="inp" autoComplete="off" value={v.username || ""} onChange={(e) => setV({ ...v, username: e.target.value })} placeholder={preset?.hint || "Email, mobile or user ID"} data-testid="vault-username" /></div>
          <div>
            <label className="lbl" htmlFor="vf-pw">Password{editing ? " (leave blank to keep the current one)" : ""}</label>
            <div className="flex gap-1"><input id="vf-pw" type={show ? "text" : "password"} autoComplete="new-password" className="inp font-mono" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} data-testid="vault-pw" />
              <button type="button" className="btn-line btn-sm" onClick={() => setShow(!show)} aria-label={show ? "Hide" : "Show"}>{show ? <EyeOff size={14} /> : <Eye size={14} />}</button>
              <button type="button" className="btn-line btn-sm" onClick={() => { setV({ ...v, password: generatePassword(18) }); setShow(true); }} title="Generate a strong password" data-testid="vault-generate"><Wand2 size={14} /></button></div>
            {s && <div className="mt-1.5 flex items-center gap-2"><div className="h-1.5 flex-1 bg-slate-100"><div className={`h-full ${s[1]}`} style={{ width: `${s[2]}%` }} /></div><span className="text-[11px] text-slate-500">{s[0]}</span></div>}
          </div>
          <div><label className="lbl" htmlFor="vf-totp">2-step key (optional)</label><input id="vf-totp" className="inp font-mono" autoComplete="off" value={v.totp_secret} onChange={(e) => setV({ ...v, totp_secret: e.target.value })} placeholder={editing && item.has_totp ? "Saved. Paste a new key to replace it" : "Setup key or otpauth:// link"} />
            <p className="mt-1 text-xs text-slate-400">Lets the team get the 6-digit code here instead of one person's phone.</p>
            {editing && item.has_totp && <label className="mt-1 flex items-center gap-2 text-xs"><input type="checkbox" checked={removeTotp} onChange={(e) => setRemoveTotp(e.target.checked)} />Remove the saved 2-step key</label>}</div>
          <div><label className="lbl" htmlFor="vf-rot">Remind to change the password every</label><select id="vf-rot" className="inp" value={v.rotate_days} onChange={(e) => setV({ ...v, rotate_days: Number(e.target.value) })}>{[[0, "Never"], [30, "30 days"], [90, "90 days"], [180, "6 months"], [365, "Year"]].map(([d, l]) => <option key={d} value={d}>{l}</option>)}</select></div>
        </div>
        <div>
          <div className="flex items-center justify-between"><span className="lbl !mb-0">Other details</span><button type="button" className="text-xs underline" onClick={() => setV({ ...v, fields: [...v.fields, { label: "", value: "", secret: false }] })}>Add a detail</button></div>
          {v.fields.map((f, i) => <div key={i} className="mt-2 grid grid-cols-[1fr_1.4fr_auto_auto] items-center gap-2"><input className="inp" placeholder="e.g. Property ID" value={f.label} onChange={(e) => setField(i, { label: e.target.value })} aria-label="Detail name" /><input className="inp" type={f.secret && !show ? "password" : "text"} value={f.value} onChange={(e) => setField(i, { value: e.target.value })} aria-label="Detail value" /><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={f.secret} onChange={(e) => setField(i, { secret: e.target.checked })} />Secret</label><button type="button" className="p-1 text-slate-400 hover:text-red-700" onClick={() => setV({ ...v, fields: v.fields.filter((_, j) => j !== i) })} aria-label="Remove"><Trash2 size={14} /></button></div>)}
        </div>
        <div><label className="lbl" htmlFor="vf-notes">Notes (kept secret)</label><textarea id="vf-notes" className="inp" rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} placeholder="Recovery phone, security questions, who to call" /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><p className="lbl">Share with roles</p><div className="flex flex-wrap gap-x-4 gap-y-1">{meta.roles.filter((r) => !["super_admin", "director"].includes(r.key)).map((r) => <label key={r.key} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={v.share_roles.includes(r.key)} onChange={() => toggle("share_roles", r.key)} data-testid={`vault-share-${r.key}`} />{r.label}</label>)}</div><p className="mt-1 text-xs text-slate-400">Administrators and directors can always see every login.</p></div>
          <div><p className="lbl">…or with named people</p><div className="max-h-40 overflow-y-auto border border-slate-200 p-2">{users.filter((u) => meta.roles.some((r) => r.key === u.role) && !["super_admin", "director"].includes(u.role)).map((u) => <label key={u.id} className="flex items-center gap-1.5 py-0.5 text-sm"><input type="checkbox" checked={v.share_users.includes(u.id)} onChange={() => toggle("share_users", u.id)} />{u.name}<span className="text-xs text-slate-400">{label(u.role)}</span></label>)}</div></div>
        </div>
        {props.length > 0 && <div><label className="lbl" htmlFor="vf-prop">For a property (optional)</label><select id="vf-prop" className="inp" value={v.property_ids[0] || ""} onChange={(e) => setV({ ...v, property_ids: e.target.value ? [e.target.value] : [] })}><option value="">Company-wide</option>{props.filter((p) => p.code).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.title}</option>)}</select></div>}
        {st.err && <p className="text-sm text-red-700" role="alert" data-testid="form-error">{st.err}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" className="btn-line" onClick={onClose}>Cancel</button><button className="btn-dark" disabled={st.busy} data-testid="vault-save">{st.busy ? "Saving…" : "Save"}</button></div>
      </form>
    </Modal>
  );
}

function Revealed({ value, onHide }) {
  useEffect(() => { const t = setTimeout(onHide, 20000); return () => clearTimeout(t); }, [onHide]);
  return <code className="break-all bg-slate-100 px-2 py-1 font-mono text-sm" data-testid="vault-revealed">{value}</code>;
}

function TotpCode({ item, ensureUnlocked }) {
  const [c, setC] = useState(null);
  const left = useCountdown(c?.until);
  const get = async () => { if (!(await ensureUnlocked())) return; const r = await act(() => api.post(`/vault/items/${item.id}/code`)); if (r) setC({ code: r.data.code, until: Date.now() / 1000 + r.data.seconds_left }); };
  useEffect(() => { if (c && left === 0) setC(null); }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return <button className="btn-line btn-sm" onClick={get} data-testid={`vault-code-${item.id}`}><Timer size={13} />2-step code</button>;
  return <span className="inline-flex items-center gap-2"><code className="bg-slate-900 px-2 py-1 font-mono text-sm tracking-[0.2em] text-white" data-testid="vault-totp">{c.code}</code><span className="text-xs text-slate-500">{left}s</span><button className="p-1 text-slate-500 hover:text-slate-900" onClick={async () => { if (await copyText(c.code)) toast.success("Code copied"); }} aria-label="Copy code"><Copy size={14} /></button></span>;
}

function ItemCard({ it, ensureUnlocked, onEdit, onHistory, onDelete, rolesLabel }) {
  const [shown, setShown] = useState(null);
  const reveal = async (field, purpose) => {
    if (!(await ensureUnlocked())) return null;
    const r = await act(() => api.post(`/vault/items/${it.id}/reveal`, { field, purpose }));
    return r ? r.data.value : null;
  };
  const copy = async (field, what) => { const v = await reveal(field, "copy"); if (v != null && await copyText(v)) toast.success(`${what} copied. Paste it, then clear your clipboard.`); };
  return (
    <div className="panel p-4" data-testid={`vault-item-${it.preset}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><p className="font-medium text-slate-900">{it.title}</p><p className="text-xs text-slate-500">{it.category_label}{it.share_roles?.length ? ` · shared with ${it.share_roles.map(rolesLabel).join(", ")}` : ""}{it.share_users?.length ? ` · ${it.share_users.length} named` : ""}{!it.share_roles?.length && !it.share_users?.length ? " · only you and administrators" : ""}</p></div>
        <div className="flex items-center gap-1">{it.rotate_due && <Badge v="due" text="Change due" />}{it.has_totp && <Badge v="active" tone="blue" text="2-step" />}</div>
      </div>
      <div className="mt-3 space-y-2 text-sm">
        {it.username && <p className="flex flex-wrap items-center gap-2"><span className="w-20 shrink-0 text-xs text-slate-500">Login</span><span className="break-all">{it.username}</span><button className="p-1 text-slate-400 hover:text-slate-900" onClick={async () => { if (await copyText(it.username)) toast.success("Login copied"); }} aria-label="Copy login"><Copy size={13} /></button></p>}
        {it.has_password && <p className="flex flex-wrap items-center gap-2"><span className="w-20 shrink-0 text-xs text-slate-500">Password</span>{shown?.field === "password" ? <Revealed value={shown.value} onHide={() => setShown(null)} /> : <span className="tracking-widest text-slate-400">••••••••</span>}
          <button className="p-1 text-slate-400 hover:text-slate-900" onClick={async () => { if (shown?.field === "password") return setShown(null); const v = await reveal("password", "view"); if (v != null) setShown({ field: "password", value: v }); }} aria-label="Show password" data-testid={`vault-show-${it.preset}`}>{shown?.field === "password" ? <EyeOff size={13} /> : <Eye size={13} />}</button>
          <button className="p-1 text-slate-400 hover:text-slate-900" onClick={() => copy("password", "Password")} aria-label="Copy password" data-testid={`vault-copy-${it.preset}`}><Copy size={13} /></button></p>}
        {(it.fields_public || []).map((f) => <p key={f.label} className="flex flex-wrap items-center gap-2"><span className="w-20 shrink-0 text-xs text-slate-500">{f.label}</span><span className="break-all">{f.value}</span></p>)}
        {(it.secret_labels || []).map((l) => <p key={l} className="flex flex-wrap items-center gap-2"><span className="w-20 shrink-0 text-xs text-slate-500">{l}</span>{shown?.field === `field:${l}` ? <Revealed value={shown.value} onHide={() => setShown(null)} /> : <span className="tracking-widest text-slate-400">••••••</span>}<button className="p-1 text-slate-400 hover:text-slate-900" onClick={async () => { const v = await reveal(`field:${l}`, "view"); if (v != null) setShown({ field: `field:${l}`, value: v }); }} aria-label={`Show ${l}`}><Eye size={13} /></button><button className="p-1 text-slate-400 hover:text-slate-900" onClick={() => copy(`field:${l}`, l)} aria-label={`Copy ${l}`}><Copy size={13} /></button></p>)}
        {it.has_notes && (shown?.field === "notes" ? <p className="whitespace-pre-wrap bg-slate-50 p-2 text-xs">{shown.value}</p> : <button className="text-xs underline" onClick={async () => { const v = await reveal("notes", "view"); if (v != null) setShown({ field: "notes", value: v }); }}>Show notes</button>)}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        {it.has_totp && <TotpCode item={it} ensureUnlocked={ensureUnlocked} />}
        {it.url && <a className="btn-line btn-sm" href={it.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} />Open site</a>}
        {it.can_edit && <><button className="btn-line btn-sm" onClick={() => onEdit(it)} data-testid={`vault-edit-${it.preset}`}>Edit</button><button className="btn-line btn-sm" onClick={() => onHistory(it)}><History size={13} />History</button><button className="p-1.5 text-slate-400 hover:text-red-700" onClick={() => onDelete(it)} aria-label="Delete"><Trash2 size={14} /></button></>}
        <span className="ml-auto text-[11px] text-slate-400">{it.password_changed_at ? `Changed ${fmtDate(it.password_changed_at)}` : ""}{it.last_used_at ? ` · used ${fmtDate(it.last_used_at)} by ${it.last_used_by}` : ""}</span>
      </div>
    </div>
  );
}

function HistoryModal({ item, onClose, ensureUnlocked }) {
  const [rows, setRows] = useState(null);
  const [shown, setShown] = useState({});
  useEffect(() => { if (item) { setRows(null); setShown({}); api.get(`/vault/items/${item.id}/history`).then((r) => setRows(r.data)).catch(() => setRows([])); } }, [item]);
  return (
    <Modal open={!!item} onClose={onClose} title={`Old passwords · ${item?.title || ""}`}>
      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : !rows.length ? <p className="text-sm text-slate-500">No earlier passwords saved. When the password is changed, the old one is kept here (last 10).</p> :
        <ul className="divide-y divide-slate-100">{rows.map((h) => <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span>Until {fmtDateTime(h.at)} · changed by {h.by}</span>{shown[h.id] ? <code className="bg-slate-100 px-2 py-1 font-mono">{shown[h.id]}</code> : <button className="btn-line btn-sm" onClick={async () => { if (!(await ensureUnlocked())) return; const r = await act(() => api.post(`/vault/items/${item.id}/history/${h.id}/reveal`)); if (r) setShown({ ...shown, [h.id]: r.data.value }); }}>Show</button>}</li>)}</ul>}
    </Modal>
  );
}

export default function Vault() {
  const { can } = useAuth();
  const dialog = useDialog();
  const [params] = useSearchParams();
  const [status, setStatus] = useState(null);
  const [f, setF] = useState({ category: "", q: "", due: params.get("due") === "1" });
  const [unlockOpen, setUnlockOpen] = useState(null);
  const [edit, setEdit] = useState(null);
  const [hist, setHist] = useState(null);
  const { rows, reload, loading } = useList("/vault/items", { category: f.category || undefined, q: f.q || undefined, due: f.due || undefined });
  const { rows: meta } = useList("/vault/meta");
  const { rows: users } = useList("/users/lite");
  const { rows: props } = useList(can("properties") ? "/properties" : "/branches");
  const loadStatus = () => api.get("/vault/status").then((r) => setStatus(r.data)).catch(() => setStatus(false));
  useEffect(() => { loadStatus(); }, []);
  const left = useCountdown(status?.until);
  useEffect(() => { if (status?.unlocked && left === 0 && status.until) setStatus({ ...status, unlocked: false, until: null }); }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  const rolesLabel = useMemo(() => (k) => ROLE_SHORT[k] || (meta?.roles || []).find((r) => r.key === k)?.label || label(k), [meta]);
  // Opens the unlock dialog when needed and resolves once the vault is open (or the person cancels).
  const ensureUnlocked = () => (status?.unlocked && left > 0 ? Promise.resolve(true) : new Promise((resolve) => setUnlockOpen({ resolve })));
  if (status === null) return <p className="text-sm text-slate-500">Loading…</p>;
  if (status === false) return <p className="text-sm text-slate-500">Could not open the vault.</p>;
  if (!status.configured) return (
    <div>
      <PageHeader title="Password vault" sub="Shared logins for Airbnb, Booking.com, portals, GST, EB, banking and more, encrypted and logged." />
      <Section title="Switch on the vault" testid="vault-setup">
        <p className="text-sm text-slate-600">The vault needs an encryption key on the server. A super administrator adds it once:</p>
        <pre className="mt-3 overflow-x-auto bg-slate-900 p-3 text-xs text-slate-100">{`cd /opt/sellandiammanestates      # the app folder on the server
echo "VAULT_KEY=$(openssl rand -base64 32)" >> backend/.env
docker compose up -d backend`}</pre>
        <p className="mt-3 text-sm text-slate-600">Keep a copy of the key somewhere safe outside the server (a sealed envelope or your personal password manager). Without it, saved passwords cannot be read after a server rebuild. Never change it once logins are saved.</p>
      </Section>
    </div>
  );
  const unlocked = status.unlocked && left > 0;
  return (
    <div>
      <PageHeader title="Password vault" sub="Shared logins for the company's platforms. Passwords are encrypted; every view, copy and change is recorded.">
        {unlocked ? <button className="btn-line btn-sm" onClick={async () => { await api.post("/vault/lock"); loadStatus(); }} data-testid="vault-lock"><Lock size={14} />Lock · {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</button>
          : <button className="btn-line btn-sm" onClick={() => ensureUnlocked()} data-testid="vault-unlock"><LockOpen size={14} />Unlock</button>}
        {status.can_add && <button className="btn-dark btn-sm" onClick={async () => { if (await ensureUnlocked()) setEdit({}); }} data-testid="vault-add"><Plus size={14} />Add a login</button>}
      </PageHeader>
      {!unlocked && <p className="mb-4 flex items-center gap-2 bg-slate-100 p-3 text-sm text-slate-700" data-testid="vault-locked"><KeyRound size={16} />Locked. You can see which logins exist; unlock with your password to show or copy one.</p>}
      <Tabs defaultValue="logins"><TabsList className="rounded-sm"><TabsTrigger value="logins">Logins</TabsTrigger><TabsTrigger value="activity" data-testid="vault-tab-activity">Activity</TabsTrigger></TabsList>
        <TabsContent value="logins" className="mt-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <select className="inp sm:!w-auto" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} aria-label="Category"><option value="">All kinds</option>{(meta?.categories || []).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
            <input className="inp sm:!w-56" placeholder="Search name, login or site" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Search" data-testid="vault-search" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.due} onChange={(e) => setF({ ...f, due: e.target.checked })} />Password change due</label>
            <button className="p-2 text-slate-500 hover:text-slate-900" onClick={reload} aria-label="Refresh"><RefreshCw size={15} /></button>
          </div>
          {loading && !rows.length ? <p className="text-sm text-slate-500">Loading…</p> : !rows.length ? <p className="panel p-6 text-sm text-slate-500">No logins {f.q || f.category || f.due ? "match" : "shared with you yet"}.</p> :
            <div className="grid gap-4 lg:grid-cols-2" data-testid="vault-items">{rows.map((it) => <ItemCard key={it.id} it={it} ensureUnlocked={ensureUnlocked} rolesLabel={rolesLabel} onEdit={async (x) => { if (await ensureUnlocked()) setEdit(x); }} onHistory={setHist} onDelete={async (x) => { if (await dialog.confirm({ title: `Delete ${x.title}?`, body: "It disappears for everyone it is shared with. The record of who used it stays in the activity log.", okLabel: "Delete", tone: "danger" })) { await act(() => api.delete(`/vault/items/${x.id}`), "Deleted"); reload(); } }} />)}</div>}
        </TabsContent>
        <TabsContent value="activity" className="mt-4"><Activity /></TabsContent>
      </Tabs>
      <Unlock open={!!unlockOpen} mfa={status.mfa} onClose={() => { unlockOpen?.resolve(false); setUnlockOpen(null); }} onDone={(until) => { setStatus({ ...status, unlocked: true, until }); const r = unlockOpen?.resolve; setUnlockOpen(null); r?.(true); }} />
      {meta?.presets && <ItemForm open={!!edit} onClose={() => setEdit(null)} item={edit?.id ? edit : null} meta={meta} users={users} props={props} onSaved={() => reload()} ensureUnlocked={ensureUnlocked} />}
      <HistoryModal item={hist} onClose={() => setHist(null)} ensureUnlocked={ensureUnlocked} />
    </div>
  );
}

const ACTION_TEXT = { vault_view: "Viewed", vault_copy: "Copied", vault_code: "Got a 2-step code", vault_unlocked: "Unlocked the vault", vault_unlock_failed: "Failed to unlock", vault_item_created: "Added", vault_item_updated: "Changed", vault_item_deleted: "Deleted", vault_view_old_password: "Viewed an old password" };

function Activity() {
  const { rows, loading } = useList("/vault/activity");
  return <DataTable testid="vault-activity" loading={loading} rows={rows} empty="Nothing yet." columns={[{ key: "at", label: "When", render: (r) => fmtDateTime(r.at) }, { key: "user_name", label: "Who" }, { key: "action", label: "What", render: (r) => ACTION_TEXT[r.action] || label(r.action) }, { key: "details", label: "Login", render: (r) => <>{r.details?.title || "-"}{r.details?.field && <span className="block text-xs text-slate-500">{r.details.field.replace("field:", "")}</span>}{r.details?.changed?.length > 0 && <span className="block text-xs text-slate-500">{r.details.changed.join(", ")}</span>}</> }]} />;
}
