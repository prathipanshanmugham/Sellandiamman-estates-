"""Co-investors: people who put money into specific properties or projects through the company. Staff record projects,
capital received, valuations and payouts; investors sign in to their own dashboard (/investor) to see holdings,
current value, payouts, returns (XIRR), statements, documents and project updates."""
import re
from datetime import date, timedelta
from typing import Optional, List
import jwt
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field
from core import (db, now, now_iso, new_id, next_code, normalize_phone, require, can, audit, notify, post_ledger,
                  investor_user, get_settings, today_ist, head_office_id, branch_filter, JWT_SECRET, JWT_ALG)
from logic import xirr, r2
from pdf import make_pdf, inr

router = APIRouter()
DATE = r"^\d{4}-\d{2}-\d{2}$"
KINDS = ["rental_income", "land_bank", "development", "short_stay", "commercial_lease"]
DIST_KINDS = ["rental_income", "profit_share", "interest", "capital_return"]


# ---------------- Calculations ----------------
def _valuation_at(project, on):
    vals = sorted([v for v in project.get("valuations") or [] if v["date"] <= on], key=lambda v: v["date"])
    return vals[-1]["value"] if vals else None


async def project_book(pid):
    """Everything needed to value a project: investments, distributions, capital and the latest value."""
    p = await db.inv_projects.find_one({"id": pid}, {"_id": 0})
    inv = await db.investments.find({"project_id": pid}, {"_id": 0}).to_list(5000)
    dist = await db.distributions.find({"project_id": pid}, {"_id": 0}).to_list(20000)
    return p, inv, dist


def holding_values(project, investments, distributions, on=None):
    """Per active/exited investment: share of the project, current value, payouts and XIRR."""
    on = on or today_ist().isoformat()
    active = [i for i in investments if i["status"] == "active" and i["date"] <= on]
    capital = sum(i["amount"] for i in active)
    val = _valuation_at(project, on)
    value = val if val is not None else capital
    out = {}
    for i in investments:
        share = (i["amount"] / capital) if i["status"] == "active" and capital else 0
        cur = r2(value * share) if i["status"] == "active" else 0.0
        ds = [d for d in distributions if d["investment_id"] == i["id"]]
        paid = r2(sum(d["gross"] for d in ds))
        flows = [(date.fromisoformat(i["date"]), -i["amount"])] + [(date.fromisoformat(d["date"]), d["gross"]) for d in ds]
        if i["status"] == "exited" and i.get("exit_date"):
            flows.append((date.fromisoformat(i["exit_date"]), i.get("exit_amount") or 0))
        elif cur:
            flows.append((date.fromisoformat(on), cur))
        gain = r2(cur + paid + (i.get("exit_amount") or 0) - i["amount"])
        out[i["id"]] = {"share_pct": r2(share * 100), "current_value": cur, "distributions": paid,
                        "net_distributions": r2(sum(d["net"] for d in ds)), "tds": r2(sum(d.get("tds") or 0 for d in ds)),
                        "gain": gain, "xirr": xirr(flows), "flows": flows}
    return out, capital, value


async def portfolio(investor_id, on=None):
    on = on or today_ist().isoformat()
    invs = await db.investments.find({"investor_id": investor_id}, {"_id": 0}).sort("date", 1).to_list(500)
    holdings, flows = [], []
    books = {}
    for i in invs:
        if i["project_id"] not in books:
            books[i["project_id"]] = await project_book(i["project_id"])
        p, all_inv, all_dist = books[i["project_id"]]
        vals, capital, value = holding_values(p, all_inv, all_dist, on)
        v = vals[i["id"]]
        flows += v.pop("flows")
        holdings.append({**i, **v, "project": {k: p.get(k) for k in ("id", "code", "name", "kind", "city", "locality", "status",
                                                                     "target_irr_pct", "cover_image")}})
    active = [h for h in holdings if h["status"] == "active"]
    totals = {"invested": r2(sum(h["amount"] for h in holdings)), "active_invested": r2(sum(h["amount"] for h in active)),
              "current_value": r2(sum(h["current_value"] for h in active)), "distributions": r2(sum(h["distributions"] for h in holdings)),
              "net_distributions": r2(sum(h["net_distributions"] for h in holdings)), "tds": r2(sum(h["tds"] for h in holdings)),
              "realised": r2(sum(h.get("exit_amount") or 0 for h in holdings)), "xirr": xirr(flows), "holdings": len(active)}
    totals["gain"] = r2(totals["current_value"] + totals["distributions"] + totals["realised"] - totals["invested"])
    totals["ytd_distributions"] = r2(sum(d["gross"] for d in await db.distributions.find(
        {"investor_id": investor_id, "date": {"$gte": _fy_start(on)}}, {"_id": 0, "gross": 1}).to_list(5000)))
    return holdings, totals, books


