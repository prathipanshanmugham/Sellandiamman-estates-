import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { api, fmtDate, inr, label, opts, openFile, useMeta, priceLabel, imgSrc } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Logo } from "../../components/brand/Logo";
import { Badge, DataTable, Kpi, Section, FormDialog, useList, act, Facts } from "../../components/erp/kit";

const TABS = [["/owner", "Overview"], ["/owner/rent", "Rent & tenants"], ["/owner/statements", "Statements"], ["/owner/requests", "Maintenance"], ["/owner/stays", "Short stays"], ["/owner/documents", "Documents"]];
const monthLabel = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

export function OwnerLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  useMeta({ title: "Owner portal", noindex: true });
  return (
    <div className="min-h-screen bg-slate-50" data-testid="owner-portal">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/owner" aria-label="Owner portal home"><Logo size="sm" /></Link>
          <div className="flex items-center gap-3 text-sm"><span className="hidden text-slate-600 sm:inline" data-testid="owner-name">{user.name}</span><button className="flex items-center gap-1 text-slate-600 hover:text-slate-900" onClick={async () => { await logout(); nav("/erp/login"); }} data-testid="owner-logout"><LogOut size={16} />Sign out</button></div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 sm:px-4" aria-label="Owner portal">
          {TABS.map(([to, l]) => <NavLink key={to} to={to} end className={({ isActive }) => `shrink-0 border-b-2 px-3 py-2.5 text-sm ${isActive ? "border-slate-900 font-semibold text-slate-900" : "border-transparent text-slate-600 hover:text-slate-900"}`} data-testid={`owner-tab-${l.split(" ")[0].toLowerCase()}`}>{l}</NavLink>)}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8"><Outlet /></main>
      <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-slate-500 sm:px-6">Rent and deposits are held for you in a separate owner-funds account and are never counted as our income. Questions? Call your property manager or write to us from the <Link to="/contact" className="underline">contact page</Link>.</footer>
    </div>
  );
}

export function OwnerOverview() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get("/portal/overview").then((r) => setD(r.data)).catch(() => setD(false)); }, []);
  if (d === false) return <p className="text-sm text-slate-500">Could not load your details. Refresh to try again.</p>;
  if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  const m = d.this_month;
  return (
    <div className="space-y-6">
      <div><p className="eyebrow">Owner {d.owner.code}</p><h1 className="mt-1 font-heading text-2xl font-semibold">Hello, {d.owner.name}</h1></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi title={`Rent collected · ${monthLabel(d.month)}`} value={inr(m.rent_collected, true)} testid="owner-kpi-rent" />
        <Kpi title="Payable to you this month" value={inr(m.net_payable, true)} hint={`after ${inr(m.management_fee, true)} fee and ${inr(m.expenses, true)} repairs`} testid="owner-kpi-net" />
        <Kpi title="Rent overdue" value={inr(d.arrears, true)} hint={d.arrears > 0 ? "We are following up" : "All tenants up to date"} testid="owner-kpi-arrears" />
        <Kpi title="Open maintenance" value={d.open_requests} hint={`${d.upcoming_stays} upcoming stays`} testid="owner-kpi-requests" />
      </div>
      {d.last_statement && <Section title="Latest statement"><div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>{monthLabel(d.last_statement.month)} · net {inr(d.last_statement.net_payable)} · <Badge v={d.last_statement.payout_status} /> {d.last_statement.payout_reference && <span className="text-xs text-slate-500">ref {d.last_statement.payout_reference}</span>}</span><button className="btn-line btn-sm" onClick={() => openFile(`/portal/statements/${d.last_statement.month}/pdf`, { name: `Statement ${d.last_statement.month}` })} data-testid="owner-latest-pdf">Statement PDF</button></div></Section>}
      <Section title={`Your properties (${d.properties.length})`}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{d.properties.map((p) => <div key={p.id} className="border border-slate-200 bg-white" data-testid={`owner-prop-${p.code}`}><img src={imgSrc(p.images?.[0])} alt="" className="aspect-[16/9] w-full object-cover" /><div className="p-4"><p className="font-heading font-semibold">{p.title}</p><p className="text-xs text-slate-500">{p.locality}, {p.city} · {p.code}</p><p className="mt-2 flex flex-wrap gap-1"><Badge v={p.status} /><Badge v={p.occupancy || "vacant"} tone={p.occupancy === "occupied" ? "green" : "amber"} /></p><p className="mt-2 text-sm">{priceLabel(p)}{p.mgmt_fee_pct ? ` · our fee ${p.mgmt_fee_pct}%` : ""}</p>{p.listing_id && ["published", "under_offer"].includes(p.status) && <Link to={`/properties/${p.listing_id}`} className="mt-2 inline-block text-xs underline">See the public listing</Link>}</div></div>)}</div>
      </Section>
      {d.rent_due.length > 0 && <Section title="Next rent due"><DataTable rows={d.rent_due} columns={[{ key: "property_title", label: "Property" }, { key: "period", label: "Month", render: (r) => monthLabel(r.period) }, { key: "due_date", label: "Due", render: (r) => fmtDate(r.due_date) }, { key: "balance", label: "Amount", render: (r) => inr(r.balance) }]} /></Section>}
    </div>
  );
}

