import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, fmtDateTime, inr, label, opts } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { PageHeader, Badge, FormDialog, Section, Facts, DataTable, useList, act } from "../../components/erp/kit";
import { STAGES, leadFields } from "./Leads";

export default function LeadDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, user } = useAuth();
  const [l, setL] = useState(null);
  const [dlg, setDlg] = useState("");
  const { rows: users } = useList("/users/lite");
  const { rows: props } = useList("/properties");
  const load = () => api.get(`/leads/${id}`).then((r) => setL(r.data)).catch(() => setL(false));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (l === false) return <p data-testid="lead-not-found">Lead not found or not accessible.</p>;
  if (!l) return <p className="text-sm text-slate-500">Loading…</p>;
  const w = can("leads", "w");
  const patch = async (body, msg) => { await act(() => api.patch(`/leads/${id}`, body), msg); load(); };
  const propOpts = props.map((p) => ({ value: p.id, label: `${p.code} · ${p.title}` }));
  const close = () => setDlg("");
  return (
    <div className="space-y-6" data-testid="lead-detail">
      <PageHeader title={`${l.name}`} sub={`${l.code} · ${l.phone}${l.email ? ` · ${l.email}` : ""}`}>
        <Badge v={l.stage} testid="lead-stage-badge" />
        {w && <button className="btn-line btn-sm" onClick={() => setDlg("edit")} data-testid="edit-lead-btn">Edit</button>}
        {w && <button className="btn-line btn-sm" onClick={() => setDlg("visit")} data-testid="schedule-visit-btn">Schedule site visit</button>}
        {can("deals", "w") && !["won", "lost"].includes(l.stage) && <button className="btn-dark btn-sm" onClick={() => setDlg("convert")} data-testid="convert-deal-btn">Convert to deal</button>}
      </PageHeader>
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Section title="Profile">
            <Facts items={[["Customer type", label(l.customer_type)], ["Interest", label(l.interest)], ["Source", label(l.source)], ["Budget", l.budget_max ? `${inr(l.budget_min, true)} – ${inr(l.budget_max, true)}` : "-"], ["Preferred locations", l.preferred_locations], ["Next follow-up", fmtDateTime(l.next_follow_up)], ["Owner", users.find((u) => u.id === l.assigned_to)?.name || "Unassigned"], ["Preferred contact", label(l.preferred_contact)], ["Marketing consent", l.consent?.marketing ? "Yes" : "No"], ["Requirements", l.requirements]]} />
          </Section>
          {w && <Section title="Stage & assignment">
            <div className="flex flex-wrap items-end gap-3">
              <div><label className="lbl">Stage</label><select className="inp" value={l.stage} onChange={(e) => e.target.value === "lost" ? setDlg("lost") : patch({ stage: e.target.value }, "Stage updated")} data-testid="lead-stage-select" disabled={l.stage === "won"}>{STAGES.filter((s) => s !== "won" || l.stage === "won").map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
              {user.role !== "sales_agent" && <div><label className="lbl">Assigned agent</label><select className="inp" value={l.assigned_to || ""} onChange={(e) => patch({ assigned_to: e.target.value || null }, "Lead assigned")} data-testid="lead-assign-select"><option value="">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name} ({label(u.role)})</option>)}</select></div>}
            </div>
            {l.lost_reason && <p className="mt-3 text-sm text-red-700">Lost reason: {l.lost_reason}</p>}
          </Section>}
          <Section title="Site visits" testid="site-visits-section">
            <DataTable testid="visits-table" rows={l.site_visits} columns={[{ key: "property_code", label: "Property", render: (v) => `${v.property_code} · ${v.property_title}` }, { key: "scheduled_at", label: "When", render: (v) => fmtDateTime(v.scheduled_at) }, { key: "status", label: "Status", render: (v) => <Badge v={v.status} /> }, { key: "a", label: "", render: (v) => w && v.status === "scheduled" ? <span className="flex gap-1"><button className="btn-line btn-sm" onClick={async () => { const fb = window.prompt("Visit feedback"); if (fb !== null) { await act(() => api.patch(`/site-visits/${v.id}`, { status: "completed", feedback: fb }), "Visit completed"); load(); } }} data-testid={`complete-visit-${v.id}`}>Complete</button><button className="btn-line btn-sm" onClick={async () => { await act(() => api.patch(`/site-visits/${v.id}`, { status: "cancelled" })); load(); }}>Cancel</button></span> : v.feedback || "" }]} />
          </Section>
          {l.deals?.length > 0 && <Section title="Deals">{l.deals.map((d) => <Link key={d.id} to={`/erp/deals/${d.id}`} className="flex justify-between border-b border-slate-100 py-2 text-sm hover:underline"><span>{d.code} · {d.title}</span><Badge v={d.stage} /></Link>)}</Section>}
        </div>
        <Section title="Activity" testid="activity-section" actions={w && <button className="btn-dark btn-sm" onClick={() => setDlg("activity")} data-testid="log-activity-btn">Log activity</button>}>
          <ol className="space-y-4">{l.activities.map((a) => <li key={a.id} className="border-l-2 border-slate-200 pl-3 text-sm"><p className="text-xs text-slate-400">{fmtDateTime(a.created_at)} · {a.user_name} · {label(a.kind)}</p><p className="text-slate-700">{a.notes}</p>{a.outcome && <p className="text-xs text-slate-500">Outcome: {a.outcome}</p>}</li>)}</ol>
        </Section>
      </div>
      <FormDialog open={dlg === "edit"} onClose={close} title="Edit lead" fields={leadFields(users, false).filter((f) => !["phone", "source"].includes(f.name))} initial={{ ...l, marketing_consent: l.consent?.marketing }} onSubmit={async (v) => { const { name, email, organization, customer_type, interest, preferred_locations, budget_min, budget_max, next_follow_up, requirements, marketing_consent } = v; await api.patch(`/leads/${id}`, { name, email, organization, customer_type, interest, preferred_locations, budget_min, budget_max, next_follow_up, requirements, marketing_consent }); load(); }} />
      <FormDialog open={dlg === "activity"} onClose={close} title="Log activity" initial={{ kind: "call" }} fields={[{ name: "kind", label: "Type", type: "select", required: true, options: opts(["call", "whatsapp", "email", "meeting", "sms", "note"]) }, { name: "outcome", label: "Outcome" }, { name: "notes", label: "Notes", type: "textarea", required: true, full: true }, { name: "next_follow_up", label: "Next follow-up", type: "datetime-local" }]} onSubmit={async (v) => { await api.post(`/leads/${id}/activities`, v); load(); }} />
      <FormDialog open={dlg === "visit"} onClose={close} title="Schedule site visit" fields={[{ name: "property_id", label: "Property", type: "select", required: true, options: propOpts, full: true }, { name: "scheduled_at", label: "Date & time", type: "datetime-local", required: true }, { name: "notes", label: "Notes", full: true }]} onSubmit={async (v) => { await api.post(`/leads/${id}/site-visits`, v); load(); }} />
      <FormDialog open={dlg === "lost"} onClose={close} title="Mark lead as lost" fields={[{ name: "lost_reason", label: "Lost reason", type: "select", required: true, options: opts(["budget_mismatch", "bought_elsewhere", "not_responding", "requirement_changed", "location_mismatch", "duplicate", "other"]) }]} onSubmit={async (v) => { await api.patch(`/leads/${id}`, { stage: "lost", lost_reason: v.lost_reason }); load(); }} />
      <FormDialog open={dlg === "convert"} onClose={close} title="Convert to deal" initial={{ deal_type: l.interest === "rent" ? "rent" : l.interest === "lease" ? "lease" : "sale", property_id: l.property_id }} fields={[{ name: "property_id", label: "Property", type: "select", required: true, options: propOpts, full: true }, { name: "deal_type", label: "Deal type", type: "select", required: true, options: opts(["sale", "rent", "lease"]) }]} onSubmit={async (v) => { const r = await api.post(`/leads/${id}/convert`, v); nav(`/erp/deals/${r.data.id}`); }} />
    </div>
  );
}
