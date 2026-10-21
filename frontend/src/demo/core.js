// Hosted preview: an in-browser copy of the backend's rules (backend/core.py, logic.py), working on the
// snapshot exported from the real backend by demo/export.py. Changes last until the page is reloaded.
import snapshot from "./snapshot.json";

export const META = snapshot.meta;
export const DEMO_PASSWORD = "Demo@12345";
export let db = {};
export const state = { userId: null, sid: null, resetTokens: {}, recovery: {}, branch: "" };

export function resetDb() {
  db = JSON.parse(JSON.stringify(snapshot.db));
  ["users", "branches", "settings", "properties", "owners", "leads", "lead_activities", "site_visits", "deals", "invoices", "payments",
    "credit_notes", "ledger_entries", "leases", "rent_payments", "deposit_movements", "owner_statements", "work_orders", "vendors",
    "bookings", "tasks", "approvals", "expenses", "posts", "documents", "campaigns", "notifications", "audit_logs", "counters", "verifications",
    "customers", "locations", "stay_channels", "stay_blocks", "investors", "inv_projects", "investments", "distributions", "agreements",
    "site_content", "site_versions", "lead_activities", "tickets", "lease_charges", "charge_payments", "payment_notices", "vault_items", "vault_history"]
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
export const ROLES = { super_admin: "Super Administrator", director: "Owner / Director", branch_manager: "Branch / Operations Manager", sales_agent: "Sales / Brokerage Agent", property_manager: "Property Manager", accountant: "Finance / Accountant", marketing: "Marketing Staff", shortstay_ops: "Short-Stay Operations", auditor: "Read-Only Auditor", owner: "Owner / Lessor (portal)", investor: "Investor (portal)", tenant: "Tenant (portal)", buyer: "Buyer / Client (portal)" };
export const PORTAL_ROLES = ["owner", "investor", "tenant", "buyer"];
const MODULES = ["dashboard", "ceo", "leads", "customers", "properties", "owners", "deals", "finance", "leases", "maintenance", "shortstay", "documents", "agreements", "investors", "tasks", "reports", "cms", "users", "settings", "audit", "vault"];
const all = (p) => Object.fromEntries(MODULES.map((m) => [m, p]));
export const PERMS = {
  super_admin: all("rwaep"),
  director: { ...all("rwae"), users: "r", settings: "r", properties: "rwaep", cms: "rwp", vault: "rwa" },
  branch_manager: { dashboard: "r", ceo: "re", leads: "rwe", customers: "rwe", properties: "rwaep", owners: "rw", deals: "rwe", finance: "r", leases: "rw", maintenance: "rw", shortstay: "rw", documents: "rw", agreements: "rw", tasks: "rw", reports: "re", cms: "rwp", users: "r", vault: "rw" },
  sales_agent: { dashboard: "r", leads: "rw", customers: "rw", properties: "rw", owners: "r", deals: "rw", tasks: "rw", documents: "rw", agreements: "rw", vault: "r" },
  property_manager: { dashboard: "r", properties: "r", owners: "r", customers: "r", leases: "rw", maintenance: "rw", documents: "rw", agreements: "rw", tasks: "rw", vault: "r" },
  accountant: { dashboard: "r", ceo: "re", finance: "rwe", deals: "r", leases: "r", shortstay: "r", owners: "r", customers: "r", investors: "rwe", agreements: "r", reports: "re", tasks: "rw", maintenance: "r", vault: "rw" },
  marketing: { dashboard: "r", properties: "rp", cms: "rwp", leads: "r", tasks: "rw", vault: "rw" },
  shortstay_ops: { dashboard: "r", shortstay: "rw", maintenance: "rw", properties: "r", tasks: "rw", documents: "r", vault: "rw" },
  auditor: { dashboard: "r", ceo: "re", leads: "r", customers: "r", properties: "r", owners: "r", deals: "r", finance: "r", leases: "r", maintenance: "r", shortstay: "r", investors: "r", agreements: "r", reports: "re", audit: "r" },
  owner: {},
  investor: {},
  tenant: {},
  buyer: {},
};
const OWN_SCOPE = { sales_agent: { leads: "assigned_to", deals: "assigned_to", properties: "assigned_agent", customers: "rm_id" }, property_manager: { properties: "assigned_manager", leases: "manager_id" } };
// Records of these modules carry a branch_id (backend/core.py BRANCH_SCOPED); directors and super admins see every branch.
export const BRANCH_SCOPED = ["leads", "customers", "properties", "deals", "leases", "shortstay", "maintenance", "finance", "agreements", "ceo"];
const ALL_BRANCH_ROLES = ["super_admin", "director"];

export const can = (u, m, a) => (PERMS[u?.role]?.[m] || "").includes(a);
export const isScoped = (u, m) => !!OWN_SCOPE[u.role]?.[m];
// null = every branch; otherwise the branches on the person's account
export const allowedBranches = (u) => (!u || ALL_BRANCH_ROLES.includes(u.role) || !u.branch_ids?.length ? null : [...u.branch_ids]);
// branches this request may see: the account's, narrowed to the branch picked in the app (X-Branch)
export function branchSet(u, selected) {
  const allowed = allowedBranches(u);
  const sel = selected !== undefined ? selected : state.branch;
  if (sel && sel !== "all" && (allowed === null || allowed.includes(sel))) return [sel];
  return allowed;
}
export const inBranches = (u, selected) => { const b = branchSet(u, selected); return (d) => b === null || b.includes(d.branch_id); };
export const inBranch = (u, id) => { const a = allowedBranches(u); return a === null || a.includes(id); };
export const checkBranch = (u, id) => { if (id && !inBranch(u, id)) fail(403, "You can only work with records of your own branch"); };
export function homeBranch(u) {
  const sel = state.branch;
  if (sel && sel !== "all" && inBranch(u, sel)) return sel;
  return u?.branch_ids?.[0] || null;
}
export function inScope(u, m) {
  const field = OWN_SCOPE[u.role]?.[m];
  const br = BRANCH_SCOPED.includes(m) ? branchSet(u) : null;
  return (d) => (!field || d[field] === u.id) && (!br || br.includes(d.branch_id));
}
export const headOfficeId = () => (db.branches.find((b) => b.is_head_office && b.active !== false) || [...db.branches].sort((a, b) => (a.order || 0) - (b.order || 0))[0] || {}).id || null;
export function branchForPlace(city, locality) {
  const eq = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  if (city) {
    if (locality) { const l = db.locations.find((x) => x.kind === "locality" && eq(x.city, city) && eq(x.name, locality)); if (l?.branch_id) return l.branch_id; }
    const c = db.locations.find((x) => x.kind === "city" && eq(x.name, city)); if (c?.branch_id) return c.branch_id;
    const b = db.branches.find((x) => eq(x.city, city) && x.active !== false); if (b) return b.id;
  }
  return headOfficeId();
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
    permissions: PERMS[u.role] || {}, created_at: u.created_at, mfa_enabled: !!u.mfa_enabled, owner_id: u.owner_id || null, investor_id: u.investor_id || null, customer_id: u.customer_id || null,
    last_login: u.last_login || null, all_branches: allowedBranches(u) === null, designation: u.designation || null, department: u.department || null,
    reports_to: u.reports_to || null, whatsapp: u.whatsapp || null, show_in_directory: u.show_in_directory !== false, joined_on: u.joined_on || null,
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
  const ids = db.users.filter((u) => roles.includes(u.role) && u.active && (!branchId || allowedBranches(u) === null || u.branch_ids.includes(branchId))).map((u) => u.id);
  notify(ids, title, body, link, dedupe, kind);
}

export function postLedger(ledger, direction, amount, refType, refId, description, user, party = null, account = null, branchId = null) {
  const a = r2(amount);
  if (a <= 0) return null;
  const e = { id: newId(), code: nextCode("ledger", "LE-", 6), ledger, direction, amount: a, account: account || refType, ref_type: refType, ref_id: refId, party, description,
    posted_by: user?.id || null, posted_at: nowIso(), reversal_of: null, reversed: false, branch_id: branchId || null };
  db.ledger_entries.push(e);
  return e;
}

// ---------- Business rules (backend/logic.py) ----------
export const LEAD_STAGES = ["new", "contacted", "qualified", "requirements", "matched", "site_visit", "negotiation", "won", "lost"];
export const PROPERTY_FLOW = { draft: ["verification_pending", "inactive"], verification_pending: ["verified", "draft", "inactive"], verified: ["ready_to_market", "inactive"], ready_to_market: ["published", "inactive"], published: ["under_offer", "ready_to_market", "inactive"], under_offer: ["published", "closed", "inactive"], closed: ["archived", "ready_to_market"], inactive: ["draft", "archived"], archived: [] };
export const LEDGERS = { company: "Company income & expenses", owner_funds: "Client / owner funds held", deposits: "Tenant deposits (liability)", commission_payable: "Commissions payable", shortstay_owner: "Short-stay owner settlements", investor_funds: "Investor capital & payouts" };

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

export function calcOwnerStatement(rents, exps, charges = []) {
  const rent = r2(rents.reduce((s, i) => s + Number(i.amount), 0));
  const fee = r2(rents.reduce((s, i) => s + (Number(i.amount) * Number(i.fee_pct || 0)) / 100, 0));
  const ex = r2(exps.reduce((s, e) => s + Number(e.amount), 0));
  const chg = r2(charges.reduce((s, c) => s + Number(c.amount), 0));
  return { rent_collected: rent, management_fee: fee, expenses: ex, charges_collected: chg, net_payable: r2(rent - fee - ex + chg) };
}

export const rangesOverlap = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

// Reads an uploaded File into a data URL so the preview can show it later.
export const fileToDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });

