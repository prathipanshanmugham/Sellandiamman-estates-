import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LayoutGrid, List, Map as MapIcon, SlidersHorizontal, X } from "lucide-react";
import { api, useMeta, priceLabel, label, imgSrc, useMedia } from "../../lib/api";
import PropertyCard, { SaveButton } from "../../components/public/PropertyCard";
import PropertyMap from "../../components/public/PropertyMap";
import { useSite } from "../../components/public/SiteLayout";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../components/ui/sheet";

const FIELDS = ["transaction", "category", "city", "locality", "pincode", "min_price", "max_price", "bedrooms", "bathrooms", "min_area", "max_area", "furnishing", "feature", "sort", "q"];
const FILTER_LABELS = { transaction: "Looking to", category: "Type", city: "City", locality: "Locality", pincode: "PIN", min_price: "Min ₹", max_price: "Max ₹", bedrooms: "Beds", bathrooms: "Baths", min_area: "Min area", max_area: "Max area", furnishing: "Furnishing", feature: "Feature", q: "Search" };
const PAGE = 12;

function Filters({ params, setParam, reset }) {
  const v = (k) => params.get(k) || "";
  const sel = (k, options, lab) => (
    <div><label className="lbl" htmlFor={`f-${k}`}>{lab}</label><select id={`f-${k}`} className="inp" value={v(k)} onChange={(e) => setParam(k, e.target.value)} data-testid={`filter-${k}`}>{options.map(([val, l]) => <option key={val} value={val}>{l}</option>)}</select></div>
  );
  const num = (k, lab) => <div><label className="lbl" htmlFor={`f-${k}`}>{lab}</label><input id={`f-${k}`} type="number" min="0" inputMode="numeric" className="inp" value={v(k)} onChange={(e) => setParam(k, e.target.value)} data-testid={`filter-${k}`} /></div>;
  return (
    <div className="space-y-4" data-testid="catalogue-filters">
      <div><label className="lbl" htmlFor="f-q">Search</label><input id="f-q" className="inp" placeholder="Locality, title or listing ID" value={v("q")} onChange={(e) => setParam("q", e.target.value)} data-testid="filter-q" /></div>
      {sel("transaction", [["", "Any"], ["sale", "Buy"], ["rent", "Rent"], ["lease", "Lease"], ["short_stay", "Short stay"]], "Looking to")}
      {sel("category", [["", "All types"], ["residential,apartment,villa", "Homes"], ["land,agricultural", "Land & plots"], ["commercial,shop,office", "Shops & offices"], ["industrial,factory_shed", "Industrial / sheds"], ["warehouse", "Warehouse"], ["other", "Other"]], "Property type")}
      {sel("city", [["", "All"], ["Erode", "Erode"], ["Perundurai", "Perundurai"]], "City")}
      <div className="grid grid-cols-2 gap-3"><div><label className="lbl" htmlFor="f-locality">Locality</label><input id="f-locality" className="inp" value={v("locality")} onChange={(e) => setParam("locality", e.target.value)} data-testid="filter-locality" /></div><div><label className="lbl" htmlFor="f-pin">PIN code</label><input id="f-pin" className="inp" maxLength={6} inputMode="numeric" value={v("pincode")} onChange={(e) => setParam("pincode", e.target.value)} data-testid="filter-pincode" /></div></div>
      <div className="grid grid-cols-2 gap-3">{num("min_price", "Min ₹")}{num("max_price", "Max ₹")}</div>
      <div className="grid grid-cols-2 gap-3">{num("bedrooms", "Beds (min)")}{num("bathrooms", "Baths (min)")}</div>
      <div className="grid grid-cols-2 gap-3">{num("min_area", "Min area")}{num("max_area", "Max area")}</div>
      {sel("furnishing", [["", "Any"], ["furnished", "Furnished"], ["semi_furnished", "Semi-furnished"], ["unfurnished", "Unfurnished"]], "Furnishing")}
      {sel("feature", [["", "Any"], ["Car parking", "Car parking"], ["Power backup", "Power backup"], ["Gated community", "Gated community"], ["Lift", "Lift"], ["3-phase power", "3-phase power"], ["Container access", "Container access"], ["DTCP approved", "DTCP approved"], ["Wi-Fi", "Wi-Fi"]], "Feature")}
      <button className="btn-line w-full" onClick={reset} data-testid="filter-reset-btn">Clear all filters</button>
    </div>
  );
}

function ListRow({ p }) {
  return (
    <Link to={`/properties/${p.listing_id}`} className="relative flex gap-4 border border-slate-200 bg-white p-3 hover:border-slate-400 sm:gap-5" data-testid={`property-row-${p.listing_id}`}>
      <img src={imgSrc(p.images?.[0])} alt={p.title} className="h-24 w-28 shrink-0 object-cover sm:h-28 sm:w-40" loading="lazy" />
      <div className="min-w-0 pr-8"><p className="font-heading text-lg font-semibold">{priceLabel(p)}</p><p className="text-sm text-slate-800">{p.title}</p><p className="text-xs text-slate-500">{p.locality}, {p.city} · {label(p.category)} · {p.listing_id}</p></div>
      <SaveButton id={p.listing_id} className="absolute right-3 top-3 text-slate-500 hover:text-slate-900" />
    </Link>
  );
}

