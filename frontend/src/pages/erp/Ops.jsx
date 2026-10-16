import { useMemo, useState } from "react";
import { api, fmtDate, fmtDateTime, inr, label, opts } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { PageHeader, DataTable, Badge, FormDialog, Modal, Facts, useList, act } from "../../components/erp/kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";

const NEXT = { open: ["assigned", "cancelled"], assigned: ["in_progress", "cancelled"], in_progress: ["completed", "cancelled"], completed: ["closed"] };

export function Maintenance() {
  const { can } = useAuth();
  const [open, setOpen] = useState("");
  const [sel, setSel] = useState(null);
  const { rows, reload } = useList("/work-orders");
  const { rows: vendors, reload: rv } = useList("/vendors");
  const { rows: props } = useList(can("properties") ? "/properties" : "/branches");
  const w = can("maintenance", "w");
  const update = async (body, msg) => { const r = await act(() => api.patch(`/work-orders/${sel.id}`, body), msg); if (r) { setSel(r.data); reload(); } };
  return (
    <div>
      <PageHeader title="Maintenance" sub="Work orders from request to completion, with vendor quotes and costs.">{w && <><button className="btn-line btn-sm" onClick={() => setOpen("vendor")} data-testid="new-vendor-btn">New vendor</button><button className="btn-dark btn-sm" onClick={() => setOpen("wo")} data-testid="new-workorder-btn">New work order</button></>}</PageHeader>
      <Tabs defaultValue="wo"><TabsList className="rounded-sm"><TabsTrigger value="wo">Work orders</TabsTrigger><TabsTrigger value="vendors" data-testid="tab-vendors">Vendors</TabsTrigger></TabsList>
        <TabsContent value="wo" className="mt-4"><DataTable testid="workorders-table" rows={rows} onRow={setSel} columns={[{ key: "code", label: "Code" }, { key: "title", label: "Issue" }, { key: "property_title", label: "Property" }, { key: "priority", label: "Priority", render: (r) => <Badge v={r.priority} /> }, { key: "due_date", label: "Due", render: (r) => fmtDate(r.due_date) }, { key: "charge_to", label: "Charge to", render: (r) => label(r.charge_to) }, { key: "status", label: "Status", render: (r) => <Badge v={r.status} /> }]} /></TabsContent>
        <TabsContent value="vendors" className="mt-4"><DataTable testid="vendors-table" rows={vendors} columns={[{ key: "name", label: "Vendor" }, { key: "trade", label: "Trade" }, { key: "phone", label: "Phone" }, { key: "gstin", label: "GSTIN" }]} /></TabsContent>
      </Tabs>
      <Modal open={!!sel} onClose={() => setSel(null)} title={`${sel?.code} · ${sel?.title}`} wide>
        {sel && <div className="space-y-4" data-testid="workorder-detail">
          <Facts items={[["Property", sel.property_title], ["Status", <Badge v={sel.status} testid="workorder-status" />], ["Priority", label(sel.priority)], ["Vendor", vendors.find((v) => v.id === sel.vendor_id)?.name], ["Quote", sel.quote_amount != null ? inr(sel.quote_amount) : "-"], ["Actual cost", sel.actual_cost != null ? inr(sel.actual_cost) : "-"], ["Charge to", label(sel.charge_to)], ["Description", sel.description]]} />
          {w && <div className="flex flex-wrap items-end gap-2">
            <div><label className="lbl">Vendor</label><select className="inp" value={sel.vendor_id || ""} onChange={(e) => update({ vendor_id: e.target.value || null }, "Vendor assigned")} data-testid="wo-vendor-select"><option value="">—</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
            <button className="btn-line btn-sm" onClick={() => { const q = window.prompt("Vendor quotation (₹)"); if (q) update({ quote_amount: Number(q) }, "Quote saved"); }} data-testid="wo-quote-btn">Add quote</button>
            {(NEXT[sel.status] || []).map((s) => <button key={s} className="btn-dark btn-sm" data-testid={`wo-status-${s}`} onClick={() => { if (s === "completed") { const c = window.prompt("Actual cost (₹)", sel.quote_amount || 0); if (c !== null) update({ status: s, actual_cost: Number(c) }, "Completed"); } else update({ status: s }, `Moved to ${label(s)}`); }}>{label(s)}</button>)}
            <button className="btn-line btn-sm" onClick={() => { const n = window.prompt("Note"); if (n) update({ note: n }); }}>Add note</button>
          </div>}
          <div>{sel.history?.map((h, i) => <p key={i} className="border-b border-slate-100 py-1 text-xs text-slate-600">{fmtDateTime(h.at)} · {h.by} · {h.event}</p>)}</div>
        </div>}
      </Modal>
      <FormDialog open={open === "wo"} onClose={() => setOpen("")} title="New work order" initial={{ priority: "medium", charge_to: "owner", category: "general" }} fields={[{ name: "property_id", label: "Property", type: "select", required: true, full: true, options: props.filter((p) => p.code).map((p) => ({ value: p.id, label: `${p.code} · ${p.title}` })) }, { name: "title", label: "Issue", required: true, full: true }, { name: "category", label: "Category", type: "select", required: true, options: opts(["general", "plumbing", "electrical", "carpentry", "painting", "cleaning", "appliance", "structural"]) }, { name: "priority", label: "Priority", type: "select", required: true, options: opts(["low", "medium", "high", "urgent"]) }, { name: "due_date", label: "Due date", type: "date" }, { name: "charge_to", label: "Charge to", type: "select", required: true, options: opts(["owner", "company"]) }, { name: "vendor_id", label: "Vendor", type: "select", options: vendors.map((v) => ({ value: v.id, label: v.name })) }, { name: "reported_by", label: "Reported by" }, { name: "description", label: "Description", type: "textarea", full: true }]} onSubmit={async (v) => { await api.post("/work-orders", v); reload(); }} />
      <FormDialog open={open === "vendor"} onClose={() => setOpen("")} title="New vendor" fields={[{ name: "name", label: "Name", required: true }, { name: "phone", label: "Mobile", required: true }, { name: "trade", label: "Trade", required: true }, { name: "gstin", label: "GSTIN" }, { name: "notes", label: "Notes", full: true }]} onSubmit={async (v) => { await api.post("/vendors", v); rv(); }} />
    </div>
  );
}

