import os
import re
import asyncio
import uuid
import time
import logging
from contextvars import ContextVar
from datetime import datetime, timezone, timedelta
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

import bcrypt  # noqa: E402
import jwt  # noqa: E402
from fastapi import Request, HTTPException, Depends, UploadFile  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from pymongo import ReturnDocument  # noqa: E402
from pymongo.errors import DuplicateKeyError  # noqa: E402

logger = logging.getLogger("sellandiamman")
MONGO_URL = os.environ["MONGO_URL"]
if MONGO_URL.startswith("mongomock://"):
    # In-memory database for the automated tests only (requirements-dev.txt). Never use in production.
    from mongomock_motor import AsyncMongoMockClient  # noqa: E402
    client = AsyncMongoMockClient(tz_aware=True)
else:
    client = AsyncIOMotorClient(MONGO_URL, tz_aware=True)
db = client[os.environ["DB_NAME"]]
JWT_SECRET = os.environ["JWT_SECRET"]
if len(JWT_SECRET) < 32:
    logging.getLogger("sellandiamman").warning("JWT_SECRET is shorter than 32 characters; use a long random value")
JWT_ALG = "HS256"
SESSION_HOURS = 12
BCRYPT_ROUNDS = int(os.environ.get("BCRYPT_ROUNDS", "12"))
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true").lower() != "false"
SITE_URL = os.environ.get("SITE_URL", "").rstrip("/")
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR") or (ROOT / "uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
IST = timezone(timedelta(hours=5, minutes=30))

ROLES = {
    "super_admin": "Super Administrator",
    "director": "Owner / Director",
    "branch_manager": "Branch / Operations Manager",
    "sales_agent": "Sales / Brokerage Agent",
    "property_manager": "Property Manager",
    "accountant": "Finance / Accountant",
    "marketing": "Marketing Staff",
    "shortstay_ops": "Short-Stay Operations",
    "auditor": "Read-Only Auditor",
    "owner": "Property Owner (portal)",
    "investor": "Investor (portal)",
}
PORTAL_ROLES = ("owner", "investor")
STAFF_ROLES = [r for r in ROLES if r not in PORTAL_ROLES]
MODULES = ["dashboard", "ceo", "leads", "customers", "properties", "owners", "deals", "finance", "leases",
           "maintenance", "shortstay", "documents", "agreements", "investors", "tasks", "reports", "cms", "users",
           "settings", "audit"]
# r=read w=write a=approve e=export p=publish
PERMS = {
    "super_admin": {m: "rwaep" for m in MODULES},
    "director": {**{m: "rwae" for m in MODULES}, "users": "r", "settings": "r", "properties": "rwaep", "cms": "rwp"},
    "branch_manager": {"dashboard": "r", "ceo": "re", "leads": "rwe", "customers": "rwe", "properties": "rwaep",
                       "owners": "rw", "deals": "rwe", "finance": "r", "leases": "rw", "maintenance": "rw",
                       "shortstay": "rw", "documents": "rw", "agreements": "rw", "tasks": "rw", "reports": "re",
                       "cms": "rwp", "users": "r"},
    "sales_agent": {"dashboard": "r", "leads": "rw", "customers": "rw", "properties": "rw", "owners": "r",
                    "deals": "rw", "tasks": "rw", "documents": "rw", "agreements": "rw"},
    "property_manager": {"dashboard": "r", "properties": "r", "owners": "r", "customers": "r", "leases": "rw",
                         "maintenance": "rw", "documents": "rw", "agreements": "rw", "tasks": "rw"},
    "accountant": {"dashboard": "r", "ceo": "re", "finance": "rwe", "deals": "r", "leases": "r", "shortstay": "r",
                   "owners": "r", "customers": "r", "investors": "rwe", "agreements": "r", "reports": "re",
                   "tasks": "rw", "maintenance": "r"},
    "marketing": {"dashboard": "r", "properties": "rp", "cms": "rwp", "leads": "r", "tasks": "rw"},
    "shortstay_ops": {"dashboard": "r", "shortstay": "rw", "maintenance": "rw", "properties": "r", "tasks": "rw",
                      "documents": "r"},
    "auditor": {"dashboard": "r", "ceo": "re", "leads": "r", "customers": "r", "properties": "r", "owners": "r",
                "deals": "r", "finance": "r", "leases": "r", "maintenance": "r", "shortstay": "r", "investors": "r",
                "agreements": "r", "reports": "re", "audit": "r"},
    # Owners and investors use their own portals (/api/portal/*, /api/investor/*), scoped to their own records.
    "owner": {},
    "investor": {},
}
# Record scope: these roles only see records where field == their user id
OWN_SCOPE = {
    "sales_agent": {"leads": "assigned_to", "deals": "assigned_to", "properties": "assigned_agent", "customers": "rm_id"},
    "property_manager": {"properties": "assigned_manager", "leases": "manager_id"},
}
# Modules whose records carry a branch_id. People with branches set on their account see only those branches;
# super admins and directors see every branch. The branch picker in the staff app narrows any view to one branch.
BRANCH_SCOPED = ("leads", "customers", "properties", "deals", "leases", "shortstay", "maintenance", "finance",
                 "agreements", "ceo")
