"""AI agents and the MCP endpoint.

Directors and super admins create agents in the staff app (Team & admin -> AI agents & MCP). Each agent works as one
staff login: that person's role, branches and record scope apply, every change it makes is in the audit log as
"<person> (AI agent: <agent>)", and on top of the role it is held to read only or read & write, and never deletes,
decides approvals, records money, or touches logins, settings, the website or the vault (core.agent_blocked).

MCP: POST /api/mcp, JSON-RPC 2.0 over Streamable HTTP (plain JSON answers, no session). The key goes in
"Authorization: Bearer sae_...", "X-API-Key: sae_..." or "?key=sae_..." (the last one for apps that only take an
address; it then shows in web-server access logs). Keys are stored as SHA-256 hashes and shown once. 240 calls a
minute per agent. Every call is kept in ai_agent_calls for 90 days.

Each tool runs as an ordinary API request inside this server, signed with a two-minute token for the agent, so the
same permission checks, branch limits, numbering, notifications and audit trail apply as when the person uses the app.
"""
import asyncio
import csv
import hashlib
import io
import json
import os
import random
import re
import secrets
import time
from datetime import timedelta

import httpx
from fastapi import APIRouter, Request, Depends, HTTPException
from fastapi.responses import JSONResponse, Response
from fastapi.routing import APIRoute

from core import (db, require, audit, can, now, now_iso, new_id, today_ist, get_settings, SITE_URL, ROLES, PORTAL_ROLES, PERMS,
                  client_ip, agent_identity, agent_is_live, agent_blocked, make_agent_token, REQ_BRANCH, logger, AGENT_WRITE)

router = APIRouter()

APP_NAME = "Sellandiamman Estates"
KEY_PREFIX = "sae_"
CALLS_PER_MINUTE = 240
KEEP_CALLS_DAYS = 90
PROTOCOLS = ("2025-06-18", "2025-03-26", "2024-11-05")
MAX_TEXT = 60000

# Ready-made jobs. The person still chooses which staff login the agent works as; the suggestion follows the job.
TEMPLATES = [
    {"key": "analyst", "name": "Business analyst", "access": "read", "roles": ["director", "super_admin"],
     "purpose": "Answer questions about how the business is doing: enquiries and conversion, deals and commission, rent collected and arrears, "
                "occupancy and short-stay income, branch scores, investor returns. Read only. Say which screen or report each figure comes from "
                "and the dates it covers."},
    {"key": "sales", "name": "Sales assistant", "access": "write", "roles": ["sales_agent", "branch_manager"],
     "purpose": "Keep enquiries moving: find leads waiting for a first reply or with an overdue follow-up, log calls and WhatsApp chats as activities, "
                "set the next follow-up, book site visits and find matching listings. Never change prices, offers or commission."},
    {"key": "collections", "name": "Rent & collections assistant", "access": "read", "roles": ["accountant"],
     "purpose": "Track money owed: rent arrears by lease and age, tenant bills due (EB, water, maintenance), payments tenants say they made that are "
                "waiting for a check, owner statements and payouts. Prepare calling lists; don't record payments."},
    {"key": "care", "name": "Property care desk", "access": "write", "roles": ["property_manager"],
     "purpose": "Look after tenants' and owners' service requests: log repairs and cleaning as requests, reply in the request thread, raise work orders "
                "for vendors and make sure every urgent request has someone on it. Leases ending in the next 60 days need a renewal call."},
    {"key": "stays", "name": "Short-stay desk", "access": "write", "roles": ["shortstay_ops"],
     "purpose": "Run the short-stay calendar: arrivals and departures this week, bookings missing guest details, clashes between platforms, "
                "cleaning between stays and dates to close. Prices and payouts stay with people."},
    {"key": "listings", "name": "Listings assistant", "access": "read", "roles": ["marketing", "branch_manager"],
     "purpose": "Keep the listings healthy: properties waiting for photos, verification or authorisation, listings with no enquiries, "
                "which lead sources and campaigns bring buyers and tenants. Read only; the website is published by people."},
]
TEMPLATE_KEYS = {t["key"] for t in TEMPLATES}


# ------------------------------------------------------------------ record types (the app's lists, as the AI sees them)
def _rt(label, group, module, about, list_path, get=None, create=None, update=None, actions=None, related=None, title=("name", "title")):
    return {"label": label, "group": group, "module": module, "about": about, "list": list_path, "get": get, "create": create,
            "update": update, "actions": actions or {}, "related": related or {}, "title": title}


