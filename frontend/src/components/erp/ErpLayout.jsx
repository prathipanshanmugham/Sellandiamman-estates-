import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Bell, LayoutDashboard, Users, Building2, UserSquare, Handshake, FileText, Wrench, CalendarDays, Wallet, CheckSquare, FolderLock, BarChart3, Settings, ShieldCheck, ScrollText, Menu, LogOut, Stamp, KeyRound } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { useAuth } from "../../lib/auth";
import { api, fmtDateTime } from "../../lib/api";
import { Wordmark } from "../public/SiteLayout";

const NAV = [
  ["/erp", "Dashboard", LayoutDashboard, "dashboard"], ["/erp/leads", "CRM & Leads", Users, "leads"], ["/erp/properties", "Properties", Building2, "properties"],
  ["/erp/owners", "Owners", UserSquare, "owners"], ["/erp/deals", "Deals", Handshake, "deals"], ["/erp/leases", "Leases & Rent", FileText, "leases"],
  ["/erp/maintenance", "Maintenance", Wrench, "maintenance"], ["/erp/short-stay", "Short-Stay", CalendarDays, "shortstay"], ["/erp/finance", "Finance", Wallet, "finance"],
  ["/erp/approvals", "Approvals", Stamp, null], ["/erp/tasks", "Tasks", CheckSquare, "tasks"], ["/erp/documents", "Documents", FolderLock, "documents"],
  ["/erp/reports", "Reports", BarChart3, "reports"], ["/erp/users", "Users & Roles", ShieldCheck, "users"], ["/erp/settings", "Settings & CMS", Settings, "settings|cms"], ["/erp/audit", "Audit Log", ScrollText, "audit"],
];

function Notifications() {
  const [rows, setRows] = useState([]);
  const load = () => api.get("/notifications").then((r) => setRows(r.data)).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  const unread = rows.filter((r) => !r.read).length;
  return (
    <Popover onOpenChange={(o) => { if (!o && unread) api.post("/notifications/read").then(load); }}>
      <PopoverTrigger className="relative p-2 text-slate-600 hover:text-slate-900" data-testid="notifications-btn" aria-label="Notifications"><Bell size={18} />{unread > 0 && <span className="absolute right-0 top-0 min-w-[16px] bg-slate-900 px-1 text-[10px] text-white" data-testid="notifications-count">{unread}</span>}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-sm p-0">
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
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  const items = NAV.filter(([, , , m]) => !m || m.split("|").some((x) => can(x)));
  const side = (
    <nav className="flex h-full flex-col bg-slate-900 text-slate-300">
      <Link to="/" className="block border-b border-slate-800 px-5 py-5"><Wordmark dark /></Link>
      <div className="flex-1 overflow-y-auto py-3">
        {items.map(([to, l, Icon]) => <NavLink key={to} to={to} end={to === "/erp"} data-testid={`erp-nav-${l.split(" ")[0].toLowerCase()}`} className={({ isActive }) => `flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${isActive ? "bg-slate-800 text-white" : "hover:bg-slate-800/60 hover:text-white"}`}><Icon size={16} />{l}</NavLink>)}
      </div>
      <div className="border-t border-slate-800 p-4 text-xs"><p className="font-medium text-white" data-testid="erp-user-name">{user.name}</p><p className="text-slate-500" data-testid="erp-user-role">{user.role_label}</p></div>
    </nav>
  );
  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 lg:block">{side}</aside>
      {open && <div className="fixed inset-0 z-50 flex lg:hidden"><div className="w-64">{side}</div><div className="flex-1 bg-slate-900/40" onClick={() => setOpen(false)} /></div>}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Menu" data-testid="erp-menu-toggle"><Menu size={20} /></button>
          <span className="hidden text-xs text-slate-400 lg:block">Sellandiamman Estates ERP · Asia/Kolkata</span>
          <div className="flex items-center gap-1">
            <Notifications />
            <Link to="/erp/settings?tab=password" className="p-2 text-slate-600 hover:text-slate-900" aria-label="Change password" data-testid="change-password-link"><KeyRound size={18} /></Link>
            <button className="flex items-center gap-1 p-2 text-sm text-slate-600 hover:text-slate-900" onClick={async () => { await logout(); nav("/erp/login"); }} data-testid="logout-btn"><LogOut size={16} />Logout</button>
          </div>
        </header>
        <main className="p-4 sm:p-6 lg:p-8"><Outlet /></main>
      </div>
    </div>
  );
}
