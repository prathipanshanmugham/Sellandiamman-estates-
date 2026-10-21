import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Phone, MessageCircle, Mail, FileText } from "lucide-react";
import { api, fmtDate, fmtDateTime, inr, label, openFile, imgSrc, todayIST, telLink, waLink } from "../../lib/api";
import { PortalShell } from "../../components/portal/PortalShell";
import { RequestsList, RequestDetail } from "../../components/portal/Requests";
import { Markdown } from "../../lib/markdown";
import { Badge, DataTable, Kpi, Section, Facts, act } from "../../components/erp/kit";
import { ValueChart } from "../../components/ValueChart";

const TABS = [["/investor", "Overview"], ["/investor/payouts", "Payouts"], ["/investor/updates", "Updates"], ["/investor/documents", "Documents & statements"], ["/investor/requests", "Requests"]];
const pct = (v) => (v == null ? "-" : `${Number(v).toFixed(1)}%`);
const fyStart = () => { const t = todayIST(); const y = Number(t.slice(0, 4)) - (t.slice(5, 7) < "04" ? 1 : 0); return `${y}-04-01`; };

export function InvestorLayout() {
  return <PortalShell kind="investor" home="/investor" title="Investor dashboard" tabs={TABS}
    footer="Values between valuations are estimates based on the last valuation and are not a guaranteed sale price. Investments in property carry risk and are not deposits. Past returns do not promise future returns. Questions? Raise a request or contact your relationship manager." />;
}

export const InvestorRequests = () => <RequestsList base="/investor/requests" allowEntry={false} intro="Questions about a payout or statement, a document you need, or anything else about your investment." />;
export const InvestorRequest = () => <RequestDetail base="/investor/requests" />;

function Rm({ rm }) {
  if (!rm) return null;
  const wa = waLink(rm.whatsapp || rm.phone, "Hello, I have a question about my investment.");
  return (
    <Section title="Your relationship manager">
      <p className="font-medium">{rm.name}</p>
      <div className="mt-3 flex flex-wrap gap-2">{rm.phone && <a className="btn-line btn-sm" href={telLink(rm.phone)}><Phone size={13} />Call</a>}{wa && <a className="btn-line btn-sm" href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle size={13} />WhatsApp</a>}{rm.email && <a className="btn-line btn-sm" href={`mailto:${rm.email}`}><Mail size={13} />Email</a>}</div>
    </Section>
  );
}

export function InvestorOverview() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get("/investor/overview").then((r) => setD(r.data)).catch(() => setD(false)); }, []);
  if (d === false) return <p className="text-sm text-slate-500">Could not load your dashboard. Refresh to try again.</p>;
  if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  const t = d.totals;
  return (
    <div className="space-y-6">
      <div><p className="eyebrow">Investor {d.investor.code}</p><h1 className="mt-1 font-heading text-2xl font-semibold">Hello, {d.investor.name}</h1></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi title="Invested" value={inr(t.active_invested, true)} testid="inv-kpi-invested" />
        <Kpi title="Value now" value={inr(t.current_value, true)} testid="inv-kpi-value" />
        <Kpi title="Gain so far" value={inr(t.gain, true)} hint="Value + payouts − money in" />
        <Kpi title="Payouts received" value={inr(t.net_distributions, true)} hint={`after TDS of ${inr(t.tds, true)}`} testid="inv-kpi-payouts" />
        <Kpi title="This financial year" value={inr(t.ytd_distributions, true)} hint="Payouts before TDS" />
        <Kpi title="Your return (XIRR)" value={pct(t.xirr)} hint="A yearly rate, counting when money moved" testid="inv-kpi-xirr" />
      </div>
      <Section title="How your investment has grown"><ValueChart series={d.series} /></Section>
      <Section title={`Your holdings (${d.holdings.length})`}>
        <div className="grid gap-4 md:grid-cols-2">{d.holdings.map((h) => (
          <Link key={h.id} to={`/investor/holdings/${h.id}`} className="block border border-slate-200 bg-white hover:border-slate-400" data-testid={`holding-${h.code}`}>
            {h.project?.cover_image && <img src={imgSrc(h.project.cover_image)} alt="" className="aspect-[16/7] w-full object-cover" />}
            <div className="p-4">
              <p className="font-heading font-semibold">{h.project_name}</p>
              <p className="text-xs text-slate-500">{label(h.project?.kind)} · {[h.project?.locality, h.project?.city].filter(Boolean).join(", ")} · <Badge v={h.status} tone={h.status === "active" ? "green" : "grey"} /></p>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm"><div><dt className="text-[11px] uppercase text-slate-400">Invested</dt><dd>{inr(h.amount, true)}</dd></div><div><dt className="text-[11px] uppercase text-slate-400">Value</dt><dd>{inr(h.current_value, true)}</dd></div><div><dt className="text-[11px] uppercase text-slate-400">XIRR</dt><dd>{pct(h.xirr)}</dd></div></dl>
            </div>
          </Link>
        ))}</div>
      </Section>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Section title="Latest payouts" actions={<Link to="/investor/payouts" className="text-xs underline">All payouts</Link>}><DataTable rows={d.recent_payouts} columns={[{ key: "date", label: "Date", render: (x) => fmtDate(x.date) }, { key: "project_name", label: "Project" }, { key: "period", label: "Period" }, { key: "net", label: "Paid to you", render: (x) => inr(x.net) }]} empty="No payouts yet." /></Section>
        <div className="space-y-6">
          <Rm rm={d.rm} />
          <Section title="Project news" actions={<Link to="/investor/updates" className="text-xs underline">All updates</Link>}>{d.updates.length ? <ul className="space-y-3 text-sm">{d.updates.slice(0, 3).map((u) => <li key={u.id}><p className="font-medium">{u.title}</p><p className="text-xs text-slate-500">{u.project_name} · {fmtDate(u.at)}</p></li>)}</ul> : <p className="text-sm text-slate-400">No updates yet.</p>}</Section>
        </div>
      </div>
    </div>
  );
}

