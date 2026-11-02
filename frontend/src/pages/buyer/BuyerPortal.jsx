import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Phone, MessageCircle, Mail, Check } from "lucide-react";
import { api, fmtDate, fmtDateTime, inr, label, openFile, imgSrc, priceLabel, telLink, waLink } from "../../lib/api";
import { Badge, DataTable, Section, act } from "../../components/erp/kit";
import { PortalShell, Loading } from "../../components/portal/PortalShell";
import { RequestsList, RequestDetail, NewRequest } from "../../components/portal/Requests";

const TABS = [["/buyer", "Overview"], ["/buyer/requests", "Requests"], ["/buyer/documents", "Documents"]];
const STEP_TEXT = { negotiation: "Price agreed", agreement: "Agreement", closing: "Registration / handover", won: "Done" };
const DEAL_KIND = { sale: "Purchase", rent: "Rental", lease: "Lease" };

export function BuyerLayout() {
  return <PortalShell kind="buyer" home="/buyer" title="Buyer portal" tabs={TABS}
    footer={<>Prices and timelines are as agreed with the seller and can change until registration. Questions? <Link to="/buyer/requests" className="underline">Raise a request</Link> or call your relationship manager.</>} />;
}

function Agent({ a }) {
  if (!a) return null;
  const wa = waLink(a.whatsapp || a.phone, "Hello, this is about my property purchase.");
  return (
    <Section title="Your relationship manager">
      <p className="font-medium">{a.name}</p>{a.designation && <p className="text-xs text-slate-500">{a.designation}</p>}
      <div className="mt-3 flex flex-wrap gap-2">{a.phone && <a className="btn-line btn-sm" href={telLink(a.phone)}><Phone size={13} />Call</a>}{wa && <a className="btn-line btn-sm" href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle size={13} />WhatsApp</a>}{a.email && <a className="btn-line btn-sm" href={`mailto:${a.email}`}><Mail size={13} />Email</a>}</div>
    </Section>
  );
}

