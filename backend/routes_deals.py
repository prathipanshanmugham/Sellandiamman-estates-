from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field
from core import db, now_iso, new_id, next_code, require, can, scope, is_scoped, get_scoped, audit, notify, \
    post_ledger, get_settings, notify_roles
from logic import calc_commission
from pdf import make_pdf, inr

router = APIRouter()
STAGES = ["negotiation", "agreement", "closing", "won", "cancelled", "disputed"]


def default_checklist(kind):
    base = ["Commission agreement signed", "Identity verified (parties)", "Title / ownership documents reviewed"]
    extra = {"sale": ["Sale agreement drafted", "Registration date fixed"],
             "rent": ["Rental agreement executed", "Deposit received", "Move-in checklist"],
             "lease": ["Lease deed executed", "Security deposit received", "Handover completed"]}
    return [{"item": i, "done": False} for i in base + extra.get(kind, [])]


class DealIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    deal_type: str = Field(pattern=r"^(sale|rent|lease)$")
    property_id: str
    lead_id: Optional[str] = None
    buyer_name: str = Field(min_length=2, max_length=120)
    buyer_phone: Optional[str] = None
    seller_name: Optional[str] = None
    expected_close: Optional[str] = None
    assigned_to: Optional[str] = None
    notes: Optional[str] = None


class OfferIn(BaseModel):
    amount: float = Field(gt=0)
    party: str = Field(min_length=2, max_length=120)
    terms: Optional[str] = Field(None, max_length=1000)


class SplitIn(BaseModel):
    party: str
    kind: str = Field("co_broker", pattern=r"^(co_broker|referral|agent)$")
    percent: float = Field(ge=0, le=100)


class CommissionIn(BaseModel):
    type: str = Field(pattern=r"^(percent|fixed|months_rent)$")
    value: float = Field(ge=0)
    payer: str = Field(min_length=2, max_length=120)
    agreement_signed: bool = False
    splits: List[SplitIn] = []
    reason: Optional[str] = None


class CancelIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
    status: str = Field("cancelled", pattern=r"^(cancelled|disputed)$")


async def apply_commission(deal, payload, user):
    calc = calc_commission(deal.get("agreed_value") or 0, {"type": payload["type"], "value": payload["value"]},
                           payload.get("splits"))
    com = {"rule": {"type": payload["type"], "value": payload["value"]}, "payer": payload["payer"],
           "agreement_signed": payload.get("agreement_signed", False), **calc, "set_by": user["name"], "at": now_iso()}
    sets = {"commission": com, "expected_commission": calc["gross"]}
    if com["agreement_signed"]:
        sets["checklist.0.done"] = True
    await db.deals.update_one({"id": deal["id"]}, {"$set": sets,
                                                   "$push": {"history": {"at": now_iso(), "by": user["name"],
                                                                         "event": f"Commission set: {inr(calc['gross'])}"}}})
    await audit(user, "commission_set", "deals", deal["id"], {"gross": calc["gross"], "rule": com["rule"]})
    return com


@router.get("/deals")
async def list_deals(stage: Optional[str] = None, user=Depends(require("deals", "r"))):
    f = {"deleted": {"$ne": True}, **scope(user, "deals")}
    if stage:
        f["stage"] = stage
    return await db.deals.find(f, {"_id": 0, "history": 0}).sort("created_at", -1).to_list(2000)


@router.post("/deals")
async def create_deal(body: DealIn, user=Depends(require("deals", "w"))):
    prop = await db.properties.find_one({"id": body.property_id, "deleted": {"$ne": True}, **scope(user, "properties")}, {"_id": 0})
    if not prop:
        raise HTTPException(404, "Property not found")
    if body.lead_id:
        await get_scoped("leads", "leads", user, body.lead_id)
    d = {"id": new_id(), "code": await next_code("deal", "SE-D-"), **body.model_dump(), "property_title": prop["title"],
         "stage": "negotiation", "branch_id": prop.get("branch_id"), "offers": [], "agreed_value": None,
         "commission": None, "expected_commission": 0, "checklist": default_checklist(body.deal_type),
         "history": [{"at": now_iso(), "by": user["name"], "event": "Deal created"}], "created_at": now_iso(),
         "deleted": False}
    if is_scoped(user, "deals") or not d.get("assigned_to"):
        d["assigned_to"] = user["id"]
    await db.deals.insert_one(dict(d))
    await audit(user, "deal_created", "deals", d["id"])
    return d


@router.post("/deals/commission-preview")
async def preview(body: dict, user=Depends(require("deals", "r"))):
    try:
        return calc_commission(body.get("base_value"), body.get("rule"), body.get("splits"))
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.get("/deals/{did}")
async def get_deal(did: str, user=Depends(require("deals", "r"))):
    d = await get_scoped("deals", "deals", user, did)
    if can(user, "finance", "r") or can(user, "deals", "w"):
        d["invoice"] = await db.invoices.find_one({"deal_id": did}, {"_id": 0})
    d["approvals"] = await db.approvals.find({"entity_id": did}, {"_id": 0}).to_list(50)
    return d


