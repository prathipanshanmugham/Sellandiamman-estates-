import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, useMeta, fmtDate, imgSrc, label, shareUrl, SITE_URL } from "../../lib/api";
import { Markdown } from "../../lib/markdown";
import ShareBar from "../../components/public/ShareBar";

export const POST_CATEGORIES = ["market_update", "buying_guide", "owner_guide", "area_guide", "legal_tax", "company_news"];

function PostCard({ p, big }) {
  return (
    <Link to={`/insights/${p.slug}`} className={`group block ${big ? "md:col-span-2 md:grid md:grid-cols-2 md:gap-8" : ""}`} data-testid={`post-card-${p.slug}`}>
      <div className="aspect-[16/10] overflow-hidden bg-slate-100">{p.cover_image ? <img src={imgSrc(p.cover_image)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" /> : null}</div>
      <div className={big ? "md:self-center" : ""}>
        <p className="mt-4 text-xs text-slate-500">{label(p.category)} · {fmtDate(p.published_at)} · {p.reading_minutes} min read</p>
        <h2 className={`mt-1 font-heading font-semibold group-hover:underline ${big ? "text-2xl sm:text-3xl" : "text-lg"}`}>{p.title}</h2>
        <p className="mt-2 line-clamp-3 text-sm text-slate-600">{p.excerpt}</p>
      </div>
    </Link>
  );
}

export function Insights() {
  useMeta({ title: "Insights & guides", description: "Market updates, buying and owner guides, and area notes for Erode and Perundurai property.", path: "/insights" });
  const [sp, setSp] = useSearchParams();
  const cat = sp.get("category") || "";
  const [d, setD] = useState(null);
  useEffect(() => { api.get("/public/posts", { params: { category: cat || undefined, limit: 30 } }).then((r) => setD(r.data)).catch(() => setD({ items: [] })); }, [cat]);
  return (
    <div className="container-x py-10 sm:py-14">
      <p className="eyebrow">Insights</p>
      <h1 className="mt-2 font-heading text-4xl font-semibold">Guides and market notes</h1>
      <p className="mt-4 max-w-2xl text-slate-600">What we see in Erode and Perundurai: prices, rentals, documents to check and how owners can get more from their property.</p>
      <div className="-mx-4 mt-8 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        <button className={`chip shrink-0 ${!cat ? "chip-on" : ""}`} onClick={() => setSp({})}>All</button>
        {POST_CATEGORIES.map((c) => <button key={c} className={`chip shrink-0 ${cat === c ? "chip-on" : ""}`} onClick={() => setSp({ category: c })} data-testid={`post-cat-${c}`}>{label(c)}</button>)}
      </div>
      {!d && <p className="mt-10 text-sm text-slate-500">Loading…</p>}
      {d && !d.items.length && <p className="mt-10 text-sm text-slate-500">No articles in this section yet.</p>}
      {d && d.items.length > 0 && <div className="mt-10 grid gap-x-8 gap-y-12 md:grid-cols-2 lg:grid-cols-3">{d.items.map((p, i) => <PostCard key={p.slug} p={p} big={i === 0 && !cat} />)}</div>}
    </div>
  );
}

export function Article() {
  const { slug } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => { setD(null); setErr(false); api.get(`/public/posts/${slug}`).then((r) => setD(r.data)).catch(() => setErr(true)); }, [slug]);
  const p = d?.post;
  useMeta({ title: p?.seo_title || p?.title || "Article", description: p?.seo_description || p?.excerpt, image: p?.cover_image, path: `/insights/${slug}`,
    jsonLd: p && { "@context": "https://schema.org", "@type": "Article", headline: p.title, datePublished: p.published_at, dateModified: p.updated_at, author: { "@type": "Organization", name: "Sellandiamman Estates" }, publisher: { "@type": "Organization", name: "Sellandiamman Estates", logo: { "@type": "ImageObject", url: `${SITE_URL}/icon-512.png` } }, image: p.cover_image ? (p.cover_image.startsWith("http") ? p.cover_image : `${SITE_URL}${p.cover_image}`) : undefined } });
  if (err) return <div className="container-x py-24"><h1 className="font-heading text-2xl">Article not found</h1><Link to="/insights" className="btn-dark mt-6">All articles</Link></div>;
  if (!p) return <div className="container-x py-24 text-sm text-slate-500">Loading…</div>;
  return (
    <article className="container-x py-10 sm:py-14" data-testid="article-page">
      <nav className="text-xs text-slate-500" aria-label="Breadcrumb"><Link to="/insights" className="hover:underline">Insights</Link> / <Link to={`/insights?category=${p.category}`} className="hover:underline">{label(p.category)}</Link></nav>
      <header className="mt-4 max-w-3xl">
        <h1 className="font-heading text-3xl font-semibold leading-tight sm:text-5xl">{p.title}</h1>
        {p.excerpt && <p className="mt-4 text-lg text-slate-600">{p.excerpt}</p>}
        <p className="mt-4 text-sm text-slate-500">{p.author_name ? `${p.author_name} · ` : ""}{fmtDate(p.published_at)} · {p.reading_minutes} min read</p>
      </header>
      {p.cover_image && <img src={imgSrc(p.cover_image)} alt="" className="mt-8 aspect-[21/9] w-full object-cover" />}
      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0"><Markdown text={p.body} />
          <div className="mt-10 border-t border-slate-200 pt-6"><p className="lbl">Share this article</p><ShareBar url={shareUrl("i", p.slug)} text={p.title} testid="article-share" /></div>
        </div>
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="border border-slate-200 p-5"><p className="font-heading font-semibold">Talk to us</p><p className="mt-1 text-sm text-slate-600">Questions about a property, documents or prices? We reply the same working day.</p><Link to="/contact" className="btn-dark mt-4 w-full">Contact the team</Link></div>
          <div className="border border-slate-200 p-5"><p className="font-heading font-semibold">Run the numbers</p><p className="mt-1 text-sm text-slate-600">EMI, stamp duty and area conversion.</p><Link to="/tools" className="btn-line mt-4 w-full">Open calculators</Link></div>
        </aside>
      </div>
      {d.related?.length > 0 && <section className="mt-16 border-t border-slate-200 pt-10"><h2 className="font-heading text-2xl font-semibold">More in {label(p.category)}</h2><div className="mt-6 grid gap-8 md:grid-cols-3">{d.related.map((r) => <PostCard key={r.slug} p={r} />)}</div></section>}
    </article>
  );
}
