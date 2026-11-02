// Customer sign-ins (tenant, buyer, owner, investor), service tickets, tenant bills and payment notices, and the
// password vault (backend/routes_tickets.py, routes_bills.py, routes_tenant.py, routes_buyer.py, routes_vault.py,
// routes_customers.py logins) for the hosted preview.
import { route } from "./router";
import {
  db, state, META, DEMO_PASSWORD, fail, nowIso, todayIST, newId, r2, notDeleted, one, sortBy, pick, omit, nextCode, inr, settings, ROLES,
  PERMS, PORTAL_ROLES, can, inScope, checkBranch, homeBranch, audit, notify, notifyRoles, postLedger, fileToDataUrl, linkCustomer,
} from "./core";
import { recordRent, createWorkOrder } from "./routes_money";
import { createUser } from "./routes_site";

const ACTIVE = ["open", "acknowledged", "in_progress", "on_hold"];

// ======================================================================================== tickets
const CATEGORIES = {
  plumbing: ["Plumbing or water leak", "repair"], electrical: ["Electrical or power", "repair"], appliance: ["Appliance (AC, geyser, fan, motor)", "repair"],
  carpentry: ["Doors, windows, locks, carpentry", "repair"], painting: ["Painting, cracks or seepage", "repair"], water_supply: ["Water supply, tank or motor", "repair"],
  pest_control: ["Pest control", "repair"], cleaning: ["Cleaning", "cleaning"], deep_cleaning: ["Deep cleaning", "cleaning"], tank_cleaning: ["Water tank or sump cleaning", "cleaning"],
  garden: ["Garden or common area", "cleaning"], security: ["Keys, access or security", "service"], internet: ["Internet, DTH or cable", "service"], parking: ["Parking", "service"],
  complaint: ["Complaint (neighbours, noise, society)", "service"], documents: ["Documents (receipt, agreement copy, address letter)", "account"], billing: ["Rent or bill query", "account"],
  renewal: ["Lease renewal", "account"], move_out: ["Move-out notice", "account"], payout: ["Statement or payout query", "account"], listing: ["Listing, tenant search or rent revision", "owner"],
  property_tax: ["Property tax, EB or water name transfer", "owner"], home_loan: ["Home-loan help", "buying"], registration: ["Registration and legal help", "buying"],
  site_visit: ["Site visit", "buying"], other: ["Something else", "service"],
};
const keysIn = (...groups) => Object.entries(CATEGORIES).filter(([, [, g]]) => groups.includes(g)).map(([k]) => k);
const ROLE_CATS = {
  tenant: [...keysIn("repair", "cleaning", "service"), "documents", "billing", "renewal", "move_out"],
  owner: [...keysIn("repair", "cleaning", "service", "owner"), "documents", "billing", "payout"],
  buyer: ["site_visit", "home_loan", "registration", "documents", "billing", "complaint", "other"],
  investor: ["payout", "documents", "other"],
};
const STATUSES = ["open", "acknowledged", "in_progress", "on_hold", "resolved", "closed", "cancelled"];
const FLOW = { open: ["acknowledged", "in_progress", "on_hold", "resolved", "cancelled"], acknowledged: ["in_progress", "on_hold", "resolved", "cancelled"], in_progress: ["on_hold", "resolved", "cancelled"],
  on_hold: ["in_progress", "resolved", "cancelled"], resolved: ["closed", "in_progress"], closed: ["in_progress"], cancelled: [] };
const SLA = { urgent: [4, 24], high: [24, 72], medium: [48, 168], low: [72, 336] };
const PORTAL_HOME = { tenant: "/tenant/requests", owner: "/owner/requests", buyer: "/buyer/requests", investor: "/investor/requests" };
const catLabel = (k) => (CATEGORIES[k] || [String(k).replace(/_/g, " ")])[0];
const due = (prio, i, start) => new Date(Date.parse(start || nowIso()) + SLA[prio || "medium"][i] * 3600e3).toISOString();
const msg = (user, text, byRole, internal = false, kind = "message") => ({ id: newId(), at: nowIso(), user_id: user?.id || null, by: user?.name || "System", by_role: byRole, text, internal, kind });
const prop = (id) => db.properties.find((p) => p.id === id && notDeleted(p)) || null;
const strOk = (v, min, max, what) => { const s = String(v || "").trim(); if (s.length < min || s.length > max) fail(422, `${what}: between ${min} and ${max} characters`); return s; };

function notifyStaff(t, title, body = "") {
  const link = `/erp/tickets/${t.id}`;
  const targets = [t.assigned_to, t.property_id && prop(t.property_id)?.assigned_manager].filter(Boolean);
  if (targets.length) notify(targets, title, body, link, `tk:${t.id}:${nowIso()}`);
  if (!t.assigned_to) notifyRoles(["branch_manager"], title, body, link, `tk:${t.id}:${nowIso()}`, "info", t.branch_id);
}
function notifyCustomer(t, title, body = "") {
  const ids = new Set([t.raised_by?.user_id].filter(Boolean));
  if (t.customer_id) db.users.filter((u) => u.customer_id === t.customer_id && ["tenant", "buyer"].includes(u.role) && u.active).forEach((u) => ids.add(u.id));
  db.users.filter((u) => ids.has(u.id) && u.active).forEach((u) => notify([u.id], title, body, `${PORTAL_HOME[u.role] || "/"}/${t.id}`, `tkc:${t.id}:${nowIso()}`));
}

export function createTicket(data, user, byRole, channel) {
  if (!CATEGORIES[data.category]) fail(422, "Choose a type of request");
  const title = strOk(data.title, 3, 160, "title");
  const p = data.property_id ? prop(data.property_id) || fail(404, "Property not found") : null;
  const group = CATEGORIES[data.category][1];
  const prio = ["low", "medium", "high", "urgent"].includes(data.priority) ? data.priority : "medium";
  const t = { id: newId(), code: nextCode("ticket", "TK-", 5), category: data.category, group, title, description: String(data.description || "").trim() || null, priority: prio,
    property_id: p?.id || null, property_title: p?.title || null, property_code: p?.code || null, owner_id: data.owner_id || p?.owner_id || null, branch_id: p?.branch_id || data.branch_id || null,
    lease_id: data.lease_id || null, customer_id: data.customer_id || null, visible_to_owner: group === "repair" || byRole === "owner",
    raised_by: { user_id: user.id, name: user.name, role: byRole }, channel, preferred_time: data.preferred_time || null, permission_to_enter: !!data.permission_to_enter,
    status: "open", assigned_to: data.assigned_to || null, assigned_name: null, work_order_id: null, respond_by: due(prio, 0), due_at: due(prio, 1), first_response_at: null, resolved_at: null,
    closed_at: null, rating: null, files: [], messages: [], created_at: nowIso(), updated_at: nowIso(), last_message_at: nowIso(), unread_staff: byRole !== "staff", unread_customer: byRole === "staff" };
  if (t.assigned_to) t.assigned_name = db.users.find((u) => u.id === t.assigned_to)?.name || null;
  if (t.description) t.messages.push(msg(user, t.description, byRole));
  db.tickets.push(t);
  audit(user, "ticket_created", "maintenance", t.id, { category: t.category, by: byRole });
  return t;
}

const staffTicket = (user, id) => db.tickets.find((t) => t.id === id && inScope(user, "maintenance")(t)) || fail(404, "Ticket not found");
const listRow = (t) => { const n = nowIso(); const active = ACTIVE.includes(t.status); return { ...omit(t, ["messages"]), overdue: active && t.due_at < n, reply_overdue: active && !t.first_response_at && t.respond_by < n, category_label: catLabel(t.category) }; };

