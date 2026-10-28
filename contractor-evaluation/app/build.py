#!/usr/bin/env python3
"""يجمع البرنامج في ملف واحد dist/index.html (للإرسال أو التشغيل من أي مكان)."""
import re, pathlib
root = pathlib.Path(__file__).parent
html = (root / 'index.html').read_text(encoding='utf-8')
html = re.sub(r'<link rel="stylesheet" href="app.css">', lambda m: '<style>\n' + (root / 'app.css').read_text(encoding='utf-8') + '\n</style>', html)
def inline(m):
    p = root / m.group(1)
    return '<script>\n' + p.read_text(encoding='utf-8') + '\n</script>' if p.exists() else ''
html = re.sub(r'<script src="([^"]+)"[^>]*></script>', inline, html)
out = root / 'dist'; out.mkdir(exist_ok=True)
(out / 'index.html').write_text(html, encoding='utf-8')
print('OK ->', out / 'index.html', len(html.encode('utf-8')), 'bytes')
