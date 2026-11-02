"""Service tickets: repairs, cleaning and other requests raised by tenants, owners (lessors), buyers and investors from
their portals, or by staff on a customer's behalf (phone, WhatsApp, walk-in). Each ticket has a conversation with the
customer, internal notes, photos, an owner on our side, a response/resolution target, and can become a work order."""
from datetime import timedelta, datetime
from typing import Optional
import jwt
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel, Field
from core import (db, now, now_iso, new_id, next_code, require, scope, audit, notify, notify_roles, portal_user,
                  save_upload, check_branch, can, JWT_SECRET, JWT_ALG, IMAGE_TYPES, DOC_TYPES, home_branch)

router = APIRouter()

# key: (label, group). Groups decide which customers see the category and whether the owner sees the ticket.
CATEGORIES = {
    "plumbing": ("Plumbing or water leak", "repair"),
    "electrical": ("Electrical or power", "repair"),
    "appliance": ("Appliance (AC, geyser, fan, motor)", "repair"),
    "carpentry": ("Doors, windows, locks, carpentry", "repair"),
    "painting": ("Painting, cracks or seepage", "repair"),
    "water_supply": ("Water supply, tank or motor", "repair"),
    "pest_control": ("Pest control", "repair"),
    "cleaning": ("Cleaning", "cleaning"),
    "deep_cleaning": ("Deep cleaning", "cleaning"),
    "tank_cleaning": ("Water tank or sump cleaning", "cleaning"),
    "garden": ("Garden or common area", "cleaning"),
    "security": ("Keys, access or security", "service"),
    "internet": ("Internet, DTH or cable", "service"),
    "parking": ("Parking", "service"),
    "complaint": ("Complaint (neighbours, noise, society)", "service"),
    "documents": ("Documents (receipt, agreement copy, address letter)", "account"),
    "billing": ("Rent or bill query", "account"),
    "renewal": ("Lease renewal", "account"),
    "move_out": ("Move-out notice", "account"),
    "payout": ("Statement or payout query", "account"),
    "listing": ("Listing, tenant search or rent revision", "owner"),
    "property_tax": ("Property tax, EB or water name transfer", "owner"),
    "home_loan": ("Home-loan help", "buying"),
    "registration": ("Registration and legal help", "buying"),
    "site_visit": ("Site visit", "buying"),
    "other": ("Something else", "service"),
}
ROLE_CATS = {
    "tenant": [k for k, (_, g) in CATEGORIES.items() if g in ("repair", "cleaning", "service")] + ["documents", "billing", "renewal", "move_out"],
    "owner": [k for k, (_, g) in CATEGORIES.items() if g in ("repair", "cleaning", "service", "owner")] + ["documents", "billing", "payout"],
    "buyer": ["site_visit", "home_loan", "registration", "documents", "billing", "complaint", "other"],
    "investor": ["payout", "documents", "other"],
}
STATUSES = ["open", "acknowledged", "in_progress", "on_hold", "resolved", "closed", "cancelled"]
FLOW = {"open": ["acknowledged", "in_progress", "on_hold", "resolved", "cancelled"],
        "acknowledged": ["in_progress", "on_hold", "resolved", "cancelled"],
        "in_progress": ["on_hold", "resolved", "cancelled"],
        "on_hold": ["in_progress", "resolved", "cancelled"],
        "resolved": ["closed", "in_progress"], "closed": ["in_progress"], "cancelled": []}
# hours to first reply, hours to resolve
SLA = {"urgent": (4, 24), "high": (24, 72), "medium": (48, 168), "low": (72, 336)}
PORTAL_HOME = {"tenant": "/tenant/requests", "owner": "/owner/requests", "buyer": "/buyer/requests", "investor": "/investor/requests"}
LIST_FIELDS = {"_id": 0, "messages": 0}


class TicketIn(BaseModel):
    category: str
    title: str = Field(min_length=3, max_length=160)
    description: Optional[str] = Field(None, max_length=3000)
    priority: str = Field("medium", pattern=r"^(low|medium|high|urgent)$")
    property_id: Optional[str] = None
    preferred_time: Optional[str] = Field(None, max_length=120)
    permission_to_enter: bool = False


