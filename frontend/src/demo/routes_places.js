// Branches, towns & localities, team directory and the website editor (backend/routes_branches.py, routes_cms.py)
// for the hosted preview.
import { route } from "./router";
import {
  META, db, fail, nowIso, newId, notDeleted, pick, normalizePhone, can, audit, settings, slugify, eqi, ensureCity, ensurePlace, PORTAL_ROLES, ROLES, fileToDataUrl,
} from "./core";

const PUBLIC_BRANCH = ["id", "code", "name", "city", "district", "address", "pincode", "phone", "whatsapp", "email", "office_hours", "lat", "lng", "is_head_office", "gbp_url"];
const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name));
const headFirst = (a, b) => (b.is_head_office ? 1 : 0) - (a.is_head_office ? 1 : 0) || (a.order || 0) - (b.order || 0);
const isStaff = (u) => !PORTAL_ROLES.includes(u.role);

// ---------------- Branches ----------------
route("GET", "/branches", () => [...db.branches].sort(byOrder).map((b) => ({ ...b,
  staff: db.users.filter((u) => (u.branch_ids || []).includes(b.id) && u.active && isStaff(u)).length,
  properties: db.properties.filter((p) => p.branch_id === b.id && notDeleted(p)).length })), { auth: "staff" });

route("GET", "/public/branches", () => db.branches.filter((b) => b.active !== false).sort(headFirst).map((b) => Object.fromEntries(PUBLIC_BRANCH.map((k) => [k, b[k] ?? null]))));

function checkBranch(d) {
  if (String(d.name || "").trim().length < 2 || String(d.city || "").trim().length < 2) fail(422, "Branch name and town are required");
  if (d.pincode && !/^\d{6}$/.test(d.pincode)) fail(422, "PIN code must be 6 digits");
  ["phone", "whatsapp"].forEach((k) => { if (d[k]) d[k] = normalizePhone(d[k]); });
  return d;
}
const BRANCH_FIELDS = ["name", "code", "city", "district", "address", "pincode", "phone", "whatsapp", "email", "office_hours", "lat", "lng", "manager_id", "is_head_office", "active", "gbp_url"];

route("POST", "/branches", ({ user, body }) => {
  if (db.branches.some((b) => eqi(b.name, body.name))) fail(409, "A branch with this name already exists");
  const d = checkBranch({ is_head_office: false, active: true, ...pick(body, BRANCH_FIELDS) });
  let id = `br-${slugify(d.name)}`;
  if (db.branches.some((b) => b.id === id)) id = `${id}-${newId().slice(0, 4)}`;
  const b = { ...d, id, code: String(d.code || d.name.slice(0, 3)).toUpperCase(), order: db.branches.length + 1, created_at: nowIso() };
  db.branches.push(b);
  if (b.is_head_office) db.branches.forEach((x) => { if (x.id !== id) x.is_head_office = false; });
  ensureCity(d.city, d.district || null, id);
  audit(user, "branch_created", "settings", id, { name: d.name });
  return b;
}, { perm: ["settings", "w"] });

route("PATCH", "/branches/:id", ({ user, params, body }) => {
  const b = db.branches.find((x) => x.id === params.id) || fail(404, "Branch not found");
  const upd = checkBranch({ ...b, ...pick(body, BRANCH_FIELDS) });
  const out = pick(upd, Object.keys(body).filter((k) => BRANCH_FIELDS.includes(k)));
  if (out.active === false && b.is_head_office) fail(422, "Choose another head office before closing this branch");
  Object.assign(b, out);
  if (out.is_head_office) db.branches.forEach((x) => { if (x.id !== b.id) x.is_head_office = false; });
  audit(user, "branch_updated", "settings", b.id, out);
  return b;
}, { perm: ["settings", "w"] });

