// CRM, properties, owners and deals (backend/routes_crm.py, routes_props.py, routes_deals.py) for the hosted preview.
import { route } from "./router";
import {
  db, fail, nowIso, nowIstMin, todayIST, newId, notDeleted, one, sortBy, pick, rx, nextCode, inr, normalizePhone, settings, can, isScoped,
  inScope, getScoped, audit, notify, notifyRoles, postLedger, LEAD_STAGES, PROPERTY_FLOW, calcCommission,
  checkBranch, homeBranch, headOfficeId, branchForPlace, inBranch, inBranches, linkCustomer, ensurePlace, geoFields,
} from "./core";
import { createUser } from "./routes_site";

// ---------------- CRM ----------------
const SOURCES = ["website", "whatsapp", "phone", "referral", "walk_in", "portal", "social", "broker", "existing_customer", "campaign"];
const TYPES = ["buyer", "seller", "tenant", "landlord", "investor", "business"];

export function addActivity(leadId, kind, notes, user = null, extra = {}) {
  db.lead_activities.push({ id: newId(), lead_id: leadId, kind, notes, user_id: user?.id || null, user_name: user ? user.name : "System", created_at: nowIso(), ...extra });
}

// Branch for a lead from the places it mentions ("Thindal, Nasiyanur"), else the head office.
function branchFromText(text) {
  if (text) {
    const words = String(text).split(/[,/;&]| and /).map((w) => w.trim().toLowerCase()).filter(Boolean);
    const rows = db.locations.filter((l) => l.active !== false);
    for (const kind of ["locality", "city"]) {
      const r = rows.find((x) => x.kind === kind && words.includes(x.name.toLowerCase()));
      if (r) return r.branch_id || branchForPlace(r.city);
    }
  }
  return headOfficeId();
}
const LEAD_TYPE = { buyer: "buyer", seller: "seller", tenant: "tenant", landlord: "landlord", investor: "investor", business: "business" };

export function createLead(data, user, note) {
  const dup = db.leads.find((l) => l.phone === data.phone && !["won", "lost"].includes(l.stage) && notDeleted(l));
  if (dup && !data.force) { addActivity(dup.id, "duplicate_enquiry", note || "Repeat enquiry received", user); return [dup, true]; }
  const lead = { id: newId(), code: nextCode("lead", "SE-LD-", 5), stage: "new", deleted: false, created_at: nowIso(), updated_at: nowIso(), created_by: user?.id || null, contacts: [], lost_reason: null, next_follow_up: null,
    ...pick(data, ["name", "phone", "email", "organization", "customer_type", "source", "interest", "budget_min", "budget_max", "preferred_locations", "requirements", "property_id", "assigned_to", "branch_id", "next_follow_up", "preferred_contact", "utm_source", "campaign_id"]),
    consent: { marketing: !!data.marketing_consent, recorded_at: nowIso() } };
  if (!lead.branch_id) lead.branch_id = branchFromText(lead.preferred_locations);
  db.leads.push(lead);
  linkCustomer("leads", lead.id, { name: lead.name, phone: lead.phone, email: lead.email, organization: lead.organization, types: [LEAD_TYPE[lead.customer_type] || "buyer"], source: lead.source,
    branch_id: lead.branch_id, rm_id: lead.assigned_to, preferred_contact: lead.preferred_contact, marketing_consent: data.marketing_consent }, user);
  addActivity(lead.id, "created", note || "Lead created", user);
  if (lead.assigned_to) notify([lead.assigned_to], `New lead assigned: ${lead.name}`, lead.requirements || "", `/erp/leads/${lead.id}`, `assign:${lead.id}:${lead.assigned_to}`);
  return [lead, false];
}

const validate = (d) => {
  if (d.customer_type && !TYPES.includes(d.customer_type)) fail(422, "Invalid customer type");
  if (d.source && !SOURCES.includes(d.source)) fail(422, "Invalid lead source");
};

route("GET", "/leads", ({ user, query: q }) => {
  let rows = db.leads.filter((l) => notDeleted(l) && inScope(user, "leads")(l));
  if (q.stage) rows = rows.filter((l) => l.stage === q.stage);
  if (q.source) rows = rows.filter((l) => l.source === q.source);
  if (q.assigned_to && !isScoped(user, "leads")) rows = rows.filter((l) => (q.assigned_to === "unassigned" ? !l.assigned_to : l.assigned_to === q.assigned_to));
  if (q.overdue && String(q.overdue) !== "false") rows = rows.filter((l) => l.next_follow_up && l.next_follow_up < nowIstMin() && !["won", "lost"].includes(l.stage));
  if (q.q) { const r = rx(q.q); rows = rows.filter((l) => [l.name, l.phone, l.code, l.email].some((x) => r.test(x || ""))); }
  return sortBy(rows, "created_at", -1);
}, { perm: ["leads", "r"] });