class StaffTicketIn(TicketIn):
    lease_id: Optional[str] = None
    customer_id: Optional[str] = None
    channel: str = Field("phone", pattern=r"^(phone|whatsapp|walk_in|email|staff)$")
    assigned_to: Optional[str] = None


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=3000)
    internal: bool = False


class TicketPatch(BaseModel):
    status: Optional[str] = None
    assigned_to: Optional[str] = None
    priority: Optional[str] = Field(None, pattern=r"^(low|medium|high|urgent)$")
    category: Optional[str] = None
    note: Optional[str] = Field(None, max_length=1000)


class RateIn(BaseModel):
    stars: int = Field(ge=1, le=5)
    comment: Optional[str] = Field(None, max_length=1000)


class WoIn(BaseModel):
    vendor_id: Optional[str] = None
    quote_amount: Optional[float] = Field(None, ge=0)
    charge_to: str = Field("owner", pattern=r"^(owner|company)$")
    due_date: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")


def cat_label(k):
    return CATEGORIES.get(k, (k.replace("_", " ").title(), "service"))[0]


def _due(priority, hours_index, start=None):
    base = datetime.fromisoformat(start) if start else now()
    return (base + timedelta(hours=SLA[priority][hours_index])).isoformat()


def _msg(user, text, by_role, internal=False, kind="message"):
    return {"id": new_id(), "at": now_iso(), "user_id": user["id"] if user else None,
            "by": (user or {}).get("name") or "System", "by_role": by_role, "text": text, "internal": internal, "kind": kind}


async def _property(pid):
    return await db.properties.find_one({"id": pid, "deleted": {"$ne": True}},
                                        {"_id": 0, "id": 1, "title": 1, "code": 1, "owner_id": 1, "branch_id": 1,
                                         "assigned_manager": 1, "locality": 1, "city": 1})


async def _notify_staff(t, title, body=""):
    link = f"/erp/tickets/{t['id']}"
    targets = [t.get("assigned_to")]
    if t.get("property_id"):
        p = await _property(t["property_id"])
        targets.append(p and p.get("assigned_manager"))
    if any(targets):
        await notify(targets, title, body, link, dedupe=f"tk:{t['id']}:{now_iso()}")
    if not t.get("assigned_to"):
        await notify_roles(["branch_manager"], title, body, link, dedupe=f"tk:{t['id']}:{now_iso()}", branch_id=t.get("branch_id"))


async def _notify_customer(t, title, body=""):
    """Tells the customer(s) who can see this ticket in their portal."""
    ids, f = set(), []
    if t.get("raised_by", {}).get("user_id"):
        ids.add(t["raised_by"]["user_id"])
    if t.get("customer_id"):
        f.append({"customer_id": t["customer_id"], "role": {"$in": ["tenant", "buyer"]}})
    if f:
        for u in await db.users.find({"$or": f, "active": True}, {"_id": 0, "id": 1}).to_list(50):
            ids.add(u["id"])
    users = await db.users.find({"id": {"$in": list(ids)}, "active": True}, {"_id": 0, "id": 1, "role": 1}).to_list(50)
    for u in users:
        await notify([u["id"]], title, body, f"{PORTAL_HOME.get(u['role'], '/')}/{t['id']}", dedupe=f"tkc:{t['id']}:{now_iso()}")


