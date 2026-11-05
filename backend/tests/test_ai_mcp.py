# AI agents and the MCP endpoint: keys, access levels, the person's permissions and branches, the things agents may
# never do, the activity log, and the official MCP client. Runs against a backend started with SEED_DEMO=true.
import asyncio
import json
import os
import random
from datetime import date, timedelta

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


def boss():
    return login(f"director@{D}")


def uid(s, email):
    return next(u["id"] for u in s.get(f"{API}/users").json() if u["email"] == email)


def make_agent(s, email, access="read", name="Test agent", purpose="Testing", **extra):
    r = s.post(f"{API}/ai/agents", json={"name": name, "purpose": purpose, "access": access, "user_id": uid(s, email), **extra})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["key"].startswith("sae_") and d["url_with_key"].endswith(d["key"]) and d["mcp_url"].endswith("/api/mcp")
    assert "key_hash" not in d["agent"] and d["agent"]["status"] == "active"
    return d


def rpc(key, method, params=None, mid=1, how="bearer"):
    body = {"jsonrpc": "2.0", "method": method, **({"params": params} if params is not None else {}), **({"id": mid} if mid is not None else {})}
    headers, url = {"X-Forwarded-For": ip()}, f"{API}/mcp"
    if how == "bearer":
        headers["Authorization"] = f"Bearer {key}"
    elif how == "header":
        headers["X-API-Key"] = key
    else:
        url = f"{url}?key={key}"
    return requests.post(url, json=body, headers=headers)


def call(key, tool, args=None):
    r = rpc(key, "tools/call", {"name": tool, "arguments": args or {}})
    assert r.status_code == 200, r.text
    res = r.json()
    assert "result" in res, res
    out = res["result"]
    text = out["content"][0]["text"]
    return out["isError"], (text if out["isError"] else json.loads(text))


def ok(key, tool, args=None):
    err, out = call(key, tool, args)
    assert not err, out
    return out


class TestManagingAgents:
    def test_only_directors_and_admins_manage_agents(self):
        s = boss()
        sales = login(f"sales.agent@{D}")
        assert sales.get(f"{API}/ai/agents").status_code == 403
        assert sales.post(f"{API}/ai/agents", json={"name": "x", "access": "read"}).status_code == 403
        aud = login(f"auditor@{D}")
        assert aud.get(f"{API}/ai/agents").status_code == 200, "the auditor can see agents"
        assert aud.post(f"{API}/ai/agents", json={"name": "x", "access": "read"}).status_code == 403
        # a director can't hand an agent super-admin powers, nor make it work as a customer login
        r = s.post(f"{API}/ai/agents", json={"name": "x", "access": "read", "user_id": uid(s, ADMIN[0])})
        assert r.status_code == 403
        r = s.post(f"{API}/ai/agents", json={"name": "x", "access": "read", "user_id": uid(s, f"tenant@{D}")})
        assert r.status_code == 422
        assert s.post(f"{API}/ai/agents", json={"name": " ", "access": "read"}).status_code == 422
        info = s.get(f"{API}/ai/info").json()
        assert info["mcp_url"].endswith("/api/mcp") and len(info["templates"]) == 6 and info["key_prefix"] == "sae_"
        assert any(t["name"] == "run_report" for t in info["tools"]) and {"daily_brief", "rent_collections"} <= {p["name"] for p in info["prompts"]}
        assert info["staff"] and all(u["role"] not in ("tenant", "owner", "buyer", "investor", "super_admin") for u in info["staff"])

    def test_agents_show_in_the_audit_log_when_made(self):
        s = boss()
        a = make_agent(s, f"accountant@{D}", name="Audit check")
        logs = login(*ADMIN).get(f"{API}/audit", params={"entity": "ai_agents"}).json()
        assert any(x["entity_id"] == a["agent"]["id"] and x["action"] == "ai_agent_created" for x in logs)


