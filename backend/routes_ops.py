from datetime import date, timedelta
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError
from core import db, now_iso, new_id, next_code, require, can, scope, get_scoped, audit, post_ledger, notify, \
    get_settings, today_ist, normalize_phone, notify_roles
from logic import calc_shortstay, calc_owner_statement, ranges_overlap
from pdf import make_pdf, inr

router = APIRouter()
DATE = r"^\d{4}-\d{2}-\d{2}$"


def month_add(y, m, n):
    m0 = m - 1 + n
    return y + m0 // 12, m0 % 12 + 1


def build_schedule(start, end, rent, due_day, esc_pct, esc_months):
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    out, i = [], 0
    y, m = s.year, s.month
    while date(y, m, 1) <= e:
        steps = i // esc_months if esc_months else 0
        amt = round(rent * ((1 + esc_pct / 100) ** steps), 2)
        out.append({"period": f"{y}-{m:02d}", "due_date": date(y, m, min(due_day, 28)).isoformat(), "amount": amt,
                    "paid": 0.0})
        y, m = month_add(y, m, 1)
        i += 1
    return out


class LeaseIn(BaseModel):
    property_id: str
    tenant_name: str = Field(min_length=2, max_length=120)
    tenant_phone: str
    tenant_email: Optional[str] = None
    tenant_kind: str = Field("individual", pattern=r"^(individual|business)$")
    lease_type: str = Field("residential", pattern=r"^(residential|commercial|industrial)$")
    start_date: str = Field(pattern=DATE)
    end_date: str = Field(pattern=DATE)
    rent: float = Field(gt=0)
    due_day: int = Field(5, ge=1, le=28)
    deposit: float = Field(0, ge=0)
    escalation_pct: float = Field(0, ge=0, le=100)
    escalation_every_months: int = Field(12, ge=0, le=120)
    mgmt_fee_pct: float = Field(0, ge=0, le=100)
    manager_id: Optional[str] = None
    notes: Optional[str] = None


class RentIn(BaseModel):
    period: str = Field(pattern=r"^\d{4}-\d{2}$")
    amount: float = Field(gt=0)
    method: str = Field(pattern=r"^(cash|upi|bank_transfer|cheque)$")
    reference: Optional[str] = None
    date: str = Field(pattern=DATE)
    idempotency_key: str = Field(min_length=8, max_length=80)


class DepositIn(BaseModel):
    amount: float = Field(gt=0)
    direction: str = Field(pattern=r"^(in|out)$")
    reason: str = Field(min_length=3, max_length=300)
    idempotency_key: str = Field(min_length=8, max_length=80)


class HandoverIn(BaseModel):
    kind: str = Field(pattern=r"^(move_in|move_out|inspection)$")
    items: List[dict] = []
    meter_readings: Optional[str] = None
    notes: Optional[str] = None
    date: str = Field(pattern=DATE)


class WorkOrderIn(BaseModel):
    property_id: str
    title: str = Field(min_length=3, max_length=200)
    description: Optional[str] = None
    category: str = "general"
    priority: str = Field("medium", pattern=r"^(low|medium|high|urgent)$")
    due_date: Optional[str] = None
    vendor_id: Optional[str] = None
    quote_amount: Optional[float] = Field(None, ge=0)
    charge_to: str = Field("owner", pattern=r"^(owner|company)$")
    reported_by: Optional[str] = None


class VendorIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str
    trade: str = Field(min_length=2, max_length=60)
    gstin: Optional[str] = None
    notes: Optional[str] = None


class BookingIn(BaseModel):
    property_id: str
    guest_name: str = Field(min_length=2, max_length=120)
    guest_phone: str
    guest_email: Optional[str] = None
    guests: int = Field(1, ge=1, le=50)
    check_in: str = Field(pattern=DATE)
    check_out: str = Field(pattern=DATE)
    nightly_rate: float = Field(gt=0)
    discount: float = Field(0, ge=0)
    cleaning_fee: float = Field(0, ge=0)
    platform: str = Field("direct", pattern=r"^(direct|airbnb|booking_com|makemytrip|other)$")
    platform_fee: float = Field(0, ge=0)
    operating_costs: float = Field(0, ge=0)
    mgmt_fee_pct: Optional[float] = Field(None, ge=0, le=100)
    source_ref: Optional[str] = None
    notes: Optional[str] = None


class CancelBookingIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)
    refund_amount: float = Field(0, ge=0)


# ---------------- Leases ----------------
@router.get("/leases")
async def list_leases(status: Optional[str] = None, user=Depends(require("leases", "r"))):
    f = scope(user, "leases")
    if status:
        f["status"] = status
    rows = await db.leases.find(f, {"_id": 0}).sort("end_date", 1).to_list(2000)
    t = today_ist().isoformat()
    for r in rows:
        r["arrears"] = round(sum(s["amount"] - s["paid"] for s in r.get("schedule", []) if s["due_date"] < t), 2)
        r.pop("schedule", None)
    return rows


@router.post("/leases")
async def create_lease(body: LeaseIn, user=Depends(require("leases", "w"))):
    if body.end_date <= body.start_date:
        raise HTTPException(422, "End date must be after start date")
    prop = await db.properties.find_one({"id": body.property_id, "deleted": {"$ne": True}}, {"_id": 0})
    if not prop:
        raise HTTPException(404, "Property not found")
    clash = await db.leases.find_one({"property_id": body.property_id, "status": "active",
                                      "start_date": {"$lt": body.end_date}, "end_date": {"$gt": body.start_date}})
    if clash:
        raise HTTPException(409, f"Property already has an active lease {clash['code']} in this period")
    data = body.model_dump()
    data["tenant_phone"] = normalize_phone(data["tenant_phone"])
    if user["role"] == "property_manager":
        data["manager_id"] = user["id"]
    data["manager_id"] = data.get("manager_id") or prop.get("assigned_manager") or user["id"]
    lease = {"id": new_id(), "code": await next_code("lease", "SE-LS-"), **data, "owner_id": prop.get("owner_id"),
             "property_title": prop["title"], "property_code": prop["code"], "status": "active",
             "deposit_held": 0.0, "handovers": [], "issues": [],
             "schedule": build_schedule(body.start_date, body.end_date, body.rent, body.due_day, body.escalation_pct,
                                        body.escalation_every_months),
             "created_at": now_iso()}
    await db.leases.insert_one(dict(lease))
    await db.properties.update_one({"id": prop["id"]}, {"$set": {"occupancy": "occupied", "service_type": "management"}})
    await audit(user, "lease_created", "leases", lease["id"])
    return lease


@router.get("/leases/{lid}")
async def get_lease(lid: str, user=Depends(require("leases", "r"))):
    lease = await db.leases.find_one({"id": lid, **scope(user, "leases")}, {"_id": 0})
    if not lease:
        raise HTTPException(404, "Record not found")
    lease["payments"] = await db.rent_payments.find({"lease_id": lid}, {"_id": 0}).sort("date", -1).to_list(500)
    t = today_ist().isoformat()
    lease["arrears"] = round(sum(s["amount"] - s["paid"] for s in lease["schedule"] if s["due_date"] < t), 2)
    return lease


async def _lease_for_write(lid, user):
    lease = await db.leases.find_one({"id": lid, **scope(user, "leases")}, {"_id": 0})
    if not lease:
        raise HTTPException(404, "Record not found")
    return lease


@router.post("/leases/{lid}/rent")
async def record_rent(lid: str, body: RentIn, user=Depends(require("leases", "w"))):
    lease = await _lease_for_write(lid, user)
    if await db.rent_payments.find_one({"idempotency_key": body.idempotency_key}):
        raise HTTPException(409, "This rent payment was already recorded")
    if lease["status"] != "active":
        raise HTTPException(422, "Rent can only be recorded on an active lease")
    sched = next((s for s in lease["schedule"] if s["period"] == body.period), None)
    if not sched:
        raise HTTPException(422, "Period is outside the lease schedule")
    if sched["paid"] + body.amount > sched["amount"] + 0.001:
        raise HTTPException(422, f"Amount exceeds the balance due for {body.period}")
    p = {"id": new_id(), "lease_id": lid, "lease_code": lease["code"], "owner_id": lease.get("owner_id"),
         "property_id": lease["property_id"], "mgmt_fee_pct": lease["mgmt_fee_pct"], **body.model_dump(),
         "receipt_no": await next_code("rent_receipt", "RR-", 5), "by": user["id"], "created_at": now_iso()}
    try:
        await db.rent_payments.insert_one(dict(p))
    except DuplicateKeyError:
        raise HTTPException(409, "This rent payment was already recorded")
    await db.leases.update_one({"id": lid, "schedule.period": body.period}, {"$inc": {"schedule.$.paid": body.amount}})
    await post_ledger("owner_funds", "in", body.amount, "rent", p["id"],
                      f"Rent {body.period} {lease['code']} received on behalf of owner", user, lease.get("owner_id"),
                      "rent_collected")
    await audit(user, "rent_recorded", "leases", lid, {"amount": body.amount, "period": body.period})
    return p