async def create_ticket(data, user, by_role, channel):
    """data: category, title, description, priority, property_id, lease_id, customer_id, owner_id, preferred_time,
    permission_to_enter, assigned_to."""
    if data["category"] not in CATEGORIES:
        raise HTTPException(422, "Choose a type of request")
    prop = await _property(data["property_id"]) if data.get("property_id") else None
    if data.get("property_id") and not prop:
        raise HTTPException(404, "Property not found")
    group = CATEGORIES[data["category"]][1]
    t = {"id": new_id(), "code": await next_code("ticket", "TK-", 5), "category": data["category"],
         "group": group, "title": data["title"].strip(), "description": (data.get("description") or "").strip() or None,
         "priority": data.get("priority") or "medium", "property_id": prop and prop["id"],
         "property_title": prop and prop["title"], "property_code": prop and prop["code"],
         "owner_id": data.get("owner_id") or (prop and prop.get("owner_id")),
         "branch_id": (prop and prop.get("branch_id")) or data.get("branch_id"),
         "lease_id": data.get("lease_id"), "customer_id": data.get("customer_id"),
         "visible_to_owner": group == "repair" or by_role == "owner",
         "raised_by": {"user_id": user["id"], "name": user.get("name"), "role": by_role}, "channel": channel,
         "preferred_time": data.get("preferred_time"), "permission_to_enter": bool(data.get("permission_to_enter")),
         "status": "open", "assigned_to": data.get("assigned_to"), "assigned_name": None, "work_order_id": None,
         "respond_by": _due(data.get("priority") or "medium", 0), "due_at": _due(data.get("priority") or "medium", 1),
         "first_response_at": None, "resolved_at": None, "closed_at": None, "rating": None, "files": [],
         "messages": [], "created_at": now_iso(), "updated_at": now_iso(), "last_message_at": now_iso(),
         "unread_staff": by_role != "staff", "unread_customer": by_role == "staff"}
    if t["assigned_to"]:
        a = await db.users.find_one({"id": t["assigned_to"]}, {"_id": 0, "name": 1})
        t["assigned_name"] = a and a["name"]
    if t["description"]:
        t["messages"].append(_msg(user, t["description"], by_role if by_role != "staff" else "staff", kind="message"))
    await db.tickets.insert_one(dict(t))
    await audit(user, "ticket_created", "maintenance", t["id"], {"category": t["category"], "by": by_role})
    return t


# ---------------- Staff ----------------


