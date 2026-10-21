// Sign-in, users, public website, Insights and owner portal (backend/routes_auth.py, routes_public.py,
// routes_content.py, routes_portal.py), for the hosted preview.
import { route } from "./router";
import {
  db, state, META, DEMO_PASSWORD, fail, nowIso, todayIST, newId, r2, notDeleted, one, where, sortBy, pick, omit, rx, nextCode, inr,
  normalizePhone, settings, ROLES, can, publicUser, audit, notify, notifyRoles, mfaRequiredFor, calcOwnerStatement, fileToDataUrl,
  PORTAL_ROLES, branchForPlace, ensurePlace, geoFields, linkCustomer, eqi, publishDue, livePost,
} from "./core";
import { publishedSite } from "./routes_places";
import { createLead, addActivity } from "./routes_sales";

// ---------------- Auth ----------------
const passOk = (u, pw) => pw === (u.demo_password || DEMO_PASSWORD);
const startSession = (u) => {
  state.userId = u.id; state.sid = newId();
  u.last_login = nowIso();
  audit(u, "login", "auth", u.id, { mfa: !!u.mfa_enabled });
  return publicUser(u);
};

route("POST", "/auth/login", ({ body }) => {
  const email = String(body.email || "").trim().toLowerCase();
  const u = db.users.find((x) => x.email === email);
  if (!u || !passOk(u, body.password)) fail(401, "Invalid email or password");
  if (!u.active) fail(403, "This account is not active");
  if (u.mfa_enabled) return { mfa_required: true, mfa_token: `demo-mfa-${u.id}` };
  return startSession(u);
});

const codeOk = (u, code) => {
  const c = String(code || "").replace(/\s/g, "");
  if (/^\d{6}$/.test(c) && c !== "000000") return true;
  const rec = state.recovery[u.id] || [];
  const i = rec.indexOf(c.toUpperCase());
  if (i >= 0) { rec.splice(i, 1); return true; }
  return false;
};
route("POST", "/auth/mfa/login", ({ body }) => {
  const id = String(body.mfa_token || "").replace("demo-mfa-", "");
  const u = db.users.find((x) => x.id === id && x.active);
  if (!u) fail(401, "Your sign-in step expired. Please sign in again.");
  if (!codeOk(u, body.code)) fail(401, "That code is not correct. Check the time on your phone and try again.");
  return startSession(u);
});
route("POST", "/auth/logout", ({ user }) => { audit(user, "logout", "auth", user.id); state.userId = null; return { ok: true }; }, { auth: "any" });
route("GET", "/auth/me", ({ user }) => publicUser(user), { auth: "any" });
route("GET", "/auth/session", () => { const u = state.userId && db.users.find((x) => x.id === state.userId && x.active); return { user: u ? publicUser(u) : null }; });
route("POST", "/auth/mfa/setup", ({ user }) => {
  if (user.mfa_enabled) fail(409, "2-step sign-in is already on. Turn it off first to set up a new phone.");
  return { secret: META.mfa_demo.secret, otpauth_uri: META.mfa_demo.otpauth_uri, qr_svg: META.mfa_demo.qr_svg };
}, { auth: "any" });
route("POST", "/auth/mfa/enable", ({ user, body }) => {
  if (!/^\d{6}$/.test(String(body.code || "")) || body.code === "000000") fail(422, "That code is not correct. Enter the 6-digit code shown in your authenticator app.");
  const hex = () => Math.floor(Math.random() * 65536).toString(16).toUpperCase().padStart(4, "0");
  const codes = Array.from({ length: 8 }, () => `${hex()}-${hex()}`);
  state.recovery[user.id] = codes.map((c) => c.replace("-", ""));
  Object.assign(user, { mfa_enabled: true, mfa_enabled_at: nowIso() });
  audit(user, "mfa_enabled", "auth", user.id);
  return { ok: true, recovery_codes: codes };
}, { auth: "any" });
route("POST", "/auth/mfa/disable", ({ user, body }) => {
  if (mfaRequiredFor(user)) fail(422, "2-step sign-in is required for your role and cannot be turned off.");
  if (!passOk(user, body.password)) fail(400, "Password is incorrect");
  if (!codeOk(user, body.code)) fail(400, "That code is not correct");
  user.mfa_enabled = false;
  audit(user, "mfa_disabled", "auth", user.id);
  return { ok: true };
}, { auth: "any" });

