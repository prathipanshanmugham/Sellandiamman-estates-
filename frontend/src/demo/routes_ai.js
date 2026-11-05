// AI agents & MCP screen (backend/routes_ai.py) for the hosted preview. The preview has no server, so AI apps can't
// connect to it; agents, keys and the activity list behave as on the live site, with two sample agents and their calls.
import { route } from "./router";
import { db, META, fail, nowIso, todayIST, newId, ROLES, PORTAL_ROLES, can, audit } from "./core";

const AI = META.ai || { templates: [], tools: [], prompts: [], key_prefix: "sae_", calls_per_minute: 240, keep_calls_days: 90 };
const MCP_URL = "https://www.sellandiammanestates.com/api/mcp";
const TEMPLATE_KEYS = new Set(AI.templates.map((t) => t.key));

function newKey() {
  const a = new Uint8Array(30);
  crypto.getRandomValues(a);
  return AI.key_prefix + btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function statusOf(a) {
  if (a.revoked) return "revoked";
  if (a.expires_on && a.expires_on < todayIST()) return "expired";
  return a.active ? "active" : "paused";
}

function pub(a) {
  const u = db.users.find((x) => x.id === a.user_id) || {};
  const { key_hash, ...rest } = a; // eslint-disable-line no-unused-vars
  return { ...rest, status: statusOf(a), user_name: u.name, user_role: u.role, user_role_label: ROLES[u.role], user_active: !!u.active };
}

// Two sample agents with some calls, made the first time the screen is opened after a reset
function seed() {
  if (db._ai_seeded) return;
  db._ai_seeded = true;
  const by = (role) => db.users.find((u) => u.role === role && u.active);
  const boss = by("director");
  const sales = db.users.find((u) => u.email?.startsWith("sales.agent@")) || by("sales_agent");
  const acc = by("accountant");
  if (!boss) return;
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  const mk = (tpl, user, extra) => {
    const t = AI.templates.find((x) => x.key === tpl) || {};
    const key = newKey();
    return { id: newId(), name: t.name, purpose: t.purpose, template: tpl, access: t.access, expires_on: null, user_id: user.id, active: true, revoked: false,
      key_hash: "preview", key_prefix: key.slice(0, 10), key_version: 1, created_by: boss.id, created_by_name: boss.name, created_at: ago(60 * 24 * 6),
      updated_at: ago(60 * 24 * 6), last_used_at: null, last_ip: null, last_client: null, calls_total: 0, ...extra };
  };
  const agents = [];
  if (sales) agents.push(mk("sales", sales, { last_used_at: ago(42), last_client: "Claude 1.0", calls_total: 37 }));
  agents.push(mk("analyst", boss, { last_used_at: ago(60 * 20), last_client: "claude-ai 0.1.0", calls_total: 12 }));
  if (acc) agents.push(mk("collections", acc, { active: false, calls_total: 5, last_used_at: ago(60 * 24 * 3), last_client: "Claude 1.0" }));
  db.ai_agents.push(...agents);
  const lead = db.leads.find((l) => l.assigned_to === sales?.id) || db.leads[0];
  const calls = [];
  const c = (a, min, tool, args, ok = true, error = null, ms = 120) => calls.push({ id: newId(), agent_id: a.id, agent_name: a.name, user_id: a.user_id,
    user_name: (db.users.find((u) => u.id === a.user_id) || {}).name, method: tool ? "tools/call" : "initialize", tool, args, ok, error, ms, ip: "203.0.113.24", at: ago(min) });
  if (sales && agents[0]) {
    const s = agents[0];
    c(s, 48, null, '{"client":"Claude"}', true, null, 0);
    c(s, 47, "whoami", null, true, null, 35);
    c(s, 46, "list_records", '{"type":"leads","filters":{"overdue":true}}', true, null, 180);
    if (lead) {
      c(s, 44, "get_record", `{"type":"leads","id":"${lead.code}"}`, true, null, 95);
      c(s, 43, "run_action", `{"type":"leads","id":"${lead.code}","action":"log_activity","data":{"kind":"call","notes":"Asked for 2 BHK options near the bus stand"}}`, true, null, 140);
    }
    c(s, 42, "call_api", '{"method":"POST","path":"/api/leases/…/rent"}', false, "AI agents don't record money coming in or going out (rent, payments, invoices, expenses, payouts, prices). A person records it in the app; the agent can read it.", 8);
  }
  const an = agents.find((x) => x.template === "analyst");
  c(an, 60 * 20 + 3, null, '{"client":"claude-ai"}', true, null, 0);
  c(an, 60 * 20 + 2, "overview", null, true, null, 410);
  c(an, 60 * 20, "run_report", '{"report":"leases","from":"2026-04-01"}', true, null, 260);
  db.ai_agent_calls.push(...calls.sort((x, y) => (x.at < y.at ? 1 : -1)));
}

route("GET", "/ai/info", ({ user }) => {
  seed();
  const staff = can(user, "ai", "w") ? db.users.filter((u) => u.active && !PORTAL_ROLES.includes(u.role) && (u.role !== "super_admin" || user.role === "super_admin"))
    .map((u) => ({ id: u.id, name: u.name, role: u.role, role_label: ROLES[u.role] })).sort((a, b) => (a.name < b.name ? -1 : 1)) : [];
  return { mcp_url: MCP_URL, templates: AI.templates, calls_per_minute: AI.calls_per_minute, keep_calls_days: AI.keep_calls_days, key_prefix: AI.key_prefix,
    staff, tools: AI.tools, prompts: AI.prompts };
}, { perm: ["ai", "r"] });

route("GET", "/ai/agents", () => { seed(); return [...db.ai_agents].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map(pub); }, { perm: ["ai", "r"] });

function worksAs(user, uid) {
  const t = db.users.find((u) => u.id === uid);
  if (!t || !t.active) fail(422, "Choose an active staff login for the agent to work as");
  if (PORTAL_ROLES.includes(t.role)) fail(422, "An agent can only work as a staff login, not a customer login");
  if (t.role === "super_admin" && user.role !== "super_admin") fail(403, "Only a super admin can let an agent work as a super admin");
  return t;
}

function clean(body, partial = false) {
  const out = {};
  if ("name" in body || !partial) {
    const name = String(body.name || "").trim().slice(0, 60);
    if (!name) fail(422, "Give the agent a name");
    out.name = name;
  }
  if ("purpose" in body) out.purpose = String(body.purpose || "").trim().slice(0, 2000);
  if ("access" in body || !partial) {
    const acc = body.access || "read";
    if (!["read", "write"].includes(acc)) fail(422, "Access is read or write");
    out.access = acc;
  }
  if ("expires_on" in body) {
    const exp = body.expires_on || null;
    if (exp && !/^\d{4}-\d{2}-\d{2}$/.test(exp)) fail(422, "Expiry date should look like 2026-12-31");
    out.expires_on = exp;
  }
  if ("template" in body) out.template = TEMPLATE_KEYS.has(body.template) ? body.template : null;
  return out;
}

const issue = (a, key) => ({ agent: pub(a), key, mcp_url: MCP_URL, url_with_key: `${MCP_URL}?key=${key}` });
const find = (id) => db.ai_agents.find((a) => a.id === id) || fail(404, "Agent not found");

route("POST", "/ai/agents", ({ user, body }) => {
  seed();
  const data = clean(body);
  const t = worksAs(user, body.user_id || user.id);
  const key = newKey();
  const a = { id: newId(), purpose: "", template: null, expires_on: null, ...data, user_id: t.id, active: true, revoked: false, key_hash: "preview",
    key_prefix: key.slice(0, 10), key_version: 1, created_by: user.id, created_by_name: user.name, created_at: nowIso(), updated_at: nowIso(),
    last_used_at: null, last_ip: null, last_client: null, calls_total: 0 };
  db.ai_agents.push(a);
  audit(user, "ai_agent_created", "ai_agents", a.id, { name: a.name, works_as: t.name, access: a.access });
  return issue(a, key);
}, { perm: ["ai", "w"] });

route("PATCH", "/ai/agents/:id", ({ user, body, params }) => {
  const a = find(params.id);
  if (a.revoked) fail(409, "This agent's key was revoked. Make a new agent instead.");
  const upd = clean(body, true);
  if (body.user_id && body.user_id !== a.user_id) upd.user_id = worksAs(user, body.user_id).id;
  if ("active" in body) upd.active = !!body.active;
  Object.assign(a, upd, { updated_at: nowIso() });
  audit(user, upd.active === false ? "ai_agent_paused" : "ai_agent_changed", "ai_agents", a.id, { name: a.name });
  return pub(a);
}, { perm: ["ai", "w"] });

route("POST", "/ai/agents/:id/rotate", ({ user, params }) => {
  const a = find(params.id);
  if (a.revoked) fail(409, "This agent's key was revoked. Make a new agent instead.");
  const key = newKey();
  Object.assign(a, { key_prefix: key.slice(0, 10), key_version: (a.key_version || 1) + 1, updated_at: nowIso() });
  audit(user, "ai_agent_new_key", "ai_agents", a.id, { name: a.name });
  return issue(a, key);
}, { perm: ["ai", "w"] });

route("POST", "/ai/agents/:id/revoke", ({ user, params }) => {
  const a = find(params.id);
  Object.assign(a, { revoked: true, active: false, revoked_at: nowIso(), revoked_by: user.name, key_version: (a.key_version || 1) + 1, updated_at: nowIso() });
  audit(user, "ai_agent_revoked", "ai_agents", a.id, { name: a.name });
  return pub(a);
}, { perm: ["ai", "w"] });

route("GET", "/ai/calls", ({ query }) => {
  seed();
  let rows = db.ai_agent_calls;
  if (query.agent_id) rows = rows.filter((c) => c.agent_id === query.agent_id);
  if (query.errors === "true" || query.errors === true) rows = rows.filter((c) => !c.ok);
  const page = Math.max(1, Number(query.page) || 1);
  return { items: rows.slice((page - 1) * 50, page * 50), total: rows.length, page, size: 50 };
}, { perm: ["ai", "r"] });
