import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MapPin, Plus, Pencil, Eye, EyeOff } from "lucide-react";
import { api, clearCache, placeUrl, mapsUrl } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useDialog } from "../../lib/dialogs";
import { PageHeader, DataTable, Badge, FormDialog, Section, act } from "../../components/erp/kit";
import LocationPicker from "../../components/LocationPicker";

const branchFields = (users) => [
  { name: "name", label: "Branch name", required: true }, { name: "code", label: "Short code (3–4 letters)" },
  { name: "city", label: "Town", required: true }, { name: "district", label: "District" },
  { name: "address", label: "Office address", type: "textarea", full: true }, { name: "pincode", label: "PIN code" },
  { name: "phone", label: "Branch phone" }, { name: "whatsapp", label: "Branch WhatsApp" }, { name: "email", label: "Branch email", type: "email" },
  { name: "office_hours", label: "Office hours", hint: "Blank = company hours" },
  { name: "manager_id", label: "Branch manager", type: "select", options: users.map((u) => ({ value: u.id, label: u.name })) },
  { name: "gbp_url", label: "Google Business Profile link", hint: "Used for 'Directions' and in search-engine data", full: true },
  { name: "is_head_office", label: "Head office", type: "checkbox" }, { name: "active", label: "Open (shown on the website)", type: "checkbox" },
];

