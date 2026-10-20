import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, label, opts, priceLabel, useCached } from "../../lib/api";
import LocationPicker from "../../components/LocationPicker";
import { useAuth } from "../../lib/auth";
import { useDialog } from "../../lib/dialogs";
import { PageHeader, DataTable, Badge, FormDialog, useList } from "../../components/erp/kit";

export const CATS = ["residential", "apartment", "villa", "land", "agricultural", "commercial", "shop", "office", "industrial", "warehouse", "factory_shed", "other"];
export const PSTATUS = ["draft", "verification_pending", "verified", "ready_to_market", "published", "under_offer", "closed", "inactive", "archived"];

export const propFields = (owners, users, branches) => [
  { name: "title", label: "Title", required: true, full: true },
  { name: "category", label: "Category", type: "select", options: opts(CATS), required: true },
  { name: "transaction", label: "Transaction", type: "select", options: opts(["sale", "rent", "lease", "short_stay"]), required: true },
  { name: "ownership_type", label: "Ownership", type: "select", required: true, options: [{ value: "third_party", label: "Third-party owned (brokered/managed)" }, { value: "company", label: "Company owned" }] },
  { name: "service_type", label: "Service", type: "select", required: true, options: opts(["brokerage", "management", "short_stay"]) },
  { name: "owner_id", label: "Owner", type: "select", options: owners.map((o) => ({ value: o.id, label: `${o.code} · ${o.name}` })) },
  { name: "branch_id", label: "Branch", type: "select", options: branches.map((b) => ({ value: b.id, label: b.name })) },
  { name: "location_public", label: "Pin on the website", type: "select", required: true, options: [{ value: "approximate", label: "Approximate (about 100 m away)" }, { value: "exact", label: "Exact point" }, { value: "hidden", label: "Do not show a pin" }] },
  { name: "survey_no", label: "Survey no. / identifier" }, { name: "internal_address", label: "Full address (internal)", full: true },
  { name: "price", label: "Price / rent (₹)", type: "number" }, { name: "price_unit", label: "Price unit", type: "select", required: true, options: opts(["total", "per_month", "per_night", "per_sqft", "per_acre", "per_cent"]) },
  { name: "plot_area", label: "Plot area", type: "number" }, { name: "built_area", label: "Built-up area", type: "number" },
  { name: "area_unit", label: "Area unit", type: "select", required: true, options: opts(["sq.ft", "sq.m", "acres", "cents", "grounds"]) },
  { name: "bedrooms", label: "Bedrooms", type: "number" }, { name: "bathrooms", label: "Bathrooms", type: "number" },
  { name: "furnishing", label: "Furnishing", type: "select", options: opts(["furnished", "semi_furnished", "unfurnished"]) },
  { name: "power_supply", label: "Power supply" }, { name: "loading_access", label: "Loading / access" }, { name: "parking", label: "Parking" },
  { name: "mgmt_fee_pct", label: "Management fee %", type: "number" }, { name: "max_guests", label: "Max guests (short stay)", type: "number" },
  { name: "assigned_agent", label: "Assigned agent", type: "select", options: users.filter((u) => ["sales_agent", "branch_manager"].includes(u.role)).map((u) => ({ value: u.id, label: u.name })) },
  { name: "assigned_manager", label: "Property manager", type: "select", options: users.filter((u) => ["property_manager", "shortstay_ops", "branch_manager"].includes(u.role)).map((u) => ({ value: u.id, label: u.name })) },
  { name: "amenities_text", label: "Amenities (comma separated)", full: true },
  { name: "images_text", label: "Image URLs (comma separated, approved only)", full: true },
  { name: "description_public", label: "Public description", type: "textarea", full: true },
  { name: "notes_internal", label: "Internal notes", type: "textarea", full: true },
  { name: "checkin_instructions", label: "Check-in instructions (restricted)", type: "textarea", full: true },
  { name: "service_agreement", label: "Service agreement details", type: "textarea", full: true },
];

