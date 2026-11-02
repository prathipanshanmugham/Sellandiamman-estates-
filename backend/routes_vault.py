"""Password vault for the company's platform logins: Airbnb, Booking.com, Agoda, MakeMyTrip, property portals,
TNREGINET, EB, GST, income tax, Google, Meta, domain and hosting, banking, Wi-Fi and door codes.

Secrets (password, 2-step key, notes and any field marked secret) are encrypted with AES-256-GCM using VAULT_KEY from
the server environment, so a copy of the database alone does not reveal them. Reading a secret needs the vault to be
unlocked with the person's own password (and 2-step code when they use one) for 15 minutes; every reveal, code and
change is written to the audit log. Logins are shared with roles or named people; the creator and administrators can
change them. Old passwords are kept (encrypted) so a change can be undone."""
import base64
import binascii
import json
import logging
import os
from datetime import timedelta
from typing import Optional, List
import jwt
import pyotp
from fastapi import APIRouter, HTTPException, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from core import (db, now, now_iso, new_id, require, can, audit, verify_password, rate_limit, ROLES, PORTAL_ROLES, PERMS,
                  JWT_SECRET, JWT_ALG, COOKIE_SECURE, today_ist, notify)

router = APIRouter(prefix="/vault")
log = logging.getLogger("sellandiamman")
UNLOCK_MINUTES = 15
HISTORY_KEEP = 10
CATEGORIES = {"short_stay": "Short-stay channels", "listing_portal": "Property portals", "government": "Government & registration",
              "tax": "Tax & compliance", "utilities": "Utilities (EB, water)", "banking": "Banking", "payments": "Payments",
              "marketing": "Marketing & social", "email": "Email & accounts", "web": "Website, domain & hosting",
              "property": "Property access (Wi-Fi, locks)", "other": "Other"}
