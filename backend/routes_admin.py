import csv
import io
import base64
from datetime import datetime, timedelta
from typing import Optional
import jwt
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel, Field
from core import (db, now, now_iso, new_id, require, can, scope, is_scoped, current_user, get_scoped, audit, notify,
                  notify_roles, get_settings, save_upload, today_ist, JWT_SECRET, JWT_ALG, UPLOAD_DIR, IMAGE_TYPES,
                  DOC_TYPES, IST, PERMS)
from routes_finance import do_reverse, apply_credit_note
from routes_deals import apply_commission
from routes_ops import apply_booking_cancel

router = APIRouter()


# ---------------- Dashboard ----------------
def _rng(frm, to):
    return {"$gte": frm or "0000", "$lte": (to or "9999") + "T23:59:59~"}


async def _sum(coll, match, field):
    r = await db[coll].aggregate([{"$match": match}, {"$group": {"_id": None, "t": {"$sum": f"${field}"}}}]).to_list(1)
    return round(r[0]["t"], 2) if r else 0.0


@router.get("/dashboard")
async def dashboard(frm: Optional[str] = None, to: Optional[str] = None, user=Depends(require("dashboard", "r"))):
    rng = _rng(frm, to)
    nowl = datetime.now(IST).strftime("%Y-%m-%dT%H:%M")
    t = today_ist()
    out = {"range": {"from": frm, "to": to}}
    if can(user, "leads", "r"):
        lf = {"deleted": {"$ne": True}, **scope(user, "leads")}
        out["leads"] = {
            "new": await db.leads.count_documents({**lf, "created_at": rng}),
            "awaiting_followup": await db.leads.count_documents({**lf, "stage": {"$nin": ["won", "lost"]},
                                                                 "next_follow_up": {"$lt": nowl, "$ne": None}}),
            "qualified": await db.leads.count_documents({**lf, "stage": {"$in": ["qualified", "requirements", "matched",
                                                                                  "site_visit", "negotiation"]}}),
            "by_stage": {r["_id"]: r["n"] for r in await db.leads.aggregate(
                [{"$match": lf}, {"$group": {"_id": "$stage", "n": {"$sum": 1}}}]).to_list(20)},
            "by_source": [{"source": r["_id"], "leads": r["n"], "won": r["won"]} for r in await db.leads.aggregate(
                [{"$match": {**lf, "created_at": rng}}, {"$group": {"_id": "$source", "n": {"$sum": 1}, "won": {
                    "$sum": {"$cond": [{"$eq": ["$stage", "won"]}, 1, 0]}}}}]).to_list(20)],
        }
        vf = {} if not scope(user, "leads") else {"agent_id": user["id"]}
        out["site_visits"] = {"scheduled": await db.site_visits.count_documents({**vf, "status": "scheduled"}),
                              "completed": await db.site_visits.count_documents({**vf, "status": "completed",
                                                                                 "updated_at": rng})}
        staff = await db.leads.aggregate([{"$match": {**lf, "assigned_to": {"$ne": None}}}, {"$group": {
            "_id": "$assigned_to", "open": {"$sum": {"$cond": [{"$in": ["$stage", ["won", "lost"]]}, 0, 1]}},
            "won": {"$sum": {"$cond": [{"$eq": ["$stage", "won"]}, 1, 0]}}, "total": {"$sum": 1}}}]).to_list(200)
        names = {u["id"]: u["name"] for u in await db.users.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(500)}
        out["staff"] = [{"name": names.get(s["_id"], "-"), "open": s["open"], "won": s["won"],
                         "conversion": round(100 * s["won"] / s["total"], 1) if s["total"] else 0} for s in staff]
    if can(user, "deals", "r"):
        df = {"deleted": {"$ne": True}, **scope(user, "deals")}
        out["deals"] = {"negotiating": await db.deals.count_documents({**df, "stage": {"$in": ["negotiation", "agreement", "closing"]}}),
                        "closed": await db.deals.count_documents({**df, "stage": "won", "closed_at": rng})}
    if can(user, "leases", "r") or can(user, "maintenance", "r"):
        soon = (t + timedelta(days=60)).isoformat()
        leases = await db.leases.find({"status": "active"}, {"_id": 0, "rent": 1, "mgmt_fee_pct": 1, "end_date": 1}).to_list(5000)
        out["pm"] = {"active_leases": len(leases),
                     "expiring_60d": sum(1 for x in leases if x["end_date"] <= soon),
                     "vacant": await db.properties.count_documents({"transaction": {"$in": ["rent", "lease"]},
                                                                    "occupancy": "vacant", "status": {"$in": ["published", "ready_to_market"]}}),
                     "open_work_orders": await db.work_orders.count_documents({"status": {"$in": ["open", "assigned", "in_progress"]}})}
    if can(user, "shortstay", "r"):
        bf = {"status": {"$ne": "cancelled"}, "check_in": _rng(frm, to)}
        bks = await db.bookings.find(bf, {"_id": 0, "nights": 1, "gross": 1, "room_revenue": 1}).to_list(5000)
        nights = sum(b["nights"] for b in bks)
        out["shortstay"] = {"bookings": len(bks), "gross": round(sum(b["gross"] for b in bks), 2),
                            "nights": nights, "adr": round(sum(b["room_revenue"] for b in bks) / nights, 2) if nights else 0}
    if can(user, "finance", "r"):
        open_deals = await db.deals.find({"stage": {"$in": ["negotiation", "agreement", "closing"]}},
                                         {"_id": 0, "commission": 1}).to_list(5000)
        quoted = sum((d.get("commission") or {}).get("gross", 0) for d in open_deals
                     if d.get("commission") and not d["commission"].get("agreement_signed"))
        expected = sum(d["commission"]["gross"] for d in open_deals
                       if d.get("commission") and d["commission"].get("agreement_signed"))
        inv_m = {"status": {"$ne": "void"}, "issue_date": rng}
        invs = await db.invoices.find({"status": {"$nin": ["void"]}}, {"_id": 0}).to_list(10000)
        receivable = round(sum(i["total"] - i["paid"] - i.get("credited", 0) for i in invs), 2)
        overdue = round(sum(i["total"] - i["paid"] - i.get("credited", 0) for i in invs
                            if i["due_date"] < t.isoformat() and i["status"] in ("issued", "partially_paid")), 2)
        collected = await _sum("ledger_entries", {"ledger": "company", "direction": "in", "account": {"$regex": "^revenue:"},
                                                  "posted_at": rng}, "amount")
        reversed_rev = await _sum("ledger_entries", {"ledger": "company", "direction": "out", "account": {"$regex": "^revenue:"},
                                                     "posted_at": rng}, "amount")
        expenses = await _sum("ledger_entries", {"ledger": "company", "direction": "out", "account": {"$regex": "^(expense|refund)"},
                                                 "posted_at": rng}, "amount")
        by_service = await db.ledger_entries.aggregate([{"$match": {"ledger": "company", "account": {"$regex": "^revenue:"},
                                                                    "posted_at": rng}},
                                                        {"$group": {"_id": "$account", "t": {"$sum": {"$cond": [
                                                            {"$eq": ["$direction", "in"]}, "$amount", {"$multiply": ["$amount", -1]}]}}}}]).to_list(20)
        leases = await db.leases.find({"status": "active"}, {"_id": 0, "rent": 1, "mgmt_fee_pct": 1}).to_list(5000)
        trend = []
        for i in range(5, -1, -1):
            y, m = t.year, t.month - i
            while m <= 0:
                m += 12
                y -= 1
            key = f"{y}-{m:02d}"
            trend.append({"month": key,
                          "collected": await _sum("ledger_entries", {"ledger": "company", "direction": "in",
                                                                     "account": {"$regex": "^revenue:"}, "posted_at": {"$regex": f"^{key}"}}, "amount"),
                          "expenses": await _sum("ledger_entries", {"ledger": "company", "direction": "out",
                                                                    "account": {"$regex": "^expense"}, "posted_at": {"$regex": f"^{key}"}}, "amount")})
        out["finance"] = {
            "quoted_commission": round(quoted, 2), "expected_commission": round(expected, 2),
            "earned_commission": await _sum("deals", {"stage": "won", "closed_at": rng}, "final_commission"),
            "invoiced": await _sum("invoices", inv_m, "total"), "collected": round(collected - reversed_rev, 2),
            "receivables": receivable, "overdue_receivables": overdue, "expenses": expenses,
            "operating_cash_flow": round(collected - reversed_rev - expenses, 2),
            "monthly_recurring_mgmt": round(sum(x["rent"] * x["mgmt_fee_pct"] / 100 for x in leases), 2),
            "by_service": [{"service": r["_id"].split(":")[1], "amount": round(r["t"], 2)} for r in by_service],
            "trend": trend,
            "marketing_spend": await _sum("expenses", {"category": {"$regex": "^marketing", "$options": "i"}, "date": rng}, "amount"),
        }
    return out