export const toPropBody = (v) => {
  const { amenities_text, images_text, lat, lng, accuracy_m, source, ...rest } = v;
  const out = { ...rest, amenities: (amenities_text || "").split(",").map((s) => s.trim()).filter(Boolean), images: (images_text || "").split(",").map((s) => s.trim()).filter(Boolean) };
  ["verifications", "owner", "leases", "public_lat", "public_lng"].forEach((k) => delete out[k]);
  if (lat && lng) out.geo = { lat, lng, accuracy_m, source: source || "map_pin" };
  else if ("lat" in v) out.geo = null;
  return out;
};
// geo (private exact point) -> the picker's flat fields
export const geoInitial = (p) => ({ lat: p.geo?.lat ?? null, lng: p.geo?.lng ?? null, accuracy_m: p.geo?.accuracy_m ?? null, source: p.geo?.source ?? null });

// The town / locality / map pin block used inside the property forms
export function PropLocation({ v, set }) {
  const towns = useCached("/locations", []);
  return (
    <fieldset className="border-t border-slate-100 pt-4"><legend className="lbl">Location</legend>
      <LocationPicker value={v} onChange={(x) => set(x)} towns={towns} testid="prop-location" note="Add a new town or locality by typing it; it joins the list for everyone. The exact pin stays internal; the website shows the point you choose above." />
    </fieldset>
  );
}

export default function Properties() {
  const nav = useNavigate();
  const { can } = useAuth();
  const dialog = useDialog();
  const [flt, setFlt] = useState({ status: "", q: "", transaction: "" });
  const [open, setOpen] = useState(false);
  const { rows } = useList("/properties", { status: flt.status || undefined, q: flt.q || undefined, transaction: flt.transaction || undefined });
  const { rows: owners } = useList(can("owners") ? "/owners" : "/branches");
  const { rows: users } = useList("/users/lite");
  const { rows: branches } = useList("/branches");
  return (
    <div>
      <PageHeader title="Property register" sub="Third-party owned unless marked company-owned. Publishing requires verification and authorisation.">
        {can("properties", "w") && <button className="btn-dark btn-sm" onClick={() => setOpen(true)} data-testid="new-property-btn">New property</button>}
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="inp sm:!w-56" placeholder="Search title, code, locality" value={flt.q} onChange={(e) => setFlt({ ...flt, q: e.target.value })} data-testid="property-search-input" />
        <select className="inp !w-auto" value={flt.status} onChange={(e) => setFlt({ ...flt, status: e.target.value })} data-testid="property-status-filter"><option value="">All statuses</option>{PSTATUS.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <select className="inp !w-auto" value={flt.transaction} onChange={(e) => setFlt({ ...flt, transaction: e.target.value })} data-testid="property-tx-filter"><option value="">All transactions</option>{["sale", "rent", "lease", "short_stay"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
      </div>
      <DataTable testid="properties-table" rows={rows} onRow={(r) => nav(`/erp/properties/${r.id}`)} columns={[
        { key: "code", label: "Code" }, { key: "listing_id", label: "Listing" }, { key: "title", label: "Title" },
        { key: "category", label: "Type", render: (r) => `${label(r.category)} · ${label(r.transaction)}` },
        { key: "locality", label: "Location", render: (r) => `${r.locality}, ${r.city}` }, { key: "branch_id", label: "Branch", render: (r) => branches.find((b) => b.id === r.branch_id)?.name || "-" }, { key: "price", label: "Price", render: (r) => priceLabel(r) },
        { key: "ownership_type", label: "Ownership", render: (r) => label(r.ownership_type) },
        { key: "status", label: "Status", render: (r) => <Badge v={r.status} /> },
      ]} />
      <FormDialog open={open} onClose={() => setOpen(false)} title="New property" wide fields={propFields(can("owners") ? owners : [], users, branches)} initial={{ transaction: "sale", category: "residential", ownership_type: "third_party", service_type: "brokerage", price_unit: "total", area_unit: "sq.ft", city: "", locality: "", location_public: "approximate" }}
        onSubmit={async (v) => {
          try { const r = await api.post("/properties", toPropBody(v)); nav(`/erp/properties/${r.data.id}`); }
          catch (e) { if (e.response?.status === 409 && await dialog.confirm({ title: "Possible duplicate", body: `${e.response.data.detail}. Create a separate property anyway?`, okLabel: "Create anyway" })) { const r = await api.post("/properties", { ...toPropBody(v), force: true }); nav(`/erp/properties/${r.data.id}`); } else throw e; }
        }}>{(v, set) => <PropLocation v={v} set={set} />}</FormDialog>
    </div>
  );
}