route("GET", "/tickets/options", () => ({ categories: Object.entries(CATEGORIES).map(([key, [label, group]]) => ({ key, label, group })), statuses: STATUSES, flow: FLOW, sla: SLA }), { perm: ["maintenance", "r"] });
function staffList(user, q = {}) {
  const re = q.q ? new RegExp(String(q.q).slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
  return sortBy(db.tickets.filter((t) => inScope(user, "maintenance")(t) && (q.status === "active" ? ACTIVE.includes(t.status) : !q.status || t.status === q.status)
    && (!q.category || t.category === q.category) && (!q.mine || t.assigned_to === user.id) && (!re || re.test(t.title) || re.test(t.code) || re.test(t.property_title || "") || re.test(t.raised_by?.name || ""))), "last_message_at", -1).map(listRow);
}
route("GET", "/tickets", ({ user, query }) => staffList(user, query), { perm: ["maintenance", "r"] });
route("GET", "/tickets/stats", ({ user }) => {
  const rows = staffList(user);
  const active = rows.filter((r) => ACTIVE.includes(r.status));
  const rated = rows.filter((r) => r.rating).map((r) => r.rating.stars);
  return { active: active.length, new: rows.filter((r) => r.status === "open").length, overdue: active.filter((r) => r.overdue).length, unanswered: active.filter((r) => r.reply_overdue).length,
    unread: active.filter((r) => r.unread_staff).length, avg_rating: rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10 : null, rated: rated.length };
}, { perm: ["maintenance", "r"] });
route("POST", "/tickets", ({ user, body: b }) => {
  const data = { ...b };
  if (b.lease_id) {
    const ls = db.leases.find((l) => l.id === b.lease_id && (!can(user, "leases", "r") || inScope(user, "leases")(l))) || fail(404, "Lease not found");
    data.property_id = data.property_id || ls.property_id; data.customer_id = data.customer_id || ls.customer_id || null;
  }
  if (data.property_id) checkBranch(user, (prop(data.property_id) || fail(404, "Property not found")).branch_id);
  else data.branch_id = homeBranch(user);
  const t = createTicket(data, user, "staff", b.channel || "phone");
  Object.assign(t, { first_response_at: nowIso(), unread_customer: false });
  notifyCustomer(t, `We logged your request ${t.code}`, t.title);
  return t;
}, { perm: ["maintenance", "w"] });
route("GET", "/tickets/:id", ({ user, params }) => {
  const t = staffTicket(user, params.id);
  const out = { ...t, category_label: catLabel(t.category), files: sortBy(db.documents.filter((d) => d.entity_type === "ticket" && d.entity_id === t.id && d.is_latest), "created_at").map(({ demo_url, ...d }) => d) }; // eslint-disable-line no-unused-vars
  if (t.work_order_id) out.work_order = omit(one("work_orders", (w) => w.id === t.work_order_id) || {}, ["history"]);
  if (t.customer_id) out.customer = pick(one("customers", (c) => c.id === t.customer_id) || {}, ["id", "code", "name", "phone", "email", "language"]);
  if (t.lease_id) out.lease = pick(one("leases", (l) => l.id === t.lease_id) || {}, ["id", "code", "tenant_name", "tenant_phone", "status"]);
  t.unread_staff = false;
  return out;
}, { perm: ["maintenance", "r"] });
route("PATCH", "/tickets/:id", ({ user, params, body: b }) => {
  const t = staffTicket(user, params.id);
  const upd = { updated_at: nowIso() }; const events = [];
  if (b.status && b.status !== t.status) {
    if (!FLOW[t.status].includes(b.status)) fail(422, `Cannot move a ${t.status.replace("_", " ")} ticket to ${b.status.replace("_", " ")}`);
    upd.status = b.status; events.push(`Status: ${b.status.replace("_", " ")}`);
    if (b.status === "resolved") upd.resolved_at = nowIso();
    if (b.status === "closed") upd.closed_at = nowIso();
    if (!t.first_response_at) upd.first_response_at = nowIso();
  }
  if (b.assigned_to != null && b.assigned_to !== (t.assigned_to || "")) {
    if (b.assigned_to) {
      const a = db.users.find((u) => u.id === b.assigned_to && u.active);
      if (!a || PORTAL_ROLES.includes(a.role)) fail(422, "Assign the ticket to a staff member");
      Object.assign(upd, { assigned_to: a.id, assigned_name: a.name }); events.push(`Assigned to ${a.name}`);
      notify([a.id], `Ticket ${t.code} assigned to you`, t.title, `/erp/tickets/${t.id}`, `tka:${t.id}:${a.id}`);
    } else { Object.assign(upd, { assigned_to: null, assigned_name: null }); events.push("Unassigned"); }
  }
  if (b.priority && b.priority !== t.priority) { Object.assign(upd, { priority: b.priority, due_at: due(b.priority, 1, t.created_at), respond_by: due(b.priority, 0, t.created_at) }); events.push(`Priority: ${b.priority}`); }
  if (b.category && b.category !== t.category) { if (!CATEGORIES[b.category]) fail(422, "Unknown category"); Object.assign(upd, { category: b.category, group: CATEGORIES[b.category][1] }); events.push(`Type: ${catLabel(b.category)}`); }
  if (!events.length && !b.note) return t;
  const msgs = events.map((e) => msg(user, e, "staff", false, "event"));
  if (b.note) {
    msgs.push(msg(user, String(b.note).trim(), "staff"));
    Object.assign(upd, { unread_customer: true, last_message_at: nowIso() });
    if (!t.first_response_at) upd.first_response_at = nowIso();
    if (t.status === "open" && !upd.status) upd.status = "acknowledged";
  }
  Object.assign(t, upd); t.messages.push(...msgs);
  audit(user, "ticket_updated", "maintenance", t.id, omit(upd, ["updated_at"]));
  if (upd.status || b.note) notifyCustomer(t, `Your request ${t.code} ${upd.status ? `is ${upd.status.replace("_", " ")}` : "has a reply"}`, b.note || t.title);
  return t;
}, { perm: ["maintenance", "w"] });
route("POST", "/tickets/:id/messages", ({ user, params, body: b }) => {
  const t = staffTicket(user, params.id);
  const m = msg(user, strOk(b.text, 1, 3000, "text"), "staff", !!b.internal);
  t.updated_at = nowIso();
  if (!b.internal) { Object.assign(t, { last_message_at: nowIso(), unread_customer: true }); if (!t.first_response_at) { t.first_response_at = nowIso(); if (t.status === "open") t.status = "acknowledged"; } }
  t.messages.push(m);
  if (!b.internal) notifyCustomer(t, `Reply on your request ${t.code}`, String(b.text).slice(0, 140));
  return m;
}, { perm: ["maintenance", "w"] });
async function saveFile(t, files, user, byRole) {
  const f = files.file?.[0] || fail(422, "Choose a file");
  const ok = byRole === "staff" ? ["application/pdf", "image/jpeg", "image/png", "image/webp", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] : ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  if (!ok.includes(f.type)) fail(422, `File type not allowed: ${f.type || "unknown"}`);
  if (f.size > 10 * 1024 * 1024) fail(422, "File too large (max 10 MB)");
  if (db.documents.filter((d) => d.entity_type === "ticket" && d.entity_id === t.id).length >= 20) fail(422, "A ticket can hold up to 20 files");
  const d = { id: newId(), demo_url: f.size < 4e6 ? await fileToDataUrl(f) : null, size: f.size, content_type: f.type, original_name: f.name, entity_type: "ticket", entity_id: t.id,
    doc_type: f.type.startsWith("image/") ? "photo" : "other", version: 1, is_latest: true, uploaded_by: user.id, uploaded_by_name: user.name, by_role: byRole, created_at: nowIso() };
  db.documents.push(d);
  t.messages.push(msg(user, `Added ${d.original_name}`, byRole, false, "file"));
  Object.assign(t, { updated_at: nowIso(), last_message_at: nowIso(), [byRole === "staff" ? "unread_customer" : "unread_staff"]: true });
  const { demo_url, ...out } = d; // eslint-disable-line no-unused-vars
  return out;
}
route("POST", "/tickets/:id/files", ({ user, params, files }) => saveFile(staffTicket(user, params.id), files, user, "staff"), { perm: ["maintenance", "w"] });
route("POST", "/tickets/:id/work-order", ({ user, params, body: b }) => {
  const t = staffTicket(user, params.id);
  if (!t.property_id) fail(422, "Link the ticket to a property first");
  if (t.work_order_id) fail(409, "This ticket already has a work order");
  const wo = createWorkOrder({ property_id: t.property_id, title: `${t.title} (${t.code})`, description: t.description, category: t.group, priority: t.priority, due_date: b.due_date || null,
    vendor_id: b.vendor_id || null, quote_amount: b.quote_amount ?? null, charge_to: b.charge_to || "owner", reported_by: `${t.raised_by.name} (${t.raised_by.role})` }, user);
  wo.ticket_id = t.id;
  const was = t.status;
  Object.assign(t, { work_order_id: wo.id, updated_at: nowIso() });
  if (["open", "acknowledged", "on_hold"].includes(was)) t.status = "in_progress";
  if (!t.first_response_at) t.first_response_at = nowIso();
  t.messages.push(msg(user, `Work order ${wo.code} raised`, "staff", false, "event"));
  if (t.status !== was) notifyCustomer(t, `Work has been scheduled for ${t.code}`, t.title);
  return { ...t, work_order: wo };
}, { perm: ["maintenance", "w"] });
export function onWorkOrderDone(wo, user) {
  const t = db.tickets.find((x) => x.work_order_id === wo.id);
  if (!t || ["resolved", "closed", "cancelled"].includes(t.status)) return;
  Object.assign(t, { status: "resolved", resolved_at: nowIso(), updated_at: nowIso(), unread_customer: true, last_message_at: nowIso() });
  t.messages.push(msg(user, "The work is complete. If anything is still not right, reopen this request.", "staff"));
  notifyCustomer(t, `Your request ${t.code} is resolved`, t.title);
}

// ---------------- the customer's side (/my/*) ----------------
function buyerRecords(cid) {
  const c = one("customers", (x) => x.id === cid) || {};
  const leads = sortBy(db.leads.filter((l) => l.customer_id === cid && notDeleted(l)), "created_at", -1);
  const lids = leads.map((l) => l.id);
  const deals = sortBy(db.deals.filter((d) => notDeleted(d) && (lids.includes(d.lead_id) || (c.phone && d.buyer_phone === c.phone))), "created_at", -1);
  return { c, leads, deals };
}
function myContext(user) {
  const { role, id: uid } = user;
  let pids = []; let filter; let leases = [];
  if (role === "tenant") {
    leases = db.leases.filter((l) => l.customer_id === user.customer_id).map((l) => pick(l, ["id", "code", "property_id", "status", "end_date"]));
    pids = leases.map((l) => l.property_id);
    filter = (t) => t.raised_by?.user_id === uid || t.customer_id === user.customer_id;
  } else if (role === "owner") {
    pids = db.properties.filter((p) => p.owner_id === user.owner_id && notDeleted(p)).map((p) => p.id);
    filter = (t) => t.raised_by?.user_id === uid || (t.owner_id === user.owner_id && t.visible_to_owner);
  } else if (role === "buyer") {
    const { leads, deals } = buyerRecords(user.customer_id);
    const shared = db.lead_activities.filter((a) => leads.some((l) => l.id === a.lead_id) && a.kind === "shared_listing" && a.property_id).map((a) => a.property_id);
    pids = [...new Set([...deals.map((d) => d.property_id).filter(Boolean), ...shared])];
    filter = (t) => t.raised_by?.user_id === uid || t.customer_id === user.customer_id;
  } else filter = (t) => t.raised_by?.user_id === uid;
  const props = db.properties.filter((p) => pids.includes(p.id)).map((p) => pick(p, ["id", "title", "code", "locality", "city"]));
  return { filter, props, leases };
}
const mine = (user, id) => { const { filter } = myContext(user); return db.tickets.find((t) => t.id === id && filter(t)) || fail(404, "Request not found"); };
const canReply = (t, user) => t.raised_by?.user_id === user.id || (!!t.customer_id && t.customer_id === user.customer_id);
function custView(t, user) {
  return { ...omit(t, ["messages", "assigned_to", "unread_staff", "work_order_id"]), messages: (t.messages || []).filter((m) => !m.internal), category_label: catLabel(t.category),
    can_reply: canReply(t, user), assigned_name: (t.assigned_name || "").split(" ")[0] || null };
}
const writable = (user, id) => { const t = mine(user, id); if (!canReply(t, user)) fail(403, "You can follow this request but not reply to it"); return t; };

route("GET", "/my/ticket-options", ({ user }) => {
  const { props, leases } = myContext(user);
  return { categories: (ROLE_CATS[user.role] || ["other"]).map((k) => ({ key: k, label: catLabel(k), group: CATEGORIES[k][1] })), properties: props, leases };
}, { auth: "portal" });
route("GET", "/my/tickets", ({ user }) => { const { filter } = myContext(user); return sortBy(db.tickets.filter(filter), "last_message_at", -1).map((t) => { const v = custView(t, user); v.message_count = v.messages.length; delete v.messages; return v; }); }, { auth: "portal" });
route("POST", "/my/tickets", ({ user, body: b }) => {
  const { props, leases } = myContext(user);
  if (!(ROLE_CATS[user.role] || []).includes(b.category)) fail(422, "Choose a type of request");
  const data = pick(b, ["category", "title", "description", "priority", "property_id", "preferred_time", "permission_to_enter"]);
  if (data.property_id && !props.some((p) => p.id === data.property_id)) fail(404, "Property not found");
  if (!data.property_id && props.length === 1 && ["tenant", "owner"].includes(user.role)) data.property_id = props[0].id;
  if (["tenant", "buyer"].includes(user.role)) { data.customer_id = user.customer_id; data.branch_id = one("customers", (c) => c.id === user.customer_id)?.branch_id || null; }
  if (user.role === "tenant" && data.property_id) { const ls = leases.find((x) => x.property_id === data.property_id && x.status === "active") || leases.find((x) => x.property_id === data.property_id); data.lease_id = ls?.id || null; }
  if (user.role === "owner") data.owner_id = user.owner_id;
  if (user.role === "investor") { const inv = one("investors", (i) => i.id === user.investor_id) || {}; data.branch_id = inv.branch_id || null; data.assigned_to = inv.rm_id || null; }
  const t = createTicket(data, user, user.role, "portal");
  notifyStaff(t, `New request ${t.code}: ${t.title}`, `${catLabel(t.category)} · ${user.name}`);
  return custView(t, user);
}, { auth: "portal" });
route("GET", "/my/tickets/:id", ({ user, params }) => {
  const t = mine(user, params.id);
  const v = custView(t, user);
  v.files = sortBy(db.documents.filter((d) => d.entity_type === "ticket" && d.entity_id === t.id && d.is_latest), "created_at").map(({ demo_url, ...d }) => d); // eslint-disable-line no-unused-vars
  if (t.work_order_id) v.work_order = pick(one("work_orders", (w) => w.id === t.work_order_id) || {}, ["code", "status", "due_date"]);
  if (t.unread_customer && v.can_reply) t.unread_customer = false;
  return v;
}, { auth: "portal" });
route("POST", "/my/tickets/:id/messages", ({ user, params, body: b }) => {
  const t = writable(user, params.id);
  if (t.status === "cancelled") fail(422, "This request was cancelled. Raise a new one.");
  const m = msg(user, strOk(b.text, 1, 3000, "text"), user.role);
  Object.assign(t, { updated_at: nowIso(), last_message_at: nowIso(), unread_staff: true }); t.messages.push(m);
  notifyStaff(t, `Reply on ${t.code} from ${user.name}`, String(b.text).slice(0, 140));
  return m;
}, { auth: "portal" });
route("POST", "/my/tickets/:id/files", ({ user, params, files }) => { const t = writable(user, params.id); if (["cancelled", "closed"].includes(t.status)) fail(422, "This request is closed"); return saveFile(t, files, user, user.role); }, { auth: "portal" });
route("POST", "/my/tickets/:id/files/:did/link", ({ user, params }) => {
  mine(user, params.id);
  db.documents.find((d) => d.id === params.did && d.entity_type === "ticket" && d.entity_id === params.id) || fail(404, "File not found");
  return { url: `/api/files/demo-${params.did}`, expires_in: 300 };
}, { auth: "portal" });
route("POST", "/my/tickets/:id/cancel", ({ user, params, body }) => {
  const t = writable(user, params.id);
  if (!["open", "acknowledged", "on_hold"].includes(t.status)) fail(422, "Work has started on this request; reply to it instead");
  const reason = String(body.reason || "No longer needed").slice(0, 300);
  Object.assign(t, { status: "cancelled", updated_at: nowIso(), unread_staff: true }); t.messages.push(msg(user, `Cancelled: ${reason}`, user.role, false, "event"));
  notifyStaff(t, `${t.code} cancelled by ${user.name}`, reason);
  return { ok: true };
}, { auth: "portal" });
route("POST", "/my/tickets/:id/reopen", ({ user, params, body }) => {
  const t = writable(user, params.id);
  if (!["resolved", "closed"].includes(t.status)) fail(422, "Only a resolved request can be reopened");
  const text = String(body.text || "It is still not fixed").slice(0, 1000);
  Object.assign(t, { status: "in_progress", resolved_at: null, closed_at: null, rating: null, updated_at: nowIso(), last_message_at: nowIso(), unread_staff: true });
  t.messages.push(msg(user, "Reopened", user.role, false, "event"), msg(user, text, user.role));
  notifyStaff(t, `${t.code} reopened by ${user.name}`, text);
  return { ok: true };
}, { auth: "portal" });
route("POST", "/my/tickets/:id/rate", ({ user, params, body: b }) => {
  const t = writable(user, params.id);
  if (!["resolved", "closed"].includes(t.status)) fail(422, "You can rate a request once it is resolved");
  const stars = Number(b.stars);
  if (!(stars >= 1 && stars <= 5)) fail(422, "stars: 1 to 5");
  const rating = { stars, comment: b.comment || null, at: nowIso() };
  Object.assign(t, { rating, status: "closed", closed_at: t.closed_at || nowIso(), updated_at: nowIso(), unread_customer: false });
  t.messages.push(msg(user, `Rated ${stars}/5${b.comment ? `: ${b.comment}` : ""}`, user.role, false, "event"));
  if (stars <= 2) notifyStaff(t, `Low rating on ${t.code} (${stars}/5)`, b.comment || t.title);
  return { ok: true, rating };
}, { auth: "portal" });

// ======================================================================================== bills & notices
const KINDS = { electricity: "Electricity (EB)", water: "Water", maintenance: "Maintenance / association", gas: "Gas", internet: "Internet / DTH", parking: "Parking", cleaning: "Cleaning service",
  property_tax: "Property tax share", repair: "Repair recovery", other: "Other" };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function periodText(a, b) {
  const [ya, ma] = [Number(a.slice(0, 4)), Number(a.slice(5, 7))];
  if (!b || b === a) return `${MON[ma - 1]} ${ya}`;
  const [yb, mb] = [Number(b.slice(0, 4)), Number(b.slice(5, 7))];
  return ya === yb ? `${MON[ma - 1]}–${MON[mb - 1]} ${yb}` : `${MON[ma - 1]} ${ya}–${MON[mb - 1]} ${yb}`;
}
export function chargeView(c) {
  const open = ["due", "partly_paid"].includes(c.status);
  return { ...c, balance: c.status === "waived" ? 0 : r2(c.amount - (c.paid || 0)), kind_label: KINDS[c.kind] || c.kind, overdue: open && c.due_date < todayIST() };
}
const leaseFor = (user, id) => db.leases.find((l) => l.id === id && inScope(user, "leases")(l)) || fail(404, "Lease not found");
const chargeFor = (user, id) => { const c = db.lease_charges.find((x) => x.id === id) || fail(404, "Bill not found"); leaseFor(user, c.lease_id); return c; };
const tenantIds = (l) => (l.customer_id ? db.users.filter((u) => u.role === "tenant" && u.customer_id === l.customer_id && u.active).map((u) => u.id) : []);

export function leaseExtras(l, user) {
  const pays = sortBy(db.charge_payments.filter((p) => p.lease_id === l.id), "date", -1);
  const charges = sortBy(db.lease_charges.filter((c) => c.lease_id === l.id), "due_date", -1).map((c) => ({ ...chargeView(c), payments: pays.filter((p) => p.charge_id === c.id).map((p) => pick(p, ["id", "charge_id", "amount", "date", "method", "reference", "receipt_no", "source"])) }));
  return {
    charges, bills_due: r2(charges.filter((c) => ["due", "partly_paid"].includes(c.status)).reduce((s, c) => s + c.balance, 0)),
    payment_notices: sortBy(db.payment_notices.filter((n) => n.lease_id === l.id), "created_at", -1),
    tenant_logins: l.customer_id && can(user, "users", "r") ? db.users.filter((u) => u.role === "tenant" && u.customer_id === l.customer_id).map((u) => pick(u, ["id", "email", "active", "last_login"])) : [],
    tickets: sortBy(db.tickets.filter((t) => t.lease_id === l.id), "created_at", -1).map((t) => pick(t, ["id", "code", "title", "status", "category", "created_at"])),
  };
}

route("GET", "/charges", ({ user, query: q }) => {
  const lids = db.leases.filter((l) => inScope(user, "leases")(l)).map((l) => l.id);
  return sortBy(db.lease_charges.filter((c) => lids.includes(c.lease_id) && (q.status === "open" ? ["due", "partly_paid"].includes(c.status) : !q.status || c.status === q.status) && (!q.kind || c.kind === q.kind)), "due_date", -1).map(chargeView);
}, { perm: ["leases", "r"] });
route("POST", "/leases/:id/charges", ({ user, params, body: b }) => {
  const l = leaseFor(user, params.id);
  if (!KINDS[b.kind]) fail(422, "Choose the type of bill");
  if (!/^\d{4}-\d{2}$/.test(b.period || "")) fail(422, "period: use YYYY-MM");
  if (b.period_to && b.period_to < b.period) fail(422, "The billing period ends before it starts");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.due_date || "")) fail(422, "due_date: choose a date");
  const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
  const [prev, curr, rate, fixed] = [num(b.reading_prev), num(b.reading_curr), num(b.rate), Number(b.fixed || 0)];
  let units = null; let amount;
  if (curr != null) {
    if (prev == null || rate == null) fail(422, "Enter the previous reading and the rate per unit");
    if (curr < prev) fail(422, "The current reading cannot be lower than the previous one");
    units = r2(curr - prev); amount = r2(units * rate + fixed);
  } else { if (!(Number(b.amount) > 0)) fail(422, "Enter the bill amount, or the meter readings and rate"); amount = r2(Number(b.amount)); }
  const mode = b.mode === "direct" ? "direct" : "collect"; const payee = b.payee === "company" ? "company" : "owner";
  const c = { id: newId(), code: nextCode("bill", "BL-", 5), lease_id: l.id, lease_code: l.code, property_id: l.property_id, property_title: l.property_title, owner_id: l.owner_id || null,
    customer_id: l.customer_id || null, branch_id: l.branch_id || null, tenant_name: l.tenant_name, kind: b.kind, period: b.period, period_to: b.period_to || null, consumer_no: b.consumer_no || null,
    reading_prev: prev, reading_curr: curr, rate, fixed, due_date: b.due_date, mode, payee, notes: b.notes || null, label: String(b.label || "").trim() || `${KINDS[b.kind]} ${periodText(b.period, b.period_to)}`,
    units, amount, paid: 0, status: "due", created_by: user.id, created_at: nowIso() };
  db.lease_charges.push(c);
  audit(user, "bill_added", "leases", l.id, { bill: c.code, amount, kind: b.kind });
  notify(tenantIds(l), `New bill: ${c.label}`, `${inr(amount)} due on ${b.due_date}`, "/tenant/bills", `bill:${c.id}`);
  return chargeView(c);
}, { perm: ["leases", "w"] });
function applyChargePayment(c, b, user, source = "staff") {
  if (["paid", "waived"].includes(c.status)) fail(422, "This bill is already settled");
  const bal = r2(c.amount - (c.paid || 0)); const amt = r2(Number(b.amount));
  if (!(amt > 0)) fail(422, "amount: enter the amount");
  if (amt > bal + 0.001) fail(422, `Amount exceeds the balance of ${inr(bal)}`);
  if (db.charge_payments.some((p) => p.idempotency_key === b.idempotency_key)) fail(409, "This payment was already recorded");
  const l = one("leases", (x) => x.id === c.lease_id) || {};
  const p = { id: newId(), charge_id: c.id, charge_code: c.code, lease_id: c.lease_id, lease_code: c.lease_code, owner_id: c.owner_id, property_id: c.property_id, kind: c.kind, label: c.label, mode: c.mode,
    payee: c.payee, amount: amt, date: b.date, month: String(b.date).slice(0, 7), method: b.method, reference: b.reference || null, idempotency_key: b.idempotency_key, source,
    receipt_no: c.mode === "collect" ? nextCode("bill_receipt", "BR-", 5) : null, by: user.id, by_name: user.name, created_at: nowIso() };
  db.charge_payments.push(p);
  c.paid = r2((c.paid || 0) + amt);
  c.status = c.paid >= c.amount - 0.001 ? "paid" : "partly_paid";
  if (c.status === "paid") c.paid_at = nowIso();
  if (c.mode === "collect") {
    if (c.payee === "owner") postLedger("owner_funds", "in", amt, "charge", p.id, `${c.label} ${c.lease_code} collected for owner`, user, c.owner_id, "charges_collected", c.branch_id);
    else postLedger("company", "in", amt, "charge", p.id, `${c.label} ${c.lease_code}`, user, l.tenant_name, "revenue:services", c.branch_id);
  }
  audit(user, "bill_payment", "leases", c.lease_id, { bill: c.code, amount: amt, source });
  return p;
}
route("POST", "/charges/:id/pay", ({ user, params, body: b }) => {
  const c = chargeFor(user, params.id);
  const p = applyChargePayment(c, b, user);
  notify(tenantIds(one("leases", (l) => l.id === c.lease_id) || {}), `Payment received: ${c.label}`, inr(p.amount), "/tenant/bills", `billpay:${p.id}`);
  return { ...p, bill_status: c.status };
}, { perm: ["leases", "w"] });
route("POST", "/charges/:id/waive", ({ user, params, body }) => {
  const c = chargeFor(user, params.id);
  if (c.paid) fail(422, "Part of this bill is paid; it cannot be waived");
  const reason = String(body.reason || "").trim(); if (reason.length < 3) fail(422, "Give a reason");
  Object.assign(c, { status: "waived", waived_reason: reason.slice(0, 300), waived_by: user.name });
  audit(user, "bill_waived", "leases", c.lease_id, { bill: c.code, reason });
  return { ok: true };
}, { perm: ["leases", "w"] });
route("DELETE", "/charges/:id", ({ user, params }) => {
  const c = chargeFor(user, params.id);
  if (c.paid) fail(422, "A bill with payments cannot be deleted");
  db.lease_charges = db.lease_charges.filter((x) => x.id !== c.id);
  audit(user, "bill_deleted", "leases", c.lease_id, { bill: c.code });
  return { ok: true };
}, { perm: ["leases", "w"] });
route("GET", "/charges/:id/payments", ({ user, params }) => { chargeFor(user, params.id); return sortBy(db.charge_payments.filter((p) => p.charge_id === params.id), "date", -1); }, { perm: ["leases", "r"] });

