import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut, Home, IndianRupee, Receipt, MessageSquare, FileText, FileSpreadsheet, Wallet, Newspaper, CalendarDays, MoreHorizontal, X } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useMeta } from "../../lib/api";
import { Logo } from "../brand/Logo";
import { Notifications } from "../NotificationBell";

// Icon and short name for each portal section, for the phone tab bar (keyed by the last part of the path).
const SECTION = {
  "": [Home, "Home"], rent: [IndianRupee, "Rent"], bills: [Receipt, "Bills"], requests: [MessageSquare, "Requests"], documents: [FileText, "Documents"],
  statements: [FileSpreadsheet, "Statements"], payouts: [Wallet, "Payouts"], updates: [Newspaper, "Updates"], stays: [CalendarDays, "Stays"],
};
const section = (to, home) => SECTION[to === home ? "" : to.split("/").pop()] || [FileText, null];

// Frame shared by the customer portals (tenant, owner / lessor, buyer, investor): logo, notifications, sign-out and
// tabs. Tabs sit under the header on larger screens and in a bar at the bottom on phones (up to four plus "More").
export function PortalShell({ kind, home, title, tabs, footer }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [more, setMore] = useState(false);
  useMeta({ title, noindex: true });
  useEffect(() => { setMore(false); }, [loc.pathname]);
  useEffect(() => { document.body.dataset.tabbar = "1"; return () => { delete document.body.dataset.tabbar; }; }, []);
  const bar = tabs.length > 5 ? tabs.slice(0, 4) : tabs;
  const rest = tabs.length > 5 ? tabs.slice(4) : [];
  const restActive = rest.some(([to]) => loc.pathname.startsWith(to));
  const tabCls = (on) => `relative flex min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 pt-0.5 text-[10.5px] leading-tight tracking-tight min-[360px]:text-[11px] min-[360px]:tracking-normal ${on ? "font-semibold text-slate-900" : "text-slate-500"}`;
  return (
    <div className="min-h-screen bg-slate-50" data-testid={`${kind}-portal`}>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
          <Link to={home} aria-label={`${title} home`} className="flex min-h-[40px] min-w-0 items-center"><Logo size="sm" /></Link>
          <div className="flex shrink-0 items-center gap-1 text-sm sm:gap-3">
            <span className="hidden text-slate-600 md:inline" data-testid={`${kind}-name`}>{user.name}</span>
            <Notifications />
            <button className="-mr-2 flex items-center gap-1 p-2 text-slate-600 hover:text-slate-900 sm:mr-0" onClick={async () => { await logout(); nav(`/login/${kind}`); }} data-testid={`${kind}-logout`} aria-label="Sign out"><LogOut size={16} /><span className="hidden sm:inline">Sign out</span></button>
          </div>
        </div>
        <nav className="no-scrollbar mx-auto hidden max-w-6xl gap-1 overflow-x-auto px-2 sm:flex sm:px-4" aria-label={title}>
          {tabs.map(([to, l]) => <NavLink key={to} to={to} end={to === home} className={({ isActive }) => `shrink-0 border-b-2 px-3 py-2.5 text-sm ${isActive ? "border-slate-900 font-semibold text-slate-900" : "border-transparent text-slate-600 hover:text-slate-900"}`} data-testid={`${kind}-tab-${l.split(" ")[0].toLowerCase()}`}>{l}</NavLink>)}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-8 pt-5 sm:px-6 sm:py-8"><Outlet /></main>
      {footer && <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-slate-500 sm:px-6">{footer}</footer>}
      {/* phones: tab bar at the bottom, within thumb reach */}
      <div className="h-[calc(64px+env(safe-area-inset-bottom))] sm:hidden" aria-hidden="true" />
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur sm:hidden" aria-label={`${title} sections`} data-testid={`${kind}-tabbar`}>
        <div className="grid h-14" style={{ gridTemplateColumns: `repeat(${bar.length + (rest.length ? 1 : 0)}, minmax(0, 1fr))` }}>
          {bar.map(([to, l]) => {
            const [Icon, short] = section(to, home);
            return (
              <NavLink key={to} to={to} end={to === home} className={({ isActive }) => tabCls(isActive)} data-testid={`${kind}-bar-${(short || l).toLowerCase()}`}>
                {({ isActive }) => <>{isActive && <span className="absolute inset-x-4 top-0 h-0.5 bg-slate-900" />}<Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} /><span className="max-w-full truncate">{short || l}</span></>}
              </NavLink>
            );
          })}
          {rest.length > 0 && <button type="button" className={tabCls(restActive || more)} onClick={() => setMore(!more)} aria-expanded={more} data-testid={`${kind}-bar-more`}>
            {restActive && <span className="absolute inset-x-4 top-0 h-0.5 bg-slate-900" />}<MoreHorizontal size={20} /><span>More</span>
          </button>}
        </div>
      </nav>
      {more && <div className="fixed inset-0 z-[35] sm:hidden" onClick={() => setMore(false)}>
        <div className="absolute inset-0 bg-slate-900/30" />
        <div className="absolute inset-x-0 bottom-[calc(57px+env(safe-area-inset-bottom))] border-t border-slate-200 bg-white p-2 shadow-lg" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-3 pb-1 pt-2"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">More</p><button className="p-1 text-slate-500" onClick={() => setMore(false)} aria-label="Close"><X size={16} /></button></div>
          {rest.map(([to, l]) => {
            const [Icon] = section(to, home);
            return <NavLink key={to} to={to} className={({ isActive }) => `flex items-center gap-3 px-3 py-3 text-sm ${isActive ? "bg-slate-100 font-semibold text-slate-900" : "text-slate-700"}`}><Icon size={18} />{l}</NavLink>;
          })}
        </div>
      </div>}
    </div>
  );
}

export function Loading({ d, what = "your details" }) {
  if (d === false) return <p className="text-sm text-slate-500">Could not load {what}. Refresh to try again.</p>;
  return <p className="text-sm text-slate-500">Loading…</p>;
}
