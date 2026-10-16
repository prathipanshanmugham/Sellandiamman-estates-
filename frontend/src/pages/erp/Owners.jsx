import { useState } from "react";
import { api, fmtDate, inr, label, openFile } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { PageHeader, DataTable, Badge, FormDialog, Modal, Section, Facts, useList, act } from "../../components/erp/kit";

function Statement({ owner }) {
  const { can } = useAuth();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [s, setS] = useState(null);
  const load = () => act(() => api.get(`/owners/${owner.id}/statement`, { params: { month } })).then((r) => r && setS(r.data));
  return (
    <Section title="Owner statement" testid="owner-statement-section">
      <div className="flex flex-wrap gap-2"><input type="month" className="inp !w-auto" value={month} onChange={(e) => setMonth(e.target.value)} data-testid="statement-month-input" /><button className="btn-line btn-sm" onClick={load} data-testid="view-statement-btn">View</button><button className="btn-line btn-sm" onClick={() => openFile(`/owners/${owner.id}/statement.pdf?month=${month}`)} data-testid="statement-pdf-btn">PDF</button></div>
      {s && <div className="mt-4"><Facts items={[["Rent collected (owner funds)", inr(s.rent_collected)], ["Management fee", inr(s.management_fee)], ["Expenses", inr(s.expenses)], ["Net payable to owner", <b data-testid="statement-net">{inr(s.net_payable)}</b>]]} />
        {s.settled ? <p className="mt-3 text-sm text-emerald-700" data-testid="statement-settled">Settled ({s.settled.code}) · payout {label(s.settled.payout_status)}</p> :
          can("leases", "w") && <button className="btn-dark btn-sm mt-3" onClick={async () => { await act(() => api.post(`/owners/${owner.id}/statement/settle`, { month }), "Statement settled; payout pending manual transfer"); load(); }} data-testid="settle-statement-btn">Settle statement</button>}</div>}
    </Section>
  );
}

export default function Owners() {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(null);
  const { rows, reload } = useList("/owners");
  const view = async (o) => { const r = await act(() => api.get(`/owners/${o.id}`)); if (r) setSel(r.data); };
  return (
    <div>
      <PageHeader title="Property owners" sub="Third-party owners we broker or manage for.">{can("owners", "w") && <button className="btn-dark btn-sm" onClick={() => setOpen(true)} data-testid="new-owner-btn">New owner</button>}</PageHeader>
      <DataTable testid="owners-table" rows={rows} onRow={view} columns={[{ key: "code", label: "Code" }, { key: "name", label: "Name" }, { key: "phone", label: "Phone" }, { key: "kind", label: "Kind", render: (r) => label(r.kind) }, { key: "is_nri", label: "NRI", render: (r) => (r.is_nri ? "Yes" : "No") }, { key: "source", label: "Source", render: (r) => label(r.source || "direct") }]} />
      <FormDialog open={open} onClose={() => setOpen(false)} title="New owner" initial={{ kind: "individual", preferred_contact: "phone" }} fields={[{ name: "name", label: "Name", required: true }, { name: "phone", label: "Mobile", required: true }, { name: "email", label: "Email" }, { name: "kind", label: "Kind", type: "select", required: true, options: [{ value: "individual", label: "Individual" }, { value: "company", label: "Company" }, { value: "trust", label: "Trust" }, { value: "other", label: "Other" }] }, { name: "representative_name", label: "Authorised representative" }, { name: "representative_phone", label: "Representative phone" }, { name: "address", label: "Address", full: true }, { name: "is_nri", label: "NRI / out-of-town owner", type: "checkbox" }, { name: "notes", label: "Notes", type: "textarea", full: true }]} onSubmit={async (v) => { await api.post("/owners", v); reload(); }} />
      <Modal open={!!sel} onClose={() => setSel(null)} title={sel?.name} wide>
        {sel && <div className="space-y-4" data-testid="owner-detail">
          <Facts items={[["Code", sel.code], ["Phone", sel.phone], ["Email", sel.email], ["Representative", sel.representative_name], ["NRI", sel.is_nri ? "Yes" : "No"]]} />
          <Section title="Properties">{sel.properties.map((p) => <p key={p.id} className="flex justify-between border-b border-slate-100 py-1.5 text-sm"><span>{p.code} · {p.title}</span><Badge v={p.status} /></p>)}</Section>
          {(can("leases") || can("finance")) && <Statement owner={sel} />}
          {sel.statements?.length > 0 && <Section title="Past statements">{sel.statements.map((s) => <p key={s.id} className="flex justify-between border-b border-slate-100 py-1.5 text-sm"><span>{s.month} · net {inr(s.net_payable)}</span><span>{label(s.payout_status)} {s.paid_at && fmtDate(s.paid_at)}</span></p>)}</Section>}
        </div>}
      </Modal>
    </div>
  );
}
