import { Link } from "react-router-dom";
import { BedDouble, Bath, Maximize, MapPin } from "lucide-react";
import { label, priceLabel } from "../../lib/api";

export const imgSrc = (u) => (u?.startsWith("/api/") ? `${process.env.REACT_APP_BACKEND_URL}${u}` : u || "/images/placeholder.svg");

export default function PropertyCard({ p }) {
  const area = p.built_area || p.plot_area;
  return (
    <Link to={`/properties/${p.listing_id}`} className="group block border border-slate-200 bg-white transition-colors hover:border-slate-400" data-testid={`property-card-${p.listing_id}`}>
      <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
        <img src={imgSrc(p.images?.[0])} alt={p.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        <span className="absolute left-3 top-3 bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-800">{p.transaction === "sale" ? "For sale" : label(p.transaction)}</span>
        {p.status === "Under offer" && <span className="absolute right-3 top-3 bg-slate-900 px-2 py-1 text-[11px] font-semibold uppercase text-white">Under offer</span>}
      </div>
      <div className="p-5">
        <p className="font-heading text-xl font-semibold text-slate-900" data-testid="property-card-price">{priceLabel(p)}</p>
        <h3 className="mt-1 line-clamp-1 text-sm font-medium text-slate-800">{p.title}</h3>
        <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><MapPin size={13} />{p.locality}, {p.city}</p>
        <div className="mt-4 flex gap-4 border-t border-slate-100 pt-3 text-xs text-slate-600">
          {p.bedrooms ? <span className="flex items-center gap-1"><BedDouble size={14} />{p.bedrooms} Bed</span> : null}
          {p.bathrooms ? <span className="flex items-center gap-1"><Bath size={14} />{p.bathrooms} Bath</span> : null}
          {area ? <span className="flex items-center gap-1"><Maximize size={14} />{area.toLocaleString("en-IN")} {p.area_unit}</span> : null}
          <span className="ml-auto text-slate-400">{p.listing_id}</span>
        </div>
      </div>
    </Link>
  );
}