RECORD_TYPES = {
    "leads": _rt("Leads", "Customers & sales", "leads", "Enquiries from the website, property portals, calls and walk-ins, each with a stage, "
                 "an owner (assigned_to) and a next follow-up.", "/api/leads", "/api/leads/{id}", "/api/leads", ("PATCH", "/api/leads/{id}"),
                 {"log_activity": ("POST", "/api/leads/{id}/activities", "Log a call, WhatsApp, email, visit or note (and the next follow-up)"),
                  "book_site_visit": ("POST", "/api/leads/{id}/site-visits", "Book a site visit to a property"),
                  "share_listings": ("POST", "/api/leads/{id}/share-listings", "Send the lead a set of listings"),
                  "convert": ("POST", "/api/leads/{id}/convert", "Turn the lead into a deal")},
                 {"matching_listings": "/api/leads/{id}/matches"}),
    "customers": _rt("Customers", "Customers & sales", "customers", "One record per person or business (matched by mobile), linked to their "
                     "enquiries, deals, leases, stays and investments.", "/api/customers", "/api/customers/{id}", "/api/customers",
                     ("PATCH", "/api/customers/{id}"), {"add_note": ("POST", "/api/customers/{id}/notes", "Add a note to the customer's record")}),
    "properties": _rt("Properties", "Customers & sales", "properties", "Property register: homes, plots, shops, offices, industrial sheds and "
                      "short-stay homes, third-party owned unless marked company-owned; listing status and authorisation.",
                      "/api/properties", "/api/properties/{id}", "/api/properties", ("PATCH", "/api/properties/{id}"),
                      {"change_status": ("POST", "/api/properties/{id}/transition", "Move the listing on (e.g. under offer, rented, sold, withdrawn)")},
                      title=("title",)),
    "owners": _rt("Owners", "Customers & sales", "owners", "Property owners and lessors, including NRI owners.", "/api/owners",
                  "/api/owners/{id}", "/api/owners", ("PATCH", "/api/owners/{id}"), related={"statement": "/api/owners/{id}/statement"}),
    "deals": _rt("Deals", "Customers & sales", "deals", "Sales, rentals and leases being closed: stage, agreed value, expected commission, offers.",
                 "/api/deals", "/api/deals/{id}", "/api/deals", ("PATCH", "/api/deals/{id}"),
                 {"add_offer": ("POST", "/api/deals/{id}/offers", "Record an offer from a party")}, title=("title",)),
    "site_visits": _rt("Site visits", "Customers & sales", "leads", "Visits booked for leads, with time, status and feedback.", "/api/site-visits",
                       update=("PATCH", "/api/site-visits/{id}"), title=("lead_name", "property_title")),
    "agreements": _rt("Agreements", "Customers & sales", "agreements", "Rental, lease, sale, brokerage, management and co-investment agreements "
                      "(drafts, final, signed).", "/api/agreements", "/api/agreements/{id}", "/api/agreements", ("PATCH", "/api/agreements/{id}"),
                      title=("title",)),
    "leases": _rt("Leases & rent", "Operations", "leases", "Leases with tenant, rent, deposit, end date, arrears and the rent schedule. Rent "
                  "received is owner money, held in the owner-funds ledger.", "/api/leases", "/api/leases/{id}", "/api/leases",
                  actions={"add_bill": ("POST", "/api/leases/{id}/charges", "Add a tenant bill (EB by meter reading, water, maintenance…)")},
                  title=("property_title", "tenant_name")),
    "tenant_bills": _rt("Tenant bills", "Operations", "leases", "EB, water, association maintenance and other bills on leases: amount, due date, "
                        "collected by us or paid to the provider, status.", "/api/charges", title=("label", "property_title")),
    "payment_notices": _rt("Payments tenants reported", "Operations", "leases", "\"I have paid\" notices from tenants (UPI reference), waiting "
                           "for staff to check against the bank.", "/api/payment-notices", title=("label", "tenant_name")),
    "service_requests": _rt("Service requests", "Operations", "maintenance", "Repairs, cleaning, documents and questions from tenants, owners, "
                            "buyers and investors, with a conversation, priority, reply and fix targets.", "/api/tickets", "/api/tickets/{id}",
                            "/api/tickets", ("PATCH", "/api/tickets/{id}"),
                            {"reply": ("POST", "/api/tickets/{id}/messages", "Reply in the request thread, or add an internal note"),
                             "make_work_order": ("POST", "/api/tickets/{id}/work-order", "Raise a work order for a vendor from the request")},
                            {"categories_and_targets": "/api/tickets/options", "counts": "/api/tickets/stats"}, title=("title",)),
    "work_orders": _rt("Work orders", "Operations", "maintenance", "Repair and maintenance jobs for vendors, with quote, cost and who pays.",
                       "/api/work-orders", create="/api/work-orders", update=("PATCH", "/api/work-orders/{id}"), title=("title",)),
    "vendors": _rt("Vendors", "Operations", "maintenance", "Plumbers, electricians, cleaners and other vendors.", "/api/vendors", create="/api/vendors"),
    "stay_bookings": _rt("Short-stay bookings", "Operations", "shortstay", "Bookings from Airbnb, Booking.com, MakeMyTrip, Agoda, the website "
                         "and direct, with guest, nights, gross, fees and status.", "/api/bookings", create="/api/bookings",
                         update=("PATCH", "/api/bookings/{id}"),
                         actions={"set_status": ("PATCH", "/api/bookings/{id}/status", "Check in, check out or mark no-show"),
                                  "cancel": ("POST", "/api/bookings/{id}/cancel", "Cancel the booking"),
                                  "log_issue": ("POST", "/api/bookings/{id}/issues", "Note a damage or guest issue")},
                         title=("property_title", "guest_name")),
    "stay_homes": _rt("Short-stay homes", "Operations", "shortstay", "Homes run as short stays and their platforms.", "/api/short-stay/units",
                      title=("title",)),
    "tasks": _rt("Tasks", "Work", "tasks", "Tasks for the team, with assignee, due date and priority.", "/api/tasks", create="/api/tasks",
                 update=("PATCH", "/api/tasks/{id}"), title=("title",)),
    "approvals": _rt("Approvals", "Work", "dashboard", "Requests waiting for a decision (publishing, discounts, refunds…). AI agents can read them; "
                     "people decide.", "/api/approvals", title=("summary", "kind")),
    "documents": _rt("Documents", "Operations", "documents", "Files stored against properties, leases, owners and customers, with type and expiry. "
                     "The files themselves open only in the app.", "/api/documents", title=("original_name",)),
    "invoices": _rt("Invoices", "Money", "finance", "Commission and service invoices with totals, payments and status.", "/api/invoices",
                    "/api/invoices/{id}", title=("customer_name", "number")),
    "expenses": _rt("Expenses", "Money", "finance", "Company and owner expenses by category and vendor.", "/api/expenses", title=("description",)),
    "owner_statements": _rt("Owner statements", "Money", "finance", "Monthly statements per owner: rent collected, fee, expenses, bills, net "
                            "payable and payout status.", "/api/owner-statements", title=("owner_name", "month")),
    "investors": _rt("Investors", "Money", "investors", "Co-investors with holdings, value now, payouts and returns.", "/api/investors",
                     "/api/investors/{id}", "/api/investors", ("PATCH", "/api/investors/{id}")),
    "investment_projects": _rt("Investment projects", "Money", "investors", "Co-investment projects: raised, value, payouts, return.",
                               "/api/inv-projects", "/api/inv-projects/{id}", "/api/inv-projects", ("PATCH", "/api/inv-projects/{id}"),
                               {"post_update": ("POST", "/api/inv-projects/{id}/updates", "Post a progress update for the project's investors")}),
    "campaigns": _rt("Campaigns", "Website & marketing", "cms", "Marketing campaigns with their lead codes, budgets, leads and wins.", "/api/campaigns",
                     create="/api/campaigns"),
}
CODE_FIELDS = ("code", "number", "listing_id", "receipt_no")
SEARCHABLE = ("leads", "customers", "properties", "owners", "investors", "service_requests", "agreements", "documents")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


# ------------------------------------------------------------------ keys
def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def new_key() -> str:
    return KEY_PREFIX + secrets.token_urlsafe(30)


def base_url(request: Request) -> str:
    if SITE_URL:
        return SITE_URL
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme).split(",")[0].strip()
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "localhost").split(",")[0].strip()
    return f"{proto}://{host}"


def status_of(a):
    if a.get("revoked"):
        return "revoked"
    if a.get("expires_on") and a["expires_on"] < today_ist().isoformat():
        return "expired"
    return "active" if a.get("active") else "paused"


async def public_agents(rows):
    ids = list({a["user_id"] for a in rows})
    users = {u["id"]: u for u in await db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1, "role": 1, "active": 1}).to_list(500)}
    out = []
    for a in rows:
        u = users.get(a["user_id"]) or {}
        d = {k: v for k, v in a.items() if k not in ("_id", "key_hash")}
        d.update({"status": status_of(a), "user_name": u.get("name"), "user_role": u.get("role"), "user_role_label": ROLES.get(u.get("role")),
                  "user_active": bool(u.get("active"))})
        out.append(d)
    return out


# ------------------------------------------------------------------ managing agents (people only; agents can't reach /api/ai)
@router.get("/ai/info")
async def ai_info(request: Request, user=Depends(require("ai", "r"))):
    staff = []
    if can(user, "ai", "w"):
        rows = await db.users.find({"active": True, "role": {"$nin": list(PORTAL_ROLES)}}, {"_id": 0, "id": 1, "name": 1, "role": 1}).sort("name", 1).to_list(500)
        staff = [{**u, "role_label": ROLES.get(u["role"])} for u in rows if u["role"] != "super_admin" or user["role"] == "super_admin"]
    return {"mcp_url": f"{base_url(request)}/api/mcp", "templates": TEMPLATES, "calls_per_minute": CALLS_PER_MINUTE, "keep_calls_days": KEEP_CALLS_DAYS,
            "key_prefix": KEY_PREFIX, "staff": staff,
            "tools": [{"name": t["name"], "title": t["title"], "description": t["description"].split("\n")[0], "write": t.get("write", False)} for t in TOOLS],
            "prompts": [{"name": p["name"], "title": p["title"], "description": p["description"]} for p in PROMPTS]}


@router.get("/ai/agents")
async def ai_agents(user=Depends(require("ai", "r"))):
    rows = await db.ai_agents.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return await public_agents(rows)


async def _works_as(user, uid):
    target = await db.users.find_one({"id": uid}, {"_id": 0, "id": 1, "role": 1, "active": 1, "name": 1})
    if not target or not target.get("active"):
        raise HTTPException(422, "Choose an active staff login for the agent to work as")
    if target["role"] in PORTAL_ROLES:
        raise HTTPException(422, "An agent can only work as a staff login, not a customer login")
    if target["role"] == "super_admin" and user["role"] != "super_admin":
        raise HTTPException(403, "Only a super admin can let an agent work as a super admin")
    return target


