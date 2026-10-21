import { createContext, useContext, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Menu, X, Phone, Mail, MapPin, MessageCircle, Heart, Facebook, Instagram, Youtube, Linkedin, Globe, Eye, UserRound } from "lucide-react";
import { api, store, waLink, useShortlist, telLink, cachedGet, placeUrl } from "../../lib/api";
import { DEFAULT_SITE } from "../../lib/content";
import { Logo } from "../brand/Logo";

const SiteCtx = createContext({ content: DEFAULT_SITE, branches: [] });
export const useSite = () => useContext(SiteCtx);

const NAV = [["/properties", "Properties"], ["/services", "Services"], ["/insights", "Insights"], ["/list-property", "List your property"], ["/contact", "Contact"]];

// Kept for older imports: the brand lockup, or an uploaded logo when an administrator has set one.
export function Wordmark({ dark = false, logo, size = "md", stacked = false }) {
  if (logo) return <img src={logo} alt="Sellandiamman Estates" className="h-10 w-auto" />;
  return <Logo tone={dark ? "dark" : "light"} size={size} stacked={stacked} />;
}

function Header({ site }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const saved = useShortlist();
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-md">
      <div className="container-x flex h-16 items-center justify-between gap-4">
        <Link to="/" data-testid="site-logo-link" aria-label="Sellandiamman Estates home"><Wordmark logo={site.logo} /></Link>
        <nav className="hidden items-center gap-6 lg:flex" aria-label="Main">
          {NAV.map(([to, l]) => (
            <NavLink key={to} to={to} data-testid={`nav-${to.slice(1)}`} className={({ isActive }) => `text-sm transition-colors ${isActive ? "font-semibold text-slate-900" : "text-slate-600 hover:text-slate-900"}`}>{l}</NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <Link to="/shortlist" className="relative p-2 text-slate-600 hover:text-slate-900" aria-label={`Saved properties (${saved.length})`} data-testid="nav-shortlist">
            <Heart size={19} />
            {saved.length > 0 && <span className="absolute right-0.5 top-0.5 min-w-[16px] bg-slate-900 px-1 text-center text-[10px] font-semibold leading-4 text-white">{saved.length}</span>}
          </Link>
          <Link to="/login" className="btn-line btn-sm hidden lg:inline-flex" data-testid="nav-customer-login"><UserRound size={15} />Customer login</Link>
          <button className="p-2 lg:hidden" onClick={() => setOpen(!open)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} data-testid="mobile-menu-toggle">{open ? <X /> : <Menu />}</button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-slate-200 bg-white lg:hidden" data-testid="mobile-menu" aria-label="Main">
          {NAV.map(([to, l]) => <Link key={to} to={to} className="block border-b border-slate-100 px-5 py-3.5 text-sm">{l}</Link>)}
          <Link to="/shortlist" className="block border-b border-slate-100 px-5 py-3.5 text-sm">Saved properties ({saved.length})</Link>
          <Link to="/login" className="flex items-center gap-2 px-5 py-3.5 text-sm font-semibold" data-testid="mobile-customer-login"><UserRound size={16} />Customer login · tenant, owner, buyer, investor</Link>
        </nav>
      )}
    </header>
  );
}

const SOCIAL = { facebook: Facebook, instagram: Instagram, youtube: Youtube, linkedin: Linkedin, x: Globe, google_business: Globe };

