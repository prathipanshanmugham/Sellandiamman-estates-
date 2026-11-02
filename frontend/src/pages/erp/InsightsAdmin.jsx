import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Heading2, Heading3, Bold, Italic, List, ListOrdered, Quote, Link2, ImageIcon, CalendarClock } from "lucide-react";
import { api, errMsg, fmtDateTime, label, opts, imgSrc, shareUrl, nowIST } from "../../lib/api";
import ShareBar from "../../components/public/ShareBar";
import { useAuth } from "../../lib/auth";
import { useDialog } from "../../lib/dialogs";
import { Markdown } from "../../lib/markdown";
import { PageHeader, DataTable, Badge, FormDialog, Section, useList, act } from "../../components/erp/kit";
import { POST_CATEGORIES } from "../public/Insights";

export function InsightsList() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const { rows, loading } = useList("/posts");
  return (
    <div>
      <PageHeader title="Insights" sub="Market updates and guides shown on the website. Drafts stay private until published.">{can("cms", "w") && <button className="btn-dark btn-sm" onClick={() => setOpen(true)} data-testid="new-post-btn">New article</button>}</PageHeader>
      <DataTable testid="posts-table" loading={loading} rows={rows} onRow={(r) => nav(`/erp/insights/${r.id}`)} columns={[
        { key: "title", label: "Title", render: (r) => <>{r.title}{r.audience === "investors" && <span className="ml-2"><Badge v="investors only" tone="blue" /></span>}</> }, { key: "category", label: "Section", render: (r) => label(r.category) },
        { key: "status", label: "Status", render: (r) => <><Badge v={r.status} tone={r.status === "published" ? "green" : r.status === "scheduled" ? "blue" : "grey"} />{r.status === "scheduled" && r.publish_at && <span className="block text-xs text-slate-500">{fmtDateTime(r.publish_at)}</span>}</> },
        { key: "author_name", label: "Author" }, { key: "updated_at", label: "Updated", render: (r) => fmtDateTime(r.updated_at) },
      ]} empty="No articles yet." />
      <FormDialog open={open} onClose={() => setOpen(false)} title="New article" initial={{ category: "market_update", audience: "public", body: "## Heading\n\nStart writing here. Use ## for headings, - for lists and **bold** for emphasis." }}
        fields={[{ name: "title", label: "Title", required: true, full: true }, { name: "category", label: "Section", type: "select", required: true, options: opts(POST_CATEGORIES) }, { name: "audience", label: "Who can read it", type: "select", required: true, options: [{ value: "public", label: "Everyone (website)" }, { value: "investors", label: "Investors only (their dashboard)" }] }, { name: "excerpt", label: "Summary (shown in lists)", type: "textarea", full: true }, { name: "body", label: "Article (Markdown)", type: "textarea", required: true, full: true }]}
        onSubmit={async (v) => { const r = await api.post("/posts", v); nav(`/erp/insights/${r.data.id}`); }} />
    </div>
  );
}

