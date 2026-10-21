// Routing for the preview's in-browser API: matches method + path, checks sign-in and permissions the same way
// backend/core.py does (current_user, staff_user, owner_user, require), and turns errors into HTTP-style responses.
import { db, state, fail, HttpError, requirePerm, mfaRequiredFor, PORTAL_ROLES } from "./core";

const routes = [];
export function route(method, path, handler, opts = {}) {
  const keys = [];
  const re = new RegExp(`^${path.replace(/:[a-z]+/g, (m) => { keys.push(m.slice(1)); return "([^/]+)"; })}$`);
  routes.push({ method, re, keys, handler, opts, path });
}

function currentUser(path) {
  const u = state.userId && db.users.find((x) => x.id === state.userId && x.active);
  if (!u) fail(401, "Not authenticated");
  if (!u.mfa_enabled && !path.startsWith("/auth/") && mfaRequiredFor(u)) fail(403, "mfa_setup_required");
  return u;
}

export async function dispatch(method, path, query, body, files) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const ctx = { params, query, body: body || {}, files: files || {}, path };
    const o = r.opts;
    if (o.auth || o.perm) {
      ctx.user = currentUser(path);
      if ((o.auth === "staff" || o.perm) && PORTAL_ROLES.includes(ctx.user.role)) fail(403, "This area is for staff accounts");
      if (o.auth === "owner" && (ctx.user.role !== "owner" || !ctx.user.owner_id)) fail(403, "This area is for property owners");
      if (o.auth === "investor" && (ctx.user.role !== "investor" || !ctx.user.investor_id)) fail(403, "This area is for investors");
      if (o.perm) requirePerm(ctx.user, o.perm[0], o.perm[1], path);
    }
    return r.handler(ctx);
  }
  throw new HttpError(404, "Not found");
}
