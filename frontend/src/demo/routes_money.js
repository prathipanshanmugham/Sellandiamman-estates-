// Finance, leases, owner statements, maintenance and short stays (backend/routes_finance.py, routes_ops.py) for the preview.
import { route } from "./router";
import {
  db, fail, nowIso, todayIST, newId, r2, notDeleted, one, sortBy, pick, nextCode, inr, normalizePhone, settings, can, inScope, getScoped,
  audit, notify, notifyRoles, postLedger, LEDGERS, calcInvoice, calcShortstay, rangesOverlap,
} from "./core";
import { statementData } from "./routes_site";

// ---------------- Invoices & payments ----------------
const fy = (d) => { const y = Number(d.slice(5, 7)) >= 4 ? Number(d.slice(0, 4)) : Number(d.slice(0, 4)) - 1; return `${y}-${String((y + 1) % 100).padStart(2, "0")}`; };
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export function createInvoiceDoc(data, user) {
  const s = settings();
  const calc = calcInvoice(data.lines, s.gst_rate || 0, !!s.gst_enabled);
  if (data.deal_id && db.invoices.some((i) => i.deal_id === data.deal_id)) fail(409, "An invoice already exists for this deal");
  const t = todayIST();
  const inv = { id: newId(), number: nextCode(`inv-${fy(t)}`, `SE/${fy(t)}/`, 4), type: data.type, customer_name: data.customer_name, customer_phone: data.customer_phone || null, customer_gstin: data.customer_gstin || null,
    ...calc, paid: 0, credited: 0, status: "issued", issue_date: t, due_date: addDays(t, Number(s.invoice_due_days || 15)), deal_id: data.deal_id || null, booking_id: null, owner_id: null, notes: data.notes || null, created_by: user.id, created_at: nowIso() };
  db.invoices.push(inv);
  audit(user, "invoice_issued", "finance", inv.id, { total: inv.total, number: inv.number });
  return inv;
}

route("GET", "/invoices", ({ query: q }) => sortBy(db.invoices.filter((i) => !q.status || i.status === q.status), "created_at", -1), { perm: ["finance", "r"] });
route("POST", "/invoices", ({ user, body }) => {
  if (!["brokerage", "management", "shortstay", "marketing", "other"].includes(body.type)) fail(422, "Invalid invoice type");
  if (String(body.customer_name || "").length < 2) fail(422, "customer_name: at least 2 characters");
  return createInvoiceDoc(body, user);
}, { perm: ["finance", "w"] });
route("GET", "/invoices/:id", ({ params }) => {
  const inv = one("invoices", (i) => i.id === params.id) || fail(404, "Invoice not found");
  return { ...inv, payments: db.payments.filter((p) => p.invoice_id === inv.id), credit_notes: db.credit_notes.filter((c) => c.invoice_id === inv.id) };
}, { perm: ["finance", "r"] });
route("POST", "/invoices/:id/payments", ({ user, params, body }) => {
  const inv = one("invoices", (i) => i.id === params.id) || fail(404, "Invoice not found");
  const amt = Number(body.amount);
  if (!(amt > 0)) fail(422, "amount: enter an amount");
  if (db.payments.some((p) => p.idempotency_key === body.idempotency_key)) fail(409, "This payment was already recorded");
  if (!["issued", "partially_paid"].includes(inv.status) || inv.paid + inv.credited + amt > inv.total + 0.001) fail(422, "Payment exceeds the outstanding amount or invoice is not payable");
  const rno = nextCode("receipt", "RCPT-", 5);
  const pay = { id: newId(), receipt_no: rno, invoice_id: inv.id, invoice_number: inv.number, ...pick(body, ["amount", "method", "reference", "date", "idempotency_key"]), amount: amt, recorded_by: user.id, created_at: nowIso() };
  db.payments.push(pay);
  inv.paid = r2(inv.paid + amt);
  inv.status = inv.paid + inv.credited >= inv.total - 0.001 ? "paid" : "partially_paid";
  postLedger("company", "in", amt, "invoice", inv.id, `Receipt ${rno} against ${inv.number}`, user, inv.customer_name, `revenue:${inv.type}`);
  audit(user, "payment_recorded", "finance", inv.id, { amount: amt, receipt: rno });
  return { ...pay, invoice_status: inv.status };
}, { perm: ["finance", "w"] });

