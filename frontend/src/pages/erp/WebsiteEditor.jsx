import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUp, ArrowDown, Eye, EyeOff, Plus, Trash2, ImageIcon, Upload, ExternalLink, History } from "lucide-react";
import { api, errMsg, fmtDateTime, imgSrc, label, clearCache, IS_DEMO } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useDialog } from "../../lib/dialogs";
import { PageHeader, Section, Modal, Badge, act } from "../../components/erp/kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";

const BUILT_IN = ["villa", "estate", "interior", "apartment", "apartment2", "house", "contemporary", "commercial", "shed", "warehouse", "land", "land2"].map((n) => `/images/${n}.jpg`);
const SECTION_INFO = {
  featured: ["Featured properties", "Listings marked 'Feature on homepage'"], category_tabs: ["Browse by type", "Tabs: homes, land, commercial, rentals, short stays"],
  locations: ["Properties by town", "Every town with its number of listings"], recent: ["Recently added", "The newest six listings"],
  services: ["Services", "The services list (edit on the Services tab)"], stats: ["Numbers", "Up to six figures, e.g. 5 branches"],
  why: ["Why us", "Points from the Why us tab, with a photo"], insights: ["Insights", "The latest three articles"],
  testimonials: ["Customer reviews", "From the Reviews tab"], text: ["Text block", "Your own heading and text"],
  cta: ["Buyers / tenants / owners", "Three call-to-action boxes"], branches: ["Branches", "Each branch with call, WhatsApp and directions"],
};

function ImagePicker({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [media, setMedia] = useState([]);
  useEffect(() => { if (open) api.get("/cms/media").then((r) => setMedia(r.data)).catch(() => {}); }, [open]);
  const upload = async (e) => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; const fd = new FormData(); fd.append("file", f); const r = await act(() => api.post("/cms/media", fd), "Photo uploaded"); if (r) { onChange(r.data.url); setOpen(false); } };
  return (
    <div className="flex items-center gap-3">
      <div className="h-16 w-24 shrink-0 overflow-hidden border border-slate-200 bg-slate-100">{value ? <img src={imgSrc(value)} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="m-auto mt-5 text-slate-300" size={20} />}</div>
      {!disabled && <div className="flex flex-wrap gap-1"><button type="button" className="btn-line btn-sm" onClick={() => setOpen(true)}>Change photo</button>{value && <button type="button" className="btn-line btn-sm" onClick={() => onChange("")}>Remove</button>}</div>}
      <Modal open={open} onClose={() => setOpen(false)} title="Choose a photo" wide>
        <label className="btn-dark btn-sm mb-4 cursor-pointer"><Upload size={13} />Upload a photo (JPG, PNG or WebP, up to 5 MB)<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={upload} /></label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{[...media.map((m) => m.url), ...BUILT_IN].map((u) => <button key={u} type="button" onClick={() => { onChange(u); setOpen(false); }} className={`aspect-[4/3] overflow-hidden border-2 ${u === value ? "border-slate-900" : "border-transparent hover:border-slate-400"}`}><img src={imgSrc(u)} alt="" className="h-full w-full object-cover" loading="lazy" /></button>)}</div>
        <p className="mt-3 text-xs text-slate-500">Use photos you own or have permission to use. Wide photos (at least 1600 px across) look best at the top of the home page.</p>
      </Modal>
    </div>
  );
}

const Txt = ({ label: l, value, onChange, disabled, area, max, hint, testid }) => (
  <div><label className="lbl">{l}{max ? <span className="float-right font-normal normal-case tracking-normal text-slate-400">{(value || "").length}/{max}</span> : null}</label>
    {area ? <textarea rows={area} className="inp" value={value || ""} maxLength={max} disabled={disabled} onChange={(e) => onChange(e.target.value)} data-testid={testid} /> : <input className="inp" value={value || ""} maxLength={max} disabled={disabled} onChange={(e) => onChange(e.target.value)} data-testid={testid} />}
    {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}</div>
);

function ListEditor({ items, onChange, disabled, render, blank, addLabel, max = 30 }) {
  const move = (i, d) => { const n = [...items]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); onChange(n); };
  return (
    <div className="space-y-3">
      {items.map((it, i) => <div key={i} className="flex gap-2 border border-slate-200 bg-white p-3"><div className="min-w-0 flex-1 space-y-3">{render(it, (patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x))))}</div>
        {!disabled && <div className="flex flex-col gap-1"><button type="button" className="p-1 text-slate-400 hover:text-slate-900 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={14} /></button><button type="button" className="p-1 text-slate-400 hover:text-slate-900 disabled:opacity-30" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={14} /></button><button type="button" className="p-1 text-slate-400 hover:text-red-700" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={14} /></button></div>}
      </div>)}
      {!disabled && items.length < max && <button type="button" className="btn-line btn-sm" onClick={() => onChange([...items, blank()])}><Plus size={13} />{addLabel}</button>}
    </div>
  );
}