def _fy_start(on):
    d = date.fromisoformat(on)
    y = d.year if d.month >= 4 else d.year - 1
    return f"{y}-04-01"


def _month_ends(start, end):
    d = date.fromisoformat(start).replace(day=1)
    stop = date.fromisoformat(end)
    while d <= stop:
        nxt = (d.replace(day=28) + timedelta(days=4)).replace(day=1)
        yield min(nxt - timedelta(days=1), stop).isoformat()
        d = nxt


async def value_series(investor_id):
    invs = await db.investments.find({"investor_id": investor_id}, {"_id": 0}).to_list(500)
    if not invs:
        return []
    t = today_ist().isoformat()
    books = {pid: await project_book(pid) for pid in {i["project_id"] for i in invs}}
    out = []
    for me in _month_ends(min(i["date"] for i in invs), t):
        value = invested = paid = 0.0
        for pid, (p, all_inv, all_dist) in books.items():
            vals, _, _ = holding_values(p, [x for x in all_inv if x["date"] <= me], all_dist, me)
            for i in invs:
                if i["project_id"] == pid and i["date"] <= me:
                    invested += i["amount"]
                    if i["status"] == "active" or (i.get("exit_date") or "9999") > me:
                        value += vals.get(i["id"], {}).get("current_value", 0)
            paid += sum(d["gross"] for d in all_dist if d["investor_id"] == investor_id and d["date"] <= me)
        out.append({"month": me[:7], "value": r2(value), "invested": r2(invested), "distributions": r2(paid)})
    return out


# ---------------- Investors ----------------
class InvestorIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str
    email: Optional[str] = Field(None, max_length=120)
    kind: str = Field("individual", pattern=r"^(individual|huf|company|nri|trust)$")
    city: Optional[str] = Field(None, max_length=60)
    pan_last4: Optional[str] = Field(None, pattern=r"^[A-Za-z0-9]{4}$")
    rm_id: Optional[str] = None
    notes: Optional[str] = Field(None, max_length=2000)


async def _investor(iid):
    i = await db.investors.find_one({"id": iid, "deleted": {"$ne": True}}, {"_id": 0})
    if not i:
        raise HTTPException(404, "Investor not found")
    return i


@router.get("/investors")
async def list_investors(q: Optional[str] = None, user=Depends(require("investors", "r"))):
    f = {"deleted": {"$ne": True}}
    if q:
        rx = {"$regex": re.escape(q[:60]), "$options": "i"}
        f["$or"] = [{"name": rx}, {"phone": rx}, {"code": rx}]
    rows = await db.investors.find(f, {"_id": 0}).sort("created_at", -1).to_list(2000)
    for r in rows:
        _, totals, _ = await portfolio(r["id"])
        r["totals"] = totals
    return rows


@router.post("/investors")
async def new_investor(body: InvestorIn, user=Depends(require("investors", "w"))):
    phone = normalize_phone(body.phone)
    if await db.investors.find_one({"phone": phone, "deleted": {"$ne": True}}):
        raise HTTPException(409, "An investor with this mobile number already exists")
    i = {"id": new_id(), "code": await next_code("investor", "SE-I-"), **body.model_dump(), "phone": phone,
         "email": (body.email or "").strip().lower() or None, "pan_last4": (body.pan_last4 or "").upper() or None,
         "kyc_status": "pending", "branch_id": await head_office_id(), "created_by": user["id"], "created_at": now_iso(),
         "deleted": False}
    await db.investors.insert_one(dict(i))
    from routes_customers import link_customer
    c = await link_customer("investors", i["id"], {"name": i["name"], "phone": phone, "email": i["email"], "types": ["investor"],
                                                   "city": body.city, "source": "investor"}, user)
    i["customer_id"] = c and c["id"]
    await audit(user, "investor_created", "investors", i["id"])
    return i


