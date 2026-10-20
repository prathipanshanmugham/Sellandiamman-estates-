import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FileDown, FileText, Copy, Upload, Trash2, Plus, RotateCcw, Stamp } from "lucide-react";
import { api, errMsg, fmtDate, fmtDateTime, inr, label, openFile, useDebounced } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useDialog } from "../../lib/dialogs";
import { PageHeader, DataTable, Badge, Section, act } from "../../components/erp/kit";

const SOURCE_LABEL = { lease: "Lease", property: "Property", deal: "Deal", owner: "Owner", investment: "Investment", investor: "Investor" };

export function AgreementsList() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState(null);
  const dq = useDebounced(q);
  useEffect(() => { api.get("/agreements", { params: { q: dq || undefined, status: status || undefined } }).then((r) => setRows(r.data)).catch(() => setRows([])); }, [dq, status]);
  return (
    <div>
      <PageHeader title="Agreements" sub="Rental, lease, sale, brokerage, management and co-investment agreements laid out for Indian stamp paper, ready as Word or PDF. Drafts for your lawyer to review before signing.">
        {can("agreements", "w") && <button className="btn-dark btn-sm" onClick={() => nav("/erp/agreements/new")} data-testid="new-agreement-btn">New agreement</button>}
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-2"><input className="inp sm:!w-64" placeholder="Search title, code, party" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search agreements" />{[["", "All"], ["draft", "Drafts"], ["final", "Final"], ["signed", "Signed"]].map(([k, l]) => <button key={k} className={`chip ${status === k ? "chip-on" : ""}`} onClick={() => setStatus(k)}>{l}</button>)}</div>
      <DataTable testid="agreements-table" loading={!rows} rows={rows || []} onRow={(r) => nav(`/erp/agreements/${r.id}`)} columns={[{ key: "code", label: "Code" }, { key: "title", label: "Agreement" }, { key: "template", label: "Kind", render: (a) => label(a.template) }, { key: "stamp", label: "Stamp duty (est.)", render: (a) => (a.stamp_estimate?.duty ? inr(a.stamp_estimate.duty, true) : "-") }, { key: "status", label: "Status", render: (a) => <Badge v={a.status} tone={a.status === "signed" ? "green" : a.status === "final" ? "blue" : "grey"} /> }, { key: "created_by_name", label: "By" }, { key: "updated_at", label: "Updated", render: (a) => fmtDate(a.updated_at || a.created_at) }]} empty="No agreements yet." />
    </div>
  );
}

// The agreement as it will print: a blank band at the top of page 1 for the stamp paper / e-stamp certificate.
export function Paper({ blocks, stampTop = 100, stampLine }) {
  return (
    <div className="agreement-paper mx-auto max-w-[44rem] bg-white px-6 py-8 text-[13px] leading-6 text-slate-900 shadow-sm sm:px-12" data-testid="agreement-preview">
      {stampTop > 0 && <div className="mb-6 flex items-center justify-center border-2 border-dashed border-slate-300 text-[11px] uppercase tracking-widest text-slate-400" style={{ height: Math.min(260, stampTop * 1.6) }}><Stamp size={14} className="mr-2" />Stamp paper / e-stamp area · {stampTop} mm</div>}
      {stampLine && <p className="mb-4 text-xs italic text-slate-600">{stampLine}</p>}
      {blocks.map((b, i) => {
        if (b.t === "title") return <h2 key={i} className="text-center font-serif text-lg font-bold tracking-wide underline underline-offset-4">{b.text}</h2>;
        if (b.t === "subtitle") return <p key={i} className="mb-4 text-center text-xs uppercase tracking-wider text-slate-500">{b.text}</p>;
        if (b.t === "center") return <p key={i} className="my-2 text-center font-semibold">{b.text}</p>;
        if (b.t === "heading") return <p key={i} className="mt-6 font-semibold underline">{b.text}</p>;
        if (b.t === "clause") return <p key={i} className="my-2 text-justify"><span className="mr-1 font-semibold">{b.n}.</span>{b.text}</p>;
        if (b.t === "signatures") return <div key={i} className="mt-10 grid gap-8 sm:grid-cols-2">{b.parties.map((p) => <div key={p.label}><div className="h-12" /><p className="border-t border-slate-400 pt-1 text-xs font-semibold">{p.label}</p><p className="text-xs">{p.name}</p>{p.sub && <p className="text-xs text-slate-500">{p.sub}</p>}</div>)}</div>;
        if (b.t === "witnesses") return <div key={i} className="mt-10"><p className="text-xs font-semibold">WITNESSES:</p><div className="mt-2 grid gap-8 text-xs sm:grid-cols-2"><p>1. Name & address: ____________________</p><p>2. Name & address: ____________________</p></div></div>;
        return <p key={i} className="my-2 text-justify">{b.text}</p>;
      })}
    </div>
  );
}