# Starting points so staff don't type URLs; the hint says what the login name usually is on that site.
PRESETS = [
    {"key": "airbnb", "name": "Airbnb (host account)", "url": "https://www.airbnb.co.in/hosting", "category": "short_stay", "hint": "Email or mobile", "rotate_days": 180},
    {"key": "booking_com", "name": "Booking.com extranet", "url": "https://admin.booking.com", "category": "short_stay", "hint": "Login name", "fields": ["Property ID"], "rotate_days": 180},
    {"key": "agoda", "name": "Agoda YCS", "url": "https://ycs.agoda.com", "category": "short_stay", "hint": "Email", "fields": ["Property ID"], "rotate_days": 180},
    {"key": "mmt", "name": "MakeMyTrip / Goibibo (InGo-MMT)", "url": "https://in.goibibo.com/extranet/", "category": "short_stay", "hint": "Email or mobile", "fields": ["Hotel code"], "rotate_days": 180},
    {"key": "vrbo", "name": "Vrbo", "url": "https://www.vrbo.com", "category": "short_stay", "hint": "Email", "rotate_days": 180},
    {"key": "expedia", "name": "Expedia Partner Central", "url": "https://apps.expediapartnercentral.com", "category": "short_stay", "hint": "Username", "fields": ["Property ID"], "rotate_days": 180},
    {"key": "99acres", "name": "99acres", "url": "https://www.99acres.com", "category": "listing_portal", "hint": "Email or mobile"},
    {"key": "magicbricks", "name": "MagicBricks", "url": "https://www.magicbricks.com", "category": "listing_portal", "hint": "Email or mobile"},
    {"key": "housing", "name": "Housing.com", "url": "https://housing.com", "category": "listing_portal", "hint": "Mobile"},
    {"key": "nobroker", "name": "NoBroker", "url": "https://www.nobroker.in", "category": "listing_portal", "hint": "Mobile"},
    {"key": "olx", "name": "OLX", "url": "https://www.olx.in", "category": "listing_portal", "hint": "Mobile"},
    {"key": "tnreginet", "name": "TNREGINET (registration)", "url": "https://tnreginet.gov.in", "category": "government", "hint": "User ID"},
    {"key": "tnrera", "name": "TNRERA", "url": "https://rera.tn.gov.in", "category": "government", "hint": "User ID", "fields": ["Registration no."]},
    {"key": "tangedco", "name": "TNPDCL / TANGEDCO (EB)", "url": "https://www.tnebltd.gov.in", "category": "utilities", "hint": "User ID", "fields": ["Service connection no."]},
    {"key": "gst", "name": "GST portal", "url": "https://services.gst.gov.in", "category": "tax", "hint": "Username", "fields": ["GSTIN"], "rotate_days": 90},
    {"key": "income_tax", "name": "Income Tax e-filing", "url": "https://eportal.incometax.gov.in", "category": "tax", "hint": "PAN", "rotate_days": 90},
    {"key": "traces", "name": "TRACES (TDS)", "url": "https://www.tdscpc.gov.in", "category": "tax", "hint": "User ID", "fields": ["TAN"], "rotate_days": 90},
    {"key": "mca", "name": "MCA21", "url": "https://www.mca.gov.in", "category": "government", "hint": "User ID"},
    {"key": "google_business", "name": "Google Business Profile", "url": "https://business.google.com", "category": "marketing", "hint": "Google account"},
    {"key": "google", "name": "Google account / Gmail", "url": "https://accounts.google.com", "category": "email", "hint": "Email", "rotate_days": 180},
    {"key": "meta", "name": "Facebook / Instagram (Meta Business)", "url": "https://business.facebook.com", "category": "marketing", "hint": "Email"},
    {"key": "whatsapp_business", "name": "WhatsApp Business", "url": "https://business.whatsapp.com", "category": "marketing", "hint": "Phone number"},
    {"key": "youtube", "name": "YouTube", "url": "https://studio.youtube.com", "category": "marketing", "hint": "Google account"},
    {"key": "linkedin", "name": "LinkedIn", "url": "https://www.linkedin.com", "category": "marketing", "hint": "Email"},
    {"key": "godaddy", "name": "GoDaddy (domain)", "url": "https://sso.godaddy.com", "category": "web", "hint": "Customer number or email", "rotate_days": 180},
    {"key": "hostinger", "name": "Hostinger (server)", "url": "https://hpanel.hostinger.com", "category": "web", "hint": "Email", "rotate_days": 180},
    {"key": "razorpay", "name": "Razorpay", "url": "https://dashboard.razorpay.com", "category": "payments", "hint": "Email", "rotate_days": 90},
    {"key": "phonepe_business", "name": "PhonePe Business", "url": "https://business.phonepe.com", "category": "payments", "hint": "Mobile"},
    {"key": "paytm_business", "name": "Paytm for Business", "url": "https://dashboard.paytm.com", "category": "payments", "hint": "Mobile"},
    {"key": "bank", "name": "Net banking", "url": "", "category": "banking", "hint": "User ID", "fields": ["Corporate ID"], "rotate_days": 90},
    {"key": "wifi", "name": "Wi-Fi network", "url": "", "category": "property", "hint": "Network name (SSID)"},
    {"key": "door_code", "name": "Smart lock or key-safe code", "url": "", "category": "property", "hint": "Lock name"},
    {"key": "other", "name": "Other", "url": "", "category": "other", "hint": "Username"},
]
PRESET = {p["key"]: p for p in PRESETS}
# roles a login can be shared with: staff roles that may open the vault at all (never the auditor or customers)
STAFF_ROLE_KEYS = [r for r in ROLES if r not in PORTAL_ROLES and "r" in PERMS.get(r, {}).get("vault", "")]


# ---------------- Encryption ----------------
def _key():
    raw = (os.environ.get("VAULT_KEY") or "").strip()
    if not raw:
        return None
    for dec in (base64.urlsafe_b64decode, base64.b64decode, bytes.fromhex):
        try:
            k = dec(raw + "=" * (-len(raw) % 4)) if dec is not bytes.fromhex else dec(raw)
            if len(k) == 32:
                return k
        except (binascii.Error, ValueError):
            continue
    log.warning("VAULT_KEY is set but is not 32 bytes (base64 or hex); the password vault stays switched off")
    return None


def configured():
    return _key() is not None


def _need_key():
    k = _key()
    if not k:
        raise HTTPException(503, "vault_not_configured")
    return k


def encrypt(item_id: str, payload: dict) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = os.urandom(12)
    ct = AESGCM(_need_key()).encrypt(nonce, json.dumps(payload).encode(), f"vault:{item_id}".encode())
    return "v1:" + base64.b64encode(nonce + ct).decode()


def decrypt(item_id: str, blob: str) -> dict:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.exceptions import InvalidTag
    if not blob:
        return {}
    if not blob.startswith("v1:"):
        raise HTTPException(500, "Unknown vault format")
    data = base64.b64decode(blob[3:])
    try:
        return json.loads(AESGCM(_need_key()).decrypt(data[:12], data[12:], f"vault:{item_id}".encode()))
    except InvalidTag:
        raise HTTPException(500, "This login cannot be read with the current VAULT_KEY")