export function applyCreditNote(inv, payload, user) {
  const amt = Number(payload.amount);
  const used = payload.refund ? inv.credited : inv.credited + inv.paid;
  if (inv.status === "void" || used + amt > inv.total + 0.001) fail(422, "Credit exceeds the invoice's outstanding amount");
  inv.credited = r2(inv.credited + amt);
  const cn = { id: newId(), number: nextCode("credit", "CN-", 5), invoice_id: inv.id, ...payload, by: user.id, created_at: nowIso() };
  db.credit_notes.push(cn);
  if (payload.refund) { postLedger("company", "out", amt, "credit_note", cn.id, `Refund ${cn.number} on ${inv.number}`, user, inv.customer_name, "refund"); inv.paid = r2(inv.paid - amt); }
  let status = inv.paid + inv.credited >= inv.total - 0.001 ? "paid" : inv.paid > 0 ? "partially_paid" : "issued";
  if (inv.credited >= inv.total - 0.001 && inv.paid <= 0.001) status = "credited";
  inv.status = status;
  audit(user, "credit_note", "finance", inv.id, { amount: amt, refund: !!payload.refund });
  return cn;
}
route("POST", "/invoices/:id/credit-note", ({ user, params, body }) => {
  const inv = one("invoices", (i) => i.id === params.id) || fail(404, "Invoice not found");
  if (!(Number(body.amount) > 0) || String(body.reason || "").length < 3) fail(422, "Enter an amount and a reason");
  if (body.refund && Number(body.amount) > inv.paid) fail(422, "Refund exceeds amount paid");
  if (can(user, "finance", "a")) return { approval_required: false, credit_note: applyCreditNote(inv, body, user) };
  const ap = { id: newId(), kind: "credit_note", entity_type: "invoice", entity_id: inv.id, summary: `${inv.number}: ${body.refund ? "refund" : "credit/write-off"} ${inr(body.amount)}`, payload: body, status: "pending", requested_by: user.id, requested_by_name: user.name, reason: body.reason, created_at: nowIso() };
  db.approvals.push(ap);
  notifyRoles(["director", "super_admin"], "Approval needed: credit note / refund", ap.summary, "/erp/approvals", `ap:${ap.id}`);
  return { approval_required: true, approval: ap };
}, { perm: ["finance", "w"] });

route("POST", "/deals/:id/invoice", ({ user, params }) => {
  if (!(can(user, "deals", "w") || can(user, "finance", "w"))) fail(403, "You do not have permission for this action");
  const d = getScoped("deals", "deals", user, params.id);
  if (d.stage !== "won") fail(422, "Only closed deals can be invoiced");
  const c = d.commission;
  return createInvoiceDoc({ type: "brokerage", customer_name: c.payer, deal_id: d.id, lines: [{ description: `Brokerage commission – ${d.property_title} (${d.code})`, qty: 1, rate: c.gross }] }, user);
}, { perm: ["deals", "r"] });

