import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Phone, MessageCircle, Copy, Zap, Droplet, Receipt, FileText, Wrench } from "lucide-react";
import { api, fmtDate, inr, label, openFile, imgSrc, todayIST, telLink, waLink, uid, copyText, METHOD_OPTS, payMethod } from "../../lib/api";
import { Badge, DataTable, Kpi, Section, Facts, FormDialog, Modal, act } from "../../components/erp/kit";
import { PortalShell, Loading } from "../../components/portal/PortalShell";
import { RequestsList, RequestDetail } from "../../components/portal/Requests";

const monthLabel = (m) => (m ? new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }) : "-");
const TABS = [["/tenant", "Overview"], ["/tenant/rent", "Rent"], ["/tenant/bills", "Bills"], ["/tenant/requests", "Requests"], ["/tenant/documents", "Documents"]];
const KIND_ICON = { electricity: Zap, water: Droplet };
const BILL_STATUS = { due: "Due", partly_paid: "Part paid", paid: "Paid", waived: "Waived" };

export function TenantLayout() {
  return <PortalShell kind="tenant" home="/tenant" title="Tenant portal" tabs={TABS}
    footer={<>Rent and bills are collected on behalf of your property owner and receipted by Sellandiamman Estates. Something not right? <Link to="/tenant/requests" className="underline">Raise a request</Link> or call your property manager.</>} />;
}

function useOverview() {
  const [d, setD] = useState(null);
  const load = () => api.get("/tenant/overview").then((r) => setD(r.data)).catch(() => setD(false));
  useEffect(() => { load(); }, []);
  return [d, load];
}

