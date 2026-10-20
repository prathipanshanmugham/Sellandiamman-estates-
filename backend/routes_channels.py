"""Short stays on many platforms: each unit's channels (Airbnb, Booking.com, Agoda, MakeMyTrip, Goibibo, Vrbo,
Expedia, our website), two-way calendar sync with iCal links, blocked dates, pricing, a multi-unit calendar,
channel performance, and booking requests from the website."""
import ipaddress
import secrets
import socket
from datetime import date, timedelta
from typing import Optional, List
from urllib.parse import urlparse
import httpx
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from core import (db, now_iso, new_id, require, scope, audit, notify_roles, normalize_phone, rate_limit, today_ist,
                  logger, check_branch, SITE_URL)
from logic import PLATFORMS, stay_quote, calc_shortstay, ranges_overlap, r2
import ical

router = APIRouter()
SYSTEM = {"id": None, "name": "Calendar sync", "role": "system"}
DATE = r"^\d{4}-\d{2}-\d{2}$"
LIVE = ["confirmed", "checked_in", "completed"]


async def _unit(user, pid):
    p = await db.properties.find_one({"id": pid, "transaction": "short_stay", "deleted": {"$ne": True},
                                      **scope(user, "shortstay")}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Short-stay property not found")
    return p


def _default_pricing(p):
    return {"base_rate": p.get("nightly_rate") or p.get("price") or 0, "weekend_rate": None, "cleaning_fee": 0, "min_nights": 1,
            "weekly_discount_pct": 0, "monthly_discount_pct": 0, "included_guests": 2, "extra_guest_fee": 0, "seasons": []}


def pricing_of(p):
    return {**_default_pricing(p), **(p.get("stay_pricing") or {})}


# ---------------- Units, channels ----------------
class ChannelIn(BaseModel):
    property_id: str
    platform: str
    listing_url: Optional[str] = Field(None, max_length=500)
    ical_import_url: Optional[str] = Field(None, max_length=1000)
    commission_pct: Optional[float] = Field(None, ge=0, le=60)
    active: bool = True


@router.get("/short-stay/platforms")
async def platforms(user=Depends(require("shortstay", "r"))):
    return [{"key": k, "label": v[0], "commission_pct": v[1]} for k, v in PLATFORMS.items()]


@router.get("/short-stay/units")
async def units(user=Depends(require("shortstay", "r"))):
    props = await db.properties.find({"transaction": "short_stay", "deleted": {"$ne": True}, **scope(user, "shortstay")},
                                     {"_id": 0, "id": 1, "code": 1, "title": 1, "locality": 1, "city": 1, "branch_id": 1,
                                      "nightly_rate": 1, "price": 1, "max_guests": 1, "status": 1, "images": 1,
                                      "stay_pricing": 1, "listing_id": 1, "mgmt_fee_pct": 1}).to_list(500)
    t = today_ist()
    frm, to = t.isoformat(), (t + timedelta(days=30)).isoformat()
    out = []
    for p in props:
        chans = await db.stay_channels.find({"property_id": p["id"], "active": {"$ne": False}}, {"_id": 0, "export_token": 0}).to_list(50)
        bks = await db.bookings.find({"property_id": p["id"], "status": {"$in": LIVE}, "check_in": {"$lt": to},
                                      "check_out": {"$gt": frm}}, {"_id": 0, "check_in": 1, "check_out": 1}).to_list(500)
        booked = sum(len([d for d in _nights(b["check_in"], b["check_out"]) if frm <= d < to]) for b in bks)
        nxt = await db.bookings.find({"property_id": p["id"], "status": "confirmed", "check_in": {"$gte": frm}},
                                     {"_id": 0, "code": 1, "check_in": 1, "guest_name": 1, "platform": 1}).sort("check_in", 1).limit(1).to_list(1)
        out.append({**p, "pricing": pricing_of(p), "channels": chans, "occupancy_30d": round(booked / 30 * 100),
                    "next_booking": nxt[0] if nxt else None,
                    "needs_details": await db.bookings.count_documents({"property_id": p["id"], "needs_details": True,
                                                                        "status": {"$nin": ["cancelled", "declined"]}}),
                    "conflicts": await db.bookings.count_documents({"property_id": p["id"], "status": "conflict"})})
    return out


def _nights(ci, co):
    d, end = date.fromisoformat(ci), date.fromisoformat(co)
    while d < end:
        yield d.isoformat()
        d += timedelta(days=1)


def _safe_url(url):
    """Calendar links must be public https/http addresses (no internal network addresses)."""
    u = urlparse(url or "")
    if u.scheme not in ("http", "https") or not u.hostname:
        raise HTTPException(422, "Paste the full calendar link starting with https://")
    try:
        for info in socket.getaddrinfo(u.hostname, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                raise HTTPException(422, "That calendar address is not reachable from the internet")
    except socket.gaierror:
        raise HTTPException(422, "That calendar address could not be found")
    return url


@router.get("/short-stay/channels")
async def list_channels(property_id: Optional[str] = None, user=Depends(require("shortstay", "r"))):
    f = {"property_id": property_id} if property_id else {}
    f.update({k: v for k, v in scope(user, "shortstay").items()})
    rows = await db.stay_channels.find(f, {"_id": 0}).sort("created_at", 1).to_list(1000)
    base = SITE_URL or ""
    for c in rows:
        c["export_url"] = f"{base}/api/public/ical/{c['export_token']}.ics" if c.get("export_token") else None
        c["label"] = PLATFORMS.get(c["platform"], (c["platform"],))[0]
    return rows


@router.post("/short-stay/channels")
async def add_channel(body: ChannelIn, user=Depends(require("shortstay", "w"))):
    p = await _unit(user, body.property_id)
    if body.platform not in PLATFORMS:
        raise HTTPException(422, "Unknown platform")
    if await db.stay_channels.find_one({"property_id": p["id"], "platform": body.platform}):
        raise HTTPException(409, f"{PLATFORMS[body.platform][0]} is already set up for this property")
    if body.ical_import_url:
        _safe_url(body.ical_import_url)
    c = {"id": new_id(), **body.model_dump(), "property_title": p["title"], "branch_id": p.get("branch_id"),
         "commission_pct": body.commission_pct if body.commission_pct is not None else PLATFORMS[body.platform][1],
         "export_token": secrets.token_urlsafe(24), "last_sync_at": None, "last_sync_status": None, "last_sync_error": None,
         "last_sync_events": 0, "created_at": now_iso(), "created_by": user["id"]}
    await db.stay_channels.insert_one(dict(c))
    await audit(user, "channel_added", "shortstay", c["id"], {"platform": body.platform, "property": p["code"]})
    return c


async def _channel(user, cid):
    c = await db.stay_channels.find_one({"id": cid, **scope(user, "shortstay")}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Channel not found")
    return c


@router.patch("/short-stay/channels/{cid}")
async def edit_channel(cid: str, body: dict, user=Depends(require("shortstay", "w"))):
    c = await _channel(user, cid)
    upd = {k: body[k] for k in ("listing_url", "ical_import_url", "commission_pct", "active") if k in body}
    if upd.get("ical_import_url"):
        _safe_url(upd["ical_import_url"])
    if "commission_pct" in upd and upd["commission_pct"] is not None and not (0 <= float(upd["commission_pct"]) <= 60):
        raise HTTPException(422, "Commission must be between 0 and 60%")
    await db.stay_channels.update_one({"id": cid}, {"$set": upd})
    await audit(user, "channel_updated", "shortstay", cid, upd)
    return {**c, **upd}


@router.post("/short-stay/channels/{cid}/rotate-link")
async def rotate(cid: str, user=Depends(require("shortstay", "w"))):
    await _channel(user, cid)
    tok = secrets.token_urlsafe(24)
    await db.stay_channels.update_one({"id": cid}, {"$set": {"export_token": tok}})
    await audit(user, "channel_link_rotated", "shortstay", cid)
    return {"export_url": f"{SITE_URL}/api/public/ical/{tok}.ics"}


# ---------------- Calendar export (platforms read this) ----------------
@router.get("/public/ical/{token}.ics")
async def export_ics(token: str):
    c = await db.stay_channels.find_one({"export_token": token, "active": {"$ne": False}}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Calendar not found")
    since = (today_ist() - timedelta(days=30)).isoformat()
    events = []
    # every booking except the ones this platform already knows about (they came from it)
    for b in await db.bookings.find({"property_id": c["property_id"], "status": {"$in": LIVE + ["conflict"]},
                                     "check_out": {"$gte": since}, "channel_id": {"$ne": c["id"]}},
                                    {"_id": 0, "id": 1, "check_in": 1, "check_out": 1}).to_list(5000):
        events.append({"uid": b["id"], "start": b["check_in"], "end": b["check_out"], "summary": "Reserved"})
    for k in await db.stay_blocks.find({"property_id": c["property_id"], "end": {"$gte": since},
                                        "channel_id": {"$ne": c["id"]}}, {"_id": 0}).to_list(2000):
        events.append({"uid": k["id"], "start": k["start"], "end": k["end"], "summary": "Not available"})
    await db.stay_channels.update_one({"id": c["id"]}, {"$set": {"last_export_at": now_iso()}})
    return Response(ical.build(f"{c.get('property_title') or 'Property'} · Sellandiamman Estates", events),
                    media_type="text/calendar; charset=utf-8", headers={"Cache-Control": "no-store"})


# ---------------- Calendar import ----------------
async def reconcile(c, events):
    """Brings a platform's calendar into ours: new reservations become bookings needing guest details, closed dates
    become blocks, dates that moved are moved, reservations that disappeared are cancelled, clashes are flagged."""
    from routes_ops import make_booking, BookingIn, release_nights, reserve_nights
    prop = await db.properties.find_one({"id": c["property_id"]}, {"_id": 0})
    if not prop:
        return {"created": 0, "updated": 0, "cancelled": 0, "blocks": 0, "conflicts": 0}
    label = PLATFORMS.get(c["platform"], (c["platform"],))[0]
    today = today_ist().isoformat()
    seen, out = set(), {"created": 0, "updated": 0, "cancelled": 0, "blocks": 0, "conflicts": 0}
    rate = pricing_of(prop)["base_rate"] or prop.get("nightly_rate") or 1
    for e in events:
        if ical.is_ours(e["uid"]) or e["status"] == "CANCELLED" or e["end"] < today:
            continue
        seen.add(e["uid"])
        if ical.is_block(e["summary"]):
            blk = await db.stay_blocks.find_one({"channel_id": c["id"], "uid": e["uid"]}, {"_id": 0})
            if not blk:
                await db.stay_blocks.insert_one({"id": new_id(), "property_id": prop["id"], "start": e["start"], "end": e["end"],
                                                 "reason": "closed_on_platform", "note": f"Closed on {label}", "channel_id": c["id"],
                                                 "uid": e["uid"], "branch_id": prop.get("branch_id"), "created_at": now_iso(),
                                                 "created_by": None})
                out["blocks"] += 1
                # some platforms (e.g. Booking.com) show their own reservations as closed dates: warn if one clashes with ours
                clash = await db.bookings.find_one({"property_id": prop["id"], "status": {"$in": ["confirmed", "checked_in"]},
                                                    "channel_id": {"$ne": c["id"]}, "check_in": {"$lt": e["end"]},
                                                    "check_out": {"$gt": e["start"]}}, {"_id": 0, "id": 1, "code": 1})
                if clash:
                    out["conflicts"] += 1
                    await notify_roles(["shortstay_ops", "branch_manager"], f"Check {label}: {prop['title']}",
                                       f"{label} shows {e['start']} to {e['end']} as taken, but {clash['code']} is booked here. "
                                       f"If {label} sold these nights, one booking has to move.", "/erp/short-stay",
                                       dedupe=f"blkclash:{c['id']}:{e['uid']}", kind="warning", branch_id=prop.get("branch_id"))
            elif (blk["start"], blk["end"]) != (e["start"], e["end"]):
                await db.stay_blocks.update_one({"id": blk["id"]}, {"$set": {"start": e["start"], "end": e["end"]}})
            continue
        b = await db.bookings.find_one({"channel_id": c["id"], "channel_uid": e["uid"]}, {"_id": 0})
        if b:
            if (b["check_in"], b["check_out"]) != (e["start"], e["end"]) and b["status"] in ("confirmed", "conflict"):
                await release_nights(b["id"])
                moved = {**b, "check_in": e["start"], "check_out": e["end"]}
                nights = len(list(_nights(e["start"], e["end"])))
                calc = calc_shortstay(date.fromisoformat(e["start"]), date.fromisoformat(e["end"]), b["nightly_rate"], b.get("discount", 0),
                                      b.get("cleaning_fee", 0), b.get("platform_fee", 0) if nights == b["nights"] else
                                      r2(b["nightly_rate"] * nights * (c.get("commission_pct") or 0) / 100),
                                      b.get("operating_costs", 0), b.get("mgmt_fee_pct", 0))
                status = "confirmed"
                try:
                    await reserve_nights(moved)
                except HTTPException:
                    status = "conflict"
                    out["conflicts"] += 1
                await db.bookings.update_one({"id": b["id"]}, {"$set": {"check_in": e["start"], "check_out": e["end"], **calc,
                                                                         "status": status}, "$push": {"issues": {
                    "at": now_iso(), "by": "Calendar sync", "note": f"Dates changed on {label}: {b['check_in']}–{b['check_out']} → {e['start']}–{e['end']}"}}})
                out["updated"] += 1
            continue
        nights = len(list(_nights(e["start"], e["end"])))
        guest = e["summary"].strip()
        generic = not guest or guest.lower() in ("reserved", "booked", "reservation", "airbnb", label.lower())
        body = BookingIn(property_id=prop["id"], guest_name=f"Guest via {label}" if generic else guest[:120], guest_phone=None,
                         guests=1, check_in=e["start"], check_out=e["end"], nightly_rate=float(rate), platform=c["platform"],
                         platform_fee=r2(float(rate) * nights * float(c.get("commission_pct") or 0) / 100), source_ref=e["uid"][:120],
                         notes=(e["description"] or "")[:500] or None)
        extra = {"channel_id": c["id"], "channel_uid": e["uid"], "needs_details": True, "amounts_estimated": True}
        try:
            await make_booking(body, SYSTEM, "confirmed", "ical", extra)
            out["created"] += 1
        except HTTPException as ex:
            if ex.status_code != 409:
                raise
            bk = await make_booking(body, SYSTEM, "conflict", "ical", extra, check_overlap=False)
            out["conflicts"] += 1
            await notify_roles(["shortstay_ops", "branch_manager", "director"], f"Double booking: {prop['title']}",
                               f"{label} has {e['start']} to {e['end']} ({bk['code']}), which clashes: {ex.detail}",
                               "/erp/short-stay", dedupe=f"conflict:{bk['id']}", kind="warning", branch_id=prop.get("branch_id"))
    # reservations that vanished from the platform's calendar were cancelled there
    async for b in db.bookings.find({"channel_id": c["id"], "source": "ical", "status": {"$in": ["confirmed", "conflict"]},
                                     "check_in": {"$gte": today}}, {"_id": 0}):
        if b.get("channel_uid") not in seen:
            await db.bookings.update_one({"id": b["id"]}, {"$set": {"status": "cancelled", "cancelled_at": now_iso(),
                                                                     "cancel_reason": f"Removed from the {label} calendar"}})
            await release_nights(b["id"])
            out["cancelled"] += 1
            await notify_roles(["shortstay_ops"], f"Cancelled on {label}: {b['code']}", f"{prop['title']} {b['check_in']}",
                               "/erp/short-stay", dedupe=f"ical-cancel:{b['id']}", branch_id=prop.get("branch_id"))
    await db.stay_blocks.delete_many({"channel_id": c["id"], "uid": {"$nin": list(seen)}, "end": {"$gte": today}})
    return out


async def sync_channel(c, text=None):
    try:
        if text is None:
            url = _safe_url(c.get("ical_import_url"))
            async with httpx.AsyncClient(timeout=20, follow_redirects=True) as h:
                r = await h.get(url, headers={"User-Agent": "SellandiammanEstates-CalendarSync/1.0"})
                r.raise_for_status()
                text = r.text[:3_000_000]
        events = ical.parse(text)
        if "BEGIN:VCALENDAR" not in (text or ""):
            raise ValueError("That link did not return a calendar (.ics)")
        res = await reconcile(c, events)
        await db.stay_channels.update_one({"id": c["id"]}, {"$set": {"last_sync_at": now_iso(), "last_sync_status": "ok",
                                                                    "last_sync_error": None, "last_sync_events": len(events),
                                                                    "last_sync_result": res}})
        return {"ok": True, "events": len(events), **res}
    except (httpx.HTTPError, ValueError, HTTPException) as e:
        msg = getattr(e, "detail", None) or str(e) or e.__class__.__name__
        await db.stay_channels.update_one({"id": c["id"]}, {"$set": {"last_sync_at": now_iso(), "last_sync_status": "failed",
                                                                    "last_sync_error": str(msg)[:300]}})
        return {"ok": False, "error": str(msg)[:300]}


@router.post("/short-stay/channels/{cid}/sync")
async def sync_now(cid: str, user=Depends(require("shortstay", "w"))):
    c = await _channel(user, cid)
    if not c.get("ical_import_url"):
        raise HTTPException(422, "Paste this platform's calendar (iCal) link first")
    res = await sync_channel(c)
    await audit(user, "channel_synced", "shortstay", cid, res)
    return res


@router.post("/short-stay/channels/{cid}/import-text")
async def import_text(cid: str, body: dict, user=Depends(require("shortstay", "w"))):
    """For a calendar file downloaded from the platform (or when its link cannot be reached)."""
    c = await _channel(user, cid)
    text = str(body.get("ics") or body.get("text") or "")
    if "BEGIN:VCALENDAR" not in text:
        raise HTTPException(422, "That is not a calendar file (.ics)")
    res = await sync_channel(c, text[:3_000_000])
    await audit(user, "channel_imported", "shortstay", cid, res)
    return res


async def sync_all():
    n = 0
    async for c in db.stay_channels.find({"active": {"$ne": False}, "ical_import_url": {"$nin": [None, ""]}}, {"_id": 0}):
        res = await sync_channel(c)
        n += 1
        if not res.get("ok"):
            logger.warning("Calendar sync failed for %s: %s", c.get("id"), res.get("error"))
    return n


# ---------------- Blocks ----------------
class BlockIn(BaseModel):
    property_id: str
    start: str = Field(pattern=DATE)
    end: str = Field(pattern=DATE)
    reason: str = Field("owner_stay", pattern=r"^(owner_stay|maintenance|hold|other)$")
    note: Optional[str] = Field(None, max_length=300)


@router.post("/short-stay/blocks")
async def add_block(body: BlockIn, user=Depends(require("shortstay", "w"))):
    p = await _unit(user, body.property_id)
    if body.end <= body.start:
        raise HTTPException(422, "The end date must be after the start date")
    clash = await db.bookings.find_one({"property_id": p["id"], "status": {"$in": LIVE}, "check_in": {"$lt": body.end},
                                        "check_out": {"$gt": body.start}}, {"_id": 0, "code": 1})
    if clash:
        raise HTTPException(409, f"Booking {clash['code']} is on these dates")
    k = {"id": new_id(), **body.model_dump(), "channel_id": None, "uid": None, "branch_id": p.get("branch_id"),
         "created_by": user["id"], "created_by_name": user["name"], "created_at": now_iso()}
    await db.stay_blocks.insert_one(dict(k))
    await audit(user, "dates_blocked", "shortstay", k["id"], {"property": p["code"], "start": body.start, "end": body.end})
    return k


@router.delete("/short-stay/blocks/{kid}")
async def remove_block(kid: str, user=Depends(require("shortstay", "w"))):
    k = await db.stay_blocks.find_one({"id": kid}, {"_id": 0})
    if not k:
        raise HTTPException(404, "Not found")
    await _unit(user, k["property_id"])
    if k.get("channel_id"):
        raise HTTPException(422, "These dates are closed on the platform; open them there and sync")
    await db.stay_blocks.delete_one({"id": kid})
    await audit(user, "dates_unblocked", "shortstay", kid)
    return {"ok": True}


# ---------------- Pricing & quotes ----------------
class Season(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    start: str = Field(pattern=DATE)
    end: str = Field(pattern=DATE)
    rate: float = Field(gt=0)


class PricingIn(BaseModel):
    base_rate: float = Field(gt=0)
    weekend_rate: Optional[float] = Field(None, ge=0)
    cleaning_fee: float = Field(0, ge=0)
    min_nights: int = Field(1, ge=1, le=60)
    weekly_discount_pct: float = Field(0, ge=0, le=60)
    monthly_discount_pct: float = Field(0, ge=0, le=70)
    included_guests: int = Field(2, ge=1, le=50)
    extra_guest_fee: float = Field(0, ge=0)
    seasons: List[Season] = []


@router.put("/short-stay/units/{pid}/pricing")
async def set_pricing(pid: str, body: PricingIn, user=Depends(require("shortstay", "w"))):
    await _unit(user, pid)
    for s in body.seasons:
        if s.end < s.start:
            raise HTTPException(422, f"{s.name}: the end date is before the start date")
    pr = body.model_dump()
    await db.properties.update_one({"id": pid}, {"$set": {"stay_pricing": pr, "nightly_rate": body.base_rate}})
    await audit(user, "pricing_updated", "shortstay", pid, {"base_rate": body.base_rate, "seasons": len(body.seasons)})
    return pr


class QuoteIn(BaseModel):
    property_id: str
    check_in: str = Field(pattern=DATE)
    check_out: str = Field(pattern=DATE)
    guests: int = Field(1, ge=1, le=50)
    platform: str = "direct"


async def _quote(p, ci, co, guests, platform):
    from routes_ops import platform_commission
    try:
        q = stay_quote(date.fromisoformat(ci), date.fromisoformat(co), pricing_of(p), guests)
    except ValueError as e:
        raise HTTPException(422, str(e))
    pct = await platform_commission(p["id"], platform)
    fee = r2(q["total"] * pct / 100)
    calc = calc_shortstay(date.fromisoformat(ci), date.fromisoformat(co), q["avg_rate"], 0, q["cleaning_fee"], fee, 0,
                          p.get("mgmt_fee_pct") or 0)
    return {**q, "platform": platform, "platform_pct": pct, "platform_fee": fee, "management_fee": calc["management_fee"],
            "owner_payout": calc["owner_payout"]}


@router.post("/short-stay/quote")
async def quote(body: QuoteIn, user=Depends(require("shortstay", "r"))):
    p = await _unit(user, body.property_id)
    return await _quote(p, body.check_in, body.check_out, body.guests, body.platform)


# ---------------- Multi-unit calendar & performance ----------------
@router.get("/short-stay/calendar")
async def calendar(frm: str, to: str, user=Depends(require("shortstay", "r"))):
    if len(frm) != 10 or len(to) != 10 or to <= frm:
        raise HTTPException(422, "Use from/to dates as YYYY-MM-DD")
    sc = scope(user, "shortstay")
    units = await db.properties.find({"transaction": "short_stay", "deleted": {"$ne": True}, **sc},
                                     {"_id": 0, "id": 1, "code": 1, "title": 1, "locality": 1, "city": 1, "branch_id": 1}).to_list(500)
    ids = [u["id"] for u in units]
    bks = await db.bookings.find({"property_id": {"$in": ids}, "status": {"$nin": ["cancelled", "declined"]},
                                  "check_in": {"$lt": to}, "check_out": {"$gt": frm}},
                                 {"_id": 0, "id": 1, "code": 1, "property_id": 1, "check_in": 1, "check_out": 1, "guest_name": 1,
                                  "platform": 1, "status": 1, "nights": 1, "needs_details": 1, "gross": 1}).to_list(5000)
    blocks = await db.stay_blocks.find({"property_id": {"$in": ids}, "start": {"$lt": to}, "end": {"$gt": frm}}, {"_id": 0}).to_list(2000)
    return {"units": units, "bookings": bks, "blocks": blocks}


@router.get("/short-stay/performance")
async def performance(frm: str, to: str, user=Depends(require("shortstay", "r"))):
    """By platform and by unit for stays checking in between the dates (cancellations counted separately)."""
    sc = scope(user, "shortstay")
    units = await db.properties.find({"transaction": "short_stay", "deleted": {"$ne": True}, **sc},
                                     {"_id": 0, "id": 1, "code": 1, "title": 1}).to_list(500)
    ids = [u["id"] for u in units]
    rows = await db.bookings.find({"property_id": {"$in": ids}, "check_in": {"$gte": frm, "$lte": to}}, {"_id": 0}).to_list(10000)
    days = (date.fromisoformat(to) - date.fromisoformat(frm)).days + 1
    by_p, by_u = {}, {u["id"]: {**u, "nights": 0, "room": 0.0, "gross": 0.0, "fees": 0.0, "bookings": 0} for u in units}
    for b in rows:
        k = by_p.setdefault(b["platform"], {"platform": b["platform"], "label": PLATFORMS.get(b["platform"], (b["platform"],))[0],
                                           "bookings": 0, "nights": 0, "gross": 0.0, "commission": 0.0, "net": 0.0,
                                           "mgmt_fee": 0.0, "room": 0.0, "cancelled": 0, "lead_days": 0})
        if b["status"] in ("cancelled", "declined"):
            k["cancelled"] += 1
            continue
        if b["status"] in ("requested", "conflict"):
            continue
        k["bookings"] += 1
        k["nights"] += b["nights"]
        k["gross"] += b["gross"]
        k["commission"] += b.get("platform_fee") or 0
        k["net"] += b.get("net_after_platform") or 0
        k["mgmt_fee"] += b.get("management_fee") or 0
        k["room"] += b.get("room_revenue") or 0
        k["lead_days"] += max(0, (date.fromisoformat(b["check_in"]) - date.fromisoformat(b["created_at"][:10])).days)
        u = by_u[b["property_id"]]
        u["bookings"] += 1
        u["nights"] += b["nights"]
        u["room"] += b.get("room_revenue") or 0
        u["gross"] += b["gross"]
        u["fees"] += b.get("management_fee") or 0
    plat = []
    for k in by_p.values():
        plat.append({**{x: (r2(v) if isinstance(v, float) else v) for x, v in k.items()},
                     "adr": r2(k["room"] / k["nights"]) if k["nights"] else 0,
                     "avg_lead_days": round(k["lead_days"] / k["bookings"]) if k["bookings"] else None,
                     "commission_pct": r2(k["commission"] / k["gross"] * 100) if k["gross"] else 0})
    blocked = {}
    for k in await db.stay_blocks.find({"property_id": {"$in": ids}, "start": {"$lte": to}, "end": {"$gt": frm}}, {"_id": 0}).to_list(2000):
        blocked[k["property_id"]] = blocked.get(k["property_id"], 0) + len([d for d in _nights(k["start"], k["end"]) if frm <= d <= to])
    unit_rows = []
    for u in by_u.values():
        avail = max(1, days - blocked.get(u["id"], 0))
        unit_rows.append({**{x: (r2(v) if isinstance(v, float) else v) for x, v in u.items()}, "available_nights": avail,
                          "occupancy_pct": round(min(100, u["nights"] / avail * 100), 1),
                          "adr": r2(u["room"] / u["nights"]) if u["nights"] else 0, "revpar": r2(u["room"] / avail)})
    return {"from": frm, "to": to, "platforms": sorted(plat, key=lambda x: -x["gross"]), "units": unit_rows}


# ---------------- Website: availability and booking requests ----------------
@router.get("/public/properties/{listing_id}/availability")
async def availability(listing_id: str):
    p = await db.properties.find_one({"listing_id": listing_id, "transaction": "short_stay",
                                      "status": {"$in": ["published", "under_offer"]}, "deleted": {"$ne": True}}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Listing not found")
    t = today_ist()
    to = (t + timedelta(days=210)).isoformat()
    taken = []
    for b in await db.bookings.find({"property_id": p["id"], "status": {"$in": ["confirmed", "checked_in", "conflict"]},
                                     "check_out": {"$gt": t.isoformat()}, "check_in": {"$lt": to}},
                                    {"_id": 0, "check_in": 1, "check_out": 1}).to_list(2000):
        taken.append({"start": b["check_in"], "end": b["check_out"]})
    for k in await db.stay_blocks.find({"property_id": p["id"], "end": {"$gt": t.isoformat()}}, {"_id": 0}).to_list(2000):
        taken.append({"start": k["start"], "end": k["end"]})
    pr = pricing_of(p)
    return {"taken": sorted(taken, key=lambda x: x["start"]), "min_nights": pr["min_nights"], "base_rate": pr["base_rate"],
            "weekend_rate": pr.get("weekend_rate"), "cleaning_fee": pr["cleaning_fee"], "max_guests": p.get("max_guests"),
            "today": t.isoformat()}


class StayRequestIn(BaseModel):
    listing_id: str = Field(max_length=30)
    check_in: str = Field(pattern=DATE)
    check_out: str = Field(pattern=DATE)
    guests: int = Field(1, ge=1, le=50)
    name: str = Field(min_length=2, max_length=100)
    phone: str = Field(min_length=10, max_length=20)
    email: Optional[str] = Field(None, max_length=120)
    message: Optional[str] = Field(None, max_length=1000)
    consent: bool
    marketing_consent: bool = False
    website: Optional[str] = ""
    cf_token: Optional[str] = Field(None, max_length=4000)


@router.post("/public/stay-request")
async def stay_request(body: StayRequestIn, request: Request):
    """A website guest asks for dates. The dates are checked now; staff confirm by phone/WhatsApp and take payment."""
    rate_limit(request, "public_form", 8, 600)
    if body.website:
        return {"ok": True, "reference": "received"}
    if not body.consent:
        raise HTTPException(422, "Please accept the privacy policy to continue")
    from routes_public import verify_human
    from routes_crm import create_lead
    from routes_ops import make_booking, BookingIn, blocked_by
    await verify_human(request, body.cf_token)
    p = await db.properties.find_one({"listing_id": body.listing_id, "transaction": "short_stay",
                                      "status": {"$in": ["published", "under_offer"]}, "deleted": {"$ne": True}}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Listing not found")
    if body.check_in < today_ist().isoformat():
        raise HTTPException(422, "Choose dates from today onwards")
    if p.get("max_guests") and body.guests > p["max_guests"]:
        raise HTTPException(422, f"This home takes up to {p['max_guests']} guests")
    phone = normalize_phone(body.phone)
    if await blocked_by(p["id"], body.check_in, body.check_out) or await db.bookings.find_one(
            {"property_id": p["id"], "status": {"$in": ["confirmed", "checked_in", "conflict"]}, "check_in": {"$lt": body.check_out},
             "check_out": {"$gt": body.check_in}}):
        raise HTTPException(409, "Those dates are already taken. Please choose other dates.")
    q = await _quote(p, body.check_in, body.check_out, body.guests, "website")
    lead, _ = await create_lead({"name": body.name.strip(), "phone": phone, "email": body.email, "source": "website",
                                 "interest": "short_stay", "customer_type": "buyer", "property_id": p["id"],
                                 "branch_id": p.get("branch_id"), "assigned_to": p.get("assigned_manager"),
                                 "requirements": f"Stay {body.check_in} to {body.check_out}, {body.guests} guests. {body.message or ''}".strip(),
                                 "marketing_consent": body.marketing_consent, "preferred_contact": "whatsapp"},
                                None, f"Stay request on the website: {body.check_in} to {body.check_out} ({q['nights']} nights)")
    bk = await make_booking(BookingIn(property_id=p["id"], guest_name=body.name.strip(), guest_phone=phone, guest_email=body.email,
                                      guests=body.guests, check_in=body.check_in, check_out=body.check_out, nightly_rate=q["avg_rate"],
                                      cleaning_fee=q["cleaning_fee"], platform="website", platform_fee=0, notes=body.message),
                            None, "requested", "website", {"lead_id": lead["id"], "quote_total": q["total"]})
    await notify_roles(["shortstay_ops", "branch_manager"], f"Stay request: {p['title']}",
                       f"{body.name} · {body.check_in} to {body.check_out} · {body.guests} guests · about ₹{q['total']:,.0f}",
                       "/erp/short-stay", dedupe=f"stayreq:{bk['id']}", branch_id=p.get("branch_id"))
    return {"ok": True, "reference": bk["code"], "nights": q["nights"], "estimate": q["total"]}
