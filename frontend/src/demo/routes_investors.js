// Co-investors (backend/routes_investors.py) for the hosted preview: investors, projects, capital, valuations, payouts
// with TDS, exits, returns (XIRR) and the investor's own dashboard.
import { route } from "./router";
import {
  db, fail, nowIso, todayIST, newId, r2, notDeleted, pick, omit, sortBy, rx, nextCode, inr, normalizePhone, can, audit, notify, postLedger, xirr, headOfficeId,
  inBranches, linkCustomer,
} from "./core";
import { createUser } from "./routes_site";

const KINDS = ["rental_income", "land_bank", "development", "short_stay", "commercial_lease"];
const DIST_KINDS = ["rental_income", "profit_share", "interest", "capital_return"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------- Calculations ----------------
const valuationAt = (p, on) => { const v = sortBy((p.valuations || []).filter((x) => x.date <= on), "date"); return v.length ? v[v.length - 1].value : null; };
const book = (pid) => [db.inv_projects.find((p) => p.id === pid), db.investments.filter((i) => i.project_id === pid), db.distributions.filter((d) => d.project_id === pid)];

export function holdingValues(project, investments, distributions, on = todayIST()) {
  const active = investments.filter((i) => i.status === "active" && i.date <= on);
  const capital = active.reduce((s, i) => s + i.amount, 0);
  const val = valuationAt(project, on);
  const value = val != null ? val : capital;
  const out = {};
  investments.forEach((i) => {
    const share = i.status === "active" && capital ? i.amount / capital : 0;
    const cur = i.status === "active" ? r2(value * share) : 0;
    const ds = distributions.filter((d) => d.investment_id === i.id);
    const paid = r2(ds.reduce((s, d) => s + d.gross, 0));
    const flows = [[i.date, -i.amount], ...ds.map((d) => [d.date, d.gross])];
    if (i.status === "exited" && i.exit_date) flows.push([i.exit_date, i.exit_amount || 0]);
    else if (cur) flows.push([on, cur]);
    out[i.id] = { share_pct: r2(share * 100), current_value: cur, distributions: paid, net_distributions: r2(ds.reduce((s, d) => s + d.net, 0)), tds: r2(ds.reduce((s, d) => s + (d.tds || 0), 0)),
      gain: r2(cur + paid + (i.exit_amount || 0) - i.amount), xirr: xirr(flows), flows };
  });
  return [out, capital, value];
}
const fyStart = (on) => { const y = Number(on.slice(0, 4)); return `${Number(on.slice(5, 7)) >= 4 ? y : y - 1}-04-01`; };
const PROJECT_KEYS = ["id", "code", "name", "kind", "city", "locality", "status", "target_irr_pct", "cover_image"];

export function portfolio(investorId, on = todayIST()) {
  const invs = sortBy(db.investments.filter((i) => i.investor_id === investorId), "date");
  const books = {}; const holdings = []; let flows = [];
  invs.forEach((i) => {
    if (!books[i.project_id]) books[i.project_id] = book(i.project_id);
    const [p, all, dist] = books[i.project_id];
    const [vals] = holdingValues(p, all, dist, on);
    const { flows: f, ...v } = vals[i.id];
    flows = flows.concat(f);
    holdings.push({ ...i, ...v, project: Object.fromEntries(PROJECT_KEYS.map((k) => [k, p?.[k] ?? null])) });
  });
  const active = holdings.filter((h) => h.status === "active");
  const s = (rows, k) => r2(rows.reduce((t, h) => t + (h[k] || 0), 0));
  const totals = { invested: s(holdings, "amount"), active_invested: s(active, "amount"), current_value: s(active, "current_value"), distributions: s(holdings, "distributions"),
    net_distributions: s(holdings, "net_distributions"), tds: s(holdings, "tds"), realised: s(holdings, "exit_amount"), xirr: xirr(flows), holdings: active.length };
  totals.gain = r2(totals.current_value + totals.distributions + totals.realised - totals.invested);
  totals.ytd_distributions = r2(db.distributions.filter((d) => d.investor_id === investorId && d.date >= fyStart(on)).reduce((t, d) => t + d.gross, 0));
  return [holdings, totals, books];
}
function monthEnds(start, end) {
  const out = [];
  let y = Number(start.slice(0, 4)); let m = Number(start.slice(5, 7));
  while (`${y}-${String(m).padStart(2, "0")}-01` <= end) {
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    out.push(last < end ? last : end);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
export function valueSeries(investorId) {
  const invs = db.investments.filter((i) => i.investor_id === investorId);
  if (!invs.length) return [];
  const t = todayIST();
  const books = Object.fromEntries([...new Set(invs.map((i) => i.project_id))].map((pid) => [pid, book(pid)]));
  return monthEnds(invs.reduce((a, i) => (i.date < a ? i.date : a), invs[0].date), t).map((me) => {
    let value = 0; let invested = 0; let paid = 0;
    Object.entries(books).forEach(([pid, [p, all, dist]]) => {
      const [vals] = holdingValues(p, all.filter((x) => x.date <= me), dist, me);
      invs.forEach((i) => { if (i.project_id === pid && i.date <= me) { invested += i.amount; if (i.status === "active" || (i.exit_date || "9999") > me) value += vals[i.id]?.current_value || 0; } });
      paid += dist.filter((d) => d.investor_id === investorId && d.date <= me).reduce((s, d) => s + d.gross, 0);
    });
    return { month: me.slice(0, 7), value: r2(value), invested: r2(invested), distributions: r2(paid) };
  });
}

// ---------------- Investors ----------------
const investorById = (id) => db.investors.find((i) => i.id === id && notDeleted(i)) || fail(404, "Investor not found");
route("GET", "/investors", ({ query: q }) => {
  let rows = db.investors.filter(notDeleted);
  if (q.q) { const r = rx(q.q); rows = rows.filter((i) => [i.name, i.phone, i.code].some((x) => r.test(x || ""))); }
  return sortBy(rows, "created_at", -1).map((i) => ({ ...i, totals: portfolio(i.id)[1] }));
}, { perm: ["investors", "r"] });
route("POST", "/investors", ({ user, body: b }) => {
  if (String(b.name || "").trim().length < 2) fail(422, "name: at least 2 characters");
  const kind = b.kind || "individual";
  if (!["individual", "huf", "company", "nri", "trust"].includes(kind)) fail(422, "Invalid investor type");
  if (b.pan_last4 && !/^[A-Za-z0-9]{4}$/.test(b.pan_last4)) fail(422, "Enter only the last 4 characters of the PAN");
  const phone = normalizePhone(b.phone);
  if (db.investors.some((i) => i.phone === phone && notDeleted(i))) fail(409, "An investor with this mobile number already exists");
  const i = { id: newId(), code: nextCode("investor", "SE-I-"), ...pick(b, ["name", "city", "rm_id", "notes"]), kind, phone, email: String(b.email || "").trim().toLowerCase() || null,
    pan_last4: String(b.pan_last4 || "").toUpperCase() || null, kyc_status: "pending", branch_id: headOfficeId(), created_by: user.id, created_at: nowIso(), deleted: false };
  db.investors.push(i);
  linkCustomer("investors", i.id, { name: i.name, phone, email: i.email, types: ["investor"], city: b.city, source: "investor" }, user);
  audit(user, "investor_created", "investors", i.id);
  return i;
}, { perm: ["investors", "w"] });
route("GET", "/investors/:id", ({ user, params }) => {
  const i = { ...investorById(params.id) };
  const [holdings, totals] = portfolio(i.id);
  Object.assign(i, { holdings, totals, distributions: sortBy(db.distributions.filter((d) => d.investor_id === i.id), "date", -1), series: valueSeries(i.id) });
  if (can(user, "users", "r")) i.portal_users = db.users.filter((u) => u.investor_id === i.id && u.role === "investor").map((u) => pick(u, ["id", "email", "active", "last_login"]));
  if (i.rm_id) { const rm = db.users.find((u) => u.id === i.rm_id); i.rm = rm ? pick(rm, ["name", "phone"]) : null; }
  return i;
}, { perm: ["investors", "r"] });
route("PATCH", "/investors/:id", ({ user, params, body }) => {
  const i = investorById(params.id);
  const upd = pick(body, ["name", "email", "kind", "city", "pan_last4", "rm_id", "notes", "kyc_status"]);
  if (upd.kyc_status && !["pending", "verified", "rejected"].includes(upd.kyc_status)) fail(422, "Unknown KYC status");
  if (upd.kyc_status === "verified" && !can(user, "investors", "a")) fail(403, "A director marks KYC as verified");
  if (upd.pan_last4 && !/^[A-Za-z0-9]{4}$/.test(upd.pan_last4)) fail(422, "Enter only the last 4 characters of the PAN");
  Object.assign(i, upd);
  audit(user, "investor_updated", "investors", i.id, upd);
  return i;
}, { perm: ["investors", "w"] });
route("POST", "/investors/:id/portal-invite", ({ user, params, body }) => {
  const i = investorById(params.id);
  const email = String(body.email || i.email || "").trim().toLowerCase();
  if (!email) fail(422, "Add the investor's email address first");
  const out = createUser({ email, name: i.name.slice(0, 100), role: "investor", investor_id: i.id, phone: i.phone }, user);
  if (!i.email) i.email = email;
  audit(user, "investor_portal_invited", "investors", i.id, { email });
  return out;
}, { perm: ["users", "w"] });

// ---------------- Projects ----------------
const projectById = (id) => db.inv_projects.find((p) => p.id === id && notDeleted(p)) || fail(404, "Project not found");
function checkProject(p) {
  if (String(p.name || "").trim().length < 3) fail(422, "name: at least 3 characters");
  if (!KINDS.includes(p.kind)) fail(422, "Unknown project type");
  if (String(p.city || "").trim().length < 2) fail(422, "city: required");
  if (!(Number(p.target_raise) > 0)) fail(422, "target_raise: enter the amount to raise");
  if (!DATE.test(p.start_date || "")) fail(422, "start_date: choose a date");
  if (p.status && !["open", "funded", "operating", "exiting", "exited"].includes(p.status)) fail(422, "Invalid status");
}
function projectTotals(p) {
  const [, inv, dist] = book(p.id);
  const [vals, capital, value] = holdingValues(p, inv, dist);
  return [{ raised: r2(inv.reduce((s, i) => s + i.amount, 0)), capital: r2(capital), current_value: r2(value), investors: new Set(inv.filter((i) => i.status === "active").map((i) => i.investor_id)).size,
    distributed: r2(dist.reduce((s, d) => s + d.gross, 0)), xirr: xirr(Object.values(vals).flatMap((v) => v.flows)) }, vals, inv, dist];
}
route("GET", "/inv-projects", ({ user }) => sortBy(db.inv_projects.filter((p) => notDeleted(p) && inBranches(user)(p)), "created_at", -1).map((p) => ({ ...p, ...projectTotals(p)[0] })), { perm: ["investors", "r"] });
route("POST", "/inv-projects", ({ user, body: b }) => {
  const d = { min_ticket: 0, horizon_months: 36, status: "open", property_ids: [], ...pick(b, ["name", "kind", "city", "locality", "property_ids", "branch_id", "target_raise", "min_ticket", "target_irr_pct", "expected_yield_pct", "start_date", "horizon_months", "description", "cover_image", "status"]) };
  checkProject(d);
  ["target_raise", "min_ticket"].forEach((k) => { d[k] = Number(d[k] || 0); });
  const p = { id: newId(), code: nextCode("inv_project", "SE-PR-", 3), ...d, branch_id: d.branch_id || headOfficeId(), valuations: [], updates: [], created_by: user.id, created_at: nowIso(), deleted: false };
  db.inv_projects.push(p);
  audit(user, "project_created", "investors", p.id, { name: p.name });
  return p;
}, { perm: ["investors", "w"] });
route("GET", "/inv-projects/:id", ({ params }) => {
  const p = { ...projectById(params.id) };
  const [totals, vals, inv, dist] = projectTotals(p);
  const name = (id) => db.investors.find((x) => x.id === id)?.name || null;
  p.investments = inv.map((i) => ({ ...i, investor_name: name(i.investor_id), ...omit(vals[i.id], ["flows"]) }));
  p.distributions = sortBy(dist.map((d) => ({ ...d, investor_name: name(d.investor_id) })), "date", -1);
  p.totals = totals;
  p.properties = db.properties.filter((x) => (p.property_ids || []).includes(x.id)).map((x) => pick(x, ["id", "code", "title", "status"]));
  return p;
}, { perm: ["investors", "r"] });
route("PATCH", "/inv-projects/:id", ({ user, params, body }) => {
  const p = projectById(params.id);
  const upd = pick(body, ["name", "kind", "city", "locality", "property_ids", "target_raise", "min_ticket", "target_irr_pct", "expected_yield_pct", "horizon_months", "description", "cover_image", "status"]);
  try { checkProject({ ...p, ...upd }); } catch { fail(422, "Check the project details"); }
  Object.assign(p, upd);
  audit(user, "project_updated", "investors", p.id, upd);
  return p;
}, { perm: ["investors", "w"] });
route("POST", "/inv-projects/:id/valuations", ({ user, params, body: b }) => {
  const p = projectById(params.id);
  if (!DATE.test(b.date || "") || !(Number(b.value) > 0)) fail(422, "Enter the date and the value");
  if (b.date > todayIST()) fail(422, "A valuation cannot be dated in the future");
  const method = b.method || "internal";
  if (!["internal", "valuer", "sale_offer", "guideline"].includes(method)) fail(422, "Invalid method");
  const v = { date: b.date, value: Number(b.value), note: b.note || null, method, by: user.name, at: nowIso() };
  p.valuations = [...(p.valuations || []), v];
  audit(user, "valuation_added", "investors", p.id, { value: v.value, date: v.date });
  return v;
}, { perm: ["investors", "w"] });
route("POST", "/inv-projects/:id/updates", ({ user, params, body: b }) => {
  const p = projectById(params.id);
  if (String(b.title || "").trim().length < 3 || String(b.body || "").trim().length < 3) fail(422, "Write a title and the update");
  const u = { id: newId(), title: String(b.title).slice(0, 140), body: String(b.body).slice(0, 4000), by: user.name, at: nowIso() };
  p.updates = [...(p.updates || []), u];
  const holders = new Set(db.investments.filter((i) => i.project_id === p.id && i.status === "active").map((i) => i.investor_id));
  notify(db.users.filter((x) => x.role === "investor" && holders.has(x.investor_id) && x.active).map((x) => x.id), `Update: ${p.name}`, u.title, "/investor/updates", `pu:${u.id}`);
  audit(user, "project_update_posted", "investors", p.id, { title: u.title });
  return u;
}, { perm: ["investors", "w"] });

// ---------------- Capital and payouts ----------------
route("POST", "/investments", ({ user, body: b }) => {
  const inv = investorById(b.investor_id);
  const p = projectById(b.project_id);
  const amount = Number(b.amount);
  if (!(amount > 0)) fail(422, "amount: enter the amount received");
  if (!DATE.test(b.date || "")) fail(422, "date: choose a date");
  if (String(b.reference || "").trim().length < 3) fail(422, "reference: at least 3 characters");
  const method = b.method || "bank_transfer";
  if (!["bank_transfer", "cheque", "upi", "other"].includes(method)) fail(422, "Invalid payment method");
  if (["exiting", "exited"].includes(p.status)) fail(422, "This project is no longer taking money");
  if (amount < (p.min_ticket || 0)) fail(422, `The minimum for this project is ${inr(p.min_ticket)}`);
  if (b.date > todayIST()) fail(422, "Record money when it has been received");
  if (db.investments.some((x) => x.reference === b.reference && x.project_id === p.id)) fail(409, "A payment with this reference is already recorded");
  const m = { id: newId(), code: nextCode("investment", "SE-IV-", 5), investor_id: inv.id, project_id: p.id, amount, date: b.date, method, reference: b.reference, notes: b.notes || null,
    project_name: p.name, investor_name: inv.name, status: "active", exit_date: null, exit_amount: null, created_by: user.id, created_at: nowIso() };
  db.investments.push(m);
  postLedger("investor_funds", "in", amount, "investment", m.id, `Capital from ${inv.name} for ${p.name}`, user, inv.id, "investor_capital", p.branch_id);
  audit(user, "investment_recorded", "investors", m.id, { amount, project: p.code });
  return m;
}, { perm: ["investors", "w"] });

route("POST", "/inv-projects/:id/distribute", ({ user, params, body: b }) => {
  const p = projectById(params.id);
  if (!DIST_KINDS.includes(b.kind)) fail(422, "Unknown payout type");
  const total = Number(b.amount); const tdsPct = Number(b.tds_pct || 0);
  if (!(total > 0) || !DATE.test(b.date || "")) fail(422, "Enter the date and the amount");
  if (tdsPct < 0 || tdsPct > 40) fail(422, "TDS must be between 0 and 40%");
  if (b.date > todayIST()) fail(422, "Record a payout on or after the day it is paid");
  const active = sortBy(db.investments.filter((i) => i.project_id === p.id && i.status === "active" && i.date <= b.date), "date");
  if (!active.length) fail(422, "No investors held this project on that date");
  const cap = active.reduce((s, i) => s + i.amount, 0);
  const batch = newId(); const rows = []; let given = 0;
  active.forEach((i, k) => {
    const part = k === active.length - 1 ? r2(total - given) : r2((total * i.amount) / cap);
    given = r2(given + part);
    const tds = r2((part * tdsPct) / 100);
    const d = { id: newId(), code: nextCode("distribution", "SE-DS-", 5), batch_id: batch, project_id: p.id, project_name: p.name, investor_id: i.investor_id, investment_id: i.id, date: b.date,
      kind: b.kind, gross: part, tds, net: r2(part - tds), period: b.period || null, reference: b.reference || null, created_by: user.id, created_at: nowIso() };
    db.distributions.push(d);
    const kindTitle = b.kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    postLedger("investor_funds", "out", d.net, "distribution", d.id, `${kindTitle} ${b.period || b.date} to ${i.investor_name} (${p.name})`, user, i.investor_id, `investor_${b.kind}`, p.branch_id);
    if (tds) postLedger("investor_funds", "out", tds, "distribution", d.id, `TDS withheld ${i.investor_name} (${p.name})`, user, i.investor_id, "tds_payable", p.branch_id);
    rows.push(d);
  });
  db.users.filter((u) => u.role === "investor" && u.active && rows.some((r) => r.investor_id === u.investor_id)).forEach((u) => {
    const mine = rows.find((r) => r.investor_id === u.investor_id);
    notify([u.id], `Payout from ${p.name}`, `${inr(mine.net)} (${b.period || b.date})`, "/investor/payouts", `dist:${mine.id}`);
  });
  audit(user, "distribution_posted", "investors", p.id, { amount: total, investors: rows.length, kind: b.kind });
  return { batch_id: batch, rows };
}, { perm: ["investors", "w"] });

route("POST", "/investments/:id/exit", ({ user, params, body: b }) => {
  const m = db.investments.find((x) => x.id === params.id) || fail(404, "Investment not found");
  if (m.status !== "active") fail(409, "Already exited");
  if (!DATE.test(b.date || "") || !(Number(b.amount) >= 0) || String(b.reference || "").length < 3) fail(422, "Enter the date, amount and reference");
  if (b.date < m.date) fail(422, "The exit date is before the investment date");
  const p = projectById(m.project_id);
  Object.assign(m, { status: "exited", exit_date: b.date, exit_amount: Number(b.amount), exit_reference: b.reference });
  postLedger("investor_funds", "out", Number(b.amount), "investment", m.id, `Exit paid to ${m.investor_name} (${p.name})`, user, m.investor_id, "investor_exit", p.branch_id);
  audit(user, "investment_exited", "investors", m.id, { amount: Number(b.amount) });
  return { ok: true };
}, { perm: ["investors", "a"] });

// ---------------- Investor portal ----------------
route("GET", "/investor/overview", ({ user }) => {
  const i = investorById(user.investor_id);
  const [holdings, totals, books] = portfolio(i.id);
  const updates = Object.entries(books).flatMap(([pid, [p]]) => (p?.updates || []).map((u) => ({ ...u, project_name: p.name, project_id: pid })));
  const rm = i.rm_id ? db.users.find((u) => u.id === i.rm_id) : null;
  return { investor: pick(i, ["code", "name", "kind", "kyc_status"]), totals, holdings: holdings.map((h) => omit(h, ["created_by", "reference", "notes"])), series: valueSeries(i.id),
    updates: sortBy(updates, "at", -1).slice(0, 10), recent_payouts: sortBy(db.distributions.filter((d) => d.investor_id === i.id), "date", -1).slice(0, 6).map((d) => omit(d, ["created_by"])),
    rm: rm ? pick(rm, ["name", "phone", "email", "whatsapp"]) : null };
}, { auth: "investor" });
route("GET", "/investor/payouts", ({ user }) => sortBy(db.distributions.filter((d) => d.investor_id === user.investor_id), "date", -1).map((d) => omit(d, ["created_by"])), { auth: "investor" });
route("GET", "/investor/holdings/:id", ({ user, params }) => {
  const [holdings, , books] = portfolio(user.investor_id);
  const h = holdings.find((x) => x.id === params.id) || fail(404, "Holding not found");
  const [p] = books[h.project_id];
  return { ...omit(h, ["created_by"]), project: Object.fromEntries(["id", "code", "name", "kind", "city", "locality", "description", "status", "start_date", "horizon_months", "target_irr_pct", "expected_yield_pct", "cover_image", "valuations", "updates"].map((k) => [k, p?.[k] ?? null])),
    payouts: sortBy(db.distributions.filter((d) => d.investment_id === h.id), "date", -1).map((d) => omit(d, ["created_by"])) };
}, { auth: "investor" });
route("GET", "/investor/updates", ({ user }) => {
  const [, , books] = portfolio(user.investor_id);
  const out = Object.values(books).flatMap(([p]) => (p?.updates || []).map((u) => ({ ...u, project_name: p.name })));
  db.posts.filter((x) => x.audience === "investors" && x.status === "published" && notDeleted(x)).forEach((x) => out.push({ id: x.id, title: x.title, body: x.body, at: x.published_at, project_name: "Company news", by: "Sellandiamman Estates" }));
  return out.sort((a, b) => ((a.at || "") < (b.at || "") ? 1 : -1));
}, { auth: "investor" });
const portalDocs = (user) => {
  const pids = new Set(db.investments.filter((i) => i.investor_id === user.investor_id).map((i) => i.project_id));
  return sortBy(db.documents.filter((d) => d.is_latest && d.share_with_investor && ((d.entity_type === "investor" && d.entity_id === user.investor_id) || (d.entity_type === "inv_project" && pids.has(d.entity_id)))), "created_at", -1);
};
route("GET", "/investor/documents", ({ user }) => portalDocs(user).map((d) => pick(d, ["id", "original_name", "doc_type", "entity_type", "created_at"])), { auth: "investor" });
route("POST", "/investor/documents/:id/link", ({ user, params }) => {
  if (!portalDocs(user).some((d) => d.id === params.id)) fail(404, "Not found");
  audit(user, "document_link", "documents", params.id, { portal: "investor" });
  return { url: `/api/files/demo-${params.id}`, expires_in: 300 };
}, { auth: "investor" });
