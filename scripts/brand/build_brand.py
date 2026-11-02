"""Builds every Sellandiamman brand asset from the supplied artwork (scripts/brand/sellandiamman-logo-source.png).

The artwork is traced once into clean vector geometry, which is then written out for the website, the PDFs and the icons,
so all of them draw exactly the same logo:

  frontend/src/components/brand/mark.js     vector paths + colours used by <Mark/> and <Logo/>
  backend/brand.py                          the same geometry as polygons for reportlab PDFs
  frontend/public/favicon.svg|.ico, apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable-512.png, og-image.jpg
  frontend/public/brand/*.svg|*.png         mark and lockups for light and dark backgrounds

Run from the repository root:   python scripts/brand/build_brand.py
Needs opencv-python-headless, numpy, scipy, pillow and playwright (with Chromium).
"""
import asyncio
import io
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter1d

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "scripts/brand/sellandiamman-logo-source.png"
PUBLIC = ROOT / "frontend/public"
UP = 4  # trace at 4x for sub-pixel accuracy; all geometry below is in source-image pixels

# Colours sampled from the artwork (grey #9C9FA3, red #FD171B on black). On white the grey and red are taken one step
# deeper so the mark keeps its contrast; on dark backgrounds the artwork's own colours are used.
COLORS = {
    "dark": {"s": "#9C9FA3", "a": "#FD171B", "word": "#FFFFFF", "sub": "#9C9FA3"},
    "light": {"s": "#8A8D92", "a": "#E3161C", "word": "#121315", "sub": "#7A7D82"},
}
BLACK = "#0B0B0C"


# ----------------------------------------------------------------------------------------------------------- tracing
def masks():
    src = cv2.imread(str(SRC)).astype(np.float32)
    im = cv2.resize(src, None, fx=UP, fy=UP, interpolation=cv2.INTER_CUBIC)
    b, g, r = im[:, :, 0], im[:, :, 1], im[:, :, 2]
    redness, lum = r - (g + b) / 2, (r + g + b) / 3
    red = (redness > 114).astype(np.uint8)
    grey = ((lum > 79) & (redness < 60)).astype(np.uint8)
    white = (lum > 128).astype(np.uint8)
    cut = 600 * UP  # the mark sits above row 600, the wordmark below
    grey[cut:] = 0
    red[cut:] = 0
    white[:cut] = 0
    return {"grey": grey, "red": red, "white": white}