# ---------------- Reports (CSV) ----------------
REPORTS = {
    "leads": ("leads", "leads", ["code", "name", "phone", "source", "interest", "stage", "lost_reason", "created_at"]),
    "deals": ("deals", "deals", ["code", "title", "deal_type", "stage", "agreed_value", "expected_commission",
                                 "final_commission", "closed_at"]),
    "invoices": ("invoices", "finance", ["number", "type", "customer_name", "issue_date", "due_date", "total", "paid",
                                         "credited", "status"]),
    "ledger": ("ledger_entries", "finance", ["code", "ledger", "direction", "amount", "account", "description",
                                             "posted_at", "reversed", "reversal_of"]),
    "leases": ("leases", "leases", ["code", "property_title", "tenant_name", "start_date", "end_date", "rent",
                                    "mgmt_fee_pct", "deposit_held", "status"]),
    "bookings": ("bookings", "shortstay", ["code", "property_title", "check_in", "check_out", "nights", "gross",
                                           "platform_fee", "management_fee", "owner_payout", "status", "settled"]),
    "work_orders": ("work_orders", "maintenance", ["code", "property_title", "title", "priority", "status",
                                                   "quote_amount", "actual_cost", "charge_to", "created_at"]),
    "properties": ("properties", "properties", ["code", "listing_id", "title", "category", "transaction", "city",
                                                "locality", "status", "authorization", "created_at"]),
    "owner_statements": ("owner_statements", "finance", ["code", "owner_name", "month", "rent_collected",
                                                         "management_fee", "expenses", "net_payable", "payout_status"]),
}


