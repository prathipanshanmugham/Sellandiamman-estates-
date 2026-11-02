"""Website editor: home page sections (show / hide / reorder / edit), hero, services, FAQ, About, announcement, reviews and
search-engine text, with a draft that is previewed and then published; the last 15 published versions can be restored."""
import copy
import re
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from core import db, now_iso, new_id, require, audit, save_upload, IMAGE_TYPES, clear_settings_cache
from site_defaults import DEFAULT_SITE, SECTION_TYPES

router = APIRouter()
KEEP_VERSIONS = 15


def _s(v, n=300):
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", str(v or ""))[:n]


def _img(v):
    v = _s(v, 300)
    return v if (v.startswith("/images/") or v.startswith("/api/public/media/") or v.startswith("https://")) else ""


def clean(c):
    """Validates and trims everything the editor sends, so the website can trust it."""
    d = copy.deepcopy(DEFAULT_SITE)
    c = c or {}
    h = c.get("hero") or {}
    d["hero"] = {"eyebrow": _s(h.get("eyebrow"), 120), "title": _s(h.get("title"), 140) or DEFAULT_SITE["hero"]["title"],
                 "subtitle": _s(h.get("subtitle"), 300), "image": _img(h.get("image")) or DEFAULT_SITE["hero"]["image"],
                 "show_search": bool(h.get("show_search", True))}
    d["announcement"] = _s(c.get("announcement"), 200)
    secs, seen = [], set()
    for s in (c.get("sections") or DEFAULT_SITE["sections"])[:30]:
        t = s.get("type")
        if t not in SECTION_TYPES:
            continue
        sid = _s(s.get("id") or f"{t}-{new_id()[:6]}", 40)
        if sid in seen:
            sid = f"{sid}-{new_id()[:4]}"
        seen.add(sid)
        out = {"id": sid, "type": t, "visible": bool(s.get("visible", True)), "title": _s(s.get("title"), 160),
               "eyebrow": _s(s.get("eyebrow"), 60), "subtitle": _s(s.get("subtitle"), 300)}
        if t == "text":
            out["body"] = _s(s.get("body"), 6000)
        if t == "why":
            out["image"] = _img(s.get("image"))
        if t == "stats":
            out["items"] = [{"value": _s(i.get("value"), 12), "label": _s(i.get("label"), 40)} for i in (s.get("items") or [])[:6] if i.get("value")]
        secs.append(out)
    d["sections"] = secs
    d["services"] = [{"slug": re.sub(r"[^a-z0-9-]", "", _s(x.get("slug"), 60).lower()) or f"service-{i}", "title": _s(x.get("title"), 80),
                      "summary": _s(x.get("summary"), 300), "points": [_s(p, 200) for p in (x.get("points") or [])[:10] if str(p).strip()]}
                     for i, x in enumerate((c.get("services") or DEFAULT_SITE["services"])[:16]) if x.get("title")]
    d["why"] = [{"title": _s(x.get("title"), 80), "body": _s(x.get("body"), 300)} for x in (c.get("why") or DEFAULT_SITE["why"])[:8] if x.get("title")]
    d["faq"] = [{"q": _s(x.get("q"), 200), "a": _s(x.get("a"), 1200)} for x in (c.get("faq") or DEFAULT_SITE["faq"])[:30] if x.get("q") and x.get("a")]
    a = c.get("about") or {}
    d["about"] = {"title": _s(a.get("title"), 120) or DEFAULT_SITE["about"]["title"], "body": _s(a.get("body"), 6000) or DEFAULT_SITE["about"]["body"],
                  "image": _img(a.get("image")) or DEFAULT_SITE["about"]["image"]}
    d["footer_tagline"] = _s(c.get("footer_tagline"), 300) or DEFAULT_SITE["footer_tagline"]
    d["contact_intro"] = _s(c.get("contact_intro"), 300)
    d["testimonials"] = [{"quote": _s(t.get("quote"), 400), "name": _s(t.get("name"), 80)} for t in (c.get("testimonials") or [])[:9] if t.get("quote")]
    seo = c.get("seo") or {}
    d["seo"] = {"title": _s(seo.get("title"), 70), "description": _s(seo.get("description"), 170)}
    return d


async def published():
    p = await db.site_content.find_one({"id": "published"}, {"_id": 0})
    return clean((p or {}).get("content") or DEFAULT_SITE)


@router.get("/public/site")
async def public_site():
    return await published()