const resetLink = (u, purpose) => {
  const token = newId().replace(/-/g, "");
  state.resetTokens[token] = { userId: u.id, purpose };
  return `${window.location.origin}${window.location.pathname}#/erp/reset-password?token=${token}`;
};
route("POST", "/auth/forgot-password", () => ({ ok: true, message: "If the account exists, a reset link has been sent." }));
route("POST", "/auth/reset-password", ({ body }) => {
  const t = state.resetTokens[body.token];
  if (!t) fail(400, "This link is invalid or has expired");
  const u = db.users.find((x) => x.id === t.userId);
  u.demo_password = body.password;
  if (t.purpose === "activation") u.active = true;
  delete state.resetTokens[body.token];
  return { ok: true };
});
route("POST", "/auth/change-password", ({ user, body }) => {
  if (!passOk(user, body.current_password)) fail(400, "Current password is incorrect");
  if (String(body.new_password || "").length < 8) fail(422, "new_password: String should have at least 8 characters");
  user.demo_password = body.new_password;
  audit(user, "password_changed", "users", user.id);
  return { ok: true };
}, { auth: "any" });
route("GET", "/auth/sessions", ({ user }) => [{ current: true, created_at: user.last_login || nowIso(), ip: "This browser", user_agent: navigator.userAgent.slice(0, 120), mfa: !!user.mfa_enabled }], { auth: "any" });

// ---------------- Users ----------------
const safeUser = (u) => omit(u, ["demo_password", "photo"]);
route("GET", "/roles", () => Object.entries(ROLES).map(([key, label]) => ({ key, label })), { auth: "staff" });
route("GET", "/users/lite", () => db.users.filter((u) => u.active && !PORTAL_ROLES.includes(u.role)).map((u) => pick(u, ["id", "name", "role", "branch_ids", "designation"])), { auth: "staff" });
route("GET", "/users", () => sortBy(db.users, "created_at").map(safeUser), { perm: ["users", "r"] });
const checkGrant = (actor, role) => {
  if (!ROLES[role]) fail(422, "Unknown role");
  if (role === "super_admin" && actor.role !== "super_admin") fail(403, "Only a Super Administrator can grant this role");
};
function checkBranches(ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (list.some((id) => !db.branches.some((b) => b.id === id))) fail(422, "Unknown branch");
  return list;
}
function checkManager(uid, reportsTo) {
  if (!reportsTo) return null;
  const seen = new Set([uid]);
  let cur = reportsTo;
  while (cur) {
    if (seen.has(cur)) fail(422, "That reporting line would make a loop");
    seen.add(cur);
    const m = db.users.find((u) => u.id === cur);
    if (!m || PORTAL_ROLES.includes(m.role)) fail(422, "Choose a staff member as the manager");
    cur = m.reports_to;
  }
  return reportsTo;
}
export function createUser(body, actor) {
  checkGrant(actor, body.role);
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(422, "email: enter a valid email address");
  if (String(body.name || "").trim().length < 2) fail(422, "name: at least 2 characters");
  if (db.users.some((u) => u.email === email)) fail(409, "A user with this email already exists");
  if (body.password && body.password.length < 8) fail(422, "password: at least 8 characters");
  if (body.role === "owner" && !one("owners", (o) => o.id === body.owner_id && notDeleted(o))) fail(422, "Choose the owner record this portal account belongs to");
  if (body.role === "investor" && !one("investors", (o) => o.id === body.investor_id && notDeleted(o))) fail(422, "Choose the investor record this portal account belongs to");
  const portal = PORTAL_ROLES.includes(body.role);
  const uid = newId();
  const u = { id: uid, email, name: body.name.trim(), role: body.role, phone: body.phone || null, branch_ids: portal ? [] : checkBranches(body.branch_ids), active: !!body.password,
    created_at: nowIso(), owner_id: body.role === "owner" ? body.owner_id : null, investor_id: body.role === "investor" ? body.investor_id : null, demo_password: body.password || undefined };
  if (!portal) Object.assign(u, { designation: body.designation || null, department: body.department || null, whatsapp: body.whatsapp || null, joined_on: body.joined_on || null,
    reports_to: checkManager(uid, body.reports_to), show_in_directory: true });
  db.users.push(u);
  const link = body.password ? null : resetLink(u, "activation");
  audit(actor, "user_created", "users", u.id, { role: body.role });
  return { ...publicUser(u), activation_link: link, email_status: link ? "dev_logged" : null };
}
route("POST", "/users", ({ user, body }) => createUser(body, user), { perm: ["users", "w"] });
route("PATCH", "/users/:id", ({ user, body, params }) => {
  const t = one("users", (u) => u.id === params.id);
  if (!t) fail(404, "User not found");
  const upd = Object.fromEntries(Object.entries(pick(body, ["name", "role", "phone", "branch_ids", "active", "designation", "department", "reports_to", "whatsapp", "show_in_directory", "joined_on"]))
    .filter(([k, v]) => v != null || ["reports_to", "designation", "department", "whatsapp"].includes(k)));
  if ("role" in upd) { checkGrant(user, upd.role); if ((PORTAL_ROLES.includes(upd.role) || PORTAL_ROLES.includes(t.role)) && upd.role !== t.role) fail(422, "Portal accounts and staff accounts cannot be converted into each other"); }
  if ("branch_ids" in upd) upd.branch_ids = checkBranches(upd.branch_ids);
  if ("reports_to" in upd) upd.reports_to = checkManager(t.id, upd.reports_to);
  if (t.role === "super_admin" && user.role !== "super_admin") fail(403, "Cannot modify a Super Administrator");
  if (t.id === user.id && (upd.active === false || ("role" in upd && upd.role !== user.role))) fail(400, "You cannot deactivate or change the role of your own account");
  Object.assign(t, upd);
  audit(user, "user_updated", "users", t.id, upd);
  return publicUser(t);
}, { perm: ["users", "w"] });
route("POST", "/users/:id/revoke-sessions", ({ user, params }) => { audit(user, "sessions_revoked", "users", params.id); return { revoked: 1 }; }, { perm: ["users", "w"] });
route("POST", "/users/:id/mfa-reset", ({ user, params }) => {
  const t = one("users", (u) => u.id === params.id) || fail(404, "User not found");
  if (t.role === "super_admin" && user.role !== "super_admin") fail(403, "Cannot modify a Super Administrator");
  t.mfa_enabled = false;
  audit(user, "mfa_reset", "users", t.id);
  return { ok: true };
}, { perm: ["users", "w"] });
route("POST", "/users/:id/reset-link", ({ user, params }) => {
  const t = one("users", (u) => u.id === params.id) || fail(404, "User not found");
  audit(user, "reset_link_issued", "users", t.id);
  return { link: resetLink(t, t.active ? "reset" : "activation"), email_status: "dev_logged" };
}, { perm: ["users", "w"] });