export default function Catalogue() {
  const site = useSite();
  useMeta({ title: "Properties for sale, rent and lease", description: "Search verified homes, land, shops, offices, warehouses and factory sheds in Erode and Perundurai.", path: "/properties" });
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState({ items: [], total: 0 });
  const [mapItems, setMapItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(params.get("view") || "grid");
  const [sheet, setSheet] = useState(false);
  const [picked, setPicked] = useState(null);
  const page = Number(params.get("page") || 1);
  const wide = useMedia("(min-width: 1024px)");
  const query = useMemo(() => { const q = {}; FIELDS.forEach((k) => { if (params.get(k)) q[k] = params.get(k); }); return q; }, [params]);
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      api.get("/public/properties", { params: { ...query, page, limit: PAGE } }).then((r) => setData(r.data)).catch(() => setData({ items: [], total: 0 })).finally(() => setLoading(false));
      if (view === "map") api.get("/public/properties", { params: { ...query, limit: 200 } }).then((r) => setMapItems(r.data.items)).catch(() => setMapItems([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query, page, view]);
  const setParam = (k, val) => { const n = new URLSearchParams(params); if (val) n.set(k, val); else n.delete(k); n.delete("page"); setParams(n, { replace: true }); };
  const active = FIELDS.filter((k) => k !== "sort" && params.get(k));
  const pages = Math.ceil(data.total / PAGE);
  const pickedItem = mapItems.find((x) => x.listing_id === picked);
  const changeView = (v) => { setView(v); const n = new URLSearchParams(params); if (v === "grid") n.delete("view"); else n.set("view", v); setParams(n, { replace: true }); };
  return (
    <div className="container-x py-10 sm:py-12">
      <p className="eyebrow">Property catalogue</p>
      <h1 className="mt-2 font-heading text-3xl font-semibold sm:text-4xl">Find a property</h1>
      <div className="mt-8 grid gap-10 lg:grid-cols-[280px_1fr]">
        {wide && <aside><Filters params={params} setParam={setParam} reset={() => setParams({})} /></aside>}
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button className="btn-line btn-sm lg:hidden" onClick={() => setSheet(true)} data-testid="open-filters-btn"><SlidersHorizontal size={14} />Filters{active.length ? ` (${active.length})` : ""}</button>
              <p className="text-sm text-slate-600" data-testid="catalogue-count" aria-live="polite">{loading ? "Loading…" : `${data.total} ${data.total === 1 ? "property" : "properties"}`}</p>
            </div>
            <div className="flex items-center gap-2">
              <select className="inp !w-auto !py-1.5" value={params.get("sort") || "latest"} onChange={(e) => setParam("sort", e.target.value)} aria-label="Sort" data-testid="sort-select"><option value="latest">Latest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="area_desc">Largest area</option></select>
              {[["grid", LayoutGrid, "Grid view"], ["list", List, "List view"], ["map", MapIcon, "Map view"]].map(([v, I, l]) => <button key={v} className={`btn-line btn-sm ${view === v ? "!border-slate-900 !bg-slate-900 !text-white" : ""}`} onClick={() => changeView(v)} aria-label={l} aria-pressed={view === v} data-testid={`view-${v}-btn`}><I size={14} /></button>)}
            </div>
          </div>
          {active.length > 0 && <div className="mb-5 flex flex-wrap gap-2" data-testid="active-filters">{active.map((k) => <button key={k} className="chip" onClick={() => setParam(k, "")}>{FILTER_LABELS[k]}: {label(params.get(k).split(",")[0])}{params.get(k).includes(",") ? "…" : ""}<X size={12} /></button>)}</div>}
          {!loading && !data.items.length && <div className="border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500" data-testid="catalogue-empty">No properties match these filters. <Link to="/requirement" className="underline">Post your requirement</Link> and we will tell you when one comes up.</div>}
          {view === "map" ? (
            <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
              <PropertyMap items={mapItems} center={site.map_center} selected={picked} onSelect={(p) => setPicked(p.listing_id)} />
              <div className="space-y-3">{pickedItem ? <PropertyCard p={pickedItem} compact /> : <p className="border border-dashed border-slate-300 p-6 text-sm text-slate-500">Tap a price on the map to see the property. Locations are approximate; exact addresses are shared on enquiry.</p>}</div>
            </div>
          ) : view === "grid" ? <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">{data.items.map((p) => <PropertyCard key={p.listing_id} p={p} />)}</div> : <div className="space-y-3">{data.items.map((p) => <ListRow key={p.listing_id} p={p} />)}</div>}
          {view !== "map" && pages > 1 && <nav className="mt-8 flex flex-wrap gap-2" aria-label="Pages">{Array.from({ length: pages }, (_, i) => <button key={i} onClick={() => { const n = new URLSearchParams(params); n.set("page", i + 1); setParams(n); window.scrollTo(0, 0); }} className={`h-9 w-9 border text-sm ${page === i + 1 ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`} aria-current={page === i + 1 ? "page" : undefined} data-testid={`page-btn-${i + 1}`}>{i + 1}</button>)}</nav>}
        </div>
      </div>
      <Sheet open={sheet && !wide} onOpenChange={setSheet}>
        <SheetContent side="left" className="w-[88vw] max-w-sm overflow-y-auto">
          <SheetHeader><SheetTitle className="font-heading">Filters</SheetTitle></SheetHeader>
          <div className="mt-4"><Filters params={params} setParam={setParam} reset={() => setParams({})} /></div>
          <button className="btn-dark mt-6 w-full" onClick={() => setSheet(false)} data-testid="apply-filters-btn">Show {data.total} {data.total === 1 ? "property" : "properties"}</button>
        </SheetContent>
      </Sheet>
    </div>
  );
}