// ---------------- Ledgers & expenses ----------------
route("GET", "/ledger", ({ query: q }) => sortBy(db.ledger_entries.filter((e) => (!q.ledger || e.ledger === q.ledger) && (!q.ref_id || e.ref_id === q.ref_id)), "posted_at", -1), { perm: ["finance", "r"] });
route("GET", "/ledger/balances", () => {
  const out = Object.fromEntries(Object.entries(LEDGERS).map(([k, v]) => [k, { name: v, in: 0, out: 0, balance: 0 }]));
  db.ledger_entries.forEach((e) => { const o = out[e.ledger] || (out[e.ledger] = { name: e.ledger, in: 0, out: 0, balance: 0 }); o[e.direction] = r2(o[e.direction] + e.amount); });
  Object.values(out).forEach((o) => { o.balance = r2(o.in - o.out); });
  return out;
}, { perm: ["finance", "r"] });
export function doReverse(e, reason, user) {
  if (e.reversed || e.reversal_of) fail(409, "Entry is already reversed or is itself a reversal");
  e.reversed = true;
  const rev = postLedger(e.ledger, e.direction === "in" ? "out" : "in", e.amount, e.ref_type, e.ref_id, `Reversal of ${e.code}: ${reason}`, user, e.party, e.account);
  rev.reversal_of = e.id;
  audit(user, "ledger_reversal", "finance", e.id, { reason });
  return rev;
}
route("POST", "/ledger/:id/reverse", ({ user, params, body }) => {
  const e = one("ledger_entries", (x) => x.id === params.id) || fail(404, "Entry not found");
  if (String(body.reason || "").length < 3) fail(422, "reason: at least 3 characters");
  if (can(user, "finance", "a")) return { approval_required: false, entry: doReverse(e, body.reason, user) };
  const ap = { id: newId(), kind: "ledger_reversal", entity_type: "ledger", entity_id: e.id, summary: `Reverse ${e.code} (${inr(e.amount)})`, payload: { reason: body.reason }, status: "pending", requested_by: user.id, requested_by_name: user.name, reason: body.reason, created_at: nowIso() };
  db.approvals.push(ap);
  return { approval_required: true, approval: ap };
}, { perm: ["finance", "w"] });
route("GET", "/expenses", () => sortBy(db.expenses, "date", -1), { perm: ["finance", "r"] });
route("POST", "/expenses", ({ user, body: b }) => {
  if (b.paid_from === "owner_funds" && !b.owner_id) fail(422, "Owner is required when paying from owner funds");
  if (!(Number(b.amount) > 0) || !b.category || !b.description) fail(422, "Date, category, description and amount are required");
  const e = { ...pick(b, ["date", "category", "description", "vendor", "bill_ref", "paid_from", "owner_id", "property_id", "branch_id"]), amount: Number(b.amount), gst_amount: Number(b.gst_amount || 0), id: newId(), code: nextCode("expense", "EXP-", 5), by: user.id, created_at: nowIso() };
  db.expenses.push(e);
  postLedger(e.paid_from || "company", "out", e.amount + e.gst_amount, "expense", e.id, `${e.category}: ${e.description}`, user, e.vendor || e.owner_id, `expense:${e.category}`);
  audit(user, "expense_recorded", "finance", e.id, { amount: e.amount });
  return e;
}, { perm: ["finance", "w"] });

// ---------------- Leases & rent ----------------
function buildSchedule(start, end, rent, dueDay, escPct, escMonths) {
  const out = []; let [y, m] = [Number(start.slice(0, 4)), Number(start.slice(5, 7))]; let i = 0;
  const e = end.slice(0, 7);
  while (`${y}-${String(m).padStart(2, "0")}` <= e) {
    const steps = escMonths ? Math.floor(i / escMonths) : 0;
    out.push({ period: `${y}-${String(m).padStart(2, "0")}`, due_date: `${y}-${String(m).padStart(2, "0")}-${String(Math.min(dueDay, 28)).padStart(2, "0")}`, amount: r2(rent * (1 + escPct / 100) ** steps), paid: 0 });
    m += 1; if (m > 12) { m = 1; y += 1; } i += 1;
  }
  return out;
}
const arrears = (l) => r2((l.schedule || []).filter((s) => s.due_date < todayIST()).reduce((t, s) => t + s.amount - s.paid, 0));
const leaseFor = (user, id) => db.leases.find((l) => l.id === id && inScope(user, "leases")(l)) || fail(404, "Record not found");

