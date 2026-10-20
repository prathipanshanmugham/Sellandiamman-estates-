import { useEffect, useMemo, useState } from "react";
import { Phone, MessageCircle, Mail, FileDown, Search, Building2 } from "lucide-react";
import { api, openFile, telLink, waLink, label, useDebounced } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { PageHeader, DataTable, Modal, Section, act } from "../../components/erp/kit";

const initials = (n) => String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase();

function Avatar({ p, size = 44 }) {
  return p.photo ? <img src={p.photo} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} /> : <span className="flex shrink-0 items-center justify-center rounded-full bg-slate-900 font-heading text-sm font-semibold text-white" style={{ width: size, height: size }} aria-hidden="true">{initials(p.name)}</span>;
}

function Contacts({ p, small }) {
  const wa = waLink(p.whatsapp || p.phone, `Hello ${p.name.split(" ")[0]},`);
  const cls = small ? "p-1 text-slate-500 hover:text-slate-900" : "btn-line btn-sm";
  return (
    <span className="flex flex-wrap justify-center gap-1">
      {p.phone && <a href={telLink(p.phone)} className={cls} aria-label={`Call ${p.name}`} title={p.phone}><Phone size={13} />{!small && "Call"}</a>}
      {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className={cls} aria-label={`WhatsApp ${p.name}`}><MessageCircle size={13} />{!small && "WhatsApp"}</a>}
      {p.email && <a href={`mailto:${p.email}`} className={cls} aria-label={`Email ${p.name}`} title={p.email}><Mail size={13} />{!small && "Email"}</a>}
    </span>
  );
}

function Node({ p, kids, branchName, highlight }) {
  const children = kids[p.id] || [];
  return (
    <li>
      <div className={`org-card inline-flex w-48 flex-col items-center border bg-white p-3 text-center shadow-sm ${highlight === p.id ? "border-slate-900 ring-2 ring-slate-900" : "border-slate-200"}`} data-testid={`org-node-${p.id}`}>
        <Avatar p={p} />
        <p className="mt-2 text-sm font-semibold leading-tight text-slate-900">{p.name}</p>
        <p className="text-[11px] leading-tight text-slate-600">{p.designation || p.role_label}</p>
        <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-400">{branchName(p)}</p>
        <div className="mt-1"><Contacts p={p} small /></div>
      </div>
      {children.length > 0 && <ul>{children.map((c) => <Node key={c.id} p={c} kids={kids} branchName={branchName} highlight={highlight} />)}</ul>}
    </li>
  );
}

async function resizePhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(img.width, img.height), c = document.createElement("canvas");
    c.width = c.height = 240;
    c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 240, 240);
    return c.toDataURL("image/jpeg", 0.82);
  } finally { URL.revokeObjectURL(url); }
}

