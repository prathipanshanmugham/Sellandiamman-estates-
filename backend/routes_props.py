import re
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from core import (db, now_iso, new_id, next_code, normalize_phone, require, can, scope, is_scoped, get_scoped,
                  audit, today_ist)
from logic import can_transition

router = APIRouter()
CATEGORIES = ["residential", "apartment", "villa", "land", "agricultural", "commercial", "shop", "office",
              "industrial", "warehouse", "factory_shed", "other"]
EDITABLE = ["title", "category", "transaction", "ownership_type", "owner_id", "branch_id", "city", "locality",
            "pincode", "internal_address", "public_lat", "public_lng", "survey_no", "plot_area", "built_area",
            "area_unit", "bedrooms", "bathrooms", "furnishing", "amenities", "price", "price_unit", "price_on_request",
            "negotiated_terms", "description_public", "notes_internal", "images", "availability", "occupancy",
            "assigned_agent", "assigned_manager", "source", "service_type", "power_supply", "loading_access",
            "parking", "checkin_instructions", "video_url", "mgmt_fee_pct", "nightly_rate", "max_guests",
            "service_agreement"]
RESTRICTED_FOR_MARKETING = ["internal_address", "notes_internal", "survey_no", "checkin_instructions",
                            "negotiated_terms", "service_agreement", "owner_id"]


class PropertyIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    category: str
    transaction: str = Field(pattern=r"^(sale|rent|lease|short_stay)$")
    ownership_type: str = Field("third_party", pattern=r"^(third_party|company)$")
    owner_id: Optional[str] = None
    branch_id: Optional[str] = None
    city: str = Field(min_length=2, max_length=60)
    locality: str = Field(min_length=2, max_length=100)
    pincode: Optional[str] = Field(None, pattern=r"^\d{6}$")
    internal_address: Optional[str] = None
    public_lat: Optional[float] = None
    public_lng: Optional[float] = None
    survey_no: Optional[str] = None
    plot_area: Optional[float] = Field(None, ge=0)
    built_area: Optional[float] = Field(None, ge=0)
    area_unit: str = "sq.ft"
    bedrooms: Optional[int] = Field(None, ge=0, le=50)
    bathrooms: Optional[int] = Field(None, ge=0, le=50)
    furnishing: Optional[str] = None
    amenities: List[str] = []
    price: Optional[float] = Field(None, ge=0)
    price_unit: str = Field("total", pattern=r"^(total|per_month|per_night|per_sqft|per_acre|per_cent)$")
    price_on_request: bool = False
    negotiated_terms: Optional[str] = None
    description_public: Optional[str] = None
    notes_internal: Optional[str] = None
    images: List[str] = []
    availability: Optional[str] = "Immediate"
    occupancy: Optional[str] = "vacant"
    assigned_agent: Optional[str] = None
    assigned_manager: Optional[str] = None
    source: Optional[str] = "direct"
    service_type: str = Field("brokerage", pattern=r"^(brokerage|management|short_stay)$")
    power_supply: Optional[str] = None
    loading_access: Optional[str] = None
    parking: Optional[str] = None
    checkin_instructions: Optional[str] = None
    video_url: Optional[str] = None
    mgmt_fee_pct: Optional[float] = Field(None, ge=0, le=100)
    nightly_rate: Optional[float] = Field(None, ge=0)
    max_guests: Optional[int] = Field(None, ge=0)
    service_agreement: Optional[str] = None
    force: bool = False


class TransitionIn(BaseModel):
    to: str
    notes: Optional[str] = None
    closed_as: Optional[str] = Field(None, pattern=r"^(sold|rented|leased)$")


class VerifyIn(BaseModel):
    ownership_verified: bool
    authorization_signed: bool
    marketing_authorized: bool
    authorization_expiry: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    notes: Optional[str] = Field(None, max_length=2000)


class OwnerIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str
    email: Optional[str] = None
    kind: str = Field("individual", pattern=r"^(individual|company|trust|other)$")
    is_nri: bool = False
    address: Optional[str] = None
    preferred_contact: str = "phone"
    representative_name: Optional[str] = None
    representative_phone: Optional[str] = None
    notes: Optional[str] = None


def view_for(user, p):
    if not can(user, "shortstay", "r"):
        p.pop("checkin_instructions", None)
    if user["role"] == "marketing":
        for k in RESTRICTED_FOR_MARKETING:
            p.pop(k, None)
    return p


@router.get("/properties")
async def list_props(status: Optional[str] = None, category: Optional[str] = None, transaction: Optional[str] = None,
                     q: Optional[str] = None, service_type: Optional[str] = None, owner_id: Optional[str] = None,
                     user=Depends(require("properties", "r"))):
    f = {"deleted": {"$ne": True}, **scope(user, "properties")}
    for k, v in (("status", status), ("category", category), ("transaction", transaction),
                 ("service_type", service_type), ("owner_id", owner_id)):
        if v:
            f[k] = v
    if q:
        rx = {"$regex": re.escape(q[:60]), "$options": "i"}
        f["$or"] = [{"title": rx}, {"code": rx}, {"listing_id": rx}, {"locality": rx}]
    rows = await db.properties.find(f, {"_id": 0, "publication_history": 0}).sort("created_at", -1).to_list(2000)
    return [view_for(user, r) for r in rows]


