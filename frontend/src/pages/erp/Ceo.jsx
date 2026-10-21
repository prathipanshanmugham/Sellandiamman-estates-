import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, ArrowDownRight, FileDown, Sheet, Info } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, errMsg, inr, n0, openFile, todayIST, useBranchPick, cachedGet } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { PageHeader, Section, Kpi, DataTable } from "../../components/erp/kit";

const TONES = { healthy: ["#047857", "bg-emerald-50 text-emerald-800 border-emerald-200"], attention: ["#b45309", "bg-amber-50 text-amber-800 border-amber-200"], critical: ["#b91c1c", "bg-red-50 text-red-800 border-red-200"], no_data: ["#94a3b8", "bg-slate-50 text-slate-600 border-slate-200"] };
const TONE = new Proxy(TONES, { get: (t, k) => t[k] || t.no_data });
const STATUS_TEXT = { healthy: "Healthy", attention: "Needs attention", critical: "Act now", no_data: "No data" };
const iso = (d) => d.toISOString().slice(0, 10);

function presets() {
  const t = todayIST();
  const d = new Date(`${t}T00:00:00Z`);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const fyY = m < 3 ? y - 1 : y;
  const q0 = Math.floor(((m + 9) % 12) / 3); // Indian FY quarters: Apr–Jun = 0
  const qStartMonth = (3 + q0 * 3) % 12, qYear = qStartMonth > m ? y - 1 : y;
  return [
    ["This month", iso(new Date(Date.UTC(y, m, 1))), t],
    ["Last month", iso(new Date(Date.UTC(y, m - 1, 1))), iso(new Date(Date.UTC(y, m, 0)))],
    ["Last 90 days", iso(new Date(Date.UTC(y, m, d.getUTCDate() - 89))), t],
    ["This quarter", iso(new Date(Date.UTC(qYear, qStartMonth, 1))), t],
    ["Financial year to date", `${fyY}-04-01`, t],
    ["Last financial year", `${fyY - 1}-04-01`, `${fyY}-03-31`],
  ];
}

function Gauge({ score, status }) {
  const r = 54, c = 2 * Math.PI * r, v = score == null ? 0 : Math.max(0, Math.min(100, score));
  return (
    <svg viewBox="0 0 140 140" className="h-36 w-36" role="img" aria-label={`Health score ${score ?? "not available"} out of 100`}>
      <circle cx="70" cy="70" r={r} fill="none" stroke="#e2e8f0" strokeWidth="12" />
      <circle cx="70" cy="70" r={r} fill="none" stroke={TONE[status || "none"][0]} strokeWidth="12" strokeLinecap="butt" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 70 70)" />
      <text x="70" y="68" textAnchor="middle" className="fill-slate-900" style={{ font: "600 34px Outfit, sans-serif" }}>{score == null ? "–" : Math.round(score)}</text>
      <text x="70" y="90" textAnchor="middle" className="fill-slate-500" style={{ font: "500 11px 'Plus Jakarta Sans', sans-serif" }}>out of 100</text>
    </svg>
  );
}

const fmtVal = (m) => (m.value == null ? "No data" : m.unit === "%" ? `${m.value}%` : m.unit === "hours" ? `${m.value} h` : `${m.value} ${m.unit || ""}`);
const change = (a, b) => (b ? ((a - b) / Math.abs(b)) * 100 : null);

function Delta({ now, before, invert }) {
  const c = change(now, before);
  if (c == null || !Number.isFinite(c)) return null;
  const up = c >= 0, good = invert ? !up : up;
  return <span className={`inline-flex items-center text-xs ${good ? "text-emerald-700" : "text-red-700"}`}>{up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(c).toFixed(0)}% vs previous</span>;
}

