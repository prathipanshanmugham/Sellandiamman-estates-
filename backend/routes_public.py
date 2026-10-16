import re
import os
from typing import Optional, List
from fastapi import APIRouter, Request, HTTPException, UploadFile, File, Form
from fastapi.responses import Response, FileResponse
from pydantic import BaseModel, Field
from core import (db, now_iso, new_id, next_code, normalize_phone, rate_limit, notify_roles, get_settings, audit,
                  save_upload, IMAGE_TYPES, UPLOAD_DIR)
from routes_crm import create_lead

router = APIRouter()
PUBLIC_FIELDS = ["listing_id", "title", "description_public", "category", "transaction", "city", "locality", "pincode",
                 "public_lat", "public_lng", "price", "price_unit", "price_on_request", "plot_area", "built_area",
                 "area_unit", "bedrooms", "bathrooms", "furnishing", "amenities", "availability", "occupancy", "images",
                 "featured", "published_at", "power_supply", "loading_access", "parking", "video_url", "max_guests",
                 "status"]
PROJ = {"_id": 0, **{f: 1 for f in PUBLIC_FIELDS}}
PUBLIC_SETTINGS = ["name", "phone", "whatsapp", "email", "address", "cities", "localities", "logo", "demo_mode",
                   "hero_title", "hero_subtitle", "seo_title", "seo_description", "testimonials", "office_hours"]
SORTS = {"latest": [("published_at", -1)], "price_asc": [("price", 1)], "price_desc": [("price", -1)],
         "area_desc": [("built_area", -1), ("plot_area", -1)]}


def base_filter():
    return {"status": {"$in": ["published", "under_offer"]}, "deleted": {"$ne": True}}


def public_view(p):
    p = {k: p.get(k) for k in PUBLIC_FIELDS if k in p}
    p["status"] = "Under offer" if p.get("status") == "under_offer" else "Available"
    return p


@router.get("/public/settings")
async def public_settings():
    s = await get_settings()
    return {k: s.get(k) for k in PUBLIC_SETTINGS}


@router.get("/public/properties")
async def search(transaction: Optional[str] = None, category: Optional[str] = None, city: Optional[str] = None,
                 locality: Optional[str] = None, pincode: Optional[str] = None, min_price: Optional[float] = None,
                 max_price: Optional[float] = None, bedrooms: Optional[int] = None, bathrooms: Optional[int] = None,
                 min_area: Optional[float] = None, max_area: Optional[float] = None, furnishing: Optional[str] = None,
                 feature: Optional[str] = None, q: Optional[str] = None, featured: Optional[bool] = None,
                 sort: str = "latest", page: int = 1, limit: int = 12):
    f = base_filter()
    if transaction:
        f["transaction"] = transaction
    if category:
        f["category"] = {"$in": category.split(",")[:10]}
    if city:
        f["city"] = city
    if locality:
        f["locality"] = {"$regex": re.escape(locality[:60]), "$options": "i"}
    if pincode:
        f["pincode"] = pincode[:6]
    if min_price is not None or max_price is not None:
        f["price"] = {k: v for k, v in (("$gte", min_price), ("$lte", max_price)) if v is not None}
    if bedrooms:
        f["bedrooms"] = {"$gte": bedrooms}
    if bathrooms:
        f["bathrooms"] = {"$gte": bathrooms}
    if min_area is not None or max_area is not None:
        rng = {k: v for k, v in (("$gte", min_area), ("$lte", max_area)) if v is not None}
        f["$or"] = [{"built_area": rng}, {"plot_area": rng}]
    if furnishing:
        f["furnishing"] = furnishing
    if feature:
        f["amenities"] = feature
    if featured is not None:
        f["featured"] = featured
    if q:
        rx = {"$regex": re.escape(q[:60]), "$options": "i"}
        f.setdefault("$and", []).append({"$or": [{"title": rx}, {"locality": rx}, {"city": rx}, {"listing_id": rx}]})
    limit = max(1, min(limit, 48))
    page = max(1, page)
    total = await db.properties.count_documents(f)
    items = await db.properties.find(f, PROJ).sort(SORTS.get(sort, SORTS["latest"])).skip((page - 1) * limit) \
        .limit(limit).to_list(limit)
    return {"items": [public_view(i) for i in items], "total": total, "page": page, "limit": limit}


