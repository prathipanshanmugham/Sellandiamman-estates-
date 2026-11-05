// Team & admin -> AI agents & MCP: agents that let Claude (or any app that speaks MCP) work in the staff app as one
// staff login, with that person's permissions, branches and record scope.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Bot, Plus, Copy, Check, KeyRound, Pause, Play, Pencil, Ban, ListChecks, ShieldCheck, ShieldOff, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { api, errMsg, fmtDate, fmtDateTime, copyText, IS_DEMO } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useDialog } from "../../lib/dialogs";
import { Badge, DataTable, Modal, PageHeader, Section } from "../../components/erp/kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";

const STATUS = { active: ["green", "Active"], paused: ["amber", "Paused"], revoked: ["red", "Revoked"], expired: ["grey", "Expired"] };
const NEVER = "delete anything, decide approvals, record money coming in or going out (rent, payments, invoices, expenses, payouts, prices), change logins, settings or the website, or open the password vault";

function ago(s) {
  if (!s) return "";
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return fmtDate(s);
}

function CopyField({ label, value, hint }) {
  const [done, setDone] = useState(false);
  const copy = async () => { if (await copyText(value)) { setDone(true); setTimeout(() => setDone(false), 1500); } else toast.error("Couldn't copy. Select the text and copy it."); };
  return (
    <div className="min-w-0">
      {label && <p className="lbl">{label}</p>}
      <div className="flex items-stretch gap-2">
        <code className="block min-w-0 flex-1 select-all break-all border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[12.5px] leading-snug text-slate-800">{value}</code>
        <button type="button" className="btn-line btn-sm shrink-0" onClick={copy} aria-label={`Copy ${label || "text"}`}>{done ? <Check size={14} /> : <Copy size={14} />}</button>
      </div>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

// How to add the server to Claude and Claude Code, filled in with the real address (and the key when we have it)
function ConnectSteps({ url, keyText }) {
  const k = keyText || "sae_…your key…";
  return (
    <div className="space-y-6 text-sm text-slate-700">
      <section className="space-y-3">
        <h3 className="font-heading text-[15px] font-semibold text-slate-900">Claude (web, desktop and phone apps)</h3>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>In Claude, open <b>Customize → Connectors</b>, choose <b>+ Add</b>, then <b>Add custom connector</b>. On a Team or Enterprise plan an owner adds it under <b>Organization settings → Connectors</b>.</li>
          <li>Name it <b>Sellandiamman Estates</b> and paste the server address below.</li>
          <li>For authentication choose <b>No sign in</b>, and under <b>Request headers</b> add <code className="bg-slate-100 px-1">Authorization</code> with the value <code className="break-all bg-slate-100 px-1">Bearer {k}</code>.</li>
          <li>Add it, then switch it on in a chat from <b>+ → Connectors</b>.</li>
        </ol>
        <CopyField label="Server address" value={url} />
        <CopyField label="Request header value (Authorization)" value={`Bearer ${k}`} />
      </section>
      <section className="space-y-3">
        <h3 className="font-heading text-[15px] font-semibold text-slate-900">Claude Code</h3>
        <CopyField value={`claude mcp add --transport http --scope user sellandiamman-estates ${url} --header "Authorization: Bearer ${k}"`} />
      </section>
      <section className="space-y-3">
        <h3 className="font-heading text-[15px] font-semibold text-slate-900">Apps that only take an address</h3>
        <p className="text-slate-500">Use the address with the key in it. The key then also shows in the web server's access log, so use the header where you can.</p>
        <CopyField value={`${url}?key=${k}`} />
      </section>
    </div>
  );
}

function AgentCard({ a, writable, onEdit, onToggle, onRotate, onRevoke, onLog }) {
  const [tone, text] = STATUS[a.status] || STATUS.paused;
  const live = a.status !== "revoked";
  return (
    <article className="panel flex min-w-0 flex-col gap-3 p-4" data-testid={`ai-agent-${a.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center ${a.status === "active" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-400"}`}><Bot size={18} /></span>
          <div className="min-w-0">
            <h3 className="break-words font-heading text-base font-semibold leading-snug text-slate-900">{a.name}</h3>
            <p className="text-sm text-slate-500">Works as {a.user_name || "a removed login"}{a.user_role_label ? ` · ${a.user_role_label}` : ""}{a.user_active === false ? " (login switched off)" : ""}</p>
          </div>
        </div>
        <Badge v={a.status} tone={tone} text={text} />
      </div>
      {a.purpose && <p className="line-clamp-3 text-sm text-slate-600">{a.purpose}</p>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Access</dt><dd className="flex items-center gap-1.5 text-slate-800">{a.access === "write" ? <ShieldCheck size={14} className="text-amber-600" /> : <ShieldOff size={14} className="text-slate-400" />}{a.access === "write" ? "Read & write" : "Read only"}</dd></div>
        <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Key</dt><dd className="font-mono text-[13px] text-slate-800">{a.key_prefix}…</dd></div>
        <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Last used</dt><dd className="text-slate-800">{a.last_used_at ? ago(a.last_used_at) : "Not yet"}{a.last_client && <span className="block truncate text-xs text-slate-400">{a.last_client}</span>}</dd></div>
        <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Calls</dt><dd className="tabular text-slate-800">{a.calls_total || 0}</dd></div>
        <div><dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Stops after</dt><dd className="text-slate-800">{a.expires_on ? fmtDate(a.expires_on) : "No end date"}</dd></div>
        <div className="min-w-0"><dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Made by</dt><dd className="truncate text-slate-800">{a.created_by_name}, {fmtDate(a.created_at)}</dd></div>
      </dl>
      <div className="mt-auto flex flex-wrap gap-2 border-t border-slate-100 pt-3">
        <button className="btn-line btn-sm" onClick={onLog}><ListChecks size={14} />Activity</button>
        {writable && live && <>
          <button className="btn-line btn-sm" onClick={onToggle} data-testid="ai-agent-toggle">{a.active ? <><Pause size={14} />Pause</> : <><Play size={14} />Switch on</>}</button>
          <button className="btn-line btn-sm" onClick={onRotate} data-testid="ai-agent-rotate"><KeyRound size={14} />New key</button>
          <button className="btn-line btn-sm" onClick={onEdit}><Pencil size={14} />Edit</button>
          <button className="btn-ghost btn-sm text-red-700 hover:bg-red-50" onClick={onRevoke} data-testid="ai-agent-revoke"><Ban size={14} />Revoke</button>
        </>}
      </div>
    </article>
  );
}

function AgentForm({ agent, templates, staff, onClose, onSaved }) {
  const editing = !!agent?.id;
  const { user } = useAuth();
  const [tpl, setTpl] = useState(agent?.template || "");
  const [v, setV] = useState(() => (editing ? { name: agent.name, purpose: agent.purpose || "", access: agent.access, user_id: agent.user_id, expires_on: agent.expires_on || "" }
    : { name: "", purpose: "", access: "read", user_id: "", expires_on: "" }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e?.target ? e.target.value : e }));
  const pick = (t) => {
    setTpl(t?.key || "");
    if (!t) { setV((s) => ({ ...s, name: tpl ? "" : s.name, purpose: tpl ? "" : s.purpose })); return; }
    const suggested = t.roles.map((r) => staff.find((u) => u.role === r)).find(Boolean);
    setV((s) => ({ ...s, name: t.name, purpose: t.purpose, access: t.access, user_id: s.user_id || suggested?.id || "" }));
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...v, template: tpl || null, expires_on: v.expires_on || null };
      if (!body.user_id) delete body.user_id;
      const r = editing ? await api.patch(`/ai/agents/${agent.id}`, body) : await api.post("/ai/agents", body);
      onSaved(r.data, editing);
    } catch (ex) { toast.error(errMsg(ex)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={editing ? `Edit ${agent.name}` : "New AI agent"} wide>
      <form onSubmit={save} className="space-y-5" data-testid="ai-agent-form">
        <p className="-mt-2 text-sm text-slate-500">{editing ? "Changes apply from the agent's next call. The key stays the same." : "Pick a job to start from, choose whose login it works as, then copy its key."}</p>
        {!editing && (
          <div>
            <p className="lbl">Job</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {templates.map((t) => (
                <button key={t.key} type="button" onClick={() => pick(t)} aria-pressed={tpl === t.key} data-testid={`ai-template-${t.key}`}
                  className={`border px-3 py-2.5 text-left transition-colors ${tpl === t.key ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-400"}`}>
                  <span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-slate-900">{t.name}</span><Badge v={t.access} tone={t.access === "write" ? "amber" : "grey"} text={t.access === "write" ? "Read & write" : "Read only"} /></span>
                  <span className="mt-0.5 line-clamp-2 text-xs text-slate-500">{t.purpose}</span>
                </button>
              ))}
              <button type="button" onClick={() => pick(null)} aria-pressed={!tpl} className={`border border-dashed px-3 py-2.5 text-left ${!tpl ? "border-slate-900 bg-slate-50" : "border-slate-300 hover:border-slate-400"}`}>
                <span className="text-sm font-semibold text-slate-900">Your own job</span><span className="block text-xs text-slate-500">Write the job description yourself</span>
              </button>
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="lbl" htmlFor="ai-name">Name *</label><input id="ai-name" className="inp" value={v.name} onChange={set("name")} placeholder="Sales assistant" maxLength={60} required data-testid="ai-agent-name" /></div>
          <div>
            <label className="lbl" htmlFor="ai-user">Works as</label>
            <select id="ai-user" className="inp" value={v.user_id} onChange={set("user_id")} data-testid="ai-agent-user">
              <option value="">Me ({user.name})</option>
              {staff.filter((u) => u.id !== user.id).map((u) => <option key={u.id} value={u.id}>{u.name}, {u.role_label}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-400">It gets this person's permissions, branches and records.</p>
          </div>
        </div>
        <fieldset>
          <legend className="lbl">Access</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[["read", "Read only", "Looks things up, runs reports and screens. Changes nothing."], ["write", "Read & write", "Can also add and change records and act on them (log a call, reply to a request…), as the person could."]].map(([k, l, d]) => (
              <label key={k} className={`flex cursor-pointer gap-2.5 border px-3 py-2.5 ${v.access === k ? "border-slate-900 bg-slate-50" : "border-slate-200"}`}>
                <input type="radio" name="ai-access" value={k} checked={v.access === k} onChange={() => setV((s) => ({ ...s, access: k }))} className="mt-1" data-testid={`ai-access-${k}`} />
                <span><span className="block text-sm font-semibold text-slate-900">{l}</span><span className="block text-xs text-slate-500">{d}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label className="lbl" htmlFor="ai-purpose">Job description</label>
          <textarea id="ai-purpose" rows={4} className="inp" value={v.purpose} onChange={set("purpose")} maxLength={2000} />
          <p className="mt-1 text-xs text-slate-400">The AI reads this when it connects. Say what to look after and what to leave alone.</p>
        </div>
        <div className="sm:max-w-xs">
          <label className="lbl" htmlFor="ai-exp">Stops working after</label>
          <input id="ai-exp" type="date" className="inp" value={v.expires_on || ""} onChange={set("expires_on")} />
          <p className="mt-1 text-xs text-slate-400">Optional. Useful for a trial.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-4 sm:flex sm:justify-end">
          <button type="button" className="btn-line" onClick={onClose}>Cancel</button>
          <button className="btn-dark" disabled={busy || !v.name.trim()} data-testid="ai-agent-save">{busy ? "Saving…" : editing ? "Save" : "Create agent"}</button>
        </div>
      </form>
    </Modal>
  );
}

function Activity({ agents, agentId, setAgentId, tools }) {
  const titles = useMemo(() => Object.fromEntries((tools || []).map((t) => [t.name, t.title])), [tools]);
  const [errors, setErrors] = useState(false);
  const [page, setPage] = useState(1);
  const [d, setD] = useState(null);
  const load = () => api.get("/ai/calls", { params: { agent_id: agentId || undefined, errors: errors || undefined, page } }).then((r) => setD(r.data)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, [agentId, errors, page]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = d ? Math.max(1, Math.ceil(d.total / d.size)) : 1;
  return (
    <div className="space-y-3">
      <div className="filter-bar flex flex-wrap items-center gap-2">
        <select className="fb-full inp sm:!w-64" value={agentId} onChange={(e) => { setAgentId(e.target.value); setPage(1); }} aria-label="Agent">
          <option value="">All agents</option>{(agents || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <div className="fb-full flex items-center justify-between gap-2 sm:contents">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={errors} onChange={(e) => { setErrors(e.target.checked); setPage(1); }} />Only calls that were refused</label>
          <button className="p-2 text-slate-500 hover:text-slate-900" onClick={load} aria-label="Refresh"><RefreshCw size={15} /></button>
        </div>
        {d && <span className="text-xs text-slate-500 sm:ml-auto">{d.total} calls, kept 90 days</span>}
      </div>
      <DataTable testid="ai-calls" loading={!d} rows={d?.items || []} empty="No calls yet. They show here as soon as an agent connects." columns={[
        { key: "tool", label: "Call", m: "title", render: (c) => <>{titles[c.tool] || c.tool || (c.method === "initialize" ? "Connected" : c.method)}<span className="block text-xs text-slate-500">{c.agent_name} · as {c.user_name}</span></> },
        { key: "ok", label: "Result", m: "badge", render: (c) => <Badge v={c.ok ? "done" : "rejected"} tone={c.ok ? "green" : "red"} text={c.ok ? "Done" : "Refused"} /> },
        { key: "at", label: "When", render: (c) => <span className="whitespace-nowrap">{fmtDateTime(c.at)}</span> },
        { key: "ms", label: "Time", render: (c) => `${c.ms ?? 0} ms` },
        { key: "args", label: "Details", m: "wide", render: (c) => <span className={`line-clamp-2 break-all text-xs ${c.ok ? "text-slate-500" : "text-red-700"}`}>{c.error || c.args || "—"}</span> },
      ]} />
      {pages > 1 && <nav className="flex items-center justify-end gap-2 text-sm" aria-label="Pages">
        <button className="btn-line btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={14} />Newer</button>
        <span className="tabular text-slate-500">{page} / {pages}</span>
        <button className="btn-line btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Older<ChevronRight size={14} /></button>
      </nav>}
    </div>
  );
}

export default function AiAgents() {
  const { can } = useAuth();
  const dialog = useDialog();
  const writable = can("ai", "w");
  const [info, setInfo] = useState(null);
  const [agents, setAgents] = useState(null);
  const [tab, setTab] = useState("agents");
  const [form, setForm] = useState(null); // {} new, agent = edit
  const [issued, setIssued] = useState(null);
  const [logAgent, setLogAgent] = useState("");
  const reload = () => api.get("/ai/agents").then((r) => setAgents(r.data)).catch((e) => { toast.error(errMsg(e)); setAgents([]); });
  useEffect(() => { api.get("/ai/info").then((r) => setInfo(r.data)).catch(() => {}); reload(); }, []);
  const sorted = useMemo(() => [...(agents || [])].sort((a, b) => (a.status === "revoked") - (b.status === "revoked")), [agents]);
  const url = info?.mcp_url || `${window.location.origin}/api/mcp`;
  const active = (agents || []).filter((a) => a.status === "active").length;

  const patch = async (a, body, msg) => { try { await api.patch(`/ai/agents/${a.id}`, body); toast.success(msg); reload(); } catch (ex) { toast.error(errMsg(ex)); } };
  const rotate = async (a) => {
    if (!(await dialog.confirm({ title: `New key for ${a.name}?`, body: "The current key stops working straight away. Put the new one into Claude's connector settings.", okLabel: "Make a new key" }))) return;
    try { const r = await api.post(`/ai/agents/${a.id}/rotate`); setIssued(r.data); reload(); } catch (ex) { toast.error(errMsg(ex)); }
  };
  const revoke = async (a) => {
    if (!(await dialog.confirm({ title: `Revoke ${a.name}?`, body: "It stops working at once and can't be switched back on. Its activity stays in the log.", okLabel: "Revoke", tone: "danger" }))) return;
    try { await api.post(`/ai/agents/${a.id}/revoke`); toast.success(`${a.name} can't connect any more`); reload(); } catch (ex) { toast.error(errMsg(ex)); }
  };

  return (
    <div data-testid="ai-agents-page">
      <PageHeader title="AI agents & MCP" sub="Let Claude, or any app that speaks MCP, work in the staff app. Each agent works as one staff login with that person's permissions, and everything it does is in the audit log.">
        {writable && <button className="btn-dark btn-sm" onClick={() => setForm({})} data-testid="ai-new-agent"><Plus size={14} />New agent</button>}
      </PageHeader>
      {IS_DEMO && <p className="mb-4 border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Preview: agents and keys made here are for show. The live site answers AI apps at its own address, {url.replace(/^https?:\/\/[^/]+/, "https://www.sellandiammanestates.com")}.</p>}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="rounded-sm">
          <TabsTrigger value="agents" data-testid="ai-tab-agents">Agents{active ? ` (${active})` : ""}</TabsTrigger>
          <TabsTrigger value="activity" data-testid="ai-tab-activity">Activity</TabsTrigger>
          <TabsTrigger value="connect" data-testid="ai-tab-connect">How to connect</TabsTrigger>
        </TabsList>
        <TabsContent value="agents" className="mt-4">
          {!agents ? <p className="text-sm text-slate-500">Loading…</p> : !sorted.length ? (
            <div className="panel flex flex-col items-center px-6 py-12 text-center">
              <span className="flex h-11 w-11 items-center justify-center bg-slate-100 text-slate-500"><Bot size={22} /></span>
              <h2 className="mt-3 font-heading text-lg font-semibold">No AI agents yet</h2>
              <p className="mt-1 max-w-md text-sm text-slate-500">Make one for each job, such as a sales assistant that logs follow-ups, a care desk that answers tenants' requests, or a read-only analyst for the CEO view and reports.</p>
              {writable && <button className="btn-dark btn-sm mt-4" onClick={() => setForm({})}><Plus size={14} />New agent</button>}
            </div>
          ) : (
            <div className="grid items-stretch gap-4 lg:grid-cols-2">
              {sorted.map((a) => <AgentCard key={a.id} a={a} writable={writable} onEdit={() => setForm(a)} onLog={() => { setLogAgent(a.id); setTab("activity"); }}
                onToggle={() => patch(a, { active: !a.active }, a.active ? `${a.name} is paused` : `${a.name} is switched on`)} onRotate={() => rotate(a)} onRevoke={() => revoke(a)} />)}
            </div>
          )}
          <div className="mt-4 flex gap-3 border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-slate-500" />
            <p><b className="text-slate-900">What agents can never do.</b> Whatever the login's role allows, an agent can't {NEVER}. Records it adds or changes go through the same checks, numbering and notifications as in the app, and the audit log shows them as "<i>person</i> (AI agent: <i>name</i>)". 240 calls a minute per agent.</p>
          </div>
        </TabsContent>
        <TabsContent value="activity" className="mt-4"><Activity agents={agents} agentId={logAgent} setAgentId={setLogAgent} tools={info?.tools} /></TabsContent>
        <TabsContent value="connect" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <Section title="Connect an agent">
              <p className="-mt-2 mb-4 text-sm text-slate-500">Use the key you copied when you made the agent. Lost it? Make a new key on the agent's card.</p>
              <ConnectSteps url={url} />
            </Section>
            <div className="min-w-0 space-y-4">
              <Section title="What the AI can use">
                <ul className="-mx-4 -mb-4 divide-y divide-slate-100 sm:-mx-5 sm:-mb-5">
                  {(info?.tools || []).map((t) => <li key={t.name} className="px-4 py-2.5 sm:px-5"><p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">{t.title}{t.write && <Badge v="write" tone="amber" text="Read & write agents" />}</p><p className="text-xs text-slate-500">{t.description}</p></li>)}
                </ul>
              </Section>
              {info?.prompts?.length > 0 && <Section title="Ready-made requests">
                <p className="-mt-2 mb-3 text-xs text-slate-500">Shown in Claude's prompt list once connected.</p>
                <ul className="-mx-4 -mb-4 divide-y divide-slate-100 sm:-mx-5 sm:-mb-5">{info.prompts.map((p) => <li key={p.name} className="px-4 py-2.5 sm:px-5"><p className="text-sm font-medium text-slate-900">{p.title}</p><p className="text-xs text-slate-500">{p.description}</p></li>)}</ul>
              </Section>}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {form && <AgentForm agent={form} templates={info?.templates || []} staff={info?.staff || []} onClose={() => setForm(null)}
        onSaved={(d, editing) => { setForm(null); reload(); if (editing) toast.success("Agent saved"); else setIssued(d); }} />}
      <Modal open={!!issued} onClose={() => setIssued(null)} title={`Key for ${issued?.agent?.name || "the agent"}`} wide>
        {issued && <div className="space-y-5" data-testid="ai-key-issued">
          <p className="-mt-2 text-sm text-slate-500">Copy it now: it's shown only this once. If it's lost, make a new key.</p>
          <CopyField label="Key" value={issued.key} />
          <p className="border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><b>Treat it like a password.</b> Anyone with this key can do what {issued.agent?.user_name} can, within the agent's access. Revoke the agent if the key is shared by mistake.</p>
          <ConnectSteps url={issued.mcp_url} keyText={issued.key} />
          <div className="flex justify-end border-t border-slate-100 pt-4"><button className="btn-dark" onClick={() => setIssued(null)} data-testid="ai-key-done">I've copied it</button></div>
        </div>}
      </Modal>
    </div>
  );
}