def _clean(body, partial=False):
    out = {}
    if "name" in body or not partial:
        name = str(body.get("name") or "").strip()[:60]
        if not name:
            raise HTTPException(422, "Give the agent a name")
        out["name"] = name
    if "purpose" in body:
        out["purpose"] = str(body.get("purpose") or "").strip()[:2000]
    if "access" in body or not partial:
        acc = body.get("access") or "read"
        if acc not in ("read", "write"):
            raise HTTPException(422, "Access is read or write")
        out["access"] = acc
    if "expires_on" in body:
        exp = body.get("expires_on") or None
        if exp and not re.match(r"^\d{4}-\d{2}-\d{2}$", str(exp)):
            raise HTTPException(422, "Expiry date should look like 2026-12-31")
        out["expires_on"] = exp
    if "template" in body:
        out["template"] = body.get("template") if body.get("template") in TEMPLATE_KEYS else None
    return out


@router.post("/ai/agents")
async def ai_create(body: dict, request: Request, user=Depends(require("ai", "w"))):
    data = _clean(body)
    target = await _works_as(user, body.get("user_id") or user["id"])
    key = new_key()
    doc = {"id": new_id(), **data, "purpose": data.get("purpose", ""), "template": data.get("template"), "expires_on": data.get("expires_on"),
           "user_id": target["id"], "active": True, "revoked": False, "key_hash": hash_key(key), "key_prefix": key[:10], "key_version": 1,
           "created_by": user["id"], "created_by_name": user["name"], "created_at": now_iso(), "updated_at": now_iso(),
           "last_used_at": None, "last_ip": None, "last_client": None, "calls_total": 0}
    await db.ai_agents.insert_one(dict(doc))
    await audit(user, "ai_agent_created", "ai_agents", doc["id"], {"name": doc["name"], "works_as": target["name"], "access": doc["access"]})
    mcp = f"{base_url(request)}/api/mcp"
    return {"agent": (await public_agents([doc]))[0], "key": key, "mcp_url": mcp, "url_with_key": f"{mcp}?key={key}"}


async def _agent_or_404(aid):
    a = await db.ai_agents.find_one({"id": aid}, {"_id": 0})
    if not a:
        raise HTTPException(404, "Agent not found")
    return a


@router.patch("/ai/agents/{aid}")
async def ai_update(aid: str, body: dict, user=Depends(require("ai", "w"))):
    a = await _agent_or_404(aid)
    if a.get("revoked"):
        raise HTTPException(409, "This agent's key was revoked. Make a new agent instead.")
    upd = _clean(body, partial=True)
    if "user_id" in body and body["user_id"] and body["user_id"] != a["user_id"]:
        upd["user_id"] = (await _works_as(user, body["user_id"]))["id"]
    if "active" in body:
        upd["active"] = bool(body["active"])
    if not upd:
        return (await public_agents([a]))[0]
    upd["updated_at"] = now_iso()
    await db.ai_agents.update_one({"id": aid}, {"$set": upd})
    changed = {k: v for k, v in upd.items() if k not in ("updated_at", "purpose")}
    await audit(user, "ai_agent_paused" if upd.get("active") is False else "ai_agent_changed", "ai_agents", aid, {"name": a["name"], **changed})
    return (await public_agents([await _agent_or_404(aid)]))[0]


@router.post("/ai/agents/{aid}/rotate")
async def ai_rotate(aid: str, request: Request, user=Depends(require("ai", "w"))):
    a = await _agent_or_404(aid)
    if a.get("revoked"):
        raise HTTPException(409, "This agent's key was revoked. Make a new agent instead.")
    key = new_key()
    await db.ai_agents.update_one({"id": aid}, {"$set": {"key_hash": hash_key(key), "key_prefix": key[:10], "updated_at": now_iso()}, "$inc": {"key_version": 1}})
    await audit(user, "ai_agent_new_key", "ai_agents", aid, {"name": a["name"]})
    mcp = f"{base_url(request)}/api/mcp"
    return {"agent": (await public_agents([await _agent_or_404(aid)]))[0], "key": key, "mcp_url": mcp, "url_with_key": f"{mcp}?key={key}"}


@router.post("/ai/agents/{aid}/revoke")
async def ai_revoke(aid: str, user=Depends(require("ai", "w"))):
    a = await _agent_or_404(aid)
    await db.ai_agents.update_one({"id": aid}, {"$set": {"revoked": True, "active": False, "revoked_at": now_iso(), "revoked_by": user["name"],
                                                          "updated_at": now_iso()}, "$inc": {"key_version": 1}})
    await audit(user, "ai_agent_revoked", "ai_agents", aid, {"name": a["name"]})
    return (await public_agents([await _agent_or_404(aid)]))[0]


@router.get("/ai/calls")
async def ai_calls(user=Depends(require("ai", "r")), agent_id: str = "", errors: bool = False, page: int = 1):
    f = {}
    if agent_id:
        f["agent_id"] = agent_id
    if errors:
        f["ok"] = False
    total = await db.ai_agent_calls.count_documents(f)
    rows = await db.ai_agent_calls.find(f, {"_id": 0}).sort("at", -1).skip((max(1, page) - 1) * 50).limit(50).to_list(50)
    return {"items": rows, "total": total, "page": page, "size": 50}


# ------------------------------------------------------------------ MCP: running a tool as the agent
class ToolError(Exception):
    pass


class Ctx:
    def __init__(self, request: Request, agent: dict, user: dict):
        self.request, self.agent, self.user = request, agent, user
        self.write = agent.get("access") == "write"

    def can(self, module, action="r"):
        return can(self.user, module, action)

    async def api(self, method, path, params=None, body=None, raw=False, branch=None):
        """One request to this server's own API as the agent, with the person's permissions."""
        method = method.upper()
        if not path.startswith("/api/"):
            path = "/api/" + path.lstrip("/")
        why = agent_blocked(self.agent.get("access"), method, path.split("?")[0])
        if why:
            raise ToolError(why)
        headers = {"Authorization": f"Bearer {make_agent_token(self.agent)}", "X-Forwarded-For": client_ip(self.request),
                   "X-Forwarded-Host": self.request.headers.get("x-forwarded-host") or self.request.headers.get("host") or "",
                   "User-Agent": f"sae-ai-agent/{self.agent['id'][:8]}"}
        if branch:
            headers["X-Branch"] = str(branch)[:40]
        params = {k: (str(v).lower() if isinstance(v, bool) else v) for k, v in (params or {}).items() if v not in (None, "")}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.request.app), base_url="http://sae.internal", timeout=120) as c:
            r = await c.request(method, path, params=params, json=body if method in AGENT_WRITE else None, headers=headers)
        if r.status_code >= 400:
            try:
                detail = r.json().get("detail")
            except Exception:
                detail = r.text[:300]
            if isinstance(detail, list):  # validation errors
                detail = "; ".join(f"{'.'.join(str(x) for x in d.get('loc', [])[1:])}: {d.get('msg')}" for d in detail[:6])
            raise ToolError(f"{r.status_code}: {detail or 'Request failed'}")
        if raw:
            return r
        ctype = r.headers.get("content-type", "")
        if "json" in ctype:
            return r.json()
        if ctype.startswith("text/") and "html" not in ctype:
            return {"content_type": ctype, "text": r.text[:MAX_TEXT]}
        return {"file": True, "content_type": ctype, "bytes": len(r.content),
                "note": "This address returns a file (PDF, Word, calendar). Open it in the app; its figures are also available from the matching list or report."}


def compact(doc):
    """Drops empty values so answers stay short."""
    if isinstance(doc, dict):
        return {k: compact(v) for k, v in doc.items() if v not in (None, "", [], {}) and not (k == "deleted" and v is False)}
    if isinstance(doc, list):
        return [compact(x) for x in doc]
    return doc


def schema(props=None, required=None):
    return {"type": "object", "properties": props or {}, "required": required or [], "additionalProperties": False}


TYPE_ARG = {"type": "string", "description": "Record type from list_record_types, e.g. leads, customers, properties, leases, service_requests, stay_bookings"}
BRANCH_ARG = {"type": "string", "description": "Branch id (from whoami) to narrow to one branch; leave out for every branch the person may see"}


