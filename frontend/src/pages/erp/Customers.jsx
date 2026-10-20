import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Phone, MessageCircle, Mail, Upload, Download, Users2 } from "lucide-react";
import { api, fmtDate, fmtDateTime, inr, label, opts, openFile, useDebounced, telLink, waLink, cachedGet } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useDialog } from "../../lib/dialogs";
import { PageHeader, DataTable, Badge, FormDialog, Section, Facts, Modal, act } from "../../components/erp/kit";

export const CTYPES = ["buyer", "seller", "tenant", "landlord", "owner", "guest", "investor", "business"];
const LANGS = ["english", "tamil", "hindi", "malayalam", "telugu", "kannada", "other"];

const custFields = (users, branches, scoped) => [
  { name: "name", label: "Name", required: true }, { name: "phone", label: "Mobile", required: true },
  { name: "alt_phone", label: "Second mobile" }, { name: "email", label: "Email", type: "email" },
  { name: "kind", label: "Individual or business", type: "select", required: true, options: opts(["individual", "business"]) },
  { name: "organization", label: "Company / organisation" },
  { name: "types_text", label: "Customer types", hint: `Comma separated: ${CTYPES.join(", ")}`, full: true },
  { name: "tags_text", label: "Tags (comma separated)", hint: "For example: nri, vip, corporate, referral", full: true },
  { name: "city", label: "Town" }, { name: "locality", label: "Locality" }, { name: "address", label: "Address", type: "textarea", full: true },
  { name: "language", label: "Language", type: "select", options: opts(LANGS) },
  { name: "preferred_contact", label: "Preferred contact", type: "select", options: opts(["phone", "whatsapp", "email"]) },
  { name: "gstin", label: "GSTIN" },
  ...(scoped ? [] : [{ name: "rm_id", label: "Relationship manager", type: "select", options: users.map((u) => ({ value: u.id, label: u.name })) }, { name: "branch_id", label: "Branch", type: "select", options: branches.map((b) => ({ value: b.id, label: b.name })) }]),
  { name: "notes", label: "Notes", type: "textarea", full: true },
];
const splitList = (t) => String(t || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const toBody = ({ types_text, tags_text, ...v }) => ({ ...v, types: splitList(types_text).filter((t) => CTYPES.includes(t)), tags: splitList(tags_text) });

export function Customers() {
  const nav = useNavigate();
  const { can, user } = useAuth();
  const dialog = useDialog();
  const [f, setF] = useState({ q: "", type: "", tag: "", city: "", consent: "", kyc: "", inactive_days: "", sort: "recent" });
  const [page, setPage] = useState(1);
  const [d, setD] = useState(null);
  const [open, setOpen] = useState("");
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const q = useDebounced(f.q, 300);
  const params = useMemo(() => Object.fromEntries(Object.entries({ ...f, q, page, limit: 50 }).filter(([, v]) => v !== "" && v != null)), [f, q, page]);
  const load = () => api.get("/customers", { params }).then((r) => setD(r.data)).catch(() => setD({ items: [], total: 0, tags: [], type_counts: {} }));
  useEffect(() => { load(); }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get("/users/lite").then((r) => setUsers(r.data)).catch(() => {}); cachedGet("/branches").then(setBranches).catch(() => {}); }, []);
  const set = (k) => (e) => { setPage(1); setF({ ...f, [k]: e.target.value }); };
  const qs = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && !["sort", "inactive_days"].includes(k))).toString();
  const importCsv = async (e) => {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    const r = await act(() => api.post("/customers/import", fd));
    if (r) { dialog.notice({ title: "Import finished", body: `${r.data.created} added, ${r.data.updated} updated.${r.data.errors.length ? `\n\nNot imported:\n${r.data.errors.join("\n")}` : ""}` }); load(); }
  };
  const pages = d ? Math.ceil(d.total / 50) : 0;
  return (
    <div>
      <PageHeader title="Customers" sub="One record per person or business, linked to their enquiries, deals, leases, stays and investments (matched by mobile number).">
        {can("customers", "w") && <button className="btn-line btn-sm" onClick={() => setOpen("dups")} data-testid="customer-dups-btn"><Users2 size={13} />Possible duplicates</button>}
        {can("customers", "e") && can("customers", "w") && <label className="btn-line btn-sm cursor-pointer" data-testid="customer-import-btn"><Upload size={13} />Import CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={importCsv} /></label>}
        {can("customers", "e") && <button className="btn-line btn-sm" onClick={() => openFile(`/customers/export.csv${qs ? `?${qs}` : ""}`, { name: "Customers", csv: true })} data-testid="customer-export-btn"><Download size={13} />Export CSV</button>}
        {can("customers", "w") && <button className="btn-dark btn-sm" onClick={() => setOpen("new")} data-testid="new-customer-btn">New customer</button>}
      </PageHeader>
      <div className="mb-3 flex flex-wrap gap-2" data-testid="customer-type-chips">
        <button className={`chip ${!f.type ? "chip-on" : ""}`} onClick={() => { setPage(1); setF({ ...f, type: "" }); }}>All</button>
        {CTYPES.map((t) => <button key={t} className={`chip ${f.type === t ? "chip-on" : ""}`} onClick={() => { setPage(1); setF({ ...f, type: f.type === t ? "" : t }); }}>{label(t)} <span className={f.type === t ? "text-slate-300" : "text-slate-400"}>{d?.type_counts?.[t] ?? ""}</span></button>)}
      </div>
      <div className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
        <input className="inp lg:col-span-2" placeholder="Search name, mobile, email, code" value={f.q} onChange={set("q")} data-testid="customer-search" aria-label="Search customers" />
        <select className="inp" value={f.tag} onChange={set("tag")} aria-label="Tag"><option value="">Any tag</option>{(d?.tags || []).map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <input className="inp" placeholder="Town" value={f.city} onChange={set("city")} aria-label="Town" />
        <select className="inp" value={f.consent} onChange={set("consent")} aria-label="Consent" data-testid="customer-consent-filter"><option value="">Any consent</option><option value="marketing">Agreed to marketing</option><option value="whatsapp">Agreed to WhatsApp</option><option value="none">No marketing consent</option></select>
        <select className="inp" value={f.kyc} onChange={set("kyc")} aria-label="KYC"><option value="">Any KYC</option>{["not_started", "pending", "verified", "rejected"].map((k) => <option key={k} value={k}>{label(k)}</option>)}</select>
        <select className="inp" value={f.inactive_days} onChange={set("inactive_days")} aria-label="Activity"><option value="">Any activity</option><option value="90">Quiet 90+ days</option><option value="180">Quiet 6+ months</option><option value="365">Quiet 1+ year</option></select>
      </div>
      <DataTable testid="customers-table" loading={!d} rows={d?.items || []} onRow={(r) => nav(`/erp/customers/${r.id}`)} columns={[
        { key: "code", label: "Code" },
        { key: "name", label: "Name", render: (c) => <><span className="font-medium text-slate-900">{c.name}</span>{c.organization && <span className="block text-xs text-slate-500">{c.organization}</span>}{c.anonymised && <span className="block text-xs text-red-700">Personal data removed</span>}</> },
        { key: "phone", label: "Mobile" },
        { key: "types", label: "Type", render: (c) => <span className="flex flex-wrap gap-1">{(c.types || []).map((t) => <Badge key={t} v={t} tone="grey" />)}</span> },
        { key: "city", label: "Town", render: (c) => c.city || "-" },
        { key: "tags", label: "Tags", render: (c) => (c.tags || []).join(", ") || "-" },
        { key: "consent", label: "Marketing", render: (c) => (c.consent?.marketing ? "Yes" : "No") },
        { key: "last_activity_at", label: "Last activity", render: (c) => fmtDate(c.last_activity_at) },
      ]} empty="No customers match." />
      {pages > 1 && <nav className="mt-4 flex flex-wrap items-center gap-2 text-sm" aria-label="Pages"><button className="btn-line btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span className="text-slate-500">Page {page} of {pages} · {d.total} customers</span><button className="btn-line btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></nav>}
      <FormDialog open={open === "new"} onClose={() => setOpen("")} title="New customer" wide fields={[...custFields(users, branches, user.role === "sales_agent"), { name: "marketing_consent", label: "The customer agreed to receive offers and updates", type: "checkbox" }]} initial={{ kind: "individual", language: "english", preferred_contact: "phone" }}
        onSubmit={async (v) => {
          try { const r = await api.post("/customers", toBody(v)); nav(`/erp/customers/${r.data.id}`); }
          catch (e) { if (e.response?.status === 409 && await dialog.confirm({ title: "Mobile number already used", body: `${e.response.data.detail}. Open that record instead, or add a separate customer?`, okLabel: "Add separately" })) { const r = await api.post("/customers", { ...toBody(v), force: true }); nav(`/erp/customers/${r.data.id}`); } else if (e.response?.status !== 409) throw e; }
        }} />
      <Duplicates open={open === "dups"} onClose={() => { setOpen(""); load(); }} canMerge={can("customers", "a")} />
    </div>
  );
}