route("GET", "/leases", ({ user, query: q }) => sortBy(db.leases.filter((l) => inScope(user, "leases")(l) && (!q.status || l.status === q.status)), "end_date").map(({ schedule, ...l }) => ({ ...l, arrears: arrears({ schedule }) })), { perm: ["leases", "r"] });
route("POST", "/leases", ({ user, body: b }) => {
  if (!(b.end_date > b.start_date)) fail(422, "End date must be after start date");
  if (!(Number(b.rent) > 0)) fail(422, "rent: enter the monthly rent");
  const p = one("properties", (x) => x.id === b.property_id && notDeleted(x)) || fail(404, "Property not found");
  const clash = db.leases.find((l) => l.property_id === p.id && l.status === "active" && l.start_date < b.end_date && l.end_date > b.start_date);
  if (clash) fail(409, `Property already has an active lease ${clash.code} in this period`);
  const d = { tenant_kind: "individual", lease_type: "residential", due_day: 5, deposit: 0, escalation_pct: 0, escalation_every_months: 12, mgmt_fee_pct: 0, ...pick(b, ["property_id", "tenant_name", "tenant_email", "tenant_kind", "lease_type", "start_date", "end_date", "rent", "due_day", "deposit", "escalation_pct", "escalation_every_months", "mgmt_fee_pct", "manager_id", "notes"]) };
  ["rent", "due_day", "deposit", "escalation_pct", "escalation_every_months", "mgmt_fee_pct"].forEach((k) => { d[k] = Number(d[k] || 0); });
  d.tenant_phone = normalizePhone(b.tenant_phone);
  if (user.role === "property_manager") d.manager_id = user.id;
  d.manager_id = d.manager_id || p.assigned_manager || user.id;
  const l = { id: newId(), code: nextCode("lease", "SE-LS-"), ...d, owner_id: p.owner_id, property_title: p.title, property_code: p.code, status: "active", deposit_held: 0, handovers: [], issues: [],
    schedule: buildSchedule(d.start_date, d.end_date, d.rent, d.due_day, d.escalation_pct, d.escalation_every_months), created_at: nowIso() };
  db.leases.push(l);
  Object.assign(p, { occupancy: "occupied", service_type: "management" });
  audit(user, "lease_created", "leases", l.id);
  return l;
}, { perm: ["leases", "w"] });
route("GET", "/leases/:id", ({ user, params }) => { const l = leaseFor(user, params.id); return { ...l, payments: sortBy(db.rent_payments.filter((p) => p.lease_id === l.id), "date", -1), arrears: arrears(l) }; }, { perm: ["leases", "r"] });
route("POST", "/leases/:id/rent", ({ user, params, body: b }) => {
  const l = leaseFor(user, params.id);
  if (db.rent_payments.some((p) => p.idempotency_key === b.idempotency_key)) fail(409, "This rent payment was already recorded");
  if (l.status !== "active") fail(422, "Rent can only be recorded on an active lease");
  const s = l.schedule.find((x) => x.period === b.period) || fail(422, "Period is outside the lease schedule");
  const amt = Number(b.amount);
  if (s.paid + amt > s.amount + 0.001) fail(422, `Amount exceeds the balance due for ${b.period}`);
  const p = { id: newId(), lease_id: l.id, lease_code: l.code, owner_id: l.owner_id, property_id: l.property_id, mgmt_fee_pct: l.mgmt_fee_pct, ...pick(b, ["period", "method", "reference", "date", "idempotency_key"]), amount: amt, receipt_no: nextCode("rent_receipt", "RR-", 5), by: user.id, created_at: nowIso() };
  db.rent_payments.push(p);
  s.paid = r2(s.paid + amt);
  postLedger("owner_funds", "in", amt, "rent", p.id, `Rent ${b.period} ${l.code} received on behalf of owner`, user, l.owner_id, "rent_collected");
  audit(user, "rent_recorded", "leases", l.id, { amount: amt, period: b.period });
  return p;
}, { perm: ["leases", "w"] });
route("POST", "/leases/:id/deposit", ({ user, params, body: b }) => {
  const l = leaseFor(user, params.id);
  const amt = Number(b.amount);
  if (b.direction === "out" && amt > (l.deposit_held || 0) + 0.001) fail(422, "Refund exceeds deposit held");
  if (db.deposit_movements.some((d) => d.idempotency_key === b.idempotency_key)) fail(409, "Already recorded");
  db.deposit_movements.push({ id: newId(), lease_id: l.id, ...b, amount: amt, by: user.id, created_at: nowIso() });
  l.deposit_held = r2((l.deposit_held || 0) + (b.direction === "in" ? amt : -amt));
  postLedger("deposits", b.direction, amt, "lease", l.id, `Deposit ${b.direction === "in" ? "received" : "refunded"} ${l.code}: ${b.reason}`, user, l.tenant_name, "tenant_deposit");
  return { ok: true, deposit_held: l.deposit_held };
}, { perm: ["leases", "w"] });
route("POST", "/leases/:id/handover", ({ user, params, body }) => { const l = leaseFor(user, params.id); const rec = { id: newId(), ...body, by: user.name, at: nowIso() }; l.handovers = [...(l.handovers || []), rec]; return rec; }, { perm: ["leases", "w"] });
route("POST", "/leases/:id/terminate", ({ user, params, body }) => {
  const l = leaseFor(user, params.id);
  if (l.status !== "active") fail(422, "Lease is not active");
  Object.assign(l, { status: "ended", ended_reason: body.reason || null, ended_at: nowIso() });
  const p = one("properties", (x) => x.id === l.property_id); if (p) p.occupancy = "vacant";
  audit(user, "lease_ended", "leases", l.id);
  return { ok: true };
}, { perm: ["leases", "w"] });

