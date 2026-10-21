"""CEO dashboard: company health score (0-100) from six pillars, the figures behind it, a branch league table, a
6-month trend and 'what to fix first', for any dates, branch, town and locality. Downloadable as a PDF report or CSV."""
import csv
import io
import re
from datetime import date, timedelta, datetime
from statistics import median
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response, StreamingResponse
from core import db, require, audit, get_settings, today_ist, allowed_branches, REQ_BRANCH, IST, can
from logic import score_linear, status_for, grade_for, combine, r2, xirr

router = APIRouter()
PILLARS = [("growth", "Growth", 15), ("profit", "Revenue & profit", 20), ("cash", "Cash & collections", 20),
           ("sales", "Sales effectiveness", 15), ("portfolio", "Portfolio & occupancy", 15), ("service", "Service & compliance", 15)]


def _d(s):
    return date.fromisoformat(s[:10])


def _in(v, frm, to):
    return bool(v) and frm <= str(v)[:10] <= to


class Scope:
    """Which branches / properties a CEO view covers."""

    def __init__(self, branches, city=None, locality=None):
        self.branches = branches  # None = all
        self.city = (city or "").strip().lower() or None
        self.locality = (locality or "").strip().lower() or None
        self.pids = None

    async def load(self):
        if self.city or self.locality:
            f = {}
            if self.city:
                f["city"] = {"$regex": f"^{re.escape(self.city)}$", "$options": "i"}
            if self.locality:
                f["locality"] = {"$regex": f"^{re.escape(self.locality)}$", "$options": "i"}
            self.pids = {p["id"] for p in await db.properties.find(f, {"_id": 0, "id": 1}).to_list(100000)}
        return self

    def br(self, doc):
        return self.branches is None or doc.get("branch_id") in self.branches

    def place(self, pid):
        return self.pids is None or pid in self.pids

    def ok(self, doc, pid_field="property_id"):
        return self.br(doc) and self.place(doc.get(pid_field) if pid_field else None)

    @property
    def located(self):
        return self.pids is not None


async def load_all():
    """Reads the collections once per dashboard request; every period / branch is then worked out in memory."""
    nd = {"deleted": {"$ne": True}}
    return {"properties": await db.properties.find(nd, {"_id": 0, "publication_history": 0, "geo": 0}).to_list(100000),
            "deals": await db.deals.find(nd, {"_id": 0, "history": 0, "offers": 0, "checklist": 0}).to_list(100000),
            "leases": await db.leases.find({}, {"_id": 0}).to_list(100000),
            "rent_payments": await db.rent_payments.find({}, {"_id": 0}).to_list(200000),
            "bookings": await db.bookings.find({}, {"_id": 0, "issues": 0}).to_list(100000),
            "leads": await db.leads.find(nd, {"_id": 0}).to_list(100000),
            "work_orders": await db.work_orders.find({}, {"_id": 0, "history": 0}).to_list(100000),
            "expenses": await db.expenses.find({"paid_from": {"$ne": "owner_funds"}}, {"_id": 0}).to_list(100000),
            "invoices": await db.invoices.find({"status": {"$ne": "void"}}, {"_id": 0, "lines": 0}).to_list(100000),
            "payments": await db.payments.find({}, {"_id": 0}).to_list(100000),
            "site_visits": await db.site_visits.find({}, {"_id": 0}).to_list(100000),
            "ledger_rev": await db.ledger_entries.find({"ledger": "company", "account": {"$regex": "^revenue:"}},
                                                       {"_id": 0, "amount": 1, "direction": 1, "branch_id": 1, "posted_at": 1}).to_list(200000),
            "first_acts": {}}