@router.get("/reports/{name}.csv")
async def report_csv(name: str, frm: Optional[str] = None, to: Optional[str] = None, user=Depends(current_user)):
    if name not in REPORTS:
        raise HTTPException(404, "Unknown report")
    coll, module, cols = REPORTS[name]
    if not (can(user, module, "r") and (can(user, module, "e") or can(user, "reports", "e"))):
        await audit(user, "permission_denied", "reports", name)
        raise HTTPException(403, "You do not have permission to export this report")
    f = {"deleted": {"$ne": True}} if coll in ("leads", "deals", "properties") else {}
    if module in ("leads", "deals", "properties", "leases"):
        f.update(scope(user, module))
    rows = await db[coll].find(f, {"_id": 0}).to_list(20000)
    if frm or to:
        rows = [r for r in rows if (frm or "") <= str(r.get(cols[-2]) or r.get("created_at") or "")[:10] <= (to or "9999")]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(cols)
    for r in rows:
        w.writerow([r.get(c) if not isinstance(r.get(c), dict) else r[c].get("expiry", "") for c in cols])
    await audit(user, "export", "reports", name, {"rows": len(rows)})
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f"attachment; filename={name}.csv"})


# ---------------- Documents ----------------
ENTITY_MODULE = {"property": "properties", "lead": "leads", "deal": "deals", "lease": "leases", "owner": "owners",
                 "booking": "shortstay", "work_order": "maintenance", "vendor": "maintenance", "company": "settings"}
ENTITY_COLL = {"property": "properties", "lead": "leads", "deal": "deals"}


async def _check_entity(user, etype, eid, action="r"):
    mod = ENTITY_MODULE.get(etype)
    if not mod or not can(user, mod, action):
        raise HTTPException(404, "Record not found")
    if etype in ENTITY_COLL:
        await get_scoped(ENTITY_COLL[etype], mod, user, eid)


@router.get("/documents")
async def list_docs(entity_type: Optional[str] = None, entity_id: Optional[str] = None, q: Optional[str] = None,
                    expiring: bool = False, user=Depends(require("documents", "r"))):
    f = {"is_latest": True}
    if entity_type and entity_id:
        await _check_entity(user, entity_type, entity_id)
        f.update({"entity_type": entity_type, "entity_id": entity_id})
    else:
        allowed = [k for k, m in ENTITY_MODULE.items() if can(user, m, "r")]
        f["entity_type"] = {"$in": allowed}
        if is_scoped(user, "properties") or is_scoped(user, "leases"):
            f["uploaded_by"] = user["id"]
    if q:
        f["$or"] = [{"original_name": {"$regex": q[:40], "$options": "i"}}, {"doc_type": q[:40]}]
    if expiring:
        f["expiry_date"] = {"$ne": None, "$lte": (today_ist() + timedelta(days=30)).isoformat()}
    return await db.documents.find(f, {"_id": 0, "stored_name": 0}).sort("created_at", -1).to_list(2000)