ALL_BRANCH_ROLES = ("super_admin", "director")
# Branch chosen in the staff app's picker for this request (header X-Branch); empty = all the person may see.
REQ_BRANCH: ContextVar = ContextVar("req_branch", default=None)


def now():
    return datetime.now(timezone.utc)


def now_iso():
    return now().isoformat()


def today_ist():
    return datetime.now(IST).date()


def new_id():
    return str(uuid.uuid4())


def pick(data: dict, allowed):
    return {k: data[k] for k in allowed if k in data}


async def next_code(name, prefix, width=4):
    doc = await db.counters.find_one_and_update({"_id": name}, {"$inc": {"seq": 1}}, upsert=True,
                                                return_document=ReturnDocument.AFTER)
    return f"{prefix}{doc['seq']:0{width}d}"


def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt(BCRYPT_ROUNDS)).decode()


def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except ValueError:
        return False


PHONE_RE = re.compile(r"^(?:\+?91)?([6-9]\d{9})$")


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"[\s\-()]", "", raw or "")
    m = PHONE_RE.match(digits)
    if not m:
        raise HTTPException(422, "Enter a valid 10-digit Indian mobile number")
    return "+91" + m.group(1)


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    # right-most entry is the one appended by our trusted ingress; left-most values are client-controlled
    return fwd.split(",")[-1].strip() if fwd else (request.client.host if request.client else "unknown")


_rate: dict = {}


def rate_limit(request: Request, key: str, limit: int, window: int):
    """In-memory limiter (one backend process). Use a shared store such as Redis if you run several."""
    k = f"{key}:{client_ip(request)}"
    t = time.time()
    if len(_rate) > 20000:  # drop idle keys so memory stays bounded
        for old in [x for x, v in _rate.items() if not v or v[-1] < t - 3600]:
            _rate.pop(old, None)
    hits = [h for h in _rate.get(k, []) if h > t - window]
    if len(hits) >= limit:
        raise HTTPException(429, "Too many requests. Please try again later.")
    hits.append(t)
    _rate[k] = hits


_settings_cache = {"at": 0.0, "value": None}


async def get_settings_cached(max_age=30):
    if _settings_cache["value"] is None or time.time() - _settings_cache["at"] > max_age:
        _settings_cache["value"] = await db.settings.find_one({"id": "company"}, {"_id": 0}) or {}
        _settings_cache["at"] = time.time()
    return _settings_cache["value"]


def clear_settings_cache():
    _settings_cache["value"] = None


def mfa_required_for(user, settings) -> bool:
    return user.get("role") in (settings.get("mfa_required_roles") or [])


PROFILE_FIELDS = ("designation", "department", "reports_to", "whatsapp", "show_in_directory", "joined_on")


