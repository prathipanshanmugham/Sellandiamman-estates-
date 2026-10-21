# Round 4: branches and locations, customer records, short-stay channels (iCal), co-investors and their dashboard,
# agreement generator, website editor, CEO dashboard, search-engine pages and the team chart.
import os
import random
import re
import uuid

import pytest
import requests

BASE_URL = (os.environ.get("TEST_BASE_URL") or "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN = (os.environ.get("ADMIN_EMAIL", "admin@estates.test"), os.environ.get("ADMIN_PASSWORD", "Admin@Estates2026"))
DEMO_PW = os.environ.get("DEMO_PASSWORD", "Demo@12345")
D = "demo.sellandiamman.test"


def ip():
    return f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"


def login(email, pw=DEMO_PW):
    s = requests.Session()
    s.headers["X-Forwarded-For"] = ip()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return s


def admin():
    return login(*ADMIN)


def phone():
    return "+9198" + "".join(str(random.randint(0, 9)) for _ in range(8))


class TestBranches:
    def test_five_branches_with_perundurai_head_office(self):
        rows = admin().get(f"{API}/branches").json()
        names = {b["name"] for b in rows}
        assert {"Perundurai", "Erode", "Kadambur", "Sathyamangalam", "Namakkal"} <= names
        assert [b["name"] for b in rows if b.get("is_head_office")] == ["Perundurai"]
        pub = requests.get(f"{API}/public/branches").json()
        assert len(pub) >= 5 and "manager_id" not in pub[0]

    def test_branch_staff_see_only_their_branch(self):
        erode = login(f"branch.manager@{D}")
        props = erode.get(f"{API}/properties").json()
        props = props.get("items", props) if isinstance(props, dict) else props
        assert props and all(p["branch_id"] == "br-erode" for p in props)
        nmk = [p for p in (lambda r: r.get("items", r) if isinstance(r, dict) else r)(admin().get(f"{API}/properties").json())
               if p.get("branch_id") == "br-namakkal"]
        assert nmk
        assert erode.get(f"{API}/properties/{nmk[0]['id']}").status_code == 404

    def test_branch_picker_narrows_the_view(self):
        a = admin()
        a.headers["X-Branch"] = "br-namakkal"
        props = a.get(f"{API}/properties").json()
        props = props.get("items", props) if isinstance(props, dict) else props
        assert props and {p["branch_id"] for p in props} == {"br-namakkal"}

    def test_locations_can_be_added(self):
        name = f"Test Nagar {uuid.uuid4().hex[:5]}"
        agent = login(f"sales.agent@{D}")
        r = agent.post(f"{API}/locations", json={"kind": "locality", "name": name, "city": "Namakkal"})
        assert r.status_code == 200, r.text
        assert agent.post(f"{API}/locations", json={"kind": "city", "name": "Tiruppur"}).status_code == 403
        towns = requests.get(f"{API}/public/locations").json()
        nmk = next(t for t in towns if t["name"] == "Namakkal")
        assert any(x["name"] == name for x in nmk["localities"])


class TestCustomers:
    def test_list_create_duplicate_and_timeline(self):
        a = admin()
        res = a.get(f"{API}/customers").json()
        assert res["total"] > 10
        ph = phone()
        c = a.post(f"{API}/customers", json={"name": "Test Customer", "phone": ph, "types": ["buyer"], "city": "Erode"})
        assert c.status_code == 200, c.text
        assert a.post(f"{API}/customers", json={"name": "Someone Else", "phone": ph}).status_code == 409
        d = a.get(f"{API}/customers/{c.json()['id']}").json()
        assert d["name"] == "Test Customer" and "timeline" in d

    def test_auditor_reads_but_cannot_add(self):
        au = login(f"auditor@{D}")
        assert au.get(f"{API}/customers").status_code == 200
        assert au.post(f"{API}/customers", json={"name": "No Way", "phone": phone()}).status_code == 403

    def test_customers_are_internal(self):
        assert requests.get(f"{API}/customers").status_code == 401


class TestShortStayChannels:
    def _unit(self, a):
        units = a.get(f"{API}/short-stay/units").json()
        return next(u for u in units if "Farm Stay" in u["title"])

    def test_export_link_and_availability(self):
        a = login(f"shortstay.ops@{D}")
        u = self._unit(a)
        chans = a.get(f"{API}/short-stay/channels", params={"property_id": u["id"]}).json()
        air = next(c for c in chans if c["platform"] == "airbnb")
        cal = requests.get(f"{API}/public/ical/{air['export_token']}.ics")
        assert cal.status_code == 200 and "BEGIN:VCALENDAR" in cal.text
        # the Airbnb reservation imported from Airbnb is not sent back to Airbnb
        assert "Guest via Airbnb" not in cal.text
        assert requests.get(f"{API}/public/ical/not-a-real-token.ics").status_code == 404
        lid = u.get("listing_id")
        av = requests.get(f"{API}/public/properties/{lid}/availability").json()
        assert av["taken"] and av["base_rate"] > 0
        # guests' names never reach the website
        assert all(set(x) == {"start", "end"} for x in av["taken"])

    def test_import_then_cancel_on_platform(self):
        a = login(f"shortstay.ops@{D}")
        u = self._unit(a)
        chans = a.get(f"{API}/short-stay/channels", params={"property_id": u["id"]}).json()
        agoda = next(c for c in chans if c["platform"] == "agoda")
        uid = f"test-{uuid.uuid4().hex[:8]}@agoda.com"
        y, m = random.randint(2030, 2040), random.randint(1, 12)
        ics = ("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:%s\r\nDTSTART;VALUE=DATE:%d%02d02\r\nDTEND;VALUE=DATE:%d%02d04\r\n"
               "SUMMARY:Reserved\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n") % (uid, y, m, y, m)
        r = a.post(f"{API}/short-stay/channels/{agoda['id']}/import-text", json={"text": ics})
        assert r.status_code == 200 and r.json()["created"] == 1, r.text
        bks = a.get(f"{API}/bookings", params={"property_id": u["id"]}).json()
        bk = next(b for b in bks if b.get("channel_uid") == uid)
        assert bk["needs_details"] and bk["status"] == "confirmed"
        # the same dates cannot be sold again directly
        q = a.post(f"{API}/bookings", json={"property_id": u["id"], "guest_name": "Walk In", "guest_phone": phone(), "guests": 2, "check_in": f"{y}-{m:02d}-03",
                                            "check_out": f"{y}-{m:02d}-05", "nightly_rate": 5000})
        assert q.status_code == 409
        r = a.post(f"{API}/short-stay/channels/{agoda['id']}/import-text", json={"text": "BEGIN:VCALENDAR\r\nEND:VCALENDAR"})
        assert r.json()["cancelled"] == 1

    def test_quote_uses_pricing(self):
        a = login(f"shortstay.ops@{D}")
        u = self._unit(a)
        q = a.post(f"{API}/short-stay/quote", json={"property_id": u["id"], "check_in": "2029-05-01", "check_out": "2029-05-04",
                                                     "guests": 8, "platform": "airbnb"}).json()
        assert q["nights"] == 3 and q["total"] > 0 and q["platform_fee"] > 0

    def test_ical_urls_must_be_public_https(self):
        a = login(f"shortstay.ops@{D}")
        u = self._unit(a)
        chans = a.get(f"{API}/short-stay/channels", params={"property_id": u["id"]}).json()
        r = a.patch(f"{API}/short-stay/channels/{chans[0]['id']}", json={"ical_import_url": "http://127.0.0.1/x.ics"})
        assert r.status_code == 422


class TestInvestors:
    def test_investor_dashboard(self):
        inv = login(f"investor@{D}")
        o = inv.get(f"{API}/investor/overview").json()
        assert o["holdings"] and o["totals"]["invested"] > 0
        assert inv.get(f"{API}/investor/payouts").status_code == 200
        pdf = inv.get(f"{API}/investor/statement.pdf")
        assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
        docs = inv.get(f"{API}/investor/documents").json()
        assert docs
        assert inv.post(f"{API}/investor/documents/{docs[0]['id']}/link").status_code == 200

    def test_investor_cannot_use_staff_or_owner_areas(self):
        inv = login(f"investor@{D}")
        assert inv.get(f"{API}/leads").status_code in (401, 403)
        assert inv.get(f"{API}/investors").status_code in (401, 403)
        assert inv.get(f"{API}/portal/overview").status_code in (401, 403)

    def test_other_investors_holdings_are_hidden(self):
        a = admin()
        rows = a.get(f"{API}/investors").json()
        mine = next(i for i in rows if i["email"] == f"investor@{D}")
        other = next(i for i in rows if i["id"] != mine["id"])
        oi = a.get(f"{API}/investors/{other['id']}").json()
        inv = login(f"investor@{D}")
        assert inv.get(f"{API}/investor/holdings/{oi['holdings'][0]['id']}").status_code == 404

    def test_sales_agent_has_no_access(self):
        assert login(f"sales.agent@{D}").get(f"{API}/investors").status_code == 403


class TestAgreements:
    def test_templates_and_downloads(self):
        pm = login(f"property.manager@{D}")
        t = pm.get(f"{API}/agreements/templates").json()
        assert any(x["key"] == "rental_residential" for x in t)
        rows = pm.get(f"{API}/agreements").json()
        a = next(x for x in rows if x["template"] == "rental_residential")
        p = pm.get(f"{API}/agreements/{a['id']}/pdf")
        assert p.status_code == 200 and p.content[:4] == b"%PDF"
        w = pm.get(f"{API}/agreements/{a['id']}/docx")
        assert w.status_code == 200 and w.content[:2] == b"PK"

    def test_final_agreement_cannot_be_edited(self):
        pm = login(f"property.manager@{D}")
        a = next(x for x in pm.get(f"{API}/agreements").json() if x["status"] == "final")
        assert pm.patch(f"{API}/agreements/{a['id']}", json={"title": "Changed"}).status_code == 422

    def test_new_draft_from_lease(self):
        pm = login(f"property.manager@{D}")
        leases = pm.get(f"{API}/leases").json()
        ls = leases[0]
        pre = pm.get(f"{API}/agreements/prefill", params={"template": "rental_residential", "entity_type": "lease",
                                                          "entity_id": ls["id"]}).json()
        assert pre["data"]["rent"] == ls["rent"]
        r = pm.post(f"{API}/agreements", json={"template": "rental_residential", "entity_type": "lease", "entity_id": ls["id"],
                                               "data": pre["data"], "paper": "a4"})
        assert r.status_code == 200 and r.json()["status"] == "draft"


class TestWebsiteEditor:
    def test_draft_publish_restore(self):
        mk = login(f"marketing@{D}")
        cur = mk.get(f"{API}/cms/site").json()
        draft = cur["draft"]
        old = draft["hero"]["title"]
        draft["hero"]["title"] = "Test title " + uuid.uuid4().hex[:4]
        assert mk.put(f"{API}/cms/site/draft", json=draft).status_code == 200
        assert requests.get(f"{API}/public/site").json()["hero"]["title"] == old
        assert mk.post(f"{API}/cms/site/publish").status_code == 200
        assert requests.get(f"{API}/public/site").json()["hero"]["title"] == draft["hero"]["title"]
        draft["hero"]["title"] = old
        mk.put(f"{API}/cms/site/draft", json=draft)
        mk.post(f"{API}/cms/site/publish")

    def test_editor_cleans_input(self):
        mk = login(f"marketing@{D}")
        d = mk.get(f"{API}/cms/site").json()["draft"]
        d["hero"]["image"] = "javascript:alert(1)"
        d["sections"].append({"type": "evil", "title": "x"})
        out = mk.put(f"{API}/cms/site/draft", json=d).json()["draft"]
        assert out["hero"]["image"].startswith("/") and all(s["type"] != "evil" for s in out["sections"])
        mk.post(f"{API}/cms/site/discard")

    def test_sales_agent_cannot_edit(self):
        assert login(f"sales.agent@{D}").put(f"{API}/cms/site/draft", json={}).status_code == 403


class TestCeo:
    def test_dashboard_score_and_branch_league(self):
        d = login(f"director@{D}")
        r = d.get(f"{API}/ceo/dashboard", params={"frm": "2026-01-01", "to": "2026-12-31"}).json()
        assert 0 <= r["score"] <= 100 and len(r["pillars"]) == 6
        assert len(r["league"]) >= 5
        one = d.get(f"{API}/ceo/dashboard", params={"branch": "br-namakkal"}).json()
        assert one["filters"]["branch"] == "br-namakkal"
        town = d.get(f"{API}/ceo/dashboard", params={"city": "Erode"}).json()
        assert town["filters"]["city"] == "Erode"

    def test_reports(self):
        d = login(f"director@{D}")
        pdf = d.get(f"{API}/ceo/report.pdf", params={"frm": "2026-04-01", "to": "2026-09-30", "branch": "br-erode"})
        assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
        csv = d.get(f"{API}/ceo/report.csv")
        assert csv.status_code == 200 and "Health score" in csv.text

    def test_only_management_sees_it(self):
        assert login(f"sales.agent@{D}").get(f"{API}/ceo/dashboard").status_code == 403
        bm = login(f"branch.manager@{D}")
        assert bm.get(f"{API}/ceo/dashboard", params={"branch": "br-namakkal"}).status_code == 403
        assert bm.get(f"{API}/ceo/dashboard").status_code == 200

    def test_date_range_is_checked(self):
        d = login(f"director@{D}")
        assert d.get(f"{API}/ceo/dashboard", params={"frm": "2026-05-01", "to": "2026-01-01"}).status_code == 422


class TestSearchAndAi:
    def test_robots_welcomes_ai_crawlers(self):
        t = requests.get(f"{API}/robots.txt").text
        assert "GPTBot" in t and "ClaudeBot" in t and "PerplexityBot" in t and "Disallow: /investor" in t and "llms.txt" in t

    def test_llms_txt(self):
        t = requests.get(f"{API}/llms.txt").text
        assert t.startswith("# ") and "Branches" in t and "Namakkal" in t and "/properties/SEL-" in t
        full = requests.get(f"{API}/llms-full.txt").text
        assert len(full) > len(t) and "Frequently asked questions" in full

    def test_server_rendered_listing_page(self):
        lid = requests.get(f"{API}/public/properties").json()["items"][0]["listing_id"]
        r = requests.get(f"{API}/seo/page", headers={"X-Original-URI": f"/properties/{lid}"})
        if r.status_code == 503:
            pytest.skip("website not built (frontend/build/index.html)")
        assert r.status_code == 200
        assert '"RealEstateListing"' in r.text and 'rel="canonical"' in r.text and "<h1>" in r.text
        ld = re.search(r'<script type="application/ld\+json" id="ssr-jsonld">(.*?)</script>', r.text, re.S)
        import json
        json.loads(ld.group(1))

    def test_location_page_and_404(self):
        r = requests.get(f"{API}/seo/page", headers={"X-Original-URI": "/properties-in/namakkal"})
        if r.status_code == 503:
            pytest.skip("website not built")
        assert r.status_code == 200 and "Properties in Namakkal" in r.text and '"FAQPage"' in r.text
        assert requests.get(f"{API}/seo/page", headers={"X-Original-URI": "/properties-in/atlantis"}).status_code == 404
        priv = requests.get(f"{API}/seo/page", headers={"X-Original-URI": "/erp/leads"})
        assert "noindex" in priv.text


class TestTeam:
    def test_org_chart_and_pdf(self):
        a = login(f"sales.agent@{D}")
        org = a.get(f"{API}/team/org").json()
        people = org["people"]
        assert any(p["designation"] == "Managing Director" for p in people)
        assert all("password_hash" not in p for p in people)
        pdf = a.get(f"{API}/team/org.pdf")
        assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"

    def test_update_my_contact(self):
        a = login(f"marketing@{D}")
        r = a.patch(f"{API}/team/me", json={"whatsapp": "+919876543210"})
        assert r.status_code == 200
        assert a.patch(f"{API}/team/me", json={"role": "super_admin"}).status_code in (200, 422)
        me = a.get(f"{API}/auth/me").json()
        assert me.get("role", me.get("user", {}).get("role")) == "marketing"


class TestOwnerSubmissionLocation:
    def test_pin_is_kept_and_new_locality_waits_for_review(self):
        body = {"name": "Owner Test", "phone": phone(), "category": "residential", "transaction": "sale", "city": "Sathyamangalam",
                "locality": f"New Layout {uuid.uuid4().hex[:4]}", "price": "3000000", "declaration": "true", "lat": "11.501",
                "lng": "77.241", "accuracy_m": "12", "location_source": "gps"}
        r = requests.post(f"{API}/public/owner-submission", data=body, headers={"X-Forwarded-For": ip()})
        assert r.status_code == 200, r.text
        towns = requests.get(f"{API}/public/locations").json()
        sty = next(t for t in towns if t["name"] == "Sathyamangalam")
        assert all(x["name"] != body["locality"] for x in sty["localities"])
