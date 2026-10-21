// Agreement generator (backend/agreements.py, routes_agreements.py) for the hosted preview. The templates come from the
// real backend (snapshot meta), and the wording is filled in here exactly as the server does. Word and PDF files are
// made by the live server; the preview shows the stamp-paper layout on screen.
import { route } from "./router";
import {
  META, db, fail, nowIso, todayIST, newId, nextCode, settings, audit, inScope, checkBranch, homeBranch, headOfficeId, amountInWords, pick, rx, sortBy, fileToDataUrl,
} from "./core";

const TEMPLATES = META.agreement_templates || {};
const ENTITY = { lease: "leases", deal: "deals", property: "properties", owner: "owners", investment: "investments", investor: "investors" };
const OWNER_TPL = ["rental_residential", "lease_commercial", "leave_licence", "brokerage_authorisation", "property_management", "shortstay_management", "sale_agreement", "token_receipt"];
const BLANK = "________________";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const empty = (v) => v === null || v === undefined || v === "";
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; };

// ---------------- Rendering (agreements.py) ----------------
function stampFor(t, d) {
  const s = t.stamp || {};
  if (s.kind === "lease") {
    const months = Math.trunc(num(d.term_months || 11)) || 11;
    const rent = num(d.rent || 0) || 0;
    const esc = num(d.escalation_pct || 0) || 0; const every = Math.trunc(num(d.escalation_every_months || 12)) || 12;
    let total = 0;
    for (let m = 0; m < months; m += 1) total += rent * (1 + esc / 100) ** Math.floor(m / every);
    const base = total + (num(d.deposit || 0) || 0) + (num(d.advance_rent || 0) || 0);
    return { basis: Math.round(base * 100) / 100, rate: "1% (Art. 35(a), leases under 30 years)", duty: Math.ceil(base * 0.01),
      note: "Tamil Nadu: 1% of the total rent for the term plus the advance and security deposit (from 3 May 2024). Registration fee is separate. Confirm with the sub-registrar before buying stamp paper." };
  }
  if (s.kind === "sale") {
    if ([true, "yes", "true"].includes(d.possession_on_agreement)) {
      const price = num(d.price || 0) || 0;
      return { basis: price, rate: "7% (agreement with possession is charged like a sale)", duty: Math.ceil(price * 0.07), note: "When possession is handed over under the agreement it is charged like a sale deed. Confirm with your lawyer." };
    }
    return { basis: null, rate: "Agreement (Art. 5)", duty: 200, note: "Agreement for sale without possession. Confirm the current stamp value and whether to register it." };
  }
  return { basis: null, rate: s.rate || "", duty: s.duty ?? null, note: "Confirm the current stamp value with the sub-registrar or your lawyer." };
}
function moneyFull(v) {
  const x = Number(v || 0);
  const [whole, frac] = x.toFixed(2).split(".");
  let w = whole;
  if (whole.length > 3) { let head = whole.slice(0, -3); const parts = []; while (head.length > 2) { parts.unshift(head.slice(-2)); head = head.slice(0, -2); } if (head) parts.unshift(head); w = `${parts.join(",")},${whole.slice(-3)}`; }
  return `Rs. ${w}${frac === "00" ? "" : `.${frac}`}/- (${amountInWords(x)})`;
}
function niceDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
  if (!m) return String(s || "________");
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
function th(n) {
  const x = Math.trunc(num(n));
  if (Number.isNaN(x)) return String(n || "");
  return `${x}${x % 100 >= 11 && x % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[x % 10] || "th"}`;
}
function addMonths(iso, months, minusDay = true) {
  const [y0, m0, d0] = iso.split("-").map(Number);
  const m = m0 - 1 + months;
  const y = y0 + Math.floor(m / 12); const mm = (m % 12) + 1;
  const last = new Date(Date.UTC(y, mm, 0)).getUTCDate();
  const out = new Date(Date.UTC(y, mm - 1, Math.min(d0, last)));
  if (minusDay) out.setUTCDate(out.getUTCDate() - 1);
  return out.toISOString().slice(0, 10);
}
function context(key, data, company) {
  const t = TEMPLATES[key];
  const d = Object.fromEntries(t.fields.map((f) => [f.key, f.default ?? null]));
  Object.entries(data || {}).forEach(([k, v]) => { if (!empty(v)) d[k] = v; });
  const ctx = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, empty(v) ? BLANK : v]));
  const block = (k) => {
    if (k === "company") return `${company.legal_name || company.name || "Sellandiamman Estates"}, having its office at ${company.address || BLANK}, represented by its ${d.company_signatory_designation || "authorised signatory"} ${d.company_signatory || BLANK}`;
    const parts = [String(d[`${k}_name`] || BLANK)];
    if (d[`${k}_relation`]) parts.push(String(d[`${k}_relation`]));
    if (d[`${k}_age`]) parts.push(`aged about ${Math.trunc(num(d[`${k}_age`]))} years`);
    const business = /(ltd|llp|pvt|traders|company|industries|logistics|textiles|enterprises)/.test(String(d[`${k}_name`] || "").toLowerCase());
    parts.push(`${business ? "having its office at" : "residing at"} ${d[`${k}_address`] || BLANK}`);
    if (d[`${k}_id`]) parts.push(`(ID ending ${String(d[`${k}_id`]).slice(-4)})`);
    return parts.join(", ");
  };
  t.parties.forEach(([k]) => { ctx[`${k}_block`] = block(k); });
  t.fields.forEach((f) => {
    if (f.type === "money") ctx[`${f.key}_full`] = !empty(d[f.key]) ? moneyFull(d[f.key]) : BLANK;
    if (f.type === "date") ctx[f.key] = d[f.key] ? niceDate(d[f.key]) : BLANK;
  });
  ["due_day", "statement_day"].forEach((k) => { if (k in d) ctx[`${k}_th`] = th(d[k]); });
  ctx.end_date = d.start_date && d.term_months && /^\d{4}-\d{2}-\d{2}/.test(String(d.start_date)) && !Number.isNaN(num(d.term_months)) ? niceDate(addMonths(String(d.start_date).slice(0, 10), Math.trunc(num(d.term_months)))) : BLANK;
  ctx.balance_full = d.price && d.advance ? moneyFull(num(d.price) - num(d.advance)) : BLANK;
  if (d.execution_date && d.completion_days && /^\d{4}-\d{2}-\d{2}/.test(String(d.execution_date))) {
    const x = new Date(`${String(d.execution_date).slice(0, 10)}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + Math.trunc(num(d.completion_days)));
    ctx.completion_date = niceDate(x.toISOString().slice(0, 10));
  } else ctx.completion_date = BLANK;
  const lockRaw = String(d.lock_in_months ?? "0");
  const lock = /^[\d.]+$/.test(lockRaw.replace(".", "")) ? Math.trunc(num(lockRaw) || 0) : 0;
  ctx.lock_in_text = lock ? `Neither party shall end this tenancy during the first ${lock} months. ` : "";
  ctx.possession_text = d.possession_on_agreement === "yes" ? " (possession has been handed over today on this agreement)" : "";
  ctx.survey_line = d.survey_no ? `Survey / door no.: ${d.survey_no}\n` : "";
  ctx.boundaries_line = d.boundaries ? `Boundaries: ${d.boundaries}\n` : "";
  ctx.fittings_line = d.fittings ? `Fittings provided: ${d.fittings}\n` : "";
  ctx.expected_price_full = d.expected_price ? moneyFull(d.expected_price) : "the price agreed with the Owner";
  ctx.owner_bank = d.owner_bank || "as notified by the Owner in writing";
  return [ctx, d];
}
const fill = (text, ctx) => String(text).replace(/\{(\w+)\}/g, (_, k) => (k in ctx ? String(ctx[k]) : BLANK));

export function renderBlocks(key, data, company, clauses = null, extra = null) {
  const t = TEMPLATES[key];
  const [ctx, d] = context(key, data, company);
  const blocks = [{ t: "title", text: t.title }];
  if (t.subtitle) blocks.push({ t: "subtitle", text: t.subtitle });
  t.recitals.forEach((r) => { const txt = fill(r, ctx); blocks.push({ t: ["AND", "BETWEEN:"].includes(txt.trim()) ? "center" : "para", text: txt }); });
  const body = [...(clauses != null ? clauses : t.clauses.map((c) => fill(c, ctx))).filter((c) => String(c).trim()), ...(extra || []).filter((c) => String(c).trim()).map((c) => fill(c, ctx))];
  body.forEach((c, i) => blocks.push({ t: "clause", n: i + 1, text: c }));
  if (t.schedule) {
    const sched = fill(t.schedule, ctx).split("\n").filter((ln) => ln.trim());
    blocks.push({ t: "heading", text: sched[0] });
    sched.slice(1).forEach((ln) => blocks.push({ t: "para", text: ln }));
  }
  blocks.push({ t: "para", text: "IN WITNESS WHEREOF the parties have signed this document on the day, month and year first written above, of their own free will and in the presence of the witnesses below." });
  blocks.push({ t: "signatures", parties: t.parties.map(([k, lab]) => ({ label: lab, name: (k === "company" ? company.legal_name || company.name : d[`${k}_name`]) || "", sub: k === "company" ? `by ${d.company_signatory || ""} (${d.company_signatory_designation || ""})` : "" })) });
  blocks.push({ t: "witnesses" });
  return [blocks, ctx, d];
}
const defaultClauses = (key, data, company) => { const [ctx] = context(key, data, company); return TEMPLATES[key].clauses.map((c) => fill(c, ctx)); };
const titleCase = (s) => String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// ---------------- Prefill from a record ----------------
const monthsBetween = (a, b) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a || "") || !/^\d{4}-\d{2}-\d{2}$/.test(b || "")) return null;
  const [y1, m1, d1] = a.split("-").map(Number); const [y2, m2, d2] = b.split("-").map(Number);
  return Math.max(1, (y2 - y1) * 12 + m2 - m1 + (d2 >= d1 ? 1 : 0));
};
function propText(p) {
  const bits = [p.title];
  if (p.built_area) bits.push(`built-up area about ${Math.round(p.built_area).toLocaleString("en-US")} ${p.area_unit || "sq.ft"}`);
  if (p.plot_area) bits.push(`${`plot / land area about ${Number(p.plot_area).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.replace(/0+$/, "").replace(/\.$/, "")} ${p.area_unit || ""}`);
  if (p.furnishing) bits.push(p.furnishing.replace(/_/g, " "));
  return bits.filter(Boolean).join(", ");
}
const ownerParty = (prefix, o) => { if (!o) return {}; const c = o.customer_id ? db.customers.find((x) => x.id === o.customer_id) : null; return { [`${prefix}_name`]: o.name, [`${prefix}_address`]: o.address || c?.address }; };

function prefill(template, etype, eid, user) {
  const s = settings();
  const director = db.users.find((u) => u.role === "director" && u.active);
  const out = { execution_date: todayIST(), execution_place: "Erode", company_signatory: s.agreement_signatory || director?.name || "", company_signatory_designation: s.agreement_signatory_designation || "Director" };
  let branch = null;
  if (etype && eid) {
    const coll = ENTITY[etype] || fail(422, "Unknown record type");
    const rec = db[coll].find((x) => x.id === eid) || fail(404, "Record not found");
    if (["lease", "deal", "property"].includes(etype) && !inScope(user, { lease: "leases", deal: "deals", property: "properties" }[etype])(rec)) fail(404, "Record not found");
    const prop = etype === "property" ? rec : rec.property_id ? db.properties.find((x) => x.id === rec.property_id) : null;
    if (prop) {
      branch = prop.branch_id || null;
      Object.assign(out, { property_address: prop.internal_address || `${prop.locality}, ${prop.city} ${prop.pincode || ""}`.trim(), property_description: propText(prop), survey_no: prop.survey_no,
        execution_place: prop.city || out.execution_place, mgmt_fee_pct: prop.mgmt_fee_pct || null, expected_price: prop.price, power: prop.power_supply });
      const owner = prop.owner_id ? db.owners.find((o) => o.id === prop.owner_id) : null;
      const k = ["rental_residential", "lease_commercial", "leave_licence"].includes(template) ? "lessor" : ["sale_agreement", "token_receipt"].includes(template) ? "seller" : "owner";
      Object.assign(out, ownerParty(k, owner));
    }
    if (etype === "owner") Object.assign(out, ownerParty("owner", rec));
    if (etype === "lease") {
      const c = rec.customer_id ? db.customers.find((x) => x.id === rec.customer_id) : null;
      Object.assign(out, { lessee_name: rec.tenant_name, lessee_address: c?.address, rent: rec.rent, deposit: rec.deposit, start_date: rec.start_date, term_months: monthsBetween(rec.start_date, rec.end_date),
        due_day: rec.due_day, escalation_pct: rec.escalation_pct, escalation_every_months: rec.escalation_every_months });
    }
    if (etype === "deal") Object.assign(out, { buyer_name: rec.buyer_name, price: rec.agreed_value, lessee_name: rec.buyer_name, rent: rec.deal_type !== "sale" ? rec.agreed_value : null });
    if (etype === "investment" || etype === "investor") {
      const inv = etype === "investor" ? rec : db.investors.find((x) => x.id === rec.investor_id);
      const c = inv?.customer_id ? db.customers.find((x) => x.id === inv.customer_id) : null;
      Object.assign(out, { investor_name: inv?.name, investor_address: c?.address, investor_id: inv?.pan_last4 });
      if (etype === "investment") {
        const p = db.inv_projects.find((x) => x.id === rec.project_id);
        branch = p?.branch_id || null;
        Object.assign(out, { project_name: p?.name, project_location: p ? [p.locality, p.city].filter(Boolean).join(", ") : null, project_description: p ? String(p.description || "").slice(0, 300) : null,
          amount: rec.amount, investment_date: rec.date, reference: rec.reference, horizon_months: p?.horizon_months });
      }
    }
  }
  return [Object.fromEntries(Object.entries(out).filter(([, v]) => !empty(v))), branch];
}

// ---------------- Routes ----------------
function check(b) {
  if (!TEMPLATES[b.template]) fail(422, "Unknown template");
  if (b.clauses != null && (b.clauses.length > 80 || b.clauses.some((c) => String(c).length > 4000))) fail(422, "Too many or too long clauses");
  Object.entries(b.data || {}).forEach(([k, v]) => { if (typeof v === "string" && v.length > 2000) fail(422, `${k} is too long`); });
  if (b.paper && !["legal", "a4"].includes(b.paper)) fail(422, "Invalid paper size");
  if (b.stamp_top_mm != null && !(Number(b.stamp_top_mm) >= 0 && Number(b.stamp_top_mm) <= 180)) fail(422, "Blank space must be between 0 and 180 mm");
}
export function stampLine(a) {
  if (!a.estamp_no) return null;
  const amt = a.stamp_value ? `Rs. ${Math.round(a.stamp_value).toLocaleString("en-US")}` : "the stamp duty";
  return `Stamp duty of ${amt} paid vide e-Stamp certificate No. ${a.estamp_no}${a.estamp_date ? ` dated ${niceDate(a.estamp_date)}` : ""}.`;
}
const FIELDS = ["template", "title", "entity_type", "entity_id", "data", "clauses", "extra_clauses", "paper", "stamp_top_mm", "stamp_value", "estamp_no", "estamp_date"];
const fy = (d) => { const y = Number(d.slice(5, 7)) >= 4 ? Number(d.slice(0, 4)) : Number(d.slice(0, 4)) - 1; return `${y}-${String((y + 1) % 100).padStart(2, "0")}`; };
export const agreementFor = (user, id) => db.agreements.find((a) => a.id === id && a.deleted !== true && inScope(user, "agreements")(a)) || fail(404, "Agreement not found");

route("GET", "/agreements/templates", () => Object.entries(TEMPLATES).map(([key, t]) => ({ key, title: titleCase(t.title), subtitle: t.subtitle, group: t.group, summary: t.summary, parties: t.parties.map((p) => p[1]), sources: t.sources, fields: t.fields })), { perm: ["agreements", "r"] });
route("GET", "/agreements/prefill", ({ user, query: q }) => {
  if (!TEMPLATES[q.template]) fail(422, "Unknown template");
  const [data] = prefill(q.template, q.entity_type, q.entity_id, user);
  return { data, clauses: defaultClauses(q.template, data, settings()) };
}, { perm: ["agreements", "w"] });
route("POST", "/agreements/preview", ({ body: b }) => {
  check(b);
  const [blocks, , d] = renderBlocks(b.template, b.data || {}, settings(), b.clauses ?? null, b.extra_clauses || []);
  return { blocks, stamp: stampFor(TEMPLATES[b.template], d), default_clauses: defaultClauses(b.template, b.data || {}, settings()), stamp_line: stampLine(b) };
}, { perm: ["agreements", "r"] });
route("GET", "/agreements", ({ user, query: q }) => {
  let rows = db.agreements.filter((a) => a.deleted !== true && inScope(user, "agreements")(a));
  if (q.entity_type && q.entity_id) rows = rows.filter((a) => a.entity_type === q.entity_type && a.entity_id === q.entity_id);
  if (q.status) rows = rows.filter((a) => a.status === q.status);
  if (q.q) { const r = rx(q.q); rows = rows.filter((a) => [a.title, a.code, a.party_names].some((x) => r.test(x || ""))); }
  return sortBy(rows, "created_at", -1).map(({ data, clauses, extra_clauses, ...a }) => a); // eslint-disable-line no-unused-vars
}, { perm: ["agreements", "r"] });

function createAgreement(b, user) {
  check(b);
  let branch = null;
  if (b.entity_type && b.entity_id) [, branch] = prefill(b.template, b.entity_type, b.entity_id, user);
  branch = branch || homeBranch(user) || headOfficeId();
  checkBranch(user, branch);
  const t = TEMPLATES[b.template];
  const [, , d] = renderBlocks(b.template, b.data || {}, settings(), b.clauses ?? null, b.extra_clauses || []);
  const names = t.parties.map(([k]) => d[`${k}_name`]).filter(Boolean);
  const today = todayIST();
  const a = { id: newId(), code: nextCode(`ag-${fy(today)}`, `AG/${fy(today)}/`, 4), template: b.template, entity_type: b.entity_type || null, entity_id: b.entity_id || null, data: b.data || {},
    clauses: b.clauses ?? null, extra_clauses: b.extra_clauses || [], paper: b.paper || "legal", stamp_top_mm: b.stamp_top_mm ?? 100, stamp_value: b.stamp_value ?? null, estamp_no: b.estamp_no || null, estamp_date: b.estamp_date || null,
    title: b.title || `${titleCase(t.title)} – ${names.join(" & ") || "draft"}`, party_names: names.join(" "), status: "draft", version: 1, branch_id: branch, stamp_estimate: stampFor(t, d),
    created_by: user.id, created_by_name: user.name, created_at: nowIso(), updated_at: nowIso(), deleted: false };
  db.agreements.push(a);
  audit(user, "agreement_created", "agreements", a.id, { template: b.template, entity: `${b.entity_type}:${b.entity_id}` });
  return a;
}
route("POST", "/agreements", ({ user, body }) => createAgreement(body, user), { perm: ["agreements", "w"] });
export const agreementBlocks = (a) => renderBlocks(a.template, a.data || {}, settings(), a.clauses ?? null, a.extra_clauses || [])[0];
route("GET", "/agreements/:id", ({ user, params }) => {
  const a = agreementFor(user, params.id);
  return { ...a, blocks: agreementBlocks(a), documents: sortBy(db.documents.filter((d) => d.entity_type === "agreement" && d.entity_id === a.id), "created_at", -1).slice(0, 20).map(({ demo_url, ...d }) => d) }; // eslint-disable-line no-unused-vars
}, { perm: ["agreements", "r"] });
route("PATCH", "/agreements/:id", ({ user, params, body }) => {
  const a = agreementFor(user, params.id);
  if (a.status !== "draft") fail(422, "Final agreements cannot be edited. Make a copy to change it.");
  const allowed = ["title", "data", "clauses", "extra_clauses", "paper", "stamp_top_mm", "stamp_value", "estamp_no", "estamp_date"];
  const merged = { ...a, ...pick(body, allowed) };
  check(merged);
  const t = TEMPLATES[a.template];
  const [, , d] = renderBlocks(a.template, merged.data || {}, settings(), merged.clauses ?? null, merged.extra_clauses || []);
  Object.assign(a, pick(merged, Object.keys(body).filter((k) => allowed.includes(k))), { version: a.version + 1, updated_at: nowIso(), stamp_estimate: stampFor(t, d), party_names: t.parties.map(([k]) => d[`${k}_name`] || "").join(" ").trim() });
  return a;
}, { perm: ["agreements", "w"] });
route("POST", "/agreements/:id/copy", ({ user, params }) => {
  const a = agreementFor(user, params.id);
  return createAgreement({ ...pick(a, FIELDS), title: `${a.title} (copy)` }, user);
}, { perm: ["agreements", "w"] });

const fname = (a, ext) => `${`${a.code}-${a.title}`.replace(/[^\w.-]+/g, "-").slice(0, 90).replace(/^-+|-+$/g, "")}.${ext}`;
route("POST", "/agreements/:id/finalise", ({ user, params, body }) => {
  const a = agreementFor(user, params.id);
  if (a.status !== "draft") fail(409, "Already final");
  const share = !!body.share;
  const d = { id: newId(), size: 0, content_type: "application/pdf", original_name: fname(a, "pdf"), entity_type: "agreement", entity_id: a.id, doc_type: "agreement", expiry_date: null, notes: a.code, version: 1, is_latest: true,
    previous_id: null, public_approved: false, share_with_owner: false, share_with_investor: false, uploaded_by: user.id, uploaded_by_name: user.name, created_at: nowIso(), agreement_id: a.id };
  db.documents.push(d);
  // a copy on the linked record so it shows with the property / owner / investor files and in their portal
  let et = a.entity_type; let eid = a.entity_id;
  if (["lease", "deal"].includes(et)) { et = "property"; eid = db[ENTITY[a.entity_type]].find((x) => x.id === a.entity_id)?.property_id; } else if (et === "investment") { et = "investor"; eid = db.investments.find((x) => x.id === a.entity_id)?.investor_id; }
  if (eid && ["property", "owner", "investor"].includes(et)) db.documents.push({ ...d, id: newId(), entity_type: et, entity_id: eid, share_with_owner: share && OWNER_TPL.includes(a.template) && ["property", "owner"].includes(et), share_with_investor: share && a.template === "investor_coinvestment" && et === "investor" });
  // a rental or lease agreement also sits on the lease, where the tenant sees it once shared
  if (a.entity_type === "lease" && a.entity_id) db.documents.push({ ...d, id: newId(), entity_type: "lease", entity_id: a.entity_id, share_with_owner: false, share_with_investor: false, share_with_tenant: share && OWNER_TPL.includes(a.template) });
  Object.assign(a, { status: "final", finalised_at: nowIso(), finalised_by: user.name });
  audit(user, "agreement_finalised", "agreements", a.id, { shared: share });
  return { ok: true };
}, { perm: ["agreements", "w"] });
route("POST", "/agreements/:id/signed", async ({ user, params, files }) => {
  const a = agreementFor(user, params.id);
  if (a.status === "draft") fail(422, "Finalise the agreement before uploading the signed copy");
  const f = files.file?.[0] || fail(422, "Choose a file");
  if (!["application/pdf", "image/jpeg", "image/png"].includes(f.type)) fail(422, `File type not allowed: ${f.type || "unknown"}`);
  const d = { id: newId(), demo_url: f.size < 4e6 ? await fileToDataUrl(f) : null, size: f.size, content_type: f.type, original_name: f.name, entity_type: "agreement", entity_id: a.id, doc_type: "signed_agreement",
    expiry_date: null, notes: a.code, version: 1, is_latest: true, previous_id: null, public_approved: false, uploaded_by: user.id, uploaded_by_name: user.name, created_at: nowIso() };
  db.documents.push(d);
  Object.assign(a, { status: "signed", signed_at: nowIso() });
  audit(user, "agreement_signed_uploaded", "agreements", a.id);
  const { demo_url, ...out } = d; // eslint-disable-line no-unused-vars
  return out;
}, { perm: ["agreements", "w"] });
route("DELETE", "/agreements/:id", ({ user, params }) => {
  const a = agreementFor(user, params.id);
  if (a.status !== "draft") fail(422, "Only drafts can be deleted");
  a.deleted = true;
  audit(user, "agreement_deleted", "agreements", a.id);
  return { ok: true };
}, { perm: ["agreements", "w"] });