export default function Places() {
  const { can } = useAuth();
  const dialog = useDialog();
  const [branches, setBranches] = useState(null);
  const [towns, setTowns] = useState(null);
  const [users, setUsers] = useState([]);
  const [dlg, setDlg] = useState(null);
  const sw = can("settings", "w");
  const pw = can("properties", "w") || sw;
  const load = () => { clearCache("/branches"); clearCache("/locations"); clearCache("/public/"); api.get("/branches").then((r) => setBranches(r.data)).catch(() => setBranches([])); api.get("/locations").then((r) => setTowns(r.data)).catch(() => setTowns([])); };
  useEffect(() => { load(); api.get("/users/lite").then((r) => setUsers(r.data)).catch(() => {}); }, []);
  const editLoc = async (loc, patch, msg) => { if (await act(() => api.patch(`/locations/${loc.id}`, patch), msg)) load(); };
  const addLocality = async (town) => {
    const name = await dialog.ask({ title: `Add a locality in ${town.name}`, label: "Locality / area / village" });
    if (name && await act(() => api.post("/locations", { kind: "locality", name, city: town.name }), "Added")) load();
  };
  const intro = async (loc) => {
    const t = await dialog.ask({ title: `Introduction for ${loc.name}`, body: `Shown at the top of ${placeUrl(loc.city || loc.name, loc.kind === "locality" ? loc.name : null)} and read by search engines and AI assistants. Two or three factual sentences: what the area is known for, roads, schools, industry.`, label: "Introduction", type: "textarea", initial: loc.intro || "", required: false });
    if (t !== null) editLoc(loc, { intro: t }, "Saved");
  };
  const rename = async (loc) => { const n = await dialog.ask({ title: `Rename ${loc.name}`, body: "Listings in this place are updated too.", label: "New name", initial: loc.name }); if (n && n !== loc.name) editLoc(loc, { name: n }, "Renamed"); };
  const suggested = (towns || []).flatMap((t) => t.localities.filter((l) => l.active === false).map((l) => ({ ...l, town: t.name })));
  return (
    <div className="space-y-6" data-testid="places-page">
      <PageHeader title="Branches & places" sub="Branches, and the towns and localities used for listings, search, website location pages and branch routing. New places are added automatically when someone lists a property somewhere new.">
        {sw && <button className="btn-dark btn-sm" onClick={() => setDlg({ kind: "branch", v: { active: true, is_head_office: false } })} data-testid="new-branch-btn">New branch</button>}
      </PageHeader>
      <Section title="Branches" testid="branches-section">
        <DataTable testid="branches-table" loading={!branches} rows={branches || []} columns={[
          { key: "name", label: "Branch", render: (b) => <><span className="font-medium">{b.name}</span> <span className="text-xs text-slate-400">{b.code}</span>{b.is_head_office && <span className="ml-2"><Badge v="head office" tone="blue" /></span>}</> },
          { key: "city", label: "Town", render: (b) => `${b.city}${b.district ? `, ${b.district}` : ""}` },
          { key: "address", label: "Address", render: (b) => <span className={b.address?.startsWith("[") ? "text-amber-700" : ""}>{b.address || "-"}</span> },
          { key: "manager_id", label: "Manager", render: (b) => users.find((u) => u.id === b.manager_id)?.name || "-" },
          { key: "staff", label: "Staff" }, { key: "properties", label: "Properties" },
          { key: "map", label: "Map", render: (b) => (b.lat ? <a className="underline" href={mapsUrl(b.lat, b.lng)} target="_blank" rel="noopener noreferrer">Pin set</a> : <span className="text-amber-700">No pin</span>) },
          { key: "active", label: "Status", render: (b) => <Badge v={b.active === false ? "closed" : "open"} tone={b.active === false ? "grey" : "green"} /> },
          { key: "x", label: "", render: (b) => sw && <button className="btn-line btn-sm" onClick={() => setDlg({ kind: "branch", id: b.id, v: { ...b, active: b.active !== false } })} data-testid={`edit-branch-${b.id}`}><Pencil size={12} />Edit</button> },
        ]} />
        <p className="mt-3 text-xs text-slate-400">Addresses in [brackets] are placeholders: replace them before going live. Staff are given branches under Users & Roles.</p>
      </Section>
      {suggested.length > 0 && sw && <Section title={`Places suggested from the website (${suggested.length})`}><p className="mb-3 text-xs text-slate-500">Owners typed these when listing a property. Approve to add them to the website lists, or leave them hidden.</p><ul className="flex flex-wrap gap-2">{suggested.map((l) => <li key={l.id} className="flex items-center gap-1 border border-amber-300 bg-amber-50 px-2 py-1 text-sm">{l.name}, {l.town}<button className="ml-1 underline" onClick={() => editLoc(l, { active: true }, "Approved")}>Approve</button><button className="underline" onClick={() => rename(l)}>Rename</button></li>)}</ul></Section>}
      <Section title="Towns & localities" testid="towns-section" actions={sw && <button className="btn-line btn-sm" onClick={() => setDlg({ kind: "town", v: { city: "" } })} data-testid="new-town-btn"><Plus size={13} />Add town</button>}>
        {!towns ? <p className="text-sm text-slate-500">Loading…</p> : <div className="space-y-4">{towns.map((t) => (
          <div key={t.id} className="border border-slate-200 p-4" data-testid={`town-${t.slug}`}>
            <div className="flex flex-wrap items-center gap-2">
              <MapPin size={15} className="text-slate-400" /><p className="font-heading text-lg font-semibold">{t.name}</p>
              <span className="text-xs text-slate-500">{t.district ? `${t.district} district · ` : ""}{t.listings} live listings</span>
              {t.active === false && <Badge v="hidden" tone="grey" />}
              <span className="ml-auto flex flex-wrap items-center gap-1">
                <Link to={placeUrl(t.name)} className="btn-line btn-sm">Website page</Link>
                {sw && <select className="border border-slate-200 px-1 py-1 text-xs" value={t.branch_id || ""} onChange={(e) => editLoc(t, { branch_id: e.target.value || null }, "Branch updated")} aria-label={`Branch for ${t.name}`}><option value="">Branch: head office</option>{(branches || []).map((b) => <option key={b.id} value={b.id}>Branch: {b.name}</option>)}</select>}
                {sw && <button className="btn-line btn-sm" onClick={() => intro(t)}>{t.intro ? "Edit introduction" : "Add introduction"}</button>}
                {sw && <button className="btn-line btn-sm" onClick={() => rename(t)}>Rename</button>}
                {sw && <button className="btn-line btn-sm" onClick={() => editLoc(t, { active: t.active === false }, t.active === false ? "Shown" : "Hidden")} aria-label={t.active === false ? "Show" : "Hide"}>{t.active === false ? <Eye size={12} /> : <EyeOff size={12} />}</button>}
              </span>
            </div>
            {t.intro && <p className="mt-2 text-sm text-slate-600">{t.intro}</p>}
            <ul className="mt-3 flex flex-wrap gap-1.5">{t.localities.map((l) => <li key={l.id} className={`group flex items-center gap-1 border px-2 py-1 text-xs ${l.active === false ? "border-dashed border-slate-300 text-slate-400" : "border-slate-200"}`}>{l.name}{l.listings > 0 && <span className="text-slate-400">{l.listings}</span>}{sw && <><button className="hidden text-slate-400 hover:text-slate-900 group-hover:inline" onClick={() => intro({ ...l, city: t.name })} aria-label={`Introduction for ${l.name}`}><Pencil size={10} /></button><button className="hidden text-slate-400 hover:text-slate-900 group-hover:inline" onClick={() => editLoc(l, { active: l.active === false }, l.active === false ? "Shown" : "Hidden")} aria-label={l.active === false ? `Show ${l.name}` : `Hide ${l.name}`}>{l.active === false ? <Eye size={10} /> : <EyeOff size={10} />}</button></>}</li>)}
              {pw && <li><button className="flex items-center gap-1 border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-slate-500" onClick={() => addLocality(t)} data-testid={`add-locality-${t.slug}`}><Plus size={11} />Add locality</button></li>}</ul>
          </div>
        ))}</div>}
      </Section>
      <FormDialog open={dlg?.kind === "branch"} onClose={() => setDlg(null)} title={dlg?.id ? `Edit ${dlg.v.name}` : "New branch"} wide fields={branchFields(users)} initial={dlg?.v || {}}
        onSubmit={async (v) => { const body = { ...v }; ["staff", "properties", "created_at", "id", "order"].forEach((k) => delete body[k]); if (dlg.id) await api.patch(`/branches/${dlg.id}`, body); else await api.post("/branches", body); load(); }}>
        {(v, set) => <div><p className="lbl">Office location on the map</p><LocationPicker value={{ city: v.city, locality: v.locality_hint || "", lat: v.lat, lng: v.lng, accuracy_m: null, source: "map_pin" }} onChange={(x) => set({ city: x.city, locality_hint: x.locality, lat: x.lat, lng: x.lng })} towns={towns || []} testid="branch-location" note="Place the pin on the office door: it is used for 'Directions' and in search results." /></div>}
      </FormDialog>
      <FormDialog open={dlg?.kind === "town"} onClose={() => setDlg(null)} title="Add a town" fields={[{ name: "name", label: "Town", required: true }, { name: "district", label: "District" }, { name: "pincode", label: "Main PIN code" }, { name: "branch_id", label: "Looked after by", type: "select", options: (branches || []).map((b) => ({ value: b.id, label: b.name })) }, { name: "intro", label: "Introduction for the website page", type: "textarea", full: true }]} initial={{}}
        onSubmit={async (v) => { await api.post("/locations", { ...v, kind: "city" }); load(); }} />
    </div>
  );
}

