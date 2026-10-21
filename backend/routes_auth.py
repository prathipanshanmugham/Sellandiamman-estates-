import hashlib
import io
import secrets
from datetime import timedelta
from typing import Optional, List
import jwt
import pyotp
from fastapi import APIRouter, Request, Response, HTTPException, Depends
from pydantic import BaseModel, Field
from core import (db, now, now_iso, new_id, hash_password, verify_password, current_user, staff_user, require, audit,
                  public_user, client_ip, rate_limit, send_email, get_settings_cached, mfa_required_for,
                  JWT_SECRET, JWT_ALG, SESSION_HOURS, ROLES, COOKIE_SECURE, SITE_URL, PORTAL_ROLES)

router = APIRouter()
EMAIL_RE = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
MFA_ISSUER = "Sellandiamman Estates"


class LoginIn(BaseModel):
    email: str = Field(pattern=EMAIL_RE, max_length=200)
    password: str = Field(min_length=1, max_length=200)


class MfaLoginIn(BaseModel):
    mfa_token: str = Field(min_length=10, max_length=2000)
    code: str = Field(min_length=6, max_length=20)


class CodeIn(BaseModel):
    code: str = Field(min_length=6, max_length=20)


class DisableMfaIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)
    code: str = Field(min_length=6, max_length=20)


class ForgotIn(BaseModel):
    email: str = Field(max_length=200)


class ResetIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    password: str = Field(min_length=8, max_length=200)


class ChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=200)


class UserIn(BaseModel):
    email: str = Field(pattern=EMAIL_RE, max_length=200)
    name: str = Field(min_length=2, max_length=100)
    role: str
    phone: Optional[str] = None
    branch_ids: List[str] = []
    owner_id: Optional[str] = None
    investor_id: Optional[str] = None
    customer_id: Optional[str] = None
    password: Optional[str] = Field(None, min_length=8, max_length=200)
    designation: Optional[str] = Field(None, max_length=80)
    department: Optional[str] = Field(None, max_length=60)
    reports_to: Optional[str] = None
    whatsapp: Optional[str] = Field(None, max_length=20)
    joined_on: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class UserPatch(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    phone: Optional[str] = None
    branch_ids: Optional[List[str]] = None
    active: Optional[bool] = None
    designation: Optional[str] = Field(None, max_length=80)
    department: Optional[str] = Field(None, max_length=60)
    reports_to: Optional[str] = None
    whatsapp: Optional[str] = Field(None, max_length=20)
    show_in_directory: Optional[bool] = None
    joined_on: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")


async def _check_branches(ids):
    ids = [i for i in (ids or []) if i]
    if ids and await db.branches.count_documents({"id": {"$in": ids}}) != len(set(ids)):
        raise HTTPException(422, "Unknown branch")
    return list(dict.fromkeys(ids))


async def _check_manager(uid, reports_to):
    """reports_to must be another active staff member, and must not make a loop."""
    if not reports_to:
        return None
    seen, cur = {uid}, reports_to
    while cur:
        if cur in seen:
            raise HTTPException(422, "That reporting line would make a loop")
        seen.add(cur)
        m = await db.users.find_one({"id": cur}, {"_id": 0, "reports_to": 1, "role": 1})
        if not m or m["role"] in PORTAL_ROLES:
            raise HTTPException(422, "Choose a staff member as the manager")
        cur = m.get("reports_to")
    return reports_to


def _cookie(response: Response, token: str):
    response.set_cookie("access_token", token, httponly=True, secure=COOKIE_SECURE, samesite="lax",
                        max_age=SESSION_HOURS * 3600, path="/")


async def _start_session(user, request: Request, response: Response, mfa: bool = False):
    sid = secrets.token_urlsafe(24)
    await db.sessions.insert_one({"sid": sid, "user_id": user["id"], "created_at": now(), "revoked": False,
                                  "expires_at": now() + timedelta(hours=SESSION_HOURS), "ip": client_ip(request),
                                  "mfa": mfa, "user_agent": (request.headers.get("user-agent") or "")[:200]})
    token = jwt.encode({"sub": user["id"], "sid": sid, "exp": now() + timedelta(hours=SESSION_HOURS)},
                       JWT_SECRET, algorithm=JWT_ALG)
    _cookie(response, token)
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login": now_iso()}})
    await audit(user, "login", "auth", user["id"], {"mfa": mfa})
    return public_user(user, await get_settings_cached())


async def _check_attempts(keys):
    for key, limit in keys:
        att = await db.login_attempts.find_one({"identifier": key})
        if att and att["last"] < now() - timedelta(minutes=15):
            await db.login_attempts.delete_one({"identifier": key})
        elif att and att.get("count", 0) >= limit:
            raise HTTPException(429, "Too many failed attempts. Try again in 15 minutes.")


async def _fail(keys):
    for key, _ in keys:
        await db.login_attempts.update_one({"identifier": key}, {"$inc": {"count": 1}, "$set": {"last": now()}},
                                           upsert=True)


@router.post("/auth/login")
async def login(body: LoginIn, request: Request, response: Response):
    rate_limit(request, "login", 60, 300)
    email = body.email.strip().lower()
    keys = ((f"{client_ip(request)}:{email}", 5), (f"email:{email}", 20))
    await _check_attempts(keys)
    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash") or not verify_password(body.password, user["password_hash"]):
        await _fail(keys)
        raise HTTPException(401, "Invalid email or password")
    if not user.get("active"):
        raise HTTPException(403, "This account is not active")
    await db.login_attempts.delete_many({"identifier": {"$in": [k for k, _ in keys]}})
    if user.get("mfa_enabled"):
        tok = jwt.encode({"sub": user["id"], "typ": "mfa", "exp": now() + timedelta(minutes=5)}, JWT_SECRET,
                         algorithm=JWT_ALG)
        return {"mfa_required": True, "mfa_token": tok}
    return await _start_session(user, request, response)


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.strip().upper().replace("-", "").encode()).hexdigest()


