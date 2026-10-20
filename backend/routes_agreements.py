"""Agreement generator: pick a template, prefill from a lease / deal / property / owner / investment, edit clauses,
then download in stamp-paper layout as Word or PDF. Finalised agreements are kept with the record (and shown in the
owner or investor portal), and the signed scan can be uploaded back."""
import re
from datetime import date
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel, Field
from core import (db, now_iso, new_id, next_code, require, can, scope, audit, get_settings, today_ist, save_upload,
                  check_branch, home_branch, head_office_id, UPLOAD_DIR, DOC_TYPES, IST)
import agreements as A

router = APIRouter()
ENTITY = {"lease": "leases", "deal": "deals", "property": "properties", "owner": "owners", "investment": "investments",
          "investor": "investors"}
OWNER_TPL = {"rental_residential", "lease_commercial", "leave_licence", "brokerage_authorisation", "property_management",
             "shortstay_management", "sale_agreement", "token_receipt"}


def _fy(d):
    y = d.year if d.month >= 4 else d.year - 1
    return f"{y}-{(y + 1) % 100:02d}"


def _months_between(a, b):
    try:
        d1, d2 = date.fromisoformat(a), date.fromisoformat(b)
        return max(1, (d2.year - d1.year) * 12 + d2.month - d1.month + (1 if d2.day >= d1.day else 0))
    except (TypeError, ValueError):
        return None


def _prop_text(p):
    bits = [p.get("title")]
    if p.get("built_area"):
        bits.append(f"built-up area about {p['built_area']:,.0f} {p.get('area_unit') or 'sq.ft'}")
    if p.get("plot_area"):
        bits.append(f"plot / land area about {p['plot_area']:,.2f}".rstrip("0").rstrip(".") + f" {p.get('area_unit') or ''}")
    if p.get("furnishing"):
        bits.append(p["furnishing"].replace("_", " "))
    return ", ".join(b for b in bits if b)


async def _owner_party(prefix, owner):
    if not owner:
        return {}
    c = await db.customers.find_one({"id": owner.get("customer_id")}, {"_id": 0, "address": 1}) if owner.get("customer_id") else None
    return {f"{prefix}_name": owner.get("name"), f"{prefix}_address": owner.get("address") or (c or {}).get("address")}


