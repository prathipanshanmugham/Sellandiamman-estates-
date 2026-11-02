import { useState } from "react";
import { api, fmtDate, fmtDateTime, inr, label, opts } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useDialog } from "../../lib/dialogs";
import { PageHeader, DataTable, Badge, FormDialog, Modal, Facts, useList, act } from "../../components/erp/kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";

const NEXT = { open: ["assigned", "cancelled"], assigned: ["in_progress", "cancelled"], in_progress: ["completed", "cancelled"], completed: ["closed"] };

export function Maintenance() {
  const { can } = useAuth();
  const dialog = useDialog();
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
            <button className="btn-line btn-sm" onClick={async () => { const q = await dialog.ask({ title: "Vendor quotation", label: "Quoted amount (₹)", type: "number", initial: sel.quote_amount ?? "" }); if (q != null) update({ quote_amount: q }, "Quote saved"); }} data-testid="wo-quote-btn">{sel.quote_amount != null ? "Change quote" : "Add quote"}</button>
            {(NEXT[sel.status] || []).map((s) => <button key={s} className="btn-dark btn-sm" data-testid={`wo-status-${s}`} onClick={async () => { if (s === "completed") { const c = await dialog.ask({ title: "Complete work order", body: sel.charge_to === "owner" ? "The cost is recovered from the owner in their next statement." : "The cost is booked as a company maintenance expense.", label: "Actual cost (₹)", type: "number", initial: sel.quote_amount || 0, okLabel: "Mark completed" }); if (c != null) update({ status: s, actual_cost: c }, "Completed"); } else update({ status: s }, `Moved to ${label(s)}`); }}>{label(s)}</button>)}
            <button className="btn-line btn-sm" onClick={async () => { const n = await dialog.ask({ title: "Add a note", label: "Note", type: "textarea" }); if (n) update({ note: n }, "Note added"); }}>Add note</button>
          </div>}
          <div>{sel.history?.map((h, i) => <p key={i} className="border-b border-slate-100 py-1 text-xs text-slate-600">{fmtDateTime(h.at)} · {h.by} · {h.event}</p>)}</div>
        </div>}
      </Modal>
      <FormDialog open={open === "wo"} onClose={() => setOpen("")} title="New work order" initial={{ priority: "medium", charge_to: "owner", category: "general" }} fields={[{ name: "property_id", label: "Property", type: "select", required: true, full: true, options: props.filter((p) => p.code).map((p) => ({ value: p.id, label: `${p.code} · ${p.title}` })) }, { name: "title", label: "Issue", required: true, full: true }, { name: "category", label: "Category", type: "select", required: true, options: opts(["general", "plumbing", "electrical", "carpentry", "painting", "cleaning", "appliance", "structural"]) }, { name: "priority", label: "Priority", type: "select", required: true, options: opts(["low", "medium", "high", "urgent"]) }, { name: "due_date", label: "Due date", type: "date" }, { name: "charge_to", label: "Charge to", type: "select", required: true, options: opts(["owner", "company"]) }, { name: "vendor_id", label: "Vendor", type: "select", options: vendors.map((v) => ({ value: v.id, label: v.name })) }, { name: "reported_by", label: "Reported by" }, { name: "description", label: "Description", type: "textarea", full: true }]} onSubmit={async (v) => { await api.post("/work-orders", v); reload(); }} />
      <FormDialog open={open === "vendor"} onClose={() => setOpen("")} title="New vendor" fields={[{ name: "name", label: "Name", required: true }, { name: "phone", label: "Mobile", required: true }, { name: "trade", label: "Trade", required: true }, { name: "gstin", label: "GSTIN" }, { name: "notes", label: "Notes", full: true }]} onSubmit={async (v) => { await api.post("/vendors", v); rv(); }} />
    </div>
  );
}