def _check_totp(secret: str, code: str) -> bool:
    code = code.strip().replace(" ", "")
    return bool(secret) and code.isdigit() and pyotp.TOTP(secret).verify(code, valid_window=1)


@router.post("/auth/mfa/login")
async def mfa_login(body: MfaLoginIn, request: Request, response: Response):
    rate_limit(request, "mfa", 20, 300)
    try:
        p = jwt.decode(body.mfa_token, JWT_SECRET, algorithms=[JWT_ALG])
        if p.get("typ") != "mfa":
            raise jwt.InvalidTokenError()
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Your sign-in step expired. Please sign in again.")
    keys = ((f"mfa:{p['sub']}", 6),)
    await _check_attempts(keys)
    user = await db.users.find_one({"id": p["sub"], "active": True})
    if not user or not user.get("mfa_enabled"):
        raise HTTPException(401, "Please sign in again.")
    ok = _check_totp(user.get("mfa_secret"), body.code)
    used_recovery = False
    if not ok:
        h = _hash_code(body.code)
        if h in (user.get("mfa_recovery") or []):
            await db.users.update_one({"id": user["id"]}, {"$pull": {"mfa_recovery": h}})
            ok = used_recovery = True
    if not ok:
        await _fail(keys)
        raise HTTPException(401, "That code is not correct. Check the time on your phone and try again.")
    await db.login_attempts.delete_many({"identifier": keys[0][0]})
    if used_recovery:
        await audit(user, "mfa_recovery_code_used", "auth", user["id"])
    return await _start_session(user, request, response, mfa=True)


@router.post("/auth/logout")
async def logout(response: Response, user=Depends(current_user)):
    await db.sessions.update_one({"sid": user["sid"]}, {"$set": {"revoked": True}})
    response.delete_cookie("access_token", path="/")
    await audit(user, "logout", "auth", user["id"])
    return {"ok": True}


@router.get("/auth/me")
async def me(user=Depends(current_user)):
    return public_user(user, await get_settings_cached())


@router.get("/auth/session")
async def session(request: Request):
    """Like /auth/me, but answers {"user": null} instead of 401 when nobody is signed in (used on page load)."""
    try:
        user = await current_user(request)
    except HTTPException as e:
        if e.detail == "mfa_setup_required":
            raise
        return {"user": None}
    return {"user": public_user(user, await get_settings_cached())}


# ---------- 2-step sign-in (TOTP authenticator apps) ----------
def _qr_svg(uri: str) -> str:
    import qrcode
    import qrcode.image.svg
    img = qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage, box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue().decode()