async def gather(sc, frm, to, data=None):
    """All figures for one period and scope."""
    data = data or await load_all()
    props = [p for p in data["properties"] if sc.ok(p, "id")]
    deals = [d for d in data["deals"] if sc.ok(d)]
    leases = [x for x in data["leases"] if sc.ok(x)]
    lease_map = {x["id"]: x for x in leases}
    rents = [r for r in data["rent_payments"] if frm <= r["date"] <= to and r["lease_id"] in lease_map]
    bookings = [b for b in data["bookings"] if sc.ok(b)]
    leads_all = data["leads"]

    def lead_ok(ld):
        if not sc.br(ld):
            return False
        if not sc.located:
            return True
        if ld.get("property_id") in (sc.pids or set()):
            return True
        txt = (ld.get("preferred_locations") or "").lower()
        return bool((sc.locality and sc.locality in txt) or (sc.city and not sc.locality and sc.city in txt))
    leads = [ld for ld in leads_all if lead_ok(ld)]
    wos = [w for w in data["work_orders"] if sc.ok(w)]
    expenses = [e for e in data["expenses"] if frm <= e["date"] <= to and sc.br(e) and (not sc.located or e.get("property_id") in sc.pids)]
    invoices = [i for i in data["invoices"] if sc.br(i)]
    payments = [p for p in data["payments"] if frm <= p["date"] <= to]
    inv_map = {i["id"]: i for i in invoices}
    visits = [v for v in data["site_visits"] if sc.ok(v)]

    brokerage = sum(d.get("final_commission") or 0 for d in deals if d["stage"] == "won" and _in(d.get("closed_at"), frm, to))
    def net_of_gst(p):
        i = inv_map[p["invoice_id"]]
        return p["amount"] * (i.get("subtotal") or i.get("total") or 0) / i["total"] if i.get("total") else p["amount"]
    # brokerage billed without a deal record (e.g. older deals entered straight in Finance) counts when it is paid
    if not sc.located:
        brokerage += sum(net_of_gst(p) for p in payments if p["invoice_id"] in inv_map and inv_map[p["invoice_id"]]["type"] == "brokerage"
                         and not inv_map[p["invoice_id"]].get("deal_id"))
    management = sum(r["amount"] * float(r.get("mgmt_fee_pct") or 0) / 100 for r in rents)
    shortstay = sum(b.get("management_fee") or 0 for b in bookings if b["status"] in ("completed", "checked_in") and _in(b["check_out"], frm, to))
    other = 0.0 if sc.located else sum(net_of_gst(p) for p in payments if p["invoice_id"] in inv_map and inv_map[p["invoice_id"]]["type"] in ("marketing", "other"))
    revenue = r2(brokerage + management + shortstay + other)
    wo_company = sum(w.get("actual_cost") or 0 for w in wos if w.get("charge_to") == "company" and _in(w.get("completed_at"), frm, to))
    expense_total = r2(sum(e["amount"] for e in expenses) + wo_company)
    t = today_ist().isoformat()
    outstanding = [i for i in invoices if i["status"] in ("issued", "partially_paid")]
    out_total = sum(i["total"] - i["paid"] - (i.get("credited") or 0) for i in outstanding)
    overdue = sum(i["total"] - i["paid"] - (i.get("credited") or 0) for i in outstanding if i["due_date"] < min(t, to))
    rent_due = rent_paid = 0.0
    for x in leases:
        for s in x.get("schedule") or []:
            if frm <= s["due_date"] <= min(to, t):
                rent_due += s["amount"]
                rent_paid += min(s["paid"], s["amount"])
    arrears = sum(s["amount"] - s["paid"] for x in leases if x["status"] == "active" for s in x.get("schedule") or [] if s["due_date"] < t)
    new_leads = [ld for ld in leads if _in(ld["created_at"], frm, to)]
    closed = [ld for ld in leads if ld["stage"] in ("won", "lost") and _in(ld.get("updated_at"), frm, to)]
    won = [ld for ld in closed if ld["stage"] == "won"]
    acts = data["first_acts"]
    missing = [ld["id"] for ld in new_leads if ld["id"] not in acts]
    if missing:
        for lid in missing:
            acts[lid] = None
        for a in await db.lead_activities.find({"lead_id": {"$in": missing}, "kind": {"$nin": ["created", "duplicate_enquiry"]}},
                                               {"_id": 0, "lead_id": 1, "created_at": 1}).to_list(100000):
            if acts.get(a["lead_id"]) is None or a["created_at"] < acts[a["lead_id"]]:
                acts[a["lead_id"]] = a["created_at"]
    resp = []
    for ld in new_leads:
        if acts.get(ld["id"]):
            try:
                resp.append(max(0.0, (datetime.fromisoformat(acts[ld["id"]]) - datetime.fromisoformat(ld["created_at"])).total_seconds() / 3600))
            except ValueError:
                pass
    visits_done = [v for v in visits if v["status"] == "completed" and _in(v.get("updated_at") or v.get("scheduled_at"), frm, to)]
    deals_new = [d for d in deals if _in(d["created_at"], frm, to)]
    managed = [p for p in props if p.get("transaction") in ("rent", "lease") and p.get("service_type") == "management"
               and p.get("status") not in ("inactive", "archived")]
    occupied = [p for p in managed if p.get("occupancy") == "occupied"]
    units = [p for p in props if p.get("transaction") == "short_stay" and p.get("status") not in ("inactive", "archived", "draft")]
    days = (_d(to) - _d(frm)).days + 1
    ss_nights = 0
    for b in bookings:
        if b["status"] in ("confirmed", "checked_in", "completed"):
            d0, d1 = max(_d(b["check_in"]), _d(frm)), min(_d(b["check_out"]), _d(to) + timedelta(days=1))
            ss_nights += max(0, (d1 - d0).days)
    published = [p for p in props if p.get("status") == "published"]
    stale = [p for p in published if p.get("published_at") and (_d(t) - _d(p["published_at"])).days > 90]
    auth_bad = [p for p in published if (p.get("authorization") or {}).get("expiry", "0000") < (_d(t) + timedelta(days=30)).isoformat()]
    wo_done = [w for w in wos if _in(w.get("completed_at"), frm, to)]

    def on_time(w):
        if w.get("due_date"):
            return w["completed_at"][:10] <= w["due_date"]
        return (_d(w["completed_at"]) - _d(w["created_at"])).days <= 7
    wo_open_overdue = [w for w in wos if w["status"] in ("open", "assigned", "in_progress") and w.get("due_date") and w["due_date"] < t]
    ledger_rev = [e for e in data["ledger_rev"] if frm <= (e.get("posted_at") or "")[:10] <= to]
    collected = sum(e["amount"] * (1 if e["direction"] == "in" else -1) for e in ledger_rev if sc.br(e)) if not sc.located else None
    ss_live = [b for b in bookings if b["status"] in ("completed", "checked_in", "confirmed") and _in(b["check_in"], frm, to)]
    return {
        "revenue": revenue, "by_service": {"brokerage": r2(brokerage), "management": r2(management), "shortstay": r2(shortstay), "other": r2(other)},
        "expenses": expense_total, "net": r2(revenue - expense_total), "collected": r2(collected) if collected is not None else None,
        "receivables": r2(out_total), "overdue": r2(overdue), "rent_due": r2(rent_due), "rent_paid": r2(rent_paid), "arrears": r2(arrears),
        "rent_collected": r2(sum(r["amount"] for r in rents)),
        "new_leads": len(new_leads), "closed_leads": len(closed), "won_leads": len(won),
        "first_response_h": round(median(resp), 1) if resp else None, "visits_done": len(visits_done), "deals_new": len(deals_new),
        "deals_won": len([d for d in deals if d["stage"] == "won" and _in(d.get("closed_at"), frm, to)]),
        "commission": r2(brokerage), "managed": len(managed), "occupied": len(occupied), "units": len(units),
        "ss_available": len(units) * days, "ss_nights": ss_nights, "ss_bookings": len(ss_live),
        "ss_gross": r2(sum(b["gross"] for b in ss_live)), "ss_adr": r2(sum(b.get("room_revenue") or 0 for b in ss_live) / max(1, sum(b["nights"] for b in ss_live))),
        "published": len(published), "stale": len(stale), "auth_bad": len(auth_bad), "wo_done": len(wo_done),
        "wo_on_time": len([w for w in wo_done if on_time(w)]), "wo_open_overdue": len(wo_open_overdue),
        "active_leases": len([x for x in leases if x["status"] == "active"]), "listings_total": len(props),
    }


