# Round 3: saved-listing lookup, WhatsApp link previews, logo reset, robots/sitemap, and the public pages' data.
import os
import random

import requests

BASE_URL = (os.environ.get("TEST_BASE_URL") or "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN = (os.environ.get("ADMIN_EMAIL", "admin@estates.test"), os.environ.get("ADMIN_PASSWORD", "Admin@Estates2026"))
DEMO_PW = os.environ.get("DEMO_PASSWORD", "Demo@12345")


def ip():
    return f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"


def login(email, pw=DEMO_PW):
    s = requests.Session()
    s.headers["X-Forwarded-For"] = ip()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return s


class TestPublicExtras:
    def test_ids_filter_returns_only_those_listings(self):
        items = requests.get(f"{API}/public/properties", params={"limit": 4}).json()["items"]
        ids = [p["listing_id"] for p in items[:2]]
        r = requests.get(f"{API}/public/properties", params={"ids": ",".join(ids + ["SEL-99999"]), "limit": 50})
        assert r.status_code == 200
        got = sorted(p["listing_id"] for p in r.json()["items"])
        assert got == sorted(ids)

    def test_share_preview_has_open_graph_tags_and_redirect(self):
        p = requests.get(f"{API}/public/properties", params={"limit": 1}).json()["items"][0]
        r = requests.get(f"{API}/share/p/{p['listing_id']}")
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
        html = r.text
        assert 'property="og:title"' in html and 'property="og:image"' in html and p["title"].split(" ")[0] in html
        assert f"/properties/{p['listing_id']}" in html and "location.replace" in html
        # unknown listing still answers with a generic preview, never an error page
        assert requests.get(f"{API}/share/p/SEL-00000").status_code == 200

    def test_share_preview_for_article_escapes_text(self):
        posts = requests.get(f"{API}/public/posts").json()["items"]
        r = requests.get(f"{API}/share/i/{posts[0]['slug']}")
        assert r.status_code == 200 and 'og:description' in r.text and "<script>location" in r.text

    def test_robots_allows_share_links_and_blocks_private_areas(self):
        t = requests.get(f"{API}/robots.txt").text
        assert "Allow: /s/" in t and "Disallow: /erp" in t and "Disallow: /owner" in t

    def test_sitemap_lists_places_insights_and_listings(self):
        x = requests.get(f"{API}/sitemap.xml").text
        # the property tools are for staff only now, so they are not in the sitemap
        assert "/tools" not in x and "/insights/" in x and "/properties/SEL-" in x and "/properties-in/" in x


class TestLogoReset:
    def test_remove_logo_needs_settings_write(self):
        a = login(*ADMIN)
        assert a.delete(f"{API}/settings/logo").status_code == 200
        assert requests.get(f"{API}/public/settings").json().get("logo") is None
        mk = login("marketing@demo.sellandiamman.test")
        assert mk.delete(f"{API}/settings/logo").status_code == 403


class TestSessionCheck:
    def test_session_answers_without_401(self):
        r = requests.get(f"{API}/auth/session")
        assert r.status_code == 200 and r.json() == {"user": None}
        s = login("auditor@demo.sellandiamman.test")
        u = s.get(f"{API}/auth/session").json()["user"]
        assert u["role"] == "auditor" and "password_hash" not in u


class TestStatementShape:
    def test_statement_keeps_total_and_items_separate(self):
        o = login("owner@demo.sellandiamman.test")
        months = o.get(f"{API}/portal/statements").json()["months_with_rent"]
        st = o.get(f"{API}/portal/statements/{months[0]}").json()
        assert isinstance(st["expenses"], (int, float)) and isinstance(st["expense_items"], list)
        assert round(sum(e["amount"] for e in st["expense_items"]), 2) == st["expenses"]
