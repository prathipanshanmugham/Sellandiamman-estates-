import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { api, errMsg, label } from "../../lib/api";

export function PageHeader({ title, sub, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-5">
      <div><h1 className="font-heading text-2xl font-semibold text-slate-900" data-testid="page-title">{title}</h1>{sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

const TONES = { green: "bg-emerald-50 text-emerald-800 border-emerald-200", amber: "bg-amber-50 text-amber-800 border-amber-200", blue: "bg-blue-50 text-blue-800 border-blue-200", red: "bg-red-50 text-red-800 border-red-200", grey: "bg-slate-50 text-slate-700 border-slate-200" };
const STATUS_TONE = { published: "green", verified: "green", won: "green", paid: "green", active: "green", completed: "green", closed: "grey", done: "green", approved: "green", settled: "green", verification_pending: "amber", pending: "amber", partially_paid: "amber", negotiation: "blue", agreement: "blue", issued: "blue", confirmed: "blue", in_progress: "blue", checked_in: "blue", lost: "red", cancelled: "red", rejected: "red", disputed: "red", void: "red", urgent: "red", high: "amber", overdue: "red", failed: "red", requested: "amber", scheduled: "blue", no_show: "red", ready_to_market: "blue", under_offer: "blue", pending_manual_transfer: "amber", due: "amber", visit: "blue", stay: "green", rent: "amber", lease_end: "red", task: "grey", authorisation: "amber" };
export function Badge({ v, tone, testid }) {
  return <span className={`inline-block whitespace-nowrap border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${TONES[tone || STATUS_TONE[v] || "grey"]}`} data-testid={testid}>{label(v)}</span>;
}

export function Kpi({ title, value, hint, testid, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`panel p-4 text-left ${onClick ? "hover:border-slate-400" : "cursor-default"}`} data-testid={testid}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <p className="mt-2 font-heading text-2xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </button>
  );
}

export function DataTable({ columns, rows, onRow, testid = "data-table", empty = "No records yet.", cards = true, loading = false }) {
  return (
    <div className="panel overflow-x-auto" data-testid={testid}>
      <table className={`tbl w-full ${cards ? "tbl-cards" : ""}`}>
        <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i} onClick={onRow ? () => onRow(r) : undefined} onKeyDown={onRow ? (e) => { if (e.key === "Enter") onRow(r); } : undefined} tabIndex={onRow ? 0 : undefined} className={onRow ? "cursor-pointer hover:bg-slate-50 focus:bg-slate-50 focus:outline-none" : ""} data-testid={`${testid}-row-${i}`}>
              {columns.map((c) => <td key={c.key} data-label={typeof c.label === "string" ? c.label : ""}>{c.render ? c.render(r) : r[c.key] ?? "-"}</td>)}
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={columns.length} className="empty-cell py-10 text-center text-slate-400">{loading ? "Loading…" : empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={`max-h-[90vh] overflow-y-auto rounded-sm ${wide ? "sm:max-w-4xl" : "sm:max-w-xl"}`}>
        <DialogHeader><DialogTitle className="font-heading">{title}</DialogTitle></DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function Field({ f, value, onChange }) {
  const id = `fld-${f.name}`;
  const common = { id, value: value ?? "", onChange: (e) => onChange(e.target.value), className: "inp", "data-testid": `field-${f.name}`, required: f.required };
  let el;
  if (f.type === "select") el = <select {...common}>{!f.required && <option value="">—</option>}{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
  else if (f.type === "textarea") el = <textarea rows={3} {...common} />;
  else if (f.type === "checkbox") return <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} data-testid={`field-${f.name}`} />{f.label}</label>;
  else el = <input type={f.type || "text"} step={f.type === "number" ? "any" : undefined} {...common} />;
  return <div className={f.full ? "sm:col-span-2" : ""}><label className="lbl" htmlFor={id}>{f.label}{f.required && " *"}</label>{el}{f.hint && <p className="mt-1 text-xs text-slate-400">{f.hint}</p>}</div>;
}

export function FormDialog({ open, onClose, title, fields, initial = {}, onSubmit, submitLabel = "Save", children }) {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (open) { setV(initial); setErr(""); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const out = { ...v };
    fields.forEach((f) => {
      if (f.type === "number") out[f.name] = out[f.name] === "" || out[f.name] == null ? null : Number(out[f.name]);
      else if (out[f.name] === "") out[f.name] = null;
    });
    try { await onSubmit(out); onClose(); } catch (ex) { setErr(errMsg(ex)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={title} wide={fields.length > 10}>
      <form onSubmit={submit} className="space-y-4" data-testid="form-dialog">
        <div className="grid gap-4 sm:grid-cols-2">{fields.map((f) => <Field key={f.name} f={f} value={v[f.name]} onChange={(x) => setV((s) => ({ ...s, [f.name]: x }))} />)}</div>
        {children && children(v)}
        {err && <p className="text-sm text-red-700" role="alert" data-testid="form-error">{err}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" className="btn-line" onClick={onClose}>Cancel</button><button className="btn-dark" disabled={busy} data-testid="form-submit-btn">{busy ? "Saving…" : submitLabel}</button></div>
      </form>
    </Modal>
  );
}

export function useList(path, params) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(params || {});
  const load = () => { setLoading(true); return api.get(path, { params }).then((r) => setRows(r.data)).catch((e) => toast.error(errMsg(e))).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, [path, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { rows, loading, reload: load };
}

export async function act(fn, ok) {
  try { const r = await fn(); if (ok) toast.success(ok); return r; } catch (e) { toast.error(errMsg(e)); return null; }
}

export function Section({ title, children, actions, testid }) {
  return <section className="panel p-5" data-testid={testid}><div className="mb-4 flex items-center justify-between gap-2"><h2 className="font-heading text-base font-semibold">{title}</h2><div className="flex gap-2">{actions}</div></div>{children}</section>;
}

export function Facts({ items }) {
  return <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">{items.filter(Boolean).map(([k, v]) => <div key={k}><dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{k}</dt><dd className="mt-0.5 break-words text-sm text-slate-800">{v ?? "-"}</dd></div>)}</dl>;
}