export function BuyerOverview() {
  const [d, setD] = useState(null);
  const [ask, setAsk] = useState(null);
  useEffect(() => { api.get("/buyer/overview").then((r) => setD(r.data)).catch(() => setD(false)); }, []);
  if (!d) return <Loading d={d} />;
  const upcoming = d.visits.filter((v) => ["scheduled", "requested"].includes(v.status));
  return (
    <div className="space-y-6">
      <div><p className="eyebrow">Client {d.customer.code}</p><h1 className="mt-1 font-heading text-2xl font-semibold" data-testid="buyer-hello">Hello, {d.customer.name}</h1></div>
      {d.deals.map((x) => (
        <section key={x.id} className="panel overflow-hidden" data-testid={`buyer-deal-${x.code}`}>
          <div className="grid md:grid-cols-[260px_1fr]">
            <img src={imgSrc(x.property?.images?.[0])} alt="" className="h-40 w-full object-cover md:h-full" />
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="eyebrow">{DEAL_KIND[x.deal_type] || "Deal"} · {x.code}</p><p className="mt-1 font-heading text-lg font-semibold">{x.property_title}</p>{x.property && <p className="text-xs text-slate-500">{x.property.locality}, {x.property.city}</p>}</div><Badge v={x.stage} /></div>
              <ol className="grid gap-2 sm:grid-cols-4" data-testid="deal-steps">{x.steps.map((s) => <li key={s.key} className={`border-t-4 pt-2 text-xs ${s.done ? "border-emerald-600 text-slate-900" : s.current ? "border-slate-900 font-semibold text-slate-900" : "border-slate-200 text-slate-400"}`}>{STEP_TEXT[s.key]}</li>)}</ol>
              <div className="grid gap-4 sm:grid-cols-2 text-sm">
                <div>{x.agreed_value ? <p>Agreed value <b>{inr(x.agreed_value, true)}</b></p> : <p className="text-slate-500">Price under discussion</p>}{x.expected_close && <p className="text-slate-600">Expected by {fmtDate(x.expected_close)}</p>}</div>
                <ul className="space-y-1" data-testid="deal-checklist">{x.checklist.map((c) => <li key={c.item} className={`flex items-start gap-2 ${c.done ? "text-slate-900" : "text-slate-500"}`}><span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center border ${c.done ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300"}`}>{c.done && <Check size={11} />}</span>{c.item}</li>)}</ul>
              </div>
              {x.history.length > 0 && <details className="text-xs text-slate-500"><summary className="cursor-pointer">History</summary><ul className="mt-2 space-y-1">{x.history.slice().reverse().map((h, i) => <li key={i}>{fmtDateTime(h.at)} · {h.event}</li>)}</ul></details>}
              <div className="flex flex-wrap gap-2"><button className="btn-line btn-sm" onClick={() => setAsk({ category: "home_loan", property_id: x.property_id })}>Home-loan help</button><button className="btn-line btn-sm" onClick={() => setAsk({ category: "registration", property_id: x.property_id })}>Registration & legal help</button></div>
            </div>
          </div>
        </section>
      ))}
      {!d.deals.length && <p className="panel p-6 text-sm text-slate-600">No purchase in progress yet. Homes we pick for you and your site visits appear below.</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Site visits" testid="buyer-visits">
          {!d.visits.length ? <p className="text-sm text-slate-500">No visits yet.</p> : <ul className="divide-y divide-slate-100">{d.visits.map((v) => <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"><span><b>{v.property_title}</b><span className="block text-xs text-slate-500">{fmtDateTime(v.scheduled_at)}</span></span><Badge v={v.status} /></li>)}</ul>}
          {upcoming.length > 0 && <p className="mt-3 text-xs text-slate-500">Need to change a time? Raise a site-visit request and we will call you.</p>}
        </Section>
        <Agent a={d.agent} />
      </div>
      <Section title="Homes we picked for you" testid="buyer-shortlist">
        {!d.shortlist.length ? <p className="text-sm text-slate-500">Your relationship manager shares matching homes here.</p> :
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{d.shortlist.map((p) => (
            <div key={p.id} className="border border-slate-200 bg-white"><img src={imgSrc(p.images?.[0])} alt="" className="aspect-[16/9] w-full object-cover" />
              <div className="p-4"><p className="font-heading font-semibold">{p.title}</p><p className="text-xs text-slate-500">{p.locality}, {p.city}</p><p className="mt-2 text-sm font-medium">{priceLabel(p)}</p>
                <div className="mt-3 flex flex-wrap gap-2">{p.listing_id && <Link to={`/properties/${p.listing_id}`} className="btn-line btn-sm">Details</Link>}<button className="btn-dark btn-sm" onClick={() => setAsk({ category: "site_visit", property_id: p.id, title: `Visit ${p.title}` })} data-testid={`ask-visit-${p.code}`}>Ask for a visit</button></div></div></div>
          ))}</div>}
      </Section>
      {d.requirements.length > 0 && <Section title="What you are looking for"><DataTable rows={d.requirements} columns={[{ key: "interest", label: "Looking to", render: (r) => label(r.interest) }, { key: "budget_max", label: "Budget", render: (r) => r.budget_max ? `${r.budget_min ? `${inr(r.budget_min, true)} – ` : "up to "}${inr(r.budget_max, true)}` : "-" }, { key: "preferred_locations", label: "Areas" }, { key: "requirements", label: "Notes" }]} /></Section>}
      <NewRequest open={!!ask} onClose={() => setAsk(null)} preset={ask || {}} allowEntry={false} onDone={() => toast.success("Request sent. We will call you.")} />
    </div>
  );
}

export const BuyerRequests = () => <RequestsList base="/buyer/requests" allowEntry={false} intro="Site visits, home-loan help, registration and legal checks, documents or anything else about your purchase." />;
export const BuyerRequest = () => <RequestDetail base="/buyer/requests" />;

export function BuyerDocuments() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get("/buyer/documents").then((r) => setRows(r.data)).catch(() => setRows(false)); }, []);
  if (!rows) return <Loading d={rows} what="your documents" />;
  const open = async (doc) => { const r = await act(() => api.post(`/buyer/documents/${doc.id}/link`)); if (r) openFile(r.data.url.replace(/^\/api/, ""), { name: doc.original_name }); };
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold">Documents</h1>
      <DataTable testid="buyer-documents" rows={rows} empty="Documents for your purchase (agreement drafts, title papers, receipts) appear here when your relationship manager shares them." columns={[{ key: "original_name", label: "Document" }, { key: "doc_type", label: "Type", render: (x) => label(x.doc_type) }, { key: "created_at", label: "Added", render: (x) => fmtDate(x.created_at) }, { key: "x", label: "", render: (x) => <button className="btn-line btn-sm" onClick={() => open(x)}>Open</button> }]} />
    </div>
  );
}