@router.post("/auth/mfa/setup")
async def mfa_setup(user=Depends(current_user)):
    if user.get("mfa_enabled"):
        raise HTTPException(409, "2-step sign-in is already on. Turn it off first to set up a new phone.")
    secret = pyotp.random_base32()
    await db.users.update_one({"id": user["id"]}, {"$set": {"mfa_pending_secret": secret}})
    uri = pyotp.TOTP(secret).provisioning_uri(name=user["email"], issuer_name=MFA_ISSUER)
    return {"secret": secret, "otpauth_uri": uri, "qr_svg": _qr_svg(uri)}


@router.post("/auth/mfa/enable")
async def mfa_enable(body: CodeIn, user=Depends(current_user)):
    full = await db.users.find_one({"id": user["id"]})
    if not _check_totp(full.get("mfa_pending_secret"), body.code):
        raise HTTPException(422, "That code is not correct. Enter the 6-digit code shown in your authenticator app.")
    codes = ["-".join([secrets.token_hex(2).upper(), secrets.token_hex(2).upper()]) for _ in range(8)]
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "mfa_enabled": True, "mfa_secret": full["mfa_pending_secret"], "mfa_enabled_at": now_iso(),
        "mfa_recovery": [_hash_code(c) for c in codes]}, "$unset": {"mfa_pending_secret": ""}})
    await db.sessions.update_many({"user_id": user["id"], "sid": {"$ne": user["sid"]}}, {"$set": {"revoked": True}})
    await audit(user, "mfa_enabled", "auth", user["id"])
    return {"ok": True, "recovery_codes": codes}


@router.post("/auth/mfa/disable")
async def mfa_disable(body: DisableMfaIn, user=Depends(current_user)):
    full = await db.users.find_one({"id": user["id"]})
    if mfa_required_for(full, await get_settings_cached()):
        raise HTTPException(422, "2-step sign-in is required for your role and cannot be turned off.")
    if not verify_password(body.password, full.get("password_hash") or ""):
        raise HTTPException(400, "Password is incorrect")
    if not _check_totp(full.get("mfa_secret"), body.code):
        raise HTTPException(400, "That code is not correct")
    await db.users.update_one({"id": user["id"]}, {"$set": {"mfa_enabled": False},
                                                   "$unset": {"mfa_secret": "", "mfa_recovery": ""}})
    await audit(user, "mfa_disabled", "auth", user["id"])
    return {"ok": True}


# ---------- Password reset & activation ----------
PORTAL_LOGIN = {"owner": ("owner", "owner / lessor", "your properties, rent collected, monthly statements, bills and repair requests"),
                "investor": ("investor", "investor", "your holdings, payouts, statements and project updates"),
                "tenant": ("tenant", "tenant", "your rent, receipts, electricity and other bills, deposit, documents and service requests"),
                "buyer": ("buyer", "buyer", "the progress of your purchase, site visits, documents and service requests")}


async def _issue_token(user, purpose):
    token = secrets.token_urlsafe(32)
    portal = PORTAL_LOGIN.get(user.get("role"))
    hours = (24 * 7 if portal else 24) if purpose == "activation" else 1
    await db.password_reset_tokens.insert_one({"token": token, "user_id": user["id"], "purpose": purpose,
                                               "used": False, "expires_at": now() + timedelta(hours=hours)})
    link = f"{SITE_URL}/erp/reset-password?token={token}"
    if purpose == "activation" and portal:
        subject = f"Your Sellandiamman Estates {portal[1]} login"
        text = (f"Hello {user.get('name') or ''},\n\nWe have opened a {portal[1]} login for you. In it you can see {portal[2]}, "
                f"and raise requests with us at any time.\n\nSet your password within 7 days using this link:\n{link}\n\n"
                f"After that, sign in at {SITE_URL}/login/{portal[0]} with this email address.\n\n"
                "If you were not expecting this, ignore this email.")
    elif purpose == "activation":
        subject = "Your Sellandiamman Estates account"
        text = (f"Hello {user.get('name') or ''},\n\nAn account has been created for you. Set your password within "
                f"24 hours using this link:\n{link}\n\nIf you were not expecting this, ignore this email.")
    else:
        subject = "Reset your Sellandiamman Estates password"
        text = (f"Hello {user.get('name') or ''},\n\nUse this link within 1 hour to set a new password:\n{link}\n\n"
                "If you did not ask for this, you can ignore this email.")
    status = await send_email(user["email"], subject, text)
    return link, status