// ---------------- Public website ----------------
const PUBLIC_FIELDS = ["listing_id", "title", "description_public", "category", "transaction", "city", "locality", "pincode", "public_lat", "public_lng", "price", "price_unit", "price_on_request", "plot_area", "built_area", "area_unit", "bedrooms", "bathrooms", "furnishing", "amenities", "availability", "occupancy", "images", "featured", "published_at", "power_supply", "loading_access", "parking", "video_url", "max_guests", "status"];
const PUBLIC_SETTINGS = ["name", "phone", "whatsapp", "email", "address", "cities", "localities", "logo", "demo_mode", "hero_title", "hero_subtitle", "seo_title", "seo_description", "testimonials", "office_hours", "social", "rera_no", "announcement", "map_center"];
const live = (p) => ["published", "under_offer"].includes(p.status) && notDeleted(p);
export const publicView = (p) => ({ ...pick(p, PUBLIC_FIELDS), status: p.status === "under_offer" ? "Under offer" : "Available" });

route("GET", "/public/settings", () => {
  const site = publishedSite();
  return { ...pick(settings(), PUBLIC_SETTINGS), turnstile_site_key: null, site_url: null, announcement: site.announcement, testimonials: site.testimonials,
    hero_title: site.hero.title, hero_subtitle: site.hero.subtitle, seo_title: site.seo.title, seo_description: site.seo.description, footer_tagline: site.footer_tagline };
});
route("GET", "/public/properties", ({ query: q }) => {
  let rows = db.properties.filter(live);
  if (q.ids) { const ids = q.ids.split(",").map((s) => s.trim()); rows = rows.filter((p) => ids.includes(p.listing_id)); }
  if (q.transaction) rows = rows.filter((p) => p.transaction === q.transaction);
  if (q.category) { const cs = q.category.split(","); rows = rows.filter((p) => cs.includes(p.category)); }
  if (q.city) rows = rows.filter((p) => p.city === q.city);
  if (q.locality) rows = rows.filter((p) => rx(q.locality).test(p.locality || ""));
  if (q.pincode) rows = rows.filter((p) => p.pincode === q.pincode.slice(0, 6));
  if (q.min_price) rows = rows.filter((p) => p.price != null && p.price >= Number(q.min_price));
  if (q.max_price) rows = rows.filter((p) => p.price != null && p.price <= Number(q.max_price));
  if (q.bedrooms) rows = rows.filter((p) => (p.bedrooms || 0) >= Number(q.bedrooms));
  if (q.bathrooms) rows = rows.filter((p) => (p.bathrooms || 0) >= Number(q.bathrooms));
  if (q.min_area || q.max_area) rows = rows.filter((p) => [p.built_area, p.plot_area].some((a) => a != null && (!q.min_area || a >= Number(q.min_area)) && (!q.max_area || a <= Number(q.max_area))));
  if (q.furnishing) rows = rows.filter((p) => p.furnishing === q.furnishing);
  if (q.feature) rows = rows.filter((p) => (p.amenities || []).includes(q.feature));
  if (q.featured != null) rows = rows.filter((p) => !!p.featured === (String(q.featured) === "true"));
  if (q.q) { const r = rx(q.q); rows = rows.filter((p) => [p.title, p.locality, p.city, p.listing_id].some((x) => r.test(x || ""))); }
  const sort = { price_asc: (a, b) => (a.price ?? 0) - (b.price ?? 0), price_desc: (a, b) => (b.price ?? 0) - (a.price ?? 0), area_desc: (a, b) => (b.built_area || b.plot_area || 0) - (a.built_area || a.plot_area || 0) }[q.sort] || ((a, b) => (b.published_at || "").localeCompare(a.published_at || ""));
  rows = [...rows].sort(sort);
  const limit = Math.max(1, Math.min(Number(q.limit || 12), 200)); const page = Math.max(1, Number(q.page || 1));
  return { items: rows.slice((page - 1) * limit, page * limit).map(publicView), total: rows.length, page, limit };
});
route("GET", "/public/properties/:lid", ({ params }) => {
  const p = db.properties.find((x) => live(x) && x.listing_id === params.lid) || fail(404, "Listing not found");
  const similar = db.properties.filter((x) => live(x) && x.listing_id !== p.listing_id && x.transaction === p.transaction && (x.category === p.category || x.city === p.city)).slice(0, 3);
  return { property: publicView(p), similar: similar.map(publicView) };
});
route("GET", "/public/localities", () => [...new Map(db.properties.filter(live).map((p) => [`${p.city}|${p.locality}`, { city: p.city, locality: p.locality }])).values()]);

