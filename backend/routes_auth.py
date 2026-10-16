import os
import secrets
from datetime import timedelta
from typing import Optional, List
import jwt
from fastapi import APIRouter, Request, Response, HTTPException, Depends
from pydantic import BaseModel, Field
from core import (db, now, now_iso, new_id, hash_password, verify_password, current_user, require, audit,
                  public_user, client_ip, rate_limit, JWT_SECRET, JWT_ALG, SESSION_HOURS, ROLES, logger)

router = APIRouter()
EMAIL_RE = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class LoginIn(BaseModel):
    email: str = Field(pattern=EMAIL_RE, max_length=200)
    password: str = Field(min_length=1, max_length=200)


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
    password: Optional[str] = Field(None, min_length=8, max_length=200)


class UserPatch(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    phone: Optional[str] = None
    branch_ids: Optional[List[str]] = None
    active: Optional[bool] = None


def _cookie(response: Response, token: str):
    response.set_cookie("access_token", token, httponly=True, secure=True, samesite="lax",
                        max_age=SESSION_HOURS * 3600, path="/")


@router.post("/auth/login")
async def login(body: LoginIn, request: Request, response: Response):
    rate_limit(request, "login", 20, 300)
    email = body.email.strip().lower()
    ident = f"{client_ip(request)}:{email}"
    att = await db.login_attempts.find_one({"identifier": ident})
    if att and att["last"] < now() - timedelta(minutes=15):
        await db.login_attempts.delete_one({"identifier": ident})
        att = None
    if att and att.get("count", 0) >= 5:
        raise HTTPException(429, "Too many failed attempts. Try again in 15 minutes.")
    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash") or not verify_password(body.password, user["password_hash"]):
        await db.login_attempts.update_one({"identifier": ident}, {"$inc": {"count": 1}, "$set": {"last": now()}},
                                           upsert=True)
        raise HTTPException(401, "Invalid email or password")
    if not user.get("active"):
        raise HTTPException(403, "This account is not active")
    await db.login_attempts.delete_one({"identifier": ident})
    sid = secrets.token_urlsafe(24)
    await db.sessions.insert_one({"sid": sid, "user_id": user["id"], "created_at": now(), "revoked": False,
                                  "expires_at": now() + timedelta(hours=SESSION_HOURS), "ip": client_ip(request)})
    token = jwt.encode({"sub": user["id"], "sid": sid, "exp": now() + timedelta(hours=SESSION_HOURS)},
                       JWT_SECRET, algorithm=JWT_ALG)
    _cookie(response, token)
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login": now_iso()}})
    await audit(user, "login", "auth", user["id"])
    return public_user(user)


@router.post("/auth/logout")
async def logout(response: Response, user=Depends(current_user)):
    await db.sessions.update_one({"sid": user["sid"]}, {"$set": {"revoked": True}})
    response.delete_cookie("access_token", path="/")
    await audit(user, "logout", "auth", user["id"])
    return {"ok": True}


@router.get("/auth/me")
async def me(user=Depends(current_user)):
    return public_user(user)


async def _issue_token(user, purpose):
    token = secrets.token_urlsafe(32)
    await db.password_reset_tokens.insert_one({"token": token, "user_id": user["id"], "purpose": purpose,
                                               "used": False, "expires_at": now() + timedelta(hours=24 if purpose == "activation" else 1)})
    link = f"{os.environ.get('SITE_URL', '')}/erp/reset-password?token={token}"
    logger.info("[EMAIL-DEV] %s link for %s: %s", purpose, user["email"], link)
    return link


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
    return {"ok": True}


@router.post("/auth/change-password")
async def change_password(body: ChangeIn, user=Depends(current_user)):
    full = await db.users.find_one({"id": user["id"]})
    if not verify_password(body.current_password, full["password_hash"]):
        raise HTTPException(400, "Current password is incorrect")
    await db.users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_password(body.new_password)}})
    await db.sessions.update_many({"user_id": user["id"], "sid": {"$ne": user["sid"]}}, {"$set": {"revoked": True}})
    await audit(user, "password_changed", "users", user["id"])
    return {"ok": True}


@router.get("/roles")
async def roles(user=Depends(current_user)):
    return [{"key": k, "label": v} for k, v in ROLES.items()]


@router.get("/users/lite")
async def users_lite(user=Depends(current_user)):
    return await db.users.find({"active": True}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(500)


@router.get("/users")
async def list_users(user=Depends(require("users", "r"))):
    return await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", 1).to_list(500)


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
    doc = {"id": new_id(), "email": email, "name": body.name.strip(), "role": body.role, "phone": body.phone,
           "branch_ids": body.branch_ids, "active": bool(body.password), "created_at": now_iso(),
           "password_hash": hash_password(body.password) if body.password else None}
    await db.users.insert_one(dict(doc))
    link = None if body.password else await _issue_token(doc, "activation")
    await audit(user, "user_created", "users", doc["id"], {"role": body.role})
    return {**public_user(doc), "activation_link": link}


@router.patch("/users/{uid}")
async def update_user(uid: str, body: UserPatch, user=Depends(require("users", "w"))):
    target = await db.users.find_one({"id": uid}, {"_id": 0})
    if not target:
        raise HTTPException(404, "User not found")
    upd = body.model_dump(exclude_none=True)
    if "role" in upd:
        _check_grant(user, upd["role"])
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


@router.post("/users/{uid}/reset-link")
async def admin_reset_link(uid: str, user=Depends(require("users", "w"))):
    target = await db.users.find_one({"id": uid}, {"_id": 0})
    if not target:
        raise HTTPException(404, "User not found")
    link = await _issue_token(target, "activation" if not target.get("active") else "reset")
    await audit(user, "reset_link_issued", "users", uid)
    return {"link": link}