async def _get_staff(user, tid):
    t = await db.tickets.find_one({"id": tid, **scope(user, "maintenance")}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Ticket not found")
    return t


@router.get("/tickets/options")
async def staff_options(user=Depends(require("maintenance", "r"))):
    return {"categories": [{"key": k, "label": v[0], "group": v[1]} for k, v in CATEGORIES.items()],
            "statuses": STATUSES, "flow": FLOW, "sla": SLA}


@router.get("/tickets")
async def list_tickets(status: Optional[str] = None, category: Optional[str] = None, mine: bool = False,
                       q: Optional[str] = None, user=Depends(require("maintenance", "r"))):
    f = scope(user, "maintenance")
    if status == "active":
        f["status"] = {"$in": ["open", "acknowledged", "in_progress", "on_hold"]}
    elif status:
        f["status"] = status
    if category:
        f["category"] = category
    if mine:
        f["assigned_to"] = user["id"]
    if q:
        f["$or"] = [{"title": {"$regex": q[:40], "$options": "i"}}, {"code": {"$regex": q[:20], "$options": "i"}},
                    {"property_title": {"$regex": q[:40], "$options": "i"}}, {"raised_by.name": {"$regex": q[:40], "$options": "i"}}]
    rows = await db.tickets.find(f, LIST_FIELDS).sort("last_message_at", -1).to_list(1000)
    n = now_iso()
    for r in rows:
        active = r["status"] in ("open", "acknowledged", "in_progress", "on_hold")
        r["overdue"] = active and r.get("due_at", n) < n
        r["reply_overdue"] = active and not r.get("first_response_at") and r.get("respond_by", n) < n
        r["category_label"] = cat_label(r["category"])
    return rows


@router.get("/tickets/stats")
async def ticket_stats(user=Depends(require("maintenance", "r"))):
    rows = await list_tickets(user=user)
    active = [r for r in rows if r["status"] in ("open", "acknowledged", "in_progress", "on_hold")]
    rated = [r["rating"]["stars"] for r in rows if r.get("rating")]
    return {"active": len(active), "new": sum(1 for r in rows if r["status"] == "open"),
            "overdue": sum(1 for r in active if r["overdue"]), "unanswered": sum(1 for r in active if r["reply_overdue"]),
            "unread": sum(1 for r in active if r.get("unread_staff")),
            "avg_rating": round(sum(rated) / len(rated), 1) if rated else None, "rated": len(rated)}


@router.post("/tickets")
async def staff_create(body: StaffTicketIn, user=Depends(require("maintenance", "w"))):
    data = body.model_dump()
    if body.lease_id:
        lease = await db.leases.find_one({"id": body.lease_id, **scope(user, "leases")} if can(user, "leases", "r") else {"id": body.lease_id},
                                         {"_id": 0, "property_id": 1, "customer_id": 1, "owner_id": 1})
        if not lease:
            raise HTTPException(404, "Lease not found")
        data["property_id"] = data.get("property_id") or lease["property_id"]
        data["customer_id"] = data.get("customer_id") or lease.get("customer_id")
    if data.get("property_id"):
        p = await _property(data["property_id"])
        if not p:
            raise HTTPException(404, "Property not found")
        check_branch(user, p.get("branch_id"))
    else:
        data["branch_id"] = home_branch(user)
    t = await create_ticket(data, user, "staff", body.channel)
    t["first_response_at"] = now_iso()
    await db.tickets.update_one({"id": t["id"]}, {"$set": {"first_response_at": t["first_response_at"], "unread_customer": False}})
    await _notify_customer(t, f"We logged your request {t['code']}", t["title"])
    return t


@router.get("/tickets/{tid}")
async def staff_get(tid: str, user=Depends(require("maintenance", "r"))):
    t = await _get_staff(user, tid)
    t["category_label"] = cat_label(t["category"])
    t["files"] = await db.documents.find({"entity_type": "ticket", "entity_id": tid, "is_latest": True},
                                         {"_id": 0, "stored_name": 0}).sort("created_at", 1).to_list(100)
    if t.get("work_order_id"):
        t["work_order"] = await db.work_orders.find_one({"id": t["work_order_id"]}, {"_id": 0, "history": 0})
    if t.get("customer_id"):
        t["customer"] = await db.customers.find_one({"id": t["customer_id"]}, {"_id": 0, "id": 1, "code": 1, "name": 1,
                                                                               "phone": 1, "email": 1, "language": 1})
    if t.get("lease_id"):
        t["lease"] = await db.leases.find_one({"id": t["lease_id"]}, {"_id": 0, "id": 1, "code": 1, "tenant_name": 1,
                                                                     "tenant_phone": 1, "status": 1})
    if t.get("unread_staff"):
        await db.tickets.update_one({"id": tid}, {"$set": {"unread_staff": False}})
    return t


@router.patch("/tickets/{tid}")
async def staff_update(tid: str, body: TicketPatch, user=Depends(require("maintenance", "w"))):
    t = await _get_staff(user, tid)
    upd, events = {"updated_at": now_iso()}, []
    if body.status and body.status != t["status"]:
        if body.status not in FLOW[t["status"]]:
            raise HTTPException(422, f"Cannot move a {t['status'].replace('_', ' ')} ticket to {body.status.replace('_', ' ')}")
        upd["status"] = body.status
        events.append(f"Status: {body.status.replace('_', ' ')}")
        if body.status == "resolved":
            upd["resolved_at"] = now_iso()
        if body.status == "closed":
            upd["closed_at"] = now_iso()
        if not t.get("first_response_at"):
            upd["first_response_at"] = now_iso()
    if body.assigned_to is not None and body.assigned_to != t.get("assigned_to"):
        if body.assigned_to:
            a = await db.users.find_one({"id": body.assigned_to, "active": True}, {"_id": 0, "id": 1, "name": 1, "role": 1})
            if not a or a["role"] in ("owner", "investor", "tenant", "buyer"):
                raise HTTPException(422, "Assign the ticket to a staff member")
            upd.update({"assigned_to": a["id"], "assigned_name": a["name"]})
            events.append(f"Assigned to {a['name']}")
            await notify([a["id"]], f"Ticket {t['code']} assigned to you", t["title"], f"/erp/tickets/{tid}", dedupe=f"tka:{tid}:{a['id']}")
        else:
            upd.update({"assigned_to": None, "assigned_name": None})
            events.append("Unassigned")
    if body.priority and body.priority != t["priority"]:
        upd.update({"priority": body.priority, "due_at": _due(body.priority, 1, t["created_at"]),
                    "respond_by": _due(body.priority, 0, t["created_at"])})
        events.append(f"Priority: {body.priority}")
    if body.category and body.category != t["category"]:
        if body.category not in CATEGORIES:
            raise HTTPException(422, "Unknown category")
        upd.update({"category": body.category, "group": CATEGORIES[body.category][1]})
        events.append(f"Type: {cat_label(body.category)}")
    if not events and not body.note:
        return t
    msgs = [_msg(user, e, "staff", kind="event") for e in events]
    if body.note:
        msgs.append(_msg(user, body.note.strip(), "staff"))
        upd["unread_customer"] = True
        upd["last_message_at"] = now_iso()
        if not t.get("first_response_at"):
            upd["first_response_at"] = now_iso()
        if t["status"] == "open" and "status" not in upd:
            upd["status"] = "acknowledged"
    await db.tickets.update_one({"id": tid}, {"$set": upd, "$push": {"messages": {"$each": msgs}}})
    await audit(user, "ticket_updated", "maintenance", tid, {k: v for k, v in upd.items() if k != "updated_at"})
    nt = {**t, **upd}
    if "status" in upd or body.note:
        what = f"is {upd['status'].replace('_', ' ')}" if "status" in upd else "has a reply"
        await _notify_customer(nt, f"Your request {t['code']} {what}", body.note or t["title"])
    return {**nt, "messages": t["messages"] + msgs}


@router.post("/tickets/{tid}/messages")
async def staff_message(tid: str, body: MessageIn, user=Depends(require("maintenance", "w"))):
    t = await _get_staff(user, tid)
    m = _msg(user, body.text.strip(), "staff", internal=body.internal)
    upd = {"updated_at": now_iso()}
    if not body.internal:
        upd.update({"last_message_at": now_iso(), "unread_customer": True})
        if not t.get("first_response_at"):
            upd["first_response_at"] = now_iso()
            if t["status"] == "open":
                upd["status"] = "acknowledged"
    await db.tickets.update_one({"id": tid}, {"$set": upd, "$push": {"messages": m}})
    if not body.internal:
        await _notify_customer(t, f"Reply on your request {t['code']}", body.text[:140])
    return m


@router.post("/tickets/{tid}/files")
async def staff_file(tid: str, file: UploadFile = File(...), user=Depends(require("maintenance", "w"))):
    await _get_staff(user, tid)
    return await _save_file(tid, file, user, "staff")


@router.post("/tickets/{tid}/work-order")
async def to_work_order(tid: str, body: WoIn, user=Depends(require("maintenance", "w"))):
    t = await _get_staff(user, tid)
    if not t.get("property_id"):
        raise HTTPException(422, "Link the ticket to a property first")
    if t.get("work_order_id"):
        raise HTTPException(409, "This ticket already has a work order")
    from routes_ops import create_wo, WorkOrderIn
    wo = await create_wo(WorkOrderIn(property_id=t["property_id"], title=f"{t['title']} ({t['code']})",
                                     description=t.get("description"), category=t["group"], priority=t["priority"],
                                     due_date=body.due_date, vendor_id=body.vendor_id, quote_amount=body.quote_amount,
                                     charge_to=body.charge_to, reported_by=f"{t['raised_by']['name']} ({t['raised_by']['role']})"), user)
    await db.work_orders.update_one({"id": wo["id"]}, {"$set": {"ticket_id": tid}})
    upd = {"work_order_id": wo["id"], "updated_at": now_iso()}
    if t["status"] in ("open", "acknowledged", "on_hold"):
        upd["status"] = "in_progress"
    if not t.get("first_response_at"):
        upd["first_response_at"] = now_iso()
    await db.tickets.update_one({"id": tid}, {"$set": upd, "$push": {"messages": _msg(user, f"Work order {wo['code']} raised", "staff", kind="event")}})
    if upd.get("status"):
        await _notify_customer(t, f"Work has been scheduled for {t['code']}", t["title"])
    return {**t, **upd, "work_order": wo}


async def on_work_order_done(wo, user):
    """Called when a linked work order is completed: the ticket becomes resolved and the customer is told."""
    t = await db.tickets.find_one({"work_order_id": wo["id"]}, {"_id": 0})
    if not t or t["status"] in ("resolved", "closed", "cancelled"):
        return
    await db.tickets.update_one({"id": t["id"]}, {"$set": {"status": "resolved", "resolved_at": now_iso(), "updated_at": now_iso(),
                                                           "unread_customer": True, "last_message_at": now_iso()},
                                                  "$push": {"messages": _msg(user, "The work is complete. If anything is still not right, reopen this request.", "staff")}})
    await _notify_customer(t, f"Your request {t['code']} is resolved", t["title"])


# ---------------- Files ----------------
async def _save_file(tid, file, user, by_role):
    saved = await save_upload(file, {*IMAGE_TYPES, *DOC_TYPES} if by_role == "staff" else {*IMAGE_TYPES, "application/pdf"})
    n = await db.documents.count_documents({"entity_type": "ticket", "entity_id": tid})
    if n >= 20:
        raise HTTPException(422, "A ticket can hold up to 20 files")
    d = {"id": new_id(), **saved, "entity_type": "ticket", "entity_id": tid, "doc_type": "photo" if saved["content_type"] in IMAGE_TYPES else "other",
         "expiry_date": None, "notes": None, "version": 1, "is_latest": True, "previous_id": None, "public_approved": False,
         "uploaded_by": user["id"], "uploaded_by_name": user["name"], "by_role": by_role, "created_at": now_iso()}
    await db.documents.insert_one(dict(d))
    await db.tickets.update_one({"id": tid}, {"$push": {"messages": _msg(user, f"Added {d['original_name']}", by_role if by_role != "staff" else "staff", kind="file")},
                                              "$set": {"updated_at": now_iso(), "last_message_at": now_iso(),
                                                       ("unread_staff" if by_role != "staff" else "unread_customer"): True}})
    d.pop("stored_name")
    return d


def _file_link(did, uid):
    tok = jwt.encode({"doc": did, "uid": uid, "typ": "file", "exp": now() + timedelta(minutes=5)}, JWT_SECRET, algorithm=JWT_ALG)
    return {"url": f"/api/files/{tok}", "expires_in": 300}


# ---------------- Customer portals (/api/my/*) ----------------
async def _my_context(user):
    """Ticket filter and the properties this customer may raise requests for."""
    role, uid = user["role"], user["id"]
    props, leases = [], []
    if role == "tenant":
        leases = await db.leases.find({"customer_id": user["customer_id"]}, {"_id": 0, "id": 1, "code": 1, "property_id": 1,
                                                                             "status": 1, "end_date": 1}).to_list(50)
        pids = [ls["property_id"] for ls in leases]
        f = {"$or": [{"raised_by.user_id": uid}, {"customer_id": user["customer_id"]}]}
    elif role == "owner":
        pids = [p["id"] for p in await db.properties.find({"owner_id": user["owner_id"], "deleted": {"$ne": True}}, {"_id": 0, "id": 1}).to_list(500)]
        f = {"$or": [{"raised_by.user_id": uid}, {"owner_id": user["owner_id"], "visible_to_owner": True}]}
    elif role == "buyer":
        from routes_buyer import buyer_records
        _, leads, deals = await buyer_records(user["customer_id"])
        shared = await db.lead_activities.find({"lead_id": {"$in": [x["id"] for x in leads]}, "kind": "shared_listing"},
                                               {"_id": 0, "property_id": 1}).to_list(500)
        pids = list(dict.fromkeys([d["property_id"] for d in deals if d.get("property_id")] +
                                  [a["property_id"] for a in shared if a.get("property_id")]))
        f = {"$or": [{"raised_by.user_id": uid}, {"customer_id": user["customer_id"]}]}
    else:
        pids = []
        f = {"raised_by.user_id": uid}
    if pids:
        props = await db.properties.find({"id": {"$in": pids}}, {"_id": 0, "id": 1, "title": 1, "code": 1, "locality": 1, "city": 1}).to_list(500)
    return f, props, leases


async def _get_mine(user, tid):
    f, _, _ = await _my_context(user)
    t = await db.tickets.find_one({"id": tid, **f}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Request not found")
    return t


def _customer_view(t, user):
    out = {k: v for k, v in t.items() if k not in ("messages", "assigned_to", "unread_staff", "work_order_id")}
    out["messages"] = [m for m in t.get("messages", []) if not m.get("internal")]
    out["category_label"] = cat_label(t["category"])
    out["can_reply"] = t["raised_by"].get("user_id") == user["id"] or (t.get("customer_id") and t.get("customer_id") == user.get("customer_id"))
    out["assigned_name"] = (t.get("assigned_name") or "").split(" ")[0] or None
    return out


@router.get("/my/ticket-options")
async def my_options(user=Depends(portal_user)):
    _, props, leases = await _my_context(user)
    cats = ROLE_CATS.get(user["role"], ["other"])
    return {"categories": [{"key": k, "label": cat_label(k), "group": CATEGORIES[k][1]} for k in cats],
            "properties": props, "leases": leases}


@router.get("/my/tickets")
async def my_tickets(user=Depends(portal_user)):
    f, _, _ = await _my_context(user)
    rows = await db.tickets.find(f, {"_id": 0}).sort("last_message_at", -1).to_list(500)
    out = []
    for t in rows:
        v = _customer_view(t, user)
        v["message_count"] = len(v.pop("messages"))
        out.append(v)
    return out


@router.post("/my/tickets")
async def my_create(body: TicketIn, user=Depends(portal_user)):
    _, props, leases = await _my_context(user)
    if body.category not in ROLE_CATS.get(user["role"], []):
        raise HTTPException(422, "Choose a type of request")
    data = body.model_dump()
    if body.property_id and body.property_id not in {p["id"] for p in props}:
        raise HTTPException(404, "Property not found")
    if not body.property_id and len(props) == 1 and user["role"] in ("tenant", "owner"):
        data["property_id"] = props[0]["id"]
    if user["role"] in ("tenant", "buyer"):
        data["customer_id"] = user["customer_id"]
        c = await db.customers.find_one({"id": user["customer_id"]}, {"_id": 0, "branch_id": 1})
        data["branch_id"] = c and c.get("branch_id")
    if user["role"] == "tenant" and data.get("property_id"):
        ls = next((x for x in leases if x["property_id"] == data["property_id"] and x["status"] == "active"), None) or \
            next((x for x in leases if x["property_id"] == data["property_id"]), None)
        data["lease_id"] = ls and ls["id"]
    if user["role"] == "owner":
        data["owner_id"] = user["owner_id"]
    if user["role"] == "investor":
        inv = await db.investors.find_one({"id": user["investor_id"]}, {"_id": 0, "branch_id": 1, "rm_id": 1})
        data["branch_id"] = inv and inv.get("branch_id")
        data["assigned_to"] = inv and inv.get("rm_id")
    t = await create_ticket(data, user, user["role"], "portal")
    await _notify_staff(t, f"New request {t['code']}: {t['title']}", f"{cat_label(t['category'])} · {user['name']}")
    return _customer_view(t, user)


@router.get("/my/tickets/{tid}")
async def my_get(tid: str, user=Depends(portal_user)):
    t = await _get_mine(user, tid)
    v = _customer_view(t, user)
    v["files"] = [d for d in await db.documents.find({"entity_type": "ticket", "entity_id": tid, "is_latest": True},
                                                     {"_id": 0, "stored_name": 0}).sort("created_at", 1).to_list(100)]
    if t.get("work_order_id"):
        wo = await db.work_orders.find_one({"id": t["work_order_id"]}, {"_id": 0, "code": 1, "status": 1, "due_date": 1})
        v["work_order"] = wo
    if t.get("unread_customer") and v["can_reply"]:
        await db.tickets.update_one({"id": tid}, {"$set": {"unread_customer": False}})
    return v


async def _mine_writable(user, tid):
    t = await _get_mine(user, tid)
    if not _customer_view(t, user)["can_reply"]:
        raise HTTPException(403, "You can follow this request but not reply to it")
    return t


@router.post("/my/tickets/{tid}/messages")
async def my_message(tid: str, body: MessageIn, user=Depends(portal_user)):
    t = await _mine_writable(user, tid)
    if t["status"] == "cancelled":
        raise HTTPException(422, "This request was cancelled. Raise a new one.")
    m = _msg(user, body.text.strip(), user["role"])
    await db.tickets.update_one({"id": tid}, {"$set": {"updated_at": now_iso(), "last_message_at": now_iso(), "unread_staff": True},
                                              "$push": {"messages": m}})
    await _notify_staff(t, f"Reply on {t['code']} from {user['name']}", body.text[:140])
    return m


@router.post("/my/tickets/{tid}/files")
async def my_file(tid: str, file: UploadFile = File(...), user=Depends(portal_user)):
    t = await _mine_writable(user, tid)
    if t["status"] in ("cancelled", "closed"):
        raise HTTPException(422, "This request is closed")
    return await _save_file(tid, file, user, user["role"])


@router.post("/my/tickets/{tid}/files/{did}/link")
async def my_file_link(tid: str, did: str, user=Depends(portal_user)):
    await _get_mine(user, tid)
    d = await db.documents.find_one({"id": did, "entity_type": "ticket", "entity_id": tid}, {"_id": 0, "id": 1})
    if not d:
        raise HTTPException(404, "File not found")
    return _file_link(did, user["id"])


@router.post("/my/tickets/{tid}/cancel")
async def my_cancel(tid: str, body: dict, user=Depends(portal_user)):
    t = await _mine_writable(user, tid)
    if t["status"] not in ("open", "acknowledged", "on_hold"):
        raise HTTPException(422, "Work has started on this request; reply to it instead")
    reason = str(body.get("reason") or "No longer needed")[:300]
    await db.tickets.update_one({"id": tid}, {"$set": {"status": "cancelled", "updated_at": now_iso(), "unread_staff": True},
                                              "$push": {"messages": _msg(user, f"Cancelled: {reason}", user["role"], kind="event")}})
    await _notify_staff(t, f"{t['code']} cancelled by {user['name']}", reason)
    return {"ok": True}


@router.post("/my/tickets/{tid}/reopen")
async def my_reopen(tid: str, body: dict, user=Depends(portal_user)):
    t = await _mine_writable(user, tid)
    if t["status"] not in ("resolved", "closed"):
        raise HTTPException(422, "Only a resolved request can be reopened")
    if t.get("closed_at") and t["closed_at"] < (now() - timedelta(days=30)).isoformat():
        raise HTTPException(422, "This request was closed more than 30 days ago. Please raise a new one.")
    text = str(body.get("text") or "It is still not fixed")[:1000]
    await db.tickets.update_one({"id": tid}, {"$set": {"status": "in_progress", "resolved_at": None, "closed_at": None, "rating": None,
                                                       "updated_at": now_iso(), "last_message_at": now_iso(), "unread_staff": True},
                                              "$push": {"messages": {"$each": [_msg(user, "Reopened", user["role"], kind="event"), _msg(user, text, user["role"])]}}})
    await _notify_staff(t, f"{t['code']} reopened by {user['name']}", text)
    return {"ok": True}


@router.post("/my/tickets/{tid}/rate")
async def my_rate(tid: str, body: RateIn, user=Depends(portal_user)):
    t = await _mine_writable(user, tid)
    if t["status"] not in ("resolved", "closed"):
        raise HTTPException(422, "You can rate a request once it is resolved")
    rating = {"stars": body.stars, "comment": body.comment, "at": now_iso()}
    await db.tickets.update_one({"id": tid}, {"$set": {"rating": rating, "status": "closed", "closed_at": t.get("closed_at") or now_iso(),
                                                       "updated_at": now_iso(), "unread_customer": False},
                                              "$push": {"messages": _msg(user, f"Rated {body.stars}/5" + (f": {body.comment}" if body.comment else ""), user["role"], kind="event")}})
    if body.stars <= 2:
        await _notify_staff(t, f"Low rating on {t['code']} ({body.stars}/5)", body.comment or t["title"])
    return {"ok": True, "rating": rating}