@router.get("/investors/{iid}")
async def get_investor(iid: str, user=Depends(require("investors", "r"))):
    i = await _investor(iid)
    holdings, totals, _ = await portfolio(iid)
    i.update({"holdings": holdings, "totals": totals,
              "distributions": await db.distributions.find({"investor_id": iid}, {"_id": 0}).sort("date", -1).to_list(2000),
              "series": await value_series(iid)})
    if can(user, "users", "r"):
        i["portal_users"] = await db.users.find({"investor_id": iid, "role": "investor"},
                                                {"_id": 0, "id": 1, "email": 1, "active": 1, "last_login": 1}).to_list(5)
    if i.get("rm_id"):
        rm = await db.users.find_one({"id": i["rm_id"]}, {"_id": 0, "name": 1, "phone": 1})
        i["rm"] = rm
    return i


@router.patch("/investors/{iid}")
async def edit_investor(iid: str, body: dict, user=Depends(require("investors", "w"))):
    i = await _investor(iid)
    upd = {k: body[k] for k in ("name", "email", "kind", "city", "pan_last4", "rm_id", "notes", "kyc_status") if k in body}
    if upd.get("kyc_status") and upd["kyc_status"] not in ("pending", "verified", "rejected"):
        raise HTTPException(422, "Unknown KYC status")
    if upd.get("kyc_status") == "verified" and not can(user, "investors", "a"):
        raise HTTPException(403, "A director marks KYC as verified")
    if upd.get("pan_last4") and not re.fullmatch(r"[A-Za-z0-9]{4}", upd["pan_last4"]):
        raise HTTPException(422, "Enter only the last 4 characters of the PAN")
    await db.investors.update_one({"id": iid}, {"$set": upd})
    await audit(user, "investor_updated", "investors", iid, upd)
    return {**i, **upd}


