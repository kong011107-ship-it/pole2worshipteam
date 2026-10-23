#!/usr/bin/env python3
"""RESTORE-GUIDE.md → assets/guide.js (관리자 화면 '사고 대응 · 이관 안내서'). 안내서를 고치면 다시 돌려 주세요."""
import html, re, sys, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
md = open(os.path.join(root, "RESTORE-GUIDE.md"), encoding="utf-8").read().splitlines()
def inline(t):
    t = html.escape(t, quote=False)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"(https://[^\s<)]+)", r'<a href="\1" target="_blank" rel="noopener">\1</a>', t)
    return t
out, stack = [], []   # stack: list types by indent
def close_to(level):
    while len(stack) > level: out.append(f"</{stack.pop()}>")
for line in md:
    if not line.strip(): close_to(0); continue
    m = re.match(r"^(#{1,4})\s+(.*)", line)
    if m:
        close_to(0); n = len(m.group(1)); 
        if n == 1: continue   # 제목은 화면 머리에
        out.append(f"<h{n}>{inline(m.group(2))}</h{n}>"); continue
    m = re.match(r"^(\s*)(-|\d+\.)\s+(.*)", line)
    if m:
        lvl = len(m.group(1)) // 3 + 1; tag = "ol" if m.group(2)[0].isdigit() else "ul"
        if len(stack) < lvl: out.append(f"<{tag}>"); stack.append(tag)
        else: close_to(lvl)
        out.append(f"<li>{inline(m.group(3))}"); continue
    close_to(0); out.append(f"<p>{inline(line)}</p>")
close_to(0)
h = "\n".join(out)
h = re.sub(r"<li>(.*?)(?=<li>|</ul>|</ol>|<ul>|<ol>)", lambda m: m.group(0), h)
js = "// 자동으로 만든 파일 — RESTORE-GUIDE.md를 고친 뒤 python3 scripts/guide_to_js.py\nwindow.GUIDE_HTML = " + __import__("json").dumps(h, ensure_ascii=False) + ";\n"
open(os.path.join(root, "assets", "guide.js"), "w", encoding="utf-8").write(js)
print(len(h))