function FieldInput({ f, value, onChange, disabled }) {
  const id = `ag-${f.key}`;
  const common = { id, className: "inp", disabled, value: value ?? "", "data-testid": `ag-field-${f.key}` };
  let el;
  if (f.type === "textarea") el = <textarea rows={2} {...common} onChange={(e) => onChange(e.target.value)} />;
  else if (f.type === "select") el = <select {...common} onChange={(e) => onChange(e.target.value)}>{!f.required && <option value="">—</option>}{(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}</select>;
  else if (f.type === "date") el = <input type="date" {...common} onChange={(e) => onChange(e.target.value)} />;
  else if (f.type === "number" || f.type === "money") el = <input type="number" step="any" {...common} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
  else if (f.type === "checkbox") return <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />{f.label}</label>;
  else el = <input {...common} onChange={(e) => onChange(e.target.value)} />;
  return <div className={f.type === "textarea" ? "sm:col-span-2" : ""}><label className="lbl" htmlFor={id}>{f.label}{f.required && " *"}</label>{el}{f.type === "money" && value ? <p className="mt-0.5 text-[11px] text-slate-400">{inr(value)}</p> : null}</div>;
}

function SourcePicker({ tpl, onPick }) {
  const [type, setType] = useState(tpl.sources[0] || "");
  const [rows, setRows] = useState([]);
  const [inv, setInv] = useState("");
  const [holdings, setHoldings] = useState([]);
  useEffect(() => {
    setRows([]); setInv(""); setHoldings([]);
    const path = { lease: "/leases", property: "/properties", deal: "/deals", owner: "/owners", investment: "/investors", investor: "/investors" }[type];
    if (path) api.get(path).then((r) => setRows(Array.isArray(r.data) ? r.data : r.data.items || [])).catch(() => setRows([]));
  }, [type]);
  useEffect(() => { if (type === "investment" && inv) api.get(`/investors/${inv}`).then((r) => setHoldings(r.data.holdings)).catch(() => setHoldings([])); }, [type, inv]);
  const text = (r) => ({ lease: `${r.code} · ${r.tenant_name} · ${r.property_title}`, property: `${r.code} · ${r.title}`, deal: `${r.code} · ${r.title}`, owner: `${r.code} · ${r.name}`, investor: `${r.code} · ${r.name}`, investment: `${r.code} · ${r.name}` }[type]);
  if (!tpl.sources.length) return null;
  return (
    <div className="flex flex-wrap items-end gap-2 bg-slate-50 p-3" data-testid="agreement-source">
      <div><label className="lbl" htmlFor="src-type">Fill in from</label><select id="src-type" className="inp" value={type} onChange={(e) => setType(e.target.value)}>{tpl.sources.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s] || label(s)}</option>)}</select></div>
      {type === "investment" ? <>
        <div className="min-w-[12rem] flex-1"><label className="lbl" htmlFor="src-inv">Investor</label><select id="src-inv" className="inp" value={inv} onChange={(e) => setInv(e.target.value)}><option value="">Choose…</option>{rows.map((r) => <option key={r.id} value={r.id}>{text(r)}</option>)}</select></div>
        <div className="min-w-[12rem] flex-1"><label className="lbl" htmlFor="src-h">Investment</label><select id="src-h" className="inp" defaultValue="" onChange={(e) => e.target.value && onPick("investment", e.target.value)} data-testid="agreement-source-record"><option value="">Choose…</option>{holdings.map((h) => <option key={h.id} value={h.id}>{h.project_name} · {inr(h.amount, true)} · {fmtDate(h.date)}</option>)}</select></div>
      </> : <div className="min-w-[14rem] flex-1"><label className="lbl" htmlFor="src-rec">Record</label><select id="src-rec" className="inp" defaultValue="" onChange={(e) => e.target.value && onPick(type, e.target.value)} data-testid="agreement-source-record"><option value="">Choose…</option>{rows.map((r) => <option key={r.id} value={r.id}>{text(r)}</option>)}</select></div>}
      <p className="w-full text-xs text-slate-500">Names, addresses, rent, dates and property details are copied in. Check and complete the rest.</p>
    </div>
  );
}

