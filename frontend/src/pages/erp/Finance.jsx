import { useEffect, useState } from "react";
import { api, fmtDate, fmtDateTime, inr, label, opts, openFile, todayIST, uid } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { PageHeader, DataTable, Badge, FormDialog, Modal, Kpi, Facts, useList, act } from "../../components/erp/kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";

function InvoiceModal({ inv, onClose, reload }) {
  const { can } = useAuth();
  const [d, setD] = useState(null);
  const [dlg, setDlg] = useState("");
  const load = () => inv && api.get(`/invoices/${inv.id}`).then((r) => setD(r.data));
  useEffect(() => { setD(null); load(); }, [inv]); // eslint-disable-line react-hooks/exhaustive-deps
  const bal = d ? d.total - d.paid - (d.credited || 0) : 0;
  const after = () => { load(); reload(); };
  return (
    <Modal open={!!inv} onClose={onClose} title={`Invoice ${inv?.number || ""}`} wide>
      {d && <div className="space-y-4" data-testid="invoice-detail">
        <Facts items={[["Customer", d.customer_name], ["Type", label(d.type)], ["Issued", fmtDate(d.issue_date)], ["Due", fmtDate(d.due_date)], ["Subtotal", inr(d.subtotal)], [`GST (${d.tax_rate}%)`, inr(d.tax)], ["Total", inr(d.total)], ["Paid", inr(d.paid)], ["Balance", <b data-testid="invoice-balance">{inr(bal)}</b>], ["Status", <Badge v={d.status} testid="invoice-status" />]]} />
        <div className="flex flex-wrap gap-2">
          <button className="btn-line btn-sm" onClick={() => openFile(`/invoices/${d.id}/pdf`)} data-testid="invoice-pdf-btn">Invoice PDF</button>
          {can("finance", "w") && bal > 0 && <button className="btn-dark btn-sm" onClick={() => setDlg("pay")} data-testid="record-payment-btn">Record payment</button>}
          {can("finance", "w") && <button className="btn-line btn-sm" onClick={() => setDlg("credit")} data-testid="credit-note-btn">Credit note / refund</button>}
        </div>
        <DataTable testid="payments-table" rows={d.payments} columns={[{ key: "receipt_no", label: "Receipt" }, { key: "date", label: "Date", render: (p) => fmtDate(p.date) }, { key: "method", label: "Method", render: (p) => label(p.method) }, { key: "amount", label: "Amount", render: (p) => inr(p.amount) }, { key: "r", label: "", render: (p) => <button className="btn-line btn-sm" onClick={() => openFile(`/payments/${p.id}/receipt.pdf`)}>Receipt PDF</button> }]} empty="No payments yet" />
        {d.credit_notes.length > 0 && <p className="text-sm text-slate-600">Credit notes: {d.credit_notes.map((c) => `${c.number} ${inr(c.amount)}`).join(", ")}</p>}
      </div>}
      <FormDialog open={dlg === "pay"} onClose={() => setDlg("")} title="Record payment" initial={{ amount: bal, method: "bank_transfer", date: todayIST(), idempotency_key: uid() }} fields={[{ name: "amount", label: "Amount (₹)", type: "number", required: true }, { name: "method", label: "Method", type: "select", required: true, options: opts(["bank_transfer", "upi", "cheque", "cash", "card"]) }, { name: "date", label: "Date", type: "date", required: true }, { name: "reference", label: "Reference / UTR" }]} onSubmit={async (v) => { await api.post(`/invoices/${d.id}/payments`, v); after(); }} />
      <FormDialog open={dlg === "credit"} onClose={() => setDlg("")} title="Credit note / refund (approval may be required)" fields={[{ name: "amount", label: "Amount (₹)", type: "number", required: true }, { name: "reason", label: "Reason", required: true, full: true }, { name: "refund", label: "Refund cash already received", type: "checkbox" }]} onSubmit={async (v) => { const r = await api.post(`/invoices/${d.id}/credit-note`, v); act(async () => r, r.data.approval_required ? "Sent for approval" : "Credit note issued"); after(); }} />
    </Modal>
  );
}