export default function WebsiteEditor() {
  const { can } = useAuth();
  const dialog = useDialog();
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [c, setC] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const w = can("cms", "w");
  const load = () => api.get("/cms/site").then((r) => { setD(r.data); setC(r.data.draft); setDirty(false); }).catch(() => setD(false));
  useEffect(() => { load(); }, []);
  useEffect(() => { const on = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", on); return () => window.removeEventListener("beforeunload", on); }, [dirty]);
  if (d === false) return <p>Could not load the website content.</p>;
  if (!d || !c) return <p className="text-sm text-slate-500">Loading…</p>;
  const set = (patch) => { setC((s) => ({ ...s, ...patch })); setDirty(true); };
  const saveDraft = async (quiet) => { setBusy(true); try { const r = await api.put("/cms/site/draft", c); setC(r.data.draft); setDirty(false); if (!quiet) act(async () => true, "Draft saved"); await load(); return true; } catch (e) { dialog.notice({ title: "Could not save", body: errMsg(e) }); return false; } finally { setBusy(false); } };
  const preview = async () => { if (dirty && !(await saveDraft(true))) return; if (IS_DEMO) nav("/?preview=draft"); else window.open("/?preview=draft", "_blank", "noopener"); };
  const publish = async () => {
    if (!(await dialog.confirm({ title: "Publish these changes?", body: "Visitors and search engines see the new version straight away. The current version is kept in History.", okLabel: "Publish" }))) return;
    if (dirty && !(await saveDraft(true))) return;
    if (await act(() => api.post("/cms/site/publish"), "Published on the website")) { clearCache("/public/"); load(); }
  };
  const discard = async () => { if (await dialog.confirm({ title: "Throw away unpublished changes?", body: "The draft goes back to what the website shows now.", okLabel: "Discard", tone: "danger" }) && await act(() => api.post("/cms/site/discard"), "Draft discarded")) load(); };
  const changed = d.dirty || dirty;
  const sec = (i, patch) => set({ sections: c.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const moveSec = (i, dir) => { const n = [...c.sections]; const [x] = n.splice(i, 1); n.splice(i + dir, 0, x); set({ sections: n }); };
  const missingTypes = Object.keys(SECTION_INFO).filter((t) => t === "text" || !c.sections.some((s) => s.type === t));
  return (
    <div className="space-y-6" data-testid="website-editor">
      <PageHeader title="Website editor" sub={<>Change the home page, services, FAQ, About page, reviews and search-engine text. Changes stay in a draft until you publish. {d.published_at && <>Last published {fmtDateTime(d.published_at)} by {d.published_by}.</>}</>}>
        {changed ? <Badge v="unpublished changes" tone="amber" testid="cms-status" /> : <Badge v="published" tone="green" testid="cms-status" />}
        <button className="btn-line btn-sm" onClick={preview} data-testid="cms-preview-btn"><ExternalLink size={13} />Preview</button>
        {w && <button className="btn-line btn-sm" disabled={!dirty || busy} onClick={() => saveDraft(false)} data-testid="cms-save-btn">{dirty ? "Save draft" : "Draft saved"}</button>}
        {w && changed && <button className="btn-line btn-sm" onClick={discard}>Discard</button>}
        {can("cms", "p") && <button className="btn-dark btn-sm" disabled={!changed || busy} onClick={publish} data-testid="cms-publish-btn">Publish</button>}
      </PageHeader>
      <Tabs defaultValue="home">
        <TabsList className="flex h-auto flex-wrap justify-start rounded-sm"><TabsTrigger value="home">Home page</TabsTrigger><TabsTrigger value="services">Services</TabsTrigger><TabsTrigger value="why">Why us</TabsTrigger><TabsTrigger value="faq">FAQ</TabsTrigger><TabsTrigger value="about">About & contact</TabsTrigger><TabsTrigger value="reviews">Reviews</TabsTrigger><TabsTrigger value="seo">Search & AI</TabsTrigger><TabsTrigger value="history"><History size={13} className="mr-1" />History</TabsTrigger></TabsList>

        <TabsContent value="home" className="mt-4 space-y-6">
          <Section title="Top of the page">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <Txt label="Small line above the headline" value={c.hero.eyebrow} max={120} disabled={!w} onChange={(x) => set({ hero: { ...c.hero, eyebrow: x } })} />
                <Txt label="Headline" value={c.hero.title} max={140} disabled={!w} onChange={(x) => set({ hero: { ...c.hero, title: x } })} testid="cms-hero-title" />
                <Txt label="Sub-heading" value={c.hero.subtitle} max={300} area={2} disabled={!w} onChange={(x) => set({ hero: { ...c.hero, subtitle: x } })} />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.hero.show_search !== false} disabled={!w} onChange={(e) => set({ hero: { ...c.hero, show_search: e.target.checked } })} />Show the property search box</label>
                <Txt label="Announcement bar (blank to hide)" value={c.announcement} max={200} disabled={!w} onChange={(x) => set({ announcement: x })} hint="A thin strip at the top of every page, e.g. office closed for Pongal" />
              </div>
              <div><label className="lbl">Background photo</label><ImagePicker value={c.hero.image} disabled={!w} onChange={(x) => set({ hero: { ...c.hero, image: x } })} />
                <div className="relative mt-4 overflow-hidden" aria-hidden="true"><img src={imgSrc(c.hero.image || "/images/villa.jpg")} alt="" className="aspect-[16/7] w-full object-cover" /><div className="absolute inset-0 bg-gradient-to-r from-slate-950/80 to-slate-900/30" /><div className="absolute inset-0 p-4"><p className="text-[9px] uppercase tracking-widest text-slate-300">{c.hero.eyebrow}</p><p className="mt-1 max-w-[80%] font-heading text-lg font-semibold leading-tight text-white">{c.hero.title}</p><p className="mt-1 max-w-[70%] text-[10px] text-slate-200">{c.hero.subtitle}</p></div></div>
              </div>
            </div>
          </Section>
          <Section title="Sections, top to bottom" testid="cms-sections">
            <ol className="space-y-2">{c.sections.map((s, i) => (
              <li key={s.id} className={`border p-3 ${s.visible ? "border-slate-200 bg-white" : "border-dashed border-slate-300 bg-slate-50"}`} data-testid={`cms-section-${s.type}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-6 text-xs font-semibold text-slate-400">{i + 1}</span>
                  <span className="min-w-0 flex-1"><span className="font-medium">{SECTION_INFO[s.type]?.[0] || label(s.type)}</span><span className="block text-xs text-slate-500">{SECTION_INFO[s.type]?.[1]}</span></span>
                  {w && <><button type="button" className="p-1.5 text-slate-500 hover:text-slate-900 disabled:opacity-30" disabled={i === 0} onClick={() => moveSec(i, -1)} aria-label="Move up"><ArrowUp size={15} /></button><button type="button" className="p-1.5 text-slate-500 hover:text-slate-900 disabled:opacity-30" disabled={i === c.sections.length - 1} onClick={() => moveSec(i, 1)} aria-label="Move down"><ArrowDown size={15} /></button><button type="button" className="btn-line btn-sm" onClick={() => sec(i, { visible: !s.visible })} data-testid={`cms-toggle-${s.type}`}>{s.visible ? <><Eye size={13} />Shown</> : <><EyeOff size={13} />Hidden</>}</button>{s.type === "text" && <button type="button" className="p-1.5 text-slate-400 hover:text-red-700" onClick={() => set({ sections: c.sections.filter((_, j) => j !== i) })} aria-label="Remove section"><Trash2 size={15} /></button>}</>}
                </div>
                {s.visible && !["cta"].includes(s.type) && <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {!["category_tabs", "testimonials", "stats"].includes(s.type) && <Txt label="Small line above" value={s.eyebrow} max={60} disabled={!w} onChange={(x) => sec(i, { eyebrow: x })} />}
                  <Txt label="Heading" value={s.title} max={160} disabled={!w} onChange={(x) => sec(i, { title: x })} />
                  {["locations", "featured", "recent", "insights", "branches"].includes(s.type) && <Txt label="Short description" value={s.subtitle} max={300} disabled={!w} onChange={(x) => sec(i, { subtitle: x })} />}
                  {s.type === "why" && <div><label className="lbl">Photo</label><ImagePicker value={s.image} disabled={!w} onChange={(x) => sec(i, { image: x })} /></div>}
                  {s.type === "text" && <div className="sm:col-span-3"><Txt label="Text (## heading, - list, **bold**, [link](/contact))" value={s.body} area={6} max={6000} disabled={!w} onChange={(x) => sec(i, { body: x })} /></div>}
                  {s.type === "stats" && <div className="sm:col-span-3"><ListEditor items={s.items || []} disabled={!w} max={6} addLabel="Add a number" blank={() => ({ value: "", label: "" })} onChange={(items) => sec(i, { items })} render={(it, up) => <div className="grid grid-cols-[6rem_1fr] gap-2"><input className="inp" placeholder="5" value={it.value} maxLength={12} disabled={!w} onChange={(e) => up({ value: e.target.value })} aria-label="Figure" /><input className="inp" placeholder="Branches" value={it.label} maxLength={40} disabled={!w} onChange={(e) => up({ label: e.target.value })} aria-label="Label" /></div>} /></div>}
                </div>}
              </li>
            ))}</ol>
            {w && missingTypes.length > 0 && <div className="mt-3 flex items-center gap-2"><Plus size={14} className="text-slate-400" /><select className="inp !w-auto" defaultValue="" onChange={(e) => { const t = e.target.value; e.target.value = ""; if (t) set({ sections: [...c.sections, { id: `${t}-${Date.now().toString(36)}`, type: t, visible: true, title: t === "text" ? "" : SECTION_INFO[t][0], eyebrow: "", subtitle: "", body: "", items: [] }] }); }} aria-label="Add a section" data-testid="cms-add-section"><option value="">Add a section…</option>{missingTypes.map((t) => <option key={t} value={t}>{SECTION_INFO[t][0]}</option>)}</select></div>}
          </Section>
        </TabsContent>

        <TabsContent value="services" className="mt-4"><Section title="Services (also on the Services page and in the footer)"><ListEditor items={c.services} disabled={!w} max={16} addLabel="Add a service" blank={() => ({ slug: "", title: "", summary: "", points: [] })} onChange={(services) => set({ services })} render={(s, up) => <>
          <div className="grid gap-3 sm:grid-cols-2"><Txt label="Name" value={s.title} max={80} disabled={!w} onChange={(x) => up({ title: x, slug: s.slug || x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") })} /><Txt label="Web address" value={s.slug} max={60} disabled={!w} onChange={(x) => up({ slug: x.toLowerCase().replace(/[^a-z0-9-]/g, "") })} hint={`/services/${s.slug || "…"}`} /></div>
          <Txt label="Summary" value={s.summary} max={300} area={2} disabled={!w} onChange={(x) => up({ summary: x })} />
          <Txt label="What's included (one per line)" value={(s.points || []).join("\n")} area={4} disabled={!w} onChange={(x) => up({ points: x.split("\n") })} />
        </>} /></Section></TabsContent>

        <TabsContent value="why" className="mt-4"><Section title="Why choose us (home page)"><ListEditor items={c.why} disabled={!w} max={8} addLabel="Add a point" blank={() => ({ title: "", body: "" })} onChange={(why) => set({ why })} render={(x, up) => <div className="grid gap-3 sm:grid-cols-[1fr_2fr]"><Txt label="Point" value={x.title} max={80} disabled={!w} onChange={(v) => up({ title: v })} /><Txt label="Explanation" value={x.body} max={300} area={2} disabled={!w} onChange={(v) => up({ body: v })} /></div>} /></Section></TabsContent>

        <TabsContent value="faq" className="mt-4"><Section title="Frequently asked questions"><p className="mb-3 text-xs text-slate-500">Clear questions and direct answers help search engines and AI assistants (ChatGPT, Gemini, Perplexity, Claude) quote you correctly.</p><ListEditor items={c.faq} disabled={!w} max={30} addLabel="Add a question" blank={() => ({ q: "", a: "" })} onChange={(faq) => set({ faq })} render={(x, up) => <><Txt label="Question" value={x.q} max={200} disabled={!w} onChange={(v) => up({ q: v })} /><Txt label="Answer" value={x.a} max={1200} area={3} disabled={!w} onChange={(v) => up({ a: v })} /></>} /></Section></TabsContent>

        <TabsContent value="about" className="mt-4 space-y-6">
          <Section title="About page"><div className="grid gap-4 lg:grid-cols-[2fr_1fr]"><div className="space-y-4"><Txt label="Heading" value={c.about.title} max={120} disabled={!w} onChange={(x) => set({ about: { ...c.about, title: x } })} /><Txt label="Text (blank line between paragraphs)" value={c.about.body} area={10} max={6000} disabled={!w} onChange={(x) => set({ about: { ...c.about, body: x } })} /></div><div><label className="lbl">Photo</label><ImagePicker value={c.about.image} disabled={!w} onChange={(x) => set({ about: { ...c.about, image: x } })} /></div></div></Section>
          <Section title="Footer & contact page"><div className="grid gap-4 sm:grid-cols-2"><Txt label="Footer line about the company" value={c.footer_tagline} max={300} area={2} disabled={!w} onChange={(x) => set({ footer_tagline: x })} /><Txt label="Contact page introduction" value={c.contact_intro} max={300} area={2} disabled={!w} onChange={(x) => set({ contact_intro: x })} /></div><p className="mt-3 text-xs text-slate-500">Branch addresses, phones and map points are edited under Branches & places.</p></Section>
        </TabsContent>

        <TabsContent value="reviews" className="mt-4"><Section title="Customer reviews"><p className="mb-3 text-xs text-slate-500">Only real reviews, with the customer's permission.</p><ListEditor items={c.testimonials} disabled={!w} max={9} addLabel="Add a review" blank={() => ({ quote: "", name: "" })} onChange={(testimonials) => set({ testimonials })} render={(x, up) => <div className="grid gap-3 sm:grid-cols-[2fr_1fr]"><Txt label="What they said" value={x.quote} max={400} area={2} disabled={!w} onChange={(v) => up({ quote: v })} /><Txt label="Name, area" value={x.name} max={80} disabled={!w} onChange={(v) => up({ name: v })} /></div>} /></Section></TabsContent>

        <TabsContent value="seo" className="mt-4 space-y-6">
          <Section title="Home page in search results">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-4"><Txt label="Title" value={c.seo.title} max={70} disabled={!w} onChange={(x) => set({ seo: { ...c.seo, title: x } })} hint="Blank = 'Property services in' and your branch towns" /><Txt label="Description" value={c.seo.description} max={170} area={3} disabled={!w} onChange={(x) => set({ seo: { ...c.seo, description: x } })} /></div>
              <div className="border border-slate-200 bg-white p-4" aria-label="How it may look on Google"><p className="text-xs text-slate-500">How it may look on Google</p><p className="mt-2 truncate text-lg text-[#1a0dab]">{c.seo.title || "Property services in Perundurai, Erode, Kadambur…"} | Sellandiamman Estates</p><p className="text-xs text-[#006621]">{window.location.host || "your-site"} ›</p><p className="line-clamp-2 text-sm text-slate-600">{c.seo.description || "Verified homes, plots, shops, offices, warehouses and factory sheds for sale, rent and lease…"}</p></div>
            </div>
          </Section>
          <Section title="Done for you automatically">
            <ul className="grid gap-2 text-sm text-slate-700 md:grid-cols-2">
              {["Every page is sent with its text, title, description and structured data (schema.org) already in the HTML, so Google, Bing and AI assistants read it without running the app", "Listing pages carry RealEstateListing data: price, area, rooms, photos and approximate location", "A page per town and locality (e.g. /properties-in/namakkal) with listings, prices and local FAQs", "Organisation and branch details (addresses, phones, map points) for local search", "sitemap.xml with every listing, article, town page and photo", "robots.txt welcomes Google, Bing and AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended…) and keeps staff, owner and investor areas private", "llms.txt and llms-full.txt: a plain summary of the company, branches, services and current listings for AI assistants", "Insights articles carry author, dates and keywords"].map((t) => <li key={t} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-slate-900" />{t}</li>)}
            </ul>
            <p className="mt-4 text-xs text-slate-500">To get found: verify the site in Google Search Console and Bing Webmaster Tools and submit /sitemap.xml; create a Google Business Profile for each branch and paste its link under Branches & places; keep FAQ answers and town introductions specific and current.</p>
          </Section>
        </TabsContent>

        <TabsContent value="history" className="mt-4"><Section title="Published versions (last 15)">{d.history.length ? <ul className="divide-y divide-slate-100">{d.history.map((h) => <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"><span>{fmtDateTime(h.published_at)} · {h.by}</span>{w && <button className="btn-line btn-sm" onClick={async () => { if (dirty && !(await dialog.confirm({ title: "Lose unsaved changes?", okLabel: "Continue" }))) return; if (await act(() => api.post(`/cms/site/restore/${h.id}`), "Loaded into the draft. Check it, then publish.")) load(); }}>Load into draft</button>}</li>)}</ul> : <p className="text-sm text-slate-400">Nothing published from the editor yet.</p>}</Section></TabsContent>
      </Tabs>
    </div>
  );
}