def _rtype(ctx, key):
    rt = RECORD_TYPES.get(key or "")
    if not rt or not ctx.can(rt["module"]):
        raise ToolError(f"Unknown or not available record type '{key}'. Use list_record_types.")
    return rt


def _items(res):
    if isinstance(res, dict):
        for k in ("items", "rows", "units", "results"):
            if isinstance(res.get(k), list):
                return res[k], res.get("total")
        return [], None
    return (res if isinstance(res, list) else []), None


def _title(rt, it):
    for k in rt["title"] + ("name", "title"):
        if it.get(k):
            return it[k]
    return None


def _code(it):
    return next((it[k] for k in CODE_FIELDS if it.get(k)), None)


_ROUTES = {}


def _route(app, method, path):
    """The FastAPI route for METHOD /api/path/{id} (path written with {id})."""
    if not _ROUTES:
        for r in app.routes:
            if isinstance(r, APIRoute):
                norm = re.sub(r"\{[^}]+\}", "{id}", r.path)
                for m in r.methods:
                    _ROUTES[(m, norm)] = r
    return _ROUTES.get((method, path))


def _model_fields(route):
    """Fields of a route's JSON body, from its Pydantic model."""
    if not route or route.body_field is None:
        return None
    model = getattr(route.body_field, "type_", None)
    if not hasattr(model, "model_json_schema"):
        return [{"note": "Free-form JSON object; see the app's form for the fields."}]
    sch = model.model_json_schema()
    defs = sch.get("$defs", {})
    req = set(sch.get("required", []))

    def one(name, p, required):
        if "$ref" in p:
            p = defs.get(p["$ref"].split("/")[-1], {})
        opts = p.get("anyOf") or [p]
        typ, choices, inner, pattern = [], None, None, p.get("pattern")
        for o in opts:
            pattern = pattern or o.get("pattern")
            if "$ref" in o:
                o = defs.get(o["$ref"].split("/")[-1], {})
                typ.append("object")
                inner = o
                continue
            if o.get("enum"):
                choices = o["enum"]
            t = o.get("type")
            if t and t != "null":
                typ.append(t)
            if t == "array" and o.get("items"):
                it = o["items"]
                if "$ref" in it:
                    inner = defs.get(it["$ref"].split("/")[-1], {})
                elif it.get("enum"):
                    choices = it["enum"]
        m = re.fullmatch(r"\^\(([\w|]+)\)\$", pattern or "")
        if m and not choices:
            choices, pattern = m.group(1).split("|"), None
        d = {"key": name, "type": "/".join(dict.fromkeys(typ)) or "any", "required": required or None, "choices": choices,
             "format": pattern, "default": p.get("default"), "about": p.get("description")}
        if inner and inner.get("properties"):
            ireq = set(inner.get("required", []))
            d["fields"] = [one(k, v, k in ireq) for k, v in inner["properties"].items()]
        return compact(d)
    return [one(k, v, k in req) for k, v in (sch.get("properties") or {}).items()]


def _query_params(route):
    return [p.name for p in route.dependant.query_params] if route else []