export function OwnerRent() {
  const { rows, loading } = useList("/portal/leases");
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold">Rent & tenants</h1>
      {!loading && !rows.length && <p className="panel p-6 text-sm text-slate-500">No leases yet.</p>}
      {rows.map((l) => (
        <Section key={l.id} title={`${l.property_title} · ${l.code}`} actions={<Badge v={l.status} />}>
          <Facts items={[["Tenant", l.tenant_name], ["Period", `${fmtDate(l.start_date)} – ${fmtDate(l.end_date)}`], ["Rent", `${inr(l.rent)} a month, due on day ${l.due_day}`], ["Yearly increase", `${l.escalation_pct}%`], ["Deposit held for you", inr(l.deposit_held)], ["Overdue", <b className={l.arrears > 0 ? "text-red-700" : ""}>{inr(l.arrears)}</b>]]} />
          <div className="mt-4"><DataTable testid={`owner-payments-${l.code}`} rows={l.payments} columns={[{ key: "period", label: "Month", render: (p) => monthLabel(p.period) }, { key: "date", label: "Received", render: (p) => fmtDate(p.date) }, { key: "method", label: "Method", render: (p) => label(p.method) }, { key: "amount", label: "Amount", render: (p) => inr(p.amount) }, { key: "x", label: "", render: (p) => <button className="btn-line btn-sm" onClick={() => openFile(`/portal/rent-receipts/${p.id}/pdf`, { name: `Rent receipt ${p.receipt_no}` })}>Receipt</button> }]} empty="No rent received yet." /></div>
        </Section>
      ))}
    </div>
  );
}

export function OwnerStatements() {
  const [d, setD] = useState(null);
  const [month, setMonth] = useState("");
  const [s, setS] = useState(null);
  useEffect(() => { api.get("/portal/statements").then((r) => { setD(r.data); const m = r.data.months_with_rent[0]; if (m) setMonth(m); }).catch(() => setD({ settled: [], months_with_rent: [] })); }, []);
  useEffect(() => { if (month) api.get(`/portal/statements/${month}`).then((r) => setS(r.data)).catch(() => setS(null)); }, [month]);
  if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold">Monthly statements</h1>
      {!d.months_with_rent.length ? <p className="panel p-6 text-sm text-slate-500">No rent collected yet, so there are no statements.</p> : <>
        <div className="flex flex-wrap items-end gap-2"><div><label className="lbl" htmlFor="st-month">Month</label><select id="st-month" className="inp" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="owner-statement-month">{d.months_with_rent.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></div><button className="btn-line btn-sm" onClick={() => openFile(`/portal/statements/${month}/pdf`, { name: `Statement ${month}` })} data-testid="owner-statement-pdf">Download PDF</button></div>
        {s && <Section title={monthLabel(month)} testid="owner-statement">
          <DataTable rows={[...s.rents.map((r) => ({ ...r, desc: `Rent ${monthLabel(r.period)} (${r.lease_code})` })), ...(s.expense_items || []).map((e) => ({ desc: e.description, amount: -e.amount }))]} columns={[{ key: "date", label: "Date", render: (r) => fmtDate(r.date) }, { key: "desc", label: "Description" }, { key: "amount", label: "Amount", render: (r) => inr(r.amount) }]} />
          <div className="mt-4 max-w-md space-y-1 text-sm">{[["Rent collected", s.rent_collected], ["Our management fee", -s.management_fee], ["Repairs and maintenance", -s.expenses]].map(([k, v]) => <p key={k} className="flex justify-between"><span className="text-slate-600">{k}</span><span className="tabular">{inr(v)}</span></p>)}<p className="flex justify-between border-t border-slate-900 pt-1 font-semibold"><span>Payable to you</span><span className="tabular" data-testid="owner-statement-net">{inr(s.net_payable)}</span></p></div>
          <p className="mt-3 text-sm">{s.settled ? <>Settled · <Badge v={s.settled.payout_status} />{s.settled.payout_reference && <span className="ml-2 text-xs text-slate-500">bank ref {s.settled.payout_reference}</span>}</> : <span className="text-slate-500">Not settled yet. We settle each month after rent is collected.</span>}</p>
        </Section>}
      </>}
    </div>
  );
}

