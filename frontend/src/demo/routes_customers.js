// Customer data management (backend/routes_customers.py) for the hosted preview: one record per person across leads,
// owners, tenants, guests and investors, with consent, KYC, tags, timeline, merge, import/export and DPDP requests.
import { route } from "./router";
import {
  db, fail, nowIso, todayIST, newId, nextCode, normalizePhone, can, isScoped, inScope, audit, pick, sortBy, rx, checkBranch, homeBranch, headOfficeId,
  upsertCustomer, CUSTOMER_TYPES,
} from "./core";
import { anonymiseLeadRecord } from "./routes_sales";
import { csvRoute } from "./routes_admin";

const LANGS = ["english", "tamil", "hindi", "malayalam", "telugu", "kannada", "other"];
const cleanTags = (tags) => [...new Set((tags || []).map((t) => String(t).replace(/\s+/g, " ").trim().toLowerCase().slice(0, 30)).filter(Boolean))].sort().slice(0, 15);
const listView = ({ consent_history, notes_log, ...c }) => c; // eslint-disable-line no-unused-vars
const live = (c) => c.deleted !== true;

function getC(user, id) {
  return db.customers.find((c) => c.id === id && live(c) && inScope(user, "customers")(c)) || fail(404, "Customer not found");
}
function filters(user, q = {}) {
  const r = q.q ? rx(q.q) : null;
  const cutoff = q.inactive_days ? new Date(Date.now() - Number(q.inactive_days) * 864e5).toISOString() : null;
  return (c) => live(c) && !c.merged_into && inScope(user, "customers")(c)
    && (!r || [c.name, c.phone, c.email, c.code, c.organization].some((x) => r.test(x || "")))
    && (!q.type || (c.types || []).includes(q.type))
    && (!q.tag || (c.tags || []).includes(String(q.tag).toLowerCase()))
    && (!q.city || String(c.city || "").toLowerCase() === String(q.city).toLowerCase())
    && (q.consent !== "marketing" || c.consent?.marketing === true)
    && (q.consent !== "whatsapp" || c.consent?.whatsapp === true)
    && (q.consent !== "none" || c.consent?.marketing !== true)
    && (!q.kyc || c.kyc?.status === q.kyc)
    && (!cutoff || (c.last_activity_at || "") < cutoff);
}

route("GET", "/customers", ({ user, query: q }) => {
  const f = filters(user, q);
  const order = { name: ["name", 1], activity: ["last_activity_at", -1] }[q.sort] || ["created_at", -1];
  const all = sortBy(db.customers.filter(f), order[0], order[1]);
  const limit = Math.max(1, Math.min(Number(q.limit || 50), 200)); const page = Math.max(1, Number(q.page || 1));
  const mine = db.customers.filter((c) => live(c) && inScope(user, "customers")(c));
  const base = filters(user);
  return { items: all.slice((page - 1) * limit, page * limit).map(listView), total: all.length, page, limit,
    tags: [...new Set(mine.flatMap((c) => c.tags || []))].sort(),
    type_counts: Object.fromEntries(CUSTOMER_TYPES.map((t) => [t, db.customers.filter((c) => base(c) && (c.types || []).includes(t)).length])) };
}, { perm: ["customers", "r"] });