// ---------------- Owner statements ----------------
route("GET", "/owners/:id/statement", ({ user, params, query }) => {
  if (!(can(user, "leases", "r") || can(user, "finance", "r"))) fail(403, "You do not have permission for this action");
  const [rents, exps, calc] = statementData(params.id, query.month);
  return { month: query.month, rents, ...calc, expense_items: exps, settled: one("owner_statements", (s) => s.owner_id === params.id && s.month === query.month) };
}, { perm: ["owners", "r"] });
route("POST", "/owners/:id/statement/settle", ({ user, params, body }) => {
  const month = body.month || "";
  const owner = one("owners", (o) => o.id === params.id);
  if (!owner || month.length !== 7) fail(422, "Owner and month (YYYY-MM) are required");
  const [, , calc] = statementData(owner.id, month);
  if (calc.rent_collected <= 0) fail(422, "No rent collected for this month");
  if (db.owner_statements.some((s) => s.owner_id === owner.id && s.month === month)) fail(409, "Statement already settled for this month");
  const st = { id: newId(), code: nextCode("statement", "OS-", 5), owner_id: owner.id, owner_name: owner.name, month, ...calc, payout_status: "pending_manual_transfer", by: user.id, created_at: nowIso() };
  db.owner_statements.push(st);
  postLedger("owner_funds", "out", calc.management_fee, "owner_statement", st.id, `Management fee ${month} transferred to company`, user, owner.id, "mgmt_fee");
  postLedger("company", "in", calc.management_fee, "owner_statement", st.id, `Management fee ${month} – ${owner.name}`, user, owner.id, "revenue:management");
  postLedger("owner_funds", "out", calc.expenses, "owner_statement", st.id, `Maintenance recovered ${month}`, user, owner.id, "expense_recovery");
  postLedger("company", "in", calc.expenses, "owner_statement", st.id, `Maintenance cost recovered from owner ${month}`, user, owner.id, "reimbursement");
  audit(user, "owner_statement_settled", "owners", owner.id, { month, ...calc });
  return st;
}, { perm: ["leases", "w"] });
route("GET", "/owner-statements", () => sortBy(db.owner_statements, "created_at", -1), { perm: ["finance", "r"] });
route("POST", "/owner-statements/:id/mark-paid", ({ user, params, body }) => {
  const st = one("owner_statements", (s) => s.id === params.id) || fail(404, "Statement not found");
  if (!body.reference) fail(422, "Bank transfer reference is required");
  if (st.payout_status !== "pending_manual_transfer") fail(409, "Payout already recorded");
  Object.assign(st, { payout_status: "paid", payout_reference: body.reference, paid_at: nowIso() });
  postLedger("owner_funds", "out", st.net_payable, "owner_statement", st.id, `Owner payout ${st.month} ref ${body.reference}`, user, st.owner_id, "owner_payout");
  audit(user, "owner_payout", "owners", st.owner_id, { reference: body.reference });
  return { ok: true };
}, { perm: ["finance", "w"] });

