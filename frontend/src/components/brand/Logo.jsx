import { S_PATH, A_PATH, MARK_VIEWBOX, WORD_PATH, SUB_PATH, HORIZONTAL, STACKED, COLORS } from "./mark";

const tones = (tone) => COLORS[tone === "dark" ? "dark" : "light"];

// The SA mark from the Sellandiamman artwork: grey S, red A. tone="dark" on dark grounds; `color` gives a one-colour mark.
export function Mark({ className = "h-8 w-auto", tone = "light", color, title }) {
  const c = tones(tone);
  return (
    <svg viewBox={MARK_VIEWBOX} className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title} focusable="false">
      <path d={S_PATH} fill={color || c.s} />
      <path d={A_PATH} fill={color || c.a} />
    </svg>
  );
}

const HEIGHTS = {
  horizontal: { sm: "h-6", md: "h-8 sm:h-9", lg: "h-11 sm:h-12" },
  stacked: { sm: "h-16", md: "h-24", lg: "h-36" },
};

// Lockups drawn as one vector: the mark beside SELLANDIAMMAN / — ESTATES — (horizontal, for bars),
// or the mark above the name as in the artwork (stacked). size picks the height; className can override it.
export function Logo({ tone = "light", size = "md", stacked = false, className = "", title = "Sellandiamman Estates" }) {
  const c = tones(tone);
  const L = stacked ? STACKED : HORIZONTAL;
  const [mx, my] = stacked ? STACKED.mark : [0, 0];
  const [tx, ty, tk] = L.text;
  const h = HEIGHTS[stacked ? "stacked" : "horizontal"][size] || HEIGHTS.horizontal.md;
  return (
    <svg viewBox={`0 0 ${L.w} ${L.h}`} className={`${h} w-auto max-w-full shrink-0 ${className}`} role="img" aria-label={title} focusable="false" data-testid="brand-logo">
      <g transform={`translate(${mx} ${my})`}>
        <path d={S_PATH} fill={c.s} />
        <path d={A_PATH} fill={c.a} />
      </g>
      <g transform={`translate(${tx} ${ty}) scale(${tk})`}>
        <path d={WORD_PATH} fill={c.word} fillRule="evenodd" />
        <path d={SUB_PATH} fill={c.sub} fillRule="evenodd" />
      </g>
    </svg>
  );
}

export default Logo;
