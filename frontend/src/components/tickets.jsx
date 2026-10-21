import { useState } from "react";
import { Paperclip, Star } from "lucide-react";
import { fmtDateTime } from "../lib/api";
import { Badge } from "./erp/kit";

// Shared pieces of a service request (ticket) for the customer portals and the staff desk.
export const STATUS_TEXT = { open: "Received", acknowledged: "Seen by our team", in_progress: "In progress", on_hold: "On hold", resolved: "Resolved", closed: "Closed", cancelled: "Cancelled" };
export const PRIORITY_TEXT = { low: "Can wait", medium: "Normal", high: "Soon, please", urgent: "Urgent (safety, no water or power)" };
export const GROUP_TEXT = { repair: "Repairs", cleaning: "Cleaning", service: "Services", account: "Account & documents", owner: "For owners", buying: "Buying" };
const STEPS = ["open", "acknowledged", "in_progress", "resolved", "closed"];

export function TicketBadge({ status, staff = false, testid }) {
  return <Badge v={status} text={staff ? undefined : STATUS_TEXT[status]} testid={testid} />;
}

export function StatusSteps({ status }) {
  if (status === "cancelled") return <p className="text-sm text-slate-500">This request was cancelled.</p>;
  const cur = STEPS.indexOf(status === "on_hold" ? "in_progress" : status);
  return (
    <ol className="flex flex-wrap gap-x-1 gap-y-2 text-xs" data-testid="ticket-steps">
      {STEPS.map((s, i) => (
        <li key={s} className={`flex items-center gap-1 ${i <= cur ? "font-semibold text-slate-900" : "text-slate-400"}`}>
          <span className={`inline-block h-2 w-2 rounded-full ${i < cur ? "bg-emerald-600" : i === cur ? "bg-slate-900" : "bg-slate-300"}`} />
          {s === "in_progress" && status === "on_hold" ? "On hold" : STATUS_TEXT[s]}
          {i < STEPS.length - 1 && <span className="mx-1 text-slate-300">—</span>}
        </li>
      ))}
    </ol>
  );
}

// Conversation: the customer's messages on the right, ours on the left, status changes as small notes in the middle.
// staffView shows internal notes (amber) and puts our replies on the right instead.
export function Thread({ messages, staffView = false }) {
  if (!messages?.length) return <p className="text-sm text-slate-500">No messages yet.</p>;
  return (
    <ol className="space-y-3" data-testid="ticket-thread">
      {messages.map((m) => {
        if (m.kind === "event" || m.kind === "file") return <li key={m.id} className="text-center text-[11px] text-slate-400">{m.text} · {m.by} · {fmtDateTime(m.at)}</li>;
        const ours = m.by_role === "staff";
        const right = staffView ? ours : !ours;
        return (
          <li key={m.id} className={`flex ${right ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] border px-3 py-2 text-sm ${m.internal ? "border-amber-200 bg-amber-50" : right ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"}`}>
              <p className="whitespace-pre-wrap break-words">{m.text}</p>
              <p className={`mt-1 text-[10px] ${right && !m.internal ? "text-slate-300" : "text-slate-400"}`}>{m.internal ? "Internal note · " : ""}{m.by}{ours && !staffView ? " (Sellandiamman)" : ""} · {fmtDateTime(m.at)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function Files({ files, open }) {
  if (!files?.length) return null;
  return (
    <ul className="flex flex-wrap gap-2" data-testid="ticket-files">
      {files.map((f) => <li key={f.id}><button type="button" className="btn-line btn-sm" onClick={() => open(f)}><Paperclip size={13} />{f.original_name}</button></li>)}
    </ul>
  );
}

export function Stars({ value, onChange, size = 22 }) {
  const [hover, setHover] = useState(0);
  return (
    <span className="inline-flex gap-0.5" role={onChange ? "radiogroup" : undefined} aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= (hover || value || 0);
        const icon = <Star size={size} className={on ? "fill-amber-400 text-amber-500" : "text-slate-300"} />;
        return onChange
          ? <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)} onClick={() => onChange(n)} data-testid={`star-${n}`}>{icon}</button>
          : <span key={n}>{icon}</span>;
      })}
    </span>
  );
}

// <select> with the request types grouped (Repairs, Cleaning, …).
export function CategorySelect({ categories, value, onChange, id = "tk-cat" }) {
  const groups = [...new Set(categories.map((c) => c.group))];
  return (
    <select id={id} className="inp" value={value} onChange={(e) => onChange(e.target.value)} required data-testid="ticket-category">
      <option value="">Choose…</option>
      {groups.map((g) => <optgroup key={g} label={GROUP_TEXT[g] || g}>{categories.filter((c) => c.group === g).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>)}
    </select>
  );
}
