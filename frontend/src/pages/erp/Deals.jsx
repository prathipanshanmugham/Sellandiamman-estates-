import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, fmtDateTime, inr, label, opts, openFile } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { PageHeader, DataTable, Badge, FormDialog, Section, Facts, useList, act } from "../../components/erp/kit";
import { DocsPanel } from "./Documents";

export function Deals() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const { rows } = useList("/deals");
  const { rows: props } = useList(can("properties") && can("deals", "w") ? "/properties" : "/branches");
  return (
    <div>
      <PageHeader title="Deals" sub="Sale, rental and commercial lease transactions. Revenue = commission only.">{can("deals", "w") && <button className="btn-dark btn-sm" onClick={() => setOpen(true)} data-testid="new-deal-btn">New deal</button>}</PageHeader>
      <DataTable testid="deals-table" rows={rows} onRow={(r) => nav(`/erp/deals/${r.id}`)} columns={[{ key: "code", label: "Code" }, { key: "title", label: "Deal" }, { key: "deal_type", label: "Type", render: (r) => label(r.deal_type) }, { key: "agreed_value", label: "Agreed value", render: (r) => (r.agreed_value ? inr(r.agreed_value, true) : "-") }, { key: "expected_commission", label: "Commission", render: (r) => inr(r.final_commission ?? r.expected_commission) }, { key: "stage", label: "Stage", render: (r) => <Badge v={r.stage} /> }]} />
      <FormDialog open={open} onClose={() => setOpen(false)} title="New deal" initial={{ deal_type: "sale" }} fields={[{ name: "title", label: "Title", required: true, full: true }, { name: "deal_type", label: "Type", type: "select", required: true, options: opts(["sale", "rent", "lease"]) }, { name: "property_id", label: "Property", type: "select", required: true, options: props.map((p) => ({ value: p.id, label: `${p.code} · ${p.title}` })) }, { name: "buyer_name", label: "Buyer / tenant", required: true }, { name: "buyer_phone", label: "Buyer phone" }, { name: "seller_name", label: "Seller / landlord" }, { name: "expected_close", label: "Expected closing", type: "date" }]} onSubmit={async (v) => { const r = await api.post("/deals", v); nav(`/erp/deals/${r.data.id}`); }} />
    </div>
  );
}

