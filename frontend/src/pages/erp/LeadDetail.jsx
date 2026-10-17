import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { MessageCircle, Phone } from "lucide-react";
import { api, fmtDateTime, inr, label, opts, priceLabel, waLink, telLink, SITE_URL } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useDialog } from "../../lib/dialogs";
import { PageHeader, Badge, FormDialog, Section, Facts, DataTable, useList, act } from "../../components/erp/kit";
import { STAGES, leadFields } from "./Leads";

function Matches({ lead, onShared }) {
  const [rows, setRows] = useState(null);
  const [sel, setSel] = useState([]);
  useEffect(() => { api.get(`/leads/${lead.id}/matches`).then((r) => setRows(r.data)).catch(() => setRows([])); }, [lead.id]);
  if (rows === null) return <Section title="Matching listings"><p className="text-sm text-slate-500">Finding matches…</p></Section>;
  const picked = rows.filter((p) => sel.includes(p.id));
  const msg = `Hello ${lead.name}, here are properties that match what you asked for:\n${picked.map((p) => `• ${p.title} – ${priceLabel(p)}${p.listing_id ? `\n  ${SITE_URL}/properties/${p.listing_id}` : ""}`).join("\n")}\n\nReply here to book a site visit. – Sellandiamman Estates`;
  const link = waLink(lead.phone, msg);
  // A real link (not window.open) so it works with pop-up blockers; the click also records what was sent.
  const record = async () => {
    await act(() => api.post(`/leads/${lead.id}/share-listings`, { property_ids: sel }), `Recorded ${sel.length} shared listing${sel.length === 1 ? "" : "s"}`);
    setSel([]); onShared();
  };
  return (
    <Section title="Matching listings" testid="matches-section" actions={sel.length > 0 && link && <a className="btn-dark btn-sm" href={link} target="_blank" rel="noopener noreferrer" onClick={record} data-testid="share-matches-btn"><MessageCircle size={14} />Send {sel.length} on WhatsApp</a>}>
      {!rows.length ? <p className="text-sm text-slate-500">No listings match the budget and interest yet. Matches update as new properties are added.</p> :
        <ul className="divide-y divide-slate-100">{rows.slice(0, 10).map((p) => (
          <li key={p.id} className="flex items-start gap-3 py-2.5">
            <input type="checkbox" className="mt-1" checked={sel.includes(p.id)} onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} aria-label={`Select ${p.title}`} data-testid={`match-check-${p.code}`} />
            <div className="min-w-0 flex-1"><Link to={`/erp/properties/${p.id}`} className="text-sm font-medium text-slate-900 hover:underline">{p.code} · {p.title}</Link>
              <p className="text-xs text-slate-500">{priceLabel(p)} · {p.locality}, {p.city} · {label(p.status)}</p>
              {p.reasons?.length > 0 && <p className="mt-0.5 text-xs text-emerald-800">{p.reasons.join(" · ")}</p>}</div>
            {p.shared ? <Badge v="sent" tone="grey" /> : <span className="shrink-0 text-xs tabular text-slate-400">score {p.score}</span>}
          </li>))}</ul>}
    </Section>
  );
}