// ---------- Round 3 rules (backend/logic.py) ----------
// key: [label, typical host commission %]
export const PLATFORMS = { direct: ["Direct (phone / walk-in)", 0], website: ["Our website", 0], airbnb: ["Airbnb", 15], booking_com: ["Booking.com", 18], agoda: ["Agoda", 18],
  makemytrip: ["MakeMyTrip", 20], goibibo: ["Goibibo", 20], vrbo: ["Vrbo", 8], expedia: ["Expedia", 18], other: ["Other", 0] };

export const isoAdd = (iso, days) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

export function stayQuote(ci, co, pricing, guests = 1) {
  const nights = daysBetween(ci, co);
  if (!(nights > 0)) throw new Error("Check-out must be after check-in");
  const base = Number(pricing.base_rate || 0);
  if (base <= 0) throw new Error("Set a nightly rate for this property first");
  const minN = parseInt(pricing.min_nights || 1, 10);
  if (nights < minN) throw new Error(`Minimum stay is ${minN} nights`);
  const weekend = Number(pricing.weekend_rate || 0) || base;
  const rows = [];
  for (let i = 0, d = ci; i < nights; i += 1, d = isoAdd(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); // Fri = 5, Sat = 6 (Python weekday 4, 5)
    let [rate, label] = wd === 5 || wd === 6 ? [weekend, "weekend"] : [base, "base"];
    (pricing.seasons || []).forEach((s) => { if (s.start && s.end && s.start <= d && d <= s.end && Number(s.rate || 0) > 0) { rate = Number(s.rate); label = s.name || "season"; } });
    rows.push({ night: d, rate: r2(rate), label });
  }
  const room = r2(rows.reduce((a, r) => a + r.rate, 0));
  const discPct = nights >= 28 ? Number(pricing.monthly_discount_pct || 0) : nights >= 7 ? Number(pricing.weekly_discount_pct || 0) : 0;
  const discount = r2((room * discPct) / 100);
  const included = parseInt(pricing.included_guests || 2, 10);
  const extra = r2(Math.max(0, parseInt(guests, 10) - included) * Number(pricing.extra_guest_fee || 0) * nights);
  const cleaning = r2(pricing.cleaning_fee || 0);
  return { nights, rows, room, discount, discount_pct: discPct, extra_guests: extra, cleaning_fee: cleaning, total: r2(room - discount + extra + cleaning), avg_rate: r2((room - discount + extra) / nights) };
}

