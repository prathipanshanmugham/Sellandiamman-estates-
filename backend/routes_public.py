import re
import os
import html
import json
from pathlib import Path
from typing import Optional, List
import httpx
from fastapi import APIRouter, Request, HTTPException, UploadFile, File, Form
from fastapi.responses import Response, FileResponse
from pydantic import BaseModel, Field
from core import (db, now_iso, new_id, next_code, normalize_phone, rate_limit, notify, notify_roles, get_settings,
                  audit, save_upload, client_ip, logger, IMAGE_TYPES, UPLOAD_DIR, SITE_URL, branch_for_place)
from routes_crm import create_lead, add_activity
from routes_props import CATEGORIES
from pdf import make_brochure, inr, inr_short

router = APIRouter()
PUBLIC_FIELDS = ["listing_id", "title", "description_public", "category", "transaction", "city", "locality", "pincode",
                 "public_lat", "public_lng", "price", "price_unit", "price_on_request", "plot_area", "built_area",
                 "area_unit", "bedrooms", "bathrooms", "furnishing", "amenities", "availability", "occupancy", "images",
                 "featured", "published_at", "power_supply", "loading_access", "parking", "video_url", "max_guests",
                 "status"]
PROJ = {"_id": 0, **{f: 1 for f in PUBLIC_FIELDS}}
PUBLIC_SETTINGS = ["name", "phone", "whatsapp", "email", "address", "cities", "localities", "logo", "demo_mode",
                   "hero_title", "hero_subtitle", "seo_title", "seo_description", "testimonials", "office_hours",
                   "social", "rera_no", "announcement", "map_center"]
TURNSTILE_SECRET = os.environ.get("TURNSTILE_SECRET", "")
# Website's /public folder, when it sits next to the backend (development); used for sample listing photos in brochures.
STATIC_DIR = Path(os.environ.get("STATIC_DIR") or (Path(__file__).resolve().parent.parent / "frontend" / "public"))
TURNSTILE_SITE_KEY = os.environ.get("TURNSTILE_SITE_KEY", "")


async def verify_human(request: Request, token: Optional[str]):
    """Optional Cloudflare Turnstile check (set TURNSTILE_SECRET + TURNSTILE_SITE_KEY). Honeypot + rate limits always apply."""
    if not TURNSTILE_SECRET:
        return
    if not token:
        raise HTTPException(422, "Please complete the 'I am human' check")
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.post("https://challenges.cloudflare.com/turnstile/v0/siteverify",
                             data={"secret": TURNSTILE_SECRET, "response": token, "remoteip": client_ip(request)})
            ok = r.json().get("success")
    except Exception:
        logger.exception("Turnstile verification failed; allowing request")
        return
    if not ok:
        raise HTTPException(422, "The 'I am human' check failed. Please try again.")
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
    from routes_cms import published
    s = await get_settings()
    site = await published()
    return {**{k: s.get(k) for k in PUBLIC_SETTINGS}, "turnstile_site_key": TURNSTILE_SITE_KEY or None,
            "site_url": SITE_URL or None, "announcement": site["announcement"], "testimonials": site["testimonials"],
            "hero_title": site["hero"]["title"], "hero_subtitle": site["hero"]["subtitle"],
            "seo_title": site["seo"]["title"], "seo_description": site["seo"]["description"],
            "footer_tagline": site["footer_tagline"]}