// How to pay: amount, the collection account, and a UPI link / QR with the amount filled in.
export function PayDialog({ target, onClose, onPaid }) {
  const [p, setP] = useState(null);
  useEffect(() => {
    if (!target) return;
    setP(null);
    api.get("/tenant/pay", { params: { lease_id: target.lease_id, kind: target.kind, period: target.period, charge_id: target.charge_id } }).then((r) => setP(r.data)).catch(() => setP(false));
  }, [target]);
  const row = (k, v) => v && <p className="flex items-center justify-between gap-2 border-b border-slate-100 py-1.5 text-sm"><span className="text-slate-500">{k}</span><span className="flex items-center gap-1 font-medium">{v}<button type="button" className="p-1 text-slate-400 hover:text-slate-900" onClick={async () => { if (await copyText(v)) toast.success("Copied"); }} aria-label={`Copy ${k}`}><Copy size={13} /></button></span></p>;
  return (
    <Modal open={!!target} onClose={onClose} title="Pay">
      {!p ? <Loading d={p} what="the payment details" /> : <div className="space-y-4" data-testid="pay-dialog">
        <div><p className="text-sm text-slate-500">{p.label}</p><p className="font-heading text-3xl font-semibold" data-testid="pay-amount">{inr(p.amount)}</p></div>
        {p.direct ? <p className="bg-amber-50 p-3 text-sm text-amber-900">{p.message}{p.consumer_no ? ` Service / consumer no. ${p.consumer_no}.` : ""}</p> : <>
          {p.upi_uri && <div className="flex flex-col items-center gap-3 border border-slate-200 p-4 sm:flex-row sm:items-start">
            <div className="h-40 w-40 shrink-0 bg-white [&>svg]:h-full [&>svg]:w-full" aria-label="UPI QR code" dangerouslySetInnerHTML={{ __html: p.qr_svg }} />
            <div className="space-y-2 text-sm"><p>Scan with any UPI app (GPay, PhonePe, Paytm, BHIM), or on this phone:</p><a className="btn-dark btn-sm" href={p.upi_uri} data-testid="upi-link">Open UPI app</a><p className="text-xs text-slate-500">The amount and a note with your lease code are filled in for you.</p></div>
          </div>}
          {(p.pay_to?.account_no || p.pay_to?.upi_id) && <div>{row("UPI ID", p.pay_to.upi_id)}{row("Account name", p.pay_to.account_name)}{row("Bank", p.pay_to.bank_name)}{row("Account no.", p.pay_to.account_no)}{row("IFSC", p.pay_to.ifsc)}</div>}
          {!p.pay_to?.account_no && !p.pay_to?.upi_id && <p className="text-sm text-slate-600">Pay at your branch office or ask your property manager for the account details.</p>}
          {p.pay_to?.note && <p className="text-xs text-slate-500">{p.pay_to.note}</p>}
        </>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4"><button className="btn-line" onClick={onClose}>Close</button><button className="btn-dark" onClick={() => { onClose(); onPaid({ ...target, amount: p.amount }); }} data-testid="pay-done">I have paid, tell them</button></div>
      </div>}
    </Modal>
  );
}

// "I have paid": the tenant sends the UPI / bank reference; staff check it and record the payment.
export function NoticeDialog({ target, onClose, onDone, leases, bills }) {
  const lease = leases?.find((l) => l.id === target?.lease_id);
  const open = (bills || []).filter((b) => b.lease_id === target?.lease_id && ["due", "partly_paid"].includes(b.status));
  const months = (lease?.schedule || []).filter((s) => s.paid < s.amount);
  return (
    <FormDialog open={!!target} onClose={onClose} title="Tell us about a payment" submitLabel="Send"
      initial={{ period: target?.period || months[0]?.period, charge_id: target?.charge_id || open[0]?.id, amount: target?.amount, date: todayIST(), method: "upi" }}
      fields={[target?.kind === "charge" ? { name: "charge_id", label: "Bill", type: "select", required: true, options: open.map((b) => ({ value: b.id, label: `${b.label} · ${inr(b.balance)}` })) }
          : { name: "period", label: "Month", type: "select", required: true, options: (months.length ? months : lease?.schedule || []).map((s) => ({ value: s.period, label: `${monthLabel(s.period)} · ${inr(s.amount - s.paid)}` })) },
        { name: "amount", label: "Amount paid (₹)", type: "number", required: true }, { name: "date", label: "Paid on", type: "date", required: true },
        { name: "method", label: "How", type: "select", required: true, options: METHOD_OPTS },
        { name: "reference", label: "UPI / bank reference (UTR)", hint: "Helps us find it quickly" }, { name: "note", label: "Note", full: true }]}
      onSubmit={async (v) => { const kind = target.kind === "charge" ? "charge" : "rent"; await api.post(`/tenant/leases/${target.lease_id}/payment-notices`, { ...v, kind, period: kind === "rent" ? v.period : null, charge_id: kind === "charge" ? v.charge_id : null, idempotency_key: uid() }); onDone?.(); }}>
      {() => <p className="text-xs text-slate-500">We match it with our bank account, usually within a working day, and the receipt appears here.</p>}
    </FormDialog>
  );
}

function Manager({ m }) {
  if (!m) return null;
  const wa = waLink(m.whatsapp || m.phone, "Hello, this is about my rented home.");
  return <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-slate-600">Your property manager: <b>{m.name}</b></span>{m.phone && <a className="btn-line btn-sm" href={telLink(m.phone)}><Phone size={13} />Call</a>}{wa && <a className="btn-line btn-sm" href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle size={13} />WhatsApp</a>}</div>;
}

export function TenantOverview() {
  const [d, load] = useOverview();
  const [pay, setPay] = useState(null);
  const [notice, setNotice] = useState(null);
  const [full, setFull] = useState([]);
  useEffect(() => { if (d?.leases?.length) Promise.all(d.leases.map((l) => api.get(`/tenant/leases/${l.id}`).then((r) => r.data))).then(setFull).catch(() => {}); }, [d]);
  if (!d) return <Loading d={d} />;
  return (
    <div className="space-y-6">
      <div><p className="eyebrow">Tenant {d.customer.code}</p><h1 className="mt-1 font-heading text-2xl font-semibold" data-testid="tenant-hello">Hello, {d.customer.name}</h1></div>
      {!d.leases.length && <p className="panel p-6 text-sm text-slate-500">We have no lease in your name yet. If you have just moved in, your property manager will add it shortly.</p>}
      {d.leases.map((l) => {
        const ending = l.status === "active" && l.end_date <= new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
        return (
          <section key={l.id} className="panel overflow-hidden" data-testid={`tenant-lease-${l.code}`}>
            <div className="grid md:grid-cols-[260px_1fr]">
              <img src={imgSrc(l.property?.images?.[0])} alt="" className="h-40 w-full object-cover md:h-full" />
              <div className="space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-heading text-lg font-semibold">{l.property_title}</p><p className="text-xs text-slate-500">{l.property?.locality}, {l.property?.city} · lease {l.code}</p></div><Badge v={l.status} /></div>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Kpi title="Next rent" value={l.next_due ? inr(l.next_due.balance, true) : "All paid"} hint={l.next_due ? `${monthLabel(l.next_due.period)} · due ${fmtDate(l.next_due.due_date)}` : undefined} testid="tenant-kpi-next" />
                  <Kpi title="Overdue" value={inr(l.arrears, true)} hint={l.arrears > 0 ? "Please pay soon" : "Nothing overdue"} testid="tenant-kpi-arrears" />
                  <Kpi title="Deposit held" value={inr(l.deposit_held, true)} hint="Refunded at move-out" />
                  <Kpi title="Rent" value={inr(l.rent, true)} hint={`Due on day ${l.due_day} each month`} />
                </div>
                {l.status === "active" && <div className="flex flex-wrap gap-2">{l.next_due && <button className="btn-dark btn-sm" onClick={() => setPay({ lease_id: l.id, kind: "rent", period: l.next_due.period })} data-testid="pay-rent-btn">Pay rent</button>}<button className="btn-line btn-sm" onClick={() => setNotice({ lease_id: l.id, kind: "rent", period: l.next_due?.period })} data-testid="paid-btn">I have paid</button><Link className="btn-line btn-sm" to="/tenant/requests"><Wrench size={13} />Raise a request</Link></div>}
                {ending && <p className="bg-amber-50 p-3 text-sm text-amber-900" data-testid="lease-ending">Your lease ends on {fmtDate(l.end_date)}. Want to stay on? <Link to="/tenant/requests" className="underline">Raise a renewal request</Link>, or a move-out notice if you are leaving.</p>}
                <Manager m={l.manager} />
              </div>
            </div>
          </section>
        );
      })}
      <div className="grid gap-3 sm:grid-cols-2">
        <Kpi title="Bills due" value={inr(d.bills_total, true)} hint={`${d.bills_due.length} bill${d.bills_due.length === 1 ? "" : "s"} (EB, water…)`} testid="tenant-kpi-bills" />
        <Kpi title="Open requests" value={d.open_requests} hint={d.pending_notices ? `${d.pending_notices} payment${d.pending_notices > 1 ? "s" : ""} waiting for our check` : "Repairs, cleaning, documents"} testid="tenant-kpi-requests" />
      </div>
      {d.bills_due.length > 0 && <Section title="Bills to pay" actions={<Link to="/tenant/bills" className="text-xs underline">All bills</Link>}>
        <div className="divide-y divide-slate-100" data-testid="tenant-bills-due">{d.bills_due.map((b) => { const I = KIND_ICON[b.kind] || Receipt; return (
          <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex min-w-0 items-start gap-3"><I size={18} className="mt-0.5 shrink-0 text-slate-400" /><div className="min-w-0"><p className="font-medium">{b.label}</p><p className="text-xs text-slate-500">Due {fmtDate(b.due_date)}{b.overdue ? " · overdue" : ""}{b.mode === "direct" ? " · pay the provider directly" : ""}</p></div></div>
            <div className="flex items-center gap-2"><span className="font-semibold tabular">{inr(b.balance)}</span>{b.mode === "collect" ? <button className="btn-dark btn-sm" onClick={() => setPay({ lease_id: b.lease_id, kind: "charge", charge_id: b.id })} data-testid={`pay-bill-${b.code}`}>Pay</button> : <button className="btn-line btn-sm" onClick={() => setNotice({ lease_id: b.lease_id, kind: "charge", charge_id: b.id, amount: b.balance })}>I have paid</button>}</div>
          </div>); })}</div>
      </Section>}
      {d.pay_to?.upi_id && <p className="text-xs text-slate-500">Rent and bills go to {d.pay_to.account_name || "our collection account"} (UPI {d.pay_to.upi_id}). Never pay anyone who calls asking for a different account.</p>}
      <PayDialog target={pay} onClose={() => setPay(null)} onPaid={(x) => setNotice(x)} />
      <NoticeDialog target={notice} onClose={() => setNotice(null)} onDone={() => { toast.success("Sent. We will confirm it soon."); load(); }} leases={full} bills={d.bills_due} />
    </div>
  );
}

export function TenantRent() {
  const [d, load] = useOverview();
  const [leases, setLeases] = useState(null);
  const [pay, setPay] = useState(null);
  const [notice, setNotice] = useState(null);
  const reload = () => { load(); if (d) Promise.all(d.leases.map((l) => api.get(`/tenant/leases/${l.id}`).then((r) => r.data))).then(setLeases); };
  useEffect(() => { if (d) Promise.all(d.leases.map((l) => api.get(`/tenant/leases/${l.id}`).then((r) => r.data))).then(setLeases).catch(() => setLeases(false)); }, [d]);
  if (!d || !leases) return <Loading d={d === false || leases === false ? false : null} />;
  const t = todayIST();
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold">Rent</h1>
      {!leases.length && <p className="panel p-6 text-sm text-slate-500">No lease yet.</p>}
      {leases.map((l) => (
        <div key={l.id} className="space-y-4">
          <Section title={`${l.property_title} · ${l.code}`} actions={<Badge v={l.status} />} testid={`rent-${l.code}`}>
            <Facts items={[["Period", `${fmtDate(l.start_date)} – ${fmtDate(l.end_date)}`], ["Rent", `${inr(l.rent)} a month, due on day ${l.due_day}`], ["Yearly increase", `${l.escalation_pct}% every ${l.escalation_every_months} months`], ["Deposit held", inr(l.deposit_held)], ["Paid so far", inr(l.paid_total)], ["Overdue", <b className={l.arrears > 0 ? "text-red-700" : ""}>{inr(l.arrears)}</b>]]} />
            {l.status === "active" && <div className="mt-4 flex flex-wrap gap-2">{l.next_due && <button className="btn-dark btn-sm" onClick={() => setPay({ lease_id: l.id, kind: "rent", period: l.next_due.period })}>Pay {monthLabel(l.next_due.period)}</button>}<button className="btn-line btn-sm" onClick={() => setNotice({ lease_id: l.id, kind: "rent", period: l.next_due?.period })} data-testid="rent-paid-btn">I have paid</button></div>}
          </Section>
          {l.notices?.length > 0 && <Section title="Payments you told us about"><DataTable testid="tenant-notices" rows={l.notices} columns={[{ key: "label", label: "For" }, { key: "amount", label: "Amount", render: (n) => inr(n.amount) }, { key: "date", label: "Paid on", render: (n) => fmtDate(n.date) }, { key: "reference", label: "Reference" }, { key: "status", label: "Status", render: (n) => <>{<Badge v={n.status === "pending" ? "pending" : n.status === "confirmed" ? "paid" : "rejected"} text={{ pending: "Checking", confirmed: "Confirmed", rejected: "Not matched" }[n.status]} />}{n.reason && <span className="block text-xs text-slate-500">{n.reason}</span>}</> }]} /></Section>}
          <Section title="Month by month">
            <DataTable testid={`tenant-schedule-${l.code}`} rows={l.schedule} columns={[{ key: "period", label: "Month", render: (s) => monthLabel(s.period) }, { key: "due_date", label: "Due", render: (s) => fmtDate(s.due_date) }, { key: "amount", label: "Rent", render: (s) => inr(s.amount) }, { key: "paid", label: "Paid", render: (s) => inr(s.paid) }, { key: "st", label: "", render: (s) => s.paid >= s.amount - 0.001 ? <Badge v="paid" /> : s.due_date < t ? <Badge v="overdue" /> : s.paid > 0 ? <Badge v="partly_paid" /> : <Badge v="upcoming" text="Upcoming" /> }]} />
          </Section>
          <Section title="Receipts">
            <DataTable testid={`tenant-receipts-${l.code}`} rows={l.payments} empty="No rent received yet." columns={[{ key: "receipt_no", label: "Receipt" }, { key: "period", label: "Month", render: (p) => monthLabel(p.period) }, { key: "date", label: "Received", render: (p) => fmtDate(p.date) }, { key: "method", label: "Method", render: (p) => payMethod(p.method) }, { key: "amount", label: "Amount", render: (p) => inr(p.amount) }, { key: "x", label: "", render: (p) => <button className="btn-line btn-sm" onClick={() => openFile(`/tenant/rent-receipts/${p.id}/pdf`, { name: `Rent receipt ${p.receipt_no}` })} data-testid={`tenant-receipt-${p.receipt_no}`}>PDF</button> }]} />
          </Section>
          {(l.deposit_movements?.length > 0 || l.handovers?.length > 0) && <Section title="Deposit and handover">
            {l.deposit_movements.map((m, i) => <p key={i} className="border-b border-slate-100 py-1.5 text-sm">{fmtDate(m.created_at)} · {m.direction === "in" ? "Received" : "Refunded"} {inr(m.amount)} · {m.reason}</p>)}
            {l.handovers.map((h, i) => <p key={`h${i}`} className="border-b border-slate-100 py-1.5 text-sm">{label(h.kind)} · {fmtDate(h.date)}{h.meter_readings ? ` · meters ${h.meter_readings}` : ""}{h.notes ? ` · ${h.notes}` : ""}</p>)}
          </Section>}
        </div>
      ))}
      <PayDialog target={pay} onClose={() => setPay(null)} onPaid={(x) => setNotice(x)} />
      <NoticeDialog target={notice} onClose={() => setNotice(null)} onDone={() => { toast.success("Sent. We will confirm it soon."); reload(); }} leases={leases} bills={d.bills_due} />
    </div>
  );
}

