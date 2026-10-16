"""Idempotent seeding: admin from env, branches, settings, optional synthetic demo data."""
import os
from datetime import timedelta
from core import db, now_iso, new_id, next_code, hash_password, verify_password, today_ist, logger
from routes_ops import build_schedule


async def ensure_indexes():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.sessions.create_index("sid", unique=True)
    await db.sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.login_attempts.create_index("identifier")
    await db.notifications.create_index("dedupe_key", unique=True)
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.payments.create_index("idempotency_key", unique=True)
    await db.rent_payments.create_index("idempotency_key", unique=True)
    await db.deposit_movements.create_index("idempotency_key", unique=True)
    await db.owner_statements.create_index([("owner_id", 1), ("month", 1)], unique=True)
    for c in ("properties", "leads", "deals", "owners", "leases", "bookings", "invoices", "work_orders", "documents",
              "ledger_entries", "tasks", "approvals", "expenses", "vendors"):
        await db[c].create_index("id", unique=True)
    await db.properties.create_index("listing_id", sparse=True)
    await db.properties.create_index([("status", 1), ("city", 1), ("transaction", 1)])
    await db.leads.create_index("phone")
    await db.leads.create_index([("stage", 1), ("assigned_to", 1)])
    await db.ledger_entries.create_index([("ledger", 1), ("posted_at", -1)])
    await db.audit_logs.create_index([("entity", 1), ("at", -1)])
    await db.bookings.create_index([("property_id", 1), ("check_in", 1)])


async def seed_core():
    email = os.environ["ADMIN_EMAIL"].strip().lower()
    pw = os.environ["ADMIN_PASSWORD"]
    u = await db.users.find_one({"email": email})
    if not u:
        await db.users.insert_one({"id": new_id(), "email": email, "name": "Super Administrator", "role": "super_admin",
                                   "active": True, "branch_ids": [], "password_hash": hash_password(pw),
                                   "created_at": now_iso()})
    elif not verify_password(pw, u.get("password_hash") or ""):
        await db.users.update_one({"email": email}, {"$set": {"password_hash": hash_password(pw)}})
    for b in ({"id": "br-erode", "name": "Erode", "city": "Erode"},
              {"id": "br-perundurai", "name": "Perundurai", "city": "Perundurai"}):
        await db.branches.update_one({"id": b["id"]}, {"$setOnInsert": b}, upsert=True)
    await db.settings.update_one({"id": "company"}, {"$setOnInsert": {
        "id": "company", "name": "Sellandiamman Estates", "legal_name": "Sellandiamman Estates (Sellandiamman Group)",
        "phone": "+91 00000 00000", "whatsapp": "", "email": "info@example.com",
        "address": "[Office address], Erode, Tamil Nadu", "gstin": "", "gst_enabled": False, "gst_rate": 0,
        "cities": ["Erode", "Perundurai"], "localities": [], "invoice_due_days": 15,
        "approvals": {"commission_change": True, "refunds": True, "write_offs": True},
        "demo_mode": os.environ.get("SEED_DEMO") == "true", "office_hours": "Mon–Sat, 9:30 AM – 6:30 PM",
        "hero_title": "Property services for Erode & Perundurai",
        "hero_subtitle": "Buy, sell, rent, lease and professionally managed homes, land and industrial spaces.",
        "testimonials": []}}, upsert=True)


DEMO_USERS = [("director", "Demo Director"), ("branch_manager", "Demo Branch Manager"),
              ("sales_agent", "Demo Sales Agent"), ("property_manager", "Demo Property Manager"),
              ("accountant", "Demo Accountant"), ("marketing", "Demo Marketing"),
              ("shortstay_ops", "Demo Short-Stay Ops"), ("auditor", "Demo Auditor")]


def _prop(code, title, cat, tx, city, loc, pin, price, unit, img, **kw):
    t = today_ist()
    return {"id": new_id(), "code": code, "title": title, "category": cat, "transaction": tx,
            "ownership_type": "third_party", "city": city, "locality": loc, "pincode": pin, "price": price,
            "price_unit": unit, "price_on_request": False, "images": img, "amenities": kw.pop("amenities", []),
            "area_unit": kw.pop("area_unit", "sq.ft"), "availability": "Immediate", "occupancy": "vacant",
            "status": "published", "verification": {"status": "verified", "by": "Seed", "at": now_iso()},
            "authorization": {"signed": True, "marketing_authorized": True, "expiry": (t + timedelta(days=180)).isoformat()},
            "publication_history": [{"at": now_iso(), "by": "Seed", "action": "published"}], "featured": False,
            "published_at": now_iso(), "created_at": now_iso(), "updated_at": now_iso(), "deleted": False,
            "service_type": "brokerage", "source": "direct", **kw}