def contours(mask):
    cs, _ = cv2.findContours(mask * 255, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    return [c.reshape(-1, 2).astype(float) for c in cs if cv2.contourArea(c) > 200 * UP * UP]


def smooth_poly(c, sigma, eps):
    sm = np.column_stack([gaussian_filter1d(c[:, 0], sigma, mode="wrap"), gaussian_filter1d(c[:, 1], sigma, mode="wrap")])
    return cv2.approxPolyDP(sm.astype(np.float32).reshape(-1, 1, 2), eps, True).reshape(-1, 2) / UP


def straight_poly(c, n_eps):
    """Polygon with exactly straight edges: find the corners, fit a line to each edge, corners = line intersections."""
    rough = cv2.approxPolyDP(c.astype(np.float32).reshape(-1, 1, 2), n_eps, True).reshape(-1, 2)
    idx = [int(np.argmin(((c - v) ** 2).sum(1))) for v in rough]
    lines = []
    for i in range(len(idx)):
        a, b = idx[i], idx[(i + 1) % len(idx)]
        seg = c[a:b + 1] if a < b else np.vstack([c[a:], c[:b + 1]])
        k = max(1, len(seg) // 8)
        seg = seg[k:-k] if len(seg) > 3 * k else seg  # skip the slightly rounded ends near each corner
        vx, vy, x0, y0 = cv2.fitLine(seg.astype(np.float32), cv2.DIST_L2, 0, 0.01, 0.01).ravel()
        lines.append((x0, y0, vx, vy))
    pts = []
    for i in range(len(lines)):
        x1, y1, a1, b1 = lines[i - 1]
        x2, y2, a2, b2 = lines[i]
        det = a1 * (-b2) - b1 * (-a2)
        t = ((x2 - x1) * (-b2) - (y2 - y1) * (-a2)) / det
        pts.append((x1 + t * a1, y1 + t * b1))
    return np.array(pts) / UP


def drop_collinear(p, deg=2.5):
    p = list(map(tuple, p))
    changed = True
    while changed and len(p) > 3:
        changed = False
        for i in range(len(p)):
            a, b, c = np.array(p[i - 1]), np.array(p[i]), np.array(p[(i + 1) % len(p)])
            u, v = b - a, c - b
            ang = abs(np.degrees(np.arctan2(u[0] * v[1] - u[1] * v[0], u @ v)))
            if ang < deg or np.hypot(*u) < 0.05:
                del p[i]
                changed = True
                break
    return np.array(p)


def square_up(p, tol=0.8):
    """Makes nearly horizontal/vertical edges exactly horizontal/vertical (fitted straight letters)."""
    p = np.array(p, float)
    for _ in range(3):
        for i in range(len(p)):
            j = (i + 1) % len(p)
            dx, dy = p[j] - p[i]
            if abs(dx) < tol and abs(dy) > 4 * tol:
                p[i, 0] = p[j, 0] = (p[i, 0] + p[j, 0]) / 2
            elif abs(dy) < tol and abs(dx) > 4 * tol:
                p[i, 1] = p[j, 1] = (p[i, 1] + p[j, 1]) / 2
    return p


def snap(p, axis, targets, tol):
    p = np.array(p, float)
    for t in targets:
        m = np.abs(p[:, axis] - t) < tol
        p[m, axis] = t
    return p


def clean_chevron(p, base):
    """The A chevron as six exact corners: both legs keep a constant width (outer edges parallel to inner edges)."""
    p = [tuple(v) for v in p]
    tip = min(p, key=lambda v: v[0])                                   # left end, against the S
    i = p.index(tip)
    nb = [p[i - 1], p[(i + 1) % len(p)]]
    inner_l = max(nb, key=lambda v: v[1])                              # lower neighbour = inner end of the cut
    bottom = sorted([v for v in p if abs(v[1] - base) < 3], key=lambda v: v[0])
    foot_in, foot_out = (bottom[0][0], base), (bottom[-1][0], base)
    j = p.index(inner_l)
    k = p[(j + 1) % len(p)] if p[(j + 1) % len(p)] != tip else p[j - 1]
    inner_apex = k                                                     # notch where the two inner edges meet

    def intersect(a, da, b, db):
        a, da, b, db = map(np.array, (a, da, b, db))
        cross = lambda u, v: u[0] * v[1] - u[1] * v[0]
        t = cross(b - a, db) / cross(da, db)
        return tuple(a + t * da)
    apex = intersect(tip, np.subtract(inner_apex, inner_l), foot_out, np.subtract(inner_apex, foot_in))
    return np.array([tip, inner_l, inner_apex, foot_in, foot_out, apex])


def canonical(letters, groups):
    """Repeated letters (the three As, two Ms, two Ns, two Ls) drawn from one instance so they match exactly."""
    out = list(letters)
    for spans in groups:
        insts = [[i for i, p in enumerate(out) if p[:, 0].min() >= a - 1 and p[:, 0].max() <= b + 1] for a, b in spans]
        ref = insts[0]
        if any(len(ix) != len(ref) or any(len(out[x]) != len(out[y]) for x, y in zip(ix, ref)) for ix in insts):
            continue
        rx = (min(out[i][:, 0].min() for i in ref) + max(out[i][:, 0].max() for i in ref)) / 2
        refp = [out[i].copy() for i in ref]
        for ix in insts[1:]:
            cx = (min(out[i][:, 0].min() for i in ix) + max(out[i][:, 0].max() for i in ix)) / 2
            for slot, rp in zip(ix, refp):
                out[slot] = rp + (cx - rx, 0)
    return out


def bbox(polys):
    allp = np.vstack(polys)
    return allp[:, 0].min(), allp[:, 1].min(), allp[:, 0].max(), allp[:, 1].max()


def trace():
    m = masks()
    # --- the mark: a grey S (two strokes) and a red A chevron
    s_polys = [smooth_poly(c, 3.0, 1.0) for c in contours(m["grey"])]
    a_poly = drop_collinear(straight_poly(contours(m["red"])[0], 6 * UP))
    base = max(p[:, 1].max() for p in s_polys)
    s_polys = [snap(p, 1, [base], 0.6) for p in s_polys]
    a_poly = clean_chevron(snap(a_poly, 1, [base], 2.0), base)

    # --- the wordmark: straight letters get fitted edges, S and D keep their curves
    letters = []
    for c in contours(m["white"]):
        x0 = c[:, 0].min() / UP
        x1 = c[:, 0].max() / UP
        curved = x0 < 200 or (800 < x0 < 930 and x1 < 930)
        if curved:
            p = smooth_poly(c, 2.4, 0.9)
        else:
            p = square_up(drop_collinear(straight_poly(c, 1.6 * UP)))
        letters.append(p)
    top = np.median([p[:, 1].min() for p in letters if p[:, 1].max() - p[:, 1].min() > 100])
    bot = np.median([p[:, 1].max() for p in letters if p[:, 1].max() - p[:, 1].min() > 100])
    letters = [snap(p, 1, [top, bot], 1.2) for p in letters]
    letters.sort(key=lambda p: (p[:, 0].min(), -(p[:, 1].max() - p[:, 1].min())))
    letters = canonical(letters, [[(320, 405), (420, 505)], [(662, 777), (1600, 1715)], [(1133, 1270), (1298, 1434)],
                                  [(513, 648), (983, 1119), (1449, 1586)]])
    return {"S": s_polys, "A": [a_poly], "W": letters, "cap_top": top, "baseline": bot}


def glyph(letters, x_from, x_to):
    return [p for p in letters if p[:, 0].min() >= x_from - 1 and p[:, 0].max() <= x_to + 1]


def estates(t):
    """ESTATES in the wordmark's own letters (E, S, A traced; T built from E's stem and arm)."""
    W, top, bot = t["W"], t["cap_top"], t["baseline"]
    E = glyph(W, 205, 300)
    S = glyph(W, 85, 192)
    A = glyph(W, 510, 650)
    m = masks()["white"]
    ex0 = E[0][:, 0].min()
    row = m[int((top + (bot - top) * 0.3) * UP)]          # between E's top and middle arms
    stem = (np.argmax(row[int(ex0 * UP):] == 0)) / UP
    col = m[:, int((ex0 + 50) * UP)]                     # through E's top arm
    arm = (np.argmax(col[int(top * UP) + 2:] == 0) + 2) / UP
    e_w = E[0][:, 0].max() - ex0
    tw = e_w + 6
    T = [np.array([(0, top), (tw, top), (tw, top + arm), ((tw + stem) / 2, top + arm), ((tw + stem) / 2, bot),
                   ((tw - stem) / 2, bot), ((tw - stem) / 2, top + arm), (0, top + arm)])]

    def at0(g):
        x0 = min(p[:, 0].min() for p in g)
        return [p - (x0, 0) for p in g]
    seq = [at0(E), at0(S), T, at0(A), T, at0(E), at0(S)]
    return seq, {"stem": stem, "arm": arm, "t_width": tw}


# ------------------------------------------------------------------------------------------------------- composition
def shift(polys, dx, dy, k=1.0):
    return [(p - (0, 0)) * k + (dx, dy) for p in polys]


def compose(t):
    S, A, W = t["S"], t["A"], t["W"]
    top, bot = t["cap_top"], t["baseline"]
    # mark, origin at its top-left corner
    mx0, my0, mx1, my1 = bbox(S + A)
    mark = {"S": shift(S, -mx0, -my0), "A": shift(A, -mx0, -my0)}
    mark_w, mark_h = mx1 - mx0, my1 - my0
    # wordmark, origin at the cap top-left
    wx0, _, wx1, _ = bbox(W)
    word = shift(W, -wx0, -top)
    word_w, cap = wx1 - wx0, bot - top
    # descriptor: E S T A T E S between two hairline rules, centred under the wordmark
    seq, tm = estates(t)
    k = 0.42                         # ESTATES cap height relative to SELLANDIAMMAN
    hd = cap * k
    track = 0.92 * hd
    widths = [max(p[:, 0].max() for p in g) for g in seq]
    est_w = sum(widths) * k + track * (len(seq) - 1)
    gap_y = 0.42 * cap
    y0 = cap + gap_y
    x = (word_w - est_w) / 2
    sub = []
    for g, w in zip(seq, widths):
        sub += [(p - (0, top)) * k + (x, y0) for p in g]
        x += w * k + track
    rule_t = 0.55 * tm["stem"] * k
    gap_x = 1.15 * hd
    rl = (word_w - est_w) / 2 - gap_x
    ry = y0 + hd / 2 - rule_t / 2
    rules = [np.array([(0, ry), (rl, ry), (rl, ry + rule_t), (0, ry + rule_t)]),
             np.array([(word_w - rl, ry), (word_w, ry), (word_w, ry + rule_t), (word_w - rl, ry + rule_t)])]
    text_h = y0 + hd
    return {"mark": mark, "mark_w": mark_w, "mark_h": mark_h, "word": word, "word_w": word_w, "cap": cap,
            "sub": sub + rules, "text_h": text_h, "metrics": tm}


# ------------------------------------------------------------------------------------------------------------ output
def num(v, nd=1):
    s = f"{v:.{nd}f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def path_d(polys, nd=1):
    return "".join("M" + " L".join(f"{num(x, nd)} {num(y, nd)}" for x, y in p) + "Z" for p in polys)


def rnd(polys, nd=1):
    return [[(round(float(x), nd), round(float(y), nd)) for x, y in p] for p in polys]


def lockups(C):
    """Two lockups built from the mark and the text block: horizontal (header) and stacked (the artwork's own layout)."""
    mh, mw, ww, th = C["mark_h"], C["mark_w"], C["word_w"], C["text_h"]
    # horizontal: text block height 0.62 of the mark, vertically centred; gap 0.28 of the mark height
    hk = 0.62 * mh / th
    hgap = 0.28 * mh
    horiz = {"w": mw + hgap + ww * hk, "h": mh, "text": (mw + hgap, (mh - th * hk) / 2, hk), "mark": (0, 0, 1)}
    # stacked: mark centred over the wordmark, gap as in the artwork
    sgap = 0.25 * mh
    sw = max(mw, ww)
    stacked = {"w": sw, "h": mh + sgap + th, "mark": ((sw - mw) / 2, 0, 1), "text": ((sw - ww) / 2, mh + sgap, 1)}
    return {"horizontal": horiz, "stacked": stacked}


def svg_group(C, layout, tone, with_text=True):
    col = COLORS[tone]
    mx, my, mk = layout["mark"]
    parts = [f'<g transform="translate({mx:.1f} {my:.1f})"><path fill="{col["s"]}" d="{path_d(C["mark"]["S"])}"/>'
             f'<path fill="{col["a"]}" d="{path_d(C["mark"]["A"])}"/></g>']
    if with_text:
        tx, ty, tk = layout["text"]
        parts.append(f'<g transform="translate({tx:.1f} {ty:.1f}) scale({tk:.5f})"><path fill="{col["word"]}" fill-rule="evenodd" d="{path_d(C["word"])}"/>'
                     f'<path fill="{col["sub"]}" fill-rule="evenodd" d="{path_d(C["sub"])}"/></g>')
    return "".join(parts)


def svg_doc(C, layout, tone, pad=0.0, bg=None, title="Sellandiamman Estates"):
    w, h = layout["w"] + 2 * pad, layout["h"] + 2 * pad
    bgr = f'<rect width="{w:.1f}" height="{h:.1f}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.1f} {h:.1f}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{bgr}<g transform="translate({pad:.1f} {pad:.1f})">{svg_group(C, layout, tone)}</g></svg>')


def mark_svg(C, tone, title="Sellandiamman"):
    lay = {"w": C["mark_w"], "h": C["mark_h"], "mark": (0, 0, 1)}
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {C["mark_w"]:.1f} {C["mark_h"]:.1f}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{svg_group(C, lay, tone, with_text=False)}</svg>')


def icon_svg(C, size, fill=0.8, radius=0.0, bg=BLACK):
    """Square icon: the mark on black, fitted to `fill` of the width."""
    k = size * fill / C["mark_w"]
    x = (size - C["mark_w"] * k) / 2
    y = (size - C["mark_h"] * k) / 2
    col = COLORS["dark"]
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">'
            f'<rect width="{size}" height="{size}" rx="{size * radius:.1f}" fill="{bg}"/>'
            f'<g transform="translate({x:.2f} {y:.2f}) scale({k:.5f})"><path fill="{col["s"]}" d="{path_d(C["mark"]["S"])}"/>'
            f'<path fill="{col["a"]}" d="{path_d(C["mark"]["A"])}"/></g></svg>')


