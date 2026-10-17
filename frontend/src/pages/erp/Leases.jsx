import { useEffect, useState } from "react";
import { api, fmtDate, inr, label, opts, todayIST, uid, openFile } from "../../lib/api";
import { useDialog } from "../../lib/dialogs";
import { useAuth } from "../../lib/auth";
import { PageHeader, DataTable, Badge, FormDialog, Modal, Facts, Section, useList, act } from "../../components/erp/kit";

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
    <Modal open={!!lease} onClose={onClose} title={`Lease ${lease?.code || ""}`} wide>
      {d && <div className="space-y-4" data-testid="lease-detail">
        <Facts items={[["Property", d.property_title], ["Tenant", `${d.tenant_name} · ${d.tenant_phone}`], ["Period", `${fmtDate(d.start_date)} – ${fmtDate(d.end_date)}`], ["Rent", `${inr(d.rent)} due day ${d.due_day}`], ["Escalation", `${d.escalation_pct}% every ${d.escalation_every_months} months`], ["Management fee", `${d.mgmt_fee_pct}%`], ["Deposit agreed", inr(d.deposit)], ["Deposit held (liability)", <span data-testid="deposit-held">{inr(d.deposit_held)}</span>], ["Arrears", <b className={d.arrears > 0 ? "text-red-700" : ""} data-testid="lease-arrears">{inr(d.arrears)}</b>], ["Status", <Badge v={d.status} />]]} />
        {w && <div className="flex flex-wrap gap-2"><button className="btn-line btn-sm" onClick={() => setDlg({ kind: "deposit", direction: "in", key: uid() })} data-testid="deposit-in-btn">Record deposit received</button><button className="btn-line btn-sm" onClick={() => setDlg({ kind: "deposit", direction: "out", key: uid() })}>Refund deposit</button><button className="btn-line btn-sm" onClick={() => setDlg({ kind: "handover" })} data-testid="handover-btn">Move-in / out checklist</button><button className="btn-line btn-sm" onClick={async () => { const reason = await dialog.ask({ title: "End this lease?", body: "The property is marked vacant. Record the move-out handover and refund the deposit separately.", label: "Reason", initial: "Lease term completed", okLabel: "End lease", tone: "danger" }); if (reason) { await act(() => api.post(`/leases/${d.id}/terminate`, { reason }), "Lease ended"); after(); } }} data-testid="end-lease-btn">End lease</button></div>}
        <Section title="Rent schedule (collected on behalf of owner)">
          <DataTable testid="rent-schedule-table" rows={d.schedule} columns={[{ key: "period", label: "Period" }, { key: "due_date", label: "Due", render: (s) => fmtDate(s.due_date) }, { key: "amount", label: "Rent", render: (s) => inr(s.amount) }, { key: "paid", label: "Received", render: (s) => inr(s.paid) }, { key: "st", label: "", render: (s) => s.paid >= s.amount ? <Badge v="paid" /> : s.due_date < todayIST() ? <Badge v="overdue" /> : <Badge v="upcoming" /> }, { key: "x", label: "", render: (s) => s.paid < s.amount && w ? <button className="btn-line btn-sm" onClick={() => setDlg({ kind: "rent", period: s.period, amount: s.amount - s.paid, key: uid() })} data-testid={`record-rent-${s.period}`}>Record rent</button> : null }]} />
        </Section>
        {d.payments?.length > 0 && <Section title="Rent received">
          <DataTable testid="rent-payments-table" rows={d.payments} columns={[{ key: "receipt_no", label: "Receipt" }, { key: "period", label: "Period" }, { key: "date", label: "Received", render: (p) => fmtDate(p.date) }, { key: "method", label: "Method", render: (p) => label(p.method) }, { key: "amount", label: "Amount", render: (p) => inr(p.amount) }, { key: "x", label: "", render: (p) => <button className="btn-line btn-sm" onClick={() => openFile(`/rent-payments/${p.id}/receipt.pdf`, { name: `Rent receipt ${p.receipt_no}` })} data-testid={`rent-receipt-${p.receipt_no}`}>Receipt PDF</button> }]} />
        </Section>}
        {d.handovers?.length > 0 && <Section title="Handover records">{d.handovers.map((h) => <p key={h.id} className="border-b border-slate-100 py-1 text-sm">{label(h.kind)} · {fmtDate(h.date)} · meters: {h.meter_readings || "-"} · {h.notes}</p>)}</Section>}
      </div>}
      <FormDialog open={dlg?.kind === "rent"} onClose={() => setDlg(null)} title={`Record rent ${dlg?.period || ""}`} initial={{ amount: dlg?.amount, method: "upi", date: todayIST(), idempotency_key: dlg?.key }} fields={[{ name: "amount", label: "Amount (₹)", type: "number", required: true }, { name: "method", label: "Method", type: "select", required: true, options: opts(["upi", "bank_transfer", "cheque", "cash"]) }, { name: "date", label: "Received on", type: "date", required: true }, { name: "reference", label: "Reference" }]} onSubmit={async (v) => { await api.post(`/leases/${d.id}/rent`, { ...v, period: dlg.period }); after(); }} />
      <FormDialog open={dlg?.kind === "deposit"} onClose={() => setDlg(null)} title={dlg?.direction === "in" ? "Deposit received" : "Deposit refund"} initial={{ amount: dlg?.direction === "in" ? d?.deposit : d?.deposit_held, reason: dlg?.direction === "in" ? "Security deposit" : "Move-out refund", idempotency_key: dlg?.key }} fields={[{ name: "amount", label: "Amount (₹)", type: "number", required: true }, { name: "reason", label: "Reason", required: true }]} onSubmit={async (v) => { await api.post(`/leases/${d.id}/deposit`, { ...v, direction: dlg.direction }); after(); }} />
      <FormDialog open={dlg?.kind === "handover"} onClose={() => setDlg(null)} title="Handover / inspection record" initial={{ kind: "move_in", date: todayIST() }} fields={[{ name: "kind", label: "Type", type: "select", required: true, options: opts(["move_in", "move_out", "inspection"]) }, { name: "date", label: "Date", type: "date", required: true }, { name: "meter_readings", label: "Meter readings (EB / water)" }, { name: "notes", label: "Condition notes / checklist", type: "textarea", full: true }]} onSubmit={async (v) => { await api.post(`/leases/${d.id}/handover`, v); after(); }} />
    </Modal>
  );
}

export default function Leases() {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(null);
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
