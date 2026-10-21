// CEO dashboard (backend/routes_ceo.py) for the hosted preview: company health score from six pillars, the figures
// behind it, branch league table, 6-month trend and "what to fix first", for any dates, branch, town and locality.
import { route } from "./router";
import {
  db, state, fail, todayIST, r2, notDeleted, settings, audit, can, allowedBranches, scoreLinear, statusFor, gradeFor, combine, isoAdd, daysBetween, pyRound,
} from "./core";
import { csvRoute } from "./routes_admin";

const PILLARS = [["growth", "Growth", 15], ["profit", "Revenue & profit", 20], ["cash", "Cash & collections", 20], ["sales", "Sales effectiveness", 15], ["portfolio", "Portfolio & occupancy", 15], ["service", "Service & compliance", 15]];
const inP = (v, frm, to) => !!v && frm <= String(v).slice(0, 10) && String(v).slice(0, 10) <= to;
const sum = (rows, f) => rows.reduce((t, x) => t + (typeof f === "function" ? f(x) : x[f] || 0), 0);
const money = (v) => `₹${Math.round(v).toLocaleString("en-US")}`;
const minS = (a, b) => (a < b ? a : b);
const maxS = (a, b) => (a > b ? a : b);

function scope(branches, city, locality) {
  const c = String(city || "").trim().toLowerCase() || null;
  const l = String(locality || "").trim().toLowerCase() || null;
  const pids = c || l ? new Set(db.properties.filter((p) => (!c || String(p.city || "").toLowerCase() === c) && (!l || String(p.locality || "").toLowerCase() === l)).map((p) => p.id)) : null;
  const br = (d) => branches === null || branches.includes(d.branch_id);
  const place = (pid) => pids === null || pids.has(pid);
  return { branches, city: c, locality: l, pids, br, place, ok: (d, f = "property_id") => br(d) && place(f ? d[f] : null), located: pids !== null };
}