def write_js(C, L):
    h, s = L["horizontal"], L["stacked"]
    data = {
        "MARK_W": round(C["mark_w"], 1), "MARK_H": round(C["mark_h"], 1),
        "S_PATH": path_d(C["mark"]["S"]), "A_PATH": path_d(C["mark"]["A"]),
        "WORD_W": round(C["word_w"], 1), "TEXT_H": round(C["text_h"], 1),
        "WORD_PATH": path_d(C["word"]), "SUB_PATH": path_d(C["sub"]),
        "HORIZONTAL": {"w": round(h["w"], 1), "h": round(h["h"], 1), "text": [round(v, 5) for v in h["text"]]},
        "STACKED": {"w": round(s["w"], 1), "h": round(s["h"], 1), "mark": [round(v, 1) for v in s["mark"]], "text": [round(v, 1) for v in s["text"]]},
        "COLORS": COLORS,
    }
    lines = ["// Generated by scripts/brand/build_brand.py from the supplied Sellandiamman artwork. Do not edit by hand.",
             "// The same geometry is written to backend/brand.py for the PDFs."]
    for k, v in data.items():
        lines.append(f"export const {k} = {json.dumps(v)};")
    lines.append("export const MARK_VIEWBOX = `0 0 ${MARK_W} ${MARK_H}`;")
    (ROOT / "frontend/src/components/brand/mark.js").write_text("\n".join(lines) + "\n")