# ---------------- Unlock ----------------
class UnlockIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)
    code: Optional[str] = Field(None, max_length=12)


def _token(request: Request):
    return request.cookies.get("vault_token")


def unlocked_until(request: Request, user):
    tok = _token(request)
    if not tok:
        return None
    try:
        p = jwt.decode(tok, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.InvalidTokenError:
        return None
    if p.get("typ") != "vault" or p.get("sub") != user["id"] or p.get("sid") != user.get("sid"):
        return None
    return p["exp"]


def need_unlock(request: Request, user):
    if not unlocked_until(request, user):
        raise HTTPException(423, "vault_locked")


def _nostore(data):
    return JSONResponse(data, headers={"Cache-Control": "no-store", "Pragma": "no-cache"})


@router.get("/status")
async def status(request: Request, user=Depends(require("vault", "r"))):
    until = unlocked_until(request, user)
    return {"configured": configured(), "unlocked": bool(until), "until": until, "mfa": bool(user.get("mfa_enabled")),
            "can_add": can(user, "vault", "w"), "can_manage": can(user, "vault", "a")}


@router.post("/unlock")
async def unlock(body: UnlockIn, request: Request, response: Response, user=Depends(require("vault", "r"))):
    rate_limit(request, f"vault-unlock:{user['id']}", 5, 900)
    _need_key()
    full = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 1, "mfa_enabled": 1, "mfa_secret": 1})
    if not full or not verify_password(body.password, full.get("password_hash") or ""):
        await audit(user, "vault_unlock_failed", "vault", None)
        raise HTTPException(401, "That password is not right")
    if full.get("mfa_enabled"):
        code = (body.code or "").strip().replace(" ", "")
        if not (code.isdigit() and pyotp.TOTP(full["mfa_secret"]).verify(code, valid_window=1)):
            await audit(user, "vault_unlock_failed", "vault", None, {"reason": "2-step code"})
            raise HTTPException(401, "Enter the current 6-digit code from your authenticator app")
    exp = now() + timedelta(minutes=UNLOCK_MINUTES)
    tok = jwt.encode({"sub": user["id"], "sid": user.get("sid"), "typ": "vault", "exp": exp}, JWT_SECRET, algorithm=JWT_ALG)
    response.set_cookie("vault_token", tok, httponly=True, secure=COOKIE_SECURE, samesite="strict",
                        max_age=UNLOCK_MINUTES * 60, path="/api/vault")
    await audit(user, "vault_unlocked", "vault", None)
    return {"ok": True, "until": int(exp.timestamp())}


@router.post("/lock")
async def lock(response: Response, user=Depends(require("vault", "r"))):
    response.delete_cookie("vault_token", path="/api/vault")
    return {"ok": True}


# ---------------- Items ----------------
class FieldIn(BaseModel):
    label: str = Field(min_length=1, max_length=40)
    value: str = Field("", max_length=500)
    secret: bool = False


class ItemIn(BaseModel):
    title: str = Field(min_length=2, max_length=80)
    preset: str = "other"
    category: Optional[str] = None
    url: Optional[str] = Field(None, max_length=300)
    username: Optional[str] = Field(None, max_length=160)
    password: Optional[str] = Field(None, max_length=500)
    totp_secret: Optional[str] = Field(None, max_length=200)
    notes: Optional[str] = Field(None, max_length=3000)
    fields: List[FieldIn] = []
    property_ids: List[str] = []
    share_roles: List[str] = []
    share_users: List[str] = []
    rotate_days: int = Field(0, ge=0, le=730)
    tags: List[str] = []


class ItemPatch(BaseModel):
    title: Optional[str] = Field(None, min_length=2, max_length=80)
    category: Optional[str] = None
    url: Optional[str] = Field(None, max_length=300)
    username: Optional[str] = Field(None, max_length=160)
    password: Optional[str] = Field(None, max_length=500)
    totp_secret: Optional[str] = Field(None, max_length=200)
    notes: Optional[str] = Field(None, max_length=3000)
    fields: Optional[List[FieldIn]] = None
    property_ids: Optional[List[str]] = None
    share_roles: Optional[List[str]] = None
    share_users: Optional[List[str]] = None
    rotate_days: Optional[int] = Field(None, ge=0, le=730)
    tags: Optional[List[str]] = None


