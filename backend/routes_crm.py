import csv
import io
import re
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from core import (db, now_iso, new_id, next_code, normalize_phone, require, can, scope, is_scoped, get_scoped,
                  audit, notify, IST)
from logic import LEAD_STAGES

router = APIRouter()
SOURCES = ["website", "whatsapp", "phone", "referral", "walk_in", "portal", "social", "broker", "existing_customer",
           "campaign"]
CUSTOMER_TYPES = ["buyer", "seller", "tenant", "landlord", "investor", "business"]


def ist_now_str():
    return datetime.now(IST).strftime("%Y-%m-%dT%H:%M")


async def add_activity(lead_id, kind, notes, user=None, extra=None):
    await db.lead_activities.insert_one({"id": new_id(), "lead_id": lead_id, "kind": kind, "notes": notes,
                                         "user_id": user["id"] if user else None,
                                         "user_name": user.get("name") if user else "System",
                                         "created_at": now_iso(), **(extra or {})})


async def create_lead(data, user, note=None):
    """Returns (lead, is_duplicate). Duplicate open lead with same phone gets an activity instead."""
    dup = await db.leads.find_one({"phone": data["phone"], "stage": {"$nin": ["won", "lost"]}, "deleted": {"$ne": True}},
                                  {"_id": 0})
    if dup and not data.get("force"):
        await add_activity(dup["id"], "duplicate_enquiry", note or "Repeat enquiry received", user)
        return dup, True
    lead = {"id": new_id(), "code": await next_code("lead", "SE-LD-", 5), "stage": "new", "deleted": False,
            "created_at": now_iso(), "updated_at": now_iso(), "created_by": user["id"] if user else None,
            "contacts": [], "lost_reason": None, "next_follow_up": None,
            **{k: data.get(k) for k in ("name", "phone", "email", "organization", "customer_type", "source", "interest",
                                        "budget_min", "budget_max", "preferred_locations", "requirements",
                                        "property_id", "assigned_to", "branch_id", "next_follow_up",
                                        "preferred_contact", "utm_source", "campaign_id")},
            "consent": {"marketing": bool(data.get("marketing_consent")), "recorded_at": now_iso()}}
    await db.leads.insert_one(dict(lead))
    await add_activity(lead["id"], "created", note or "Lead created", user)
    if lead.get("assigned_to"):
        await notify([lead["assigned_to"]], f"New lead assigned: {lead['name']}", lead.get("requirements") or "",
                     f"/erp/leads/{lead['id']}", dedupe=f"assign:{lead['id']}:{lead['assigned_to']}")
    return lead, False


class LeadIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    phone: str
    email: Optional[str] = Field(None, max_length=120)
    organization: Optional[str] = Field(None, max_length=120)
    customer_type: str = "buyer"
    source: str = "phone"
    interest: str = "buy"
    budget_min: Optional[float] = Field(None, ge=0)
    budget_max: Optional[float] = Field(None, ge=0)
    preferred_locations: Optional[str] = None
    requirements: Optional[str] = Field(None, max_length=3000)
    property_id: Optional[str] = None
    assigned_to: Optional[str] = None
    branch_id: Optional[str] = None
    next_follow_up: Optional[str] = None
    marketing_consent: bool = False
    preferred_contact: str = "phone"
    campaign_id: Optional[str] = None
    force: bool = False


