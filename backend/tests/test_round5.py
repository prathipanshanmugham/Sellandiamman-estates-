# Round 5: customer sign-ins (tenant, owner / lessor, buyer, investor), tenant bills (EB, water…), payment notices,
# service tickets, and the password vault. Runs against a backend started with SEED_DEMO=true and a VAULT_KEY.
import os
import random
import uuid

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


def key():
    return str(uuid.uuid4())


def tenant_lease(t):
    o = t.get(f"{API}/tenant/overview").json()
    return o, o["leases"][0]


class TestCustomerSignIns:
    def test_each_customer_lands_in_their_own_portal(self):
        for who, role, ok, blocked in (("tenant", "tenant", "/tenant/overview", "/portal/overview"),
                                       ("buyer", "buyer", "/buyer/overview", "/tenant/overview"),
                                       ("owner", "owner", "/portal/overview", "/buyer/overview")):
            s = login(f"{who}@{D}")
            me = s.get(f"{API}/auth/me").json()
            assert me["role"] == role
            assert s.get(f"{API}{ok}").status_code == 200
            assert s.get(f"{API}{blocked}").status_code == 403
            assert s.get(f"{API}/leads").status_code == 403, "customers never reach staff APIs"
            assert s.get(f"{API}/tickets").status_code == 403

    def test_staff_create_a_tenant_login_from_the_customer(self):
        a = admin()
        leases = a.get(f"{API}/leases").json()
        ls = next(x for x in leases if x.get("customer_id") and x["tenant_name"] != "Ramesh & Anu Kannan")
        c = a.get(f"{API}/customers/{ls['customer_id']}").json()
        kinds = {t["type"]: t["ok"] for t in c["login_types"]}
        assert kinds["tenant"] is True and kinds["buyer"] is True
        email = f"tenant-{uuid.uuid4().hex[:6]}@example.com"
        r = a.post(f"{API}/customers/{c['id']}/logins", json={"type": "tenant", "email": email})
        assert r.status_code == 200, r.text
        assert r.json()["role"] == "tenant" and "/erp/reset-password?token=" in r.json()["activation_link"]
        assert a.post(f"{API}/customers/{c['id']}/logins", json={"type": "tenant", "email": email}).status_code == 409
        c2 = a.get(f"{API}/customers/{c['id']}").json()
        assert any(u["email"] == email and u["role"] == "tenant" for u in c2["logins"])
        # setting the password from the link signs them into the tenant portal
        tok = r.json()["activation_link"].split("token=")[1]
        rr = requests.post(f"{API}/auth/reset-password", json={"token": tok, "password": "Tenant@12345"}, headers={"X-Forwarded-For": ip()})
        assert rr.status_code == 200 and rr.json()["portal"] == "tenant"
        t = login(email, "Tenant@12345")
        assert t.get(f"{API}/tenant/overview").json()["leases"][0]["code"] == ls["code"]

    def test_tenant_login_needs_a_lease(self):
        a = admin()
        cs = a.get(f"{API}/customers", params={"type": "buyer", "limit": 50}).json()["items"]
        c = next(x for x in cs if not a.get(f"{API}/customers/{x['id']}").json()["leases"])
        r = a.post(f"{API}/customers/{c['id']}/logins", json={"type": "tenant", "email": f"x{uuid.uuid4().hex[:6]}@example.com"})
        assert r.status_code == 422 and "lease" in r.json()["detail"].lower()

    def test_only_administrators_create_logins(self):
        d = login(f"director@{D}")
        cid = d.get(f"{API}/customers").json()["items"][0]["id"]
        assert d.post(f"{API}/customers/{cid}/logins", json={"type": "buyer", "email": "a@b.co"}).status_code == 403