@router.get("/public/properties")
async def search(transaction: Optional[str] = None, category: Optional[str] = None, city: Optional[str] = None,
                 locality: Optional[str] = None, pincode: Optional[str] = None, min_price: Optional[float] = None,
                 max_price: Optional[float] = None, bedrooms: Optional[int] = None, bathrooms: Optional[int] = None,
                 min_area: Optional[float] = None, max_area: Optional[float] = None, furnishing: Optional[str] = None,
                 feature: Optional[str] = None, q: Optional[str] = None, featured: Optional[bool] = None,
                 ids: Optional[str] = None, sort: str = "latest", page: int = 1, limit: int = 12):
    f = base_filter()
    if ids:  # saved / compared listings
        f["listing_id"] = {"$in": [i.strip()[:30] for i in ids.split(",") if i.strip()][:50]}
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
    limit = max(1, min(limit, 200))
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
    kind: str = Field("enquiry", pattern=r"^(enquiry|callback|management|visit|requirement)$")
    preferred_contact: str = Field("phone", pattern=r"^(phone|whatsapp|email)$")
    preferred_time: Optional[str] = Field(None, max_length=60)
    preferred_date: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    preferred_slot: Optional[str] = Field(None, pattern=r"^(morning|afternoon|evening)$")
    budget_max: Optional[float] = Field(None, ge=0, le=1e11)
    preferred_locations: Optional[str] = Field(None, max_length=200)
    category: Optional[str] = Field(None, max_length=120)
    consent: bool
    marketing_consent: bool = False
    website: Optional[str] = ""
    cf_token: Optional[str] = Field(None, max_length=4000)
    utm_source: Optional[str] = Field(None, max_length=60)
    utm_campaign: Optional[str] = Field(None, max_length=60)


SLOT_TIME = {"morning": "10:00", "afternoon": "14:00", "evening": "17:00"}