def _visible_filter(user):
    f = {"deleted": {"$ne": True}}
    if not can(user, "vault", "a"):
        f["$or"] = [{"created_by": user["id"]}, {"share_roles": user["role"]}, {"share_users": user["id"]}]
    return f


def _can_edit(user, item):
    return can(user, "vault", "a") or (item.get("created_by") == user["id"] and can(user, "vault", "w"))


def _clean_totp(s):
    if not s:
        return None
    s = s.strip()
    if s.startswith("otpauth://"):
        from urllib.parse import urlparse, parse_qs
        s = (parse_qs(urlparse(s).query).get("secret") or [""])[0]
    s = s.replace(" ", "").upper()
    try:
        pyotp.TOTP(s).now()
    except (binascii.Error, ValueError, TypeError):
        raise HTTPException(422, "That 2-step key is not valid. Paste the setup key (letters and digits) or the otpauth:// link.")
    return s


def _view(user, it):
    out = {k: v for k, v in it.items() if k not in ("_id", "secret")}
    days = it.get("rotate_days") or 0
    changed = (it.get("password_changed_at") or it["created_at"])[:10]
    out["rotate_due"] = bool(days) and it.get("has_password") and changed <= (today_ist() - timedelta(days=days)).isoformat()
    out["can_edit"] = _can_edit(user, it)
    out["category_label"] = CATEGORIES.get(it.get("category"), "Other")
    return out


async def _valid_share(roles, users):
    roles = [r for r in roles if r in STAFF_ROLE_KEYS]
    ok = {u["id"] for u in await db.users.find({"id": {"$in": users}, "active": True, "role": {"$in": STAFF_ROLE_KEYS}},
                                               {"_id": 0, "id": 1}).to_list(200)} if users else set()
    return roles, [u for u in users if u in ok]


async def _get(user, iid):
    it = await db.vault_items.find_one({"id": iid, **_visible_filter(user)}, {"_id": 0})
    if not it:
        raise HTTPException(404, "Login not found")
    return it


def _split_fields(fields):
    pub = [{"label": f.label.strip(), "value": f.value.strip()} for f in fields if not f.secret and f.label.strip()]
    sec = [{"label": f.label.strip(), "value": f.value} for f in fields if f.secret and f.label.strip()]
    return pub, sec


@router.get("/meta")
async def meta(user=Depends(require("vault", "r"))):
    return {"presets": PRESETS, "categories": [{"key": k, "label": v} for k, v in CATEGORIES.items()],
            "roles": [{"key": k, "label": ROLES[k]} for k in STAFF_ROLE_KEYS], "configured": configured()}


@router.get("/items")
async def list_items(category: Optional[str] = None, q: Optional[str] = None, property_id: Optional[str] = None,
                     due: bool = False, user=Depends(require("vault", "r"))):
    f = _visible_filter(user)
    if category:
        f["category"] = category
    if property_id:
        f["property_ids"] = property_id
    if q:
        rx = {"$regex": q[:40].replace("\\", ""), "$options": "i"}
        f.setdefault("$and", []).append({"$or": [{"title": rx}, {"username": rx}, {"url": rx}, {"tags": rx}]})
    rows = [_view(user, it) for it in await db.vault_items.find(f, {"_id": 0, "secret": 0}).sort("title", 1).to_list(2000)]
    if due:
        rows = [r for r in rows if r["rotate_due"]]
    return rows


@router.post("/items")
async def create_item(body: ItemIn, request: Request, user=Depends(require("vault", "w"))):
    need_unlock(request, user)
    preset = PRESET.get(body.preset) or PRESET["other"]
    pub, sec = _split_fields(body.fields)
    roles, users = await _valid_share(body.share_roles, body.share_users)
    iid = new_id()
    totp = _clean_totp(body.totp_secret)
    secret = {"password": body.password or "", "totp": totp, "notes": body.notes or "", "fields": sec}
    it = {"id": iid, "title": body.title.strip(), "preset": preset["key"], "category": body.category if body.category in CATEGORIES else preset["category"],
          "url": (body.url or preset.get("url") or "").strip() or None, "username": (body.username or "").strip() or None,
          "fields_public": pub, "secret_labels": [x["label"] for x in sec], "secret": encrypt(iid, secret),
          "has_password": bool(body.password), "has_totp": bool(totp), "has_notes": bool(body.notes),
          "property_ids": body.property_ids[:50], "share_roles": roles, "share_users": users,
          "rotate_days": body.rotate_days, "tags": sorted({t.strip().lower()[:24] for t in body.tags if t.strip()})[:10],
          "password_changed_at": now_iso() if body.password else None, "created_by": user["id"], "created_by_name": user["name"],
          "created_at": now_iso(), "updated_at": now_iso(), "deleted": False}
    await db.vault_items.insert_one(dict(it))
    await audit(user, "vault_item_created", "vault", iid, {"title": it["title"], "shared_roles": roles, "shared_users": len(users)})
    return _view(user, it)


