"""Tenant portal: a tenant sees only their own leases: rent schedule and receipts, bills (EB, water…), deposit,
shared documents and how to pay; they can tell us about a payment they made and raise service requests (/api/my/*)."""
from datetime import timedelta
from typing import Optional
from urllib.parse import quote
import jwt
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from pymongo.errors import DuplicateKeyError
from core import (db, now, now_iso, new_id, tenant_user, audit, notify, notify_roles, get_settings_cached, today_ist,
                  JWT_SECRET, JWT_ALG)
from routes_bills import NoticeIn, charge_view, bill_receipt_pdf_bytes, period_text
from routes_ops import rent_receipt_pdf_bytes

router = APIRouter(prefix="/tenant")
HIDE = {"_id": 0, "notes": 0, "mgmt_fee_pct": 0, "owner_id": 0, "manager_id": 0, "issues": 0}


async def _leases(user):
    return await db.leases.find({"customer_id": user["customer_id"]}, HIDE).sort([("status", 1), ("end_date", -1)]).to_list(50)


async def _lease(user, lid):
    ls = await db.leases.find_one({"id": lid, "customer_id": user["customer_id"]}, HIDE)
    if not ls:
        raise HTTPException(404, "Lease not found")
    return ls


def _rent_summary(ls):
    t = today_ist().isoformat()
    sched = ls.get("schedule", [])
    nxt = next((s for s in sched if s["paid"] < s["amount"] - 0.001), None)
    return {"arrears": round(sum(s["amount"] - s["paid"] for s in sched if s["due_date"] < t), 2),
            "next_due": nxt and {"period": nxt["period"], "due_date": nxt["due_date"], "balance": round(nxt["amount"] - nxt["paid"], 2),
                                 "overdue": nxt["due_date"] < t},
            "paid_total": round(sum(s["paid"] for s in sched), 2)}


async def _manager(ls):
    m = await db.users.find_one({"id": ls.get("manager_id")}, {"_id": 0, "name": 1, "phone": 1, "whatsapp": 1, "email": 1}) if ls.get("manager_id") else None
    return m


async def _pay_to():
    s = await get_settings_cached()
    out = {k: s.get(f"pay_{k}") for k in ("upi_id", "account_name", "bank_name", "account_no", "ifsc", "note")}
    out["company_phone"] = s.get("phone")
    out["company_whatsapp"] = s.get("whatsapp")
    return out


@router.get("/overview")
async def overview(user=Depends(tenant_user)):
    c = await db.customers.find_one({"id": user["customer_id"]}, {"_id": 0, "id": 1, "code": 1, "name": 1, "phone": 1, "email": 1}) or {}
    leases = await _leases(user)
    out = []
    for ls in leases:
        raw = await db.leases.find_one({"id": ls["id"]}, {"_id": 0, "manager_id": 1})
        prop = await db.properties.find_one({"id": ls["property_id"]}, {"_id": 0, "title": 1, "locality": 1, "city": 1, "images": 1,
                                                                         "category": 1, "address": 1})
        out.append({**{k: ls[k] for k in ("id", "code", "property_id", "property_title", "status", "start_date", "end_date", "rent",
                                          "due_day", "deposit", "deposit_held", "escalation_pct", "lease_type") if k in ls},
                    **_rent_summary(ls), "property": prop, "manager": await _manager(raw or {})})
    lids = [ls["id"] for ls in leases]
    bills = [charge_view(b) for b in await db.lease_charges.find({"lease_id": {"$in": lids}, "status": {"$in": ["due", "partly_paid"]}},
                                                              {"_id": 0}).sort("due_date", 1).to_list(100)]
    open_t = await db.tickets.count_documents({"customer_id": user["customer_id"], "status": {"$in": ["open", "acknowledged", "in_progress", "on_hold"]}})
    pending = await db.payment_notices.count_documents({"user_id": user["id"], "status": "pending"})
    return {"customer": c, "leases": out, "bills_due": bills, "bills_total": round(sum(b["balance"] for b in bills), 2),
            "open_requests": open_t, "pending_notices": pending, "pay_to": await _pay_to()}


