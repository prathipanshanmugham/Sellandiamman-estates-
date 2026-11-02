import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, X } from "lucide-react";
import { api, useMeta, useShortlist, shortlistApi, priceLabel, label, imgSrc, num, inr0, waShare, SITE_URL } from "../../lib/api";
import { txLabel } from "../../components/public/PropertyCard";

const ROWS = [["Price", (p) => priceLabel(p)], ["For", (p) => txLabel(p.transaction)], ["Type", (p) => label(p.category)], ["Location", (p) => `${p.locality}, ${p.city}`],
  ["Built-up", (p) => (p.built_area ? `${num(p.built_area)} ${p.area_unit}` : "-")], ["Plot / land", (p) => (p.plot_area ? `${num(p.plot_area)} ${p.area_unit}` : "-")],
  ["Price per sq.ft", (p) => (p.transaction === "sale" && p.price && p.area_unit === "sq.ft" && (p.built_area || p.plot_area) ? inr0(p.price / (p.built_area || p.plot_area)) : "-")],
  ["Bedrooms", (p) => p.bedrooms ?? "-"], ["Bathrooms", (p) => p.bathrooms ?? "-"], ["Furnishing", (p) => label(p.furnishing)], ["Availability", (p) => p.availability || "-"],
  ["Status", (p) => p.status], ["Features", (p) => (p.amenities || []).join(", ") || "-"]];

export default function Shortlist() {
  useMeta({ title: "Saved properties", description: "Compare the properties you saved.", noindex: true });
  const ids = useShortlist();
  const [items, setItems] = useState(null);
  useEffect(() => {
    if (!ids.length) { setItems([]); return; }
    api.get("/public/properties", { params: { ids: ids.join(","), limit: 50 } }).then((r) => setItems(r.data.items)).catch(() => setItems([]));
  }, [ids]);
  const gone = items ? ids.filter((id) => !items.some((p) => p.listing_id === id)) : [];
  const shareText = items?.length ? `Properties I'm considering:\n${items.map((p) => `${p.title} – ${priceLabel(p)}\n${SITE_URL}/properties/${p.listing_id}`).join("\n")}` : "";
  return (
    <div className="container-x py-10 sm:py-14" data-testid="shortlist-page">
      <p className="eyebrow">Saved</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-heading text-4xl font-semibold">Saved properties</h1>
        {items?.length > 0 && <div className="flex gap-2"><a className="btn-line btn-sm" href={waShare(shareText)} target="_blank" rel="noopener noreferrer" data-testid="shortlist-share">Send on WhatsApp</a><button className="btn-line btn-sm" onClick={() => shortlistApi.clear()} data-testid="shortlist-clear">Clear all</button></div>}
      </div>
      <p className="mt-3 text-sm text-slate-600">Saved on this device only. Tap the heart on any listing to add it here (up to 12).</p>
      {items === null && <p className="mt-10 text-sm text-slate-500">Loading…</p>}
      {items && !items.length && <div className="mt-10 border border-dashed border-slate-300 p-10 text-center" data-testid="shortlist-empty"><Heart className="mx-auto text-slate-400" /><p className="mt-3 text-sm text-slate-600">No saved properties yet.</p><Link to="/properties" className="btn-dark mt-5">Browse properties</Link></div>}
      {gone.length > 0 && <p className="mt-6 bg-amber-50 p-3 text-sm text-amber-900">{gone.length === 1 ? "One saved listing is" : `${gone.length} saved listings are`} no longer available ({gone.join(", ")}). <button className="underline" onClick={() => gone.forEach((g) => shortlistApi.remove(g))}>Remove</button></p>}
      {items?.length > 0 && <div className="mt-8 overflow-x-auto border border-slate-200" data-testid="compare-table">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead><tr><th className="w-40 border-b border-slate-200 bg-slate-50 p-3 text-left align-bottom text-xs font-semibold uppercase tracking-wider text-slate-500">Compare</th>
            {items.map((p) => <th key={p.listing_id} className="relative border-b border-l border-slate-200 p-3 text-left align-top font-normal">
              <button onClick={() => shortlistApi.remove(p.listing_id)} className="absolute right-2 top-2 bg-white/90 p-1 text-slate-500 hover:text-slate-900" aria-label={`Remove ${p.title}`}><X size={14} /></button>
              <Link to={`/properties/${p.listing_id}`} className="block"><img src={imgSrc(p.images?.[0])} alt="" className="aspect-[4/3] w-full object-cover" /><span className="mt-2 block font-heading text-sm font-semibold text-slate-900 hover:underline">{p.title}</span><span className="text-xs text-slate-500">{p.listing_id}</span></Link>
            </th>)}</tr></thead>
          <tbody>{ROWS.map(([l, f]) => <tr key={l}><th className="border-b border-slate-100 bg-slate-50 p-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{l}</th>{items.map((p) => <td key={p.listing_id} className="border-b border-l border-slate-100 p-3 align-top text-slate-800">{f(p)}</td>)}</tr>)}</tbody>
        </table>
      </div>}
    </div>
  );
}