export function xirr(flowsIn, guess = 0.1) {
  const flows = flowsIn.filter(([, a]) => Number(a)).map(([d, a]) => [d, Number(a)]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  if (flows.length < 2 || !(flows.some(([, a]) => a < 0) && flows.some(([, a]) => a > 0))) return null;
  const t0 = flows[0][0];
  const yrs = flows.map(([d, a]) => [daysBetween(t0, d) / 365, a]);
  if (Math.max(...yrs.map(([t]) => t)) < 1 / 365) return null;
  const npv = (r) => yrs.reduce((s, [t, a]) => s + a / (1 + r) ** t, 0);
  const dnpv = (r) => yrs.reduce((s, [t, a]) => s - (t * a) / (1 + r) ** (t + 1), 0);
  let r = guess;
  for (let i = 0; i < 100; i += 1) {
    const f = npv(r); const df = dnpv(r);
    if (!Number.isFinite(f) || !Number.isFinite(df) || Math.abs(df) < 1e-12) break;
    let nr = r - f / df;
    if (nr <= -0.9999) nr = (r - 0.9999) / 2;
    if (Math.abs(nr - r) < 1e-9) return Math.round(nr * 10000) / 100;
    r = nr;
  }
  let lo = -0.99; let hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i += 1) { const mid = (lo + hi) / 2; if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid; }
  return Math.round(((lo + hi) / 2) * 10000) / 100;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const two = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ""));