@router.patch("/deals/{did}")
async def update_deal(did: str, body: dict, user=Depends(require("deals", "w"))):
    d = await get_scoped("deals", "deals", user, did)
    if d["stage"] in ("won", "cancelled"):
        raise HTTPException(422, "Closed deals cannot be edited")
    upd = {k: v for k, v in body.items() if k in ("title", "buyer_name", "buyer_phone", "seller_name", "expected_close",
                                                  "notes", "checklist", "stage")}
    if "stage" in upd and upd["stage"] not in ("negotiation", "agreement", "closing", "disputed"):
        raise HTTPException(422, "Use the close or cancel action for this stage")
    if "assigned_to" in body and not is_scoped(user, "deals"):
        upd["assigned_to"] = body["assigned_to"]
    await db.deals.update_one({"id": did}, {"$set": upd, "$push": {"history": {"at": now_iso(), "by": user["name"],
                                                                               "event": f"Updated {', '.join(upd)}"}}})
    return {**d, **upd}


@router.post("/deals/{did}/offers")
async def add_offer(did: str, body: OfferIn, user=Depends(require("deals", "w"))):
    d = await get_scoped("deals", "deals", user, did)
    if d["stage"] in ("won", "cancelled"):
        raise HTTPException(422, "Deal is closed")
    o = {"id": new_id(), **body.model_dump(), "status": "pending", "by": user["name"], "at": now_iso()}
    await db.deals.update_one({"id": did}, {"$push": {"offers": o, "history": {"at": now_iso(), "by": user["name"],
                                                                                "event": f"Offer {inr(body.amount)} by {body.party}"}}})
    if d.get("lead_id"):
        from routes_crm import add_activity
        await add_activity(d["lead_id"], "offer", f"Offer of {inr(body.amount)} recorded on {d['code']}", user)
    return o


@router.patch("/deals/{did}/offers/{oid}")
async def offer_status(did: str, oid: str, body: dict, user=Depends(require("deals", "w"))):
    d = await get_scoped("deals", "deals", user, did)
    status = body.get("status")
    if status not in ("accepted", "rejected", "countered"):
        raise HTTPException(422, "Invalid offer status")
    offer = next((o for o in d["offers"] if o["id"] == oid), None)
    if not offer:
        raise HTTPException(404, "Offer not found")
    upd = {"offers.$.status": status}
    if status == "accepted":
        if d.get("commission") and d["commission"].get("agreement_signed"):
            raise HTTPException(422, "Commission already agreed on a previous value; request a commission change")
        upd["agreed_value"] = offer["amount"]
        upd["stage"] = "agreement"
    await db.deals.update_one({"id": did, "offers.id": oid}, {"$set": upd, "$push": {"history": {
        "at": now_iso(), "by": user["name"], "event": f"Offer {status}"}}})
    if status == "accepted" and d.get("commission"):
        c = d["commission"]
        await apply_commission({**d, "agreed_value": offer["amount"]},
                               {**c["rule"], "payer": c["payer"], "splits": c["splits"],
                                "agreement_signed": c["agreement_signed"]}, user)
    return {"ok": True}


@router.post("/deals/{did}/commission")
async def set_commission(did: str, body: CommissionIn, user=Depends(require("deals", "w"))):
    d = await get_scoped("deals", "deals", user, did)
    if d["stage"] in ("won", "cancelled"):
        raise HTTPException(422, "Commission cannot be changed after closing; use an approved adjustment")
    if not d.get("agreed_value"):
        raise HTTPException(422, "Accept an offer to set the agreed value first")
    payload = body.model_dump()
    try:
        calc = calc_commission(d["agreed_value"], {"type": body.type, "value": body.value}, payload["splits"])
    except ValueError as e:
        raise HTTPException(422, str(e))
    settings = await get_settings()
    needs = d.get("commission") and (settings.get("approvals") or {}).get("commission_change", True)
    if needs and not can(user, "deals", "a"):
        ap = {"id": new_id(), "kind": "commission_change", "entity_type": "deal", "entity_id": did,
              "summary": f"{d['code']}: commission → {inr(calc['gross'])}", "payload": payload, "status": "pending",
              "requested_by": user["id"], "requested_by_name": user["name"], "reason": body.reason,
              "created_at": now_iso()}
        await db.approvals.insert_one(dict(ap))
        await notify_roles(["director", "super_admin"], "Approval needed: commission change", ap["summary"],
                           "/erp/approvals", dedupe=f"ap:{ap['id']}")
        return {"approval_required": True, "approval": ap}
    com = await apply_commission(d, payload, user)
    return {"approval_required": False, "commission": com}