class TestProtocol:
    def test_handshake_tools_prompts(self):
        a = make_agent(boss(), f"sales.agent@{D}", "read", name="Sales reader")
        r = rpc(a["key"], "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "pytest", "version": "1"}})
        res = r.json()["result"]
        assert res["protocolVersion"] == "2025-06-18" and res["serverInfo"]["name"] == "sellandiamman-estates"
        assert "Sales reader" in res["instructions"] and "read only" in res["instructions"] and "Vignesh Kumar" in res["instructions"]
        assert rpc(a["key"], "initialize", {"protocolVersion": "1999-01-01"}).json()["result"]["protocolVersion"] == "2025-06-18"
        r = rpc(a["key"], "notifications/initialized", mid=None)
        assert r.status_code == 202 and not r.content
        tools = {t["name"]: t for t in rpc(a["key"], "tools/list").json()["result"]["tools"]}
        assert not {"create_record", "update_record", "run_action"} & set(tools)
        assert tools["call_api"]["inputSchema"]["properties"]["method"]["enum"] == ["GET", "POST"]
        assert tools["list_records"]["annotations"]["readOnlyHint"] is True
        prompts = rpc(a["key"], "prompts/list").json()["result"]["prompts"]
        assert {"daily_brief", "lead_followups", "rent_collections", "service_desk", "short_stay_week"} <= {p["name"] for p in prompts}
        assert rpc(a["key"], "prompts/get", {"name": "daily_brief"}).json()["result"]["messages"][0]["role"] == "user"
        assert rpc(a["key"], "no/such").json()["error"]["code"] == -32601
        assert rpc(a["key"], "ping").json()["result"] == {}
        batch = requests.post(f"{API}/mcp", json=[{"jsonrpc": "2.0", "id": 1, "method": "ping"}, {"jsonrpc": "2.0", "method": "notifications/x"}],
                              headers={"Authorization": f"Bearer {a['key']}"}).json()
        assert batch == [{"jsonrpc": "2.0", "id": 1, "result": {}}]

    def test_keys_by_header_address_and_wrong_keys(self):
        a = make_agent(boss(), f"sales.agent@{D}", "read")
        for how in ("bearer", "header", "url"):
            assert rpc(a["key"], "ping", how=how).json()["result"] == {}
        r = rpc("sae_wrong", "ping")
        assert r.status_code == 401 and "WWW-Authenticate" in r.headers
        assert rpc("", "ping").status_code == 401
        assert requests.get(f"{API}/mcp").status_code == 405
        # the key never works as a normal sign-in
        assert requests.get(f"{API}/leads", headers={"Authorization": f"Bearer {a['key']}"}).status_code == 401


class TestWhatAgentsSee:
    def test_read_agent_works_with_the_persons_scope(self):
        s = boss()
        a = make_agent(s, f"sales.agent@{D}", "read")
        me = ok(a["key"], "whoami")
        assert me["works_as"]["name"] == "Vignesh Kumar" and me["access"] == "read only"
        assert [b["id"] for b in me["branches"]] == ["br-erode"] and "leads" in me["can_open"] and "finance" not in me["can_open"]
        types = {t["type"] for g in ok(a["key"], "list_record_types")["groups"] for t in g["types"]}
        assert {"leads", "customers", "properties", "deals"} <= types and not {"invoices", "leases", "investors"} & types
        vid = uid(s, f"sales.agent@{D}")
        leads = ok(a["key"], "list_records", {"type": "leads", "page_size": 100})
        assert leads["total"] > 0 and all(x.get("assigned_to") == vid for x in leads["items"]), "a sales agent sees only their own leads"
        # the same list as the person gets in the app
        app = login(f"sales.agent@{D}").get(f"{API}/leads").json()
        assert leads["total"] == len(app)
        one = ok(a["key"], "get_record", {"type": "leads", "id": leads["items"][0]["code"]})
        assert one["record"]["id"] == leads["items"][0]["id"]
        err, text = call(a["key"], "list_records", {"type": "invoices"})
        assert err and "not available" in text
        d = ok(a["key"], "describe_record_type", {"type": "leads"})
        assert "stage" in d["list_filters"] and "fields_to_add" not in d, "read agents don't get the add/change forms"
        found = ok(a["key"], "search", {"query": leads["items"][0]["name"]})
        assert any(x["id"] == leads["items"][0]["id"] for x in found["results"].get("leads", []))
        ov = ok(a["key"], "overview")
        assert "dashboard" in ov and "ceo_view" not in ov

    def test_filters_sort_dates_and_pages(self):
        a = make_agent(boss(), f"director@{D}", "read")
        new = ok(a["key"], "list_records", {"type": "leads", "filters": {"stage": "new"}, "page_size": 100})
        assert new["items"] and all(x["stage"] == "new" for x in new["items"])
        multi = ok(a["key"], "list_records", {"type": "leads", "filters": {"stage": ["new", "contacted"]}, "page_size": 100})
        assert {x["stage"] for x in multi["items"]} <= {"new", "contacted"} and multi["total"] >= new["total"]
        p1 = ok(a["key"], "list_records", {"type": "leads", "sort": "code", "page_size": 3})
        p2 = ok(a["key"], "list_records", {"type": "leads", "sort": "code", "page_size": 3, "page": 2})
        codes = [x["code"] for x in p1["items"] + p2["items"]]
        assert codes == sorted(codes) and p1["more"]
        lease = ok(a["key"], "list_records", {"type": "leases", "sort": "-arrears", "fields": ["tenant_name", "arrears"]})
        arr = [x.get("arrears", 0) for x in lease["items"]]
        assert arr == sorted(arr, reverse=True) and set(lease["items"][0]) <= {"id", "code", "tenant_name", "arrears"}
        erode = ok(a["key"], "list_records", {"type": "leads", "branch": "br-erode", "page_size": 100})
        assert erode["items"] and all(x.get("branch_id") == "br-erode" for x in erode["items"])
        ov = ok(a["key"], "overview")
        assert "ceo_view" in ov and "approvals_waiting" in ov

    def test_reports_and_screens(self):
        a = make_agent(boss(), f"accountant@{D}", "read")
        reps = {r["report"] for r in ok(a["key"], "list_reports")["reports"]}
        assert {"invoices", "ledger", "owner_statements"} <= reps and "site_visits" not in reps, "the accountant can't open leads"
        inv = ok(a["key"], "run_report", {"report": "invoices", "max_rows": 2})
        assert inv["columns"][0] == "number" and len(inv["rows"]) <= 2 and inv["total_rows"] >= len(inv["rows"])
        err, text = call(a["key"], "run_report", {"report": "site_visits"})
        assert err and "not available" in text
        eps = ok(a["key"], "list_endpoints", {"filter": "ledger"})["endpoints"]
        assert any(e["path"] == "/api/ledger/balances" for e in eps)
        paths = {e["path"] for e in ok(a["key"], "list_endpoints")["endpoints"]}
        assert not any(x.startswith(("/api/vault", "/api/auth", "/api/ai", "/api/portal", "/api/tenant/")) for x in paths)
        assert "/api/users" not in paths and "/api/users/{uid}" not in paths and "/api/users/lite" in paths
        bal = ok(a["key"], "call_api", {"path": "/api/ledger/balances"})
        assert bal
        err, text = call(a["key"], "call_api", {"path": "/api/vault/items"})
        assert err
        err, text = call(a["key"], "call_api", {"method": "POST", "path": "/api/invoices", "body": {}})
        assert err and "read-only" in text


class TestWriteAgents:
    def test_write_agent_adds_and_changes_as_the_person(self):
        s = boss()
        a = make_agent(s, f"sales.agent@{D}", "write", name="Sales helper")
        tools = {t["name"] for t in rpc(a["key"], "tools/list").json()["result"]["tools"]}
        assert {"create_record", "update_record", "run_action"} <= tools
        d = ok(a["key"], "describe_record_type", {"type": "leads"})
        keys = {f["key"] for f in d["fields_to_add"]}
        assert {"name", "phone", "source", "interest"} <= keys and any(x["action"] == "log_activity" for x in d["actions"])
        phone = f"9{random.randint(100000000, 999999999)}"
        made = ok(a["key"], "create_record", {"type": "leads", "data": {"name": "AI Agent Test Lead", "phone": phone, "source": "phone",
                                                                         "interest": "rent", "customer_type": "tenant"}})
        lid = made["created"]["id"]
        assert made["created"]["code"].startswith("SE-LD-")
        lead = login(f"sales.agent@{D}").get(f"{API}/leads/{lid}").json()
        assert lead["assigned_to"] == uid(s, f"sales.agent@{D}"), "made exactly as the person would: assigned to them"
        ok(a["key"], "run_action", {"type": "leads", "id": made["created"]["code"], "action": "log_activity",
                                    "data": {"kind": "call", "notes": "Called from the AI agent test"}})
        up = ok(a["key"], "update_record", {"type": "leads", "id": lid, "changes": {"stage": "contacted"}})
        assert up["updated"]
        logs = login(*ADMIN).get(f"{API}/audit", params={"entity_id": lid}).json()
        assert logs and all("(AI agent: Sales helper)" in x["user_name"] for x in logs) and all(x.get("agent_id") == a["agent"]["id"] for x in logs)
        # the person's limits still apply: a sales agent can't open invoices even with write access
        err, text = call(a["key"], "create_record", {"type": "invoices", "data": {}})
        assert err

    def test_things_agents_never_do(self):
        s = boss()
        a = make_agent(s, f"director@{D}", "write", name="Boss helper")
        lease = ok(a["key"], "list_records", {"type": "leases", "page_size": 1})["items"][0]
        never = [
            ("DELETE", None), ("PUT", "/api/settings"), ("POST", f"/api/leases/{lease['id']}/rent"), ("POST", "/api/expenses"),
            ("POST", "/api/approvals/x/decide"), ("GET", "/api/vault/items"), ("GET", "/api/users"), ("POST", "/api/cms/site/publish"),
            ("POST", "/api/customers/import"), ("PUT", "/api/short-stay/units/x/pricing"), ("POST", "/api/leads/x/anonymise"),
        ]
        for method, path in never:
            if method == "DELETE":
                continue  # call_api offers no DELETE at all
            err, text = call(a["key"], "call_api", {"method": method, "path": path, "body": {}})
            assert err, (method, path, text)
        tools = {t["name"]: t for t in rpc(a["key"], "tools/list").json()["result"]["tools"]}
        assert "DELETE" not in tools["call_api"]["inputSchema"]["properties"]["method"]["enum"]
        err, text = call(a["key"], "run_action", {"type": "leases", "id": lease["id"], "action": "record_rent"})
        assert err
        # the reading side of money is open
        assert ok(a["key"], "list_records", {"type": "invoices", "page_size": 2})["items"]
        # nothing of that kind was done under the agent's name
        logs = [x for x in login(*ADMIN).get(f"{API}/audit").json() if "(AI agent:" in (x.get("user_name") or "")]
        assert not any(x["action"] in ("rent_recorded", "settings_updated", "approval_decided") for x in logs)

    def test_quote_calculators_work_for_read_agents(self):
        a = make_agent(boss(), f"director@{D}", "read")
        err, text = call(a["key"], "call_api", {"method": "POST", "path": "/api/deals/commission-preview", "body": {}})
        assert "read-only" not in text


class TestLifecycle:
    def test_pause_new_key_revoke_and_expiry(self):
        s = boss()
        d = make_agent(s, f"accountant@{D}", "read")
        aid, key = d["agent"]["id"], d["key"]
        assert s.patch(f"{API}/ai/agents/{aid}", json={"active": False}).json()["status"] == "paused"
        assert rpc(key, "ping").status_code == 403
        assert s.patch(f"{API}/ai/agents/{aid}", json={"active": True}).json()["status"] == "active"
        assert rpc(key, "ping").status_code == 200
        r = s.post(f"{API}/ai/agents/{aid}/rotate").json()
        assert r["key"] != key and rpc(key, "ping").status_code == 401 and rpc(r["key"], "ping").status_code == 200
        key = r["key"]
        y = (date.today() - timedelta(days=2)).isoformat()
        assert s.patch(f"{API}/ai/agents/{aid}", json={"expires_on": y}).json()["status"] == "expired"
        assert rpc(key, "ping").status_code == 403
        s.patch(f"{API}/ai/agents/{aid}", json={"expires_on": None})
        assert s.post(f"{API}/ai/agents/{aid}/revoke").json()["status"] == "revoked"
        assert rpc(key, "ping").status_code == 403
        assert s.patch(f"{API}/ai/agents/{aid}", json={"active": True}).status_code == 409
        assert s.post(f"{API}/ai/agents/{aid}/rotate").status_code == 409

    def test_calls_are_logged_with_secrets_masked(self):
        s = boss()
        d = make_agent(s, f"director@{D}", "read", name="Logged agent")
        rpc(d["key"], "initialize", {"protocolVersion": "2025-06-18", "clientInfo": {"name": "pytest-client", "version": "9"}})
        ok(d["key"], "whoami")
        call(d["key"], "call_api", {"path": "/api/leads", "query": {"password": "hunter2", "q": "x"}})
        call(d["key"], "list_records", {"type": "nope"})
        log = s.get(f"{API}/ai/calls", params={"agent_id": d["agent"]["id"]}).json()
        assert log["total"] >= 4
        assert all("hunter2" not in (c.get("args") or "") for c in log["items"])
        fails = s.get(f"{API}/ai/calls", params={"agent_id": d["agent"]["id"], "errors": True}).json()["items"]
        assert fails and all(not c["ok"] for c in fails)
        ag = next(x for x in s.get(f"{API}/ai/agents").json() if x["id"] == d["agent"]["id"])
        assert ag["calls_total"] >= 4 and ag["last_client"] == "pytest-client 9" and ag["last_used_at"]


def _sdk_transport(url, headers):
    """The official MCP client's HTTP transport (SDK 2.x, or 1.x)."""
    try:
        from mcp.client.streamable_http import streamable_http_client
        import httpx2
        return streamable_http_client(url, http_client=httpx2.AsyncClient(headers=headers, timeout=60), terminate_on_close=False)
    except ImportError:
        from mcp.client.streamable_http import streamablehttp_client
        return streamablehttp_client(url, headers=headers)


def test_official_mcp_client():
    mcp = pytest.importorskip("mcp")
    d = make_agent(boss(), f"director@{D}", "read", name="SDK check")

    async def run(url, headers):
        async with _sdk_transport(url, headers) as streams:
            async with mcp.ClientSession(streams[0], streams[1]) as session:
                init = await session.initialize()
                tools = await session.list_tools()
                res = await session.call_tool("whoami", {})
                prompts = await session.list_prompts()
                return init, tools, res, prompts
    for url, headers in ((f"{API}/mcp", {"Authorization": f"Bearer {d['key']}"}), (f"{API}/mcp?key={d['key']}", {})):
        init, tools, res, prompts = asyncio.run(run(url, headers))
        info = getattr(init, "server_info", None) or getattr(init, "serverInfo")
        failed = getattr(res, "is_error", None)
        failed = res.isError if failed is None else failed
        assert info.name == "sellandiamman-estates"
        assert "whoami" in {t.name for t in tools.tools} and not failed
        assert json.loads(res.content[0].text)["works_as"]["name"] == "Karthik Raman"
        assert "daily_brief" in {p.name for p in prompts.prompts}