export default function LeadDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const dialog = useDialog();
  const { can, user } = useAuth();
  const [l, setL] = useState(null);
  const [dlg, setDlg] = useState("");
  const [visit, setVisit] = useState(null);
  const { rows: users } = useList("/users/lite");
  const { rows: props } = useList(can("properties") ? "/properties" : "/branches");
  const load = () => api.get(`/leads/${id}`).then((r) => setL(r.data)).catch(() => setL(false));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (l === false) return <p data-testid="lead-not-found">Lead not found or not accessible.</p>;
  if (!l) return <p className="text-sm text-slate-500">Loading…</p>;
  const w = can("leads", "w") && !l.anonymised;
  const patch = async (body, msg) => { await act(() => api.patch(`/leads/${id}`, body), msg); load(); };
  const propOpts = props.filter((p) => p.code).map((p) => ({ value: p.id, label: `${p.code} · ${p.title}` }));
  const close = () => setDlg("");
  const completeVisit = async (v) => { const fb = await dialog.ask({ title: "Visit feedback", label: "What did the customer say?", type: "textarea", required: false, okLabel: "Mark completed" }); if (fb !== null) { await act(() => api.patch(`/site-visits/${v.id}`, { status: "completed", feedback: fb }), "Visit completed"); load(); } };
  const setVisitStatus = async (v, status, msg) => { await act(() => api.patch(`/site-visits/${v.id}`, { status }), msg); load(); };
  const anonymise = async () => {
    const reason = await dialog.ask({ title: "Remove this person's data?", body: "Use this only when the customer asks for their personal data to be deleted. Their name, phone, email and notes are removed for good. Figures and history stay for reporting.", label: "How did they ask? (for the audit log)", okLabel: "Remove personal data", tone: "danger" });
    if (reason) { await act(() => api.post(`/leads/${id}/anonymise`, { confirm: true, reason }), "Personal data removed"); load(); }
  };
  const wa = waLink(l.phone, `Hello ${l.name}, this is ${user.name} from Sellandiamman Estates.`);
  return (
    <div className="space-y-6" data-testid="lead-detail">
      <PageHeader title={l.name} sub={`${l.code}${l.phone ? ` · ${l.phone}` : ""}${l.email ? ` · ${l.email}` : ""}`}>
        <Badge v={l.stage} testid="lead-stage-badge" />
        {l.phone && <a className="btn-line btn-sm" href={telLink(l.phone)}><Phone size={14} />Call</a>}
        {wa && <a className="btn-line btn-sm" href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} />WhatsApp</a>}
        {w && <button className="btn-line btn-sm" onClick={() => setDlg("edit")} data-testid="edit-lead-btn">Edit</button>}
        {w && <button className="btn-line btn-sm" onClick={() => setDlg("visit")} data-testid="schedule-visit-btn">Schedule visit</button>}
        {can("deals", "w") && w && !["won", "lost"].includes(l.stage) && <button className="btn-dark btn-sm" onClick={() => setDlg("convert")} data-testid="convert-deal-btn">Convert to deal</button>}
      </PageHeader>
      {l.anonymised && <p className="bg-slate-100 p-3 text-sm text-slate-600" data-testid="lead-anonymised">Personal data was removed on the customer's request.</p>}
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Section title="Profile">
            <Facts items={[["Customer type", label(l.customer_type)], ["Interest", label(l.interest)], ["Source", label(l.source)], ["Budget", l.budget_max ? `${l.budget_min ? `${inr(l.budget_min, true)} – ` : "up to "}${inr(l.budget_max, true)}` : "-"], ["Preferred locations", l.preferred_locations], ["Next follow-up", fmtDateTime(l.next_follow_up)], ["Owner", users.find((u) => u.id === l.assigned_to)?.name || "Unassigned"], ["Preferred contact", label(l.preferred_contact)], ["Marketing consent", l.consent?.marketing ? "Yes" : "No"], ["Requirements", l.requirements]]} />
          </Section>
          {w && <Section title="Stage & assignment">
            <div className="flex flex-wrap items-end gap-3">
              <div><label className="lbl" htmlFor="lead-stage">Stage</label><select id="lead-stage" className="inp" value={l.stage} onChange={(e) => e.target.value === "lost" ? setDlg("lost") : patch({ stage: e.target.value }, "Stage updated")} data-testid="lead-stage-select" disabled={l.stage === "won"}>{STAGES.filter((s) => s !== "won" || l.stage === "won").map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
              {user.role !== "sales_agent" && <div><label className="lbl" htmlFor="lead-assign">Assigned agent</label><select id="lead-assign" className="inp" value={l.assigned_to || ""} onChange={(e) => patch({ assigned_to: e.target.value || null }, "Lead assigned")} data-testid="lead-assign-select"><option value="">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name} ({label(u.role)})</option>)}</select></div>}
            </div>
            {l.lost_reason && <p className="mt-3 text-sm text-red-700">Lost reason: {label(l.lost_reason)}</p>}
          </Section>}
          {can("properties") && !l.anonymised && <Matches lead={l} onShared={load} />}
          <Section title="Site visits" testid="site-visits-section">
            <DataTable testid="visits-table" rows={l.site_visits} columns={[
              { key: "property_code", label: "Property", render: (v) => `${v.property_code} · ${v.property_title}` },
              { key: "scheduled_at", label: "When", render: (v) => <>{fmtDateTime(v.scheduled_at)}{v.status === "requested" && <span className="block text-xs text-slate-500">asked for {label(v.preferred_slot || "any time")}</span>}</> },
              { key: "status", label: "Status", render: (v) => <Badge v={v.status} /> },
              { key: "a", label: "", render: (v) => w && v.status === "requested" ? <span className="flex flex-wrap gap-1"><button className="btn-dark btn-sm" onClick={() => setVisit(v)} data-testid={`confirm-visit-${v.id}`}>Confirm time</button><button className="btn-line btn-sm" onClick={() => setVisitStatus(v, "cancelled", "Request declined")}>Decline</button></span>
                : w && v.status === "scheduled" ? <span className="flex flex-wrap gap-1"><button className="btn-line btn-sm" onClick={() => completeVisit(v)} data-testid={`complete-visit-${v.id}`}>Completed</button><button className="btn-line btn-sm" onClick={() => setVisitStatus(v, "no_show", "Marked as no-show")}>No-show</button><button className="btn-line btn-sm" onClick={() => setVisitStatus(v, "cancelled", "Visit cancelled")}>Cancel</button></span> : v.feedback || "" },
            ]} empty="No visits yet." />
          </Section>
          {l.deals?.length > 0 && <Section title="Deals">{l.deals.map((d) => <Link key={d.id} to={`/erp/deals/${d.id}`} className="flex justify-between border-b border-slate-100 py-2 text-sm hover:underline"><span>{d.code} · {d.title}</span><Badge v={d.stage} /></Link>)}</Section>}
          {can("leads", "a") && !l.anonymised && <Section title="Data protection"><p className="text-sm text-slate-600">If the customer asks you to delete their personal data, remove it here. This cannot be undone.</p><button className="btn-line btn-sm mt-3" onClick={anonymise} data-testid="anonymise-btn">Remove personal data…</button></Section>}
        </div>
        <Section title="Activity" testid="activity-section" actions={w && <button className="btn-dark btn-sm" onClick={() => setDlg("activity")} data-testid="log-activity-btn">Log activity</button>}>
          <ol className="space-y-4">{l.activities.map((a) => <li key={a.id} className="border-l-2 border-slate-200 pl-3 text-sm"><p className="text-xs text-slate-400">{fmtDateTime(a.created_at)} · {a.user_name} · {label(a.kind)}</p><p className="text-slate-700">{a.notes}</p>{a.outcome && <p className="text-xs text-slate-500">Outcome: {a.outcome}</p>}</li>)}</ol>
        </Section>
      </div>
      <FormDialog open={dlg === "edit"} onClose={close} title="Edit lead" fields={leadFields(users, false).filter((f) => !["phone", "source"].includes(f.name))} initial={{ ...l, marketing_consent: l.consent?.marketing }} onSubmit={async (v) => { const { name, email, organization, customer_type, interest, preferred_locations, budget_min, budget_max, next_follow_up, requirements, marketing_consent } = v; await api.patch(`/leads/${id}`, { name, email, organization, customer_type, interest, preferred_locations, budget_min, budget_max, next_follow_up, requirements, marketing_consent }); load(); }} />
      <FormDialog open={dlg === "activity"} onClose={close} title="Log activity" initial={{ kind: "call" }} fields={[{ name: "kind", label: "Type", type: "select", required: true, options: opts(["call", "whatsapp", "email", "meeting", "sms", "note"]) }, { name: "outcome", label: "Outcome" }, { name: "notes", label: "Notes", type: "textarea", required: true, full: true }, { name: "next_follow_up", label: "Next follow-up", type: "datetime-local" }]} onSubmit={async (v) => { await api.post(`/leads/${id}/activities`, v); load(); }} />
      <FormDialog open={dlg === "visit"} onClose={close} title="Schedule site visit" initial={{ property_id: l.property_id }} fields={[{ name: "property_id", label: "Property", type: "select", required: true, options: propOpts, full: true }, { name: "scheduled_at", label: "Date & time", type: "datetime-local", required: true }, { name: "notes", label: "Notes", full: true }]} onSubmit={async (v) => { await api.post(`/leads/${id}/site-visits`, v); load(); }} />
      <FormDialog open={!!visit} onClose={() => setVisit(null)} title="Confirm visit time" submitLabel="Confirm visit" initial={{ scheduled_at: visit?.scheduled_at?.slice(0, 16) }} fields={[{ name: "scheduled_at", label: "Date & time", type: "datetime-local", required: true, full: true, hint: "The assigned agent is notified." }]} onSubmit={async (v) => { await api.patch(`/site-visits/${visit.id}`, { status: "scheduled", scheduled_at: v.scheduled_at }); load(); }} />
      <FormDialog open={dlg === "lost"} onClose={close} title="Mark lead as lost" fields={[{ name: "lost_reason", label: "Lost reason", type: "select", required: true, options: opts(["budget_mismatch", "bought_elsewhere", "not_responding", "requirement_changed", "location_mismatch", "duplicate", "other"]) }]} onSubmit={async (v) => { await api.patch(`/leads/${id}`, { stage: "lost", lost_reason: v.lost_reason }); load(); }} />
      <FormDialog open={dlg === "convert"} onClose={close} title="Convert to deal" initial={{ deal_type: l.interest === "rent" ? "rent" : l.interest === "lease" ? "lease" : "sale", property_id: l.property_id }} fields={[{ name: "property_id", label: "Property", type: "select", required: true, options: propOpts, full: true }, { name: "deal_type", label: "Deal type", type: "select", required: true, options: opts(["sale", "rent", "lease"]) }]} onSubmit={async (v) => { const r = await api.post(`/leads/${id}/convert`, v); nav(`/erp/deals/${r.data.id}`); }} />
    </div>
  );
}
