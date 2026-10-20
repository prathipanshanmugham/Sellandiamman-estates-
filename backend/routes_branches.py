"""Branches, the towns / localities list (addable by staff), and the team directory with the organisation chart."""
import re
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field
from core import (db, now_iso, new_id, require, can, staff_user, audit, normalize_phone, get_settings, ROLES,
                  PORTAL_ROLES, IMAGE_TYPES)

router = APIRouter()
PUBLIC_BRANCH = ["id", "code", "name", "city", "district", "address", "pincode", "phone", "whatsapp", "email",
                 "office_hours", "lat", "lng", "is_head_office", "gbp_url"]


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")[:60] or "place"


def _rx(s):
    return {"$regex": f"^{re.escape((s or '').strip())}$", "$options": "i"}


# ---------------- Branches ----------------
class BranchIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    code: Optional[str] = Field(None, max_length=8)
    city: str = Field(min_length=2, max_length=60)
    district: Optional[str] = Field(None, max_length=60)
    address: Optional[str] = Field(None, max_length=300)
    pincode: Optional[str] = Field(None, pattern=r"^\d{6}$")
    phone: Optional[str] = Field(None, max_length=20)
    whatsapp: Optional[str] = Field(None, max_length=20)
    email: Optional[str] = Field(None, max_length=120)
    office_hours: Optional[str] = Field(None, max_length=80)
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lng: Optional[float] = Field(None, ge=-180, le=180)
    manager_id: Optional[str] = None
    is_head_office: bool = False
    active: bool = True
    gbp_url: Optional[str] = Field(None, max_length=300)


async def _clear_head_office(except_id):
    await db.branches.update_many({"id": {"$ne": except_id}, "is_head_office": True}, {"$set": {"is_head_office": False}})


@router.get("/branches")
async def branches(user=Depends(staff_user)):
    rows = await db.branches.find({}, {"_id": 0}).sort([("order", 1), ("name", 1)]).to_list(200)
    for b in rows:
        b["staff"] = await db.users.count_documents({"branch_ids": b["id"], "active": True, "role": {"$nin": list(PORTAL_ROLES)}})
        b["properties"] = await db.properties.count_documents({"branch_id": b["id"], "deleted": {"$ne": True}})
    return rows


@router.get("/public/branches")
async def public_branches():
    rows = await db.branches.find({"active": {"$ne": False}}, {"_id": 0}).sort([("is_head_office", -1), ("order", 1)]).to_list(100)
    return [{k: b.get(k) for k in PUBLIC_BRANCH} for b in rows]


@router.post("/branches")
async def new_branch(body: BranchIn, user=Depends(require("settings", "w"))):
    if await db.branches.find_one({"name": _rx(body.name)}):
        raise HTTPException(409, "A branch with this name already exists")
    data = body.model_dump()
    for k in ("phone", "whatsapp"):
        if data.get(k):
            data[k] = normalize_phone(data[k])
    bid = f"br-{slugify(body.name)}"
    if await db.branches.find_one({"id": bid}):
        bid = f"{bid}-{new_id()[:4]}"
    b = {"id": bid, **data, "code": (body.code or body.name[:3]).upper(),
         "order": await db.branches.count_documents({}) + 1, "created_at": now_iso()}
    await db.branches.insert_one(dict(b))
    if b["is_head_office"]:
        await _clear_head_office(bid)
    await _ensure_city(body.city, body.district, bid)
    await audit(user, "branch_created", "settings", bid, {"name": body.name})
    return b


@router.patch("/branches/{bid}")
async def edit_branch(bid: str, body: dict, user=Depends(require("settings", "w"))):
    b = await db.branches.find_one({"id": bid}, {"_id": 0})
    if not b:
        raise HTTPException(404, "Branch not found")
    try:
        data = BranchIn(**{**b, **body}).model_dump()
    except Exception as e:  # pydantic validation error -> readable message
        raise HTTPException(422, str(e).split("\n")[1] if "\n" in str(e) else "Check the branch details")
    upd = {k: data[k] for k in body if k in data}
    for k in ("phone", "whatsapp"):
        if upd.get(k):
            upd[k] = normalize_phone(upd[k])
    if upd.get("active") is False and b.get("is_head_office"):
        raise HTTPException(422, "Choose another head office before closing this branch")
    await db.branches.update_one({"id": bid}, {"$set": upd})
    if upd.get("is_head_office"):
        await _clear_head_office(bid)
    await audit(user, "branch_updated", "settings", bid, upd)
    return {**b, **upd}


