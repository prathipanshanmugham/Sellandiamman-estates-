import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, inr, label, fmtDateTime } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Kpi, PageHeader, Section, DataTable, act } from "../../components/erp/kit";

const STAGES = ["new", "contacted", "qualified", "requirements", "matched", "site_visit", "negotiation", "won", "lost"];

export default function Dashboard() {
  const nav = useNavigate();
  const { user, can } = useAuth();
  const [r, setR] = useState({ frm: "", to: "" });
  const [d, setD] = useState(null);
  const [visits, setVisits] = useState([]);
  useEffect(() => { api.get("/dashboard", { params: { frm: r.frm || undefined, to: r.to || undefined } }).then((x) => setD(x.data)).catch(() => setD({})); }, [r]);
  useEffect(() => { if (can("leads")) api.get("/site-visits").then((x) => setVisits(x.data.filter((v) => v.status === "requested"))).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <p className="text-sm text-slate-500">Loading dashboard…</p>;
  if (!d.range && !d.leads && !d.finance) return <p className="text-sm text-slate-500">The dashboard could not be loaded. Refresh to try again.</p>;
  const f = d.finance;
  return (
    <div className="space-y-6" data-testid="dashboard">
      <PageHeader title={`Welcome, ${user.name}`} sub="Business overview. Figures respect your role's access.">
        <input type="date" className="inp !w-auto" value={r.frm} onChange={(e) => setR({ ...r, frm: e.target.value })} data-testid="dash-from" aria-label="From" />
        <input type="date" className="inp !w-auto" value={r.to} onChange={(e) => setR({ ...r, to: e.target.value })} data-testid="dash-to" aria-label="To" />
        <button className="btn-line btn-sm" onClick={async () => { const x = await act(() => api.post("/automations/run")); if (x) act(async () => x, `Checked ${x.data.checked} reminders`); }} data-testid="run-reminders-btn">Check reminders now</button>
      </PageHeader>
      {d.leads && <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Kpi title="New leads" value={d.leads.new} testid="kpi-new-leads" onClick={() => nav("/erp/leads")} />
        <Kpi title="Overdue follow-ups" value={d.leads.awaiting_followup} testid="kpi-overdue" onClick={() => nav("/erp/leads?overdue=1")} />
        <Kpi title="Qualified pipeline" value={d.leads.qualified} testid="kpi-qualified" />
        <Kpi title="Visits scheduled" value={d.site_visits.scheduled} hint={`${d.site_visits.requested} requests waiting · ${d.site_visits.completed} done`} testid="kpi-visits" onClick={() => nav("/erp/calendar")} />
        {d.deals && <Kpi title="Offers / negotiation" value={d.deals.negotiating} testid="kpi-negotiating" onClick={() => nav("/erp/deals")} />}
        {d.deals && <Kpi title="Closed deals" value={d.deals.closed} testid="kpi-closed" />}
      </div>}
      {visits.length > 0 && <Section title={`Visit requests waiting (${visits.length})`} testid="visit-requests">
        <ul className="divide-y divide-slate-100">{visits.map((v) => <li key={v.id}><Link to={`/erp/leads/${v.lead_id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm hover:underline"><span><b>{v.lead_name}</b> · {v.property_code} {v.property_title}</span><span className="text-xs text-slate-500">asked for {fmtDateTime(v.scheduled_at)} ({label(v.preferred_slot || "any time")})</span></Link></li>)}</ul>
        <p className="mt-2 text-xs text-slate-400">Open the lead to confirm a time. The customer booked these on the website.</p>
      </Section>}
      {f && <Section title="Revenue recognition" testid="revenue-section">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi title="Quoted commission" value={inr(f.quoted_commission, true)} hint="Open deals, no signed agreement" testid="kpi-quoted" />
          <Kpi title="Expected commission" value={inr(f.expected_commission, true)} hint="Open deals, signed agreement" testid="kpi-expected" />
          <Kpi title="Earned commission" value={inr(f.earned_commission, true)} hint="Deals closed in period" testid="kpi-earned" />
          <Kpi title="Invoiced" value={inr(f.invoiced, true)} testid="kpi-invoiced" />
          <Kpi title="Collected cash" value={inr(f.collected, true)} hint="Company revenue only" testid="kpi-collected" />
          <Kpi title="Receivables" value={inr(f.receivables, true)} hint={`${inr(f.overdue_receivables, true)} overdue`} testid="kpi-receivables" onClick={() => nav("/erp/finance")} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi title="Monthly recurring mgmt fees" value={inr(f.monthly_recurring_mgmt, true)} testid="kpi-mrr" />
          <Kpi title="Expenses" value={inr(f.expenses, true)} testid="kpi-expenses" />
          <Kpi title="Operating cash flow" value={inr(f.operating_cash_flow, true)} testid="kpi-cashflow" />
          <Kpi title="Marketing spend" value={inr(f.marketing_spend, true)} testid="kpi-marketing" />
        </div>
        <p className="mt-3 text-xs text-slate-400">Property sale values, rent collected for owners, deposits and gross booking proceeds are excluded from company revenue.</p>
      </Section>}
      {(d.pm || d.shortstay) && <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {d.pm && <><Kpi title="Active leases" value={d.pm.active_leases} testid="kpi-leases" onClick={() => nav("/erp/leases")} /><Kpi title="Leases expiring (60d)" value={d.pm.expiring_60d} testid="kpi-expiring" /><Kpi title="Vacant rentals" value={d.pm.vacant} testid="kpi-vacant" /><Kpi title="Open work orders" value={d.pm.open_work_orders} testid="kpi-workorders" onClick={() => nav("/erp/maintenance")} /></>}
        {d.shortstay && <><Kpi title="Short-stay bookings" value={d.shortstay.bookings} testid="kpi-bookings" onClick={() => nav("/erp/short-stay")} /><Kpi title="Gross booking value" value={inr(d.shortstay.gross, true)} hint="Not company revenue" testid="kpi-booking-gross" /><Kpi title="Average daily rate" value={inr(d.shortstay.adr, true)} hint={`${d.shortstay.nights} nights`} testid="kpi-adr" /></>}
      </div>}
      <div className="grid gap-6 xl:grid-cols-2">
        {d.leads && <Section title="Lead pipeline"><ResponsiveContainer width="100%" height={240}><BarChart data={STAGES.map((s) => ({ stage: label(s), n: d.leads.by_stage[s] || 0 }))}><CartesianGrid stroke="#f1f5f9" /><XAxis dataKey="stage" tick={{ fontSize: 10 }} interval={0} angle={-20} height={50} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="n" name="Leads" fill="#334155" /></BarChart></ResponsiveContainer></Section>}
        {f && <Section title="Collections vs expenses (6 months)"><ResponsiveContainer width="100%" height={240}><BarChart data={f.trend}><CartesianGrid stroke="#f1f5f9" /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => inr(v, true)} width={70} /><Tooltip formatter={(v) => inr(v)} /><Legend /><Bar dataKey="collected" name="Collected" fill="#1e293b" /><Bar dataKey="expenses" name="Expenses" fill="#94a3b8" /></BarChart></ResponsiveContainer></Section>}
        {d.leads && <Section title="Lead sources"><DataTable testid="lead-sources-table" columns={[{ key: "source", label: "Source", render: (x) => label(x.source) }, { key: "leads", label: "Leads" }, { key: "won", label: "Won" }]} rows={d.leads.by_source} /></Section>}
        {d.staff && <Section title="Staff workload & conversion"><DataTable testid="staff-table" columns={[{ key: "name", label: "Staff" }, { key: "open", label: "Open leads" }, { key: "won", label: "Won" }, { key: "conversion", label: "Conversion", render: (x) => `${x.conversion}%` }]} rows={d.staff} /></Section>}
        {f?.by_service?.length > 0 && <Section title="Revenue by service"><DataTable columns={[{ key: "service", label: "Service", render: (x) => label(x.service) }, { key: "amount", label: "Collected", render: (x) => inr(x.amount) }]} rows={f.by_service} /></Section>}
      </div>
    </div>
  );
}
