"""Insights: market updates, guides and area notes written by staff and shown on the public website."""
import re
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel, Field
from core import db, now_iso, new_id, require, can, audit, save_upload, IMAGE_TYPES

router = APIRouter()
CATEGORIES = ["market_update", "buying_guide", "owner_guide", "area_guide", "legal_tax", "company_news"]
LIST_FIELDS = {"_id": 0, "id": 1, "slug": 1, "title": 1, "excerpt": 1, "category": 1, "cover_image": 1,
               "published_at": 1, "author_name": 1, "reading_minutes": 1, "tags": 1}


def slugify(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
    return s[:80] or "post"


class PostIn(BaseModel):
    title: str = Field(min_length=4, max_length=160)
    slug: Optional[str] = Field(None, max_length=90)
    excerpt: Optional[str] = Field(None, max_length=400)
    body: str = Field(min_length=20, max_length=40000)
    category: str = "market_update"
    tags: List[str] = []
    cover_image: Optional[str] = Field(None, max_length=500)
    seo_title: Optional[str] = Field(None, max_length=160)
    seo_description: Optional[str] = Field(None, max_length=300)


def _minutes(body):
    return max(1, round(len(re.findall(r"\w+", body or "")) / 200))


async def _unique_slug(slug, exclude_id=None):
    base, n = slug, 2
    while await db.posts.find_one({"slug": slug, "id": {"$ne": exclude_id}, "deleted": {"$ne": True}}):
        slug = f"{base}-{n}"
        n += 1
    return slug


@router.get("/posts")
async def list_posts(user=Depends(require("cms", "r"))):
    return await db.posts.find({"deleted": {"$ne": True}}, {"_id": 0, "body": 0}).sort("updated_at", -1).to_list(1000)


@router.get("/posts/{pid}")
async def get_post(pid: str, user=Depends(require("cms", "r"))):
    p = await db.posts.find_one({"id": pid, "deleted": {"$ne": True}}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Post not found")
    return p


@router.post("/posts")
async def create_post(body: PostIn, user=Depends(require("cms", "w"))):
    if body.category not in CATEGORIES:
        raise HTTPException(422, "Invalid category")
    data = body.model_dump()
    data["slug"] = await _unique_slug(slugify(body.slug or body.title))
    data["tags"] = [t.strip()[:40] for t in body.tags if t.strip()][:10]
    p = {"id": new_id(), **data, "status": "draft", "reading_minutes": _minutes(body.body), "author_id": user["id"],
         "author_name": user["name"], "published_at": None, "created_at": now_iso(), "updated_at": now_iso(),
         "deleted": False}
    await db.posts.insert_one(dict(p))
    await audit(user, "post_created", "cms", p["id"], {"title": p["title"]})
    return p


@router.patch("/posts/{pid}")
async def update_post(pid: str, body: dict, user=Depends(require("cms", "w"))):
    p = await db.posts.find_one({"id": pid, "deleted": {"$ne": True}}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Post not found")
    allowed = ["title", "slug", "excerpt", "body", "category", "tags", "cover_image", "seo_title", "seo_description"]
    upd = {k: v for k, v in body.items() if k in allowed}
    if "category" in upd and upd["category"] not in CATEGORIES:
        raise HTTPException(422, "Invalid category")
    if "title" in upd and not (4 <= len(str(upd["title"]).strip()) <= 160):
        raise HTTPException(422, "Title must be 4–160 characters")
    if "body" in upd:
        if len(str(upd["body"])) < 20:
            raise HTTPException(422, "The article is too short")
        upd["reading_minutes"] = _minutes(upd["body"])
    if "slug" in upd:
        upd["slug"] = await _unique_slug(slugify(upd["slug"] or upd.get("title") or p["title"]), pid)
    if "tags" in upd:
        upd["tags"] = [str(t).strip()[:40] for t in (upd["tags"] or []) if str(t).strip()][:10]
    status = body.get("status")
    if status and status != p["status"]:
        if status not in ("draft", "published"):
            raise HTTPException(422, "Invalid status")
        if status == "published" and not can(user, "cms", "p"):
            raise HTTPException(403, "You are not authorised to publish")
        upd["status"] = status
        if status == "published" and not p.get("published_at"):
            upd["published_at"] = now_iso()
    upd["updated_at"] = now_iso()
    await db.posts.update_one({"id": pid}, {"$set": upd})
    await audit(user, "post_updated", "cms", pid, {k: v for k, v in upd.items() if k not in ("body", "updated_at")})
    return {**p, **upd}


@router.delete("/posts/{pid}")
async def delete_post(pid: str, user=Depends(require("cms", "w"))):
    r = await db.posts.update_one({"id": pid}, {"$set": {"deleted": True, "status": "draft", "updated_at": now_iso()}})
    if not r.matched_count:
        raise HTTPException(404, "Post not found")
    await audit(user, "post_deleted", "cms", pid)
    return {"ok": True}


@router.post("/posts/{pid}/cover")
async def upload_cover(pid: str, file: UploadFile = File(...), user=Depends(require("cms", "w"))):
    p = await db.posts.find_one({"id": pid, "deleted": {"$ne": True}}, {"_id": 0, "id": 1})
    if not p:
        raise HTTPException(404, "Post not found")
    saved = await save_upload(file, IMAGE_TYPES, 5 * 1024 * 1024)
    d = {"id": new_id(), **saved, "entity_type": "post", "entity_id": pid, "doc_type": "photo", "version": 1,
         "is_latest": True, "public_approved": True, "uploaded_by": user["id"], "uploaded_by_name": user["name"],
         "created_at": now_iso()}
    await db.documents.insert_one(dict(d))
    url = f"/api/public/media/{d['id']}"
    await db.posts.update_one({"id": pid}, {"$set": {"cover_image": url, "updated_at": now_iso()}})
    return {"cover_image": url}


# ---------- Public ----------
@router.get("/public/posts")
async def public_posts(category: Optional[str] = None, page: int = 1, limit: int = 9):
    f = {"status": "published", "deleted": {"$ne": True}}
    if category:
        f["category"] = category
    limit, page = max(1, min(limit, 30)), max(1, page)
    total = await db.posts.count_documents(f)
    items = await db.posts.find(f, LIST_FIELDS).sort("published_at", -1).skip((page - 1) * limit).limit(limit).to_list(limit)
    return {"items": items, "total": total, "page": page, "limit": limit}


@router.get("/public/posts/{slug}")
async def public_post(slug: str):
    p = await db.posts.find_one({"slug": slug, "status": "published", "deleted": {"$ne": True}},
                                {"_id": 0, "author_id": 0})
    if not p:
        raise HTTPException(404, "Article not found")
    related = await db.posts.find({"status": "published", "deleted": {"$ne": True}, "slug": {"$ne": slug},
                                   "category": p.get("category")}, LIST_FIELDS).sort("published_at", -1).limit(3).to_list(3)
    return {"post": p, "related": related}