route("POST", "/customers", ({ user, body: b }) => {
  if (String(b.name || "").trim().length < 2) fail(422, "name: at least 2 characters");
  const phone = normalizePhone(b.phone);
  const dup = db.customers.find((c) => (c.phone === phone || c.alt_phone === phone) && !c.merged_into && live(c));
  if (dup && !b.force) fail(409, `${dup.name} (${dup.code}) already has this mobile number`);
  if (b.branch_id) checkBranch(user, b.branch_id);
  const language = b.language || "english";
  if (!LANGS.includes(language)) fail(422, "Unknown language");
  const alt = b.alt_phone ? normalizePhone(b.alt_phone) : null;
  const consentOn = !!b.marketing_consent;
  const consent = { marketing: consentOn, whatsapp: consentOn, recorded_at: nowIso(), method: "staff" };
  const c = { id: newId(), code: nextCode("customer", "SE-C-", 5), name: b.name.trim(), phone: dup ? null : phone, alt_phone: dup ? phone : alt,
    email: String(b.email || "").trim().toLowerCase() || null, kind: b.kind === "business" ? "business" : "individual", organization: b.organization || null,
    types: (b.types || []).filter((t) => CUSTOMER_TYPES.includes(t)), tags: cleanTags(b.tags), city: b.city || null, locality: b.locality || null, address: b.address || null, language,
    preferred_contact: b.preferred_contact || "phone", source: b.source || "direct", gstin: b.gstin || null, notes: b.notes || null,
    branch_id: b.branch_id || homeBranch(user) || headOfficeId(), rm_id: isScoped(user, "customers") ? user.id : b.rm_id || null, consent,
    consent_history: [{ at: consent.recorded_at, marketing: consentOn, whatsapp: consentOn, by: user.name, method: "staff" }],
    kyc: { status: "not_started" }, pan_last4: null, created_at: nowIso(), updated_at: nowIso(), last_activity_at: nowIso(), merged_into: null, anonymised: false, deleted: false, created_by: user.id };
  db.customers.push(c);
  audit(user, "customer_created", "customers", c.id);
  return c;
}, { perm: ["customers", "w"] });