async def prefill(template, entity_type, entity_id, user):
    s = await get_settings()
    director = await db.users.find_one({"role": "director", "active": True}, {"_id": 0, "name": 1})
    out = {"execution_date": today_ist().isoformat(), "execution_place": "Erode",
           "company_signatory": s.get("agreement_signatory") or (director or {}).get("name") or "",
           "company_signatory_designation": s.get("agreement_signatory_designation") or "Director"}
    branch = None
    if not entity_type or not entity_id:
        return out, branch
    coll = ENTITY.get(entity_type)
    if not coll:
        raise HTTPException(422, "Unknown record type")
    rec = await db[coll].find_one({"id": entity_id}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Record not found")
    if entity_type in ("lease", "deal", "property"):
        mod = {"lease": "leases", "deal": "deals", "property": "properties"}[entity_type]
        if not await db[coll].find_one({"id": entity_id, **scope(user, mod)}, {"_id": 0, "id": 1}):
            raise HTTPException(404, "Record not found")
    prop = None
    if entity_type == "property":
        prop = rec
    elif rec.get("property_id"):
        prop = await db.properties.find_one({"id": rec["property_id"]}, {"_id": 0})
    if prop:
        branch = prop.get("branch_id")
        out.update({"property_address": prop.get("internal_address") or f"{prop.get('locality')}, {prop.get('city')} {prop.get('pincode') or ''}".strip(),
                    "property_description": _prop_text(prop), "survey_no": prop.get("survey_no"),
                    "execution_place": prop.get("city") or out["execution_place"],
                    "mgmt_fee_pct": prop.get("mgmt_fee_pct") or None, "expected_price": prop.get("price"),
                    "power": prop.get("power_supply")})
        owner = await db.owners.find_one({"id": prop.get("owner_id")}, {"_id": 0}) if prop.get("owner_id") else None
        key = "lessor" if template in ("rental_residential", "lease_commercial", "leave_licence") else (
            "seller" if template in ("sale_agreement", "token_receipt") else "owner")
        out.update(await _owner_party(key, owner))
    if entity_type == "owner":
        out.update(await _owner_party("owner", rec))
    if entity_type == "lease":
        c = await db.customers.find_one({"id": rec.get("customer_id")}, {"_id": 0, "address": 1}) if rec.get("customer_id") else None
        out.update({"lessee_name": rec["tenant_name"], "lessee_address": (c or {}).get("address"), "rent": rec["rent"],
                    "deposit": rec.get("deposit"), "start_date": rec["start_date"], "term_months": _months_between(rec["start_date"], rec["end_date"]),
                    "due_day": rec.get("due_day"), "escalation_pct": rec.get("escalation_pct"),
                    "escalation_every_months": rec.get("escalation_every_months")})
    if entity_type == "deal":
        out.update({"buyer_name": rec.get("buyer_name"), "price": rec.get("agreed_value"),
                    "lessee_name": rec.get("buyer_name"), "rent": rec.get("agreed_value") if rec.get("deal_type") != "sale" else None})
    if entity_type in ("investment", "investor"):
        inv = rec if entity_type == "investor" else await db.investors.find_one({"id": rec["investor_id"]}, {"_id": 0})
        c = await db.customers.find_one({"id": inv.get("customer_id")}, {"_id": 0, "address": 1}) if inv and inv.get("customer_id") else None
        out.update({"investor_name": inv and inv["name"], "investor_address": (c or {}).get("address"),
                    "investor_id": inv and inv.get("pan_last4")})
        if entity_type == "investment":
            p = await db.inv_projects.find_one({"id": rec["project_id"]}, {"_id": 0})
            branch = p and p.get("branch_id")
            out.update({"project_name": p and p["name"], "project_location": p and ", ".join(x for x in (p.get("locality"), p.get("city")) if x),
                        "project_description": p and (p.get("description") or "")[:300], "amount": rec["amount"],
                        "investment_date": rec["date"], "reference": rec.get("reference"),
                        "horizon_months": p and p.get("horizon_months")})
    return {k: v for k, v in out.items() if v not in (None, "")}, branch


class AgreementIn(BaseModel):
    template: str
    title: Optional[str] = Field(None, max_length=160)
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    data: dict = {}
    clauses: Optional[List[str]] = None
    extra_clauses: List[str] = []
    paper: str = Field("legal", pattern=r"^(legal|a4)$")
    stamp_top_mm: float = Field(100, ge=0, le=180)
    stamp_value: Optional[float] = Field(None, ge=0)
    estamp_no: Optional[str] = Field(None, max_length=40)
    estamp_date: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")


def _check(body):
    if body.template not in A.TEMPLATES:
        raise HTTPException(422, "Unknown template")
    if body.clauses is not None and (len(body.clauses) > 80 or any(len(c) > 4000 for c in body.clauses)):
        raise HTTPException(422, "Too many or too long clauses")
    for k, v in (body.data or {}).items():
        if isinstance(v, str) and len(v) > 2000:
            raise HTTPException(422, f"{k} is too long")


def stamp_line(a):
    if a.get("estamp_no"):
        amt = f"Rs. {a['stamp_value']:,.0f}" if a.get("stamp_value") else "the stamp duty"
        return f"Stamp duty of {amt} paid vide e-Stamp certificate No. {a['estamp_no']}" + (
            f" dated {A.nice_date(a['estamp_date'])}" if a.get("estamp_date") else "") + "."
    return None


async def _render(a):
    company = await get_settings()
    blocks, ctx, d = A.render_blocks(a["template"], a.get("data") or {}, company, a.get("clauses"), a.get("extra_clauses"))
    return blocks


@router.get("/agreements/templates")
async def templates(user=Depends(require("agreements", "r"))):
    return A.template_list()


@router.get("/agreements/prefill")
async def get_prefill(template: str, entity_type: Optional[str] = None, entity_id: Optional[str] = None,
                      user=Depends(require("agreements", "w"))):
    if template not in A.TEMPLATES:
        raise HTTPException(422, "Unknown template")
    data, _ = await prefill(template, entity_type, entity_id, user)
    return {"data": data, "clauses": A.default_clauses(template, data, await get_settings())}


@router.post("/agreements/preview")
async def preview(body: AgreementIn, user=Depends(require("agreements", "r"))):
    _check(body)
    company = await get_settings()
    blocks, _, d = A.render_blocks(body.template, body.data, company, body.clauses, body.extra_clauses)
    return {"blocks": blocks, "stamp": A.TEMPLATES[body.template]["stamp"](d),
            "default_clauses": A.default_clauses(body.template, body.data, company),
            "stamp_line": stamp_line(body.model_dump())}


@router.get("/agreements")
async def list_agreements(entity_type: Optional[str] = None, entity_id: Optional[str] = None, q: Optional[str] = None,
                          status: Optional[str] = None, user=Depends(require("agreements", "r"))):
    f = {"deleted": {"$ne": True}, **scope(user, "agreements")}
    if entity_type and entity_id:
        f.update({"entity_type": entity_type, "entity_id": entity_id})
    if status:
        f["status"] = status
    if q:
        rx = {"$regex": re.escape(q[:60]), "$options": "i"}
        f["$or"] = [{"title": rx}, {"code": rx}, {"party_names": rx}]
    return await db.agreements.find(f, {"_id": 0, "data": 0, "clauses": 0, "extra_clauses": 0}).sort("created_at", -1).to_list(2000)


@router.post("/agreements")
async def create(body: AgreementIn, user=Depends(require("agreements", "w"))):
    _check(body)
    branch = None
    if body.entity_type and body.entity_id:
        _, branch = await prefill(body.template, body.entity_type, body.entity_id, user)
    branch = branch or home_branch(user) or await head_office_id()
    check_branch(user, branch)
    t = A.TEMPLATES[body.template]
    company = await get_settings()
    _, _, d = A.render_blocks(body.template, body.data, company, body.clauses, body.extra_clauses)
    names = [d.get(f"{k}_name") for k, _ in t["parties"] if d.get(f"{k}_name")]
    a = {"id": new_id(), "code": await next_code(f"ag-{_fy(today_ist())}", f"AG/{_fy(today_ist())}/", 4), **body.model_dump(),
         "title": body.title or f"{t['title'].title()} – {' & '.join(names) or 'draft'}", "party_names": " ".join(names),
         "status": "draft", "version": 1, "branch_id": branch, "stamp_estimate": t["stamp"](d), "created_by": user["id"],
         "created_by_name": user["name"], "created_at": now_iso(), "updated_at": now_iso(), "deleted": False}
    await db.agreements.insert_one(dict(a))
    await audit(user, "agreement_created", "agreements", a["id"], {"template": body.template, "entity": f"{body.entity_type}:{body.entity_id}"})
    return a


async def _get(user, aid):
    a = await db.agreements.find_one({"id": aid, "deleted": {"$ne": True}, **scope(user, "agreements")}, {"_id": 0})
    if not a:
        raise HTTPException(404, "Agreement not found")
    return a


@router.get("/agreements/{aid}")
async def get_agreement(aid: str, user=Depends(require("agreements", "r"))):
    a = await _get(user, aid)
    a["blocks"] = await _render(a)
    a["documents"] = await db.documents.find({"entity_type": "agreement", "entity_id": aid}, {"_id": 0, "stored_name": 0}).sort("created_at", -1).to_list(20)
    return a


@router.patch("/agreements/{aid}")
async def edit(aid: str, body: dict, user=Depends(require("agreements", "w"))):
    a = await _get(user, aid)
    if a["status"] != "draft":
        raise HTTPException(422, "Final agreements cannot be edited. Make a copy to change it.")
    allowed = ["title", "data", "clauses", "extra_clauses", "paper", "stamp_top_mm", "stamp_value", "estamp_no", "estamp_date"]
    merged = {**a, **{k: body[k] for k in allowed if k in body}}
    try:
        chk = AgreementIn(**{k: merged.get(k) for k in AgreementIn.model_fields if k in merged})
    except Exception:
        raise HTTPException(422, "Check the agreement details")
    _check(chk)
    t = A.TEMPLATES[a["template"]]
    _, _, d = A.render_blocks(a["template"], merged.get("data") or {}, await get_settings(), merged.get("clauses"), merged.get("extra_clauses"))
    upd = {k: merged[k] for k in allowed if k in body}
    upd.update({"version": a["version"] + 1, "updated_at": now_iso(), "stamp_estimate": t["stamp"](d),
                "party_names": " ".join(d.get(f"{k}_name") or "" for k, _ in t["parties"]).strip()})
    await db.agreements.update_one({"id": aid}, {"$set": upd})
    return {**a, **upd}


@router.post("/agreements/{aid}/copy")
async def copy(aid: str, user=Depends(require("agreements", "w"))):
    a = await _get(user, aid)
    body = AgreementIn(**{k: a.get(k) for k in AgreementIn.model_fields if k in a})
    body.title = f"{a['title']} (copy)"
    return await create(body, user)


async def _file(a, kind):
    blocks = await _render(a)
    t = A.TEMPLATES[a["template"]]
    if kind == "pdf":
        return A.to_pdf(blocks, a["template"], a["title"], a.get("paper") or "legal", a.get("stamp_top_mm") or 0, stamp_line(a)), "application/pdf"
    return (A.to_docx(blocks, a["template"], a.get("paper") or "legal", a.get("stamp_top_mm") or 0, stamp_line(a)),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document")


def _fname(a, ext):
    return re.sub(r"[^\w.-]+", "-", f"{a['code']}-{a['title']}")[:90].strip("-") + f".{ext}"


@router.get("/agreements/{aid}/pdf")
async def pdf(aid: str, user=Depends(require("agreements", "r"))):
    a = await _get(user, aid)
    data, mt = await _file(a, "pdf")
    await audit(user, "agreement_downloaded", "agreements", aid, {"format": "pdf"})
    return Response(data, media_type=mt, headers={"Content-Disposition": f"inline; filename={_fname(a, 'pdf')}"})


@router.get("/agreements/{aid}/docx")
async def docx(aid: str, user=Depends(require("agreements", "r"))):
    a = await _get(user, aid)
    data, mt = await _file(a, "docx")
    await audit(user, "agreement_downloaded", "agreements", aid, {"format": "docx"})
    return Response(data, media_type=mt, headers={"Content-Disposition": f"attachment; filename={_fname(a, 'docx')}"})


async def _store(a, data, ctype, name, doc_type, user, share_owner=False, share_investor=False):
    import asyncio
    stored = new_id()
    await asyncio.to_thread((UPLOAD_DIR / stored).write_bytes, data)
    d = {"id": new_id(), "stored_name": stored, "size": len(data), "content_type": ctype, "original_name": name,
         "entity_type": "agreement", "entity_id": a["id"], "doc_type": doc_type, "expiry_date": None, "notes": a["code"],
         "version": 1, "is_latest": True, "previous_id": None, "public_approved": False, "share_with_owner": False,
         "share_with_investor": False, "uploaded_by": user["id"], "uploaded_by_name": user["name"], "created_at": now_iso()}
    await db.documents.insert_one(dict(d))
    # a copy on the linked record so it shows with the property / owner / investor files and in their portal
    if a.get("entity_type") in ("property", "owner", "investor") or a.get("entity_type") in ("lease", "deal", "investment"):
        et, eid = a["entity_type"], a["entity_id"]
        if et in ("lease", "deal"):
            rec = await db[ENTITY[et]].find_one({"id": eid}, {"_id": 0, "property_id": 1})
            et, eid = "property", (rec or {}).get("property_id")
        elif et == "investment":
            rec = await db.investments.find_one({"id": eid}, {"_id": 0, "investor_id": 1})
            et, eid = "investor", (rec or {}).get("investor_id")
        if eid:
            await db.documents.insert_one({**d, "id": new_id(), "entity_type": et, "entity_id": eid,
                                           "share_with_owner": share_owner and et in ("property", "owner"),
                                           "share_with_investor": share_investor and et == "investor"})
    return d


@router.post("/agreements/{aid}/finalise")
async def finalise(aid: str, body: dict, user=Depends(require("agreements", "w"))):
    a = await _get(user, aid)
    if a["status"] != "draft":
        raise HTTPException(409, "Already final")
    data, mt = await _file(a, "pdf")
    share = bool(body.get("share"))
    await _store(a, data, mt, _fname(a, "pdf"), "agreement", user, share and a["template"] in OWNER_TPL,
                 share and a["template"] == "investor_coinvestment")
    await db.agreements.update_one({"id": aid}, {"$set": {"status": "final", "finalised_at": now_iso(), "finalised_by": user["name"]}})
    await audit(user, "agreement_finalised", "agreements", aid, {"shared": share})
    return {"ok": True}


@router.post("/agreements/{aid}/signed")
async def signed(aid: str, file: UploadFile = File(...), user=Depends(require("agreements", "w"))):
    a = await _get(user, aid)
    if a["status"] == "draft":
        raise HTTPException(422, "Finalise the agreement before uploading the signed copy")
    saved = await save_upload(file, DOC_TYPES)
    d = {"id": new_id(), **saved, "entity_type": "agreement", "entity_id": aid, "doc_type": "signed_agreement",
         "expiry_date": None, "notes": a["code"], "version": 1, "is_latest": True, "previous_id": None, "public_approved": False,
         "uploaded_by": user["id"], "uploaded_by_name": user["name"], "created_at": now_iso()}
    await db.documents.insert_one(dict(d))
    await db.agreements.update_one({"id": aid}, {"$set": {"status": "signed", "signed_at": now_iso()}})
    await audit(user, "agreement_signed_uploaded", "agreements", aid)
    d.pop("stored_name", None)
    return d


@router.delete("/agreements/{aid}")
async def delete(aid: str, user=Depends(require("agreements", "w"))):
    a = await _get(user, aid)
    if a["status"] != "draft":
        raise HTTPException(422, "Only drafts can be deleted")
    await db.agreements.update_one({"id": aid}, {"$set": {"deleted": True}})
    await audit(user, "agreement_deleted", "agreements", aid)
    return {"ok": True}