class TestTenantBills:
    def test_meter_bill_is_units_times_rate_plus_fixed(self):
        a = admin()
        ls = next(x for x in a.get(f"{API}/leases").json() if x["status"] == "active")
        r = a.post(f"{API}/leases/{ls['id']}/charges", json={"kind": "electricity", "period": "2026-11", "period_to": "2026-12",
                                                             "reading_prev": 100, "reading_curr": 350.5, "rate": 6, "fixed": 50,
                                                             "due_date": "2026-12-20", "mode": "collect", "payee": "owner"})
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["units"] == 250.5 and c["amount"] == 1553.0 and c["label"] == "Electricity (EB) Nov–Dec 2026"
        bad = a.post(f"{API}/leases/{ls['id']}/charges", json={"kind": "electricity", "period": "2026-11", "reading_prev": 400,
                                                               "reading_curr": 300, "rate": 6, "due_date": "2026-12-20"})
        assert bad.status_code == 422
        assert a.delete(f"{API}/charges/{c['id']}").status_code == 200

    def test_collected_bill_gets_a_receipt_and_goes_to_the_owner_statement(self):
        a = admin()
        t = login(f"tenant@{D}")
        _, lease = tenant_lease(t)
        month = "2026-11"
        c = a.post(f"{API}/leases/{lease['id']}/charges", json={"kind": "water", "period": month, "amount": 450, "due_date": f"{month}-10",
                                                                "mode": "collect", "payee": "owner"}).json()
        k = key()
        p = a.post(f"{API}/charges/{c['id']}/pay", json={"amount": 450, "date": f"{month}-08", "method": "upi", "reference": "T1", "idempotency_key": k})
        assert p.status_code == 200, p.text
        assert p.json()["receipt_no"].startswith("BR-") and p.json()["bill_status"] == "paid"
        assert a.post(f"{API}/charges/{c['id']}/pay", json={"amount": 1, "date": f"{month}-08", "method": "upi", "idempotency_key": key()}).status_code == 422
        bills = t.get(f"{API}/tenant/bills").json()
        mine = next(b for b in bills if b["id"] == c["id"])
        assert mine["status"] == "paid" and mine["payments"][0]["receipt_no"] == p.json()["receipt_no"]
        assert "payee" not in mine and "owner_id" not in mine
        pdf = t.get(f"{API}/tenant/bill-receipts/{p.json()['id']}/pdf")
        assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
        o = login(f"owner@{D}")
        st = o.get(f"{API}/portal/statements/{month}").json()
        assert st["charges_collected"] >= 450 and any(ci["receipt_no"] == p.json()["receipt_no"] for ci in st["charge_items"])
        assert abs(st["net_payable"] - (st["rent_collected"] - st["management_fee"] - st["expenses"] + st["charges_collected"])) < 0.01
        assert any(b["id"] == c["id"] for b in o.get(f"{API}/portal/bills").json())

    def test_direct_bill_is_tracked_without_money_or_receipt(self):
        a = admin()
        ls = next(x for x in a.get(f"{API}/leases").json() if x["status"] == "active")
        c = a.post(f"{API}/leases/{ls['id']}/charges", json={"kind": "maintenance", "period": "2026-11", "amount": 1200,
                                                             "due_date": "2026-11-10", "mode": "direct"}).json()
        p = a.post(f"{API}/charges/{c['id']}/pay", json={"amount": 1200, "date": "2026-11-05", "method": "upi", "idempotency_key": key()}).json()
        assert p["receipt_no"] is None and p["bill_status"] == "paid"
        ledger = a.get(f"{API}/ledger", params={"ledger": "owner_funds"})
        if ledger.status_code == 200:
            rows = ledger.json().get("items", ledger.json()) if isinstance(ledger.json(), dict) else ledger.json()
            assert not any(e.get("ref_id") == p["id"] for e in rows)

    def test_waive_and_cannot_delete_a_paid_bill(self):
        a = admin()
        ls = next(x for x in a.get(f"{API}/leases").json() if x["status"] == "active")
        c = a.post(f"{API}/leases/{ls['id']}/charges", json={"kind": "parking", "period": "2026-11", "amount": 500, "due_date": "2026-11-10"}).json()
        assert a.post(f"{API}/charges/{c['id']}/waive", json={"reason": "Goodwill"}).status_code == 200
        d = a.post(f"{API}/leases/{ls['id']}/charges", json={"kind": "parking", "period": "2026-12", "amount": 500, "due_date": "2026-12-10"}).json()
        a.post(f"{API}/charges/{d['id']}/pay", json={"amount": 200, "date": "2026-12-01", "method": "cash", "idempotency_key": key()})
        assert a.delete(f"{API}/charges/{d['id']}").status_code == 422