@router.post("/properties")
async def create_prop(body: PropertyIn, user=Depends(require("properties", "w"))):
    if body.category not in CATEGORIES:
        raise HTTPException(422, "Invalid category")
    data = body.model_dump()
    force = data.pop("force")
    if not force:
        dupq = []
        if body.survey_no:
            dupq.append({"survey_no": body.survey_no, "city": body.city})
        if body.internal_address:
            dupq.append({"internal_address": {"$regex": f"^{re.escape(body.internal_address.strip())}$", "$options": "i"}})
        if dupq:
            d = await db.properties.find_one({"$or": dupq, "deleted": {"$ne": True}}, {"_id": 0, "code": 1})
            if d:
                raise HTTPException(409, f"Possible duplicate of property {d['code']}")
    if is_scoped(user, "properties"):
        data["assigned_agent"] = user["id"]
    if not data.get("branch_id") and user.get("branch_ids"):
        data["branch_id"] = user["branch_ids"][0]
    if not data.get("branch_id"):
        data["branch_id"] = {"erode": "br-erode", "perundurai": "br-perundurai"}.get(body.city.strip().lower())
    p = {"id": new_id(), "code": await next_code("property", "SE-P-"), **data, "status": "draft",
         "verification": {"status": "not_started"}, "authorization": {}, "publication_history": [],
         "featured": False, "listing_id": None, "created_by": user["id"], "created_at": now_iso(),
         "updated_at": now_iso(), "deleted": False}
    await db.properties.insert_one(dict(p))
    await audit(user, "property_created", "properties", p["id"])
    return p


@router.get("/properties/{pid}")
async def get_prop(pid: str, user=Depends(require("properties", "r"))):
    p = await get_scoped("properties", "properties", user, pid)
    p["verifications"] = await db.verifications.find({"property_id": pid}, {"_id": 0}).sort("at", -1).to_list(50)
    if can(user, "owners", "r") and p.get("owner_id"):
        p["owner"] = await db.owners.find_one({"id": p["owner_id"]}, {"_id": 0})
    if can(user, "leases", "r"):
        p["leases"] = await db.leases.find({"property_id": pid}, {"_id": 0, "schedule": 0}).to_list(50)
    return view_for(user, p)


@router.patch("/properties/{pid}")
async def update_prop(pid: str, body: dict, user=Depends(require("properties", "w"))):
    p = await get_scoped("properties", "properties", user, pid)
    upd = {k: v for k, v in body.items() if k in EDITABLE}
    if is_scoped(user, "properties"):
        upd.pop("assigned_agent", None)
    if "category" in upd and upd["category"] not in CATEGORIES:
        raise HTTPException(422, "Invalid category")
    if "pincode" in upd and upd["pincode"] and not re.fullmatch(r"\d{6}", str(upd["pincode"])):
        raise HTTPException(422, "PIN code must be 6 digits")
    for k in ("price", "plot_area", "built_area", "mgmt_fee_pct", "nightly_rate"):
        if upd.get(k) not in (None, "") and float(upd[k]) < 0:
            raise HTTPException(422, f"{k} cannot be negative")
    upd["updated_at"] = now_iso()
    await db.properties.update_one({"id": pid}, {"$set": upd})
    await audit(user, "property_updated", "properties", pid, {k: v for k, v in upd.items() if k != "updated_at"})
    return view_for(user, {**p, **upd})


@router.post("/properties/{pid}/transition")
async def transition(pid: str, body: TransitionIn, user=Depends(require("properties", "w"))):
    p = await get_scoped("properties", "properties", user, pid)
    cur, to = p["status"], body.to
    if to == "verified":
        raise HTTPException(422, "Use the verification action to verify a property")
    if not can_transition(cur, to):
        raise HTTPException(422, f"Cannot move from {cur} to {to}")
    upd = {"status": to, "updated_at": now_iso()}
    hist = None
    if to == "published":
        if not can(user, "properties", "p"):
            raise HTTPException(403, "You are not authorised to publish listings")
        v, a = p.get("verification") or {}, p.get("authorization") or {}
        if v.get("status") != "verified":
            raise HTTPException(422, "Ownership verification is required before publishing")
        if not a.get("marketing_authorized") or not a.get("expiry") or a["expiry"] < today_ist().isoformat():
            raise HTTPException(422, "A valid, unexpired marketing authorisation is required before publishing")
        if not p.get("description_public") or not p.get("title"):
            raise HTTPException(422, "Public title and description are required before publishing")
        if not p.get("listing_id"):
            upd["listing_id"] = await next_code("listing", "SEL-", 5)
        upd["published_at"] = now_iso()
        hist = {"at": now_iso(), "by": user["name"], "action": "published", "notes": body.notes}
    elif cur == "published":
        hist = {"at": now_iso(), "by": user["name"], "action": f"unpublished ({to})", "notes": body.notes}
    if to == "closed":
        upd["closed_as"] = body.closed_as or {"sale": "sold", "rent": "rented"}.get(p.get("transaction"), "leased")
    update = {"$set": upd}
    if hist:
        update["$push"] = {"publication_history": hist}
    await db.properties.update_one({"id": pid}, update)
    await audit(user, "property_status", "properties", pid, {"from": cur, "to": to, "notes": body.notes})
    return {**p, **upd}