const three = (n) => [Math.floor(n / 100) ? `${ONES[Math.floor(n / 100)]} Hundred` : "", n % 100 ? two(n % 100) : ""].filter(Boolean).join(" ");
export function amountInWords(v) {
  const x = Math.round(Number(v || 0) * 100) / 100;
  const rupees = Math.trunc(x); const paise = Math.round((x - rupees) * 100);
  if (!rupees && !paise) return "Rupees Zero only";
  const parts = [];
  const crore = Math.floor(rupees / 1e7); let rest = rupees % 1e7;
  const lakh = Math.floor(rest / 1e5); rest %= 1e5;
  const thousand = Math.floor(rest / 1000); rest %= 1000;
  if (crore) parts.push(`${crore < 1000 ? three(crore) : amountInWords(crore).replace("Rupees ", "").replace(" only", "")} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (rest) parts.push(three(rest));
  let words = parts.length ? `Rupees ${parts.join(" ")}` : "Rupees Zero";
  if (paise) words += ` and ${two(paise)} Paise`;
  return `${words} only`;
}

// Python's round(): halves go to the even digit (56.25 -> 56.2), so the preview shows the server's numbers.
export function pyRound(x, n = 0) {
  if (!Number.isFinite(x)) return x;
  const [i, f] = Math.abs(x).toFixed(20).split("."); // the double's exact decimal value
  if (/^50*$/.test(f.slice(n))) { // an exact tie: round to the even digit
    const last = Number(n ? f[n - 1] : i[i.length - 1]);
    const down = Number(`${i}.${f.slice(0, n) || "0"}`);
    return Math.sign(x) * Number((last % 2 ? down + 10 ** -n : down).toFixed(n));
  }
  return Number(x.toFixed(n));
}
export function scoreLinear(value, bad, good) {
  if (value == null) return null;
  if (good === bad) return value >= good ? 100 : 0;
  const s = ((value - bad) / (good - bad)) * 100;
  return pyRound(Math.max(0, Math.min(100, s)), 1);
}
export const statusFor = (s) => (s == null ? "no_data" : s >= 75 ? "healthy" : s >= 50 ? "attention" : "critical");
export const gradeFor = (s) => (s == null ? "-" : s >= 85 ? "A" : s >= 70 ? "B" : s >= 55 ? "C" : "D");
export function combine(pillars) {
  let total = 0; let wsum = 0;
  const out = pillars.map((p) => {
    const sc = p.metrics.map((m) => m.score).filter((s) => s != null);
    const ps = sc.length ? pyRound(sc.reduce((a, b) => a + b, 0) / sc.length, 1) : null;
    if (ps != null) { total += ps * p.weight; wsum += p.weight; }
    return { ...p, score: ps, status: statusFor(ps) };
  });
  return [wsum ? pyRound(total / wsum, 1) : null, out];
}

export const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "place";
export const eqi = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

// Customers (backend/routes_customers.py upsert_customer / link_customer): one record per person, matched by mobile.
export const CUSTOMER_TYPES = ["buyer", "seller", "tenant", "landlord", "owner", "guest", "investor", "business"];
const normPhoneSoft = (p) => { try { return p ? normalizePhone(p) : null; } catch { return null; } };
export function upsertCustomer(data, user = null) {
  const phone = normPhoneSoft(data.phone);
  const email = String(data.email || "").trim().toLowerCase() || null;
  const types = (data.types || []).filter((t) => CUSTOMER_TYPES.includes(t));
  const live = (c) => !c.merged_into && c.deleted !== true;
  let c = phone ? db.customers.find((x) => live(x) && (x.phone === phone || x.alt_phone === phone)) : email ? db.customers.find((x) => live(x) && x.email === email) : null;
  if (c) {
    const upd = { last_activity_at: nowIso(), updated_at: nowIso() };
    ["email", "city", "locality", "organization", "branch_id", "rm_id"].forEach((k) => { if (data[k] && !c[k]) upd[k] = k === "email" ? email : data[k]; });
    Object.assign(c, upd);
    c.types = [...new Set([...(c.types || []), ...types])].sort();
    return c;
  }
  if (!phone && !email) return null;
  const consent = !!data.marketing_consent;
  c = { id: newId(), code: nextCode("customer", "SE-C-", 5), name: String(data.name || "Customer").trim().slice(0, 120), phone, alt_phone: null, email,
    kind: data.kind || (types.includes("business") ? "business" : "individual"), organization: data.organization || null, types, tags: data.tags || [], city: data.city || null,
    locality: data.locality || null, address: data.address || null, language: data.language || "english", preferred_contact: data.preferred_contact || "phone", source: data.source || "direct",
    branch_id: data.branch_id || (user ? homeBranch(user) : null) || headOfficeId(), rm_id: data.rm_id || (user?.role === "sales_agent" ? user.id : null),
    consent: { marketing: consent, whatsapp: consent, recorded_at: nowIso(), method: data.consent_method || data.source || "form" },
    consent_history: [{ at: nowIso(), marketing: consent, whatsapp: consent, by: user ? user.name : "Website", method: data.source || "form" }],
    kyc: { status: "not_started" }, notes: data.notes || null, gstin: data.gstin || null, pan_last4: null, created_at: nowIso(), updated_at: nowIso(), last_activity_at: nowIso(),
    merged_into: null, anonymised: false, deleted: false, created_by: user?.id || null };
  db.customers.push(c);
  return c;
}
export function linkCustomer(coll, rid, data, user = null) {
  const c = upsertCustomer(data, user);
  const rec = c && db[coll].find((x) => x.id === rid);
  if (rec) rec.customer_id = c.id;
  return c;
}

// Towns & localities (backend/routes_branches.py ensure_place): the list grows as properties are added.
export function ensureCity(name, district = null, branchId = null) {
  let c = db.locations.find((x) => x.kind === "city" && eqi(x.name, name));
  if (c) return c;
  c = { id: newId(), kind: "city", name: name.trim(), city: name.trim(), district, state: "Tamil Nadu", pincode: null, lat: null, lng: null, branch_id: branchId, slug: slugify(name), active: true, intro: null, created_at: nowIso() };
  db.locations.push(c);
  return c;
}
export function ensurePlace(city, locality = null, pincode = null, lat = null, lng = null, branchId = null, source = "system", active = true) {
  if (!city) return null;
  const c = ensureCity(city, null, branchId);
  if (!locality) return c;
  let loc = db.locations.find((x) => x.kind === "locality" && eqi(x.city, c.name) && eqi(x.name, locality));
  if (loc) return loc;
  loc = { id: newId(), kind: "locality", name: locality.trim().slice(0, 80), city: c.name, city_id: c.id, district: c.district, state: "Tamil Nadu", pincode, lat, lng,
    branch_id: branchId || c.branch_id, slug: slugify(locality), active, intro: null, source, created_at: nowIso() };
  db.locations.push(loc);
  return loc;
}

// Property location (backend/routes_props.py geo_fields): exact point kept private, public pin rounded (~100 m) or hidden.
const PUBLIC_DECIMALS = { approximate: 3, exact: 5, hidden: null };
export function geoFields(geo, mode, user = null, source = "pin") {
  if (!geo || geo.lat == null || geo.lat === "" || geo.lng == null || geo.lng === "") return {};
  const lat = Number(geo.lat); const lng = Number(geo.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) fail(422, "Location must be a latitude and longitude");
  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) fail(422, "Location is out of range");
  const m = mode in PUBLIC_DECIMALS ? mode : "approximate";
  const dec = PUBLIC_DECIMALS[m];
  const rnd = (v, n) => Math.round(v * 10 ** n) / 10 ** n;
  return { geo: { lat: rnd(lat, 6), lng: rnd(lng, 6), accuracy_m: geo.accuracy_m == null || geo.accuracy_m === "" ? null : Math.round(Number(geo.accuracy_m)), source: geo.source || source,
    captured_at: geo.captured_at || nowIso(), captured_by: geo.captured_by || (user ? user.name : null) }, location_public: m, public_lat: dec ? rnd(lat, dec) : null, public_lng: dec ? rnd(lng, dec) : null };
}

// Posts that are live on the public website: published, or scheduled with their time come; never investor-only ones.
export function publishDue() {
  const now = nowIso();
  db.posts.filter((p) => p.status === "scheduled" && p.publish_at && p.publish_at <= now && notDeleted(p)).forEach((p) => { p.status = "published"; p.published_at = p.publish_at; });
}
export const livePost = (p) => notDeleted(p) && p.audience !== "investors" && (p.status === "published" || (p.status === "scheduled" && p.publish_at && p.publish_at <= nowIso()));