async def company_compliance():
    admins = await db.users.find({"role": {"$in": ["super_admin", "director"]}, "active": True}, {"_id": 0, "mfa_enabled": 1}).to_list(100)
    inv = await db.investors.find({"deleted": {"$ne": True}}, {"_id": 0, "kyc_status": 1}).to_list(10000)
    return {"admins": len(admins), "admins_2step": len([a for a in admins if a.get("mfa_enabled")]),
            "investors": len(inv), "investors_kyc": len([i for i in inv if i.get("kyc_status") == "verified"])}


def pct(a, b):
    return round(a / b * 100, 1) if b else None


def growth(cur, prev):
    if prev in (None, 0):
        return 100.0 if cur else None
    return round(max(-100.0, min(999.0, (cur - prev) / prev * 100)), 1)


def metrics(cur, prev, comp, targets_month=None, days=30):
    M = []

    def add(key, pillar, label, value, unit, bad, good, target, fix, link, raw=None):
        s = score_linear(value, bad, good)
        M.append({"key": key, "pillar": pillar, "label": label, "value": value, "unit": unit, "score": s, "status": status_for(s),
                  "target": target, "fix": fix, "link": link, "raw": raw})
    add("revenue_growth", "growth", "Revenue vs previous period", growth(cur["revenue"], prev["revenue"]), "%", -20, 15, "+15% or more",
        "Look at which service fell (brokerage, management, short stays) in the revenue split and push that team.", "/erp/ceo",
        f"₹{cur['revenue']:,.0f} vs ₹{prev['revenue']:,.0f}")
    add("lead_growth", "growth", "New enquiries vs previous period", growth(cur["new_leads"], prev["new_leads"]), "%", -25, 20, "+20% or more",
        "Refresh listings, post an Insight, run a campaign for the weakest town.", "/erp/leads", f"{cur['new_leads']} vs {prev['new_leads']}")
    margin = pct(cur["net"], cur["revenue"]) if cur["revenue"] else None
    add("margin", "profit", "Operating margin", margin, "%", 0, 40, "40% or more",
        "Check expenses by category in Finance; cut spend that does not bring leads or fees.", "/erp/finance",
        f"₹{cur['net']:,.0f} left from ₹{cur['revenue']:,.0f}")
    if targets_month:
        want = targets_month * days / 30
        add("target", "profit", "Revenue against target", pct(cur["revenue"], want), "%", 50, 100, "100%",
            "Agree weekly targets per agent and per branch; review pipeline value each Monday.", "/erp/deals",
            f"₹{cur['revenue']:,.0f} of ₹{want:,.0f}")
    od = pct(cur["overdue"], cur["receivables"]) if cur["receivables"] else (0.0 if cur["receivables"] == 0 else None)
    add("overdue", "cash", "Invoices overdue (share of money owed)", od, "%", 50, 0, "Under 10%",
        "Call the oldest overdue invoices first; send the invoice PDF on WhatsApp.", "/erp/finance",
        f"₹{cur['overdue']:,.0f} overdue of ₹{cur['receivables']:,.0f}")
    add("rent_collection", "cash", "Rent collected on time", pct(cur["rent_paid"], cur["rent_due"]), "%", 70, 98, "98% or more",
        "Follow up arrears from Leases & Rent; the reminders list shows who is late.", "/erp/leases",
        f"₹{cur['rent_paid']:,.0f} of ₹{cur['rent_due']:,.0f} due")
    add("conversion", "sales", "Leads won (of leads closed)", pct(cur["won_leads"], cur["closed_leads"]), "%", 5, 30, "30% or more",
        "Read the lost reasons in CRM; train on the most common one.", "/erp/leads", f"{cur['won_leads']} won of {cur['closed_leads']}")
    add("response", "sales", "First response to a new lead (median)", cur["first_response_h"], "hours", 48, 2, "Within 2 hours",
        "Assign website leads automatically to the branch agent and check overdue follow-ups daily.", "/erp/leads")
    add("visit_to_deal", "sales", "Site visits turning into deals", pct(cur["deals_new"], cur["visits_done"]), "%", 5, 35, "35% or more",
        "Shortlist better before visits: use 'Matching listings' on each lead.", "/erp/leads",
        f"{cur['deals_new']} deals from {cur['visits_done']} visits")
    add("occupancy", "portfolio", "Managed rentals occupied", pct(cur["occupied"], cur["managed"]), "%", 60, 95, "95% or more",
        "List vacant managed homes first on the website and portals; review their rent.", "/erp/properties", f"{cur['occupied']} of {cur['managed']}")
    add("ss_occupancy", "portfolio", "Short-stay nights booked", pct(cur["ss_nights"], cur["ss_available"]), "%", 20, 70, "70% or more",
        "Check each home's platforms and prices in Short stays → Homes & platforms; add missing platforms.", "/erp/short-stay",
        f"{cur['ss_nights']} of {cur['ss_available']} nights")
    add("fresh_listings", "portfolio", "Listings fresher than 90 days", pct(cur["published"] - cur["stale"], cur["published"]), "%", 50, 90,
        "90% or more", "Re-price or re-shoot listings older than 90 days.", "/erp/properties", f"{cur['stale']} older than 90 days")
    add("maintenance", "service", "Repairs finished on time", pct(cur["wo_on_time"], cur["wo_done"]), "%", 50, 95, "95% or more",
        "Give every work order a due date and a vendor on day one.", "/erp/maintenance",
        f"{cur['wo_on_time']} of {cur['wo_done']}; {cur['wo_open_overdue']} open and late")
    add("authorisations", "service", "Listings with valid owner authorisation", pct(cur["published"] - cur["auth_bad"], cur["published"]), "%",
        70, 100, "100%", "Renew authorisations ending within 30 days (Calendar shows them).", "/erp/calendar",
        f"{cur['auth_bad']} ending or ended")
    add("two_step", "service", "Directors and admins with 2-step sign-in", pct(comp["admins_2step"], comp["admins"]), "%", 0, 100, "100%",
        "Turn on 2-step sign-in in Security and require it for these roles in Settings.", "/erp/security")
    if comp["investors"]:
        add("investor_kyc", "service", "Investors with KYC verified", pct(comp["investors_kyc"], comp["investors"]), "%", 50, 100, "100%",
            "Collect PAN and address proof for investors marked pending.", "/erp/investors")
    return M