// ---------------- Maintenance ----------------
const WO_FLOW = { open: ["assigned", "cancelled"], assigned: ["in_progress", "cancelled"], in_progress: ["completed", "cancelled"], completed: ["closed"], closed: [], cancelled: [] };
route("GET", "/work-orders", ({ query: q }) => sortBy(db.work_orders.filter((w) => !q.status || w.status === q.status), "created_at", -1), { perm: ["maintenance", "r"] });
route("POST", "/work-orders", ({ user, body: b }) => {
  const p = one("properties", (x) => x.id === b.property_id) || fail(404, "Property not found");
  if (String(b.title || "").length < 3) fail(422, "title: at least 3 characters");
  const wo = { category: "general", priority: "medium", charge_to: "owner", ...pick(b, ["property_id", "title", "description", "category", "priority", "due_date", "vendor_id", "quote_amount", "charge_to", "reported_by"]), id: newId(), code: nextCode("wo", "WO-", 5), property_title: p.title,
    status: b.vendor_id ? "assigned" : "open", actual_cost: null, history: [{ at: nowIso(), by: user.name, event: "Created" }], created_by: user.id, created_at: nowIso() };
  db.work_orders.push(wo);
  notify([p.assigned_manager], `Work order ${wo.code}: ${b.title}`, p.title, "/erp/maintenance", `wo:${wo.id}`);
  return wo;
}, { perm: ["maintenance", "w"] });
route("PATCH", "/work-orders/:id", ({ user, params, body }) => {
  const wo = one("work_orders", (w) => w.id === params.id) || fail(404, "Work order not found");
  const upd = pick(body, ["vendor_id", "quote_amount", "due_date", "priority", "charge_to"]);
  const st = body.status;
  if (st && st !== wo.status) {
    if (!WO_FLOW[wo.status].includes(st)) fail(422, `Cannot move from ${wo.status} to ${st}`);
    upd.status = st;
    if (st === "completed") {
      if (body.actual_cost == null || Number(body.actual_cost) < 0) fail(422, "Actual cost is required to complete");
      upd.actual_cost = Number(body.actual_cost); upd.completed_at = nowIso();
    }
  }
  Object.assign(wo, upd);
  wo.history.push({ at: nowIso(), by: user.name, event: body.note || (st ? `Status → ${st}` : "Updated") });
  if (upd.status === "completed" && upd.actual_cost > 0) postLedger("company", "out", upd.actual_cost, "work_order", wo.id, `Vendor paid ${wo.code}`, user, wo.vendor_id, "expense:maintenance");
  audit(user, "work_order_updated", "maintenance", wo.id, upd);
  return wo;
}, { perm: ["maintenance", "w"] });
route("GET", "/vendors", () => sortBy(db.vendors, "name"), { perm: ["maintenance", "r"] });
route("POST", "/vendors", ({ body }) => {
  if (String(body.name || "").length < 2 || String(body.trade || "").length < 2) fail(422, "Name and trade are required");
  const v = { ...pick(body, ["name", "trade", "gstin", "notes"]), phone: normalizePhone(body.phone), id: newId(), created_at: nowIso() };
  db.vendors.push(v);
  return v;
}, { perm: ["maintenance", "w"] });