route("POST", "/leads", ({ user, body }) => {
  const d = { ...body };
  validate(d);
  if (String(d.name || "").trim().length < 2) fail(422, "name: at least 2 characters");
  d.phone = normalizePhone(d.phone);
  if (isScoped(user, "leads")) d.assigned_to = user.id;
  if (d.branch_id) checkBranch(user, d.branch_id);
  else d.branch_id = homeBranch(user) || branchFromText(d.preferred_locations);
  const ex = db.leads.find((l) => l.phone === d.phone && !["won", "lost"].includes(l.stage) && notDeleted(l));
  if (ex && !d.force) fail(409, `Possible duplicate: open lead ${ex.code} (${ex.name}) has this phone`);
  const [lead] = createLead({ ...d, force: true }, user);
  audit(user, "lead_created", "leads", lead.id);
  return lead;
}, { perm: ["leads", "w"] });

route("POST", "/leads/import", async ({ user, files }) => {
  if (!can(user, "leads", "w")) fail(403, "You do not have permission for this action");
  const f = files.file?.[0] || fail(422, "Choose a CSV file");
  const text = (await f.text()).replace(/^﻿/, "");
  const [head, ...lines] = text.split(/\r?\n/).filter((l) => l.trim());
  const cols = (head || "").split(",").map((c) => c.trim().toLowerCase());
  let created = 0; let dups = 0; const errors = [];
  lines.forEach((ln, i) => {
    const vals = ln.split(","); const row = Object.fromEntries(cols.map((c, j) => [c, (vals[j] || "").trim()]));
    try {
      if (!row.name || !row.phone) throw new Error("name and phone are required");
      const [, dup] = createLead({ name: row.name.slice(0, 100), phone: normalizePhone(row.phone), email: row.email || null, source: SOURCES.includes(row.source) ? row.source : "campaign", interest: row.interest || "buy", customer_type: "buyer", requirements: row.requirements || null, assigned_to: isScoped(user, "leads") ? user.id : null }, user, "Imported from CSV");
      if (dup) dups += 1; else created += 1;
    } catch (e) { errors.push(`Row ${i + 2}: ${e.detail || e.message}`); }
  });
  audit(user, "import", "leads", null, { created, duplicates: dups });
  return { created, duplicates: dups, errors: errors.slice(0, 50) };
}, { perm: ["leads", "e"] });

route("GET", "/leads/:id", ({ user, params }) => {
  const l = getScoped("leads", "leads", user, params.id);
  return { ...l, activities: sortBy(db.lead_activities.filter((a) => a.lead_id === l.id), "created_at", -1), site_visits: sortBy(db.site_visits.filter((v) => v.lead_id === l.id), "scheduled_at", -1),
    deals: db.deals.filter((d) => d.lead_id === l.id).map((d) => pick(d, ["id", "code", "stage", "title"])) };
}, { perm: ["leads", "r"] });

route("PATCH", "/leads/:id", ({ user, params, body }) => {
  const l = getScoped("leads", "leads", user, params.id);
  const upd = { ...body };
  validate(upd);
  if ("assigned_to" in upd && isScoped(user, "leads")) fail(403, "Only managers can reassign leads");
  if (upd.branch_id) checkBranch(user, upd.branch_id);
  if ("stage" in upd) {
    if (!LEAD_STAGES.includes(upd.stage)) fail(422, "Invalid stage");
    if (upd.stage === "lost" && !(upd.lost_reason || l.lost_reason)) fail(422, "A lost reason is required");
    if (upd.stage === "won" && !db.deals.some((d) => d.lead_id === l.id && d.stage === "won")) fail(422, "Close a deal for this lead to mark it won");
  }
  if ("marketing_consent" in upd) { upd.consent = { marketing: upd.marketing_consent, recorded_at: nowIso() }; delete upd.marketing_consent; }
  upd.updated_at = nowIso();
  const before = { stage: l.stage, assigned_to: l.assigned_to };
  Object.assign(l, upd);
  if ("stage" in upd && upd.stage !== before.stage) addActivity(l.id, "stage_change", `Stage: ${before.stage} → ${upd.stage}`, user);
  if (upd.assigned_to && upd.assigned_to !== before.assigned_to) {
    addActivity(l.id, "assigned", "Lead reassigned", user);
    notify([upd.assigned_to], `Lead assigned to you: ${l.name}`, "", `/erp/leads/${l.id}`, `assign:${l.id}:${upd.assigned_to}`);
  }
  audit(user, "lead_updated", "leads", l.id, upd);
  return l;
}, { perm: ["leads", "w"] });

route("POST", "/leads/:id/activities", ({ user, params, body }) => {
  const l = getScoped("leads", "leads", user, params.id);
  if (!String(body.notes || "").trim()) fail(422, "notes: required");
  addActivity(l.id, body.kind, body.notes, user, { outcome: body.outcome || null });
  Object.assign(l, { updated_at: nowIso(), last_contacted_at: nowIso(), next_follow_up: body.next_follow_up || null });
  if (l.stage === "new" && ["call", "whatsapp", "email", "meeting", "sms"].includes(body.kind)) { l.stage = "contacted"; addActivity(l.id, "stage_change", "Stage: new → contacted", user); }
  return { ok: true };
}, { perm: ["leads", "w"] });

