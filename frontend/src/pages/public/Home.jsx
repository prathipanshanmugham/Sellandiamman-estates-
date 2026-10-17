import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Search, Calculator, Scale, Ruler, TrendingUp, Building2, Hotel } from "lucide-react";
import { api, useMeta, asset, fmtDate, imgSrc, SITE_URL } from "../../lib/api";
import { SERVICES, WHY } from "../../lib/content";
import PropertyCard from "../../components/public/PropertyCard";
import { useSite } from "../../components/public/SiteLayout";
import { Mark } from "../../components/brand/Logo";

const TABS = [["residential,apartment,villa", "Homes", "sale"], ["land,agricultural", "Land & plots", "sale"], ["commercial,shop,office,industrial,warehouse,factory_shed", "Commercial & industrial", ""], ["", "Rentals", "rent"], ["", "Short stays", "short_stay"]];

function HeroSearch() {
  const nav = useNavigate();
  const [f, setF] = useState({ transaction: "sale", category: "", city: "", max_price: "" });
  const go = (e) => { e.preventDefault(); const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)); nav(`/properties?${q}`); };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={go} className="grid gap-px border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-5" data-testid="hero-search-form" role="search">
      <select className="bg-white px-4 py-4 text-sm focus:outline-none" value={f.transaction} onChange={set("transaction")} aria-label="Looking to" data-testid="hero-transaction-select"><option value="sale">Buy</option><option value="rent">Rent</option><option value="lease">Lease</option><option value="short_stay">Short stay</option></select>
      <select className="bg-white px-4 py-4 text-sm focus:outline-none" value={f.category} onChange={set("category")} aria-label="Property type" data-testid="hero-category-select"><option value="">All types</option><option value="residential,apartment,villa">Homes</option><option value="land,agricultural">Land / plots</option><option value="commercial,shop,office">Shops & offices</option><option value="industrial,warehouse,factory_shed">Industrial / warehouse</option></select>
      <select className="bg-white px-4 py-4 text-sm focus:outline-none" value={f.city} onChange={set("city")} aria-label="City" data-testid="hero-city-select"><option value="">Erode & Perundurai</option><option>Erode</option><option>Perundurai</option></select>
      <input className="bg-white px-4 py-4 text-sm focus:outline-none" type="number" min="0" inputMode="numeric" placeholder="Max budget (₹)" value={f.max_price} onChange={set("max_price")} aria-label="Max budget" data-testid="hero-maxprice-input" />
      <button className="flex items-center justify-center gap-2 bg-slate-900 px-6 py-4 text-sm font-medium text-white hover:bg-slate-700 sm:col-span-2 lg:col-span-1" data-testid="hero-search-btn"><Search size={16} />Search</button>
    </form>
  );
}

function Row({ title, items, link, testid }) {
  if (!items?.length) return null;
  return (
    <section className="container-x py-14" data-testid={testid}>
      <div className="mb-8 flex items-end justify-between gap-4"><h2 className="font-heading text-2xl font-semibold sm:text-3xl">{title}</h2><Link to={link} className="flex shrink-0 items-center gap-1 text-sm font-medium text-slate-700 hover:text-slate-900">View all <ArrowRight size={14} /></Link></div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{items.map((p) => <PropertyCard key={p.listing_id} p={p} />)}</div>
    </section>
  );
}

const TOOLS = [["emi", "Home-loan EMI", "Monthly instalment and total interest", Calculator], ["stamp-duty", "Stamp duty & registration", "Tamil Nadu sale-deed costs", Scale], ["area", "Area converter", "Cents, grounds, acres and sq.ft", Ruler], ["yield", "Rental yield", "What a rental really earns", TrendingUp], ["lease", "Lease escalation", "Rent over a commercial lease", Building2], ["short-stay", "Short-stay income", "Nightly bookings vs a tenant", Hotel]];

