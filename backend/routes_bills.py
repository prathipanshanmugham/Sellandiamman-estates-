"""Tenant bills on a lease (electricity / EB, water, maintenance, internet, parking…) and payment notices sent by
tenants from their portal.

A bill is either collected by us (mode "collect": the tenant pays us, we issue a receipt and pass the money to the
owner in their monthly statement, or keep it when we are the provider) or paid by the tenant straight to the provider
(mode "direct": we only track it so the tenant and owner can see what is due and what was paid)."""
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError
from core import (db, now_iso, new_id, next_code, require, can, scope, audit, post_ledger, notify, get_settings,
                  today_ist)
from pdf import make_pdf, inr

router = APIRouter()
DATE = r"^\d{4}-\d{2}-\d{2}$"
MONTH = r"^\d{4}-\d{2}$"
KINDS = {"electricity": "Electricity (EB)", "water": "Water", "maintenance": "Maintenance / association",
         "gas": "Gas", "internet": "Internet / DTH", "parking": "Parking", "cleaning": "Cleaning service",
         "property_tax": "Property tax share", "repair": "Repair recovery", "other": "Other"}
METHODS = r"^(cash|upi|bank_transfer|cheque)$"


class ChargeIn(BaseModel):
    kind: str
    label: Optional[str] = Field(None, max_length=80)
    period: str = Field(pattern=MONTH)
    period_to: Optional[str] = Field(None, pattern=MONTH)
    consumer_no: Optional[str] = Field(None, max_length=40)
    reading_prev: Optional[float] = Field(None, ge=0)
    reading_curr: Optional[float] = Field(None, ge=0)
    rate: Optional[float] = Field(None, ge=0, le=1000)
    fixed: float = Field(0, ge=0)
    amount: Optional[float] = Field(None, gt=0)
    due_date: str = Field(pattern=DATE)
    mode: str = Field("collect", pattern=r"^(collect|direct)$")
    payee: str = Field("owner", pattern=r"^(owner|company)$")
    notes: Optional[str] = Field(None, max_length=500)


class ChargePayIn(BaseModel):
    amount: float = Field(gt=0)
    date: str = Field(pattern=DATE)
    method: str = Field(pattern=METHODS)
    reference: Optional[str] = Field(None, max_length=80)
    idempotency_key: str = Field(min_length=8, max_length=80)


class NoticeIn(BaseModel):
    kind: str = Field(pattern=r"^(rent|charge)$")
    period: Optional[str] = Field(None, pattern=MONTH)
    charge_id: Optional[str] = None
    amount: float = Field(gt=0)
    date: str = Field(pattern=DATE)
    method: str = Field(pattern=METHODS)
    reference: Optional[str] = Field(None, max_length=80)
    note: Optional[str] = Field(None, max_length=300)
    idempotency_key: str = Field(min_length=8, max_length=80)


def period_text(a, b=None):
    """2026-09 → Sep 2026; 2026-09..2026-10 → Sep–Oct 2026; 2026-12..2027-01 → Dec 2026–Jan 2027."""
    import calendar
    ya, ma = int(a[:4]), int(a[5:7])
    if not b or b == a:
        return f"{calendar.month_abbr[ma]} {ya}"
    yb, mb = int(b[:4]), int(b[5:7])
    if ya == yb:
        return f"{calendar.month_abbr[ma]}–{calendar.month_abbr[mb]} {yb}"
    return f"{calendar.month_abbr[ma]} {ya}–{calendar.month_abbr[mb]} {yb}"


def compute_amount(body):
    """Meter bills: units × rate + fixed charges. Otherwise the amount entered."""
    if body.get("reading_curr") is not None:
        if body.get("reading_prev") is None or body.get("rate") is None:
            raise HTTPException(422, "Enter the previous reading and the rate per unit")
        if body["reading_curr"] < body["reading_prev"]:
            raise HTTPException(422, "The current reading cannot be lower than the previous one")
        units = round(body["reading_curr"] - body["reading_prev"], 2)
        return units, round(units * body["rate"] + float(body.get("fixed") or 0), 2)
    if not body.get("amount"):
        raise HTTPException(422, "Enter the bill amount, or the meter readings and rate")
    return None, round(float(body["amount"]), 2)


def charge_view(c):
    c = {k: v for k, v in c.items() if k != "_id"}
    c["balance"] = round(c["amount"] - c.get("paid", 0), 2) if c["status"] not in ("waived",) else 0
    c["kind_label"] = KINDS.get(c["kind"], c["kind"])
    c["overdue"] = c["status"] in ("due", "partly_paid") and c["due_date"] < today_ist().isoformat()
    return c


async def _lease(lid, user):
    lease = await db.leases.find_one({"id": lid, **scope(user, "leases")}, {"_id": 0})
    if not lease:
        raise HTTPException(404, "Lease not found")
    return lease


