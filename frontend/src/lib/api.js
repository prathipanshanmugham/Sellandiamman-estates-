import axios from "axios";
import { useEffect, useState, useSyncExternalStore } from "react";

// Same-origin by default (Caddy serves /api and the site together). Set REACT_APP_BACKEND_URL only when the API lives elsewhere.
export const BACKEND = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/$/, "");
export const API = `${BACKEND}/api`;
export const SITE_URL = (process.env.REACT_APP_SITE_URL || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");
export const api = axios.create({ baseURL: API, withCredentials: true, timeout: 30000 });

export function errMsg(e) {
  const d = e?.response?.data?.detail;
  if (!e?.response) return "Could not reach the server. Check your connection and try again.";
  if (d == null) return e.response.status === 429 ? "Too many requests. Please wait a minute and try again." : "Something went wrong. Please try again.";
  if (typeof d === "string") return d === "mfa_setup_required" ? "Set up 2-step sign-in to continue." : d;
  if (Array.isArray(d)) return d.map((x) => (x?.msg ? `${(x.loc || []).slice(-1)[0] || ""}: ${x.msg}`.replace(/^: /, "") : JSON.stringify(x))).join(" ");
  return d.msg || String(d);
}

const fmt0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const num0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function inr(v, compact = false) {
  const n = Number(v || 0);
  if (compact && Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, "")} Cr`;
  if (compact && Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2).replace(/\.?0+$/, "")} L`;
  return compact ? fmt0.format(n) : fmt2.format(n);
}
export const inr0 = (v) => fmt0.format(Math.round(Number(v || 0)));
export const n0 = (v) => num0.format(Number(v || 0));
const num2 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
export const num = (v) => num2.format(Number(v || 0));

const UNIT = { per_month: "/month", per_night: "/night", per_sqft: "/sq.ft", per_acre: "/acre", per_cent: "/cent" };
export function priceLabel(p) {
  if (p.price_on_request || !p.price) return "Price on request";
  return `${inr(p.price, true)}${UNIT[p.price_unit] || ""}`;
}

