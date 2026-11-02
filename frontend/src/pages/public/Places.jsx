import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MapPin, ArrowRight } from "lucide-react";
import { api, useMeta, useCached, slugify, placeUrl, inr, SITE_URL, todayIST, fmtDate } from "../../lib/api";
import PropertyCard from "../../components/public/PropertyCard";
import PropertyMap from "../../components/public/PropertyMap";
import { useSite } from "../../components/public/SiteLayout";
import { BranchCards } from "./Home";
import { NotFound } from "./Pages";

const TX = { sale: "for sale", rent: "for rent", lease: "for lease", short_stay: "for short stays" };
const PER = { rent: " a month", lease: " a month", short_stay: " a night" };
const factText = (f) => `${f.n} ${f.n === 1 ? "property" : "properties"} ${TX[f.tx] || f.tx}${f.min ? (f.min === f.max ? ` at ${inr(f.min, true)}` : `, ${inr(f.min, true)} to ${inr(f.max, true)}`) + (PER[f.tx] || "") : ""}`;

// /properties-in/:city and /properties-in/:city/:locality: a page per town and locality, with the listings there,
// a short summary of prices, the branch that looks after it, and common questions (also for search engines).
export default function PlacePage() {
  const { city: cs, locality: ls } = useParams();
  const site = useSite();
  const towns = useCached("/public/locations", null);
  const town = towns?.find((t) => slugify(t.name) === cs);
  const loc = ls ? town?.localities.find((l) => slugify(l.name) === ls) : null;
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (!town || (ls && !loc)) return;
    setRows(null);
    api.get("/public/properties", { params: { city: town.name, locality: loc?.name, limit: 60 } }).then((r) => setRows(r.data.items)).catch(() => setRows([]));
  }, [town?.id, loc?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const place = loc ? `${loc.name}, ${town?.name}` : town?.name;
  const facts = useMemo(() => {
    const by = {};
    (rows || []).forEach((p) => { (by[p.transaction] = by[p.transaction] || []).push(p); });
    return Object.entries(by).map(([tx, ps]) => {
      const prices = ps.filter((p) => p.price && !p.price_on_request).map((p) => p.price);
      return { tx, n: ps.length, min: prices.length ? Math.min(...prices) : null, max: prices.length ? Math.max(...prices) : null };
    });
  }, [rows]);
  const branch = site.branches.find((b) => town && b.city.toLowerCase() === town.name.toLowerCase()) || site.branches.find((b) => b.id === (loc?.branch_id || town?.branch_id));
  const faq = place && rows ? [
    { q: `How many properties are listed in ${place}?`, a: `As of ${fmtDate(todayIST())}, there ${rows.length === 1 ? "is 1 verified property" : `are ${rows.length} verified properties`} listed in ${place}${facts.length ? `: ${facts.map(factText).join("; ")}` : ""}.` },
    { q: `Who can help me buy, rent or lease property in ${place}?`, a: `Sellandiamman Estates ${branch ? `has a branch in ${branch.city}` : `covers ${place}`} and can arrange site visits, check documents and prepare rental agreements.` },
    { q: `Can I list my property in ${place}?`, a: "Yes. Use the 'List your property' page. Our team verifies ownership and agrees terms in writing before anything is published." },
  ] : [];
  useMeta({
    title: place ? `Property in ${place} – sale, rent & lease` : "Places",
    description: place ? `${rows ? `${rows.length} verified properties` : "Verified homes, plots, shops, offices and sheds"} in ${place}. ${(loc || town)?.intro || ""}`.slice(0, 300) : undefined,
    path: place ? placeUrl(town.name, loc?.name) : undefined,
    jsonLd: place && rows ? { "@context": "https://schema.org", "@graph": [
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` }, { "@type": "ListItem", position: 2, name: town.name, item: `${SITE_URL}${placeUrl(town.name)}` }, ...(loc ? [{ "@type": "ListItem", position: 3, name: loc.name, item: `${SITE_URL}${placeUrl(town.name, loc.name)}` }] : [])] },
      { "@type": "FAQPage", mainEntity: faq.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })) },
    ] } : undefined,
  });
  if (towns && (!town || (ls && !loc))) return <NotFound />;
  if (!town) return <div className="container-x py-24 text-sm text-slate-500">Loading…</div>;
  const others = town.localities.filter((l) => l.listings && l.id !== loc?.id);
  return (
    <div className="container-x py-10 sm:py-12" data-testid="place-page">
      <nav className="text-xs text-slate-500" aria-label="Breadcrumb"><Link to="/" className="hover:underline">Home</Link> / <Link to={placeUrl(town.name)} className="hover:underline">{town.name}</Link>{loc && <> / {loc.name}</>}</nav>
      <div className="mt-4 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="eyebrow flex items-center gap-1"><MapPin size={12} />{town.district ? `${town.district} district, ` : ""}Tamil Nadu</p>
          <h1 className="mt-2 font-heading text-3xl font-semibold sm:text-4xl" data-testid="place-title">Properties in {place}</h1>
          <p className="mt-4 max-w-2xl text-slate-600">{(loc || town).intro || `Homes, plots, shops, offices and industrial spaces for sale, rent and lease in ${place}, verified by Sellandiamman Estates.`}</p>
          {rows && <p className="mt-4 text-sm text-slate-700" data-testid="place-summary">{rows.length ? facts.map(factText).join(" · ") : "No listings here right now."}</p>}
          <div className="mt-5 flex flex-wrap gap-2"><Link to={`/properties?city=${encodeURIComponent(town.name)}${loc ? `&locality=${encodeURIComponent(loc.name)}` : ""}`} className="btn-dark btn-sm">Search with filters<ArrowRight size={13} /></Link><Link to="/requirement" className="btn-line btn-sm">Post a requirement</Link><Link to="/list-property" className="btn-line btn-sm">List a property here</Link></div>
        </div>
        {rows && rows.some((p) => p.public_lat) && <PropertyMap items={rows} height={260} center={town.lat ? { lat: town.lat, lng: town.lng, zoom: 12 } : undefined} />}
      </div>
      {!loc && others.length > 0 && <section className="mt-10"><h2 className="font-heading text-lg font-semibold">Localities in {town.name}</h2><div className="mt-3 flex flex-wrap gap-2">{others.map((l) => <Link key={l.id} to={placeUrl(town.name, l.name)} className="chip" data-testid={`locality-${l.slug}`}>{l.name} <span className="text-slate-400">{l.listings}</span></Link>)}</div></section>}
      {loc && others.length > 0 && <p className="mt-8 text-sm text-slate-600">Also in {town.name}: {others.slice(0, 8).map((l, i) => <span key={l.id}>{i > 0 && " · "}<Link to={placeUrl(town.name, l.name)} className="underline">{l.name}</Link></span>)}</p>}
      <section className="mt-10">
        {rows === null ? <p className="text-sm text-slate-500">Loading listings…</p> : rows.length ? <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">{rows.map((p) => <PropertyCard key={p.listing_id} p={p} />)}</div> : <div className="border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">No listings in {place} right now. <Link to="/requirement" className="underline">Tell us what you need</Link> and we will let you know when one comes up.</div>}
      </section>
      {faq.length > 0 && <section className="mt-16 max-w-3xl"><h2 className="font-heading text-2xl font-semibold">Questions about {place}</h2><div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">{faq.map((x) => <div key={x.q} className="py-4"><h3 className="font-medium text-slate-900">{x.q}</h3><p className="mt-1 text-sm text-slate-600">{x.a}</p></div>)}</div></section>}
      {branch && <section className="mt-16"><h2 className="mb-4 font-heading text-2xl font-semibold">Your local branch</h2><BranchCards branches={[branch]} phone={site.phone} whatsapp={site.whatsapp} compact /></section>}
    </div>
  );
}
