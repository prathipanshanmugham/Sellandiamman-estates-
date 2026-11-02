# End-to-end API regression for Sellandiamman Estates (public site + ERP). Tests run in file order and share state.
import os
import random
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE_URL = (os.environ.get("TEST_BASE_URL") or os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
# Credentials come from the environment (same values as the backend .env); never hard-code real passwords here.
ADMIN = (os.environ.get("ADMIN_EMAIL", "admin@estates.test"), os.environ.get("ADMIN_PASSWORD", "Admin@Estates2026"))
DEMO_PW = os.environ.get("DEMO_PASSWORD", "Demo@12345")
S = {}  # shared state
_sessions = {}


PUB_H = {"X-Forwarded-For": f"10.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}"}


def phone():
    return "9" + "".join(random.choice("0123456789") for _ in range(9))


def login(email, pw=DEMO_PW):
    if email in _sessions:
        return _sessions[email]
    s = requests.Session()
    # NOTE: server trusts first X-Forwarded-For value for rate limits; unique value avoids the shared 20/5min login cap
    s.headers["X-Forwarded-For"] = f"10.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}"
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    _sessions[email] = s
    return s


def admin():
    return login(*ADMIN)


def demo(role):
    return login(f"{role}@demo.sellandiamman.test")


FORBIDDEN_PUBLIC = ("internal_address", "notes_internal", "owner_id", "survey_no", "checkin_instructions")


# ---------- Auth basics ----------
class TestAuth:
    def test_login_sets_httponly_cookie(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": "auditor@demo.sellandiamman.test", "password": DEMO_PW})
        assert r.status_code == 200
        sc = r.headers.get("set-cookie", "")
        assert "access_token=" in sc and "httponly" in sc.lower()
        if os.environ.get("COOKIE_SECURE", "true").lower() != "false":
            assert "secure" in sc.lower()
        me = s.get(f"{API}/auth/me")
        assert me.status_code == 200 and me.json()["role"] == "auditor"
        # logout revokes server side, even if token reused
        tok = s.cookies.get("access_token")
        assert s.post(f"{API}/auth/logout").status_code == 200
        assert requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"}).status_code == 401

    def test_anonymous_401_403_404(self):
        for p in ("documents", "leads", "properties"):
            assert requests.get(f"{API}/{p}").status_code == 401, p
        assert requests.get(f"{API}/files/garbage-token").status_code == 403
        assert requests.get(f"{API}/public/media/{uuid.uuid4()}").status_code == 404


# ---------- Public site ----------
class TestPublic:
    def test_public_listing_and_detail_no_private_fields(self):
        r = requests.get(f"{API}/public/properties")
        assert r.status_code == 200
        d = requests.get(f"{API}/public/properties/SEL-00001")
        assert d.status_code == 200, d.text
        body = d.json()
        txt = str(body)
        for k in FORBIDDEN_PUBLIC:
            assert k not in txt, f"leaks {k}"

    def test_enquiry_creates_lead_and_dedupes(self):
        p = phone()
        S["enq_phone"] = p
        bad = requests.post(headers=PUB_H, url=f"{API}/public/enquiry", json={"name": "TEST_Visitor", "phone": p, "consent": False,
                                                           "listing_id": "SEL-00001"})
        assert bad.status_code == 422
        r = requests.post(headers=PUB_H, url=f"{API}/public/enquiry", json={"name": "TEST_Visitor", "phone": p, "consent": True,
                                                         "listing_id": "SEL-00001", "message": "Interested"})
        assert r.status_code == 200, r.text
        ref = r.json()["reference"]
        assert ref.startswith("SE-LD-")
        r2 = requests.post(headers=PUB_H, url=f"{API}/public/enquiry", json={"name": "TEST_Visitor", "phone": p, "consent": True,
                                                          "listing_id": "SEL-00001"})
        assert r2.status_code == 200 and r2.json()["reference"] == ref
        leads = admin().get(f"{API}/leads").json()
        mine = [x for x in leads if x["phone"] == "+91" + p]
        assert len(mine) == 1 and mine[0]["source"] == "website"
        S["lead_id"] = mine[0]["id"]
        lead = admin().get(f"{API}/leads/{S['lead_id']}").json()
        assert any(a.get("kind") == "duplicate_enquiry" for a in lead.get("activities", [])), lead.keys()

    def test_owner_submission(self):
        files = [("photos", ("a.png", b"\x89PNG\r\n\x1a\n" + b"0" * 50, "image/png"))]
        data = {"name": "TEST_Owner", "phone": phone(), "city": "Erode", "locality": "TEST_Locality",
                "category": "residential", "transaction": "sale", "price": "2500000", "declaration": "true",
                "address": "TEST secret address 12"}
        r = requests.post(headers=PUB_H, url=f"{API}/public/owner-submission", data=data, files=files)
        assert r.status_code == 200, r.text
        code = r.json()["reference"]
        props = admin().get(f"{API}/properties").json()
        p = next(x for x in props if x["code"] == code)
        assert p["status"] == "verification_pending"
        S["sub_pid"] = p["id"]
        pub = requests.get(f"{API}/public/properties", params={"q": "TEST_Locality"}).json()
        assert "TEST_Locality" not in str(pub)


# ---------- CRM ----------
class TestCRM:
    def test_assign_and_agent_scope(self):
        a = admin()
        agent = demo("sales.agent")
        agent_id = agent.get(f"{API}/auth/me").json()["id"]
        S["agent_id"] = agent_id
        r = a.patch(f"{API}/leads/{S['lead_id']}", json={"assigned_to": agent_id})
        assert r.status_code == 200
        leads = agent.get(f"{API}/leads").json()
        assert leads and all(x.get("assigned_to") == agent_id for x in leads)
        assert any(x["id"] == S["lead_id"] for x in leads)
        other = next((x for x in a.get(f"{API}/leads").json() if x.get("assigned_to") != agent_id), None)
        if other:
            assert agent.get(f"{API}/leads/{other['id']}").status_code == 404

    def test_agent_call_visit_stage(self):
        agent = demo("sales.agent")
        lid = S["lead_id"]
        before = agent.get(f"{API}/leads/{lid}").json()["stage"]
        r = agent.post(f"{API}/leads/{lid}/activities", json={"kind": "call", "notes": "TEST call"})
        assert r.status_code == 200
        if before == "new":
            assert agent.get(f"{API}/leads/{lid}").json()["stage"] == "contacted"
        pid = agent.get(f"{API}/leads/{lid}").json().get("property_id") or S["sub_pid"]
        when = (date.today() + timedelta(days=2)).isoformat() + "T10:00"
        v = agent.post(f"{API}/leads/{lid}/site-visits", json={"property_id": pid, "scheduled_at": when})
        assert v.status_code == 200, v.text
        u = agent.patch(f"{API}/leads/{lid}", json={"stage": "qualified"})
        assert u.status_code == 200, u.text
        assert agent.get(f"{API}/leads/{lid}").json()["stage"] == "qualified"


# ---------- Property workflow ----------
class TestPropertyWorkflow:
    def test_publish_before_verify_fails_then_verify_publish(self):
        a = admin()
        pid = S["sub_pid"]
        r = a.post(f"{API}/properties/{pid}/transition", json={"to": "published"})
        assert r.status_code == 422
        exp = (date.today() + timedelta(days=180)).isoformat()
        v = a.post(f"{API}/properties/{pid}/verify", json={"ownership_verified": True, "authorization_signed": True,
                                                           "marketing_authorized": True, "authorization_expiry": exp})
        assert v.status_code == 200 and v.json()["verification_result"] == "verified"
        assert a.patch(f"{API}/properties/{pid}", json={"title": "TEST_ Owner house",
                                                         "description_public": "TEST public desc"}).status_code == 200
        assert a.post(f"{API}/properties/{pid}/transition", json={"to": "ready_to_market"}).status_code == 200
        p = a.post(f"{API}/properties/{pid}/transition", json={"to": "published"})
        assert p.status_code == 200, p.text
        lid = p.json()["listing_id"]
        assert lid.startswith("SEL-")
        pub = requests.get(f"{API}/public/properties/{lid}")
        assert pub.status_code == 200
        assert "TEST secret address" not in pub.text


# ---------- Deals / commission / invoices / payments ----------
class TestDeals:
    def test_convert_offer_commission_close_invoice(self):
        a = admin()
        d = a.post(f"{API}/leads/{S['lead_id']}/convert", json={"property_id": S["sub_pid"], "deal_type": "sale"})
        assert d.status_code == 200, d.text
        did = d.json()["id"]
        S["deal_id"] = did
        o = a.post(f"{API}/deals/{did}/offers", json={"amount": 2400000, "party": "TEST_Buyer"})
        assert o.status_code == 200
        assert a.patch(f"{API}/deals/{did}/offers/{o.json()['id']}", json={"status": "accepted"}).status_code == 200
        prev = a.post(f"{API}/deals/commission-preview", json={"base_value": 2400000, "rule": {"type": "percent", "value": 2},
                                                               "splits": [{"party": "TEST_CoBroker", "kind": "co_broker", "percent": 25}]})
        assert prev.status_code == 200, prev.text
        pv = prev.json()
        assert pv["gross"] == 48000 and pv["company_net"] == 36000, pv
        # unsigned agreement -> close 422
        c = a.post(f"{API}/deals/{did}/commission", json={"type": "percent", "value": 2, "payer": "TEST_Buyer",
                                                           "agreement_signed": False,
                                                           "splits": [{"party": "TEST_CoBroker", "kind": "co_broker", "percent": 25}]})
        assert c.status_code == 200, c.text
        assert a.post(f"{API}/deals/{did}/close").status_code == 422
        c = a.post(f"{API}/deals/{did}/commission", json={"type": "percent", "value": 2, "payer": "TEST_Buyer",
                                                           "agreement_signed": True,
                                                           "splits": [{"party": "TEST_CoBroker", "kind": "co_broker", "percent": 25}]})
        assert c.status_code == 200 and c.json()["approval_required"] is False
        cl = a.post(f"{API}/deals/{did}/close")
        assert cl.status_code == 200 and cl.json()["final_commission"] == 48000
        assert a.post(f"{API}/deals/{did}/close").status_code == 409
        inv = a.post(f"{API}/deals/{did}/invoice")
        assert inv.status_code == 200, inv.text
        S["inv"] = inv.json()
        assert inv.json()["subtotal"] == 48000
        assert a.post(f"{API}/deals/{did}/invoice").status_code == 409

    def test_payment_idempotency_and_overpay(self):
        acc = demo("accountant")
        inv = S["inv"]
        bal0 = acc.get(f"{API}/ledger/balances").json()
        key = "TEST_" + uuid.uuid4().hex[:12]
        body = {"amount": 10000, "method": "upi", "date": date.today().isoformat(), "idempotency_key": key}
        r = acc.post(f"{API}/invoices/{inv['id']}/payments", json=body)
        assert r.status_code == 200, r.text
        assert acc.post(f"{API}/invoices/{inv['id']}/payments", json=body).status_code == 409
        full = acc.get(f"{API}/invoices/{inv['id']}").json()
        assert len(full["payments"]) == 1 and full["paid"] == 10000
        over = acc.post(f"{API}/invoices/{inv['id']}/payments",
                        json={**body, "amount": inv["total"] * 2, "idempotency_key": "TEST_" + uuid.uuid4().hex[:12]})
        assert over.status_code == 422
        bal1 = acc.get(f"{API}/ledger/balances").json()
        S["bal_print"] = (bal0, bal1)
        print("BALANCES", bal0, bal1)


# ---------- Leases / owner statements ----------
class TestLeases:
    def test_lease_rent_statement_settle(self):
        a = admin()
        ow = a.post(f"{API}/owners", json={"name": "TEST_Landlord", "phone": phone()})
        assert ow.status_code == 200, ow.text
        oid = ow.json()["id"]
        pr = a.post(f"{API}/properties", json={"title": "TEST_ Rent flat", "category": "apartment", "transaction": "rent",
                                                "owner_id": oid, "city": "Erode", "locality": "TEST_Loc", "price": 15000,
                                                "price_unit": "per_month"})
        assert pr.status_code == 200, pr.text
        today = date.today()
        start = today.replace(day=1).isoformat()
        end = (today.replace(day=1) + timedelta(days=365)).isoformat()
        ls = a.post(f"{API}/leases", json={"property_id": pr.json()["id"], "tenant_name": "TEST_Tenant",
                                           "tenant_phone": phone(), "start_date": start, "end_date": end,
                                           "rent": 15000, "deposit": 30000, "mgmt_fee_pct": 8})
        assert ls.status_code == 200, ls.text
        lid = ls.json()["id"]
        month = today.strftime("%Y-%m")
        led0 = a.get(f"{API}/ledger/balances").json()
        rk = "TEST_" + uuid.uuid4().hex[:12]
        rr = a.post(f"{API}/leases/{lid}/rent", json={"period": month, "amount": 15000, "method": "upi",
                                                      "date": today.isoformat(), "idempotency_key": rk})
        assert rr.status_code == 200, rr.text
        assert a.post(f"{API}/leases/{lid}/rent", json={"period": month, "amount": 15000, "method": "upi",
                                                        "date": today.isoformat(), "idempotency_key": rk}).status_code == 409
        led1 = a.get(f"{API}/ledger/balances").json()
        print("LEASE BAL", led0, led1)
        st = a.get(f"{API}/owners/{oid}/statement", params={"month": month}).json()
        assert st["rent_collected"] == 15000 and st["management_fee"] == 1200 and st["net_payable"] == 13800, st
        s1 = a.post(f"{API}/owners/{oid}/statement/settle", json={"month": month})
        assert s1.status_code == 200, s1.text
        assert a.post(f"{API}/owners/{oid}/statement/settle", json={"month": month}).status_code == 409
        S["owner_id"] = oid
        S["prop_rent"] = pr.json()["id"]


# ---------- Maintenance ----------
class TestMaintenance:
    def test_work_order_flow(self):
        pm = demo("property.manager")
        a = admin()
        v = a.post(f"{API}/vendors", json={"name": "TEST_Plumber", "phone": phone(), "trade": "plumbing"})
        assert v.status_code == 200
        wo = a.post(f"{API}/work-orders", json={"property_id": S["prop_rent"], "title": "TEST_ Leak fix"})
        assert wo.status_code == 200 and wo.json()["status"] == "open"
        wid = wo.json()["id"]
        assert pm.patch(f"{API}/work-orders/{wid}", json={"vendor_id": v.json()["id"], "status": "assigned"}).status_code == 200
        assert pm.patch(f"{API}/work-orders/{wid}", json={"status": "completed"}).status_code == 422
        assert pm.patch(f"{API}/work-orders/{wid}", json={"status": "in_progress"}).status_code == 200
        assert pm.patch(f"{API}/work-orders/{wid}", json={"status": "completed"}).status_code == 422
        assert pm.patch(f"{API}/work-orders/{wid}", json={"status": "completed", "actual_cost": 1500}).status_code == 200
        c = pm.patch(f"{API}/work-orders/{wid}", json={"status": "closed"})
        assert c.status_code == 200 and c.json()["status"] == "closed"


# ---------- Short stay ----------
class TestShortStay:
    def test_booking_overlap_checkin_settle(self):
        ops = demo("shortstay.ops")
        a = admin()
        prop = next(p for p in a.get(f"{API}/properties").json() if p["code"] == "SE-P-0007")
        assert prop["transaction"] == "short_stay"
        ci = date.today() + timedelta(days=random.randint(400, 3000))
        co = ci + timedelta(days=2)
        body = {"property_id": prop["id"], "guest_name": "TEST_Guest", "guest_phone": phone(), "guests": 1,
                "check_in": ci.isoformat(), "check_out": co.isoformat(), "nightly_rate": 3000, "cleaning_fee": 500,
                "platform": "airbnb", "platform_fee": 600, "operating_costs": 400, "mgmt_fee_pct": 20}
        b = ops.post(f"{API}/bookings", json=body)
        assert b.status_code == 200, b.text
        bk = b.json()
        print("BOOKING CALC", {k: bk.get(k) for k in ("gross", "net_after_platform", "management_fee", "owner_payout")})
        assert bk["gross"] == 6500
        ov = ops.post(f"{API}/bookings", json={**body, "check_in": (ci + timedelta(days=1)).isoformat(),
                                               "check_out": (co + timedelta(days=1)).isoformat()})
        assert ov.status_code == 409
        assert ops.post(f"{API}/bookings/{bk['id']}/settle").status_code == 422
        assert ops.patch(f"{API}/bookings/{bk['id']}/status", json={"status": "checked_in"}).status_code == 200
        assert ops.patch(f"{API}/bookings/{bk['id']}/status", json={"status": "completed"}).status_code == 200
        st = ops.post(f"{API}/bookings/{bk['id']}/settle")
        assert st.status_code == 200, st.text
        assert ops.post(f"{API}/bookings/{bk['id']}/settle").status_code == 409


# ---------- Dashboard / permissions ----------
class TestPermissions:
    def test_director_dashboard(self):
        d = demo("director").get(f"{API}/dashboard")
        assert d.status_code == 200
        print("DIRECTOR DASH KEYS", list(d.json().keys()))
        assert "finance" in d.json() or "revenue" in str(d.json())

    def test_agent_denials(self):
        ag = demo("sales.agent")
        for p in ("invoices", "ledger", "users"):
            assert ag.get(f"{API}/{p}").status_code == 403, p
        dash = ag.get(f"{API}/dashboard").json()
        assert "finance" not in dash

    def test_auditor_and_marketing(self):
        au = demo("auditor")
        assert au.post(f"{API}/leads", json={"name": "TEST_x", "phone": phone()}).status_code == 403
        mk = demo("marketing")
        props = mk.get(f"{API}/properties").json()
        assert props
        one = mk.get(f"{API}/properties/{props[0]['id']}").json()
        assert "internal_address" not in one and "internal_address" not in props[0]


# ---------- Approvals ----------
class TestApprovals:
    def test_commission_change_approval(self):
        a = admin()
        bm = demo("branch.manager")
        di = demo("director")
        # create open deal with commission
        bm_props = bm.get(f"{API}/properties").json()
        pid = next(p["id"] for p in bm_props if p.get("branch_id") and p["transaction"] == "rent")
        d = a.post(f"{API}/deals", json={"title": "TEST_ Approval deal", "deal_type": "rent", "property_id": pid,
                                         "buyer_name": "TEST_Renter"}).json()
        did = d["id"]
        o = a.post(f"{API}/deals/{did}/offers", json={"amount": 15000, "party": "TEST_Renter"}).json()
        a.patch(f"{API}/deals/{did}/offers/{o['id']}", json={"status": "accepted"})
        assert a.post(f"{API}/deals/{did}/commission", json={"type": "months_rent", "value": 1, "payer": "TEST_Renter"}).status_code == 200
        # branch manager may be branch scoped; ensure visible
        r = bm.post(f"{API}/deals/{did}/commission", json={"type": "months_rent", "value": 2, "payer": "TEST_Renter",
                                                            "reason": "TEST change"})
        if r.status_code == 404:
            pytest.skip("Deal not in branch manager's branch")
        assert r.status_code == 200 and r.json()["approval_required"] is True, r.text
        aid = r.json()["approval"]["id"]
        assert bm.post(f"{API}/approvals/{aid}/decide", json={"approve": True}).status_code == 403
        assert di.post(f"{API}/approvals/{aid}/decide", json={"approve": True}).status_code == 200
        deal = a.get(f"{API}/deals/{did}").json()
        assert deal["commission"]["gross"] == 30000, deal["commission"]
        assert di.post(f"{API}/approvals/{aid}/decide", json={"approve": True}).status_code == 409