def write_py(C, L):
    h = L["horizontal"]
    body = f'''"""Sellandiamman brand geometry for the PDFs. Generated by scripts/brand/build_brand.py, do not edit by hand.

The website draws the same shapes (frontend/src/components/brand/mark.js). Units are those of the traced artwork;
y grows downwards. Holes (A, D) are separate polygons, so fill with the even-odd rule.
"""

MARK_W, MARK_H = {C["mark_w"]:.1f}, {C["mark_h"]:.1f}
WORD_W, CAP_H, TEXT_H = {C["word_w"]:.1f}, {C["cap"]:.1f}, {C["text_h"]:.1f}
COLORS = {json.dumps(COLORS)}
MARK_GREY = COLORS["light"]["s"]
MARK_RED = COLORS["light"]["a"]
INK = "#0F172A"
# horizontal lockup: mark at (0, 0); text block at (x, y) scaled by k; overall size W x H
LOCKUP = {{"w": {h["w"]:.1f}, "h": {h["h"]:.1f}, "text_x": {h["text"][0]:.1f}, "text_y": {h["text"][1]:.1f}, "text_k": {h["text"][2]:.5f}}}

S_POLYS = {rnd(C["mark"]["S"])}
A_POLYS = {rnd(C["mark"]["A"])}
WORD_POLYS = {rnd(C["word"])}
SUB_POLYS = {rnd(C["sub"])}


def mark_polygons():
    """The whole mark (S and A) as closed polygons, for one-colour use."""
    return S_POLYS + A_POLYS
'''
    (ROOT / "backend/brand.py").write_text(body)