function Invoices() {
  const { can } = useAuth();
  const [sel, setSel] = useState(null);
  const [open, setOpen] = useState(false);
  const { rows, reload } = useList("/invoices");
  return (
    <div>
      {can("finance", "w") && <div className="mb-3 flex justify-end"><button className="btn-dark btn-sm" onClick={() => setOpen(true)} data-testid="new-invoice-btn">New invoice</button></div>}
      <DataTable testid="invoices-table" rows={rows} onRow={setSel} columns={[{ key: "number", label: "Number" }, { key: "type", label: "Type", render: (r) => label(r.type) }, { key: "customer_name", label: "Customer" }, { key: "issue_date", label: "Issued", render: (r) => fmtDate(r.issue_date) }, { key: "due_date", label: "Due", render: (r) => <span className={r.due_date < todayIST() && ["issued", "partially_paid"].includes(r.status) ? "font-semibold text-red-700" : ""}>{fmtDate(r.due_date)}</span> }, { key: "total", label: "Total", render: (r) => inr(r.total) }, { key: "paid", label: "Paid", render: (r) => inr(r.paid) }, { key: "status", label: "Status", render: (r) => <Badge v={r.status} /> }]} />
      <InvoiceModal inv={sel} onClose={() => setSel(null)} reload={reload} />
      <FormDialog open={open} onClose={() => setOpen(false)} title="New invoice" initial={{ type: "management", qty: 1 }} fields={[{ name: "type", label: "Type", type: "select", required: true, options: opts(["management", "brokerage", "shortstay", "marketing", "other"]) }, { name: "customer_name", label: "Customer", required: true }, { name: "customer_gstin", label: "Customer GSTIN" }, { name: "description", label: "Line description", required: true, full: true }, { name: "qty", label: "Qty", type: "number", required: true }, { name: "rate", label: "Rate (₹)", type: "number", required: true }, { name: "notes", label: "Notes", full: true }]} onSubmit={async (v) => { await api.post("/invoices", { type: v.type, customer_name: v.customer_name, customer_gstin: v.customer_gstin, notes: v.notes, lines: [{ description: v.description, qty: v.qty, rate: v.rate }] }); reload(); }} />
    </div>
  );
}

function Ledgers() {
  const { can } = useAuth();
  const [ledger, setLedger] = useState("company");
  const [bal, setBal] = useState({});
  const { rows, reload } = useList("/ledger", { ledger });
  useEffect(() => { api.get("/ledger/balances").then((r) => setBal(r.data)); }, [rows]);
  const reverse = async (e) => { const reason = window.prompt("Reason for reversal"); if (!reason) return; const r = await act(() => api.post(`/ledger/${e.id}/reverse`, { reason })); if (r) { act(async () => r, r.data.approval_required ? "Reversal sent for approval" : "Entry reversed"); reload(); } };
  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">{Object.entries(bal).map(([k, b]) => <Kpi key={k} title={b.name} value={inr(b.balance, true)} hint={`In ${inr(b.in, true)} · Out ${inr(b.out, true)}`} testid={`ledger-balance-${k}`} onClick={() => setLedger(k)} />)}</div>
      <p className="mb-2 text-sm text-slate-500">Showing: <b>{bal[ledger]?.name}</b>. Entries are never edited; corrections are posted as reversals.</p>
      <DataTable testid="ledger-table" rows={rows} columns={[{ key: "code", label: "Entry" }, { key: "posted_at", label: "Posted", render: (r) => fmtDateTime(r.posted_at) }, { key: "description", label: "Description" }, { key: "account", label: "Account" }, { key: "direction", label: "In/Out", render: (r) => <Badge v={r.direction} tone={r.direction === "in" ? "green" : "amber"} /> }, { key: "amount", label: "Amount", render: (r) => inr(r.amount) }, { key: "x", label: "", render: (r) => r.reversed ? <Badge v="reversed" tone="grey" /> : r.reversal_of ? <span className="text-xs text-slate-400">reversal</span> : can("finance", "w") && <button className="btn-line btn-sm" onClick={() => reverse(r)} data-testid={`reverse-${r.code}`}>Reverse</button> }]} />
    </div>
  );
}

