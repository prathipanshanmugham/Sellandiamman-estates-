import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Copy, RefreshCw, Upload, AlertTriangle, ExternalLink, Plus, Trash2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { api, fmtDate, fmtDateTime, inr, label, todayIST, copyText, imgSrc } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useDialog } from "../../lib/dialogs";
import { PageHeader, DataTable, Badge, FormDialog, Modal, Facts, Section, Kpi, act } from "../../components/erp/kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";

const COLORS = { direct: "#0f172a", website: "#334155", airbnb: "#e11d48", booking_com: "#1d4ed8", agoda: "#7c3aed", makemytrip: "#ea580c", goibibo: "#f97316", vrbo: "#0891b2", expedia: "#ca8a04", other: "#64748b" };
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const DAYS = 28;

function usePlatforms() {
  const [p, setP] = useState([]);
  useEffect(() => { api.get("/short-stay/platforms").then((r) => setP(r.data)).catch(() => {}); }, []);
  return p;
}

// ---------- Calendar: every home on one screen ----------
function CalendarGrid({ units, onBooking, onEmpty, reloadKey }) {
  const [start, setStart] = useState(() => addDays(todayIST(), -3));
  const [d, setD] = useState(null);
  const end = addDays(start, DAYS);
  useEffect(() => { api.get("/short-stay/calendar", { params: { frm: start, to: end } }).then((r) => setD(r.data)).catch(() => setD({ units: [], bookings: [], blocks: [] })); }, [start, end, reloadKey]);
  const days = Array.from({ length: DAYS }, (_, i) => addDays(start, i));
  const today = todayIST();
  if (!d) return <p className="text-sm text-slate-500">Loading calendar…</p>;
  const col = (date) => Math.max(0, Math.min(DAYS, diff(start, date)));
  return (
    <div data-testid="stay-calendar">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className="btn-line btn-sm" onClick={() => setStart(addDays(start, -14))} aria-label="Earlier"><ChevronLeft size={14} /></button>
        <button className="btn-line btn-sm" onClick={() => setStart(addDays(today, -3))}>Today</button>
        <button className="btn-line btn-sm" onClick={() => setStart(addDays(start, 14))} aria-label="Later"><ChevronRight size={14} /></button>
        <input type="date" className="inp !w-auto" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} aria-label="Start date" />
        <span className="flex flex-wrap gap-2 text-[11px] text-slate-500">{Object.entries({ direct: "Direct", website: "Website", airbnb: "Airbnb", booking_com: "Booking.com", makemytrip: "MakeMyTrip", agoda: "Agoda" }).map(([k, l]) => <span key={k} className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5" style={{ background: COLORS[k] }} />{l}</span>)}<span className="flex items-center gap-1"><span className="stay-block inline-block h-2.5 w-2.5" />Closed</span></span>
      </div>
      <div className="panel overflow-x-auto">
        <div className="min-w-max" style={{ display: "grid", gridTemplateColumns: `minmax(150px, 190px) repeat(${DAYS}, 34px)` }}>
          <div className="sticky left-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Home</div>
          {days.map((x) => { const wd = new Date(`${x}T00:00:00Z`).getUTCDay(); return <div key={x} className={`border-b border-l border-slate-200 py-1 text-center text-[10px] leading-tight ${x === today ? "bg-slate-900 text-white" : wd === 0 || wd === 6 ? "bg-slate-100 text-slate-600" : "bg-slate-50 text-slate-500"}`}>{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][wd]}<br /><b>{Number(x.slice(8))}</b></div>; })}
          {(units.length ? units : d.units).map((u) => {
            const bks = d.bookings.filter((b) => b.property_id === u.id);
            const blks = d.blocks.filter((b) => b.property_id === u.id);
            return [
              <div key={`${u.id}-n`} className="sticky left-0 z-10 border-b border-slate-100 bg-white px-3 py-2 text-xs"><p className="truncate font-medium text-slate-900" title={u.title}>{u.title}</p><p className="text-slate-400">{u.code} · {u.locality}</p></div>,
              <div key={`${u.id}-r`} className="relative border-b border-slate-100" style={{ gridColumn: `2 / span ${DAYS}`, display: "grid", gridTemplateColumns: `repeat(${DAYS}, 34px)` }}>
                {days.map((x) => <button key={x} type="button" className={`h-12 border-l border-slate-100 hover:bg-slate-50 ${x === today ? "bg-slate-50" : ""}`} onClick={() => onEmpty(u, x)} aria-label={`New booking ${u.title} ${x}`} />)}
                {blks.map((k) => { const s = col(k.start), e = col(k.end); if (e <= s) return null; return <div key={k.id} className="stay-block pointer-events-none absolute top-1.5 flex h-9 items-center overflow-hidden px-1.5 text-[10px] text-slate-600" style={{ left: s * 34 + 2, width: (e - s) * 34 - 4 }} title={`${k.note || label(k.reason)} ${k.start}–${k.end}`}>{k.note || label(k.reason)}</div>; })}
                {bks.map((b) => { const s = col(b.check_in), e = col(b.check_out); if (e <= s) return null; const warn = b.status === "conflict" || b.status === "requested"; return <button key={b.id} type="button" onClick={() => onBooking(b.id)} className={`absolute top-1.5 flex h-9 items-center gap-1 overflow-hidden px-1.5 text-left text-[10px] font-medium text-white ${warn ? "ring-2 ring-amber-400" : ""} ${b.status === "requested" ? "opacity-60" : ""}`} style={{ left: s * 34 + 17, width: Math.max(18, (e - s) * 34 - 4), background: COLORS[b.platform] || COLORS.other }} title={`${b.code} · ${b.guest_name} · ${b.check_in} to ${b.check_out} · ${b.status}`} data-testid={`cal-booking-${b.code}`}>{(b.needs_details || warn) && <AlertTriangle size={10} className="shrink-0" />}<span className="truncate">{b.guest_name}</span></button>; })}
              </div>,
            ];
          })}
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-400">Bars start at check-in afternoon and end at check-out morning. Tap a free day to add a booking. Amber outline: a clash between platforms or a website request waiting for you.</p>
    </div>
  );
}

