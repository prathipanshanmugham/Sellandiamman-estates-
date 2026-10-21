import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { api, fmtDateTime } from "../lib/api";

// In-app notifications for staff and customers alike (new replies, bills, payments confirmed…).
export function Notifications() {
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