function gather(sc, frm, to) {
  const props = db.properties.filter((p) => notDeleted(p) && sc.ok(p, "id"));
  const deals = db.deals.filter((d) => notDeleted(d) && sc.ok(d));
  const leases = db.leases.filter((x) => sc.ok(x));
  const leaseIds = new Set(leases.map((x) => x.id));
  const rents = db.rent_payments.filter((r) => frm <= r.date && r.date <= to && leaseIds.has(r.lease_id));
  const bookings = db.bookings.filter((b) => sc.ok(b));
  const leads = db.leads.filter((ld) => {
    if (!notDeleted(ld) || !sc.br(ld)) return false;
    if (!sc.located) return true;
    if (sc.pids.has(ld.property_id)) return true;
    const txt = String(ld.preferred_locations || "").toLowerCase();
    return !!((sc.locality && txt.includes(sc.locality)) || (sc.city && !sc.locality && txt.includes(sc.city)));
  });
  const wos = db.work_orders.filter((w) => sc.ok(w));
  const expenses = db.expenses.filter((e) => e.paid_from !== "owner_funds" && frm <= e.date && e.date <= to && sc.br(e) && (!sc.located || sc.pids.has(e.property_id)));
  const invoices = db.invoices.filter((i) => i.status !== "void" && sc.br(i));
  const invMap = Object.fromEntries(invoices.map((i) => [i.id, i]));
  const payments = db.payments.filter((p) => frm <= p.date && p.date <= to);
  const visits = db.site_visits.filter((v) => sc.ok(v));

  let brokerage = sum(deals.filter((d) => d.stage === "won" && inP(d.closed_at, frm, to)), (d) => d.final_commission || 0);
  const netOfGst = (p) => { const i = invMap[p.invoice_id]; return i.total ? (p.amount * (i.subtotal || i.total || 0)) / i.total : p.amount; };
  // brokerage billed without a deal record counts when it is paid
  if (!sc.located) brokerage += sum(payments.filter((p) => invMap[p.invoice_id] && invMap[p.invoice_id].type === "brokerage" && !invMap[p.invoice_id].deal_id), netOfGst);
  const management = sum(rents, (r) => (r.amount * Number(r.mgmt_fee_pct || 0)) / 100);
  const shortstay = sum(bookings.filter((b) => ["completed", "checked_in"].includes(b.status) && inP(b.check_out, frm, to)), (b) => b.management_fee || 0);
  const other = sc.located ? 0 : sum(payments.filter((p) => invMap[p.invoice_id] && ["marketing", "other"].includes(invMap[p.invoice_id].type)), netOfGst);
  const revenue = r2(brokerage + management + shortstay + other);
  const woCompany = sum(wos.filter((w) => w.charge_to === "company" && inP(w.completed_at, frm, to)), (w) => w.actual_cost || 0);
  const expenseTotal = r2(sum(expenses, "amount") + woCompany);
  const t = todayIST();
  const outstanding = invoices.filter((i) => ["issued", "partially_paid"].includes(i.status));
  const owed = (i) => i.total - i.paid - (i.credited || 0);
  const outTotal = sum(outstanding, owed);
  const overdue = sum(outstanding.filter((i) => i.due_date < minS(t, to)), owed);
  let rentDue = 0; let rentPaid = 0;
  leases.forEach((x) => (x.schedule || []).forEach((s) => { if (frm <= s.due_date && s.due_date <= minS(to, t)) { rentDue += s.amount; rentPaid += Math.min(s.paid, s.amount); } }));
  const arrears = sum(leases.filter((x) => x.status === "active"), (x) => sum((x.schedule || []).filter((s) => s.due_date < t), (s) => s.amount - s.paid));
  const newLeads = leads.filter((ld) => inP(ld.created_at, frm, to));
  const closed = leads.filter((ld) => ["won", "lost"].includes(ld.stage) && inP(ld.updated_at, frm, to));
  const won = closed.filter((ld) => ld.stage === "won");
  const resp = [];
  newLeads.forEach((ld) => {
    const first = db.lead_activities.filter((a) => a.lead_id === ld.id && !["created", "duplicate_enquiry"].includes(a.kind)).reduce((m, a) => (!m || a.created_at < m ? a.created_at : m), null);
    if (first) { const h = (Date.parse(first) - Date.parse(ld.created_at)) / 3600e3; if (Number.isFinite(h)) resp.push(Math.max(0, h)); }
  });
  resp.sort((a, b) => a - b);
  const median = resp.length ? (resp.length % 2 ? resp[(resp.length - 1) / 2] : (resp[resp.length / 2 - 1] + resp[resp.length / 2]) / 2) : null;
  const visitsDone = visits.filter((v) => v.status === "completed" && inP(v.updated_at || v.scheduled_at, frm, to));
  const dealsNew = deals.filter((d) => inP(d.created_at, frm, to));
  const managed = props.filter((p) => ["rent", "lease"].includes(p.transaction) && p.service_type === "management" && !["inactive", "archived"].includes(p.status));
  const occupied = managed.filter((p) => p.occupancy === "occupied");
  const units = props.filter((p) => p.transaction === "short_stay" && !["inactive", "archived", "draft"].includes(p.status));
  const days = daysBetween(frm, to) + 1;
  let ssNights = 0;
  bookings.forEach((b) => { if (["confirmed", "checked_in", "completed"].includes(b.status)) ssNights += Math.max(0, daysBetween(maxS(b.check_in, frm), minS(b.check_out, isoAdd(to, 1)))); });
  const published = props.filter((p) => p.status === "published");
  const stale = published.filter((p) => p.published_at && daysBetween(String(p.published_at).slice(0, 10), t) > 90);
  const authBad = published.filter((p) => (p.authorization?.expiry || "0000") < isoAdd(t, 30));
  const woDone = wos.filter((w) => inP(w.completed_at, frm, to));
  const onTime = (w) => (w.due_date ? w.completed_at.slice(0, 10) <= w.due_date : daysBetween(w.created_at.slice(0, 10), w.completed_at.slice(0, 10)) <= 7);
  const woOpenLate = wos.filter((w) => ["open", "assigned", "in_progress"].includes(w.status) && w.due_date && w.due_date < t);
  const collected = sc.located ? null : sum(db.ledger_entries.filter((e) => e.ledger === "company" && /^revenue:/.test(e.account) && frm <= String(e.posted_at || "").slice(0, 10) && String(e.posted_at || "").slice(0, 10) <= to && sc.br(e)), (e) => e.amount * (e.direction === "in" ? 1 : -1));
  const ssLive = bookings.filter((b) => ["completed", "checked_in", "confirmed"].includes(b.status) && inP(b.check_in, frm, to));
  return { revenue, by_service: { brokerage: r2(brokerage), management: r2(management), shortstay: r2(shortstay), other: r2(other) }, expenses: expenseTotal, net: r2(revenue - expenseTotal),
    collected: collected == null ? null : r2(collected), receivables: r2(outTotal), overdue: r2(overdue), rent_due: r2(rentDue), rent_paid: r2(rentPaid), arrears: r2(arrears), rent_collected: r2(sum(rents, "amount")),
    new_leads: newLeads.length, closed_leads: closed.length, won_leads: won.length, first_response_h: median == null ? null : pyRound(median, 1), visits_done: visitsDone.length, deals_new: dealsNew.length,
    deals_won: deals.filter((d) => d.stage === "won" && inP(d.closed_at, frm, to)).length, commission: r2(brokerage), managed: managed.length, occupied: occupied.length, units: units.length,
    ss_available: units.length * days, ss_nights: ssNights, ss_bookings: ssLive.length, ss_gross: r2(sum(ssLive, "gross")), ss_adr: r2(sum(ssLive, (b) => b.room_revenue || 0) / Math.max(1, sum(ssLive, "nights"))),
    published: published.length, stale: stale.length, auth_bad: authBad.length, wo_done: woDone.length, wo_on_time: woDone.filter(onTime).length, wo_open_overdue: woOpenLate.length,
    active_leases: leases.filter((x) => x.status === "active").length, listings_total: props.length };
}

