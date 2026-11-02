import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, fmtDate, fmtDateTime, label, priceLabel, todayIST, openFile } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { PageHeader, Badge, FormDialog, Section, Facts, useList, act } from "../../components/erp/kit";
import { propFields, toPropBody, geoInitial, PropLocation } from "./Properties";
import { DocsPanel } from "./Documents";

const NEXT = { draft: ["verification_pending"], verification_pending: ["draft"], verified: ["ready_to_market"], ready_to_market: ["published"], published: ["under_offer", "ready_to_market"], under_offer: ["published", "closed"], closed: ["archived", "ready_to_market"], inactive: ["draft", "archived"], archived: [] };

export default function ErpProperty() {
  const { id } = useParams();
  const { can } = useAuth();
  const [p, setP] = useState(null);
  const [dlg, setDlg] = useState("");
  const { rows: owners } = useList(can("owners") ? "/owners" : "/branches");
  const { rows: users } = useList("/users/lite");
  const { rows: branches } = useList("/branches");
  const load = () => api.get(`/properties/${id}`).then((r) => setP(r.data)).catch(() => setP(false));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (p === false) return <p data-testid="property-not-found">Property not found or not accessible.</p>;
  if (!p) return <p className="text-sm text-slate-500">Loading…</p>;
  const move = async (to) => { await act(() => api.post(`/properties/${id}/transition`, { to }), `Moved to ${label(to)}`); load(); };
  const exp = p.authorization?.expiry;
  return (
    <div className="space-y-6" data-testid="erp-property-detail">
      <PageHeader title={p.title} sub={`${p.code}${p.listing_id ? ` · Public ID ${p.listing_id}` : ""} · ${label(p.ownership_type)}`}>
        <Badge v={p.status} testid="property-status-badge" />
        {can("properties", "w") && (NEXT[p.status] || []).map((to) => <button key={to} className={to === "published" ? "btn-dark btn-sm" : "btn-line btn-sm"} onClick={() => move(to)} data-testid={`transition-${to}-btn`}>{to === "published" ? "Publish" : `→ ${label(to)}`}</button>)}
        {can("properties", "w") && !["inactive", "archived"].includes(p.status) && <button className="btn-line btn-sm" onClick={() => move("inactive")} data-testid="transition-inactive-btn">Deactivate</button>}
        {can("properties", "a") && ["verification_pending", "verified", "ready_to_market", "published"].includes(p.status) && <button className="btn-dark btn-sm" onClick={() => setDlg("verify")} data-testid="verify-property-btn">Verify / authorise</button>}
        {can("properties", "w") && <button className="btn-line btn-sm" onClick={() => setDlg("edit")} data-testid="edit-property-btn">Edit</button>}
        {p.listing_id && ["published", "under_offer"].includes(p.status) && <><Link to={`/properties/${p.listing_id}`} className="btn-line btn-sm" data-testid="view-public-btn">View on website</Link><button className="btn-line btn-sm" onClick={() => openFile(`/public/properties/${p.listing_id}/brochure.pdf`, { name: `${p.listing_id} brochure` })} data-testid="brochure-btn">Brochure PDF</button></>}
        {can("cms", "w") && p.status === "published" && <button className="btn-line btn-sm" onClick={async () => { await act(() => api.patch(`/properties/${id}/featured`, { featured: !p.featured }), "Updated"); load(); }} data-testid="toggle-featured-btn">{p.featured ? "Unfeature" : "Feature on homepage"}</button>}
      </PageHeader>
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Section title="Details"><Facts items={[["Category", label(p.category)], ["Transaction", label(p.transaction)], ["Service", label(p.service_type)], ["Price", priceLabel(p)], ["Location", `${p.locality}, ${p.city} ${p.pincode || ""}`], ["Branch", branches.find((b) => b.id === p.branch_id)?.name], ["Map pin", p.geo ? <a className="underline" href={`https://www.google.com/maps/search/?api=1&query=${p.geo.lat},${p.geo.lng}`} target="_blank" rel="noopener noreferrer">{`${p.geo.lat.toFixed(5)}, ${p.geo.lng.toFixed(5)}`}{p.geo.accuracy_m ? ` ±${p.geo.accuracy_m} m` : ""} ({label(p.geo.source)})</a> : "Not set"], ["Website pin", label(p.location_public || "approximate")], ["Internal address", p.internal_address], ["Survey no.", p.survey_no], ["Plot area", p.plot_area && `${p.plot_area} ${p.area_unit}`], ["Built-up", p.built_area && `${p.built_area} ${p.area_unit}`], ["Beds / baths", `${p.bedrooms ?? "-"} / ${p.bathrooms ?? "-"}`], ["Furnishing", label(p.furnishing)], ["Occupancy", label(p.occupancy)], ["Power", p.power_supply], ["Loading", p.loading_access], ["Mgmt fee", p.mgmt_fee_pct != null ? `${p.mgmt_fee_pct}%` : null], ["Source", label(p.source)], ["Agent", users.find((u) => u.id === p.assigned_agent)?.name], ["Manager", users.find((u) => u.id === p.assigned_manager)?.name]]} />
            {p.description_public && <p className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-600"><span className="lbl">Public description</span>{p.description_public}</p>}
            {p.owner_description && <p className="mt-4 text-sm text-slate-600"><span className="lbl">Owner's description</span>{p.owner_description}</p>}
            {p.notes_internal && <p className="mt-4 text-sm text-slate-600"><span className="lbl">Internal notes</span>{p.notes_internal}</p>}
            {p.checkin_instructions && <p className="mt-4 text-sm text-slate-600"><span className="lbl">Check-in instructions (restricted)</span>{p.checkin_instructions}</p>}
          </Section>
          <DocsPanel entityType="property" entityId={id} allowPublicApprove={can("cms", "p")} />
        </div>
        <div className="space-y-6">
          <Section title="Verification & authorisation" testid="verification-section">
            {p.owner_match_unverified && <p className="mb-3 bg-amber-50 p-2 text-xs text-amber-800" data-testid="owner-match-warning">Submitted phone matched an existing owner record. Confirm the submitter ({p.submitted_name}) is that owner before verifying.</p>}
            <Facts items={[["Verification", <Badge v={p.verification?.status || "not_started"} testid="verification-badge" />], ["Verified by", p.verification?.by], ["Marketing authorised", p.authorization?.marketing_authorized ? "Yes" : "No"], ["Authorisation expiry", exp ? <span className={exp < todayIST() ? "font-semibold text-red-700" : ""}>{fmtDate(exp)}</span> : "-"]]} />
            {p.verifications?.map((v) => <p key={v.id} className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">{fmtDateTime(v.at)} · {v.by_name}: <b>{v.result}</b> {v.notes}</p>)}
          </Section>
          {p.owner && <Section title="Owner (restricted)"><Facts items={[["Name", p.owner.name], ["Phone", p.owner.phone], ["Email", p.owner.email], ["NRI", p.owner.is_nri ? "Yes" : "No"]]} /></Section>}
          <Section title="Publication history" testid="publication-history">{(p.publication_history || []).length ? p.publication_history.map((h, i) => <p key={i} className="border-b border-slate-100 py-1.5 text-xs text-slate-600">{fmtDateTime(h.at)} · {h.by} · {h.action}</p>) : <p className="text-sm text-slate-400">Never published</p>}</Section>
          {p.leases?.length > 0 && <Section title="Leases">{p.leases.map((l) => <p key={l.id} className="flex justify-between border-b border-slate-100 py-1.5 text-sm"><span>{l.code} · {l.tenant_name}</span><Badge v={l.status} /></p>)}</Section>}
        </div>
      </div>
      <FormDialog open={dlg === "edit"} onClose={() => setDlg("")} title="Edit property" wide fields={propFields(can("owners") ? owners : [], users, branches)} initial={{ ...p, location_public: p.location_public || "approximate", ...geoInitial(p), amenities_text: (p.amenities || []).join(", "), images_text: (p.images || []).join(", ") }} onSubmit={async (v) => { await api.patch(`/properties/${id}`, toPropBody(v)); load(); }}>{(v, set) => <PropLocation v={v} set={set} />}</FormDialog>
      <FormDialog open={dlg === "verify"} onClose={() => setDlg("")} title="Ownership verification & marketing authorisation" submitLabel="Record verification" initial={{ ownership_verified: false, authorization_signed: false, marketing_authorized: false, authorization_expiry: exp || "" }}
        fields={[{ name: "ownership_verified", label: "Ownership documents verified", type: "checkbox" }, { name: "authorization_signed", label: "Owner authorisation signed", type: "checkbox" }, { name: "marketing_authorized", label: "Owner authorises marketing / publication", type: "checkbox" }, { name: "authorization_expiry", label: "Authorisation expiry", type: "date", required: true }, { name: "notes", label: "Notes", type: "textarea", full: true }]}
        onSubmit={async (v) => { const r = await api.post(`/properties/${id}/verify`, v); act(async () => r, r.data.verification_result === "verified" ? "Property verified" : "Recorded as not verified: ownership and signed authorisation are both needed"); load(); }} />
    </div>
  );
}
