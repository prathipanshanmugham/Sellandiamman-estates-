import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Phone, MessageCircle, ImagePlus, Send, AlertTriangle } from "lucide-react";
import { api, fmtDate, fmtDateTime, inr, label, opts, openFile, telLink, waLink } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { PageHeader, DataTable, Badge, FormDialog, Kpi, Facts, Section, useList, act } from "../../components/erp/kit";
import { CategorySelect, Files, PRIORITY_TEXT, Stars, Thread, TicketBadge } from "../../components/tickets";

const ROLE_TEXT = { tenant: "Tenant", owner: "Owner", buyer: "Buyer", investor: "Investor", staff: "Staff" };
const CHANNEL = ["phone", "whatsapp", "walk_in", "email", "staff"];
const NEXT_LABEL = { acknowledged: "Acknowledge", in_progress: "Start work", on_hold: "Put on hold", resolved: "Mark resolved", closed: "Close", cancelled: "Cancel" };

// Service requests desk: everything customers raise from their portals, plus requests staff log for them.
export function Tickets() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ status: "active", category: "", mine: false, q: "" });
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState(null);
  const { rows, loading, reload } = useList("/tickets", { status: f.status === "all" ? undefined : f.status, category: f.category || undefined, mine: f.mine || undefined, q: f.q || undefined });
  const { rows: meta } = useList("/tickets/options");
  const cats = meta?.categories || [];
  const { rows: props } = useList(can("properties") ? "/properties" : "/branches");
  const { rows: users } = useList("/users/lite");
  useEffect(() => { api.get("/tickets/stats").then((r) => setStats(r.data)).catch(() => {}); }, [rows]);
  return (
    <div>
      <PageHeader title="Service requests" sub="Repairs, cleaning, documents and questions from tenants, owners, buyers and investors. Reply here; they see it in their portal.">
        {can("maintenance", "w") && <button className="btn-dark btn-sm" onClick={() => setOpen(true)} data-testid="new-ticket-btn">Log a request</button>}
      </PageHeader>
      {stats && <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi title="Open" value={stats.active} onClick={() => setF({ ...f, status: "active" })} testid="tk-kpi-open" />
        <Kpi title="New" value={stats.new} hint="Not seen yet" onClick={() => setF({ ...f, status: "open" })} />
        <Kpi title="Waiting for a first reply" value={stats.unanswered} hint="Past the reply target" />
        <Kpi title="Past due" value={stats.overdue} hint="Past the fix-by target" testid="tk-kpi-overdue" />
        <Kpi title="Customer rating" value={stats.avg_rating ? `${stats.avg_rating} / 5` : "-"} hint={`${stats.rated} rated`} />
      </div>}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <select className="inp sm:!w-auto" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status" data-testid="tk-filter-status"><option value="active">Open (all active)</option><option value="all">Everything</option>{["open", "acknowledged", "in_progress", "on_hold", "resolved", "closed", "cancelled"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <select className="inp sm:!w-auto sm:max-w-xs" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} aria-label="Type"><option value="">All types</option>{cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
        <input className="inp sm:!w-48" placeholder="Search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Search" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.mine} onChange={(e) => setF({ ...f, mine: e.target.checked })} />Assigned to me</label>
      </div>
      <DataTable testid="tickets-table" loading={loading} rows={rows} onRow={(r) => nav(`/erp/tickets/${r.id}`)} empty="No requests here." columns={[
        { key: "code", label: "Ref", render: (r) => <span className="whitespace-nowrap">{r.unread_staff && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-600 align-middle" aria-label="Unread" />}{r.code}</span> },
        { key: "title", label: "Request", render: (r) => <>{r.title}<span className="block text-xs text-slate-500">{r.category_label} · {ROLE_TEXT[r.raised_by?.role] || ""} {r.raised_by?.name}</span></> },
        { key: "property_title", label: "Property", render: (r) => r.property_title || "-" },
        { key: "priority", label: "Priority", render: (r) => <Badge v={r.priority} /> },
        { key: "status", label: "Status", render: (r) => <><TicketBadge status={r.status} staff />{r.overdue && <span className="ml-1 text-[11px] font-semibold text-red-700">LATE</span>}</> },
        { key: "assigned_name", label: "With", render: (r) => r.assigned_name || <span className="text-amber-700">Unassigned</span> },
        { key: "last_message_at", label: "Updated", render: (r) => fmtDateTime(r.last_message_at) }]} />
      <FormDialog open={open} onClose={() => setOpen(false)} title="Log a request for a customer" wide initial={{ priority: "medium", channel: "phone" }}
        fields={[{ name: "property_id", label: "Property", type: "select", full: true, options: props.filter((p) => p.code).map((p) => ({ value: p.id, label: `${p.code} · ${p.title}` })) },
          { name: "title", label: "Request", required: true, full: true }, { name: "description", label: "Details", type: "textarea", full: true },
          { name: "priority", label: "Priority", type: "select", required: true, options: Object.entries(PRIORITY_TEXT).map(([value, l]) => ({ value, label: l })) },
          { name: "channel", label: "Came in by", type: "select", required: true, options: opts(CHANNEL) },
          { name: "assigned_to", label: "Assign to", type: "select", options: users.map((u) => ({ value: u.id, label: u.name })) },
          { name: "preferred_time", label: "Best time to visit" }]}
        onSubmit={async (v) => { if (!v.category) throw { response: { data: { detail: "Choose the type of request" }, status: 422 } }; const r = await api.post("/tickets", v); reload(); nav(`/erp/tickets/${r.data.id}`); }}>
        {(v, set) => <div><label className="lbl" htmlFor="tk-cat">Type *</label><CategorySelect categories={cats} value={v.category || ""} onChange={(x) => set({ category: x })} /><p className="mt-1 text-xs text-slate-500">If the property has an active lease, the tenant sees this request in their portal.</p></div>}
      </FormDialog>
    </div>
  );
}

