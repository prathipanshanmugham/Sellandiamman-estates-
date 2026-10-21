"""Owner portal: a property owner sees only their own properties, rent, statements, maintenance and stays."""
from datetime import timedelta
from typing import Optional
import jwt
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field
from core import (db, now, now_iso, new_id, next_code, owner_user, audit, notify, notify_roles, today_ist,
                  JWT_SECRET, JWT_ALG)
from routes_ops import _statement_data, statement_pdf_bytes, rent_receipt_pdf_bytes

router = APIRouter(prefix="/portal")
PROP_FIELDS = {"_id": 0, "id": 1, "code": 1, "listing_id": 1, "title": 1, "category": 1, "transaction": 1, "status": 1,
               "occupancy": 1, "locality": 1, "city": 1, "price": 1, "price_unit": 1, "images": 1, "service_type": 1,
               "mgmt_fee_pct": 1, "published_at": 1, "authorization": 1}


class RequestIn(BaseModel):
    property_id: str
    title: str = Field(min_length=3, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    priority: str = Field("medium", pattern=r"^(low|medium|high|urgent)$")


async def _props(owner_id):
    return await db.properties.find({"owner_id": owner_id, "deleted": {"$ne": True}}, PROP_FIELDS).to_list(500)


@router.get("/overview")
async def overview(user=Depends(owner_user)):
    oid = user["owner_id"]
    owner = await db.owners.find_one({"id": oid}, {"_id": 0, "id": 1, "code": 1, "name": 1, "is_nri": 1}) or {}
    props = await _props(oid)
    pids = [p["id"] for p in props]
    t = today_ist()
    month = t.strftime("%Y-%m")
    leases = await db.leases.find({"owner_id": oid, "status": "active"}, {"_id": 0}).to_list(200)
    arrears = round(sum(s["amount"] - s["paid"] for ls in leases for s in ls["schedule"]
                        if s["due_date"] < t.isoformat()), 2)
    rents, exps, calc = await _statement_data(oid, month)
    last = await db.owner_statements.find({"owner_id": oid}, {"_id": 0}).sort("month", -1).limit(1).to_list(1)
    open_wo = await db.work_orders.count_documents({"property_id": {"$in": pids},
                                                    "status": {"$in": ["open", "assigned", "in_progress"]}})
    upcoming = await db.bookings.count_documents({"property_id": {"$in": pids}, "status": "confirmed",
                                                  "check_in": {"$gte": t.isoformat()}})
    due_soon = []
    for ls in leases:
        nxt = next((s for s in ls["schedule"] if s["paid"] < s["amount"]), None)
        if nxt:
            due_soon.append({"lease_code": ls["code"], "property_title": ls["property_title"], "period": nxt["period"],
                             "due_date": nxt["due_date"], "balance": round(nxt["amount"] - nxt["paid"], 2)})
    bills_open = await db.lease_charges.count_documents({"owner_id": oid, "status": {"$in": ["due", "partly_paid"]}})
    open_tickets = await db.tickets.count_documents({"$or": [{"raised_by.user_id": user["id"]}, {"owner_id": oid, "visible_to_owner": True}],
                                                     "status": {"$in": ["open", "acknowledged", "in_progress", "on_hold"]}})
    return {"owner": owner, "properties": props, "month": month, "this_month": calc, "arrears": arrears,
            "bills_open": bills_open, "open_tickets": open_tickets,
            "active_leases": len(leases), "occupied": sum(1 for p in props if p.get("occupancy") == "occupied"),
            "last_statement": last[0] if last else None, "open_requests": open_wo, "upcoming_stays": upcoming,
            "rent_due": sorted(due_soon, key=lambda x: x["due_date"])[:10]}


@router.get("/leases")
async def leases(user=Depends(owner_user)):
    rows = await db.leases.find({"owner_id": user["owner_id"]},
                                {"_id": 0, "tenant_phone": 0, "tenant_email": 0, "notes": 0, "manager_id": 0}).sort("end_date", -1).to_list(200)
    t = today_ist().isoformat()
    for r in rows:
        r["arrears"] = round(sum(s["amount"] - s["paid"] for s in r.get("schedule", []) if s["due_date"] < t), 2)
        r["payments"] = await db.rent_payments.find({"lease_id": r["id"]}, {
            "_id": 0, "id": 1, "period": 1, "amount": 1, "date": 1, "method": 1, "receipt_no": 1}).sort("date", -1).to_list(200)
    return rows


@router.get("/statements")
async def statements(user=Depends(owner_user)):
    oid = user["owner_id"]
    settled = await db.owner_statements.find({"owner_id": oid}, {"_id": 0, "by": 0}).sort("month", -1).to_list(120)
    months = sorted({r["period"] for r in await db.rent_payments.find({"owner_id": oid}, {"_id": 0, "period": 1}).to_list(5000)},
                    reverse=True)
    return {"settled": settled, "months_with_rent": months}


@router.get("/statements/{month}")
async def statement(month: str, user=Depends(owner_user)):
    if len(month) != 7:
        raise HTTPException(422, "Month must be YYYY-MM")
    rents, exps, calc = await _statement_data(user["owner_id"], month)
    settled = await db.owner_statements.find_one({"owner_id": user["owner_id"], "month": month}, {"_id": 0, "by": 0})
    from routes_ops import owner_charge_items
    return {"month": month, "rents": [{k: r.get(k) for k in ("date", "lease_code", "period", "amount", "receipt_no")}
                                      for r in rents], **calc, "expense_items": exps,
            "charge_items": await owner_charge_items(user["owner_id"], month), "settled": settled}


@router.get("/statements/{month}/pdf")
async def statement_pdf(month: str, user=Depends(owner_user)):
    if len(month) != 7:
        raise HTTPException(422, "Month must be YYYY-MM")
    await audit(user, "portal_statement_download", "owners", user["owner_id"], {"month": month})
    return Response(await statement_pdf_bytes(user["owner_id"], month), media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename=statement-{month}.pdf"})


@router.get("/rent-receipts/{pid}/pdf")
async def rent_receipt(pid: str, user=Depends(owner_user)):
    p = await db.rent_payments.find_one({"id": pid, "owner_id": user["owner_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Receipt not found")
    return Response(await rent_receipt_pdf_bytes(p), media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename={p['receipt_no']}.pdf"})


@router.get("/work-orders")
async def work_orders(user=Depends(owner_user)):
    pids = [p["id"] for p in await _props(user["owner_id"])]
    rows = await db.work_orders.find({"property_id": {"$in": pids}}, {"_id": 0, "vendor_id": 0, "created_by": 0}).sort(
        "created_at", -1).to_list(500)
    for r in rows:
        r["history"] = [{"at": h["at"], "event": h["event"]} for h in r.get("history", [])]
    return rows


@router.post("/requests")
async def raise_request(body: RequestIn, user=Depends(owner_user)):
    prop = await db.properties.find_one({"id": body.property_id, "owner_id": user["owner_id"], "deleted": {"$ne": True}},
                                        {"_id": 0, "id": 1, "title": 1, "code": 1, "assigned_manager": 1})
    if not prop:
        raise HTTPException(404, "Property not found")
    wo = {"id": new_id(), "code": await next_code("wo", "WO-", 5), "property_id": prop["id"],
          "title": body.title, "description": body.description, "category": "general", "priority": body.priority,
          "due_date": None, "vendor_id": None, "quote_amount": None, "charge_to": "owner",
          "reported_by": f"Owner portal ({user['name']})", "property_title": prop["title"], "status": "open",
          "actual_cost": None, "history": [{"at": now_iso(), "by": user["name"], "event": "Raised by owner"}],
          "created_by": user["id"], "created_at": now_iso()}
    await db.work_orders.insert_one(dict(wo))
    await notify([prop.get("assigned_manager")], f"Owner request {wo['code']}: {body.title}", prop["title"],
                 "/erp/maintenance", dedupe=f"wo:{wo['id']}")
    await notify_roles(["branch_manager"], f"Owner request {wo['code']}: {body.title}", prop["title"],
                       "/erp/maintenance", dedupe=f"wo:{wo['id']}")
    await audit(user, "portal_request", "maintenance", wo["id"])
    wo.pop("created_by")
    return wo


@router.get("/bills")
async def bills(user=Depends(owner_user)):
    """Tenant bills on the owner's properties (EB, water, maintenance…) and whether they are paid."""
    from routes_bills import charge_view
    rows = await db.lease_charges.find({"owner_id": user["owner_id"]}, {"_id": 0, "created_by": 0, "customer_id": 0}).sort("due_date", -1).to_list(1000)
    return [charge_view(r) for r in rows]


@router.get("/bookings")
async def bookings(user=Depends(owner_user)):
    pids = [p["id"] for p in await _props(user["owner_id"])]
    keep = {"_id": 0, **{k: 1 for k in ("id", "code", "property_id", "property_title", "check_in", "check_out", "nights",
                                         "guests", "platform", "gross", "platform_fee", "net_after_platform",
                                         "management_fee", "mgmt_fee_pct", "operating_costs", "owner_payout",
                                         "status", "settled", "payout_status")}}
    return await db.bookings.find({"property_id": {"$in": pids}}, keep).sort("check_in", -1).to_list(500)


@router.get("/documents")
async def documents(user=Depends(owner_user)):
    pids = [p["id"] for p in await _props(user["owner_id"])]
    f = {"is_latest": True, "share_with_owner": True,
         "$or": [{"entity_type": "property", "entity_id": {"$in": pids}},
                 {"entity_type": "owner", "entity_id": user["owner_id"]}]}
    return await db.documents.find(f, {"_id": 0, "id": 1, "original_name": 1, "doc_type": 1, "entity_type": 1,
                                       "entity_id": 1, "expiry_date": 1, "created_at": 1, "version": 1}).sort(
        "created_at", -1).to_list(500)


@router.post("/documents/{did}/link")
async def doc_link(did: str, user=Depends(owner_user)):
    docs = {d["id"] for d in await documents(user)}
    if did not in docs:
        raise HTTPException(404, "Not found")
    tok = jwt.encode({"doc": did, "uid": user["id"], "typ": "file", "exp": now() + timedelta(minutes=5)}, JWT_SECRET,
                     algorithm=JWT_ALG)
    await audit(user, "document_link", "documents", did, {"portal": True})
    return {"url": f"/api/files/{tok}", "expires_in": 300}
