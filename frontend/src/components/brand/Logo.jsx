import { MARK_PATH, MARK_VIEWBOX, MARK_GREY } from "./mark";

// The SA mark from the supplied logo, drawn as vector so it stays sharp at every size.
export function Mark({ className = "h-8 w-auto", color = MARK_GREY, title }) {
  return (
    <svg viewBox={MARK_VIEWBOX} className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title} focusable="false">
      <path d={MARK_PATH} fill={color} />
    </svg>
  );
}

// Horizontal lockup: mark, then SELLANDIAMMAN over a letter-spaced ESTATES.
// tone="dark" is for dark backgrounds (footer, ERP sidebar).
export function Logo({ tone = "light", size = "md", stacked = false, className = "" }) {
  const dark = tone === "dark";
  const s = { sm: { mark: "h-6", name: "text-[13px]", sub: "text-[8px] tracking-[0.5em]" }, md: { mark: "h-8", name: "text-[15px]", sub: "text-[9px] tracking-[0.55em]" }, lg: { mark: "h-12", name: "text-xl", sub: "text-[11px] tracking-[0.6em]" } }[size];
  const words = (
    <span className="flex flex-col leading-none">
      <span className={`font-heading font-semibold tracking-[0.06em] ${s.name} ${dark ? "text-white" : "text-slate-900"}`}>SELLANDIAMMAN</span>
      <span className={`mt-1 font-semibold ${s.sub} ${dark ? "text-slate-400" : "text-brand-ink"}`}>ESTATES</span>
    </span>
  );
  return (
    <span className={`inline-flex ${stacked ? "flex-col items-center gap-2" : "items-center gap-3"} ${className}`} data-testid="brand-logo">
      <Mark className={`${s.mark} w-auto shrink-0`} color={dark ? "#B9BABE" : MARK_GREY} />
      {words}
    </span>
  );
}

export default Logo;
