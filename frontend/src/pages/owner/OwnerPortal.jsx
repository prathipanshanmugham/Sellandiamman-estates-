import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDate, inr, label, openFile, priceLabel, imgSrc } from "../../lib/api";
import { Badge, DataTable, Kpi, Section, useList, act, Facts } from "../../components/erp/kit";
import { PortalShell } from "../../components/portal/PortalShell";
import { RequestsList, RequestDetail } from "../../components/portal/Requests";

const TABS = [["/owner", "Overview"], ["/owner/rent", "Rent & tenants"], ["/owner/bills", "Bills"], ["/owner/statements", "Statements"], ["/owner/requests", "Requests & repairs"], ["/owner/stays", "Short stays"], ["/owner/documents", "Documents"]];
const monthLabel = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

export function OwnerLayout() {
  return <PortalShell kind="owner" home="/owner" title="Owner portal" tabs={TABS}
    footer={<>Rent and deposits are held for you in a separate owner-funds account and are never counted as our income. Questions? <Link to="/owner/requests" className="underline">Raise a request</Link> or call your property manager.</>} />;
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
        <Kpi title="Open requests" value={d.open_tickets ?? d.open_requests} hint={`${d.bills_open || 0} tenant bills open · ${d.upcoming_stays} upcoming stays`} testid="owner-kpi-requests" />
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
          <DataTable rows={[...s.rents.map((r) => ({ ...r, desc: `Rent ${monthLabel(r.period)} (${r.lease_code})` })), ...(s.charge_items || []).map((c) => ({ date: c.date, desc: `Collected for you: ${c.description}`, amount: c.amount })), ...(s.expense_items || []).map((e) => ({ desc: e.description, amount: -e.amount }))]} columns={[{ key: "date", label: "Date", render: (r) => fmtDate(r.date) }, { key: "desc", label: "Description" }, { key: "amount", label: "Amount", render: (r) => inr(r.amount) }]} />
          <div className="mt-4 max-w-md space-y-1 text-sm">{[["Rent collected", s.rent_collected], ["Our management fee", -s.management_fee], ["Repairs and maintenance", -s.expenses], ...(s.charges_collected ? [["Bills collected for you (EB, water…)", s.charges_collected]] : [])].map(([k, v]) => <p key={k} className="flex justify-between"><span className="text-slate-600">{k}</span><span className="tabular">{inr(v)}</span></p>)}<p className="flex justify-between border-t border-slate-900 pt-1 font-semibold"><span>Payable to you</span><span className="tabular" data-testid="owner-statement-net">{inr(s.net_payable)}</span></p></div>
          <p className="mt-3 text-sm">{s.settled ? <>Settled · <Badge v={s.settled.payout_status} />{s.settled.payout_reference && <span className="ml-2 text-xs text-slate-500">bank ref {s.settled.payout_reference}</span>}</> : <span className="text-slate-500">Not settled yet. We settle each month after rent is collected.</span>}</p>
        </Section>}
      </>}
    </div>
  );
}

// Requests (tickets) the owner raised, repairs their tenants reported, and the work orders with their cost.
export function OwnerRequests() {
  const { rows, loading } = useList("/portal/work-orders");
  return <RequestsList base="/owner/requests" intro="Ask us for anything about your property: repairs, a tenant search, a rent revision, EB or tax name transfers, documents. Repairs your tenants report show here too."
    extra={<Section title="Repair work and costs" testid="owner-work-orders"><DataTable testid="owner-requests-table" loading={loading} rows={rows} columns={[{ key: "code", label: "Ref" }, { key: "title", label: "Work" }, { key: "property_title", label: "Property" }, { key: "status", label: "Status", render: (r) => <Badge v={r.status} /> }, { key: "actual_cost", label: "Cost", render: (r) => (r.actual_cost != null ? `${inr(r.actual_cost)}${r.charge_to === "owner" ? " (from your statement)" : ""}` : r.quote_amount != null ? `Quote ${inr(r.quote_amount)}` : "-") }]} empty="No repair work yet." /></Section>} />;
}

export const OwnerRequest = () => <RequestDetail base="/owner/requests" />;

const BILL_STATUS = { due: "Due", partly_paid: "Part paid", paid: "Paid", waived: "Waived" };

export function OwnerBills() {
  const { rows, loading } = useList("/portal/bills");
  const open = rows.filter((b) => ["due", "partly_paid"].includes(b.status));
  return (
    <div className="space-y-6">
      <div><h1 className="font-heading text-2xl font-semibold">Tenant bills</h1><p className="mt-1 max-w-2xl text-sm text-slate-600">Electricity (EB), water, maintenance and other bills on your properties. Bills we collect are paid to you in full with your monthly statement; bills the tenant pays directly to the provider are listed so you can see they are paid.</p></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3"><Kpi title="Open bills" value={open.length} hint={inr(open.reduce((s, b) => s + b.balance, 0), true)} testid="owner-bills-open" /><Kpi title="Overdue" value={open.filter((b) => b.overdue).length} /></div>
      <DataTable testid="owner-bills-table" loading={loading} rows={rows} empty="No bills yet." columns={[{ key: "label", label: "Bill", render: (b) => <>{b.label}<span className="block text-xs text-slate-500">{b.code}{b.units != null ? ` · ${b.units} units` : ""}</span></> }, { key: "property_title", label: "Property", render: (b) => <>{b.property_title}<span className="block text-xs text-slate-500">{b.tenant_name}</span></> }, { key: "amount", label: "Amount", render: (b) => inr(b.amount) }, { key: "due_date", label: "Due", render: (b) => fmtDate(b.due_date) }, { key: "mode", label: "Paid to", render: (b) => (b.mode === "collect" ? (b.payee === "owner" ? "Us, passed to you" : "Us (our service)") : "Provider directly") }, { key: "status", label: "Status", render: (b) => <Badge v={b.overdue ? "overdue" : b.status} text={b.overdue ? "Overdue" : BILL_STATUS[b.status]} /> }]} />
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