export function TenantBills() {
  const [rows, setRows] = useState(null);
  const [leases, setLeases] = useState([]);
  const [pay, setPay] = useState(null);
  const [notice, setNotice] = useState(null);
  const load = () => api.get("/tenant/bills").then((r) => setRows(r.data)).catch(() => setRows(false));
  useEffect(() => { load(); api.get("/tenant/overview").then((r) => Promise.all(r.data.leases.map((l) => api.get(`/tenant/leases/${l.id}`).then((x) => x.data)))).then(setLeases).catch(() => {}); }, []);
  if (!rows) return <Loading d={rows} what="your bills" />;
  const due = rows.filter((b) => ["due", "partly_paid"].includes(b.status));
  return (
    <div className="space-y-6">
      <div><h1 className="font-heading text-2xl font-semibold">Bills</h1><p className="mt-1 max-w-2xl text-sm text-slate-600">Electricity (EB), water, maintenance and other charges for your home. Bills marked “pay the provider” go straight to the EB office, association or provider; tell us once paid so your record stays complete.</p></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3"><Kpi title="Due now" value={inr(due.reduce((s, b) => s + b.balance, 0), true)} hint={`${due.length} bill${due.length === 1 ? "" : "s"}`} testid="bills-kpi-due" /><Kpi title="Paid this year" value={inr(rows.filter((b) => b.status === "paid" && b.due_date >= `${todayIST().slice(0, 4)}-01-01`).reduce((s, b) => s + b.amount, 0), true)} /></div>
      {!rows.length && <p className="panel p-6 text-sm text-slate-500">No bills yet.</p>}
      <div className="space-y-3" data-testid="tenant-bills">
        {rows.map((b) => { const I = KIND_ICON[b.kind] || Receipt; return (
          <div key={b.id} className="panel p-4" data-testid={`bill-${b.code}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3"><I size={18} className="mt-0.5 shrink-0 text-slate-400" /><div className="min-w-0">
                <p className="font-medium">{b.label}</p>
                <p className="text-xs text-slate-500">{b.code} · {b.property_title} · due {fmtDate(b.due_date)}{b.mode === "direct" ? " · pay the provider directly" : ""}{b.consumer_no ? ` · service no. ${b.consumer_no}` : ""}</p>
                {b.units != null && <p className="mt-1 text-xs text-slate-600" data-testid="bill-meter">Meter {b.reading_prev} → {b.reading_curr} = {b.units} units × ₹{b.rate}{b.fixed ? ` + ₹${b.fixed} fixed` : ""}</p>}
                {b.notes && <p className="mt-1 text-xs text-slate-500">{b.notes}</p>}
              </div></div>
              <div className="text-right"><p className="font-semibold tabular">{inr(b.amount)}</p><Badge v={b.overdue ? "overdue" : b.status} text={b.overdue ? "Overdue" : BILL_STATUS[b.status]} /></div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {["due", "partly_paid"].includes(b.status) && (b.mode === "collect" ? <button className="btn-dark btn-sm" onClick={() => setPay({ lease_id: b.lease_id, kind: "charge", charge_id: b.id })}>Pay {inr(b.balance)}</button> : null)}
              {["due", "partly_paid"].includes(b.status) && <button className="btn-line btn-sm" onClick={() => setNotice({ lease_id: b.lease_id, kind: "charge", charge_id: b.id, amount: b.balance })} data-testid={`bill-paid-${b.code}`}>I have paid</button>}
              {b.payments.filter((p) => p.receipt_no).map((p) => <button key={p.id} className="btn-line btn-sm" onClick={() => openFile(`/tenant/bill-receipts/${p.id}/pdf`, { name: `Receipt ${p.receipt_no}` })}><FileText size={13} />{p.receipt_no}</button>)}
              {b.payments.filter((p) => !p.receipt_no).map((p) => <span key={p.id} className="text-xs text-slate-500">Paid {inr(p.amount)} on {fmtDate(p.date)}{p.reference ? ` (${p.reference})` : ""}</span>)}
            </div>
          </div>); })}
      </div>
      <PayDialog target={pay} onClose={() => setPay(null)} onPaid={(x) => setNotice(x)} />
      <NoticeDialog target={notice} onClose={() => setNotice(null)} onDone={() => { toast.success("Sent. We will confirm it soon."); load(); }} leases={leases} bills={rows} />
    </div>
  );
}

export const TenantRequests = () => <RequestsList base="/tenant/requests" intro="Repairs, cleaning, keys, documents, rent questions, renewal or a move-out notice. Add photos so we can send the right person." />;
export const TenantRequest = () => <RequestDetail base="/tenant/requests" />;

export function TenantDocuments() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get("/tenant/documents").then((r) => setD(r.data)).catch(() => setD(false)); }, []);
  if (!d) return <Loading d={d} what="your documents" />;
  const open = async (doc) => { const r = await act(() => api.post(`/tenant/documents/${doc.id}/link`)); if (r) openFile(r.data.url.replace(/^\/api/, ""), { name: doc.original_name }); };
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold">Documents</h1>
      <DataTable testid="tenant-documents" rows={d.documents} empty="No documents shared with you yet. Your rental agreement appears here once it is signed." columns={[{ key: "original_name", label: "Document" }, { key: "doc_type", label: "Type", render: (x) => label(x.doc_type) }, { key: "created_at", label: "Added", render: (x) => fmtDate(x.created_at) }, { key: "x", label: "", render: (x) => <button className="btn-line btn-sm" onClick={() => open(x)}>Open</button> }]} />
      <p className="text-xs text-slate-500">Need something else, like an address-proof letter or a copy of the agreement? <Link to="/tenant/requests" className="underline">Raise a documents request</Link>.</p>
    </div>
  );
}