// ---------------- Short stays ----------------
const bookingView = (u, b) => (can(u, "shortstay", "w") ? b : { ...b, guest_phone: undefined, guest_email: undefined });
route("GET", "/bookings", ({ user, query: q }) => sortBy(db.bookings.filter((b) => !q.property_id || b.property_id === q.property_id), "check_in", -1).map((b) => bookingView(user, b)), { perm: ["shortstay", "r"] });
route("POST", "/bookings", ({ user, body: b }) => {
  const p = one("properties", (x) => x.id === b.property_id && x.transaction === "short_stay") || fail(404, "Short-stay property not found");
  const guests = Number(b.guests || 1);
  if (p.max_guests && guests > p.max_guests) fail(422, `Maximum ${p.max_guests} guests allowed`);
  if (String(b.guest_name || "").length < 2) fail(422, "guest_name: at least 2 characters");
  const pct = b.mgmt_fee_pct != null && b.mgmt_fee_pct !== "" ? Number(b.mgmt_fee_pct) : p.mgmt_fee_pct || 0;
  const calc = calcShortstay(b.check_in, b.check_out, Number(b.nightly_rate), b.discount, b.cleaning_fee, b.platform_fee, b.operating_costs, pct);
  const clash = db.bookings.find((x) => x.property_id === p.id && x.status !== "cancelled" && rangesOverlap(b.check_in, b.check_out, x.check_in, x.check_out));
  if (clash) fail(409, `Dates overlap with booking ${clash.code}`);
  const bk = { ...pick(b, ["property_id", "guest_name", "guest_email", "platform", "source_ref", "notes", "check_in", "check_out"]), guests, nightly_rate: Number(b.nightly_rate), discount: Number(b.discount || 0), cleaning_fee: Number(b.cleaning_fee || 0),
    guest_phone: normalizePhone(b.guest_phone), mgmt_fee_pct: pct, id: newId(), code: nextCode("booking", "SE-B-", 5), ...calc, property_title: p.title, owner_id: p.owner_id, status: "confirmed", settled: false, issues: [], created_by: user.id, created_at: nowIso() };
  db.bookings.push(bk);
  db.tasks.push({ id: newId(), title: `Turnover cleaning – ${p.title} (${bk.code})`, due_date: b.check_out, priority: "high", status: "open", kind: "cleaning", related_type: "booking", related_id: bk.id, assigned_to: null, created_by: user.id, created_at: nowIso(), comments: [] });
  audit(user, "booking_created", "shortstay", bk.id);
  return bk;
}, { perm: ["shortstay", "w"] });
route("PATCH", "/bookings/:id/status", ({ params, body }) => {
  const flow = { confirmed: ["checked_in", "no_show"], checked_in: ["completed"] };
  const b = one("bookings", (x) => x.id === params.id) || fail(404, "Booking not found");
  if (!(flow[b.status] || []).includes(body.status)) fail(422, `Cannot move from ${b.status} to ${body.status}`);
  b.status = body.status; b[`${body.status}_at`] = nowIso();
  return { ok: true };
}, { perm: ["shortstay", "w"] });
route("POST", "/bookings/:id/issues", ({ user, params, body }) => {
  if (!body.note) fail(422, "Note is required");
  const b = one("bookings", (x) => x.id === params.id) || fail(404, "Booking not found");
  b.issues = [...(b.issues || []), { at: nowIso(), by: user.name, note: String(body.note).slice(0, 1000) }];
  return { ok: true };
}, { perm: ["shortstay", "w"] });
export function applyBookingCancel(b, payload, user) {
  if (b.status !== "confirmed" || b.settled) fail(409, "Booking cannot be cancelled in its current state");
  Object.assign(b, { status: "cancelled", cancel_reason: payload.reason, refund_amount: Number(payload.refund_amount || 0), cancelled_at: nowIso() });
  audit(user, "booking_cancelled", "shortstay", b.id, payload);
  return { ok: true };
}
route("POST", "/bookings/:id/cancel", ({ user, params, body }) => {
  const b = one("bookings", (x) => x.id === params.id) || fail(404, "Booking not found");
  const refund = Number(body.refund_amount || 0);
  if (String(body.reason || "").length < 3) fail(422, "reason: at least 3 characters");
  if (refund > b.gross) fail(422, "Refund exceeds booking value");
  if (refund > 0 && (settings().approvals || {}).refunds !== false && !can(user, "shortstay", "a")) {
    const ap = { id: newId(), kind: "booking_refund", entity_type: "booking", entity_id: b.id, summary: `${b.code}: cancel with refund ${inr(refund)}`, payload: { reason: body.reason, refund_amount: refund }, status: "pending", requested_by: user.id, requested_by_name: user.name, reason: body.reason, created_at: nowIso() };
    db.approvals.push(ap);
    notifyRoles(["director", "super_admin"], "Approval needed: booking refund", ap.summary, "/erp/approvals", `ap:${ap.id}`);
    return { approval_required: true, approval: ap };
  }
  return applyBookingCancel(b, { reason: body.reason, refund_amount: refund }, user);
}, { perm: ["shortstay", "w"] });
route("POST", "/bookings/:id/settle", ({ user, params }) => {
  const b = one("bookings", (x) => x.id === params.id) || fail(404, "Booking not found");
  if (b.status !== "completed") fail(422, "Only completed stays can be settled");
  if (b.settled) fail(409, "Booking already settled");
  Object.assign(b, { settled: true, settled_at: nowIso(), payout_status: "pending_manual_transfer" });
  const o = b.owner_id;
  postLedger("shortstay_owner", "in", b.net_after_platform, "booking", b.id, `${b.code} net booking proceeds (gross ${inr(b.gross)} less platform fee)`, user, o, "booking_net");
  postLedger("shortstay_owner", "out", b.management_fee, "booking", b.id, `${b.code} management fee`, user, o, "mgmt_fee");
  postLedger("company", "in", b.management_fee, "booking", b.id, `${b.code} short-stay management fee`, user, o, "revenue:shortstay");
  postLedger("shortstay_owner", "out", b.operating_costs, "booking", b.id, `${b.code} operating costs`, user, o, "operating_costs");
  audit(user, "booking_settled", "shortstay", b.id, { owner_payout: b.owner_payout });
  return { ok: true, owner_payout: b.owner_payout, management_fee: b.management_fee };
}, { perm: ["shortstay", "w"] });
