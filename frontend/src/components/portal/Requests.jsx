import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ImagePlus, Send } from "lucide-react";
import { api, errMsg, fmtDate, fmtDateTime, openFile } from "../../lib/api";
import { Modal, act } from "../erp/kit";
import { CategorySelect, Files, PRIORITY_TEXT, StatusSteps, Stars, Thread, TicketBadge } from "../tickets";
import { useDialog } from "../../lib/dialogs";
import { Loading } from "./PortalShell";

const MAX_FILES = 5;

// "Raise a request" form: type, property, what happened, how urgent, when to visit, photos.
export function NewRequest({ open, onClose, onDone, preset = {}, allowEntry = true }) {
  const [o, setO] = useState(null);
  const [v, setV] = useState({});
  const [files, setFiles] = useState([]);
  const [st, setSt] = useState({ busy: false, err: "" });
  useEffect(() => {
    if (!open) return;
    setV({ priority: "medium", permission_to_enter: false, ...preset }); setFiles([]); setSt({ busy: false, err: "" });
    api.get("/my/ticket-options").then((r) => { setO(r.data); if (r.data.properties.length === 1) setV((x) => ({ ...x, property_id: x.property_id || r.data.properties[0].id })); }).catch((e) => setSt({ busy: false, err: errMsg(e) }));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setSt({ busy: true, err: "" });
    try {
      const { data } = await api.post("/my/tickets", { ...v, property_id: v.property_id || null, description: v.description || null, preferred_time: v.preferred_time || null });
      for (const f of files) {
        const fd = new FormData(); fd.append("file", f);
        try { await api.post(`/my/tickets/${data.id}/files`, fd); } catch (ex) { setSt({ busy: false, err: `${f.name}: ${errMsg(ex)}` }); }
      }
      onClose(); onDone?.(data);
    } catch (ex) { setSt({ busy: false, err: errMsg(ex) }); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Raise a request">
      {!o ? <Loading d={st.err ? false : null} what="the form" /> :
        <form onSubmit={submit} className="space-y-4" data-testid="new-request-form">
          <div><label className="lbl" htmlFor="tk-cat">What do you need? *</label><CategorySelect categories={o.categories} value={v.category || ""} onChange={(x) => setV({ ...v, category: x })} /></div>
          {o.properties.length > 1 && <div><label className="lbl" htmlFor="tk-prop">Property</label><select id="tk-prop" className="inp" value={v.property_id || ""} onChange={set("property_id")} data-testid="ticket-property"><option value="">Not about a particular property</option>{o.properties.map((p) => <option key={p.id} value={p.id}>{p.title} · {p.locality || p.city}</option>)}</select></div>}
          {o.properties.length === 1 && <p className="text-sm text-slate-600">For <b>{o.properties[0].title}</b>, {o.properties[0].locality || o.properties[0].city}</p>}
          <div><label className="lbl" htmlFor="tk-title">In a few words *</label><input id="tk-title" className="inp" required minLength={3} maxLength={160} placeholder="e.g. Kitchen tap is leaking" value={v.title || ""} onChange={set("title")} data-testid="ticket-title" /></div>
          <div><label className="lbl" htmlFor="tk-desc">Details</label><textarea id="tk-desc" className="inp" rows={3} maxLength={3000} placeholder="Where exactly, since when, anything you have tried" value={v.description || ""} onChange={set("description")} data-testid="ticket-description" /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="lbl" htmlFor="tk-pr">How urgent?</label><select id="tk-pr" className="inp" value={v.priority} onChange={set("priority")} data-testid="ticket-priority">{Object.entries(PRIORITY_TEXT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label className="lbl" htmlFor="tk-time">Best time to visit or call</label><input id="tk-time" className="inp" maxLength={120} placeholder="e.g. Weekdays after 6 pm" value={v.preferred_time || ""} onChange={set("preferred_time")} data-testid="ticket-time" /></div>
          </div>
          {allowEntry && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={!!v.permission_to_enter} onChange={set("permission_to_enter")} data-testid="ticket-entry" />Our team may enter with the spare key if nobody is home</label>}
          <div>
            <label className="lbl" htmlFor="tk-files">Photos or a PDF (up to {MAX_FILES})</label>
            <input id="tk-files" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" className="w-full max-w-full text-sm" onChange={(e) => setFiles([...e.target.files].slice(0, MAX_FILES))} data-testid="ticket-files-input" />
            {files.length > 0 && <p className="mt-1 text-xs text-slate-500">{files.map((f) => f.name).join(", ")}</p>}
          </div>
          {st.err && <p className="text-sm text-red-700" role="alert" data-testid="form-error">{st.err}</p>}
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" className="btn-line" onClick={onClose}>Cancel</button><button className="btn-dark" disabled={st.busy} data-testid="ticket-submit">{st.busy ? "Sending…" : "Send request"}</button></div>
        </form>}
    </Modal>
  );
}

// The customer's requests, newest activity first, with a button to raise a new one.
export function RequestsList({ base, intro, allowEntry = true, extra }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const load = () => api.get("/my/tickets").then((r) => setRows(r.data)).catch(() => setRows(false));
  useEffect(() => { load(); }, []);
  const active = (rows || []).filter((r) => ["open", "acknowledged", "in_progress", "on_hold"].includes(r.status));
  const done = (rows || []).filter((r) => !active.includes(r));
  const card = (r) => (
    <Link key={r.id} to={`${base}/${r.id}`} className="block border border-slate-200 bg-white p-4 hover:border-slate-400" data-testid={`request-${r.code}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1"><p className="font-medium text-slate-900">{r.unread_customer && r.can_reply && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-600 align-middle" aria-label="New reply" />}{r.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">{r.code} · {r.category_label}{r.property_title ? ` · ${r.property_title}` : ""}{!r.can_reply ? ` · raised by your tenant` : ""}</p></div>
        <span className="shrink-0"><TicketBadge status={r.status} /></span>
      </div>
      <p className="mt-2 text-xs text-slate-400">Updated {fmtDateTime(r.last_message_at)} · {r.message_count} message{r.message_count === 1 ? "" : "s"}{r.rating ? ` · rated ${r.rating.stars}/5` : ""}</p>
    </Link>
  );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-heading text-2xl font-semibold">Requests</h1>{intro && <p className="mt-1 max-w-2xl text-sm text-slate-600">{intro}</p>}</div>
        <button className="btn-dark btn-sm" onClick={() => setOpen(true)} data-testid="new-request-btn">Raise a request</button>
      </div>
      {rows === null ? <Loading d={null} /> : rows === false ? <Loading d={false} what="your requests" /> : <>
        <section><h2 className="mb-3 text-sm font-semibold text-slate-700">Open ({active.length})</h2>{active.length ? <div className="grid gap-3 md:grid-cols-2" data-testid="requests-open">{active.map(card)}</div> : <p className="panel p-5 text-sm text-slate-500">Nothing open. If something needs fixing or you need a document, raise a request and we will get back to you.</p>}</section>
        {done.length > 0 && <section><h2 className="mb-3 text-sm font-semibold text-slate-700">Done</h2><div className="grid gap-3 md:grid-cols-2">{done.map(card)}</div></section>}
      </>}
      {extra}
      <NewRequest open={open} onClose={() => setOpen(false)} allowEntry={allowEntry} onDone={(t) => nav(`${base}/${t.id}`)} />
    </div>
  );
}

export function RequestDetail({ base }) {
  const { id } = useParams();
  const dialog = useDialog();
  const [t, setT] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [rate, setRate] = useState({ stars: 0, comment: "" });
  const fileRef = useRef(null);
  const load = () => api.get(`/my/tickets/${id}`).then((r) => setT(r.data)).catch(() => setT(false));
  useEffect(() => { setT(null); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t) return <Loading d={t} what="this request" />;
  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    if (await act(() => api.post(`/my/tickets/${id}/messages`, { text }))) { setText(""); await load(); }
    setBusy(false);
  };
  const upload = async (e) => {
    const fs = [...e.target.files].slice(0, MAX_FILES);
    e.target.value = "";
    for (const f of fs) { const fd = new FormData(); fd.append("file", f); await act(() => api.post(`/my/tickets/${id}/files`, fd)); }
    load();
  };
  const openF = async (f) => { const r = await act(() => api.post(`/my/tickets/${id}/files/${f.id}/link`)); if (r) openFile(r.data.url.replace(/^\/api/, ""), { name: f.original_name }); };
  const live = !["cancelled", "closed"].includes(t.status);
  return (
    <div className="space-y-5" data-testid="request-detail">
      <Link to={base} className="text-xs text-slate-500 hover:underline">← All requests</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><p className="eyebrow">{t.code} · {t.category_label}</p><h1 className="mt-1 font-heading text-2xl font-semibold" data-testid="request-title">{t.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{t.property_title ? `${t.property_title} · ` : ""}raised {fmtDate(t.created_at)} by {t.raised_by?.name}{t.assigned_name ? ` · handled by ${t.assigned_name}` : ""}</p></div>
        <TicketBadge status={t.status} testid="request-status" />
      </div>
      <div className="panel p-4"><StatusSteps status={t.status} />
        {t.work_order && <p className="mt-3 text-sm text-slate-600" data-testid="request-work-order">Work order {t.work_order.code}{t.work_order.due_date ? ` · planned for ${fmtDate(t.work_order.due_date)}` : ""} · {t.work_order.status.replace("_", " ")}</p>}
        {(t.preferred_time || t.permission_to_enter) && <p className="mt-2 text-xs text-slate-500">{t.preferred_time ? `Best time: ${t.preferred_time}. ` : ""}{t.permission_to_enter ? "You allowed entry with the spare key." : ""}</p>}
      </div>
      {t.status === "resolved" && t.can_reply && <div className="panel border-emerald-200 bg-emerald-50 p-4" data-testid="rate-box">
        <p className="font-medium text-emerald-900">We have marked this as resolved. How did we do?</p>
        <div className="mt-2"><Stars value={rate.stars} onChange={(n) => setRate({ ...rate, stars: n })} /></div>
        <textarea className="inp mt-2" rows={2} placeholder="Anything to tell us (optional)" value={rate.comment} onChange={(e) => setRate({ ...rate, comment: e.target.value })} data-testid="rate-comment" />
        <div className="mt-2 flex flex-wrap gap-2"><button className="btn-dark btn-sm" disabled={!rate.stars} onClick={async () => { if (await act(() => api.post(`/my/tickets/${id}/rate`, { stars: rate.stars, comment: rate.comment || null }), "Thank you")) load(); }} data-testid="rate-submit">Close with this rating</button>
          <button className="btn-line btn-sm" onClick={async () => { const why = await dialog.ask({ title: "Still not fixed?", label: "What is still wrong?", type: "textarea", okLabel: "Reopen" }); if (why && await act(() => api.post(`/my/tickets/${id}/reopen`, { text: why }), "Reopened")) load(); }} data-testid="reopen-btn">Still not fixed</button></div>
      </div>}
      {t.rating && <p className="text-sm text-slate-600">You rated this <Stars value={t.rating.stars} size={14} />{t.rating.comment ? ` · “${t.rating.comment}”` : ""}</p>}
      <section className="panel p-4 sm:p-5"><h2 className="mb-3 font-heading text-base font-semibold">Conversation</h2>
        <Thread messages={t.messages} />
        <div className="mt-4"><Files files={t.files} open={openF} /></div>
        {t.can_reply && live && <form onSubmit={send} className="mt-4 space-y-2 border-t border-slate-100 pt-4">
          <label className="lbl" htmlFor="tk-reply">Reply</label>
          <textarea id="tk-reply" className="inp" rows={3} maxLength={3000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add details, answer a question or tell us it is done" data-testid="reply-input" />
          <div className="flex flex-wrap justify-between gap-2">
            <span><input ref={fileRef} type="file" multiple hidden accept="image/jpeg,image/png,image/webp,application/pdf" onChange={upload} data-testid="reply-file" /><button type="button" className="btn-line btn-sm" onClick={() => fileRef.current?.click()}><ImagePlus size={14} />Add photo</button></span>
            <button className="btn-dark btn-sm" disabled={busy || !text.trim()} data-testid="reply-send"><Send size={14} />Send</button>
          </div>
        </form>}
        {!t.can_reply && <p className="mt-4 text-xs text-slate-500">Raised by your tenant. You can follow it here; our team keeps you posted on repairs to your property.</p>}
      </section>
      {t.can_reply && ["open", "acknowledged", "on_hold"].includes(t.status) && <button className="text-xs text-slate-500 underline" onClick={async () => { const why = await dialog.ask({ title: "Cancel this request?", label: "Reason (optional)", required: false, okLabel: "Cancel request", tone: "danger" }); if (why !== null && await act(() => api.post(`/my/tickets/${id}/cancel`, { reason: why || null }), "Cancelled")) load(); }} data-testid="cancel-request">Cancel this request</button>}
      {t.can_reply && t.status === "closed" && !t.rating && <button className="text-xs text-slate-500 underline" onClick={async () => { const why = await dialog.ask({ title: "Reopen this request?", label: "What is still wrong?", type: "textarea", okLabel: "Reopen" }); if (why && await act(() => api.post(`/my/tickets/${id}/reopen`, { text: why }), "Reopened")) load(); }}>Reopen</button>}
    </div>
  );
}