const SLOT_TIME = { morning: "10:00", afternoon: "14:00", evening: "17:00" };
route("POST", "/public/enquiry", ({ body: b }) => {
  if (b.website) return { ok: true, reference: "received" };
  if (String(b.name || "").trim().length < 2) fail(422, "name: at least 2 characters");
  if (!b.consent) fail(422, "Please accept the privacy policy to continue");
  const phone = normalizePhone(b.phone);
  const prop = b.listing_id ? db.properties.find((p) => live(p) && p.listing_id === b.listing_id) : null;
  const kind = b.kind || "enquiry";
  if (kind === "visit") {
    if (!prop) fail(422, "Choose a listing to visit");
    if (!b.preferred_date) fail(422, "Choose a preferred date for the visit");
    if (b.preferred_date < todayIST()) fail(422, "Choose a date from today onwards");
  }
  const camp = b.utm_campaign ? one("campaigns", (c) => c.code === b.utm_campaign) : null;
  let note = b.message ? `[${kind}] ${b.message}` : `Website ${kind}`;
  if (b.preferred_time) note += ` | Preferred time: ${b.preferred_time}`;
  if (kind === "visit") note += ` | Visit requested for ${b.preferred_date} (${b.preferred_slot || "any time"})`;
  if (kind === "requirement") { const bits = [b.category, b.preferred_locations, b.budget_max ? `budget up to ${inr(b.budget_max)}` : null].filter(Boolean); if (bits.length) note += ` | ${bits.join(", ")}`; }
  const interest = b.interest || "buy";
  const [lead, dup] = createLead({ name: b.name.trim(), phone, email: b.email, source: "website", interest, customer_type: { sell: "seller", management: "landlord" }[interest] || "buyer",
    property_id: prop?.id || null, branch_id: prop?.branch_id || null, assigned_to: prop?.assigned_agent || null, requirements: [b.category, b.message].filter(Boolean).join(" ") || null,
    budget_max: b.budget_max || null, preferred_locations: b.preferred_locations || null, preferred_contact: b.preferred_contact, marketing_consent: b.marketing_consent,
    utm_source: b.utm_source, campaign_id: camp?.id || null }, null, note);
  if (dup && (b.budget_max || b.preferred_locations)) Object.assign(lead, pick({ budget_max: b.budget_max || undefined, preferred_locations: b.preferred_locations || undefined }, ["budget_max", "preferred_locations"]));
  if (kind === "visit") {
    const when = `${b.preferred_date}T${SLOT_TIME[b.preferred_slot] || "11:00"}`;
    const v = { id: newId(), lead_id: lead.id, lead_name: lead.name, property_id: prop.id, property_title: prop.title, property_code: prop.code, scheduled_at: when, preferred_slot: b.preferred_slot,
      status: "requested", notes: b.message, agent_id: prop.assigned_agent || lead.assigned_to, source: "website", branch_id: lead.branch_id || null, created_at: nowIso() };
    db.site_visits.push(v);
    addActivity(lead.id, "site_visit", `Visit requested on the website for ${when} at ${prop.code}`);
    if (v.agent_id) notify([v.agent_id], `Visit request: ${lead.name}`, `${prop.title} · ${when}`, `/erp/leads/${lead.id}`, `vreq:${v.id}`);
  }
  const title = { visit: "Site visit request", requirement: "New requirement" }[kind] || `New website ${kind}`;
  notifyRoles(["super_admin", "director", "branch_manager"], `${title}: ${b.name}`, note.slice(0, 200), `/erp/leads/${lead.id}`, `enq:${lead.id}:${nowIso().slice(0, 16)}`, "info", lead.branch_id);
  return { ok: true, reference: lead.code };
});