// ---------------- Towns & localities ----------------
function listingCounts() {
  const counts = {};
  db.properties.filter((p) => ["published", "under_offer"].includes(p.status) && notDeleted(p)).forEach((p) => {
    const c = String(p.city || "").toLowerCase(); const l = String(p.locality || "").toLowerCase();
    counts[`${c}|`] = (counts[`${c}|`] || 0) + 1;
    counts[`${c}|${l}`] = (counts[`${c}|${l}`] || 0) + 1;
  });
  return counts;
}
function tree(rows) {
  const counts = listingCounts();
  return rows.filter((r) => r.kind === "city").sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ ...c, listings: counts[`${c.name.toLowerCase()}|`] || 0,
    localities: rows.filter((r) => r.kind === "locality" && String(r.city || "").toLowerCase() === c.name.toLowerCase()).sort((a, b) => a.name.localeCompare(b.name))
      .map((x) => ({ ...x, listings: counts[`${c.name.toLowerCase()}|${x.name.toLowerCase()}`] || 0 })) }));
}
route("GET", "/public/locations", () => tree(db.locations.filter((l) => l.active !== false).map(({ source, ...rest }) => rest))); // eslint-disable-line no-unused-vars
route("GET", "/locations", () => tree(db.locations), { auth: "staff" });

route("POST", "/locations", ({ user, body }) => {
  const kind = body.kind || "locality";
  const name = String(body.name || "").trim();
  if (name.length < 2) fail(422, "Enter the name");
  if (body.pincode && !/^\d{6}$/.test(body.pincode)) fail(422, "PIN code must be 6 digits");
  if (kind === "city") {
    if (!can(user, "settings", "w")) fail(403, "Only administrators can add a new town");
    if (db.locations.some((l) => l.kind === "city" && eqi(l.name, name))) fail(409, `${name} is already in the list`);
    const c = ensureCity(name, body.district || null, body.branch_id || null);
    ["pincode", "lat", "lng", "intro"].forEach((k) => { if (body[k] != null && body[k] !== "") c[k] = body[k]; });
    audit(user, "location_added", "settings", c.id, { city: name });
    return c;
  }
  if (!(can(user, "properties", "w") || can(user, "settings", "w"))) fail(403, "You do not have permission for this action");
  if (!body.city) fail(422, "Choose the town this locality belongs to");
  if (!db.locations.some((l) => l.kind === "city" && eqi(l.name, body.city))) fail(422, "Add the town first");
  if (db.locations.some((l) => l.kind === "locality" && eqi(l.city, body.city) && eqi(l.name, name))) fail(409, `${name} is already listed under ${body.city}`);
  const loc = ensurePlace(body.city, name, body.pincode || null, body.lat ?? null, body.lng ?? null, body.branch_id || null, user.id);
  if (body.intro) loc.intro = body.intro;
  audit(user, "location_added", "properties", loc.id, { city: body.city, locality: name });
  return loc;
}, { auth: "staff" });

route("PATCH", "/locations/:id", ({ user, params, body }) => {
  const loc = db.locations.find((l) => l.id === params.id) || fail(404, "Not found");
  const upd = pick(body, ["district", "pincode", "lat", "lng", "branch_id", "intro", "active"]);
  if (upd.pincode && !/^\d{6}$/.test(String(upd.pincode))) fail(422, "PIN code must be 6 digits");
  const nn = String(body.name || "").trim();
  if (nn && nn !== loc.name) {
    if (db.locations.some((l) => l.id !== loc.id && l.kind === loc.kind && eqi(l.name, nn) && (loc.kind === "city" || eqi(l.city, loc.city)))) fail(409, "That name is already in the list");
    Object.assign(upd, { name: nn, slug: slugify(nn) });
    if (loc.kind === "city") {
      upd.city = nn;
      db.locations.filter((l) => l.kind === "locality" && eqi(l.city, loc.name)).forEach((l) => { l.city = nn; });
      db.properties.filter((p) => eqi(p.city, loc.name)).forEach((p) => { p.city = nn; });
    } else db.properties.filter((p) => eqi(p.city, loc.city) && eqi(p.locality, loc.name)).forEach((p) => { p.locality = nn; });
  }
  Object.assign(loc, upd);
  audit(user, "location_updated", "settings", loc.id, upd);
  return loc;
}, { perm: ["settings", "w"] });