function Expenses() {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const { rows, reload } = useList("/expenses");
  const { rows: owners } = useList("/owners");
  return (
    <div>
      {can("finance", "w") && <div className="mb-3 flex justify-end"><button className="btn-dark btn-sm" onClick={() => setOpen(true)} data-testid="new-expense-btn">Record expense</button></div>}
      <DataTable testid="expenses-table" rows={rows} columns={[{ key: "code", label: "Code" }, { key: "date", label: "Date", render: (r) => fmtDate(r.date) }, { key: "category", label: "Category" }, { key: "description", label: "Description" }, { key: "vendor", label: "Vendor" }, { key: "paid_from", label: "Paid from", render: (r) => label(r.paid_from) }, { key: "amount", label: "Amount", render: (r) => inr(r.amount + (r.gst_amount || 0)) }]} />
      <FormDialog open={open} onClose={() => setOpen(false)} title="Record expense / vendor bill" initial={{ date: todayIST(), paid_from: "company", gst_amount: 0 }} fields={[{ name: "date", label: "Date", type: "date", required: true }, { name: "category", label: "Category", type: "select", required: true, options: opts(["marketing", "office_rent", "salaries", "travel", "utilities", "software", "maintenance", "professional_fees", "other"]) }, { name: "description", label: "Description", required: true, full: true }, { name: "amount", label: "Amount (₹)", type: "number", required: true }, { name: "gst_amount", label: "GST paid (₹)", type: "number" }, { name: "vendor", label: "Vendor" }, { name: "bill_ref", label: "Bill reference" }, { name: "paid_from", label: "Paid from", type: "select", required: true, options: [{ value: "company", label: "Company funds" }, { value: "owner_funds", label: "Owner funds (on behalf of owner)" }] }, { name: "owner_id", label: "Owner (if owner funds)", type: "select", options: owners.map((o) => ({ value: o.id, label: o.name })) }]} onSubmit={async (v) => { await api.post("/expenses", v); reload(); }} />
    </div>
  );
}

function Payouts() {
  const { can } = useAuth();
  const { rows, reload } = useList("/owner-statements");
  const { rows: bookings, reload: rb } = useList("/bookings");
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">Payouts are never transferred automatically. Make the bank transfer, then record its reference here.</p>
      <DataTable testid="statements-table" rows={rows} columns={[{ key: "code", label: "Statement" }, { key: "owner_name", label: "Owner" }, { key: "month", label: "Month" }, { key: "rent_collected", label: "Rent", render: (r) => inr(r.rent_collected) }, { key: "management_fee", label: "Fee", render: (r) => inr(r.management_fee) }, { key: "net_payable", label: "Net payable", render: (r) => inr(r.net_payable) }, { key: "payout_status", label: "Payout", render: (r) => <Badge v={r.payout_status} /> }, { key: "x", label: "", render: (r) => can("finance", "w") && r.payout_status === "pending_manual_transfer" && <button className="btn-line btn-sm" onClick={async () => { const ref = window.prompt("Bank transfer reference"); if (ref) { await act(() => api.post(`/owner-statements/${r.id}/mark-paid`, { reference: ref }), "Payout recorded"); reload(); } }} data-testid={`mark-paid-${r.code}`}>Mark paid</button> }]} empty="No owner statements settled yet" />
      <h3 className="font-heading font-semibold">Short-stay settlements</h3>
      <DataTable testid="ss-settlements-table" rows={bookings.filter((b) => b.settled)} columns={[{ key: "code", label: "Booking" }, { key: "property_title", label: "Property" }, { key: "gross", label: "Gross", render: (r) => inr(r.gross) }, { key: "management_fee", label: "Our fee", render: (r) => inr(r.management_fee) }, { key: "owner_payout", label: "Owner payout", render: (r) => inr(r.owner_payout) }, { key: "payout_status", label: "Payout", render: (r) => <Badge v={r.payout_status} /> }]} empty="No settled bookings" />
      <span className="hidden">{rb && ""}</span>
    </div>
  );
}

export default function Finance() {
  return (
    <div>
      <PageHeader title="Finance" sub="Invoices, receipts, expenses and separate ledgers for company and client funds." />
      <Tabs defaultValue="invoices">
        <TabsList className="rounded-sm"><TabsTrigger value="invoices" data-testid="tab-invoices">Invoices</TabsTrigger><TabsTrigger value="ledgers" data-testid="tab-ledgers">Ledgers</TabsTrigger><TabsTrigger value="expenses" data-testid="tab-expenses">Expenses</TabsTrigger><TabsTrigger value="payouts" data-testid="tab-payouts">Owner payouts</TabsTrigger></TabsList>
        <TabsContent value="invoices" className="mt-4"><Invoices /></TabsContent>
        <TabsContent value="ledgers" className="mt-4"><Ledgers /></TabsContent>
        <TabsContent value="expenses" className="mt-4"><Expenses /></TabsContent>
        <TabsContent value="payouts" className="mt-4"><Payouts /></TabsContent>
      </Tabs>
    </div>
  );
}