route("POST", "/public/owner-submission", async ({ body: b, files }) => {
  if (b.website) return { ok: true, reference: "received" };
  if (!b.declaration || b.declaration === "false") fail(422, "You must confirm you are the owner or authorised representative");
  if (!["sale", "rent", "lease", "short_stay"].includes(b.transaction)) fail(422, "Invalid intention");
  if (b.pincode && !/^\d{6}$/.test(b.pincode)) fail(422, "PIN code must be 6 digits");
  const photos = (files.photos || []).slice(0, 6);
  const phone = normalizePhone(b.phone);
  const city = String(b.city || "").trim(); const locality = String(b.locality || "").trim();
  const lat = b.lat !== undefined && b.lat !== "" ? Number(b.lat) : null; const lng = b.lng !== undefined && b.lng !== "" ? Number(b.lng) : null;
  const geo = lat != null && lng != null ? geoFields({ lat, lng, accuracy_m: b.accuracy_m || null, source: b.location_source === "gps" ? "owner_gps" : "owner_pin", captured_by: `Owner (${b.name.trim().slice(0, 60)})` }, "approximate") : {};
  let owner = one("owners", (o) => o.phone === phone);
  const match = !!owner;
  if (!owner) {
    owner = { id: newId(), code: nextCode("owner", "SE-O-"), name: b.name.trim(), phone, email: b.email || null, preferred_contact: b.preferred_contact || "phone", kind: "individual", is_nri: false, source: "owner_submission", created_at: nowIso(), deleted: false };
    db.owners.push(owner);
  }
  linkCustomer("owners", owner.id, { name: owner.name, phone, email: b.email, types: ["owner", "landlord"], source: "website", city });
  const branchId = branchForPlace(city, locality);
  // an owner's new locality is added for staff to review before it shows on the website
  if (db.locations.some((l) => l.kind === "city" && eqi(l.name, city))) ensurePlace(city, locality, b.pincode || null, geo.geo?.lat ?? null, geo.geo?.lng ?? null, branchId, "owner_submission", false);
  const pid = newId();
  const prop = { id: pid, code: nextCode("property", "SE-P-"), title: `${b.category[0].toUpperCase()}${b.category.slice(1)} in ${b.locality}`, category: b.category, transaction: b.transaction, ownership_type: "third_party",
    owner_id: owner.id, city, locality, pincode: b.pincode || null, internal_address: b.address || null, price: b.price ? Number(b.price) : null, price_unit: b.transaction === "sale" ? "total" : "per_month",
    description_public: "", owner_description: b.description || null, requested_services: b.services || null, status: "verification_pending", source: "owner_submission", images: [], amenities: [],
    verification: { status: "pending" }, owner_match_unverified: match, submitted_name: b.name.trim(), branch_id: branchId,
    authorization: {}, publication_history: [], created_at: nowIso(), updated_at: nowIso(), deleted: false, featured: false, location_public: "approximate", ...geo };
  db.properties.push(prop);
  for (const f of photos) {
    db.documents.push({ id: newId(), demo_url: await fileToDataUrl(f), size: f.size, content_type: f.type, original_name: f.name, entity_type: "property", entity_id: pid, doc_type: "photo", version: 1, is_latest: true, public_approved: false, uploaded_by: null, created_at: nowIso() });
  }
  createLead({ name: b.name.trim(), phone, email: b.email, source: "website", interest: b.transaction === "sale" ? "sell" : "management", customer_type: b.transaction === "sale" ? "seller" : "landlord", branch_id: branchId, property_id: pid, requirements: b.description, preferred_contact: b.preferred_contact }, null, `Owner submitted property ${prop.code} for review`);
  audit(null, "owner_submission", "properties", pid, { photos: photos.length, location: !!geo.geo });
  notifyRoles(["super_admin", "director", "branch_manager"], `Property submitted for verification: ${prop.code}`, `${b.name} - ${locality}, ${city}`, `/erp/properties/${pid}`, `sub:${pid}`, "info", branchId);
  return { ok: true, reference: prop.code };
});

// ---------------- Insights ----------------
const CATS = ["market_update", "buying_guide", "owner_guide", "area_guide", "legal_tax", "company_news", "project_update"];
const LIST = ["id", "slug", "title", "excerpt", "category", "cover_image", "published_at", "author_name", "reading_minutes", "tags"];
const slugify = (s) => (String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "post");
const minutes = (body) => Math.max(1, Math.round((String(body || "").match(/\w+/g) || []).length / 200));
const uniqueSlug = (slug, exclude) => { let s = slug; let n = 2; while (db.posts.some((p) => p.slug === s && p.id !== exclude && notDeleted(p))) s = `${slug}-${n++}`; return s; };

