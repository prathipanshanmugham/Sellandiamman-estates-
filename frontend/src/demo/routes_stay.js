// Short stays on many platforms (backend/routes_channels.py, ical.py) for the hosted preview: channels, two-way
// calendar sync, blocked dates, pricing and quotes, the multi-unit calendar, performance and website stay requests.
// The preview cannot reach booking platforms, so "Sync now" re-reads what the last sync brought in; pasting a
// calendar file (.ics) runs the real import.
import { route } from "./router";
import {
  db, fail, nowIso, todayIST, newId, r2, notDeleted, pick, sortBy, normalizePhone, audit, notifyRoles, inScope, PLATFORMS, stayQuote, calcShortstay,
  rangesOverlap, isoAdd, daysBetween,
} from "./core";
import { makeBooking, blockedBy } from "./routes_money";
import { createLead } from "./routes_sales";

const LIVE = ["confirmed", "checked_in", "completed"];
const UID_DOMAIN = "sellandiamman-estates";
const label = (k) => (PLATFORMS[k] || [k])[0];
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("");
const nights = (ci, co) => { const out = []; for (let d = ci; d < co; d = isoAdd(d, 1)) out.push(d); return out; };

const unitFor = (user, pid) => db.properties.find((p) => p.id === pid && p.transaction === "short_stay" && notDeleted(p) && inScope(user, "shortstay")(p)) || fail(404, "Short-stay property not found");
const pricingOf = (p) => ({ base_rate: p.nightly_rate || p.price || 0, weekend_rate: null, cleaning_fee: 0, min_nights: 1, weekly_discount_pct: 0, monthly_discount_pct: 0, included_guests: 2, extra_guest_fee: 0, seasons: [], ...(p.stay_pricing || {}) });
const units = (user) => db.properties.filter((p) => p.transaction === "short_stay" && notDeleted(p) && inScope(user, "shortstay")(p));

route("GET", "/short-stay/platforms", () => Object.entries(PLATFORMS).map(([key, [l, pct]]) => ({ key, label: l, commission_pct: pct })), { perm: ["shortstay", "r"] });

route("GET", "/short-stay/units", ({ user }) => {
  const t = todayIST(); const to = isoAdd(t, 30);
  return units(user).map((p) => {
    const bks = db.bookings.filter((b) => b.property_id === p.id && LIVE.includes(b.status) && b.check_in < to && b.check_out > t);
    const booked = bks.reduce((s, b) => s + nights(b.check_in, b.check_out).filter((d) => t <= d && d < to).length, 0);
    const nxt = sortBy(db.bookings.filter((b) => b.property_id === p.id && b.status === "confirmed" && b.check_in >= t), "check_in")[0];
    return { ...pick(p, ["id", "code", "title", "locality", "city", "branch_id", "nightly_rate", "price", "max_guests", "status", "images", "stay_pricing", "listing_id", "mgmt_fee_pct"]),
      pricing: pricingOf(p), channels: db.stay_channels.filter((c) => c.property_id === p.id && c.active !== false).map(({ export_token, ...c }) => c), // eslint-disable-line no-unused-vars
      occupancy_30d: Math.round((booked / 30) * 100), next_booking: nxt ? pick(nxt, ["code", "check_in", "guest_name", "platform"]) : null,
      needs_details: db.bookings.filter((b) => b.property_id === p.id && b.needs_details && !["cancelled", "declined"].includes(b.status)).length,
      conflicts: db.bookings.filter((b) => b.property_id === p.id && b.status === "conflict").length };
  });
}, { perm: ["shortstay", "r"] });

const safeUrl = (url) => { if (!/^https?:\/\/[^/\s]+/i.test(url || "")) fail(422, "Paste the full calendar link starting with https://"); return url; };
const exportUrl = (c) => (c.export_token ? `/api/public/ical/${c.export_token}.ics` : null);

route("GET", "/short-stay/channels", ({ user, query: q }) => sortBy(db.stay_channels.filter((c) => (!q.property_id || c.property_id === q.property_id) && inScope(user, "shortstay")(c)), "created_at")
  .map((c) => ({ ...c, export_url: exportUrl(c), label: label(c.platform) })), { perm: ["shortstay", "r"] });

