#!/usr/bin/env python3
"""يجمع index.html + logos.js (+ data.local.js إن وُجد) في ملف واحد dist/attendance.html يعمل دون إنترنت."""
import re, pathlib

root = pathlib.Path(__file__).parent
html = (root / "index.html").read_text(encoding="utf-8")

def inline(m):
    src = m.group(1)
    p = root / src
    if not p.exists():
        return ""            # data.local.js اختياري
    return "<script>\n" + p.read_text(encoding="utf-8") + "\n</script>"

html = re.sub(r'<script src="([^"]+)"[^>]*></script>', inline, html)
out = root / "dist"
out.mkdir(exist_ok=True)
(out / "attendance.html").write_text(html, encoding="utf-8")
print("OK ->", out / "attendance.html")
