# AI agents and MCP

Claude, or any app that speaks the Model Context Protocol (MCP), can work in the Sellandiamman Estates staff app through
**AI agents**. Each agent works as one staff login, so it sees and does only what that person may (their role, their
branches, their own leads or leases where the role is limited to them), and everything it does is in the audit log as
*"Person (AI agent: Agent name)"*.

The same design as Sellandiamman Power Infra's *AI agents & MCP* and Traders' *AI & MCP access*.

## Set one up

1. Sign in as the director or a super admin and open **Team & admin → AI agents & MCP** (`/erp/ai-agents`). The
   auditor can look but not change anything.
2. **New agent**: pick a job (business analyst, sales assistant, rent & collections, property care desk, short-stay desk,
   listings assistant, or your own), choose whose login it works as, and choose **Read only** or **Read & write**. An
   optional end date stops it working after that day.
3. Copy the key (`sae_…`). It is shown once; the server keeps only a SHA-256 hash. Lost it? **New key** on the agent's
   card (the old one stops at once).
4. Add it to Claude:
   - **Claude (web, desktop, phone)**: Customize → Connectors → + Add → Add custom connector. Name *Sellandiamman
     Estates*, server address `https://www.sellandiammanestates.com/api/mcp`, authentication **No sign in**, and under
     **Request headers** add `Authorization` = `Bearer sae_…`. On Team and Enterprise plans an owner adds it under
     Organization settings → Connectors. Then switch it on in a chat from **+ → Connectors**.
   - **Claude Code**: `claude mcp add --transport http --scope user sellandiamman-estates https://www.sellandiammanestates.com/api/mcp --header "Authorization: Bearer sae_…"`
   - **Apps that only take an address**: `https://www.sellandiammanestates.com/api/mcp?key=sae_…` (the key then also
     appears in the web servers' access logs, so prefer the header).

## What an agent can and can't do

- The login's role decides what it can open, which branches it sees and which records (a sales agent's agent sees only
  that agent's leads, deals and customers), the same as on screen.
- **Read only** agents look things up, run reports and read screens. **Read & write** agents can also add and change
  records and act on them: log a call on a lead, book a site visit, share listings, convert a lead to a deal, reply to a
  service request, raise a work order, add a tenant bill, check a guest in, add a task. The usual numbering, branch,
  matching and notifications apply.
- Whatever the role, an agent **never** (`core.agent_blocked`):
  - deletes anything;
  - decides approvals, verifies or features a listing, finalises or marks an agreement signed;
  - records money coming in or going out: rent, deposits, invoice payments, credit notes, bill payments and waivers,
    tenant payment checks, owner payouts and settlements, ledger reversals, expenses, investments and distributions,
    deal close / commission / invoice, short-stay prices;
  - changes logins, customer logins and portal invites, settings, branches, the website or Insights, imports, merges,
    consent, KYC or anonymising;
  - opens the password vault, customer portals, customer data exports or stored files.
- 240 calls a minute per agent. Every call is listed under **Activity** for 90 days; pausing or revoking an agent stops
  it at once.

## Tools the AI gets

| Tool | What it does |
|---|---|
| `whoami` | The agent, the login it works as, its branches and what it can open, the team, today's date (IST), currency |
| `overview` | Dashboard figures, CEO view and alerts (if allowed), approvals waiting, the person's open tasks, service requests, unread notifications |
| `list_record_types` / `describe_record_type` | The record types it may open; list filters, the fields to add or change (from the app's own forms) and actions |
| `search` | One search across leads, customers, properties, owners, investors, service requests, agreements and documents |
| `list_records` / `get_record` | Lists with text search, filters, dates, sorting and pages; one record in full by id or code (SE-LD-…, SE-P-…, TK-…) |
| `create_record`, `update_record`, `run_action` | Read & write agents only |
| `list_reports` / `run_report` | The spreadsheet reports as rows and columns |
| `list_endpoints` / `call_api` | Other screens: CEO view, calendar, ledger balances, owner statements, short-stay calendar and performance, lead matches |

Record types: leads, customers, properties, owners, deals, site visits, agreements, leases, tenant bills, payments tenants
reported, service requests, work orders, vendors, short-stay bookings and homes, tasks, approvals, documents, invoices,
expenses, owner statements, investors, investment projects, campaigns.

Ready-made prompts: *Daily brief*, *Lead follow-ups*, *Rent collections list*, *Service desk check*, *Short stays this week*.

## How it works

- `POST /api/mcp`: JSON-RPC 2.0 over Streamable HTTP, plain JSON answers, no session (`GET` answers 405). Protocol
  versions 2025-06-18, 2025-03-26 and 2024-11-05. Code: `backend/routes_ai.py`.
- Each tool call runs as an ordinary request inside the server, signed with a two-minute token for the agent
  (`core.make_agent_token`), so the same permission checks, branch limits and audit trail apply as in the app. The
  token is never handed out, and the key itself never works as a sign-in.
- Collections: `ai_agents` (key hash, prefix, version, who it works as, access, status, last use) and `ai_agent_calls`
  (tool, arguments with secrets masked, result, time, IP).
- Caddy answers `/.well-known/oauth-*` with 404, so Claude's connector setup sees there is no OAuth sign-in and uses the
  request header.
- Tests: `backend/tests/test_ai_mcp.py`, including the official MCP Python SDK client over HTTP with the key in a
  header and in the address.
- The hosted preview shows the screen with sample agents and calls; AI apps can only connect to the live site.