@router.post("/documents")
async def upload_doc(entity_type: str = Form(...), entity_id: str = Form(...), doc_type: str = Form(...),
                     expiry_date: Optional[str] = Form(None), notes: Optional[str] = Form(None),
                     file: UploadFile = File(...), user=Depends(require("documents", "w"))):
    await _check_entity(user, entity_type, entity_id)
    saved = await save_upload(file, DOC_TYPES)
    prev = await db.documents.find_one({"entity_type": entity_type, "entity_id": entity_id, "doc_type": doc_type,
                                        "original_name": saved["original_name"], "is_latest": True}, {"_id": 0})
    version = (prev["version"] + 1) if prev else 1
    if prev:
        await db.documents.update_one({"id": prev["id"]}, {"$set": {"is_latest": False}})
    d = {"id": new_id(), **saved, "entity_type": entity_type, "entity_id": entity_id, "doc_type": doc_type[:40],
         "expiry_date": expiry_date or None, "notes": notes, "version": version, "is_latest": True,
         "previous_id": prev["id"] if prev else None, "public_approved": False, "uploaded_by": user["id"],
         "uploaded_by_name": user["name"], "created_at": now_iso()}
    await db.documents.insert_one(dict(d))
    await audit(user, "document_uploaded", "documents", d["id"], {"entity": f"{entity_type}:{entity_id}", "v": version})
    d.pop("stored_name")
    return d