function preview(v) {
  if (!v.check_in || !v.check_out || !v.nightly_rate) return null;
  const n = Math.round((new Date(v.check_out) - new Date(v.check_in)) / 864e5);
  if (n <= 0) return null;
  const room = n * v.nightly_rate, gross = room - (+v.discount || 0) + (+v.cleaning_fee || 0), net = gross - (+v.platform_fee || 0), fee = (net * (+v.mgmt_fee_pct || 0)) / 100;
  return { n, gross, net, fee, owner: net - fee - (+v.operating_costs || 0) };
}

export function ShortStay() {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(null);
  const { rows, reload } = useList("/bookings");
  const { rows: props } = useList("/properties", { transaction: "short_stay" });
  const w = can("shortstay", "w");
  const occ = useMemo(() => { const live = rows.filter((b) => b.status !== "cancelled"); const nights = live.reduce((s, b) => s + b.nights, 0); return { nights, adr: nights ? live.reduce((s, b) => s + b.room_revenue, 0) / nights : 0, fees: live.reduce((s, b) => s + b.management_fee, 0) }; }, [rows]);
  const doAct = async (fn, msg) => { const r = await act(fn, msg); if (r) { reload(); setSel(null); } };
  return (
    <div>
      <PageHeader title="Short-stay" sub={`Manual booking entry. No live platform sync is configured. ${occ.nights} nights booked · ADR ${inr(occ.adr, true)} · fees ${inr(occ.fees, true)}`}>{w && <button className="btn-dark btn-sm" onClick={() => setOpen(true)} data-testid="new-booking-btn">New reservation</button>}</PageHeader>
      <DataTable testid="bookings-table" rows={rows} onRow={setSel} columns={[{ key: "code", label: "Code" }, { key: "property_title", label: "Property" }, { key: "guest_name", label: "Guest" }, { key: "check_in", label: "Check-in", render: (r) => fmtDate(r.check_in) }, { key: "check_out", label: "Check-out", render: (r) => fmtDate(r.check_out) }, { key: "gross", label: "Gross", render: (r) => inr(r.gross) }, { key: "management_fee", label: "Our fee", render: (r) => inr(r.management_fee) }, { key: "owner_payout", label: "Owner", render: (r) => inr(r.owner_payout) }, { key: "status", label: "Status", render: (r) => <><Badge v={r.status} />{r.settled && <Badge v="settled" />}</> }]} />
      <Modal open={!!sel} onClose={() => setSel(null)} title={`Booking ${sel?.code}`} wide>
        {sel && <div className="space-y-4" data-testid="booking-detail">
          <Facts items={[["Guest", `${sel.guest_name} (${sel.guests})`], ["Phone", sel.guest_phone], ["Platform", label(sel.platform)], ["Nights", sel.nights], ["Room revenue", inr(sel.room_revenue)], ["Gross booking", inr(sel.gross)], ["Platform fee", inr(sel.platform_fee)], ["Net after platform", inr(sel.net_after_platform)], [`Management fee (${sel.mgmt_fee_pct}%)`, <b data-testid="booking-mgmt-fee">{inr(sel.management_fee)}</b>], ["Operating costs", inr(sel.operating_costs)], ["Owner settlement", <b data-testid="booking-owner-payout">{inr(sel.owner_payout)}</b>], ["Status", label(sel.status)]]} />
          {w && <div className="flex flex-wrap gap-2">
            {sel.status === "confirmed" && <button className="btn-line btn-sm" onClick={() => doAct(() => api.patch(`/bookings/${sel.id}/status`, { status: "checked_in" }), "Checked in")} data-testid="checkin-btn">Check in</button>}
            {sel.status === "checked_in" && <button className="btn-line btn-sm" onClick={() => doAct(() => api.patch(`/bookings/${sel.id}/status`, { status: "completed" }), "Checked out")} data-testid="checkout-btn">Check out</button>}
            {sel.status === "completed" && !sel.settled && <button className="btn-dark btn-sm" onClick={() => doAct(() => api.post(`/bookings/${sel.id}/settle`), "Settlement posted")} data-testid="settle-booking-btn">Post owner settlement</button>}
            {sel.status === "confirmed" && <button className="btn-line btn-sm" onClick={() => { const reason = window.prompt("Cancellation reason"); if (!reason) return; const refund = Number(window.prompt("Refund amount (₹)", "0") || 0); doAct(() => api.post(`/bookings/${sel.id}/cancel`, { reason, refund_amount: refund }), "Cancellation processed"); }} data-testid="cancel-booking-btn">Cancel</button>}
            <button className="btn-line btn-sm" onClick={() => { const note = window.prompt("Guest issue"); if (note) doAct(() => api.post(`/bookings/${sel.id}/issues`, { note }), "Issue logged"); }}>Log guest issue</button>
          </div>}
          {sel.issues?.map((i, k) => <p key={k} className="text-xs text-slate-600">{fmtDateTime(i.at)} · {i.by}: {i.note}</p>)}
        </div>}
      </Modal>
      <FormDialog open={open} onClose={() => setOpen(false)} title="New reservation" initial={{ guests: 2, platform: "direct", discount: 0, cleaning_fee: 0, platform_fee: 0, operating_costs: 0 }} fields={[{ name: "property_id", label: "Property", type: "select", required: true, full: true, options: props.map((p) => ({ value: p.id, label: `${p.code} · ${p.title}` })) }, { name: "guest_name", label: "Guest name", required: true }, { name: "guest_phone", label: "Guest mobile", required: true }, { name: "guests", label: "Guests", type: "number", required: true }, { name: "platform", label: "Platform", type: "select", required: true, options: opts(["direct", "airbnb", "booking_com", "makemytrip", "other"]) }, { name: "check_in", label: "Check-in", type: "date", required: true }, { name: "check_out", label: "Check-out", type: "date", required: true }, { name: "nightly_rate", label: "Nightly rate (₹)", type: "number", required: true }, { name: "discount", label: "Discount (₹)", type: "number" }, { name: "cleaning_fee", label: "Cleaning fee (₹)", type: "number" }, { name: "platform_fee", label: "Platform fee (₹)", type: "number" }, { name: "operating_costs", label: "Operating costs (₹)", type: "number" }, { name: "mgmt_fee_pct", label: "Mgmt fee % (blank = property default)", type: "number" }]}
        onSubmit={async (v) => { await api.post("/bookings", v); reload(); }}>
        {(v) => { const p = preview({ ...v, mgmt_fee_pct: v.mgmt_fee_pct ?? props.find((x) => x.id === v.property_id)?.mgmt_fee_pct }); return p && <p className="bg-slate-50 p-3 text-sm" data-testid="booking-preview">{p.n} nights · gross {inr(p.gross)} · net {inr(p.net)} · fee {inr(p.fee)} · owner {inr(p.owner)}</p>; }}
      </FormDialog>
    </div>
  );
}