@router.get("/public/properties/{listing_id}")
async def detail(listing_id: str):
    p = await db.properties.find_one({**base_filter(), "listing_id": listing_id}, PROJ)
    if not p:
        raise HTTPException(404, "Listing not found")
    sim = await db.properties.find({**base_filter(), "listing_id": {"$ne": listing_id},
                                    "$or": [{"category": p.get("category")}, {"city": p.get("city")}],
                                    "transaction": p.get("transaction")}, PROJ).limit(3).to_list(3)
    return {"property": public_view(p), "similar": [public_view(s) for s in sim]}


@router.get("/public/localities")
async def localities():
    rows = await db.properties.aggregate([{"$match": base_filter()},
                                          {"$group": {"_id": {"city": "$city", "locality": "$locality"}}}]).to_list(500)
    return sorted([r["_id"] for r in rows], key=lambda x: (x.get("city") or "", x.get("locality") or ""))


class EnquiryIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    phone: str = Field(min_length=10, max_length=20)
    email: Optional[str] = Field(None, max_length=120)
    message: Optional[str] = Field("", max_length=2000)
    listing_id: Optional[str] = Field(None, max_length=30)
    interest: str = Field("buy", pattern=r"^(buy|rent|lease|short_stay|sell|management|commercial|other)$")
    kind: str = Field("enquiry", pattern=r"^(enquiry|callback|management)$")
    preferred_contact: str = Field("phone", pattern=r"^(phone|whatsapp|email)$")
    preferred_time: Optional[str] = Field(None, max_length=60)
    consent: bool
    marketing_consent: bool = False
    website: Optional[str] = ""
    utm_source: Optional[str] = Field(None, max_length=60)
    utm_campaign: Optional[str] = Field(None, max_length=60)


@router.post("/public/enquiry")
async def enquiry(body: EnquiryIn, request: Request):
    rate_limit(request, "public_form", 8, 600)
    if body.website:
        return {"ok": True, "reference": "received"}
    if not body.consent:
        raise HTTPException(422, "Please accept the privacy policy to continue")
    phone = normalize_phone(body.phone)
    prop = None
    if body.listing_id:
        prop = await db.properties.find_one({**base_filter(), "listing_id": body.listing_id}, {"_id": 0})
    camp = None
    if body.utm_campaign:
        camp = await db.campaigns.find_one({"code": body.utm_campaign}, {"_id": 0, "id": 1})
    note = f"[{body.kind}] {body.message or ''}".strip()
    if body.preferred_time:
        note += f" | Preferred time: {body.preferred_time}"
    lead, dup = await create_lead({
        "name": body.name.strip(), "phone": phone, "email": body.email, "source": "website",
        "interest": body.interest, "customer_type": {"sell": "seller", "management": "landlord"}.get(body.interest, "buyer"),
        "property_id": prop["id"] if prop else None, "branch_id": prop.get("branch_id") if prop else None,
        "assigned_to": prop.get("assigned_agent") if prop else None, "requirements": body.message,
        "preferred_contact": body.preferred_contact, "marketing_consent": body.marketing_consent,
        "utm_source": body.utm_source, "campaign_id": camp["id"] if camp else None,
    }, None, note)
    await notify_roles(["super_admin", "director", "branch_manager"], f"New website {body.kind}: {body.name}",
                       note[:200], f"/erp/leads/{lead['id']}", dedupe=f"enq:{lead['id']}:{now_iso()[:16]}",
                       branch_id=lead.get("branch_id"))
    return {"ok": True, "reference": lead["code"]}