@router.get("/documents/{did}/versions")
async def versions(did: str, user=Depends(require("documents", "r"))):
    d = await db.documents.find_one({"id": did}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Not found")
    await _check_entity(user, d["entity_type"], d["entity_id"])
    return await db.documents.find({"entity_type": d["entity_type"], "entity_id": d["entity_id"], "doc_type": d["doc_type"],
                                    "original_name": d["original_name"]}, {"_id": 0, "stored_name": 0}).sort("version", -1).to_list(50)


@router.post("/documents/{did}/link")
async def doc_link(did: str, user=Depends(require("documents", "r"))):
    d = await db.documents.find_one({"id": did}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Not found")
    await _check_entity(user, d["entity_type"], d["entity_id"])
    if d["doc_type"] == "kyc" and not can(user, "documents", "a"):
        raise HTTPException(403, "KYC documents need elevated access")
    tok = jwt.encode({"doc": did, "uid": user["id"], "typ": "file", "exp": now() + timedelta(minutes=5)}, JWT_SECRET,
                     algorithm=JWT_ALG)
    await audit(user, "document_link", "documents", did)
    return {"url": f"/api/files/{tok}", "expires_in": 300}


@router.get("/files/{token}")
async def serve_file(token: str):
    try:
        p = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        if p.get("typ") != "file":
            raise jwt.InvalidTokenError()
    except jwt.InvalidTokenError:
        raise HTTPException(403, "Link is invalid or expired")
    d = await db.documents.find_one({"id": p["doc"]}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Not found")
    await audit({"id": p["uid"], "name": "", "role": None}, "document_downloaded", "documents", d["id"])
    return FileResponse(UPLOAD_DIR / d["stored_name"], media_type=d["content_type"], filename=d["original_name"])


@router.post("/documents/{did}/approve-public")
async def approve_public(did: str, user=Depends(require("cms", "p"))):
    d = await db.documents.find_one({"id": did}, {"_id": 0})
    if not d or d["content_type"] not in IMAGE_TYPES or d["entity_type"] != "property":
        raise HTTPException(422, "Only property photos can be approved for the website")
    await db.documents.update_one({"id": did}, {"$set": {"public_approved": True}})
    await db.properties.update_one({"id": d["entity_id"]}, {"$addToSet": {"images": f"/api/public/media/{did}"}})
    await audit(user, "media_approved", "documents", did)
    return {"ok": True}


# ---------------- Tasks ----------------
class TaskIn(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    description: Optional[str] = None
    assigned_to: Optional[str] = None
    due_date: Optional[str] = None
    priority: str = Field("medium", pattern=r"^(low|medium|high|urgent)$")
    kind: str = "general"
    related_type: Optional[str] = None
    related_id: Optional[str] = None


@router.get("/tasks")
async def list_tasks(user=Depends(require("tasks", "r"))):
    f = {}
    if user["role"] not in ("super_admin", "director", "branch_manager"):
        f["$or"] = [{"assigned_to": user["id"]}, {"created_by": user["id"]}]
        if can(user, "shortstay", "w"):
            f["$or"].append({"kind": "cleaning"})
    return await db.tasks.find(f, {"_id": 0}).sort("due_date", 1).to_list(2000)


@router.post("/tasks")
async def new_task(body: TaskIn, user=Depends(require("tasks", "w"))):
    t = {"id": new_id(), **body.model_dump(), "status": "open", "created_by": user["id"], "comments": [],
         "created_at": now_iso()}
    t["assigned_to"] = t["assigned_to"] or user["id"]
    await db.tasks.insert_one(dict(t))
    if t["assigned_to"] != user["id"]:
        await notify([t["assigned_to"]], f"Task assigned: {t['title']}", "", "/erp/tasks", dedupe=f"task:{t['id']}")
    return t


@router.patch("/tasks/{tid}")
async def update_task(tid: str, body: dict, user=Depends(require("tasks", "w"))):
    t = await db.tasks.find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Task not found")
    mine = user["id"] in (t.get("assigned_to"), t.get("created_by")) or (t.get("kind") == "cleaning" and can(user, "shortstay", "w"))
    if not mine and user["role"] not in ("super_admin", "director", "branch_manager"):
        raise HTTPException(404, "Task not found")
    upd = {k: body[k] for k in ("status", "priority", "due_date", "assigned_to") if k in body}
    if upd.get("status") and upd["status"] not in ("open", "in_progress", "done"):
        raise HTTPException(422, "Invalid status")
    op = {"$set": upd} if upd else {}
    if body.get("comment"):
        op["$push"] = {"comments": {"at": now_iso(), "by": user["name"], "text": str(body["comment"])[:1000]}}
    if op:
        await db.tasks.update_one({"id": tid}, op)
    return {"ok": True}


# ---------------- Notifications & automations ----------------
@router.get("/notifications")
async def my_notifications(user=Depends(current_user)):
    return await db.notifications.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)


@router.post("/notifications/read")
async def read_all(user=Depends(current_user)):
    await db.notifications.update_many({"user_id": user["id"], "read": False}, {"$set": {"read": True}})
    return {"ok": True}


async def run_automations():
    t = today_ist()
    ts = t.isoformat()
    nowl = datetime.now(IST).strftime("%Y-%m-%dT%H:%M")
    n = 0
    async for ld in db.leads.find({"stage": {"$nin": ["won", "lost"]}, "next_follow_up": {"$lt": nowl, "$ne": None},
                                   "assigned_to": {"$ne": None}}, {"_id": 0}):
        await notify([ld["assigned_to"]], f"Overdue follow-up: {ld['name']}", ld["next_follow_up"],
                     f"/erp/leads/{ld['id']}", dedupe=f"fu:{ld['id']}:{ld['next_follow_up']}", kind="warning")
        n += 1
    soon = (t + timedelta(days=60)).isoformat()
    async for ls in db.leases.find({"status": "active", "end_date": {"$lte": soon}}, {"_id": 0, "schedule": 0}):
        await notify([ls.get("manager_id")], f"Lease expiring: {ls['code']}", f"Ends {ls['end_date']}", "/erp/leases",
                     dedupe=f"lexp:{ls['id']}", kind="warning")
        n += 1
    async for ls in db.leases.find({"status": "active"}, {"_id": 0}):
        due = [s for s in ls["schedule"] if s["due_date"] < ts and s["paid"] < s["amount"]]
        if due:
            await notify([ls.get("manager_id")], f"Rent arrears: {ls['code']}", f"{len(due)} period(s) unpaid",
                         "/erp/leases", dedupe=f"arr:{ls['id']}:{due[-1]['period']}", kind="warning")
            n += 1
    auth_soon = (t + timedelta(days=30)).isoformat()
    async for p in db.properties.find({"status": {"$in": ["published", "ready_to_market", "verified"]},
                                       "authorization.expiry": {"$lte": auth_soon}}, {"_id": 0}):
        await notify_roles(["branch_manager", "director"], f"Listing authorisation expiring: {p['code']}",
                           p["authorization"].get("expiry", ""), f"/erp/properties/{p['id']}",
                           dedupe=f"auth:{p['id']}:{p['authorization'].get('expiry')}", kind="warning")
        if p["authorization"].get("expiry", "9999") < ts and p["status"] == "published":
            await db.properties.update_one({"id": p["id"]}, {"$set": {"status": "ready_to_market"},
                                                             "$push": {"publication_history": {"at": now_iso(), "by": "System",
                                                                                               "action": "unpublished (authorisation expired)"}}})
        n += 1
    async for d in db.documents.find({"is_latest": True, "expiry_date": {"$ne": None, "$lte": auth_soon}}, {"_id": 0}):
        await notify([d.get("uploaded_by")], f"Document expiring: {d['original_name']}", d["expiry_date"], "/erp/documents",
                     dedupe=f"doc:{d['id']}", kind="warning")
        n += 1
    async for i in db.invoices.find({"status": {"$in": ["issued", "partially_paid"]}, "due_date": {"$lt": ts}}, {"_id": 0}):
        await notify_roles(["accountant"], f"Invoice overdue: {i['number']}", i["customer_name"], "/erp/finance",
                           dedupe=f"inv:{i['id']}", kind="warning")
        n += 1
    tmr = (t + timedelta(days=1)).isoformat()
    async for b in db.bookings.find({"status": "confirmed", "check_in": {"$in": [ts, tmr]}}, {"_id": 0}):
        await notify_roles(["shortstay_ops"], f"Check-in {b['check_in']}: {b['code']}", b["property_title"],
                           "/erp/short-stay", dedupe=f"ci:{b['id']}")
        n += 1
    async for w in db.work_orders.find({"status": {"$in": ["open", "assigned", "in_progress"]}, "due_date": {"$lt": ts, "$ne": None}}, {"_id": 0}):
        await notify_roles(["branch_manager", "property_manager"], f"Work order overdue: {w['code']}", w["title"],
                           "/erp/maintenance", dedupe=f"wo_due:{w['id']}", kind="warning")
        n += 1
    return n


@router.post("/automations/run")
async def run_now(user=Depends(require("dashboard", "r"))):
    return {"checked": await run_automations()}


# ---------------- Approvals ----------------
APPROVAL_PERM = {"commission_change": ("deals", "a"), "ledger_reversal": ("finance", "a"),
                 "credit_note": ("finance", "a"), "booking_refund": ("shortstay", "a")}


@router.get("/approvals")
async def list_approvals(user=Depends(current_user)):
    kinds = [k for k, (m, a) in APPROVAL_PERM.items() if can(user, m, a)]
    f = {"$or": [{"kind": {"$in": kinds}}, {"requested_by": user["id"]}]}
    return await db.approvals.find(f, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.post("/approvals/{aid}/decide")
async def decide(aid: str, body: dict, user=Depends(current_user)):
    ap = await db.approvals.find_one({"id": aid}, {"_id": 0})
    if not ap:
        raise HTTPException(404, "Approval not found")
    m, a = APPROVAL_PERM[ap["kind"]]
    if not can(user, m, a):
        raise HTTPException(403, "You are not authorised to decide this approval")
    if ap["requested_by"] == user["id"]:
        raise HTTPException(403, "You cannot approve your own request")
    approve = bool(body.get("approve"))
    r = await db.approvals.update_one({"id": aid, "status": "pending"}, {"$set": {
        "status": "approved" if approve else "rejected", "decided_by": user["id"], "decided_by_name": user["name"],
        "decided_at": now_iso(), "decision_note": body.get("note")}})
    if not r.modified_count:
        raise HTTPException(409, "Already decided")
    if approve:
        try:
            if ap["kind"] == "commission_change":
                deal = await db.deals.find_one({"id": ap["entity_id"]}, {"_id": 0})
                await apply_commission(deal, ap["payload"], user)
            elif ap["kind"] == "ledger_reversal":
                e = await db.ledger_entries.find_one({"id": ap["entity_id"]}, {"_id": 0})
                await do_reverse(e, ap["payload"]["reason"], user)
            elif ap["kind"] == "credit_note":
                inv = await db.invoices.find_one({"id": ap["entity_id"]}, {"_id": 0})
                await apply_credit_note(inv, ap["payload"], user)
            elif ap["kind"] == "booking_refund":
                b = await db.bookings.find_one({"id": ap["entity_id"]}, {"_id": 0})
                await apply_booking_cancel(b, ap["payload"], user)
        except HTTPException as e:
            await db.approvals.update_one({"id": aid}, {"$set": {"status": "failed", "decision_note": e.detail}})
            raise
    await audit(user, f"approval_{'approved' if approve else 'rejected'}", "approvals", aid, {"kind": ap["kind"]})
    await notify([ap["requested_by"]], f"Your request was {'approved' if approve else 'rejected'}", ap["summary"],
                 "/erp/approvals", dedupe=f"apd:{aid}")
    return {"ok": True}


# ---------------- Settings / CMS / audit / branches / campaigns ----------------
SETTINGS_FIELDS = ["name", "legal_name", "phone", "whatsapp", "email", "address", "gstin", "gst_enabled", "gst_rate",
                   "cities", "localities", "approvals", "demo_mode", "invoice_due_days", "office_hours", "enquiry_routing"]
CMS_FIELDS = ["hero_title", "hero_subtitle", "seo_title", "seo_description", "testimonials"]


@router.get("/settings")
async def get_all_settings(user=Depends(current_user)):
    if not (can(user, "settings", "r") or can(user, "cms", "r")):
        raise HTTPException(403, "You do not have permission for this action")
    return await get_settings()


@router.put("/settings")
async def put_settings(body: dict, user=Depends(current_user)):
    allowed = (SETTINGS_FIELDS if can(user, "settings", "w") else []) + (CMS_FIELDS if can(user, "cms", "w") else [])
    if not allowed:
        raise HTTPException(403, "You do not have permission for this action")
    upd = {k: v for k, v in body.items() if k in allowed}
    if "gst_rate" in upd:
        rate = float(upd["gst_rate"] or 0)
        if rate < 0 or rate > 28:
            raise HTTPException(422, "GST rate must be between 0 and 28")
        upd["gst_rate"] = rate
    await db.settings.update_one({"id": "company"}, {"$set": upd}, upsert=True)
    await audit(user, "settings_updated", "settings", "company", upd)
    return await get_settings()


@router.post("/settings/logo")
async def upload_logo(file: UploadFile = File(...), user=Depends(require("settings", "w"))):
    data = await file.read()
    if file.content_type not in ("image/png", "image/jpeg", "image/webp") or len(data) > 1024 * 1024:
        raise HTTPException(422, "Logo must be PNG/JPEG/WebP under 1 MB")
    url = f"data:{file.content_type};base64,{base64.b64encode(data).decode()}"
    await db.settings.update_one({"id": "company"}, {"$set": {"logo": url}}, upsert=True)
    await audit(user, "logo_updated", "settings", "company")
    return {"ok": True}


@router.get("/audit")
async def audit_logs(entity: Optional[str] = None, entity_id: Optional[str] = None, user=Depends(require("audit", "r"))):
    f = {}
    if entity:
        f["entity"] = entity
    if entity_id:
        f["entity_id"] = entity_id
    return await db.audit_logs.find(f, {"_id": 0}).sort("at", -1).to_list(1000)


@router.get("/branches")
async def branches(user=Depends(current_user)):
    return await db.branches.find({}, {"_id": 0}).to_list(100)


@router.get("/campaigns")
async def campaigns(user=Depends(require("cms", "r"))):
    rows = await db.campaigns.find({}, {"_id": 0}).to_list(200)
    for c in rows:
        c["leads"] = await db.leads.count_documents({"campaign_id": c["id"]})
        c["won"] = await db.leads.count_documents({"campaign_id": c["id"], "stage": "won"})
    return rows


@router.post("/campaigns")
async def new_campaign(body: dict, user=Depends(require("cms", "w"))):
    if not body.get("name") or not body.get("code"):
        raise HTTPException(422, "Name and code are required")
    if await db.campaigns.find_one({"code": body["code"]}):
        raise HTTPException(409, "Campaign code already exists")
    c = {"id": new_id(), "name": str(body["name"])[:120], "code": str(body["code"])[:40], "channel": body.get("channel"),
         "budget": float(body.get("budget") or 0), "start_date": body.get("start_date"), "created_at": now_iso()}
    await db.campaigns.insert_one(dict(c))
    return c
