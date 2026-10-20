import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, fmtDate, fmtDateTime, inr, label, opts, openFile, todayIST, cachedGet } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useDialog } from "../../lib/dialogs";
import { PageHeader, DataTable, Badge, FormDialog, Section, Facts, Kpi, act } from "../../components/erp/kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { DocsPanel } from "./Documents";
import { ValueChart } from "../../components/ValueChart";

export const PROJECT_KINDS = ["rental_income", "commercial_lease", "short_stay", "land_bank", "development"];
const DIST_KINDS = ["rental_income", "profit_share", "interest", "capital_return"];
const pct = (v) => (v == null ? "-" : `${v.toFixed ? v.toFixed(1) : v}%`);

const investorFields = (users) => [
  { name: "name", label: "Name", required: true }, { name: "phone", label: "Mobile", required: true }, { name: "email", label: "Email", type: "email", hint: "Needed for the investor dashboard login" },
  { name: "kind", label: "Investor type", type: "select", required: true, options: [{ value: "individual", label: "Individual" }, { value: "huf", label: "HUF" }, { value: "company", label: "Company / LLP" }, { value: "nri", label: "NRI" }, { value: "trust", label: "Trust" }] },
  { name: "city", label: "Town / country" }, { name: "pan_last4", label: "PAN (last 4 only)" },
  { name: "rm_id", label: "Relationship manager", type: "select", options: users.map((u) => ({ value: u.id, label: u.name })) },
  { name: "notes", label: "Notes", type: "textarea", full: true },
];
const projectFields = (branches) => [
  { name: "name", label: "Project name", required: true, full: true },
  { name: "kind", label: "Type", type: "select", required: true, options: opts(PROJECT_KINDS) },
  { name: "status", label: "Status", type: "select", required: true, options: opts(["open", "funded", "operating", "exiting", "exited"]) },
  { name: "city", label: "Town", required: true }, { name: "locality", label: "Locality" },
  { name: "branch_id", label: "Branch", type: "select", options: branches.map((b) => ({ value: b.id, label: b.name })) },
  { name: "target_raise", label: "Target to raise (₹)", type: "number", required: true }, { name: "min_ticket", label: "Minimum per investor (₹)", type: "number" },
  { name: "target_irr_pct", label: "Target return (IRR %)", type: "number" }, { name: "expected_yield_pct", label: "Expected yearly payout (%)", type: "number" },
  { name: "start_date", label: "Start date", type: "date", required: true }, { name: "horizon_months", label: "Expected holding (months)", type: "number", required: true },
  { name: "cover_image", label: "Cover photo address", hint: "e.g. /images/shed.jpg or a website media link" },
  { name: "description", label: "About the project (shown to its investors)", type: "textarea", full: true },
];

