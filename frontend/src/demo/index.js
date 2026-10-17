// Hosted-preview build only (REACT_APP_DEMO=true): the real frontend talks to an in-browser copy of the API
// seeded from the real backend (see demo/export.py). Production builds load demo-stub.js instead.
import { api, setFileOpener, setMediaResolver, store } from "../lib/api";
import { META, db, clone, HttpError } from "./core";
import { dispatch } from "./router";
import "./routes_site";
import "./routes_sales";
import "./routes_money";
import "./routes_admin";

// Freeze "today" to the day the sample data was made, so due dates, arrears and the calendar line up.
const RealDate = Date;
const offset = RealDate.parse(META.exported_at) - RealDate.now();
class DemoDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); }
  static now() { return RealDate.now() + offset; }
}
DemoDate.UTC = RealDate.UTC;
DemoDate.parse = RealDate.parse;
window.Date = DemoDate;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function adapter(config) {
  const [path, qs] = String(config.url || "").split("?");
  const query = { ...Object.fromEntries(new URLSearchParams(qs || "")) };
  Object.entries(config.params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") query[k] = String(v); });
  let body = {};
  const files = {};
  if (typeof FormData !== "undefined" && config.data instanceof FormData) {
    for (const [k, v] of config.data.entries()) {
      if (typeof v === "object" && v && "size" in v) (files[k] = files[k] || []).push(v);
      else body[k] = v;
    }
  } else if (typeof config.data === "string" && config.data) {
    try { body = JSON.parse(config.data); } catch { body = {}; }
  } else if (config.data && typeof config.data === "object") body = config.data;
  await wait(60 + Math.random() * 90);
  try {
    const data = await dispatch(String(config.method || "get").toUpperCase(), path, query, body, files);
    return { data: clone(data), status: 200, statusText: "OK", headers: {}, config, request: {} };
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (!(e instanceof HttpError)) console.error("[preview api]", e); // eslint-disable-line no-console
    const err = new Error(`Request failed with status code ${status}`);
    err.config = config;
    err.isAxiosError = true;
    err.response = { status, statusText: String(status), data: { detail: e instanceof HttpError ? e.detail : "Something went wrong. Please try again." }, headers: {}, config };
    throw err;
  }
}

export function bootDemo() {
  api.defaults.adapter = adapter;
  store.set("se_cookie_consent", "essential");
  setMediaResolver((u) => { const m = /\/api\/public\/media\/([\w-]+)/.exec(u || ""); return (m && db.documents.find((d) => d.id === m[1])?.demo_url) || null; });
  setFileOpener((path, meta) => window.dispatchEvent(new CustomEvent("demo-open-file", { detail: { path, meta: meta || {} } })));
}

export { default as DemoLayer } from "./DemoUI";
