import axios from "axios";
import { useEffect } from "react";

export const BACKEND = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND}/api`;
export const api = axios.create({ baseURL: API, withCredentials: true });

export function errMsg(e) {
  const d = e?.response?.data?.detail;
  if (d == null) return e?.response?.status === 429 ? "Too many requests. Please wait." : "Something went wrong. Please try again.";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => (x?.msg ? `${(x.loc || []).slice(-1)[0] || ""}: ${x.msg}` : JSON.stringify(x))).join(" ");
  return d.msg || String(d);
}

const fmt0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

export function inr(v, compact = false) {
  const n = Number(v || 0);
  if (compact && Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2).replace(/\.00$/, "")} Cr`;
  if (compact && Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2).replace(/\.00$/, "")} L`;
  return compact ? fmt0.format(n) : fmt2.format(n);
}

const UNIT = { per_month: "/month", per_night: "/night", per_sqft: "/sq.ft", per_acre: "/acre", per_cent: "/cent" };
export function priceLabel(p) {
  if (p.price_on_request || !p.price) return "Price on request";
  return `${inr(p.price, true)}${UNIT[p.price_unit] || ""}`;
}

export function fmtDate(s) {
  if (!s) return "-";
  const d = new Date(s.length === 10 ? `${s}T00:00:00+05:30` : s.length === 16 ? `${s}:00+05:30` : s);
  return d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(s) {
  if (!s) return "-";
  const d = new Date(s.length === 16 ? `${s}:00+05:30` : s);
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const label = (s) => (s ? String(s).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "-");
export const opts = (arr) => arr.map((v) => (typeof v === "string" ? { value: v, label: label(v) } : v));
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function useTitle(title, description) {
  useEffect(() => {
    document.title = title ? `${title} | Sellandiamman Estates` : "Sellandiamman Estates";
    let m = document.querySelector('meta[name="description"]');
    if (!m) { m = document.createElement("meta"); m.name = "description"; document.head.appendChild(m); }
    if (description) m.content = description;
  }, [title, description]);
}

export const waLink = (number, text) => {
  const digits = (number || "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
};

export const openFile = (path) => window.open(`${API}${path}`, "_blank", "noopener");
