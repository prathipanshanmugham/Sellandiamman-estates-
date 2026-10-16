import { createContext, useContext, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Menu, X, Phone, Mail, MapPin, MessageCircle } from "lucide-react";
import { api, waLink } from "../../lib/api";
import { SERVICES } from "../../lib/content";

const SiteCtx = createContext({});
export const useSite = () => useContext(SiteCtx);

const NAV = [["/properties", "Properties"], ["/services", "Services"], ["/list-property", "List your property"], ["/about", "About"], ["/contact", "Contact"]];

export function Wordmark({ dark = false, logo }) {
  if (logo) return <img src={logo} alt="Sellandiamman Estates" className="h-10 w-auto" />;
  return (
    <span className="flex flex-col leading-none">
      <span className={`font-heading text-lg font-semibold tracking-tight ${dark ? "text-white" : "text-slate-900"}`}>SELLANDIAMMAN</span>
      <span className={`text-[10px] font-semibold tracking-[0.42em] ${dark ? "text-slate-400" : "text-slate-500"}`}>ESTATES</span>
    </span>
  );
}

function Header({ site }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-md">
      <div className="container-x flex h-16 items-center justify-between">
        <Link to="/" data-testid="site-logo-link"><Wordmark logo={site.logo} /></Link>
        <nav className="hidden items-center gap-7 md:flex">
          {NAV.map(([to, l]) => (
            <NavLink key={to} to={to} data-testid={`nav-${to.slice(1)}`} className={({ isActive }) => `text-sm transition-colors ${isActive ? "text-slate-900 font-semibold" : "text-slate-600 hover:text-slate-900"}`}>{l}</NavLink>
          ))}
          <Link to="/erp/login" className="btn-line btn-sm" data-testid="nav-staff-login">Staff login</Link>
        </nav>
        <button className="md:hidden" onClick={() => setOpen(!open)} aria-label="Menu" data-testid="mobile-menu-toggle">{open ? <X /> : <Menu />}</button>
      </div>
      {open && (
        <nav className="border-t border-slate-200 bg-white md:hidden" data-testid="mobile-menu">
          {NAV.map(([to, l]) => <Link key={to} to={to} className="block border-b border-slate-100 px-5 py-3 text-sm">{l}</Link>)}
          <Link to="/erp/login" className="block px-5 py-3 text-sm font-semibold">Staff login</Link>
        </nav>
      )}
    </header>
  );
}

function Footer({ site }) {
  return (
    <footer className="bg-slate-900 text-slate-300">
      <div className="container-x grid gap-10 py-14 md:grid-cols-4">
        <div className="md:col-span-1">
          <Wordmark dark />
          <p className="mt-4 text-sm text-slate-400">A Sellandiamman Group company. Brokerage, property management and short-stay services in Erode and Perundurai.</p>
        </div>
        <div>
          <p className="eyebrow !text-slate-500">Services</p>
          <ul className="mt-4 space-y-2 text-sm">{SERVICES.slice(0, 6).map((s) => <li key={s.slug}><Link className="hover:text-white" to={`/services/${s.slug}`}>{s.title}</Link></li>)}</ul>
        </div>
        <div>
          <p className="eyebrow !text-slate-500">Company</p>
          <ul className="mt-4 space-y-2 text-sm">
            {[["/about", "About us"], ["/faq", "FAQ"], ["/contact", "Contact"], ["/legal/privacy", "Privacy policy"], ["/legal/terms", "Terms of service"], ["/legal/disclaimer", "Listing disclaimer"], ["/legal/cookies", "Cookie policy"]].map(([to, l]) => <li key={to}><Link className="hover:text-white" to={to}>{l}</Link></li>)}
          </ul>
        </div>
        <div className="space-y-3 text-sm" data-testid="footer-contact">
          <p className="eyebrow !text-slate-500">Contact</p>
          <p className="flex gap-2"><MapPin size={16} className="mt-0.5 shrink-0" />{site.address}</p>
          <p className="flex gap-2"><Phone size={16} />{site.phone}</p>
          <p className="flex gap-2"><Mail size={16} />{site.email}</p>
          <p className="text-slate-500">{site.office_hours}</p>
        </div>
      </div>
      <div className="border-t border-slate-800">
        <div className="container-x flex flex-col justify-between gap-2 py-5 text-xs text-slate-500 sm:flex-row">
          <span>© {new Date().getFullYear()} Sellandiamman Estates. All rights reserved.</span>
          <span>Listings are subject to verification and availability. See our disclaimer.</span>
        </div>
      </div>
    </footer>
  );
}

function CookieBanner() {
  const [show, setShow] = useState(() => !localStorage.getItem("se_cookie_consent"));
  if (!show) return null;
  const choose = (v) => { localStorage.setItem("se_cookie_consent", v); setShow(false); };
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white p-4 shadow-lg" data-testid="cookie-banner">
      <div className="container-x flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <p className="text-sm text-slate-600">We use only essential cookies (staff login). No advertising trackers. <Link to="/legal/cookies" className="underline">Cookie policy</Link></p>
        <div className="flex gap-2">
          <button className="btn-line btn-sm" onClick={() => choose("essential")} data-testid="cookie-essential-btn">Essential only</button>
          <button className="btn-dark btn-sm" onClick={() => choose("all")} data-testid="cookie-accept-btn">Accept</button>
        </div>
      </div>
    </div>
  );
}

export default function SiteLayout() {
  const [site, setSite] = useState({});
  useEffect(() => { api.get("/public/settings").then((r) => setSite(r.data)).catch(() => {}); }, []);
  const wa = waLink(site.whatsapp, "Hello Sellandiamman Estates, I have an enquiry.");
  return (
    <SiteCtx.Provider value={site}>
      <div className="flex min-h-screen flex-col">
        {site.demo_mode && <div className="bg-slate-100 py-1.5 text-center text-xs text-slate-600" data-testid="demo-banner">Sample listings shown for demonstration. They are not real properties.</div>}
        <Header site={site} />
        <main className="flex-1"><Outlet /></main>
        <Footer site={site} />
        <a href={wa || "/contact"} target={wa ? "_blank" : undefined} rel="noreferrer" data-testid="whatsapp-float-btn" aria-label="WhatsApp enquiry" className="fixed bottom-20 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg hover:bg-slate-700"><MessageCircle size={22} /></a>
        <CookieBanner />
      </div>
    </SiteCtx.Provider>
  );
}