export function OwnerRequests() {
  const { rows, reload, loading } = useList("/portal/work-orders");
  const [props, setProps] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => { api.get("/portal/overview").then((r) => setProps(r.data.properties)).catch(() => {}); }, []);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3"><h1 className="font-heading text-2xl font-semibold">Maintenance</h1><button className="btn-dark btn-sm" onClick={() => setOpen(true)} data-testid="owner-new-request">Report an issue</button></div>
      <DataTable testid="owner-requests-table" loading={loading} rows={rows} columns={[{ key: "code", label: "Ref" }, { key: "title", label: "Issue" }, { key: "property_title", label: "Property" }, { key: "priority", label: "Priority", render: (r) => <Badge v={r.priority} /> }, { key: "status", label: "Status", render: (r) => <Badge v={r.status} /> }, { key: "actual_cost", label: "Cost", render: (r) => (r.actual_cost != null ? `${inr(r.actual_cost)}${r.charge_to === "owner" ? " (from your statement)" : ""}` : r.quote_amount != null ? `Quote ${inr(r.quote_amount)}` : "-") }]} empty="No maintenance requests." />
      <FormDialog open={open} onClose={() => setOpen(false)} title="Report an issue" submitLabel="Send to property manager" initial={{ priority: "medium", property_id: props[0]?.id }} fields={[{ name: "property_id", label: "Property", type: "select", required: true, full: true, options: props.map((p) => ({ value: p.id, label: `${p.title} (${p.code})` })) }, { name: "title", label: "What needs fixing?", required: true, full: true }, { name: "priority", label: "How urgent?", type: "select", required: true, options: opts(["low", "medium", "high", "urgent"]) }, { name: "description", label: "Details", type: "textarea", full: true }]} onSubmit={async (v) => { await api.post("/portal/requests", v); reload(); }} />
    </div>
  );
}

export function OwnerStays() {
  const { rows, loading } = useList("/portal/bookings");
  const live = rows.filter((b) => b.status !== "cancelled");
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold">Short stays</h1>
      {live.length > 0 && <div className="grid grid-cols-2 gap-3 md:grid-cols-3"><Kpi title="Nights booked" value={live.reduce((s, b) => s + b.nights, 0)} /><Kpi title="Your payouts" value={inr(live.reduce((s, b) => s + b.owner_payout, 0), true)} /><Kpi title="Settled stays" value={live.filter((b) => b.settled).length} /></div>}
      <DataTable testid="owner-stays-table" loading={loading} rows={rows} columns={[{ key: "property_title", label: "Property" }, { key: "check_in", label: "Dates", render: (b) => `${fmtDate(b.check_in)} – ${fmtDate(b.check_out)}` }, { key: "nights", label: "Nights" }, { key: "platform", label: "Booked via", render: (b) => label(b.platform) }, { key: "gross", label: "Booking value", render: (b) => inr(b.gross) }, { key: "owner_payout", label: "Your payout", render: (b) => inr(b.owner_payout) }, { key: "status", label: "Status", render: (b) => <><Badge v={b.status} />{b.settled && <Badge v={b.payout_status || "settled"} />}</> }]} empty="No short-stay bookings." />
    </div>
  );
}

export function OwnerDocuments() {
  const { rows, loading } = useList("/portal/documents");
  const open = async (d) => { const r = await act(() => api.post(`/portal/documents/${d.id}/link`)); if (r) openFile(r.data.url.replace(/^\/api/, ""), { name: d.original_name }); };
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold">Documents</h1>
      <p className="text-sm text-slate-600">Agreements, inspection reports and other files your property manager has shared with you.</p>
      <DataTable testid="owner-docs-table" loading={loading} rows={rows} columns={[{ key: "original_name", label: "File" }, { key: "doc_type", label: "Type", render: (d) => label(d.doc_type) }, { key: "created_at", label: "Added", render: (d) => fmtDate(d.created_at) }, { key: "expiry_date", label: "Valid until", render: (d) => fmtDate(d.expiry_date) }, { key: "x", label: "", render: (d) => <button className="btn-line btn-sm" onClick={() => open(d)}>Open</button> }]} empty="No documents shared yet." />
    </div>
  );
}
