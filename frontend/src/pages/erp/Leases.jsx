import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, fmtDate, fmtDateTime, inr, label, opts, todayIST, uid, openFile, payMethod, METHOD_OPTS } from "../../lib/api";
import { useDialog } from "../../lib/dialogs";
import { useAuth } from "../../lib/auth";
import { PageHeader, DataTable, Badge, FormDialog, Modal, Facts, Section, useList, act } from "../../components/erp/kit";
import { DocsPanel } from "./Documents";

function LeaseModal({ lease, onClose, reload }) {
  const { can } = useAuth();
  const dialog = useDialog();
  const [d, setD] = useState(null);
  const [dlg, setDlg] = useState(null);
  const load = () => lease && api.get(`/leases/${lease.id}`).then((r) => setD(r.data));
  useEffect(() => { setD(null); load(); }, [lease]); // eslint-disable-line react-hooks/exhaustive-deps
  const w = can("leases", "w") && d?.status === "active";
  const after = () => { load(); reload(); };
  return (
    <Modal open={!!lease} onClose={onClose} title={`Lease ${d?.code || lease?.code || ""}`} wide>
      {d && <div className="space-y-4" data-testid="lease-detail">
        <Facts items={[["Property", d.property_title], ["Tenant", `${d.tenant_name} · ${d.tenant_phone}`], ["Period", `${fmtDate(d.start_date)} – ${fmtDate(d.end_date)}`], ["Rent", `${inr(d.rent)} due day ${d.due_day}`], ["Escalation", `${d.escalation_pct}% every ${d.escalation_every_months} months`], ["Management fee", `${d.mgmt_fee_pct}%`], ["Deposit agreed", inr(d.deposit)], ["Deposit held (liability)", <span data-testid="deposit-held">{inr(d.deposit_held)}</span>], ["Arrears", <b className={d.arrears > 0 ? "text-red-700" : ""} data-testid="lease-arrears">{inr(d.arrears)}</b>], ["Status", <Badge v={d.status} />]]} />
        {w && <div className="flex flex-wrap gap-2"><button className="btn-line btn-sm" onClick={() => setDlg({ kind: "deposit", direction: "in", key: uid() })} data-testid="deposit-in-btn">Record deposit received</button><button className="btn-line btn-sm" onClick={() => setDlg({ kind: "deposit", direction: "out", key: uid() })}>Refund deposit</button><button className="btn-line btn-sm" onClick={() => setDlg({ kind: "handover" })} data-testid="handover-btn">Move-in / out checklist</button><button className="btn-line btn-sm" onClick={async () => { const reason = await dialog.ask({ title: "End this lease?", body: "The property is marked vacant. Record the move-out handover and refund the deposit separately.", label: "Reason", initial: "Lease term completed", okLabel: "End lease", tone: "danger" }); if (reason) { await act(() => api.post(`/leases/${d.id}/terminate`, { reason }), "Lease ended"); after(); } }} data-testid="end-lease-btn">End lease</button></div>}
        <Section title="Rent schedule (collected on behalf of owner)">
          <DataTable testid="rent-schedule-table" rows={d.schedule} columns={[{ key: "period", label: "Period" }, { key: "due_date", label: "Due", render: (s) => fmtDate(s.due_date) }, { key: "amount", label: "Rent", render: (s) => inr(s.amount) }, { key: "paid", label: "Received", render: (s) => inr(s.paid) }, { key: "st", label: "", render: (s) => s.paid >= s.amount ? <Badge v="paid" /> : s.due_date < todayIST() ? <Badge v="overdue" /> : <Badge v="upcoming" /> }, { key: "x", label: "", render: (s) => s.paid < s.amount && w ? <button className="btn-line btn-sm" onClick={() => setDlg({ kind: "rent", period: s.period, amount: s.amount - s.paid, key: uid() })} data-testid={`record-rent-${s.period}`}>Record rent</button> : null }]} />
        </Section>
        {d.payments?.length > 0 && <Section title="Rent received">
          <DataTable testid="rent-payments-table" rows={d.payments} columns={[{ key: "receipt_no", label: "Receipt" }, { key: "period", label: "Period" }, { key: "date", label: "Received", render: (p) => fmtDate(p.date) }, { key: "method", label: "Method", render: (p) => label(p.method) }, { key: "amount", label: "Amount", render: (p) => inr(p.amount) }, { key: "x", label: "", render: (p) => <button className="btn-line btn-sm" onClick={() => openFile(`/rent-payments/${p.id}/receipt.pdf`, { name: `Rent receipt ${p.receipt_no}` })} data-testid={`rent-receipt-${p.receipt_no}`}>Receipt PDF</button> }]} />
        </Section>}
        <LeaseBills d={d} w={can("leases", "w")} after={after} />
        {d.payment_notices?.length > 0 && <Section title="Payments the tenant told us about" testid="lease-notices">
          <DataTable testid="notices-table" rows={d.payment_notices} columns={[{ key: "label", label: "For" }, { key: "amount", label: "Amount", render: (n) => inr(n.amount) }, { key: "date", label: "Paid on", render: (n) => fmtDate(n.date) }, { key: "method", label: "How", render: (n) => `${payMethod(n.method)}${n.reference ? ` · ${n.reference}` : ""}` }, { key: "status", label: "Status", render: (n) => <><Badge v={n.status === "confirmed" ? "paid" : n.status} text={label(n.status)} />{n.receipt_no && <span className="block text-xs text-slate-500">{n.receipt_no}</span>}{n.reason && <span className="block text-xs text-slate-500">{n.reason}</span>}</> },
            { key: "x", label: "", render: (n) => n.status === "pending" && can("leases", "w") && <span className="flex flex-wrap gap-1"><button className="btn-dark btn-sm" onClick={async () => { if (await dialog.confirm({ title: `Confirm ${inr(n.amount)}?`, body: "Check that the money is in the bank account first. This records the payment and issues the receipt.", okLabel: "Confirm & record" })) { await act(() => api.post(`/payment-notices/${n.id}/confirm`, {}), "Payment recorded"); after(); } }} data-testid={`confirm-notice-${n.reference || n.id}`}>Confirm</button><button className="btn-line btn-sm" onClick={async () => { const reason = await dialog.ask({ title: "Not matched", label: "Tell the tenant why", initial: "We could not find this payment in our account. Please check the reference." }); if (reason) { await act(() => api.post(`/payment-notices/${n.id}/reject`, { reason }), "Tenant told"); after(); } }}>Reject</button></span> }]} />
        </Section>}
        <Section title="Tenant portal" testid="lease-portal" actions={can("users", "w") && !d.tenant_logins?.length && <button className="btn-line btn-sm" onClick={async () => { const email = await dialog.ask({ title: `Tenant login for ${d.tenant_name}`, body: "They see their rent, receipts, bills, deposit and documents, and can raise requests. We send a link to set a password.", label: "Tenant's email", initial: d.tenant_email || "" }); if (email) { const r = await act(() => api.post(`/leases/${d.id}/tenant-login`, { email })); if (r) { dialog.notice({ title: "Login created", body: r.data.email_status === "sent" ? "We emailed the link. You can also share it yourself:" : "Email is not set up, so share this one-time link with the tenant (for example on WhatsApp):", copy: r.data.activation_link }); after(); } } }} data-testid="tenant-login-btn">Give the tenant a login</button>}>
          {d.tenant_logins?.length ? <ul className="text-sm">{d.tenant_logins.map((u) => <li key={u.id} className="flex flex-wrap items-center gap-2">{u.email} <Badge v={u.active ? "active" : "invited"} />{u.last_login && <span className="text-xs text-slate-500">last signed in {fmtDateTime(u.last_login)}</span>}</li>)}</ul> : <p className="text-sm text-slate-500">No tenant login yet.</p>}
          {d.tickets?.length > 0 && <div className="mt-4"><p className="lbl">Requests from this lease</p><ul className="space-y-1 text-sm">{d.tickets.map((t) => <li key={t.id}><Link className="underline" to={`/erp/tickets/${t.id}`}>{t.code}</Link> {t.title} <Badge v={t.status} /></li>)}</ul></div>}
        </Section>
        <DocsPanel entityType="lease" entityId={d.id} title="Lease documents (tick “Tenant can see” to show one in the tenant's portal)" defaultType="lease_agreement" />
        {d.handovers?.length > 0 && <Section title="Handover records">{d.handovers.map((h) => <p key={h.id} className="border-b border-slate-100 py-1 text-sm">{label(h.kind)} · {fmtDate(h.date)} · meters: {h.meter_readings || "-"} · {h.notes}</p>)}</Section>}
      </div>}
      <FormDialog open={dlg?.kind === "rent"} onClose={() => setDlg(null)} title={`Record rent ${dlg?.period || ""}`} initial={{ amount: dlg?.amount, method: "upi", date: todayIST(), idempotency_key: dlg?.key }} fields={[{ name: "amount", label: "Amount (₹)", type: "number", required: true }, { name: "method", label: "Method", type: "select", required: true, options: opts(["upi", "bank_transfer", "cheque", "cash"]) }, { name: "date", label: "Received on", type: "date", required: true }, { name: "reference", label: "Reference" }]} onSubmit={async (v) => { await api.post(`/leases/${d.id}/rent`, { ...v, period: dlg.period }); after(); }} />
      <FormDialog open={dlg?.kind === "deposit"} onClose={() => setDlg(null)} title={dlg?.direction === "in" ? "Deposit received" : "Deposit refund"} initial={{ amount: dlg?.direction === "in" ? d?.deposit : d?.deposit_held, reason: dlg?.direction === "in" ? "Security deposit" : "Move-out refund", idempotency_key: dlg?.key }} fields={[{ name: "amount", label: "Amount (₹)", type: "number", required: true }, { name: "reason", label: "Reason", required: true }]} onSubmit={async (v) => { await api.post(`/leases/${d.id}/deposit`, { ...v, direction: dlg.direction }); after(); }} />
      <FormDialog open={dlg?.kind === "handover"} onClose={() => setDlg(null)} title="Handover / inspection record" initial={{ kind: "move_in", date: todayIST() }} fields={[{ name: "kind", label: "Type", type: "select", required: true, options: opts(["move_in", "move_out", "inspection"]) }, { name: "date", label: "Date", type: "date", required: true }, { name: "meter_readings", label: "Meter readings (EB / water)" }, { name: "notes", label: "Condition notes / checklist", type: "textarea", full: true }]} onSubmit={async (v) => { await api.post(`/leases/${d.id}/handover`, v); after(); }} />
    </Modal>
  );
}