export function InvestorsHome() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [inv, setInv] = useState(null);
  const [prj, setPrj] = useState(null);
  const [open, setOpen] = useState("");
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const load = () => { api.get("/investors").then((r) => setInv(r.data)).catch(() => setInv([])); api.get("/inv-projects").then((r) => setPrj(r.data)).catch(() => setPrj([])); };
  useEffect(() => { load(); api.get("/users/lite").then((r) => setUsers(r.data)).catch(() => {}); cachedGet("/branches").then(setBranches).catch(() => {}); }, []);
  const w = can("investors", "w");
  const t = (inv || []).reduce((a, i) => ({ invested: a.invested + i.totals.active_invested, value: a.value + i.totals.current_value, paid: a.paid + i.totals.distributions }), { invested: 0, value: 0, paid: 0 });
  return (
    <div>
      <PageHeader title="Investors" sub="Co-investors in our rental, land and short-stay projects: capital, payouts, valuations and their online dashboard. Investor money is kept in its own ledger, never as company income.">
        {w && <><button className="btn-line btn-sm" onClick={() => setOpen("project")} data-testid="new-project-btn">New project</button><button className="btn-dark btn-sm" onClick={() => setOpen("investor")} data-testid="new-investor-btn">New investor</button></>}
      </PageHeader>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4"><Kpi title="Capital invested (active)" value={inr(t.invested, true)} /><Kpi title="Current value" value={inr(t.value, true)} hint={t.invested ? `${(((t.value - t.invested) / t.invested) * 100).toFixed(1)}% above cost` : ""} /><Kpi title="Payouts to date" value={inr(t.paid, true)} /><Kpi title="Investors" value={(inv || []).length} hint={`${(prj || []).length} projects`} /></div>
      <Tabs defaultValue="investors"><TabsList className="rounded-sm"><TabsTrigger value="investors">Investors</TabsTrigger><TabsTrigger value="projects" data-testid="tab-projects">Projects</TabsTrigger></TabsList>
        <TabsContent value="investors" className="mt-4"><DataTable testid="investors-table" loading={!inv} rows={inv || []} onRow={(r) => nav(`/erp/investors/${r.id}`)} columns={[{ key: "code", label: "Code" }, { key: "name", label: "Investor" }, { key: "kind", label: "Type", render: (r) => label(r.kind) }, { key: "city", label: "Town" }, { key: "inv", label: "Invested", render: (r) => inr(r.totals.active_invested, true) }, { key: "val", label: "Value now", render: (r) => inr(r.totals.current_value, true) }, { key: "paid", label: "Payouts", render: (r) => inr(r.totals.distributions, true) }, { key: "xirr", label: "Return (XIRR)", render: (r) => pct(r.totals.xirr) }, { key: "kyc_status", label: "KYC", render: (r) => <Badge v={r.kyc_status} tone={r.kyc_status === "verified" ? "green" : "amber"} /> }]} empty="No investors yet." /></TabsContent>
        <TabsContent value="projects" className="mt-4"><DataTable testid="projects-table" loading={!prj} rows={prj || []} onRow={(r) => nav(`/erp/inv-projects/${r.id}`)} columns={[{ key: "code", label: "Code" }, { key: "name", label: "Project" }, { key: "kind", label: "Type", render: (r) => label(r.kind) }, { key: "city", label: "Town" }, { key: "status", label: "Status", render: (r) => <Badge v={r.status} /> }, { key: "raised", label: "Raised", render: (r) => <span className="block min-w-[8rem]"><span className="text-xs">{inr(r.raised, true)} of {inr(r.target_raise, true)}</span><span className="mt-1 block h-1.5 bg-slate-100"><span className="block h-1.5 bg-slate-900" style={{ width: `${Math.min(100, (r.raised / r.target_raise) * 100)}%` }} /></span></span> }, { key: "investors", label: "Investors" }, { key: "current_value", label: "Value", render: (r) => inr(r.current_value, true) }, { key: "distributed", label: "Paid out", render: (r) => inr(r.distributed, true) }, { key: "xirr", label: "XIRR", render: (r) => pct(r.xirr) }]} empty="No projects yet." /></TabsContent>
      </Tabs>
      <FormDialog open={open === "investor"} onClose={() => setOpen("")} title="New investor" fields={investorFields(users)} initial={{ kind: "individual" }} onSubmit={async (v) => { const r = await api.post("/investors", v); nav(`/erp/investors/${r.data.id}`); }} />
      <FormDialog open={open === "project"} onClose={() => setOpen("")} title="New investment project" fields={projectFields(branches)} initial={{ kind: "rental_income", status: "open", start_date: todayIST(), horizon_months: 36, min_ticket: 500000 }} onSubmit={async (v) => { const r = await api.post("/inv-projects", { ...v, min_ticket: v.min_ticket || 0 }); nav(`/erp/inv-projects/${r.data.id}`); }} />
    </div>
  );
}

