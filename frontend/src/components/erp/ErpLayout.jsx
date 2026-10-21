import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Bell, LayoutDashboard, Users, Building2, UserSquare, Handshake, FileText, Wrench, CalendarDays, CalendarRange, Wallet, CheckSquare, FolderLock, BarChart3, Settings, ShieldCheck, ScrollText, Menu, LogOut, Stamp, Newspaper, KeyRound, ExternalLink, X, Gauge, Contact, FileSignature, PiggyBank, Calculator, PanelsTopLeft, Network, MapPinned } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { useAuth } from "../../lib/auth";
import { api, fmtDateTime, branchApi, useBranchPick, cachedGet } from "../../lib/api";
import { Logo } from "../brand/Logo";

const NAV = [
  ["Work", [["/erp", "Dashboard", LayoutDashboard, "dashboard"], ["/erp/ceo", "CEO dashboard", Gauge, "ceo"], ["/erp/calendar", "Calendar", CalendarRange, null], ["/erp/tasks", "Tasks", CheckSquare, "tasks"], ["/erp/approvals", "Approvals", Stamp, null]]],
  ["Customers & sales", [["/erp/customers", "Customers", Contact, "customers"], ["/erp/leads", "CRM & Leads", Users, "leads"], ["/erp/properties", "Properties", Building2, "properties"], ["/erp/owners", "Owners", UserSquare, "owners"], ["/erp/deals", "Deals", Handshake, "deals"], ["/erp/agreements", "Agreements", FileSignature, "agreements"]]],
  ["Operations", [["/erp/leases", "Leases & Rent", FileText, "leases"], ["/erp/maintenance", "Maintenance", Wrench, "maintenance"], ["/erp/short-stay", "Short stays", CalendarDays, "shortstay"], ["/erp/documents", "Documents", FolderLock, "documents"]]],
  ["Money", [["/erp/finance", "Finance", Wallet, "finance"], ["/erp/investors", "Investors", PiggyBank, "investors"], ["/erp/reports", "Reports", BarChart3, "reports"], ["/erp/tools", "Tools & calculators", Calculator, null]]],
  ["Website", [["/erp/website", "Website editor", PanelsTopLeft, "cms"], ["/erp/insights", "Insights", Newspaper, "cms"]]],
  ["Team & admin", [["/erp/team", "Team chart", Network, null], ["/erp/places", "Branches & places", MapPinned, "settings|properties"], ["/erp/users", "Users & Roles", ShieldCheck, "users"], ["/erp/settings", "Settings", Settings, "settings|cms"], ["/erp/audit", "Audit Log", ScrollText, "audit"]]],
];

