import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { api, fmtDate, fmtDateTime, inr, label, opts, openFile } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useDialog } from "../../lib/dialogs";
import { PageHeader, DataTable, Badge, FormDialog, Section, Field, useList, act } from "../../components/erp/kit";

export function Tasks() {
  const { can, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [show, setShow] = useState("open");
  const { rows, reload, loading } = useList("/tasks");
  const { rows: users } = useList("/users/lite");
  const setStatus = async (t, status) => { await act(() => api.patch(`/tasks/${t.id}`, { status }), status === "done" ? "Task done" : "Updated"); reload(); };
  const list = rows.filter((t) => (show === "open" ? t.status !== "done" : show === "mine" ? t.assigned_to === user.id && t.status !== "done" : true));
  return (
    <div>
      <PageHeader title="Tasks" sub="Site-visit prep, cleaning turnovers, inspections and follow-ups.">{can("tasks", "w") && <button className="btn-dark btn-sm" onClick={() => setOpen(true)} data-testid="new-task-btn">New task</button>}</PageHeader>
      <div className="mb-4 flex gap-2">{[["open", "Open"], ["mine", "Mine"], ["all", "All"]].map(([k, l]) => <button key={k} className={`chip ${show === k ? "chip-on" : ""}`} onClick={() => setShow(k)}>{l}</button>)}</div>
      <DataTable testid="tasks-table" loading={loading} rows={list} columns={[{ key: "title", label: "Task" }, { key: "kind", label: "Kind", render: (t) => label(t.kind) }, { key: "assigned_to", label: "Assignee", render: (t) => users.find((u) => u.id === t.assigned_to)?.name || "Unassigned" }, { key: "due_date", label: "Due", render: (t) => fmtDate(t.due_date) }, { key: "priority", label: "Priority", render: (t) => <Badge v={t.priority} /> }, { key: "status", label: "Status", render: (t) => can("tasks", "w") ? <select className="border border-slate-200 px-1 py-1 text-xs" value={t.status} onChange={(e) => setStatus(t, e.target.value)} aria-label="Task status" data-testid={`task-status-${t.id}`}>{["open", "in_progress", "done"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select> : label(t.status) }]} empty="No tasks here." />
      <FormDialog open={open} onClose={() => setOpen(false)} title="New task" initial={{ priority: "medium", kind: "general", assigned_to: user.id }} fields={[{ name: "title", label: "Title", required: true, full: true }, { name: "assigned_to", label: "Assign to", type: "select", options: users.map((u) => ({ value: u.id, label: u.name })) }, { name: "due_date", label: "Due", type: "date" }, { name: "priority", label: "Priority", type: "select", required: true, options: opts(["low", "medium", "high", "urgent"]) }, { name: "kind", label: "Kind", type: "select", required: true, options: opts(["general", "site_visit", "follow_up", "inspection", "cleaning", "documentation"]) }, { name: "description", label: "Description", type: "textarea", full: true }]} onSubmit={async (v) => { await api.post("/tasks", v); reload(); }} />
    </div>
  );
}

export function Approvals() {
  const { user } = useAuth();
  const dialog = useDialog();
  const { rows, reload, loading } = useList("/approvals");
  const decide = async (a, approve) => {
    const note = await dialog.ask({ title: approve ? "Approve this request?" : "Reject this request?", body: `${a.summary}\nRequested by ${a.requested_by_name}: ${a.reason || "no reason given"}`, label: "Note (optional)", required: false, okLabel: approve ? "Approve" : "Reject", tone: approve ? undefined : "danger" });
    if (note === null) return;
    await act(() => api.post(`/approvals/${a.id}/decide`, { approve, note }), approve ? "Approved" : "Rejected"); reload();
  };
  return (
    <div>
      <PageHeader title="Approvals" sub="Commission changes, refunds, credit notes and ledger reversals need a second person to approve." />
      <DataTable testid="approvals-table" loading={loading} rows={rows} columns={[{ key: "kind", label: "Kind", render: (a) => label(a.kind) }, { key: "summary", label: "Request" }, { key: "reason", label: "Reason" }, { key: "requested_by_name", label: "Requested by" }, { key: "created_at", label: "When", render: (a) => fmtDateTime(a.created_at) }, { key: "status", label: "Status", render: (a) => <><Badge v={a.status} />{a.decided_by_name && <span className="mt-1 block text-xs text-slate-500">by {a.decided_by_name}</span>}</> }, { key: "x", label: "", render: (a) => a.status === "pending" && (a.requested_by !== user.id ? <span className="flex gap-1"><button className="btn-dark btn-sm" onClick={() => decide(a, true)} data-testid={`approve-${a.id}`}>Approve</button><button className="btn-line btn-sm" onClick={() => decide(a, false)} data-testid={`reject-${a.id}`}>Reject</button></span> : <span className="text-xs text-slate-500">Waiting for someone else</span>) }]} empty="No approval requests" />
    </div>
  );
}

const REPORTS = [["leads", "Lead funnel & sources", "leads"], ["site_visits", "Site visits & feedback", "leads"], ["deals", "Brokerage deals & commission", "deals"], ["invoices", "Invoices & receivables", "finance"], ["ledger", "Ledger entries (all ledgers)", "finance"], ["expenses", "Company expenses", "finance"], ["owner_statements", "Owner settlements", "finance"], ["leases", "Leases, rent & renewals", "leases"], ["bookings", "Short-stay bookings & payouts", "shortstay"], ["work_orders", "Maintenance jobs & costs", "maintenance"], ["properties", "Listings & authorisation expiry", "properties"]];

export function Reports() {
  const { can } = useAuth();
  const [r, setR] = useState({ frm: "", to: "" });
  const q = new URLSearchParams(Object.entries(r).filter(([, v]) => v)).toString();
  const list = REPORTS.filter(([, , m]) => can(m) && (can(m, "e") || can("reports", "e")));
  return (
    <div>
      <PageHeader title="Reports" sub="Spreadsheet (CSV) exports, limited to what your role can see. PDFs for invoices, deals, statements and receipts are on each record.">
        <input type="date" className="inp !w-auto" value={r.frm} onChange={(e) => setR({ ...r, frm: e.target.value })} aria-label="From date" data-testid="report-from" /><input type="date" className="inp !w-auto" value={r.to} onChange={(e) => setR({ ...r, to: e.target.value })} aria-label="To date" data-testid="report-to" />
      </PageHeader>
      {!list.length && <p className="panel p-6 text-sm text-slate-500">Your role has no reports to export.</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.map(([k, l]) => <div key={k} className="panel flex items-center justify-between gap-3 p-4"><span className="text-sm font-medium">{l}</span><button className="btn-line btn-sm shrink-0" onClick={() => openFile(`/reports/${k}.csv${q ? `?${q}` : ""}`, { name: l, csv: true })} data-testid={`report-${k}-btn`}>Download CSV</button></div>)}</div>
    </div>
  );
}

export function Users() {
  const { can, user } = useAuth();
  const dialog = useDialog();
  const [open, setOpen] = useState(false);
  const { rows, reload, loading } = useList("/users");
  const { rows: roles } = useList("/roles");
  const { rows: branches } = useList("/branches");
  const w = can("users", "w");
  const roleOpts = roles.filter((r) => r.key !== "owner" && (r.key !== "super_admin" || user.role === "super_admin")).map((r) => ({ value: r.key, label: r.label }));
  const showLink = (title, d) => dialog.notice({ title, body: d.email_status === "sent" ? "We emailed the link. You can also share it yourself:" : "Email is not set up on this server, so share this one-time link with the person securely (for example on WhatsApp):", copy: d.link || d.activation_link });
  return (
    <div>
      <PageHeader title="Users & roles" sub="Only administrators create accounts. Changing a role or deactivating someone signs them out everywhere.">{w && <button className="btn-dark btn-sm" onClick={() => setOpen(true)} data-testid="new-user-btn">New user</button>}</PageHeader>
      <DataTable testid="users-table" loading={loading} rows={rows} columns={[
        { key: "name", label: "Name", render: (u) => <>{u.name}{u.mfa_enabled && <span className="ml-2 text-[10px] font-semibold uppercase text-emerald-700">2-step</span>}</> }, { key: "email", label: "Email" },
        { key: "role", label: "Role", render: (u) => w && u.id !== user.id && u.role !== "owner" ? <select className="border border-slate-200 px-1 py-1 text-xs" value={u.role} onChange={async (e) => { await act(() => api.patch(`/users/${u.id}`, { role: e.target.value }), "Role updated"); reload(); }} aria-label={`Role for ${u.name}`} data-testid={`user-role-${u.email}`}>{roles.filter((r) => r.key !== "owner").map((r) => <option key={r.key} value={r.key} disabled={r.key === "super_admin" && user.role !== "super_admin"}>{r.label}</option>)}</select> : label(u.role) },
        { key: "active", label: "Status", render: (u) => <Badge v={u.active ? "active" : u.last_login ? "inactive" : "invited"} tone={u.active ? "green" : u.last_login ? "grey" : "amber"} /> },
        { key: "last_login", label: "Last sign-in", render: (u) => fmtDateTime(u.last_login) },
        { key: "x", label: "", render: (u) => w && u.id !== user.id && <span className="flex flex-wrap gap-1">
          <button className="btn-line btn-sm" onClick={async () => { await act(() => api.patch(`/users/${u.id}`, { active: !u.active }), u.active ? "Deactivated" : "Activated"); reload(); }} data-testid={`user-toggle-${u.email}`}>{u.active ? "Deactivate" : "Activate"}</button>
          <button className="btn-line btn-sm" onClick={async () => { const r = await act(() => api.post(`/users/${u.id}/reset-link`)); if (r) showLink(`Password link for ${u.name}`, r.data); }}>Password link</button>
          {u.mfa_enabled && <button className="btn-line btn-sm" onClick={async () => { if (await dialog.confirm({ title: `Reset 2-step sign-in for ${u.name}?`, body: "Use this when they lose their phone. They will sign in with their password and set up 2-step again.", okLabel: "Reset" })) { await act(() => api.post(`/users/${u.id}/mfa-reset`), "2-step sign-in reset"); reload(); } }}>Reset 2-step</button>}
          <button className="btn-line btn-sm" onClick={() => act(() => api.post(`/users/${u.id}/revoke-sessions`), "Signed out everywhere")}>Sign out everywhere</button>
        </span> }]} />
      <FormDialog open={open} onClose={() => setOpen(false)} title="New staff user" initial={{ role: "sales_agent" }} fields={[{ name: "name", label: "Name", required: true }, { name: "email", label: "Email", type: "email", required: true }, { name: "phone", label: "Phone" }, { name: "role", label: "Role", type: "select", required: true, options: roleOpts }, { name: "branch", label: "Branch", type: "select", options: branches.map((b) => ({ value: b.id, label: b.name })) }, { name: "password", label: "Initial password (leave blank to send a set-password link)", type: "password", hint: "At least 8 characters" }]}
        onSubmit={async (v) => { const r = await api.post("/users", { ...v, branch_ids: v.branch ? [v.branch] : [] }); reload(); if (r.data.activation_link) setTimeout(() => showLink(`Account created for ${r.data.name}`, r.data), 50); }} />
    </div>
  );
}

const SET_FIELDS = [{ name: "name", label: "Company name" }, { name: "legal_name", label: "Legal name" }, { name: "phone", label: "Phone" }, { name: "whatsapp", label: "WhatsApp number (with country code)", hint: "Leave blank to hide WhatsApp buttons" }, { name: "email", label: "Email" }, { name: "office_hours", label: "Office hours" }, { name: "address", label: "Address", full: true }, { name: "gstin", label: "Company GSTIN" }, { name: "rera_no", label: "TNRERA agent registration no.", hint: "Shown in the footer and on documents" }, { name: "gst_rate", label: "GST rate % (as advised by your accountant)", type: "number" }, { name: "invoice_due_days", label: "Invoice due days", type: "number" }, { name: "gst_enabled", label: "Charge GST on invoices", type: "checkbox" }, { name: "demo_mode", label: "Show the 'sample listings' banner on the website", type: "checkbox" }];
const CMS_FIELDS = [{ name: "hero_title", label: "Home page headline", full: true }, { name: "hero_subtitle", label: "Home page sub-heading", full: true }, { name: "announcement", label: "Announcement bar (leave blank to hide)", full: true }, { name: "seo_title", label: "Search engine title", full: true }, { name: "seo_description", label: "Search engine description", type: "textarea", full: true }];
const SOCIAL = [["facebook", "Facebook page"], ["instagram", "Instagram"], ["youtube", "YouTube"], ["linkedin", "LinkedIn"], ["google_business", "Google Business profile"], ["x", "X (Twitter)"]];
const MFA_ROLES = ["super_admin", "director", "accountant", "branch_manager", "property_manager", "sales_agent", "marketing", "shortstay_ops", "auditor"];

function SettingsForm({ fields, initial, canEdit, testid }) {
  const [v, setV] = useState(initial);
  const save = async () => { const body = {}; fields.forEach((f) => { body[f.name] = f.type === "number" ? Number(v[f.name] || 0) : v[f.name]; }); await act(() => api.put("/settings", body), "Saved"); };
  return <div data-testid={testid}><div className="grid gap-4 sm:grid-cols-2">{fields.map((f) => <Field key={f.name} f={f} value={v[f.name]} onChange={(x) => setV({ ...v, [f.name]: x })} />)}</div>{canEdit && <button className="btn-dark btn-sm mt-4" onClick={save} data-testid="save-settings-btn">Save</button>}</div>;
}

function Checklist() {
  const [s, setS] = useState(null);
  useEffect(() => { api.get("/system/status").then((r) => setS(r.data)).catch(() => setS(false)); }, []);
  if (!s) return null;
  const items = [
    [!s.contact_placeholder, "Real phone, email and office address", "Company & tax below"],
    [s.whatsapp, "WhatsApp number for enquiry buttons", "Company & tax below"],
    [s.email, "Email sending (SMTP) for password links and alerts", "SMTP_* in the server settings"],
    [s.site_url, "Website address (SITE_URL)", "Server settings"],
    [s.cookie_secure, "Secure sign-in cookies (HTTPS)", "COOKIE_SECURE=true"],
    [!s.demo_mode && !s.demo_data, "Sample data removed and demo banner off", "SEED_DEMO=false on a fresh database"],
    [s.admins_without_mfa === 0, "2-step sign-in on for every director and super admin", `${s.admins_without_mfa} still without it`],
    [s.turnstile, "'I am human' check on public forms (optional)", "TURNSTILE_* in the server settings"],
    [s.rera, "TNRERA agent registration number", "Company & tax below"],
  ];
  const done = items.filter(([ok]) => ok).length;
  return (
    <Section title={`Go-live checklist · ${done} of ${items.length} done`} testid="golive-checklist">
      <ul className="grid gap-2 md:grid-cols-2">{items.map(([ok, t, how]) => <li key={t} className="flex items-start gap-2 text-sm">{ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-700" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />}<span><span className={ok ? "text-slate-600" : "font-medium text-slate-900"}>{t}</span>{!ok && <span className="block text-xs text-slate-500">{how}</span>}</span></li>)}</ul>
      <p className="mt-3 text-xs text-slate-400">See DEPLOYMENT.md in the code for the server settings.</p>
    </Section>
  );
}

function Testimonials({ initial, canEdit }) {
  const [rows, setRows] = useState(initial || []);
  const save = () => act(() => api.put("/settings", { testimonials: rows }), "Reviews saved");
  return (
    <div className="space-y-3" data-testid="testimonials-editor">
      <p className="text-xs text-slate-500">Only add real reviews with the customer's permission. They appear on the home page.</p>
      {rows.map((t, i) => <div key={i} className="grid gap-2 border border-slate-200 p-3 sm:grid-cols-[1fr_200px_auto]"><textarea rows={2} className="inp" placeholder="What the customer said" value={t.quote} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, quote: e.target.value } : x)))} disabled={!canEdit} aria-label="Review text" /><input className="inp" placeholder="Name, area" value={t.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} disabled={!canEdit} aria-label="Reviewer" />{canEdit && <button className="btn-line btn-sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>}</div>)}
      {canEdit && <div className="flex gap-2"><button className="btn-line btn-sm" onClick={() => setRows([...rows, { quote: "", name: "" }])} disabled={rows.length >= 9}>Add review</button><button className="btn-dark btn-sm" onClick={save}>Save reviews</button></div>}
    </div>
  );
}

export function Settings() {
  const { can, user } = useAuth();
  const [s, setS] = useState(null);
  const { rows: camps, reload } = useList(can("cms") ? "/campaigns" : "/branches");
  const [camp, setCamp] = useState(false);
  useEffect(() => { if (can("settings") || can("cms")) api.get("/settings").then((r) => setS(r.data)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const logo = async (e) => { const fd = new FormData(); fd.append("file", e.target.files[0]); await act(() => api.post("/settings/logo", fd), "Logo updated"); e.target.value = ""; };
  const sw = can("settings", "w");
  return (
    <div className="space-y-6" data-testid="settings-page">
      <PageHeader title="Settings & website content" sub={<>Your password and 2-step sign-in are under <Link to="/erp/security" className="underline">Security</Link>.</>} />
      {s && can("settings") && <Checklist />}
      {s && can("settings") && <Section title="Company & tax"><SettingsForm fields={SET_FIELDS} initial={s} canEdit={sw} testid="company-settings" />
        {sw && <div className="mt-4 border-t border-slate-100 pt-4"><p className="lbl">Logo</p><p className="mb-2 text-xs text-slate-500">The SA logo is built in. Upload a file only to replace it (PNG/JPG/WebP, max 1 MB).</p><input type="file" accept="image/png,image/jpeg,image/webp" onChange={logo} data-testid="logo-upload-input" />{s.logo && <button className="btn-line btn-sm ml-2" onClick={async () => { await act(() => api.delete("/settings/logo"), "Back to the built-in logo"); setS({ ...s, logo: null }); }}>Use built-in logo</button>}</div>}
      </Section>}
      {s && can("cms") && <Section title="Home page & search engines"><SettingsForm fields={CMS_FIELDS} initial={s} canEdit={can("cms", "w")} testid="cms-settings" /><p className="mt-3 text-xs text-slate-400">Publish and feature listings from each property's page. Approve owner photos for the website from the property's documents panel.</p></Section>}
      {s && can("cms") && <Section title="Customer reviews"><Testimonials initial={s.testimonials} canEdit={can("cms", "w")} /></Section>}
      {s && can("settings") && <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Social media links" testid="social-settings"><SocialSave initial={s.social || {}} canEdit={sw} /></Section>
        <Section title="Security & alerts" testid="security-policy">
          <p className="text-sm text-slate-600">Require 2-step sign-in for these roles:</p>
          <MfaRoles initial={s.mfa_required_roles || []} canEdit={sw} selfRole={user.role} selfMfa={user.mfa_enabled} />
          <EmailToggle initial={!!s.email_notifications} canEdit={sw} />
          <MapCentre initial={s.map_center || { lat: 11.31, lng: 77.65, zoom: 11 }} canEdit={sw} />
        </Section>
      </div>}
      {can("cms") && <Section title="Campaigns & lead sources" actions={can("cms", "w") && <button className="btn-line btn-sm" onClick={() => setCamp(true)} data-testid="new-campaign-btn">New campaign</button>}><p className="mb-3 text-xs text-slate-500">Add <code>?utm_source=facebook&utm_campaign=CODE</code> to the links in your ads. Website enquiries from those links are counted against the campaign.</p><DataTable testid="campaigns-table" rows={camps.filter((c) => c.code)} columns={[{ key: "name", label: "Campaign" }, { key: "code", label: "Code" }, { key: "channel", label: "Channel", render: (c) => label(c.channel) }, { key: "budget", label: "Budget", render: (c) => inr(c.budget) }, { key: "leads", label: "Leads" }, { key: "won", label: "Won" }]} /></Section>}
      <FormDialog open={camp} onClose={() => setCamp(false)} title="New campaign" fields={[{ name: "name", label: "Name", required: true }, { name: "code", label: "Code (utm_campaign)", required: true }, { name: "channel", label: "Channel", type: "select", options: opts(["social", "search_ads", "print", "referral", "portal", "whatsapp"]) }, { name: "budget", label: "Budget (₹)", type: "number" }, { name: "start_date", label: "Start", type: "date" }]} onSubmit={async (v) => { await api.post("/campaigns", v); reload(); }} />
    </div>
  );
}

function SocialSave({ initial, canEdit }) {
  const [v, setV] = useState(initial);
  return <div className="space-y-3"><p className="text-xs text-slate-500">Shown as icons in the website footer.</p>{SOCIAL.map(([k, l]) => <div key={k}><label className="lbl" htmlFor={`soc-${k}`}>{l}</label><input id={`soc-${k}`} className="inp" placeholder="https://" value={v[k] || ""} disabled={!canEdit} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></div>)}{canEdit && <button className="btn-dark btn-sm" onClick={() => act(() => api.put("/settings", { social: v }), "Links saved")} data-testid="save-social-btn">Save links</button>}</div>;
}

function MfaRoles({ initial, canEdit, selfRole, selfMfa }) {
  const [v, setV] = useState(initial);
  return (
    <div className="mt-2">
      <div className="grid grid-cols-2 gap-2">{MFA_ROLES.map((r) => <label key={r} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.includes(r)} disabled={!canEdit} onChange={(e) => setV(e.target.checked ? [...v, r] : v.filter((x) => x !== r))} data-testid={`mfa-role-${r}`} />{label(r)}</label>)}</div>
      {v.includes(selfRole) && !selfMfa && <p className="mt-2 text-xs text-amber-800">Turn on 2-step sign-in for your own account first (Security page).</p>}
      {canEdit && <button className="btn-dark btn-sm mt-3" onClick={() => act(() => api.put("/settings", { mfa_required_roles: v }), "Saved. People in these roles set up 2-step at their next sign-in.")} data-testid="save-mfa-roles">Save</button>}
    </div>
  );
}

function EmailToggle({ initial, canEdit }) {
  const [v, setV] = useState(initial);
  return <label className="mt-5 flex items-start gap-2 border-t border-slate-100 pt-4 text-sm"><input type="checkbox" className="mt-1" checked={v} disabled={!canEdit} onChange={async (e) => { setV(e.target.checked); await act(() => api.put("/settings", { email_notifications: e.target.checked }), "Saved"); }} data-testid="email-notifications-toggle" /><span>Also email staff their alerts (overdue follow-ups, approvals, expiring leases). Needs email (SMTP) set up on the server.</span></label>;
}

function MapCentre({ initial, canEdit }) {
  const [v, setV] = useState(initial);
  return (
    <div className="mt-5 border-t border-slate-100 pt-4">
      <p className="text-sm text-slate-600">Where the website map opens</p>
      <div className="mt-2 grid grid-cols-3 gap-2">{["lat", "lng", "zoom"].map((k) => <div key={k}><label className="lbl" htmlFor={`map-${k}`}>{{ lat: "Latitude", lng: "Longitude", zoom: "Zoom" }[k]}</label><input id={`map-${k}`} type="number" step="any" className="inp" value={v[k]} disabled={!canEdit} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} /></div>)}</div>
      {canEdit && <button className="btn-line btn-sm mt-3" onClick={() => act(() => api.put("/settings", { map_center: v }), "Saved")}>Save map centre</button>}
    </div>
  );
}

export function Audit() {
  const [entity, setEntity] = useState("");
  const { rows, loading } = useList("/audit", { entity: entity || undefined });
  return (
    <div>
      <PageHeader title="Audit log" sub="Sign-ins, sensitive changes, exports, downloads and refused actions."><select className="inp !w-auto" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Module" data-testid="audit-entity-filter"><option value="">All modules</option>{["auth", "users", "leads", "properties", "owners", "deals", "finance", "leases", "maintenance", "shortstay", "documents", "approvals", "settings", "cms", "reports"].map((x) => <option key={x} value={x}>{label(x)}</option>)}</select></PageHeader>
      <DataTable testid="audit-table" loading={loading} rows={rows} columns={[{ key: "at", label: "When", render: (a) => fmtDateTime(a.at) }, { key: "user_name", label: "User", render: (a) => a.user_name || a.user_id || "Public website" }, { key: "role", label: "Role", render: (a) => label(a.role) }, { key: "action", label: "Action", render: (a) => <span className={a.action === "permission_denied" ? "font-semibold text-red-700" : ""}>{label(a.action)}</span> }, { key: "entity", label: "Module" }, { key: "details", label: "Details", render: (a) => <span className="break-all font-mono text-[11px] text-slate-500">{JSON.stringify(a.details).slice(0, 120)}</span> }]} />
    </div>
  );
}
