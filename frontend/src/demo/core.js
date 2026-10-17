// Hosted preview: an in-browser copy of the backend's rules (backend/core.py, logic.py), working on the
// snapshot exported from the real backend by demo/export.py. Changes last until the page is reloaded.
import snapshot from "./snapshot.json";

export const META = snapshot.meta;
export const DEMO_PASSWORD = "Demo@12345";
export let db = {};
export const state = { userId: null, sid: null, resetTokens: {}, recovery: {} };

export function resetDb() {
  db = JSON.parse(JSON.stringify(snapshot.db));
  ["users", "branches", "settings", "properties", "owners", "leads", "lead_activities", "site_visits", "deals", "invoices", "payments",
    "credit_notes", "ledger_entries", "leases", "rent_payments", "deposit_movements", "owner_statements", "work_orders", "vendors",
    "bookings", "tasks", "approvals", "expenses", "posts", "documents", "campaigns", "notifications", "audit_logs", "counters", "verifications"]
    .forEach((c) => { if (!db[c]) db[c] = []; });
}
resetDb();

export class HttpError extends Error {
  constructor(status, detail) { super(typeof detail === "string" ? detail : "error"); this.status = status; this.detail = detail; }
}
export const fail = (status, detail) => { throw new HttpError(status, detail); };