@router.get("/items/{iid}")
async def get_item(iid: str, user=Depends(require("vault", "r"))):
    it = await _get(user, iid)
    v = _view(user, it)
    v["history_count"] = await db.vault_history.count_documents({"item_id": iid})
    if v["share_users"]:
        v["share_user_names"] = {u["id"]: u["name"] for u in await db.users.find({"id": {"$in": v["share_users"]}}, {"_id": 0, "id": 1, "name": 1}).to_list(200)}
    return v


@router.patch("/items/{iid}")
async def update_item(iid: str, body: ItemPatch, request: Request, user=Depends(require("vault", "r"))):
    need_unlock(request, user)
    it = await _get(user, iid)
    if not _can_edit(user, it):
        raise HTTPException(403, "Only the person who added this login or an administrator can change it")
    data = body.model_dump(exclude_unset=True)
    upd, changes = {"updated_at": now_iso()}, []
    for k in ("title", "url", "username"):
        if k in data:
            upd[k] = (data[k] or "").strip() or None
            changes.append(k)
    if data.get("category") in CATEGORIES:
        upd["category"] = data["category"]
    if "rotate_days" in data:
        upd["rotate_days"] = data["rotate_days"]
    if "tags" in data:
        upd["tags"] = sorted({t.strip().lower()[:24] for t in data["tags"] or [] if t.strip()})[:10]
    if "property_ids" in data:
        upd["property_ids"] = (data["property_ids"] or [])[:50]
    if "share_roles" in data or "share_users" in data:
        roles, users = await _valid_share(data.get("share_roles", it.get("share_roles", [])), data.get("share_users", it.get("share_users", [])))
        upd.update({"share_roles": roles, "share_users": users})
        changes.append("sharing")
    if any(k in data for k in ("password", "totp_secret", "notes", "fields")):
        sec = decrypt(iid, it["secret"])
        if "password" in data and (data["password"] or "") != sec.get("password", ""):
            if sec.get("password"):
                await db.vault_history.insert_one({"id": new_id(), "item_id": iid, "secret": it["secret"], "at": now_iso(),
                                                   "by": user["name"], "user_id": user["id"]})
                old = await db.vault_history.find({"item_id": iid}, {"_id": 0, "id": 1}).sort("at", -1).skip(HISTORY_KEEP).to_list(100)
                if old:
                    await db.vault_history.delete_many({"id": {"$in": [o["id"] for o in old]}})
            sec["password"] = data["password"] or ""
            upd["password_changed_at"] = now_iso()
            upd["has_password"] = bool(sec["password"])
            changes.append("password")
        if "totp_secret" in data:
            sec["totp"] = _clean_totp(data["totp_secret"])
            upd["has_totp"] = bool(sec["totp"])
            changes.append("2-step key")
        if "notes" in data:
            sec["notes"] = data["notes"] or ""
            upd["has_notes"] = bool(sec["notes"])
            changes.append("notes")
        if "fields" in data:
            pub, secf = _split_fields([FieldIn(**f) for f in data["fields"] or []])
            sec["fields"] = secf
            upd.update({"fields_public": pub, "secret_labels": [x["label"] for x in secf]})
            changes.append("fields")
        upd["secret"] = encrypt(iid, sec)
    await db.vault_items.update_one({"id": iid}, {"$set": upd})
    await audit(user, "vault_item_updated", "vault", iid, {"title": it["title"], "changed": changes})
    return _view(user, {**it, **upd})


@router.delete("/items/{iid}")
async def delete_item(iid: str, user=Depends(require("vault", "r"))):
    it = await _get(user, iid)
    if not _can_edit(user, it):
        raise HTTPException(403, "Only the person who added this login or an administrator can delete it")
    await db.vault_items.update_one({"id": iid}, {"$set": {"deleted": True, "deleted_at": now_iso(), "deleted_by": user["name"]}})
    await audit(user, "vault_item_deleted", "vault", iid, {"title": it["title"]})
    return {"ok": True}


class RevealIn(BaseModel):
    field: str = Field(min_length=1, max_length=60)
    purpose: str = Field("view", pattern=r"^(view|copy)$")