route("POST", "/leads/:id/site-visits", ({ user, params, body }) => {
  const l = getScoped("leads", "leads", user, params.id);
  const p = one("properties", (x) => x.id === body.property_id && notDeleted(x)) || fail(404, "Property not found");
  if (!body.scheduled_at) fail(422, "scheduled_at: required");
  const v = { id: newId(), lead_id: l.id, lead_name: l.name, property_id: p.id, property_title: p.title, property_code: p.code, scheduled_at: body.scheduled_at, status: "scheduled", notes: body.notes || null, agent_id: l.assigned_to || user.id, branch_id: l.branch_id || null, created_at: nowIso() };
  db.site_visits.push(v);
  if (LEAD_STAGES.indexOf(l.stage) < LEAD_STAGES.indexOf("site_visit")) { addActivity(l.id, "stage_change", `Stage: ${l.stage} → site_visit`, user); l.stage = "site_visit"; }
  addActivity(l.id, "site_visit", `Site visit scheduled at ${p.code} for ${body.scheduled_at}`, user);
  notify([v.agent_id], `Site visit: ${l.name}`, `${p.title} at ${body.scheduled_at}`, `/erp/leads/${l.id}`, `visit:${v.id}`);
  return v;
}, { perm: ["leads", "w"] });

route("GET", "/site-visits", ({ user }) => sortBy(db.site_visits.filter((v) => (!isScoped(user, "leads") || v.agent_id === user.id) && inBranches(user)(v)), "scheduled_at", -1), { perm: ["leads", "r"] });

route("PATCH", "/site-visits/:id", ({ user, params, body }) => {
  const v = one("site_visits", (x) => x.id === params.id) || fail(404, "Visit not found");
  const l = getScoped("leads", "leads", user, v.lead_id);
  if (!["requested", "scheduled", "completed", "cancelled", "no_show"].includes(body.status)) fail(422, "Invalid status");
  const upd = { status: body.status, feedback: body.feedback || null, updated_at: nowIso() };
  if (body.status === "scheduled") {
    const when = body.scheduled_at || v.scheduled_at;
    if (!when) fail(422, "Choose a date and time for the visit");
    upd.scheduled_at = when; upd.agent_id = v.agent_id || l.assigned_to || user.id;
    notify([upd.agent_id], `Site visit confirmed: ${v.lead_name}`, `${v.property_title} at ${when}`, `/erp/leads/${v.lead_id}`, `visit:${v.id}:${when}`);
  }
  Object.assign(v, upd);
  addActivity(v.lead_id, "site_visit", `Visit ${body.status}${body.status === "scheduled" ? ` for ${upd.scheduled_at}` : ""}${body.feedback ? `: ${body.feedback}` : ""}`, user);
  return v;
}, { perm: ["leads", "w"] });