def _months(to, n=6):
    d = _d(to).replace(day=1)
    out = []
    for _ in range(n):
        out.append(d)
        d = (d - timedelta(days=1)).replace(day=1)
    return list(reversed(out))


async def compute(user, frm, to, branch=None, city=None, locality=None, league=True, trend=True, data=None, comp=None):
    data = data or await load_all()
    allowed = allowed_branches(user)
    if branch and branch != "all":
        if allowed is not None and branch not in allowed:
            raise HTTPException(403, "You can only see your own branches")
        brs = [branch]
    else:
        brs = allowed
    sc = await Scope(brs, city, locality).load()
    days = (_d(to) - _d(frm)).days + 1
    pfrm, pto = (_d(frm) - timedelta(days=days)).isoformat(), (_d(frm) - timedelta(days=1)).isoformat()
    cur, prev = await gather(sc, frm, to, data), await gather(sc, pfrm, pto, data)
    comp = comp or await company_compliance()
    s = await get_settings()
    tg = (s.get("targets") or {}).get("monthly_revenue") or {}
    target = sum(float(v or 0) for k, v in tg.items() if k != "all" and (brs is None or k in brs)) if brs is not None else float(tg.get("all") or 0) or sum(
        float(v or 0) for k, v in tg.items() if k != "all")
    ms = metrics(cur, prev, comp, target or None, days)
    cw = s.get("health_weights") or {}
    W = [(k, lab, int(cw.get(k, w))) for k, lab, w in PILLARS]
    pillars = [{"key": k, "label": lab, "weight": w, "metrics": [m for m in ms if m["pillar"] == k]} for k, lab, w in W]
    score, pillars = combine(pillars)
    prev_score = None
    if league:  # the top-level view also shows how the previous period scored
        pms = metrics(prev, await gather(sc, (_d(pfrm) - timedelta(days=days)).isoformat(), (_d(pfrm) - timedelta(days=1)).isoformat(), data),
                      comp, target or None, days)
        prev_score, _ = combine([{"key": k, "label": lab, "weight": w, "metrics": [m for m in pms if m["pillar"] == k]} for k, lab, w in W])
    weight = {k: w for k, _, w in W}
    fix = sorted([m for m in ms if m["score"] is not None and m["score"] < 75],
                 key=lambda m: -(100 - m["score"]) * weight[m["pillar"]])[:6]
    out = {"period": {"from": frm, "to": to, "days": days, "prev_from": pfrm, "prev_to": pto}, "score": score, "grade": grade_for(score),
           "status": status_for(score), "prev_score": prev_score, "pillars": pillars, "fix_first": fix,
           "kpis": {**cur, "prev": {k: prev[k] for k in ("revenue", "expenses", "net", "new_leads", "deals_won", "commission", "ss_gross")}},
           "filters": {"branch": branch or "all", "city": city, "locality": locality}}
    if trend:
        rows = []
        for m in _months(to):
            mf = m.isoformat()
            mt = min(((m.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)), _d(to)).isoformat()
            g = await gather(sc, mf, mt, data)
            rows.append({"month": mf[:7], "revenue": g["revenue"], "expenses": g["expenses"], "net": g["net"], "new_leads": g["new_leads"],
                         "deals_won": g["deals_won"], "rent_collected": g["rent_collected"], "ss_gross": g["ss_gross"]})
        out["trend"] = rows
    if league:
        bl = await db.branches.find({"active": {"$ne": False}}, {"_id": 0, "id": 1, "name": 1}).sort("order", 1).to_list(100)
        rows = []
        for b in bl:
            if brs is not None and b["id"] not in brs:
                continue
            sub = await compute(user, frm, to, b["id"], city, locality, league=False, trend=False, data=data, comp=comp)
            k = sub["kpis"]
            rows.append({"branch_id": b["id"], "branch": b["name"], "score": sub["score"], "grade": sub["grade"], "revenue": k["revenue"],
                         "net": k["net"], "new_leads": k["new_leads"], "deals_won": k["deals_won"],
                         "conversion": pct(k["won_leads"], k["closed_leads"]), "occupancy": pct(k["occupied"], k["managed"]),
                         "arrears": k["arrears"], "listings": k["published"]})
        out["league"] = sorted(rows, key=lambda r: -(r["score"] or 0))
    inv = await db.investments.find({"status": "active"}, {"_id": 0, "amount": 1, "project_id": 1}).to_list(100000)
    if can(user, "investors", "r") or user["role"] in ("super_admin", "director"):
        dist = await db.distributions.find({"date": {"$gte": frm, "$lte": to}}, {"_id": 0, "gross": 1}).to_list(100000)
        out["investors"] = {"capital": r2(sum(i["amount"] for i in inv)), "projects": len({i["project_id"] for i in inv}),
                            "payouts": r2(sum(d["gross"] for d in dist))}
    return out