# ---------------- Towns & localities ----------------
class LocationIn(BaseModel):
    kind: str = Field("locality", pattern=r"^(city|locality)$")
    name: str = Field(min_length=2, max_length=80)
    city: Optional[str] = Field(None, max_length=60)
    district: Optional[str] = Field(None, max_length=60)
    pincode: Optional[str] = Field(None, pattern=r"^\d{6}$")
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lng: Optional[float] = Field(None, ge=-180, le=180)
    branch_id: Optional[str] = None
    intro: Optional[str] = Field(None, max_length=1500)


async def _ensure_city(name, district=None, branch_id=None):
    c = await db.locations.find_one({"kind": "city", "name": _rx(name)}, {"_id": 0})
    if c:
        return c
    c = {"id": new_id(), "kind": "city", "name": name.strip(), "city": name.strip(), "district": district,
         "state": "Tamil Nadu", "pincode": None, "lat": None, "lng": None, "branch_id": branch_id,
         "slug": slugify(name), "active": True, "intro": None, "created_at": now_iso()}
    await db.locations.insert_one(dict(c))
    return c


async def ensure_place(city, locality=None, pincode=None, lat=None, lng=None, branch_id=None, source="system",
                       active=True):
    """Adds a town / locality the first time it is used (a property or an owner's submission), so the list grows.
    Localities suggested from the public website start hidden until staff switch them on."""
    if not city:
        return None
    c = await _ensure_city(city, branch_id=branch_id)
    if not locality:
        return c
    loc = await db.locations.find_one({"kind": "locality", "city": _rx(c["name"]), "name": _rx(locality)}, {"_id": 0})
    if loc:
        return loc
    loc = {"id": new_id(), "kind": "locality", "name": locality.strip()[:80], "city": c["name"], "city_id": c["id"],
           "district": c.get("district"), "state": "Tamil Nadu", "pincode": pincode, "lat": lat, "lng": lng,
           "branch_id": branch_id or c.get("branch_id"), "slug": slugify(locality), "active": active, "intro": None,
           "source": source, "created_at": now_iso()}
    await db.locations.insert_one(dict(loc))
    return loc


def _tree(rows, counts=None):
    counts = counts or {}
    cities = [r for r in rows if r["kind"] == "city"]
    out = []
    for c in sorted(cities, key=lambda x: x["name"]):
        locs = sorted([r for r in rows if r["kind"] == "locality" and r.get("city", "").lower() == c["name"].lower()],
                      key=lambda x: x["name"])
        out.append({**c, "listings": counts.get((c["name"].lower(), None), 0),
                    "localities": [{**x, "listings": counts.get((c["name"].lower(), x["name"].lower()), 0)} for x in locs]})
    return out


async def _listing_counts():
    rows = await db.properties.find({"status": {"$in": ["published", "under_offer"]}, "deleted": {"$ne": True}},
                                    {"_id": 0, "city": 1, "locality": 1}).to_list(10000)
    counts = {}
    for p in rows:
        c, loc = (p.get("city") or "").lower(), (p.get("locality") or "").lower()
        counts[(c, None)] = counts.get((c, None), 0) + 1
        counts[(c, loc)] = counts.get((c, loc), 0) + 1
    return counts


@router.get("/public/locations")
async def public_locations():
    rows = await db.locations.find({"active": {"$ne": False}}, {"_id": 0, "source": 0}).to_list(5000)
    return _tree(rows, await _listing_counts())


@router.get("/locations")
async def locations(user=Depends(staff_user)):
    rows = await db.locations.find({}, {"_id": 0}).to_list(5000)
    return _tree(rows, await _listing_counts())