function score(lead, p) {
  let s = 0; const why = [];
  const locs = String(lead.preferred_locations || "").split(/[,/;]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const hay = `${p.locality || ""} ${p.city || ""} ${p.pincode || ""}`.toLowerCase();
  if (locs.length && locs.some((x) => hay.includes(x))) { s += 3; why.push("preferred location"); }
  const { price } = p; const bmin = lead.budget_min; const bmax = lead.budget_max;
  if (price && bmax && price <= bmax && (!bmin || price >= bmin)) { s += 3; why.push("within budget"); } else if (price && bmax && price <= bmax * 1.1) { s += 1; why.push("just above budget"); }
  const req = String(lead.requirements || "").toLowerCase();
  if (p.bedrooms && req.includes(`${p.bedrooms} bhk`)) { s += 2; why.push(`${p.bedrooms} BHK`); }
  if (p.category && req.includes(p.category.replace("_", " "))) { s += 1; why.push(p.category.replace("_", " ")); }
  if (p.status === "published") s += 1;
  return [s, why];
}
route("GET", "/leads/:id/matches", ({ user, params }) => {
  const l = getScoped("leads", "leads", user, params.id);
  if (!can(user, "properties", "r")) fail(403, "You do not have permission for this action");
  const tx = { buy: "sale", rent: "rent", lease: "lease", short_stay: "short_stay", commercial: "lease" }[l.interest];
  let rows = db.properties.filter((p) => ["published", "ready_to_market", "under_offer"].includes(p.status) && notDeleted(p) && inScope(user, "properties")(p) && (!tx || p.transaction === tx));
  if (l.budget_max) rows = rows.filter((p) => p.price == null || p.price_on_request || p.price <= Number(l.budget_max) * 1.1);
  const shared = new Set(db.lead_activities.filter((a) => a.lead_id === l.id && a.kind === "shared_listing").map((a) => a.property_id));
  return rows.map((p) => { const [s, why] = score(l, p); return { ...pick(p, ["id", "code", "listing_id", "title", "locality", "city", "pincode", "price", "price_unit", "price_on_request", "bedrooms", "category", "transaction", "status", "images", "built_area", "plot_area", "area_unit"]), score: s, reasons: why, shared: shared.has(p.id) }; })
    .sort((a, b) => b.score - a.score || (a.price || 0) - (b.price || 0)).slice(0, 20);
}, { perm: ["leads", "r"] });

route("POST", "/leads/:id/share-listings", ({ user, params, body }) => {
  const l = getScoped("leads", "leads", user, params.id);
  const props = db.properties.filter((p) => (body.property_ids || []).slice(0, 20).includes(p.id));
  props.forEach((p) => addActivity(l.id, "shared_listing", `Shared listing ${p.listing_id || p.code}`, user, { property_id: p.id }));
  if (props.length && ["new", "contacted", "qualified", "requirements"].includes(l.stage)) { addActivity(l.id, "stage_change", `Stage: ${l.stage} → matched`, user); Object.assign(l, { stage: "matched", updated_at: nowIso() }); }
  return { shared: props.length };
}, { perm: ["leads", "w"] });

route("POST", "/leads/:id/anonymise", ({ user, params, body }) => {
  const l = getScoped("leads", "leads", user, params.id);
  if (!body.confirm) fail(422, "Confirm that the customer asked for their data to be removed");
  anonymiseLeadRecord(l, user, body.reason);
  return { ok: true };
}, { perm: ["leads", "a"] });

export function anonymiseLeadRecord(l, user, reason = null) {
  Object.assign(l, { name: "Anonymised contact", phone: null, email: null, organization: null, requirements: null, preferred_locations: null, contacts: [], utm_source: null, anonymised: true, anonymised_at: nowIso(),
    consent: { marketing: false, recorded_at: nowIso() }, stage: ["won", "lost"].includes(l.stage) ? l.stage : "lost", lost_reason: l.lost_reason || "data_removal_request", updated_at: nowIso() });
  db.lead_activities.filter((a) => a.lead_id === l.id).forEach((a) => { a.notes = "[removed on request]"; a.outcome = null; });
  db.site_visits.filter((v) => v.lead_id === l.id).forEach((v) => Object.assign(v, { lead_name: "Anonymised contact", feedback: null, notes: null }));
  audit(user, "lead_anonymised", "leads", l.id, { code: l.code, reason });
}

route("POST", "/leads/:id/convert", ({ user, params, body }) => {
  const l = getScoped("leads", "leads", user, params.id);
  const p = db.properties.find((x) => x.id === body.property_id && notDeleted(x) && inScope(user, "properties")(x)) || fail(404, "Property not found");
  const owner = one("owners", (o) => o.id === p.owner_id) || {};
  const d = { id: newId(), code: nextCode("deal", "SE-D-"), title: `${l.name} – ${p.title}`, deal_type: body.deal_type, lead_id: l.id, property_id: p.id, property_title: p.title, buyer_name: l.name, buyer_phone: l.phone,
    seller_name: owner.name || null, stage: "negotiation", assigned_to: l.assigned_to || user.id, branch_id: l.branch_id || p.branch_id, offers: [], agreed_value: null, commission: null, expected_commission: 0,
    checklist: defaultChecklist(body.deal_type), history: [{ at: nowIso(), by: user.name, event: "Deal created from lead" }], created_at: nowIso(), deleted: false };
  db.deals.push(d);
  Object.assign(l, { stage: "negotiation", updated_at: nowIso() });
  addActivity(l.id, "stage_change", `Converted to deal ${d.code}`, user);
  audit(user, "deal_created", "deals", d.id);
  return d;
}, { perm: ["deals", "w"] });

// ---------------- Properties & owners ----------------
const CATEGORIES = ["residential", "apartment", "villa", "land", "agricultural", "commercial", "shop", "office", "industrial", "warehouse", "factory_shed", "other"];
const EDITABLE = ["title", "category", "transaction", "ownership_type", "owner_id", "branch_id", "city", "locality", "pincode", "internal_address", "public_lat", "public_lng", "survey_no", "plot_area", "built_area", "area_unit", "bedrooms", "bathrooms", "furnishing", "amenities", "price", "price_unit", "price_on_request", "negotiated_terms", "description_public", "notes_internal", "images", "availability", "occupancy", "assigned_agent", "assigned_manager", "source", "service_type", "power_supply", "loading_access", "parking", "checkin_instructions", "video_url", "mgmt_fee_pct", "nightly_rate", "max_guests", "service_agreement", "geo", "location_public"];
const RESTRICTED = ["internal_address", "notes_internal", "survey_no", "checkin_instructions", "negotiated_terms", "service_agreement", "owner_id", "geo"];
const viewFor = (u, p) => { const o = { ...p }; if (!can(u, "shortstay", "r")) delete o.checkin_instructions; if (u.role === "marketing") RESTRICTED.forEach((k) => delete o[k]); return o; };

route("GET", "/properties", ({ user, query: q }) => {
  let rows = db.properties.filter((p) => notDeleted(p) && inScope(user, "properties")(p));
  ["status", "category", "transaction", "service_type", "owner_id"].forEach((k) => { if (q[k]) rows = rows.filter((p) => p[k] === q[k]); });
  if (q.q) { const r = rx(q.q); rows = rows.filter((p) => [p.title, p.code, p.listing_id, p.locality].some((x) => r.test(x || ""))); }
  return sortBy(rows, "created_at", -1).map((p) => { const { publication_history, ...rest } = p; return viewFor(user, rest); }); // eslint-disable-line no-unused-vars
}, { perm: ["properties", "r"] });

route("POST", "/properties", ({ user, body }) => {
  const d = { ...body };
  if (!CATEGORIES.includes(d.category)) fail(422, "Invalid category");
  if (String(d.title || "").trim().length < 3) fail(422, "title: at least 3 characters");
  if (!d.city || !d.locality) fail(422, "City and locality are required");
  if (d.pincode && !/^\d{6}$/.test(d.pincode)) fail(422, "PIN code must be 6 digits");
  if (!d.force) {
    const dup = db.properties.find((p) => notDeleted(p) && ((d.survey_no && p.survey_no === d.survey_no && p.city === d.city) || (d.internal_address && String(p.internal_address || "").toLowerCase() === d.internal_address.trim().toLowerCase())));
    if (dup) fail(409, `Possible duplicate of property ${dup.code}`);
  }
  delete d.force;
  if (isScoped(user, "properties")) d.assigned_agent = user.id;
  if (d.location_public && !["approximate", "exact", "hidden"].includes(d.location_public)) fail(422, "Invalid location setting");
  if (d.branch_id) checkBranch(user, d.branch_id);
  else {
    // the branch that covers the town, unless that is outside the person's own branches
    const place = branchForPlace(d.city, d.locality);
    d.branch_id = inBranch(user, place) ? place : homeBranch(user) || place;
  }
  const g = geoFields(d.geo, d.location_public || "approximate", user);
  delete d.geo;
  ensurePlace(String(d.city).trim(), String(d.locality).trim(), d.pincode || null, g.geo?.lat ?? null, g.geo?.lng ?? null, d.branch_id, user.id);
  const p = { amenities: [], images: [], area_unit: "sq.ft", availability: "Immediate", occupancy: "vacant", location_public: "approximate", ...pick(d, EDITABLE), ...g, id: newId(), code: nextCode("property", "SE-P-"), status: "draft", verification: { status: "not_started" }, authorization: {},
    publication_history: [], featured: false, listing_id: null, created_by: user.id, created_at: nowIso(), updated_at: nowIso(), deleted: false };
  db.properties.push(p);
  audit(user, "property_created", "properties", p.id);
  return p;
}, { perm: ["properties", "w"] });

route("GET", "/properties/:id", ({ user, params }) => {
  const p = { ...getScoped("properties", "properties", user, params.id) };
  p.verifications = sortBy(db.verifications.filter((v) => v.property_id === p.id), "at", -1);
  if (can(user, "owners", "r") && p.owner_id) p.owner = one("owners", (o) => o.id === p.owner_id);
  if (can(user, "leases", "r")) p.leases = db.leases.filter((l) => l.property_id === p.id).map(({ schedule, ...rest }) => rest); // eslint-disable-line no-unused-vars
  return viewFor(user, p);
}, { perm: ["properties", "r"] });

route("PATCH", "/properties/:id", ({ user, params, body }) => {
  const p = getScoped("properties", "properties", user, params.id);
  const upd = pick(body, EDITABLE);
  if (isScoped(user, "properties")) delete upd.assigned_agent;
  if ("category" in upd && !CATEGORIES.includes(upd.category)) fail(422, "Invalid category");
  if (upd.pincode && !/^\d{6}$/.test(String(upd.pincode))) fail(422, "PIN code must be 6 digits");
  ["price", "plot_area", "built_area", "mgmt_fee_pct", "nightly_rate"].forEach((k) => { if (upd[k] != null && upd[k] !== "" && Number(upd[k]) < 0) fail(422, `${k} cannot be negative`); });
  if (upd.branch_id) checkBranch(user, upd.branch_id);
  if ("geo" in upd || "location_public" in upd) {
    const geo = upd.geo || p.geo; delete upd.geo;
    const mode = upd.location_public || p.location_public || "approximate";
    const g = geoFields(geo, mode, user, geo?.source || "pin");
    if (Object.keys(g).length) Object.assign(upd, g); else if (mode === "hidden") Object.assign(upd, { public_lat: null, public_lng: null });
  }
  if (upd.city || upd.locality) ensurePlace(upd.city || p.city, upd.locality || p.locality, upd.pincode || p.pincode, null, null, p.branch_id, user.id);
  upd.updated_at = nowIso();
  Object.assign(p, upd);
  audit(user, "property_updated", "properties", p.id, upd);
  return viewFor(user, p);
}, { perm: ["properties", "w"] });

route("POST", "/properties/:id/transition", ({ user, params, body }) => {
  const p = getScoped("properties", "properties", user, params.id);
  const cur = p.status; const to = body.to;
  if (to === "verified") fail(422, "Use the verification action to verify a property");
  if (!(PROPERTY_FLOW[cur] || []).includes(to)) fail(422, `Cannot move from ${cur} to ${to}`);
  const upd = { status: to, updated_at: nowIso() };
  let hist = null;
  if (to === "published") {
    if (!can(user, "properties", "p")) fail(403, "You are not authorised to publish listings");
    const v = p.verification || {}; const a = p.authorization || {};
    if (v.status !== "verified") fail(422, "Ownership verification is required before publishing");
    if (!a.marketing_authorized || !a.expiry || a.expiry < todayIST()) fail(422, "A valid, unexpired marketing authorisation is required before publishing");
    if (!p.description_public || !p.title) fail(422, "Public title and description are required before publishing");
    if (!p.listing_id) upd.listing_id = nextCode("listing", "SEL-", 5);
    upd.published_at = nowIso();
    hist = { at: nowIso(), by: user.name, action: "published", notes: body.notes || null };
  } else if (cur === "published") hist = { at: nowIso(), by: user.name, action: `unpublished (${to})`, notes: body.notes || null };
  if (to === "closed") upd.closed_as = body.closed_as || { sale: "sold", rent: "rented" }[p.transaction] || "leased";
  Object.assign(p, upd);
  if (hist) p.publication_history = [...(p.publication_history || []), hist];
  audit(user, "property_status", "properties", p.id, { from: cur, to });
  return p;
}, { perm: ["properties", "w"] });

route("POST", "/properties/:id/verify", ({ user, params, body: b }) => {
  const p = getScoped("properties", "properties", user, params.id);
  if (!["verification_pending", "verified", "ready_to_market", "published"].includes(p.status)) fail(422, "Submit the property for verification first");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.authorization_expiry || ""))) fail(422, "authorization_expiry: choose a date");
  const ok = b.ownership_verified && b.authorization_signed && b.authorization_expiry >= todayIST();
  const rec = { id: newId(), property_id: p.id, ...pick(b, ["ownership_verified", "authorization_signed", "marketing_authorized", "authorization_expiry", "notes"]), result: ok ? "verified" : "rejected", by: user.id, by_name: user.name, at: nowIso() };
  db.verifications.push(rec);
  Object.assign(p, { verification: { status: ok ? "verified" : "rejected", by: user.name, at: nowIso(), notes: b.notes || null }, authorization: { signed: !!b.authorization_signed, marketing_authorized: !!b.marketing_authorized, expiry: b.authorization_expiry }, updated_at: nowIso() });
  if (ok && p.status === "verification_pending") p.status = "verified";
  audit(user, "property_verification", "properties", p.id, { result: rec.result });
  return { ...p, verification_result: rec.result };
}, { perm: ["properties", "a"] });