export function fmtDate(s) {
  if (!s) return "-";
  const d = new Date(s.length === 10 ? `${s}T00:00:00+05:30` : s.length === 16 ? `${s}:00+05:30` : s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(s) {
  if (!s) return "-";
  const d = new Date(s.length === 16 ? `${s}:00+05:30` : s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const nowIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 16);
export const label = (s) => (s ? String(s).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "-");
export const opts = (arr) => arr.map((v) => (typeof v === "string" ? { value: v, label: label(v) } : v));
export const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// ---------- Page meta (title, description, canonical, social cards, structured data) ----------
function setMeta(attr, key, value) {
  let m = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!m) { m = document.createElement("meta"); m.setAttribute(attr, key); document.head.appendChild(m); }
  m.setAttribute("content", value || "");
}

export function useMeta({ title, description, image, path, jsonLd, noindex } = {}) {
  const ld = jsonLd ? JSON.stringify(jsonLd) : "";
  useEffect(() => {
    const full = title ? `${title} | Sellandiamman Estates` : "Sellandiamman Estates · Property services in Perundurai, Erode, Sathyamangalam, Kadambur & Namakkal";
    // the server puts this page's structured data into the first HTML; after that the app keeps it up to date
    document.getElementById("ssr-jsonld")?.remove();
    document.title = full;
    if (description) { setMeta("name", "description", description); setMeta("property", "og:description", description); }
    setMeta("property", "og:title", full);
    const url = `${SITE_URL}${path ?? window.location.pathname}`;
    setMeta("property", "og:url", url);
    if (image) setMeta("property", "og:image", image.startsWith("http") ? image : `${SITE_URL}${image}`);
    setMeta("name", "robots", noindex ? "noindex" : "index,follow");
    let c = document.head.querySelector('link[rel="canonical"]');
    if (!c) { c = document.createElement("link"); c.rel = "canonical"; document.head.appendChild(c); }
    c.href = url;
    let s = document.getElementById("page-jsonld");
    if (ld) {
      if (!s) { s = document.createElement("script"); s.type = "application/ld+json"; s.id = "page-jsonld"; document.head.appendChild(s); }
      s.textContent = ld;
    } else if (s) s.remove();
  }, [title, description, image, path, ld, noindex]);
}
export const useTitle = (title, description) => useMeta({ title, description });

export const waLink = (number, text) => {
  const digits = (number || "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
};
export const waShare = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;
// Links shared on WhatsApp go through /s/... so the chat shows the photo, price and title (see backend /api/share).
export const IS_DEMO = process.env.REACT_APP_DEMO === "true";
export const shareUrl = (kind, id) => (IS_DEMO ? `${SITE_URL}/${kind === "p" ? "properties" : "insights"}/${id}` : `${SITE_URL}/s/${kind}/${id}`);
export const telLink = (phone) => `tel:${(phone || "").replace(/[^\d+]/g, "")}`;

// ---------- Opening PDFs / CSVs ----------
// The live site opens the file in a new tab. The hosted preview swaps this for an in-page viewer.
let fileOpener = (path) => window.open(`${API}${path}`, "_blank", "noopener");
export const setFileOpener = (fn) => { fileOpener = fn; };
export const openFile = (path, meta) => fileOpener(path, meta);

// ---------- Copy to clipboard with a fallback ----------
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try {
      const t = document.createElement("textarea"); t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok;
    } catch { return false; }
  }
}

// ---------- Browser storage that never throws (private windows, blocked storage) ----------
export const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ---------- Branch picked in the staff app ----------
// Sent as the X-Branch header, so every list, total and report narrows to that branch. Empty = all your branches.
let branchPick = store.get("se_branch", "");
const branchListeners = new Set();
const applyBranch = () => { if (branchPick) api.defaults.headers.common["X-Branch"] = branchPick; else delete api.defaults.headers.common["X-Branch"]; };
applyBranch();
export const branchApi = {
  get: () => branchPick,
  set(v) { branchPick = v || ""; store.set("se_branch", branchPick); applyBranch(); branchListeners.forEach((l) => l()); },
};
export function useBranchPick() {
  return useSyncExternalStore((cb) => { branchListeners.add(cb); return () => branchListeners.delete(cb); }, () => branchPick, () => branchPick);
}

// ---------- Small cache for data every page needs (towns, branches, website text) ----------
const cache = new Map();
export function cachedGet(path, maxAgeMs = 5 * 60e3) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.p;
  const p = api.get(path).then((r) => r.data);
  p.catch(() => cache.delete(path));
  cache.set(path, { at: Date.now(), p });
  return p;
}
export const clearCache = (prefix = "") => { [...cache.keys()].forEach((k) => { if (k.startsWith(prefix)) cache.delete(k); }); };
export function useCached(path, fallback) {
  const [v, setV] = useState(() => fallback);
  useEffect(() => { let on = true; if (path) cachedGet(path).then((d) => on && setV(d)).catch(() => {}); return () => { on = false; }; }, [path]);
  return v;
}
// Web-address form of a town or locality name, the same as the server's (routes_seo.slug)
export const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const placeUrl = (city, locality) => `/properties-in/${slugify(city)}${locality ? `/${slugify(locality)}` : ""}`;
export const mapsUrl = (lat, lng, q) => (lat && lng ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q || "")}`);

// ---------- Shortlist (saved listings, kept in this browser) ----------
const SL_KEY = "se_shortlist";
let shortlist = store.get(SL_KEY, []);
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
export const shortlistApi = {
  has: (id) => shortlist.includes(id),
  toggle(id) { shortlist = shortlist.includes(id) ? shortlist.filter((x) => x !== id) : [...shortlist, id].slice(-12); store.set(SL_KEY, shortlist); emit(); },
  remove(id) { shortlist = shortlist.filter((x) => x !== id); store.set(SL_KEY, shortlist); emit(); },
  clear() { shortlist = []; store.set(SL_KEY, shortlist); emit(); },
};
export function useShortlist() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => shortlist, () => shortlist);
}

export function useMedia(query) {
  const get = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false);
  const [m, setM] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on));
  }, [query]);
  return m;
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

// Static files from /public. PUBLIC_URL is "" on the live site and "." in the hosted preview.
export const asset = (p) => (p && p.startsWith("/") ? `${process.env.PUBLIC_URL || ""}${p}` : p);
// The hosted preview keeps uploaded photos in the page and resolves /api/public/media/... itself.
let mediaResolver = null;
export const setMediaResolver = (fn) => { mediaResolver = fn; };
export const imgSrc = (u) => (u?.startsWith("/api/") ? (mediaResolver && mediaResolver(u)) || `${BACKEND}${u}` : asset(u || "/images/placeholder.svg"));