# ---- tools
async def t_whoami(ctx: Ctx, a):
    s = await get_settings()
    branches = await db.branches.find({}, {"_id": 0, "id": 1, "name": 1, "city": 1, "is_head_office": 1}).to_list(50)
    allowed = ctx.user.get("branch_ids") or []
    all_b = ctx.user["role"] in ("super_admin", "director") or not allowed
    team = await db.users.find({"active": True, "role": {"$nin": list(PORTAL_ROLES)}}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(300)
    return compact({"agent": ctx.agent["name"], "job": ctx.agent.get("purpose") or None,
                    "access": "read & write (never deletes, never records money)" if ctx.write else "read only",
                    "works_as": {"name": ctx.user["name"], "role": ROLES.get(ctx.user["role"]), "email": ctx.user.get("email")},
                    "branches": [b for b in branches if all_b or b["id"] in allowed],
                    "can_open": sorted(m for m, p in PERMS.get(ctx.user["role"], {}).items() if "r" in p and m not in ("ai", "vault", "users", "settings")),
                    "team": [{"id": u["id"], "name": u["name"], "role": ROLES.get(u["role"])} for u in team],
                    "company": s.get("name") or APP_NAME, "today": today_ist().isoformat(), "timezone": "Asia/Kolkata (IST)",
                    "currency": "INR (₹); lakh (L) = 1,00,000 and crore (Cr) = 1,00,00,000"})


async def _try(ctx, path, params=None):
    try:
        return await ctx.api("GET", path, params)
    except ToolError as ex:
        return {"not_available": str(ex)}


async def t_overview(ctx: Ctx, a):
    out = {}
    if ctx.can("dashboard"):
        out["dashboard"] = await _try(ctx, "/api/dashboard")
    if ctx.can("ceo"):
        ceo = await _try(ctx, "/api/ceo/dashboard")
        if isinstance(ceo, dict) and "not_available" not in ceo:
            ceo = {k: ceo.get(k) for k in ("score", "health", "alerts", "kpis", "totals", "range") if ceo.get(k) is not None} or ceo
        out["ceo_view"] = ceo
    ap = await _try(ctx, "/api/approvals")
    items, _ = _items(ap)
    pend = [x for x in items if x.get("status") in (None, "pending")]
    out["approvals_waiting"] = {"count": len(pend), "items": [compact({k: x.get(k) for k in ("kind", "summary", "requested_by_name", "created_at")}) for x in pend[:15]],
                                "note": "AI agents can't decide approvals; a person decides them in the app."}
    if ctx.can("tasks"):
        tasks, _ = _items(await _try(ctx, "/api/tasks"))
        mine = [t for t in tasks if t.get("assigned_to") == ctx.user["id"] and t.get("status") not in ("done", "cancelled")]
        out["my_open_tasks"] = [compact({k: t.get(k) for k in ("id", "title", "due_date", "priority", "status")}) for t in mine[:20]]
    if ctx.can("maintenance"):
        out["service_requests"] = await _try(ctx, "/api/tickets/stats")
    notes = await _try(ctx, "/api/notifications")
    if isinstance(notes, list):
        out["unread_notifications"] = [compact({k: n.get(k) for k in ("title", "body", "created_at")}) for n in notes if not n.get("read")][:15]
    return compact(out)


async def t_list_types(ctx: Ctx, a):
    groups = {}
    for k, rt in RECORD_TYPES.items():
        if not ctx.can(rt["module"]):
            continue
        w = ctx.write and ctx.can(rt["module"], "w")
        writes = [x for x in (("add" if rt["create"] else None), ("change" if rt["update"] else None)) if x]
        acts = [n for n, (m, p, _) in rt["actions"].items() if agent_blocked(ctx.agent.get("access"), m, p.replace("{id}", "x")) is None] if w else []
        groups.setdefault(rt["group"], []).append(compact({"type": k, "label": rt["label"], "about": rt["about"],
                                                           "you_can": ["read"] + (writes if w else []) + acts}))
    order = ["Customers & sales", "Operations", "Work", "Money", "Website & marketing"]
    return {"groups": [{"group": g, "types": groups[g]} for g in order if g in groups],
            "tip": "describe_record_type gives the filters, fields and actions of a type."}


async def t_describe(ctx: Ctx, a):
    rt = _rtype(ctx, a.get("type"))
    app = ctx.request.app
    w = ctx.write and ctx.can(rt["module"], "w")
    lr = _route(app, "GET", rt["list"])
    out = {"type": a["type"], "label": rt["label"], "about": rt["about"],
           "list_filters": [q for q in _query_params(lr) if q not in ("page", "limit")],
           "search": "query looks in names, codes, phones and titles" if "q" in _query_params(lr) else "no text search on this list; filter on fields instead",
           "open_one": "get_record by id or code" + ("" if rt["get"] else " (looked up from the list)")}
    if w and rt["create"]:
        out["fields_to_add"] = _model_fields(_route(app, "POST", rt["create"]))
    if w and rt["update"]:
        out["fields_to_change"] = _model_fields(_route(app, rt["update"][0], rt["update"][1]))
    if w:
        acts = []
        for name, (m, p, about) in rt["actions"].items():
            if agent_blocked(ctx.agent.get("access"), m, p.replace("{id}", "x")):
                continue
            acts.append(compact({"action": name, "what": about, "fields": _model_fields(_route(app, m, p))}))
        out["actions"] = acts
    if rt["related"]:
        out["related_screens"] = {k: v for k, v in rt["related"].items()}
    out["notes"] = ("Refer to other records by id. Dates YYYY-MM-DD, date-times ISO in India time. Money in rupees as plain numbers. "
                    "Codes and totals are given by the system. Phone numbers as 10-digit Indian mobiles.")
    return compact(out)


async def t_search(ctx: Ctx, a):
    q = str(a.get("query") or "").strip()
    if len(q) < 2:
        raise ToolError("Search needs at least 2 characters")
    keys = [k for k in SEARCHABLE if ctx.can(RECORD_TYPES[k]["module"])]

    async def one(k):
        rt = RECORD_TYPES[k]
        try:
            res = await ctx.api("GET", rt["list"], {"q": q, **({"limit": 8} if k == "customers" else {})})
        except ToolError:
            return k, []
        items, _ = _items(res)
        return k, [compact({"id": it.get("id"), "code": _code(it), "name": _title(rt, it),
                            "status": it.get("status") or it.get("stage"), "phone": it.get("phone")}) for it in items[:8]]
    found = await asyncio.gather(*(one(k) for k in keys))
    return {"query": q, "results": {k: v for k, v in found if v}, "searched": keys}


def _match(it, filters):
    for k, v in filters.items():
        have = it.get(k)
        if v == "__empty":
            if have not in (None, "", []):
                return False
            continue
        want = v if isinstance(v, list) else [v]
        want = [str(x).lower() for x in want]
        if isinstance(have, list):
            if not any(str(x).lower() in want for x in have):
                return False
        elif str(have).lower() not in want:
            return False
    return True


def _summarise(item):
    out = {}
    for k, v in item.items():
        if isinstance(v, list) and len(v) > 3 and v and isinstance(v[0], dict):
            out[k] = f"{len(v)} entries (get_record for detail)"
        elif k in ("photo", "images") and isinstance(v, list):
            out[k] = f"{len(v)} images"
        else:
            out[k] = v
    return out


async def _fetch(ctx, rt, a, server_params=None):
    lr = _route(ctx.request.app, "GET", rt["list"])
    qp = _query_params(lr)
    params = dict(server_params or {})
    if a.get("query") and "q" in qp:
        params["q"] = a["query"]
    rest = {}
    for k, v in (a.get("filters") or {}).items():
        if k in qp and not isinstance(v, list) and v != "__empty":
            params[k] = v
        else:
            rest[k] = v
    if "limit" in qp:
        params["limit"] = 500
    items, total = _items(await ctx.api("GET", rt["list"], params, branch=a.get("branch")))
    if a.get("query") and "q" not in qp:
        ql = str(a["query"]).lower()
        items = [it for it in items if ql in json.dumps(it, ensure_ascii=False, default=str).lower()]
    if rest:
        items = [it for it in items if _match(it, rest)]
    return items


async def t_list(ctx: Ctx, a):
    rt = _rtype(ctx, a.get("type"))
    items = await _fetch(ctx, rt, a)
    df = a.get("date_field") or next((k for k in ("date", "due_date", "check_in", "scheduled_at", "issue_date", "start_date", "created_at")
                                      if items and k in items[0]), "created_at")
    if a.get("from") or a.get("to"):
        lo, hi = a.get("from") or "", a.get("to") or "9999"
        items = [it for it in items if lo <= str(it.get(df) or "")[:10] <= hi]
    if a.get("sort"):
        key = a["sort"].lstrip("-")

        def sk(it):
            v = it.get(key)
            return (0, v, "") if isinstance(v, (int, float)) and not isinstance(v, bool) else (1, 0, str(v))
        have = sorted((it for it in items if it.get(key) not in (None, "")), key=sk, reverse=a["sort"].startswith("-"))
        items = have + [it for it in items if it.get(key) in (None, "")]
    size = max(1, min(100, int(a.get("page_size") or 20)))
    page = max(1, int(a.get("page") or 1))
    chunk = items[(page - 1) * size: page * size]
    fields = a.get("fields")
    if fields:
        chunk = [{k: v for k, v in it.items() if k in fields or k in ("id",) + CODE_FIELDS} for it in chunk]
    else:
        chunk = [_summarise(it) for it in chunk]
    return {"type": a["type"], "total": len(items), "page": page, "page_size": size, "items": compact(chunk),
            "more": len(items) > page * size or None, "date_field": df if (a.get("from") or a.get("to")) else None}


async def _find(ctx, rt, rid, typ):
    rid = str(rid).strip()
    if UUID_RE.match(rid) and rt["get"]:
        return rid, None
    items = await _fetch(ctx, rt, {"query": rid})
    if not items and UUID_RE.match(rid):
        items = await _fetch(ctx, rt, {})
    low = rid.lower()
    hit = next((x for x in items if x.get("id") == rid or str(_code(x) or "").lower() == low
                or any(str(x.get(k, "")).lower() == low for k in CODE_FIELDS)), None)
    if not hit and len(items) == 1:
        hit = items[0]
    if not hit:
        raise ToolError(f"No {typ} record with id or code '{rid}'")
    return hit["id"], hit


async def t_get(ctx: Ctx, a):
    rt = _rtype(ctx, a.get("type"))
    rid, hit = await _find(ctx, rt, a.get("id"), a["type"])
    doc = await ctx.api("GET", rt["get"].replace("{id}", rid)) if rt["get"] else hit
    out = {"record": compact(doc)}
    out["related_screens"] = None
    if a.get("include_history") and ctx.can("audit"):
        try:
            hist = await ctx.api("GET", "/api/audit", {"entity_id": rid})
            out["history"] = [compact({k: h.get(k) for k in ("at", "user_name", "action", "details")}) for h in hist[:40]]
        except ToolError as ex:
            out["history"] = str(ex)
    if rt["related"]:
        out["related_screens"] = {k: v.replace("{id}", rid) for k, v in rt["related"].items()}
    return compact(out)


def _need_write(ctx, rt, what):
    if not ctx.write:
        raise ToolError("This agent has read-only access.")
    if not ctx.can(rt["module"], "w"):
        raise ToolError(f"{ctx.user['name']} can't {what} {rt['label'].lower()}.")


async def t_create(ctx: Ctx, a):
    rt = _rtype(ctx, a.get("type"))
    _need_write(ctx, rt, "add")
    if not rt["create"]:
        raise ToolError(f"{rt['label']} can't be added through the AI tools.")
    doc = await ctx.api("POST", rt["create"], body=a.get("data") or {}, branch=a.get("branch"))
    if isinstance(doc, dict):
        return {"created": compact({k: doc.get(k) for k in ("id",) + CODE_FIELDS + ("status", "stage", "name", "title") if doc.get(k) is not None}),
                "record": compact(doc)}
    return {"created": doc}


async def t_update(ctx: Ctx, a):
    rt = _rtype(ctx, a.get("type"))
    _need_write(ctx, rt, "change")
    if not rt["update"]:
        raise ToolError(f"{rt['label']} can't be changed through the AI tools; describe_record_type lists its actions.")
    rid, _ = await _find(ctx, rt, a.get("id"), a["type"])
    doc = await ctx.api(rt["update"][0], rt["update"][1].replace("{id}", rid), body=a.get("changes") or {})
    return {"updated": True, "record": compact(doc) if isinstance(doc, dict) else doc}


async def t_action(ctx: Ctx, a):
    rt = _rtype(ctx, a.get("type"))
    _need_write(ctx, rt, "do that with")
    act = rt["actions"].get(a.get("action") or "")
    if not act:
        raise ToolError(f"Unknown action '{a.get('action')}' for {a['type']}. describe_record_type lists them.")
    rid, _ = await _find(ctx, rt, a.get("id"), a["type"])
    res = await ctx.api(act[0], act[1].replace("{id}", rid), body=a.get("data") or {})
    return {"done": a["action"], "result": compact(res) if isinstance(res, (dict, list)) else res}


def _report_list(ctx):
    from routes_admin import REPORTS
    out = []
    for k, (coll, module, cols) in REPORTS.items():
        if ctx.can(module) and (ctx.can(module, "e") or ctx.can("reports", "e")):
            out.append({"report": k, "columns": cols})
    return out


async def t_reports(ctx: Ctx, a):
    reps = _report_list(ctx)
    return {"reports": reps, "also": "The CEO view, owner statements, rent schedules and short-stay performance are screens: list_endpoints with "
                                     "'ceo', 'owner', 'lease' or 'short-stay'.",
            "none": None if reps else f"{ctx.user['name']} has no reports to export."}


async def t_run_report(ctx: Ctx, a):
    name = str(a.get("report") or "")
    if name not in {r["report"] for r in _report_list(ctx)}:
        raise ToolError(f"Unknown or not available report '{name}'. Use list_reports.")
    mx = max(1, min(1000, int(a.get("max_rows") or 200)))
    r = await ctx.api("GET", f"/api/reports/{name}.csv", {"frm": a.get("from"), "to": a.get("to")}, raw=True, branch=a.get("branch"))
    rows = list(csv.reader(io.StringIO(r.text)))
    cols, data = (rows[0], rows[1:]) if rows else ([], [])
    return {"report": name, "columns": cols, "rows": data[:mx], "total_rows": len(data), "truncated": len(data) > mx or None,
            "dates": {"from": a.get("from") or "all", "to": a.get("to") or "today"}}


ENDPOINT_HIDE = re.compile(r"^/api/(public|seo|robots|sitemap|llms|portal|tenant|buyer|investor|my|auth|vault|ai|mcp|files|share|health|"
                           r"openapi|docs|users(?!/lite)|team/me|automations)(/|\.|$)")
FILE_PATH = re.compile(r"\.(pdf|docx|csv|ics|json)$")


def _endpoints(ctx: Ctx):
    out = []
    for r in ctx.request.app.routes:
        if not isinstance(r, APIRoute) or ENDPOINT_HIDE.search(r.path) or FILE_PATH.search(r.path):
            continue
        for m in sorted(r.methods - {"HEAD", "OPTIONS"}):
            if m == "DELETE":
                continue
            ok = agent_blocked(ctx.agent.get("access"), m, re.sub(r"\{[^}]+\}", "x", r.path)) is None
            if m != "GET" and not ok:
                continue
            doc = (r.endpoint.__doc__ or "").strip().split("\n")[0]
            q = [p.name for p in r.dependant.query_params]
            out.append(compact({"method": m, "path": r.path, "what": doc or r.name.replace("_", " ").strip().capitalize(), "query": q or None,
                                "takes_body": m in AGENT_WRITE or None, "allowed": ok or None}))
    return out


async def t_endpoints(ctx: Ctx, a):
    f = str(a.get("filter") or "").lower()
    eps = [x for x in _endpoints(ctx) if not f or f in x["path"].lower() or f in x["what"].lower()]
    return {"endpoints": eps, "notes": "Paths with {braces} take an id. Lists of records are easier with the record tools. "
                                       "The person's role still decides what each one returns."}


async def t_call(ctx: Ctx, a):
    method = str(a.get("method") or "GET").upper()
    path = str(a.get("path") or "")
    bare = path.split("?")[0]
    if not path.startswith("/api/") or ".." in path or ENDPOINT_HIDE.search(bare):
        raise ToolError("Use a path from list_endpoints, starting with /api/")
    res = await ctx.api(method, path, a.get("query") or {}, a.get("body") if method != "GET" else None, branch=a.get("branch"))
    return compact(res) if isinstance(res, (dict, list)) else res


T_ARGS_LIST = {
    "type": TYPE_ARG,
    "query": {"type": "string", "description": "Text to look for (name, code, phone, title…)"},
    "filters": {"type": "object", "description": "Field = value, e.g. {\"stage\": \"new\"}, {\"status\": [\"open\", \"in_progress\"]}, {\"overdue\": true} "
                "or {\"next_follow_up\": \"__empty\"}. Filters from describe_record_type run on the server; other fields are matched on the results.",
                "additionalProperties": True},
    "from": {"type": "string", "description": "Start date YYYY-MM-DD (on date_field)"},
    "to": {"type": "string", "description": "End date YYYY-MM-DD"},
    "date_field": {"type": "string", "description": "Which date the range applies to (default: the record's main date, else created_at)"},
    "sort": {"type": "string", "description": "Field to sort by; '-' first for newest or largest first, e.g. -created_at, due_date, -arrears"},
    "page": {"type": "integer", "minimum": 1},
    "page_size": {"type": "integer", "minimum": 1, "maximum": 100, "description": "Default 20"},
    "fields": {"type": "array", "items": {"type": "string"}, "description": "Only these fields (id and code always come)"},
    "branch": BRANCH_ARG,
}

TOOLS = [
    {"name": "whoami", "title": "Who am I working as", "fn": t_whoami, "input": schema(),
     "description": "The agent, the staff login it works as (role, branches, what it can open), the team (for assigning), today's date in India and the "
                    "currency conventions. Start here."},
    {"name": "overview", "title": "Today's position", "fn": t_overview, "input": schema(),
     "description": "The person's dashboard for today: enquiries, deals, rent and short-stay figures, the CEO view and alerts (if allowed), approvals "
                    "waiting, their open tasks, service requests and unread notifications."},
    {"name": "list_record_types", "title": "Record types", "fn": t_list_types, "input": schema(),
     "description": "Every kind of record this agent can open (leads, customers, properties, owners, deals, leases, tenant bills, service requests, "
                    "short-stay bookings, invoices, owner statements, investors…), grouped like the app's menu, with what it may do on each."},
    {"name": "describe_record_type", "title": "Fields of a record type", "fn": t_describe, "input": schema({"type": TYPE_ARG}, ["type"]),
     "description": "The list filters, the fields to add or change (key, type, required, choices) and the actions of one record type. Read this before "
                    "adding, changing or filtering records."},
    {"name": "search", "title": "Search everything", "fn": t_search,
     "input": schema({"query": {"type": "string", "description": "Name, code, phone, title…"}}, ["query"]),
     "description": "Searches leads, customers, properties, owners, investors, service requests, agreements and documents at once."},
    {"name": "list_records", "title": "List records", "fn": t_list, "input": schema(T_ARGS_LIST, ["type"]),
     "description": "Records of one type with text search, field filters, a date range, sorting and pages. Long lists inside a record show as a count; "
                    "use get_record for the full record."},
    {"name": "get_record", "title": "Open a record", "fn": t_get,
     "input": schema({"type": TYPE_ARG, "id": {"type": "string", "description": "Record id, or its code such as SE-LD-00010, SE-P-0022, SE-LS-0001, "
                                                                                  "TK-00004 or an invoice number"},
                      "include_history": {"type": "boolean", "description": "Also return who changed what and when (if the person may read the audit log)"}},
                     ["type", "id"]),
     "description": "One record in full (a lead with its activities, a lease with its rent schedule, a request with its conversation…) and related screens."},
    {"name": "create_record", "title": "Add a record", "fn": t_create, "write": True,
     "input": schema({"type": TYPE_ARG, "data": {"type": "object", "description": "Field values by key (see describe_record_type). Leave out codes and totals.",
                                                  "additionalProperties": True}, "branch": BRANCH_ARG}, ["type", "data"]),
     "description": "Adds a record (a lead, a customer, a service request, a work order, a task, a booking…) exactly as a person would in the app: "
                    "numbering, branch, matching and notifications happen as usual. Confirm with the person first."},
    {"name": "update_record", "title": "Change a record", "fn": t_update, "write": True,
     "input": schema({"type": TYPE_ARG, "id": {"type": "string", "description": "Record id or code"},
                      "changes": {"type": "object", "description": "Only the fields to change", "additionalProperties": True}}, ["type", "id", "changes"]),
     "description": "Changes some fields of a record, with the same checks as the app. Confirm with the person first."},
    {"name": "run_action", "title": "Act on a record", "fn": t_action, "write": True,
     "input": schema({"type": TYPE_ARG, "id": {"type": "string", "description": "Record id or code"},
                      "action": {"type": "string", "description": "Action from describe_record_type, e.g. log_activity, book_site_visit, reply, make_work_order, add_bill"},
                      "data": {"type": "object", "description": "Fields the action needs (see describe_record_type)", "additionalProperties": True}},
                     ["type", "id", "action"]),
     "description": "Does one thing on a record: log a call on a lead, book a site visit, reply to a service request, raise a work order, add a tenant bill, "
                    "check a guest in… Money, approvals and deletes stay with people."},
    {"name": "list_reports", "title": "Reports", "fn": t_reports, "input": schema(),
     "description": "The reports this person may export (leads, deals, invoices, ledger, leases, bookings, work orders, properties, owner statements, "
                    "site visits, expenses, customers, agreements)."},
    {"name": "run_report", "title": "Run a report", "fn": t_run_report,
     "input": schema({"report": {"type": "string", "description": "Report key from list_reports"}, "from": {"type": "string", "description": "YYYY-MM-DD"},
                      "to": {"type": "string", "description": "YYYY-MM-DD"}, "branch": BRANCH_ARG,
                      "max_rows": {"type": "integer", "minimum": 1, "maximum": 1000, "description": "Default 200"}}, ["report"]),
     "description": "Runs a report for a date range and returns its columns and rows (the same as the spreadsheet download)."},
    {"name": "list_endpoints", "title": "Other screens", "fn": t_endpoints,
     "input": schema({"filter": {"type": "string", "description": "Word to narrow the list, e.g. ceo, owner, lease, short-stay, ledger, calendar, team"}}),
     "description": "The app's other screens as API addresses: CEO view, calendar, ledger balances, owner statements, short-stay calendar and performance, "
                    "lead matches, team chart, ticket options."},
    {"name": "call_api", "title": "Open a screen's data", "fn": t_call,
     "input": schema({"method": {"type": "string", "enum": ["GET", "POST", "PUT", "PATCH"], "description": "GET to read"},
                      "path": {"type": "string", "description": "Path from list_endpoints with ids filled in, e.g. /api/ceo/dashboard or /api/owners/<id>/statement"},
                      "query": {"type": "object", "description": "Query parameters", "additionalProperties": True},
                      "body": {"type": "object", "description": "JSON body for POST, PUT or PATCH", "additionalProperties": True},
                      "branch": BRANCH_ARG}, ["path"]),
     "description": "Calls one address from list_endpoints as this person and returns its JSON. Read-only agents can only use GET (and the quote and "
                    "preview calculators)."},
]
TOOL_MAP = {t["name"]: t for t in TOOLS}


def tool_defs(agent):
    write = agent.get("access") == "write"
    out = []
    for t in TOOLS:
        if t.get("write") and not write:
            continue
        inp = t["input"]
        if t["name"] == "call_api" and not write:
            inp = json.loads(json.dumps(inp))
            inp["properties"]["method"]["enum"] = ["GET", "POST"]
            inp["properties"]["method"]["description"] = "GET to read; POST only for the calculators /api/short-stay/quote, /api/deals/commission-preview, /api/agreements/preview"
        out.append({"name": t["name"], "title": t["title"], "description": t["description"], "inputSchema": inp,
                    "annotations": {"title": t["title"], "readOnlyHint": not t.get("write") and t["name"] != "call_api",
                                    "destructiveHint": False, "idempotentHint": not t.get("write") and t["name"] != "call_api", "openWorldHint": False}})
    return out


# ---- prompts (ready-made requests that show up in Claude's prompt list)
PROMPTS = [
    {"name": "daily_brief", "title": "Daily brief",
     "description": "Today's position: what needs attention, approvals waiting, rent overdue, requests past target and the three things to do first.",
     "text": f"Give me today's brief for {APP_NAME}. Use overview first. Then list approvals waiting, leads with an overdue follow-up, rent in arrears, "
             "service requests past their reply or fix target, and short-stay arrivals and departures today and tomorrow (whatever this login can see). "
             "End with the three things I should do first today. Keep it short and give record codes."},
    {"name": "lead_followups", "title": "Lead follow-ups",
     "description": "Leads waiting for a first reply or with an overdue follow-up, oldest first, with a suggested next step.",
     "text": "Find leads that are still new or whose next follow-up has passed (list_records on leads with the overdue filter, then stage new). "
             "Sort oldest first and show code, name, phone, interest, source, owner and days waiting, with a one-line next step for each. "
             "For buyers and tenants, mention one or two matching listings if get_record's related screens show any."},
    {"name": "rent_collections", "title": "Rent collections list",
     "description": "Leases in arrears, tenant bills due and payments waiting for a check, as a calling list.",
     "text": "Make a rent collections list: leases with arrears (list_records on leases, sort -arrears), tenant bills due or overdue (tenant_bills), and "
             "payments tenants reported that are still waiting for a check (payment_notices). Group by tenant with amounts and days overdue, and "
             "suggest who to call first. Don't record any payment."},
    {"name": "service_desk", "title": "Service desk check",
     "description": "Open service requests past target, urgent ones without someone on them, and open work orders.",
     "text": "Review open service requests (list_records on service_requests, status active): which are past the reply or fix target, which urgent ones "
             "have nobody assigned, and which have been waiting on the customer. Add open work orders and their vendors. Rank by urgency with codes."},
    {"name": "short_stay_week", "title": "Short stays this week",
     "description": "Arrivals and departures for the next 7 days, bookings missing guest details, and clashes.",
     "text": "List short-stay arrivals and departures for the next 7 days (stay_bookings, check_in and check_out), bookings that still need guest details, "
             "and any clashes between platforms (list_endpoints 'short-stay' for the calendar). Note cleaning needed between stays."},
]


def instructions(agent, user, company):
    acc = ("read and write (it can add and change records and do things on them, but never deletes, decides approvals or records money)"
           if agent.get("access") == "write" else "read only")
    job = (agent.get("purpose") or "").strip()
    return (f"You are connected to the business system of {company}, a property services company in Tamil Nadu, India, with branches in Perundurai "
            f"(head office), Erode, Kadambur, Sathyamangalam and Namakkal: buying, selling, rentals and leases, managed properties for owners (rent "
            f"collection, tenant bills, repairs), short stays on Airbnb, Booking.com and others, and property co-investment. This connection is the AI "
            f"agent '{agent['name']}', working as {user['name']} ({ROLES.get(user['role'])}); that person's permissions, branches and record scope apply. "
            f"Access: {acc}.\n"
            "How to work: whoami and overview first. Find records with search, or list_record_types -> describe_record_type -> list_records / get_record. "
            "Other screens (CEO view, calendar, owner statements, short-stay calendar and performance, ledger balances) are in list_endpoints and "
            "call_api; spreadsheet reports in list_reports and run_report.\n"
            "Money is in Indian rupees (lakh and crore); dates are YYYY-MM-DD in India time. Rent received is owner money held in the owner-funds "
            "ledger, not company income. Every change is recorded in the audit log under the person's name with this agent's name. Approvals, "
            "payments and deletes are done by people in the app. Confirm with the person you are working for before adding or changing anything, "
            "and before sending anything to a customer."
            + (f"\nThis agent's job: {job}" if job else ""))


# ------------------------------------------------------------------ MCP endpoint
_rate: dict = {}


def _rate_ok(aid):
    if os.environ.get("DISABLE_RATE_LIMIT") == "true":
        return True
    t = time.time()
    hits = [h for h in _rate.get(aid, []) if h > t - 60]
    if len(hits) >= CALLS_PER_MINUTE:
        _rate[aid] = hits
        return False
    hits.append(t)
    _rate[aid] = hits
    return True


def _key_from(request: Request):
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer ") and auth[7:].strip().startswith(KEY_PREFIX):
        return auth[7:].strip()
    return (request.headers.get("x-api-key") or request.query_params.get("key") or "").strip()


def _rpc_error(mid, code, message, status=200, headers=None):
    return JSONResponse({"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}}, status_code=status, headers=headers)


def _redact(args):
    try:
        text = json.dumps(args, ensure_ascii=False, default=str)
    except Exception:
        text = str(args)
    text = re.sub(r'("(?:password|secret|otp|token|key|upi_ref|reference)"\s*:\s*)"[^"]*"', r'\1"***"', text, flags=re.I)
    return text[:600]


async def _log(ctx: Ctx, method, tool, args, ok, error, ms):
    await db.ai_agent_calls.insert_one({"id": new_id(), "agent_id": ctx.agent["id"], "agent_name": ctx.agent["name"], "user_id": ctx.user["id"],
                                        "user_name": ctx.user["name"], "method": method, "tool": tool, "args": _redact(args) if args else None,
                                        "ok": ok, "error": (error or "")[:400] or None, "ms": ms, "ip": client_ip(ctx.request), "at": now_iso()})
    if random.random() < 0.01:
        await db.ai_agent_calls.delete_many({"at": {"$lt": (now() - timedelta(days=KEEP_CALLS_DAYS)).isoformat()}})


async def _handle(ctx: Ctx, msg, company):
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or not isinstance(msg.get("method"), str):
        return {"jsonrpc": "2.0", "id": msg.get("id") if isinstance(msg, dict) else None, "error": {"code": -32600, "message": "Invalid request"}}
    mid, method, params = msg.get("id"), msg["method"], msg.get("params") or {}
    is_note = "id" not in msg

    def ok(result):
        return None if is_note else {"jsonrpc": "2.0", "id": mid, "result": result}

    def err(code, text):
        return None if is_note else {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": text}}

    if method.startswith("notifications/"):
        return None
    if method == "initialize":
        want = params.get("protocolVersion")
        ci = params.get("clientInfo") or {}
        await db.ai_agents.update_one({"id": ctx.agent["id"]}, {"$set": {"last_client": f"{ci.get('name', '')} {ci.get('version', '')}".strip()[:80] or None}})
        await _log(ctx, "initialize", None, {"client": ci.get("name")}, True, None, 0)
        return ok({"protocolVersion": want if want in PROTOCOLS else PROTOCOLS[0],
                   "capabilities": {"tools": {"listChanged": False}, "prompts": {"listChanged": False}},
                   "serverInfo": {"name": "sellandiamman-estates", "title": APP_NAME, "version": ctx.request.app.version},
                   "instructions": instructions(ctx.agent, ctx.user, company)})
    if method == "ping":
        return ok({})
    if method == "tools/list":
        return ok({"tools": tool_defs(ctx.agent)})
    if method == "prompts/list":
        return ok({"prompts": [{"name": p["name"], "title": p["title"], "description": p["description"], "arguments": []} for p in PROMPTS]})
    if method == "prompts/get":
        p = next((x for x in PROMPTS if x["name"] == params.get("name")), None)
        if not p:
            return err(-32602, "Unknown prompt")
        return ok({"description": p["description"], "messages": [{"role": "user", "content": {"type": "text", "text": p["text"]}}]})
    if method == "resources/list":
        return ok({"resources": []})
    if method == "resources/templates/list":
        return ok({"resourceTemplates": []})
    if method == "logging/setLevel":
        return ok({})
    if method == "completion/complete":
        return ok({"completion": {"values": [], "hasMore": False}})
    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments") or {}
        t = TOOL_MAP.get(name)
        if not t or (t.get("write") and ctx.agent.get("access") != "write"):
            return err(-32602, f"Unknown tool: {name}")
        if not isinstance(args, dict):
            return err(-32602, "arguments must be an object")
        missing = [k for k in t["input"].get("required", []) if args.get(k) in (None, "")]
        t0 = time.time()
        try:
            if missing:
                raise ToolError(f"Missing: {', '.join(missing)}")
            result = await t["fn"](ctx, args)
            text = json.dumps(result, ensure_ascii=False, default=str, separators=(",", ":"))
            if len(text) > MAX_TEXT:
                text = text[:MAX_TEXT] + ' …(cut short: ask for fewer rows, a smaller page_size or specific fields)'
            await _log(ctx, "tools/call", name, args, True, None, int((time.time() - t0) * 1000))
            return ok({"content": [{"type": "text", "text": text}], "isError": False})
        except (ToolError, HTTPException) as ex:
            text = str(ex) if isinstance(ex, ToolError) else str(ex.detail)
            await _log(ctx, "tools/call", name, args, False, text, int((time.time() - t0) * 1000))
            return ok({"content": [{"type": "text", "text": text}], "isError": True})
        except Exception as ex:  # a fault in the server: tell the agent plainly, keep the details in the server log
            logger.exception("MCP tool %s failed", name)
            await _log(ctx, "tools/call", name, args, False, f"server error: {type(ex).__name__}", int((time.time() - t0) * 1000))
            return ok({"content": [{"type": "text", "text": "Something went wrong on the server with this request. Try different arguments, or tell the person."}],
                       "isError": True})
    return err(-32601, f"Method not found: {method}")


@router.post("/mcp")
async def mcp(request: Request):
    """Model Context Protocol endpoint for AI agents (Streamable HTTP, JSON-RPC 2.0)."""
    REQ_BRANCH.set(None)
    key = _key_from(request)
    agent = await db.ai_agents.find_one({"key_hash": hash_key(key)}, {"_id": 0}) if key.startswith(KEY_PREFIX) else None
    if not agent:
        return _rpc_error(None, -32001, "Missing or wrong AI agent key. Make one in the staff app: Team & admin -> AI agents & MCP.", 401,
                          {"WWW-Authenticate": 'Bearer realm="sellandiamman-estates"'})
    if not agent_is_live(agent):
        return _rpc_error(None, -32001, f"This AI agent is {status_of(agent)}. An administrator can switch it back on in AI agents & MCP.", 403)
    user = await agent_identity(agent)
    if not user:
        return _rpc_error(None, -32001, "The staff login this agent works as is switched off.", 403)
    try:
        body = await request.json()
    except Exception:
        return _rpc_error(None, -32700, "Parse error: send JSON-RPC 2.0", 400)
    if not _rate_ok(agent["id"]):
        mid = body.get("id") if isinstance(body, dict) else None
        return _rpc_error(mid, -32000, f"Too many calls: this agent may make {CALLS_PER_MINUTE} a minute. Wait a moment and try again.", 429)
    ctx = Ctx(request, agent, user)
    company = (await get_settings()).get("name") or APP_NAME
    await db.ai_agents.update_one({"id": agent["id"]}, {"$set": {"last_used_at": now_iso(), "last_ip": client_ip(request)}, "$inc": {"calls_total": 1}})
    if isinstance(body, list):
        if not body:
            return _rpc_error(None, -32600, "Empty batch", 400)
        out = [r for r in [await _handle(ctx, m, company) for m in body] if r is not None]
        return JSONResponse(out) if out else Response(status_code=202)
    res = await _handle(ctx, body, company)
    return JSONResponse(res) if res is not None else Response(status_code=202)


@router.get("/mcp")
async def mcp_get():
    """This server answers each POST directly and doesn't keep a stream open."""
    return Response(status_code=405, headers={"Allow": "POST"})


@router.delete("/mcp")
async def mcp_delete():
    return Response(status_code=405, headers={"Allow": "POST"})