export function InvestorHolding() {
  const { id } = useParams();
  const [h, setH] = useState(null);
  useEffect(() => { api.get(`/investor/holdings/${id}`).then((r) => setH(r.data)).catch(() => setH(false)); }, [id]);
  if (h === false) return <p className="text-sm text-slate-500">Holding not found.</p>;
  if (!h) return <p className="text-sm text-slate-500">Loading…</p>;
  const p = h.project;
  return (
    <div className="space-y-6" data-testid="investor-holding">
      <div><Link to="/investor" className="text-xs text-slate-500 hover:underline">← Overview</Link><h1 className="mt-2 font-heading text-2xl font-semibold">{p.name}</h1><p className="text-sm text-slate-500">{label(p.kind)} · {[p.locality, p.city].filter(Boolean).join(", ")} · project status <Badge v={p.status} /></p></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5"><Kpi title="You invested" value={inr(h.amount, true)} hint={fmtDate(h.date)} /><Kpi title="Your share" value={`${h.share_pct}%`} /><Kpi title="Value now" value={inr(h.current_value, true)} /><Kpi title="Payouts (net)" value={inr(h.net_distributions, true)} /><Kpi title="XIRR" value={pct(h.xirr)} hint={p.target_irr_pct ? `target ${p.target_irr_pct}%` : ""} /></div>
      {p.description && <Section title="About the project"><p className="text-sm text-slate-700">{p.description}</p><Facts items={[["Started", fmtDate(p.start_date)], ["Expected holding", `${p.horizon_months} months`], ["Target return", p.target_irr_pct ? `${p.target_irr_pct}% a year` : "-"], ["Expected payout", p.expected_yield_pct ? `${p.expected_yield_pct}% a year` : "-"]]} /></Section>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Valuations">{p.valuations?.length ? <ul className="divide-y divide-slate-100 text-sm">{[...p.valuations].reverse().map((v, i) => <li key={i} className="flex justify-between gap-2 py-2"><span>{fmtDate(v.date)} · {label(v.method)}</span><b>{inr(v.value, true)}</b></li>)}</ul> : <p className="text-sm text-slate-400">Shown at cost until the first valuation.</p>}</Section>
        <Section title="Updates">{p.updates?.length ? <ul className="space-y-3 text-sm">{[...p.updates].reverse().map((u) => <li key={u.id}><p className="font-medium">{u.title}</p><p className="text-slate-600">{u.body}</p><p className="text-xs text-slate-400">{fmtDate(u.at)}</p></li>)}</ul> : <p className="text-sm text-slate-400">No updates yet.</p>}</Section>
      </div>
      <Section title="Payouts from this project"><DataTable rows={h.payouts} columns={[{ key: "date", label: "Date", render: (x) => fmtDate(x.date) }, { key: "kind", label: "Type", render: (x) => label(x.kind) }, { key: "period", label: "Period" }, { key: "gross", label: "Gross", render: (x) => inr(x.gross) }, { key: "tds", label: "TDS", render: (x) => inr(x.tds) }, { key: "net", label: "Paid", render: (x) => inr(x.net) }, { key: "reference", label: "Reference" }]} empty="No payouts yet." /></Section>
    </div>
  );
}

export function InvestorPayouts() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get("/investor/payouts").then((r) => setRows(r.data)).catch(() => setRows([])); }, []);
  const tot = (rows || []).reduce((a, x) => ({ gross: a.gross + x.gross, tds: a.tds + x.tds, net: a.net + x.net }), { gross: 0, tds: 0, net: 0 });
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold">Payouts</h1>
      <div className="grid grid-cols-3 gap-3"><Kpi title="Gross" value={inr(tot.gross, true)} /><Kpi title="TDS deducted" value={inr(tot.tds, true)} hint="Shown in your Form 26AS / AIS" /><Kpi title="Paid to you" value={inr(tot.net, true)} /></div>
      <DataTable testid="investor-payouts" loading={!rows} rows={rows || []} columns={[{ key: "date", label: "Date", render: (x) => fmtDate(x.date) }, { key: "project_name", label: "Project" }, { key: "kind", label: "Type", render: (x) => label(x.kind) }, { key: "period", label: "Period" }, { key: "gross", label: "Gross", render: (x) => inr(x.gross) }, { key: "tds", label: "TDS", render: (x) => inr(x.tds) }, { key: "net", label: "Paid", render: (x) => inr(x.net) }, { key: "reference", label: "Reference" }]} empty="No payouts yet." />
    </div>
  );
}

