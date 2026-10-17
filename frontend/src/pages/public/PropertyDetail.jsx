import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MapPin, MessageCircle, Check, ChevronLeft, ChevronRight, Phone } from "lucide-react";
import { api, useMeta, priceLabel, label, waLink, imgSrc, inr0, num, shareUrl, telLink, SITE_URL } from "../../lib/api";
import { emi } from "../../lib/calc";
import PropertyCard, { SaveButton, txLabel } from "../../components/public/PropertyCard";
import EnquiryForm from "../../components/public/EnquiryForm";
import ShareBar from "../../components/public/ShareBar";
import PropertyMap from "../../components/public/PropertyMap";
import { useSite } from "../../components/public/SiteLayout";

function Gallery({ images, title }) {
  const [i, setI] = useState(0);
  const list = images?.length ? images : [null];
  const go = (d) => setI((i + d + list.length) % list.length);
  return (
    <div>
      <div className="relative aspect-[16/10] overflow-hidden bg-slate-100">
        <img src={imgSrc(list[i])} alt={`${title} – photo ${i + 1} of ${list.length}`} className="h-full w-full object-cover" data-testid="property-main-image" />
        {list.length > 1 && <>
          <button onClick={() => go(-1)} className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/90 p-2 text-slate-800 hover:bg-white" aria-label="Previous photo"><ChevronLeft size={18} /></button>
          <button onClick={() => go(1)} className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/90 p-2 text-slate-800 hover:bg-white" aria-label="Next photo"><ChevronRight size={18} /></button>
          <span className="absolute bottom-2 right-2 bg-slate-900/80 px-2 py-0.5 text-xs text-white tabular">{i + 1} / {list.length}</span>
        </>}
      </div>
      {list.length > 1 && <div className="mt-3 flex gap-3 overflow-x-auto">{list.map((u, k) => <button key={`${u}-${k}`} onClick={() => setI(k)} className={`h-16 w-24 shrink-0 overflow-hidden border-2 ${k === i ? "border-slate-900" : "border-transparent"}`} aria-label={`Show photo ${k + 1}`} data-testid={`thumb-${k}`}><img src={imgSrc(u)} alt="" className="h-full w-full object-cover" /></button>)}</div>}
    </div>
  );
}

function EmiHint({ price }) {
  const [rate, setRate] = useState(8.5);
  const loan = price * 0.8;
  const m = emi(loan, rate, 240);
  return (
    <section className="mt-10 border border-slate-200 bg-slate-50 p-5" data-testid="emi-hint">
      <h2 className="font-heading text-lg font-semibold">Home-loan estimate</h2>
      <p className="mt-1 text-sm text-slate-600">With an 80% loan of {inr0(loan)} over 20 years at <select className="border-b border-slate-400 bg-transparent px-0.5 font-semibold focus:outline-none" value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Interest rate">{[7.5, 8, 8.5, 9, 9.5, 10].map((r) => <option key={r} value={r}>{r}%</option>)}</select>, the EMI is about <b className="text-slate-900 tabular">{inr0(m)}</b> a month.</p>
      <p className="mt-2 text-xs text-slate-500">Add about 9% of the value for stamp duty and registration in Tamil Nadu. <Link to="/tools#emi" className="underline">Change the numbers</Link> · <Link to="/tools#stamp-duty" className="underline">Purchase costs</Link></p>
    </section>
  );
}