@router.post("/public/owner-submission")
async def owner_submission(
        request: Request, name: str = Form(..., min_length=2, max_length=100), phone: str = Form(...),
        email: Optional[str] = Form(None), preferred_contact: str = Form("phone"),
        city: str = Form(..., max_length=60), locality: str = Form(..., max_length=100),
        pincode: Optional[str] = Form(None), address: Optional[str] = Form(None, max_length=500),
        category: str = Form(...), transaction: str = Form(...), price: Optional[float] = Form(None),
        description: Optional[str] = Form(None, max_length=3000), services: Optional[str] = Form(None),
        declaration: bool = Form(...), website: Optional[str] = Form(""), photos: List[UploadFile] = File(default=[])):
    rate_limit(request, "owner_form", 4, 900)
    if website:
        return {"ok": True, "reference": "received"}
    if not declaration:
        raise HTTPException(422, "You must confirm you are the owner or authorised representative")
    if transaction not in ("sale", "rent", "lease", "short_stay"):
        raise HTTPException(422, "Invalid intention")
    if pincode and not re.fullmatch(r"\d{6}", pincode):
        raise HTTPException(422, "PIN code must be 6 digits")
    if len(photos) > 6:
        raise HTTPException(422, "Up to 6 photos allowed")
    phone_n = normalize_phone(phone)
    saved = [await save_upload(p, IMAGE_TYPES, 5 * 1024 * 1024) for p in photos if p.filename]
    owner = await db.owners.find_one({"phone": phone_n}, {"_id": 0})
    if not owner:
        owner = {"id": new_id(), "code": await next_code("owner", "SE-O-"), "name": name.strip(), "phone": phone_n,
                 "email": email, "preferred_contact": preferred_contact, "kind": "individual", "is_nri": False,
                 "source": "owner_submission", "created_at": now_iso(), "deleted": False}
        await db.owners.insert_one(dict(owner))
    pid = new_id()
    prop = {"id": pid, "code": await next_code("property", "SE-P-"), "title": f"{category.title()} in {locality}",
            "category": category, "transaction": transaction, "ownership_type": "third_party", "owner_id": owner["id"],
            "city": city, "locality": locality, "pincode": pincode, "internal_address": address, "price": price,
            "price_unit": "total" if transaction == "sale" else "per_month", "description_public": "",
            "owner_description": description, "requested_services": services, "status": "verification_pending",
            "source": "owner_submission", "images": [], "amenities": [], "verification": {"status": "pending"},
            "authorization": {}, "publication_history": [], "created_at": now_iso(), "updated_at": now_iso(),
            "deleted": False, "featured": False}
    await db.properties.insert_one(dict(prop))
    for s in saved:
        await db.documents.insert_one({"id": new_id(), **s, "entity_type": "property", "entity_id": pid,
                                       "doc_type": "photo", "version": 1, "is_latest": True, "public_approved": False,
                                       "uploaded_by": None, "created_at": now_iso()})
    lead, _ = await create_lead({"name": name.strip(), "phone": phone_n, "email": email, "source": "website",
                                 "interest": "sell" if transaction == "sale" else "management",
                                 "customer_type": "seller" if transaction == "sale" else "landlord",
                                 "property_id": pid, "requirements": description, "preferred_contact": preferred_contact},
                                None, f"Owner submitted property {prop['code']} for review")
    await audit(None, "owner_submission", "properties", pid, {"photos": len(saved)})
    await notify_roles(["super_admin", "director", "branch_manager"], f"Property submitted for verification: {prop['code']}",
                       f"{name} - {locality}, {city}", f"/erp/properties/{pid}", dedupe=f"sub:{pid}")
    return {"ok": True, "reference": prop["code"]}


@router.get("/public/media/{doc_id}")
async def media(doc_id: str):
    d = await db.documents.find_one({"id": doc_id, "public_approved": True}, {"_id": 0})
    if not d or not (UPLOAD_DIR / d["stored_name"]).exists():
        raise HTTPException(404, "Not found")
    return FileResponse(UPLOAD_DIR / d["stored_name"], media_type=d["content_type"],
                        headers={"Cache-Control": "public, max-age=86400"})


@router.get("/sitemap.xml")
async def sitemap():
    site = os.environ.get("SITE_URL", "")
    pages = ["", "/properties", "/services", "/list-property", "/about", "/contact", "/faq", "/legal/privacy",
             "/legal/terms", "/legal/disclaimer"]
    pages += [f"/services/{s}" for s in ("buy-sell", "rental-brokerage", "property-management", "nri-services",
                                          "short-stay", "commercial-industrial", "marketing-photography", "inspection-maintenance")]
    props = await db.properties.find(base_filter(), {"_id": 0, "listing_id": 1}).to_list(5000)
    pages += [f"/properties/{p['listing_id']}" for p in props if p.get("listing_id")]
    xml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    xml += "".join(f"<url><loc>{site}{p}</loc></url>" for p in pages) + "</urlset>"
    return Response(xml, media_type="application/xml")