function compliance() {
  const admins = db.users.filter((u) => ["super_admin", "director"].includes(u.role) && u.active);
  const inv = db.investors.filter(notDeleted);
  return { admins: admins.length, admins_2step: admins.filter((a) => a.mfa_enabled).length, investors: inv.length, investors_kyc: inv.filter((i) => i.kyc_status === "verified").length };
}
const pct = (a, b) => (b ? pyRound((a / b) * 100, 1) : null);
function growth(cur, prev) {
  if (prev == null || prev === 0) return cur ? 100 : null;
  return pyRound(Math.max(-100, Math.min(999, ((cur - prev) / prev) * 100)), 1);
}
function metrics(cur, prev, comp, targetMonth, days) {
  const M = [];
  const add = (key, pillar, label, value, unit, bad, good, target, fix, link, raw = null) => { const s = scoreLinear(value, bad, good); M.push({ key, pillar, label, value, unit, score: s, status: statusFor(s), target, fix, link, raw }); };
  add("revenue_growth", "growth", "Revenue vs previous period", growth(cur.revenue, prev.revenue), "%", -20, 15, "+15% or more", "Look at which service fell (brokerage, management, short stays) in the revenue split and push that team.", "/erp/ceo", `${money(cur.revenue)} vs ${money(prev.revenue)}`);
  add("lead_growth", "growth", "New enquiries vs previous period", growth(cur.new_leads, prev.new_leads), "%", -25, 20, "+20% or more", "Refresh listings, post an Insight, run a campaign for the weakest town.", "/erp/leads", `${cur.new_leads} vs ${prev.new_leads}`);
  add("margin", "profit", "Operating margin", cur.revenue ? pct(cur.net, cur.revenue) : null, "%", 0, 40, "40% or more", "Check expenses by category in Finance; cut spend that does not bring leads or fees.", "/erp/finance", `${money(cur.net)} left from ${money(cur.revenue)}`);
  if (targetMonth) { const want = (targetMonth * days) / 30; add("target", "profit", "Revenue against target", pct(cur.revenue, want), "%", 50, 100, "100%", "Agree weekly targets per agent and per branch; review pipeline value each Monday.", "/erp/deals", `${money(cur.revenue)} of ${money(want)}`); }
  const od = cur.receivables ? pct(cur.overdue, cur.receivables) : cur.receivables === 0 ? 0 : null;
  add("overdue", "cash", "Invoices overdue (share of money owed)", od, "%", 50, 0, "Under 10%", "Call the oldest overdue invoices first; send the invoice PDF on WhatsApp.", "/erp/finance", `${money(cur.overdue)} overdue of ${money(cur.receivables)}`);
  add("rent_collection", "cash", "Rent collected on time", pct(cur.rent_paid, cur.rent_due), "%", 70, 98, "98% or more", "Follow up arrears from Leases & Rent; the reminders list shows who is late.", "/erp/leases", `${money(cur.rent_paid)} of ${money(cur.rent_due)} due`);
  add("conversion", "sales", "Leads won (of leads closed)", pct(cur.won_leads, cur.closed_leads), "%", 5, 30, "30% or more", "Read the lost reasons in CRM; train on the most common one.", "/erp/leads", `${cur.won_leads} won of ${cur.closed_leads}`);
  add("response", "sales", "First response to a new lead (median)", cur.first_response_h, "hours", 48, 2, "Within 2 hours", "Assign website leads automatically to the branch agent and check overdue follow-ups daily.", "/erp/leads");
  add("visit_to_deal", "sales", "Site visits turning into deals", pct(cur.deals_new, cur.visits_done), "%", 5, 35, "35% or more", "Shortlist better before visits: use 'Matching listings' on each lead.", "/erp/leads", `${cur.deals_new} deals from ${cur.visits_done} visits`);
  add("occupancy", "portfolio", "Managed rentals occupied", pct(cur.occupied, cur.managed), "%", 60, 95, "95% or more", "List vacant managed homes first on the website and portals; review their rent.", "/erp/properties", `${cur.occupied} of ${cur.managed}`);
  add("ss_occupancy", "portfolio", "Short-stay nights booked", pct(cur.ss_nights, cur.ss_available), "%", 20, 70, "70% or more", "Check each home's platforms and prices in Short stays → Homes & platforms; add missing platforms.", "/erp/short-stay", `${cur.ss_nights} of ${cur.ss_available} nights`);
  add("fresh_listings", "portfolio", "Listings fresher than 90 days", pct(cur.published - cur.stale, cur.published), "%", 50, 90, "90% or more", "Re-price or re-shoot listings older than 90 days.", "/erp/properties", `${cur.stale} older than 90 days`);
  add("maintenance", "service", "Repairs finished on time", pct(cur.wo_on_time, cur.wo_done), "%", 50, 95, "95% or more", "Give every work order a due date and a vendor on day one.", "/erp/maintenance", `${cur.wo_on_time} of ${cur.wo_done}; ${cur.wo_open_overdue} open and late`);
  add("authorisations", "service", "Listings with valid owner authorisation", pct(cur.published - cur.auth_bad, cur.published), "%", 70, 100, "100%", "Renew authorisations ending within 30 days (Calendar shows them).", "/erp/calendar", `${cur.auth_bad} ending or ended`);
  add("two_step", "service", "Directors and admins with 2-step sign-in", pct(comp.admins_2step, comp.admins), "%", 0, 100, "100%", "Turn on 2-step sign-in in Security and require it for these roles in Settings.", "/erp/security");
  if (comp.investors) add("investor_kyc", "service", "Investors with KYC verified", pct(comp.investors_kyc, comp.investors), "%", 50, 100, "100%", "Collect PAN and address proof for investors marked pending.", "/erp/investors");
  return M;
}
function sixMonths(to) {
  const out = [];
  let y = Number(to.slice(0, 4)); let m = Number(to.slice(5, 7));
  for (let i = 0; i < 6; i += 1) { out.unshift(`${y}-${String(m).padStart(2, "0")}-01`); m -= 1; if (m < 1) { m = 12; y -= 1; } }
  return out;
}