const KINDS = [["electricity", "Electricity (EB)"], ["water", "Water"], ["maintenance", "Maintenance / association"], ["gas", "Gas"], ["internet", "Internet / DTH"], ["parking", "Parking"], ["cleaning", "Cleaning service"], ["property_tax", "Property tax share"], ["repair", "Repair recovery"], ["other", "Other"]];
const month = (n = 0) => { const d = new Date(Date.now() + 5.5 * 3600e3); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };

// Bills on a lease: EB by meter reading or a fixed amount, collected by us (receipted, passed to the owner) or paid by the
// tenant straight to the provider (tracked only).
function LeaseBills({ d, w, after }) {
  const dialog = useDialog();
  const [add, setAdd] = useState(null);
  const [pay, setPay] = useState(null);
  const charges = d.charges || [];
  const lastReading = (kind) => charges.find((c) => c.kind === kind && c.reading_curr != null)?.reading_curr;
  return (
    <Section title={`Bills (EB, water…)${d.bills_due ? ` · ${inr(d.bills_due)} due` : ""}`} testid="lease-bills" actions={w && d.status === "active" && <button className="btn-line btn-sm" onClick={() => setAdd({ kind: "electricity", period: month(-1), period_to: month(0), due_date: todayIST(), mode: "collect", payee: "owner", reading_prev: lastReading("electricity") })} data-testid="add-bill-btn">Add bill</button>}>
      <DataTable testid="bills-table" rows={charges} empty="No bills yet. Add EB, water or maintenance bills so the tenant sees them in their portal." columns={[
        { key: "label", label: "Bill", render: (c) => <>{c.label}<span className="block text-xs text-slate-500">{c.code}{c.units != null ? ` · ${c.reading_prev}→${c.reading_curr} = ${c.units} units × ₹${c.rate}${c.fixed ? ` + ₹${c.fixed}` : ""}` : ""}{c.consumer_no ? ` · SC ${c.consumer_no}` : ""}</span></> },
        { key: "amount", label: "Amount", render: (c) => inr(c.amount) }, { key: "due_date", label: "Due", render: (c) => fmtDate(c.due_date) },
        { key: "mode", label: "Paid to", render: (c) => (c.mode === "collect" ? (c.payee === "owner" ? "Us → owner" : "Us") : "Provider") },
        { key: "status", label: "Status", render: (c) => <><Badge v={c.overdue ? "overdue" : c.status} />{c.paid > 0 && c.status !== "paid" && <span className="block text-xs text-slate-500">paid {inr(c.paid)}</span>}</> },
        { key: "x", label: "", render: (c) => <span className="flex flex-wrap gap-1">
          {w && ["due", "partly_paid"].includes(c.status) && <button className="btn-line btn-sm" onClick={() => setPay({ c, key: uid() })} data-testid={`pay-${c.code}`}>{c.mode === "collect" ? "Record payment" : "Mark paid"}</button>}
          {(c.payments || []).filter((p) => p.receipt_no).map((p) => <button key={p.id} className="btn-line btn-sm" onClick={() => openFile(`/charge-payments/${p.id}/receipt.pdf`, { name: `Receipt ${p.receipt_no}` })}>{p.receipt_no}</button>)}
          {w && c.status === "due" && !c.paid && <button className="btn-line btn-sm" onClick={async () => { const reason = await dialog.ask({ title: `Waive ${c.label}?`, label: "Reason" }); if (reason) { await act(() => api.post(`/charges/${c.id}/waive`, { reason }), "Waived"); after(); } }}>Waive</button>}
        </span> }]} />
      <FormDialog open={!!add} onClose={() => setAdd(null)} title="Add a bill" wide initial={add || {}} fields={[
        { name: "kind", label: "Type", type: "select", required: true, options: KINDS.map(([value, l]) => ({ value, label: l })) }, { name: "label", label: "Name on the bill (optional)", hint: "e.g. EB Sep–Oct 2026; filled in for you if blank" },
        { name: "period", label: "From month", type: "month", required: true }, { name: "period_to", label: "To month (bi-monthly EB)", type: "month" },
        { name: "reading_prev", label: "Previous reading", type: "number" }, { name: "reading_curr", label: "Current reading", type: "number" }, { name: "rate", label: "Rate per unit (₹)", type: "number" }, { name: "fixed", label: "Fixed charges (₹)", type: "number" },
        { name: "amount", label: "Or the bill amount (₹)", type: "number", hint: "Leave blank when you enter readings" }, { name: "due_date", label: "Tenant pays by", type: "date", required: true },
        { name: "mode", label: "Who collects", type: "select", required: true, options: [{ value: "collect", label: "We collect from the tenant" }, { value: "direct", label: "Tenant pays the provider directly" }] },
        { name: "payee", label: "Money belongs to", type: "select", required: true, options: [{ value: "owner", label: "The owner (passed on in their statement)" }, { value: "company", label: "Us (our service, e.g. cleaning)" }] },
        { name: "consumer_no", label: "EB service / consumer no." }, { name: "notes", label: "Note for the tenant", full: true }]}
        onSubmit={async (v) => { await api.post(`/leases/${d.id}/charges`, { ...v, fixed: v.fixed || 0 }); after(); }}>
        {(v) => { const u = v.reading_curr != null && v.reading_curr !== "" && v.reading_prev != null && v.reading_prev !== "" ? Number(v.reading_curr) - Number(v.reading_prev) : null; return u != null && v.rate ? <p className="text-sm text-slate-600" data-testid="bill-preview">{u} units × ₹{v.rate}{v.fixed ? ` + ₹${v.fixed}` : ""} = <b>{inr(u * Number(v.rate) + Number(v.fixed || 0))}</b></p> : null; }}
      </FormDialog>
      <FormDialog open={!!pay} onClose={() => setPay(null)} title={pay?.c.mode === "collect" ? `Payment for ${pay?.c.label}` : `Tenant paid the provider · ${pay?.c.label}`} initial={{ amount: pay?.c.balance, method: "upi", date: todayIST(), idempotency_key: pay?.key }}
        fields={[{ name: "amount", label: "Amount (₹)", type: "number", required: true }, { name: "method", label: "Method", type: "select", required: true, options: METHOD_OPTS }, { name: "date", label: "Paid on", type: "date", required: true }, { name: "reference", label: "Reference" }]}
        onSubmit={async (v) => { await api.post(`/charges/${pay.c.id}/pay`, v); after(); }} />
    </Section>
  );
}