route("GET", "/posts", () => sortBy(db.posts.filter(notDeleted), "updated_at", -1).map((p) => omit(p, ["body"])), { perm: ["cms", "r"] });
route("GET", "/posts/:id", ({ params }) => one("posts", (p) => p.id === params.id && notDeleted(p)) || fail(404, "Post not found"), { perm: ["cms", "r"] });
route("POST", "/posts", ({ user, body: b }) => {
  if (!CATS.includes(b.category)) fail(422, "Invalid category");
  if (b.audience && !["public", "investors"].includes(b.audience)) fail(422, "Invalid audience");
  if (String(b.title || "").trim().length < 4) fail(422, "title: at least 4 characters");
  if (String(b.body || "").length < 20) fail(422, "body: the article is too short");
  const p = { id: newId(), title: b.title, slug: uniqueSlug(slugify(b.slug || b.title)), excerpt: b.excerpt || null, body: b.body, category: b.category, tags: (b.tags || []).slice(0, 10), cover_image: null,
    seo_title: b.seo_title || null, seo_description: b.seo_description || null, audience: b.audience || "public", status: "draft", reading_minutes: minutes(b.body), author_id: user.id, author_name: user.name, published_at: null, created_at: nowIso(), updated_at: nowIso(), deleted: false };
  db.posts.push(p);
  audit(user, "post_created", "cms", p.id, { title: p.title });
  return p;
}, { perm: ["cms", "w"] });
route("PATCH", "/posts/:id", ({ user, body, params }) => {
  const p = one("posts", (x) => x.id === params.id && notDeleted(x)) || fail(404, "Post not found");
  const upd = pick(body, ["title", "slug", "excerpt", "body", "category", "tags", "cover_image", "seo_title", "seo_description", "audience", "featured"]);
  if ("audience" in upd && !["public", "investors"].includes(upd.audience)) fail(422, "Invalid audience");
  if ("featured" in upd) upd.featured = !!upd.featured;
  if ("category" in upd && !CATS.includes(upd.category)) fail(422, "Invalid category");
  if ("title" in upd && !(String(upd.title).trim().length >= 4 && String(upd.title).length <= 160)) fail(422, "Title must be 4–160 characters");
  if ("body" in upd) { if (String(upd.body).length < 20) fail(422, "The article is too short"); upd.reading_minutes = minutes(upd.body); }
  if ("slug" in upd) upd.slug = uniqueSlug(slugify(upd.slug || upd.title || p.title), p.id);
  if ("tags" in upd) upd.tags = (upd.tags || []).map((t) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 10);
  if (body.status && (body.status !== p.status || body.status === "scheduled")) {
    if (!["draft", "published", "scheduled"].includes(body.status)) fail(422, "Invalid status");
    if (["published", "scheduled"].includes(body.status) && !can(user, "cms", "p")) fail(403, "You are not authorised to publish");
    upd.status = body.status;
    if (body.status === "scheduled") {
      const at = String(body.publish_at || "");
      // a time without a zone is India time, as on the server
      const when = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : `${at}+05:30`);
      if (!at || Number.isNaN(when)) fail(422, "Choose a date and time to publish");
      if (when <= Date.now()) fail(422, "Choose a time in the future, or publish now");
      upd.publish_at = new Date(when).toISOString();
    }
    if (body.status === "published" && !p.published_at) upd.published_at = nowIso();
    if (body.status === "draft") upd.publish_at = null;
  }
  upd.updated_at = nowIso();
  Object.assign(p, upd);
  audit(user, "post_updated", "cms", p.id, omit(upd, ["body", "updated_at"]));
  return p;
}, { perm: ["cms", "w"] });
route("DELETE", "/posts/:id", ({ user, params }) => {
  const p = one("posts", (x) => x.id === params.id) || fail(404, "Post not found");
  Object.assign(p, { deleted: true, status: "draft", updated_at: nowIso() });
  audit(user, "post_deleted", "cms", p.id);
  return { ok: true };
}, { perm: ["cms", "w"] });
route("POST", "/posts/:id/cover", async ({ user, params, files }) => {
  const p = one("posts", (x) => x.id === params.id && notDeleted(x)) || fail(404, "Post not found");
  const f = files.file?.[0] || fail(422, "Choose a photo");
  if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) fail(422, `File type not allowed: ${f.type || "unknown"}`);
  const d = { id: newId(), demo_url: await fileToDataUrl(f), size: f.size, content_type: f.type, original_name: f.name, entity_type: "post", entity_id: p.id, doc_type: "photo", version: 1, is_latest: true, public_approved: true, uploaded_by: user.id, uploaded_by_name: user.name, created_at: nowIso() };
  db.documents.push(d);
  Object.assign(p, { cover_image: `/api/public/media/${d.id}`, updated_at: nowIso() });
  return { cover_image: p.cover_image };
}, { perm: ["cms", "w"] });
route("POST", "/posts/:id/image", async ({ user, params, files }) => {
  const p = one("posts", (x) => x.id === params.id && notDeleted(x)) || fail(404, "Post not found");
  const f = files.file?.[0] || fail(422, "Choose a photo");
  if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) fail(422, `File type not allowed: ${f.type || "unknown"}`);
  if (f.size > 5 * 1024 * 1024) fail(422, "Image is larger than 5 MB");
  const d = { id: newId(), demo_url: await fileToDataUrl(f), size: f.size, content_type: f.type, original_name: f.name, entity_type: "post", entity_id: p.id, doc_type: "photo", version: 1, is_latest: true, public_approved: true, uploaded_by: user.id, uploaded_by_name: user.name, created_at: nowIso() };
  db.documents.push(d);
  return { url: `/api/public/media/${d.id}`, markdown: `![${f.name.replace(/\.[^.]+$/, "")}](/api/public/media/${d.id})` };
}, { perm: ["cms", "w"] });
route("GET", "/public/posts", ({ query: q }) => {
  publishDue();
  let rows = db.posts.filter(livePost);
  if (q.category) rows = rows.filter((p) => p.category === q.category);
  rows = sortBy(rows, "published_at", -1);
  const limit = Math.max(1, Math.min(Number(q.limit || 9), 30)); const page = Math.max(1, Number(q.page || 1));
  return { items: rows.slice((page - 1) * limit, page * limit).map((p) => pick(p, LIST)), total: rows.length, page, limit };
});
route("GET", "/public/posts/:slug", ({ params }) => {
  publishDue();
  const p = db.posts.find((x) => x.slug === params.slug && livePost(x)) || fail(404, "Article not found");
  const related = sortBy(db.posts.filter((x) => livePost(x) && x.slug !== p.slug && x.category === p.category), "published_at", -1).slice(0, 3).map((x) => pick(x, LIST));
  return { post: omit(p, ["author_id"]), related };
});