function InvestmentForm({ open, onClose, investors, projects, initial, onDone }) {
  return <FormDialog open={open} onClose={onClose} title="Record money received" initial={{ date: todayIST(), method: "bank_transfer", ...initial }} fields={[{ name: "investor_id", label: "Investor", type: "select", required: true, options: investors.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` })) }, { name: "project_id", label: "Project", type: "select", required: true, options: projects.filter((p) => !["exiting", "exited"].includes(p.status)).map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })) }, { name: "amount", label: "Amount received (₹)", type: "number", required: true }, { name: "date", label: "Date received", type: "date", required: true }, { name: "method", label: "How", type: "select", required: true, options: opts(["bank_transfer", "cheque", "upi", "other"]) }, { name: "reference", label: "Bank / UTR reference", required: true }, { name: "notes", label: "Notes", full: true }]} onSubmit={async (v) => { await api.post("/investments", v); onDone(); }}>{() => <p className="text-xs text-slate-500">Recorded in the investor-funds ledger. Investors cannot be paid by card or cash through this system.</p>}</FormDialog>;
}

export function InvestorDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const dialog = useDialog();
  const [d, setD] = useState(null);
  const [dlg, setDlg] = useState("");
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const load = () => api.get(`/investors/${id}`).then((r) => setD(r.data)).catch(() => setD(false));
  useEffect(() => { load(); api.get("/inv-projects").then((r) => setProjects(r.data)).catch(() => {}); api.get("/users/lite").then((r) => setUsers(r.data)).catch(() => {}); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (d === false) return <p>Investor not found.</p>;
  if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  const t = d.totals;
  const w = can("investors", "w");
  const statement = async () => {
    const frm = await dialog.ask({ title: "Statement period", label: "From (YYYY-MM-DD)", initial: `${Number(todayIST().slice(0, 4)) - (todayIST().slice(5, 7) < "04" ? 1 : 0)}-04-01`, placeholder: "2026-04-01" });
    if (frm == null) return;
    openFile(`/investors/${id}/statement.pdf?frm=${frm}&to=${todayIST()}`, { name: `Statement ${d.code}` });
  };
  return (
    <div className="space-y-6" data-testid="investor-detail">
      <PageHeader title={d.name} sub={<><Link to="/erp/investors" className="hover:underline">Investors</Link> · {d.code} · {label(d.kind)}{d.city ? ` · ${d.city}` : ""}</>}>
        <button className="btn-line btn-sm" onClick={statement} data-testid="investor-statement-btn">Statement PDF</button>
        {w && <button className="btn-line btn-sm" onClick={() => setDlg("edit")}>Edit</button>}
        {can("users", "w") && !d.portal_users?.length && <button className="btn-line btn-sm" onClick={async () => { const email = await dialog.ask({ title: "Give this investor a dashboard login", body: "They get a link to set their password. They see only their own holdings, payouts, statements and project updates.", label: "Email", type: "email", initial: d.email || "" }); if (email) { const r = await act(() => api.post(`/investors/${id}/portal-invite`, { email }), "Login created"); if (r) { load(); if (r.data.activation_link) dialog.notice({ title: "Send this link to the investor", body: "Email is not set up on this server, so share this one-time link securely (for example on WhatsApp):", copy: r.data.activation_link }); } } }} data-testid="investor-invite-btn">Give dashboard login</button>}
        {w && <button className="btn-dark btn-sm" onClick={() => setDlg("money")} data-testid="record-investment-btn">Record money received</button>}
      </PageHeader>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"><Kpi title="Invested (active)" value={inr(t.active_invested, true)} /><Kpi title="Value now" value={inr(t.current_value, true)} /><Kpi title="Gain" value={inr(t.gain, true)} hint="Value + payouts − money in" /><Kpi title="Payouts (net of TDS)" value={inr(t.net_distributions, true)} hint={`TDS ${inr(t.tds, true)}`} /><Kpi title="This financial year" value={inr(t.ytd_distributions, true)} /><Kpi title="Return (XIRR)" value={pct(t.xirr)} hint="Yearly, after all payouts" /></div>
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Section title="Value over time"><ValueChart series={d.series} /></Section>
        <Section title="Details"><Facts items={[["Mobile", d.phone], ["Email", d.email], ["PAN", d.pan_last4 ? `••••••${d.pan_last4}` : "-"], ["KYC", <Badge v={d.kyc_status} tone={d.kyc_status === "verified" ? "green" : "amber"} />], ["Relationship manager", d.rm?.name], ["Dashboard login", d.portal_users?.length ? d.portal_users.map((u) => `${u.email}${u.last_login ? ` (last ${fmtDate(u.last_login)})` : u.active ? "" : " (invited)"}`).join(", ") : "None"], ["Customer record", d.customer_id ? <Link className="underline" to={`/erp/customers/${d.customer_id}`}>Open</Link> : "-"]]} />{d.notes && <p className="mt-3 text-sm text-slate-600">{d.notes}</p>}</Section>
      </div>
      <Section title="Holdings"><DataTable testid="holdings-table" rows={d.holdings} columns={[{ key: "project_name", label: "Project", render: (h) => <Link className="underline" to={`/erp/inv-projects/${h.project_id}`}>{h.project_name}</Link> }, { key: "date", label: "Invested on", render: (h) => fmtDate(h.date) }, { key: "amount", label: "Amount", render: (h) => inr(h.amount) }, { key: "share_pct", label: "Share", render: (h) => `${h.share_pct}%` }, { key: "current_value", label: "Value now", render: (h) => inr(h.current_value) }, { key: "distributions", label: "Payouts", render: (h) => inr(h.distributions) }, { key: "xirr", label: "XIRR", render: (h) => pct(h.xirr) }, { key: "status", label: "Status", render: (h) => <Badge v={h.status} tone={h.status === "active" ? "green" : "grey"} /> }]} empty="No investments yet." /></Section>
      <Section title="Payouts"><DataTable testid="payouts-table" rows={d.distributions} columns={[{ key: "date", label: "Date", render: (x) => fmtDate(x.date) }, { key: "project_name", label: "Project" }, { key: "kind", label: "Type", render: (x) => label(x.kind) }, { key: "period", label: "Period" }, { key: "gross", label: "Gross", render: (x) => inr(x.gross) }, { key: "tds", label: "TDS", render: (x) => inr(x.tds) }, { key: "net", label: "Paid", render: (x) => inr(x.net) }, { key: "reference", label: "Reference" }]} empty="No payouts yet." /></Section>
      <DocsPanel entityType="investor" entityId={id} title="Documents (agreements, KYC, statements)" defaultType="agreement" />
      <InvestmentForm open={dlg === "money"} onClose={() => setDlg("")} investors={[d]} projects={projects} initial={{ investor_id: id }} onDone={load} />
      <FormDialog open={dlg === "edit"} onClose={() => setDlg("")} title={`Edit ${d.name}`} fields={[...investorFields(users).filter((f) => f.name !== "phone"), { name: "kyc_status", label: "KYC", type: "select", options: opts(["pending", "verified", "rejected"]) }]} initial={d} onSubmit={async (v) => { await api.patch(`/investors/${id}`, v); load(); }} />
    </div>
  );
}

export function ProjectDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const dialog = useDialog();
  const [p, setP] = useState(null);
  const [dlg, setDlg] = useState("");
  const [investors, setInvestors] = useState([]);
  const [branches, setBranches] = useState([]);
  const load = () => api.get(`/inv-projects/${id}`).then((r) => setP(r.data)).catch(() => setP(false));
  useEffect(() => { load(); api.get("/investors").then((r) => setInvestors(r.data)).catch(() => {}); cachedGet("/branches").then(setBranches).catch(() => {}); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (p === false) return <p>Project not found.</p>;
  if (!p) return <p className="text-sm text-slate-500">Loading…</p>;
  const w = can("investors", "w");
  const t = p.totals;
  const vals = [...(p.valuations || [])].sort((a, b) => (a.date < b.date ? 1 : -1));
  const exit = async (m) => {
    const amount = await dialog.ask({ title: `Pay ${m.investor_name} out of ${p.name}?`, body: `Current value of this holding: ${inr(m.current_value)}. Record the amount actually paid.`, label: "Amount paid (₹)", type: "number", initial: Math.round(m.current_value) });
    if (amount == null) return;
    const reference = await dialog.ask({ title: "Payment reference", label: "Bank / UTR reference" });
    if (reference && await act(() => api.post(`/investments/${m.id}/exit`, { date: todayIST(), amount, reference }), "Exit recorded")) load();
  };
  return (
    <div className="space-y-6" data-testid="project-detail">
      <PageHeader title={p.name} sub={<><Link to="/erp/investors" className="hover:underline">Investors</Link> · {p.code} · {label(p.kind)} · {[p.locality, p.city].filter(Boolean).join(", ")}</>}>
        <Badge v={p.status} />
        {w && <button className="btn-line btn-sm" onClick={() => setDlg("edit")}>Edit</button>}
        {w && <button className="btn-line btn-sm" onClick={() => setDlg("value")} data-testid="add-valuation-btn">Add valuation</button>}
        {w && <button className="btn-line btn-sm" onClick={() => setDlg("update")} data-testid="post-update-btn">Post update</button>}
        {w && <button className="btn-line btn-sm" onClick={() => setDlg("money")}>Record money received</button>}
        {w && t.investors > 0 && <button className="btn-dark btn-sm" onClick={() => setDlg("pay")} data-testid="distribute-btn">Pay investors</button>}
      </PageHeader>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"><Kpi title="Raised" value={inr(t.raised, true)} hint={`target ${inr(p.target_raise, true)}`} /><Kpi title="Capital in" value={inr(t.capital, true)} /><Kpi title="Value now" value={inr(t.current_value, true)} hint={vals[0] ? `valued ${fmtDate(vals[0].date)}` : "at cost"} /><Kpi title="Paid out" value={inr(t.distributed, true)} /><Kpi title="Investors" value={t.investors} /><Kpi title="Return (XIRR)" value={pct(t.xirr)} hint={p.target_irr_pct ? `target ${p.target_irr_pct}%` : ""} /></div>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Section title="Investments"><DataTable testid="project-investments" rows={p.investments} columns={[{ key: "investor_name", label: "Investor", render: (m) => <Link className="underline" to={`/erp/investors/${m.investor_id}`}>{m.investor_name}</Link> }, { key: "date", label: "Date", render: (m) => fmtDate(m.date) }, { key: "amount", label: "Amount", render: (m) => inr(m.amount) }, { key: "share_pct", label: "Share", render: (m) => `${m.share_pct}%` }, { key: "current_value", label: "Value now", render: (m) => inr(m.current_value) }, { key: "xirr", label: "XIRR", render: (m) => pct(m.xirr) }, { key: "status", label: "", render: (m) => (m.status === "active" ? (can("investors", "a") && <button className="btn-line btn-sm" onClick={() => exit(m)}>Exit</button>) : <span className="text-xs text-slate-500">Exited {fmtDate(m.exit_date)} · {inr(m.exit_amount)}</span>) }]} empty="No money received yet." /></Section>
        <Section title="About"><Facts items={[["Minimum", inr(p.min_ticket)], ["Target return", p.target_irr_pct ? `${p.target_irr_pct}% a year` : "-"], ["Expected payout", p.expected_yield_pct ? `${p.expected_yield_pct}% a year` : "-"], ["Started", fmtDate(p.start_date)], ["Holding", `${p.horizon_months} months`], ["Branch", branches.find((b) => b.id === p.branch_id)?.name]]} />{p.description && <p className="mt-3 text-sm text-slate-600">{p.description}</p>}{p.properties?.length > 0 && <p className="mt-3 text-sm">Properties: {p.properties.map((x) => <Link key={x.id} to={`/erp/properties/${x.id}`} className="mr-2 underline">{x.code} {x.title}</Link>)}</p>}</Section>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Valuations">{vals.length ? <ul className="divide-y divide-slate-100 text-sm">{vals.map((v, i) => <li key={i} className="flex flex-wrap justify-between gap-2 py-2"><span>{fmtDate(v.date)} · {label(v.method)}{v.note ? ` · ${v.note}` : ""}</span><b>{inr(v.value)}</b></li>)}</ul> : <p className="text-sm text-slate-400">No valuations yet; holdings show at cost.</p>}</Section>
        <Section title="Updates for investors">{p.updates?.length ? <ul className="space-y-3 text-sm">{[...p.updates].reverse().map((u) => <li key={u.id}><p className="font-medium">{u.title}</p><p className="text-slate-600">{u.body}</p><p className="text-xs text-slate-400">{fmtDateTime(u.at)} · {u.by}</p></li>)}</ul> : <p className="text-sm text-slate-400">No updates yet.</p>}</Section>
      </div>
      <Section title="Payout history"><DataTable rows={p.distributions} columns={[{ key: "date", label: "Date", render: (x) => fmtDate(x.date) }, { key: "investor_name", label: "Investor" }, { key: "kind", label: "Type", render: (x) => label(x.kind) }, { key: "period", label: "Period" }, { key: "gross", label: "Gross", render: (x) => inr(x.gross) }, { key: "tds", label: "TDS", render: (x) => inr(x.tds) }, { key: "net", label: "Paid", render: (x) => inr(x.net) }]} empty="No payouts yet." /></Section>
      <DocsPanel entityType="inv_project" entityId={id} title="Project documents (tick to show to its investors)" />
      <InvestmentForm open={dlg === "money"} onClose={() => setDlg("")} investors={investors} projects={[p]} initial={{ project_id: id }} onDone={load} />
      <FormDialog open={dlg === "edit"} onClose={() => setDlg("")} title="Edit project" fields={projectFields(branches).filter((f) => f.name !== "start_date")} initial={p} onSubmit={async (v) => { await api.patch(`/inv-projects/${id}`, v); load(); }} />
      <FormDialog open={dlg === "value"} onClose={() => setDlg("")} title="Add a valuation" initial={{ date: todayIST(), method: "internal" }} fields={[{ name: "date", label: "Valued on", type: "date", required: true }, { name: "value", label: "Value of the whole project (₹)", type: "number", required: true }, { name: "method", label: "Basis", type: "select", required: true, options: [{ value: "internal", label: "Our estimate" }, { value: "valuer", label: "Registered valuer" }, { value: "sale_offer", label: "Offer received" }, { value: "guideline", label: "Guideline value" }] }, { name: "note", label: "Note", full: true }]} onSubmit={async (v) => { await api.post(`/inv-projects/${id}/valuations`, v); load(); }} />
      <FormDialog open={dlg === "update"} onClose={() => setDlg("")} title="Post an update to this project's investors" fields={[{ name: "title", label: "Headline", required: true, full: true }, { name: "body", label: "Update", type: "textarea", required: true, full: true }]} onSubmit={async (v) => { await api.post(`/inv-projects/${id}/updates`, v); load(); }}>{() => <p className="text-xs text-slate-500">Investors in this project see it on their dashboard and get a notification.</p>}</FormDialog>
      <FormDialog open={dlg === "pay"} onClose={() => setDlg("")} title="Pay investors" submitLabel="Record payouts" initial={{ date: todayIST(), kind: p.kind === "land_bank" ? "profit_share" : "rental_income", tds_pct: 10 }} fields={[{ name: "date", label: "Paid on", type: "date", required: true }, { name: "kind", label: "Type", type: "select", required: true, options: opts(DIST_KINDS) }, { name: "amount", label: "Total to pay out (₹, before TDS)", type: "number", required: true }, { name: "tds_pct", label: "TDS to deduct (%)", type: "number", required: true, hint: "As advised by your accountant for this kind of payout" }, { name: "period", label: "Period (e.g. Jul–Sep 2026)" }, { name: "reference", label: "Bank batch reference" }]}
        onSubmit={async (v) => { await api.post(`/inv-projects/${id}/distribute`, v); load(); }}>
        {(v) => { const active = p.investments.filter((m) => m.status === "active" && m.date <= (v.date || todayIST())); const cap = active.reduce((a, m) => a + m.amount, 0); return v.amount > 0 && cap > 0 ? <div className="bg-slate-50 p-3 text-xs" data-testid="payout-preview"><p className="mb-1 font-semibold">Split by money invested</p>{active.map((m) => { const part = (v.amount * m.amount) / cap; const tds = (part * (v.tds_pct || 0)) / 100; return <p key={m.id} className="flex justify-between gap-2"><span>{m.investor_name}</span><span className="tabular">{inr(part)} − TDS {inr(tds)} = <b>{inr(part - tds)}</b></span></p>; })}</div> : null; }}
      </FormDialog>
    </div>
  );
}