export function computeCeo(user, frm, to, branch, city, locality, league = true, trend = true, comp = null) {
  const allowed = allowedBranches(user);
  let brs;
  if (branch && branch !== "all") { if (allowed !== null && !allowed.includes(branch)) fail(403, "You can only see your own branches"); brs = [branch]; } else brs = allowed;
  const sc = scope(brs, city, locality);
  const days = daysBetween(frm, to) + 1;
  const pfrm = isoAdd(frm, -days); const pto = isoAdd(frm, -1);
  const cur = gather(sc, frm, to); const prev = gather(sc, pfrm, pto);
  const cp = comp || compliance();
  const s = settings();
  const tg = s.targets?.monthly_revenue || {};
  const target = brs !== null ? sum(Object.entries(tg).filter(([k]) => k !== "all" && brs.includes(k)), ([, v]) => Number(v || 0))
    : Number(tg.all || 0) || sum(Object.entries(tg).filter(([k]) => k !== "all"), ([, v]) => Number(v || 0));
  const ms = metrics(cur, prev, cp, target || null, days);
  const cw = s.health_weights || {};
  const W = PILLARS.map(([k, lab, w]) => [k, lab, parseInt(cw[k] ?? w, 10)]);
  const [score, pillars] = combine(W.map(([k, lab, w]) => ({ key: k, label: lab, weight: w, metrics: ms.filter((m) => m.pillar === k) })));
  let prevScore = null;
  if (league) {
    const pms = metrics(prev, gather(sc, isoAdd(pfrm, -days), isoAdd(pfrm, -1)), cp, target || null, days);
    [prevScore] = combine(W.map(([k, lab, w]) => ({ key: k, label: lab, weight: w, metrics: pms.filter((m) => m.pillar === k) })));
  }
  const weight = Object.fromEntries(W.map(([k, , w]) => [k, w]));
  const fix = ms.filter((m) => m.score != null && m.score < 75).sort((a, b) => (100 - b.score) * weight[b.pillar] - (100 - a.score) * weight[a.pillar]).slice(0, 6);
  const keep = ["revenue", "expenses", "net", "new_leads", "deals_won", "commission", "ss_gross"];
  const out = { period: { from: frm, to, days, prev_from: pfrm, prev_to: pto }, score, grade: gradeFor(score), status: statusFor(score), prev_score: prevScore, pillars, fix_first: fix,
    kpis: { ...cur, prev: Object.fromEntries(keep.map((k) => [k, prev[k]])) }, filters: { branch: branch || "all", city: city || null, locality: locality || null } };
  if (trend) {
    out.trend = sixMonths(to).map((mf) => {
      const [y, m] = mf.split("-").map(Number);
      const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      const g = gather(sc, mf, minS(last, to));
      return { month: mf.slice(0, 7), revenue: g.revenue, expenses: g.expenses, net: g.net, new_leads: g.new_leads, deals_won: g.deals_won, rent_collected: g.rent_collected, ss_gross: g.ss_gross };
    });
  }
  if (league) {
    out.league = [...db.branches].filter((b) => b.active !== false && (brs === null || brs.includes(b.id))).sort((a, b) => (a.order || 0) - (b.order || 0)).map((b) => {
      const sub = computeCeo(user, frm, to, b.id, city, locality, false, false, cp);
      const k = sub.kpis;
      return { branch_id: b.id, branch: b.name, score: sub.score, grade: sub.grade, revenue: k.revenue, net: k.net, new_leads: k.new_leads, deals_won: k.deals_won,
        conversion: pct(k.won_leads, k.closed_leads), occupancy: pct(k.occupied, k.managed), arrears: k.arrears, listings: k.published };
    }).sort((a, b) => (b.score || 0) - (a.score || 0));
  }
  if (can(user, "investors", "r") || ["super_admin", "director"].includes(user.role)) {
    const inv = db.investments.filter((i) => i.status === "active");
    out.investors = { capital: r2(sum(inv, "amount")), projects: new Set(inv.map((i) => i.project_id)).size, payouts: r2(sum(db.distributions.filter((d) => d.date >= frm && d.date <= to), "gross")) };
  }
  return out;
}
function range(q) {
  const t = todayIST();
  const to = q.to || t; const frm = q.frm || isoAdd(t, -89);
  if (frm > to) fail(422, "The start date is after the end date");
  if (daysBetween(frm, to) > 731) fail(422, "Choose at most two years");
  return [frm, to];
}
route("GET", "/ceo/dashboard", ({ user, query: q }) => { const [frm, to] = range(q); return computeCeo(user, frm, to, q.branch || state.branch || null, q.city, q.locality); }, { perm: ["ceo", "r"] });