@router.post("/locations")
async def add_location(body: LocationIn, user=Depends(staff_user)):
    """Towns need Settings access; localities can be added by anyone who adds properties."""
    if body.kind == "city" and not can(user, "settings", "w"):
        raise HTTPException(403, "Only administrators can add a new town")
    if body.kind == "locality" and not (can(user, "properties", "w") or can(user, "settings", "w")):
        raise HTTPException(403, "You do not have permission for this action")
    if body.kind == "city":
        if await db.locations.find_one({"kind": "city", "name": _rx(body.name)}):
            raise HTTPException(409, f"{body.name} is already in the list")
        c = await _ensure_city(body.name, body.district, body.branch_id)
        upd = {k: v for k, v in body.model_dump().items() if k in ("pincode", "lat", "lng", "intro") and v is not None}
        if upd:
            await db.locations.update_one({"id": c["id"]}, {"$set": upd})
        await audit(user, "location_added", "settings", c["id"], {"city": body.name})
        return {**c, **upd}
    if not body.city:
        raise HTTPException(422, "Choose the town this locality belongs to")
    if not await db.locations.find_one({"kind": "city", "name": _rx(body.city)}):
        raise HTTPException(422, "Add the town first")
    if await db.locations.find_one({"kind": "locality", "city": _rx(body.city), "name": _rx(body.name)}):
        raise HTTPException(409, f"{body.name} is already listed under {body.city}")
    loc = await ensure_place(body.city, body.name, body.pincode, body.lat, body.lng, body.branch_id, source=user["id"])
    if body.intro:
        await db.locations.update_one({"id": loc["id"]}, {"$set": {"intro": body.intro}})
    await audit(user, "location_added", "properties", loc["id"], {"city": body.city, "locality": body.name})
    return loc


@router.patch("/locations/{lid}")
async def edit_location(lid: str, body: dict, user=Depends(require("settings", "w"))):
    loc = await db.locations.find_one({"id": lid}, {"_id": 0})
    if not loc:
        raise HTTPException(404, "Not found")
    upd = {k: body[k] for k in ("district", "pincode", "lat", "lng", "branch_id", "intro", "active") if k in body}
    if upd.get("pincode") and not re.fullmatch(r"\d{6}", str(upd["pincode"])):
        raise HTTPException(422, "PIN code must be 6 digits")
    new_name = (body.get("name") or "").strip()
    if new_name and new_name != loc["name"]:
        clash = {"kind": loc["kind"], "name": _rx(new_name), "id": {"$ne": lid}}
        if loc["kind"] == "locality":
            clash["city"] = _rx(loc["city"])
        if await db.locations.find_one(clash):
            raise HTTPException(409, "That name is already in the list")
        upd.update({"name": new_name, "slug": slugify(new_name)})
        # keep listings pointing at the renamed place
        if loc["kind"] == "city":
            upd["city"] = new_name
            await db.locations.update_many({"kind": "locality", "city": _rx(loc["name"])}, {"$set": {"city": new_name}})
            await db.properties.update_many({"city": _rx(loc["name"])}, {"$set": {"city": new_name}})
        else:
            await db.properties.update_many({"city": _rx(loc["city"]), "locality": _rx(loc["name"])},
                                            {"$set": {"locality": new_name}})
    await db.locations.update_one({"id": lid}, {"$set": upd})
    await audit(user, "location_updated", "settings", lid, upd)
    return {**loc, **upd}


# ---------------- Team directory & organisation chart ----------------
DIR_FIELDS = {"_id": 0, "id": 1, "name": 1, "email": 1, "phone": 1, "whatsapp": 1, "role": 1, "branch_ids": 1,
              "designation": 1, "department": 1, "reports_to": 1, "photo": 1, "show_in_directory": 1, "joined_on": 1}


async def directory():
    people = await db.users.find({"active": True, "role": {"$nin": list(PORTAL_ROLES)},
                                  "show_in_directory": {"$ne": False}}, DIR_FIELDS).to_list(1000)
    ids = {p["id"] for p in people}
    for p in people:
        p["role_label"] = ROLES.get(p["role"])
        if p.get("reports_to") not in ids:
            p["reports_to"] = None
    return people


