import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, fmtDateTime, label, opts, openFile } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useDialog } from "../../lib/dialogs";
import { PageHeader, DataTable, Badge, FormDialog, useList, act } from "../../components/erp/kit";

export const STAGES = ["new", "contacted", "qualified", "requirements", "matched", "site_visit", "negotiation", "won", "lost"];
export const SOURCES = ["website", "whatsapp", "phone", "referral", "walk_in", "portal", "social", "broker", "existing_customer", "campaign"];
const TYPES = ["buyer", "seller", "tenant", "landlord", "investor", "business"];

export const leadFields = (users, canAssign) => [
  { name: "name", label: "Name", required: true }, { name: "phone", label: "Mobile", required: true },
  { name: "email", label: "Email" }, { name: "organization", label: "Organization" },
  { name: "customer_type", label: "Customer type", type: "select", options: opts(TYPES), required: true },
  { name: "source", label: "Source", type: "select", options: opts(SOURCES), required: true },
  { name: "interest", label: "Interest", type: "select", options: opts(["buy", "rent", "lease", "short_stay", "sell", "management", "commercial"]), required: true },
  { name: "preferred_locations", label: "Preferred locations" },
  { name: "budget_min", label: "Budget min (₹)", type: "number" }, { name: "budget_max", label: "Budget max (₹)", type: "number" },
  { name: "next_follow_up", label: "Next follow-up", type: "datetime-local" },
  ...(canAssign ? [{ name: "assigned_to", label: "Assign to", type: "select", options: users.map((u) => ({ value: u.id, label: `${u.name} (${label(u.role)})` })) }] : []),
  { name: "requirements", label: "Requirements", type: "textarea", full: true },
  { name: "marketing_consent", label: "Customer consents to marketing messages", type: "checkbox" },
];

function Pipeline({ rows, onMove, onOpen }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-3" data-testid="lead-pipeline">
      {STAGES.map((s) => (
        <div key={s} className="w-64 shrink-0 bg-slate-100 p-2" data-testid={`pipeline-col-${s}`}>
          <p className="mb-2 flex justify-between px-1 text-xs font-semibold uppercase tracking-wider text-slate-500"><span>{label(s)}</span><span>{rows.filter((r) => r.stage === s).length}</span></p>
          <div className="space-y-2">{rows.filter((r) => r.stage === s).map((r) => (
            <div key={r.id} className="border border-slate-200 bg-white p-3 text-sm">
              <button className="text-left font-medium hover:underline" onClick={() => onOpen(r)}>{r.name}</button>
              <p className="text-xs text-slate-500">{label(r.interest)} · {label(r.source)}</p>
              <select className="mt-2 w-full border border-slate-200 px-1 py-1 text-xs" value={r.stage} onChange={(e) => onMove(r, e.target.value)} disabled={["won", "lost"].includes(r.stage)} data-testid={`pipeline-move-${r.code}`}>{STAGES.filter((x) => x !== "won" && x !== "lost").concat(r.stage === "won" || r.stage === "lost" ? [r.stage] : []).map((x) => <option key={x} value={x}>{label(x)}</option>)}</select>
            </div>))}</div>
        </div>
      ))}
    </div>
  );
}