function Footer({ site }) {
  const social = Object.entries(site.social || {}).filter(([, v]) => v);
  return (
    <footer className="relative overflow-hidden bg-slate-900 text-slate-300">
      <div className="container-x grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Wordmark dark stacked />
          <p className="mt-5 text-sm text-slate-400">{site.content.footer_tagline}</p>
          {site.rera_no && <p className="mt-3 text-xs text-slate-500" data-testid="footer-rera">TNRERA agent registration: {site.rera_no}</p>}
          {social.length > 0 && <div className="mt-5 flex gap-2">{social.map(([k, url]) => { const I = SOCIAL[k] || Globe; return <a key={k} href={url} target="_blank" rel="noopener noreferrer" aria-label={k.replace("_", " ")} className="border border-slate-700 p-2 text-slate-400 hover:border-slate-500 hover:text-white"><I size={16} /></a>; })}</div>}
        </div>
        <div>
          <p className="eyebrow !text-slate-500">Services</p>
          <ul className="mt-4 space-y-2 text-sm">{site.content.services.slice(0, 7).map((s) => <li key={s.slug}><Link className="hover:text-white" to={`/services/${s.slug}`}>{s.title}</Link></li>)}</ul>
          {site.branches.length > 0 && <><p className="eyebrow mt-8 !text-slate-500">Properties by town</p>
            <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm" data-testid="footer-towns">{site.branches.map((b) => <li key={b.id}><Link className="hover:text-white" to={placeUrl(b.city)}>{b.city}</Link></li>)}</ul></>}
        </div>
        <div>
          <p className="eyebrow !text-slate-500">Company</p>
          <ul className="mt-4 space-y-2 text-sm">
            {[["/about", "About us"], ["/insights", "Insights & guides"], ["/requirement", "Post your requirement"], ["/faq", "FAQ"], ["/legal/privacy", "Privacy policy"], ["/legal/terms", "Terms of service"], ["/legal/disclaimer", "Listing disclaimer"], ["/legal/cookies", "Cookie policy"]].map(([to, l]) => <li key={to}><Link className="hover:text-white" to={to}>{l}</Link></li>)}
          </ul>
        </div>
        <div className="space-y-3 text-sm" data-testid="footer-contact">
          <p className="eyebrow !text-slate-500">Contact</p>
          {site.address && <p className="flex gap-2"><MapPin size={16} className="mt-0.5 shrink-0" />{site.address}</p>}
          {site.branches.length > 1 && <p className="text-xs text-slate-400">Branches: {site.branches.map((b) => b.name).join(" · ")}. <Link to="/contact" className="underline">Addresses</Link></p>}
          {site.phone && <a href={telLink(site.phone)} className="flex gap-2 hover:text-white"><Phone size={16} className="shrink-0" />{site.phone}</a>}
          {site.email && <a href={`mailto:${site.email}`} className="flex gap-2 break-all hover:text-white"><Mail size={16} className="shrink-0" />{site.email}</a>}
          {site.office_hours && <p className="text-slate-500">{site.office_hours}</p>}
        </div>
      </div>
      <div className="border-t border-slate-800">
        <div className="container-x flex flex-col justify-between gap-2 py-5 text-xs text-slate-500 sm:flex-row">
          <span>© {new Date().getFullYear()} Sellandiamman Estates. All rights reserved.</span>
          <span className="flex flex-wrap gap-x-4 gap-y-1"><span>Listings are subject to verification and availability. <Link to="/legal/disclaimer" className="underline">Disclaimer</Link></span>
            <Link to="/login" className="underline hover:text-slate-300" data-testid="footer-customer-login">Customer login</Link>
            <Link to="/erp/login" className="underline hover:text-slate-300" data-testid="footer-staff-login">Staff sign in</Link></span>
        </div>
      </div>
    </footer>
  );
}

function CookieBanner() {
  const [show, setShow] = useState(() => !store.get("se_cookie_consent", null));
  if (!show) return null;
  const choose = (v) => { store.set("se_cookie_consent", v); setShow(false); };
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-lg" data-testid="cookie-banner" role="region" aria-label="Cookie notice">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-slate-600">We use only essential cookies (for signing in). No advertising trackers. <Link to="/legal/cookies" className="underline">Cookie policy</Link></p>
        <div className="flex gap-2">
          <button className="btn-line btn-sm" onClick={() => choose("essential")} data-testid="cookie-essential-btn">Essential only</button>
          <button className="btn-dark btn-sm" onClick={() => choose("all")} data-testid="cookie-accept-btn">OK</button>
        </div>
      </div>
    </div>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

// Staff can look at unpublished website-editor changes by opening any page with ?preview=draft
const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch { /* storage off */ } } };
function usePreviewDraft() {
  const { search } = useLocation();
  const asked = new URLSearchParams(search).get("preview") === "draft";
  if (asked) ss.set("se_preview", "1");
  const [on, setOn] = useState(asked || ss.get("se_preview") === "1");
  const [draft, setDraft] = useState(null);
  useEffect(() => { if (asked) setOn(true); }, [asked]);
  useEffect(() => {
    if (!on) { setDraft(null); return; }
    api.get("/cms/site").then((r) => setDraft(r.data.draft)).catch(() => setDraft(false));
  }, [on, search]);
  const exit = () => { ss.set("se_preview", ""); setOn(false); };
  return [on ? draft : null, exit];
}

export default function SiteLayout() {
  const [settings, setSettings] = useState({});
  const [content, setContent] = useState(DEFAULT_SITE);
  const [branches, setBranches] = useState([]);
  const [draft, exitPreview] = usePreviewDraft();
  useEffect(() => {
    cachedGet("/public/settings").then(setSettings).catch(() => {});
    cachedGet("/public/site").then(setContent).catch(() => {});
    cachedGet("/public/branches").then(setBranches).catch(() => {});
  }, []);
  const c = draft || content;
  const site = { ...settings, content: c, branches, announcement: c.announcement, testimonials: c.testimonials, preview: !!draft };
  const wa = waLink(site.whatsapp, "Hello Sellandiamman Estates, I have an enquiry.");
  return (
    <SiteCtx.Provider value={site}>
      <ScrollToTop />
      <div className="flex min-h-screen flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3">Skip to content</a>
        {draft && <div className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-center text-xs font-medium text-amber-900" data-testid="draft-preview-banner"><Eye size={14} />Previewing unpublished website changes. Visitors still see the published version. <Link to="/erp/website" className="underline">Back to the editor</Link><button className="underline" onClick={exitPreview}>Exit preview</button></div>}
        {draft === false && <div className="bg-amber-100 px-4 py-2 text-center text-xs text-amber-900">Sign in as staff with website access to preview unpublished changes. <button className="underline" onClick={exitPreview}>Close</button></div>}
        {site.demo_mode && <div className="bg-brand-wash py-1.5 text-center text-xs text-slate-600" data-testid="demo-banner">Sample listings shown for demonstration. They are not real properties.</div>}
        {site.announcement && <div className="bg-slate-900 px-4 py-2 text-center text-xs font-medium text-white" data-testid="announcement-bar">{site.announcement}</div>}
        <Header site={site} />
        <main id="main" className="flex-1"><Outlet /></main>
        <Footer site={site} />
        {wa && <a href={wa} target="_blank" rel="noopener noreferrer" data-testid="whatsapp-float-btn" aria-label="Chat on WhatsApp" className="fixed bottom-24 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg hover:bg-slate-700 sm:right-6"><MessageCircle size={22} /></a>}
        <CookieBanner />
      </div>
    </SiteCtx.Provider>
  );
}