@router.get("/cms/site")
async def get_site(user=Depends(require("cms", "r"))):
    pub = await db.site_content.find_one({"id": "published"}, {"_id": 0}) or {}
    draft = await db.site_content.find_one({"id": "draft"}, {"_id": 0}) or {}
    hist = await db.site_versions.find({}, {"_id": 0, "content": 0}).sort("published_at", -1).to_list(KEEP_VERSIONS)
    d = clean(draft.get("content") or pub.get("content") or DEFAULT_SITE)
    p = clean(pub.get("content") or DEFAULT_SITE)
    return {"draft": d, "published": p, "dirty": d != p, "draft_saved_at": draft.get("updated_at"), "draft_by": draft.get("updated_by"),
            "published_at": pub.get("updated_at"), "published_by": pub.get("updated_by"), "history": hist, "section_types": SECTION_TYPES}


@router.put("/cms/site/draft")
async def save_draft(body: dict, user=Depends(require("cms", "w"))):
    c = clean(body)
    await db.site_content.update_one({"id": "draft"}, {"$set": {"content": c, "updated_at": now_iso(), "updated_by": user["name"]}}, upsert=True)
    return {"ok": True, "draft": c}


@router.post("/cms/site/publish")
async def publish(user=Depends(require("cms", "p"))):
    draft = await db.site_content.find_one({"id": "draft"}, {"_id": 0})
    c = clean((draft or {}).get("content") or (await published()))
    await db.site_content.update_one({"id": "published"}, {"$set": {"content": c, "updated_at": now_iso(), "updated_by": user["name"]}}, upsert=True)
    await db.site_versions.insert_one({"id": new_id(), "content": c, "published_at": now_iso(), "by": user["name"]})
    old = await db.site_versions.find({}, {"_id": 0, "id": 1}).sort("published_at", -1).skip(KEEP_VERSIONS).to_list(1000)
    if old:
        await db.site_versions.delete_many({"id": {"$in": [o["id"] for o in old]}})
    clear_settings_cache()
    await audit(user, "website_published", "cms", "site")
    return {"ok": True}


@router.post("/cms/site/discard")
async def discard(user=Depends(require("cms", "w"))):
    await db.site_content.update_one({"id": "draft"}, {"$set": {"content": await published(), "updated_at": now_iso(), "updated_by": user["name"]}}, upsert=True)
    return {"ok": True}


@router.post("/cms/site/restore/{vid}")
async def restore(vid: str, user=Depends(require("cms", "w"))):
    v = await db.site_versions.find_one({"id": vid}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Version not found")
    await db.site_content.update_one({"id": "draft"}, {"$set": {"content": clean(v["content"]), "updated_at": now_iso(), "updated_by": user["name"]}}, upsert=True)
    await audit(user, "website_version_restored", "cms", vid)
    return {"ok": True}


@router.post("/cms/media")
async def upload_media(file: UploadFile = File(...), user=Depends(require("cms", "w"))):
    saved = await save_upload(file, IMAGE_TYPES, 5 * 1024 * 1024)
    d = {"id": new_id(), **saved, "entity_type": "site", "entity_id": "site", "doc_type": "photo", "version": 1, "is_latest": True,
         "public_approved": True, "uploaded_by": user["id"], "uploaded_by_name": user["name"], "created_at": now_iso()}
    await db.documents.insert_one(dict(d))
    await audit(user, "website_image_uploaded", "cms", d["id"])
    return {"id": d["id"], "url": f"/api/public/media/{d['id']}", "name": saved["original_name"]}


@router.get("/cms/media")
async def list_media(user=Depends(require("cms", "r"))):
    rows = await db.documents.find({"entity_type": {"$in": ["site", "post"]}, "public_approved": True}, {"_id": 0, "stored_name": 0}).sort("created_at", -1).to_list(200)
    return [{"id": r["id"], "url": f"/api/public/media/{r['id']}", "name": r.get("original_name"), "created_at": r.get("created_at")} for r in rows]


async def seed_site():
    if not await db.site_content.find_one({"id": "published"}):
        s = await db.settings.find_one({"id": "company"}, {"_id": 0}) or {}
        c = copy.deepcopy(DEFAULT_SITE)
        # carry over what was edited in Settings before the website editor existed
        if s.get("hero_title") and s["hero_title"] != "Property services for Erode & Perundurai":
            c["hero"]["title"] = s["hero_title"]
        if s.get("hero_subtitle"):
            c["hero"]["subtitle"] = s["hero_subtitle"]
        c["announcement"] = s.get("announcement") or ""
        c["testimonials"] = s.get("testimonials") or []
        c["seo"] = {"title": s.get("seo_title") or "", "description": s.get("seo_description") or ""}
        c = clean(c)
        await db.site_content.update_one({"id": "published"}, {"$set": {"content": c, "updated_at": now_iso(), "updated_by": "Setup"}}, upsert=True)
        await db.site_content.update_one({"id": "draft"}, {"$set": {"content": c, "updated_at": now_iso(), "updated_by": "Setup"}}, upsert=True)