function Duplicates({ open, onClose, canMerge }) {
  const dialog = useDialog();
  const [rows, setRows] = useState(null);
  const load = () => api.get("/customers/duplicates").then((r) => setRows(r.data)).catch(() => setRows([]));
  useEffect(() => { if (open) load(); }, [open]);
  const merge = async (keep, drop) => {
    if (!(await dialog.confirm({ title: `Merge into ${keep.name}?`, body: `${drop.code} ${drop.name} will be merged into ${keep.code}. Its enquiries, leases, stays and notes move across, and the old record is kept only for the audit trail.`, okLabel: "Merge" }))) return;
    if (await act(() => api.post(`/customers/${drop.id}/merge`, { into_id: keep.id }), "Merged")) load();
  };
  const card = (c) => <div className="min-w-0"><p className="font-medium">{c.name} <span className="text-xs text-slate-500">{c.code}</span></p><p className="text-xs text-slate-500">{c.phone}{c.email ? ` · ${c.email}` : ""}{c.city ? ` · ${c.city}` : ""}</p></div>;
  return (
    <Modal open={open} onClose={onClose} title="Possible duplicate customers" wide>
      {!rows ? <p className="text-sm text-slate-500">Checking…</p> : !rows.length ? <p className="text-sm text-slate-500">No likely duplicates found.</p> :
        <div className="divide-y divide-slate-100" data-testid="duplicates-list">{rows.map((p) => <div key={`${p.a.id}-${p.b.id}`} className="grid items-center gap-3 py-3 sm:grid-cols-[1fr_1fr_auto]">{card(p.a)}{card(p.b)}<div className="flex flex-wrap items-center gap-1"><span className="mr-1 text-xs text-amber-800">{p.reason}</span>{canMerge && <><button className="btn-line btn-sm" onClick={() => merge(p.a, p.b)}>Keep left</button><button className="btn-line btn-sm" onClick={() => merge(p.b, p.a)}>Keep right</button></>}</div></div>)}</div>}
      {!canMerge && <p className="mt-3 text-xs text-slate-500">A director or administrator merges records.</p>}
    </Modal>
  );
}