export default function Ceo() {
  const { can, user } = useAuth();
  const picked = useBranchPick();
  const P = useMemo(presets, []);
  const [f, setF] = useState({ frm: P[2][1], to: P[2][2], branch: picked || "", city: "", locality: "" });
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [branches, setBranches] = useState([]);
  const [towns, setTowns] = useState([]);
  useEffect(() => { cachedGet("/branches").then(setBranches).catch(() => {}); cachedGet("/locations").then(setTowns).catch(() => {}); }, []);
  useEffect(() => {
    setErr("");
    api.get("/ceo/dashboard", { params: { frm: f.frm, to: f.to, branch: f.branch || "all", city: f.city || undefined, locality: f.locality || undefined } })
      .then((r) => setD(r.data)).catch((e) => { setErr(errMsg(e)); setD(null); });
  }, [f]);
  const mine = user.all_branches ? branches : branches.filter((b) => (user.branch_ids || []).includes(b.id));
  const town = towns.find((t) => t.name === f.city);
  const q = new URLSearchParams(Object.entries({ frm: f.frm, to: f.to, branch: f.branch || "all", city: f.city, locality: f.locality }).filter(([, v]) => v)).toString();
  const placeLabel = [f.locality, f.city].filter(Boolean).join(", ") || (f.branch ? `${branches.find((b) => b.id === f.branch)?.name || ""} branch` : user.all_branches ? "All branches" : "Your branches");
  const k = d?.kpis;
  return (
    <div className="space-y-6" data-testid="ceo-dashboard">
      <PageHeader title="CEO dashboard" sub={`Company health for ${placeLabel}, ${f.frm} to ${f.to}, compared with the ${d ? d.period.days : "same number of"} days before.`}>
        {can("ceo", "e") && <><button className="btn-line btn-sm" onClick={() => openFile(`/ceo/report.pdf?${q}`, { name: `Company health report ${f.frm} to ${f.to}` })} data-testid="ceo-pdf-btn"><FileDown size={13} />Report PDF</button><button className="btn-line btn-sm" onClick={() => openFile(`/ceo/report.csv?${q}`, { name: "Company health report", csv: true })} data-testid="ceo-csv-btn"><Sheet size={13} />CSV</button></>}
      </PageHeader>
      <div className="panel flex flex-wrap items-end gap-3 p-4" data-testid="ceo-filters">
        <div><label className="lbl" htmlFor="ceo-preset">Period</label><select id="ceo-preset" className="inp" value={P.findIndex((p) => p[1] === f.frm && p[2] === f.to)} onChange={(e) => { const p = P[Number(e.target.value)]; if (p) setF({ ...f, frm: p[1], to: p[2] }); }}>{P.map((p, i) => <option key={p[0]} value={i}>{p[0]}</option>)}<option value={-1}>Custom dates</option></select></div>
        <div><label className="lbl" htmlFor="ceo-from">From</label><input id="ceo-from" type="date" className="inp" value={f.frm} max={f.to} onChange={(e) => e.target.value && setF({ ...f, frm: e.target.value })} data-testid="ceo-from" /></div>
        <div><label className="lbl" htmlFor="ceo-to">To</label><input id="ceo-to" type="date" className="inp" value={f.to} min={f.frm} onChange={(e) => e.target.value && setF({ ...f, to: e.target.value })} data-testid="ceo-to" /></div>
        {mine.length > 1 && <div><label className="lbl" htmlFor="ceo-branch">Branch</label><select id="ceo-branch" className="inp" value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} data-testid="ceo-branch"><option value="">{user.all_branches ? "All branches" : "All my branches"}</option>{mine.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
        <div><label className="lbl" htmlFor="ceo-town">Town</label><select id="ceo-town" className="inp" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value, locality: "" })} data-testid="ceo-town"><option value="">All towns</option>{towns.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}</select></div>
        {town?.localities?.length > 0 && <div><label className="lbl" htmlFor="ceo-loc">Locality</label><select id="ceo-loc" className="inp" value={f.locality} onChange={(e) => setF({ ...f, locality: e.target.value })}><option value="">All localities</option>{town.localities.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}</select></div>}
      </div>
      {err && <p className="bg-red-50 p-3 text-sm text-red-800" role="alert">{err}</p>}
      {!d && !err && <p className="text-sm text-slate-500">Working out the score…</p>}
      {d && <>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
          <section className="panel flex flex-col items-center p-6 text-center" data-testid="health-score">
            <p className="eyebrow">Company health score</p>
            <Gauge score={d.score} status={d.status} />
            <p className="font-heading text-2xl font-semibold">Grade {d.grade || "–"} <span className={`ml-1 border px-2 py-0.5 align-middle text-xs font-semibold uppercase ${TONE[d.status || "none"][1]}`}>{STATUS_TEXT[d.status] || "No data"}</span></p>
            {d.prev_score != null && d.score != null && <p className={`mt-2 text-sm ${d.score >= d.prev_score ? "text-emerald-700" : "text-red-700"}`}>{d.score >= d.prev_score ? "▲" : "▼"} {Math.abs(d.score - d.prev_score).toFixed(1)} points vs the previous {d.period.days} days ({d.prev_score})</p>}
            <p className="mt-3 text-xs text-slate-500">Weighted from six parts. Parts without data in this period are left out and the rest re-weighted.</p>
          </section>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="pillars">
            {d.pillars.map((p) => (
              <section key={p.key} className="panel p-4">
                <div className="flex items-center justify-between gap-2"><p className="font-heading font-semibold">{p.label}</p><span className="text-xs text-slate-400">weight {p.weight}</span></div>
                <div className="mt-2 flex items-center gap-3"><span className="font-heading text-2xl font-semibold tabular">{p.score == null ? "–" : Math.round(p.score)}</span><span className="h-2 flex-1 bg-slate-100"><span className="block h-2" style={{ width: `${p.score || 0}%`, background: TONE[p.status || "none"][0] }} /></span></div>
                <ul className="mt-3 space-y-1.5">{p.metrics.map((m) => <li key={m.key} className="flex items-start justify-between gap-2 text-xs"><span className="text-slate-600" title={m.raw || ""}>{m.label}</span><span className="shrink-0 font-semibold tabular" style={{ color: TONE[m.status || "none"][0] }}>{fmtVal(m)}</span></li>)}</ul>
              </section>
            ))}
          </div>
        </div>
        {d.fix_first.length > 0 && <Section title="Fix these first" testid="fix-first">
          <ol className="divide-y divide-slate-100">{d.fix_first.map((m, i) => <li key={m.key} className="grid gap-1 py-3 sm:grid-cols-[2rem_1fr_auto] sm:items-center"><span className="font-heading text-lg font-semibold text-slate-300">{i + 1}</span><span><span className="font-medium text-slate-900">{m.label}: {fmtVal(m)}</span> <span className="text-xs text-slate-500">(aim: {m.target}{m.raw ? ` · ${m.raw}` : ""})</span><span className="block text-sm text-slate-600">{m.fix}</span></span>{m.link && <Link to={m.link} className="btn-line btn-sm justify-self-start">Open</Link>}</li>)}</ol>
        </Section>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6" data-testid="ceo-kpis">
          <Kpi title="Company revenue" value={inr(k.revenue, true)} hint={<Delta now={k.revenue} before={k.prev.revenue} />} />
          <Kpi title="Expenses" value={inr(k.expenses, true)} hint={<Delta now={k.expenses} before={k.prev.expenses} invert />} />
          <Kpi title="Operating profit" value={inr(k.net, true)} hint={k.revenue ? `${((k.net / k.revenue) * 100).toFixed(0)}% margin` : ""} />
          <Kpi title="Cash collected" value={inr(k.collected, true)} hint={`${inr(k.receivables, true)} owed · ${inr(k.overdue, true)} overdue`} />
          <Kpi title="Rent collected for owners" value={inr(k.rent_collected, true)} hint={`${inr(k.arrears, true)} in arrears`} />
          <Kpi title="Commission earned" value={inr(k.commission, true)} hint={<Delta now={k.commission} before={k.prev.commission} />} />
          <Kpi title="New enquiries" value={n0(k.new_leads)} hint={<Delta now={k.new_leads} before={k.prev.new_leads} />} />
          <Kpi title="Deals won" value={n0(k.deals_won)} hint={`${k.deals_new} new deals · ${k.visits_done} site visits`} />
          <Kpi title="Managed rentals occupied" value={k.managed ? `${k.occupied} of ${k.managed}` : "–"} hint={`${k.active_leases} active leases`} />
          <Kpi title="Short-stay bookings" value={inr(k.ss_gross, true)} hint={`${k.ss_nights} of ${k.ss_available} nights · ADR ${inr(k.ss_adr, true)}`} />
          <Kpi title="Live listings" value={n0(k.published)} hint={`${k.stale} older than 90 days`} />
          {d.investors && <Kpi title="Investor capital" value={inr(d.investors.capital, true)} hint={`${d.investors.projects} projects · ${inr(d.investors.payouts, true)} paid out in period`} />}
        </div>
        <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
          <Section title="Six-month trend">
            <ResponsiveContainer width="100%" height={260}><ComposedChart data={d.trend}><CartesianGrid stroke="#f1f5f9" /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => inr(v, true)} width={70} /><Tooltip formatter={(v, n) => (n === "New enquiries" ? v : inr(v))} /><Legend /><Bar dataKey="revenue" name="Revenue" fill="#1e293b" /><Bar dataKey="expenses" name="Expenses" fill="#cbd5e1" /><Line dataKey="net" name="Profit" stroke="#16a34a" strokeWidth={2} dot={false} /></ComposedChart></ResponsiveContainer>
          </Section>
          <Section title="Revenue by service"><ul className="space-y-2">{Object.entries(k.by_service || {}).sort((a, b) => b[1] - a[1]).map(([s, v]) => <li key={s}><div className="flex justify-between text-sm"><span className="capitalize">{s === "shortstay" ? "Short stays" : s}</span><span className="tabular">{inr(v, true)}</span></div><div className="mt-1 h-1.5 bg-slate-100"><div className="h-1.5 bg-slate-900" style={{ width: `${k.revenue ? Math.max(0, (v / k.revenue) * 100) : 0}%` }} /></div></li>)}</ul><p className="mt-3 flex gap-1 text-xs text-slate-400"><Info size={12} className="mt-0.5 shrink-0" />Company income only. Sale values, rent held for owners, deposits and guests' booking money are not counted.</p></Section>
        </div>
        {d.league?.length > 1 && <Section title="Branches compared" testid="branch-league">
          <DataTable rows={d.league} columns={[{ key: "branch", label: "Branch", render: (r) => <button className="underline" onClick={() => setF({ ...f, branch: r.branch_id, city: "", locality: "" })}>{r.branch}</button> }, { key: "score", label: "Score", render: (r) => <b>{r.score == null ? "–" : Math.round(r.score)} {r.grade}</b> }, { key: "revenue", label: "Revenue", render: (r) => inr(r.revenue, true) }, { key: "net", label: "Profit", render: (r) => <span className={r.net < 0 ? "text-red-700" : ""}>{inr(r.net, true)}</span> }, { key: "new_leads", label: "New enquiries" }, { key: "deals_won", label: "Deals won" }, { key: "conversion", label: "Conversion", render: (r) => (r.conversion == null ? "–" : `${r.conversion}%`) }, { key: "occupancy", label: "Occupancy", render: (r) => (r.occupancy == null ? "–" : `${r.occupancy}%`) }, { key: "arrears", label: "Arrears", render: (r) => inr(r.arrears, true) }, { key: "listings", label: "Listings" }]} />
        </Section>}
      </>}
    </div>
  );
}