export function TicketDesk() {
  const { id } = useParams();
  const { can } = useAuth();
  const [t, setT] = useState(null);
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(false);
  const [wo, setWo] = useState(false);
  const fileRef = useRef(null);
  const { rows: users } = useList("/users/lite");
  const { rows: vendors } = useList(can("maintenance") ? "/vendors" : "/branches");
  const { rows: meta } = useList("/tickets/options");
  const load = () => api.get(`/tickets/${id}`).then((r) => setT(r.data)).catch(() => setT(false));
  useEffect(() => { setT(null); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (t === false) return <p className="text-sm text-slate-500">Request not found.</p>;
  if (!t) return <p className="text-sm text-slate-500">Loading…</p>;
  const w = can("maintenance", "w");
  const patch = async (body, msg) => { if (await act(() => api.patch(`/tickets/${id}`, body), msg)) load(); };
  const send = async (e) => { e.preventDefault(); if (!text.trim()) return; if (await act(() => api.post(`/tickets/${id}/messages`, { text, internal }), internal ? "Note saved" : "Reply sent")) { setText(""); load(); } };
  const upload = async (e) => { for (const f of [...e.target.files].slice(0, 5)) { const fd = new FormData(); fd.append("file", f); await act(() => api.post(`/tickets/${id}/files`, fd)); } e.target.value = ""; load(); };
  const openF = async (f) => { const r = await act(() => api.post(`/documents/${f.id}/link`)); if (r) openFile(r.data.url.replace(/^\/api/, ""), { name: f.original_name }); };
  const now = new Date().toISOString();
  const active = ["open", "acknowledged", "in_progress", "on_hold"].includes(t.status);
  const phone = t.customer?.phone || t.lease?.tenant_phone;
  const wa = waLink(phone, `Hello ${t.customer?.name || ""}, this is about your request ${t.code}.`);
  return (
    <div className="space-y-5" data-testid="ticket-desk">
      <Link to="/erp/tickets" className="text-xs text-slate-500 hover:underline">← Service requests</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><p className="eyebrow">{t.code} · {t.category_label}</p><h1 className="mt-1 font-heading text-2xl font-semibold" data-testid="ticket-title">{t.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{ROLE_TEXT[t.raised_by?.role]} {t.raised_by?.name} · {label(t.channel)} · {fmtDateTime(t.created_at)}</p></div>
        <div className="flex flex-wrap items-center gap-2"><Badge v={t.priority} /><TicketBadge status={t.status} staff testid="ticket-status" /></div>
      </div>
      {active && t.due_at < now && <p className="flex items-center gap-2 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle size={16} />Past the fix-by target ({fmtDateTime(t.due_at)}).</p>}
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Section title="Conversation">
            <Thread messages={t.messages} staffView />
            <div className="mt-4"><Files files={t.files} open={openF} /></div>
            {w && t.status !== "cancelled" && <form onSubmit={send} className="mt-4 space-y-2 border-t border-slate-100 pt-4">
              <textarea className={`inp ${internal ? "!border-amber-300 !bg-amber-50" : ""}`} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={internal ? "Internal note (the customer does not see this)" : `Reply to ${t.raised_by?.name || "the customer"}`} data-testid="ticket-reply" aria-label="Reply" />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} data-testid="ticket-internal" />Internal note</label>
                  <input ref={fileRef} type="file" multiple hidden onChange={upload} /><button type="button" className="btn-line btn-sm" onClick={() => fileRef.current?.click()}><ImagePlus size={14} />Attach</button></span>
                <button className="btn-dark btn-sm" disabled={!text.trim()} data-testid="ticket-send"><Send size={14} />{internal ? "Save note" : "Send reply"}</button>
              </div>
            </form>}
          </Section>
          {t.rating && <Section title="Customer rating"><Stars value={t.rating.stars} size={16} />{t.rating.comment && <p className="mt-1 text-sm text-slate-600">“{t.rating.comment}”</p>}</Section>}
        </div>
        <div className="space-y-5">
          {w && <Section title="Actions">
            <div className="flex flex-wrap gap-2">{(meta?.flow?.[t.status] || []).map((s) => <button key={s} className={s === "cancelled" ? "btn-line btn-sm" : "btn-dark btn-sm"} onClick={() => patch({ status: s }, label(s))} data-testid={`ticket-to-${s}`}>{NEXT_LABEL[s] || label(s)}</button>)}</div>
            <div className="mt-4 grid gap-3">
              <div><label className="lbl" htmlFor="tk-assign">Handled by</label><select id="tk-assign" className="inp" value={t.assigned_to || ""} onChange={(e) => patch({ assigned_to: e.target.value || "" }, "Assigned")} data-testid="ticket-assign"><option value="">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
              <div><label className="lbl" htmlFor="tk-prio">Priority</label><select id="tk-prio" className="inp" value={t.priority} onChange={(e) => patch({ priority: e.target.value }, "Priority changed")}>{Object.entries(PRIORITY_TEXT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div><label className="lbl" htmlFor="tk-cat2">Type</label><CategorySelect id="tk-cat2" categories={meta?.categories || []} value={t.category} onChange={(x) => patch({ category: x }, "Type changed")} /></div>
            </div>
            {t.property_id && !t.work_order && active && <button className="btn-line btn-sm mt-4" onClick={() => setWo(true)} data-testid="ticket-wo-btn">Raise a work order</button>}
          </Section>}
          <Section title="Details">
            <Facts items={[["Property", t.property_id ? <Link className="underline" to={`/erp/properties/${t.property_id}`}>{t.property_title}</Link> : "-"],
              ["Customer", t.customer ? <Link className="underline" to={`/erp/customers/${t.customer.id}`}>{t.customer.name}</Link> : t.raised_by?.name],
              t.lease && ["Lease", <Link className="underline" to={`/erp/leases?open=${t.lease.id}`}>{t.lease.code}</Link>],
              ["Reply by", <span className={!t.first_response_at && t.respond_by < now && active ? "font-semibold text-red-700" : ""}>{t.first_response_at ? `Replied ${fmtDateTime(t.first_response_at)}` : fmtDateTime(t.respond_by)}</span>],
              ["Fix by", <span className={active && t.due_at < now ? "font-semibold text-red-700" : ""}>{fmtDateTime(t.due_at)}</span>],
              t.preferred_time && ["Best time", t.preferred_time], ["Entry with spare key", t.permission_to_enter ? "Allowed" : "Ask first"],
              t.resolved_at && ["Resolved", fmtDateTime(t.resolved_at)]]} cols="grid-cols-2" />
            {phone && <div className="mt-4 flex flex-wrap gap-2"><a className="btn-line btn-sm" href={telLink(phone)}><Phone size={13} />Call</a>{wa && <a className="btn-line btn-sm" href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle size={13} />WhatsApp</a>}</div>}
          </Section>
          {t.work_order && <Section title={`Work order ${t.work_order.code}`} testid="ticket-wo">
            <Facts items={[["Status", <Badge v={t.work_order.status} />], ["Vendor", vendors.find?.((v) => v.id === t.work_order.vendor_id)?.name], ["Quote", t.work_order.quote_amount != null ? inr(t.work_order.quote_amount) : "-"], ["Cost", t.work_order.actual_cost != null ? inr(t.work_order.actual_cost) : "-"], ["Charged to", label(t.work_order.charge_to)], ["Due", fmtDate(t.work_order.due_date)]]} cols="grid-cols-2" />
            <Link to="/erp/maintenance" className="mt-3 inline-block text-xs underline">Open maintenance</Link>
            <p className="mt-2 text-xs text-slate-500">When the work order is completed, this request is marked resolved and the customer is asked to rate it.</p>
          </Section>}
        </div>
      </div>
      <FormDialog open={wo} onClose={() => setWo(false)} title="Raise a work order" initial={{ charge_to: "owner" }}
        fields={[{ name: "vendor_id", label: "Vendor", type: "select", options: (Array.isArray(vendors) ? vendors : []).filter((v) => v.trade).map((v) => ({ value: v.id, label: `${v.name} · ${v.trade}` })) }, { name: "quote_amount", label: "Quote (₹)", type: "number" }, { name: "charge_to", label: "Cost charged to", type: "select", required: true, options: opts(["owner", "company"]) }, { name: "due_date", label: "Planned date", type: "date" }]}
        onSubmit={async (v) => { await api.post(`/tickets/${id}/work-order`, v); load(); }} />
    </div>
  );
}