// ---------------- Owner portal ----------------
const ownerProps = (oid) => db.properties.filter((p) => p.owner_id === oid && notDeleted(p)).map((p) => pick(p, ["id", "code", "listing_id", "title", "category", "transaction", "status", "occupancy", "locality", "city", "price", "price_unit", "images", "service_type", "mgmt_fee_pct", "published_at", "authorization"]));
export function statementData(oid, month) {
  const rents = db.rent_payments.filter((r) => r.owner_id === oid && r.period === month);
  const pids = db.properties.filter((p) => p.owner_id === oid).map((p) => p.id);
  const wos = db.work_orders.filter((w) => pids.includes(w.property_id) && w.charge_to === "owner" && ["completed", "closed"].includes(w.status) && (w.completed_at || "").startsWith(month));
  const exps = wos.map((w) => ({ amount: w.actual_cost || 0, description: `${w.code} ${w.title}`, property_id: w.property_id }));
  return [rents, exps, calcOwnerStatement(rents.map((r) => ({ amount: r.amount, fee_pct: r.mgmt_fee_pct || 0 })), exps)];
}
const arrearsOf = (ls) => r2((ls.schedule || []).filter((s) => s.due_date < todayIST()).reduce((t, s) => t + s.amount - s.paid, 0));

route("GET", "/portal/overview", ({ user }) => {
  const oid = user.owner_id;
  const owner = pick(one("owners", (o) => o.id === oid) || {}, ["id", "code", "name", "is_nri"]);
  const props = ownerProps(oid);
  const pids = props.map((p) => p.id);
  const month = todayIST().slice(0, 7);
  const leases = db.leases.filter((l) => l.owner_id === oid && l.status === "active");
  const [, , calc] = statementData(oid, month);
  const last = sortBy(db.owner_statements.filter((s) => s.owner_id === oid), "month", -1)[0] || null;
  const due = leases.map((ls) => { const n = ls.schedule.find((s) => s.paid < s.amount); return n && { lease_code: ls.code, property_title: ls.property_title, period: n.period, due_date: n.due_date, balance: r2(n.amount - n.paid) }; }).filter(Boolean);
  return { owner, properties: props, month, this_month: calc, arrears: r2(leases.reduce((t, l) => t + arrearsOf(l), 0)), active_leases: leases.length,
    occupied: props.filter((p) => p.occupancy === "occupied").length, last_statement: last ? omit(last, ["by"]) : null,
    open_requests: db.work_orders.filter((w) => pids.includes(w.property_id) && ["open", "assigned", "in_progress"].includes(w.status)).length,
    upcoming_stays: db.bookings.filter((b) => pids.includes(b.property_id) && b.status === "confirmed" && b.check_in >= todayIST()).length,
    rent_due: sortBy(due, "due_date").slice(0, 10) };
}, { auth: "owner" });
route("GET", "/portal/leases", ({ user }) => sortBy(db.leases.filter((l) => l.owner_id === user.owner_id), "end_date", -1).map((l) => ({
  ...omit(l, ["tenant_phone", "tenant_email", "notes", "manager_id"]), arrears: arrearsOf(l),
  payments: sortBy(db.rent_payments.filter((p) => p.lease_id === l.id), "date", -1).map((p) => pick(p, ["id", "period", "amount", "date", "method", "receipt_no"])) })), { auth: "owner" });