route("GET", "/payment-notices", ({ user, query: q }) => {
  const lids = db.leases.filter((l) => inScope(user, "leases")(l)).map((l) => l.id);
  const st = q.status || "pending";
  return sortBy(db.payment_notices.filter((n) => lids.includes(n.lease_id) && (st === "all" || n.status === st)), "created_at", -1);
}, { perm: ["leases", "r"] });
const noticeFor = (user, id) => { const n = db.payment_notices.find((x) => x.id === id) || fail(404, "Notice not found"); leaseFor(user, n.lease_id); if (n.status !== "pending") fail(409, "This notice was already handled"); return n; };
route("POST", "/payment-notices/:id/confirm", ({ user, params, body }) => {
  const n = noticeFor(user, params.id);
  const amount = Number(body.amount || n.amount); const date = body.date || n.date;
  let ref;
  if (n.kind === "rent") {
    const l = leaseFor(user, n.lease_id);
    const rec = recordRent(l, { period: n.period, amount, method: n.method, reference: n.reference, date, idempotency_key: `notice-${n.id}` }, user);
    ref = { rent_payment_id: rec.id, receipt_no: rec.receipt_no };
  } else {
    const c = db.lease_charges.find((x) => x.id === n.charge_id) || fail(404, "Bill not found");
    const p = applyChargePayment(c, { amount, date, method: n.method, reference: n.reference, idempotency_key: `notice-${n.id}` }, user, "tenant_notice");
    ref = { charge_payment_id: p.id, receipt_no: p.receipt_no };
  }
  Object.assign(n, { status: "confirmed", handled_by: user.name, handled_at: nowIso(), ...ref });
  notify([n.user_id], "Payment confirmed", `${inr(amount)} · ${n.label || n.kind}`, n.kind === "rent" ? "/tenant/rent" : "/tenant/bills", `notice:${n.id}`);
  return { ok: true, ...ref };
}, { perm: ["leases", "w"] });
route("POST", "/payment-notices/:id/reject", ({ user, params, body }) => {
  const n = noticeFor(user, params.id);
  const reason = String(body.reason || "").trim(); if (reason.length < 3) fail(422, "Tell the tenant why");
  Object.assign(n, { status: "rejected", reason: reason.slice(0, 300), handled_by: user.name, handled_at: nowIso() });
  notify([n.user_id], "We could not match your payment", reason, "/tenant/rent", `notice:${n.id}`);
  audit(user, "payment_notice_rejected", "leases", n.lease_id, { reason });
  return { ok: true };
}, { perm: ["leases", "w"] });
route("POST", "/leases/:id/tenant-login", ({ user, params, body }) => {
  const l = leaseFor(user, params.id);
  if (!l.customer_id) linkCustomer("leases", l.id, { name: l.tenant_name, phone: l.tenant_phone, email: l.tenant_email, types: ["tenant"], source: "lease", branch_id: l.branch_id }, user);
  if (!l.customer_id) fail(422, "Add the tenant's mobile number to the lease first");
  return createCustomerLogin("tenant", l.customer_id, body.email || l.tenant_email, user);
}, { perm: ["users", "w"] });

