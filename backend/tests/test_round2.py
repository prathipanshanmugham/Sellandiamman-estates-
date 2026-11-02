# Round 2 features: 2-step sign-in, owner portal, insights, visit requests, lead matching, calendar, brochures,
# rent receipts, anonymising, document sharing, booking-night guard and the go-live status endpoint.
import os
import random
import uuid
from datetime import date, timedelta

import pyotp
import pytest
import requests

BASE_URL = (os.environ.get("TEST_BASE_URL") or os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN = (os.environ.get("ADMIN_EMAIL", "admin@estates.test"), os.environ.get("ADMIN_PASSWORD", "Admin@Estates2026"))
DEMO_PW = os.environ.get("DEMO_PASSWORD", "Demo@12345")
DOMAIN = "demo.sellandiamman.test"
S = {}
_sess = {}


def ip():
    return f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"


def phone():
    return "9" + "".join(random.choice("0123456789") for _ in range(9))


def login(email, pw=DEMO_PW):
    if email in _sess:
        return _sess[email]
    s = requests.Session()
    s.headers["X-Forwarded-For"] = ip()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    _sess[email] = s
    return s


def admin():
    return login(*ADMIN)


def demo(role):
    return login(f"{role}@{DOMAIN}")


class TestMfa:
    def test_enable_login_recovery_disable(self):
        a = admin()
        email = f"test_mfa_{uuid.uuid4().hex[:6]}@example.com"
        u = a.post(f"{API}/users", json={"email": email, "name": "TEST MFA", "role": "auditor", "password": "Passw0rd!x"})
        assert u.status_code == 200, u.text
        s = requests.Session()
        s.headers["X-Forwarded-For"] = ip()
        assert s.post(f"{API}/auth/login", json={"email": email, "password": "Passw0rd!x"}).status_code == 200
        setup = s.post(f"{API}/auth/mfa/setup")
        assert setup.status_code == 200 and "<svg" in setup.json()["qr_svg"]
        secret = setup.json()["secret"]
        assert s.post(f"{API}/auth/mfa/enable", json={"code": "000000"}).status_code == 422
        en = s.post(f"{API}/auth/mfa/enable", json={"code": pyotp.TOTP(secret).now()})
        assert en.status_code == 200, en.text
        codes = en.json()["recovery_codes"]
        assert len(codes) == 8
        assert s.get(f"{API}/auth/me").json()["mfa_enabled"] is True
        # password alone no longer signs in
        s2 = requests.Session()
        s2.headers["X-Forwarded-For"] = ip()
        r = s2.post(f"{API}/auth/login", json={"email": email, "password": "Passw0rd!x"})
        assert r.status_code == 200 and r.json()["mfa_required"] is True and "access_token" not in s2.cookies
        assert s2.get(f"{API}/auth/me").status_code == 401
        bad = s2.post(f"{API}/auth/mfa/login", json={"mfa_token": r.json()["mfa_token"], "code": "123456"})
        assert bad.status_code == 401
        ok = s2.post(f"{API}/auth/mfa/login", json={"mfa_token": r.json()["mfa_token"], "code": codes[0]})
        assert ok.status_code == 200, ok.text
        assert s2.get(f"{API}/auth/me").status_code == 200
        # a recovery code works once only
        s3 = requests.Session()
        s3.headers["X-Forwarded-For"] = ip()
        r3 = s3.post(f"{API}/auth/login", json={"email": email, "password": "Passw0rd!x"})
        assert s3.post(f"{API}/auth/mfa/login", json={"mfa_token": r3.json()["mfa_token"], "code": codes[0]}).status_code == 401
        assert s3.post(f"{API}/auth/mfa/login", json={"mfa_token": r3.json()["mfa_token"],
                                                      "code": pyotp.TOTP(secret).now()}).status_code == 200
        # admin can reset a lost phone
        uid = u.json()["id"]
        assert a.post(f"{API}/users/{uid}/mfa-reset").status_code == 200
        assert s3.get(f"{API}/auth/me").status_code == 401  # sessions revoked
        users = a.get(f"{API}/users").json()
        row = next(x for x in users if x["id"] == uid)
        assert not row.get("mfa_enabled") and "mfa_secret" not in row

    def test_required_role_blocks_until_setup(self):
        a = admin()
        email = f"test_req_{uuid.uuid4().hex[:6]}@example.com"
        a.post(f"{API}/users", json={"email": email, "name": "TEST Req", "role": "marketing", "password": "Passw0rd!x"})
        assert a.put(f"{API}/settings", json={"mfa_required_roles": ["marketing"]}).status_code == 200
        try:
            s = requests.Session()
            s.headers["X-Forwarded-For"] = ip()
            me = s.post(f"{API}/auth/login", json={"email": email, "password": "Passw0rd!x"}).json()
            assert me["mfa_setup_required"] is True
            blocked = s.get(f"{API}/properties")
            assert blocked.status_code == 403 and blocked.json()["detail"] == "mfa_setup_required"
            assert s.post(f"{API}/auth/mfa/setup").status_code == 200
        finally:
            assert a.put(f"{API}/settings", json={"mfa_required_roles": []}).status_code == 200


class TestOwnerPortal:
    def test_portal_scope_and_staff_denial(self):
        o = login(f"owner@{DOMAIN}")
        me = o.get(f"{API}/auth/me").json()
        assert me["role"] == "owner" and me["owner_id"]
        ov = o.get(f"{API}/portal/overview")
        assert ov.status_code == 200, ov.text
        body = ov.json()
        assert body["properties"] and all("internal_address" not in p for p in body["properties"])
        leases = o.get(f"{API}/portal/leases").json()
        assert leases and all("tenant_phone" not in x for x in leases)
        # staff areas are closed to owners
        for p in ("leads", "properties", "invoices", "users/lite", "dashboard", "settings", "calendar?frm=2026-01-01&to=2026-01-31"):
            assert o.get(f"{API}/{p}").status_code == 403, p
        # statement PDF and rent receipt
        st = o.get(f"{API}/portal/statements").json()
        if st["months_with_rent"]:
            pdf = o.get(f"{API}/portal/statements/{st['months_with_rent'][0]}/pdf")
            assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
        pay = next((p for ls in leases for p in ls["payments"]), None)
        if pay:
            r = o.get(f"{API}/portal/rent-receipts/{pay['id']}/pdf")
            assert r.status_code == 200 and r.content[:4] == b"%PDF"
        # another owner's receipt is not visible
        other = admin().get(f"{API}/owners").json()
        assert other
        S["owner_portal"] = o

    def test_raise_request_and_documents(self):
        o = S.get("owner_portal") or login(f"owner@{DOMAIN}")
        props = o.get(f"{API}/portal/overview").json()["properties"]
        r = o.post(f"{API}/portal/requests", json={"property_id": props[0]["id"], "title": "TEST_ Tap leaking"})
        assert r.status_code == 200 and r.json()["status"] == "open"
        bad = o.post(f"{API}/portal/requests", json={"property_id": str(uuid.uuid4()), "title": "TEST_ nope"})
        assert bad.status_code == 404
        assert any(w["title"] == "TEST_ Tap leaking" for w in o.get(f"{API}/portal/work-orders").json())
        # staff shares a document; owner can see and open it
        a = admin()
        files = {"file": ("auth.pdf", b"%PDF-1.4 test", "application/pdf")}
        up = a.post(f"{API}/documents", data={"entity_type": "property", "entity_id": props[0]["id"],
                                              "doc_type": "management_agreement"}, files=files)
        assert up.status_code == 200, up.text
        did = up.json()["id"]
        assert did not in [d["id"] for d in o.get(f"{API}/portal/documents").json()]
        assert a.patch(f"{API}/documents/{did}/share", json={"share": True}).status_code == 200
        assert did in [d["id"] for d in o.get(f"{API}/portal/documents").json()]
        link = o.post(f"{API}/portal/documents/{did}/link")
        assert link.status_code == 200
        f = requests.get(f"{BASE_URL}{link.json()['url']}")
        assert f.status_code == 200 and f.content.startswith(b"%PDF")

    def test_invite_owner(self):
        a = admin()
        ow = a.post(f"{API}/owners", json={"name": "TEST_Portal Owner", "phone": phone()}).json()
        r = a.post(f"{API}/owners/{ow['id']}/portal-invite", json={"email": f"owner_{uuid.uuid4().hex[:6]}@example.com"})
        assert r.status_code == 200, r.text
        assert r.json()["role"] == "owner" and r.json()["activation_link"]
        assert a.get(f"{API}/owners/{ow['id']}").json()["portal_users"]
        # staff role cannot be turned into an owner account
        assert a.patch(f"{API}/users/{r.json()['id']}", json={"role": "auditor"}).status_code == 422


class TestInsights:
    def test_draft_publish_public(self):
        mk = demo("marketing")
        p = mk.post(f"{API}/posts", json={"title": "TEST_ Plot prices in Ingur", "body": "Some words about plots " * 5,
                                          "category": "area_guide"})
        assert p.status_code == 200, p.text
        pid, slug = p.json()["id"], p.json()["slug"]
        assert requests.get(f"{API}/public/posts/{slug}").status_code == 404
        assert mk.patch(f"{API}/posts/{pid}", json={"status": "published"}).status_code == 200
        pub = requests.get(f"{API}/public/posts/{slug}")
        assert pub.status_code == 200 and pub.json()["post"]["title"].startswith("TEST_")
        assert slug in [x["slug"] for x in requests.get(f"{API}/public/posts", params={"limit": 30}).json()["items"]]
        assert f"/insights/{slug}" in requests.get(f"{API}/sitemap.xml").text
        assert demo("sales.agent").post(f"{API}/posts", json={"title": "TEST_ x", "body": "y" * 30}).status_code == 403
        assert mk.delete(f"{API}/posts/{pid}").status_code == 200
        assert requests.get(f"{API}/public/posts/{slug}").status_code == 404


class TestVisitsAndMatches:
    def test_visit_request_flow(self):
        p = phone()
        r = requests.post(f"{API}/public/enquiry", headers={"X-Forwarded-For": ip()},
                          json={"name": "TEST_Visitor2", "phone": p, "consent": True, "listing_id": "SEL-00001",
                                "kind": "visit", "preferred_date": (date.today() + timedelta(days=3)).isoformat(),
                                "preferred_slot": "evening"})
        assert r.status_code == 200, r.text
        past = requests.post(f"{API}/public/enquiry", headers={"X-Forwarded-For": ip()},
                             json={"name": "TEST_Visitor2", "phone": phone(), "consent": True, "listing_id": "SEL-00001",
                                   "kind": "visit", "preferred_date": "2020-01-01"})
        assert past.status_code == 422
        a = admin()
        lead = next(x for x in a.get(f"{API}/leads", params={"q": p}).json())
        full = a.get(f"{API}/leads/{lead['id']}").json()
        v = next(x for x in full["site_visits"] if x["status"] == "requested")
        assert v["scheduled_at"].endswith("T17:00")
        ok = a.patch(f"{API}/site-visits/{v['id']}", json={"status": "scheduled",
                                                            "scheduled_at": (date.today() + timedelta(days=3)).isoformat() + "T18:30"})
        assert ok.status_code == 200 and ok.json()["scheduled_at"].endswith("18:30")
        S["visit_lead"] = lead["id"]

    def test_requirement_and_matches(self):
        p = phone()
        r = requests.post(f"{API}/public/enquiry", headers={"X-Forwarded-For": ip()},
                          json={"name": "TEST_Req", "phone": p, "consent": True, "kind": "requirement", "interest": "buy",
                                "budget_max": 9000000, "preferred_locations": "Thindal", "category": "Villa"})
        assert r.status_code == 200, r.text
        a = admin()
        lead = a.get(f"{API}/leads", params={"q": p}).json()[0]
        assert lead["budget_max"] == 9000000 and lead["preferred_locations"] == "Thindal"
        m = a.get(f"{API}/leads/{lead['id']}/matches")
        assert m.status_code == 200 and m.json(), m.text
        top = m.json()[0]
        assert "Thindal" in top["locality"] and top["price"] <= 9900000
        sh = a.post(f"{API}/leads/{lead['id']}/share-listings", json={"property_ids": [top["id"]]})
        assert sh.status_code == 200 and sh.json()["shared"] == 1
        assert a.get(f"{API}/leads/{lead['id']}").json()["stage"] == "matched"
        S["anon_lead"] = lead["id"]

    def test_anonymise(self):
        a = admin()
        lid = S["anon_lead"]
        assert demo("sales.agent").post(f"{API}/leads/{lid}/anonymise", json={"confirm": True}).status_code in (403, 404)
        assert a.post(f"{API}/leads/{lid}/anonymise", json={}).status_code == 422
        assert a.post(f"{API}/leads/{lid}/anonymise", json={"confirm": True, "reason": "TEST request"}).status_code == 200
        lead = a.get(f"{API}/leads/{lid}").json()
        assert lead["name"] == "Anonymised contact" and lead["phone"] is None
        assert all(x["notes"] == "[removed on request]" for x in lead["activities"])


class TestDocsAndCalendar:
    def test_brochure_and_receipts(self):
        b = requests.get(f"{API}/public/properties/SEL-00001/brochure.pdf")
        assert b.status_code == 200 and b.content[:4] == b"%PDF"
        assert requests.get(f"{API}/public/properties/NOPE-1/brochure.pdf").status_code == 404
        pm = demo("property.manager")
        leases = pm.get(f"{API}/leases").json()
        lease = pm.get(f"{API}/leases/{leases[0]['id']}").json()
        if lease["payments"]:
            r = pm.get(f"{API}/rent-payments/{lease['payments'][0]['id']}/receipt.pdf")
            assert r.status_code == 200 and r.content[:4] == b"%PDF"
        assert demo("marketing").get(f"{API}/rent-payments/{uuid.uuid4()}/receipt.pdf").status_code == 403

    def test_calendar(self):
        a = admin()
        frm = date.today().replace(day=1)
        to = frm + timedelta(days=40)
        r = a.get(f"{API}/calendar", params={"frm": frm.isoformat(), "to": to.isoformat()})
        assert r.status_code == 200, r.text
        kinds = {e["type"] for e in r.json()}
        assert {"rent", "visit"} <= kinds, kinds
        ag = demo("sales.agent").get(f"{API}/calendar", params={"frm": frm.isoformat(), "to": to.isoformat()}).json()
        assert all(e["type"] in ("visit", "task", "authorisation") for e in ag)
        assert a.get(f"{API}/calendar", params={"frm": "bad", "to": "x"}).status_code == 422

    def test_status_and_health(self):
        st = admin().get(f"{API}/system/status")
        assert st.status_code == 200 and "email" in st.json()
        assert demo("sales.agent").get(f"{API}/system/status").status_code == 403
        assert requests.get(f"{API}/health").json()["ok"] is True
        assert "Sitemap:" in requests.get(f"{API}/robots.txt").text


class TestBookingGuard:
    def test_nights_freed_on_cancel(self):
        ops = demo("shortstay.ops")
        di = demo("director")
        prop = next(p for p in admin().get(f"{API}/properties").json() if p["transaction"] == "short_stay")
        ci = date.today() + timedelta(days=random.randint(3100, 3900))
        body = {"property_id": prop["id"], "guest_name": "TEST_G", "guest_phone": phone(), "guests": 1,
                "check_in": ci.isoformat(), "check_out": (ci + timedelta(days=3)).isoformat(), "nightly_rate": 2000}
        b = ops.post(f"{API}/bookings", json=body)
        assert b.status_code == 200, b.text
        same_end = ops.post(f"{API}/bookings", json={**body, "check_in": (ci + timedelta(days=3)).isoformat(),
                                                     "check_out": (ci + timedelta(days=5)).isoformat()})
        assert same_end.status_code == 200  # check-out day is free for the next guest
        assert ops.post(f"{API}/bookings", json={**body, "check_in": (ci + timedelta(days=2)).isoformat()}).status_code == 409
        # cancel without refund frees the nights
        c = di.post(f"{API}/bookings/{b.json()['id']}/cancel", json={"reason": "TEST cancel", "refund_amount": 0})
        assert c.status_code == 200, c.text
        again = ops.post(f"{API}/bookings", json=body)
        assert again.status_code == 200, again.text
