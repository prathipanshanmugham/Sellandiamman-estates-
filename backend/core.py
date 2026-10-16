import os
import re
import asyncio
import uuid
import time
import logging
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
client = AsyncIOMotorClient(os.environ["MONGO_URL"], tz_aware=True)
db = client[os.environ["DB_NAME"]]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = "HS256"
SESSION_HOURS = 12
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
}
MODULES = ["dashboard", "leads", "properties", "owners", "deals", "finance", "leases", "maintenance",
           "shortstay", "documents", "tasks", "reports", "cms", "users", "settings", "audit"]
# r=read w=write a=approve e=export p=publish
PERMS = {
    "super_admin": {m: "rwaep" for m in MODULES},
    "director": {**{m: "rwae" for m in MODULES}, "users": "r", "settings": "r", "properties": "rwaep", "cms": "rwp"},
    "branch_manager": {"dashboard": "r", "leads": "rwe", "properties": "rwaep", "owners": "rw", "deals": "rwe",
                       "finance": "r", "leases": "rw", "maintenance": "rw", "shortstay": "rw", "documents": "rw",
                       "tasks": "rw", "reports": "re", "cms": "rwp", "users": "r"},
    "sales_agent": {"dashboard": "r", "leads": "rw", "properties": "rw", "owners": "r", "deals": "rw",
                    "tasks": "rw", "documents": "rw"},
    "property_manager": {"dashboard": "r", "properties": "r", "owners": "r", "leases": "rw", "maintenance": "rw",
                         "documents": "rw", "tasks": "rw"},
    "accountant": {"dashboard": "r", "finance": "rwe", "deals": "r", "leases": "r", "shortstay": "r", "owners": "r",
                   "reports": "re", "tasks": "rw", "maintenance": "r"},
    "marketing": {"dashboard": "r", "properties": "rp", "cms": "rwp", "leads": "r", "tasks": "rw"},
    "shortstay_ops": {"dashboard": "r", "shortstay": "rw", "maintenance": "rw", "properties": "r", "tasks": "rw",
                      "documents": "r"},
    "auditor": {"dashboard": "r", "leads": "r", "properties": "r", "owners": "r", "deals": "r", "finance": "r",
                "leases": "r", "maintenance": "r", "shortstay": "r", "reports": "re", "audit": "r"},
}
# Record scope: these roles only see records where field == their user id
OWN_SCOPE = {
    "sales_agent": {"leads": "assigned_to", "deals": "assigned_to", "properties": "assigned_agent"},
    "property_manager": {"properties": "assigned_manager", "leases": "manager_id"},
}
BRANCH_SCOPED = ("leads", "properties", "deals")


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
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


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
    k = f"{key}:{client_ip(request)}"
    t = time.time()
    hits = [h for h in _rate.get(k, []) if h > t - window]
    if len(hits) >= limit:
        raise HTTPException(429, "Too many requests. Please try again later.")
    hits.append(t)
    _rate[k] = hits


def public_user(u):
    return {"id": u["id"], "email": u["email"], "name": u.get("name"), "role": u["role"],
            "role_label": ROLES.get(u["role"]), "branch_ids": u.get("branch_ids", []), "active": u.get("active"),
            "phone": u.get("phone"), "permissions": PERMS.get(u["role"], {}), "created_at": u.get("created_at")}


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
    user = await db.users.find_one({"id": payload.get("sub"), "active": True}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(401, "Account not active")
    user["sid"] = sess["sid"]
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


def scope(user, module):
    f = {}
    field = OWN_SCOPE.get(user["role"], {}).get(module)
    if field:
        f[field] = user["id"]
    if user["role"] == "branch_manager" and user.get("branch_ids") and module in BRANCH_SCOPED:
        f["branch_id"] = {"$in": user["branch_ids"] + [None]}
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


async def notify(user_ids, title, body="", link="", dedupe=None, kind="info"):
    for uid in set(filter(None, user_ids)):
        doc = {"id": new_id(), "user_id": uid, "title": title, "body": body, "link": link, "kind": kind,
               "read": False, "created_at": now_iso(), "dedupe_key": f"{dedupe}:{uid}" if dedupe else new_id(),
               "email_status": "dev_logged"}
        try:
            await db.notifications.insert_one(doc)
            logger.info("[EMAIL-DEV] to=%s subject=%s", uid, title)
        except DuplicateKeyError:
            pass


async def notify_roles(roles, title, body="", link="", dedupe=None, kind="info", branch_id=None):
    q = {"role": {"$in": roles}, "active": True}
    users = await db.users.find(q, {"_id": 0, "id": 1, "role": 1, "branch_ids": 1}).to_list(500)
    ids = [u["id"] for u in users if u["role"] != "branch_manager" or not branch_id
           or not u.get("branch_ids") or branch_id in u["branch_ids"]]
    await notify(ids, title, body, link, dedupe, kind)


async def post_ledger(ledger, direction, amount, ref_type, ref_id, description, user, party=None, account=None):
    amount = round(float(amount), 2)
    if amount <= 0:
        return None
    entry = {"id": new_id(), "code": await next_code("ledger", "LE-", 6), "ledger": ledger, "direction": direction,
             "amount": amount, "account": account or ref_type, "ref_type": ref_type, "ref_id": ref_id,
             "party": party, "description": description, "posted_by": user["id"] if user else None,
             "posted_at": now_iso(), "reversal_of": None, "reversed": False}
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
