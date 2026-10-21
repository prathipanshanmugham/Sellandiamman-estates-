// Hosted-preview controls: a small "Preview" switcher to sign in as any role, and an in-page viewer for PDFs and
// CSV exports (the preview frame cannot download files or open new tabs).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, X, FileText } from "lucide-react";
import { api, asset, errMsg } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog";
import { META, db, state } from "./core";
import { csvReport } from "./routes_admin";
import { customerData } from "./routes_customers";
import { agreementFor, agreementBlocks, stampLine } from "./routes_agreements";
import { Paper } from "../pages/erp/Agreements";

const D = "@demo.sellandiamman.test";
const ROLES = [["admin", "Super admin", "Everything, incl. users and settings"], ["director", "Director (CEO)", "All branches, CEO dashboard, approvals"], ["perundurai.manager", "Head office manager", "Perundurai branch only"], ["branch.manager", "Branch manager", "Erode branch: leads, listings, leases, stays"], ["namakkal.manager", "Namakkal manager", "Namakkal branch only"], ["sales.agent", "Sales agent", "Own leads, deals and listings"], ["property.manager", "Property manager", "Leases, rent, maintenance"], ["accountant", "Accountant", "Invoices, ledgers, payouts"], ["marketing", "Marketing", "Listings, Insights, campaigns"], ["shortstay.ops", "Short-stay ops", "Bookings and cleaning"], ["auditor", "Auditor", "Read-only, reports, audit log"], ["owner", "Owner portal", "Meena Krishnan, a property owner"], ["investor", "Investor portal", "Suresh Palanisamy, a co-investor"]];

function sampleFor(path) {
  const kinds = [[/^\/investors?\/.*statement/, "investor-statement-"], [/^\/agreements\//, "agreement-"], [/^\/ceo\/report/, "ceo-report"], [/^\/team\/org/, "org-chart"], [/^\/invoices\//, "invoice-"], [/^\/payments\//, "receipt-"], [/^\/deals\//, "deal-"], [/rent-receipts|rent-payments/, "rent-"], [/statement/, "statement-"], [/brochure/, "brochure-"]];
  const k = kinds.find(([re]) => re.test(path));
  if (!k) return null;
  const hit = Object.entries(META.pdfs).find(([, files]) => files[0].startsWith(k[1]));
  return hit ? hit[1] : null;
}

const me = () => db.users.find((u) => u.id === state.userId);
function resolve(path, meta) {
  if (/\.csv(\?|$)/.test(path) || meta.csv) return { kind: "csv", data: csvReport(path) };
  const cj = /^\/customers\/([^/]+)\/data\.json$/.exec(path);
  if (cj) { try { return { kind: "json", text: JSON.stringify(customerData(me(), cj[1]), null, 2) }; } catch (e) { return { kind: "note", text: e.detail || "Not available." }; } }
  const ag = /^\/agreements\/([^/]+)\/(pdf|docx)$/.exec(path);
  if (ag) {
    let a;
    try { a = agreementFor(me(), ag[1]); } catch (e) { return { kind: "note", text: e.detail || "Not available." }; }
    const word = ag[2] === "docx" ? "The Word (.docx) file has the same layout and can be edited in Word or Google Docs." : null;
    if (META.pdfs[path] && (a.updated_at || "") <= META.exported_at) return { kind: "pdf", files: META.pdfs[path], note: word };
    return { kind: "agreement", blocks: agreementBlocks(a), stampTop: a.stamp_top_mm ?? 100, stampLine: stampLine(a),
      note: `On the live site this downloads as a ${ag[2] === "pdf" ? "PDF" : "Word (.docx)"} file in stamp-paper layout, with the parties' initials and page numbers on every page.` };
  }
  const doc = /^\/files\/demo-([\w-]+)/.exec(path);
  if (doc) {
    const d = db.documents.find((x) => x.id === doc[1]);
    if (META.pdfs[`doc:${doc[1]}`]) return { kind: "pdf", files: META.pdfs[`doc:${doc[1]}`] };
    if (d?.demo_url && d.content_type?.startsWith("image/")) return { kind: "image", src: d.demo_url };
    const fa = d?.agreement_id && db.agreements.find((x) => x.id === d.agreement_id);
    if (fa) return { kind: "agreement", blocks: agreementBlocks(fa), stampTop: fa.stamp_top_mm ?? 100, stampLine: stampLine(fa), note: "The finalised PDF saved with this record. On the live site it opens as the PDF file." };
    return { kind: "note", text: "This file was added in the preview. On the live server it opens through a 5-minute private link." };
  }
  if (META.pdfs[path]) return { kind: "pdf", files: META.pdfs[path] };
  const bare = path.split("?")[0];
  if (bare !== path && META.pdfs[bare]) return { kind: "pdf", files: META.pdfs[bare], note: "Recorded with the default dates and filters. The live server builds the PDF for exactly what you chose." };
  const s = sampleFor(path);
  if (s) return { kind: "pdf", files: s, note: "This record was created in the preview. The live server builds its own PDF; this is a recorded example of the same document." };
  return { kind: "note", text: "This file is produced by the live server." };
}

function Viewer() {
  const [v, setV] = useState(null);
  useEffect(() => {
    const on = (e) => setV({ ...e.detail, ...resolve(e.detail.path, e.detail.meta) });
    window.addEventListener("demo-open-file", on);
    return () => window.removeEventListener("demo-open-file", on);
  }, []);
  return (
    <Dialog open={!!v} onOpenChange={(o) => !o && setV(null)}>
      <DialogContent className="max-h-[92vh] max-w-[min(56rem,calc(100vw-1.5rem))] overflow-y-auto rounded-sm p-4 sm:p-6" data-testid="demo-file-viewer">
        <DialogHeader><DialogTitle className="flex items-center gap-2 font-heading"><FileText size={18} />{v?.meta?.name || (v?.kind === "csv" ? "Export" : "Document")}</DialogTitle>
          <DialogDescription className="text-xs text-slate-500">{v?.kind === "csv" ? "Spreadsheet export (CSV). On the live site this downloads as a file." : v?.kind === "pdf" ? "PDF made by the server. On the live site this opens as a file you can download, print or send." : v?.kind === "json" ? "Everything held about this person (data access request). On the live site this downloads as a JSON file." : v?.kind === "agreement" ? "Agreement in stamp-paper layout" : "Preview"}</DialogDescription></DialogHeader>
        {v?.note && <p className="bg-amber-50 p-2 text-xs text-amber-900">{v.note}</p>}
        {v?.kind === "pdf" && <div className="space-y-3 bg-slate-100 p-2 sm:p-4">{v.files.map((f) => <img key={f} src={asset(`/pdf/${f}`)} alt="Document page" className="mx-auto w-full max-w-3xl border border-slate-200 bg-white shadow-sm" />)}</div>}
        {v?.kind === "image" && <img src={v.src} alt="" className="mx-auto max-h-[70vh] w-auto" />}
        {v?.kind === "agreement" && <div className="bg-slate-200 p-2 sm:p-4"><Paper blocks={v.blocks} stampTop={Number(v.stampTop) || 0} stampLine={v.stampLine} /></div>}
        {v?.kind === "json" && <pre className="max-h-[65vh] overflow-auto bg-slate-50 p-3 text-[11px] leading-4">{v.text}</pre>}
        {v?.kind === "note" && <p className="text-sm text-slate-600">{v.text}</p>}
        {v?.kind === "csv" && v.data && <div className="max-h-[65vh] overflow-auto border border-slate-200"><table className="tbl w-full"><thead><tr>{v.data.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{v.data.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="whitespace-nowrap">{String(c)}</td>)}</tr>)}</tbody></table></div>}
        {v?.kind === "csv" && v.data && <p className="text-xs text-slate-500">{v.data.rows.length} rows</p>}
      </DialogContent>
    </Dialog>
  );
}