async def seed_demo():
    if os.environ.get("SEED_DEMO") != "true" or await db.properties.count_documents({}) > 0:
        return
    pw = os.environ["DEMO_PASSWORD"]
    ids = {}
    for role, name in DEMO_USERS:
        uid = new_id()
        ids[role] = uid
        await db.users.update_one({"email": f"{role.replace('_', '.')}@demo.sellandiamman.test"}, {"$setOnInsert": {
            "id": uid, "email": f"{role.replace('_', '.')}@demo.sellandiamman.test", "name": name, "role": role,
            "active": True, "branch_ids": ["br-erode"], "password_hash": hash_password(pw), "created_at": now_iso()}},
            upsert=True)
        ids[role] = (await db.users.find_one({"email": f"{role.replace('_', '.')}@demo.sellandiamman.test"}))["id"]
    owners = []
    for i, n in enumerate(["Sample Owner A", "Sample Owner B", "Sample Owner C (NRI)", "Sample Industrial Owner LLP"]):
        o = {"id": new_id(), "code": await next_code("owner", "SE-O-"), "name": n, "phone": f"+9190000000{i:02d}",
             "email": f"owner{i}@example.com", "kind": "company" if "LLP" in n else "individual",
             "is_nri": "NRI" in n, "preferred_contact": "whatsapp", "created_at": now_iso(), "deleted": False}
        owners.append(o)
        await db.owners.insert_one(dict(o))
    ag, pm = ids["sales_agent"], ids["property_manager"]
    props = [
        _prop("SE-P-0001", "3 BHK Independent Villa", "villa", "sale", "Erode", "Thindal", "638009", 8500000, "total",
              ["/images/villa.jpg", "/images/interior.jpg"], bedrooms=3, bathrooms=3, built_area=2100, plot_area=2400,
              furnishing="semi_furnished", amenities=["Car parking", "Borewell", "Gated community"], featured=True,
              description_public="Sample listing: a well-ventilated 3 BHK villa with east-facing entrance, covered car parking and a landscaped garden.",
              owner_id=owners[0]["id"], assigned_agent=ag, branch_id="br-erode", survey_no="SF 101/2A"),
        _prop("SE-P-0002", "2 BHK Apartment for Rent", "apartment", "rent", "Erode", "Perundurai Road", "638011", 16000,
              "per_month", ["/images/apartment.jpg", "/images/interior.jpg"], bedrooms=2, bathrooms=2, built_area=1050,
              furnishing="furnished", amenities=["Lift", "Power backup", "Security"], featured=True,
              description_public="Sample listing: furnished 2 BHK on the 3rd floor with lift, power backup and covered parking.",
              owner_id=owners[1]["id"], assigned_agent=ag, assigned_manager=pm, branch_id="br-erode", service_type="management", mgmt_fee_pct=8),
        _prop("SE-P-0003", "DTCP Approved Residential Plot", "land", "sale", "Perundurai", "Vijayamangalam", "638056",
              1450000, "total", ["/images/land.jpg"], plot_area=1800, amenities=["DTCP approved", "Corner plot"],
              description_public="Sample listing: 1,800 sq.ft corner residential plot in an approved layout with tar road access.",
              owner_id=owners[0]["id"], assigned_agent=ag, branch_id="br-perundurai"),
        _prop("SE-P-0004", "Industrial Shed near SIPCOT", "factory_shed", "lease", "Perundurai", "SIPCOT", "638052",
              180000, "per_month", ["/images/shed.jpg", "/images/warehouse.jpg"], built_area=12000, plot_area=20000,
              power_supply="150 HP sanctioned (as provided by owner)", loading_access="40 ft container access",
              parking="Truck parking for 4 vehicles", amenities=["3-phase power", "Container access"], featured=True,
              description_public="Sample listing: 12,000 sq.ft pre-engineered shed with crane-ready columns near the SIPCOT industrial estate.",
              owner_id=owners[3]["id"], assigned_agent=ag, branch_id="br-perundurai"),
        _prop("SE-P-0005", "Warehouse with Loading Dock", "warehouse", "lease", "Erode", "Chithode", "638102", 95000,
              "per_month", ["/images/warehouse.jpg"], built_area=8000, loading_access="2 loading docks",
              description_public="Sample listing: 8,000 sq.ft warehouse with two loading docks on the Erode–Bhavani road.",
              owner_id=owners[3]["id"], assigned_agent=ag, branch_id="br-erode"),
        _prop("SE-P-0006", "Ground-floor Showroom", "shop", "rent", "Erode", "Brough Road", "638001", 65000, "per_month",
              ["/images/commercial.jpg"], built_area=1600, amenities=["Main road frontage", "Glass facade"],
              description_public="Sample listing: 1,600 sq.ft ground-floor showroom with main-road frontage.",
              owner_id=owners[1]["id"], assigned_agent=ag, branch_id="br-erode"),
        _prop("SE-P-0007", "Serviced Guest House – 2 Bedrooms", "residential", "short_stay", "Erode", "Thindal", "638009",
              3200, "per_night", ["/images/contemporary.jpg", "/images/interior.jpg"], bedrooms=2, bathrooms=2,
              max_guests=5, nightly_rate=3200, mgmt_fee_pct=20, furnishing="furnished", service_type="short_stay",
              amenities=["Wi-Fi", "AC", "Kitchen"], checkin_instructions="RESTRICTED: Key box code shared on check-in day.",
              description_public="Sample listing: fully furnished short-stay home for families and business travellers.",
              owner_id=owners[2]["id"], assigned_manager=pm, branch_id="br-erode"),
        _prop("SE-P-0008", "4 BHK Premium House", "residential", "sale", "Erode", "Nasiyanur", "638107", 12500000,
              "total", ["/images/house.jpg", "/images/estate.jpg"], bedrooms=4, bathrooms=4, built_area=3200,
              plot_area=3600, furnishing="unfurnished", amenities=["Solar", "Garden", "Car parking"],
              description_public="Sample listing: spacious 4 BHK house on a 3,600 sq.ft plot with solar water heating.",
              owner_id=owners[2]["id"], assigned_agent=ag, branch_id="br-erode"),
        _prop("SE-P-0009", "Agricultural Land – 2.5 Acres", "agricultural", "sale", "Perundurai", "Kanjikoil", "638116",
              4500000, "total", ["/images/land2.jpg"], plot_area=2.5, area_unit="acres",
              description_public="Sample listing: 2.5 acres with borewell and road access.", owner_id=owners[0]["id"],
              branch_id="br-perundurai", status="verification_pending", verification={"status": "pending"},
              authorization={}, publication_history=[], published_at=None),
    ]
    for i, p in enumerate(props):
        if p["status"] == "published":
            p["listing_id"] = await next_code("listing", "SEL-", 5)
        await db.properties.insert_one(dict(p))
    await db.counters.update_one({"_id": "property"}, {"$set": {"seq": len(props)}}, upsert=True)
    t = today_ist()
    start = (t.replace(day=1) - timedelta(days=60)).replace(day=1)
    lease = {"id": new_id(), "code": await next_code("lease", "SE-LS-"), "property_id": props[1]["id"],
             "property_title": props[1]["title"], "property_code": props[1]["code"], "owner_id": owners[1]["id"],
             "tenant_name": "Sample Tenant", "tenant_phone": "+919000000050", "tenant_kind": "individual",
             "lease_type": "residential", "start_date": start.isoformat(),
             "end_date": (start + timedelta(days=330)).isoformat(), "rent": 16000, "due_day": 5, "deposit": 50000,
             "escalation_pct": 5, "escalation_every_months": 12, "mgmt_fee_pct": 8, "manager_id": pm,
             "status": "active", "deposit_held": 0.0, "handovers": [], "issues": [], "created_at": now_iso(),
             "schedule": build_schedule(start.isoformat(), (start + timedelta(days=330)).isoformat(), 16000, 5, 5, 12)}
    await db.leases.insert_one(dict(lease))
    await db.properties.update_one({"id": props[1]["id"]}, {"$set": {"occupancy": "occupied"}})
    leads = [("Sample Buyer Ravi", "+919000000101", "website", "new", "buy"),
             ("Sample Tenant Priya", "+919000000102", "whatsapp", "contacted", "rent"),
             ("Sample Textile Unit", "+919000000103", "broker", "qualified", "lease"),
             ("Sample Investor", "+919000000104", "referral", "site_visit", "buy")]
    for n, ph, src, st, it in leads:
        lid = new_id()
        await db.leads.insert_one({"id": lid, "code": await next_code("lead", "SE-LD-", 5), "name": n, "phone": ph,
                                   "source": src, "stage": st, "interest": it, "customer_type": "business" if "Unit" in n else "buyer",
                                   "assigned_to": ag if st != "new" else None, "branch_id": "br-erode",
                                   "next_follow_up": (t - timedelta(days=1)).isoformat() + "T10:00" if st == "contacted" else None,
                                   "consent": {"marketing": False}, "contacts": [], "deleted": False,
                                   "created_at": now_iso(), "updated_at": now_iso()})
        await db.lead_activities.insert_one({"id": new_id(), "lead_id": lid, "kind": "created", "notes": "Seeded sample lead",
                                             "user_name": "System", "created_at": now_iso()})
    await db.vendors.insert_one({"id": new_id(), "name": "Sample Plumbing Services", "phone": "+919000000201",
                                 "trade": "Plumbing", "created_at": now_iso()})
    await db.campaigns.insert_one({"id": new_id(), "name": "Sample Diwali Campaign", "code": "diwali", "channel": "social",
                                   "budget": 10000, "created_at": now_iso()})
    logger.info("Demo data seeded")


async def seed():
    await ensure_indexes()
    await seed_core()
    await seed_demo()
