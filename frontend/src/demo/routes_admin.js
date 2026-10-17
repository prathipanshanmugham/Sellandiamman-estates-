// Dashboard, calendar, documents, tasks, notifications, reminders, approvals, settings, audit, reports
// (backend/routes_admin.py and the CSV exports) for the hosted preview.
import { route } from "./router";
import {
  db, state, fail, nowIso, nowIstMin, todayIST, newId, r2, notDeleted, one, sortBy, pick, can, isScoped, inScope, getScoped,
  audit, notify, notifyRoles, settings, ROLES, fileToDataUrl,
} from "./core";
import { applyCommission } from "./routes_sales";
import { doReverse, applyCreditNote, applyBookingCancel } from "./routes_money";

const inRange = (v, frm, to) => (!frm || (v || "") >= frm) && (!to || (v || "").slice(0, 10) <= to);
const sum = (rows, f) => r2(rows.reduce((t, x) => t + (typeof f === "function" ? f(x) : x[f] || 0), 0));
const addDays = (n) => { const d = new Date(`${todayIST()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

route("GET", "/dashboard", ({ user, query: q }) => {
  const { frm, to } = q;
  const t = todayIST();
  const out = { range: { from: frm || null, to: to || null } };
  if (can(user, "leads", "r")) {
    const L = db.leads.filter((l) => notDeleted(l) && inScope(user, "leads")(l));
    const byStage = {}; L.forEach((l) => { byStage[l.stage] = (byStage[l.stage] || 0) + 1; });
    const src = {}; L.filter((l) => inRange(l.created_at, frm, to)).forEach((l) => { const s = src[l.source] || (src[l.source] = { source: l.source, leads: 0, won: 0 }); s.leads += 1; if (l.stage === "won") s.won += 1; });
    out.leads = { new: L.filter((l) => inRange(l.created_at, frm, to)).length, awaiting_followup: L.filter((l) => !["won", "lost"].includes(l.stage) && l.next_follow_up && l.next_follow_up < nowIstMin()).length,
      qualified: L.filter((l) => ["qualified", "requirements", "matched", "site_visit", "negotiation"].includes(l.stage)).length, by_stage: byStage, by_source: Object.values(src) };
    const V = db.site_visits.filter((v) => !isScoped(user, "leads") || v.agent_id === user.id);
    out.site_visits = { scheduled: V.filter((v) => v.status === "scheduled").length, requested: V.filter((v) => v.status === "requested").length, completed: V.filter((v) => v.status === "completed" && inRange(v.updated_at, frm, to)).length };
    const st = {}; L.filter((l) => l.assigned_to).forEach((l) => { const s = st[l.assigned_to] || (st[l.assigned_to] = { open: 0, won: 0, total: 0 }); s.total += 1; if (l.stage === "won") s.won += 1; else if (l.stage !== "lost") s.open += 1; });
    out.staff = Object.entries(st).map(([id, s]) => ({ name: one("users", (u) => u.id === id)?.name || "-", open: s.open, won: s.won, conversion: s.total ? Math.round((1000 * s.won) / s.total) / 10 : 0 }));
  }
  if (can(user, "deals", "r")) {
    const D = db.deals.filter((d) => notDeleted(d) && inScope(user, "deals")(d));
    out.deals = { negotiating: D.filter((d) => ["negotiation", "agreement", "closing"].includes(d.stage)).length, closed: D.filter((d) => d.stage === "won" && inRange(d.closed_at, frm, to)).length };
  }
  if (can(user, "leases", "r") || can(user, "maintenance", "r")) {
    const act = db.leases.filter((l) => l.status === "active");
    out.pm = { active_leases: act.length, expiring_60d: act.filter((l) => l.end_date <= addDays(60)).length,
      vacant: db.properties.filter((p) => ["rent", "lease"].includes(p.transaction) && p.occupancy === "vacant" && ["published", "ready_to_market"].includes(p.status)).length,
      open_work_orders: db.work_orders.filter((w) => ["open", "assigned", "in_progress"].includes(w.status)).length };
  }
  if (can(user, "shortstay", "r")) {
    const B = db.bookings.filter((b) => b.status !== "cancelled" && inRange(b.check_in, frm, to));
    const nights = B.reduce((s, b) => s + b.nights, 0);
    out.shortstay = { bookings: B.length, gross: sum(B, "gross"), nights, adr: nights ? r2(sum(B, "room_revenue") / nights) : 0 };
  }
  if (can(user, "finance", "r")) {
    const open = db.deals.filter((d) => ["negotiation", "agreement", "closing"].includes(d.stage) && d.commission);
    const invs = db.invoices.filter((i) => i.status !== "void");
    const E = db.ledger_entries.filter((e) => e.ledger === "company" && inRange(e.posted_at, frm, to));
    const rev = E.filter((e) => /^revenue:/.test(e.account));
    const collected = sum(rev.filter((e) => e.direction === "in"), "amount") - sum(rev.filter((e) => e.direction === "out"), "amount");
    const expenses = sum(E.filter((e) => e.direction === "out" && /^(expense|refund)/.test(e.account)), "amount");
    const bySvc = {}; rev.forEach((e) => { const k = e.account.split(":")[1]; bySvc[k] = r2((bySvc[k] || 0) + (e.direction === "in" ? e.amount : -e.amount)); });
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      let y = Number(t.slice(0, 4)); let m = Number(t.slice(5, 7)) - i; while (m <= 0) { m += 12; y -= 1; }
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const C = db.ledger_entries.filter((e) => e.ledger === "company" && (e.posted_at || "").startsWith(key));
      trend.push({ month: key, collected: sum(C.filter((e) => e.direction === "in" && /^revenue:/.test(e.account)), "amount"), expenses: sum(C.filter((e) => e.direction === "out" && /^expense/.test(e.account)), "amount") });
    }
    out.finance = { quoted_commission: sum(open.filter((d) => !d.commission.agreement_signed), (d) => d.commission.gross), expected_commission: sum(open.filter((d) => d.commission.agreement_signed), (d) => d.commission.gross),
      earned_commission: sum(db.deals.filter((d) => d.stage === "won" && inRange(d.closed_at, frm, to)), "final_commission"), invoiced: sum(invs.filter((i) => inRange(i.issue_date, frm, to)), "total"),
      collected: r2(collected), receivables: sum(invs, (i) => i.total - i.paid - (i.credited || 0)),
      overdue_receivables: sum(invs.filter((i) => i.due_date < t && ["issued", "partially_paid"].includes(i.status)), (i) => i.total - i.paid - (i.credited || 0)),
      expenses, operating_cash_flow: r2(collected - expenses), monthly_recurring_mgmt: sum(db.leases.filter((l) => l.status === "active"), (l) => (l.rent * l.mgmt_fee_pct) / 100),
      by_service: Object.entries(bySvc).map(([service, amount]) => ({ service, amount })), trend,
      marketing_spend: sum(db.expenses.filter((e) => /^marketing/i.test(e.category) && inRange(e.date, frm, to)), "amount") };
  }
  return out;
}, { perm: ["dashboard", "r"] });

// ---------------- Documents ----------------
const ENTITY_MODULE = { property: "properties", lead: "leads", deal: "deals", lease: "leases", owner: "owners", booking: "shortstay", work_order: "maintenance", vendor: "maintenance", company: "settings", post: "cms" };
const ENTITY_COLL = { property: "properties", lead: "leads", deal: "deals" };
const checkEntity = (u, type, id) => { const m = ENTITY_MODULE[type]; if (!m || !can(u, m, "r")) fail(404, "Record not found"); if (ENTITY_COLL[type]) getScoped(ENTITY_COLL[type], m, u, id); };
const docOut = ({ stored_name, demo_url, ...d }) => d; // eslint-disable-line no-unused-vars

route("GET", "/documents", ({ user, query: q }) => {
  let rows = db.documents.filter((d) => d.is_latest);
  if (q.entity_type && q.entity_id) { checkEntity(user, q.entity_type, q.entity_id); rows = rows.filter((d) => d.entity_type === q.entity_type && d.entity_id === q.entity_id); }
  else {
    const allowed = Object.entries(ENTITY_MODULE).filter(([, m]) => can(user, m, "r")).map(([k]) => k);
    rows = rows.filter((d) => allowed.includes(d.entity_type));
    if (isScoped(user, "properties") || isScoped(user, "leases")) rows = rows.filter((d) => d.uploaded_by === user.id);
  }
  if (q.q) { const r = new RegExp(String(q.q).slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); rows = rows.filter((d) => r.test(d.original_name) || d.doc_type === q.q); }
  if (q.expiring && String(q.expiring) !== "false") rows = rows.filter((d) => d.expiry_date && d.expiry_date <= addDays(30));
  return sortBy(rows, "created_at", -1).map(docOut);
}, { perm: ["documents", "r"] });
route("POST", "/documents", async ({ user, body: b, files }) => {
  checkEntity(user, b.entity_type, b.entity_id);
  const f = files.file?.[0] || fail(422, "Choose a file");
  const ok = ["application/pdf", "image/jpeg", "image/png", "image/webp", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
  if (!ok.includes(f.type)) fail(422, `File type not allowed: ${f.type || "unknown"}`);
  if (f.size > 10 * 1024 * 1024) fail(422, "File too large (max 10 MB)");
  const prev = db.documents.find((d) => d.entity_type === b.entity_type && d.entity_id === b.entity_id && d.doc_type === b.doc_type && d.original_name === f.name && d.is_latest);
  if (prev) prev.is_latest = false;
  const d = { id: newId(), demo_url: f.size < 4e6 ? await fileToDataUrl(f) : null, size: f.size, content_type: f.type, original_name: f.name, entity_type: b.entity_type, entity_id: b.entity_id, doc_type: String(b.doc_type).slice(0, 40),
    expiry_date: b.expiry_date || null, notes: b.notes || null, version: prev ? prev.version + 1 : 1, is_latest: true, previous_id: prev?.id || null, public_approved: false, uploaded_by: user.id, uploaded_by_name: user.name, created_at: nowIso() };
  db.documents.push(d);
  audit(user, "document_uploaded", "documents", d.id, { entity: `${b.entity_type}:${b.entity_id}`, v: d.version });
  return docOut(d);
}, { perm: ["documents", "w"] });
route("POST", "/documents/:id/link", ({ user, params }) => {
  const d = one("documents", (x) => x.id === params.id) || fail(404, "Not found");
  checkEntity(user, d.entity_type, d.entity_id);
  if (d.doc_type === "kyc" && !can(user, "documents", "a")) fail(403, "KYC documents need elevated access");
  audit(user, "document_link", "documents", d.id);
  return { url: `/api/files/demo-${d.id}`, expires_in: 300 };
}, { perm: ["documents", "r"] });
route("POST", "/documents/:id/approve-public", ({ user, params }) => {
  const d = one("documents", (x) => x.id === params.id);
  if (!d || !d.content_type?.startsWith("image/") || d.entity_type !== "property") fail(422, "Only property photos can be approved for the website");
  d.public_approved = true;
  const p = one("properties", (x) => x.id === d.entity_id);
  const url = `/api/public/media/${d.id}`;
  if (p && !(p.images || []).includes(url)) p.images = [...(p.images || []), url];
  audit(user, "media_approved", "documents", d.id);
  return { ok: true };
}, { perm: ["cms", "p"] });
route("PATCH", "/documents/:id/share", ({ user, params, body }) => {
  const d = one("documents", (x) => x.id === params.id) || fail(404, "Not found");
  checkEntity(user, d.entity_type, d.entity_id);
  if (!["property", "owner"].includes(d.entity_type) || d.doc_type === "kyc") fail(422, "Only property or owner documents (not KYC) can be shared with the owner");
  d.share_with_owner = !!body.share;
  audit(user, d.share_with_owner ? "document_shared" : "document_unshared", "documents", d.id);
  return { ok: true, share_with_owner: d.share_with_owner };
}, { perm: ["documents", "w"] });

// ---------------- Calendar ----------------
route("GET", "/calendar", ({ user, query: q }) => {
  const { frm, to } = q;
  if (!frm || !to || frm.length !== 10 || to.length !== 10 || to < frm) fail(422, "Use from/to dates as YYYY-MM-DD");
  const ev = [];
  const end = `${to}T23:59`;
  if (can(user, "leads", "r")) db.site_visits.filter((v) => (!isScoped(user, "leads") || v.agent_id === user.id) && v.scheduled_at >= frm && v.scheduled_at <= end && ["requested", "scheduled", "completed"].includes(v.status))
    .forEach((v) => ev.push({ type: "visit", date: v.scheduled_at.slice(0, 10), time: v.scheduled_at.slice(11, 16), title: `Visit · ${v.lead_name}`, sub: `${v.property_code} ${v.property_title}`, status: v.status, link: `/erp/leads/${v.lead_id}` }));
  if (can(user, "shortstay", "r")) db.bookings.filter((b) => b.status !== "cancelled" && b.check_in <= to && b.check_out >= frm)
    .forEach((b) => ev.push({ type: "stay", date: b.check_in, end: b.check_out, title: `Stay · ${b.guest_name}`, sub: `${b.code} ${b.property_title} (${b.nights} nights)`, status: b.status, link: "/erp/short-stay" }));
  if (can(user, "leases", "r")) db.leases.filter((l) => inScope(user, "leases")(l) && l.status === "active").forEach((l) => {
    if (frm <= l.end_date && l.end_date <= to) ev.push({ type: "lease_end", date: l.end_date, title: `Lease ends · ${l.tenant_name}`, sub: `${l.code} ${l.property_title}`, status: "active", link: "/erp/leases" });
    l.schedule.forEach((s) => { if (frm <= s.due_date && s.due_date <= to) ev.push({ type: "rent", date: s.due_date, title: `Rent due · ${l.tenant_name}`, sub: `${l.code} ${s.period}`, status: s.paid >= s.amount ? "paid" : "due", link: "/erp/leases" }); });
  });
  if (can(user, "tasks", "r")) db.tasks.filter((t) => (["super_admin", "director", "branch_manager"].includes(user.role) || t.assigned_to === user.id) && t.due_date && t.due_date >= frm && t.due_date <= to && t.status !== "done")
    .forEach((t) => ev.push({ type: "task", date: t.due_date.slice(0, 10), title: t.title, sub: String(t.kind || "").replace(/_/g, " "), status: t.status, link: "/erp/tasks" }));
  if (can(user, "properties", "r")) db.properties.filter((p) => inScope(user, "properties")(p) && notDeleted(p) && p.authorization?.expiry >= frm && p.authorization?.expiry <= to)
    .forEach((p) => ev.push({ type: "authorisation", date: p.authorization.expiry, title: `Authorisation ends · ${p.code}`, sub: p.title, status: p.status, link: `/erp/properties/${p.id}` }));
  return ev.sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
}, { auth: "staff" });

// ---------------- Tasks ----------------
const managers = ["super_admin", "director", "branch_manager"];
route("GET", "/tasks", ({ user }) => sortBy(db.tasks.filter((t) => managers.includes(user.role) || t.assigned_to === user.id || t.created_by === user.id || (t.kind === "cleaning" && can(user, "shortstay", "w"))), "due_date"), { perm: ["tasks", "r"] });
route("POST", "/tasks", ({ user, body }) => {
  if (String(body.title || "").length < 2) fail(422, "title: at least 2 characters");
  const t = { priority: "medium", kind: "general", ...pick(body, ["title", "description", "assigned_to", "due_date", "priority", "kind", "related_type", "related_id"]), id: newId(), status: "open", created_by: user.id, comments: [], created_at: nowIso() };
  t.assigned_to = t.assigned_to || user.id;
  db.tasks.push(t);
  if (t.assigned_to !== user.id) notify([t.assigned_to], `Task assigned: ${t.title}`, "", "/erp/tasks", `task:${t.id}`);
  return t;
}, { perm: ["tasks", "w"] });
route("PATCH", "/tasks/:id", ({ user, params, body }) => {
  const t = one("tasks", (x) => x.id === params.id) || fail(404, "Task not found");
  const mine = [t.assigned_to, t.created_by].includes(user.id) || (t.kind === "cleaning" && can(user, "shortstay", "w"));
  if (!mine && !managers.includes(user.role)) fail(404, "Task not found");
  const upd = pick(body, ["status", "priority", "due_date", "assigned_to"]);
  if (upd.status && !["open", "in_progress", "done"].includes(upd.status)) fail(422, "Invalid status");
  Object.assign(t, upd);
  if (body.comment) t.comments.push({ at: nowIso(), by: user.name, text: String(body.comment).slice(0, 1000) });
  return { ok: true };
}, { perm: ["tasks", "w"] });

// ---------------- Notifications & reminders ----------------
route("GET", "/notifications", ({ user }) => sortBy(db.notifications.filter((n) => n.user_id === user.id), "created_at", -1).slice(0, 100), { auth: "any" });
route("POST", "/notifications/read", ({ user }) => { db.notifications.filter((n) => n.user_id === user.id).forEach((n) => { n.read = true; }); return { ok: true }; }, { auth: "any" });
route("POST", "/automations/run", () => {
  let n = 0;
  const t = todayIST();
  db.leads.filter((l) => !["won", "lost"].includes(l.stage) && l.next_follow_up && l.next_follow_up < nowIstMin() && l.assigned_to).forEach((l) => { notify([l.assigned_to], `Overdue follow-up: ${l.name}`, l.next_follow_up, `/erp/leads/${l.id}`, `fu:${l.id}:${l.next_follow_up}`, "warning"); n += 1; });
  db.leases.filter((l) => l.status === "active" && l.end_date <= addDays(60)).forEach((l) => { notify([l.manager_id], `Lease expiring: ${l.code}`, `Ends ${l.end_date}`, "/erp/leases", `lexp:${l.id}`, "warning"); n += 1; });
  db.leases.filter((l) => l.status === "active").forEach((l) => { const due = l.schedule.filter((s) => s.due_date < t && s.paid < s.amount); if (due.length) { notify([l.manager_id], `Rent arrears: ${l.code}`, `${due.length} period(s) unpaid`, "/erp/leases", `arr:${l.id}:${due[due.length - 1].period}`, "warning"); n += 1; } });
  db.invoices.filter((i) => ["issued", "partially_paid"].includes(i.status) && i.due_date < t).forEach((i) => { notifyRoles(["accountant"], `Invoice overdue: ${i.number}`, i.customer_name, "/erp/finance", `inv:${i.id}`, "warning"); n += 1; });
  db.site_visits.filter((v) => v.status === "requested").forEach((v) => { notifyRoles(["branch_manager", "director"], `Visit request waiting: ${v.lead_name}`, `${v.property_code} · asked for ${v.scheduled_at}`, `/erp/leads/${v.lead_id}`, `vwait:${v.id}`, "warning"); n += 1; });
  db.work_orders.filter((w) => ["open", "assigned", "in_progress"].includes(w.status) && w.due_date && w.due_date < t).forEach((w) => { notifyRoles(["branch_manager", "property_manager"], `Work order overdue: ${w.code}`, w.title, "/erp/maintenance", `wo_due:${w.id}`, "warning"); n += 1; });
  return { checked: n };
}, { perm: ["dashboard", "r"] });

// ---------------- Approvals ----------------
const APPROVAL_PERM = { commission_change: ["deals", "a"], ledger_reversal: ["finance", "a"], credit_note: ["finance", "a"], booking_refund: ["shortstay", "a"] };
route("GET", "/approvals", ({ user }) => {
  const kinds = Object.entries(APPROVAL_PERM).filter(([, [m, a]]) => can(user, m, a)).map(([k]) => k);
  return sortBy(db.approvals.filter((a) => kinds.includes(a.kind) || a.requested_by === user.id), "created_at", -1);
}, { auth: "staff" });
route("POST", "/approvals/:id/decide", ({ user, params, body }) => {
  const ap = one("approvals", (a) => a.id === params.id) || fail(404, "Approval not found");
  const [m, a] = APPROVAL_PERM[ap.kind];
  if (!can(user, m, a)) fail(403, "You are not authorised to decide this approval");
  if (ap.requested_by === user.id) fail(403, "You cannot approve your own request");
  if (ap.status !== "pending") fail(409, "Already decided");
  const approve = !!body.approve;
  Object.assign(ap, { status: approve ? "approved" : "rejected", decided_by: user.id, decided_by_name: user.name, decided_at: nowIso(), decision_note: body.note || null });
  if (approve) {
    try {
      if (ap.kind === "commission_change") applyCommission(one("deals", (d) => d.id === ap.entity_id), ap.payload, user);
      else if (ap.kind === "ledger_reversal") doReverse(one("ledger_entries", (e) => e.id === ap.entity_id), ap.payload.reason, user);
      else if (ap.kind === "credit_note") applyCreditNote(one("invoices", (i) => i.id === ap.entity_id), ap.payload, user);
      else if (ap.kind === "booking_refund") applyBookingCancel(one("bookings", (b) => b.id === ap.entity_id), ap.payload, user);
    } catch (e) { Object.assign(ap, { status: "failed", decision_note: e.detail || "Action failed" }); throw e; }
  }
  audit(user, `approval_${approve ? "approved" : "rejected"}`, "approvals", ap.id, { kind: ap.kind });
  notify([ap.requested_by], `Your request was ${approve ? "approved" : "rejected"}`, ap.summary, "/erp/approvals", `apd:${ap.id}`);
  return { ok: true };
}, { auth: "staff" });

// ---------------- Settings, audit, branches, campaigns ----------------
const SETTINGS_FIELDS = ["name", "legal_name", "phone", "whatsapp", "email", "address", "gstin", "gst_enabled", "gst_rate", "cities", "localities", "approvals", "demo_mode", "invoice_due_days", "office_hours", "enquiry_routing", "rera_no", "social", "mfa_required_roles", "email_notifications", "map_center"];
const CMS_FIELDS = ["hero_title", "hero_subtitle", "seo_title", "seo_description", "testimonials", "announcement"];
route("GET", "/settings", ({ user }) => { if (!(can(user, "settings", "r") || can(user, "cms", "r"))) fail(403, "You do not have permission for this action"); return settings(); }, { auth: "staff" });
route("PUT", "/settings", ({ user, body }) => {
  const allowed = [...(can(user, "settings", "w") ? SETTINGS_FIELDS : []), ...(can(user, "cms", "w") ? CMS_FIELDS : [])];
  if (!allowed.length) fail(403, "You do not have permission for this action");
  const upd = pick(body, allowed);
  if ("gst_rate" in upd) { const r = Number(upd.gst_rate || 0); if (r < 0 || r > 28) fail(422, "GST rate must be between 0 and 28"); upd.gst_rate = r; }
  if ("mfa_required_roles" in upd) {
    const roles = (upd.mfa_required_roles || []).filter((r) => ROLES[r]);
    if (roles.includes(user.role) && !user.mfa_enabled) fail(422, "Turn on 2-step sign-in for your own account first, then require it for your role");
    upd.mfa_required_roles = roles;
  }
  if ("testimonials" in upd) upd.testimonials = (upd.testimonials || []).filter((t) => t && t.quote).map((t) => ({ quote: String(t.quote).slice(0, 400), name: String(t.name || "").slice(0, 80) })).slice(0, 9);
  if ("invoice_due_days" in upd) upd.invoice_due_days = Math.max(0, Math.min(120, Number(upd.invoice_due_days || 15)));
  Object.assign(settings(), upd);
  audit(user, "settings_updated", "settings", "company", upd);
  return settings();
}, { auth: "staff" });
route("GET", "/system/status", () => {
  const s = settings();
  return { site_url: "https://estates.sellandiamman.example", email: false, turnstile: false, demo_mode: !!s.demo_mode, demo_data: true, whatsapp: !!s.whatsapp,
    contact_placeholder: (s.phone || "").includes("00000") || (s.email || "").includes("example.com") || (s.address || "").includes("[Office"), gst: !!s.gst_enabled, rera: !!s.rera_no,
    mfa_roles: s.mfa_required_roles || [], admins_without_mfa: db.users.filter((u) => ["super_admin", "director"].includes(u.role) && u.active && !u.mfa_enabled).length, cookie_secure: true };
}, { perm: ["settings", "r"] });
route("POST", "/settings/logo", async ({ user, files }) => {
  const f = files.file?.[0];
  if (!f || !["image/png", "image/jpeg", "image/webp"].includes(f.type) || f.size > 1024 * 1024) fail(422, "Logo must be PNG/JPEG/WebP under 1 MB");
  settings().logo = await fileToDataUrl(f);
  audit(user, "logo_updated", "settings", "company");
  return { ok: true };
}, { perm: ["settings", "w"] });
route("DELETE", "/settings/logo", ({ user }) => { settings().logo = null; audit(user, "logo_removed", "settings", "company"); return { ok: true }; }, { perm: ["settings", "w"] });
route("GET", "/audit", ({ query: q }) => sortBy(db.audit_logs.filter((a) => (!q.entity || a.entity === q.entity) && (!q.entity_id || a.entity_id === q.entity_id)), "at", -1).slice(0, 1000), { perm: ["audit", "r"] });
route("GET", "/branches", () => db.branches, { auth: "staff" });
route("GET", "/campaigns", () => db.campaigns.map((c) => ({ ...c, leads: db.leads.filter((l) => l.campaign_id === c.id).length, won: db.leads.filter((l) => l.campaign_id === c.id && l.stage === "won").length })), { perm: ["cms", "r"] });
route("POST", "/campaigns", ({ body }) => {
  if (!body.name || !body.code) fail(422, "Name and code are required");
  if (db.campaigns.some((c) => c.code === body.code)) fail(409, "Campaign code already exists");
  const c = { id: newId(), name: String(body.name).slice(0, 120), code: String(body.code).slice(0, 40), channel: body.channel || null, budget: Number(body.budget || 0), start_date: body.start_date || null, created_at: nowIso() };
  db.campaigns.push(c);
  return c;
}, { perm: ["cms", "w"] });

// ---------------- CSV exports (shown in the in-page viewer) ----------------
const REPORTS = {
  leads: ["leads", "leads", ["code", "name", "phone", "source", "interest", "stage", "lost_reason", "created_at"]],
  deals: ["deals", "deals", ["code", "title", "deal_type", "stage", "agreed_value", "expected_commission", "final_commission", "closed_at"]],
  invoices: ["invoices", "finance", ["number", "type", "customer_name", "issue_date", "due_date", "total", "paid", "credited", "status"]],
  ledger: ["ledger_entries", "finance", ["code", "ledger", "direction", "amount", "account", "description", "posted_at", "reversed", "reversal_of"]],
  leases: ["leases", "leases", ["code", "property_title", "tenant_name", "start_date", "end_date", "rent", "mgmt_fee_pct", "deposit_held", "status"]],
  bookings: ["bookings", "shortstay", ["code", "property_title", "check_in", "check_out", "nights", "gross", "platform_fee", "management_fee", "owner_payout", "status", "settled"]],
  work_orders: ["work_orders", "maintenance", ["code", "property_title", "title", "priority", "status", "quote_amount", "actual_cost", "charge_to", "created_at"]],
  properties: ["properties", "properties", ["code", "listing_id", "title", "category", "transaction", "city", "locality", "status", "authorization", "created_at"]],
  owner_statements: ["owner_statements", "finance", ["code", "owner_name", "month", "rent_collected", "management_fee", "expenses", "net_payable", "payout_status"]],
  site_visits: ["site_visits", "leads", ["lead_name", "property_code", "property_title", "scheduled_at", "status", "feedback", "source", "created_at"]],
  expenses: ["expenses", "finance", ["code", "date", "category", "description", "vendor", "amount", "gst_amount", "paid_from", "created_at"]],
};
export function csvReport(path) {
  const user = db.users.find((u) => u.id === state.userId);
  const [, base, qs] = /^\/(?:reports\/)?([\w-]+)\.csv\??(.*)$/.exec(path) || [];
  const q = Object.fromEntries(new URLSearchParams(qs || ""));
  const name = path.startsWith("/leads/export") ? "leads" : base;
  const def = REPORTS[name];
  if (!def || !user) return null;
  const [coll, module, cols] = def;
  if (!(can(user, module, "r") && (can(user, module, "e") || can(user, "reports", "e")))) return { cols: ["Message"], rows: [["Your role cannot export this report."]] };
  let rows = db[coll].filter((r) => (!["leads", "deals", "properties"].includes(coll) || notDeleted(r)) && (!["leads", "deals", "properties", "leases"].includes(module) || inScope(user, module)(r)));
  if (q.frm || q.to) rows = rows.filter((r) => inRange(String(r[cols[cols.length - 2]] || r.created_at || "").slice(0, 10), q.frm, q.to));
  audit(user, "export", "reports", name, { rows: rows.length });
  return { cols, rows: rows.map((r) => cols.map((c) => (r[c] && typeof r[c] === "object" ? r[c].expiry || "" : r[c] ?? ""))) };
}