export function InsightEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const dialog = useDialog();
  const { can } = useAuth();
  const [p, setP] = useState(null);
  const [v, setV] = useState(null);
  const [tab, setTab] = useState("write");
  const [busy, setBusy] = useState(false);
  const [when, setWhen] = useState("");
  const area = useRef(null);
  const load = () => api.get(`/posts/${id}`).then((r) => { setP(r.data); setV({ ...r.data, tags: (r.data.tags || []).join(", ") }); }).catch(() => setP(false));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (p === false) return <p>Article not found.</p>;
  if (!p || !v) return <p className="text-sm text-slate-500">Loading…</p>;
  const w = can("cms", "w");
  const dirty = ["title", "slug", "excerpt", "body", "category", "seo_title", "seo_description", "audience"].some((k) => (v[k] || "") !== (p[k] || "")) || v.tags !== (p.tags || []).join(", ");
  const save = async (extra = {}) => {
    setBusy(true);
    try {
      const body = { title: v.title, slug: v.slug, excerpt: v.excerpt, body: v.body, category: v.category, audience: v.audience || "public", seo_title: v.seo_title, seo_description: v.seo_description, tags: v.tags.split(",").map((t) => t.trim()).filter(Boolean), ...extra };
      const { data } = await api.patch(`/posts/${id}`, body);
      setP(data); setV({ ...data, tags: (data.tags || []).join(", ") });
      toast.success(extra.status === "published" ? (data.audience === "investors" ? "Published to investors' dashboards" : "Published on the website") : extra.status === "scheduled" ? `Scheduled for ${fmtDateTime(data.publish_at)}` : extra.status === "draft" ? "Moved back to draft" : "Saved");
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const cover = async (e) => { const file = e.target.files[0]; if (!file) return; const fd = new FormData(); fd.append("file", file); const r = await act(() => api.post(`/posts/${id}/cover`, fd), "Cover photo updated"); if (r) load(); e.target.value = ""; };
  const remove = async () => { if (await dialog.confirm({ title: "Delete this article?", body: "It will be removed from the website and the list.", okLabel: "Delete", tone: "danger" })) { await act(() => api.delete(`/posts/${id}`), "Article deleted"); nav("/erp/insights"); } };
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  // Toolbar: wraps the selection or starts a line with Markdown, keeping the cursor where the writer expects it
  const wrap = (before, after = "", line = false) => {
    const el = area.current; if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const sel = value.slice(a, b);
    let next, cursor;
    if (line) { const ls = value.lastIndexOf("\n", a - 1) + 1; next = value.slice(0, ls) + before + value.slice(ls); cursor = b + before.length; }
    else { next = value.slice(0, a) + before + (sel || "text") + after + value.slice(b); cursor = a + before.length + (sel || "text").length; }
    setV({ ...v, body: next });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(cursor, cursor); });
  };
  const insertImage = async (e) => {
    const file = e.target.files[0]; e.target.value = ""; if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    const r = await act(() => api.post(`/posts/${id}/image`, fd), "Photo added to the article");
    if (!r) return;
    const el = area.current; const pos = el ? el.selectionStart : v.body.length;
    setV({ ...v, body: `${v.body.slice(0, pos)}\n\n${r.data.markdown}\n\n${v.body.slice(pos)}` });
  };
  const link = async () => { const url = await dialog.ask({ title: "Add a link", label: "Web address or page (e.g. /properties-in/erode)", placeholder: "https://… or /contact" }); if (url) wrap("[", `](${url})`); };
  const TB = [[Heading2, "Heading", () => wrap("## ", "", true)], [Heading3, "Small heading", () => wrap("### ", "", true)], [Bold, "Bold", () => wrap("**", "**")], [Italic, "Italic", () => wrap("_", "_")], [List, "Bullet list", () => wrap("- ", "", true)], [ListOrdered, "Numbered list", () => wrap("1. ", "", true)], [Quote, "Quote", () => wrap("> ", "", true)], [Link2, "Link", link]];
  const editor = <div>{w && <div className="mb-1 flex flex-wrap items-center gap-0.5 border border-b-0 border-slate-300 bg-slate-50 p-1" role="toolbar" aria-label="Formatting">{TB.map(([I, l, fn]) => <button key={l} type="button" className="p-1.5 text-slate-600 hover:bg-white hover:text-slate-900" onClick={fn} title={l} aria-label={l}><I size={15} /></button>)}<label className="cursor-pointer p-1.5 text-slate-600 hover:bg-white hover:text-slate-900" title="Insert a photo" aria-label="Insert a photo"><ImageIcon size={15} /><input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={insertImage} data-testid="post-image-input" /></label></div>}<textarea ref={area} className="inp min-h-[420px] font-mono text-[13px] leading-6" value={v.body} onChange={set("body")} disabled={!w} aria-label="Article text" data-testid="post-body-input" /></div>;
  const schedule = () => (when ? save({ status: "scheduled", publish_at: `${when}:00+05:30` }) : toast.error("Choose a date and time"));
  return (
    <div className="space-y-6" data-testid="post-editor">
      <PageHeader title={p.title} sub={<span><Link to="/erp/insights" className="hover:underline">Insights</Link> · {p.status === "published" ? (p.audience === "investors" ? "Live on investors' dashboards" : <>Live at <a className="underline" href={`/insights/${p.slug}`} onClick={(e) => { e.preventDefault(); nav(`/insights/${p.slug}`); }}>/insights/{p.slug}</a></>) : p.status === "scheduled" ? `Scheduled for ${fmtDateTime(p.publish_at)}` : "Draft (not on the website)"}</span>}>
        <Badge v={p.status} tone={p.status === "published" ? "green" : p.status === "scheduled" ? "blue" : "grey"} testid="post-status" />
        {w && <button className="btn-line btn-sm" disabled={busy || !dirty} onClick={() => save()} data-testid="post-save-btn">{dirty ? "Save" : "Saved"}</button>}
        {can("cms", "p") && p.status !== "published" && <button className="btn-dark btn-sm" disabled={busy} onClick={() => save({ status: "published" })} data-testid="post-publish-btn">Publish</button>}
        {can("cms", "p") && ["published", "scheduled"].includes(p.status) && <button className="btn-line btn-sm" disabled={busy} onClick={() => save({ status: "draft" })} data-testid="post-unpublish-btn">{p.status === "scheduled" ? "Cancel schedule" : "Unpublish"}</button>}
        {w && <button className="btn-line btn-sm" onClick={remove} data-testid="post-delete-btn">Delete</button>}
      </PageHeader>
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Section title="Article">
          <div className="space-y-4">
            <div><label className="lbl" htmlFor="pt">Title</label><input id="pt" className="inp" value={v.title} onChange={set("title")} disabled={!w} data-testid="post-title-input" /></div>
            <div><label className="lbl" htmlFor="pe">Summary</label><textarea id="pe" rows={2} className="inp" value={v.excerpt || ""} onChange={set("excerpt")} disabled={!w} /></div>
            <div className="flex gap-2 xl:hidden" role="tablist">{[["write", "Write"], ["preview", "Preview"]].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`chip ${tab === k ? "chip-on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>
            <div className="grid gap-4 xl:grid-cols-2">
              <div className={tab === "write" ? "" : "hidden xl:block"}><p className="lbl hidden xl:block">Write</p>{editor}<p className="mt-1 text-xs text-slate-400">## Heading · ### Smaller heading · - list item · **bold** · [link text](/contact) · photos with the picture button</p></div>
              <div className={tab === "preview" ? "" : "hidden xl:block"}><p className="lbl hidden xl:block">Preview</p><div className="min-h-[420px] border border-slate-200 bg-white p-5"><Markdown text={v.body} /></div></div>
            </div>
          </div>
        </Section>
        <div className="space-y-6">
          {can("cms", "p") && p.status !== "published" && <Section title="Publish later">
            <label className="lbl" htmlFor="pw">Date and time (IST)</label>
            <input id="pw" type="datetime-local" className="inp" min={nowIST()} value={when} onChange={(e) => setWhen(e.target.value)} data-testid="post-schedule-input" />
            <button className="btn-line btn-sm mt-3" disabled={busy || !when} onClick={schedule} data-testid="post-schedule-btn"><CalendarClock size={13} />Schedule</button>
            <p className="mt-2 text-xs text-slate-400">It goes live by itself within 15 minutes of that time.</p>
          </Section>}
          {p.status === "published" && p.audience !== "investors" && <Section title="Share"><ShareBar url={shareUrl("i", p.slug)} text={p.title} social testid="post-share" /><p className="mt-2 text-xs text-slate-400">WhatsApp and social posts show the cover photo and summary.</p></Section>}
          <Section title="Cover photo">
            {p.cover_image ? <img src={imgSrc(p.cover_image)} alt="" className="aspect-[16/10] w-full object-cover" /> : <p className="text-sm text-slate-500">No cover photo.</p>}
            {w && <label className="btn-line btn-sm mt-3 cursor-pointer">Upload photo<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={cover} data-testid="post-cover-input" /></label>}
          </Section>
          <Section title="Details">
            <div className="space-y-3">
              <div><label className="lbl" htmlFor="pc">Section</label><select id="pc" className="inp" value={v.category} onChange={set("category")} disabled={!w}>{POST_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></div>
              <div><label className="lbl" htmlFor="pa">Who can read it</label><select id="pa" className="inp" value={v.audience || "public"} onChange={set("audience")} disabled={!w} data-testid="post-audience"><option value="public">Everyone (website)</option><option value="investors">Investors only (their dashboard)</option></select></div>
              <div><label className="lbl" htmlFor="ps">Web address</label><input id="ps" className="inp font-mono text-xs" value={v.slug} onChange={set("slug")} disabled={!w} /></div>
              <div><label className="lbl" htmlFor="ptg">Tags (comma separated)</label><input id="ptg" className="inp" value={v.tags} onChange={set("tags")} disabled={!w} /></div>
              <div><label className="lbl" htmlFor="pst">Search title (optional)</label><input id="pst" className="inp" value={v.seo_title || ""} onChange={set("seo_title")} disabled={!w} /></div>
              <div><label className="lbl" htmlFor="psd">Search description (optional)</label><textarea id="psd" rows={3} className="inp" value={v.seo_description || ""} onChange={set("seo_description")} disabled={!w} /></div>
              <p className="text-xs text-slate-400">{p.reading_minutes} min read · by {p.author_name} · updated {fmtDateTime(p.updated_at)}</p>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