@router.post("/public/enquiry")
async def enquiry(body: EnquiryIn, request: Request):
    rate_limit(request, "public_form", 8, 600)
    if body.website:
        return {"ok": True, "reference": "received"}
    if not body.consent:
        raise HTTPException(422, "Please accept the privacy policy to continue")
    await verify_human(request, body.cf_token)
    phone = normalize_phone(body.phone)
    prop = None
    if body.listing_id:
        prop = await db.properties.find_one({**base_filter(), "listing_id": body.listing_id}, {"_id": 0})
    if body.kind == "visit":
        if not prop:
            raise HTTPException(422, "Choose a listing to visit")
        if not body.preferred_date:
            raise HTTPException(422, "Choose a preferred date for the visit")
        from core import today_ist
        if body.preferred_date < today_ist().isoformat():
            raise HTTPException(422, "Choose a date from today onwards")
    camp = None
    if body.utm_campaign:
        camp = await db.campaigns.find_one({"code": body.utm_campaign}, {"_id": 0, "id": 1})
    note = f"[{body.kind}] {body.message}" if body.message else f"Website {body.kind}"
    if body.preferred_time:
        note += f" | Preferred time: {body.preferred_time}"
    if body.kind == "visit":
        note += f" | Visit requested for {body.preferred_date} ({body.preferred_slot or 'any time'})"
    if body.kind == "requirement":
        bits = [b for b in (body.category, body.preferred_locations,
                            f"budget up to {inr(body.budget_max)}" if body.budget_max else None) if b]
        if bits:
            note += " | " + ", ".join(bits)
    lead, dup = await create_lead({
        "name": body.name.strip(), "phone": phone, "email": body.email, "source": "website",
        "interest": body.interest, "customer_type": {"sell": "seller", "management": "landlord"}.get(body.interest, "buyer"),
        "property_id": prop["id"] if prop else None, "branch_id": prop.get("branch_id") if prop else None,
        "assigned_to": prop.get("assigned_agent") if prop else None,
        "requirements": " ".join(x for x in (body.category, body.message) if x) or None,
        "budget_max": body.budget_max, "preferred_locations": body.preferred_locations,
        "preferred_contact": body.preferred_contact, "marketing_consent": body.marketing_consent,
        "utm_source": body.utm_source, "campaign_id": camp["id"] if camp else None,
    }, None, note)
    if dup and (body.budget_max or body.preferred_locations):
        upd = {k: v for k, v in (("budget_max", body.budget_max), ("preferred_locations", body.preferred_locations)) if v}
        await db.leads.update_one({"id": lead["id"]}, {"$set": upd})
    if body.kind == "visit":
        when = f"{body.preferred_date}T{SLOT_TIME.get(body.preferred_slot or '', '11:00')}"
        v = {"id": new_id(), "lead_id": lead["id"], "lead_name": lead["name"], "property_id": prop["id"],
             "property_title": prop["title"], "property_code": prop["code"], "scheduled_at": when,
             "preferred_slot": body.preferred_slot, "status": "requested", "notes": body.message,
             "agent_id": prop.get("assigned_agent") or lead.get("assigned_to"), "source": "website",
             "branch_id": lead.get("branch_id"), "created_at": now_iso()}
        await db.site_visits.insert_one(dict(v))
        await add_activity(lead["id"], "site_visit", f"Visit requested on the website for {when} at {prop['code']}")
        if v["agent_id"]:
            await notify([v["agent_id"]], f"Visit request: {lead['name']}", f"{prop['title']} · {when}",
                         f"/erp/leads/{lead['id']}", dedupe=f"vreq:{v['id']}")
    title = {"visit": "Site visit request", "requirement": "New requirement"}.get(body.kind, f"New website {body.kind}")
    await notify_roles(["super_admin", "director", "branch_manager"], f"{title}: {body.name}",
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
        declaration: bool = Form(...), website: Optional[str] = Form(""), cf_token: Optional[str] = Form(None),
        lat: Optional[float] = Form(None), lng: Optional[float] = Form(None), accuracy_m: Optional[float] = Form(None),
        location_source: Optional[str] = Form(None, max_length=20),
        photos: List[UploadFile] = File(default=[])):
    rate_limit(request, "owner_form", 4, 900)
    if website:
        return {"ok": True, "reference": "received"}
    await verify_human(request, cf_token)
    if not declaration:
        raise HTTPException(422, "You must confirm you are the owner or authorised representative")
    if transaction not in ("sale", "rent", "lease", "short_stay"):
        raise HTTPException(422, "Invalid intention")
    if category not in CATEGORIES:
        raise HTTPException(422, "Invalid property category")
    if pincode and not re.fullmatch(r"\d{6}", pincode):
        raise HTTPException(422, "PIN code must be 6 digits")
    if len(photos) > 6:
        raise HTTPException(422, "Up to 6 photos allowed")
    phone_n = normalize_phone(phone)
    city, locality = city.strip(), locality.strip()
    from routes_props import geo_fields
    geo = geo_fields({"lat": lat, "lng": lng, "accuracy_m": accuracy_m,
                      "source": "owner_gps" if location_source == "gps" else "owner_pin", "captured_by": f"Owner ({name.strip()[:60]})"},
                     "approximate") if lat is not None and lng is not None else {}
    saved = [await save_upload(p, IMAGE_TYPES, 5 * 1024 * 1024) for p in photos if p.filename]
    owner = await db.owners.find_one({"phone": phone_n}, {"_id": 0})
    owner_match = bool(owner)
    if not owner:
        owner = {"id": new_id(), "code": await next_code("owner", "SE-O-"), "name": name.strip(), "phone": phone_n,
                 "email": email, "preferred_contact": preferred_contact, "kind": "individual", "is_nri": False,
                 "source": "owner_submission", "created_at": now_iso(), "deleted": False}
        await db.owners.insert_one(dict(owner))
    from routes_customers import link_customer
    await link_customer("owners", owner["id"], {"name": owner["name"], "phone": phone_n, "email": email,
                                                "types": ["owner", "landlord"], "source": "website", "city": city})
    branch_id = await branch_for_place(city, locality)
    # an owner's new locality is added for staff to review before it shows on the website
    if await db.locations.find_one({"kind": "city", "name": {"$regex": f"^{re.escape(city)}$", "$options": "i"}}):
        from routes_branches import ensure_place
        await ensure_place(city, locality, pincode, (geo.get("geo") or {}).get("lat"), (geo.get("geo") or {}).get("lng"),
                           branch_id, "owner_submission", active=False)
    pid = new_id()
    prop = {"id": pid, "code": await next_code("property", "SE-P-"), "title": f"{category.title()} in {locality}",
            "category": category, "transaction": transaction, "ownership_type": "third_party", "owner_id": owner["id"],
            "city": city, "locality": locality, "pincode": pincode, "internal_address": address, "price": price,
            "price_unit": "total" if transaction == "sale" else "per_month", "description_public": "",
            "owner_description": description, "requested_services": services, "status": "verification_pending",
            "source": "owner_submission", "images": [], "amenities": [], "verification": {"status": "pending"},
            "owner_match_unverified": owner_match, "submitted_name": name.strip(), "branch_id": branch_id,
            "authorization": {}, "publication_history": [], "created_at": now_iso(), "updated_at": now_iso(),
            "deleted": False, "featured": False, "location_public": "approximate", **geo}
    await db.properties.insert_one(dict(prop))
    for s in saved:
        await db.documents.insert_one({"id": new_id(), **s, "entity_type": "property", "entity_id": pid,
                                       "doc_type": "photo", "version": 1, "is_latest": True, "public_approved": False,
                                       "uploaded_by": None, "created_at": now_iso()})
    lead, _ = await create_lead({"name": name.strip(), "phone": phone_n, "email": email, "source": "website",
                                 "interest": "sell" if transaction == "sale" else "management",
                                 "customer_type": "seller" if transaction == "sale" else "landlord", "branch_id": branch_id,
                                 "property_id": pid, "requirements": description, "preferred_contact": preferred_contact},
                                None, f"Owner submitted property {prop['code']} for review")
    await audit(None, "owner_submission", "properties", pid, {"photos": len(saved), "location": bool(geo)})
    await notify_roles(["super_admin", "director", "branch_manager"], f"Property submitted for verification: {prop['code']}",
                       f"{name} - {locality}, {city}", f"/erp/properties/{pid}", dedupe=f"sub:{pid}", branch_id=branch_id)
    return {"ok": True, "reference": prop["code"]}