@router.post("/deals/{did}/close")
async def close_deal(did: str, user=Depends(require("deals", "w"))):
    d = await get_scoped("deals", "deals", user, did)
    c = d.get("commission")
    if not d.get("agreed_value"):
        raise HTTPException(422, "Agreed value is required")
    if not c:
        raise HTTPException(422, "Set the commission before closing")
    if not c.get("agreement_signed"):
        raise HTTPException(422, "A written commission agreement is required before closing")
    if await db.approvals.find_one({"entity_id": did, "status": "pending"}):
        raise HTTPException(422, "Resolve pending approvals before closing")
    r = await db.deals.update_one({"id": did, "stage": {"$nin": ["won", "cancelled"]}},
                                  {"$set": {"stage": "won", "closed_at": now_iso(), "final_commission": c["gross"],
                                            "company_net_commission": c["company_net"]},
                                   "$push": {"history": {"at": now_iso(), "by": user["name"], "event": "Deal closed (won)"}}})
    if not r.modified_count:
        raise HTTPException(409, "Deal is already closed")
    for s in c.get("splits", []):
        await post_ledger("commission_payable", "in", s["amount"], "deal", did,
                          f"{s['kind']} commission payable to {s['party']} ({d['code']})", user, s["party"],
                          branch_id=d.get("branch_id"))
    closed_as = {"sale": "sold", "rent": "rented", "lease": "leased"}[d["deal_type"]]
    await db.properties.update_one({"id": d["property_id"]}, {"$set": {"status": "closed", "closed_as": closed_as,
                                                                       "updated_at": now_iso()}})
    if d.get("lead_id"):
        await db.leads.update_one({"id": d["lead_id"]}, {"$set": {"stage": "won", "updated_at": now_iso()}})
    await audit(user, "deal_closed", "deals", did, {"commission": c["gross"]})
    await notify_roles(["director", "accountant"], f"Deal closed: {d['code']}", f"Commission earned {inr(c['gross'])}",
                       f"/erp/deals/{did}", dedupe=f"won:{did}")
    return {"ok": True, "final_commission": c["gross"]}


@router.post("/deals/{did}/cancel")
async def cancel_deal(did: str, body: CancelIn, user=Depends(require("deals", "w"))):
    d = await get_scoped("deals", "deals", user, did)
    if d["stage"] in ("won", "cancelled"):
        raise HTTPException(422, "Deal is already closed")
    await db.deals.update_one({"id": did}, {"$set": {"stage": body.status, "cancel_reason": body.reason},
                                            "$push": {"history": {"at": now_iso(), "by": user["name"],
                                                                  "event": f"{body.status}: {body.reason}"}}})
    await audit(user, f"deal_{body.status}", "deals", did, {"reason": body.reason})
    return {"ok": True}


@router.post("/deals/{did}/invoice")
async def deal_invoice(did: str, user=Depends(require("deals", "r"))):
    if not (can(user, "deals", "w") or can(user, "finance", "w")):
        raise HTTPException(403, "You do not have permission for this action")
    d = await get_scoped("deals", "deals", user, did)
    if d["stage"] != "won":
        raise HTTPException(422, "Only closed deals can be invoiced")
    from routes_finance import create_invoice_doc
    c = d["commission"]
    inv = await create_invoice_doc({"type": "brokerage", "customer_name": c["payer"], "deal_id": did,
                                    "branch_id": d.get("branch_id"),
                                    "lines": [{"description": f"Brokerage commission – {d['property_title']} ({d['code']})",
                                               "qty": 1, "rate": c["gross"]}]}, user)
    return inv


@router.get("/deals/{did}/summary.pdf")
async def deal_pdf(did: str, user=Depends(require("deals", "r"))):
    d = await get_scoped("deals", "deals", user, did)
    s = await get_settings()
    c = d.get("commission") or {}
    rows = [[o["at"][:10], o["party"], inr(o["amount"]), o["status"]] for o in d.get("offers", [])]
    totals = [("Agreed value", inr(d.get("agreed_value"))), ("Gross commission", inr(c.get("gross"))),
              ("Splits payable", inr(c.get("splits_total"))), ("Company net commission", inr(c.get("company_net")))]
    pdf = make_pdf(f"Deal Summary {d['code']}", s,
                   [("Deal", d["title"]), ("Type", d["deal_type"]), ("Stage", d["stage"]),
                    ("Commission payer", c.get("payer", "-")), ("Rule", str(c.get("rule", "-")))],
                   ["Date", "Party", "Offer", "Status"], rows, totals,
                   "Property value is shown for reference only; company revenue is the commission.")
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename={d['code']}.pdf"})