route("POST", "/short-stay/channels", ({ user, body: b }) => {
  const p = unitFor(user, b.property_id);
  if (!PLATFORMS[b.platform]) fail(422, "Unknown platform");
  if (db.stay_channels.some((c) => c.property_id === p.id && c.platform === b.platform)) fail(409, `${label(b.platform)} is already set up for this property`);
  if (b.ical_import_url) safeUrl(b.ical_import_url);
  if (b.commission_pct != null && !(b.commission_pct >= 0 && b.commission_pct <= 60)) fail(422, "Commission must be between 0 and 60%");
  const c = { id: newId(), property_id: p.id, platform: b.platform, listing_url: b.listing_url || null, ical_import_url: b.ical_import_url || null, active: b.active !== false,
    property_title: p.title, branch_id: p.branch_id || null, commission_pct: b.commission_pct != null ? Number(b.commission_pct) : PLATFORMS[b.platform][1], export_token: token(),
    last_sync_at: null, last_sync_status: null, last_sync_error: null, last_sync_events: 0, created_at: nowIso(), created_by: user.id };
  db.stay_channels.push(c);
  audit(user, "channel_added", "shortstay", c.id, { platform: b.platform, property: p.code });
  return c;
}, { perm: ["shortstay", "w"] });

const channelFor = (user, id) => db.stay_channels.find((c) => c.id === id && inScope(user, "shortstay")(c)) || fail(404, "Channel not found");
route("PATCH", "/short-stay/channels/:id", ({ user, params, body }) => {
  const c = channelFor(user, params.id);
  const upd = pick(body, ["listing_url", "ical_import_url", "commission_pct", "active"]);
  if (upd.ical_import_url) safeUrl(upd.ical_import_url);
  if (upd.commission_pct != null && !(Number(upd.commission_pct) >= 0 && Number(upd.commission_pct) <= 60)) fail(422, "Commission must be between 0 and 60%");
  Object.assign(c, upd);
  audit(user, "channel_updated", "shortstay", c.id, upd);
  return c;
}, { perm: ["shortstay", "w"] });
route("POST", "/short-stay/channels/:id/rotate-link", ({ user, params }) => {
  const c = channelFor(user, params.id);
  c.export_token = token();
  audit(user, "channel_link_rotated", "shortstay", c.id);
  return { export_url: exportUrl(c) };
}, { perm: ["shortstay", "w"] });

// ---------------- iCal (ical.py) ----------------
function toDate(v) {
  const x = String(v || "").trim();
  if (!/^\d{8}/.test(x)) return null;
  if (x.includes("T") && x.endsWith("Z")) {
    const t = Date.UTC(+x.slice(0, 4), +x.slice(4, 6) - 1, +x.slice(6, 8), +x.slice(9, 11) || 0, +x.slice(11, 13) || 0, +x.slice(13, 15) || 0);
    return new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10); // the India date it falls on
  }
  const d = `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}`;
  return Number.isNaN(Date.parse(d)) ? null : d;
}
export function parseIcs(text, limit = 2000) {
  const lines = [];
  String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").forEach((raw) => { if ((raw[0] === " " || raw[0] === "\t") && lines.length) lines[lines.length - 1] += raw.slice(1); else lines.push(raw); });
  const unesc = (v) => v.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
  const events = []; let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") {
      if (cur) {
        const s = cur.DTSTART; let e = cur.DTEND;
        if (s && !e) e = isoAdd(s, 1);
        if (s && e && e > s) events.push({ uid: cur.UID || `${s}-${e}`, start: s, end: e, summary: cur.SUMMARY || "", description: cur.DESCRIPTION || "", status: String(cur.STATUS || "CONFIRMED").toUpperCase() });
      }
      cur = null;
      if (events.length >= limit) break;
      continue;
    }
    if (!cur || !line.includes(":")) continue;
    const i = line.indexOf(":");
    const name = line.slice(0, i).split(";")[0].toUpperCase(); const value = line.slice(i + 1);
    if (name === "DTSTART" || name === "DTEND") cur[name] = toDate(value);
    else if (["UID", "SUMMARY", "DESCRIPTION", "STATUS"].includes(name)) cur[name] = unesc(value).slice(0, 500);
  }
  return events;
}
const isOurs = (uid) => String(uid || "").endsWith(`@${UID_DOMAIN}`);
const isBlock = (s) => ["not available", "blocked", "closed", "unavailable"].some((w) => String(s || "").toLowerCase().includes(w));