function timeline(c) {
  const ev = [];
  const leads = db.leads.filter((l) => l.customer_id === c.id);
  const ids = leads.map((l) => l.id);
  db.lead_activities.filter((a) => ids.includes(a.lead_id)).forEach((a) => ev.push({ at: a.created_at, kind: a.kind, title: a.notes || a.kind, by: a.user_name, link: `/erp/leads/${a.lead_id}` }));
  db.site_visits.filter((v) => ids.includes(v.lead_id)).forEach((v) => ev.push({ at: v.scheduled_at, kind: "site_visit", title: `Visit ${v.status} · ${v.property_code} ${v.property_title}`, link: `/erp/leads/${v.lead_id}` }));
  db.deals.filter((d) => ids.includes(d.lead_id)).forEach((d) => ev.push({ at: d.closed_at || d.created_at, kind: "deal", title: `Deal ${d.code} · ${d.stage}`, link: `/erp/deals/${d.id}` }));
  db.leases.filter((l) => l.customer_id === c.id).forEach((l) => {
    ev.push({ at: l.created_at, kind: "lease", title: `Lease ${l.code} · ${l.property_title}`, link: "/erp/leases" });
    db.rent_payments.filter((p) => p.lease_id === l.id).forEach((p) => ev.push({ at: p.date, kind: "rent", title: `Rent ${p.period} paid · ${p.receipt_no}`, amount: p.amount }));
  });
  db.bookings.filter((b) => b.customer_id === c.id).forEach((b) => ev.push({ at: b.check_in, kind: "stay", title: `Stay ${b.code} · ${b.property_title} (${b.nights} nights, ${b.platform})`, amount: b.gross, link: "/erp/short-stay" }));
  const o = db.owners.find((x) => x.customer_id === c.id);
  if (o) ev.push({ at: o.created_at, kind: "owner", title: `Owner record ${o.code}`, link: "/erp/owners" });
  const inv = db.investors.find((x) => x.customer_id === c.id);
  if (inv) db.investments.filter((m) => m.investor_id === inv.id).forEach((m) => ev.push({ at: m.date, kind: "investment", title: `Invested in ${m.project_name}`, amount: m.amount, link: `/erp/investors/${inv.id}` }));
  (c.notes_log || []).forEach((n) => ev.push({ at: n.at, kind: "note", title: n.text, by: n.by }));
  (c.consent_history || []).forEach((h) => ev.push({ at: h.at, kind: "consent", title: `Consent: marketing ${h.marketing ? "yes" : "no"}, WhatsApp ${h.whatsapp ? "yes" : "no"} (${h.method})`, by: h.by }));
  return ev.filter((e) => e.at).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

route("GET", "/customers/duplicates", ({ user }) => {
  const rows = db.customers.filter((c) => live(c) && !c.merged_into && !c.anonymised && inScope(user, "customers")(c)).map((c) => pick(c, ["id", "code", "name", "phone", "alt_phone", "email", "city", "types"]));
  const keyName = (c) => String(c.name || "").toLowerCase().replace(/[^a-z]/g, "");
  const by = {};
  rows.forEach((c) => [c.email && `e:${c.email}`, c.alt_phone && `p:${c.alt_phone}`, c.phone && `p:${c.phone}`, keyName(c).length > 5 && `n:${keyName(c)}:${String(c.city || "").toLowerCase()}`]
    .filter(Boolean).forEach((k) => { (by[k] = by[k] || []).push(c); }));
  const pairs = []; const seen = new Set();
  Object.entries(by).forEach(([k, g]) => {
    for (let i = 0; i < g.length - 1; i += 1) {
      const a = g[i]; const b = g[i + 1];
      const pk = [a.id, b.id].sort().join("|");
      if (!seen.has(pk)) { seen.add(pk); pairs.push({ a, b, reason: { e: "Same email", p: "Same mobile number", n: "Same name and town" }[k[0]] }); }
    }
  });
  return pairs;
}, { perm: ["customers", "w"] });

csvRoute(/^\/customers\/export\.csv$/, (path, q, user) => {
  if (!can(user, "customers", "e")) fail(403, "Your role cannot export customers.");
  const rows = db.customers.filter(filters(user, q));
  audit(user, "export", "customers", null, { rows: rows.length, consent: q.consent || null });
  const cols = ["code", "name", "phone", "email", "kind", "organization", "types", "tags", "city", "locality", "language", "preferred_contact", "marketing_consent", "whatsapp_consent", "kyc_status", "source", "created_at", "last_activity_at"];
  return { cols, rows: rows.map((c) => [c.code, c.name, c.phone, c.email, c.kind, c.organization, (c.types || []).join("|"), (c.tags || []).join("|"), c.city, c.locality, c.language, c.preferred_contact,
    !!c.consent?.marketing, !!c.consent?.whatsapp, c.kyc?.status, c.source, c.created_at, c.last_activity_at].map((x) => x ?? "")) };
});

route("POST", "/customers/import", async ({ user, files }) => {
  if (!can(user, "customers", "w")) fail(403, "You do not have permission for this action");
  const f = files.file?.[0] || fail(422, "Choose a CSV file");
  const text = (await f.text()).replace(/^﻿/, "").slice(0, 3e6);
  const [head, ...lines] = text.split(/\r?\n/).filter((l) => l.trim());
  const cols = (head || "").split(",").map((c) => c.trim().toLowerCase());
  let created = 0; let updated = 0; const errors = [];
  lines.forEach((ln, i) => {
    const vals = ln.split(","); const row = Object.fromEntries(cols.map((c, j) => [c, (vals[j] || "").trim()]));
    try {
      if (!row.name || !(row.phone || row.email)) throw new Error("name and phone (or email) are required");
      const phone = row.phone ? normalizePhone(row.phone) : null;
      const existed = phone && db.customers.some((c) => c.phone === phone && !c.merged_into);
      const types = String(row.types || row.type || "").split(/[|;]/).map((t) => t.trim()).filter((t) => CUSTOMER_TYPES.includes(t));
      const c = upsertCustomer({ name: row.name, phone, email: row.email, types, city: row.city, locality: row.locality, source: "import", marketing_consent: ["yes", "true", "1", "y"].includes(String(row.marketing_consent || "").toLowerCase()) }, user);
      if (row.tags && c) c.tags = cleanTags([...(c.tags || []), ...row.tags.split(/[|;]/)]);
      if (existed) updated += 1; else created += 1;
    } catch (e) { errors.push(`Row ${i + 2}: ${e.detail || e.message}`); }
  });
  audit(user, "import", "customers", null, { created, updated });
  return { created, updated, errors: errors.slice(0, 50) };
}, { perm: ["customers", "e"] });

route("GET", "/customers/:id", ({ user, params }) => {
  const c = { ...getC(user, params.id) };
  c.timeline = timeline(c);
  c.leads = db.leads.filter((l) => l.customer_id === c.id).map((l) => pick(l, ["id", "code", "stage", "interest", "created_at"]));
  const o = db.owners.find((x) => x.customer_id === c.id); c.owner = o ? pick(o, ["id", "code", "name"]) : null;
  const inv = db.investors.find((x) => x.customer_id === c.id); c.investor = inv ? pick(inv, ["id", "code"]) : null;
  c.leases = db.leases.filter((l) => l.customer_id === c.id).map((l) => pick(l, ["id", "code", "property_title", "status", "rent"]));
  c.bookings = db.bookings.filter((b) => b.customer_id === c.id).map((b) => pick(b, ["id", "code", "property_title", "check_in", "nights", "status"]));
  if (c.rm_id) c.rm_name = db.users.find((u) => u.id === c.rm_id)?.name || null;
  c.kyc_documents = db.documents.filter((d) => d.entity_type === "customer" && d.entity_id === c.id && d.doc_type === "kyc" && d.is_latest).length;
  return c;
}, { perm: ["customers", "r"] });

route("PATCH", "/customers/:id", ({ user, params, body }) => {
  const c = getC(user, params.id);
  if (c.anonymised) fail(422, "This customer's personal data was removed on request");
  const allowed = ["name", "email", "alt_phone", "kind", "organization", "types", "tags", "city", "locality", "address", "language", "preferred_contact", "gstin", "notes", ...(isScoped(user, "customers") ? [] : ["rm_id", "branch_id"])];
  const upd = pick(body, allowed);
  if ("name" in upd && String(upd.name).trim().length < 2) fail(422, "Name is required");
  if ("types" in upd) upd.types = (upd.types || []).filter((t) => CUSTOMER_TYPES.includes(t));
  if ("tags" in upd) upd.tags = cleanTags(upd.tags);
  if (upd.alt_phone) upd.alt_phone = normalizePhone(upd.alt_phone);
  if (upd.email) upd.email = upd.email.trim().toLowerCase();
  if (upd.branch_id) checkBranch(user, upd.branch_id);
  if (upd.language && !LANGS.includes(upd.language)) fail(422, "Unknown language");
  upd.updated_at = nowIso();
  Object.assign(c, upd);
  audit(user, "customer_updated", "customers", c.id, upd);
  return c;
}, { perm: ["customers", "w"] });

route("POST", "/customers/:id/notes", ({ user, params, body }) => {
  const c = getC(user, params.id);
  const text = String(body.text || "").trim();
  if (!text) fail(422, "Write a note");
  c.notes_log = [...(c.notes_log || []), { at: nowIso(), by: user.name, text: text.slice(0, 2000) }];
  c.last_activity_at = nowIso();
  return { ok: true };
}, { perm: ["customers", "w"] });

route("PATCH", "/customers/:id/consent", ({ user, params, body }) => {
  const c = getC(user, params.id);
  const rec = { at: nowIso(), marketing: !!body.marketing, whatsapp: !!body.whatsapp, by: user.name, method: String(body.method || "phone call").slice(0, 60) };
  c.consent = { marketing: rec.marketing, whatsapp: rec.whatsapp, recorded_at: rec.at, method: rec.method };
  c.consent_history = [...(c.consent_history || []), rec];
  db.leads.filter((l) => l.customer_id === c.id).forEach((l) => { l.consent = { marketing: rec.marketing, recorded_at: rec.at }; });
  audit(user, "consent_changed", "customers", c.id, rec);
  return { ok: true };
}, { perm: ["customers", "w"] });

route("PATCH", "/customers/:id/kyc", ({ user, params, body }) => {
  const c = getC(user, params.id);
  if (!["not_started", "pending", "verified", "rejected"].includes(body.status)) fail(422, "Invalid KYC status");
  if (body.id_type && !["aadhaar", "pan", "passport", "voter_id", "driving_licence", "gst", "other"].includes(body.id_type)) fail(422, "Invalid ID type");
  if (body.id_last4 && !/^[A-Za-z0-9]{4}$/.test(body.id_last4)) fail(422, "Enter only the last 4 characters of the ID");
  if (body.status === "verified" && !can(user, "customers", "a")) fail(403, "A manager marks KYC as verified");
  const kyc = { status: body.status, id_type: body.id_type || null, id_last4: String(body.id_last4 || "").toUpperCase() || null, note: body.note || null, by: user.name, at: nowIso() };
  c.kyc = kyc;
  audit(user, "kyc_updated", "customers", c.id, { status: kyc.status, id_type: kyc.id_type });
  return kyc;
}, { perm: ["customers", "w"] });

route("POST", "/customers/:id/merge", ({ user, params, body }) => {
  const src = getC(user, params.id);
  const dst = getC(user, String(body.into_id || ""));
  if (src.id === dst.id) fail(422, "Choose a different customer to keep");
  ["leads", "owners", "leases", "bookings", "investors", "invoices", "agreements"].forEach((coll) => db[coll].filter((r) => r.customer_id === src.id).forEach((r) => { r.customer_id = dst.id; }));
  db.documents.filter((d) => d.entity_type === "customer" && d.entity_id === src.id).forEach((d) => { d.entity_id = dst.id; });
  const upd = { types: [...new Set([...(dst.types || []), ...(src.types || [])])].sort(), tags: [...new Set([...(dst.tags || []), ...(src.tags || [])])].sort(), updated_at: nowIso() };
  ["email", "city", "locality", "address", "organization", "gstin"].forEach((k) => { if (!dst[k] && src[k]) upd[k] = src[k]; });
  if (src.phone && src.phone !== dst.phone && !dst.alt_phone) upd.alt_phone = src.phone;
  Object.assign(dst, upd);
  dst.notes_log = [...(dst.notes_log || []), ...(src.notes_log || []), { at: nowIso(), by: user.name, text: `Merged ${src.code} (${src.name}) into this record` }];
  Object.assign(src, { merged_into: dst.id, merged_phone: src.phone, phone: null, updated_at: nowIso() });
  audit(user, "customer_merged", "customers", dst.id, { from: src.code, into: dst.code });
  return { ok: true, kept: dst.id };
}, { perm: ["customers", "a"] });

route("POST", "/customers/:id/anonymise", ({ user, params, body }) => {
  const c = getC(user, params.id);
  if (!body.confirm) fail(422, "Confirm that the customer asked for their data to be removed");
  const kept = [];
  if (db.leases.some((l) => l.customer_id === c.id && l.status === "active")) fail(422, "This person has an active lease. End it first; lease records are kept for accounts.");
  if (db.leases.some((l) => l.customer_id === c.id)) kept.push("lease and rent records (accounting)");
  if (db.bookings.some((b) => b.customer_id === c.id && b.settled)) kept.push("settled stays (accounting)");
  if (db.investors.some((i) => i.customer_id === c.id)) fail(422, "Investors' records are kept while they hold investments");
  db.leads.filter((l) => l.customer_id === c.id).forEach((l) => anonymiseLeadRecord(l, user, body.reason));
  Object.assign(c, { name: "Anonymised customer", phone: null, alt_phone: null, email: null, organization: null, address: null, locality: null, notes: null, notes_log: [], tags: [], gstin: null,
    anonymised: true, anonymised_at: nowIso(), consent: { marketing: false, whatsapp: false, recorded_at: nowIso(), method: "erasure request" }, consent_history: [], kyc: { status: "not_started" }, updated_at: nowIso() });
  db.bookings.filter((b) => b.customer_id === c.id && !b.settled).forEach((b) => Object.assign(b, { guest_name: "Anonymised guest", guest_phone: null, guest_email: null }));
  audit(user, "customer_anonymised", "customers", c.id, { code: c.code, reason: body.reason, kept });
  return { ok: true, kept };
}, { perm: ["customers", "a"] });

// Data access request: what the live server sends as a JSON file (shown in the preview's viewer).
export function customerData(user, id) {
  if (!can(user, "customers", "e")) fail(403, "You do not have permission for this action");
  const c = getC(user, id);
  const { notes_log, ...rest } = c; // eslint-disable-line no-unused-vars
  audit(user, "data_access_export", "customers", c.id);
  return { exported_at: nowIso(), today: todayIST(), customer: rest, leads: db.leads.filter((l) => l.customer_id === c.id),
    leases: db.leases.filter((l) => l.customer_id === c.id).map(({ schedule, ...l }) => l), bookings: db.bookings.filter((b) => b.customer_id === c.id), // eslint-disable-line no-unused-vars
    documents: db.documents.filter((d) => d.entity_type === "customer" && d.entity_id === c.id).map(({ demo_url, stored_name, ...d }) => d) }; // eslint-disable-line no-unused-vars
}