def public_user(u, settings=None):
    out = {"id": u["id"], "email": u["email"], "name": u.get("name"), "role": u["role"],
           "role_label": ROLES.get(u["role"]), "branch_ids": u.get("branch_ids", []), "active": u.get("active"),
           "phone": u.get("phone"), "permissions": PERMS.get(u["role"], {}), "created_at": u.get("created_at"),
           "mfa_enabled": bool(u.get("mfa_enabled")), "owner_id": u.get("owner_id"),
           "investor_id": u.get("investor_id"), "last_login": u.get("last_login"),
           "all_branches": u["role"] in ALL_BRANCH_ROLES or not u.get("branch_ids"),
           **{k: u.get(k) for k in PROFILE_FIELDS}}
    if settings is not None:
        out["mfa_setup_required"] = mfa_required_for(u, settings) and not u.get("mfa_enabled")
    return out


# Paths a signed-in user may still call while their role requires 2-step login and they have not set it up.
MFA_EXEMPT = ("/api/auth/",)


async def current_user(request: Request):
    token = request.cookies.get("access_token")
    auth = request.headers.get("Authorization", "")
    if not token and auth.startswith("Bearer "):
        token = auth[7:]
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Session expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid session")
    sess = await db.sessions.find_one({"sid": payload.get("sid"), "revoked": False})
    if not sess or sess["expires_at"] < now():
        raise HTTPException(401, "Session expired or revoked")
    user = await db.users.find_one({"id": payload.get("sub"), "active": True},
                                   {"_id": 0, "password_hash": 0, "mfa_secret": 0, "mfa_pending_secret": 0,
                                    "mfa_recovery": 0, "photo": 0})
    if not user:
        raise HTTPException(401, "Account not active")
    user["sid"] = sess["sid"]
    REQ_BRANCH.set((request.headers.get("x-branch") or "").strip()[:40] or None)
    if not user.get("mfa_enabled") and not request.url.path.startswith(MFA_EXEMPT):
        if mfa_required_for(user, await get_settings_cached()):
            raise HTTPException(403, "mfa_setup_required")
    return user


async def staff_user(request: Request):
    user = await current_user(request)
    if user["role"] in PORTAL_ROLES:
        raise HTTPException(403, "This area is for staff accounts")
    return user


async def owner_user(request: Request):
    user = await current_user(request)
    if user["role"] != "owner" or not user.get("owner_id"):
        raise HTTPException(403, "This area is for property owners")
    return user


async def investor_user(request: Request):
    user = await current_user(request)
    if user["role"] != "investor" or not user.get("investor_id"):
        raise HTTPException(403, "This area is for investors")
    return user


def can(user, module, action):
    return action in PERMS.get(user["role"], {}).get(module, "")


def require(module, action):
    async def dep(request: Request, user=Depends(current_user)):
        if not can(user, module, action):
            await audit(user, "permission_denied", module, None, {"action": action, "path": request.url.path})
            raise HTTPException(403, "You do not have permission for this action")
        return user
    return dep


def allowed_branches(user):
    """None = every branch; otherwise the branch ids on the person's account."""
    if not user or user.get("role") in ALL_BRANCH_ROLES or not user.get("branch_ids"):
        return None
    return list(user["branch_ids"])


def branch_filter(user, field="branch_id", selected=None):
    """Mongo filter for the branches this person may see, narrowed to the branch picked in the app (if any)."""
    allowed = allowed_branches(user)
    sel = selected if selected is not None else REQ_BRANCH.get()
    if sel and sel != "all" and (allowed is None or sel in allowed):
        return {field: sel}
    if allowed is not None:
        return {field: {"$in": allowed}}
    return {}


def in_branch(user, branch_id) -> bool:
    allowed = allowed_branches(user)
    return allowed is None or branch_id in allowed


def check_branch(user, branch_id):
    if branch_id and not in_branch(user, branch_id):
        raise HTTPException(403, "You can only work with records of your own branch")


