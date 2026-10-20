import { Link } from "react-router-dom";
import { imgSrc } from "./api";

// Small, safe Markdown renderer for Insights articles: ## / ### headings, paragraphs, - and 1. lists,
// > quotes, **bold**, _italic_, [links](url) and ![photos](url). No raw HTML is ever rendered.
const okImage = (u) => /^(\/api\/public\/media\/[\w-]+|\/images\/[\w.-]+|https:\/\/\S+)$/.test(u || "");
function inline(text, key = "i") {
  const out = [];
  const re = /(!\[([^\]]*)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|_([^_]+)_|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[3] !== undefined) { if (okImage(m[3])) out.push(<img key={k} src={imgSrc(m[3])} alt={m[2]} loading="lazy" className="my-2 inline-block max-w-full" />); }
    else if (m[4]) out.push(<strong key={k}>{m[4]}</strong>);
    else if (m[5]) out.push(<em key={k}>{m[5]}</em>);
    else {
      const href = m[7];
      if (href.startsWith("/")) out.push(<Link key={k} to={href}>{m[6]}</Link>);
      else if (/^https?:\/\//.test(href)) out.push(<a key={k} href={href} target="_blank" rel="noopener noreferrer">{m[6]}</a>);
      else out.push(m[6]);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className = "prose-article" }) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line.trim());
    if (img) { if (okImage(img[2])) blocks.push({ t: "img", alt: img[1], src: img[2] }); i++; continue; }
    const h = /^(#{2,3})\s+(.*)$/.exec(line);
    if (h) { blocks.push({ t: h[1].length === 2 ? "h2" : "h3", c: h[2] }); i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      blocks.push({ t: "ul", items }); continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push({ t: "ol", items }); continue;
    }
    if (/^>\s?/.test(line)) {
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ t: "quote", c: q.join(" ") }); continue;
    }
    const p = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|\s*[-*]\s+|\s*\d+[.)]\s+|>)/.test(lines[i])) p.push(lines[i++].trim());
    blocks.push({ t: "p", c: p.join(" ") });
  }
  return (
    <div className={className}>
      {blocks.map((b, k) => {
        if (b.t === "h2") return <h2 key={k}>{inline(b.c, k)}</h2>;
        if (b.t === "h3") return <h3 key={k}>{inline(b.c, k)}</h3>;
        if (b.t === "ul") return <ul key={k}>{b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ul>;
        if (b.t === "ol") return <ol key={k}>{b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ol>;
        if (b.t === "quote") return <blockquote key={k}>{inline(b.c, k)}</blockquote>;
        if (b.t === "img") return <figure key={k} className="my-6"><img src={imgSrc(b.src)} alt={b.alt} loading="lazy" className="w-full" />{b.alt && <figcaption className="mt-2 text-xs text-slate-500">{b.alt}</figcaption>}</figure>;
        return <p key={k}>{inline(b.c, k)}</p>;
      })}
    </div>
  );
}

export const plainText = (md) => String(md || "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/[#*_>[\]]/g, "").replace(/\(([^)]+)\)/g, "").replace(/\s+/g, " ").trim();