function reconcile(c, events) {
  const prop = db.properties.find((p) => p.id === c.property_id);
  const out = { created: 0, updated: 0, cancelled: 0, blocks: 0, conflicts: 0 };
  if (!prop) return out;
  const lab = label(c.platform); const today = todayIST(); const seen = new Set();
  const rate = pricingOf(prop).base_rate || prop.nightly_rate || 1;
  const holds = (pid, ci, co, ignore) => blockedBy(pid, ci, co) || db.bookings.find((x) => x.id !== ignore && x.property_id === pid && LIVE.includes(x.status) && rangesOverlap(ci, co, x.check_in, x.check_out));
  events.forEach((e) => {
    if (isOurs(e.uid) || e.status === "CANCELLED" || e.end < today) return;
    seen.add(e.uid);
    if (isBlock(e.summary)) {
      const blk = db.stay_blocks.find((k) => k.channel_id === c.id && k.uid === e.uid);
      if (!blk) {
        db.stay_blocks.push({ id: newId(), property_id: prop.id, start: e.start, end: e.end, reason: "closed_on_platform", note: `Closed on ${lab}`, channel_id: c.id, uid: e.uid, branch_id: prop.branch_id || null, created_at: nowIso(), created_by: null });
        out.blocks += 1;
        const clash = db.bookings.find((x) => x.property_id === prop.id && ["confirmed", "checked_in"].includes(x.status) && x.channel_id !== c.id && x.check_in < e.end && x.check_out > e.start);
        if (clash) {
          out.conflicts += 1;
          notifyRoles(["shortstay_ops", "branch_manager"], `Check ${lab}: ${prop.title}`, `${lab} shows ${e.start} to ${e.end} as taken, but ${clash.code} is booked here. If ${lab} sold these nights, one booking has to move.`, "/erp/short-stay", `blkclash:${c.id}:${e.uid}`, "warning", prop.branch_id);
        }
      } else if (blk.start !== e.start || blk.end !== e.end) Object.assign(blk, { start: e.start, end: e.end });
      return;
    }
    const b = db.bookings.find((x) => x.channel_id === c.id && x.channel_uid === e.uid);
    if (b) {
      if ((b.check_in !== e.start || b.check_out !== e.end) && ["confirmed", "conflict"].includes(b.status)) {
        const n = daysBetween(e.start, e.end);
        const calc = calcShortstay(e.start, e.end, b.nightly_rate, b.discount || 0, b.cleaning_fee || 0, n === b.nights ? b.platform_fee || 0 : r2((b.nightly_rate * n * (c.commission_pct || 0)) / 100), b.operating_costs || 0, b.mgmt_fee_pct || 0);
        const clash = holds(b.property_id, e.start, e.end, b.id);
        if (clash) out.conflicts += 1;
        b.issues = [...(b.issues || []), { at: nowIso(), by: "Calendar sync", note: `Dates changed on ${lab}: ${b.check_in}–${b.check_out} → ${e.start}–${e.end}` }];
        Object.assign(b, { check_in: e.start, check_out: e.end, ...calc, status: clash ? "conflict" : "confirmed" });
        out.updated += 1;
      }
      return;
    }
    const n = daysBetween(e.start, e.end);
    const guest = e.summary.trim();
    const generic = !guest || ["reserved", "booked", "reservation", "airbnb", lab.toLowerCase()].includes(guest.toLowerCase());
    const body = { property_id: prop.id, guest_name: generic ? `Guest via ${lab}` : guest.slice(0, 120), guest_phone: null, guests: 1, check_in: e.start, check_out: e.end, nightly_rate: Number(rate),
      platform: c.platform, platform_fee: r2((Number(rate) * n * Number(c.commission_pct || 0)) / 100), source_ref: e.uid.slice(0, 120), notes: (e.description || "").slice(0, 500) || null };
    const extra = { channel_id: c.id, channel_uid: e.uid, needs_details: true, amounts_estimated: true };
    const clash = holds(prop.id, e.start, e.end);
    const bk = makeBooking(body, null, clash ? "conflict" : "confirmed", "ical", extra, false);
    if (clash) {
      out.conflicts += 1;
      notifyRoles(["shortstay_ops", "branch_manager", "director"], `Double booking: ${prop.title}`, `${lab} has ${e.start} to ${e.end} (${bk.code}), which clashes with ${clash.code || "closed dates"}`, "/erp/short-stay", `conflict:${bk.id}`, "warning", prop.branch_id);
    } else out.created += 1;
  });
  // reservations that vanished from the platform's calendar were cancelled there
  db.bookings.filter((b) => b.channel_id === c.id && b.source === "ical" && ["confirmed", "conflict"].includes(b.status) && b.check_in >= today && !seen.has(b.channel_uid)).forEach((b) => {
    Object.assign(b, { status: "cancelled", cancelled_at: nowIso(), cancel_reason: `Removed from the ${lab} calendar` });
    out.cancelled += 1;
    notifyRoles(["shortstay_ops"], `Cancelled on ${lab}: ${b.code}`, `${prop.title} ${b.check_in}`, "/erp/short-stay", `ical-cancel:${b.id}`, "info", prop.branch_id);
  });
  db.stay_blocks = db.stay_blocks.filter((k) => !(k.channel_id === c.id && !seen.has(k.uid) && k.end >= today));
  return out;
}
function syncChannel(c, text) {
  try {
    if (!String(text || "").includes("BEGIN:VCALENDAR")) fail(422, "That link did not return a calendar (.ics)");
    const events = parseIcs(text);
    const res = reconcile(c, events);
    Object.assign(c, { last_sync_at: nowIso(), last_sync_status: "ok", last_sync_error: null, last_sync_events: events.length, last_sync_result: res });
    return { ok: true, events: events.length, ...res };
  } catch (e) {
    const msg = String(e.detail || e.message || "Sync failed").slice(0, 300);
    Object.assign(c, { last_sync_at: nowIso(), last_sync_status: "failed", last_sync_error: msg });
    return { ok: false, error: msg };
  }
}
// What the platform's calendar holds now, as far as the preview knows: the bookings and closed dates it sent before.
function lastKnownFeed(c) {
  const ev = [
    ...db.bookings.filter((b) => b.channel_id === c.id && !["cancelled", "declined"].includes(b.status)).map((b) => `BEGIN:VEVENT\r\nUID:${b.channel_uid}\r\nDTSTART;VALUE=DATE:${b.check_in.replace(/-/g, "")}\r\nDTEND;VALUE=DATE:${b.check_out.replace(/-/g, "")}\r\nSUMMARY:Reserved\r\nEND:VEVENT`),
    ...db.stay_blocks.filter((k) => k.channel_id === c.id).map((k) => `BEGIN:VEVENT\r\nUID:${k.uid}\r\nDTSTART;VALUE=DATE:${k.start.replace(/-/g, "")}\r\nDTEND;VALUE=DATE:${k.end.replace(/-/g, "")}\r\nSUMMARY:Not available\r\nEND:VEVENT`),
  ];
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${ev.join("\r\n")}\r\nEND:VCALENDAR\r\n`;
}
route("POST", "/short-stay/channels/:id/sync", ({ user, params }) => {
  const c = channelFor(user, params.id);
  if (!c.ical_import_url) fail(422, "Paste this platform's calendar (iCal) link first");
  const res = syncChannel(c, lastKnownFeed(c));
  audit(user, "channel_synced", "shortstay", c.id, res);
  return res;
}, { perm: ["shortstay", "w"] });
route("POST", "/short-stay/channels/:id/import-text", ({ user, params, body }) => {
  const c = channelFor(user, params.id);
  const text = String(body.ics || body.text || "");
  if (!text.includes("BEGIN:VCALENDAR")) fail(422, "That is not a calendar file (.ics)");
  const res = syncChannel(c, text.slice(0, 3e6));
  audit(user, "channel_imported", "shortstay", c.id, res);
  return res;
}, { perm: ["shortstay", "w"] });

// ---------------- Blocks ----------------
route("POST", "/short-stay/blocks", ({ user, body: b }) => {
  const p = unitFor(user, b.property_id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.start || "") || !/^\d{4}-\d{2}-\d{2}$/.test(b.end || "")) fail(422, "Choose the start and end dates");
  if (b.end <= b.start) fail(422, "The end date must be after the start date");
  const reason = b.reason || "owner_stay";
  if (!["owner_stay", "maintenance", "hold", "other"].includes(reason)) fail(422, "Invalid reason");
  const clash = db.bookings.find((x) => x.property_id === p.id && LIVE.includes(x.status) && x.check_in < b.end && x.check_out > b.start);
  if (clash) fail(409, `Booking ${clash.code} is on these dates`);
  const k = { id: newId(), property_id: p.id, start: b.start, end: b.end, reason, note: b.note || null, channel_id: null, uid: null, branch_id: p.branch_id || null, created_by: user.id, created_by_name: user.name, created_at: nowIso() };
  db.stay_blocks.push(k);
  audit(user, "dates_blocked", "shortstay", k.id, { property: p.code, start: b.start, end: b.end });
  return k;
}, { perm: ["shortstay", "w"] });
route("DELETE", "/short-stay/blocks/:id", ({ user, params }) => {
  const k = db.stay_blocks.find((x) => x.id === params.id) || fail(404, "Not found");
  unitFor(user, k.property_id);
  if (k.channel_id) fail(422, "These dates are closed on the platform; open them there and sync");
  db.stay_blocks = db.stay_blocks.filter((x) => x.id !== k.id);
  audit(user, "dates_unblocked", "shortstay", k.id);
  return { ok: true };
}, { perm: ["shortstay", "w"] });

// ---------------- Pricing & quotes ----------------
route("PUT", "/short-stay/units/:id/pricing", ({ user, params, body: b }) => {
  const p = unitFor(user, params.id);
  const num = (v, d = 0) => (v === null || v === undefined || v === "" ? d : Number(v));
  const pr = { base_rate: num(b.base_rate), weekend_rate: b.weekend_rate ? Number(b.weekend_rate) : null, cleaning_fee: num(b.cleaning_fee), min_nights: parseInt(num(b.min_nights, 1), 10),
    weekly_discount_pct: num(b.weekly_discount_pct), monthly_discount_pct: num(b.monthly_discount_pct), included_guests: parseInt(num(b.included_guests, 2), 10), extra_guest_fee: num(b.extra_guest_fee),
    seasons: (b.seasons || []).map((s) => ({ name: String(s.name || "").slice(0, 40), start: s.start, end: s.end, rate: Number(s.rate) })) };
  if (!(pr.base_rate > 0)) fail(422, "base_rate: enter the nightly rate");
  if (pr.min_nights < 1 || pr.min_nights > 60) fail(422, "Minimum nights must be between 1 and 60");
  if (pr.weekly_discount_pct > 60 || pr.monthly_discount_pct > 70 || pr.weekly_discount_pct < 0 || pr.monthly_discount_pct < 0) fail(422, "Check the discounts");
  pr.seasons.forEach((s) => {
    if (!s.name || !/^\d{4}-\d{2}-\d{2}$/.test(s.start || "") || !/^\d{4}-\d{2}-\d{2}$/.test(s.end || "") || !(s.rate > 0)) fail(422, "Each season needs a name, dates and a rate");
    if (s.end < s.start) fail(422, `${s.name}: the end date is before the start date`);
  });
  Object.assign(p, { stay_pricing: pr, nightly_rate: pr.base_rate });
  audit(user, "pricing_updated", "shortstay", p.id, { base_rate: pr.base_rate, seasons: pr.seasons.length });
  return pr;
}, { perm: ["shortstay", "w"] });

function platformPct(pid, platform) {
  const ch = db.stay_channels.find((c) => c.property_id === pid && c.platform === platform);
  return ch && ch.commission_pct != null ? Number(ch.commission_pct) : Number((PLATFORMS[platform] || ["", 0])[1]);
}
function quoteFor(p, ci, co, guests, platform) {
  let q;
  try { q = stayQuote(ci, co, pricingOf(p), guests); } catch (e) { fail(422, e.message); }
  const pct = platformPct(p.id, platform);
  const fee = r2((q.total * pct) / 100);
  const calc = calcShortstay(ci, co, q.avg_rate, 0, q.cleaning_fee, fee, 0, p.mgmt_fee_pct || 0);
  return { ...q, platform, platform_pct: pct, platform_fee: fee, management_fee: calc.management_fee, owner_payout: calc.owner_payout };
}
route("POST", "/short-stay/quote", ({ user, body: b }) => quoteFor(unitFor(user, b.property_id), b.check_in, b.check_out, Number(b.guests || 1), b.platform || "direct"), { perm: ["shortstay", "r"] });

// ---------------- Multi-unit calendar & performance ----------------
route("GET", "/short-stay/calendar", ({ user, query: { frm, to } }) => {
  if (!frm || !to || frm.length !== 10 || to.length !== 10 || to <= frm) fail(422, "Use from/to dates as YYYY-MM-DD");
  const us = units(user).map((p) => pick(p, ["id", "code", "title", "locality", "city", "branch_id"]));
  const ids = us.map((u) => u.id);
  return { units: us,
    bookings: db.bookings.filter((b) => ids.includes(b.property_id) && !["cancelled", "declined"].includes(b.status) && b.check_in < to && b.check_out > frm).map((b) => pick(b, ["id", "code", "property_id", "check_in", "check_out", "guest_name", "platform", "status", "nights", "needs_details", "gross"])),
    blocks: db.stay_blocks.filter((k) => ids.includes(k.property_id) && k.start < to && k.end > frm) };
}, { perm: ["shortstay", "r"] });

route("GET", "/short-stay/performance", ({ user, query: { frm, to } }) => {
  if (!frm || !to) fail(422, "Use from/to dates as YYYY-MM-DD");
  const us = units(user);
  const ids = us.map((u) => u.id);
  const rows = db.bookings.filter((b) => ids.includes(b.property_id) && b.check_in >= frm && b.check_in <= to);
  const days = daysBetween(frm, to) + 1;
  const byP = {}; const byU = Object.fromEntries(us.map((u) => [u.id, { id: u.id, code: u.code, title: u.title, nights: 0, room: 0, gross: 0, fees: 0, bookings: 0 }]));
  rows.forEach((b) => {
    const k = byP[b.platform] || (byP[b.platform] = { platform: b.platform, label: label(b.platform), bookings: 0, nights: 0, gross: 0, commission: 0, net: 0, mgmt_fee: 0, room: 0, cancelled: 0, lead_days: 0 });
    if (["cancelled", "declined"].includes(b.status)) { k.cancelled += 1; return; }
    if (["requested", "conflict"].includes(b.status)) return;
    k.bookings += 1; k.nights += b.nights; k.gross += b.gross; k.commission += b.platform_fee || 0; k.net += b.net_after_platform || 0; k.mgmt_fee += b.management_fee || 0; k.room += b.room_revenue || 0;
    k.lead_days += Math.max(0, daysBetween(String(b.created_at).slice(0, 10), b.check_in));
    const u = byU[b.property_id]; u.bookings += 1; u.nights += b.nights; u.room += b.room_revenue || 0; u.gross += b.gross; u.fees += b.management_fee || 0;
  });
  const rnd = (o) => Object.fromEntries(Object.entries(o).map(([x, v]) => [x, typeof v === "number" && !Number.isInteger(v) ? r2(v) : v]));
  const platforms = Object.values(byP).map((k) => ({ ...rnd(k), adr: k.nights ? r2(k.room / k.nights) : 0, avg_lead_days: k.bookings ? Math.round(k.lead_days / k.bookings) : null, commission_pct: k.gross ? r2((k.commission / k.gross) * 100) : 0 }))
    .sort((a, b) => b.gross - a.gross);
  const blocked = {};
  db.stay_blocks.filter((k) => ids.includes(k.property_id) && k.start <= to && k.end > frm).forEach((k) => { blocked[k.property_id] = (blocked[k.property_id] || 0) + nights(k.start, k.end).filter((d) => frm <= d && d <= to).length; });
  const unitRows = Object.values(byU).map((u) => { const avail = Math.max(1, days - (blocked[u.id] || 0)); return { ...rnd(u), available_nights: avail, occupancy_pct: Math.round(Math.min(100, (u.nights / avail) * 100) * 10) / 10, adr: u.nights ? r2(u.room / u.nights) : 0, revpar: r2(u.room / avail) }; });
  return { from: frm, to, platforms, units: unitRows };
}, { perm: ["shortstay", "r"] });

// ---------------- Website: availability and booking requests ----------------
const listedUnit = (lid) => db.properties.find((p) => p.listing_id === lid && p.transaction === "short_stay" && ["published", "under_offer"].includes(p.status) && notDeleted(p)) || fail(404, "Listing not found");
route("GET", "/public/properties/:lid/availability", ({ params }) => {
  const p = listedUnit(params.lid);
  const t = todayIST(); const to = isoAdd(t, 210);
  const taken = [
    ...db.bookings.filter((b) => b.property_id === p.id && ["confirmed", "checked_in", "conflict"].includes(b.status) && b.check_out > t && b.check_in < to).map((b) => ({ start: b.check_in, end: b.check_out })),
    ...db.stay_blocks.filter((k) => k.property_id === p.id && k.end > t).map((k) => ({ start: k.start, end: k.end })),
  ].sort((a, b) => (a.start < b.start ? -1 : 1));
  const pr = pricingOf(p);
  return { taken, min_nights: pr.min_nights, base_rate: pr.base_rate, weekend_rate: pr.weekend_rate, cleaning_fee: pr.cleaning_fee, max_guests: p.max_guests || null, today: t };
});
route("POST", "/public/stay-request", ({ body: b }) => {
  if (b.website) return { ok: true, reference: "received" };
  if (!b.consent) fail(422, "Please accept the privacy policy to continue");
  if (String(b.name || "").trim().length < 2) fail(422, "name: at least 2 characters");
  const p = listedUnit(b.listing_id);
  if (b.check_in < todayIST()) fail(422, "Choose dates from today onwards");
  const guests = Number(b.guests || 1);
  if (p.max_guests && guests > p.max_guests) fail(422, `This home takes up to ${p.max_guests} guests`);
  const phone = normalizePhone(b.phone);
  if (blockedBy(p.id, b.check_in, b.check_out) || db.bookings.some((x) => x.property_id === p.id && ["confirmed", "checked_in", "conflict"].includes(x.status) && x.check_in < b.check_out && x.check_out > b.check_in)) fail(409, "Those dates are already taken. Please choose other dates.");
  const q = quoteFor(p, b.check_in, b.check_out, guests, "website");
  const [lead] = createLead({ name: b.name.trim(), phone, email: b.email, source: "website", interest: "short_stay", customer_type: "buyer", property_id: p.id, branch_id: p.branch_id, assigned_to: p.assigned_manager || null,
    requirements: `Stay ${b.check_in} to ${b.check_out}, ${guests} guests. ${b.message || ""}`.trim(), marketing_consent: b.marketing_consent, preferred_contact: "whatsapp" }, null, `Stay request on the website: ${b.check_in} to ${b.check_out} (${q.nights} nights)`);
  const bk = makeBooking({ property_id: p.id, guest_name: b.name.trim(), guest_phone: phone, guest_email: b.email || null, guests, check_in: b.check_in, check_out: b.check_out, nightly_rate: q.avg_rate, cleaning_fee: q.cleaning_fee, platform: "website", platform_fee: 0, notes: b.message || null },
    null, "requested", "website", { lead_id: lead.id, quote_total: q.total });
  notifyRoles(["shortstay_ops", "branch_manager"], `Stay request: ${p.title}`, `${b.name} · ${b.check_in} to ${b.check_out} · ${guests} guests · about ₹${Math.round(q.total).toLocaleString("en-IN")}`, "/erp/short-stay", `stayreq:${bk.id}`, "info", p.branch_id);
  return { ok: true, reference: bk.code, nights: q.nights, estimate: q.total };
});