class LeadPatch(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    organization: Optional[str] = None
    customer_type: Optional[str] = None
    interest: Optional[str] = None
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    preferred_locations: Optional[str] = None
    requirements: Optional[str] = None
    property_id: Optional[str] = None
    assigned_to: Optional[str] = None
    branch_id: Optional[str] = None
    next_follow_up: Optional[str] = None
    stage: Optional[str] = None
    lost_reason: Optional[str] = None
    preferred_contact: Optional[str] = None
    marketing_consent: Optional[bool] = None
    contacts: Optional[List[dict]] = None


class ActivityIn(BaseModel):
    kind: str = Field(pattern=r"^(call|whatsapp|email|meeting|note|sms)$")
    notes: str = Field(min_length=1, max_length=3000)
    outcome: Optional[str] = None
    next_follow_up: Optional[str] = None


class VisitIn(BaseModel):
    property_id: str
    scheduled_at: str
    notes: Optional[str] = None


class VisitPatch(BaseModel):
    status: str = Field(pattern=r"^(requested|scheduled|completed|cancelled|no_show)$")
    feedback: Optional[str] = None
    scheduled_at: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")


class ConvertIn(BaseModel):
    property_id: str
    deal_type: str = Field(pattern=r"^(sale|rent|lease)$")


def _validate(data):
    if data.get("customer_type") and data["customer_type"] not in CUSTOMER_TYPES:
        raise HTTPException(422, "Invalid customer type")
    if data.get("source") and data["source"] not in SOURCES:
        raise HTTPException(422, "Invalid lead source")


@router.get("/leads")
async def list_leads(stage: Optional[str] = None, source: Optional[str] = None, assigned_to: Optional[str] = None,
                     q: Optional[str] = None, overdue: bool = False, user=Depends(require("leads", "r"))):
    f = {"deleted": {"$ne": True}, **scope(user, "leads")}
    if stage:
        f["stage"] = stage
    if source:
        f["source"] = source
    if assigned_to and not is_scoped(user, "leads"):
        f["assigned_to"] = None if assigned_to == "unassigned" else assigned_to
    if overdue:
        f["next_follow_up"] = {"$lt": ist_now_str(), "$ne": None}
        f["stage"] = {"$nin": ["won", "lost"]}
    if q:
        rx = {"$regex": re.escape(q[:60]), "$options": "i"}
        f["$or"] = [{"name": rx}, {"phone": rx}, {"code": rx}, {"email": rx}]
    rows = await db.leads.find(f, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return rows


@router.post("/leads")
async def new_lead(body: LeadIn, user=Depends(require("leads", "w"))):
    data = body.model_dump()
    _validate(data)
    data["phone"] = normalize_phone(data["phone"])
    if is_scoped(user, "leads"):
        data["assigned_to"] = user["id"]
    if not data.get("branch_id") and user.get("branch_ids"):
        data["branch_id"] = user["branch_ids"][0]
    existing = await db.leads.find_one({"phone": data["phone"], "stage": {"$nin": ["won", "lost"]},
                                        "deleted": {"$ne": True}}, {"_id": 0, "id": 1, "code": 1, "name": 1})
    if existing and not body.force:
        raise HTTPException(409, f"Possible duplicate: open lead {existing['code']} ({existing['name']}) has this phone")
    lead, _ = await create_lead({**data, "force": True}, user)
    await audit(user, "lead_created", "leads", lead["id"])
    return lead


@router.get("/leads/export.csv")
async def export_leads(user=Depends(require("leads", "e"))):
    rows = await db.leads.find({"deleted": {"$ne": True}, **scope(user, "leads")}, {"_id": 0}).to_list(10000)
    cols = ["code", "name", "phone", "email", "customer_type", "source", "interest", "stage", "assigned_to",
            "next_follow_up", "created_at"]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow(r)
    await audit(user, "export", "leads", None, {"count": len(rows)})
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=leads.csv"})


@router.post("/leads/import")
async def import_leads(file: UploadFile = File(...), user=Depends(require("leads", "e"))):
    if not can(user, "leads", "w"):
        raise HTTPException(403, "You do not have permission for this action")
    raw = (await file.read())[:2_000_000].decode("utf-8-sig", errors="ignore")
    created, skipped, errors = 0, 0, []
    for i, row in enumerate(csv.DictReader(io.StringIO(raw)), start=2):
        try:
            if not row.get("name") or not row.get("phone"):
                raise ValueError("name and phone are required")
            phone = normalize_phone(row["phone"])
            data = {"name": row["name"].strip()[:100], "phone": phone, "email": row.get("email"),
                    "source": row.get("source") if row.get("source") in SOURCES else "campaign",
                    "interest": row.get("interest") or "buy", "customer_type": "buyer",
                    "requirements": row.get("requirements"),
                    "assigned_to": user["id"] if is_scoped(user, "leads") else None}
            _, dup = await create_lead(data, user, "Imported from CSV")
            skipped += dup
            created += not dup
        except (ValueError, HTTPException) as e:
            errors.append(f"Row {i}: {getattr(e, 'detail', str(e))}")
    await audit(user, "import", "leads", None, {"created": created, "duplicates": skipped})
    return {"created": created, "duplicates": skipped, "errors": errors[:50]}


@router.get("/leads/{lid}")
async def get_lead(lid: str, user=Depends(require("leads", "r"))):
    lead = await get_scoped("leads", "leads", user, lid)
    acts = await db.lead_activities.find({"lead_id": lid}, {"_id": 0}).sort("created_at", -1).to_list(500)
    visits = await db.site_visits.find({"lead_id": lid}, {"_id": 0}).sort("scheduled_at", -1).to_list(100)
    deals = await db.deals.find({"lead_id": lid}, {"_id": 0, "id": 1, "code": 1, "stage": 1, "title": 1}).to_list(20)
    return {**lead, "activities": acts, "site_visits": visits, "deals": deals}


@router.patch("/leads/{lid}")
async def patch_lead(lid: str, body: LeadPatch, user=Depends(require("leads", "w"))):
    lead = await get_scoped("leads", "leads", user, lid)
    upd = body.model_dump(exclude_unset=True)
    _validate(upd)
    if "assigned_to" in upd and is_scoped(user, "leads"):
        raise HTTPException(403, "Only managers can reassign leads")
    if "stage" in upd:
        if upd["stage"] not in LEAD_STAGES:
            raise HTTPException(422, "Invalid stage")
        if upd["stage"] == "lost" and not (upd.get("lost_reason") or lead.get("lost_reason")):
            raise HTTPException(422, "A lost reason is required")
        if upd["stage"] == "won" and not await db.deals.find_one({"lead_id": lid, "stage": "won"}):
            raise HTTPException(422, "Close a deal for this lead to mark it won")
    if "marketing_consent" in upd:
        upd["consent"] = {"marketing": upd.pop("marketing_consent"), "recorded_at": now_iso()}
    upd["updated_at"] = now_iso()
    await db.leads.update_one({"id": lid}, {"$set": upd})
    if "stage" in upd and upd["stage"] != lead["stage"]:
        await add_activity(lid, "stage_change", f"Stage: {lead['stage']} → {upd['stage']}", user)
    if upd.get("assigned_to") and upd["assigned_to"] != lead.get("assigned_to"):
        await add_activity(lid, "assigned", "Lead reassigned", user)
        await notify([upd["assigned_to"]], f"Lead assigned to you: {lead['name']}", "", f"/erp/leads/{lid}",
                     dedupe=f"assign:{lid}:{upd['assigned_to']}")
    await audit(user, "lead_updated", "leads", lid, {k: v for k, v in upd.items() if k != "updated_at"})
    return {**lead, **upd}


@router.post("/leads/{lid}/activities")
async def add_lead_activity(lid: str, body: ActivityIn, user=Depends(require("leads", "w"))):
    lead = await get_scoped("leads", "leads", user, lid)
    await add_activity(lid, body.kind, body.notes, user, {"outcome": body.outcome})
    upd = {"updated_at": now_iso(), "last_contacted_at": now_iso(), "next_follow_up": body.next_follow_up}
    if lead["stage"] == "new" and body.kind in ("call", "whatsapp", "email", "meeting", "sms"):
        upd["stage"] = "contacted"
        await add_activity(lid, "stage_change", "Stage: new → contacted", user)
    await db.leads.update_one({"id": lid}, {"$set": upd})
    return {"ok": True}


@router.post("/leads/{lid}/site-visits")
async def schedule_visit(lid: str, body: VisitIn, user=Depends(require("leads", "w"))):
    lead = await get_scoped("leads", "leads", user, lid)
    prop = await db.properties.find_one({"id": body.property_id, "deleted": {"$ne": True}}, {"_id": 0, "id": 1, "title": 1, "code": 1})
    if not prop:
        raise HTTPException(404, "Property not found")
    v = {"id": new_id(), "lead_id": lid, "lead_name": lead["name"], "property_id": prop["id"],
         "property_title": prop["title"], "property_code": prop["code"], "scheduled_at": body.scheduled_at,
         "status": "scheduled", "notes": body.notes, "agent_id": lead.get("assigned_to") or user["id"],
         "created_at": now_iso()}
    await db.site_visits.insert_one(dict(v))
    stages = LEAD_STAGES
    if stages.index(lead["stage"]) < stages.index("site_visit"):
        await db.leads.update_one({"id": lid}, {"$set": {"stage": "site_visit", "updated_at": now_iso()}})
        await add_activity(lid, "stage_change", f"Stage: {lead['stage']} → site_visit", user)
    await add_activity(lid, "site_visit", f"Site visit scheduled at {prop['code']} for {body.scheduled_at}", user)
    await notify([v["agent_id"]], f"Site visit: {lead['name']}", f"{prop['title']} at {body.scheduled_at}",
                 f"/erp/leads/{lid}", dedupe=f"visit:{v['id']}")
    return v


@router.get("/site-visits")
async def list_visits(user=Depends(require("leads", "r"))):
    f = {"agent_id": user["id"]} if is_scoped(user, "leads") else {}
    return await db.site_visits.find(f, {"_id": 0}).sort("scheduled_at", -1).to_list(500)


@router.patch("/site-visits/{vid}")
async def update_visit(vid: str, body: VisitPatch, user=Depends(require("leads", "w"))):
    v = await db.site_visits.find_one({"id": vid}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Visit not found")
    lead = await get_scoped("leads", "leads", user, v["lead_id"])
    upd = {"status": body.status, "feedback": body.feedback, "updated_at": now_iso()}
    if body.status == "scheduled":
        when = body.scheduled_at or v.get("scheduled_at")
        if not when:
            raise HTTPException(422, "Choose a date and time for the visit")
        upd["scheduled_at"] = when
        upd["agent_id"] = v.get("agent_id") or lead.get("assigned_to") or user["id"]
        await notify([upd["agent_id"]], f"Site visit confirmed: {v['lead_name']}", f"{v['property_title']} at {when}",
                     f"/erp/leads/{v['lead_id']}", dedupe=f"visit:{vid}:{when}")
    await db.site_visits.update_one({"id": vid}, {"$set": upd})
    note = f"Visit {body.status}" + (f" for {upd.get('scheduled_at')}" if body.status == "scheduled" else "")
    await add_activity(v["lead_id"], "site_visit", f"{note}: {body.feedback or ''}".strip(": "), user)
    return {**v, **upd}


def _match_query(lead):
    tx = {"buy": "sale", "rent": "rent", "lease": "lease", "short_stay": "short_stay", "commercial": "lease"}.get(
        lead.get("interest"))
    f = {"status": {"$in": ["published", "ready_to_market", "under_offer"]}, "deleted": {"$ne": True}}
    if tx:
        f["transaction"] = tx
    if lead.get("budget_max"):
        f["$or"] = [{"price": {"$lte": float(lead["budget_max"]) * 1.1}}, {"price_on_request": True},
                    {"price": None}]
    return f


def _score(lead, p):
    score, why = 0, []
    locs = [x.strip().lower() for x in re.split(r"[,/;]", lead.get("preferred_locations") or "") if x.strip()]
    hay = f"{p.get('locality', '')} {p.get('city', '')} {p.get('pincode', '')}".lower()
    if locs and any(x in hay for x in locs):
        score += 3
        why.append("preferred location")
    price = p.get("price")
    bmin, bmax = lead.get("budget_min"), lead.get("budget_max")
    if price and bmax and price <= bmax and (not bmin or price >= bmin):
        score += 3
        why.append("within budget")
    elif price and bmax and price <= bmax * 1.1:
        score += 1
        why.append("just above budget")
    req = (lead.get("requirements") or "").lower()
    if p.get("bedrooms") and f"{p['bedrooms']} bhk" in req:
        score += 2
        why.append(f"{p['bedrooms']} BHK")
    if p.get("category") and p["category"].replace("_", " ") in req:
        score += 1
        why.append(p["category"].replace("_", " "))
    if p.get("status") == "published":
        score += 1
    return score, why


@router.get("/leads/{lid}/matches")
async def lead_matches(lid: str, user=Depends(require("leads", "r"))):
    """Listings that fit a lead's interest, budget and preferred locations, best first."""
    lead = await get_scoped("leads", "leads", user, lid)
    if not can(user, "properties", "r"):
        raise HTTPException(403, "You do not have permission for this action")
    props = await db.properties.find({**_match_query(lead), **scope(user, "properties")},
                                     {"_id": 0, "id": 1, "code": 1, "listing_id": 1, "title": 1, "locality": 1,
                                      "city": 1, "pincode": 1, "price": 1, "price_unit": 1, "price_on_request": 1,
                                      "bedrooms": 1, "category": 1, "transaction": 1, "status": 1, "images": 1,
                                      "built_area": 1, "plot_area": 1, "area_unit": 1}).to_list(500)
    out = []
    for p in props:
        s, why = _score(lead, p)
        out.append({**p, "score": s, "reasons": why})
    out.sort(key=lambda x: (-x["score"], x.get("price") or 0))
    shared = {a.get("property_id") for a in await db.lead_activities.find(
        {"lead_id": lid, "kind": "shared_listing"}, {"_id": 0, "property_id": 1}).to_list(500)}
    for p in out:
        p["shared"] = p["id"] in shared
    return out[:20]


@router.post("/leads/{lid}/share-listings")
async def share_listings(lid: str, body: dict, user=Depends(require("leads", "w"))):
    """Records which listings were sent to the customer (the message itself is sent from the user's WhatsApp)."""
    lead = await get_scoped("leads", "leads", user, lid)
    ids = [str(x) for x in (body.get("property_ids") or [])][:20]
    props = await db.properties.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "code": 1, "listing_id": 1}).to_list(20)
    for p in props:
        await add_activity(lid, "shared_listing", f"Shared listing {p.get('listing_id') or p['code']}", user,
                           {"property_id": p["id"]})
    if props and lead["stage"] in ("new", "contacted", "qualified", "requirements"):
        await db.leads.update_one({"id": lid}, {"$set": {"stage": "matched", "updated_at": now_iso()}})
        await add_activity(lid, "stage_change", f"Stage: {lead['stage']} → matched", user)
    return {"shared": len(props)}


@router.post("/leads/{lid}/anonymise")
async def anonymise_lead(lid: str, body: dict, user=Depends(require("leads", "a"))):
    """Data-protection request: removes the person's identity from the lead and its history, keeps the numbers."""
    lead = await get_scoped("leads", "leads", user, lid)
    if not body.get("confirm"):
        raise HTTPException(422, "Confirm that the customer asked for their data to be removed")
    await db.leads.update_one({"id": lid}, {"$set": {
        "name": "Anonymised contact", "phone": None, "email": None, "organization": None, "requirements": None,
        "preferred_locations": None, "contacts": [], "utm_source": None, "anonymised": True,
        "anonymised_at": now_iso(), "consent": {"marketing": False, "recorded_at": now_iso()},
        "stage": lead["stage"] if lead["stage"] in ("won", "lost") else "lost",
        "lost_reason": lead.get("lost_reason") or "data_removal_request", "updated_at": now_iso()}})
    await db.lead_activities.update_many({"lead_id": lid}, {"$set": {"notes": "[removed on request]", "outcome": None}})
    await db.site_visits.update_many({"lead_id": lid}, {"$set": {"lead_name": "Anonymised contact", "feedback": None,
                                                                 "notes": None}})
    await audit(user, "lead_anonymised", "leads", lid, {"code": lead["code"], "reason": body.get("reason")})
    return {"ok": True}


@router.post("/leads/{lid}/convert")
async def convert_lead(lid: str, body: ConvertIn, user=Depends(require("deals", "w"))):
    lead = await get_scoped("leads", "leads", user, lid)
    prop = await db.properties.find_one({"id": body.property_id, "deleted": {"$ne": True}, **scope(user, "properties")}, {"_id": 0})
    if not prop:
        raise HTTPException(404, "Property not found")
    owner = await db.owners.find_one({"id": prop.get("owner_id")}, {"_id": 0, "name": 1}) or {}
    from routes_deals import default_checklist
    deal = {"id": new_id(), "code": await next_code("deal", "SE-D-"), "title": f"{lead['name']} – {prop['title']}",
            "deal_type": body.deal_type, "lead_id": lid, "property_id": prop["id"], "property_title": prop["title"],
            "buyer_name": lead["name"], "buyer_phone": lead["phone"], "seller_name": owner.get("name"),
            "stage": "negotiation", "assigned_to": lead.get("assigned_to") or user["id"],
            "branch_id": lead.get("branch_id") or prop.get("branch_id"), "offers": [], "agreed_value": None,
            "commission": None, "expected_commission": 0, "checklist": default_checklist(body.deal_type),
            "history": [{"at": now_iso(), "by": user["name"], "event": "Deal created from lead"}],
            "created_at": now_iso(), "deleted": False}
    await db.deals.insert_one(dict(deal))
    await db.leads.update_one({"id": lid}, {"$set": {"stage": "negotiation", "updated_at": now_iso()}})
    await add_activity(lid, "stage_change", f"Converted to deal {deal['code']}", user)
    await audit(user, "deal_created", "deals", deal["id"])
    return deal
