import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Search, MapPin, Phone, MessageCircle } from "lucide-react";
import { api, useMeta, fmtDate, imgSrc, SITE_URL, useCached, placeUrl, telLink, waLink, mapsUrl } from "../../lib/api";
import { Markdown } from "../../lib/markdown";
import PropertyCard from "../../components/public/PropertyCard";
import { useSite } from "../../components/public/SiteLayout";
import { Mark } from "../../components/brand/Logo";

const TABS = [["residential,apartment,villa", "Homes", "sale"], ["land,agricultural", "Land & plots", "sale"], ["commercial,shop,office,industrial,warehouse,factory_shed", "Commercial & industrial", ""], ["", "Rentals", "rent"], ["", "Short stays", "short_stay"]];

function HeroSearch() {
  const nav = useNavigate();
  const towns = useCached("/public/locations", []);
  const [f, setF] = useState({ transaction: "sale", category: "", city: "", max_price: "" });
  const go = (e) => { e.preventDefault(); const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)); nav(`/properties?${q}`); };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={go} className="grid gap-px border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-5" data-testid="hero-search-form" role="search">
      <select className="bg-white px-4 py-4 text-sm focus:outline-none" value={f.transaction} onChange={set("transaction")} aria-label="Looking to" data-testid="hero-transaction-select"><option value="sale">Buy</option><option value="rent">Rent</option><option value="lease">Lease</option><option value="short_stay">Short stay</option></select>
      <select className="bg-white px-4 py-4 text-sm focus:outline-none" value={f.category} onChange={set("category")} aria-label="Property type" data-testid="hero-category-select"><option value="">All types</option><option value="residential,apartment,villa">Homes</option><option value="land,agricultural">Land / plots</option><option value="commercial,shop,office">Shops & offices</option><option value="industrial,warehouse,factory_shed">Industrial / warehouse</option></select>
      <select className="bg-white px-4 py-4 text-sm focus:outline-none" value={f.city} onChange={set("city")} aria-label="Town" data-testid="hero-city-select"><option value="">All towns</option>{towns.map((t) => <option key={t.id} value={t.name}>{t.name}{t.listings ? ` (${t.listings})` : ""}</option>)}</select>
      <input className="bg-white px-4 py-4 text-sm focus:outline-none" type="number" min="0" inputMode="numeric" placeholder="Max budget (₹)" value={f.max_price} onChange={set("max_price")} aria-label="Max budget" data-testid="hero-maxprice-input" />
      <button className="flex items-center justify-center gap-2 bg-slate-900 px-6 py-4 text-sm font-medium text-white hover:bg-slate-700 sm:col-span-2 lg:col-span-1" data-testid="hero-search-btn"><Search size={16} />Search</button>
    </form>
  );
}

function Heading({ s, fallback, dark, link, linkLabel = "View all" }) {
  return (
    <div className="mb-8 flex items-end justify-between gap-4">
      <div>{s.eyebrow && <p className={`eyebrow ${dark ? "!text-slate-400" : ""}`}>{s.eyebrow}</p>}<h2 className={`font-heading text-2xl font-semibold sm:text-3xl ${s.eyebrow ? "mt-3" : ""}`}>{s.title || fallback}</h2>{s.subtitle && <p className={`mt-2 max-w-2xl text-sm ${dark ? "text-slate-400" : "text-slate-600"}`}>{s.subtitle}</p>}</div>
      {link && <Link to={link} className={`flex shrink-0 items-center gap-1 text-sm font-medium ${dark ? "text-slate-300 hover:text-white" : "text-slate-700 hover:text-slate-900"}`}>{linkLabel} <ArrowRight size={14} /></Link>}
    </div>
  );
}

function Row({ s, items, link, fallback }) {
  if (!items?.length) return null;
  return (
    <section className="container-x py-14" data-testid={`section-${s.type}`}>
      <Heading s={s} fallback={fallback} link={link} />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{items.map((p) => <PropertyCard key={p.listing_id} p={p} />)}</div>
    </section>
  );
}