async def render(jobs):
    """jobs: list of (html, width, height, out_path, transparent)."""
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for html, w, h, out, transparent in jobs:
            pg = await b.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
            await pg.set_content(f'<html><body style="margin:0;background:transparent">{html}</body></html>')
            await pg.wait_for_timeout(50)
            png = await pg.screenshot(omit_background=transparent, clip={"x": 0, "y": 0, "width": w, "height": h})
            out = Path(out)
            if out.suffix == ".jpg":
                Image.open(io.BytesIO(png)).convert("RGB").save(out, quality=90, optimize=True, progressive=True)
            else:
                out.write_bytes(png)
            await pg.close()
        await b.close()


def og_html(C, L):
    s = L["stacked"]
    k = 300 / s["h"]
    w = s["w"] * k
    lock = svg_doc(C, s, "dark").replace("<svg ", f'<svg width="{w:.0f}" height="300" ', 1)
    return f'''<div style="width:1200px;height:630px;background:{BLACK};display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Inter,'Inter Display',sans-serif">
{lock}
<div style="margin-top:46px;color:#E7E8EA;font-size:30px;font-weight:600;letter-spacing:.01em">Homes, land, rentals and property management</div>
<div style="margin-top:14px;color:#9C9FA3;font-size:21px;font-weight:500;letter-spacing:.06em">PERUNDURAI · ERODE · KADAMBUR · SATHYAMANGALAM · NAMAKKAL</div>
</div>'''