async def rent_receipt_pdf_bytes(p):
    lease = await db.leases.find_one({"id": p["lease_id"]}, {"_id": 0, "schedule": 0}) or {}
    owner = await db.owners.find_one({"id": p.get("owner_id")}, {"_id": 0, "name": 1}) or {}
    return make_pdf(f"Rent Receipt {p['receipt_no']}", await get_settings(),
                    [("Received from", lease.get("tenant_name", "-")), ("Property", lease.get("property_title", "-")),
                     ("Lease", p["lease_code"]), ("Rent period", p["period"]), ("Date received", p["date"]),
                     ("Method", p["method"].replace("_", " ").title()), ("Reference", p.get("reference") or "-"),
                     ("Received on behalf of", owner.get("name", "the property owner"))],
                    [], [], [("Amount received", inr(p["amount"]))],
                    "Rent is collected on behalf of the property owner and held in the owner-funds account.")


@router.get("/rent-payments/{pid}/receipt.pdf")
async def rent_receipt(pid: str, user=Depends(require("leases", "r"))):
    p = await db.rent_payments.find_one({"id": pid}, {"_id": 0})
    if not p or not await db.leases.find_one({"id": p["lease_id"], **scope(user, "leases")}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "Payment not found")
    return Response(await rent_receipt_pdf_bytes(p), media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename={p['receipt_no']}.pdf"})


@router.post("/leases/{lid}/deposit")
async def deposit(lid: str, body: DepositIn, user=Depends(require("leases", "w"))):
    lease = await _lease_for_write(lid, user)
    if body.direction == "out" and body.amount > lease.get("deposit_held", 0) + 0.001:
        raise HTTPException(422, "Refund exceeds deposit held")
    try:
        await db.deposit_movements.insert_one({"id": new_id(), "lease_id": lid, **body.model_dump(), "by": user["id"],
                                               "created_at": now_iso()})
    except DuplicateKeyError:
        raise HTTPException(409, "Already recorded")
    delta = body.amount if body.direction == "in" else -body.amount
    await db.leases.update_one({"id": lid}, {"$inc": {"deposit_held": delta}})
    await post_ledger("deposits", body.direction, body.amount, "lease", lid,
                      f"Deposit {'received' if body.direction == 'in' else 'refunded'} {lease['code']}: {body.reason}",
                      user, lease["tenant_name"], "tenant_deposit")
    return {"ok": True, "deposit_held": round(lease.get("deposit_held", 0) + delta, 2)}


@router.post("/leases/{lid}/handover")
async def handover(lid: str, body: HandoverIn, user=Depends(require("leases", "w"))):
    await _lease_for_write(lid, user)
    rec = {"id": new_id(), **body.model_dump(), "by": user["name"], "at": now_iso()}
    await db.leases.update_one({"id": lid}, {"$push": {"handovers": rec}})
    return rec


@router.post("/leases/{lid}/terminate")
async def terminate(lid: str, body: dict, user=Depends(require("leases", "w"))):
    lease = await _lease_for_write(lid, user)
    if lease["status"] != "active":
        raise HTTPException(422, "Lease is not active")
    await db.leases.update_one({"id": lid}, {"$set": {"status": "ended", "ended_reason": body.get("reason"),
                                                      "ended_at": now_iso()}})
    await db.properties.update_one({"id": lease["property_id"]}, {"$set": {"occupancy": "vacant"}})
    await audit(user, "lease_ended", "leases", lid)
    return {"ok": True}


# ---------------- Owner statements ----------------
async def _statement_data(oid, month):
    rents = await db.rent_payments.find({"owner_id": oid, "period": month}, {"_id": 0}).to_list(1000)
    props = [p["id"] for p in await db.properties.find({"owner_id": oid}, {"_id": 0, "id": 1}).to_list(500)]
    wos = await db.work_orders.find({"property_id": {"$in": props}, "charge_to": "owner", "status": {"$in": ["completed", "closed"]},
                                     "completed_at": {"$regex": f"^{month}"}}, {"_id": 0}).to_list(500)
    exps = [{"amount": w.get("actual_cost") or 0, "description": f"{w['code']} {w['title']}"} for w in wos]
    calc = calc_owner_statement([{"amount": r["amount"], "fee_pct": r.get("mgmt_fee_pct", 0)} for r in rents], exps)
    return rents, exps, calc


@router.get("/owners/{oid}/statement")
async def statement(oid: str, month: str, user=Depends(require("owners", "r"))):
    if not (can(user, "leases", "r") or can(user, "finance", "r")):
        raise HTTPException(403, "You do not have permission for this action")
    rents, exps, calc = await _statement_data(oid, month)
    existing = await db.owner_statements.find_one({"owner_id": oid, "month": month}, {"_id": 0})
    return {"month": month, "rents": rents, **calc, "expense_items": exps, "settled": existing}


@router.post("/owners/{oid}/statement/settle")
async def settle_statement(oid: str, body: dict, user=Depends(require("leases", "w"))):
    month = body.get("month") or ""
    owner = await db.owners.find_one({"id": oid}, {"_id": 0})
    if not owner or len(month) != 7:
        raise HTTPException(422, "Owner and month (YYYY-MM) are required")
    rents, exps, calc = await _statement_data(oid, month)
    if calc["rent_collected"] <= 0:
        raise HTTPException(422, "No rent collected for this month")
    st = {"id": new_id(), "code": await next_code("statement", "OS-", 5), "owner_id": oid, "owner_name": owner["name"],
          "month": month, **calc, "payout_status": "pending_manual_transfer", "by": user["id"], "created_at": now_iso()}
    try:
        await db.owner_statements.insert_one(dict(st))
    except DuplicateKeyError:
        raise HTTPException(409, "Statement already settled for this month")
    await post_ledger("owner_funds", "out", calc["management_fee"], "owner_statement", st["id"],
                      f"Management fee {month} transferred to company", user, oid, "mgmt_fee")
    await post_ledger("company", "in", calc["management_fee"], "owner_statement", st["id"],
                      f"Management fee {month} – {owner['name']}", user, oid, "revenue:management")
    await post_ledger("owner_funds", "out", calc["expenses"], "owner_statement", st["id"],
                      f"Maintenance recovered {month}", user, oid, "expense_recovery")
    await post_ledger("company", "in", calc["expenses"], "owner_statement", st["id"],
                      f"Maintenance cost recovered from owner {month}", user, oid, "reimbursement")
    await audit(user, "owner_statement_settled", "owners", oid, {"month": month, **calc})
    return st


@router.get("/owner-statements")
async def list_statements(user=Depends(require("finance", "r"))):
    return await db.owner_statements.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)