export default function Home() {
  const site = useSite();
  const org = { "@context": "https://schema.org", "@type": "RealEstateAgent", name: "Sellandiamman Estates", url: SITE_URL, logo: `${SITE_URL}/icon-512.png`, image: `${SITE_URL}/og-image.jpg`, telephone: site.phone, email: site.email, address: { "@type": "PostalAddress", streetAddress: site.address, addressRegion: "Tamil Nadu", addressCountry: "IN" }, areaServed: ["Erode", "Perundurai"] };
  useMeta({ title: site.seo_title || "Property services in Erode & Perundurai", description: site.seo_description || "Verified homes, land, shops and industrial sheds for sale, rent and lease in Erode and Perundurai. Property management and short-stay services.", path: "/", jsonLd: org });
  const [featured, setFeatured] = useState([]);
  const [recent, setRecent] = useState([]);
  const [tab, setTab] = useState(0);
  const [tabItems, setTabItems] = useState([]);
  const [posts, setPosts] = useState([]);
  useEffect(() => {
    api.get("/public/properties", { params: { featured: true, limit: 3 } }).then((r) => setFeatured(r.data.items)).catch(() => {});
    api.get("/public/properties", { params: { limit: 6 } }).then((r) => setRecent(r.data.items)).catch(() => {});
    api.get("/public/posts", { params: { limit: 3 } }).then((r) => setPosts(r.data.items)).catch(() => {});
  }, []);
  useEffect(() => {
    const [cat, , tx] = TABS[tab];
    api.get("/public/properties", { params: { category: cat || undefined, transaction: tx || undefined, limit: 3 } }).then((r) => setTabItems(r.data.items)).catch(() => setTabItems([]));
  }, [tab]);
  return (
    <div>
      <section className="relative">
        <div className="absolute inset-0"><img src={asset("/images/villa.jpg")} alt="" className="h-full w-full object-cover" /><div className="absolute inset-0 bg-gradient-to-r from-slate-950/80 via-slate-900/60 to-slate-900/30" /></div>
        <div className="container-x relative py-20 sm:py-28 lg:py-36">
          <p className="eyebrow fade-up !text-slate-300">Erode · Perundurai · SIPCOT</p>
          <h1 className="fade-up mt-4 max-w-3xl font-heading text-4xl font-semibold leading-[1.05] text-white sm:text-5xl lg:text-6xl" style={{ animationDelay: "80ms" }}>{site.hero_title || "Property services for Erode & Perundurai"}</h1>
          <p className="fade-up mt-5 max-w-xl text-base text-slate-200 md:text-lg" style={{ animationDelay: "160ms" }}>{site.hero_subtitle || "Buy, sell, rent, lease and professionally managed homes, land and industrial spaces."}</p>
          <div className="fade-up mt-10 max-w-5xl" style={{ animationDelay: "240ms" }}><HeroSearch /></div>
          <p className="fade-up mt-4 text-sm text-slate-300" style={{ animationDelay: "300ms" }}>Can't find it? <Link to="/requirement" className="font-semibold text-white underline underline-offset-4" data-testid="hero-requirement-link">Tell us what you need</Link> and we'll match it.</p>
        </div>
      </section>

      <Row title="Featured properties" items={featured} link="/properties" testid="featured-section" />

      <section className="border-y border-slate-200 bg-slate-50 py-14" data-testid="category-tabs-section">
        <div className="container-x">
          <div className="-mx-4 mb-8 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">{TABS.map(([, l], i) => <button key={l} onClick={() => setTab(i)} className={`shrink-0 border px-4 py-2 text-sm ${tab === i ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"}`} aria-pressed={tab === i} data-testid={`home-tab-${i}`}>{l}</button>)}</div>
          {tabItems.length ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{tabItems.map((p) => <PropertyCard key={p.listing_id} p={p} />)}</div> : <p className="text-sm text-slate-500">No listings in this category right now. <Link to="/requirement" className="underline">Tell us your requirement</Link>.</p>}
        </div>
      </section>

      <Row title="Recently added" items={recent} link="/properties?sort=latest" testid="recent-section" />

      <section className="relative overflow-hidden bg-slate-900 py-20 text-white" data-testid="services-section">
        <Mark className="pointer-events-none absolute -bottom-16 -right-24 h-80 w-auto opacity-[0.06]" color="#FFFFFF" />
        <div className="container-x relative">
          <p className="eyebrow !text-slate-400">What we do</p>
          <h2 className="mt-3 max-w-2xl font-heading text-3xl font-semibold sm:text-4xl">Brokerage, management and short-stay operations, under one accountable team.</h2>
          <div className="mt-12 grid gap-px bg-slate-700 sm:grid-cols-2 lg:grid-cols-4">
            {SERVICES.map((s) => <Link key={s.slug} to={`/services/${s.slug}`} className="group bg-slate-900 p-6 transition-colors hover:bg-slate-800" data-testid={`service-link-${s.slug}`}><h3 className="font-heading text-lg font-medium">{s.title}</h3><p className="mt-2 text-sm text-slate-400">{s.summary}</p><ArrowRight size={16} className="mt-4 text-slate-500 transition-transform group-hover:translate-x-1" /></Link>)}
          </div>
        </div>
      </section>

      <section className="container-x py-20" data-testid="tools-teaser">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="eyebrow">Property calculators</p><h2 className="mt-3 max-w-xl font-heading text-3xl font-semibold">Work out the numbers before you call us.</h2></div>
          <Link to="/tools" className="btn-line">All calculators<ArrowRight size={14} /></Link>
        </div>
        <div className="mt-10 grid gap-px border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map(([id, t, d, I]) => <Link key={id} to={`/tools#${id}`} className="group flex items-start gap-4 bg-white p-6 hover:bg-slate-50" data-testid={`tool-link-${id}`}><I size={20} className="mt-0.5 shrink-0 text-brand-ink" /><span><span className="block font-heading text-base font-semibold">{t}</span><span className="mt-1 block text-sm text-slate-500">{d}</span></span></Link>)}
        </div>
      </section>

      <section className="border-t border-slate-200 bg-slate-50" data-testid="why-section">
        <div className="container-x grid gap-12 py-20 lg:grid-cols-[1fr_1.4fr]">
          <div><p className="eyebrow">Why Sellandiamman Estates</p><h2 className="mt-3 font-heading text-3xl font-semibold">Clear process. Written terms. Local knowledge.</h2><img src={asset("/images/interior.jpg")} alt="Living room of a managed home" className="mt-8 aspect-[4/3] w-full object-cover" loading="lazy" /></div>
          <div className="grid content-start gap-8 sm:grid-cols-2">{WHY.map(([t, d]) => <div key={t} className="border-t border-slate-900 pt-5"><h3 className="font-heading text-lg font-semibold">{t}</h3><p className="mt-2 text-sm text-slate-600">{d}</p></div>)}</div>
        </div>
      </section>

      {posts.length > 0 && (
        <section className="container-x py-20" data-testid="insights-teaser">
          <div className="mb-8 flex items-end justify-between gap-4"><div><p className="eyebrow">Insights</p><h2 className="mt-3 font-heading text-3xl font-semibold">Guides and market notes</h2></div><Link to="/insights" className="flex shrink-0 items-center gap-1 text-sm font-medium text-slate-700 hover:text-slate-900">All articles <ArrowRight size={14} /></Link></div>
          <div className="grid gap-6 md:grid-cols-3">{posts.map((p) => <Link key={p.slug} to={`/insights/${p.slug}`} className="group block"><div className="aspect-[16/10] overflow-hidden bg-slate-100">{p.cover_image && <img src={imgSrc(p.cover_image)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />}</div><p className="mt-4 text-xs text-slate-500">{fmtDate(p.published_at)} · {p.reading_minutes} min read</p><h3 className="mt-1 font-heading text-lg font-semibold group-hover:underline">{p.title}</h3><p className="mt-1 line-clamp-2 text-sm text-slate-600">{p.excerpt}</p></Link>)}</div>
        </section>
      )}

      {site.testimonials?.length > 0 && (
        <section className="border-t border-slate-200 bg-slate-50 py-16" data-testid="testimonials-section"><div className="container-x grid gap-6 md:grid-cols-3">{site.testimonials.map((t, i) => <blockquote key={i} className="border-l-2 border-slate-900 bg-white p-6 text-sm text-slate-700">“{t.quote}”<footer className="mt-3 text-xs font-semibold text-slate-500">{t.name}</footer></blockquote>)}</div></section>
      )}

      <section className="container-x my-20 grid gap-px border border-slate-200 bg-slate-200 md:grid-cols-3" data-testid="cta-section">
        {[["Buyers", "Looking for a home, plot or investment?", "/properties?transaction=sale", "Browse properties"], ["Tenants & businesses", "Homes, shops, offices, sheds and warehouses.", "/properties?transaction=rent", "Find a rental"], ["Property owners", "Sell, rent out or get your property managed.", "/list-property", "List your property"]].map(([t, d, to, cta]) => (
          <div key={t} className="bg-white p-8"><p className="eyebrow">{t}</p><p className="mt-3 font-heading text-xl font-medium">{d}</p><Link to={to} className="btn-dark mt-6" data-testid={`cta-${t.split(" ")[0].toLowerCase()}`}>{cta}<ArrowRight size={14} /></Link></div>
        ))}
      </section>
    </div>
  );
}
