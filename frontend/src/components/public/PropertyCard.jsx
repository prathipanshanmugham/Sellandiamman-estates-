import { Link } from "react-router-dom";
import { BedDouble, Bath, Maximize, MapPin, Heart } from "lucide-react";
import { label, priceLabel, imgSrc, shortlistApi, useShortlist, num } from "../../lib/api";

export { imgSrc };

export const txLabel = (t) => ({ sale: "For sale", rent: "For rent", lease: "For lease", short_stay: "Short stay" }[t] || label(t));

export function SaveButton({ id, className = "", withText = false }) {
  const saved = useShortlist().includes(id);
  return (
    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); shortlistApi.toggle(id); }}
      className={`${className} inline-flex items-center gap-1.5`} aria-pressed={saved} aria-label={saved ? "Remove from saved" : "Save property"} data-testid={`save-btn-${id}`}>
      <Heart size={withText ? 16 : 17} className={saved ? "fill-slate-900 text-slate-900" : ""} />{withText && (saved ? "Saved" : "Save")}
    </button>
  );
}

export default function PropertyCard({ p, compact = false }) {
  const area = p.built_area || p.plot_area;
  return (
    <Link to={`/properties/${p.listing_id}`} className="group relative block border border-slate-200 bg-white transition-colors hover:border-slate-400" data-testid={`property-card-${p.listing_id}`}>
      <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
        <img src={imgSrc(p.images?.[0])} alt={p.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        <span className="absolute left-3 top-3 bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-800">{txLabel(p.transaction)}</span>
        {p.status === "Under offer" && <span className="absolute bottom-3 left-3 bg-slate-900 px-2 py-1 text-[11px] font-semibold uppercase text-white">Under offer</span>}
        <SaveButton id={p.listing_id} className="absolute right-2 top-2 bg-white/95 p-2 text-slate-700 hover:text-slate-900" />
      </div>
      <div className={compact ? "p-4" : "p-5"}>
        <p className="font-heading text-xl font-semibold text-slate-900" data-testid="property-card-price">{priceLabel(p)}</p>
        <h3 className="mt-1 line-clamp-1 text-sm font-medium text-slate-800">{p.title}</h3>
        <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><MapPin size={13} />{p.locality}, {p.city}</p>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
          {p.bedrooms ? <span className="flex items-center gap-1"><BedDouble size={14} />{p.bedrooms} Bed</span> : null}
          {p.bathrooms ? <span className="flex items-center gap-1"><Bath size={14} />{p.bathrooms} Bath</span> : null}
          {area ? <span className="flex items-center gap-1"><Maximize size={14} />{num(area)} {p.area_unit}</span> : null}
          <span className="ml-auto text-slate-400">{p.listing_id}</span>
        </div>
      </div>
    </Link>
  );
}
