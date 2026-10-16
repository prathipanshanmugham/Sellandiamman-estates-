import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MapPin, MessageCircle, Check } from "lucide-react";
import { api, useTitle, priceLabel, label, waLink } from "../../lib/api";
import PropertyCard, { imgSrc } from "../../components/public/PropertyCard";
import EnquiryForm from "../../components/public/EnquiryForm";
import { useSite } from "../../components/public/SiteLayout";

export default function PropertyDetail() {
  const { listingId } = useParams();
  const site = useSite();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(false);
  const [img, setImg] = useState(0);
  useEffect(() => { setD(null); setErr(false); setImg(0); api.get(`/public/properties/${listingId}`).then((r) => setD(r.data)).catch(() => setErr(true)); }, [listingId]);
  const p = d?.property;
  useTitle(p ? `${p.title}, ${p.locality}` : "Property", p?.description_public?.slice(0, 150));
  if (err) return <div className="container-x py-24" data-testid="property-not-found"><h1 className="font-heading text-2xl">Listing not available</h1><p className="mt-2 text-sm text-slate-500">This property may have been rented, sold or withdrawn.</p><Link to="/properties" className="btn-dark mt-6">Browse properties</Link></div>;
  if (!p) return <div className="container-x py-24 text-sm text-slate-500">Loading…</div>;
  const wa = waLink(site.whatsapp, `Hello, I am interested in listing ${p.listing_id}: ${p.title}`);
  const facts = [["Listing ID", p.listing_id], ["Type", label(p.category)], ["Transaction", label(p.transaction)], ["Built-up area", p.built_area && `${p.built_area.toLocaleString("en-IN")} ${p.area_unit}`], ["Plot / land area", p.plot_area && `${p.plot_area.toLocaleString("en-IN")} ${p.area_unit}`], ["Bedrooms", p.bedrooms], ["Bathrooms", p.bathrooms], ["Furnishing", p.furnishing && label(p.furnishing)], ["Availability", p.availability], ["Status", p.status], ["Max guests", p.max_guests], ["Power supply", p.power_supply], ["Loading / access", p.loading_access], ["Parking", p.parking], ["PIN code", p.pincode]].filter(([, v]) => v);
  return (
    <div className="container-x py-10" data-testid="property-detail">
      <nav className="text-xs text-slate-500"><Link to="/properties" className="hover:underline">Properties</Link> / {p.city} / {p.listing_id}</nav>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="font-heading text-3xl font-semibold sm:text-4xl" data-testid="property-title">{p.title}</h1><p className="mt-2 flex items-center gap-1 text-sm text-slate-600"><MapPin size={14} />{p.locality}, {p.city}</p></div>
        <p className="font-heading text-3xl font-semibold" data-testid="property-price">{priceLabel(p)}</p>
      </div>
      <div className="mt-8 grid gap-10 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <div className="aspect-[16/10] overflow-hidden bg-slate-100"><img src={imgSrc(p.images?.[img])} alt={p.title} className="h-full w-full object-cover" data-testid="property-main-image" /></div>
          {p.images?.length > 1 && <div className="mt-3 flex gap-3">{p.images.map((u, i) => <button key={u} onClick={() => setImg(i)} className={`h-16 w-24 overflow-hidden border-2 ${i === img ? "border-slate-900" : "border-transparent"}`} data-testid={`thumb-${i}`}><img src={imgSrc(u)} alt="" className="h-full w-full object-cover" /></button>)}</div>}
          <section className="mt-10"><h2 className="font-heading text-xl font-semibold">About this property</h2><p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700">{p.description_public}</p></section>
          <section className="mt-10"><h2 className="font-heading text-xl font-semibold">Key details</h2>
            <dl className="mt-4 grid grid-cols-2 gap-px border border-slate-200 bg-slate-200 sm:grid-cols-3">{facts.map(([k, v]) => <div key={k} className="bg-white p-4"><dt className="eyebrow">{k}</dt><dd className="mt-1 text-sm font-medium text-slate-900">{v}</dd></div>)}</dl>
          </section>
          {p.amenities?.length > 0 && <section className="mt-10"><h2 className="font-heading text-xl font-semibold">Features & amenities</h2><ul className="mt-4 grid gap-2 sm:grid-cols-2">{p.amenities.map((a) => <li key={a} className="flex items-center gap-2 text-sm text-slate-700"><Check size={14} />{a}</li>)}</ul></section>}
          {p.public_lat && p.public_lng && <section className="mt-10"><h2 className="font-heading text-xl font-semibold">Approximate location</h2><iframe title="map" className="mt-4 h-72 w-full border border-slate-200" loading="lazy" src={`https://www.openstreetmap.org/export/embed.html?bbox=${p.public_lng - 0.01},${p.public_lat - 0.01},${p.public_lng + 0.01},${p.public_lat + 0.01}&layer=mapnik`} /></section>}
          <p className="mt-10 text-xs text-slate-400">Details are provided by the owner and subject to verification by the buyer or tenant. <Link to="/legal/disclaimer" className="underline">Listing disclaimer</Link>.</p>
        </div>
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="border border-slate-200 p-6">
            <EnquiryForm listingId={p.listing_id} defaultInterest={p.transaction === "sale" ? "buy" : p.transaction} title="Enquire about this property" testid="property-enquiry" />
            {wa ? <a href={wa} target="_blank" rel="noreferrer" className="btn-line mt-3 w-full" data-testid="property-whatsapp-btn"><MessageCircle size={16} />Enquire on WhatsApp</a>
              : <p className="mt-3 text-center text-xs text-slate-400" data-testid="whatsapp-not-configured">WhatsApp enquiries will be available soon.</p>}
          </div>
        </aside>
      </div>
      {d.similar?.length > 0 && <section className="mt-20"><h2 className="font-heading text-2xl font-semibold">Similar properties</h2><div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{d.similar.map((s) => <PropertyCard key={s.listing_id} p={s} />)}</div></section>}
    </div>
  );
}