@router.post("/owner-statements/{sid}/mark-paid")
async def mark_paid(sid: str, body: dict, user=Depends(require("finance", "w"))):
    st = await db.owner_statements.find_one({"id": sid}, {"_id": 0})
    if not st:
        raise HTTPException(404, "Statement not found")
    if not body.get("reference"):
        raise HTTPException(422, "Bank transfer reference is required")
    r = await db.owner_statements.update_one({"id": sid, "payout_status": "pending_manual_transfer"},
                                             {"$set": {"payout_status": "paid", "payout_reference": body["reference"],
                                                       "paid_at": now_iso()}})
    if not r.modified_count:
        raise HTTPException(409, "Payout already recorded")
    await post_ledger("owner_funds", "out", st["net_payable"], "owner_statement", sid,
                      f"Owner payout {st['month']} ref {body['reference']}", user, st["owner_id"], "owner_payout")
    await audit(user, "owner_payout", "owners", st["owner_id"], {"reference": body["reference"]})
    return {"ok": True}


async def statement_pdf_bytes(oid, month):
    owner = await db.owners.find_one({"id": oid}, {"_id": 0}) or {}
    rents, exps, calc = await _statement_data(oid, month)
    settled = await db.owner_statements.find_one({"owner_id": oid, "month": month}, {"_id": 0}) or {}
    rows = [[r["date"], r["lease_code"], f"Rent {r['period']}", inr(r["amount"])] for r in rents]
    rows += [["", "", f"Expense: {e['description']}", inr(-e["amount"])] for e in exps]
    meta = [("Owner", owner.get("name", "-")), ("Owner code", owner.get("code", "-")), ("Month", month)]
    if settled:
        meta += [("Statement", settled.get("code")), ("Payout", str(settled.get("payout_status", "")).replace("_", " ")),
                 ("Transfer reference", settled.get("payout_reference") or "-")]
    return make_pdf(f"Owner Statement {month}", await get_settings(), meta,
                    ["Date", "Lease", "Description", "Amount"], rows,
                    [("Rent collected", inr(calc["rent_collected"])), ("Management fee", inr(-calc["management_fee"])),
                     ("Expenses", inr(-calc["expenses"])), ("Net payable to owner", inr(calc["net_payable"]))],
                    "Funds are held on behalf of the owner and are not company revenue.")


