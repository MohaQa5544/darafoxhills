#!/usr/bin/env python3
"""يجمع كل تطبيق مع logos.js وملف البيانات المحلي (إن وُجد) في ملف واحد يعمل دون إنترنت داخل dist/."""
import re, pathlib

root = pathlib.Path(__file__).parent
APPS = {"index.html": "attendance.html",      # المهندسون (قسم المشاريع + العقارات)
        "workers.html": "workers.html"}       # عمال قسم العقارات

def inline(m):
    p = root / m.group(1)
    return "<script>\n" + p.read_text(encoding="utf-8") + "\n</script>" if p.exists() else ""   # ملفات *.local.js اختيارية

out = root / "dist"; out.mkdir(exist_ok=True)
for src, dst in APPS.items():
    html = re.sub(r'<script src="([^"]+)"[^>]*></script>', inline, (root / src).read_text(encoding="utf-8"))
    (out / dst).write_text(html, encoding="utf-8")
    print("OK ->", out / dst)