route("GET", "/portal/statements", ({ user }) => ({ settled: sortBy(db.owner_statements.filter((s) => s.owner_id === user.owner_id), "month", -1).map((s) => omit(s, ["by"])),
  months_with_rent: [...new Set(db.rent_payments.filter((r) => r.owner_id === user.owner_id).map((r) => r.period))].sort().reverse() }), { auth: "owner" });
route("GET", "/portal/statements/:month", ({ user, params }) => {
  const [rents, exps, calc] = statementData(user.owner_id, params.month);
  const settled = one("owner_statements", (s) => s.owner_id === user.owner_id && s.month === params.month);
  return { month: params.month, rents: rents.map((r) => pick(r, ["date", "lease_code", "period", "amount", "receipt_no"])), ...calc, expense_items: exps, settled: settled ? omit(settled, ["by"]) : null };
}, { auth: "owner" });
route("GET", "/portal/work-orders", ({ user }) => {
  const pids = ownerProps(user.owner_id).map((p) => p.id);
  return sortBy(db.work_orders.filter((w) => pids.includes(w.property_id)), "created_at", -1).map((w) => ({ ...omit(w, ["vendor_id", "created_by"]), history: (w.history || []).map((h) => pick(h, ["at", "event"])) }));
}, { auth: "owner" });
route("POST", "/portal/requests", ({ user, body: b }) => {
  const prop = db.properties.find((p) => p.id === b.property_id && p.owner_id === user.owner_id && notDeleted(p)) || fail(404, "Property not found");
  if (String(b.title || "").trim().length < 3) fail(422, "title: at least 3 characters");
  const wo = { id: newId(), code: nextCode("wo", "WO-", 5), property_id: prop.id, title: b.title, description: b.description || null, category: "general", priority: b.priority || "medium", due_date: null, vendor_id: null,
    quote_amount: null, charge_to: "owner", reported_by: `Owner portal (${user.name})`, property_title: prop.title, status: "open", actual_cost: null, history: [{ at: nowIso(), by: user.name, event: "Raised by owner" }], created_by: user.id, created_at: nowIso() };
  db.work_orders.push(wo);
  notify([prop.assigned_manager], `Owner request ${wo.code}: ${b.title}`, prop.title, "/erp/maintenance", `wo:${wo.id}`);
  notifyRoles(["branch_manager"], `Owner request ${wo.code}: ${b.title}`, prop.title, "/erp/maintenance", `wo:${wo.id}`);
  audit(user, "portal_request", "maintenance", wo.id);
  return omit(wo, ["created_by"]);
}, { auth: "owner" });
route("GET", "/portal/bookings", ({ user }) => {
  const pids = ownerProps(user.owner_id).map((p) => p.id);
  return sortBy(db.bookings.filter((b) => pids.includes(b.property_id)), "check_in", -1).map((b) => pick(b, ["id", "code", "property_id", "property_title", "check_in", "check_out", "nights", "guests", "platform", "gross", "platform_fee", "net_after_platform", "management_fee", "mgmt_fee_pct", "operating_costs", "owner_payout", "status", "settled", "payout_status"]));
}, { auth: "owner" });
const ownerDocs = (user) => {
  const pids = ownerProps(user.owner_id).map((p) => p.id);
  return db.documents.filter((d) => d.is_latest && d.share_with_owner && ((d.entity_type === "property" && pids.includes(d.entity_id)) || (d.entity_type === "owner" && d.entity_id === user.owner_id)));
};
route("GET", "/portal/documents", ({ user }) => sortBy(ownerDocs(user), "created_at", -1).map((d) => pick(d, ["id", "original_name", "doc_type", "entity_type", "entity_id", "expiry_date", "created_at", "version"])), { auth: "owner" });
route("POST", "/portal/documents/:id/link", ({ user, params }) => {
  if (!ownerDocs(user).some((d) => d.id === params.id)) fail(404, "Not found");
  audit(user, "document_link", "documents", params.id, { portal: true });
  return { url: `/api/files/demo-${params.id}`, expires_in: 300 };
}, { auth: "owner" });