@router.post("/investors/{iid}/portal-invite")
async def investor_invite(iid: str, body: dict, user=Depends(require("users", "w"))):
    from routes_auth import create_user, UserIn
    i = await _investor(iid)
    email = (body.get("email") or i.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(422, "Add the investor's email address first")
    out = await create_user(UserIn(email=email, name=i["name"][:100], role="investor", investor_id=iid, phone=i.get("phone")), user)
    if not i.get("email"):
        await db.investors.update_one({"id": iid}, {"$set": {"email": email}})
    await audit(user, "investor_portal_invited", "investors", iid, {"email": email})
    return out


# ---------------- Projects ----------------
class ProjectIn(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    kind: str
    city: str = Field(min_length=2, max_length=60)
    locality: Optional[str] = Field(None, max_length=80)
    property_ids: List[str] = []
    branch_id: Optional[str] = None
    target_raise: float = Field(gt=0)
    min_ticket: float = Field(0, ge=0)
    target_irr_pct: Optional[float] = Field(None, ge=0, le=100)
    expected_yield_pct: Optional[float] = Field(None, ge=0, le=100)
    start_date: str = Field(pattern=DATE)
    horizon_months: int = Field(36, ge=1, le=600)
    description: Optional[str] = Field(None, max_length=5000)
    cover_image: Optional[str] = Field(None, max_length=300)
    status: str = Field("open", pattern=r"^(open|funded|operating|exiting|exited)$")


@router.get("/inv-projects")
async def list_projects(user=Depends(require("investors", "r"))):
    rows = await db.inv_projects.find({"deleted": {"$ne": True}, **branch_filter(user)}, {"_id": 0}).sort("created_at", -1).to_list(500)
    for p in rows:
        _, inv, dist = await project_book(p["id"])
        vals, capital, value = holding_values(p, inv, dist)
        flows = [f for v in vals.values() for f in v["flows"]]
        p.update({"raised": r2(sum(i["amount"] for i in inv)), "capital": r2(capital), "current_value": r2(value),
                  "investors": len({i["investor_id"] for i in inv if i["status"] == "active"}),
                  "distributed": r2(sum(d["gross"] for d in dist)), "xirr": xirr(flows)})
    return rows


@router.post("/inv-projects")
async def new_project(body: ProjectIn, user=Depends(require("investors", "w"))):
    if body.kind not in KINDS:
        raise HTTPException(422, "Unknown project type")
    p = {"id": new_id(), "code": await next_code("inv_project", "SE-PR-", 3), **body.model_dump(),
         "branch_id": body.branch_id or await head_office_id(), "valuations": [], "updates": [], "created_by": user["id"],
         "created_at": now_iso(), "deleted": False}
    await db.inv_projects.insert_one(dict(p))
    await audit(user, "project_created", "investors", p["id"], {"name": body.name})
    return p


async def _project(pid):
    p = await db.inv_projects.find_one({"id": pid, "deleted": {"$ne": True}}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Project not found")
    return p


@router.get("/inv-projects/{pid}")
async def get_project(pid: str, user=Depends(require("investors", "r"))):
    p = await _project(pid)
    _, inv, dist = await project_book(pid)
    vals, capital, value = holding_values(p, inv, dist)
    names = {i["id"]: i["name"] for i in await db.investors.find({"id": {"$in": [x["investor_id"] for x in inv]}}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)}
    p["investments"] = [{**i, "investor_name": names.get(i["investor_id"]), **{k: v for k, v in vals[i["id"]].items() if k != "flows"}} for i in inv]
    p["distributions"] = sorted([{**d, "investor_name": names.get(d["investor_id"])} for d in dist], key=lambda d: d["date"], reverse=True)
    flows = [f for v in vals.values() for f in v["flows"]]
    p["totals"] = {"raised": r2(sum(i["amount"] for i in inv)), "capital": r2(capital), "current_value": r2(value),
                   "distributed": r2(sum(d["gross"] for d in dist)), "xirr": xirr(flows),
                   "investors": len({i["investor_id"] for i in inv if i["status"] == "active"})}
    p["properties"] = await db.properties.find({"id": {"$in": p.get("property_ids") or []}}, {"_id": 0, "id": 1, "code": 1, "title": 1, "status": 1}).to_list(50)
    return p


@router.patch("/inv-projects/{pid}")
async def edit_project(pid: str, body: dict, user=Depends(require("investors", "w"))):
    p = await _project(pid)
    allowed = ["name", "kind", "city", "locality", "property_ids", "target_raise", "min_ticket", "target_irr_pct",
               "expected_yield_pct", "horizon_months", "description", "cover_image", "status"]
    upd = {k: body[k] for k in allowed if k in body}
    try:
        ProjectIn(**{**p, **upd})
    except Exception:
        raise HTTPException(422, "Check the project details")
    await db.inv_projects.update_one({"id": pid}, {"$set": upd})
    await audit(user, "project_updated", "investors", pid, upd)
    return {**p, **upd}


class ValuationIn(BaseModel):
    date: str = Field(pattern=DATE)
    value: float = Field(gt=0)
    note: Optional[str] = Field(None, max_length=300)
    method: str = Field("internal", pattern=r"^(internal|valuer|sale_offer|guideline)$")


@router.post("/inv-projects/{pid}/valuations")
async def add_valuation(pid: str, body: ValuationIn, user=Depends(require("investors", "w"))):
    await _project(pid)
    if body.date > today_ist().isoformat():
        raise HTTPException(422, "A valuation cannot be dated in the future")
    v = {**body.model_dump(), "by": user["name"], "at": now_iso()}
    await db.inv_projects.update_one({"id": pid}, {"$push": {"valuations": v}})
    await audit(user, "valuation_added", "investors", pid, {"value": body.value, "date": body.date})
    return v


class UpdateIn(BaseModel):
    title: str = Field(min_length=3, max_length=140)
    body: str = Field(min_length=3, max_length=4000)


@router.post("/inv-projects/{pid}/updates")
async def add_update(pid: str, body: UpdateIn, user=Depends(require("investors", "w"))):
    p = await _project(pid)
    u = {"id": new_id(), **body.model_dump(), "by": user["name"], "at": now_iso()}
    await db.inv_projects.update_one({"id": pid}, {"$push": {"updates": u}})
    holders = {i["investor_id"] for i in await db.investments.find({"project_id": pid, "status": "active"}, {"_id": 0, "investor_id": 1}).to_list(5000)}
    users = await db.users.find({"role": "investor", "investor_id": {"$in": list(holders)}, "active": True}, {"_id": 0, "id": 1}).to_list(5000)
    await notify([x["id"] for x in users], f"Update: {p['name']}", body.title, "/investor/updates", dedupe=f"pu:{u['id']}")
    await audit(user, "project_update_posted", "investors", pid, {"title": body.title})
    return u


# ---------------- Capital and payouts ----------------
class InvestmentIn(BaseModel):
    investor_id: str
    project_id: str
    amount: float = Field(gt=0)
    date: str = Field(pattern=DATE)
    method: str = Field("bank_transfer", pattern=r"^(bank_transfer|cheque|upi|other)$")
    reference: str = Field(min_length=3, max_length=80)
    notes: Optional[str] = Field(None, max_length=500)


@router.post("/investments")
async def add_investment(body: InvestmentIn, user=Depends(require("investors", "w"))):
    inv = await _investor(body.investor_id)
    p = await _project(body.project_id)
    if p["status"] in ("exiting", "exited"):
        raise HTTPException(422, "This project is no longer taking money")
    if body.amount < (p.get("min_ticket") or 0):
        raise HTTPException(422, f"The minimum for this project is {inr(p['min_ticket'])}")
    if body.date > today_ist().isoformat():
        raise HTTPException(422, "Record money when it has been received")
    if await db.investments.find_one({"reference": body.reference, "project_id": p["id"]}):
        raise HTTPException(409, "A payment with this reference is already recorded")
    m = {"id": new_id(), "code": await next_code("investment", "SE-IV-", 5), **body.model_dump(), "project_name": p["name"],
         "investor_name": inv["name"], "status": "active", "exit_date": None, "exit_amount": None,
         "created_by": user["id"], "created_at": now_iso()}
    await db.investments.insert_one(dict(m))
    await post_ledger("investor_funds", "in", body.amount, "investment", m["id"], f"Capital from {inv['name']} for {p['name']}",
                      user, inv["id"], "investor_capital", p.get("branch_id"))
    await audit(user, "investment_recorded", "investors", m["id"], {"amount": body.amount, "project": p["code"]})
    return m


class DistributeIn(BaseModel):
    date: str = Field(pattern=DATE)
    kind: str
    amount: float = Field(gt=0)
    tds_pct: float = Field(0, ge=0, le=40)
    period: Optional[str] = Field(None, max_length=40)
    reference: Optional[str] = Field(None, max_length=80)


def split_pro_rata(total, active):
    """Splits a payout across active investments by amount; the last one takes the rounding difference."""
    cap = sum(i["amount"] for i in active)
    out, given = [], 0.0
    for k, i in enumerate(active):
        part = r2(total - given) if k == len(active) - 1 else r2(total * i["amount"] / cap)
        given = r2(given + part)
        out.append((i, part))
    return out


@router.post("/inv-projects/{pid}/distribute")
async def distribute(pid: str, body: DistributeIn, user=Depends(require("investors", "w"))):
    p = await _project(pid)
    if body.kind not in DIST_KINDS:
        raise HTTPException(422, "Unknown payout type")
    if body.date > today_ist().isoformat():
        raise HTTPException(422, "Record a payout on or after the day it is paid")
    active = [i for i in await db.investments.find({"project_id": pid, "status": "active", "date": {"$lte": body.date}},
                                                   {"_id": 0}).sort("date", 1).to_list(5000)]
    if not active:
        raise HTTPException(422, "No investors held this project on that date")
    batch = new_id()
    rows = []
    for i, part in split_pro_rata(body.amount, active):
        tds = r2(part * body.tds_pct / 100)
        d = {"id": new_id(), "code": await next_code("distribution", "SE-DS-", 5), "batch_id": batch, "project_id": pid,
             "project_name": p["name"], "investor_id": i["investor_id"], "investment_id": i["id"], "date": body.date,
             "kind": body.kind, "gross": part, "tds": tds, "net": r2(part - tds), "period": body.period,
             "reference": body.reference, "created_by": user["id"], "created_at": now_iso()}
        await db.distributions.insert_one(dict(d))
        await post_ledger("investor_funds", "out", d["net"], "distribution", d["id"],
                          f"{body.kind.replace('_', ' ').title()} {body.period or body.date} to {i['investor_name']} ({p['name']})",
                          user, i["investor_id"], f"investor_{body.kind}", p.get("branch_id"))
        if tds:
            await post_ledger("investor_funds", "out", tds, "distribution", d["id"], f"TDS withheld {i['investor_name']} ({p['name']})",
                              user, i["investor_id"], "tds_payable", p.get("branch_id"))
        rows.append(d)
    users = await db.users.find({"role": "investor", "investor_id": {"$in": [r["investor_id"] for r in rows]}, "active": True},
                                {"_id": 0, "id": 1, "investor_id": 1}).to_list(5000)
    for u in users:
        mine = next(r for r in rows if r["investor_id"] == u["investor_id"])
        await notify([u["id"]], f"Payout from {p['name']}", f"{inr(mine['net'])} ({body.period or body.date})", "/investor/payouts",
                     dedupe=f"dist:{mine['id']}")
    await audit(user, "distribution_posted", "investors", pid, {"amount": body.amount, "investors": len(rows), "kind": body.kind})
    return {"batch_id": batch, "rows": rows}


class ExitIn(BaseModel):
    date: str = Field(pattern=DATE)
    amount: float = Field(ge=0)
    reference: str = Field(min_length=3, max_length=80)


@router.post("/investments/{mid}/exit")
async def exit_investment(mid: str, body: ExitIn, user=Depends(require("investors", "a"))):
    m = await db.investments.find_one({"id": mid}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Investment not found")
    if m["status"] != "active":
        raise HTTPException(409, "Already exited")
    if body.date < m["date"]:
        raise HTTPException(422, "The exit date is before the investment date")
    p = await _project(m["project_id"])
    await db.investments.update_one({"id": mid}, {"$set": {"status": "exited", "exit_date": body.date, "exit_amount": body.amount,
                                                           "exit_reference": body.reference}})
    await post_ledger("investor_funds", "out", body.amount, "investment", mid, f"Exit paid to {m['investor_name']} ({p['name']})",
                      user, m["investor_id"], "investor_exit", p.get("branch_id"))
    await audit(user, "investment_exited", "investors", mid, {"amount": body.amount})
    return {"ok": True}


# ---------------- Statements ----------------
async def statement_pdf_bytes(investor_id, frm, to):
    i = await _investor(investor_id)
    holdings, totals, _ = await portfolio(investor_id, to)
    dist = await db.distributions.find({"investor_id": investor_id, "date": {"$gte": frm, "$lte": to}}, {"_id": 0}).sort("date", 1).to_list(5000)
    rows = [[h["project"]["name"], h["date"], inr(h["amount"]), f"{h['share_pct']:g}%",
             inr(h["current_value"]) if h["status"] == "active" else f"Exited {inr(h.get('exit_amount'))}",
             inr(h["distributions"]), f"{h['xirr']:g}%" if h["xirr"] is not None else "-"] for h in holdings]
    rows += [["", "", "", "", "", "", ""]] if dist else []
    rows += [[f"Payout · {d['project_name']}", d["date"], d["kind"].replace("_", " "), d.get("period") or "", f"TDS {inr(d['tds'])}",
              inr(d["gross"]), inr(d["net"])] for d in dist]
    meta = [("Investor", f"{i['name']} ({i['code']})"), ("Period", f"{frm} to {to}"), ("PAN (last 4)", i.get("pan_last4") or "-")]
    totals_rows = [("Total invested", inr(totals["invested"])), ("Current value of active holdings", inr(totals["current_value"])),
                   ("Payouts to date (before TDS)", inr(totals["distributions"])), (f"Payouts in this period", inr(sum(d["gross"] for d in dist))),
                   ("TDS withheld in this period", inr(sum(d["tds"] for d in dist))),
                   ("Annualised return (XIRR) to date", f"{totals['xirr']:g}%" if totals["xirr"] is not None else "-"),
                   ("Gain to date (value + payouts − invested)", inr(totals["gain"]))]
    return make_pdf(f"Investor Statement {frm} to {to}", await get_settings(), meta,
                    ["Holding / payout", "Date", "Invested / type", "Share / period", "Value", "Payouts (gross)", "XIRR / net"],
                    rows, totals_rows,
                    "Current values use the latest valuation recorded for each project and are estimates, not offers. "
                    "Past returns do not guarantee future returns. TDS certificates are issued separately.")


@router.get("/investors/{iid}/statement.pdf")
async def investor_statement(iid: str, frm: Optional[str] = None, to: Optional[str] = None,
                             user=Depends(require("investors", "r"))):
    to = to or today_ist().isoformat()
    frm = frm or _fy_start(to)
    await audit(user, "investor_statement", "investors", iid, {"from": frm, "to": to})
    return Response(await statement_pdf_bytes(iid, frm, to), media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename=investor-statement-{frm}-{to}.pdf"})


# ---------------- Investor portal ----------------
@router.get("/investor/overview")
async def portal_overview(user=Depends(investor_user)):
    iid = user["investor_id"]
    i = await _investor(iid)
    holdings, totals, books = await portfolio(iid)
    updates = []
    for pid, (p, _, _) in books.items():
        for u in p.get("updates") or []:
            updates.append({**u, "project_name": p["name"], "project_id": pid})
    rm = await db.users.find_one({"id": i.get("rm_id")}, {"_id": 0, "name": 1, "phone": 1, "email": 1, "whatsapp": 1}) if i.get("rm_id") else None
    return {"investor": {k: i.get(k) for k in ("code", "name", "kind", "kyc_status")}, "totals": totals,
            "holdings": [{k: v for k, v in h.items() if k not in ("created_by", "reference", "notes")} for h in holdings],
            "series": await value_series(iid), "updates": sorted(updates, key=lambda u: u["at"], reverse=True)[:10],
            "recent_payouts": await db.distributions.find({"investor_id": iid}, {"_id": 0, "created_by": 0}).sort("date", -1).limit(6).to_list(6),
            "rm": rm}


@router.get("/investor/payouts")
async def portal_payouts(user=Depends(investor_user)):
    return await db.distributions.find({"investor_id": user["investor_id"]}, {"_id": 0, "created_by": 0}).sort("date", -1).to_list(5000)


@router.get("/investor/holdings/{mid}")
async def portal_holding(mid: str, user=Depends(investor_user)):
    holdings, _, books = await portfolio(user["investor_id"])
    h = next((x for x in holdings if x["id"] == mid), None)
    if not h:
        raise HTTPException(404, "Holding not found")
    p, _, _ = books[h["project_id"]]
    return {**{k: v for k, v in h.items() if k not in ("created_by",)},
            "project": {k: p.get(k) for k in ("id", "code", "name", "kind", "city", "locality", "description", "status", "start_date",
                                              "horizon_months", "target_irr_pct", "expected_yield_pct", "cover_image", "valuations", "updates")},
            "payouts": await db.distributions.find({"investment_id": mid}, {"_id": 0, "created_by": 0}).sort("date", -1).to_list(2000)}


@router.get("/investor/updates")
async def portal_updates(user=Depends(investor_user)):
    _, _, books = await portfolio(user["investor_id"])
    out = []
    for pid, (p, _, _) in books.items():
        out += [{**u, "project_name": p["name"]} for u in p.get("updates") or []]
    posts = await db.posts.find({"audience": "investors", "status": "published", "deleted": {"$ne": True}},
                                {"_id": 0, "id": 1, "title": 1, "excerpt": 1, "body": 1, "published_at": 1, "cover_image": 1}).to_list(50)
    out += [{"id": x["id"], "title": x["title"], "body": x.get("body"), "at": x.get("published_at"), "project_name": "Company news", "by": "Sellandiamman Estates"} for x in posts]
    return sorted(out, key=lambda u: u.get("at") or "", reverse=True)


@router.get("/investor/statement.pdf")
async def portal_statement(frm: Optional[str] = None, to: Optional[str] = None, user=Depends(investor_user)):
    to = to or today_ist().isoformat()
    frm = frm or _fy_start(to)
    await audit(user, "portal_statement_download", "investors", user["investor_id"], {"from": frm, "to": to})
    return Response(await statement_pdf_bytes(user["investor_id"], frm, to), media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename=statement-{frm}-{to}.pdf"})


async def _portal_docs(user):
    iid = user["investor_id"]
    pids = list({i["project_id"] for i in await db.investments.find({"investor_id": iid}, {"_id": 0, "project_id": 1}).to_list(500)})
    return await db.documents.find({"is_latest": True, "share_with_investor": True,
                                    "$or": [{"entity_type": "investor", "entity_id": iid}, {"entity_type": "inv_project", "entity_id": {"$in": pids}}]},
                                   {"_id": 0, "id": 1, "original_name": 1, "doc_type": 1, "entity_type": 1, "created_at": 1}).sort("created_at", -1).to_list(500)


@router.get("/investor/documents")
async def portal_documents(user=Depends(investor_user)):
    return await _portal_docs(user)


@router.post("/investor/documents/{did}/link")
async def portal_doc_link(did: str, user=Depends(investor_user)):
    if did not in {d["id"] for d in await _portal_docs(user)}:
        raise HTTPException(404, "Not found")
    tok = jwt.encode({"doc": did, "uid": user["id"], "typ": "file", "exp": now() + timedelta(minutes=5)}, JWT_SECRET, algorithm=JWT_ALG)
    await audit(user, "document_link", "documents", did, {"portal": "investor"})
    return {"url": f"/api/files/{tok}", "expires_in": 300}