class TestPaymentNotices:
    def test_tenant_tells_us_and_staff_confirm_the_rent(self):
        t = login(f"tenant@{D}")
        _, lease = tenant_lease(t)
        full = t.get(f"{API}/tenant/leases/{lease['id']}").json()
        due = next(s for s in full["schedule"] if s["paid"] < s["amount"])
        pay = t.get(f"{API}/tenant/pay", params={"lease_id": lease["id"], "kind": "rent", "period": due["period"]}).json()
        assert pay["amount"] == due["amount"] - due["paid"] and pay["upi_uri"].startswith("upi://pay?") and "<svg" in pay["qr_svg"]
        k = key()
        n = t.post(f"{API}/tenant/leases/{lease['id']}/payment-notices", json={"kind": "rent", "period": due["period"], "amount": pay["amount"],
                                                                              "date": "2026-10-21", "method": "upi", "reference": "UTR123", "idempotency_key": k})
        assert n.status_code == 200, n.text
        assert t.post(f"{API}/tenant/leases/{lease['id']}/payment-notices", json={"kind": "rent", "period": due["period"], "amount": pay["amount"],
                                                                                 "date": "2026-10-21", "method": "upi", "idempotency_key": k}).status_code == 409
        pm = login(f"property.manager@{D}")
        pending = pm.get(f"{API}/payment-notices").json()
        assert any(x["id"] == n.json()["id"] for x in pending)
        r = pm.post(f"{API}/payment-notices/{n.json()['id']}/confirm", json={})
        assert r.status_code == 200, r.text
        assert r.json()["receipt_no"].startswith("RR-")
        assert pm.post(f"{API}/payment-notices/{n.json()['id']}/confirm", json={}).status_code == 409
        after = t.get(f"{API}/tenant/leases/{lease['id']}").json()
        assert any(p["receipt_no"] == r.json()["receipt_no"] for p in after["payments"])
        assert next(x for x in after["notices"] if x["id"] == n.json()["id"])["status"] == "confirmed"

    def test_staff_can_reject_with_a_reason(self):
        t = login(f"tenant@{D}")
        _, lease = tenant_lease(t)
        bills = [b for b in t.get(f"{API}/tenant/bills").json() if b["status"] in ("due", "partly_paid")]
        n = t.post(f"{API}/tenant/leases/{lease['id']}/payment-notices", json={"kind": "charge", "charge_id": bills[0]["id"], "amount": 10,
                                                                              "date": "2026-10-21", "method": "upi", "idempotency_key": key()}).json()
        a = admin()
        assert a.post(f"{API}/payment-notices/{n['id']}/reject", json={"reason": "x"}).status_code == 422
        assert a.post(f"{API}/payment-notices/{n['id']}/reject", json={"reason": "Not in our account"}).status_code == 200

    def test_tenant_cannot_see_another_lease(self):
        t = login(f"tenant@{D}")
        other = next(x for x in admin().get(f"{API}/leases").json() if x["tenant_name"] != "Ramesh & Anu Kannan")
        assert t.get(f"{API}/tenant/leases/{other['id']}").status_code == 404
        assert t.get(f"{API}/tenant/pay", params={"lease_id": other["id"]}).status_code == 404