// ======================================================================================== customer logins
const LOGIN_LABEL = { tenant: "tenant", owner: "owner / lessor", investor: "investor", buyer: "buyer" };
export function customerLogins(c) {
  const o = db.owners.find((x) => x.customer_id === c.id); const i = db.investors.find((x) => x.customer_id === c.id);
  return db.users.filter((u) => LOGIN_LABEL[u.role] && (u.customer_id === c.id || (o && u.owner_id === o.id) || (i && u.investor_id === i.id))).map((u) => pick(u, ["id", "email", "role", "active", "last_login", "created_at"]));
}
export function loginTypes(c) {
  const o = db.owners.find((x) => x.customer_id === c.id && notDeleted(x)); const i = db.investors.find((x) => x.customer_id === c.id && notDeleted(x));
  const lease = db.leases.some((l) => l.customer_id === c.id);
  return [{ type: "tenant", ok: lease, why: lease ? null : "No lease with us yet" }, { type: "owner", ok: !!o, why: o ? null : "Not added as an owner yet" },
    { type: "investor", ok: !!i, why: i ? null : "Not added as an investor yet" }, { type: "buyer", ok: true, why: null }];
}
export function createCustomerLogin(kind, cid, email, user) {
  if (!LOGIN_LABEL[kind]) fail(422, "Choose the type of login");
  if (!can(user, "users", "w")) fail(403, "Only administrators create logins");
  const c = db.customers.find((x) => x.id === cid && notDeleted(x) && !x.merged_into) || fail(404, "Customer not found");
  const e = String(email || c.email || "").trim().toLowerCase();
  if (!e) fail(422, "Add the customer's email address first");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) fail(422, "Enter a valid email address");
  const t = loginTypes(c).find((x) => x.type === kind);
  if (!t.ok) fail(422, `Cannot make a ${LOGIN_LABEL[kind]} login: ${t.why.toLowerCase()}`);
  const extra = kind === "owner" ? { owner_id: db.owners.find((x) => x.customer_id === cid).id } : kind === "investor" ? { investor_id: db.investors.find((x) => x.customer_id === cid).id } : { customer_id: cid };
  const out = createUser({ email: e, name: c.name.slice(0, 100), role: kind, phone: c.phone, ...extra }, user);
  if (!c.email) c.email = e;
  c.types = [...new Set([...(c.types || []), kind])];
  c.updated_at = nowIso();
  audit(user, "customer_login_created", "customers", cid, { type: kind, email: e });
  return out;
}
route("POST", "/customers/:id/logins", ({ user, params, body }) => {
  if (can(user, "customers", "r")) db.customers.find((x) => x.id === params.id && inScope(user, "customers")(x)) || fail(404, "Customer not found");
  return createCustomerLogin(body.type || "", params.id, body.email, user);
}, { perm: ["users", "w"] });