def _range(frm, to):
    t = today_ist()
    to = to or t.isoformat()
    frm = frm or (t - timedelta(days=89)).isoformat()
    if frm > to:
        raise HTTPException(422, "The start date is after the end date")
    if (_d(to) - _d(frm)).days > 731:
        raise HTTPException(422, "Choose at most two years")
    return frm, to


@router.get("/ceo/dashboard")
async def dashboard(frm: Optional[str] = None, to: Optional[str] = None, branch: Optional[str] = None, city: Optional[str] = None,
                    locality: Optional[str] = None, user=Depends(require("ceo", "r"))):
    frm, to = _range(frm, to)
    return await compute(user, frm, to, branch or REQ_BRANCH.get(), city, locality)


def _fmt(m):
    if m["value"] is None:
        return "No data"
    return f"{m['value']:g}{'%' if m['unit'] == '%' else ' ' + m['unit']}"


@router.get("/ceo/report.csv")
async def report_csv(frm: Optional[str] = None, to: Optional[str] = None, branch: Optional[str] = None, city: Optional[str] = None,
                     locality: Optional[str] = None, user=Depends(require("ceo", "e"))):
    frm, to = _range(frm, to)
    d = await compute(user, frm, to, branch or REQ_BRANCH.get(), city, locality)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Section", "Item", "Value", "Score", "Status", "Target", "Detail"])
    w.writerow(["Overall", "Health score", d["score"], d["score"], d["status"], "", f"Grade {d['grade']}; previous period {d['prev_score']}"])
    for p in d["pillars"]:
        w.writerow(["Pillar", p["label"], "", p["score"], p["status"], f"weight {p['weight']}", ""])
        for m in p["metrics"]:
            w.writerow(["Measure", m["label"], _fmt(m), m["score"], m["status"], m["target"], m.get("raw") or ""])
    for k, v in d["kpis"].items():
        if k != "prev" and not isinstance(v, dict):
            w.writerow(["Figure", k, v, "", "", "", ""])
    for r in d.get("league") or []:
        w.writerow(["Branch", r["branch"], r["revenue"], r["score"], r["grade"], "", f"leads {r['new_leads']}, deals {r['deals_won']}"])
    await audit(user, "export", "ceo", "report_csv", {"from": frm, "to": to})
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f"attachment; filename=ceo-report-{frm}-{to}.csv"})