// Staff who work across branches choose one to narrow every list, total and report; "All" shows everything they may see.
function BranchPicker({ user, className = "" }) {
  const pick = useBranchPick();
  const [branches, setBranches] = useState([]);
  useEffect(() => { cachedGet("/branches").then(setBranches).catch(() => {}); }, []);
  const mine = user.all_branches ? branches : branches.filter((b) => (user.branch_ids || []).includes(b.id));
  useEffect(() => { if (pick && branches.length && !mine.some((b) => b.id === pick)) branchApi.set(""); }, [branches.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (mine.length < 2) return mine.length === 1 ? <span className={`px-2 text-xs text-slate-500 ${className}`} data-testid="branch-name">{mine[0].name} branch</span> : null;
  return (
    <select className={`border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 ${className}`} value={pick} onChange={(e) => branchApi.set(e.target.value)} aria-label="Branch" data-testid="branch-picker">
      <option value="">{user.all_branches ? "All branches" : "All my branches"}</option>
      {mine.map((b) => <option key={b.id} value={b.id}>{b.name}{b.is_head_office ? " (HO)" : ""}</option>)}
    </select>
  );
}

function Notifications() {
  const [rows, setRows] = useState([]);
  const load = () => api.get("/notifications").then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  const unread = rows.filter((r) => !r.read).length;
  return (
    <Popover onOpenChange={(o) => { if (!o && unread) api.post("/notifications/read").then(load).catch(() => {}); }}>
      <PopoverTrigger className="relative p-2 text-slate-600 hover:text-slate-900" data-testid="notifications-btn" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}><Bell size={18} />{unread > 0 && <span className="absolute right-0 top-0 min-w-[16px] bg-slate-900 px-1 text-[10px] text-white" data-testid="notifications-count">{unread}</span>}</PopoverTrigger>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] rounded-sm p-0">
        <div className="max-h-96 overflow-y-auto" data-testid="notifications-list">
          {rows.length === 0 && <p className="p-4 text-sm text-slate-500">No notifications</p>}
          {rows.map((n) => <Link to={n.link || "#"} key={n.id} className={`block border-b border-slate-100 p-3 text-sm hover:bg-slate-50 ${n.read ? "" : "bg-slate-50"}`}><p className="font-medium text-slate-800">{n.title}</p>{n.body && <p className="text-xs text-slate-500">{n.body}</p>}<p className="mt-1 text-[10px] text-slate-400">{fmtDateTime(n.created_at)}</p></Link>)}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function ErpLayout() {
  const { user, logout, can } = useAuth();
  const branch = useBranchPick();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  const groups = NAV.map(([g, items]) => [g, items.filter(([, , , m]) => !m || m.split("|").some((x) => can(x)))]).filter(([, items]) => items.length);
  const side = (
    <nav className="flex h-full flex-col bg-slate-900 text-slate-300" aria-label="Staff menu">
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-5"><Link to="/erp" aria-label="Dashboard"><Logo tone="dark" size="sm" /></Link><button className="p-1 text-slate-400 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button></div>
      <div className="px-5 pt-3 lg:hidden"><BranchPicker user={user} className="w-full !border-slate-700 !bg-slate-800 !text-slate-200" /></div>
      <div className="flex-1 overflow-y-auto py-2">
        {groups.map(([g, items]) => <div key={g} className="py-2"><p className="px-5 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{g}</p>
          {items.map(([to, l, Icon]) => <NavLink key={to} to={to} end={to === "/erp"} data-testid={`erp-nav-${l.split(" ")[0].toLowerCase()}`} className={({ isActive }) => `flex items-center gap-3 px-5 py-2 text-sm transition-colors ${isActive ? "bg-slate-800 text-white" : "hover:bg-slate-800/60 hover:text-white"}`}><Icon size={16} />{l}</NavLink>)}
        </div>)}
      </div>
      <div className="border-t border-slate-800 p-4 text-xs">
        <p className="font-medium text-white" data-testid="erp-user-name">{user.name}</p><p className="text-slate-500" data-testid="erp-user-role">{user.role_label}</p>
        <div className="mt-3 flex gap-3"><Link to="/erp/security" className="text-slate-400 hover:text-white">Security</Link><a href="/" className="flex items-center gap-1 text-slate-400 hover:text-white" onClick={(e) => { e.preventDefault(); nav("/"); }}>Website <ExternalLink size={11} /></a></div>
      </div>
    </nav>
  );
  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 lg:block">{side}</aside>
      {open && <div className="fixed inset-0 z-50 flex lg:hidden"><div className="w-72 max-w-[85vw]">{side}</div><div className="flex-1 bg-slate-900/40" onClick={() => setOpen(false)} /></div>}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-3 sm:px-6">
          <div className="flex items-center gap-2"><button className="p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu" data-testid="erp-menu-toggle"><Menu size={20} /></button><span className="lg:hidden"><Logo size="sm" /></span></div>
          <span className="hidden text-xs text-slate-400 xl:block">Sellandiamman Estates · staff workspace · times in IST</span>
          <div className="flex items-center gap-0.5">
            <BranchPicker user={user} className="hidden sm:block" />
            <Notifications />
            <Link to="/erp/security" className="p-2 text-slate-600 hover:text-slate-900" aria-label="Password & 2-step sign-in" data-testid="change-password-link"><KeyRound size={18} /></Link>
            <button className="flex items-center gap-1 p-2 text-sm text-slate-600 hover:text-slate-900" onClick={async () => { await logout(); nav("/erp/login"); }} data-testid="logout-btn" aria-label="Sign out"><LogOut size={16} /><span className="hidden sm:inline">Sign out</span></button>
          </div>
        </header>
        {user.mfa_enabled === false && (user.role === "super_admin" || user.role === "director") && loc.pathname === "/erp" && <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 sm:px-6" data-testid="mfa-nudge">Your account can approve payments and change settings. <Link to="/erp/security" className="font-semibold underline">Turn on 2-step sign-in</Link> to protect it.</div>}
        <main className="p-4 sm:p-6 lg:p-8"><Outlet key={branch} /></main>
      </div>
    </div>
  );
}