@router.get("/owners/{oid}/statement.pdf")
async def statement_pdf(oid: str, month: str, user=Depends(require("owners", "r"))):
    if not (can(user, "leases", "r") or can(user, "finance", "r")):
        raise HTTPException(403, "You do not have permission for this action")
    return Response(await statement_pdf_bytes(oid, month), media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename=statement-{month}.pdf"})


# ---------------- Maintenance ----------------
WO_FLOW = {"open": ["assigned", "cancelled"], "assigned": ["in_progress", "cancelled"],
           "in_progress": ["completed", "cancelled"], "completed": ["closed"], "closed": [], "cancelled": []}


@router.get("/work-orders")
async def list_wo(status: Optional[str] = None, user=Depends(require("maintenance", "r"))):
    f = {"status": status} if status else {}
    return await db.work_orders.find(f, {"_id": 0}).sort("created_at", -1).to_list(2000)


@router.post("/work-orders")
async def create_wo(body: WorkOrderIn, user=Depends(require("maintenance", "w"))):
    prop = await db.properties.find_one({"id": body.property_id}, {"_id": 0, "title": 1, "code": 1, "assigned_manager": 1})
    if not prop:
        raise HTTPException(404, "Property not found")
    wo = {"id": new_id(), "code": await next_code("wo", "WO-", 5), **body.model_dump(), "property_title": prop["title"],
          "status": "assigned" if body.vendor_id else "open", "actual_cost": None,
          "history": [{"at": now_iso(), "by": user["name"], "event": "Created"}], "created_by": user["id"],
          "created_at": now_iso()}
    await db.work_orders.insert_one(dict(wo))
    await notify([prop.get("assigned_manager")], f"Work order {wo['code']}: {body.title}", prop["title"],
                 "/erp/maintenance", dedupe=f"wo:{wo['id']}")
    return wo


@router.patch("/work-orders/{wid}")
async def update_wo(wid: str, body: dict, user=Depends(require("maintenance", "w"))):
    wo = await db.work_orders.find_one({"id": wid}, {"_id": 0})
    if not wo:
        raise HTTPException(404, "Work order not found")
    upd = {k: body[k] for k in ("vendor_id", "quote_amount", "due_date", "priority", "charge_to") if k in body}
    st = body.get("status")
    if st and st != wo["status"]:
        if st not in WO_FLOW[wo["status"]]:
            raise HTTPException(422, f"Cannot move from {wo['status']} to {st}")
        upd["status"] = st
        if st == "completed":
            cost = body.get("actual_cost")
            if cost is None or float(cost) < 0:
                raise HTTPException(422, "Actual cost is required to complete")
            upd["actual_cost"] = float(cost)
            upd["completed_at"] = now_iso()
    ev = body.get("note") or (f"Status → {st}" if st else "Updated")
    await db.work_orders.update_one({"id": wid}, {"$set": upd, "$push": {"history": {"at": now_iso(), "by": user["name"],
                                                                                      "event": ev}}})
    if upd.get("status") == "completed" and upd["actual_cost"] > 0:
        await post_ledger("company", "out", upd["actual_cost"], "work_order", wid, f"Vendor paid {wo['code']}", user,
                          wo.get("vendor_id"), "expense:maintenance")
    await audit(user, "work_order_updated", "maintenance", wid, upd)
    return {**wo, **upd}


@router.get("/vendors")
async def vendors(user=Depends(require("maintenance", "r"))):
    return await db.vendors.find({}, {"_id": 0}).sort("name", 1).to_list(1000)


@router.post("/vendors")
async def new_vendor(body: VendorIn, user=Depends(require("maintenance", "w"))):
    v = {"id": new_id(), **body.model_dump(), "phone": normalize_phone(body.phone), "created_at": now_iso()}
    await db.vendors.insert_one(dict(v))
    return v


# ---------------- Short stay ----------------
def nights_between(check_in, check_out):
    d, end = date.fromisoformat(check_in), date.fromisoformat(check_out)
    while d < end:
        yield d.isoformat()
        d += timedelta(days=1)


async def reserve_nights(bk):
    """One document per booked night with a unique (property, night) index, so two people saving overlapping
    bookings at the same moment cannot both succeed - even with several backend processes."""
    done = []
    try:
        for night in nights_between(bk["check_in"], bk["check_out"]):
            await db.booking_nights.insert_one({"property_id": bk["property_id"], "night": night, "booking_id": bk["id"]})
            done.append(night)
    except DuplicateKeyError:
        if done:
            await db.booking_nights.delete_many({"booking_id": bk["id"]})
        clash = await db.booking_nights.find_one({"property_id": bk["property_id"], "night": {"$in": list(
            nights_between(bk["check_in"], bk["check_out"]))}}, {"_id": 0, "booking_id": 1})
        other = await db.bookings.find_one({"id": (clash or {}).get("booking_id")}, {"_id": 0, "code": 1}) or {}
        raise HTTPException(409, f"Dates overlap with booking {other.get('code', 'another booking')}")


async def release_nights(booking_id):
    await db.booking_nights.delete_many({"booking_id": booking_id})


def _booking_view(user, b):
    if not can(user, "shortstay", "w"):
        b.pop("guest_phone", None)
        b.pop("guest_email", None)
    return b


@router.get("/bookings")
async def list_bookings(property_id: Optional[str] = None, user=Depends(require("shortstay", "r"))):
    f = {"property_id": property_id} if property_id else {}
    rows = await db.bookings.find(f, {"_id": 0}).sort("check_in", -1).to_list(2000)
    return [_booking_view(user, b) for b in rows]


@router.post("/bookings")
async def create_booking(body: BookingIn, user=Depends(require("shortstay", "w"))):
    prop = await db.properties.find_one({"id": body.property_id, "transaction": "short_stay"}, {"_id": 0})
    if not prop:
        raise HTTPException(404, "Short-stay property not found")
    if prop.get("max_guests") and body.guests > prop["max_guests"]:
        raise HTTPException(422, f"Maximum {prop['max_guests']} guests allowed")
    pct = body.mgmt_fee_pct if body.mgmt_fee_pct is not None else (prop.get("mgmt_fee_pct") or 0)
    try:
        calc = calc_shortstay(date.fromisoformat(body.check_in), date.fromisoformat(body.check_out), body.nightly_rate,
                              body.discount, body.cleaning_fee, body.platform_fee, body.operating_costs, pct)
    except ValueError as e:
        raise HTTPException(422, str(e))
    existing = await db.bookings.find({"property_id": body.property_id, "status": {"$ne": "cancelled"}},
                                      {"_id": 0, "check_in": 1, "check_out": 1, "code": 1}).to_list(5000)
    for b in existing:
        if ranges_overlap(body.check_in, body.check_out, b["check_in"], b["check_out"]):
            raise HTTPException(409, f"Dates overlap with booking {b['code']}")
    data = body.model_dump()
    data["guest_phone"] = normalize_phone(data["guest_phone"])
    data["mgmt_fee_pct"] = pct
    bk = {"id": new_id(), "code": await next_code("booking", "SE-B-", 5), **data, **calc,
          "property_title": prop["title"], "owner_id": prop.get("owner_id"), "status": "confirmed", "settled": False,
          "issues": [], "created_by": user["id"], "created_at": now_iso()}
    await reserve_nights(bk)
    try:
        await db.bookings.insert_one(dict(bk))
    except Exception:
        await release_nights(bk["id"])
        raise
    await db.tasks.insert_one({"id": new_id(), "title": f"Turnover cleaning – {prop['title']} ({bk['code']})",
                               "due_date": body.check_out, "priority": "high", "status": "open", "kind": "cleaning",
                               "related_type": "booking", "related_id": bk["id"], "assigned_to": None,
                               "created_by": user["id"], "created_at": now_iso(), "comments": []})
    await audit(user, "booking_created", "shortstay", bk["id"])
    return bk


@router.patch("/bookings/{bid}/status")
async def booking_status(bid: str, body: dict, user=Depends(require("shortstay", "w"))):
    st = body.get("status")
    flow = {"confirmed": ["checked_in", "no_show"], "checked_in": ["completed"]}
    b = await db.bookings.find_one({"id": bid}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Booking not found")
    if st not in flow.get(b["status"], []):
        raise HTTPException(422, f"Cannot move from {b['status']} to {st}")
    await db.bookings.update_one({"id": bid}, {"$set": {"status": st, f"{st}_at": now_iso()}})
    return {"ok": True}


@router.post("/bookings/{bid}/issues")
async def booking_issue(bid: str, body: dict, user=Depends(require("shortstay", "w"))):
    if not body.get("note"):
        raise HTTPException(422, "Note is required")
    r = await db.bookings.update_one({"id": bid}, {"$push": {"issues": {"at": now_iso(), "by": user["name"],
                                                                        "note": str(body["note"])[:1000]}}})
    if not r.matched_count:
        raise HTTPException(404, "Booking not found")
    return {"ok": True}


async def apply_booking_cancel(b, payload, user):
    r = await db.bookings.update_one({"id": b["id"], "status": {"$in": ["confirmed"]}, "settled": False},
                                     {"$set": {"status": "cancelled", "cancel_reason": payload["reason"],
                                               "refund_amount": payload["refund_amount"], "cancelled_at": now_iso()}})
    if not r.modified_count:
        raise HTTPException(409, "Booking cannot be cancelled in its current state")
    await release_nights(b["id"])
    await audit(user, "booking_cancelled", "shortstay", b["id"], payload)
    return {"ok": True}


@router.post("/bookings/{bid}/cancel")
async def cancel_booking(bid: str, body: CancelBookingIn, user=Depends(require("shortstay", "w"))):
    b = await db.bookings.find_one({"id": bid}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Booking not found")
    if body.refund_amount > b["gross"]:
        raise HTTPException(422, "Refund exceeds booking value")
    settings = await get_settings()
    if body.refund_amount > 0 and (settings.get("approvals") or {}).get("refunds", True) and not can(user, "shortstay", "a"):
        ap = {"id": new_id(), "kind": "booking_refund", "entity_type": "booking", "entity_id": bid,
              "summary": f"{b['code']}: cancel with refund {inr(body.refund_amount)}", "payload": body.model_dump(),
              "status": "pending", "requested_by": user["id"], "requested_by_name": user["name"],
              "reason": body.reason, "created_at": now_iso()}
        await db.approvals.insert_one(dict(ap))
        await notify_roles(["director", "super_admin"], "Approval needed: booking refund", ap["summary"],
                           "/erp/approvals", dedupe=f"ap:{ap['id']}")
        return {"approval_required": True, "approval": ap}
    return await apply_booking_cancel(b, body.model_dump(), user)


@router.post("/bookings/{bid}/settle")
async def settle_booking(bid: str, user=Depends(require("shortstay", "w"))):
    b = await db.bookings.find_one({"id": bid}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Booking not found")
    if b["status"] != "completed":
        raise HTTPException(422, "Only completed stays can be settled")
    r = await db.bookings.update_one({"id": bid, "settled": False}, {"$set": {"settled": True, "settled_at": now_iso(),
                                                                             "payout_status": "pending_manual_transfer"}})
    if not r.modified_count:
        raise HTTPException(409, "Booking already settled")
    o = b.get("owner_id")
    await post_ledger("shortstay_owner", "in", b["net_after_platform"], "booking", bid,
                      f"{b['code']} net booking proceeds (gross {inr(b['gross'])} less platform fee)", user, o, "booking_net")
    await post_ledger("shortstay_owner", "out", b["management_fee"], "booking", bid, f"{b['code']} management fee",
                      user, o, "mgmt_fee")
    await post_ledger("company", "in", b["management_fee"], "booking", bid, f"{b['code']} short-stay management fee",
                      user, o, "revenue:shortstay")
    await post_ledger("shortstay_owner", "out", b["operating_costs"], "booking", bid, f"{b['code']} operating costs",
                      user, o, "operating_costs")
    await audit(user, "booking_settled", "shortstay", bid, {"owner_payout": b["owner_payout"]})
    return {"ok": True, "owner_payout": b["owner_payout"], "management_fee": b["management_fee"]}