@router.post("/properties/{pid}/verify")
async def verify(pid: str, body: VerifyIn, user=Depends(require("properties", "a"))):
    p = await get_scoped("properties", "properties", user, pid)
    if p["status"] not in ("verification_pending", "verified", "ready_to_market", "published"):
        raise HTTPException(422, "Submit the property for verification first")
    ok = body.ownership_verified and body.authorization_signed and body.authorization_expiry >= today_ist().isoformat()
    rec = {"id": new_id(), "property_id": pid, **body.model_dump(), "result": "verified" if ok else "rejected",
           "by": user["id"], "by_name": user["name"], "at": now_iso()}
    await db.verifications.insert_one(dict(rec))
    upd = {"verification": {"status": "verified" if ok else "rejected", "by": user["name"], "at": now_iso(),
                            "notes": body.notes},
           "authorization": {"signed": body.authorization_signed, "marketing_authorized": body.marketing_authorized,
                             "expiry": body.authorization_expiry}, "updated_at": now_iso()}
    if ok and p["status"] == "verification_pending":
        upd["status"] = "verified"
    await db.properties.update_one({"id": pid}, {"$set": upd})
    await audit(user, "property_verification", "properties", pid, {"result": rec["result"]})
    return {**p, **upd, "verification_result": rec["result"]}


@router.patch("/properties/{pid}/featured")
async def featured(pid: str, body: dict, user=Depends(require("cms", "w"))):
    p = await db.properties.find_one({"id": pid}, {"_id": 0, "id": 1})
    if not p:
        raise HTTPException(404, "Record not found")
    await db.properties.update_one({"id": pid}, {"$set": {"featured": bool(body.get("featured"))}})
    await audit(user, "property_featured", "properties", pid, {"featured": bool(body.get("featured"))})
    return {"ok": True}


@router.get("/owners")
async def list_owners(q: Optional[str] = None, user=Depends(require("owners", "r"))):
    f = {"deleted": {"$ne": True}}
    if q:
        rx = {"$regex": re.escape(q[:60]), "$options": "i"}
        f["$or"] = [{"name": rx}, {"phone": rx}, {"code": rx}]
    return await db.owners.find(f, {"_id": 0}).sort("created_at", -1).to_list(2000)


@router.post("/owners")
async def create_owner(body: OwnerIn, user=Depends(require("owners", "w"))):
    data = body.model_dump()
    data["phone"] = normalize_phone(data["phone"])
    if await db.owners.find_one({"phone": data["phone"], "deleted": {"$ne": True}}):
        raise HTTPException(409, "An owner with this phone already exists")
    o = {"id": new_id(), "code": await next_code("owner", "SE-O-"), **data, "created_at": now_iso(), "deleted": False}
    await db.owners.insert_one(dict(o))
    await audit(user, "owner_created", "owners", o["id"])
    return o


@router.get("/owners/{oid}")
async def get_owner(oid: str, user=Depends(require("owners", "r"))):
    o = await db.owners.find_one({"id": oid, "deleted": {"$ne": True}}, {"_id": 0})
    if not o:
        raise HTTPException(404, "Record not found")
    o["properties"] = await db.properties.find({"owner_id": oid, "deleted": {"$ne": True}},
                                               {"_id": 0, "id": 1, "code": 1, "title": 1, "status": 1}).to_list(200)
    o["statements"] = await db.owner_statements.find({"owner_id": oid}, {"_id": 0}).sort("month", -1).to_list(60)
    return o


@router.patch("/owners/{oid}")
async def update_owner(oid: str, body: dict, user=Depends(require("owners", "w"))):
    allowed = ["name", "email", "kind", "is_nri", "address", "preferred_contact", "representative_name",
               "representative_phone", "notes"]
    upd = {k: v for k, v in body.items() if k in allowed}
    r = await db.owners.update_one({"id": oid}, {"$set": upd})
    if not r.matched_count:
        raise HTTPException(404, "Record not found")
    await audit(user, "owner_updated", "owners", oid, upd)
    return {"ok": True}
