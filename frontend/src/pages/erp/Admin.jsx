import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api, errMsg, fmtDate, fmtDateTime, inr, label, opts, openFile } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { PageHeader, DataTable, Badge, FormDialog, Section, Field, useList, act } from "../../components/erp/kit";

export function Tasks() {
  const { can, user } = useAuth();
  const [open, setOpen] = useState(false);
  const { rows, reload } = useList("/tasks");
  const { rows: users } = useList("/users/lite");
  const setStatus = async (t, status) => { await act(() => api.patch(`/tasks/${t.id}`, { status })); reload(); };
  return (
    <div>
      <PageHeader title="Tasks" sub="Work allocation, site-visit prep, cleaning turnovers and follow-ups.">{can("tasks", "w") && <button className="btn-dark btn-sm" onClick={() => setOpen(true)} data-testid="new-task-btn">New task</button>}</PageHeader>
      <DataTable testid="tasks-table" rows={rows} columns={[{ key: "title", label: "Task" }, { key: "kind", label: "Kind", render: (t) => label(t.kind) }, { key: "assigned_to", label: "Assignee", render: (t) => users.find((u) => u.id === t.assigned_to)?.name || "Unassigned" }, { key: "due_date", label: "Due", render: (t) => fmtDate(t.due_date) }, { key: "priority", label: "Priority", render: (t) => <Badge v={t.priority} /> }, { key: "status", label: "Status", render: (t) => can("tasks", "w") ? <select className="border border-slate-200 px-1 py-1 text-xs" value={t.status} onChange={(e) => setStatus(t, e.target.value)} data-testid={`task-status-${t.id}`}>{["open", "in_progress", "done"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select> : label(t.status) }]} />
      <FormDialog open={open} onClose={() => setOpen(false)} title="New task" initial={{ priority: "medium", kind: "general", assigned_to: user.id }} fields={[{ name: "title", label: "Title", required: true, full: true }, { name: "assigned_to", label: "Assign to", type: "select", options: users.map((u) => ({ value: u.id, label: u.name })) }, { name: "due_date", label: "Due", type: "date" }, { name: "priority", label: "Priority", type: "select", required: true, options: opts(["low", "medium", "high", "urgent"]) }, { name: "kind", label: "Kind", type: "select", required: true, options: opts(["general", "site_visit", "follow_up", "inspection", "cleaning", "documentation"]) }, { name: "description", label: "Description", type: "textarea", full: true }]} onSubmit={async (v) => { await api.post("/tasks", v); reload(); }} />
    </div>
  );
}

export function Approvals() {
  const { user } = useAuth();
  const { rows, reload } = useList("/approvals");
  const decide = async (a, approve) => { await act(() => api.post(`/approvals/${a.id}/decide`, { approve }), approve ? "Approved" : "Rejected"); reload(); };
  return (
    <div>
      <PageHeader title="Approvals" sub="Commission changes, refunds, credit notes and ledger reversals require authorised approval." />
      <DataTable testid="approvals-table" rows={rows} columns={[{ key: "kind", label: "Kind", render: (a) => label(a.kind) }, { key: "summary", label: "Request" }, { key: "reason", label: "Reason" }, { key: "requested_by_name", label: "Requested by" }, { key: "created_at", label: "When", render: (a) => fmtDateTime(a.created_at) }, { key: "status", label: "Status", render: (a) => <Badge v={a.status} /> }, { key: "x", label: "", render: (a) => a.status === "pending" && a.requested_by !== user.id && <span className="flex gap-1"><button className="btn-dark btn-sm" onClick={() => decide(a, true)} data-testid={`approve-${a.id}`}>Approve</button><button className="btn-line btn-sm" onClick={() => decide(a, false)} data-testid={`reject-${a.id}`}>Reject</button></span> }]} empty="No approval requests" />
    </div>
  );
}

const REPORTS = [["leads", "Lead funnel & sources", "leads"], ["deals", "Brokerage transactions & commission", "deals"], ["invoices", "Invoices & outstanding receivables", "finance"], ["ledger", "Ledger entries (all ledgers)", "finance"], ["owner_statements", "Owner settlements", "finance"], ["leases", "Occupancy, leases & renewals", "leases"], ["bookings", "Short-stay occupancy & revenue", "shortstay"], ["work_orders", "Maintenance costs", "maintenance"], ["properties", "Listing verification & authorisation expiry", "properties"]];

export function Reports() {
  const { can } = useAuth();
  const [r, setR] = useState({ frm: "", to: "" });
  const q = new URLSearchParams(Object.entries(r).filter(([, v]) => v)).toString();
  return (
    <div>
      <PageHeader title="Reports" sub="CSV exports respect your role. Invoice, deal and owner-statement PDFs are available on each record.">
        <input type="date" className="inp !w-auto" value={r.frm} onChange={(e) => setR({ ...r, frm: e.target.value })} data-testid="report-from" /><input type="date" className="inp !w-auto" value={r.to} onChange={(e) => setR({ ...r, to: e.target.value })} data-testid="report-to" />
      </PageHeader>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{REPORTS.filter(([, , m]) => can(m)).map(([k, l]) => <div key={k} className="panel flex items-center justify-between p-4"><span className="text-sm font-medium">{l}</span><button className="btn-line btn-sm" onClick={() => openFile(`/reports/${k}.csv${q ? `?${q}` : ""}`)} data-testid={`report-${k}-btn`}>Download CSV</button></div>)}</div>
    </div>
  );
}

export function Users() {
  const { can, user } = useAuth();
  const [open, setOpen] = useState(false);
  const { rows, reload } = useList("/users");
  const { rows: roles } = useList("/roles");
  const { rows: branches } = useList("/branches");
  const w = can("users", "w");
  const roleOpts = roles.filter((r) => r.key !== "super_admin" || user.role === "super_admin").map((r) => ({ value: r.key, label: r.label }));
  return (
    <div>
      <PageHeader title="Users & roles" sub="Staff accounts are created by administrators only. Changing a role or deactivating revokes sessions immediately.">{w && <button className="btn-dark btn-sm" onClick={() => setOpen(true)} data-testid="new-user-btn">New user</button>}</PageHeader>
      <DataTable testid="users-table" rows={rows} columns={[{ key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "role", label: "Role", render: (u) => w && u.id !== user.id ? <select className="border border-slate-200 px-1 py-1 text-xs" value={u.role} onChange={async (e) => { await act(() => api.patch(`/users/${u.id}`, { role: e.target.value }), "Role updated"); reload(); }} data-testid={`user-role-${u.email}`}>{roles.map((r) => <option key={r.key} value={r.key} disabled={r.key === "super_admin" && user.role !== "super_admin"}>{r.label}</option>)}</select> : label(u.role) }, { key: "active", label: "Status", render: (u) => <Badge v={u.active ? "active" : "inactive"} tone={u.active ? "green" : "grey"} /> }, { key: "last_login", label: "Last login", render: (u) => fmtDateTime(u.last_login) }, { key: "x", label: "", render: (u) => w && u.id !== user.id && <span className="flex gap-1"><button className="btn-line btn-sm" onClick={async () => { await act(() => api.patch(`/users/${u.id}`, { active: !u.active }), "Updated"); reload(); }} data-testid={`user-toggle-${u.email}`}>{u.active ? "Deactivate" : "Activate"}</button><button className="btn-line btn-sm" onClick={async () => { const r = await act(() => api.post(`/users/${u.id}/reset-link`)); if (r) window.prompt("Share this one-time link securely (dev mode: email not configured)", r.data.link); }}>Reset link</button><button className="btn-line btn-sm" onClick={() => act(() => api.post(`/users/${u.id}/revoke-sessions`), "Sessions revoked")}>Revoke sessions</button></span> }]} />
      <FormDialog open={open} onClose={() => setOpen(false)} title="New staff user" initial={{ role: "sales_agent" }} fields={[{ name: "name", label: "Name", required: true }, { name: "email", label: "Email", type: "email", required: true }, { name: "phone", label: "Phone" }, { name: "role", label: "Role", type: "select", required: true, options: roleOpts }, { name: "branch", label: "Branch", type: "select", options: branches.map((b) => ({ value: b.id, label: b.name })) }, { name: "password", label: "Initial password (blank = activation link)", type: "password", hint: "Min 8 characters" }]}
        onSubmit={async (v) => { const r = await api.post("/users", { ...v, branch_ids: v.branch ? [v.branch] : [] }); if (r.data.activation_link) window.prompt("Activation link (share securely)", r.data.activation_link); reload(); }} />
    </div>
  );
}

const SET_FIELDS = [{ name: "name", label: "Company name" }, { name: "legal_name", label: "Legal name" }, { name: "phone", label: "Phone" }, { name: "whatsapp", label: "WhatsApp number (with country code)", hint: "Leave blank to hide WhatsApp buttons" }, { name: "email", label: "Email" }, { name: "office_hours", label: "Office hours" }, { name: "address", label: "Address", full: true }, { name: "gstin", label: "Company GSTIN" }, { name: "gst_rate", label: "GST rate % (accountant-approved)", type: "number" }, { name: "gst_enabled", label: "Charge GST on invoices", type: "checkbox" }, { name: "invoice_due_days", label: "Invoice due days", type: "number" }, { name: "demo_mode", label: "Show 'sample listings' banner on website", type: "checkbox" }];
const CMS_FIELDS = [{ name: "hero_title", label: "Homepage hero title", full: true }, { name: "hero_subtitle", label: "Homepage hero subtitle", full: true }, { name: "seo_title", label: "SEO title", full: true }, { name: "seo_description", label: "SEO description", type: "textarea", full: true }];

function SettingsForm({ fields, initial, canEdit }) {
  const [v, setV] = useState(initial);
  const save = async () => { const body = { ...v }; fields.forEach((f) => { if (f.type === "number") body[f.name] = Number(body[f.name] || 0); }); await act(() => api.put("/settings", body), "Saved"); };
  return <div><div className="grid gap-4 sm:grid-cols-2">{fields.map((f) => <Field key={f.name} f={f} value={v[f.name]} onChange={(x) => setV({ ...v, [f.name]: x })} />)}</div>{canEdit && <button className="btn-dark btn-sm mt-4" onClick={save} data-testid="save-settings-btn">Save</button>}</div>;
}

export function Settings() {
  const { can } = useAuth();
  const [sp] = useSearchParams();
  const [s, setS] = useState(null);
  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const { rows: camps, reload } = useList(can("cms") ? "/campaigns" : "/branches");
  const [camp, setCamp] = useState(false);
  useEffect(() => { if (can("settings") || can("cms")) api.get("/settings").then((r) => setS(r.data)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const changePw = async () => { try { await api.post("/auth/change-password", pw); toast.success("Password changed"); setPw({ current_password: "", new_password: "" }); } catch (e) { toast.error(errMsg(e)); } };
  const logo = async (e) => { const fd = new FormData(); fd.append("file", e.target.files[0]); await act(() => api.post("/settings/logo", fd), "Logo updated"); };
  return (
    <div className="space-y-6">
      <PageHeader title="Settings & website content" />
      <Section title="Change password" testid="password-section"><div className="flex flex-wrap items-end gap-3" id={sp.get("tab") === "password" ? "focus" : undefined}><div><label className="lbl">Current</label><input type="password" className="inp" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} data-testid="current-password-input" /></div><div><label className="lbl">New (min 8)</label><input type="password" className="inp" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} data-testid="new-password-input" /></div><button className="btn-dark btn-sm" onClick={changePw} data-testid="change-password-btn">Update</button></div></Section>
      {s && can("settings") && <Section title="Company & tax"><SettingsForm fields={SET_FIELDS} initial={s} canEdit={can("settings", "w")} />{can("settings", "w") && <div className="mt-4 border-t border-slate-100 pt-4"><label className="lbl">Upload approved logo (PNG/JPG/WebP, max 1 MB)</label><input type="file" accept="image/png,image/jpeg,image/webp" onChange={logo} data-testid="logo-upload-input" /></div>}</Section>}
      {s && can("cms") && <Section title="Homepage & SEO (CMS)"><SettingsForm fields={CMS_FIELDS} initial={s} canEdit={can("cms", "w")} /><p className="mt-3 text-xs text-slate-400">Publish/unpublish and feature listings from each property's page. Approve owner photos for the website from the property's documents panel.</p></Section>}
      {can("cms") && <Section title="Campaigns & source attribution" actions={can("cms", "w") && <button className="btn-line btn-sm" onClick={() => setCamp(true)} data-testid="new-campaign-btn">New campaign</button>}><p className="mb-3 text-xs text-slate-500">Add <code>?utm_source=…&utm_campaign=CODE</code> to links. Website enquiries are attributed automatically.</p><DataTable testid="campaigns-table" rows={camps.filter((c) => c.code)} columns={[{ key: "name", label: "Campaign" }, { key: "code", label: "Code" }, { key: "channel", label: "Channel", render: (c) => label(c.channel) }, { key: "budget", label: "Budget", render: (c) => inr(c.budget) }, { key: "leads", label: "Leads" }, { key: "won", label: "Won" }]} /></Section>}
      <FormDialog open={camp} onClose={() => setCamp(false)} title="New campaign" fields={[{ name: "name", label: "Name", required: true }, { name: "code", label: "Code (utm_campaign)", required: true }, { name: "channel", label: "Channel", type: "select", options: opts(["social", "search_ads", "print", "referral", "portal", "whatsapp"]) }, { name: "budget", label: "Budget (₹)", type: "number" }, { name: "start_date", label: "Start", type: "date" }]} onSubmit={async (v) => { await api.post("/campaigns", v); reload(); }} />
    </div>
  );
}

export function Audit() {
  const [entity, setEntity] = useState("");
  const { rows } = useList("/audit", { entity: entity || undefined });
  return (
    <div>
      <PageHeader title="Audit log" sub="Sensitive actions, logins, exports, downloads and permission denials."><select className="inp !w-auto" value={entity} onChange={(e) => setEntity(e.target.value)} data-testid="audit-entity-filter"><option value="">All</option>{["auth", "users", "leads", "properties", "deals", "finance", "leases", "shortstay", "documents", "approvals", "settings", "reports"].map((x) => <option key={x} value={x}>{label(x)}</option>)}</select></PageHeader>
      <DataTable testid="audit-table" rows={rows} columns={[{ key: "at", label: "When", render: (a) => fmtDateTime(a.at) }, { key: "user_name", label: "User", render: (a) => a.user_name || a.user_id || "public" }, { key: "role", label: "Role", render: (a) => label(a.role) }, { key: "action", label: "Action", render: (a) => <span className={a.action === "permission_denied" ? "font-semibold text-red-700" : ""}>{label(a.action)}</span> }, { key: "entity", label: "Module" }, { key: "details", label: "Details", render: (a) => <span className="font-mono text-[11px] text-slate-500">{JSON.stringify(a.details).slice(0, 120)}</span> }]} />
    </div>
  );
}