// ======================================================================================== tenant portal
const HIDE = ["notes", "mgmt_fee_pct", "owner_id", "manager_id", "issues"];
const tLeases = (user) => sortBy(db.leases.filter((l) => l.customer_id === user.customer_id), (l) => `${l.status === "active" ? 0 : 1}${l.end_date}`);
const tLease = (user, id) => db.leases.find((l) => l.id === id && l.customer_id === user.customer_id) || fail(404, "Lease not found");
function rentSummary(l) {
  const t = todayIST(); const sched = l.schedule || [];
  const nxt = sched.find((s) => s.paid < s.amount - 0.001);
  return { arrears: r2(sched.filter((s) => s.due_date < t).reduce((a, s) => a + s.amount - s.paid, 0)),
    next_due: nxt ? { period: nxt.period, due_date: nxt.due_date, balance: r2(nxt.amount - nxt.paid), overdue: nxt.due_date < t } : null, paid_total: r2(sched.reduce((a, s) => a + s.paid, 0)) };
}
const payTo = () => { const s = settings(); return { upi_id: s.pay_upi_id || null, account_name: s.pay_account_name || null, bank_name: s.pay_bank_name || null, account_no: s.pay_account_no || null, ifsc: s.pay_ifsc || null, note: s.pay_note || null, company_phone: s.phone || null, company_whatsapp: s.whatsapp || null }; };
route("GET", "/tenant/overview", ({ user }) => {
  const c = pick(one("customers", (x) => x.id === user.customer_id) || {}, ["id", "code", "name", "phone", "email"]);
  const leases = tLeases(user);
  const out = leases.map((l) => ({ ...pick(l, ["id", "code", "property_id", "property_title", "status", "start_date", "end_date", "rent", "due_day", "deposit", "deposit_held", "escalation_pct", "lease_type"]), ...rentSummary(l),
    property: pick(one("properties", (p) => p.id === l.property_id) || {}, ["title", "locality", "city", "images", "category", "address"]),
    manager: l.manager_id ? pick(one("users", (u) => u.id === l.manager_id) || {}, ["name", "phone", "whatsapp", "email"]) : null }));
  const lids = leases.map((l) => l.id);
  const bills = sortBy(db.lease_charges.filter((b) => lids.includes(b.lease_id) && ["due", "partly_paid"].includes(b.status)), "due_date").map(chargeView);
  return { customer: c, leases: out, bills_due: bills, bills_total: r2(bills.reduce((s, b) => s + b.balance, 0)),
    open_requests: db.tickets.filter((t) => t.customer_id === user.customer_id && ACTIVE.includes(t.status)).length,
    pending_notices: db.payment_notices.filter((n) => n.user_id === user.id && n.status === "pending").length, pay_to: payTo() };
}, { auth: "tenant" });
route("GET", "/tenant/leases/:id", ({ user, params }) => {
  const l = tLease(user, params.id);
  return { ...omit(l, HIDE), ...rentSummary(l),
    payments: sortBy(db.rent_payments.filter((p) => p.lease_id === l.id), "date", -1).map((p) => pick(p, ["id", "period", "amount", "date", "method", "reference", "receipt_no"])),
    deposit_movements: sortBy(db.deposit_movements.filter((m) => m.lease_id === l.id), "created_at", -1).map((m) => pick(m, ["amount", "direction", "reason", "created_at"])),
    handovers: (l.handovers || []).map((h) => pick(h, ["kind", "date", "meter_readings", "notes", "items"])),
    notices: sortBy(db.payment_notices.filter((n) => n.lease_id === l.id && n.user_id === user.id), "created_at", -1) };
}, { auth: "tenant" });
route("GET", "/tenant/bills", ({ user }) => {
  const lids = tLeases(user).map((l) => l.id);
  return sortBy(db.lease_charges.filter((b) => lids.includes(b.lease_id)), "due_date", -1).map((b) => ({
    ...omit(chargeView(b), ["owner_id", "branch_id", "customer_id", "payee", "created_by"]),
    payments: sortBy(db.charge_payments.filter((p) => p.charge_id === b.id), "date", -1).map((p) => pick(p, ["id", "charge_id", "amount", "date", "method", "reference", "receipt_no"])) }));
}, { auth: "tenant" });
route("GET", "/tenant/pay", ({ user, query: q }) => {
  const l = tLease(user, q.lease_id);
  let amount; let label; let period = null;
  if ((q.kind || "rent") === "rent") {
    const s = q.period ? l.schedule.find((x) => x.period === q.period) : l.schedule.find((x) => x.paid < x.amount - 0.001);
    if (!s) fail(404, "Nothing due for that month");
    amount = r2(s.amount - s.paid); label = `Rent ${periodText(s.period)} · ${l.code}`; period = s.period;
  } else {
    const c = db.lease_charges.find((x) => x.id === q.charge_id && x.lease_id === l.id) || fail(404, "Bill not found");
    amount = r2(c.amount - (c.paid || 0)); label = `${c.code} ${c.label}`;
    if (c.mode === "direct") return { amount, label, direct: true, consumer_no: c.consumer_no, message: "Pay this bill straight to the provider (for EB: TNPDCL / TANGEDCO online or at the EB office), then tell us the reference." };
  }
  const to = payTo();
  const out = { amount, label, period, pay_to: to, direct: false };
  if (to.upi_id && amount > 0) {
    const name = encodeURIComponent(to.account_name || "Sellandiamman Estates");
    out.upi_uri = `upi://pay?pa=${encodeURIComponent(to.upi_id)}&pn=${name}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(label.slice(0, 60))}`;
    // QR codes are drawn by the server; the preview recorded the ones for the sample bills and rent
    out.qr_svg = (META.upi_qr || {})[out.upi_uri] || (META.upi_qr || {})._sample || null;
  }
  return out;
}, { auth: "tenant" });
route("POST", "/tenant/leases/:id/payment-notices", ({ user, params, body: b }) => {
  const l = tLease(user, params.id);
  if (l.status !== "active" && b.kind === "rent") fail(422, "This lease has ended. Call us about any balance.");
  if (!(Number(b.amount) > 0)) fail(422, "amount: enter the amount you paid");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || "")) fail(422, "date: choose the date you paid");
  let label;
  if (b.kind === "rent") { if (!l.schedule.some((s) => s.period === b.period)) fail(422, "Choose a month in your lease"); label = `Rent ${periodText(b.period)}`; }
  else { const c = db.lease_charges.find((x) => x.id === b.charge_id && x.lease_id === l.id); if (!c || ["paid", "waived"].includes(c.status)) fail(422, "Choose a bill that is still due"); label = c.label; }
  if (db.payment_notices.filter((n) => n.user_id === user.id && n.status === "pending").length >= 10) fail(429, "You have several payments waiting for us to check. We will confirm them soon.");
  if (db.payment_notices.some((n) => n.idempotency_key === b.idempotency_key)) fail(409, "We already have this payment");
  const n = { id: newId(), lease_id: l.id, lease_code: l.code, property_title: l.property_title, tenant_name: l.tenant_name, user_id: user.id, kind: b.kind, period: b.kind === "rent" ? b.period : null,
    charge_id: b.kind === "charge" ? b.charge_id : null, amount: Number(b.amount), date: b.date, method: b.method, reference: b.reference || null, note: b.note || null, idempotency_key: b.idempotency_key,
    label, status: "pending", created_at: nowIso() };
  db.payment_notices.push(n);
  const title = `Payment notice: ${l.tenant_name} paid ${Number(b.amount).toLocaleString("en-IN")} (${label})`;
  notify([l.manager_id], title, `${l.code} · ${b.method} ${b.reference || ""}`, `/erp/leases?open=${l.id}`, `pn:${n.id}`);
  notifyRoles(["accountant"], title, l.code, `/erp/leases?open=${l.id}`, `pn:${n.id}`, "info", l.branch_id);
  audit(user, "payment_notice", "leases", l.id, { amount: n.amount, kind: n.kind });
  return n;
}, { auth: "tenant" });
const tDocs = (user) => {
  const lids = tLeases(user).map((l) => l.id);
  return db.documents.filter((d) => d.is_latest && d.share_with_tenant && d.doc_type !== "kyc" && ((d.entity_type === "lease" && lids.includes(d.entity_id)) || (d.entity_type === "customer" && d.entity_id === user.customer_id)));
};
route("GET", "/tenant/documents", ({ user }) => ({ documents: sortBy(tDocs(user), "created_at", -1).map((d) => pick(d, ["id", "original_name", "doc_type", "entity_type", "entity_id", "created_at", "version"])) }), { auth: "tenant" });
route("POST", "/tenant/documents/:id/link", ({ user, params }) => { if (!tDocs(user).some((d) => d.id === params.id)) fail(404, "Not found"); audit(user, "document_link", "documents", params.id, { portal: "tenant" }); return { url: `/api/files/demo-${params.id}`, expires_in: 300 }; }, { auth: "tenant" });