// ---------- Booking detail ----------
function BookingModal({ id, onClose, onChanged, w, canApprove }) {
  const dialog = useDialog();
  const [b, setB] = useState(null);
  const [edit, setEdit] = useState(false);
  const [cancel, setCancel] = useState(false);
  const load = () => api.get("/bookings").then((r) => setB(r.data.find((x) => x.id === id) || false)).catch(() => setB(false));
  useEffect(() => { if (id) load(); else setB(null); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const doAct = async (fn, msg) => { const r = await act(fn, msg); if (r) { onChanged(); load(); } return r; };
  if (!id) return null;
  return (
    <Modal open={!!id} onClose={onClose} title={b ? `Booking ${b.code}` : "Booking"} wide>
      {b === null && <p className="text-sm text-slate-500">Loading…</p>}
      {b === false && <p className="text-sm text-slate-500">Booking not found.</p>}
      {b && <div className="space-y-4" data-testid="booking-detail">
        {b.status === "conflict" && <p className="flex gap-2 bg-red-50 p-3 text-sm text-red-900"><AlertTriangle size={16} className="mt-0.5 shrink-0" />Double booking: {label(b.platform)} sold these nights while another booking holds them. Move or cancel one of them on the platform, then confirm or cancel this one here.</p>}
        {b.status === "requested" && <p className="bg-amber-50 p-3 text-sm text-amber-900">Website request{b.quote_total ? ` · estimate ${inr(b.quote_total)}` : ""}. Call or WhatsApp the guest, take the advance, then confirm. The dates are not held until you confirm.</p>}
        {b.needs_details && <p className="bg-amber-50 p-3 text-sm text-amber-900">This booking came from {label(b.platform)}'s calendar, which shares only the dates. Add the guest's name, mobile and the amounts from the platform's reservation.{b.amounts_estimated ? " Amounts shown are estimates." : ""}</p>}
        <Facts items={[["Home", b.property_title], ["Guest", `${b.guest_name} (${b.guests})`], ["Mobile", b.guest_phone], ["Platform", label(b.platform)], ["Platform ref", b.source_ref], ["Dates", `${fmtDate(b.check_in)} → ${fmtDate(b.check_out)} (${b.nights} nights)`], ["Room revenue", inr(b.room_revenue)], ["Gross booking", inr(b.gross)], ["Platform fee", inr(b.platform_fee)], ["Net after platform", inr(b.net_after_platform)], [`Management fee (${b.mgmt_fee_pct}%)`, <b data-testid="booking-mgmt-fee">{inr(b.management_fee)}</b>], ["Operating costs", inr(b.operating_costs)], ["Owner settlement", <b data-testid="booking-owner-payout">{inr(b.owner_payout)}</b>], ["Status", <Badge v={b.status} />], ["Source", label(b.source)], ["Created", fmtDateTime(b.created_at)]]} />
        {b.notes && <p className="text-sm text-slate-600">{b.notes}</p>}
        {w && <div className="flex flex-wrap gap-2">
          {!b.settled && ["confirmed", "conflict", "requested", "checked_in"].includes(b.status) && <button className={b.needs_details ? "btn-dark btn-sm" : "btn-line btn-sm"} onClick={() => setEdit(true)} data-testid="booking-edit-btn">{b.needs_details ? "Add guest & amounts" : "Edit details"}</button>}
          {b.status === "requested" && <><button className="btn-dark btn-sm" onClick={() => doAct(() => api.patch(`/bookings/${b.id}/status`, { status: "confirmed" }), "Confirmed. The dates are now closed on every platform at their next sync.")} data-testid="booking-confirm-btn">Confirm booking</button><button className="btn-line btn-sm" onClick={async () => { const reason = await dialog.ask({ title: "Decline this request?", label: "Reason (for our records)", required: false }); if (reason !== null) doAct(() => api.patch(`/bookings/${b.id}/status`, { status: "declined", reason }), "Declined"); }}>Decline</button></>}
          {b.status === "conflict" && <button className="btn-dark btn-sm" onClick={() => doAct(() => api.patch(`/bookings/${b.id}/status`, { status: "confirmed" }), "Confirmed")} data-testid="booking-resolve-btn">Clash resolved – confirm</button>}
          {b.status === "confirmed" && <button className="btn-line btn-sm" onClick={() => doAct(() => api.patch(`/bookings/${b.id}/status`, { status: "checked_in" }), "Checked in")} data-testid="checkin-btn">Check in</button>}
          {b.status === "confirmed" && <button className="btn-line btn-sm" onClick={() => doAct(() => api.patch(`/bookings/${b.id}/status`, { status: "no_show" }), "Marked no-show")}>No-show</button>}
          {b.status === "checked_in" && <button className="btn-line btn-sm" onClick={() => doAct(() => api.patch(`/bookings/${b.id}/status`, { status: "completed" }), "Checked out")} data-testid="checkout-btn">Check out</button>}
          {b.status === "completed" && !b.settled && <button className="btn-dark btn-sm" onClick={() => doAct(() => api.post(`/bookings/${b.id}/settle`), "Settlement posted")} data-testid="settle-booking-btn">Post owner settlement</button>}
          {["confirmed", "conflict", "requested"].includes(b.status) && <button className="btn-line btn-sm" onClick={() => setCancel(true)} data-testid="cancel-booking-btn">Cancel</button>}
          <button className="btn-line btn-sm" onClick={async () => { const note = await dialog.ask({ title: "Log a guest issue", label: "What happened?", type: "textarea" }); if (note) doAct(() => api.post(`/bookings/${b.id}/issues`, { note }), "Issue logged"); }}>Log guest issue</button>
        </div>}
        {b.issues?.map((i, k) => <p key={k} className="text-xs text-slate-600">{fmtDateTime(i.at)} · {i.by}: {i.note}</p>)}
        {b.channel_id && <p className="text-xs text-slate-400">Came in by calendar sync. If it disappears from the platform's calendar it is cancelled here automatically.</p>}
      </div>}
      <FormDialog open={edit} onClose={() => setEdit(false)} title="Guest and amounts" initial={b ? { ...b, guest_name: b.guest_name?.startsWith("Guest via") ? "" : b.guest_name } : {}} fields={[{ name: "guest_name", label: "Guest name", required: true }, { name: "guest_phone", label: "Guest mobile", required: true }, { name: "guest_email", label: "Guest email", type: "email" }, { name: "guests", label: "Guests", type: "number", required: true }, { name: "source_ref", label: "Platform reservation code" }, { name: "nightly_rate", label: "Nightly rate (₹)", type: "number", required: true }, { name: "discount", label: "Discount (₹)", type: "number" }, { name: "cleaning_fee", label: "Cleaning fee (₹)", type: "number" }, { name: "platform_fee", label: "Platform commission (₹)", type: "number", hint: "From the platform's payout statement" }, { name: "operating_costs", label: "Operating costs (₹)", type: "number" }, { name: "notes", label: "Notes", type: "textarea", full: true }]}
        onSubmit={async (v) => { await api.patch(`/bookings/${b.id}`, v); onChanged(); load(); }} />
      <FormDialog open={cancel} onClose={() => setCancel(false)} title={`Cancel booking ${b?.code || ""}`} submitLabel="Cancel booking" initial={{ refund_amount: 0 }} fields={[{ name: "reason", label: "Reason", required: true, full: true }, { name: "refund_amount", label: "Refund to guest (₹)", type: "number", required: true, hint: canApprove ? undefined : "Refunds need a director's approval." }]}
        onSubmit={async (v) => { const r = await api.post(`/bookings/${b.id}/cancel`, { reason: v.reason, refund_amount: v.refund_amount || 0 }); act(async () => r, r.data.approval_required ? "Refund sent for approval" : "Booking cancelled"); onChanged(); load(); }} />
    </Modal>
  );
}

// ---------- Homes & platform links ----------
function Channels({ units, platforms, w, reload }) {
  const dialog = useDialog();
  const [chans, setChans] = useState([]);
  const load = () => api.get("/short-stay/channels").then((r) => setChans(r.data)).catch(() => {});
  useEffect(() => { load(); }, [units]);
  const done = () => { load(); reload(); };
  const editUrl = async (c) => {
    const url = await dialog.ask({ title: `${c.label}: calendar link to import`, body: `In ${c.label}, open the listing's calendar settings and copy its "export calendar" (iCal) link. We read it every 15 minutes.`, label: "Calendar (iCal) link", initial: c.ical_import_url || "", placeholder: "https://…ics", required: false });
    if (url === null) return;
    if (await act(() => api.patch(`/short-stay/channels/${c.id}`, { ical_import_url: url || null }), "Saved")) done();
  };
  const importFile = async (c, e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    const text = await f.text();
    const r = await act(() => api.post(`/short-stay/channels/${c.id}/import-text`, { ics: text }));
    if (r) { dialog.notice({ title: `${c.label} calendar imported`, body: r.data.ok ? `${r.data.events} dates read: ${r.data.created} new bookings, ${r.data.updated} changed, ${r.data.cancelled} cancelled, ${r.data.blocks} closed periods, ${r.data.conflicts} clashes.` : r.data.error }); done(); }
  };
  const sync = async (c) => { const r = await act(() => api.post(`/short-stay/channels/${c.id}/sync`)); if (r) { dialog.notice({ title: `${c.label} synced`, body: r.data.ok ? `${r.data.events} dates read: ${r.data.created} new, ${r.data.updated} changed, ${r.data.cancelled} cancelled, ${r.data.blocks} closed, ${r.data.conflicts} clashes.` : `Could not read the calendar: ${r.data.error}` }); done(); } };
  const add = async (u, platform) => { if (platform && await act(() => api.post("/short-stay/channels", { property_id: u.id, platform }), "Platform added")) done(); };
  return (
    <div className="space-y-4" data-testid="stay-channels">
      <p className="text-sm text-slate-600">For each home, give every platform our export link (it lists the nights already taken anywhere) and paste the platform's own calendar link here. Bookings then flow both ways within minutes, so a night sold on one platform is closed on the others.</p>
      {units.map((u) => {
        const mine = chans.filter((c) => c.property_id === u.id);
        const missing = platforms.filter((p) => !["direct", "website"].includes(p.key) && !mine.some((c) => c.platform === p.key));
        return (
          <section key={u.id} className="panel" data-testid={`unit-${u.code}`}>
            <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 p-4">
              <img src={imgSrc(u.images?.[0])} alt="" className="h-14 w-20 object-cover" />
              <div className="min-w-0 flex-1"><p className="font-heading font-semibold">{u.title}</p><p className="text-xs text-slate-500">{u.code} · {u.locality}, {u.city} · {u.occupancy_30d}% booked next 30 days{u.next_booking ? ` · next: ${u.next_booking.guest_name} on ${fmtDate(u.next_booking.check_in)}` : ""}</p></div>
              <div className="flex flex-wrap gap-1">{u.needs_details > 0 && <Badge v={`${u.needs_details} need details`} tone="amber" />}{u.conflicts > 0 && <Badge v={`${u.conflicts} clash`} tone="red" />}{u.listing_id && <Link to={`/properties/${u.listing_id}`} className="btn-line btn-sm">Website <ExternalLink size={11} /></Link>}</div>
            </div>
            <DataTable cards testid={`channels-${u.code}`} rows={mine} columns={[
              { key: "label", label: "Platform", render: (c) => <span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5" style={{ background: COLORS[c.platform] || COLORS.other }} />{c.label}{c.listing_url && <a href={c.listing_url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-slate-900" aria-label="Open listing"><ExternalLink size={12} /></a>}</span> },
              { key: "commission_pct", label: "Commission", render: (c) => (w ? <button className="underline decoration-dotted" onClick={async () => { const v = await dialog.ask({ title: `${c.label} commission %`, label: "Commission (%)", type: "number", initial: c.commission_pct }); if (v != null && await act(() => api.patch(`/short-stay/channels/${c.id}`, { commission_pct: v }), "Saved")) done(); }}>{c.commission_pct}%</button> : `${c.commission_pct}%`) },
              { key: "import", label: "Their calendar → us", render: (c) => <span className="text-xs">{c.ical_import_url ? <><span className="block max-w-[14rem] truncate text-slate-500" title={c.ical_import_url}>{c.ical_import_url}</span>{c.last_sync_at && <span className={c.last_sync_status === "failed" ? "text-red-700" : "text-slate-400"}>{c.last_sync_status === "failed" ? `Failed ${fmtDateTime(c.last_sync_at)}: ${c.last_sync_error}` : `Synced ${fmtDateTime(c.last_sync_at)}`}</span>}</> : <span className="text-amber-700">Not linked yet</span>}</span> },
              { key: "export", label: "Our calendar → them", render: (c) => <button className="btn-line btn-sm" onClick={async () => { await copyText(c.export_url); dialog.notice({ title: `Link for ${c.label}`, body: `Paste this in ${c.label}: Calendar → Availability → Import / sync calendar. It shows only taken dates, never guest names.`, copy: c.export_url }); }} data-testid={`copy-export-${c.platform}`}><Copy size={12} />Copy link</button> },
              { key: "x", label: "", render: (c) => w && <span className="flex flex-wrap gap-1"><button className="btn-line btn-sm" onClick={() => editUrl(c)}>{c.ical_import_url ? "Change link" : "Paste link"}</button>{c.ical_import_url && <button className="btn-line btn-sm" onClick={() => sync(c)} data-testid={`sync-${c.platform}`}><RefreshCw size={12} />Sync now</button>}<label className="btn-line btn-sm cursor-pointer"><Upload size={12} />.ics file<input type="file" accept=".ics,text/calendar" className="hidden" onChange={(e) => importFile(c, e)} /></label><button className="btn-line btn-sm" onClick={async () => { if (await dialog.confirm({ title: "Make a new export link?", body: `The old link stops working. Paste the new one in ${c.label} straight away.`, okLabel: "New link" })) { const r = await act(() => api.post(`/short-stay/channels/${c.id}/rotate-link`), "New link made"); if (r) { done(); dialog.notice({ title: "New export link", copy: r.data.export_url }); } } }}>New link</button></span> },
            ]} empty="No platforms linked yet." />
            {w && missing.length > 0 && <div className="flex items-center gap-2 border-t border-slate-100 p-3"><Plus size={14} className="text-slate-400" /><select className="inp !w-auto" defaultValue="" onChange={(e) => { add(u, e.target.value); e.target.value = ""; }} aria-label="Add a platform" data-testid={`add-platform-${u.code}`}><option value="">Add a platform…</option>{missing.map((p) => <option key={p.key} value={p.key}>{p.label} (usual commission {p.commission_pct}%)</option>)}</select></div>}
          </section>
        );
      })}
      {!units.length && <p className="panel p-6 text-sm text-slate-500">No short-stay homes yet. Add a property with transaction “short stay”.</p>}
    </div>
  );
}

// ---------- Pricing & quote ----------
function Pricing({ units, w, reload, platforms }) {
  const [uid, setUid] = useState("");
  const u = units.find((x) => x.id === uid) || units[0];
  const [p, setP] = useState(null);
  const [q, setQ] = useState({ check_in: addDays(todayIST(), 7), check_out: addDays(todayIST(), 9), guests: 2, platform: "direct" });
  const [quote, setQuote] = useState(null);
  useEffect(() => { if (u) setP({ ...u.pricing, seasons: (u.pricing.seasons || []).map((s) => ({ ...s })) }); setQuote(null); }, [u?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!u || !p) return <p className="text-sm text-slate-500">No short-stay homes yet.</p>;
  const num = (k, l, hint) => <div><label className="lbl" htmlFor={`pr-${k}`}>{l}</label><input id={`pr-${k}`} type="number" step="any" min="0" className="inp" value={p[k] ?? ""} disabled={!w} onChange={(e) => setP({ ...p, [k]: e.target.value === "" ? null : Number(e.target.value) })} />{hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}</div>;
  const save = async () => { if (await act(() => api.put(`/short-stay/units/${u.id}/pricing`, { ...p, weekend_rate: p.weekend_rate || null }), "Prices saved")) reload(); };
  const getQuote = async () => { const r = await act(() => api.post("/short-stay/quote", { property_id: u.id, ...q, guests: Number(q.guests) })); if (r) setQuote(r.data); };
  return (
    <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]" data-testid="stay-pricing">
      <Section title="Prices" actions={<select className="inp !w-auto" value={u.id} onChange={(e) => setUid(e.target.value)} aria-label="Home">{units.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>}>
        <div className="grid gap-4 sm:grid-cols-3">
          {num("base_rate", "Nightly rate (₹)")}{num("weekend_rate", "Fri & Sat nights (₹)", "Blank = same as other nights")}{num("cleaning_fee", "Cleaning fee per stay (₹)")}
          {num("min_nights", "Minimum nights")}{num("weekly_discount_pct", "7+ nights discount (%)")}{num("monthly_discount_pct", "28+ nights discount (%)")}
          {num("included_guests", "Guests included")}{num("extra_guest_fee", "Each extra guest per night (₹)")}
        </div>
        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="lbl">Season and festival prices</p>
          {p.seasons.map((s, i) => <div key={i} className="mb-2 grid items-end gap-2 sm:grid-cols-[1fr_9rem_9rem_8rem_auto]">
            <input className="inp" placeholder="Name (e.g. Pongal)" value={s.name} disabled={!w} onChange={(e) => setP({ ...p, seasons: p.seasons.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} aria-label="Season name" />
            <input type="date" className="inp" value={s.start} disabled={!w} onChange={(e) => setP({ ...p, seasons: p.seasons.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} aria-label="From" />
            <input type="date" className="inp" value={s.end} disabled={!w} onChange={(e) => setP({ ...p, seasons: p.seasons.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} aria-label="To" />
            <input type="number" className="inp" placeholder="₹/night" value={s.rate} disabled={!w} onChange={(e) => setP({ ...p, seasons: p.seasons.map((x, j) => (j === i ? { ...x, rate: Number(e.target.value) } : x)) })} aria-label="Rate" />
            {w && <button className="btn-line btn-sm" onClick={() => setP({ ...p, seasons: p.seasons.filter((_, j) => j !== i) })} aria-label="Remove season"><Trash2 size={13} /></button>}
          </div>)}
          {w && <button className="btn-line btn-sm" onClick={() => setP({ ...p, seasons: [...p.seasons, { name: "", start: todayIST(), end: addDays(todayIST(), 3), rate: p.base_rate }] })}><Plus size={13} />Add season</button>}
        </div>
        {w && <button className="btn-dark btn-sm mt-5" onClick={save} data-testid="save-pricing-btn">Save prices</button>}
        <p className="mt-3 text-xs text-slate-400">These prices are for direct and website bookings and quotes. Set the same prices on each platform in its own extranet.</p>
      </Section>
      <Section title="Quote a guest">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="lbl" htmlFor="q-ci">Check-in</label><input id="q-ci" type="date" className="inp" value={q.check_in} onChange={(e) => setQ({ ...q, check_in: e.target.value })} /></div>
          <div><label className="lbl" htmlFor="q-co">Check-out</label><input id="q-co" type="date" className="inp" value={q.check_out} onChange={(e) => setQ({ ...q, check_out: e.target.value })} /></div>
          <div><label className="lbl" htmlFor="q-g">Guests</label><input id="q-g" type="number" min="1" className="inp" value={q.guests} onChange={(e) => setQ({ ...q, guests: e.target.value })} /></div>
          <div><label className="lbl" htmlFor="q-p">Booked through</label><select id="q-p" className="inp" value={q.platform} onChange={(e) => setQ({ ...q, platform: e.target.value })}>{platforms.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></div>
        </div>
        <button className="btn-dark btn-sm mt-4" onClick={getQuote} data-testid="quote-btn">Work out the price</button>
        {quote && <div className="mt-4 space-y-1 bg-slate-50 p-4 text-sm" data-testid="quote-result">
          {[[`Room: ${quote.nights} nights (${[...new Set(quote.rows.map((x) => x.label))].join(", ")} rates)`, quote.room], quote.discount ? [`Long-stay discount (${quote.discount_pct}%)`, -quote.discount] : null, quote.extra_guests ? ["Extra guests", quote.extra_guests] : null, quote.cleaning_fee ? ["Cleaning", quote.cleaning_fee] : null].filter(Boolean).map(([l, a]) => <p key={l} className="flex justify-between gap-2"><span className="text-slate-600">{l}</span><span className="tabular">{a < 0 ? `−${inr(-a)}` : inr(a)}</span></p>)}
          <p className="flex justify-between gap-2 border-t border-slate-200 pt-2 font-semibold"><span>Guest pays ({quote.nights} nights)</span><span className="tabular">{inr(quote.total)}</span></p>
          <p className="flex justify-between gap-2 text-slate-600"><span>Platform commission ({quote.platform_pct}%)</span><span className="tabular">−{inr(quote.platform_fee)}</span></p>
          <p className="flex justify-between gap-2 text-slate-600"><span>Our management fee</span><span className="tabular">−{inr(quote.management_fee)}</span></p>
          <p className="flex justify-between gap-2 font-semibold"><span>Owner receives (before costs)</span><span className="tabular">{inr(quote.owner_payout)}</span></p>
        </div>}
      </Section>
    </div>
  );
}

// ---------- Performance by platform and home ----------
function Performance() {
  const [r, setR] = useState({ frm: addDays(todayIST(), -90), to: todayIST() });
  const [d, setD] = useState(null);
  useEffect(() => { api.get("/short-stay/performance", { params: r }).then((x) => setD(x.data)).catch(() => setD({ platforms: [], units: [] })); }, [r]);
  if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  const tot = d.platforms.reduce((a, p) => ({ gross: a.gross + p.gross, commission: a.commission + p.commission, nights: a.nights + p.nights, fee: a.fee + p.mgmt_fee }), { gross: 0, commission: 0, nights: 0, fee: 0 });
  return (
    <div className="space-y-6" data-testid="stay-performance">
      <div className="flex flex-wrap items-end gap-2"><div><label className="lbl" htmlFor="pf-f">Check-ins from</label><input id="pf-f" type="date" className="inp" value={r.frm} onChange={(e) => setR({ ...r, frm: e.target.value })} /></div><div><label className="lbl" htmlFor="pf-t">to</label><input id="pf-t" type="date" className="inp" value={r.to} onChange={(e) => setR({ ...r, to: e.target.value })} /></div></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Kpi title="Gross bookings" value={inr(tot.gross, true)} hint="Guest payments, not our income" /><Kpi title="Platform commission" value={inr(tot.commission, true)} hint={tot.gross ? `${((tot.commission / tot.gross) * 100).toFixed(1)}% of gross` : ""} /><Kpi title="Nights sold" value={tot.nights} /><Kpi title="Our management fees" value={inr(tot.fee, true)} /></div>
      {d.platforms.length > 0 && <Section title="Where bookings come from"><ResponsiveContainer width="100%" height={240}><BarChart data={d.platforms}><CartesianGrid stroke="#f1f5f9" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => inr(v, true)} width={70} /><Tooltip formatter={(v) => inr(v)} /><Legend /><Bar dataKey="net" name="Net after commission" stackId="a" fill="#1e293b" /><Bar dataKey="commission" name="Platform commission" stackId="a" fill="#94a3b8" /></BarChart></ResponsiveContainer></Section>}
      <DataTable testid="platform-table" rows={d.platforms} columns={[{ key: "label", label: "Platform" }, { key: "bookings", label: "Bookings" }, { key: "nights", label: "Nights" }, { key: "gross", label: "Gross", render: (x) => inr(x.gross) }, { key: "commission", label: "Commission", render: (x) => `${inr(x.commission)} (${x.commission_pct}%)` }, { key: "net", label: "Net", render: (x) => inr(x.net) }, { key: "adr", label: "Avg nightly rate", render: (x) => inr(x.adr) }, { key: "avg_lead_days", label: "Booked ahead", render: (x) => (x.avg_lead_days != null ? `${x.avg_lead_days} days` : "-") }, { key: "cancelled", label: "Cancelled" }]} empty="No stays in these dates." />
      <DataTable testid="unit-table" rows={d.units} columns={[{ key: "title", label: "Home" }, { key: "bookings", label: "Bookings" }, { key: "nights", label: "Nights" }, { key: "occupancy_pct", label: "Occupancy", render: (x) => `${x.occupancy_pct}%` }, { key: "adr", label: "Avg nightly rate", render: (x) => inr(x.adr) }, { key: "revpar", label: "Revenue per available night", render: (x) => inr(x.revpar) }, { key: "gross", label: "Gross", render: (x) => inr(x.gross) }, { key: "fees", label: "Our fees", render: (x) => inr(x.fees) }]} />
    </div>
  );
}

export default function StayDesk() {
  const { can } = useAuth();
  const w = can("shortstay", "w");
  const platforms = usePlatforms();
  const [units, setUnits] = useState([]);
  const [rows, setRows] = useState([]);
  const [tab, setTab] = useState("calendar");
  const [sel, setSel] = useState(null);
  const [newB, setNewB] = useState(null);
  const [block, setBlock] = useState(null);
  const [flt, setFlt] = useState("upcoming");
  const [k, setK] = useState(0);
  const reload = () => { setK((x) => x + 1); api.get("/short-stay/units").then((r) => setUnits(r.data)).catch(() => {}); api.get("/bookings").then((r) => setRows(r.data)).catch(() => {}); };
  useEffect(() => { reload(); }, []);
  const today = todayIST();
  const counts = useMemo(() => ({ details: rows.filter((b) => b.needs_details && !["cancelled", "declined"].includes(b.status)).length, conflict: rows.filter((b) => b.status === "conflict").length, requested: rows.filter((b) => b.status === "requested").length }), [rows]);
  const list = rows.filter((b) => (flt === "upcoming" ? b.check_out >= today && !["cancelled", "declined"].includes(b.status) : flt === "details" ? b.needs_details && !["cancelled", "declined"].includes(b.status) : flt === "all" ? true : b.status === flt));
  return (
    <div>
      <PageHeader title="Short stays" sub="One calendar for every platform. Bookings from Airbnb, Booking.com, MakeMyTrip, Agoda and others arrive through calendar links, and nights sold anywhere close everywhere.">
        {w && <><button className="btn-line btn-sm" onClick={() => setBlock({ start: today, end: addDays(today, 1), reason: "owner_stay" })} data-testid="block-dates-btn">Close dates</button><button className="btn-dark btn-sm" onClick={() => setNewB({ guests: 2, platform: "direct", check_in: today, check_out: addDays(today, 1) })} data-testid="new-booking-btn">New reservation</button></>}
      </PageHeader>
      {(counts.details > 0 || counts.conflict > 0 || counts.requested > 0) && <div className="mb-4 flex flex-wrap gap-2" data-testid="stay-alerts">
        {counts.conflict > 0 && <button className="chip !border-red-300 !bg-red-50 !text-red-900" onClick={() => { setTab("bookings"); setFlt("conflict"); }}><AlertTriangle size={12} />{counts.conflict} double booking{counts.conflict > 1 ? "s" : ""}</button>}
        {counts.requested > 0 && <button className="chip !border-amber-300 !bg-amber-50 !text-amber-900" onClick={() => { setTab("bookings"); setFlt("requested"); }}>{counts.requested} website request{counts.requested > 1 ? "s" : ""} to confirm</button>}
        {counts.details > 0 && <button className="chip !border-amber-300 !bg-amber-50 !text-amber-900" onClick={() => { setTab("bookings"); setFlt("details"); }}>{counts.details} platform booking{counts.details > 1 ? "s" : ""} need guest details</button>}
      </div>}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap justify-start rounded-sm"><TabsTrigger value="calendar" data-testid="tab-calendar">Calendar</TabsTrigger><TabsTrigger value="bookings" data-testid="tab-bookings">Bookings</TabsTrigger><TabsTrigger value="channels" data-testid="tab-channels">Homes & platforms</TabsTrigger><TabsTrigger value="pricing" data-testid="tab-pricing">Prices</TabsTrigger><TabsTrigger value="performance" data-testid="tab-performance">Performance</TabsTrigger></TabsList>
        <TabsContent value="calendar" className="mt-4"><CalendarGrid units={units} reloadKey={k} onBooking={setSel} onEmpty={(u, d) => w && setNewB({ property_id: u.id, guests: 2, platform: "direct", check_in: d, check_out: addDays(d, 1) })} /></TabsContent>
        <TabsContent value="bookings" className="mt-4">
          <div className="mb-3 flex flex-wrap gap-2">{[["upcoming", "Upcoming"], ["details", "Need details"], ["requested", "Requests"], ["conflict", "Clashes"], ["completed", "Completed"], ["cancelled", "Cancelled"], ["all", "All"]].map(([key, l]) => <button key={key} className={`chip ${flt === key ? "chip-on" : ""}`} onClick={() => setFlt(key)}>{l}</button>)}</div>
          <DataTable testid="bookings-table" rows={list} onRow={(b) => setSel(b.id)} columns={[{ key: "code", label: "Code" }, { key: "property_title", label: "Home" }, { key: "guest_name", label: "Guest", render: (b) => <>{b.guest_name}{b.needs_details && <span className="block text-[11px] text-amber-700">details needed</span>}</> }, { key: "platform", label: "Platform", render: (b) => <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2" style={{ background: COLORS[b.platform] || COLORS.other }} />{label(b.platform)}</span> }, { key: "check_in", label: "Check-in", render: (b) => fmtDate(b.check_in) }, { key: "nights", label: "Nights" }, { key: "gross", label: "Gross", render: (b) => inr(b.gross) }, { key: "management_fee", label: "Our fee", render: (b) => inr(b.management_fee) }, { key: "status", label: "Status", render: (b) => <><Badge v={b.status} />{b.settled && <Badge v="settled" />}</> }]} empty="No bookings here." />
        </TabsContent>
        <TabsContent value="channels" className="mt-4"><Channels units={units} platforms={platforms} w={w} reload={reload} /></TabsContent>
        <TabsContent value="pricing" className="mt-4"><Pricing units={units} w={w} reload={reload} platforms={platforms} /></TabsContent>
        <TabsContent value="performance" className="mt-4"><Performance /></TabsContent>
      </Tabs>
      <BookingModal id={sel} onClose={() => setSel(null)} onChanged={reload} w={w} canApprove={can("shortstay", "a")} />
      <FormDialog open={!!newB} onClose={() => setNewB(null)} title="New reservation" initial={newB || {}} fields={[{ name: "property_id", label: "Home", type: "select", required: true, full: true, options: units.map((p) => ({ value: p.id, label: `${p.code} · ${p.title}` })) }, { name: "guest_name", label: "Guest name", required: true }, { name: "guest_phone", label: "Guest mobile", required: true }, { name: "guests", label: "Guests", type: "number", required: true }, { name: "platform", label: "Booked through", type: "select", required: true, options: platforms.map((p) => ({ value: p.key, label: p.label })) }, { name: "check_in", label: "Check-in", type: "date", required: true }, { name: "check_out", label: "Check-out", type: "date", required: true }, { name: "nightly_rate", label: "Nightly rate (₹)", type: "number", required: true }, { name: "discount", label: "Discount (₹)", type: "number" }, { name: "cleaning_fee", label: "Cleaning fee (₹)", type: "number" }, { name: "platform_fee", label: "Platform commission (₹)", type: "number", hint: "Blank = the platform's usual %" }, { name: "operating_costs", label: "Operating costs (₹)", type: "number" }, { name: "source_ref", label: "Platform reservation code" }, { name: "notes", label: "Notes", type: "textarea", full: true }]}
        onSubmit={async (v) => { await api.post("/bookings", { ...v, discount: v.discount || 0, cleaning_fee: v.cleaning_fee || 0, operating_costs: v.operating_costs || 0 }); reload(); }}>
        {(v, set) => { const u = units.find((x) => x.id === v.property_id); return u && !v.nightly_rate ? <button type="button" className="btn-line btn-sm" onClick={() => set({ nightly_rate: u.pricing.base_rate, cleaning_fee: u.pricing.cleaning_fee })}>Use this home's prices ({inr(u.pricing.base_rate)} a night)</button> : null; }}
      </FormDialog>
      <FormDialog open={!!block} onClose={() => setBlock(null)} title="Close dates" initial={block || {}} fields={[{ name: "property_id", label: "Home", type: "select", required: true, full: true, options: units.map((p) => ({ value: p.id, label: `${p.code} · ${p.title}` })) }, { name: "start", label: "From (first night)", type: "date", required: true }, { name: "end", label: "To (morning after the last night)", type: "date", required: true }, { name: "reason", label: "Why", type: "select", required: true, options: [{ value: "owner_stay", label: "Owner staying" }, { value: "maintenance", label: "Maintenance / repairs" }, { value: "hold", label: "Hold for a guest" }, { value: "other", label: "Other" }] }, { name: "note", label: "Note", full: true }]}
        onSubmit={async (v) => { await api.post("/short-stay/blocks", v); reload(); }}>
        {() => <p className="text-xs text-slate-500">The platforms see these nights as unavailable at their next calendar sync.</p>}
      </FormDialog>
    </div>
  );
}