@router.get("/leases/{lid}")
async def lease(lid: str, user=Depends(tenant_user)):
    ls = await _lease(user, lid)
    ls.update(_rent_summary(ls))
    ls["payments"] = await db.rent_payments.find({"lease_id": lid}, {"_id": 0, "id": 1, "period": 1, "amount": 1, "date": 1, "method": 1,
                                                                    "reference": 1, "receipt_no": 1}).sort("date", -1).to_list(500)
    ls["deposit_movements"] = await db.deposit_movements.find({"lease_id": lid}, {"_id": 0, "amount": 1, "direction": 1, "reason": 1,
                                                                                 "created_at": 1}).sort("created_at", -1).to_list(50)
    ls["handovers"] = [{k: h.get(k) for k in ("kind", "date", "meter_readings", "notes", "items")} for h in ls.get("handovers", [])]
    ls["notices"] = await db.payment_notices.find({"lease_id": lid, "user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return ls


@router.get("/bills")
async def bills(user=Depends(tenant_user)):
    lids = [ls["id"] for ls in await _leases(user)]
    rows = [charge_view(b) for b in await db.lease_charges.find({"lease_id": {"$in": lids}}, {"_id": 0, "created_by": 0}).sort("due_date", -1).to_list(1000)]
    pays = await db.charge_payments.find({"lease_id": {"$in": lids}}, {"_id": 0, "id": 1, "charge_id": 1, "amount": 1, "date": 1, "method": 1,
                                                                      "reference": 1, "receipt_no": 1}).sort("date", -1).to_list(2000)
    by = {}
    for p in pays:
        by.setdefault(p["charge_id"], []).append(p)
    for r in rows:
        r["payments"] = by.get(r["id"], [])
        for k in ("owner_id", "branch_id", "customer_id", "payee"):
            r.pop(k, None)
    return rows


@router.get("/rent-receipts/{pid}/pdf")
async def rent_receipt(pid: str, user=Depends(tenant_user)):
    p = await db.rent_payments.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Receipt not found")
    await _lease(user, p["lease_id"])
    await audit(user, "tenant_receipt_download", "leases", p["lease_id"], {"receipt": p["receipt_no"]})
    return Response(await rent_receipt_pdf_bytes(p), media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename={p['receipt_no']}.pdf"})


@router.get("/bill-receipts/{pid}/pdf")
async def bill_receipt(pid: str, user=Depends(tenant_user)):
    p = await db.charge_payments.find_one({"id": pid}, {"_id": 0})
    if not p or not p.get("receipt_no"):
        raise HTTPException(404, "Receipt not found")
    await _lease(user, p["lease_id"])
    return Response(await bill_receipt_pdf_bytes(p), media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename={p['receipt_no']}.pdf"})


@router.get("/pay")
async def pay(lease_id: str, kind: str = "rent", period: Optional[str] = None, charge_id: Optional[str] = None,
              user=Depends(tenant_user)):
    """What to pay and how: amount, the collection account and a UPI link / QR with the amount filled in."""
    ls = await _lease(user, lease_id)
    if kind == "rent":
        sched = next((s for s in ls["schedule"] if s["period"] == period), None) if period else \
            next((s for s in ls["schedule"] if s["paid"] < s["amount"] - 0.001), None)
        if not sched:
            raise HTTPException(404, "Nothing due for that month")
        amount, label = round(sched["amount"] - sched["paid"], 2), f"Rent {period_text(sched['period'])} · {ls['code']}"
        period = sched["period"]
    else:
        c = await db.lease_charges.find_one({"id": charge_id, "lease_id": lease_id}, {"_id": 0})
        if not c:
            raise HTTPException(404, "Bill not found")
        amount, label = round(c["amount"] - c.get("paid", 0), 2), f"{c['code']} {c['label']}"
        if c["mode"] == "direct":
            return {"amount": amount, "label": label, "direct": True, "consumer_no": c.get("consumer_no"),
                    "message": "Pay this bill straight to the provider (for EB: TNPDCL / TANGEDCO online or at the EB office), then tell us the reference."}
    to = await _pay_to()
    out = {"amount": amount, "label": label, "period": period, "pay_to": to, "direct": False}
    if to.get("upi_id") and amount > 0:
        name = quote(to.get("account_name") or "Sellandiamman Estates")
        uri = f"upi://pay?pa={quote(to['upi_id'])}&pn={name}&am={amount:.2f}&cu=INR&tn={quote(label[:60])}"
        from routes_auth import _qr_svg
        out.update({"upi_uri": uri, "qr_svg": _qr_svg(uri)})
    return out


@router.post("/leases/{lease_id}/payment-notices")
async def payment_notice(lease_id: str, body: NoticeIn, user=Depends(tenant_user)):
    ls = await _lease(user, lease_id)
    if ls["status"] != "active" and body.kind == "rent":
        raise HTTPException(422, "This lease has ended. Call us about any balance.")
    label = None
    if body.kind == "rent":
        s = next((s for s in ls["schedule"] if s["period"] == body.period), None)
        if not s:
            raise HTTPException(422, "Choose a month in your lease")
        label = f"Rent {period_text(body.period)}"
    else:
        c = await db.lease_charges.find_one({"id": body.charge_id, "lease_id": lease_id}, {"_id": 0})
        if not c or c["status"] in ("paid", "waived"):
            raise HTTPException(422, "Choose a bill that is still due")
        label = c["label"]
    if await db.payment_notices.count_documents({"user_id": user["id"], "status": "pending"}) >= 10:
        raise HTTPException(429, "You have several payments waiting for us to check. We will confirm them soon.")
    n = {"id": new_id(), "lease_id": lease_id, "lease_code": ls["code"], "property_title": ls["property_title"],
         "tenant_name": ls["tenant_name"], "user_id": user["id"], **body.model_dump(), "label": label, "status": "pending",
         "created_at": now_iso()}
    try:
        await db.payment_notices.insert_one(dict(n))
    except DuplicateKeyError:
        raise HTTPException(409, "We already have this payment")
    raw = await db.leases.find_one({"id": lease_id}, {"_id": 0, "manager_id": 1, "branch_id": 1})
    title = f"Payment notice: {ls['tenant_name']} paid {body.amount:,.0f} ({label})"
    await notify([raw.get("manager_id")], title, f"{ls['code']} · {body.method} {body.reference or ''}", f"/erp/leases?open={lease_id}",
                 dedupe=f"pn:{n['id']}")
    await notify_roles(["accountant"], title, ls["code"], f"/erp/leases?open={lease_id}", dedupe=f"pn:{n['id']}", branch_id=raw.get("branch_id"))
    await audit(user, "payment_notice", "leases", lease_id, {"amount": body.amount, "kind": body.kind})
    n.pop("_id", None)
    return n


@router.get("/documents")
async def documents(user=Depends(tenant_user)):
    leases = await _leases(user)
    lids = [ls["id"] for ls in leases]
    f = {"is_latest": True, "share_with_tenant": True, "doc_type": {"$ne": "kyc"},
         "$or": [{"entity_type": "lease", "entity_id": {"$in": lids}}, {"entity_type": "customer", "entity_id": user["customer_id"]}]}
    rows = await db.documents.find(f, {"_id": 0, "id": 1, "original_name": 1, "doc_type": 1, "entity_type": 1, "entity_id": 1,
                                       "created_at": 1, "version": 1}).sort("created_at", -1).to_list(500)
    return {"documents": rows}


@router.post("/documents/{did}/link")
async def doc_link(did: str, user=Depends(tenant_user)):
    docs = {d["id"] for d in (await documents(user))["documents"]}
    if did not in docs:
        raise HTTPException(404, "Not found")
    tok = jwt.encode({"doc": did, "uid": user["id"], "typ": "file", "exp": now() + timedelta(minutes=5)}, JWT_SECRET, algorithm=JWT_ALG)
    await audit(user, "document_link", "documents", did, {"portal": "tenant"})
    return {"url": f"/api/files/{tok}", "expires_in": 300}
