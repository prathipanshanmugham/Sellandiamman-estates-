import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api, todayIST, fmtDate, label } from "../../lib/api";
import { PageHeader, act } from "../../components/erp/kit";

const TYPES = { visit: ["Site visit", "bg-blue-600"], stay: ["Short stay", "bg-emerald-600"], rent: ["Rent due", "bg-amber-500"], lease_end: ["Lease ends", "bg-red-600"], task: ["Task", "bg-slate-500"], authorisation: ["Authorisation ends", "bg-violet-600"] };
const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function monthGrid(y, m) {
  const first = new Date(Date.UTC(y, m, 1));
  const start = new Date(first);
  start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setUTCDate(start.getUTCDate() + i); return d; });
}

export default function Calendar() {
  const t = todayIST();
  const [ym, setYm] = useState([Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1]);
  const [types, setTypes] = useState(Object.keys(TYPES));
  const [events, setEvents] = useState([]);
  const [day, setDay] = useState(t);
  const days = useMemo(() => monthGrid(ym[0], ym[1]), [ym]);
  const frm = ymd(days[0]);
  const to = ymd(days[41]);
  useEffect(() => { act(() => api.get("/calendar", { params: { frm, to } })).then((r) => r && setEvents(r.data)); }, [frm, to]);
  const shown = events.filter((e) => types.includes(e.type));
  const byDay = useMemo(() => { const m = {}; shown.forEach((e) => { (m[e.date] = m[e.date] || []).push(e); }); return m; }, [shown]);
  const move = (n) => { const d = new Date(Date.UTC(ym[0], ym[1] + n, 1)); setYm([d.getUTCFullYear(), d.getUTCMonth()]); };
  const monthName = new Date(Date.UTC(ym[0], ym[1], 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const inMonth = (d) => d.getUTCMonth() === ym[1];
  const agendaDays = Object.keys(byDay).filter((k) => k.slice(0, 7) === `${ym[0]}-${pad(ym[1] + 1)}`).sort();
  return (
    <div data-testid="calendar-page">
      <PageHeader title="Calendar" sub="Site visits, stays, rent due dates, lease ends, tasks and listing authorisations you can see.">
        <button className="btn-line btn-sm" onClick={() => move(-1)} aria-label="Previous month"><ChevronLeft size={14} /></button>
        <span className="min-w-[9rem] px-2 py-1.5 text-center text-sm font-semibold" data-testid="calendar-month">{monthName}</span>
        <button className="btn-line btn-sm" onClick={() => move(1)} aria-label="Next month"><ChevronRight size={14} /></button>
        <button className="btn-line btn-sm" onClick={() => { setYm([Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1]); setDay(t); }}>Today</button>
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-2">{Object.entries(TYPES).map(([k, [l, c]]) => <button key={k} className={`chip ${types.includes(k) ? "" : "opacity-40"}`} aria-pressed={types.includes(k)} onClick={() => setTypes(types.includes(k) ? types.filter((x) => x !== k) : [...types, k])}><i className={`inline-block h-2 w-2 ${c}`} />{l}</button>)}</div>
      <div className="hidden md:block">
        <div className="grid grid-cols-7 border-l border-t border-slate-200 bg-white">
          {WEEK.map((w) => <div key={w} className="border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">{w}</div>)}
          {days.map((d) => { const k = ymd(d); const list = byDay[k] || []; return (
            <button key={k} onClick={() => setDay(k)} className={`min-h-[104px] border-b border-r border-slate-200 p-1.5 text-left align-top hover:bg-slate-50 ${inMonth(d) ? "" : "bg-slate-50/70 text-slate-400"} ${k === day ? "ring-2 ring-inset ring-slate-900" : ""}`} data-testid={`cal-day-${k}`}>
              <span className={`inline-flex h-6 w-6 items-center justify-center text-xs ${k === t ? "bg-slate-900 font-semibold text-white" : ""}`}>{d.getUTCDate()}</span>
              <span className="mt-1 block space-y-0.5">{list.slice(0, 3).map((e, i) => <span key={i} className="flex items-center gap-1 truncate text-[11px] text-slate-700"><i className={`inline-block h-1.5 w-1.5 shrink-0 ${TYPES[e.type][1]}`} />{e.time ? `${e.time} ` : ""}{e.title.split(" · ")[1] || e.title}</span>)}{list.length > 3 && <span className="text-[11px] text-slate-500">+{list.length - 3} more</span>}</span>
            </button>); })}
        </div>
        <DayList date={day} list={byDay[day] || []} />
      </div>
      <div className="space-y-4 md:hidden" data-testid="calendar-agenda">
        {agendaDays.length === 0 && <p className="panel p-6 text-sm text-slate-500">Nothing scheduled this month.</p>}
        {agendaDays.map((k) => <DayList key={k} date={k} list={byDay[k]} />)}
      </div>
    </div>
  );
}

function DayList({ date, list }) {
  return (
    <div className="panel mt-4 md:mt-6">
      <p className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold">{fmtDate(date)}{date === todayIST() ? " · Today" : ""}</p>
      {list.length === 0 ? <p className="px-4 py-4 text-sm text-slate-500">Nothing scheduled.</p> :
        <ul className="divide-y divide-slate-100">{list.map((e, i) => <li key={i}><Link to={e.link} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50"><i className={`mt-1.5 inline-block h-2 w-2 shrink-0 ${TYPES[e.type][1]}`} /><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-slate-900">{e.time ? `${e.time} · ` : ""}{e.title}</span><span className="block text-xs text-slate-500">{e.sub}{e.end ? ` · until ${fmtDate(e.end)}` : ""}</span></span><span className="shrink-0 text-[11px] uppercase tracking-wide text-slate-500">{label(e.status)}</span></Link></li>)}</ul>}
    </div>
  );
}
