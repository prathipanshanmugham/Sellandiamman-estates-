import { useState } from "react";
import { BACKEND, api, fmtDate, fmtDateTime, label } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { PageHeader, DataTable, Badge, Section, useList, act } from "../../components/erp/kit";

const download = async (d) => { const r = await act(() => api.post(`/documents/${d.id}/link`)); if (r) window.open(`${BACKEND}${r.data.url}`, "_blank", "noopener"); };
const DOC_TYPES = ["owner_authorization", "management_agreement", "brokerage_agreement", "lease_agreement", "inspection_report", "property_document", "kyc", "invoice", "vendor_quotation", "maintenance_record", "photo", "other"];

export function DocsPanel({ entityType, entityId, allowPublicApprove }) {
  const { can } = useAuth();
  const { rows, reload } = useList(can("documents") ? "/documents" : "/branches", can("documents") ? { entity_type: entityType, entity_id: entityId } : undefined);
  const [f, setF] = useState({ doc_type: "property_document", expiry_date: "" });
  if (!can("documents")) return null;
  const upload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append("entity_type", entityType); fd.append("entity_id", entityId); fd.append("doc_type", f.doc_type); if (f.expiry_date) fd.append("expiry_date", f.expiry_date); fd.append("file", file);
    await act(() => api.post("/documents", fd), "Uploaded"); reload(); e.target.value = "";
  };
  return (
    <Section title="Documents (private)" testid="docs-panel">
      {can("documents", "w") && <div className="mb-4 flex flex-wrap items-end gap-2">
        <div><label className="lbl">Type</label><select className="inp" value={f.doc_type} onChange={(e) => setF({ ...f, doc_type: e.target.value })} data-testid="doc-type-select">{DOC_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></div>
        <div><label className="lbl">Expiry</label><input type="date" className="inp" value={f.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })} data-testid="doc-expiry-input" /></div>
        <label className="btn-line btn-sm cursor-pointer">Upload file<input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx" onChange={upload} data-testid="doc-upload-input" /></label>
        <span className="text-xs text-slate-400">PDF, JPG, PNG, WebP, DOCX · max 10 MB</span>
      </div>}
      <DataTable testid="docs-table" rows={rows} columns={[{ key: "original_name", label: "File" }, { key: "doc_type", label: "Type", render: (d) => label(d.doc_type) }, { key: "version", label: "Ver." }, { key: "expiry_date", label: "Expiry", render: (d) => fmtDate(d.expiry_date) }, { key: "x", label: "", render: (d) => <span className="flex gap-1"><button className="btn-line btn-sm" onClick={() => download(d)} data-testid={`doc-download-${d.id}`}>Open</button>{allowPublicApprove && d.content_type?.startsWith("image/") && !d.public_approved && <button className="btn-line btn-sm" onClick={async () => { await act(() => api.post(`/documents/${d.id}/approve-public`), "Approved for website"); reload(); }} data-testid={`doc-approve-${d.id}`}>Approve for website</button>}{d.public_approved && <Badge v="public" tone="green" />}</span> }]} empty="No documents" />
    </Section>
  );
}

export default function Documents() {
  const [q, setQ] = useState("");
  const [expiring, setExpiring] = useState(false);
  const { rows } = useList("/documents", { q: q || undefined, expiring: expiring || undefined });
  return (
    <div>
      <PageHeader title="Documents" sub="Private storage. Downloads use 5-minute signed links and are audit-logged." />
      <div className="mb-4 flex gap-3"><input className="inp !w-64" placeholder="Search name or type" value={q} onChange={(e) => setQ(e.target.value)} data-testid="doc-search-input" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={expiring} onChange={(e) => setExpiring(e.target.checked)} data-testid="doc-expiring-filter" />Expiring within 30 days</label></div>
      <DataTable testid="all-docs-table" rows={rows} columns={[{ key: "original_name", label: "File" }, { key: "doc_type", label: "Type", render: (d) => label(d.doc_type) }, { key: "entity_type", label: "Linked to", render: (d) => label(d.entity_type) }, { key: "version", label: "Ver." }, { key: "uploaded_by_name", label: "Uploaded by", render: (d) => d.uploaded_by_name || "Public form" }, { key: "created_at", label: "Uploaded", render: (d) => fmtDateTime(d.created_at) }, { key: "expiry_date", label: "Expiry", render: (d) => fmtDate(d.expiry_date) }, { key: "x", label: "", render: (d) => <button className="btn-line btn-sm" onClick={() => download(d)}>Open</button> }]} />
    </div>
  );
}