async def _charge(cid, user):
    c = await db.lease_charges.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Bill not found")
    await _lease(c["lease_id"], user)
    return c


async def tenant_user_ids(lease):
    if not lease.get("customer_id"):
        return []
    return [u["id"] for u in await db.users.find({"role": "tenant", "customer_id": lease["customer_id"], "active": True},
                                                 {"_id": 0, "id": 1}).to_list(10)]


async def lease_extras(lease, user):
    """Bills, payment notices and portal logins shown on the staff lease page."""
    charges = [charge_view(c) for c in await db.lease_charges.find({"lease_id": lease["id"]}, {"_id": 0}).sort("due_date", -1).to_list(500)]
    pays = await db.charge_payments.find({"lease_id": lease["id"]}, {"_id": 0, "id": 1, "charge_id": 1, "amount": 1, "date": 1, "method": 1,
                                                                    "reference": 1, "receipt_no": 1, "source": 1}).sort("date", -1).to_list(2000)
    for c in charges:
        c["payments"] = [p for p in pays if p["charge_id"] == c["id"]]
    notices = await db.payment_notices.find({"lease_id": lease["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    logins = []
    if lease.get("customer_id") and can(user, "users", "r"):
        logins = await db.users.find({"role": "tenant", "customer_id": lease["customer_id"]},
                                     {"_id": 0, "id": 1, "email": 1, "active": 1, "last_login": 1}).to_list(10)
    tickets = await db.tickets.find({"lease_id": lease["id"]}, {"_id": 0, "id": 1, "code": 1, "title": 1, "status": 1,
                                                                "category": 1, "created_at": 1}).sort("created_at", -1).to_list(50)
    return {"charges": charges, "bills_due": round(sum(c["balance"] for c in charges if c["status"] in ("due", "partly_paid")), 2),
            "payment_notices": notices, "tenant_logins": logins, "tickets": tickets}


# ---------------- Staff: bills ----------------
@router.get("/charges")
async def list_charges(status: Optional[str] = None, kind: Optional[str] = None, user=Depends(require("leases", "r"))):
    lids = [ls["id"] for ls in await db.leases.find(scope(user, "leases"), {"_id": 0, "id": 1}).to_list(5000)]
    f = {"lease_id": {"$in": lids}}
    if status == "open":
        f["status"] = {"$in": ["due", "partly_paid"]}
    elif status:
        f["status"] = status
    if kind:
        f["kind"] = kind
    return [charge_view(c) for c in await db.lease_charges.find(f, {"_id": 0}).sort("due_date", -1).to_list(3000)]


@router.post("/leases/{lid}/charges")
async def add_charge(lid: str, body: ChargeIn, user=Depends(require("leases", "w"))):
    lease = await _lease(lid, user)
    if body.kind not in KINDS:
        raise HTTPException(422, "Choose the type of bill")
    if body.period_to and body.period_to < body.period:
        raise HTTPException(422, "The billing period ends before it starts")
    data = body.model_dump()
    units, amount = compute_amount(data)
    period_txt = period_text(body.period, body.period_to)
    c = {"id": new_id(), "code": await next_code("bill", "BL-", 5), "lease_id": lid, "lease_code": lease["code"],
         "property_id": lease["property_id"], "property_title": lease["property_title"], "owner_id": lease.get("owner_id"),
         "customer_id": lease.get("customer_id"), "branch_id": lease.get("branch_id"), "tenant_name": lease["tenant_name"],
         **data, "label": (body.label or f"{KINDS[body.kind]} {period_txt}").strip(), "units": units, "amount": amount,
         "paid": 0.0, "status": "due", "created_by": user["id"], "created_at": now_iso()}
    await db.lease_charges.insert_one(dict(c))
    await audit(user, "bill_added", "leases", lid, {"bill": c["code"], "amount": amount, "kind": body.kind})
    await notify(await tenant_user_ids(lease), f"New bill: {c['label']}", f"{inr(amount)} due on {body.due_date}",
                 "/tenant/bills", dedupe=f"bill:{c['id']}")
    return charge_view(c)


async def apply_charge_payment(c, body, user, source="staff"):
    if c["status"] in ("paid", "waived"):
        raise HTTPException(422, "This bill is already settled")
    bal = round(c["amount"] - c.get("paid", 0), 2)
    if body["amount"] > bal + 0.001:
        raise HTTPException(422, f"Amount exceeds the balance of {inr(bal)}")
    lease = await db.leases.find_one({"id": c["lease_id"]}, {"_id": 0, "schedule": 0}) or {}
    p = {"id": new_id(), "charge_id": c["id"], "charge_code": c["code"], "lease_id": c["lease_id"], "lease_code": c["lease_code"],
         "owner_id": c.get("owner_id"), "property_id": c["property_id"], "kind": c["kind"], "label": c["label"],
         "mode": c["mode"], "payee": c["payee"], "amount": round(body["amount"], 2), "date": body["date"],
         "month": body["date"][:7], "method": body["method"], "reference": body.get("reference"),
         "idempotency_key": body["idempotency_key"], "source": source,
         "receipt_no": await next_code("bill_receipt", "BR-", 5) if c["mode"] == "collect" else None,
         "by": user["id"], "by_name": user["name"], "created_at": now_iso()}
    try:
        await db.charge_payments.insert_one(dict(p))
    except DuplicateKeyError:
        raise HTTPException(409, "This payment was already recorded")
    paid = round(c.get("paid", 0) + p["amount"], 2)
    status = "paid" if paid >= c["amount"] - 0.001 else "partly_paid"
    await db.lease_charges.update_one({"id": c["id"]}, {"$set": {"paid": paid, "status": status, "paid_at": now_iso() if status == "paid" else None}})
    if c["mode"] == "collect":
        if c["payee"] == "owner":
            await post_ledger("owner_funds", "in", p["amount"], "charge", p["id"],
                              f"{c['label']} {c['lease_code']} collected for owner", user, c.get("owner_id"),
                              "charges_collected", c.get("branch_id"))
        else:
            await post_ledger("company", "in", p["amount"], "charge", p["id"], f"{c['label']} {c['lease_code']}", user,
                              lease.get("tenant_name"), "revenue:services", c.get("branch_id"))
    await audit(user, "bill_payment", "leases", c["lease_id"], {"bill": c["code"], "amount": p["amount"], "source": source})
    return p, status


@router.post("/charges/{cid}/pay")
async def pay_charge(cid: str, body: ChargePayIn, user=Depends(require("leases", "w"))):
    c = await _charge(cid, user)
    p, status = await apply_charge_payment(c, body.model_dump(), user)
    lease = await db.leases.find_one({"id": c["lease_id"]}, {"_id": 0, "customer_id": 1})
    await notify(await tenant_user_ids(lease or {}), f"Payment received: {c['label']}", inr(p["amount"]), "/tenant/bills",
                 dedupe=f"billpay:{p['id']}")
    return {**p, "bill_status": status}


@router.post("/charges/{cid}/waive")
async def waive_charge(cid: str, body: dict, user=Depends(require("leases", "w"))):
    c = await _charge(cid, user)
    if c.get("paid"):
        raise HTTPException(422, "Part of this bill is paid; it cannot be waived")
    reason = str(body.get("reason") or "").strip()
    if len(reason) < 3:
        raise HTTPException(422, "Give a reason")
    await db.lease_charges.update_one({"id": cid}, {"$set": {"status": "waived", "waived_reason": reason[:300], "waived_by": user["name"]}})
    await audit(user, "bill_waived", "leases", c["lease_id"], {"bill": c["code"], "reason": reason})
    return {"ok": True}


@router.delete("/charges/{cid}")
async def delete_charge(cid: str, user=Depends(require("leases", "w"))):
    c = await _charge(cid, user)
    if c.get("paid"):
        raise HTTPException(422, "A bill with payments cannot be deleted")
    await db.lease_charges.delete_one({"id": cid})
    await audit(user, "bill_deleted", "leases", c["lease_id"], {"bill": c["code"]})
    return {"ok": True}


async def bill_receipt_pdf_bytes(p):
    c = await db.lease_charges.find_one({"id": p["charge_id"]}, {"_id": 0}) or {}
    meta = [("Received from", c.get("tenant_name", "-")), ("Property", c.get("property_title", "-")), ("Lease", p["lease_code"]),
            ("Bill", f"{c.get('code', '')} · {p['label']}"), ("Date received", p["date"]),
            ("Method", p["method"].replace("_", " ").title()), ("Reference", p.get("reference") or "-")]
    if c.get("units") is not None:
        meta.insert(4, ("Meter", f"{c.get('reading_prev'):g} → {c.get('reading_curr'):g} = {c['units']:g} units × Rs. {c.get('rate'):g}"
                        + (f" + Rs. {c['fixed']:g} fixed" if c.get("fixed") else "")))
    if c.get("consumer_no"):
        meta.append(("Consumer / service no.", c["consumer_no"]))
    note = ("Collected on behalf of the property owner and passed to them in full." if p["payee"] == "owner"
            else "Received by Sellandiamman Estates for the service named above.")
    return make_pdf(f"Bill Receipt {p['receipt_no']}", await get_settings(), meta, [], [],
                    [("Bill amount", inr(c.get("amount", 0))), ("Amount received", inr(p["amount"])),
                     ("Balance on this bill", inr(max(0, c.get("amount", 0) - c.get("paid", 0))))], note)


@router.get("/charge-payments/{pid}/receipt.pdf")
async def staff_bill_receipt(pid: str, user=Depends(require("leases", "r"))):
    p = await db.charge_payments.find_one({"id": pid}, {"_id": 0})
    if not p or not p.get("receipt_no"):
        raise HTTPException(404, "Receipt not found")
    await _lease(p["lease_id"], user)
    return Response(await bill_receipt_pdf_bytes(p), media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename={p['receipt_no']}.pdf"})


@router.get("/charges/{cid}/payments")
async def charge_payments(cid: str, user=Depends(require("leases", "r"))):
    await _charge(cid, user)
    return await db.charge_payments.find({"charge_id": cid}, {"_id": 0}).sort("date", -1).to_list(100)


# ---------------- Staff: payment notices from tenants ----------------
@router.get("/payment-notices")
async def list_notices(status: str = "pending", user=Depends(require("leases", "r"))):
    lids = [ls["id"] for ls in await db.leases.find(scope(user, "leases"), {"_id": 0, "id": 1}).to_list(5000)]
    return await db.payment_notices.find({"lease_id": {"$in": lids}, **({"status": status} if status != "all" else {})},
                                         {"_id": 0}).sort("created_at", -1).to_list(500)


async def _notice(nid, user):
    n = await db.payment_notices.find_one({"id": nid}, {"_id": 0})
    if not n:
        raise HTTPException(404, "Notice not found")
    await _lease(n["lease_id"], user)
    if n["status"] != "pending":
        raise HTTPException(409, "This notice was already handled")
    return n


@router.post("/payment-notices/{nid}/confirm")
async def confirm_notice(nid: str, body: dict, user=Depends(require("leases", "w"))):
    """Checks the money arrived, then records it exactly as if staff had entered the payment."""
    n = await _notice(nid, user)
    amount = float(body.get("amount") or n["amount"])
    date = body.get("date") or n["date"]
    if n["kind"] == "rent":
        from routes_ops import record_rent, RentIn
        rec = await record_rent(n["lease_id"], RentIn(period=n["period"], amount=amount, method=n["method"],
                                                     reference=n.get("reference"), date=date,
                                                     idempotency_key=f"notice-{nid}"), user)
        ref = {"rent_payment_id": rec["id"], "receipt_no": rec["receipt_no"]}
    else:
        c = await db.lease_charges.find_one({"id": n["charge_id"]}, {"_id": 0})
        if not c:
            raise HTTPException(404, "Bill not found")
        p, _ = await apply_charge_payment(c, {"amount": amount, "date": date, "method": n["method"], "reference": n.get("reference"),
                                              "idempotency_key": f"notice-{nid}"}, user, source="tenant_notice")
        ref = {"charge_payment_id": p["id"], "receipt_no": p.get("receipt_no")}
    await db.payment_notices.update_one({"id": nid}, {"$set": {"status": "confirmed", "handled_by": user["name"], "handled_at": now_iso(), **ref}})
    await notify([n["user_id"]], "Payment confirmed", f"{inr(amount)} · {n.get('label') or n['kind']}", "/tenant/rent" if n["kind"] == "rent" else "/tenant/bills",
                 dedupe=f"notice:{nid}")
    return {"ok": True, **ref}


@router.post("/payment-notices/{nid}/reject")
async def reject_notice(nid: str, body: dict, user=Depends(require("leases", "w"))):
    n = await _notice(nid, user)
    reason = str(body.get("reason") or "").strip()
    if len(reason) < 3:
        raise HTTPException(422, "Tell the tenant why")
    await db.payment_notices.update_one({"id": nid}, {"$set": {"status": "rejected", "reason": reason[:300], "handled_by": user["name"],
                                                               "handled_at": now_iso()}})
    await notify([n["user_id"]], "We could not match your payment", reason, "/tenant/rent", dedupe=f"notice:{nid}")
    await audit(user, "payment_notice_rejected", "leases", n["lease_id"], {"reason": reason})
    return {"ok": True}


# ---------------- Staff: tenant logins from the lease ----------------
@router.post("/leases/{lid}/tenant-login")
async def tenant_login(lid: str, body: dict, user=Depends(require("users", "w"))):
    lease = await _lease(lid, user)
    if not lease.get("customer_id"):
        from routes_customers import link_customer
        c = await link_customer("leases", lid, {"name": lease["tenant_name"], "phone": lease["tenant_phone"], "email": lease.get("tenant_email"),
                                                "types": ["tenant"], "source": "lease", "branch_id": lease.get("branch_id")}, user)
        lease["customer_id"] = c and c["id"]
    if not lease.get("customer_id"):
        raise HTTPException(422, "Add the tenant's mobile number to the lease first")
    from routes_customers import create_customer_login
    return await create_customer_login("tenant", lease["customer_id"], body.get("email") or lease.get("tenant_email"), user)