// ======================================================================================== buyer portal
const STEPS = ["negotiation", "agreement", "closing", "won"];
const PUBLIC_PROP = ["id", "code", "listing_id", "title", "locality", "city", "price", "price_unit", "price_on_request", "bedrooms", "category", "transaction", "status", "images", "built_area", "plot_area", "area_unit"];
const agent = (id) => (id ? pick(one("users", (u) => u.id === id) || {}, ["name", "phone", "whatsapp", "email", "designation"]) : null);
route("GET", "/buyer/overview", ({ user }) => {
  const { c, leads, deals } = buyerRecords(user.customer_id);
  const lids = leads.map((l) => l.id);
  const dv = deals.map((d) => ({ ...pick(d, ["id", "code", "title", "deal_type", "property_id", "property_title", "stage", "expected_close", "agreed_value", "created_at", "closed_at"]),
    steps: STEPS.map((s) => ({ key: s, done: (STEPS.includes(d.stage) && STEPS.indexOf(s) < STEPS.indexOf(d.stage)) || d.stage === "won", current: s === d.stage })),
    checklist: (d.checklist || []).map((x) => pick(x, ["item", "done"])), history: (d.history || []).filter((h) => !String(h.event || "").startsWith("Commission")).slice(-12).map((h) => pick(h, ["at", "event"])),
    property: pick(one("properties", (p) => p.id === d.property_id) || {}, PUBLIC_PROP), agent: agent(d.assigned_to) }));
  const shared = [...new Set(db.lead_activities.filter((a) => lids.includes(a.lead_id) && a.kind === "shared_listing" && a.property_id).map((a) => a.property_id))];
  return { customer: pick(c, ["id", "code", "name", "phone", "email"]), deals: dv,
    visits: sortBy(db.site_visits.filter((v) => lids.includes(v.lead_id)), "scheduled_at", -1).map((v) => pick(v, ["id", "property_id", "property_title", "property_code", "scheduled_at", "status"])),
    shortlist: db.properties.filter((p) => shared.includes(p.id) && notDeleted(p) && ["published", "under_offer", "ready_to_market"].includes(p.status)).map((p) => pick(p, PUBLIC_PROP)),
    requirements: leads.map((l) => pick(l, ["code", "interest", "stage", "budget_min", "budget_max", "preferred_locations", "requirements", "created_at"])),
    agent: agent(leads.find((l) => l.assigned_to)?.assigned_to), open_requests: db.tickets.filter((t) => t.customer_id === user.customer_id && ACTIVE.includes(t.status)).length };
}, { auth: "buyer" });
const bDocs = (user) => {
  const { leads, deals } = buyerRecords(user.customer_id);
  return db.documents.filter((d) => d.is_latest && d.share_with_buyer && d.doc_type !== "kyc" && ((d.entity_type === "deal" && deals.some((x) => x.id === d.entity_id)) || (d.entity_type === "lead" && leads.some((x) => x.id === d.entity_id)) || (d.entity_type === "customer" && d.entity_id === user.customer_id)));
};
route("GET", "/buyer/documents", ({ user }) => sortBy(bDocs(user), "created_at", -1).map((d) => pick(d, ["id", "original_name", "doc_type", "entity_type", "created_at", "version"])), { auth: "buyer" });
route("POST", "/buyer/documents/:id/link", ({ user, params }) => { if (!bDocs(user).some((d) => d.id === params.id)) fail(404, "Not found"); return { url: `/api/files/demo-${params.id}`, expires_in: 300 }; }, { auth: "buyer" });

