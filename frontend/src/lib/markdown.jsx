import { Link } from "react-router-dom";

// Small, safe Markdown renderer for Insights articles: ## / ### headings, paragraphs, - and 1. lists,
// > quotes, **bold**, _italic_ and [links](url). No raw HTML is ever rendered.
function inline(text, key = "i") {
  const out = [];
  const re = /(\*\*([^*]+)\*\*|_([^_]+)_|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[2]) out.push(<strong key={k}>{m[2]}</strong>);
    else if (m[3]) out.push(<em key={k}>{m[3]}</em>);
    else {
      const href = m[5];
      if (href.startsWith("/")) out.push(<Link key={k} to={href}>{m[4]}</Link>);
      else if (/^https?:\/\//.test(href)) out.push(<a key={k} href={href} target="_blank" rel="noopener noreferrer">{m[4]}</a>);
      else out.push(m[4]);
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
        return <p key={k}>{inline(b.c, k)}</p>;
      })}
    </div>
  );
}

export const plainText = (md) => String(md || "").replace(/[#*_>[\]]/g, "").replace(/\(([^)]+)\)/g, "").replace(/\s+/g, " ").trim();