const KIND_ICON = { note: "Note", consent: "Consent", call: "Call", whatsapp: "WhatsApp", email: "Email", site_visit: "Visit", deal: "Deal", lease: "Lease", rent: "Rent", stay: "Stay", owner: "Owner", investment: "Investment", created: "Enquiry", stage_change: "Stage" };

export function CustomerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, user } = useAuth();
  const dialog = useDialog();
  const [c, setC] = useState(null);
  const [dlg, setDlg] = useState("");
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const load = () => api.get(`/customers/${id}`).then((r) => setC(r.data)).catch(() => setC(false));
  useEffect(() => { load(); api.get("/users/lite").then((r) => setUsers(r.data)).catch(() => {}); cachedGet("/branches").then(setBranches).catch(() => {}); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (c === false) return <p data-testid="customer-not-found">Customer not found or not in your branches.</p>;
  if (!c) return <p className="text-sm text-slate-500">Loading…</p>;
  const w = can("customers", "w") && !c.anonymised;
  const wa = waLink(c.phone, `Hello ${c.name}, this is Sellandiamman Estates.`);
  const note = async () => { const t = await dialog.ask({ title: "Add a note", label: "Note", type: "textarea" }); if (t && await act(() => api.post(`/customers/${id}/notes`, { text: t }), "Note added")) load(); };
  const anonymise = async () => {
    const reason = await dialog.ask({ title: "Remove this person's personal data?", body: "Use this when the customer asks to be forgotten. Name, phone, email and address are replaced on every linked enquiry. Financial records (invoices, leases, ledgers) keep amounts for the law but not contact details. This cannot be undone.", label: "Reason / request reference", okLabel: "Remove personal data", tone: "danger" });
    if (reason && await act(() => api.post(`/customers/${id}/anonymise`, { confirm: true, reason }), "Personal data removed")) load();
  };
  return (
    <div className="space-y-6" data-testid="customer-detail">
      <PageHeader title={c.name} sub={<><Link to="/erp/customers" className="hover:underline">Customers</Link> · {c.code}{c.organization ? ` · ${c.organization}` : ""}{c.merged_into ? " · merged into another record" : ""}</>}>
        {(c.types || []).map((t) => <Badge key={t} v={t} tone="grey" />)}
        {c.phone && !c.anonymised && <a className="btn-line btn-sm" href={telLink(c.phone)}><Phone size={13} />Call</a>}
        {wa && !c.anonymised && <a className="btn-line btn-sm" href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle size={13} />WhatsApp</a>}
        {c.email && !c.anonymised && <a className="btn-line btn-sm" href={`mailto:${c.email}`}><Mail size={13} />Email</a>}
        {w && <button className="btn-line btn-sm" onClick={() => setDlg("edit")} data-testid="edit-customer-btn">Edit</button>}
        {w && <button className="btn-line btn-sm" onClick={note} data-testid="customer-note-btn">Add note</button>}
        {can("customers", "e") && <button className="btn-line btn-sm" onClick={() => openFile(`/customers/${id}/data.json`, { name: `${c.code} personal data` })}>Data request (JSON)</button>}
        {can("customers", "a") && !c.anonymised && <button className="btn-line btn-sm" onClick={anonymise} data-testid="anonymise-btn">Forget this person</button>}
      </PageHeader>
      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6">
          <Section title="Details"><Facts items={[["Mobile", c.phone], ["Second mobile", c.alt_phone], ["Email", c.email], ["Kind", label(c.kind)], ["Town", [c.locality, c.city].filter(Boolean).join(", ") || "-"], ["Address", c.address], ["Language", label(c.language)], ["Prefers", label(c.preferred_contact)], ["Source", label(c.source)], ["Branch", branches.find((b) => b.id === c.branch_id)?.name], ["Relationship manager", c.rm_name], ["GSTIN", c.gstin], ["Tags", (c.tags || []).join(", ") || "-"], ["Added", fmtDate(c.created_at)], ["Last activity", fmtDateTime(c.last_activity_at)]]} />{c.notes && <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-600">{c.notes}</p>}</Section>
          <Section title="Consent & KYC" testid="customer-consent" actions={w && <><button className="btn-line btn-sm" onClick={() => setDlg("consent")} data-testid="consent-btn">Record consent</button><button className="btn-line btn-sm" onClick={() => setDlg("kyc")} data-testid="kyc-btn">KYC</button></>}>
            <Facts items={[["Marketing messages", c.consent?.marketing ? "Agreed" : "Not agreed"], ["WhatsApp updates", c.consent?.whatsapp ? "Agreed" : "Not agreed"], ["Recorded", c.consent?.recorded_at ? `${fmtDate(c.consent.recorded_at)}${c.consent.method ? ` (${c.consent.method})` : ""}` : "-"], ["KYC", <Badge v={c.kyc?.status || "not_started"} tone={c.kyc?.status === "verified" ? "green" : c.kyc?.status === "rejected" ? "red" : "amber"} />], ["ID", c.kyc?.id_type ? `${label(c.kyc.id_type)} ••••${c.kyc.id_last4 || ""}` : "-"], ["KYC documents", c.kyc_documents ? `${c.kyc_documents} on file` : "None"]]} />
            <p className="mt-3 text-xs text-slate-400">Only the ID type and its last 4 characters are kept here. Upload the copy as a KYC document; it opens only for managers.</p>
          </Section>
          <Section title="Linked records">
            <ul className="space-y-1.5 text-sm">
              {c.leads?.map((l) => <li key={l.id}><Link className="underline" to={`/erp/leads/${l.id}`}>{l.code}</Link> · enquiry to {label(l.interest)} · <Badge v={l.stage} /></li>)}
              {c.owner && <li><Link className="underline" to="/erp/owners">Owner {c.owner.code}</Link></li>}
              {c.investor && <li><Link className="underline" to={`/erp/investors/${c.investor.id}`}>Investor {c.investor.code}</Link></li>}
              {c.leases?.map((l) => <li key={l.id}>Lease {l.code} · {l.property_title} · {inr(l.rent, true)}/month · <Badge v={l.status} /></li>)}
              {c.bookings?.map((b) => <li key={b.id}>Stay {b.code} · {b.property_title} · {fmtDate(b.check_in)} ({b.nights} nights) · <Badge v={b.status} /></li>)}
              {!c.leads?.length && !c.owner && !c.investor && !c.leases?.length && !c.bookings?.length && <li className="text-slate-400">Nothing linked yet.</li>}
            </ul>
          </Section>
        </div>
        <Section title={`Timeline (${c.timeline.length})`} testid="customer-timeline">
          {!c.timeline.length ? <p className="text-sm text-slate-400">No activity yet.</p> :
            <ol className="relative space-y-4 border-l border-slate-200 pl-5">{c.timeline.map((e, i) => <li key={i} className="relative"><span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-slate-400" /><p className="text-[11px] uppercase tracking-wider text-slate-400">{KIND_ICON[e.kind] || label(e.kind)} · {fmtDateTime(e.at)}{e.by ? ` · ${e.by}` : ""}</p><p className="text-sm text-slate-800">{e.link ? <Link to={e.link} className="hover:underline">{e.title}</Link> : e.title}{e.amount ? <span className="text-slate-500"> · {inr(e.amount)}</span> : null}</p></li>)}</ol>}
        </Section>
      </div>
      <FormDialog open={dlg === "edit"} onClose={() => setDlg("")} title={`Edit ${c.name}`} wide fields={custFields(users, branches, user.role === "sales_agent").filter((f) => f.name !== "phone")} initial={{ ...c, types_text: (c.types || []).join(", "), tags_text: (c.tags || []).join(", ") }} onSubmit={async (v) => { await api.patch(`/customers/${id}`, toBody(v)); load(); }} />
      <FormDialog open={dlg === "consent"} onClose={() => setDlg("")} title="Record consent" initial={{ marketing: !!c.consent?.marketing, whatsapp: !!c.consent?.whatsapp, method: "phone call" }} fields={[{ name: "marketing", label: "Agrees to receive offers and property updates", type: "checkbox" }, { name: "whatsapp", label: "Agrees to WhatsApp messages", type: "checkbox" }, { name: "method", label: "How they told us", type: "select", required: true, options: opts(["phone call", "whatsapp", "email", "in person", "website form", "signed form"]) }]} onSubmit={async (v) => { await api.patch(`/customers/${id}/consent`, v); load(); }} />
      <FormDialog open={dlg === "kyc"} onClose={() => setDlg("")} title="KYC status" initial={{ status: c.kyc?.status || "pending", id_type: c.kyc?.id_type, id_last4: c.kyc?.id_last4 }} fields={[{ name: "status", label: "Status", type: "select", required: true, options: opts(["not_started", "pending", "verified", "rejected"]), hint: can("customers", "a") ? undefined : "A manager marks KYC as verified" }, { name: "id_type", label: "ID type", type: "select", options: opts(["aadhaar", "pan", "passport", "voter_id", "driving_licence", "gst", "other"]) }, { name: "id_last4", label: "Last 4 characters of the ID", hint: "Never type the full number" }, { name: "note", label: "Note", full: true }]} onSubmit={async (v) => { await api.patch(`/customers/${id}/kyc`, v); load(); }} />
      {c.merged_into && <p className="text-sm"><button className="underline" onClick={() => nav(`/erp/customers/${c.merged_into}`)}>Open the record it was merged into</button></p>}
    </div>
  );
}