function CommissionForm({ deal, onDone }) {
  const c = deal.commission;
  const [v, setV] = useState({ type: c?.rule.type || (deal.deal_type === "sale" ? "percent" : "months_rent"), value: c?.rule.value ?? "", payer: c?.payer || deal.seller_name || "", agreement_signed: c?.agreement_signed || false, reason: "" });
  const [splits, setSplits] = useState(c?.splits || []);
  const [pv, setPv] = useState(null);
  useEffect(() => { if (v.value === "") return; const t = setTimeout(() => api.post("/deals/commission-preview", { base_value: deal.agreed_value, rule: { type: v.type, value: Number(v.value) }, splits }).then((r) => setPv(r.data)).catch(() => setPv(null)), 300); return () => clearTimeout(t); }, [v.type, v.value, splits, deal.agreed_value]);
  const save = async () => { const r = await act(() => api.post(`/deals/${deal.id}/commission`, { ...v, value: Number(v.value), splits: splits.map((s) => ({ ...s, percent: Number(s.percent) })) })); if (r) { act(async () => r, r.data.approval_required ? "Change sent for approval" : "Commission saved"); onDone(); } };
  return (
    <div className="space-y-3" data-testid="commission-form">
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label className="lbl">Rule</label><select className="inp" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })} data-testid="commission-type-select"><option value="percent">% of agreed value</option><option value="fixed">Fixed fee</option><option value="months_rent">Months of rent</option></select></div>
        <div><label className="lbl">{v.type === "percent" ? "Percent" : v.type === "fixed" ? "Amount (₹)" : "Months"}</label><input type="number" step="any" min="0" className="inp" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} data-testid="commission-value-input" /></div>
        <div><label className="lbl">Payer</label><input className="inp" value={v.payer} onChange={(e) => setV({ ...v, payer: e.target.value })} data-testid="commission-payer-input" /></div>
      </div>
      {splits.map((s, i) => <div key={i} className="grid grid-cols-[1fr_140px_90px_auto] gap-2"><input className="inp" placeholder="Party" value={s.party} onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, party: e.target.value } : x)))} data-testid={`split-party-${i}`} /><select className="inp" value={s.kind} onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}><option value="co_broker">Co-broker</option><option value="referral">Referral</option><option value="agent">Agent</option></select><input type="number" className="inp" placeholder="%" value={s.percent} onChange={(e) => setSplits(splits.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))} data-testid={`split-percent-${i}`} /><button className="btn-line btn-sm" onClick={() => setSplits(splits.filter((_, j) => j !== i))}>×</button></div>)}
      <button className="btn-line btn-sm" onClick={() => setSplits([...splits, { party: "", kind: "co_broker", percent: "" }])} data-testid="add-split-btn">Add split</button>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.agreement_signed} onChange={(e) => setV({ ...v, agreement_signed: e.target.checked })} data-testid="commission-signed-checkbox" />Written commission agreement signed</label>
      {c && <input className="inp" placeholder="Reason for change (required for approval)" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} data-testid="commission-reason-input" />}
      {pv && <p className="bg-slate-50 p-3 text-sm" data-testid="commission-preview">Gross {inr(pv.gross)} · splits {inr(pv.splits_total)} · <b>company net {inr(pv.company_net)}</b></p>}
      <button className="btn-dark btn-sm" onClick={save} data-testid="save-commission-btn">Save commission</button>
    </div>
  );
}

