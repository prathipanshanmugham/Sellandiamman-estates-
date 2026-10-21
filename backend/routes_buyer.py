"""Buyer / client portal: someone buying, renting or leasing through us follows their purchase: the deal's stage and
checklist, site visits, homes we shortlisted for them, shared documents, and raises requests (/api/my/*)."""
from datetime import timedelta
import jwt
from fastapi import APIRouter, HTTPException, Depends
from core import db, now, buyer_user, audit, JWT_SECRET, JWT_ALG

router = APIRouter(prefix="/buyer")
DEAL_STEPS = ["negotiation", "agreement", "closing", "won"]
PUBLIC_PROP = {"_id": 0, "id": 1, "code": 1, "listing_id": 1, "title": 1, "locality": 1, "city": 1, "price": 1, "price_unit": 1,
               "price_on_request": 1, "bedrooms": 1, "category": 1, "transaction": 1, "status": 1, "images": 1, "built_area": 1,
               "plot_area": 1, "area_unit": 1}


async def buyer_records(customer_id):
    """The customer's enquiries (leads) and the deals made from them or in their mobile number."""
    c = await db.customers.find_one({"id": customer_id}, {"_id": 0, "id": 1, "code": 1, "name": 1, "phone": 1, "email": 1}) or {}
    leads = await db.leads.find({"customer_id": customer_id, "deleted": {"$ne": True}},
                                {"_id": 0, "id": 1, "code": 1, "interest": 1, "stage": 1, "budget_min": 1, "budget_max": 1,
                                 "preferred_locations": 1, "requirements": 1, "assigned_to": 1, "created_at": 1}).sort("created_at", -1).to_list(50)
    lids = [x["id"] for x in leads]
    q = [{"lead_id": {"$in": lids}}]
    if c.get("phone"):
        q.append({"buyer_phone": c["phone"]})
    deals = await db.deals.find({"$or": q, "deleted": {"$ne": True}}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return c, leads, deals


async def _agent(uid):
    if not uid:
        return None
    return await db.users.find_one({"id": uid}, {"_id": 0, "name": 1, "phone": 1, "whatsapp": 1, "email": 1, "designation": 1})


def _deal_view(d):
    steps = []
    cur = d["stage"]
    for s in DEAL_STEPS:
        done = cur in DEAL_STEPS and DEAL_STEPS.index(s) < DEAL_STEPS.index(cur) or cur == "won"
        steps.append({"key": s, "done": done, "current": s == cur})
    return {k: d.get(k) for k in ("id", "code", "title", "deal_type", "property_id", "property_title", "stage", "expected_close",
                                  "agreed_value", "created_at", "closed_at")} | {
        "steps": steps, "checklist": [{"item": c["item"], "done": c["done"]} for c in d.get("checklist", [])],
        "history": [{"at": h["at"], "event": h["event"]} for h in d.get("history", []) if not str(h.get("event", "")).startswith("Commission")][-12:]}


@router.get("/overview")
async def overview(user=Depends(buyer_user)):
    c, leads, deals = await buyer_records(user["customer_id"])
    lids = [x["id"] for x in leads]
    out_deals = []
    for d in deals:
        v = _deal_view(d)
        v["property"] = await db.properties.find_one({"id": d["property_id"]}, PUBLIC_PROP)
        v["agent"] = await _agent(d.get("assigned_to"))
        out_deals.append(v)
    visits = await db.site_visits.find({"lead_id": {"$in": lids}}, {"_id": 0, "id": 1, "property_id": 1, "property_title": 1,
                                                                    "property_code": 1, "scheduled_at": 1, "status": 1}).sort("scheduled_at", -1).to_list(100)
    shared_ids = [a["property_id"] for a in await db.lead_activities.find({"lead_id": {"$in": lids}, "kind": "shared_listing"},
                                                                           {"_id": 0, "property_id": 1}).to_list(500) if a.get("property_id")]
    shortlist = await db.properties.find({"id": {"$in": list(dict.fromkeys(shared_ids))}, "deleted": {"$ne": True},
                                          "status": {"$in": ["published", "under_offer", "ready_to_market"]}}, PUBLIC_PROP).to_list(50)
    agent = await _agent(next((x.get("assigned_to") for x in leads if x.get("assigned_to")), None))
    reqs = [{k: x.get(k) for k in ("code", "interest", "stage", "budget_min", "budget_max", "preferred_locations", "requirements", "created_at")}
            for x in leads]
    open_t = await db.tickets.count_documents({"customer_id": user["customer_id"], "status": {"$in": ["open", "acknowledged", "in_progress", "on_hold"]}})
    return {"customer": c, "deals": out_deals, "visits": visits, "shortlist": shortlist, "requirements": reqs, "agent": agent,
            "open_requests": open_t}


async def _docs(user):
    c, leads, deals = await buyer_records(user["customer_id"])
    f = {"is_latest": True, "share_with_buyer": True, "doc_type": {"$ne": "kyc"},
         "$or": [{"entity_type": "deal", "entity_id": {"$in": [d["id"] for d in deals]}},
                 {"entity_type": "lead", "entity_id": {"$in": [x["id"] for x in leads]}},
                 {"entity_type": "customer", "entity_id": user["customer_id"]}]}
    return await db.documents.find(f, {"_id": 0, "id": 1, "original_name": 1, "doc_type": 1, "entity_type": 1, "created_at": 1,
                                       "version": 1}).sort("created_at", -1).to_list(500)


@router.get("/documents")
async def documents(user=Depends(buyer_user)):
    return await _docs(user)


@router.post("/documents/{did}/link")
async def doc_link(did: str, user=Depends(buyer_user)):
    if did not in {d["id"] for d in await _docs(user)}:
        raise HTTPException(404, "Not found")
    tok = jwt.encode({"doc": did, "uid": user["id"], "typ": "file", "exp": now() + timedelta(minutes=5)}, JWT_SECRET, algorithm=JWT_ALG)
    await audit(user, "document_link", "documents", did, {"portal": "buyer"})
    return {"url": f"/api/files/{tok}", "expires_in": 300}