// owner (lessor) portal: tenant bills on their properties
route("GET", "/portal/bills", ({ user }) => sortBy(db.lease_charges.filter((c) => c.owner_id === user.owner_id), "due_date", -1).map((c) => omit(chargeView(c), ["created_by", "customer_id"])), { auth: "owner" });

// ======================================================================================== password vault
// The preview keeps the sample logins' secrets in plain form (demo_secret); the live server stores them AES-256-GCM
// encrypted with VAULT_KEY and decrypts one field at a time, only while the vault is unlocked.
const VMETA = META.vault || { presets: [], categories: [] };
const VCATS = Object.fromEntries((VMETA.categories || []).map((c) => [c.key, c.label]));
const VPRESET = Object.fromEntries((VMETA.presets || []).map((p) => [p.key, p]));
const SHARE_ROLES = Object.keys(ROLES).filter((r) => !PORTAL_ROLES.includes(r) && (PERMS[r]?.vault || "").includes("r"));
state.vault = state.vault || {};
const unlockedUntil = (user) => { const u = state.vault[user.id]; return u && u.sid === state.sid && u.until > Date.now() / 1000 ? u.until : null; };
const needUnlock = (user) => { if (!unlockedUntil(user)) fail(423, "vault_locked"); };
const vVisible = (user) => (it) => it.deleted !== true && (can(user, "vault", "a") || it.created_by === user.id || (it.share_roles || []).includes(user.role) || (it.share_users || []).includes(user.id));
const vEdit = (user, it) => can(user, "vault", "a") || (it.created_by === user.id && can(user, "vault", "w"));
const vGet = (user, id) => db.vault_items.find((it) => it.id === id && vVisible(user)(it)) || fail(404, "Login not found");
function vView(user, it) {
  const days = it.rotate_days || 0;
  const changed = (it.password_changed_at || it.created_at).slice(0, 10);
  const cutoff = new Date(Date.parse(`${todayIST()}T00:00:00Z`) - days * 864e5).toISOString().slice(0, 10);
  return { ...omit(it, ["demo_secret", "secret"]), rotate_due: !!days && !!it.has_password && changed <= cutoff, can_edit: vEdit(user, it), category_label: VCATS[it.category] || "Other" };
}
const shareOk = (roles, users) => [(roles || []).filter((r) => SHARE_ROLES.includes(r)), (users || []).filter((id) => db.users.some((u) => u.id === id && u.active && SHARE_ROLES.includes(u.role)))];
const splitFields = (fields) => [(fields || []).filter((f) => !f.secret && String(f.label || "").trim()).map((f) => ({ label: f.label.trim(), value: String(f.value || "").trim() })),
  (fields || []).filter((f) => f.secret && String(f.label || "").trim()).map((f) => ({ label: f.label.trim(), value: String(f.value || "") }))];
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function cleanTotp(s) {
  if (!s) return null;
  let v = String(s).trim();
  if (v.startsWith("otpauth://")) { try { v = new URL(v).searchParams.get("secret") || ""; } catch { v = ""; } }
  v = v.replace(/\s/g, "").toUpperCase().replace(/=+$/, "");
  if (v.length < 16 || [...v].some((ch) => !B32.includes(ch))) fail(422, "That 2-step key is not valid. Paste the setup key (letters and digits) or the otpauth:// link.");
  return v;
}
async function totpNow(secret) {
  let bits = ""; for (const ch of secret) bits += B32.indexOf(ch).toString(2).padStart(5, "0");
  const key = new Uint8Array(Math.floor(bits.length / 8)).map((_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2));
  const counter = Math.floor(Date.now() / 1000 / 30);
  const msgBuf = new ArrayBuffer(8); new DataView(msgBuf).setUint32(4, counter);
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", k, msgBuf));
  const o = h[h.length - 1] & 15;
  const n = (((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6;
  return String(n).padStart(6, "0");
}

route("GET", "/vault/status", ({ user }) => ({ configured: true, unlocked: !!unlockedUntil(user), until: unlockedUntil(user), mfa: !!user.mfa_enabled, can_add: can(user, "vault", "w"), can_manage: can(user, "vault", "a") }), { perm: ["vault", "r"] });
route("POST", "/vault/unlock", ({ user, body }) => {
  if (body.password !== (user.demo_password || DEMO_PASSWORD)) { audit(user, "vault_unlock_failed", "vault", null); fail(401, "That password is not right"); }
  if (user.mfa_enabled) { const c = String(body.code || "").replace(/\s/g, ""); if (!/^\d{6}$/.test(c) || c === "000000") { audit(user, "vault_unlock_failed", "vault", null, { reason: "2-step code" }); fail(401, "Enter the current 6-digit code from your authenticator app"); } }
  const until = Math.floor(Date.now() / 1000) + 15 * 60;
  state.vault[user.id] = { until, sid: state.sid };
  audit(user, "vault_unlocked", "vault", null);
  return { ok: true, until };
}, { perm: ["vault", "r"] });
route("POST", "/vault/lock", ({ user }) => { delete state.vault[user.id]; return { ok: true }; }, { perm: ["vault", "r"] });
route("GET", "/vault/meta", () => ({ presets: VMETA.presets, categories: VMETA.categories, roles: SHARE_ROLES.map((k) => ({ key: k, label: ROLES[k] })), configured: true }), { perm: ["vault", "r"] });
route("GET", "/vault/items", ({ user, query: q }) => {
  const re = q.q ? new RegExp(String(q.q).slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
  let rows = sortBy(db.vault_items.filter((it) => vVisible(user)(it) && (!q.category || it.category === q.category) && (!q.property_id || (it.property_ids || []).includes(q.property_id))
    && (!re || re.test(it.title) || re.test(it.username || "") || re.test(it.url || "") || (it.tags || []).some((t) => re.test(t)))), "title").map((it) => vView(user, it));
  if (q.due) rows = rows.filter((r) => r.rotate_due);
  return rows;
}, { perm: ["vault", "r"] });
route("POST", "/vault/items", ({ user, body: b }) => {
  needUnlock(user);
  const preset = VPRESET[b.preset] || VPRESET.other || { key: "other", category: "other" };
  const [pub, sec] = splitFields(b.fields);
  const [roles, users] = shareOk(b.share_roles, b.share_users);
  const totp = cleanTotp(b.totp_secret);
  const title = strOk(b.title, 2, 80, "title");
  const it = { id: newId(), title, preset: preset.key, category: VCATS[b.category] ? b.category : preset.category, url: String(b.url || preset.url || "").trim() || null, username: String(b.username || "").trim() || null,
    fields_public: pub, secret_labels: sec.map((x) => x.label), demo_secret: { password: b.password || "", totp, notes: b.notes || "", fields: sec }, has_password: !!b.password, has_totp: !!totp, has_notes: !!b.notes,
    property_ids: (b.property_ids || []).slice(0, 50), share_roles: roles, share_users: users, rotate_days: Number(b.rotate_days || 0), tags: [...new Set((b.tags || []).map((t) => String(t).trim().toLowerCase().slice(0, 24)).filter(Boolean))].slice(0, 10),
    password_changed_at: b.password ? nowIso() : null, created_by: user.id, created_by_name: user.name, created_at: nowIso(), updated_at: nowIso(), deleted: false };
  db.vault_items.push(it);
  audit(user, "vault_item_created", "vault", it.id, { title, shared_roles: roles, shared_users: users.length });
  return vView(user, it);
}, { perm: ["vault", "w"] });
route("GET", "/vault/items/:id", ({ user, params }) => {
  const it = vGet(user, params.id);
  return { ...vView(user, it), history_count: db.vault_history.filter((h) => h.item_id === it.id).length, share_user_names: Object.fromEntries(db.users.filter((u) => (it.share_users || []).includes(u.id)).map((u) => [u.id, u.name])) };
}, { perm: ["vault", "r"] });
route("PATCH", "/vault/items/:id", ({ user, params, body: b }) => {
  needUnlock(user);
  const it = vGet(user, params.id);
  if (!vEdit(user, it)) fail(403, "Only the person who added this login or an administrator can change it");
  const changes = []; const sec = { ...it.demo_secret };
  ["title", "url", "username"].forEach((k) => { if (k in b) { it[k] = String(b[k] || "").trim() || null; changes.push(k); } });
  if (b.category && VCATS[b.category]) it.category = b.category;
  if ("rotate_days" in b) it.rotate_days = Number(b.rotate_days || 0);
  if ("property_ids" in b) it.property_ids = (b.property_ids || []).slice(0, 50);
  if ("share_roles" in b || "share_users" in b) { [it.share_roles, it.share_users] = shareOk(b.share_roles ?? it.share_roles, b.share_users ?? it.share_users); changes.push("sharing"); }
  if ("password" in b && (b.password || "") !== (sec.password || "")) {
    if (sec.password) {
      db.vault_history.push({ id: newId(), item_id: it.id, demo_secret: { ...it.demo_secret }, at: nowIso(), by: user.name, user_id: user.id });
      const hs = sortBy(db.vault_history.filter((h) => h.item_id === it.id), "at", -1).slice(10).map((h) => h.id);
      db.vault_history = db.vault_history.filter((h) => !hs.includes(h.id));
    }
    sec.password = b.password || ""; it.password_changed_at = nowIso(); it.has_password = !!sec.password; changes.push("password");
  }
  if ("totp_secret" in b) { sec.totp = cleanTotp(b.totp_secret); it.has_totp = !!sec.totp; changes.push("2-step key"); }
  if ("notes" in b) { sec.notes = b.notes || ""; it.has_notes = !!sec.notes; changes.push("notes"); }
  if ("fields" in b) { const [pub, s] = splitFields(b.fields); sec.fields = s; it.fields_public = pub; it.secret_labels = s.map((x) => x.label); changes.push("fields"); }
  it.demo_secret = sec; it.updated_at = nowIso();
  audit(user, "vault_item_updated", "vault", it.id, { title: it.title, changed: changes });
  return vView(user, it);
}, { perm: ["vault", "r"] });
route("DELETE", "/vault/items/:id", ({ user, params }) => {
  const it = vGet(user, params.id);
  if (!vEdit(user, it)) fail(403, "Only the person who added this login or an administrator can delete it");
  Object.assign(it, { deleted: true, deleted_at: nowIso(), deleted_by: user.name });
  audit(user, "vault_item_deleted", "vault", it.id, { title: it.title });
  return { ok: true };
}, { perm: ["vault", "r"] });
route("POST", "/vault/items/:id/reveal", ({ user, params, body: b }) => {
  needUnlock(user);
  const it = vGet(user, params.id); const sec = it.demo_secret || {};
  let value;
  if (b.field === "password") value = sec.password || "";
  else if (b.field === "notes") value = sec.notes || "";
  else if (b.field === "totp_secret") { if (!vEdit(user, it)) fail(403, "Only the person who added this login or an administrator can see the 2-step key"); value = sec.totp || ""; }
  else if (String(b.field || "").startsWith("field:")) { const f = (sec.fields || []).find((x) => x.label === b.field.slice(6)); if (!f) fail(404, "No such field"); value = f.value; }
  else fail(422, "Unknown field");
  Object.assign(it, { last_used_at: nowIso(), last_used_by: user.name });
  audit(user, `vault_${b.purpose === "copy" ? "copy" : "view"}`, "vault", it.id, { title: it.title, field: b.field });
  return { value };
}, { perm: ["vault", "r"] });
route("POST", "/vault/items/:id/code", async ({ user, params }) => {
  needUnlock(user);
  const it = vGet(user, params.id);
  const s = it.demo_secret?.totp || fail(404, "This login has no 2-step key saved");
  audit(user, "vault_code", "vault", it.id, { title: it.title });
  return { code: await totpNow(s), seconds_left: 30 - (Math.floor(Date.now() / 1000) % 30) };
}, { perm: ["vault", "r"] });
route("GET", "/vault/items/:id/history", ({ user, params }) => {
  const it = vGet(user, params.id);
  if (!vEdit(user, it)) fail(403, "Only the person who added this login or an administrator can see old passwords");
  return sortBy(db.vault_history.filter((h) => h.item_id === it.id), "at", -1).slice(0, 10).map((h) => omit(h, ["demo_secret", "secret"]));
}, { perm: ["vault", "r"] });
route("POST", "/vault/items/:id/history/:hid/reveal", ({ user, params }) => {
  needUnlock(user);
  const it = vGet(user, params.id);
  if (!vEdit(user, it)) fail(403, "Only the person who added this login or an administrator can see old passwords");
  const h = db.vault_history.find((x) => x.id === params.hid && x.item_id === it.id) || fail(404, "Not found");
  audit(user, "vault_view_old_password", "vault", it.id, { title: it.title, from: h.at });
  return { value: h.demo_secret?.password || "", at: h.at };
}, { perm: ["vault", "r"] });
route("GET", "/vault/activity", ({ user, query: q }) => {
  let rows = db.audit_logs.filter((a) => a.entity === "vault");
  if (q.item_id) { vGet(user, q.item_id); rows = rows.filter((a) => a.entity_id === q.item_id); }
  else if (!can(user, "vault", "a")) { const mineIds = db.vault_items.filter((it) => it.created_by === user.id).map((it) => it.id); rows = rows.filter((a) => mineIds.includes(a.entity_id) || a.user_id === user.id); }
  return sortBy(rows, "at", -1).slice(0, 300).map((a) => omit(a, ["ip"]));
}, { perm: ["vault", "r"] });