def home_branch(user):
    """Branch for new records made in the 'all branches' view: the picked branch, else the person's first branch."""
    sel = REQ_BRANCH.get()
    if sel and sel != "all" and in_branch(user, sel):
        return sel
    return (user.get("branch_ids") or [None])[0] if user else None


def scope(user, module):
    f = {}
    field = OWN_SCOPE.get(user["role"], {}).get(module)
    if field:
        f[field] = user["id"]
    if module in BRANCH_SCOPED:
        f.update(branch_filter(user))
    return f


def is_scoped(user, module):
    return bool(OWN_SCOPE.get(user["role"], {}).get(module))


async def get_scoped(coll, module, user, rid):
    doc = await db[coll].find_one({"id": rid, "deleted": {"$ne": True}, **scope(user, module)}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Record not found")
    return doc


async def audit(user, action, entity, entity_id, details=None):
    await db.audit_logs.insert_one({
        "id": new_id(), "user_id": user["id"] if user else None, "user_name": user.get("name") if user else "public",
        "role": user.get("role") if user else None, "action": action, "entity": entity, "entity_id": entity_id,
        "details": details or {}, "at": now_iso()})


SMTP = {k: os.environ.get(f"SMTP_{k}", "") for k in ("HOST", "PORT", "USER", "PASSWORD", "FROM", "TLS")}


def email_configured() -> bool:
    return bool(SMTP["HOST"] and SMTP["FROM"])


def _send_email_sync(to, subject, text, html=None):
    import smtplib
    import ssl
    from email.message import EmailMessage
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = SMTP["FROM"], to, subject
    msg.set_content(text)
    if html:
        msg.add_alternative(html, subtype="html")
    port = int(SMTP["PORT"] or 587)
    ctx = ssl.create_default_context()
    if port == 465 or SMTP["TLS"].lower() == "ssl":
        with smtplib.SMTP_SSL(SMTP["HOST"], port, context=ctx, timeout=20) as s:
            if SMTP["USER"]:
                s.login(SMTP["USER"], SMTP["PASSWORD"])
            s.send_message(msg)
    else:
        with smtplib.SMTP(SMTP["HOST"], port, timeout=20) as s:
            if SMTP["TLS"].lower() != "none":
                s.starttls(context=ctx)
            if SMTP["USER"]:
                s.login(SMTP["USER"], SMTP["PASSWORD"])
            s.send_message(msg)


async def send_email(to, subject, text, html=None) -> str:
    """Sends through SMTP when SMTP_HOST/SMTP_FROM are set; otherwise only logs (development)."""
    if not to:
        return "skipped"
    if not email_configured():
        logger.info("[EMAIL-DEV] to=%s subject=%s\n%s", to, subject, text)
        return "dev_logged"
    try:
        await asyncio.to_thread(_send_email_sync, to, subject, text, html)
        return "sent"
    except Exception:
        logger.exception("Email to %s failed", to)
        return "failed"


def _email_body(title, body, link):
    url = f"{SITE_URL}{link}" if link and SITE_URL else ""
    text = f"{title}\n\n{body or ''}\n\n{('Open: ' + url) if url else ''}\n\n— Sellandiamman Estates"
    return text


async def _email_notification(uid, title, body, link, nid):
    u = await db.users.find_one({"id": uid, "active": True}, {"_id": 0, "email": 1})
    status = await send_email(u and u.get("email"), title, _email_body(title, body, link))
    await db.notifications.update_one({"id": nid}, {"$set": {"email_status": status}})


async def notify(user_ids, title, body="", link="", dedupe=None, kind="info"):
    settings = await get_settings_cached()
    for uid in set(filter(None, user_ids)):
        doc = {"id": new_id(), "user_id": uid, "title": title, "body": body, "link": link, "kind": kind,
               "read": False, "created_at": now_iso(), "dedupe_key": f"{dedupe}:{uid}" if dedupe else new_id(),
               "email_status": "off"}
        try:
            await db.notifications.insert_one(doc)
        except DuplicateKeyError:
            continue
        if settings.get("email_notifications"):
            asyncio.create_task(_email_notification(uid, title, body, link, doc["id"]))


async def notify_roles(roles, title, body="", link="", dedupe=None, kind="info", branch_id=None):
    """People with branches on their account are told only about their own branches' records."""
    q = {"role": {"$in": roles}, "active": True}
    users = await db.users.find(q, {"_id": 0, "id": 1, "role": 1, "branch_ids": 1}).to_list(500)
    ids = [u["id"] for u in users if not branch_id or allowed_branches(u) is None or branch_id in u["branch_ids"]]
    await notify(ids, title, body, link, dedupe, kind)


# ---------------- Branches & locations ----------------
async def head_office_id():
    b = await db.branches.find_one({"is_head_office": True, "active": {"$ne": False}}, {"_id": 0, "id": 1})
    if not b:
        b = await db.branches.find_one({"active": {"$ne": False}}, {"_id": 0, "id": 1}, sort=[("order", 1)])
    return b["id"] if b else None


async def branch_for_place(city=None, locality=None):
    """Branch that looks after a town / locality: from the locations list, else a branch in that town, else head office."""
    import re as _re
    if city:
        rx = {"$regex": f"^{_re.escape(city.strip())}$", "$options": "i"}
        if locality:
            loc = await db.locations.find_one({"kind": "locality", "city": rx, "name": {
                "$regex": f"^{_re.escape(locality.strip())}$", "$options": "i"}}, {"_id": 0, "branch_id": 1})
            if loc and loc.get("branch_id"):
                return loc["branch_id"]
        c = await db.locations.find_one({"kind": "city", "name": rx}, {"_id": 0, "branch_id": 1})
        if c and c.get("branch_id"):
            return c["branch_id"]
        b = await db.branches.find_one({"city": rx, "active": {"$ne": False}}, {"_id": 0, "id": 1})
        if b:
            return b["id"]
    return await head_office_id()


async def post_ledger(ledger, direction, amount, ref_type, ref_id, description, user, party=None, account=None,
                      branch_id=None):
    amount = round(float(amount), 2)
    if amount <= 0:
        return None
    entry = {"id": new_id(), "code": await next_code("ledger", "LE-", 6), "ledger": ledger, "direction": direction,
             "amount": amount, "account": account or ref_type, "ref_type": ref_type, "ref_id": ref_id,
             "party": party, "description": description, "posted_by": user["id"] if user else None,
             "posted_at": now_iso(), "reversal_of": None, "reversed": False, "branch_id": branch_id}
    await db.ledger_entries.insert_one(dict(entry))
    return entry


async def get_settings():
    s = await db.settings.find_one({"id": "company"}, {"_id": 0})
    return s or {}


MAGIC = {
    "application/pdf": [b"%PDF"],
    "image/jpeg": [b"\xff\xd8\xff"],
    "image/png": [b"\x89PNG"],
    "image/webp": [b"RIFF"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [b"PK"],
}
IMAGE_TYPES = ("image/jpeg", "image/png", "image/webp")
DOC_TYPES = tuple(MAGIC.keys())


async def save_upload(file: UploadFile, allowed=DOC_TYPES, max_bytes=10 * 1024 * 1024):
    data = await file.read()
    ctype = file.content_type or ""
    if ctype not in allowed:
        raise HTTPException(422, f"File type not allowed: {ctype or 'unknown'}")
    if len(data) > max_bytes:
        raise HTTPException(422, f"File too large (max {max_bytes // (1024 * 1024)} MB)")
    if not data or not any(data.startswith(m) for m in MAGIC[ctype]):
        raise HTTPException(422, "File content does not match its type")
    stored = new_id()
    await asyncio.to_thread((UPLOAD_DIR / stored).write_bytes, data)
    return {"stored_name": stored, "size": len(data), "content_type": ctype,
            "original_name": re.sub(r"[^\w.\- ]", "_", file.filename or "file")[:120]}