@router.post("/auth/forgot-password")
async def forgot(body: ForgotIn, request: Request):
    rate_limit(request, "forgot", 5, 900)
    user = await db.users.find_one({"email": body.email.strip().lower(), "active": True})
    if user:
        await _issue_token(user, "reset")
    return {"ok": True, "message": "If the account exists, a reset link has been sent."}


@router.post("/auth/reset-password")
async def reset(body: ResetIn, request: Request):
    rate_limit(request, "reset", 10, 900)
    t = await db.password_reset_tokens.find_one({"token": body.token, "used": False})
    if not t or t["expires_at"] < now():
        raise HTTPException(400, "This link is invalid or has expired")
    upd = {"password_hash": hash_password(body.password)}
    if t["purpose"] == "activation":
        upd["active"] = True
    await db.users.update_one({"id": t["user_id"]}, {"$set": upd})
    await db.password_reset_tokens.update_one({"token": body.token}, {"$set": {"used": True}})
    await db.sessions.update_many({"user_id": t["user_id"]}, {"$set": {"revoked": True}})
    await audit({"id": t["user_id"], "name": "", "role": None}, "password_reset", "users", t["user_id"])
    u = await db.users.find_one({"id": t["user_id"]}, {"_id": 0, "role": 1})
    return {"ok": True, "portal": u["role"] if u and u["role"] in PORTAL_ROLES else None}


@router.post("/auth/change-password")
async def change_password(body: ChangeIn, user=Depends(current_user)):
    full = await db.users.find_one({"id": user["id"]})
    if not verify_password(body.current_password, full["password_hash"]):
        raise HTTPException(400, "Current password is incorrect")
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_password(body.new_password)}})
    await db.sessions.update_many({"user_id": user["id"], "sid": {"$ne": user["sid"]}}, {"$set": {"revoked": True}})
    await audit(user, "password_changed", "users", user["id"])
    return {"ok": True}


@router.get("/auth/sessions")
async def my_sessions(user=Depends(current_user)):
    rows = await db.sessions.find({"user_id": user["id"], "revoked": False}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return [{"current": s["sid"] == user["sid"], "created_at": s["created_at"].isoformat(), "ip": s.get("ip"),
             "user_agent": s.get("user_agent"), "mfa": s.get("mfa", False)} for s in rows]


# ---------- Users ----------
@router.get("/roles")
async def roles(user=Depends(staff_user)):
    return [{"key": k, "label": v} for k, v in ROLES.items()]


@router.get("/users/lite")
async def users_lite(user=Depends(staff_user)):
    return await db.users.find({"active": True, "role": {"$nin": list(PORTAL_ROLES)}},
                               {"_id": 0, "id": 1, "name": 1, "role": 1, "branch_ids": 1, "designation": 1}).to_list(500)


@router.get("/users")
async def list_users(user=Depends(require("users", "r"))):
    return await db.users.find({}, {"_id": 0, "password_hash": 0, "mfa_secret": 0, "mfa_pending_secret": 0,
                                    "mfa_recovery": 0, "photo": 0}).sort("created_at", 1).to_list(500)


def _check_grant(actor, role):
    if role not in ROLES:
        raise HTTPException(422, "Unknown role")
    if role == "super_admin" and actor["role"] != "super_admin":
        raise HTTPException(403, "Only a Super Administrator can grant this role")


@router.post("/users")
async def create_user(body: UserIn, user=Depends(require("users", "w"))):
    _check_grant(user, body.role)
    email = body.email.strip().lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "A user with this email already exists")
    if body.role == "owner":
        if not body.owner_id or not await db.owners.find_one({"id": body.owner_id, "deleted": {"$ne": True}}):
            raise HTTPException(422, "Choose the owner record this portal account belongs to")
    if body.role == "investor":
        if not body.investor_id or not await db.investors.find_one({"id": body.investor_id, "deleted": {"$ne": True}}):
            raise HTTPException(422, "Choose the investor record this portal account belongs to")
    if body.role in ("tenant", "buyer"):
        if not body.customer_id or not await db.customers.find_one({"id": body.customer_id, "deleted": {"$ne": True},
                                                                     "merged_into": None}):
            raise HTTPException(422, "Choose the customer this login belongs to")
    portal = body.role in PORTAL_ROLES
    uid = new_id()
    doc = {"id": uid, "email": email, "name": body.name.strip(), "role": body.role, "phone": body.phone,
           "branch_ids": [] if portal else await _check_branches(body.branch_ids), "active": bool(body.password),
           "created_at": now_iso(), "owner_id": body.owner_id if body.role == "owner" else None,
           "investor_id": body.investor_id if body.role == "investor" else None,
           "customer_id": body.customer_id if body.role in ("tenant", "buyer") else None,
           "password_hash": hash_password(body.password) if body.password else None}
    if not portal:
        doc.update({"designation": body.designation, "department": body.department, "whatsapp": body.whatsapp,
                    "joined_on": body.joined_on, "reports_to": await _check_manager(uid, body.reports_to),
                    "show_in_directory": True})
    await db.users.insert_one(dict(doc))
    link, status = (None, None) if body.password else await _issue_token(doc, "activation")
    await audit(user, "user_created", "users", doc["id"], {"role": body.role})
    return {**public_user(doc), "activation_link": link, "email_status": status}