function Switcher() {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const { user, refresh, logout } = useAuth();
  const nav = useNavigate();
  const as = async (key) => {
    setErr("");
    try {
      if (user) await api.post("/auth/logout").catch(() => {});
      const { data } = await api.post("/auth/login", { email: `${key}${D}`, password: "Demo@12345" });
      if (data.mfa_required) { setOpen(false); nav("/erp/login"); return; }
      await refresh(); setOpen(false); nav({ owner: "/owner", investor: "/investor" }[key] || "/erp");
    } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <div className="fixed bottom-[max(12px,env(safe-area-inset-bottom,0px))] left-[max(12px,env(safe-area-inset-left,0px))] z-[60] flex flex-col items-start lg:left-auto lg:right-[max(16px,env(safe-area-inset-right,0px))] lg:items-end">
      {open && (
        <div className="mb-2 w-[min(20rem,calc(100vw-24px))] border border-slate-300 bg-white p-4 shadow-xl" data-testid="demo-switcher">
          <div className="flex items-start justify-between gap-2"><p className="font-heading text-sm font-semibold">Preview with sample data</p><button onClick={() => setOpen(false)} aria-label="Close" className="text-slate-500"><X size={16} /></button></div>
          <p className="mt-1 text-xs text-slate-600">Every screen works. Changes you make last until you reload the page. Sign in as:</p>
          <div className="mt-3 grid max-h-[48vh] gap-1 overflow-y-auto">{ROLES.map(([k, l, d]) => <button key={k} onClick={() => as(k)} className="flex flex-col items-start border border-slate-200 px-3 py-2 text-left hover:border-slate-500 hover:bg-slate-50" data-testid={`demo-as-${k}`}><span className="text-sm font-medium text-slate-900">{l}</span><span className="text-[11px] text-slate-500">{d}</span></button>)}</div>
          {err && <p className="mt-2 text-xs text-red-700">{err}</p>}
          <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3 text-xs">
            <button className="underline" onClick={() => { setOpen(false); nav("/"); }}>Website</button>
            {user && <button className="underline" onClick={async () => { await logout(); setOpen(false); nav("/"); }}>Sign out</button>}
            <span className="text-slate-400">Password for all: Demo@12345</span>
          </div>
        </div>
      )}
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-lg hover:bg-slate-700" aria-expanded={open} data-testid="demo-switcher-btn"><Eye size={14} />{user ? `Preview · ${user.role_label}` : "Preview · sign in as…"}</button>
    </div>
  );
}

export default function DemoUI() {
  return <><Switcher /><Viewer /></>;
}
