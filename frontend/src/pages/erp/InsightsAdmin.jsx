import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api, errMsg, fmtDateTime, label, opts, imgSrc } from "../../lib/api";
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
        { key: "title", label: "Title" }, { key: "category", label: "Section", render: (r) => label(r.category) },
        { key: "status", label: "Status", render: (r) => <Badge v={r.status} tone={r.status === "published" ? "green" : "grey"} /> },
        { key: "author_name", label: "Author" }, { key: "updated_at", label: "Updated", render: (r) => fmtDateTime(r.updated_at) },
      ]} empty="No articles yet." />
      <FormDialog open={open} onClose={() => setOpen(false)} title="New article" initial={{ category: "market_update", body: "## Heading\n\nStart writing here. Use ## for headings, - for lists and **bold** for emphasis." }}
        fields={[{ name: "title", label: "Title", required: true, full: true }, { name: "category", label: "Section", type: "select", required: true, options: opts(POST_CATEGORIES) }, { name: "excerpt", label: "Summary (shown in lists)", type: "textarea", full: true }, { name: "body", label: "Article (Markdown)", type: "textarea", required: true, full: true }]}
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
  const load = () => api.get(`/posts/${id}`).then((r) => { setP(r.data); setV({ ...r.data, tags: (r.data.tags || []).join(", ") }); }).catch(() => setP(false));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (p === false) return <p>Article not found.</p>;
  if (!p || !v) return <p className="text-sm text-slate-500">Loading…</p>;
  const w = can("cms", "w");
  const dirty = ["title", "slug", "excerpt", "body", "category", "seo_title", "seo_description"].some((k) => (v[k] || "") !== (p[k] || "")) || v.tags !== (p.tags || []).join(", ");
  const save = async (extra = {}) => {
    setBusy(true);
    try {
      const body = { title: v.title, slug: v.slug, excerpt: v.excerpt, body: v.body, category: v.category, seo_title: v.seo_title, seo_description: v.seo_description, tags: v.tags.split(",").map((t) => t.trim()).filter(Boolean), ...extra };
      const { data } = await api.patch(`/posts/${id}`, body);
      setP(data); setV({ ...data, tags: (data.tags || []).join(", ") });
      toast.success(extra.status === "published" ? "Published on the website" : extra.status === "draft" ? "Moved back to draft" : "Saved");
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const cover = async (e) => { const file = e.target.files[0]; if (!file) return; const fd = new FormData(); fd.append("file", file); const r = await act(() => api.post(`/posts/${id}/cover`, fd), "Cover photo updated"); if (r) load(); e.target.value = ""; };
  const remove = async () => { if (await dialog.confirm({ title: "Delete this article?", body: "It will be removed from the website and the list.", okLabel: "Delete", tone: "danger" })) { await act(() => api.delete(`/posts/${id}`), "Article deleted"); nav("/erp/insights"); } };
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const editor = <textarea className="inp min-h-[420px] font-mono text-[13px] leading-6" value={v.body} onChange={set("body")} disabled={!w} aria-label="Article text" data-testid="post-body-input" />;
  return (
    <div className="space-y-6" data-testid="post-editor">
      <PageHeader title={p.title} sub={<span><Link to="/erp/insights" className="hover:underline">Insights</Link> · {p.status === "published" ? <>Live at <a className="underline" href={`/insights/${p.slug}`} onClick={(e) => { e.preventDefault(); nav(`/insights/${p.slug}`); }}>/insights/{p.slug}</a></> : "Draft (not on the website)"}</span>}>
        <Badge v={p.status} tone={p.status === "published" ? "green" : "grey"} testid="post-status" />
        {w && <button className="btn-line btn-sm" disabled={busy || !dirty} onClick={() => save()} data-testid="post-save-btn">{dirty ? "Save" : "Saved"}</button>}
        {can("cms", "p") && p.status !== "published" && <button className="btn-dark btn-sm" disabled={busy} onClick={() => save({ status: "published" })} data-testid="post-publish-btn">Publish</button>}
        {can("cms", "p") && p.status === "published" && <button className="btn-line btn-sm" disabled={busy} onClick={() => save({ status: "draft" })} data-testid="post-unpublish-btn">Unpublish</button>}
        {w && <button className="btn-line btn-sm" onClick={remove} data-testid="post-delete-btn">Delete</button>}
      </PageHeader>
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Section title="Article">
          <div className="space-y-4">
            <div><label className="lbl" htmlFor="pt">Title</label><input id="pt" className="inp" value={v.title} onChange={set("title")} disabled={!w} data-testid="post-title-input" /></div>
            <div><label className="lbl" htmlFor="pe">Summary</label><textarea id="pe" rows={2} className="inp" value={v.excerpt || ""} onChange={set("excerpt")} disabled={!w} /></div>
            <div className="flex gap-2 xl:hidden" role="tablist">{[["write", "Write"], ["preview", "Preview"]].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`chip ${tab === k ? "chip-on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>
            <div className="grid gap-4 xl:grid-cols-2">
              <div className={tab === "write" ? "" : "hidden xl:block"}><p className="lbl hidden xl:block">Write</p>{editor}<p className="mt-1 text-xs text-slate-400">## Heading · ### Smaller heading · - list item · **bold** · [link text](/tools)</p></div>
              <div className={tab === "preview" ? "" : "hidden xl:block"}><p className="lbl hidden xl:block">Preview</p><div className="min-h-[420px] border border-slate-200 bg-white p-5"><Markdown text={v.body} /></div></div>
            </div>
          </div>
        </Section>
        <div className="space-y-6">
          <Section title="Cover photo">
            {p.cover_image ? <img src={imgSrc(p.cover_image)} alt="" className="aspect-[16/10] w-full object-cover" /> : <p className="text-sm text-slate-500">No cover photo.</p>}
            {w && <label className="btn-line btn-sm mt-3 cursor-pointer">Upload photo<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={cover} data-testid="post-cover-input" /></label>}
          </Section>
          <Section title="Details">
            <div className="space-y-3">
              <div><label className="lbl" htmlFor="pc">Section</label><select id="pc" className="inp" value={v.category} onChange={set("category")} disabled={!w}>{POST_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></div>
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
