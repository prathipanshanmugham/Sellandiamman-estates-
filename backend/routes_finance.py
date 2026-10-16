from datetime import timedelta
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError
from core import db, now_iso, new_id, next_code, require, can, audit, post_ledger, get_settings, today_ist, \
    notify_roles
from logic import calc_invoice, LEDGERS
from pdf import make_pdf, inr

router = APIRouter()
INV_TYPES = ["brokerage", "management", "shortstay", "marketing", "other"]


def fy(d):
    y = d.year if d.month >= 4 else d.year - 1
    return f"{y}-{(y + 1) % 100:02d}"


async def create_invoice_doc(data, user):
    s = await get_settings()
    try:
        calc = calc_invoice(data["lines"], s.get("gst_rate", 0), s.get("gst_enabled", False))
    except ValueError as e:
        raise HTTPException(422, str(e))
    if data.get("deal_id") and await db.invoices.find_one({"deal_id": data["deal_id"], "status": {"$ne": "void"}}):
        raise HTTPException(409, "An invoice already exists for this deal")
    t = today_ist()
    inv = {"id": new_id(), "number": await next_code(f"inv-{fy(t)}", f"SE/{fy(t)}/", 4), "type": data["type"],
           "customer_name": data["customer_name"], "customer_phone": data.get("customer_phone"),
           "customer_gstin": data.get("customer_gstin"), **calc, "paid": 0.0, "credited": 0.0, "status": "issued",
           "issue_date": t.isoformat(), "due_date": (t + timedelta(days=int(s.get("invoice_due_days", 15)))).isoformat(),
           "deal_id": data.get("deal_id"), "booking_id": data.get("booking_id"), "owner_id": data.get("owner_id"),
           "notes": data.get("notes"), "created_by": user["id"], "created_at": now_iso()}
    await db.invoices.insert_one(dict(inv))
    await audit(user, "invoice_issued", "finance", inv["id"], {"total": inv["total"], "number": inv["number"]})
    return inv


class LineIn(BaseModel):
    description: str = Field(min_length=2, max_length=300)
    qty: float = Field(1, gt=0)
    rate: float = Field(ge=0)


class InvoiceIn(BaseModel):
    type: str
    customer_name: str = Field(min_length=2, max_length=150)
    customer_phone: Optional[str] = None
    customer_gstin: Optional[str] = Field(None, max_length=15)
    lines: List[LineIn]
    notes: Optional[str] = None


class PaymentIn(BaseModel):
    amount: float = Field(gt=0)
    method: str = Field(pattern=r"^(cash|upi|bank_transfer|cheque|card)$")
    reference: Optional[str] = Field(None, max_length=100)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    idempotency_key: str = Field(min_length=8, max_length=80)


class CreditIn(BaseModel):
    amount: float = Field(gt=0)
    reason: str = Field(min_length=3, max_length=500)
    refund: bool = False


class ReverseIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class ExpenseIn(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    category: str = Field(min_length=2, max_length=60)
    description: str = Field(min_length=2, max_length=300)
    amount: float = Field(gt=0)
    gst_amount: float = Field(0, ge=0)
    vendor: Optional[str] = None
    bill_ref: Optional[str] = None
    paid_from: str = Field("company", pattern=r"^(company|owner_funds)$")
    owner_id: Optional[str] = None
    property_id: Optional[str] = None
    branch_id: Optional[str] = None


@router.get("/invoices")
async def list_invoices(status: Optional[str] = None, user=Depends(require("finance", "r"))):
    f = {"status": status} if status else {}
    return await db.invoices.find(f, {"_id": 0}).sort("created_at", -1).to_list(2000)


@router.post("/invoices")
async def new_invoice(body: InvoiceIn, user=Depends(require("finance", "w"))):
    if body.type not in INV_TYPES:
        raise HTTPException(422, "Invalid invoice type")
    return await create_invoice_doc({**body.model_dump(), "lines": [ln.model_dump() for ln in body.lines]}, user)


@router.get("/invoices/{iid}")
async def get_invoice(iid: str, user=Depends(require("finance", "r"))):
    inv = await db.invoices.find_one({"id": iid}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    inv["payments"] = await db.payments.find({"invoice_id": iid}, {"_id": 0}).to_list(100)
    inv["credit_notes"] = await db.credit_notes.find({"invoice_id": iid}, {"_id": 0}).to_list(50)
    return inv


@router.post("/invoices/{iid}/payments")
async def record_payment(iid: str, body: PaymentIn, user=Depends(require("finance", "w"))):
    inv = await db.invoices.find_one({"id": iid}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    pay = {"id": new_id(), "receipt_no": None, "invoice_id": iid, "invoice_number": inv["number"],
           **body.model_dump(), "recorded_by": user["id"], "created_at": now_iso()}
    try:
        await db.payments.insert_one(dict(pay))
    except DuplicateKeyError:
        raise HTTPException(409, "This payment was already recorded")
    r = await db.invoices.update_one(
        {"id": iid, "status": {"$in": ["issued", "partially_paid"]},
         "$expr": {"$lte": [{"$add": ["$paid", "$credited", body.amount]}, {"$add": ["$total", 0.001]}]}},
        {"$inc": {"paid": body.amount}})
    if not r.modified_count:
        await db.payments.delete_one({"id": pay["id"]})
        raise HTTPException(422, "Payment exceeds the outstanding amount or invoice is not payable")
    rno = await next_code("receipt", "RCPT-", 5)
    await db.payments.update_one({"id": pay["id"]}, {"$set": {"receipt_no": rno}})
    fresh = await db.invoices.find_one({"id": iid}, {"_id": 0})
    status = "paid" if fresh["paid"] + fresh["credited"] >= fresh["total"] - 0.001 else "partially_paid"
    await db.invoices.update_one({"id": iid}, {"$set": {"status": status}})
    await post_ledger("company", "in", body.amount, "invoice", iid, f"Receipt {rno} against {inv['number']}", user,
                      inv["customer_name"], f"revenue:{inv['type']}")
    await audit(user, "payment_recorded", "finance", iid, {"amount": body.amount, "receipt": rno})
    return {**pay, "receipt_no": rno, "invoice_status": status}


async def apply_credit_note(inv, payload, user):
    amount = float(payload["amount"])
    r = await db.invoices.update_one(
        {"id": inv["id"], "status": {"$ne": "void"},
         "$expr": {"$lte": [{"$add": ["$credited", amount]}, {"$add": ["$total", 0.001]}]}},
        {"$inc": {"credited": amount}})
    if not r.modified_count:
        raise HTTPException(422, "Credit exceeds invoice total")
    cn = {"id": new_id(), "number": await next_code("credit", "CN-", 5), "invoice_id": inv["id"], **payload,
          "by": user["id"], "created_at": now_iso()}
    await db.credit_notes.insert_one(dict(cn))
    if payload.get("refund"):
        await post_ledger("company", "out", amount, "credit_note", cn["id"], f"Refund {cn['number']} on {inv['number']}",
                          user, inv["customer_name"], "refund")
        await db.invoices.update_one({"id": inv["id"]}, {"$inc": {"paid": -amount}})
    fresh = await db.invoices.find_one({"id": inv["id"]}, {"_id": 0})
    status = "paid" if fresh["paid"] + fresh["credited"] >= fresh["total"] - 0.001 else (
        "partially_paid" if fresh["paid"] > 0 else "issued")
    if fresh["credited"] >= fresh["total"] - 0.001 and fresh["paid"] <= 0.001:
        status = "credited"
    await db.invoices.update_one({"id": inv["id"]}, {"$set": {"status": status}})
    await audit(user, "credit_note", "finance", inv["id"], {"amount": amount, "refund": payload.get("refund")})
    return cn


@router.post("/invoices/{iid}/credit-note")
async def credit_note(iid: str, body: CreditIn, user=Depends(require("finance", "w"))):
    inv = await db.invoices.find_one({"id": iid}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if body.refund and body.amount > inv["paid"]:
        raise HTTPException(422, "Refund exceeds amount paid")
    if can(user, "finance", "a"):
        return {"approval_required": False, "credit_note": await apply_credit_note(inv, body.model_dump(), user)}
    ap = {"id": new_id(), "kind": "credit_note", "entity_type": "invoice", "entity_id": iid,
          "summary": f"{inv['number']}: {'refund' if body.refund else 'credit/write-off'} {inr(body.amount)}",
          "payload": body.model_dump(), "status": "pending", "requested_by": user["id"],
          "requested_by_name": user["name"], "reason": body.reason, "created_at": now_iso()}
    await db.approvals.insert_one(dict(ap))
    await notify_roles(["director", "super_admin"], "Approval needed: credit note / refund", ap["summary"],
                       "/erp/approvals", dedupe=f"ap:{ap['id']}")
    return {"approval_required": True, "approval": ap}


@router.get("/invoices/{iid}/pdf")
async def invoice_pdf(iid: str, user=Depends(require("finance", "r"))):
    inv = await db.invoices.find_one({"id": iid}, {"_id": 0})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    s = await get_settings()
    rows = [[ln["description"], f"{ln['qty']:g}", inr(ln["rate"]), inr(ln["amount"])] for ln in inv["lines"]]
    totals = [("Subtotal", inr(inv["subtotal"]))]
    if inv["tax"]:
        totals.append((f"GST @ {inv['tax_rate']:g}%", inr(inv["tax"])))
    totals += [("Total", inr(inv["total"])), ("Paid", inr(inv["paid"])),
               ("Balance due", inr(inv["total"] - inv["paid"] - inv.get("credited", 0)))]
    pdf = make_pdf(f"Tax Invoice {inv['number']}" if inv["tax"] else f"Invoice {inv['number']}", s,
                   [("Billed to", inv["customer_name"]), ("GSTIN", inv.get("customer_gstin") or "-"),
                    ("Issue date", inv["issue_date"]), ("Due date", inv["due_date"]), ("Status", inv["status"])],
                   ["Description", "Qty", "Rate", "Amount"], rows, totals, inv.get("notes") or "")
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f"inline; filename=invoice.pdf"})


@router.get("/payments/{pid}/receipt.pdf")
async def receipt_pdf(pid: str, user=Depends(require("finance", "r"))):
    p = await db.payments.find_one({"id": pid}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Payment not found")
    s = await get_settings()
    pdf = make_pdf(f"Receipt {p['receipt_no']}", s, [("Invoice", p["invoice_number"]), ("Date", p["date"]),
                                                    ("Method", p["method"]), ("Reference", p.get("reference") or "-")],
                   [], [], [("Amount received", inr(p["amount"]))])
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": "inline; filename=receipt.pdf"})


@router.get("/ledger")
async def ledger(ledger: Optional[str] = None, ref_id: Optional[str] = None, user=Depends(require("finance", "r"))):
    f = {}
    if ledger:
        f["ledger"] = ledger
    if ref_id:
        f["ref_id"] = ref_id
    return await db.ledger_entries.find(f, {"_id": 0}).sort("posted_at", -1).to_list(5000)


@router.get("/ledger/balances")
async def balances(user=Depends(require("finance", "r"))):
    rows = await db.ledger_entries.aggregate([{"$group": {"_id": {"l": "$ledger", "d": "$direction"},
                                                          "t": {"$sum": "$amount"}}}]).to_list(50)
    out = {k: {"name": v, "in": 0.0, "out": 0.0, "balance": 0.0} for k, v in LEDGERS.items()}
    for r in rows:
        o = out.setdefault(r["_id"]["l"], {"name": r["_id"]["l"], "in": 0.0, "out": 0.0, "balance": 0.0})
        o[r["_id"]["d"]] = round(r["t"], 2)
    for o in out.values():
        o["balance"] = round(o["in"] - o["out"], 2)
    return out


async def do_reverse(entry, reason, user):
    r = await db.ledger_entries.update_one({"id": entry["id"], "reversed": False, "reversal_of": None},
                                           {"$set": {"reversed": True}})
    if not r.modified_count:
        raise HTTPException(409, "Entry is already reversed or is itself a reversal")
    rev = await post_ledger(entry["ledger"], "out" if entry["direction"] == "in" else "in", entry["amount"],
                            entry["ref_type"], entry["ref_id"], f"Reversal of {entry['code']}: {reason}", user,
                            entry.get("party"), entry.get("account"))
    await db.ledger_entries.update_one({"id": rev["id"]}, {"$set": {"reversal_of": entry["id"]}})
    await audit(user, "ledger_reversal", "finance", entry["id"], {"reason": reason})
    return rev


@router.post("/ledger/{eid}/reverse")
async def reverse(eid: str, body: ReverseIn, user=Depends(require("finance", "w"))):
    e = await db.ledger_entries.find_one({"id": eid}, {"_id": 0})
    if not e:
        raise HTTPException(404, "Entry not found")
    if can(user, "finance", "a"):
        return {"approval_required": False, "entry": await do_reverse(e, body.reason, user)}
    ap = {"id": new_id(), "kind": "ledger_reversal", "entity_type": "ledger", "entity_id": eid,
          "summary": f"Reverse {e['code']} ({inr(e['amount'])})", "payload": body.model_dump(), "status": "pending",
          "requested_by": user["id"], "requested_by_name": user["name"], "reason": body.reason, "created_at": now_iso()}
    await db.approvals.insert_one(dict(ap))
    return {"approval_required": True, "approval": ap}


@router.get("/expenses")
async def list_expenses(user=Depends(require("finance", "r"))):
    return await db.expenses.find({}, {"_id": 0}).sort("date", -1).to_list(5000)


@router.post("/expenses")
async def new_expense(body: ExpenseIn, user=Depends(require("finance", "w"))):
    if body.paid_from == "owner_funds" and not body.owner_id:
        raise HTTPException(422, "Owner is required when paying from owner funds")
    e = {"id": new_id(), "code": await next_code("expense", "EXP-", 5), **body.model_dump(), "by": user["id"],
         "created_at": now_iso()}
    await db.expenses.insert_one(dict(e))
    await post_ledger(body.paid_from, "out", body.amount + body.gst_amount, "expense", e["id"],
                      f"{body.category}: {body.description}", user, body.vendor or body.owner_id, f"expense:{body.category}")
    await audit(user, "expense_recorded", "finance", e["id"], {"amount": body.amount})
    return e