// ---------------- Team directory & organisation chart ----------------
const DIR = ["id", "name", "email", "phone", "whatsapp", "role", "branch_ids", "designation", "department", "reports_to", "photo", "show_in_directory", "joined_on"];
function directory() {
  const people = db.users.filter((u) => u.active && isStaff(u) && u.show_in_directory !== false).map((u) => pick(u, DIR));
  const ids = new Set(people.map((p) => p.id));
  return people.map((p) => ({ ...p, role_label: ROLES[p.role], reports_to: ids.has(p.reports_to) ? p.reports_to : null }));
}
route("GET", "/team/org", () => {
  const s = settings();
  return { company: pick(s, ["name", "phone", "email", "address"]), branches: db.branches.filter((b) => b.active !== false).sort(headFirst).map((b) => Object.fromEntries([...PUBLIC_BRANCH, "manager_id"].map((k) => [k, b[k] ?? null]))), people: directory() };
}, { auth: "staff" });

route("PATCH", "/team/me", ({ user, body }) => {
  const upd = pick(body, ["phone", "whatsapp", "photo"]);
  ["phone", "whatsapp"].forEach((k) => { if (upd[k]) upd[k] = normalizePhone(upd[k]); });
  if (upd.photo && !/^data:image\/(png|jpeg|webp);base64,/.test(upd.photo)) fail(422, "Photo must be a PNG, JPEG or WebP image");
  Object.assign(user, upd);
  audit(user, "profile_updated", "users", user.id, Object.fromEntries(Object.entries(upd).map(([k, v]) => [k, k === "photo" ? "(photo)" : v])));
  return { ok: true };
}, { auth: "staff" });

// ---------------- Website editor ----------------
const DEFAULT_SITE = META.site_defaults || {};
const SECTION_TYPES = META.section_types || [];
const s = (v, n = 300) => String(v ?? "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").slice(0, n); // eslint-disable-line no-control-regex
const img = (v) => { const x = s(v, 300); return x.startsWith("/images/") || x.startsWith("/api/public/media/") || x.startsWith("https://") ? x : ""; };

export function cleanSite(cIn) {
  const D = DEFAULT_SITE;
  const c = cIn || {};
  const h = c.hero || {};
  const out = JSON.parse(JSON.stringify(D));
  out.hero = { eyebrow: s(h.eyebrow, 120), title: s(h.title, 140) || D.hero.title, subtitle: s(h.subtitle, 300), image: img(h.image) || D.hero.image, show_search: h.show_search !== undefined ? !!h.show_search : true };
  out.announcement = s(c.announcement, 200);
  const seen = new Set();
  out.sections = (c.sections || D.sections).slice(0, 30).filter((x) => SECTION_TYPES.includes(x.type)).map((x) => {
    let id = s(x.id || `${x.type}-${newId().slice(0, 6)}`, 40);
    if (seen.has(id)) id = `${id}-${newId().slice(0, 4)}`;
    seen.add(id);
    const o = { id, type: x.type, visible: x.visible !== undefined ? !!x.visible : true, title: s(x.title, 160), eyebrow: s(x.eyebrow, 60), subtitle: s(x.subtitle, 300) };
    if (x.type === "text") o.body = s(x.body, 6000);
    if (x.type === "why") o.image = img(x.image);
    if (x.type === "stats") o.items = (x.items || []).slice(0, 6).filter((i) => i.value).map((i) => ({ value: s(i.value, 12), label: s(i.label, 40) }));
    return o;
  });
  out.services = (c.services || D.services).slice(0, 16).map((x, i) => [x, i]).filter(([x]) => x.title).map(([x, i]) => ({ slug: s(x.slug, 60).toLowerCase().replace(/[^a-z0-9-]/g, "") || `service-${i}`, title: s(x.title, 80), summary: s(x.summary, 300), points: (x.points || []).slice(0, 10).filter((p) => String(p).trim()).map((p) => s(p, 200)) }));
  out.why = (c.why || D.why).slice(0, 8).filter((x) => x.title).map((x) => ({ title: s(x.title, 80), body: s(x.body, 300) }));
  out.faq = (c.faq || D.faq).slice(0, 30).filter((x) => x.q && x.a).map((x) => ({ q: s(x.q, 200), a: s(x.a, 1200) }));
  const a = c.about || {};
  out.about = { title: s(a.title, 120) || D.about.title, body: s(a.body, 6000) || D.about.body, image: img(a.image) || D.about.image };
  out.footer_tagline = s(c.footer_tagline, 300) || D.footer_tagline;
  out.contact_intro = s(c.contact_intro, 300);
  out.testimonials = (c.testimonials || []).slice(0, 9).filter((t) => t.quote).map((t) => ({ quote: s(t.quote, 400), name: s(t.name, 80) }));
  const seo = c.seo || {};
  out.seo = { title: s(seo.title, 70), description: s(seo.description, 170) };
  return out;
}
const doc = (id) => db.site_content.find((x) => x.id === id);
export const publishedSite = () => cleanSite(doc("published")?.content || DEFAULT_SITE);
function setDoc(id, content, user) {
  const d = doc(id);
  const v = { content, updated_at: nowIso(), updated_by: user.name };
  if (d) Object.assign(d, v); else db.site_content.push({ id, ...v });
}