export default function PropertyDetail() {
  const { listingId } = useParams();
  const site = useSite();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(false);
  const [tab, setTab] = useState("enquire");
  useEffect(() => { setD(null); setErr(false); api.get(`/public/properties/${listingId}`).then((r) => setD(r.data)).catch(() => setErr(true)); }, [listingId]);
  const p = d?.property;
  const ld = useMemo(() => p && ({
    "@context": "https://schema.org", "@type": "RealEstateListing", name: p.title, url: `${SITE_URL}/properties/${p.listing_id}`,
    description: p.description_public, datePosted: p.published_at, image: (p.images || []).map((u) => (u?.startsWith("http") ? u : `${SITE_URL}${u}`)),
    offers: p.price && !p.price_on_request ? { "@type": "Offer", price: p.price, priceCurrency: "INR", availability: "https://schema.org/InStock", businessFunction: p.transaction === "sale" ? "http://purl.org/goodrelations/v1#Sell" : "http://purl.org/goodrelations/v1#LeaseOut" } : undefined,
    address: { "@type": "PostalAddress", addressLocality: p.locality, addressRegion: "Tamil Nadu", postalCode: p.pincode, addressCountry: "IN" },
  }), [p]);
  useMeta({ title: p ? `${p.title}, ${p.locality}` : "Property", description: p ? `${priceLabel(p)} · ${txLabel(p.transaction)} · ${p.locality}, ${p.city}. ${(p.description_public || "").slice(0, 120)}` : undefined, image: p?.images?.[0], jsonLd: ld });
  if (err) return <div className="container-x py-24" data-testid="property-not-found"><h1 className="font-heading text-2xl">Listing not available</h1><p className="mt-2 text-sm text-slate-500">This property may have been rented, sold or withdrawn.</p><Link to="/properties" className="btn-dark mt-6">Browse properties</Link></div>;
  if (!p) return <div className="container-x py-24 text-sm text-slate-500">Loading…</div>;
  const wa = waLink(site.whatsapp, `Hello, I am interested in listing ${p.listing_id}: ${p.title}`);
  const area = p.built_area || p.plot_area;
  const perUnit = p.transaction === "sale" && p.price && area && p.area_unit === "sq.ft" ? `${inr0(p.price / area)} per sq.ft` : null;
  const facts = [["Listing ID", p.listing_id], ["Type", label(p.category)], ["For", txLabel(p.transaction).replace("For ", "")], ["Built-up area", p.built_area && `${num(p.built_area)} ${p.area_unit}`], ["Plot / land area", p.plot_area && `${num(p.plot_area)} ${p.area_unit}`], ["Bedrooms", p.bedrooms], ["Bathrooms", p.bathrooms], ["Furnishing", p.furnishing && label(p.furnishing)], ["Availability", p.availability], ["Status", p.status], ["Max guests", p.max_guests], ["Power supply", p.power_supply], ["Loading / access", p.loading_access], ["Parking", p.parking], ["PIN code", p.pincode], ["Price per sq.ft", perUnit]].filter(([, v]) => v);
  const sideForm = tab === "visit"
    ? <EnquiryForm key="visit" listingId={p.listing_id} kind="visit" title="" testid="property-visit" />
    : <EnquiryForm key="enq" listingId={p.listing_id} defaultInterest={p.transaction === "sale" ? "buy" : p.transaction} title="" testid="property-enquiry" />;
  return (
    <div className="container-x py-8 sm:py-10" data-testid="property-detail">
      <nav className="text-xs text-slate-500" aria-label="Breadcrumb"><Link to="/properties" className="hover:underline">Properties</Link> / <Link to={`/properties?city=${p.city}`} className="hover:underline">{p.city}</Link> / {p.listing_id}</nav>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0"><p className="eyebrow">{txLabel(p.transaction)} · {label(p.category)}</p><h1 className="mt-1 font-heading text-3xl font-semibold sm:text-4xl" data-testid="property-title">{p.title}</h1><p className="mt-2 flex items-center gap-1 text-sm text-slate-600"><MapPin size={14} />{p.locality}, {p.city}</p></div>
        <div className="text-right"><p className="font-heading text-3xl font-semibold" data-testid="property-price">{priceLabel(p)}</p>{perUnit && <p className="text-xs text-slate-500">{perUnit}</p>}</div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <SaveButton id={p.listing_id} withText className="btn-line btn-sm" />
        <ShareBar url={shareUrl("p", p.listing_id)} text={`${p.title} – ${priceLabel(p)} (${p.locality}, ${p.city})`} brochurePath={`/public/properties/${p.listing_id}/brochure.pdf`} brochureName={`${p.listing_id} brochure`} testid="property-share" />
      </div>
      <div className="mt-6 grid gap-10 lg:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0">
          <Gallery images={p.images} title={p.title} />
          <section className="mt-10"><h2 className="font-heading text-xl font-semibold">About this property</h2><p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700">{p.description_public}</p></section>
          <section className="mt-10"><h2 className="font-heading text-xl font-semibold">Key details</h2>
            <dl className="mt-4 grid grid-cols-2 gap-px border border-slate-200 bg-slate-200 sm:grid-cols-3">{facts.map(([k, v]) => <div key={k} className="bg-white p-4"><dt className="eyebrow">{k}</dt><dd className="mt-1 text-sm font-medium text-slate-900">{v}</dd></div>)}</dl>
          </section>
          {p.amenities?.length > 0 && <section className="mt-10"><h2 className="font-heading text-xl font-semibold">Features & amenities</h2><ul className="mt-4 grid gap-2 sm:grid-cols-2">{p.amenities.map((a) => <li key={a} className="flex items-center gap-2 text-sm text-slate-700"><Check size={14} />{a}</li>)}</ul></section>}
          {p.transaction === "sale" && p.price && !p.price_on_request && <EmiHint price={p.price} />}
          {p.public_lat && p.public_lng && <section className="mt-10"><h2 className="font-heading text-xl font-semibold">Approximate location</h2><p className="mt-1 text-xs text-slate-500">The exact address is shared after you enquire.</p><div className="mt-4"><PropertyMap items={[p]} height={300} /></div></section>}
          <p className="mt-10 text-xs text-slate-400">Details are provided by the owner and subject to verification by the buyer or tenant. <Link to="/legal/disclaimer" className="underline">Listing disclaimer</Link>.</p>
        </div>
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="border border-slate-200">
            <div className="grid grid-cols-2 border-b border-slate-200" role="tablist">
              {[["enquire", "Enquire"], ["visit", "Book a site visit"]].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-4 py-3 text-sm font-medium ${tab === k ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`} data-testid={`property-tab-${k}`}>{l}</button>)}
            </div>
            <div className="p-6">{sideForm}
              <div className="mt-4 grid gap-2">
                {wa ? <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-line w-full" data-testid="property-whatsapp-btn"><MessageCircle size={16} />Ask on WhatsApp</a> : null}
                {site.phone && !site.phone.includes("00000") && <a href={telLink(site.phone)} className="btn-line w-full"><Phone size={16} />Call {site.phone}</a>}
              </div>
            </div>
          </div>
        </aside>
      </div>
      {d.similar?.length > 0 && <section className="mt-20"><h2 className="font-heading text-2xl font-semibold">Similar properties</h2><div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{d.similar.map((s) => <PropertyCard key={s.listing_id} p={s} />)}</div></section>}
    </div>
  );
}