def main():
    t = trace()
    C = compose(t)
    L = lockups(C)
    write_js(C, L)
    write_py(C, L)
    brand = PUBLIC / "brand"
    brand.mkdir(exist_ok=True)
    (brand / "mark.svg").write_text(mark_svg(C, "light"))
    (brand / "mark-on-dark.svg").write_text(mark_svg(C, "dark"))
    for name, lay in L.items():
        (brand / f"logo-{name}.svg").write_text(svg_doc(C, lay, "light"))
        (brand / f"logo-{name}-on-dark.svg").write_text(svg_doc(C, lay, "dark"))
    (PUBLIC / "favicon.svg").write_text(icon_svg(C, 64, fill=0.86, radius=0.18))
    jobs = []

    def sized(svg, w, h):
        return svg.replace("<svg ", f'<svg width="{w}" height="{h}" ', 1)
    for name, lay in L.items():
        for tone, suffix in (("light", ""), ("dark", "-on-dark")):
            w = 1200 if name == "horizontal" else 900
            h = round(w * lay["h"] / lay["w"])
            jobs.append((sized(svg_doc(C, lay, tone), w, h), w, h, brand / f"logo-{name}{suffix}.png", True))
    for size, out, fill, radius in ((180, "apple-touch-icon.png", 0.78, 0), (192, "icon-192.png", 0.8, 0.18),
                                    (512, "icon-512.png", 0.8, 0.18), (512, "icon-maskable-512.png", 0.66, 0)):
        jobs.append((icon_svg(C, size, fill, radius), size, size, PUBLIC / out, True))
    for size in (16, 32, 48):
        jobs.append((icon_svg(C, size, 0.9, 0.18), size, size, brand / f".fav{size}.png", True))
    jobs.append((og_html(C, L), 1200, 630, PUBLIC / "og-image.jpg", False))
    asyncio.run(render(jobs))
    ims = [Image.open(brand / f".fav{s}.png") for s in (16, 32, 48)]
    ims[2].save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)], append_images=ims[:2])
    for s in (16, 32, 48):
        (brand / f".fav{s}.png").unlink()
    print(json.dumps({"mark": [round(C["mark_w"], 1), round(C["mark_h"], 1)], "word": [round(C["word_w"], 1), round(C["cap"], 1)],
                      "text_h": round(C["text_h"], 1), "points": {"S": sum(len(p) for p in C["mark"]["S"]), "A": len(C["mark"]["A"][0]),
                      "word": sum(len(p) for p in C["word"])}, **{k: round(float(v), 2) for k, v in C["metrics"].items()}}))


if __name__ == "__main__":
    main()
