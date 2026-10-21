"""Packages the preview build (demo/build/site) as a hosted artifact page in demo/build/artifact.

The artifact host wraps the page in its own <html>/<head>/<body>, so the page is written without them, and only
the files the page needs are copied. Fonts are inlined into the stylesheet so they load inside the artifact frame.
    python demo/export.py                     # sample data -> frontend/src/demo/snapshot.json, PDF pages -> demo/build/pdf
    cd frontend && yarn build:preview && cd ..
    python demo/package.py
"""
import base64
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITE = ROOT / "build/site"
OUT = ROOT / "build/artifact"

if OUT.exists():
    shutil.rmtree(OUT)
(OUT / "static/js").mkdir(parents=True)
(OUT / "static/css").mkdir(parents=True)

html = (SITE / "index.html").read_text()
js = re.search(r'src="\./(static/js/main\.[\w]+\.js)"', html).group(1)
css = re.search(r'href="\./(static/css/main\.[\w]+\.css)"', html).group(1)

# Stylesheet: keep latin font faces as inline data (woff2), drop the other language subsets, keep other assets as files.
style = (SITE / css).read_text()
media_needed = set()


def face(m):
    block = m.group(0)
    url = re.search(r"url\(([^)]+?\.woff2)\)", block)
    if not url or "-latin-" not in url.group(1) or "latin-ext" in url.group(1):
        return ""
    data = base64.b64encode((SITE / "static/css" / url.group(1).strip("'\"")).resolve().read_bytes()).decode()
    return re.sub(r"src:[^;}]+", f"src:url(data:font/woff2;base64,{data}) format(\"woff2\")", block)


style = re.sub(r"@font-face\{[^}]*\}", face, style)
for u in re.findall(r"url\((\.\./media/[^)]+)\)", style):
    media_needed.add(u.replace("../", ""))
(OUT / css).write_text(style)
for m in media_needed:
    (OUT / "static" / m).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(SITE / "static" / m, OUT / "static" / m)
for f in (SITE / "static/js").glob("*.js"):
    shutil.copy(f, OUT / "static/js" / f.name)
for d in ("images", "brand"):
    shutil.copytree(SITE / d, OUT / d)
shutil.copytree(ROOT / "build/pdf", OUT / "pdf")
for f in ("favicon.svg", "icon-192.png"):
    shutil.copy(SITE / f, OUT / f)

BOOT_MARK = (SITE / "brand/mark.svg").read_text().replace("<svg ", '<svg width="48" height="20" aria-hidden="true" ', 1).replace('role="img" ', "")
page = f"""<title>Sellandiamman Estates</title>
<meta name="theme-color" content="#0F172A">
<meta name="description" content="Preview of the Sellandiamman Estates website, staff workspace and owner portal with sample data.">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="{css}">
<style>
  /* The page is the light website and staff app; keep its own white ground in every theme. */
  :root {{ color-scheme: light; }}
  html, body {{ background: #ffffff; }}
  /* Sticky bars sit below the phone's status bar inside the app viewer. */
  .sticky.top-0 {{ top: env(safe-area-inset-top, 0px); }}
  body::before {{ content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 70; background: #ffffff; }}
  #boot {{ display: flex; min-height: 60vh; align-items: center; justify-content: center; gap: 12px; font: 500 14px/1.4 system-ui, sans-serif; color: #64748b; }}
</style>
<div id="root"><div id="boot">{BOOT_MARK}Loading Sellandiamman Estates…</div></div>
<script defer src="{js}"></script>
"""
(OUT / "index.html").write_text(page)
files = sorted(str(p.relative_to(OUT)) for p in OUT.rglob("*") if p.is_file() and p.name != "index.html")
size = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
print(f"artifact: {len(files)} files, {size / 1e6:.1f} MB, page {len(page) / 1024:.1f} KB")
(ROOT / "build/artifact-files.txt").write_text("\n".join(files))