export function InvestorUpdates() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get("/investor/updates").then((r) => setRows(r.data)).catch(() => setRows([])); }, []);
  return (
    <div className="space-y-4">
      <h1 className="font-heading text-2xl font-semibold">Updates</h1>
      {!rows ? <p className="text-sm text-slate-500">Loading…</p> : !rows.length ? <p className="panel p-6 text-sm text-slate-500">No updates yet.</p> : rows.map((u) => <article key={u.id} className="panel p-5" data-testid="investor-update"><p className="text-xs uppercase tracking-wider text-slate-400">{u.project_name} · {fmtDateTime(u.at)}</p><h2 className="mt-1 font-heading text-lg font-semibold">{u.title}</h2><div className="mt-2"><Markdown text={u.body} className="prose-article !text-sm" /></div></article>)}
    </div>
  );
}

export function InvestorDocuments() {
  const [rows, setRows] = useState(null);
  const [r, setR] = useState({ frm: fyStart(), to: todayIST() });
  useEffect(() => { api.get("/investor/documents").then((x) => setRows(x.data)).catch(() => setRows([])); }, []);
  const open = async (d) => { const x = await act(() => api.post(`/investor/documents/${d.id}/link`)); if (x) openFile(x.data.url.replace(/^\/api/, ""), { name: d.original_name }); };
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold">Documents & statements</h1>
      <Section title="Statement">
        <div className="flex flex-wrap items-end gap-2"><div><label className="lbl" htmlFor="st-f">From</label><input id="st-f" type="date" className="inp" value={r.frm} onChange={(e) => setR({ ...r, frm: e.target.value })} /></div><div><label className="lbl" htmlFor="st-t">To</label><input id="st-t" type="date" className="inp" value={r.to} onChange={(e) => setR({ ...r, to: e.target.value })} /></div><button className="btn-dark btn-sm" onClick={() => openFile(`/investor/statement.pdf?frm=${r.frm}&to=${r.to}`, { name: "Investor statement" })} data-testid="investor-statement-btn"><FileText size={13} />Statement PDF</button></div>
        <p className="mt-2 text-xs text-slate-500">Money in, payouts, TDS and the value of each holding for the period. Useful for your tax return.</p>
      </Section>
      <Section title="Shared with you"><DataTable testid="investor-docs" loading={!rows} rows={rows || []} columns={[{ key: "original_name", label: "File" }, { key: "doc_type", label: "Type", render: (d) => label(d.doc_type) }, { key: "created_at", label: "Added", render: (d) => fmtDate(d.created_at) }, { key: "x", label: "", render: (d) => <button className="btn-line btn-sm" onClick={() => open(d)}>Open</button> }]} empty="No documents yet." /></Section>
    </div>
  );
}
