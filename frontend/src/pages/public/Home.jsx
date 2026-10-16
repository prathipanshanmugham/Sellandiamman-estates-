import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Search } from "lucide-react";
import { api, useTitle } from "../../lib/api";
import { SERVICES, WHY } from "../../lib/content";
import PropertyCard from "../../components/public/PropertyCard";
import { useSite } from "../../components/public/SiteLayout";

const TABS = [["residential,apartment,villa", "Residential", "sale"], ["land,agricultural", "Land & plots", "sale"], ["commercial,shop,office,industrial,warehouse,factory_shed", "Commercial & industrial", ""], ["", "Rentals", "rent"]];

function HeroSearch() {
  const nav = useNavigate();
  const [f, setF] = useState({ transaction: "sale", category: "", city: "", max_price: "" });
  const go = (e) => { e.preventDefault(); const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)); nav(`/properties?${q}`); };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={go} className="grid gap-px border border-slate-200 bg-slate-200 sm:grid-cols-5" data-testid="hero-search-form">
      <select className="bg-white px-4 py-4 text-sm focus:outline-none" value={f.transaction} onChange={set("transaction")} aria-label="Transaction" data-testid="hero-transaction-select"><option value="sale">Buy</option><option value="rent">Rent</option><option value="lease">Lease</option><option value="short_stay">Short stay</option></select>
      <select className="bg-white px-4 py-4 text-sm focus:outline-none" value={f.category} onChange={set("category")} aria-label="Type" data-testid="hero-category-select"><option value="">All types</option><option value="residential,apartment,villa">Residential</option><option value="land,agricultural">Land / plots</option><option value="commercial,shop,office">Commercial</option><option value="industrial,warehouse,factory_shed">Industrial / warehouse</option></select>
      <select className="bg-white px-4 py-4 text-sm focus:outline-none" value={f.city} onChange={set("city")} aria-label="City" data-testid="hero-city-select"><option value="">Erode & Perundurai</option><option>Erode</option><option>Perundurai</option></select>
      <input className="bg-white px-4 py-4 text-sm focus:outline-none" type="number" min="0" placeholder="Max budget (₹)" value={f.max_price} onChange={set("max_price")} aria-label="Max budget" data-testid="hero-maxprice-input" />
      <button className="flex items-center justify-center gap-2 bg-slate-900 px-6 py-4 text-sm font-medium text-white hover:bg-slate-700" data-testid="hero-search-btn"><Search size={16} />Search</button>
    </form>
  );
}

function Row({ title, items, link, testid }) {
  if (!items?.length) return null;
  return (
    <section className="container-x py-14" data-testid={testid}>
      <div className="mb-8 flex items-end justify-between"><h2 className="font-heading text-2xl font-semibold sm:text-3xl">{title}</h2><Link to={link} className="flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-slate-900">View all <ArrowRight size={14} /></Link></div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{items.map((p) => <PropertyCard key={p.listing_id} p={p} />)}</div>
    </section>
  );
}