const g6 = (v) => String(Number(Number(v).toPrecision(6)));
const fmt = (m) => (m.value == null ? "No data" : `${g6(m.value)}${m.unit === "%" ? "%" : ` ${m.unit}`}`);
csvRoute(/^\/ceo\/report\.csv$/, (path, q, user) => {
  if (!can(user, "ceo", "e")) fail(403, "Your role cannot export the CEO report.");
  const [frm, to] = range(q);
  const d = computeCeo(user, frm, to, q.branch || state.branch || null, q.city, q.locality);
  const rows = [["Overall", "Health score", d.score, d.score, d.status, "", `Grade ${d.grade}; previous period ${d.prev_score}`]];
  d.pillars.forEach((p) => {
    rows.push(["Pillar", p.label, "", p.score, p.status, `weight ${p.weight}`, ""]);
    p.metrics.forEach((m) => rows.push(["Measure", m.label, fmt(m), m.score, m.status, m.target, m.raw || ""]));
  });
  Object.entries(d.kpis).forEach(([k, v]) => { if (k !== "prev" && (v === null || typeof v !== "object")) rows.push(["Figure", k, v, "", "", "", ""]); });
  (d.league || []).forEach((r) => rows.push(["Branch", r.branch, r.revenue, r.score, r.grade, "", `leads ${r.new_leads}, deals ${r.deals_won}`]));
  audit(user, "export", "ceo", "report_csv", { from: frm, to });
  return { cols: ["Section", "Item", "Value", "Score", "Status", "Target", "Detail"], rows: rows.map((r) => r.map((x) => x ?? "")) };
});