export default function Team() {
  const { user, refresh } = useAuth();
  const [d, setD] = useState(null);
  const [view, setView] = useState("chart");
  const [q, setQ] = useState("");
  const [me, setMe] = useState(null);
  const dq = useDebounced(q, 200);
  const load = () => api.get("/team/org").then((r) => setD(r.data)).catch(() => setD(false));
  useEffect(() => { load(); }, []);
  const people = useMemo(() => d?.people || [], [d]);
  const bmap = useMemo(() => Object.fromEntries((d?.branches || []).map((b) => [b.id, b])), [d]);
  const branchName = (p) => (p.branch_ids?.length ? p.branch_ids.map((b) => bmap[b]?.name || "").join(", ") : "All branches");
  const kids = useMemo(() => { const k = {}; people.forEach((p) => { if (p.reports_to) (k[p.reports_to] = k[p.reports_to] || []).push(p); }); Object.values(k).forEach((l) => l.sort((a, b) => a.name.localeCompare(b.name))); return k; }, [people]);
  const roots = people.filter((p) => !p.reports_to);
  const match = dq && people.find((p) => `${p.name} ${p.designation || ""} ${p.phone || ""}`.toLowerCase().includes(dq.toLowerCase()));
  const filtered = people.filter((p) => !dq || `${p.name} ${p.designation || ""} ${p.department || ""} ${branchName(p)} ${p.phone || ""} ${p.email || ""}`.toLowerCase().includes(dq.toLowerCase()));
  if (d === false) return <p>Could not load the team.</p>;
  if (!d) return <p className="text-sm text-slate-500">Loading…</p>;
  const mine = people.find((p) => p.id === user.id);
  return (
    <div className="space-y-6" data-testid="team-page">
      <PageHeader title="Team & organisation chart" sub={`${people.length} people across ${d.branches.length} branches. Who reports to whom, with phone, WhatsApp and email.`}>
        <button className="btn-line btn-sm" onClick={() => openFile("/team/org.pdf", { name: "Organisation chart" })} data-testid="org-pdf-btn"><FileDown size={13} />Chart PDF</button>
        <button className="btn-dark btn-sm" onClick={() => setMe({ phone: mine?.phone || user.phone || "", whatsapp: mine?.whatsapp || "" })} data-testid="edit-my-contact-btn">My contact details</button>
      </PageHeader>
      <div className="flex flex-wrap items-center gap-2">
        {[["chart", "Chart"], ["directory", "Directory"], ["branches", "By branch"]].map(([k, l]) => <button key={k} className={`chip ${view === k ? "chip-on" : ""}`} onClick={() => setView(k)} data-testid={`team-view-${k}`}>{l}</button>)}
        <span className="relative ml-auto"><Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" /><input className="inp !pl-8 sm:!w-64" placeholder="Find a person" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a person" /></span>
      </div>
      {view === "chart" && <div className="panel overflow-x-auto p-4" data-testid="org-chart"><div className="org-tree min-w-max"><ul>{roots.map((r) => <Node key={r.id} p={r} kids={kids} branchName={branchName} highlight={match?.id} />)}</ul></div></div>}
      {view === "directory" && <DataTable testid="team-directory" rows={filtered} columns={[{ key: "name", label: "Name", render: (p) => <span className="flex items-center gap-2"><Avatar p={p} size={28} /><span><span className="font-medium">{p.name}</span><span className="block text-xs text-slate-500">{p.designation || p.role_label}</span></span></span> }, { key: "department", label: "Team", render: (p) => p.department || label(p.role) }, { key: "branch", label: "Branch", render: branchName }, { key: "reports_to", label: "Reports to", render: (p) => people.find((x) => x.id === p.reports_to)?.name || "-" }, { key: "phone", label: "Phone", render: (p) => p.phone || "-" }, { key: "email", label: "Email", render: (p) => <span className="break-all">{p.email}</span> }, { key: "x", label: "", render: (p) => <Contacts p={p} small /> }]} />}
      {view === "branches" && <div className="grid gap-4 lg:grid-cols-2" data-testid="team-branches">
        {d.branches.map((b) => { const staff = filtered.filter((p) => p.branch_ids?.includes(b.id)); const mgr = people.find((p) => p.id === b.manager_id); return (
          <Section key={b.id} title={<span className="flex items-center gap-2"><Building2 size={15} />{b.name}{b.is_head_office && <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Head office</span>}</span>}>
            <p className="text-sm text-slate-600">{b.address}</p>
            <p className="mt-1 text-xs text-slate-500">{[b.phone || d.company.phone, b.email || d.company.email].filter(Boolean).join(" · ")}</p>
            {mgr && <p className="mt-2 text-sm">Manager: <b>{mgr.name}</b></p>}
            <ul className="mt-3 divide-y divide-slate-100">{staff.map((p) => <li key={p.id} className="flex items-center justify-between gap-2 py-2"><span className="flex items-center gap-2"><Avatar p={p} size={28} /><span className="text-sm"><span className="font-medium">{p.name}</span><span className="block text-xs text-slate-500">{p.designation || p.role_label}</span></span></span><Contacts p={p} small /></li>)}{!staff.length && <li className="py-2 text-sm text-slate-400">No staff listed for this branch.</li>}</ul>
          </Section>
        ); })}
        <Section title="Across all branches"><ul className="divide-y divide-slate-100">{filtered.filter((p) => !p.branch_ids?.length).map((p) => <li key={p.id} className="flex items-center justify-between gap-2 py-2"><span className="flex items-center gap-2"><Avatar p={p} size={28} /><span className="text-sm"><span className="font-medium">{p.name}</span><span className="block text-xs text-slate-500">{p.designation || p.role_label}</span></span></span><Contacts p={p} small /></li>)}</ul></Section>
      </div>}
      <p className="text-xs text-slate-400">Administrators set designations, departments, branches and who reports to whom under Users & Roles. People can hide themselves from this list there.</p>
      <Modal open={!!me} onClose={() => setMe(null)} title="My contact details">
        {me && <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); if (await act(() => api.patch("/team/me", { phone: me.phone || null, whatsapp: me.whatsapp || null, ...(me.photo ? { photo: me.photo } : {}) }), "Saved")) { setMe(null); load(); refresh(); } }}>
          <div className="flex items-center gap-4"><Avatar p={{ ...mine, photo: me.photo || mine?.photo, name: user.name }} size={64} /><label className="btn-line btn-sm cursor-pointer">Change photo<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={async (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) setMe({ ...me, photo: await resizePhoto(f) }); }} /></label></div>
          <div><label className="lbl" htmlFor="me-phone">Work phone</label><input id="me-phone" className="inp" inputMode="tel" value={me.phone} onChange={(e) => setMe({ ...me, phone: e.target.value })} /></div>
          <div><label className="lbl" htmlFor="me-wa">WhatsApp</label><input id="me-wa" className="inp" inputMode="tel" value={me.whatsapp} onChange={(e) => setMe({ ...me, whatsapp: e.target.value })} /></div>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" className="btn-line" onClick={() => setMe(null)}>Cancel</button><button className="btn-dark">Save</button></div>
        </form>}
      </Modal>
    </div>
  );
}