@router.get("/team/org")
async def org(user=Depends(staff_user)):
    s = await get_settings()
    br = await db.branches.find({"active": {"$ne": False}}, {"_id": 0}).sort([("is_head_office", -1), ("order", 1)]).to_list(100)
    return {"company": {"name": s.get("name"), "phone": s.get("phone"), "email": s.get("email"), "address": s.get("address")},
            "branches": [{k: b.get(k) for k in PUBLIC_BRANCH + ["manager_id"]} for b in br], "people": await directory()}


class MeIn(BaseModel):
    phone: Optional[str] = Field(None, max_length=20)
    whatsapp: Optional[str] = Field(None, max_length=20)
    photo: Optional[str] = Field(None, max_length=300_000)


@router.patch("/team/me")
async def update_me(body: MeIn, user=Depends(staff_user)):
    upd = body.model_dump(exclude_unset=True)
    for k in ("phone", "whatsapp"):
        if upd.get(k):
            upd[k] = normalize_phone(upd[k])
    if upd.get("photo"):
        m = re.match(r"^data:(image/(?:png|jpeg|webp));base64,", upd["photo"])
        if not m or m.group(1) not in IMAGE_TYPES:
            raise HTTPException(422, "Photo must be a PNG, JPEG or WebP image")
    await db.users.update_one({"id": user["id"]}, {"$set": upd})
    await audit(user, "profile_updated", "users", user["id"], {k: ("(photo)" if k == "photo" else v) for k, v in upd.items()})
    return {"ok": True}


def _layout(people):
    """Positions for a top-down tree: returns {id: (x_center, level)} in 'slot' units and the total width."""
    kids = {}
    for p in people:
        kids.setdefault(p.get("reports_to"), []).append(p)
    for v in kids.values():
        v.sort(key=lambda p: (p.get("designation") or "", p["name"]))
    pos, cursor = {}, [0.0]

    def place(p, level):
        ch = kids.get(p["id"], [])
        if not ch:
            pos[p["id"]] = (cursor[0] + 0.5, level)
            cursor[0] += 1
            return pos[p["id"]][0]
        xs = [place(c, level + 1) for c in ch]
        pos[p["id"]] = ((xs[0] + xs[-1]) / 2, level)
        return pos[p["id"]][0]
    for root in kids.get(None, []):
        place(root, 0)
    return pos, cursor[0], kids