route("PATCH", "/properties/:id/featured", ({ user, params, body }) => {
  const p = one("properties", (x) => x.id === params.id) || fail(404, "Record not found");
  p.featured = !!body.featured;
  audit(user, "property_featured", "properties", p.id, { featured: p.featured });
  return { ok: true };
}, { perm: ["cms", "w"] });

route("GET", "/owners", ({ query: q }) => {
  let rows = db.owners.filter(notDeleted);
  if (q.q) { const r = rx(q.q); rows = rows.filter((o) => [o.name, o.phone, o.code].some((x) => r.test(x || ""))); }
  return sortBy(rows, "created_at", -1);
}, { perm: ["owners", "r"] });
route("POST", "/owners", ({ user, body }) => {
  if (String(body.name || "").trim().length < 2) fail(422, "name: at least 2 characters");
  const phone = normalizePhone(body.phone);
  if (db.owners.some((o) => o.phone === phone && notDeleted(o))) fail(409, "An owner with this phone already exists");
  const o = { kind: "individual", is_nri: false, preferred_contact: "phone", ...pick(body, ["name", "email", "kind", "is_nri", "address", "preferred_contact", "representative_name", "representative_phone", "notes"]), phone, id: newId(), code: nextCode("owner", "SE-O-"), created_at: nowIso(), deleted: false };
  db.owners.push(o);
  linkCustomer("owners", o.id, { name: o.name, phone: o.phone, email: o.email, types: ["owner", "landlord"], source: "direct", address: o.address, kind: o.kind === "company" ? "business" : "individual" }, user);
  audit(user, "owner_created", "owners", o.id);
  return o;
}, { perm: ["owners", "w"] });
route("GET", "/owners/:id", ({ user, params }) => {
  const o = { ...(one("owners", (x) => x.id === params.id && notDeleted(x)) || fail(404, "Record not found")) };
  o.properties = db.properties.filter((p) => p.owner_id === o.id && notDeleted(p)).map((p) => pick(p, ["id", "code", "title", "status"]));
  o.statements = sortBy(db.owner_statements.filter((s) => s.owner_id === o.id), "month", -1);
  if (can(user, "users", "r")) o.portal_users = db.users.filter((u) => u.owner_id === o.id && u.role === "owner").map((u) => pick(u, ["id", "email", "active", "last_login"]));
  return o;
}, { perm: ["owners", "r"] });
route("POST", "/owners/:id/portal-invite", ({ user, params, body }) => {
  const o = one("owners", (x) => x.id === params.id && notDeleted(x)) || fail(404, "Record not found");
  const email = String(body.email || o.email || "").trim().toLowerCase();
  if (!email) fail(422, "Add the owner's email address first");
  const out = createUser({ email, name: o.name.slice(0, 100), role: "owner", owner_id: o.id, phone: o.phone }, user);
  if (!o.email) o.email = email;
  audit(user, "owner_portal_invited", "owners", o.id, { email });
  return out;
}, { perm: ["users", "w"] });
route("PATCH", "/owners/:id", ({ user, params, body }) => {
  const o = one("owners", (x) => x.id === params.id) || fail(404, "Record not found");
  const upd = pick(body, ["name", "email", "kind", "is_nri", "address", "preferred_contact", "representative_name", "representative_phone", "notes"]);
  Object.assign(o, upd);
  audit(user, "owner_updated", "owners", o.id, upd);
  return { ok: true };
}, { perm: ["owners", "w"] });