@router.get("/public/media/{doc_id}")
async def media(doc_id: str):
    d = await db.documents.find_one({"id": doc_id, "public_approved": True}, {"_id": 0})
    if not d or not (UPLOAD_DIR / d["stored_name"]).exists():
        raise HTTPException(404, "Not found")
    return FileResponse(UPLOAD_DIR / d["stored_name"], media_type=d["content_type"],
                        headers={"Cache-Control": "public, max-age=86400"})


@router.get("/public/properties/{listing_id}/brochure.pdf")
async def brochure(listing_id: str, request: Request):
    rate_limit(request, "brochure", 30, 300)
    p = await db.properties.find_one({**base_filter(), "listing_id": listing_id}, PROJ)
    if not p:
        raise HTTPException(404, "Listing not found")
    image_path = None
    for u in p.get("images") or []:
        m = re.match(r"^/api/public/media/([\w-]+)$", u or "")
        if m:
            d = await db.documents.find_one({"id": m.group(1), "public_approved": True}, {"_id": 0})
            if d and (UPLOAD_DIR / d["stored_name"]).exists():
                image_path = UPLOAD_DIR / d["stored_name"]
                break
        elif re.match(r"^/images/[\w.-]+\.(jpg|jpeg|png|webp)$", u or "") and (STATIC_DIR / u.lstrip("/")).exists():
            image_path = STATIC_DIR / u.lstrip("/")  # sample photos shipped with the website (development and preview)
            break
    unit = {"per_month": " / month", "per_night": " / night", "per_sqft": " / sq.ft", "per_acre": " / acre",
            "per_cent": " / cent"}.get(p.get("price_unit"), "")
    price = "Price on request" if p.get("price_on_request") or not p.get("price") else f"{inr(p['price']).removesuffix('.00')}{unit}"
    lab = lambda v: str(v).replace("_", " ").title() if v else None  # noqa: E731
    facts = [("Type", lab(p.get("category"))), ("For", lab(p.get("transaction"))),
             ("Built-up", p.get("built_area") and f"{p['built_area']:,.0f} {p.get('area_unit')}"),
             ("Plot / land", p.get("plot_area") and f"{p['plot_area']:,.2f}".rstrip("0").rstrip(".") + f" {p.get('area_unit')}"),
             ("Bedrooms", p.get("bedrooms")), ("Bathrooms", p.get("bathrooms")), ("Furnishing", lab(p.get("furnishing"))),
             ("Availability", p.get("availability")), ("Power", p.get("power_supply")),
             ("Loading", p.get("loading_access")), ("Parking", p.get("parking")), ("PIN code", p.get("pincode"))]
    base = SITE_URL or str(request.base_url).rstrip("/")
    pdf = make_brochure(p, await get_settings(), f"{base}/properties/{listing_id}", image_path, facts, price)
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename={listing_id}-brochure.pdf",
                             "Cache-Control": "public, max-age=600"})