def org_pdf_bytes(company, people, branches):
    from io import BytesIO
    from reportlab.lib.pagesizes import A3, landscape
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas
    from pdf import draw_mark, INK, MUTED, RULE
    bname = {b["id"]: b["name"] for b in branches}
    W, H = landscape(A3)
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=(W, H))
    c.setTitle(f"Organisation chart · {company.get('name') or 'Sellandiamman Estates'}")

    def header(title):
        draw_mark(c, 15 * mm, H - 22 * mm, 9 * mm)
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold", 15)
        c.drawString(40 * mm, H - 17 * mm, title)
        c.setFont("Helvetica", 8.5)
        c.setFillColor(MUTED)
        c.drawString(40 * mm, H - 22 * mm, f"{company.get('name') or ''} · {company.get('phone') or ''} · {company.get('email') or ''}")
        c.drawRightString(W - 15 * mm, H - 17 * mm, f"{len(people)} people · {len(branches)} branches")
    header("Organisation chart")
    pos, width, kids = _layout(people)
    levels = max([lv for _, lv in pos.values()] or [0]) + 1
    box_w, box_h, gap_x, gap_y = 58 * mm, 24 * mm, 6 * mm, 12 * mm
    slot = box_w + gap_x
    scale = min(1.0, (W - 30 * mm) / max(1, width * slot), (H - 45 * mm) / max(1, levels * (box_h + gap_y)))
    ox = (W - width * slot * scale) / 2
    oy = H - 32 * mm

    def xy(pid):
        x, lv = pos[pid]
        return ox + x * slot * scale, oy - lv * (box_h + gap_y) * scale
    c.setStrokeColor(RULE)
    c.setLineWidth(0.8)
    for p in people:
        if p.get("reports_to") and p["id"] in pos and p["reports_to"] in pos:
            x1, y1 = xy(p["reports_to"])
            x2, y2 = xy(p["id"])
            mid = y1 - box_h * scale - (gap_y * scale) / 2
            c.line(x1, y1 - box_h * scale, x1, mid)
            c.line(x1, mid, x2, mid)
            c.line(x2, mid, x2, y2)
    for p in people:
        if p["id"] not in pos:
            continue
        cx, top = xy(p["id"])
        w, h = box_w * scale, box_h * scale
        c.setFillColor(colors.white)
        c.setStrokeColor(colors.HexColor("#94A3B8"))
        c.rect(cx - w / 2, top - h, w, h, fill=1, stroke=1)
        c.setFillColor(colors.HexColor("#0F172A"))
        c.rect(cx - w / 2, top - 1.4 * mm * scale, w, 1.4 * mm * scale, fill=1, stroke=0)
        fs = 8.6 * scale
        c.setFont("Helvetica-Bold", fs)
        c.drawCentredString(cx, top - 6 * mm * scale, p["name"][:34])
        c.setFont("Helvetica", fs * 0.86)
        c.setFillColor(MUTED)
        c.drawCentredString(cx, top - 10 * mm * scale, (p.get("designation") or p.get("role_label") or "")[:42])
        br = ", ".join(bname.get(b, "") for b in (p.get("branch_ids") or [])) or "All branches"
        c.drawCentredString(cx, top - 13.6 * mm * scale, br[:44])
        c.setFillColor(INK)
        c.drawCentredString(cx, top - 17.4 * mm * scale, (p.get("phone") or "")[:24])
        c.drawCentredString(cx, top - 21 * mm * scale, (p.get("email") or "")[:42])
    c.setFont("Helvetica", 7)
    c.setFillColor(MUTED)
    c.drawString(15 * mm, 9 * mm, "Organisation chart · internal contact list, do not share outside the company")
    c.showPage()
    # Page 2: directory by branch
    header("Team directory")
    y = H - 34 * mm
    cols = [15 * mm, 75 * mm, 140 * mm, 200 * mm, 250 * mm, 300 * mm]
    groups = [(b["id"], b["name"]) for b in branches] + [(None, "All branches / head office")]
    for bid, title in groups:
        members = [p for p in people if (bid in (p.get("branch_ids") or [])) or (bid is None and not p.get("branch_ids"))]
        if not members:
            continue
        if y < 30 * mm:
            c.showPage()
            header("Team directory")
            y = H - 34 * mm
        c.setFont("Helvetica-Bold", 10.5)
        c.setFillColor(INK)
        c.drawString(cols[0], y, title)
        y -= 6 * mm
        c.setFont("Helvetica-Bold", 7.5)
        c.setFillColor(MUTED)
        for x, t in zip(cols, ["Name", "Designation", "Department", "Phone", "WhatsApp", "Email"]):
            c.drawString(x, y, t.upper())
        y -= 5 * mm
        c.setFont("Helvetica", 8.6)
        c.setFillColor(INK)
        for p in sorted(members, key=lambda p: p["name"]):
            vals = [p["name"], p.get("designation") or p.get("role_label") or "", p.get("department") or "",
                    p.get("phone") or "", p.get("whatsapp") or "", p.get("email") or ""]
            for x, v in zip(cols, vals):
                c.drawString(x, y, str(v)[:40])
            y -= 5.2 * mm
            if y < 20 * mm:
                c.showPage()
                header("Team directory")
                y = H - 34 * mm
                c.setFont("Helvetica", 8.6)
        y -= 4 * mm
    c.save()
    return buf.getvalue()


@router.get("/team/org.pdf")
async def org_pdf(user=Depends(staff_user)):
    d = await org(user)
    await audit(user, "export", "users", "org_chart")
    return Response(org_pdf_bytes(d["company"], d["people"], d["branches"]), media_type="application/pdf",
                    headers={"Content-Disposition": "inline; filename=organisation-chart.pdf"})