route("GET", "/public/site", () => publishedSite());
route("GET", "/cms/site", () => {
  const pub = doc("published") || {}; const draft = doc("draft") || {};
  const d = cleanSite(draft.content || pub.content || DEFAULT_SITE);
  const p = cleanSite(pub.content || DEFAULT_SITE);
  const history = [...db.site_versions].sort((x, y) => (x.published_at < y.published_at ? 1 : -1)).slice(0, 15).map(({ content, ...rest }) => rest); // eslint-disable-line no-unused-vars
  return { draft: d, published: p, dirty: JSON.stringify(d) !== JSON.stringify(p), draft_saved_at: draft.updated_at || null, draft_by: draft.updated_by || null,
    published_at: pub.updated_at || null, published_by: pub.updated_by || null, history, section_types: SECTION_TYPES };
}, { perm: ["cms", "r"] });
route("PUT", "/cms/site/draft", ({ user, body }) => { const c = cleanSite(body); setDoc("draft", c, user); return { ok: true, draft: c }; }, { perm: ["cms", "w"] });
route("POST", "/cms/site/publish", ({ user }) => {
  const c = cleanSite(doc("draft")?.content || publishedSite());
  setDoc("published", c, user);
  db.site_versions.push({ id: newId(), content: c, published_at: nowIso(), by: user.name });
  db.site_versions.sort((x, y) => (x.published_at < y.published_at ? 1 : -1)).splice(15);
  audit(user, "website_published", "cms", "site");
  return { ok: true };
}, { perm: ["cms", "p"] });
route("POST", "/cms/site/discard", ({ user }) => { setDoc("draft", publishedSite(), user); return { ok: true }; }, { perm: ["cms", "w"] });
route("POST", "/cms/site/restore/:id", ({ user, params }) => {
  const v = db.site_versions.find((x) => x.id === params.id) || fail(404, "Version not found");
  setDoc("draft", cleanSite(v.content), user);
  audit(user, "website_version_restored", "cms", v.id);
  return { ok: true };
}, { perm: ["cms", "w"] });

export async function saveImage(file, entityType, entityId, user, extra = {}) {
  if (!file) fail(422, "Choose a file");
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) fail(422, "Use a JPG, PNG or WebP image");
  if (file.size > 5 * 1024 * 1024) fail(422, "Image is larger than 5 MB");
  const d = { id: newId(), original_name: file.name, content_type: file.type, size: file.size, entity_type: entityType, entity_id: entityId, doc_type: "photo", version: 1, is_latest: true,
    public_approved: true, uploaded_by: user.id, uploaded_by_name: user.name, created_at: nowIso(), demo_url: await fileToDataUrl(file), ...extra };
  db.documents.push(d);
  return d;
}
route("POST", "/cms/media", async ({ user, files }) => {
  const d = await saveImage(files.file?.[0], "site", "site", user);
  audit(user, "website_image_uploaded", "cms", d.id);
  return { id: d.id, url: `/api/public/media/${d.id}`, name: d.original_name };
}, { perm: ["cms", "w"] });
route("GET", "/cms/media", () => db.documents.filter((d) => ["site", "post"].includes(d.entity_type) && d.public_approved).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 200)
  .map((d) => ({ id: d.id, url: `/api/public/media/${d.id}`, name: d.original_name, created_at: d.created_at })), { perm: ["cms", "r"] });