@router.post("/items/{iid}/reveal")
async def reveal(iid: str, body: RevealIn, request: Request, user=Depends(require("vault", "r"))):
    need_unlock(request, user)
    it = await _get(user, iid)
    sec = decrypt(iid, it["secret"])
    if body.field == "password":
        value = sec.get("password") or ""
    elif body.field == "notes":
        value = sec.get("notes") or ""
    elif body.field == "totp_secret":
        if not _can_edit(user, it):
            raise HTTPException(403, "Only the person who added this login or an administrator can see the 2-step key")
        value = sec.get("totp") or ""
    elif body.field.startswith("field:"):
        label = body.field[6:]
        value = next((f["value"] for f in sec.get("fields", []) if f["label"] == label), None)
        if value is None:
            raise HTTPException(404, "No such field")
    else:
        raise HTTPException(422, "Unknown field")
    await db.vault_items.update_one({"id": iid}, {"$set": {"last_used_at": now_iso(), "last_used_by": user["name"]}})
    await audit(user, f"vault_{body.purpose}", "vault", iid, {"title": it["title"], "field": body.field})
    return _nostore({"value": value})


@router.post("/items/{iid}/code")
async def totp_code(iid: str, request: Request, user=Depends(require("vault", "r"))):
    """The current 2-step code for a shared login, so the team can sign in without the key leaving the vault."""
    need_unlock(request, user)
    it = await _get(user, iid)
    sec = decrypt(iid, it["secret"])
    if not sec.get("totp"):
        raise HTTPException(404, "This login has no 2-step key saved")
    t = pyotp.TOTP(sec["totp"])
    import time
    remaining = 30 - int(time.time()) % 30
    await audit(user, "vault_code", "vault", iid, {"title": it["title"]})
    return _nostore({"code": t.now(), "seconds_left": remaining})


@router.get("/items/{iid}/history")
async def history(iid: str, request: Request, user=Depends(require("vault", "r"))):
    it = await _get(user, iid)
    if not _can_edit(user, it):
        raise HTTPException(403, "Only the person who added this login or an administrator can see old passwords")
    return await db.vault_history.find({"item_id": iid}, {"_id": 0, "secret": 0}).sort("at", -1).to_list(HISTORY_KEEP)


@router.post("/items/{iid}/history/{hid}/reveal")
async def history_reveal(iid: str, hid: str, request: Request, user=Depends(require("vault", "r"))):
    need_unlock(request, user)
    it = await _get(user, iid)
    if not _can_edit(user, it):
        raise HTTPException(403, "Only the person who added this login or an administrator can see old passwords")
    h = await db.vault_history.find_one({"id": hid, "item_id": iid}, {"_id": 0})
    if not h:
        raise HTTPException(404, "Not found")
    await audit(user, "vault_view_old_password", "vault", iid, {"title": it["title"], "from": h["at"]})
    return _nostore({"value": decrypt(iid, h["secret"]).get("password", ""), "at": h["at"]})


@router.get("/activity")
async def activity(item_id: Optional[str] = None, user=Depends(require("vault", "r"))):
    """Who opened, copied or changed vault logins. Administrators see everything; others see their own logins."""
    f = {"entity": "vault"}
    if item_id:
        await _get(user, item_id)
        f["entity_id"] = item_id
    elif not can(user, "vault", "a"):
        mine = [x["id"] for x in await db.vault_items.find({"created_by": user["id"]}, {"_id": 0, "id": 1}).to_list(2000)]
        f["$or"] = [{"entity_id": {"$in": mine}}, {"user_id": user["id"]}]
    return await db.audit_logs.find(f, {"_id": 0, "ip": 0}).sort("at", -1).to_list(300)


async def rotation_reminders():
    """Weekly nudge to the person who added a login whose password is older than its change interval."""
    if not configured():
        return 0
    n = 0
    week = today_ist().strftime("%G-W%V")
    for it in await db.vault_items.find({"deleted": {"$ne": True}, "rotate_days": {"$gt": 0}, "has_password": True}, {"_id": 0, "secret": 0}).to_list(5000):
        changed = (it.get("password_changed_at") or it["created_at"])[:10]
        if changed <= (today_ist() - timedelta(days=it["rotate_days"])).isoformat():
            await notify([it["created_by"]], f"Time to change the {it['title']} password", f"Last changed {changed}", "/erp/vault?due=1",
                         dedupe=f"vault-rotate:{it['id']}:{week}")
            n += 1
    return n