@router.patch("/users/{uid}")
async def update_user(uid: str, body: UserPatch, user=Depends(require("users", "w"))):
    target = await db.users.find_one({"id": uid}, {"_id": 0})
    if not target:
        raise HTTPException(404, "User not found")
    upd = body.model_dump(exclude_unset=True)
    upd = {k: v for k, v in upd.items() if v is not None or k in ("reports_to", "designation", "department", "whatsapp")}
    if "role" in upd:
        _check_grant(user, upd["role"])
        portal = PORTAL_ROLES
        if (upd["role"] in portal or target["role"] in portal) and upd["role"] != target["role"]:
            raise HTTPException(422, "Portal accounts and staff accounts cannot be converted into each other")
    if "branch_ids" in upd:
        upd["branch_ids"] = await _check_branches(upd["branch_ids"])
    if "reports_to" in upd:
        upd["reports_to"] = await _check_manager(uid, upd["reports_to"])
    if target["role"] == "super_admin" and user["role"] != "super_admin":
        raise HTTPException(403, "Cannot modify a Super Administrator")
    if uid == user["id"] and (upd.get("active") is False or ("role" in upd and upd["role"] != user["role"])):
        raise HTTPException(400, "You cannot deactivate or change the role of your own account")
    await db.users.update_one({"id": uid}, {"$set": upd})
    if upd.get("active") is False or "role" in upd:
        await db.sessions.update_many({"user_id": uid}, {"$set": {"revoked": True}})
    await audit(user, "user_updated", "users", uid, upd)
    return public_user({**target, **upd})


@router.post("/users/{uid}/revoke-sessions")
async def revoke_sessions(uid: str, user=Depends(require("users", "w"))):
    r = await db.sessions.update_many({"user_id": uid, "revoked": False}, {"$set": {"revoked": True}})
    await audit(user, "sessions_revoked", "users", uid)
    return {"revoked": r.modified_count}


@router.post("/users/{uid}/mfa-reset")
async def admin_mfa_reset(uid: str, user=Depends(require("users", "w"))):
    target = await db.users.find_one({"id": uid}, {"_id": 0})
    if not target:
        raise HTTPException(404, "User not found")
    if target["role"] == "super_admin" and user["role"] != "super_admin":
        raise HTTPException(403, "Cannot modify a Super Administrator")
    await db.users.update_one({"id": uid}, {"$set": {"mfa_enabled": False},
                                            "$unset": {"mfa_secret": "", "mfa_recovery": "", "mfa_pending_secret": ""}})
    await db.sessions.update_many({"user_id": uid}, {"$set": {"revoked": True}})
    await audit(user, "mfa_reset", "users", uid)
    return {"ok": True}


@router.post("/users/{uid}/reset-link")
async def admin_reset_link(uid: str, user=Depends(require("users", "w"))):
    target = await db.users.find_one({"id": uid}, {"_id": 0})
    if not target:
        raise HTTPException(404, "User not found")
    link, status = await _issue_token(target, "activation" if not target.get("active") else "reset")
    await audit(user, "reset_link_issued", "users", uid)
    return {"link": link, "email_status": status}
