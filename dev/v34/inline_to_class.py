# v34.3: admin.js · conti.js · me.html의 자주 쓰는 인라인 style을 유틸 클래스(x-*)로 바꿔요. 한 번 돌리는 스크립트 (결과는 git에 들어 있어요)
import re, sys
MAP = {
  "margin:0": "x-m0", "font-weight:600": "x-b", "align-self:flex-start": "x-ss", "font-size:15px;font-weight:600": "x-h",
  "display:flex;flex-direction:column;gap:12px": "x-col x-g12", "display:flex;flex-direction:column;gap:6px": "x-col x-g6",
  "display:flex;flex-direction:column;gap:4px": "x-col x-g4", "display:flex;flex-direction:column;gap:10px": "x-col x-g10",
  "display:flex;flex-direction:column;gap:16px": "x-col x-g16", "display:flex;flex-direction:column;gap:14px": "x-col x-g14",
  "display:flex;flex-direction:column;gap:8px": "x-col x-g8",
  "margin-left:auto": "x-mla", "flex:1": "x-f1", "font-size:13px": "x-13", "font-size:14px": "x-14", "font-size:12px": "x-12",
  "color:var(--bad)": "x-bad", "display:flex;gap:6px;flex-wrap:wrap": "x-row x-wrap x-g6", "display:flex;gap:8px;flex-wrap:wrap": "x-row x-wrap x-g8",
  "display:flex;align-items:center;gap:6px": "x-row x-ac x-g6", "display:flex;align-items:center;gap:8px": "x-row x-ac x-g8",
  "display:flex;align-items:center;gap:10px": "x-row x-ac x-g10", "display:flex;gap:8px": "x-row x-g8", "display:flex;gap:6px": "x-row x-g6",
  "color:inherit;text-decoration:none": "x-plain", "width:auto": "x-wa", "overflow-x:auto": "x-ox", "font-weight:400": "x-n",
  "display:flex;flex-wrap:wrap;gap:10px;align-items:center": "x-row x-wrap x-ac x-g10", "justify-content:space-between": "x-sb", "justify-content:flex-end": "x-je",
  "font-size:14px;font-weight:600": "x-14 x-b", "margin-top:8px": "x-mt8", "margin-top:4px": "x-mt4", "padding:20px": "x-p20",
  "display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px": "x-row x-wrap x-ab x-sb x-g8",
  "margin:6px 0 0;padding-left:18px;line-height:1.8": "x-ul", "margin:6px 0 0;padding-left:18px": "x-ul x-lh",
}
TAG = re.compile(r"<([a-zA-Z][\w-]*)(\s[^<>]*?)(/?)>")
def fix(m):
    tag, attrs, slash = m.group(1), m.group(2), m.group(3)
    if "${" in attrs and '"' in re.sub(r'(style|class|href|id|data-[\w-]+|aria-[\w-]+|title|placeholder|value|type|role|for|name)="[^"]*"', "", attrs): return m.group(0)
    sm = re.search(r'\sstyle="([^"]*)"', attrs)
    if not sm: return m.group(0)
    key = sm.group(1).strip().rstrip(";")
    cls = MAP.get(key)
    if not cls: return m.group(0)
    attrs = attrs[:sm.start()] + attrs[sm.end():]
    if "${" in attrs and ("class=" in attrs.split("${")[0] or re.search(r'class="[^"]*\$\{', attrs)): return m.group(0)   # 동적 class가 있는 태그는 건너뛰어요
    cm = re.search(r'\sclass="([^"$]*)"', attrs)
    if cm: attrs = attrs[:cm.start()] + f' class="{cm.group(1)} {cls}"' + attrs[cm.end():]
    elif re.search(r'\sclass=', attrs): return m.group(0)
    else: attrs = f' class="{cls}"' + attrs
    return f"<{tag}{attrs}{slash}>"
for p in sys.argv[1:]:
    s = open(p, encoding="utf-8").read(); n0 = len(re.findall(r'style="', s))
    s2 = TAG.sub(fix, s); n1 = len(re.findall(r'style="', s2))
    open(p, "w", encoding="utf-8").write(s2); print(p, n0, "->", n1)