export function DealDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const [d, setD] = useState(null);
  const [dlg, setDlg] = useState("");
  const load = () => api.get(`/deals/${id}`).then((r) => setD(r.data)).catch(() => setD(false));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (d === false) return <p data-testid="deal-not-found">Deal not found or not accessible.</p>;
  if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  const w = can("deals", "w");
  const open = !["won", "cancelled"].includes(d.stage);
  const c = d.commission;
  return (
    <div className="space-y-6" data-testid="deal-detail">
      <PageHeader title={d.title} sub={`${d.code} · ${label(d.deal_type)} · ${d.property_title}`}>
        <Badge v={d.stage} testid="deal-stage-badge" />
        <button className="btn-line btn-sm" onClick={() => openFile(`/deals/${id}/summary.pdf`, { name: `Deal summary ${d.code}` })} data-testid="deal-pdf-btn">Deal summary PDF</button>
        {w && open && <button className="btn-dark btn-sm" onClick={async () => { await act(() => api.post(`/deals/${id}/close`), "Deal closed"); load(); }} data-testid="close-deal-btn">Close deal (won)</button>}
        {w && open && <button className="btn-line btn-sm" onClick={() => setDlg("cancel")} data-testid="cancel-deal-btn">Cancel / dispute</button>}
        {(w || can("finance", "w")) && d.stage === "won" && !d.invoice && <button className="btn-dark btn-sm" onClick={async () => { await act(() => api.post(`/deals/${id}/invoice`), "Invoice generated"); load(); }} data-testid="generate-invoice-btn">Generate invoice</button>}
      </PageHeader>
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Summary"><Facts items={[["Buyer / tenant", d.buyer_name], ["Seller / landlord", d.seller_name], ["Agreed value", d.agreed_value ? inr(d.agreed_value) : "-"], ["Expected closing", d.expected_close], ["Commission gross", c ? inr(c.gross) : "-"], ["Company net", c ? <span data-testid="deal-company-net">{inr(c.company_net)}</span> : "-"], ["Payer", c?.payer], ["Agreement signed", c ? (c.agreement_signed ? "Yes" : "No") : "-"], ["Final commission (earned)", d.final_commission != null ? inr(d.final_commission) : "-"], ["Invoice", d.invoice ? `${d.invoice.number} · ${label(d.invoice.status)}` : "-"], ["Cancellation", d.cancel_reason]]} />
          {c?.splits?.length > 0 && <div className="mt-4 text-sm">{c.splits.map((s, i) => <p key={i} className="border-t border-slate-100 py-1">{label(s.kind)}: {s.party} · {s.percent}% · {inr(s.amount)}</p>)}</div>}
        </Section>
        <Section title="Offers" testid="offers-section" actions={w && open && <button className="btn-dark btn-sm" onClick={() => setDlg("offer")} data-testid="add-offer-btn">Record offer</button>}>
          <DataTable testid="offers-table" rows={d.offers} columns={[{ key: "party", label: "Party" }, { key: "amount", label: "Amount", render: (o) => inr(o.amount) }, { key: "at", label: "Date", render: (o) => fmtDateTime(o.at) }, { key: "status", label: "Status", render: (o) => <Badge v={o.status} /> }, { key: "x", label: "", render: (o) => w && open && o.status === "pending" ? <span className="flex gap-1"><button className="btn-line btn-sm" onClick={async () => { await act(() => api.patch(`/deals/${id}/offers/${o.id}`, { status: "accepted" }), "Offer accepted"); load(); }} data-testid={`accept-offer-${o.id}`}>Accept</button><button className="btn-line btn-sm" onClick={async () => { await act(() => api.patch(`/deals/${id}/offers/${o.id}`, { status: "rejected" })); load(); }}>Reject</button></span> : null }]} />
        </Section>
        {w && open && d.agreed_value && <Section title="Commission" testid="commission-section"><CommissionForm deal={d} onDone={load} /></Section>}
        <Section title="Document checklist">{d.checklist.map((it, i) => <label key={i} className="flex items-center gap-2 border-b border-slate-100 py-1.5 text-sm"><input type="checkbox" checked={it.done} disabled={!w || !open} onChange={async (e) => { const cl = d.checklist.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)); await act(() => api.patch(`/deals/${id}`, { checklist: cl })); load(); }} data-testid={`checklist-${i}`} />{it.item}</label>)}</Section>
        {d.approvals?.length > 0 && <Section title="Approvals">{d.approvals.map((a) => <p key={a.id} className="flex justify-between border-b border-slate-100 py-1.5 text-sm"><span>{a.summary}</span><Badge v={a.status} /></p>)}</Section>}
        <Section title="History">{d.history.map((h, i) => <p key={i} className="border-b border-slate-100 py-1 text-xs text-slate-600">{fmtDateTime(h.at)} · {h.by} · {h.event}</p>)}</Section>
        <DocsPanel entityType="deal" entityId={d.id} title="Deal documents (tick “Buyer can see” to show one in the buyer's portal)" defaultType="agreement" />
      </div>
      <FormDialog open={dlg === "offer"} onClose={() => setDlg("")} title="Record offer" fields={[{ name: "party", label: "Offered by", required: true }, { name: "amount", label: d.deal_type === "sale" ? "Offer amount (₹)" : "Monthly rent (₹)", type: "number", required: true }, { name: "terms", label: "Terms", type: "textarea", full: true }]} initial={{ party: d.buyer_name }} onSubmit={async (v) => { await api.post(`/deals/${id}/offers`, v); load(); }} />
      <FormDialog open={dlg === "cancel"} onClose={() => setDlg("")} title="Cancel or dispute deal" initial={{ status: "cancelled" }} fields={[{ name: "status", label: "Status", type: "select", required: true, options: opts(["cancelled", "disputed"]) }, { name: "reason", label: "Reason", type: "textarea", required: true, full: true }]} onSubmit={async (v) => { await api.post(`/deals/${id}/cancel`, v); load(); }} />
    </div>
  );
}