def report_pdf_bytes(d, company, scope_label):
    from io import BytesIO
    from xml.sax.saxutils import escape
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, Spacer, Table, TableStyle, KeepTogether
    from pdf import _doc, _styles, _page, inr, INK, MUTED, RULE, HEAD
    buf = BytesIO()
    title = f"CEO report {d['period']['from']} to {d['period']['to']}"
    doc = _doc(buf, title)
    ss = _styles()
    tone = {"healthy": colors.HexColor("#047857"), "attention": colors.HexColor("#B45309"), "critical": colors.HexColor("#B91C1C"),
            "no_data": MUTED}

    def table(head, rows, widths, align_right_from=1):
        t = Table([head] + rows, colWidths=widths, repeatRows=1)
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), HEAD), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                               ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 8.4),
                               ("GRID", (0, 0), (-1, -1), 0.25, RULE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("ALIGN", (align_right_from, 1), (-1, -1), "RIGHT")]))
        return t
    k = d["kpis"]
    els = [Paragraph(escape(title), ss["DocTitle"]), Paragraph(escape(scope_label), ss["Small"]), Spacer(1, 8)]
    sc = d["score"]
    head = Table([[Paragraph(f"<font size=30><b>{sc if sc is not None else '-'}</b></font>", ss["Body"]),
                   Paragraph(f"<b>Company health score</b> (out of 100) · grade <b>{d['grade']}</b><br/>"
                             f"Previous period: {d['prev_score'] if d['prev_score'] is not None else '-'} · status: {d['status'].replace('_', ' ')}", ss["Body"])]],
                 colWidths=[30 * mm, 144 * mm])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("BOX", (0, 0), (-1, -1), 0.6, INK), ("TOPPADDING", (0, 0), (-1, -1), 8),
                              ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    els += [head, Spacer(1, 10), Paragraph("Key figures", ss["H3"])]
    figs = [["Revenue earned", inr(k["revenue"]), inr(k["prev"]["revenue"])], ["Expenses", inr(k["expenses"]), inr(k["prev"]["expenses"])],
            ["Net", inr(k["net"]), inr(k["prev"]["net"])], ["Brokerage commission", inr(k["by_service"]["brokerage"]), ""],
            ["Management fees", inr(k["by_service"]["management"]), ""], ["Short-stay fees", inr(k["by_service"]["shortstay"]), ""],
            ["Cash collected (company)", inr(k["collected"]) if k["collected"] is not None else "n/a for a town filter", ""],
            ["Money owed to us / overdue", f"{inr(k['receivables'])} / {inr(k['overdue'])}", ""],
            ["Rent collected for owners", inr(k["rent_collected"]), ""], ["Rent arrears today", inr(k["arrears"]), ""],
            ["New leads / deals won", f"{k['new_leads']} / {k['deals_won']}", f"{k['prev']['new_leads']} / {k['prev']['deals_won']}"],
            ["Short-stay bookings / nights / ADR", f"{k['ss_bookings']} / {k['ss_nights']} / {inr(k['ss_adr'])}", ""],
            ["Active leases / managed occupied", f"{k['active_leases']} / {k['occupied']} of {k['managed']}", ""]]
    if d.get("investors"):
        figs.append(["Investor capital / payouts in period", f"{inr(d['investors']['capital'])} / {inr(d['investors']['payouts'])}", ""])
    els.append(table(["Figure", "This period", "Previous period"], figs, [70 * mm, 60 * mm, 44 * mm]))
    els += [Spacer(1, 10), Paragraph("Health by pillar", ss["H3"])]
    rows = []
    for p in d["pillars"]:
        rows.append([Paragraph(f"<b>{escape(p['label'])}</b> (weight {p['weight']})", ss["Body"]), "", f"{p['score'] if p['score'] is not None else '-'}",
                     Paragraph(f"<font color='#{tone[p['status']].hexval()[2:]}'>{p['status'].replace('_', ' ')}</font>", ss["Body"])])
        for m in p["metrics"]:
            rows.append([Paragraph(escape(m["label"]) + (f"<br/><font size=7 color='#64748B'>{escape(m.get('raw') or '')}</font>" if m.get("raw") else ""), ss["Body"]),
                         _fmt(m), f"{m['score'] if m['score'] is not None else '-'}", Paragraph(escape(m["target"]), ss["Small"])])
    els.append(table(["Measure", "Value", "Score", "Target / status"], rows, [86 * mm, 30 * mm, 18 * mm, 40 * mm]))
    if d.get("fix_first"):
        els += [Spacer(1, 10), Paragraph("What to fix first", ss["H3"])]
        els += [Paragraph(f"<b>{escape(m['label'])}</b> ({_fmt(m)}, score {m['score']}): {escape(m['fix'])}", ss["Body"]) for m in d["fix_first"]]
    if d.get("league"):
        els += [Spacer(1, 10), KeepTogether([Paragraph("Branches", ss["H3"]), table(
            ["Branch", "Score", "Revenue", "Net", "Leads", "Deals", "Won %", "Occupied %", "Arrears"],
            [[r["branch"], f"{r['score'] if r['score'] is not None else '-'} ({r['grade']})", inr(r["revenue"]), inr(r["net"]), r["new_leads"], r["deals_won"],
              f"{r['conversion']:g}" if r["conversion"] is not None else "-", f"{r['occupancy']:g}" if r["occupancy"] is not None else "-", inr(r["arrears"])]
             for r in d["league"]], [28 * mm, 18 * mm, 24 * mm, 24 * mm, 12 * mm, 12 * mm, 14 * mm, 18 * mm, 24 * mm])])]
    if d.get("trend"):
        els += [Spacer(1, 10), KeepTogether([Paragraph("Last 6 months", ss["H3"]), table(
            ["Month", "Revenue", "Expenses", "Net", "Leads", "Deals", "Rent collected", "Short-stay gross"],
            [[r["month"], inr(r["revenue"]), inr(r["expenses"]), inr(r["net"]), r["new_leads"], r["deals_won"], inr(r["rent_collected"]), inr(r["ss_gross"])]
             for r in d["trend"]], [16 * mm, 24 * mm, 22 * mm, 22 * mm, 12 * mm, 12 * mm, 30 * mm, 30 * mm])])]
    els += [Spacer(1, 12), Paragraph("Revenue is what the company earned: brokerage on deals closed, management fees on rent collected, "
                                     "short-stay fees on completed stays and other invoices paid. Rent, deposits, booking proceeds and investor money "
                                     "held for others are not revenue. Scores run from 0 to 100; measures without data are left out.", ss["Small"])]
    doc.build(els, onFirstPage=_page(company, "CEO report"), onLaterPages=_page(company, "CEO report"))
    return buf.getvalue()


@router.get("/ceo/report.pdf")
async def report_pdf(frm: Optional[str] = None, to: Optional[str] = None, branch: Optional[str] = None, city: Optional[str] = None,
                     locality: Optional[str] = None, user=Depends(require("ceo", "e"))):
    frm, to = _range(frm, to)
    br = branch or REQ_BRANCH.get()
    d = await compute(user, frm, to, br, city, locality)
    bname = (await db.branches.find_one({"id": br}, {"_id": 0, "name": 1}) or {}).get("name") if br and br != "all" else None
    label = " · ".join(x for x in [f"Branch: {bname}" if bname else "All branches you can see", f"Town: {city}" if city else "",
                                   f"Locality: {locality}" if locality else "", f"Compared with {d['period']['prev_from']} to {d['period']['prev_to']}"] if x)
    await audit(user, "export", "ceo", "report_pdf", {"from": frm, "to": to, "branch": br, "city": city})
    return Response(report_pdf_bytes(d, await get_settings(), label), media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename=ceo-report-{frm}-{to}.pdf"})
