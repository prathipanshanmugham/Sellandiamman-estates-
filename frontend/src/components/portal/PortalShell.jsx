import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useMeta } from "../../lib/api";
import { Logo } from "../brand/Logo";
import { Notifications } from "../NotificationBell";

// Frame shared by the customer portals (tenant, owner / lessor, buyer, investor): logo, notifications, sign-out and tabs.
export function PortalShell({ kind, home, title, tabs, footer }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  useMeta({ title, noindex: true });
  return (
    <div className="min-h-screen bg-slate-50" data-testid={`${kind}-portal`}>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
          <Link to={home} aria-label={`${title} home`} className="min-w-0"><Logo size="sm" /></Link>
          <div className="flex shrink-0 items-center gap-1 text-sm sm:gap-3">
            <span className="hidden text-slate-600 md:inline" data-testid={`${kind}-name`}>{user.name}</span>
            <Notifications />
            <button className="flex items-center gap-1 p-2 text-slate-600 hover:text-slate-900" onClick={async () => { await logout(); nav(`/login/${kind}`); }} data-testid={`${kind}-logout`} aria-label="Sign out"><LogOut size={16} /><span className="hidden sm:inline">Sign out</span></button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 sm:px-4" aria-label={title}>
          {tabs.map(([to, l]) => <NavLink key={to} to={to} end={to === home} className={({ isActive }) => `shrink-0 border-b-2 px-3 py-2.5 text-sm ${isActive ? "border-slate-900 font-semibold text-slate-900" : "border-transparent text-slate-600 hover:text-slate-900"}`} data-testid={`${kind}-tab-${l.split(" ")[0].toLowerCase()}`}>{l}</NavLink>)}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8"><Outlet /></main>
      {footer && <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-slate-500 sm:px-6">{footer}</footer>}
    </div>
  );
}

export function Loading({ d, what = "your details" }) {
  if (d === false) return <p className="text-sm text-slate-500">Could not load {what}. Refresh to try again.</p>;
  return <p className="text-sm text-slate-500">Loading…</p>;
}