class TestTickets:
    def test_tenant_request_through_to_rating(self):
        t = login(f"tenant@{D}")
        opts = t.get(f"{API}/my/ticket-options").json()
        assert {"plumbing", "cleaning", "move_out"} <= {c["key"] for c in opts["categories"]}
        assert "home_loan" not in {c["key"] for c in opts["categories"]}
        assert t.post(f"{API}/my/tickets", json={"category": "home_loan", "title": "Loan"}).status_code == 422
        r = t.post(f"{API}/my/tickets", json={"category": "plumbing", "title": "TEST_ Shower leaking", "description": "Since Monday",
                                              "priority": "high", "preferred_time": "After 6 pm", "permission_to_enter": True})
        assert r.status_code == 200, r.text
        tk = r.json()
        assert tk["code"].startswith("TK-") and tk["property_id"] and tk["status"] == "open"
        pm = login(f"property.manager@{D}")
        assert any(x["id"] == tk["id"] and x["unread_staff"] for x in pm.get(f"{API}/tickets").json())
        pm.post(f"{API}/tickets/{tk['id']}/messages", json={"text": "Internal: vendor is Velu", "internal": True})
        m = pm.post(f"{API}/tickets/{tk['id']}/messages", json={"text": "Plumber comes tomorrow", "internal": False})
        assert m.status_code == 200
        mine = t.get(f"{API}/my/tickets/{tk['id']}").json()
        texts = [x["text"] for x in mine["messages"]]
        assert "Plumber comes tomorrow" in texts and not any("Internal" in x for x in texts)
        assert mine["status"] == "acknowledged"
        vendors = pm.get(f"{API}/vendors").json()
        wo = pm.post(f"{API}/tickets/{tk['id']}/work-order", json={"vendor_id": vendors[0]["id"], "quote_amount": 900, "charge_to": "owner"})
        assert wo.status_code == 200, wo.text
        wid = wo.json()["work_order"]["id"]
        assert pm.post(f"{API}/tickets/{tk['id']}/work-order", json={}).status_code == 409
        assert t.post(f"{API}/my/tickets/{tk['id']}/rate", json={"stars": 5}).status_code == 422
        for st in ("in_progress", "completed"):
            body = {"status": st, **({"actual_cost": 850} if st == "completed" else {})}
            assert pm.patch(f"{API}/work-orders/{wid}", json=body).status_code == 200
        mine = t.get(f"{API}/my/tickets/{tk['id']}").json()
        assert mine["status"] == "resolved"
        assert t.post(f"{API}/my/tickets/{tk['id']}/rate", json={"stars": 4, "comment": "Good"}).json()["ok"]
        assert t.get(f"{API}/my/tickets/{tk['id']}").json()["status"] == "closed"
        assert t.post(f"{API}/my/tickets/{tk['id']}/reopen", json={"text": "Dripping again"}).status_code == 200
        assert pm.get(f"{API}/tickets/{tk['id']}").json()["status"] == "in_progress"

    def test_owner_follows_tenant_repairs_but_cannot_reply(self):
        t = login(f"tenant@{D}")
        tk = t.post(f"{API}/my/tickets", json={"category": "electrical", "title": "TEST_ Fan regulator broken"}).json()
        o = login(f"owner@{D}")
        row = next(x for x in o.get(f"{API}/my/tickets").json() if x["id"] == tk["id"])
        assert row["can_reply"] is False
        assert o.post(f"{API}/my/tickets/{tk['id']}/messages", json={"text": "hi"}).status_code == 403
        clean = t.post(f"{API}/my/tickets", json={"category": "deep_cleaning", "title": "TEST_ Deep clean"}).json()
        assert not any(x["id"] == clean["id"] for x in o.get(f"{API}/my/tickets").json()), "tenant's own cleaning stays private"

    def test_cancel_and_photo_upload(self):
        t = login(f"tenant@{D}")
        tk = t.post(f"{API}/my/tickets", json={"category": "pest_control", "title": "TEST_ Ants in kitchen"}).json()
        png = b"\x89PNG\r\n\x1a\n" + b"0" * 200
        up = t.post(f"{API}/my/tickets/{tk['id']}/files", files={"file": ("ants.png", png, "image/png")})
        assert up.status_code == 200, up.text
        link = t.post(f"{API}/my/tickets/{tk['id']}/files/{up.json()['id']}/link").json()
        assert link["url"].startswith("/api/files/")
        bad = t.post(f"{API}/my/tickets/{tk['id']}/files", files={"file": ("x.exe", b"MZ" + b"0" * 50, "application/x-msdownload")})
        assert bad.status_code == 422
        assert t.post(f"{API}/my/tickets/{tk['id']}/cancel", json={"reason": "Sorted"}).status_code == 200
        assert t.post(f"{API}/my/tickets/{tk['id']}/messages", json={"text": "x"}).status_code == 422

    def test_buyer_and_investor_requests(self):
        b = login(f"buyer@{D}")
        ov = b.get(f"{API}/buyer/overview").json()
        assert ov["deals"] and ov["deals"][0]["steps"] and ov["shortlist"]
        prop = ov["shortlist"][0]["id"]
        r = b.post(f"{API}/my/tickets", json={"category": "site_visit", "title": "TEST_ Visit please", "property_id": prop})
        assert r.status_code == 200 and r.json()["property_id"] == prop
        assert b.post(f"{API}/my/tickets", json={"category": "plumbing", "title": "x x x"}).status_code == 422
        i = login(f"investor@{D}")
        r = i.post(f"{API}/my/tickets", json={"category": "payout", "title": "TEST_ TDS certificate"})
        assert r.status_code == 200
        assert any(x["id"] == r.json()["id"] for x in admin().get(f"{API}/tickets").json())

    def test_staff_logs_a_request_for_a_tenant(self):
        a = admin()
        ls = next(x for x in a.get(f"{API}/leases").json() if x["status"] == "active" and x.get("customer_id"))
        r = a.post(f"{API}/tickets", json={"lease_id": ls["id"], "category": "water_supply", "title": "TEST_ No water since morning",
                                           "priority": "urgent", "channel": "phone"})
        assert r.status_code == 200, r.text
        assert r.json()["customer_id"] == ls["customer_id"] and r.json()["first_response_at"]
        bad = a.patch(f"{API}/tickets/{r.json()['id']}", json={"status": "closed"})
        assert bad.status_code == 422
        stats = a.get(f"{API}/tickets/stats").json()
        assert stats["active"] >= 1