function CategoryTabs({ s }) {
  const [tab, setTab] = useState(0);
  const [items, setItems] = useState([]);
  useEffect(() => {
    const [cat, , tx] = TABS[tab];
    api.get("/public/properties", { params: { category: cat || undefined, transaction: tx || undefined, limit: 3 } }).then((r) => setItems(r.data.items)).catch(() => setItems([]));
  }, [tab]);
  return (
    <section className="border-y border-slate-200 bg-slate-50 py-14" data-testid="category-tabs-section">
      <div className="container-x">
        {s.title && <h2 className="mb-6 font-heading text-2xl font-semibold sm:text-3xl">{s.title}</h2>}
        <div className="-mx-4 mb-8 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">{TABS.map(([, l], i) => <button key={l} onClick={() => setTab(i)} className={`shrink-0 border px-4 py-2 text-sm ${tab === i ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"}`} aria-pressed={tab === i} data-testid={`home-tab-${i}`}>{l}</button>)}</div>
        {items.length ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{items.map((p) => <PropertyCard key={p.listing_id} p={p} />)}</div> : <p className="text-sm text-slate-500">No listings in this category right now. <Link to="/requirement" className="underline">Tell us your requirement</Link>.</p>}
      </div>
    </section>
  );
}

function Towns({ s }) {
  const towns = useCached("/public/locations", []);
  if (!towns.length) return null;
  return (
    <section className="container-x py-14" data-testid="towns-section">
      <Heading s={s} fallback="Properties by town" />
      <div className="grid gap-px border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-5">
        {towns.map((t) => (
          <Link key={t.id} to={placeUrl(t.name)} className="group bg-white p-5 hover:bg-slate-50" data-testid={`town-link-${t.slug}`}>
            <p className="flex items-center gap-1.5 font-heading text-lg font-semibold"><MapPin size={15} className="text-slate-400" />{t.name}</p>
            <p className="mt-1 text-xs text-slate-500">{t.listings || 0} {t.listings === 1 ? "listing" : "listings"}{t.district ? ` · ${t.district} district` : ""}</p>
            <p className="mt-3 line-clamp-2 text-xs text-slate-500">{t.localities.filter((l) => l.listings).slice(0, 4).map((l) => l.name).join(" · ")}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Services({ s, services }) {
  return (
    <section className="relative overflow-hidden bg-slate-900 py-20 text-white" data-testid="services-section">
      <Mark className="pointer-events-none absolute -bottom-16 -right-24 h-80 w-auto opacity-[0.06]" color="#FFFFFF" />
      <div className="container-x relative">
        {s.eyebrow && <p className="eyebrow !text-slate-400">{s.eyebrow}</p>}
        <h2 className="mt-3 max-w-2xl font-heading text-3xl font-semibold sm:text-4xl">{s.title || "What we do"}</h2>
        <div className="mt-12 grid gap-px bg-slate-700 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((x) => <Link key={x.slug} to={`/services/${x.slug}`} className="group bg-slate-900 p-6 transition-colors hover:bg-slate-800" data-testid={`service-link-${x.slug}`}><h3 className="font-heading text-lg font-medium">{x.title}</h3><p className="mt-2 text-sm text-slate-400">{x.summary}</p><ArrowRight size={16} className="mt-4 text-slate-500 transition-transform group-hover:translate-x-1" /></Link>)}
        </div>
      </div>
    </section>
  );
}

function Why({ s, why }) {
  return (
    <section className="border-t border-slate-200 bg-slate-50" data-testid="why-section">
      <div className="container-x grid gap-12 py-20 lg:grid-cols-[1fr_1.4fr]">
        <div>{s.eyebrow && <p className="eyebrow">{s.eyebrow}</p>}<h2 className="mt-3 font-heading text-3xl font-semibold">{s.title}</h2>{s.image && <img src={imgSrc(s.image)} alt="" className="mt-8 aspect-[4/3] w-full object-cover" loading="lazy" />}</div>
        <div className="grid content-start gap-8 sm:grid-cols-2">{why.map((w) => <div key={w.title} className="border-t border-slate-900 pt-5"><h3 className="font-heading text-lg font-semibold">{w.title}</h3><p className="mt-2 text-sm text-slate-600">{w.body}</p></div>)}</div>
      </div>
    </section>
  );
}

function Insights({ s }) {
  const [posts, setPosts] = useState([]);
  useEffect(() => { api.get("/public/posts", { params: { limit: 3 } }).then((r) => setPosts(r.data.items)).catch(() => {}); }, []);
  if (!posts.length) return null;
  return (
    <section className="container-x py-20" data-testid="insights-teaser">
      <Heading s={s} fallback="Guides and market notes" link="/insights" linkLabel="All articles" />
      <div className="grid gap-6 md:grid-cols-3">{posts.map((p) => <Link key={p.slug} to={`/insights/${p.slug}`} className="group block"><div className="aspect-[16/10] overflow-hidden bg-slate-100">{p.cover_image && <img src={imgSrc(p.cover_image)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />}</div><p className="mt-4 text-xs text-slate-500">{fmtDate(p.published_at)} · {p.reading_minutes} min read</p><h3 className="mt-1 font-heading text-lg font-semibold group-hover:underline">{p.title}</h3><p className="mt-1 line-clamp-2 text-sm text-slate-600">{p.excerpt}</p></Link>)}</div>
    </section>
  );
}

function Stats({ s }) {
  if (!s.items?.length) return null;
  return (
    <section className="border-y border-slate-200 bg-white" data-testid="stats-section">
      <div className="container-x py-12">{s.title && <h2 className="mb-6 font-heading text-2xl font-semibold">{s.title}</h2>}
        <dl className="grid grid-cols-2 gap-6 md:grid-cols-4">{s.items.map((i) => <div key={i.label} className="border-l-2 border-slate-900 pl-4"><dt className="text-xs uppercase tracking-wider text-slate-500">{i.label}</dt><dd className="mt-1 font-heading text-3xl font-semibold tabular">{i.value}</dd></div>)}</dl>
      </div>
    </section>
  );
}

export function BranchCards({ branches, phone, whatsapp, compact }) {
  if (!branches?.length) return null;
  return (
    <div className={`grid gap-px border border-slate-200 bg-slate-200 sm:grid-cols-2 ${compact ? "" : "lg:grid-cols-3"}`} data-testid="branch-cards">
      {branches.map((b) => {
        const ph = b.phone || phone;
        const wa = waLink(b.whatsapp || whatsapp, `Hello Sellandiamman Estates ${b.name}, I have an enquiry.`);
        return (
          <div key={b.id} className="bg-white p-5" data-testid={`branch-${b.id}`}>
            <p className="font-heading text-lg font-semibold">{b.name}{b.is_head_office && <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wider text-slate-500">Head office</span>}</p>
            {b.address && <p className="mt-2 flex gap-2 text-sm text-slate-600"><MapPin size={15} className="mt-0.5 shrink-0" />{b.address}</p>}
            <p className="mt-1 text-xs text-slate-500">{b.office_hours || "Mon–Sat, 9:30 AM – 6:30 PM"}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {ph && !ph.includes("00000") && <a href={telLink(ph)} className="btn-line btn-sm"><Phone size={13} />Call</a>}
              {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="btn-line btn-sm"><MessageCircle size={13} />WhatsApp</a>}
              <a href={b.gbp_url || mapsUrl(b.lat, b.lng, `Sellandiamman Estates ${b.city}`)} target="_blank" rel="noopener noreferrer" className="btn-line btn-sm"><MapPin size={13} />Directions</a>
              <Link to={placeUrl(b.city)} className="btn-line btn-sm">{b.city} listings</Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Branches({ s, site }) {
  if (!site.branches.length) return null;
  return (
    <section className="container-x py-16" data-testid="branches-section">
      <Heading s={s} fallback="Our branches" link="/contact" linkLabel="Contact" />
      <BranchCards branches={site.branches} phone={site.phone} whatsapp={site.whatsapp} />
    </section>
  );
}

function Cta() {
  return (
    <section className="container-x my-20 grid gap-px border border-slate-200 bg-slate-200 md:grid-cols-3" data-testid="cta-section">
      {[["Buyers", "Looking for a home, plot or investment?", "/properties?transaction=sale", "Browse properties"], ["Tenants & businesses", "Homes, shops, offices, sheds and warehouses.", "/properties?transaction=rent", "Find a rental"], ["Property owners", "Sell, rent out or get your property managed.", "/list-property", "List your property"]].map(([t, d, to, cta]) => (
        <div key={t} className="bg-white p-8"><p className="eyebrow">{t}</p><p className="mt-3 font-heading text-xl font-medium">{d}</p><Link to={to} className="btn-dark mt-6" data-testid={`cta-${t.split(" ")[0].toLowerCase()}`}>{cta}<ArrowRight size={14} /></Link></div>
      ))}
    </section>
  );
}

export default function Home() {
  const site = useSite();
  const c = site.content;
  const towns = site.branches.map((b) => b.city);
  const townText = towns.length ? towns.join(", ") : "Perundurai, Erode, Kadambur, Sathyamangalam and Namakkal";
  const org = { "@context": "https://schema.org", "@type": "RealEstateAgent", "@id": `${SITE_URL}/#org`, name: "Sellandiamman Estates", url: SITE_URL, logo: `${SITE_URL}/icon-512.png`, image: `${SITE_URL}/og-image.jpg`, telephone: site.phone, email: site.email, address: { "@type": "PostalAddress", streetAddress: site.address, addressRegion: "Tamil Nadu", addressCountry: "IN" }, areaServed: towns.map((t) => ({ "@type": "City", name: t })) };
  useMeta({ title: c.seo?.title || `Property services in ${townText}`, description: c.seo?.description || `Verified homes, plots, shops, offices, warehouses and factory sheds for sale, rent and lease in ${townText}. Property management, short stays and co-investment.`, path: "/", jsonLd: org });
  const [featured, setFeatured] = useState([]);
  const [recent, setRecent] = useState([]);
  useEffect(() => {
    api.get("/public/properties", { params: { featured: true, limit: 3 } }).then((r) => setFeatured(r.data.items)).catch(() => {});
    api.get("/public/properties", { params: { limit: 6 } }).then((r) => setRecent(r.data.items)).catch(() => {});
  }, []);
  const h = c.hero;
  const render = (s) => {
    switch (s.type) {
      case "featured": return <Row key={s.id} s={s} items={featured} link="/properties" fallback="Featured properties" />;
      case "recent": return <Row key={s.id} s={s} items={recent} link="/properties?sort=latest" fallback="Recently added" />;
      case "category_tabs": return <CategoryTabs key={s.id} s={s} />;
      case "locations": return <Towns key={s.id} s={s} />;
      case "services": return <Services key={s.id} s={s} services={c.services} />;
      case "stats": return <Stats key={s.id} s={s} />;
      case "why": return <Why key={s.id} s={s} why={c.why} />;
      case "insights": return <Insights key={s.id} s={s} />;
      case "testimonials": return c.testimonials?.length ? <section key={s.id} className="border-t border-slate-200 bg-slate-50 py-16" data-testid="testimonials-section"><div className="container-x">{s.title && <h2 className="mb-6 font-heading text-2xl font-semibold">{s.title}</h2>}<div className="grid gap-6 md:grid-cols-3">{c.testimonials.map((t, i) => <blockquote key={i} className="border-l-2 border-slate-900 bg-white p-6 text-sm text-slate-700">“{t.quote}”<footer className="mt-3 text-xs font-semibold text-slate-500">{t.name}</footer></blockquote>)}</div></div></section> : null;
      case "text": return s.body || s.title ? <section key={s.id} className="container-x py-14" data-testid="text-section">{s.title && <h2 className="font-heading text-2xl font-semibold sm:text-3xl">{s.title}</h2>}<div className="mt-4"><Markdown text={s.body} /></div></section> : null;
      case "branches": return <Branches key={s.id} s={s} site={site} />;
      case "cta": return <Cta key={s.id} />;
      default: return null;
    }
  };
  return (
    <div>
      <section className="relative">
        <div className="absolute inset-0"><img src={imgSrc(h.image || "/images/villa.jpg")} alt="" className="h-full w-full object-cover" /><div className="absolute inset-0 bg-gradient-to-r from-slate-950/80 via-slate-900/60 to-slate-900/30" /></div>
        <div className="container-x relative py-20 sm:py-28 lg:py-36">
          {h.eyebrow && <p className="eyebrow fade-up !text-slate-300">{h.eyebrow}</p>}
          <h1 className="fade-up mt-4 max-w-3xl font-heading text-4xl font-semibold leading-[1.05] text-white sm:text-5xl lg:text-6xl" style={{ animationDelay: "80ms" }} data-testid="hero-title">{h.title}</h1>
          {h.subtitle && <p className="fade-up mt-5 max-w-xl text-base text-slate-200 md:text-lg" style={{ animationDelay: "160ms" }}>{h.subtitle}</p>}
          {h.show_search !== false && <div className="fade-up mt-10 max-w-5xl" style={{ animationDelay: "240ms" }}><HeroSearch /></div>}
          <p className="fade-up mt-4 text-sm text-slate-300" style={{ animationDelay: "300ms" }}>Can't find it? <Link to="/requirement" className="font-semibold text-white underline underline-offset-4" data-testid="hero-requirement-link">Tell us what you need</Link> and we'll match it.</p>
        </div>
      </section>
      {c.sections.filter((s) => s.visible).map(render)}
    </div>
  );
}