export function AgreementEditor() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const dialog = useDialog();
  const [templates, setTemplates] = useState(null);
  const [a, setA] = useState(isNew ? null : undefined);
  const [v, setV] = useState({ template: sp.get("template") || "", title: "", data: {}, clauses: null, extra_clauses: [], paper: "legal", stamp_top_mm: 100, stamp_value: null, estamp_no: "", estamp_date: "", entity_type: null, entity_id: null });
  const [pv, setPv] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dirty, setDirty] = useState(false);
  const signedRef = useRef(null);
  useEffect(() => { api.get("/agreements/templates").then((r) => setTemplates(r.data)).catch(() => setTemplates([])); }, []);
  const load = () => api.get(`/agreements/${id}`).then((r) => { setA(r.data); setV({ ...v, ...r.data, estamp_no: r.data.estamp_no || "", estamp_date: r.data.estamp_date || "" }); setDirty(false); }).catch(() => setA(false));
  useEffect(() => { if (!isNew) load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const tpl = templates?.find((t) => t.key === v.template);
  const final = a && a.status !== "draft";
  const w = can("agreements", "w") && !final;
  // defaults from the template
  useEffect(() => {
    if (!tpl || !isNew) return;
    const d = {};
    tpl.fields.forEach((f) => { if (f.default !== undefined && f.default !== "") d[f.key] = f.default; });
    api.get("/agreements/prefill", { params: { template: tpl.key } }).then((r) => setV((s) => ({ ...s, data: { ...d, ...r.data.data, ...s.data } }))).catch(() => setV((s) => ({ ...s, data: { ...d, ...s.data } })));
  }, [tpl?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const body = useMemo(() => ({ template: v.template, title: v.title || null, entity_type: v.entity_type, entity_id: v.entity_id, data: v.data, clauses: v.clauses, extra_clauses: v.extra_clauses, paper: v.paper, stamp_top_mm: Number(v.stamp_top_mm) || 0, stamp_value: v.stamp_value || null, estamp_no: v.estamp_no || null, estamp_date: v.estamp_date || null }), [v]);
  const dBody = useDebounced(JSON.stringify(body), 500);
  useEffect(() => { if (!v.template) return; api.post("/agreements/preview", JSON.parse(dBody)).then((r) => { setPv(r.data); setErr(""); }).catch((e) => setErr(errMsg(e))); }, [dBody]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch) => { setV((s) => ({ ...s, ...patch })); setDirty(true); };
  const setData = (k, val) => set({ data: { ...v.data, [k]: val } });
  const pick = async (etype, eid) => {
    const r = await act(() => api.get("/agreements/prefill", { params: { template: v.template, entity_type: etype, entity_id: eid } }), "Details copied in");
    if (r) set({ data: { ...v.data, ...r.data.data }, entity_type: etype, entity_id: eid, clauses: null });
  };
  const missing = tpl ? tpl.fields.filter((f) => f.required && (v.data[f.key] == null || v.data[f.key] === "")) : [];
  const save = async () => {
    setBusy(true);
    try {
      if (isNew) { const r = await api.post("/agreements", body); act(async () => r, "Draft saved"); nav(`/erp/agreements/${r.data.id}`, { replace: true }); }
      else { await api.patch(`/agreements/${id}`, body); act(async () => true, "Saved"); load(); }
      setDirty(false);
    } catch (e) { act(() => Promise.reject(e)); } finally { setBusy(false); }
  };
  const download = (kind) => openFile(`/agreements/${id}/${kind}`, { name: `${a.code} ${a.title}`, contentType: kind === "pdf" ? "application/pdf" : "application/msword" });
  const finalise = async () => {
    if (dirty) return dialog.notice({ title: "Save first", body: "Save your changes before finalising." });
    if (missing.length && !(await dialog.confirm({ title: "Some details are blank", body: `Blank: ${missing.map((f) => f.label).join(", ")}. They print as lines to fill by hand.`, okLabel: "Finalise anyway" }))) return;
    const share = tpl && ["rental_residential", "lease_commercial", "leave_licence", "brokerage_authorisation", "property_management", "shortstay_management", "sale_agreement", "token_receipt", "investor_coinvestment"].includes(tpl.key) && await dialog.confirm({ title: "Share the final copy?", body: tpl.key === "investor_coinvestment" ? "Show the PDF in the investor's dashboard?" : "Show the PDF in the property owner's portal?", okLabel: "Yes, share", }).then((x) => x);
    if (await act(() => api.post(`/agreements/${id}/finalise`, { share: !!share }), "Finalised. The PDF is saved with the record's documents.")) load();
  };
  const uploadSigned = async (e) => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; const fd = new FormData(); fd.append("file", f); if (await act(() => api.post(`/agreements/${id}/signed`, fd), "Signed copy saved")) load(); };
  if (a === false) return <p>Agreement not found.</p>;
  if (a === undefined || !templates) return <p className="text-sm text-slate-500">Loading…</p>;
  if (isNew && !tpl) {
    const groups = [...new Set(templates.map((t) => t.group))];
    return (
      <div data-testid="agreement-templates">
        <PageHeader title="New agreement" sub={<><Link to="/erp/agreements" className="hover:underline">Agreements</Link> · choose a template</>} />
        {groups.map((g) => <section key={g} className="mb-8"><h2 className="mb-3 font-heading text-base font-semibold">{g}</h2><div className="grid gap-px border border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-3">{templates.filter((t) => t.group === g).map((t) => <button key={t.key} className="bg-white p-5 text-left hover:bg-slate-50" onClick={() => set({ template: t.key })} data-testid={`template-${t.key}`}><p className="font-heading font-semibold">{t.title}</p>{t.subtitle && <p className="text-xs text-slate-500">{t.subtitle}</p>}<p className="mt-2 text-sm text-slate-600">{t.summary}</p><p className="mt-2 text-xs text-slate-400">Between: {t.parties.join(" and ")}</p></button>)}</div></section>)}
      </div>
    );
  }
  const groups = tpl ? [...new Set(tpl.fields.map((f) => f.group || "Details"))] : [];
  const clauses = v.clauses ?? pv?.default_clauses ?? [];
  return (
    <div className="space-y-6" data-testid="agreement-editor">
      <PageHeader title={a ? a.title : `New ${tpl?.title.toLowerCase()}`} sub={<><Link to="/erp/agreements" className="hover:underline">Agreements</Link>{a ? ` · ${a.code} · version ${a.version}` : ""}{a?.finalised_at ? ` · final ${fmtDateTime(a.finalised_at)}` : ""}</>}>
        {a && <Badge v={a.status} tone={a.status === "signed" ? "green" : a.status === "final" ? "blue" : "grey"} />}
        {w && <button className="btn-dark btn-sm" disabled={busy || (!dirty && !isNew)} onClick={save} data-testid="agreement-save-btn">{isNew ? "Save draft" : dirty ? "Save" : "Saved"}</button>}
        {a && <><button className="btn-line btn-sm" onClick={() => download("docx")} disabled={dirty} data-testid="agreement-docx-btn"><FileText size={13} />Word</button><button className="btn-line btn-sm" onClick={() => download("pdf")} disabled={dirty} data-testid="agreement-pdf-btn"><FileDown size={13} />PDF</button></>}
        {a && a.status === "draft" && can("agreements", "w") && <button className="btn-line btn-sm" onClick={finalise} data-testid="agreement-finalise-btn">Finalise</button>}
        {a && a.status === "final" && can("agreements", "w") && <><button className="btn-line btn-sm" onClick={() => signedRef.current?.click()} data-testid="agreement-signed-btn"><Upload size={13} />Upload signed copy</button><input ref={signedRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={uploadSigned} /></>}
        {a && can("agreements", "w") && <button className="btn-line btn-sm" onClick={async () => { const r = await act(() => api.post(`/agreements/${id}/copy`), "Copy made"); if (r) nav(`/erp/agreements/${r.data.id}`); }}><Copy size={13} />Copy</button>}
        {a && a.status === "draft" && can("agreements", "w") && <button className="btn-line btn-sm" onClick={async () => { if (await dialog.confirm({ title: "Delete this draft?", okLabel: "Delete", tone: "danger" }) && await act(() => api.delete(`/agreements/${id}`), "Deleted")) nav("/erp/agreements"); }} aria-label="Delete draft"><Trash2 size={13} /></button>}
      </PageHeader>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-6">
          {w && tpl && <SourcePicker tpl={tpl} onPick={pick} />}
          <Section title="Title & stamp paper">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="lbl" htmlFor="ag-title">Title (for our list)</label><input id="ag-title" className="inp" value={v.title || ""} disabled={!w} onChange={(e) => set({ title: e.target.value })} placeholder={tpl?.title} /></div>
              <div><label className="lbl" htmlFor="ag-paper">Paper</label><select id="ag-paper" className="inp" value={v.paper} disabled={!w} onChange={(e) => set({ paper: e.target.value })}><option value="legal">Legal (8.5 × 14 in, usual for stamp paper)</option><option value="a4">A4 (e-stamp printout)</option></select></div>
              <div><label className="lbl" htmlFor="ag-top">Blank space at top of page 1 (mm)</label><input id="ag-top" type="number" min="0" max="180" className="inp" value={v.stamp_top_mm} disabled={!w} onChange={(e) => set({ stamp_top_mm: e.target.value })} /><p className="mt-1 text-[11px] text-slate-400">About 100 mm leaves the stamp paper's printed part clear; 0 for an e-stamp certificate attached in front.</p></div>
              <div><label className="lbl" htmlFor="ag-sv">Stamp value paid (₹)</label><input id="ag-sv" type="number" className="inp" value={v.stamp_value ?? ""} disabled={!w} onChange={(e) => set({ stamp_value: e.target.value === "" ? null : Number(e.target.value) })} /></div>
              <div><label className="lbl" htmlFor="ag-en">e-Stamp certificate no.</label><input id="ag-en" className="inp" value={v.estamp_no} disabled={!w} onChange={(e) => set({ estamp_no: e.target.value })} placeholder="IN-TN…" /></div>
              <div><label className="lbl" htmlFor="ag-ed">e-Stamp date</label><input id="ag-ed" type="date" className="inp" value={v.estamp_date} disabled={!w} onChange={(e) => set({ estamp_date: e.target.value })} /></div>
            </div>
            {pv?.stamp && <div className="mt-4 bg-amber-50 p-3 text-sm text-amber-950" data-testid="stamp-estimate"><p className="font-semibold">Stamp duty estimate: {pv.stamp.duty ? inr(pv.stamp.duty) : "-"}{pv.stamp.basis ? ` (on ${inr(pv.stamp.basis, true)})` : ""}</p><p className="text-xs">{pv.stamp.rate}. {pv.stamp.note}</p></div>}
          </Section>
          {groups.map((g) => <Section key={g} title={g}><div className="grid gap-4 sm:grid-cols-2">{tpl.fields.filter((f) => (f.group || "Details") === g).map((f) => <FieldInput key={f.key} f={f} value={v.data[f.key]} onChange={(x) => setData(f.key, x)} disabled={!w} />)}</div></Section>)}
          <Section title={`Clauses (${clauses.length + v.extra_clauses.length})`} actions={w && v.clauses && <button className="btn-line btn-sm" onClick={() => set({ clauses: null })} title="Go back to the template's clauses with the current details"><RotateCcw size={13} />Template clauses</button>}>
            <ol className="space-y-3">{clauses.map((c, i) => <li key={i} className="flex gap-2"><span className="mt-2 w-5 shrink-0 text-right text-xs font-semibold text-slate-400">{i + 1}.</span><textarea rows={3} className="inp text-[13px]" value={c} disabled={!w} onChange={(e) => set({ clauses: clauses.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={`Clause ${i + 1}`} />{w && <button className="self-start p-2 text-slate-400 hover:text-red-700" onClick={() => set({ clauses: clauses.filter((_, j) => j !== i) })} aria-label={`Remove clause ${i + 1}`}><Trash2 size={14} /></button>}</li>)}
              {v.extra_clauses.map((c, i) => <li key={`x${i}`} className="flex gap-2"><span className="mt-2 w-5 shrink-0 text-right text-xs font-semibold text-slate-400">+</span><textarea rows={3} className="inp text-[13px]" value={c} disabled={!w} onChange={(e) => set({ extra_clauses: v.extra_clauses.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={`Extra clause ${i + 1}`} />{w && <button className="self-start p-2 text-slate-400 hover:text-red-700" onClick={() => set({ extra_clauses: v.extra_clauses.filter((_, j) => j !== i) })} aria-label="Remove clause"><Trash2 size={14} /></button>}</li>)}</ol>
            {w && <button className="btn-line btn-sm mt-3" onClick={() => set({ extra_clauses: [...v.extra_clauses, ""] })} data-testid="add-clause-btn"><Plus size={13} />Add a clause</button>}
            <p className="mt-3 text-xs text-slate-400">Editing a clause fixes its wording; details you change above no longer flow into it. Use “Template clauses” to start again.</p>
          </Section>
          {a?.documents?.length > 0 && <Section title="Saved files">{a.documents.map((d) => <p key={d.id} className="flex justify-between gap-2 border-b border-slate-100 py-1.5 text-sm"><span>{d.original_name}</span><span className="text-xs text-slate-500">{label(d.doc_type)} · {fmtDate(d.created_at)}</span></p>)}</Section>}
        </div>
        <div className="xl:sticky xl:top-20 xl:self-start">
          <div className="mb-2 flex items-center justify-between"><p className="lbl !mb-0">Preview</p>{err && <p className="text-xs text-red-700">{err}</p>}</div>
          <div className="max-h-[80vh] overflow-y-auto bg-slate-200 p-3 sm:p-5">{pv ? <Paper blocks={pv.blocks} stampTop={Number(v.stamp_top_mm) || 0} stampLine={pv.stamp_line} /> : <p className="p-6 text-sm text-slate-500">Preparing preview…</p>}</div>
          <p className="mt-2 text-xs text-slate-400">The Word and PDF files repeat “initials of the parties” and “page x of y” on every page and keep the left margin wide for binding. Have the draft checked by your lawyer before it is signed.</p>
        </div>
      </div>
    </div>
  );
}