class TestVault:
    def test_locked_until_unlocked_with_own_password(self):
        d = login(f"director@{D}")
        st = d.get(f"{API}/vault/status").json()
        assert st["configured"] and not st["unlocked"]
        items = d.get(f"{API}/vault/items").json()
        assert items and all("secret" not in i and "password" not in i for i in items)
        air = next(i for i in items if i["preset"] == "airbnb")
        assert d.post(f"{API}/vault/items/{air['id']}/reveal", json={"field": "password"}).status_code == 423
        assert d.post(f"{API}/vault/unlock", json={"password": "wrong"}).status_code == 401
        assert d.post(f"{API}/vault/unlock", json={"password": DEMO_PW}).status_code == 200
        r = d.post(f"{API}/vault/items/{air['id']}/reveal", json={"field": "password", "purpose": "copy"})
        assert r.status_code == 200 and r.json()["value"] and r.headers.get("cache-control") == "no-store"
        code = d.post(f"{API}/vault/items/{air['id']}/code").json()
        assert len(code["code"]) == 6 and 0 < code["seconds_left"] <= 30
        acts = d.get(f"{API}/vault/activity", params={"item_id": air["id"]}).json()
        assert {"vault_copy", "vault_code"} <= {x["action"] for x in acts}

    def test_sharing_by_role(self):
        acc = {i["title"] for i in login(f"accountant@{D}").get(f"{API}/vault/items").json()}
        assert "GST portal" in acc and "Hostinger – website server" not in acc and not any("Airbnb" in x for x in acc)
        ss = {i["title"] for i in login(f"shortstay.ops@{D}").get(f"{API}/vault/items").json()}
        assert any("Airbnb" in x for x in ss) and "GST portal" not in ss
        assert login(f"auditor@{D}").get(f"{API}/vault/items").status_code == 403
        assert login(f"tenant@{D}").get(f"{API}/vault/items").status_code == 403

    def test_create_change_history_and_delete(self):
        s = login(f"marketing@{D}")
        s.post(f"{API}/vault/unlock", json={"password": DEMO_PW})
        r = s.post(f"{API}/vault/items", json={"title": "TEST_ Instagram", "preset": "meta", "username": "sellandiamman",
                                               "password": "Old-Pass#1", "fields": [{"label": "Backup code", "value": "1234-5678", "secret": True},
                                                                                     {"label": "Page", "value": "@sellandiamman", "secret": False}],
                                               "share_roles": ["auditor", "branch_manager"], "rotate_days": 90})
        assert r.status_code == 200, r.text
        it = r.json()
        assert it["share_roles"] == ["branch_manager"], "roles without vault access are dropped"
        assert it["fields_public"] == [{"label": "Page", "value": "@sellandiamman"}] and it["secret_labels"] == ["Backup code"]
        assert s.post(f"{API}/vault/items/{it['id']}/reveal", json={"field": "field:Backup code"}).json()["value"] == "1234-5678"
        assert s.patch(f"{API}/vault/items/{it['id']}", json={"password": "New-Pass#2"}).status_code == 200
        assert s.post(f"{API}/vault/items/{it['id']}/reveal", json={"field": "password"}).json()["value"] == "New-Pass#2"
        h = s.get(f"{API}/vault/items/{it['id']}/history").json()
        assert len(h) == 1 and "secret" not in h[0]
        assert s.post(f"{API}/vault/items/{it['id']}/history/{h[0]['id']}/reveal").json()["value"] == "Old-Pass#1"
        bm = login(f"branch.manager@{D}")
        assert any(x["id"] == it["id"] and not x["can_edit"] for x in bm.get(f"{API}/vault/items").json())
        bm.post(f"{API}/vault/unlock", json={"password": DEMO_PW})
        assert bm.patch(f"{API}/vault/items/{it['id']}", json={"title": "Hacked"}).status_code == 403
        assert bm.post(f"{API}/vault/items/{it['id']}/reveal", json={"field": "totp_secret"}).status_code == 403
        assert s.patch(f"{API}/vault/items/{it['id']}", json={"totp_secret": "not a key!"}).status_code == 422
        assert s.delete(f"{API}/vault/items/{it['id']}").status_code == 200
        assert not any(x["id"] == it["id"] for x in s.get(f"{API}/vault/items").json())

    def test_unlock_belongs_to_the_session(self):
        a = login(f"director@{D}")
        a.post(f"{API}/vault/unlock", json={"password": DEMO_PW})
        b = login(f"director@{D}")
        b.cookies.set("vault_token", a.cookies.get("vault_token"), path="/api/vault")
        item = b.get(f"{API}/vault/items").json()[0]
        assert b.post(f"{API}/vault/items/{item['id']}/reveal", json={"field": "password"}).status_code == 423


class TestBrandAndSite:
    def test_payment_details_are_validated(self):
        a = admin()
        assert a.put(f"{API}/settings", json={"pay_upi_id": "not an id"}).status_code == 422
        assert a.put(f"{API}/settings", json={"pay_ifsc": "BAD"}).status_code == 422
        assert a.put(f"{API}/settings", json={"pay_upi_id": "rent.demo@example", "pay_ifsc": "demo0000001"}).status_code == 200
        assert a.get(f"{API}/settings").json()["pay_ifsc"] == "DEMO0000001"

    def test_login_and_portals_are_private_pages(self):
        r = requests.get(f"{API}/robots.txt")
        assert "Disallow: /tenant" in r.text and "Disallow: /login" in r.text