export default function Leases() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(null);
  useEffect(() => { const id = params.get("open"); if (id) { setSel({ id, code: "" }); setParams({}, { replace: true }); } }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const { rows, reload } = useList("/leases");
  const { rows: props } = useList(can("properties") ? "/properties" : "/branches");
  const { rows: users } = useList("/users/lite");
  return (
    <div>
      <PageHeader title="Leases & rent" sub="Rent received is owner money, held in the owner-funds ledger.">{can("leases", "w") && <button className="btn-dark btn-sm" onClick={() => setOpen(true)} data-testid="new-lease-btn">New lease</button>}</PageHeader>
      <DataTable testid="leases-table" rows={rows} onRow={setSel} columns={[{ key: "code", label: "Code" }, { key: "property_title", label: "Property" }, { key: "tenant_name", label: "Tenant" }, { key: "rent", label: "Rent", render: (r) => inr(r.rent) }, { key: "end_date", label: "Ends", render: (r) => fmtDate(r.end_date) }, { key: "arrears", label: "Arrears", render: (r) => <span className={r.arrears > 0 ? "font-semibold text-red-700" : ""}>{inr(r.arrears)}</span> }, { key: "status", label: "Status", render: (r) => <Badge v={r.status} /> }]} />
      <LeaseModal lease={sel} onClose={() => setSel(null)} reload={reload} />
      <FormDialog open={open} onClose={() => setOpen(false)} title="New lease" initial={{ lease_type: "residential", tenant_kind: "individual", due_day: 5, escalation_pct: 5, escalation_every_months: 12, mgmt_fee_pct: 8, deposit: 0 }} fields={[{ name: "property_id", label: "Property", type: "select", required: true, full: true, options: props.filter((p) => p.code && ["rent", "lease"].includes(p.transaction)).map((p) => ({ value: p.id, label: `${p.code} · ${p.title}` })) }, { name: "tenant_name", label: "Tenant name", required: true }, { name: "tenant_phone", label: "Tenant mobile", required: true }, { name: "tenant_email", label: "Tenant email" }, { name: "tenant_kind", label: "Tenant type", type: "select", required: true, options: opts(["individual", "business"]) }, { name: "lease_type", label: "Lease type", type: "select", required: true, options: opts(["residential", "commercial", "industrial"]) }, { name: "start_date", label: "Start", type: "date", required: true }, { name: "end_date", label: "End", type: "date", required: true }, { name: "rent", label: "Monthly rent (₹)", type: "number", required: true }, { name: "due_day", label: "Due day", type: "number", required: true }, { name: "deposit", label: "Deposit (₹)", type: "number" }, { name: "escalation_pct", label: "Escalation %", type: "number" }, { name: "escalation_every_months", label: "Escalate every (months)", type: "number" }, { name: "mgmt_fee_pct", label: "Management fee %", type: "number", required: true }, { name: "manager_id", label: "Property manager", type: "select", options: users.filter((u) => ["property_manager", "branch_manager"].includes(u.role)).map((u) => ({ value: u.id, label: u.name })) }]} onSubmit={async (v) => { await api.post("/leases", v); reload(); }} />
    </div>
  );
}