// ---------------- Deals ----------------
export function defaultChecklist(kind) {
  const base = ["Commission agreement signed", "Identity verified (parties)", "Title / ownership documents reviewed"];
  const extra = { sale: ["Sale agreement drafted", "Registration date fixed"], rent: ["Rental agreement executed", "Deposit received", "Move-in checklist"], lease: ["Lease deed executed", "Security deposit received", "Handover completed"] };
  return [...base, ...(extra[kind] || [])].map((item) => ({ item, done: false }));
}
export function applyCommission(deal, payload, user) {
  const calc = calcCommission(deal.agreed_value || 0, { type: payload.type, value: payload.value }, payload.splits);
  const com = { rule: { type: payload.type, value: payload.value }, payer: payload.payer, agreement_signed: !!payload.agreement_signed, ...calc, set_by: user.name, at: nowIso() };
  deal.commission = com; deal.expected_commission = calc.gross;
  if (com.agreement_signed && deal.checklist?.[0]) deal.checklist[0].done = true;
  deal.history = [...(deal.history || []), { at: nowIso(), by: user.name, event: `Commission set: ${inr(calc.gross)}` }];
  audit(user, "commission_set", "deals", deal.id, { gross: calc.gross, rule: com.rule });
  return com;
}

route("GET", "/deals", ({ user, query: q }) => sortBy(db.deals.filter((d) => notDeleted(d) && inScope(user, "deals")(d) && (!q.stage || d.stage === q.stage)), "created_at", -1).map(({ history, ...rest }) => rest), { perm: ["deals", "r"] }); // eslint-disable-line no-unused-vars
route("POST", "/deals", ({ user, body }) => {
  const p = db.properties.find((x) => x.id === body.property_id && notDeleted(x) && inScope(user, "properties")(x)) || fail(404, "Property not found");
  if (body.lead_id) getScoped("leads", "leads", user, body.lead_id);
  if (String(body.title || "").length < 3 || String(body.buyer_name || "").length < 2) fail(422, "Title and buyer / tenant name are required");
  const d = { ...pick(body, ["title", "deal_type", "property_id", "lead_id", "buyer_name", "buyer_phone", "seller_name", "expected_close", "assigned_to", "notes"]), id: newId(), code: nextCode("deal", "SE-D-"), property_title: p.title, stage: "negotiation", branch_id: p.branch_id,
    offers: [], agreed_value: null, commission: null, expected_commission: 0, checklist: defaultChecklist(body.deal_type), history: [{ at: nowIso(), by: user.name, event: "Deal created" }], created_at: nowIso(), deleted: false };
  if (isScoped(user, "deals") || !d.assigned_to) d.assigned_to = user.id;
  db.deals.push(d);
  audit(user, "deal_created", "deals", d.id);
  return d;
}, { perm: ["deals", "w"] });
route("POST", "/deals/commission-preview", ({ body }) => calcCommission(body.base_value, body.rule, body.splits), { perm: ["deals", "r"] });
route("GET", "/deals/:id", ({ user, params }) => {
  const d = { ...getScoped("deals", "deals", user, params.id) };
  if (can(user, "finance", "r") || can(user, "deals", "w")) d.invoice = one("invoices", (i) => i.deal_id === d.id);
  d.approvals = db.approvals.filter((a) => a.entity_id === d.id);
  return d;
}, { perm: ["deals", "r"] });
route("PATCH", "/deals/:id", ({ user, params, body }) => {
  const d = getScoped("deals", "deals", user, params.id);
  if (["won", "cancelled"].includes(d.stage)) fail(422, "Closed deals cannot be edited");
  const upd = pick(body, ["title", "buyer_name", "buyer_phone", "seller_name", "expected_close", "notes", "checklist", "stage"]);
  if ("stage" in upd && !["negotiation", "agreement", "closing", "disputed"].includes(upd.stage)) fail(422, "Use the close or cancel action for this stage");
  if ("assigned_to" in body && !isScoped(user, "deals")) upd.assigned_to = body.assigned_to;
  Object.assign(d, upd);
  d.history.push({ at: nowIso(), by: user.name, event: `Updated ${Object.keys(upd).join(", ")}` });
  return d;
}, { perm: ["deals", "w"] });
route("POST", "/deals/:id/offers", ({ user, params, body }) => {
  const d = getScoped("deals", "deals", user, params.id);
  if (["won", "cancelled"].includes(d.stage)) fail(422, "Deal is closed");
  if (!(Number(body.amount) > 0)) fail(422, "amount: enter an amount");
  const o = { id: newId(), amount: Number(body.amount), party: body.party, terms: body.terms || null, status: "pending", by: user.name, at: nowIso() };
  d.offers.push(o);
  d.history.push({ at: nowIso(), by: user.name, event: `Offer ${inr(o.amount)} by ${o.party}` });
  if (d.lead_id) addActivity(d.lead_id, "offer", `Offer of ${inr(o.amount)} recorded on ${d.code}`, user);
  return o;
}, { perm: ["deals", "w"] });
route("PATCH", "/deals/:id/offers/:oid", ({ user, params, body }) => {
  const d = getScoped("deals", "deals", user, params.id);
  if (!["accepted", "rejected", "countered"].includes(body.status)) fail(422, "Invalid offer status");
  const o = d.offers.find((x) => x.id === params.oid) || fail(404, "Offer not found");
  if (body.status === "accepted" && d.commission?.agreement_signed) fail(422, "Commission already agreed on a previous value; request a commission change");
  o.status = body.status;
  if (body.status === "accepted") { d.agreed_value = o.amount; d.stage = "agreement"; }
  d.history.push({ at: nowIso(), by: user.name, event: `Offer ${body.status}` });
  if (body.status === "accepted" && d.commission) { const c = d.commission; applyCommission(d, { ...c.rule, payer: c.payer, splits: c.splits, agreement_signed: c.agreement_signed }, user); }
  return { ok: true };
}, { perm: ["deals", "w"] });
route("POST", "/deals/:id/commission", ({ user, params, body }) => {
  const d = getScoped("deals", "deals", user, params.id);
  if (["won", "cancelled"].includes(d.stage)) fail(422, "Commission cannot be changed after closing; use an approved adjustment");
  if (!d.agreed_value) fail(422, "Accept an offer to set the agreed value first");
  const calc = calcCommission(d.agreed_value, { type: body.type, value: body.value }, body.splits);
  const needs = d.commission && (settings().approvals || {}).commission_change !== false;
  if (needs && !can(user, "deals", "a")) {
    const ap = { id: newId(), kind: "commission_change", entity_type: "deal", entity_id: d.id, summary: `${d.code}: commission → ${inr(calc.gross)}`, payload: body, status: "pending", requested_by: user.id, requested_by_name: user.name, reason: body.reason || null, created_at: nowIso() };
    db.approvals.push(ap);
    notifyRoles(["director", "super_admin"], "Approval needed: commission change", ap.summary, "/erp/approvals", `ap:${ap.id}`);
    return { approval_required: true, approval: ap };
  }
  return { approval_required: false, commission: applyCommission(d, body, user) };
}, { perm: ["deals", "w"] });
route("POST", "/deals/:id/close", ({ user, params }) => {
  const d = getScoped("deals", "deals", user, params.id);
  const c = d.commission;
  if (!d.agreed_value) fail(422, "Agreed value is required");
  if (!c) fail(422, "Set the commission before closing");
  if (!c.agreement_signed) fail(422, "A written commission agreement is required before closing");
  if (db.approvals.some((a) => a.entity_id === d.id && a.status === "pending")) fail(422, "Resolve pending approvals before closing");
  if (["won", "cancelled"].includes(d.stage)) fail(409, "Deal is already closed");
  Object.assign(d, { stage: "won", closed_at: nowIso(), final_commission: c.gross, company_net_commission: c.company_net });
  d.history.push({ at: nowIso(), by: user.name, event: "Deal closed (won)" });
  (c.splits || []).forEach((s) => postLedger("commission_payable", "in", s.amount, "deal", d.id, `${s.kind} commission payable to ${s.party} (${d.code})`, user, s.party, null, d.branch_id));
  const p = one("properties", (x) => x.id === d.property_id);
  if (p) Object.assign(p, { status: "closed", closed_as: { sale: "sold", rent: "rented", lease: "leased" }[d.deal_type], updated_at: nowIso() });
  const l = d.lead_id && one("leads", (x) => x.id === d.lead_id);
  if (l) Object.assign(l, { stage: "won", updated_at: nowIso() });
  audit(user, "deal_closed", "deals", d.id, { commission: c.gross });
  notifyRoles(["director", "accountant"], `Deal closed: ${d.code}`, `Commission earned ${inr(c.gross)}`, `/erp/deals/${d.id}`, `won:${d.id}`);
  return { ok: true, final_commission: c.gross };
}, { perm: ["deals", "w"] });
route("POST", "/deals/:id/cancel", ({ user, params, body }) => {
  const d = getScoped("deals", "deals", user, params.id);
  if (["won", "cancelled"].includes(d.stage)) fail(422, "Deal is already closed");
  if (String(body.reason || "").length < 3) fail(422, "reason: at least 3 characters");
  Object.assign(d, { stage: body.status || "cancelled", cancel_reason: body.reason });
  d.history.push({ at: nowIso(), by: user.name, event: `${d.stage}: ${body.reason}` });
  audit(user, `deal_${d.stage}`, "deals", d.id, { reason: body.reason });
  return { ok: true };
}, { perm: ["deals", "w"] });