export default function Home() {
  const site = useSite();
  useTitle(site.seo_title || "Real estate in Erode & Perundurai", site.seo_description || "Verified properties for sale, rent and lease in Erode and Perundurai. Property management and short-stay services.");
  const [featured, setFeatured] = useState([]);
  const [recent, setRecent] = useState([]);
  const [tab, setTab] = useState(0);
  const [tabItems, setTabItems] = useState([]);
  useEffect(() => {
    api.get("/public/properties", { params: { featured: true, limit: 3 } }).then((r) => setFeatured(r.data.items));
    api.get("/public/properties", { params: { limit: 6 } }).then((r) => setRecent(r.data.items));
  }, []);
  useEffect(() => {
    const [cat, , tx] = TABS[tab];
    api.get("/public/properties", { params: { category: cat || undefined, transaction: tx || undefined, limit: 3 } }).then((r) => setTabItems(r.data.items));
  }, [tab]);
  return (
    <div>
      <section className="relative">
        <div className="absolute inset-0"><img src="/images/villa.jpg" alt="" className="h-full w-full object-cover" /><div className="absolute inset-0 bg-slate-900/55" /></div>
        <div className="container-x relative py-24 sm:py-32 lg:py-40">
          <p className="eyebrow fade-up !text-slate-300">Sellandiamman Estates · Erode · Perundurai</p>
          <h1 className="fade-up mt-4 max-w-3xl font-heading text-4xl font-semibold leading-[1.05] text-white sm:text-5xl lg:text-6xl" style={{ animationDelay: "80ms" }}>{site.hero_title || "Property services for Erode & Perundurai"}</h1>
          <p className="fade-up mt-5 max-w-xl text-base text-slate-200 md:text-lg" style={{ animationDelay: "160ms" }}>{site.hero_subtitle}</p>
          <div className="fade-up mt-10 max-w-5xl" style={{ animationDelay: "240ms" }}><HeroSearch /></div>
        </div>
      </section>

      <Row title="Featured properties" items={featured} link="/properties" testid="featured-section" />

      <section className="border-y border-slate-200 bg-slate-50 py-14" data-testid="category-tabs-section">
        <div className="container-x">
          <div className="mb-8 flex flex-wrap gap-2">{TABS.map(([, l], i) => <button key={l} onClick={() => setTab(i)} className={`border px-4 py-2 text-sm ${tab === i ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"}`} data-testid={`home-tab-${i}`}>{l}</button>)}</div>
          {tabItems.length ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{tabItems.map((p) => <PropertyCard key={p.listing_id} p={p} />)}</div> : <p className="text-sm text-slate-500">No listings in this category right now. <Link to="/contact" className="underline">Tell us your requirement</Link>.</p>}
        </div>
      </section>

      <Row title="Recently added" items={recent} link="/properties?sort=latest" testid="recent-section" />

      <section className="bg-slate-900 py-20 text-white" data-testid="services-section">
        <div className="container-x">
          <p className="eyebrow !text-slate-400">What we do</p>
          <h2 className="mt-3 max-w-2xl font-heading text-3xl font-semibold sm:text-4xl">Brokerage, management and short-stay operations, under one accountable team.</h2>
          <div className="mt-12 grid gap-px bg-slate-700 sm:grid-cols-2 lg:grid-cols-4">
            {SERVICES.map((s) => <Link key={s.slug} to={`/services/${s.slug}`} className="group bg-slate-900 p-6 transition-colors hover:bg-slate-800" data-testid={`service-link-${s.slug}`}><h3 className="font-heading text-lg font-medium">{s.title}</h3><p className="mt-2 text-sm text-slate-400">{s.summary}</p><ArrowRight size={16} className="mt-4 text-slate-500 transition-transform group-hover:translate-x-1" /></Link>)}
          </div>
        </div>
      </section>

      <section className="container-x grid gap-12 py-20 lg:grid-cols-[1fr_1.4fr]" data-testid="why-section">
        <div><p className="eyebrow">Why Sellandiamman Estates</p><h2 className="mt-3 font-heading text-3xl font-semibold">Clear process. Written terms. Local knowledge.</h2><img src="/images/interior.jpg" alt="Interior" className="mt-8 aspect-[4/3] w-full object-cover" /></div>
        <div className="grid content-start gap-8 sm:grid-cols-2">{WHY.map(([t, d], i) => <div key={t} className="border-t border-slate-900 pt-5"><span className="font-mono text-xs text-slate-400">0{i + 1}</span><h3 className="mt-2 font-heading text-lg font-semibold">{t}</h3><p className="mt-2 text-sm text-slate-600">{d}</p></div>)}</div>
      </section>

      {site.testimonials?.length > 0 && (
        <section className="border-t border-slate-200 bg-slate-50 py-16" data-testid="testimonials-section"><div className="container-x grid gap-6 md:grid-cols-3">{site.testimonials.map((t, i) => <blockquote key={i} className="border-l-2 border-slate-900 bg-white p-6 text-sm text-slate-700">“{t.quote}”<footer className="mt-3 text-xs font-semibold text-slate-500">{t.name}</footer></blockquote>)}</div></section>
      )}

      <section className="container-x grid gap-px border border-slate-200 bg-slate-200 my-20 md:grid-cols-3" data-testid="cta-section">
        {[["Buyers", "Looking for a home, plot or investment?", "/properties?transaction=sale", "Browse properties"], ["Tenants & businesses", "Homes, shops, offices, sheds and warehouses.", "/properties?transaction=rent", "Find a rental"], ["Property owners", "Sell, rent out or get your property managed.", "/list-property", "List your property"]].map(([t, d, to, cta]) => (
          <div key={t} className="bg-white p-8"><p className="eyebrow">{t}</p><p className="mt-3 font-heading text-xl font-medium">{d}</p><Link to={to} className="btn-dark mt-6" data-testid={`cta-${t.split(" ")[0].toLowerCase()}`}>{cta}<ArrowRight size={14} /></Link></div>
        ))}
      </section>
    </div>
  );
}