# ---------- Link previews for shared links (WhatsApp, Facebook, LinkedIn read these tags; they do not run JavaScript) ----------
def _preview_html(title, description, image, url):
    e = lambda v: html.escape(str(v or ""), quote=True)  # noqa: E731
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{e(title)}</title>'
            f'<meta name="viewport" content="width=device-width, initial-scale=1">'
            f'<meta property="og:type" content="website"><meta property="og:site_name" content="Sellandiamman Estates">'
            f'<meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(description)}">'
            f'<meta property="og:image" content="{e(image)}"><meta property="og:url" content="{e(url)}">'
            f'<meta name="twitter:card" content="summary_large_image"><link rel="canonical" href="{e(url)}">'
            f'<meta http-equiv="refresh" content="0;url={e(url)}"></head>'
            f'<body><p><a href="{e(url)}">{e(title)}</a></p><script>location.replace({json.dumps(url)})</script></body></html>')


def _abs(u, base):
    if not u:
        return f"{base}/og-image.jpg"
    return u if u.startswith("http") else f"{base}{u}"


@router.get("/share/p/{listing_id}")
async def share_property(listing_id: str, request: Request):
    base = SITE_URL or str(request.base_url).rstrip("/")
    p = await db.properties.find_one({**base_filter(), "listing_id": listing_id}, PROJ)
    if not p:
        return Response(_preview_html("Sellandiamman Estates", "Properties in Erode and Perundurai", f"{base}/og-image.jpg",
                                      f"{base}/properties"), media_type="text/html")
    unit = {"per_month": "/month", "per_night": "/night"}.get(p.get("price_unit"), "")
    price = "Price on request" if p.get("price_on_request") or not p.get("price") else f"{inr_short(p['price'])}{unit}"
    desc = f"{price} · {p.get('locality')}, {p.get('city')}. {(p.get('description_public') or '')[:150]}"
    return Response(_preview_html(f"{p['title']} – {price}", desc, _abs((p.get("images") or [None])[0], base),
                                  f"{base}/properties/{listing_id}"), media_type="text/html",
                    headers={"Cache-Control": "public, max-age=600"})


@router.get("/share/i/{slug}")
async def share_post(slug: str, request: Request):
    base = SITE_URL or str(request.base_url).rstrip("/")
    p = await db.posts.find_one({"slug": slug, "status": "published", "deleted": {"$ne": True}}, {"_id": 0})
    if not p:
        return Response(_preview_html("Insights | Sellandiamman Estates", "Guides and market notes", f"{base}/og-image.jpg",
                                      f"{base}/insights"), media_type="text/html")
    return Response(_preview_html(p["title"], p.get("excerpt") or "", _abs(p.get("cover_image"), base), f"{base}/insights/{slug}"),
                    media_type="text/html", headers={"Cache-Control": "public, max-age=600"})