export const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
export const nowIso = () => new Date().toISOString();
export const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const nowIstMin = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 16);
export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
export const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
export const notDeleted = (d) => d.deleted !== true;
export const one = (coll, pred) => db[coll].find(pred) || null;
export const where = (coll, pred) => db[coll].filter(pred);
export const sortBy = (rows, key, dir = 1) => [...rows].sort((a, b) => { const x = typeof key === "function" ? key(a) : a[key]; const y = typeof key === "function" ? key(b) : b[key]; return (x ?? "") < (y ?? "") ? -dir : (x ?? "") > (y ?? "") ? dir : 0; });
export const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
export const omit = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
export const rx = (q) => new RegExp(String(q).slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

export function nextCode(name, prefix, width = 4) {
  let c = db.counters.find((x) => x._id === name);
  if (!c) { c = { _id: name, seq: 0 }; db.counters.push(c); }
  c.seq += 1;
  return `${prefix}${String(c.seq).padStart(width, "0")}`;
}

export function inr(v) {
  const n = Number(v || 0);
  return `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function normalizePhone(raw) {
  const digits = String(raw || "").replace(/[\s\-()]/g, "");
  const m = /^(?:\+?91)?([6-9]\d{9})$/.exec(digits);
  if (!m) fail(422, "Enter a valid 10-digit Indian mobile number");
  return `+91${m[1]}`;
}

export const settings = () => db.settings.find((s) => s.id === "company") || {};

// ---------- Roles & permissions (backend/core.py) ----------
export const ROLES = { super_admin: "Super Administrator", director: "Owner / Director", branch_manager: "Branch / Operations Manager", sales_agent: "Sales / Brokerage Agent", property_manager: "Property Manager", accountant: "Finance / Accountant", marketing: "Marketing Staff", shortstay_ops: "Short-Stay Operations", auditor: "Read-Only Auditor", owner: "Property Owner (portal)" };
const MODULES = ["dashboard", "leads", "properties", "owners", "deals", "finance", "leases", "maintenance", "shortstay", "documents", "tasks", "reports", "cms", "users", "settings", "audit"];
const all = (p) => Object.fromEntries(MODULES.map((m) => [m, p]));
export const PERMS = {
  super_admin: all("rwaep"),
  director: { ...all("rwae"), users: "r", settings: "r", properties: "rwaep", cms: "rwp" },
  branch_manager: { dashboard: "r", leads: "rwe", properties: "rwaep", owners: "rw", deals: "rwe", finance: "r", leases: "rw", maintenance: "rw", shortstay: "rw", documents: "rw", tasks: "rw", reports: "re", cms: "rwp", users: "r" },
  sales_agent: { dashboard: "r", leads: "rw", properties: "rw", owners: "r", deals: "rw", tasks: "rw", documents: "rw" },
  property_manager: { dashboard: "r", properties: "r", owners: "r", leases: "rw", maintenance: "rw", documents: "rw", tasks: "rw" },
  accountant: { dashboard: "r", finance: "rwe", deals: "r", leases: "r", shortstay: "r", owners: "r", reports: "re", tasks: "rw", maintenance: "r" },
  marketing: { dashboard: "r", properties: "rp", cms: "rwp", leads: "r", tasks: "rw" },
  shortstay_ops: { dashboard: "r", shortstay: "rw", maintenance: "rw", properties: "r", tasks: "rw", documents: "r" },
  auditor: { dashboard: "r", leads: "r", properties: "r", owners: "r", deals: "r", finance: "r", leases: "r", maintenance: "r", shortstay: "r", reports: "re", audit: "r" },
  owner: {},
};
const OWN_SCOPE = { sales_agent: { leads: "assigned_to", deals: "assigned_to", properties: "assigned_agent" }, property_manager: { properties: "assigned_manager", leases: "manager_id" } };
const BRANCH_SCOPED = ["leads", "properties", "deals"];

export const can = (u, m, a) => (PERMS[u?.role]?.[m] || "").includes(a);
export const isScoped = (u, m) => !!OWN_SCOPE[u.role]?.[m];
export function inScope(u, m) {
  const field = OWN_SCOPE[u.role]?.[m];
  const branches = u.role === "branch_manager" && u.branch_ids?.length && BRANCH_SCOPED.includes(m) ? u.branch_ids : null;
  return (d) => (!field || d[field] === u.id) && (!branches || d.branch_id == null || branches.includes(d.branch_id));
}
export function getScoped(coll, m, u, id) {
  const d = db[coll].find((x) => x.id === id && notDeleted(x) && inScope(u, m)(x));
  if (!d) fail(404, "Record not found");
  return d;
}

export function requirePerm(u, m, a, path) {
  if (!can(u, m, a)) { audit(u, "permission_denied", m, null, { action: a, path }); fail(403, "You do not have permission for this action"); }
}

export const mfaRequiredFor = (u) => (settings().mfa_required_roles || []).includes(u.role);
export function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, role_label: ROLES[u.role], branch_ids: u.branch_ids || [], active: u.active, phone: u.phone,
    permissions: PERMS[u.role] || {}, created_at: u.created_at, mfa_enabled: !!u.mfa_enabled, owner_id: u.owner_id || null, last_login: u.last_login || null,
    mfa_setup_required: mfaRequiredFor(u) && !u.mfa_enabled };
}

export function audit(u, action, entity, entityId, details) {
  db.audit_logs.unshift({ id: newId(), user_id: u?.id || null, user_name: u ? u.name : "public", role: u?.role || null, action, entity, entity_id: entityId, details: details || {}, at: nowIso() });
}

export function notify(userIds, title, body = "", link = "", dedupe = null, kind = "info") {
  [...new Set((userIds || []).filter(Boolean))].forEach((uid) => {
    const key = dedupe ? `${dedupe}:${uid}` : newId();
    if (db.notifications.some((n) => n.dedupe_key === key)) return;
    db.notifications.unshift({ id: newId(), user_id: uid, title, body, link, kind, read: false, created_at: nowIso(), dedupe_key: key, email_status: "off" });
  });
}
export function notifyRoles(roles, title, body = "", link = "", dedupe = null, kind = "info", branchId = null) {
  const ids = db.users.filter((u) => roles.includes(u.role) && u.active && (u.role !== "branch_manager" || !branchId || !u.branch_ids?.length || u.branch_ids.includes(branchId))).map((u) => u.id);
  notify(ids, title, body, link, dedupe, kind);
}

export function postLedger(ledger, direction, amount, refType, refId, description, user, party = null, account = null) {
  const a = r2(amount);
  if (a <= 0) return null;
  const e = { id: newId(), code: nextCode("ledger", "LE-", 6), ledger, direction, amount: a, account: account || refType, ref_type: refType, ref_id: refId, party, description,
    posted_by: user?.id || null, posted_at: nowIso(), reversal_of: null, reversed: false };
  db.ledger_entries.push(e);
  return e;
}

// ---------- Business rules (backend/logic.py) ----------
export const LEAD_STAGES = ["new", "contacted", "qualified", "requirements", "matched", "site_visit", "negotiation", "won", "lost"];
export const PROPERTY_FLOW = { draft: ["verification_pending", "inactive"], verification_pending: ["verified", "draft", "inactive"], verified: ["ready_to_market", "inactive"], ready_to_market: ["published", "inactive"], published: ["under_offer", "ready_to_market", "inactive"], under_offer: ["published", "closed", "inactive"], closed: ["archived", "ready_to_market"], inactive: ["draft", "archived"], archived: [] };
export const LEDGERS = { company: "Company income & expenses", owner_funds: "Client / owner funds held", deposits: "Tenant deposits (liability)", commission_payable: "Commissions payable", shortstay_owner: "Short-stay owner settlements" };

export function calcCommission(base, rule, splits) {
  const t = rule?.type; const v = Number(rule?.value || 0); const b = Number(base || 0);
  if (!["percent", "fixed", "months_rent"].includes(t)) fail(422, "Commission type must be percent, fixed or months_rent");
  if (v < 0 || b < 0) fail(422, "Commission values cannot be negative");
  if (t === "percent" && v > 100) fail(422, "Percentage cannot exceed 100");
  const gross = r2(t === "percent" ? (b * v) / 100 : t === "fixed" ? v : b * v);
  let total = 0;
  const rows = (splits || []).map((s) => {
    const pct = Number(s.percent || 0);
    if (pct < 0 || pct > 100) fail(422, "Split percentage must be between 0 and 100");
    const amt = r2((gross * pct) / 100); total += amt;
    return { party: String(s.party || "").slice(0, 120), kind: s.kind || "co_broker", percent: pct, amount: amt };
  });
  if (r2(total) > gross) fail(422, "Commission splits exceed the gross commission");
  return { gross, splits: rows, splits_total: r2(total), company_net: r2(gross - total) };
}

export function calcInvoice(lines, rate, enabled) {
  let sub = 0;
  const out = (lines || []).map((ln) => {
    const q = Number(ln.qty || 1); const rt = Number(ln.rate || 0);
    if (q <= 0 || rt < 0) fail(422, "Invoice lines need a positive quantity and non-negative rate");
    const amt = r2(q * rt); sub += amt;
    return { description: String(ln.description || "").slice(0, 300), qty: q, rate: rt, amount: amt };
  });
  if (!out.length) fail(422, "At least one invoice line is required");
  sub = r2(sub);
  const tr = enabled ? Number(rate || 0) : 0;
  const tax = r2((sub * tr) / 100);
  return { lines: out, subtotal: sub, tax_rate: tr, tax, total: r2(sub + tax) };
}

export function calcShortstay(ci, co, rate, discount = 0, cleaning = 0, platform = 0, costs = 0, pct = 0) {
  const nights = Math.round((Date.parse(co) - Date.parse(ci)) / 864e5);
  if (!(nights > 0)) fail(422, "Check-out must be after check-in");
  if ([rate, discount, cleaning, platform, costs, pct].some((v) => Number(v || 0) < 0)) fail(422, "Amounts cannot be negative");
  if (Number(pct || 0) > 100) fail(422, "Management fee cannot exceed 100%");
  const room = r2(nights * Number(rate));
  const gross = r2(room - Number(discount || 0) + Number(cleaning || 0));
  if (gross < 0) fail(422, "Discount exceeds booking value");
  const net = r2(gross - Number(platform || 0));
  const fee = r2((net * Number(pct || 0)) / 100);
  return { nights, room_revenue: room, gross, platform_fee: r2(platform), net_after_platform: net, management_fee: fee, operating_costs: r2(costs), owner_payout: r2(net - fee - Number(costs || 0)), adr: r2(room / nights) };
}

export function calcOwnerStatement(rents, exps) {
  const rent = r2(rents.reduce((s, i) => s + Number(i.amount), 0));
  const fee = r2(rents.reduce((s, i) => s + (Number(i.amount) * Number(i.fee_pct || 0)) / 100, 0));
  const ex = r2(exps.reduce((s, e) => s + Number(e.amount), 0));
  return { rent_collected: rent, management_fee: fee, expenses: ex, net_payable: r2(rent - fee - ex) };
}

export const rangesOverlap = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

// Reads an uploaded File into a data URL so the preview can show it later.
export const fileToDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