export default function Leads() {
  const nav = useNavigate();
  const { can, user } = useAuth();
  const dialog = useDialog();
  const [sp] = useSearchParams();
  const [flt, setFlt] = useState({ stage: "", source: "", q: "", overdue: sp.get("overdue") === "1" });
  const [view, setView] = useState("table");
  const [open, setOpen] = useState(false);
  const { rows, reload } = useList("/leads", { ...flt, stage: flt.stage || undefined, source: flt.source || undefined, q: flt.q || undefined, overdue: flt.overdue || undefined });
  const { rows: users } = useList("/users/lite");
  const canAssign = user.role !== "sales_agent";
  const move = async (r, stage) => { await act(() => api.patch(`/leads/${r.id}`, { stage }), "Stage updated"); reload(); };
  const importCsv = async (e) => { const fd = new FormData(); fd.append("file", e.target.files[0]); e.target.value = ""; const r = await act(() => api.post("/leads/import", fd)); if (r) { reload(); await dialog.notice({ title: "Import finished", body: `${r.data.created} new lead${r.data.created === 1 ? "" : "s"} created. ${r.data.duplicates} matched open leads and were added as repeat enquiries.${r.data.errors.length ? `\n\nRows skipped:\n${r.data.errors.join("\n")}` : ""}` }); } };
  const now = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 16);
  return (
    <div>
      <PageHeader title="CRM & Leads" sub="Every lead has an owner, a stage and a next action.">
        <button className="btn-line btn-sm" onClick={() => setView(view === "table" ? "pipeline" : "table")} data-testid="toggle-pipeline-btn">{view === "table" ? "Pipeline view" : "Table view"}</button>
        {can("leads", "e") && <button className="btn-line btn-sm" onClick={() => openFile("/leads/export.csv", { name: "Leads", csv: true })} data-testid="export-leads-btn">Export CSV</button>}
        {can("leads", "e") && can("leads", "w") && <label className="btn-line btn-sm cursor-pointer">Import CSV<input type="file" accept=".csv" className="hidden" onChange={importCsv} data-testid="import-leads-input" /></label>}
        {can("leads", "w") && <button className="btn-dark btn-sm" onClick={() => setOpen(true)} data-testid="new-lead-btn">New lead</button>}
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="inp sm:!w-56" placeholder="Search name, phone, code" value={flt.q} onChange={(e) => setFlt({ ...flt, q: e.target.value })} data-testid="lead-search-input" />
        <select className="inp !w-auto" value={flt.stage} onChange={(e) => setFlt({ ...flt, stage: e.target.value })} data-testid="lead-stage-filter"><option value="">All stages</option>{STAGES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <select className="inp !w-auto" value={flt.source} onChange={(e) => setFlt({ ...flt, source: e.target.value })} data-testid="lead-source-filter"><option value="">All sources</option>{SOURCES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={flt.overdue} onChange={(e) => setFlt({ ...flt, overdue: e.target.checked })} data-testid="lead-overdue-filter" />Overdue follow-ups</label>
      </div>
      {view === "pipeline" ? <Pipeline rows={rows} onMove={move} onOpen={(r) => nav(`/erp/leads/${r.id}`)} /> :
        <DataTable testid="leads-table" onRow={(r) => nav(`/erp/leads/${r.id}`)} rows={rows} columns={[
          { key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "phone", label: "Phone" },
          { key: "interest", label: "Interest", render: (r) => label(r.interest) }, { key: "source", label: "Source", render: (r) => label(r.source) },
          { key: "stage", label: "Stage", render: (r) => <Badge v={r.stage} /> },
          { key: "assigned_to", label: "Owner", render: (r) => users.find((u) => u.id === r.assigned_to)?.name || <span className="text-amber-700">Unassigned</span> },
          { key: "next_follow_up", label: "Next follow-up", render: (r) => r.next_follow_up ? <span className={r.next_follow_up < now && !["won", "lost"].includes(r.stage) ? "font-semibold text-red-700" : ""}>{fmtDateTime(r.next_follow_up)}</span> : "-" },
        ]} />}
      <FormDialog open={open} onClose={() => setOpen(false)} title="New lead" fields={leadFields(users, canAssign)} initial={{ customer_type: "buyer", source: "phone", interest: "buy" }}
        onSubmit={async (v) => {
          try { const r = await api.post("/leads", v); nav(`/erp/leads/${r.data.id}`); }
          catch (e) { if (e.response?.status === 409 && await dialog.confirm({ title: "Possible duplicate", body: `${e.response.data.detail}. Create a separate lead anyway?`, okLabel: "Create anyway" })) { const r = await api.post("/leads", { ...v, force: true }); nav(`/erp/leads/${r.data.id}`); } else throw e; }
        }} />
    </div>
  );
}
