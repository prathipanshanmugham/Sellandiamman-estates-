"""Customer data management: one record per person or business across leads, owners, tenants, short-stay guests and
investors (matched by mobile number), with consent, KYC status, tags, a 360° timeline, duplicate merge, import/export
and data-protection requests (access and erasure) under the DPDP Act, 2023."""
import csv
import io
import json
import re
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel, Field
from core import (db, now_iso, new_id, next_code, normalize_phone, require, can, scope, is_scoped, audit,
                  home_branch, check_branch, head_office_id, today_ist)

router = APIRouter()
TYPES = ["buyer", "seller", "tenant", "landlord", "owner", "guest", "investor", "business"]
LANGS = ["english", "tamil", "hindi", "malayalam", "telugu", "kannada", "other"]
LIST_FIELDS = {"_id": 0, "consent_history": 0, "notes_log": 0}
LEAD_TYPE = {"buyer": "buyer", "seller": "seller", "tenant": "tenant", "landlord": "landlord", "investor": "investor",
             "business": "business"}


def _norm_phone(p):
    try:
        return normalize_phone(p) if p else None
    except HTTPException:
        return None


async def upsert_customer(data, user=None):
    """Finds the customer by mobile (or email) and adds the new role; creates them when new. Returns the record."""
    phone = _norm_phone(data.get("phone"))
    email = (data.get("email") or "").strip().lower() or None
    types = [t for t in (data.get("types") or []) if t in TYPES]
    q = None
    if phone:
        q = {"$or": [{"phone": phone}, {"alt_phone": phone}]}
    elif email:
        q = {"email": email}
    c = await db.customers.find_one({**q, "merged_into": None, "deleted": {"$ne": True}}, {"_id": 0}) if q else None
    if c:
        upd = {"last_activity_at": now_iso(), "updated_at": now_iso()}
        for k in ("email", "city", "locality", "organization", "branch_id", "rm_id"):
            if data.get(k) and not c.get(k):
                upd[k] = data[k] if k != "email" else email
        op = {"$set": upd}
        if types:
            op["$addToSet"] = {"types": {"$each": types}}
        await db.customers.update_one({"id": c["id"]}, op)
        return {**c, **upd, "types": sorted(set((c.get("types") or []) + types))}
    if not phone and not email:
        return None
    consent = bool(data.get("marketing_consent"))
    c = {"id": new_id(), "code": await next_code("customer", "SE-C-", 5), "name": (data.get("name") or "Customer").strip()[:120],
         "phone": phone, "alt_phone": None, "email": email, "kind": data.get("kind") or ("business" if "business" in types else "individual"),
         "organization": data.get("organization"), "types": types, "tags": data.get("tags") or [], "city": data.get("city"),
         "locality": data.get("locality"), "address": data.get("address"), "language": data.get("language") or "english",
         "preferred_contact": data.get("preferred_contact") or "phone", "source": data.get("source") or "direct",
         "branch_id": data.get("branch_id") or (home_branch(user) if user else None) or await head_office_id(),
         "rm_id": data.get("rm_id") or (user["id"] if user and user.get("role") == "sales_agent" else None),
         "consent": {"marketing": consent, "whatsapp": consent, "recorded_at": now_iso(), "method": data.get("consent_method") or data.get("source") or "form"},
         "consent_history": [{"at": now_iso(), "marketing": consent, "whatsapp": consent, "by": user["name"] if user else "Website", "method": data.get("source") or "form"}],
         "kyc": {"status": "not_started"}, "notes": data.get("notes"), "gstin": data.get("gstin"), "pan_last4": None,
         "created_at": now_iso(), "updated_at": now_iso(), "last_activity_at": now_iso(), "merged_into": None,
         "anonymised": False, "deleted": False, "created_by": user["id"] if user else None}
    await db.customers.insert_one(dict(c))
    return c


async def link_customer(coll, rid, data, user=None):
    """Upserts the customer and stores customer_id on the record (lead, owner, lease, booking, investor)."""
    c = await upsert_customer(data, user)
    if c:
        await db[coll].update_one({"id": rid}, {"$set": {"customer_id": c["id"]}})
    return c


class CustomerIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str
    alt_phone: Optional[str] = None
    email: Optional[str] = Field(None, max_length=120)
    kind: str = Field("individual", pattern=r"^(individual|business)$")
    organization: Optional[str] = Field(None, max_length=120)
    types: List[str] = []
    tags: List[str] = []
    city: Optional[str] = Field(None, max_length=60)
    locality: Optional[str] = Field(None, max_length=80)
    address: Optional[str] = Field(None, max_length=400)
    language: str = "english"
    preferred_contact: str = Field("phone", pattern=r"^(phone|whatsapp|email)$")
    source: str = "direct"
    gstin: Optional[str] = Field(None, max_length=15)
    notes: Optional[str] = Field(None, max_length=3000)
    marketing_consent: bool = False
    rm_id: Optional[str] = None
    branch_id: Optional[str] = None
    force: bool = False


def _clean_tags(tags):
    return sorted({re.sub(r"\s+", " ", str(t)).strip().lower()[:30] for t in (tags or []) if str(t).strip()})[:15]


async def _get(user, cid):
    c = await db.customers.find_one({"id": cid, "deleted": {"$ne": True}, **scope(user, "customers")}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Customer not found")
    return c


def _filters(user, q=None, type=None, tag=None, city=None, consent=None, kyc=None, inactive_days=None):
    f = {"deleted": {"$ne": True}, "merged_into": None, **scope(user, "customers")}
    if q:
        rx = {"$regex": re.escape(q[:60]), "$options": "i"}
        f["$or"] = [{"name": rx}, {"phone": rx}, {"email": rx}, {"code": rx}, {"organization": rx}]
    if type:
        f["types"] = type
    if tag:
        f["tags"] = tag.lower()
    if city:
        f["city"] = {"$regex": f"^{re.escape(city)}$", "$options": "i"}
    if consent == "marketing":
        f["consent.marketing"] = True
    elif consent == "whatsapp":
        f["consent.whatsapp"] = True
    elif consent == "none":
        f["consent.marketing"] = {"$ne": True}
    if kyc:
        f["kyc.status"] = kyc
    if inactive_days:
        from datetime import datetime, timedelta, timezone
        f["last_activity_at"] = {"$lt": (datetime.now(timezone.utc) - timedelta(days=int(inactive_days))).isoformat()}
    return f


@router.get("/customers")
async def list_customers(q: Optional[str] = None, type: Optional[str] = None, tag: Optional[str] = None,
                        city: Optional[str] = None, consent: Optional[str] = None, kyc: Optional[str] = None,
                        inactive_days: Optional[int] = None, sort: str = "recent", page: int = 1, limit: int = 50,
                        user=Depends(require("customers", "r"))):
    f = _filters(user, q, type, tag, city, consent, kyc, inactive_days)
    order = {"recent": [("created_at", -1)], "name": [("name", 1)], "activity": [("last_activity_at", -1)]}.get(sort, [("created_at", -1)])
    limit, page = max(1, min(limit, 200)), max(1, page)
    total = await db.customers.count_documents(f)
    items = await db.customers.find(f, LIST_FIELDS).sort(order).skip((page - 1) * limit).limit(limit).to_list(limit)
    tags = sorted({t for c in await db.customers.find({"deleted": {"$ne": True}, **scope(user, "customers")}, {"_id": 0, "tags": 1}).to_list(20000) for t in c.get("tags") or []})
    counts = {t: await db.customers.count_documents({**_filters(user), "types": t}) for t in TYPES}
    return {"items": items, "total": total, "page": page, "limit": limit, "tags": tags, "type_counts": counts}


@router.post("/customers")
async def new_customer(body: CustomerIn, user=Depends(require("customers", "w"))):
    phone = normalize_phone(body.phone)
    dup = await db.customers.find_one({"$or": [{"phone": phone}, {"alt_phone": phone}], "merged_into": None,
                                       "deleted": {"$ne": True}}, {"_id": 0, "code": 1, "name": 1})
    if dup and not body.force:
        raise HTTPException(409, f"{dup['name']} ({dup['code']}) already has this mobile number")
    if body.branch_id:
        check_branch(user, body.branch_id)
    if body.language not in LANGS:
        raise HTTPException(422, "Unknown language")
    alt = normalize_phone(body.alt_phone) if body.alt_phone else None
    consent = {"marketing": body.marketing_consent, "whatsapp": body.marketing_consent, "recorded_at": now_iso(), "method": "staff"}
    c = {"id": new_id(), "code": await next_code("customer", "SE-C-", 5), "name": body.name.strip(),
         # a forced second record keeps the shared number as its alternate, so look-ups by mobile still find the first
         "phone": None if dup else phone, "alt_phone": phone if dup else alt,
         "email": (body.email or "").strip().lower() or None, "kind": body.kind, "organization": body.organization,
         "types": [t for t in body.types if t in TYPES], "tags": _clean_tags(body.tags), "city": body.city,
         "locality": body.locality, "address": body.address, "language": body.language,
         "preferred_contact": body.preferred_contact, "source": body.source, "gstin": body.gstin, "notes": body.notes,
         "branch_id": body.branch_id or home_branch(user) or await head_office_id(),
         "rm_id": user["id"] if is_scoped(user, "customers") else body.rm_id, "consent": consent,
         "consent_history": [{"at": consent["recorded_at"], "marketing": body.marketing_consent,
                              "whatsapp": body.marketing_consent, "by": user["name"], "method": "staff"}],
         "kyc": {"status": "not_started"}, "pan_last4": None, "created_at": now_iso(), "updated_at": now_iso(),
         "last_activity_at": now_iso(), "merged_into": None, "anonymised": False, "deleted": False, "created_by": user["id"]}
    await db.customers.insert_one(dict(c))
    await audit(user, "customer_created", "customers", c["id"])
    return c


async def _timeline(c):
    ev = []
    cid = c["id"]
    leads = await db.leads.find({"customer_id": cid}, {"_id": 0}).to_list(100)
    lead_ids = [x["id"] for x in leads]
    for a in await db.lead_activities.find({"lead_id": {"$in": lead_ids}}, {"_id": 0}).to_list(2000):
        ev.append({"at": a["created_at"], "kind": a["kind"], "title": a.get("notes") or a["kind"], "by": a.get("user_name"),
                   "link": f"/erp/leads/{a['lead_id']}"})
    for v in await db.site_visits.find({"lead_id": {"$in": lead_ids}}, {"_id": 0}).to_list(500):
        ev.append({"at": v.get("scheduled_at"), "kind": "site_visit", "title": f"Visit {v['status']} · {v['property_code']} {v['property_title']}",
                   "link": f"/erp/leads/{v['lead_id']}"})
    for d in await db.deals.find({"lead_id": {"$in": lead_ids}}, {"_id": 0, "history": 0}).to_list(100):
        ev.append({"at": d.get("closed_at") or d["created_at"], "kind": "deal", "title": f"Deal {d['code']} · {d['stage']}",
                   "link": f"/erp/deals/{d['id']}"})
    for ls in await db.leases.find({"customer_id": cid}, {"_id": 0, "schedule": 0}).to_list(100):
        ev.append({"at": ls["created_at"], "kind": "lease", "title": f"Lease {ls['code']} · {ls['property_title']}", "link": "/erp/leases"})
        for p in await db.rent_payments.find({"lease_id": ls["id"]}, {"_id": 0}).to_list(500):
            ev.append({"at": p["date"], "kind": "rent", "title": f"Rent {p['period']} paid · {p['receipt_no']}", "amount": p["amount"]})
    for b in await db.bookings.find({"customer_id": cid}, {"_id": 0}).to_list(200):
        ev.append({"at": b["check_in"], "kind": "stay", "title": f"Stay {b['code']} · {b['property_title']} ({b['nights']} nights, {b['platform']})",
                   "amount": b.get("gross"), "link": "/erp/short-stay"})
    o = await db.owners.find_one({"customer_id": cid}, {"_id": 0})
    if o:
        ev.append({"at": o["created_at"], "kind": "owner", "title": f"Owner record {o['code']}", "link": "/erp/owners"})
    inv = await db.investors.find_one({"customer_id": cid}, {"_id": 0})
    if inv:
        for m in await db.investments.find({"investor_id": inv["id"]}, {"_id": 0}).to_list(100):
            ev.append({"at": m["date"], "kind": "investment", "title": f"Invested in {m.get('project_name')}", "amount": m["amount"],
                       "link": f"/erp/investors/{inv['id']}"})
    for n in c.get("notes_log") or []:
        ev.append({"at": n["at"], "kind": "note", "title": n["text"], "by": n.get("by")})
    for h in c.get("consent_history") or []:
        ev.append({"at": h["at"], "kind": "consent", "title": f"Consent: marketing {'yes' if h.get('marketing') else 'no'}, WhatsApp {'yes' if h.get('whatsapp') else 'no'} ({h.get('method')})", "by": h.get("by")})
    return sorted([e for e in ev if e.get("at")], key=lambda e: e["at"], reverse=True)


@router.get("/customers/duplicates")
async def duplicates(user=Depends(require("customers", "w"))):
    rows = await db.customers.find({"deleted": {"$ne": True}, "merged_into": None, "anonymised": {"$ne": True},
                                    **scope(user, "customers")}, {"_id": 0, "id": 1, "code": 1, "name": 1, "phone": 1,
                                                                    "alt_phone": 1, "email": 1, "city": 1, "types": 1}).to_list(20000)
    pairs, seen = [], set()

    def key_name(c):
        return re.sub(r"[^a-z]", "", (c.get("name") or "").lower())
    by = {}
    for c in rows:
        for k in filter(None, [c.get("email") and f"e:{c['email']}", c.get("alt_phone") and f"p:{c['alt_phone']}",
                               c.get("phone") and f"p:{c['phone']}", len(key_name(c)) > 5 and f"n:{key_name(c)}:{(c.get('city') or '').lower()}"]):
            by.setdefault(k, []).append(c)
    for k, group in by.items():
        if len(group) < 2:
            continue
        for i in range(len(group) - 1):
            a, b = group[i], group[i + 1]
            pk = tuple(sorted([a["id"], b["id"]]))
            if pk in seen:
                continue
            seen.add(pk)
            pairs.append({"a": a, "b": b, "reason": {"e": "Same email", "p": "Same mobile number", "n": "Same name and town"}[k[0]]})
    return pairs


@router.get("/customers/export.csv")
async def export_csv(q: Optional[str] = None, type: Optional[str] = None, tag: Optional[str] = None,
                     city: Optional[str] = None, consent: Optional[str] = None, kyc: Optional[str] = None,
                     user=Depends(require("customers", "e"))):
    rows = await db.customers.find(_filters(user, q, type, tag, city, consent, kyc), LIST_FIELDS).to_list(50000)
    cols = ["code", "name", "phone", "email", "kind", "organization", "types", "tags", "city", "locality", "language",
            "preferred_contact", "marketing_consent", "whatsapp_consent", "kyc_status", "source", "created_at", "last_activity_at"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(cols)
    for c in rows:
        w.writerow([c.get("code"), c.get("name"), c.get("phone"), c.get("email"), c.get("kind"), c.get("organization"),
                    "|".join(c.get("types") or []), "|".join(c.get("tags") or []), c.get("city"), c.get("locality"),
                    c.get("language"), c.get("preferred_contact"), (c.get("consent") or {}).get("marketing"),
                    (c.get("consent") or {}).get("whatsapp"), (c.get("kyc") or {}).get("status"), c.get("source"),
                    c.get("created_at"), c.get("last_activity_at")])
    await audit(user, "export", "customers", None, {"rows": len(rows), "consent": consent})
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=customers.csv"})


@router.post("/customers/import")
async def import_csv(file: UploadFile = File(...), user=Depends(require("customers", "e"))):
    if not can(user, "customers", "w"):
        raise HTTPException(403, "You do not have permission for this action")
    raw = (await file.read())[:3_000_000].decode("utf-8-sig", errors="ignore")
    created, updated, errors = 0, 0, []
    for i, row in enumerate(csv.DictReader(io.StringIO(raw)), start=2):
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
        try:
            if not row.get("name") or not (row.get("phone") or row.get("email")):
                raise ValueError("name and phone (or email) are required")
            phone = normalize_phone(row["phone"]) if row.get("phone") else None
            existed = phone and await db.customers.find_one({"phone": phone, "merged_into": None})
            types = [t.strip() for t in re.split(r"[|,;]", row.get("types") or row.get("type") or "") if t.strip() in TYPES]
            c = await upsert_customer({"name": row["name"], "phone": phone, "email": row.get("email"), "types": types,
                                       "city": row.get("city"), "locality": row.get("locality"), "source": "import",
                                       "marketing_consent": (row.get("marketing_consent") or "").lower() in ("yes", "true", "1", "y")}, user)
            if row.get("tags"):
                await db.customers.update_one({"id": c["id"]}, {"$addToSet": {"tags": {"$each": _clean_tags(re.split(r"[|,;]", row["tags"]))}}})
            updated += bool(existed)
            created += not existed
        except (ValueError, HTTPException) as e:
            errors.append(f"Row {i}: {getattr(e, 'detail', str(e))}")
    await audit(user, "import", "customers", None, {"created": created, "updated": updated})
    return {"created": created, "updated": updated, "errors": errors[:50]}


@router.get("/customers/{cid}")
async def get_customer(cid: str, user=Depends(require("customers", "r"))):
    c = await _get(user, cid)
    c["timeline"] = await _timeline(c)
    c["leads"] = await db.leads.find({"customer_id": cid}, {"_id": 0, "id": 1, "code": 1, "stage": 1, "interest": 1, "created_at": 1}).to_list(100)
    c["owner"] = await db.owners.find_one({"customer_id": cid}, {"_id": 0, "id": 1, "code": 1, "name": 1})
    c["investor"] = await db.investors.find_one({"customer_id": cid}, {"_id": 0, "id": 1, "code": 1})
    c["leases"] = await db.leases.find({"customer_id": cid}, {"_id": 0, "id": 1, "code": 1, "property_title": 1, "status": 1, "rent": 1}).to_list(50)
    c["bookings"] = await db.bookings.find({"customer_id": cid}, {"_id": 0, "id": 1, "code": 1, "property_title": 1, "check_in": 1, "nights": 1, "status": 1}).to_list(100)
    if c.get("rm_id"):
        rm = await db.users.find_one({"id": c["rm_id"]}, {"_id": 0, "name": 1})
        c["rm_name"] = rm and rm["name"]
    c["kyc_documents"] = await db.documents.count_documents({"entity_type": "customer", "entity_id": cid, "doc_type": "kyc", "is_latest": True})
    if can(user, "users", "r"):
        c["logins"] = await customer_logins(c)
    c["login_types"] = await login_types(c)
    c["tickets"] = await db.tickets.find({"customer_id": cid}, {"_id": 0, "id": 1, "code": 1, "title": 1, "status": 1,
                                                                "created_at": 1}).sort("created_at", -1).to_list(50)
    return c


# ---------------- Customer sign-ins (tenant, owner / lessor, investor, buyer) ----------------
LOGIN_LABEL = {"tenant": "tenant", "owner": "owner / lessor", "investor": "investor", "buyer": "buyer"}


async def customer_logins(c):
    q = [{"customer_id": c["id"]}]
    if c.get("owner"):
        q.append({"owner_id": c["owner"]["id"]})
    if c.get("investor"):
        q.append({"investor_id": c["investor"]["id"]})
    return await db.users.find({"$or": q, "role": {"$in": list(LOGIN_LABEL)}},
                               {"_id": 0, "id": 1, "email": 1, "role": 1, "active": 1, "last_login": 1, "created_at": 1}).to_list(20)


async def login_types(c):
    """Which customer sign-ins make sense for this person, and why one cannot be made yet."""
    owner = c.get("owner") or await db.owners.find_one({"customer_id": c["id"], "deleted": {"$ne": True}}, {"_id": 0, "id": 1})
    inv = c.get("investor") or await db.investors.find_one({"customer_id": c["id"], "deleted": {"$ne": True}}, {"_id": 0, "id": 1})
    has_lease = await db.leases.count_documents({"customer_id": c["id"]}) > 0
    return [{"type": "tenant", "ok": has_lease, "why": None if has_lease else "No lease with us yet"},
            {"type": "owner", "ok": bool(owner), "why": None if owner else "Not added as an owner yet"},
            {"type": "investor", "ok": bool(inv), "why": None if inv else "Not added as an investor yet"},
            {"type": "buyer", "ok": True, "why": None}]


async def create_customer_login(kind, cid, email, user):
    from routes_auth import create_user, UserIn, EMAIL_RE
    if kind not in LOGIN_LABEL:
        raise HTTPException(422, "Choose the type of login")
    if not can(user, "users", "w"):
        raise HTTPException(403, "Only administrators create logins")
    c = await db.customers.find_one({"id": cid, "deleted": {"$ne": True}, "merged_into": None}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Customer not found")
    email = (email or c.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(422, "Add the customer's email address first")
    if not re.match(EMAIL_RE, email):
        raise HTTPException(422, "Enter a valid email address")
    allowed = {t["type"]: t for t in await login_types(c)}
    if not allowed[kind]["ok"]:
        raise HTTPException(422, f"Cannot make a {LOGIN_LABEL[kind]} login: {allowed[kind]['why'].lower()}")
    extra = {}
    if kind == "owner":
        extra["owner_id"] = (await db.owners.find_one({"customer_id": cid, "deleted": {"$ne": True}}, {"_id": 0, "id": 1}))["id"]
    elif kind == "investor":
        extra["investor_id"] = (await db.investors.find_one({"customer_id": cid, "deleted": {"$ne": True}}, {"_id": 0, "id": 1}))["id"]
    else:
        extra["customer_id"] = cid
    out = await create_user(UserIn(email=email, name=c["name"][:100], role=kind, phone=c.get("phone"), **extra), user)
    upd = {"updated_at": now_iso()}
    if not c.get("email"):
        upd["email"] = email
    op = {"$set": upd}
    if kind in ("tenant", "buyer", "owner", "investor"):
        op["$addToSet"] = {"types": kind}
    await db.customers.update_one({"id": cid}, op)
    await audit(user, "customer_login_created", "customers", cid, {"type": kind, "email": email})
    return out


@router.post("/customers/{cid}/logins")
async def new_customer_login(cid: str, body: dict, user=Depends(require("users", "w"))):
    if can(user, "customers", "r"):
        await _get(user, cid)
    return await create_customer_login(body.get("type") or "", cid, body.get("email"), user)


@router.patch("/customers/{cid}")
async def edit_customer(cid: str, body: dict, user=Depends(require("customers", "w"))):
    c = await _get(user, cid)
    if c.get("anonymised"):
        raise HTTPException(422, "This customer's personal data was removed on request")
    allowed = ["name", "email", "alt_phone", "kind", "organization", "types", "tags", "city", "locality", "address",
               "language", "preferred_contact", "gstin", "notes"]
    if not is_scoped(user, "customers"):
        allowed += ["rm_id", "branch_id"]
    upd = {k: body[k] for k in allowed if k in body}
    if "name" in upd and len(str(upd["name"]).strip()) < 2:
        raise HTTPException(422, "Name is required")
    if "types" in upd:
        upd["types"] = [t for t in upd["types"] or [] if t in TYPES]
    if "tags" in upd:
        upd["tags"] = _clean_tags(upd["tags"])
    if upd.get("alt_phone"):
        upd["alt_phone"] = normalize_phone(upd["alt_phone"])
    if upd.get("email"):
        upd["email"] = upd["email"].strip().lower()
    if upd.get("branch_id"):
        check_branch(user, upd["branch_id"])
    if upd.get("language") and upd["language"] not in LANGS:
        raise HTTPException(422, "Unknown language")
    upd["updated_at"] = now_iso()
    await db.customers.update_one({"id": cid}, {"$set": upd})
    await audit(user, "customer_updated", "customers", cid, {k: v for k, v in upd.items() if k != "updated_at"})
    return {**c, **upd}


@router.post("/customers/{cid}/notes")
async def add_note(cid: str, body: dict, user=Depends(require("customers", "w"))):
    await _get(user, cid)
    text = str(body.get("text") or "").strip()
    if not text:
        raise HTTPException(422, "Write a note")
    await db.customers.update_one({"id": cid}, {"$push": {"notes_log": {"at": now_iso(), "by": user["name"], "text": text[:2000]}},
                                                "$set": {"last_activity_at": now_iso()}})
    return {"ok": True}


class ConsentIn(BaseModel):
    marketing: bool
    whatsapp: bool
    method: str = Field("phone call", max_length=60)


@router.patch("/customers/{cid}/consent")
async def set_consent(cid: str, body: ConsentIn, user=Depends(require("customers", "w"))):
    await _get(user, cid)
    rec = {"at": now_iso(), "marketing": body.marketing, "whatsapp": body.whatsapp, "by": user["name"], "method": body.method}
    await db.customers.update_one({"id": cid}, {"$set": {"consent": {"marketing": body.marketing, "whatsapp": body.whatsapp,
                                                                     "recorded_at": rec["at"], "method": body.method}},
                                                "$push": {"consent_history": rec}})
    await db.leads.update_many({"customer_id": cid}, {"$set": {"consent": {"marketing": body.marketing, "recorded_at": rec["at"]}}})
    await audit(user, "consent_changed", "customers", cid, rec)
    return {"ok": True}


class KycIn(BaseModel):
    status: str = Field(pattern=r"^(not_started|pending|verified|rejected)$")
    id_type: Optional[str] = Field(None, pattern=r"^(aadhaar|pan|passport|voter_id|driving_licence|gst|other)$")
    id_last4: Optional[str] = Field(None, pattern=r"^[A-Za-z0-9]{4}$")
    note: Optional[str] = Field(None, max_length=300)


@router.patch("/customers/{cid}/kyc")
async def set_kyc(cid: str, body: KycIn, user=Depends(require("customers", "w"))):
    """Only the ID type and its last 4 characters are stored here; the document itself goes in KYC documents."""
    await _get(user, cid)
    if body.status == "verified" and not can(user, "customers", "a"):
        raise HTTPException(403, "A manager marks KYC as verified")
    kyc = {**body.model_dump(), "id_last4": (body.id_last4 or "").upper() or None, "by": user["name"], "at": now_iso()}
    await db.customers.update_one({"id": cid}, {"$set": {"kyc": kyc}})
    await audit(user, "kyc_updated", "customers", cid, {"status": body.status, "id_type": body.id_type})
    return kyc


@router.post("/customers/{cid}/merge")
async def merge(cid: str, body: dict, user=Depends(require("customers", "a"))):
    """Moves everything from this customer onto the one kept, then retires this record (kept for the audit trail)."""
    src = await _get(user, cid)
    dst = await _get(user, str(body.get("into_id") or ""))
    if src["id"] == dst["id"]:
        raise HTTPException(422, "Choose a different customer to keep")
    for coll in ("leads", "owners", "leases", "bookings", "investors", "invoices", "agreements"):
        await db[coll].update_many({"customer_id": src["id"]}, {"$set": {"customer_id": dst["id"]}})
    await db.documents.update_many({"entity_type": "customer", "entity_id": src["id"]}, {"$set": {"entity_id": dst["id"]}})
    upd = {"types": sorted(set((dst.get("types") or []) + (src.get("types") or []))),
           "tags": sorted(set((dst.get("tags") or []) + (src.get("tags") or []))), "updated_at": now_iso()}
    for k in ("email", "city", "locality", "address", "organization", "gstin"):
        if not dst.get(k) and src.get(k):
            upd[k] = src[k]
    if src.get("phone") and src["phone"] != dst.get("phone") and not dst.get("alt_phone"):
        upd["alt_phone"] = src["phone"]
    await db.customers.update_one({"id": dst["id"]}, {"$set": upd, "$push": {"notes_log": {"$each": (src.get("notes_log") or []) + [
        {"at": now_iso(), "by": user["name"], "text": f"Merged {src['code']} ({src['name']}) into this record"}]}}})
    await db.customers.update_one({"id": src["id"]}, {"$set": {"merged_into": dst["id"], "phone": None,
                                                               "merged_phone": src.get("phone"), "updated_at": now_iso()}})
    await audit(user, "customer_merged", "customers", dst["id"], {"from": src["code"], "into": dst["code"]})
    return {"ok": True, "kept": dst["id"]}


@router.get("/customers/{cid}/data.json")
async def data_access(cid: str, user=Depends(require("customers", "e"))):
    """Everything held about the person, for a data access request."""
    c = await get_customer(cid, user)
    c.pop("timeline", None)
    out = {"exported_at": now_iso(), "customer": c,
           "leads": await db.leads.find({"customer_id": cid}, {"_id": 0}).to_list(100),
           "leases": await db.leases.find({"customer_id": cid}, {"_id": 0, "schedule": 0}).to_list(100),
           "bookings": await db.bookings.find({"customer_id": cid}, {"_id": 0}).to_list(500),
           "documents": await db.documents.find({"entity_type": "customer", "entity_id": cid}, {"_id": 0, "stored_name": 0}).to_list(200)}
    await audit(user, "data_access_export", "customers", cid)
    return Response(json.dumps(out, default=str, indent=2), media_type="application/json",
                    headers={"Content-Disposition": f"attachment; filename={c['code']}-data.json"})


@router.post("/customers/{cid}/anonymise")
async def anonymise(cid: str, body: dict, user=Depends(require("customers", "a"))):
    """Erasure request: removes the person's identity and marketing data. Rent, booking and invoice records keep the
    name only while the law needs them (accounts are kept 8 years); that is listed in the response."""
    c = await _get(user, cid)
    if not body.get("confirm"):
        raise HTTPException(422, "Confirm that the customer asked for their data to be removed")
    kept = []
    if await db.leases.count_documents({"customer_id": cid, "status": "active"}):
        raise HTTPException(422, "This person has an active lease. End it first; lease records are kept for accounts.")
    if await db.leases.count_documents({"customer_id": cid}):
        kept.append("lease and rent records (accounting)")
    if await db.bookings.count_documents({"customer_id": cid, "settled": True}):
        kept.append("settled stays (accounting)")
    if await db.investors.count_documents({"customer_id": cid}):
        raise HTTPException(422, "Investors' records are kept while they hold investments")
    from routes_crm import anonymise_lead_record
    for ld in await db.leads.find({"customer_id": cid}, {"_id": 0}).to_list(100):
        await anonymise_lead_record(ld, user, body.get("reason"))
    await db.customers.update_one({"id": cid}, {"$set": {
        "name": "Anonymised customer", "phone": None, "alt_phone": None, "email": None, "organization": None, "address": None,
        "locality": None, "notes": None, "notes_log": [], "tags": [], "gstin": None, "anonymised": True, "anonymised_at": now_iso(),
        "consent": {"marketing": False, "whatsapp": False, "recorded_at": now_iso(), "method": "erasure request"},
        "consent_history": [], "kyc": {"status": "not_started"}, "updated_at": now_iso()}})
    await db.bookings.update_many({"customer_id": cid, "settled": {"$ne": True}}, {"$set": {"guest_name": "Anonymised guest", "guest_phone": None, "guest_email": None}})
    await audit(user, "customer_anonymised", "customers", cid, {"code": c["code"], "reason": body.get("reason"), "kept": kept})
    return {"ok": True, "kept": kept}


async def backfill_customers():
    """One-time: build customer records from existing leads, owners, tenants and guests (matched by mobile)."""
    n = 0
    for ld in await db.leads.find({"customer_id": {"$exists": False}, "phone": {"$ne": None}}, {"_id": 0}).to_list(50000):
        c = await link_customer("leads", ld["id"], {"name": ld["name"], "phone": ld["phone"], "email": ld.get("email"),
                                                    "types": [LEAD_TYPE.get(ld.get("customer_type"), "buyer")], "source": ld.get("source"),
                                                    "branch_id": ld.get("branch_id"), "rm_id": ld.get("assigned_to"),
                                                    "marketing_consent": (ld.get("consent") or {}).get("marketing")})
        n += bool(c)
    for o in await db.owners.find({"customer_id": {"$exists": False}}, {"_id": 0}).to_list(50000):
        await link_customer("owners", o["id"], {"name": o["name"], "phone": o.get("phone"), "email": o.get("email"),
                                                "types": ["owner", "landlord"], "source": o.get("source") or "direct",
                                                "kind": "business" if o.get("kind") == "company" else "individual"})
    for ls in await db.leases.find({"customer_id": {"$exists": False}}, {"_id": 0, "schedule": 0}).to_list(50000):
        await link_customer("leases", ls["id"], {"name": ls["tenant_name"], "phone": ls.get("tenant_phone"), "email": ls.get("tenant_email"),
                                                 "types": ["tenant"], "source": "lease", "branch_id": ls.get("branch_id"),
                                                 "kind": "business" if ls.get("tenant_kind") == "business" else "individual"})
    for b in await db.bookings.find({"customer_id": {"$exists": False}, "guest_phone": {"$ne": None}}, {"_id": 0}).to_list(50000):
        await link_customer("bookings", b["id"], {"name": b["guest_name"], "phone": b.get("guest_phone"), "email": b.get("guest_email"),
                                                  "types": ["guest"], "source": b.get("platform") or "direct", "branch_id": b.get("branch_id")})
    return n


async def customer_counts_for_dashboard(user):
    t = today_ist().isoformat()
    f = _filters(user)
    return {"total": await db.customers.count_documents(f),
            "new_this_month": await db.customers.count_documents({**f, "created_at": {"$gte": t[:7]}}),
            "with_consent": await db.customers.count_documents({**f, "consent.marketing": True})}
