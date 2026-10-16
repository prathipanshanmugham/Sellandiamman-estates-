import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LayoutGrid, List } from "lucide-react";
import { api, useTitle, priceLabel, label } from "../../lib/api";
import PropertyCard, { imgSrc } from "../../components/public/PropertyCard";
import { Link } from "react-router-dom";

const FIELDS = ["transaction", "category", "city", "locality", "pincode", "min_price", "max_price", "bedrooms", "bathrooms", "min_area", "max_area", "furnishing", "feature", "sort", "q"];

function Filters({ params, setParam, reset }) {
  const v = (k) => params.get(k) || "";
  const sel = (k, options, lab) => (
    <div><label className="lbl">{lab}</label><select className="inp" value={v(k)} onChange={(e) => setParam(k, e.target.value)} data-testid={`filter-${k}`}>{options.map(([val, l]) => <option key={val} value={val}>{l}</option>)}</select></div>
  );
  const num = (k, lab) => <div><label className="lbl">{lab}</label><input type="number" min="0" className="inp" value={v(k)} onChange={(e) => setParam(k, e.target.value)} data-testid={`filter-${k}`} /></div>;
  return (
    <aside className="space-y-4" data-testid="catalogue-filters">
      <div><label className="lbl">Search</label><input className="inp" placeholder="Locality, title or ID" value={v("q")} onChange={(e) => setParam("q", e.target.value)} data-testid="filter-q" /></div>
      {sel("transaction", [["", "Any"], ["sale", "Buy"], ["rent", "Rent"], ["lease", "Lease"], ["short_stay", "Short stay"]], "Looking to")}
      {sel("category", [["", "All types"], ["residential,apartment,villa", "Residential"], ["land,agricultural", "Land & plots"], ["commercial,shop,office", "Commercial"], ["industrial,factory_shed", "Industrial"], ["warehouse", "Warehouse"], ["other", "Other"]], "Property type")}
      {sel("city", [["", "All"], ["Erode", "Erode"], ["Perundurai", "Perundurai"]], "City")}
      <div><label className="lbl">Locality</label><input className="inp" value={v("locality")} onChange={(e) => setParam("locality", e.target.value)} data-testid="filter-locality" /></div>
      <div><label className="lbl">PIN code</label><input className="inp" maxLength={6} value={v("pincode")} onChange={(e) => setParam("pincode", e.target.value)} data-testid="filter-pincode" /></div>
      <div className="grid grid-cols-2 gap-3">{num("min_price", "Min ₹")}{num("max_price", "Max ₹")}</div>
      <div className="grid grid-cols-2 gap-3">{num("bedrooms", "Beds (min)")}{num("bathrooms", "Baths (min)")}</div>
      <div className="grid grid-cols-2 gap-3">{num("min_area", "Min area")}{num("max_area", "Max area")}</div>
      {sel("furnishing", [["", "Any"], ["furnished", "Furnished"], ["semi_furnished", "Semi-furnished"], ["unfurnished", "Unfurnished"]], "Furnishing")}
      {sel("feature", [["", "Any"], ["Car parking", "Car parking"], ["Power backup", "Power backup"], ["Gated community", "Gated community"], ["3-phase power", "3-phase power"], ["Container access", "Container access"], ["DTCP approved", "DTCP approved"]], "Feature")}
      <button className="btn-line w-full" onClick={reset} data-testid="filter-reset-btn">Reset filters</button>
    </aside>
  );
}

function ListRow({ p }) {
  return (
    <Link to={`/properties/${p.listing_id}`} className="flex gap-5 border border-slate-200 bg-white p-3 hover:border-slate-400" data-testid={`property-row-${p.listing_id}`}>
      <img src={imgSrc(p.images?.[0])} alt={p.title} className="h-28 w-40 shrink-0 object-cover" loading="lazy" />
      <div className="min-w-0"><p className="font-heading text-lg font-semibold">{priceLabel(p)}</p><p className="text-sm text-slate-800">{p.title}</p><p className="text-xs text-slate-500">{p.locality}, {p.city} · {label(p.category)} · {p.listing_id}</p></div>
    </Link>
  );
}

export default function Catalogue() {
  useTitle("Properties for sale, rent and lease", "Search verified homes, land, commercial and industrial properties in Erode and Perundurai.");
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("grid");
  const page = Number(params.get("page") || 1);
  useEffect(() => {
    setLoading(true);
    const q = {};
    FIELDS.forEach((k) => { if (params.get(k)) q[k] = params.get(k); });
    const t = setTimeout(() => api.get("/public/properties", { params: { ...q, page, limit: 12 } }).then((r) => setData(r.data)).finally(() => setLoading(false)), 250);
    return () => clearTimeout(t);
  }, [params, page]);
  const setParam = (k, val) => { const n = new URLSearchParams(params); if (val) n.set(k, val); else n.delete(k); n.delete("page"); setParams(n, { replace: true }); };
  const pages = Math.ceil(data.total / 12);
  return (
    <div className="container-x py-12">
      <p className="eyebrow">Property catalogue</p>
      <h1 className="mt-2 font-heading text-3xl font-semibold sm:text-4xl">Find a property</h1>
      <div className="mt-10 grid gap-10 lg:grid-cols-[280px_1fr]">
        <Filters params={params} setParam={setParam} reset={() => setParams({})} />
        <div>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600" data-testid="catalogue-count">{loading ? "Loading…" : `${data.total} properties`}</p>
            <div className="flex items-center gap-2">
              <select className="inp !w-auto" value={params.get("sort") || "latest"} onChange={(e) => setParam("sort", e.target.value)} data-testid="sort-select"><option value="latest">Latest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="area_desc">Largest area</option></select>
              <button className={`btn-line btn-sm ${view === "grid" ? "!bg-slate-900 !text-white" : ""}`} onClick={() => setView("grid")} aria-label="Grid view" data-testid="view-grid-btn"><LayoutGrid size={14} /></button>
              <button className={`btn-line btn-sm ${view === "list" ? "!bg-slate-900 !text-white" : ""}`} onClick={() => setView("list")} aria-label="List view" data-testid="view-list-btn"><List size={14} /></button>
            </div>
          </div>
          {!loading && !data.items.length && <div className="border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500" data-testid="catalogue-empty">No properties match these filters. <Link to="/contact" className="underline">Share your requirement</Link> and we will notify you.</div>}
          {view === "grid" ? <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">{data.items.map((p) => <PropertyCard key={p.listing_id} p={p} />)}</div> : <div className="space-y-3">{data.items.map((p) => <ListRow key={p.listing_id} p={p} />)}</div>}
          {pages > 1 && <div className="mt-8 flex gap-2">{Array.from({ length: pages }, (_, i) => <button key={i} onClick={() => { const n = new URLSearchParams(params); n.set("page", i + 1); setParams(n); }} className={`h-9 w-9 border text-sm ${page === i + 1 ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`} data-testid={`page-btn-${i + 1}`}>{i + 1}</button>)}</div>}
          <p className="mt-6 text-xs text-slate-400">Map view becomes available when a maps provider is configured.</p>
        </div>
      </div>
    </div>
  );
}
