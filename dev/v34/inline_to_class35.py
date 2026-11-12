# v35: 남은 인라인 style 중 두 번 이상 나오는 고정값(${…} 없는 것)을 유틸 클래스(x2-*)로 · 굵기 700/800은 600으로 (글자 크기 기준)
#   python3 dev/v34/inline_to_class35.py assets/admin.js assets/conti.js me.html  → 바뀐 수 출력 + /tmp/x2.css (ui.css 맨 끝에 붙여요)
import re, sys, collections
sys.path.insert(0, __file__.rsplit("/", 1)[0])
FILES = sys.argv[1:]
cnt = collections.Counter()
for p in FILES:
    for v in re.findall(r'\sstyle="([^"$]*)"', open(p, encoding="utf-8").read()):
        cnt[v.strip().rstrip(";")] += 1
MAP = {k: f"x2-{i + 1}" for i, (k, n) in enumerate(sorted([x for x in cnt.items() if x[1] >= 2 and x[0]], key=lambda x: -x[1]))}
# 이미 있는 x-* 와 같은 값은 그대로
import importlib.util
spec = importlib.util.spec_from_file_location("old", __file__.rsplit("/", 1)[0] + "/inline_to_class.py")
OLD = {}
src = open(__file__.rsplit("/", 1)[0] + "/inline_to_class.py", encoding="utf-8").read()
exec(src.split("TAG = ")[0], OLD)
for k, v in OLD["MAP"].items():
    if k in MAP: MAP[k] = v
TAG = re.compile(r"<([a-zA-Z][\w-]*)(\s[^<>]*?)(/?)>")
def fix(m):
    tag, attrs, slash = m.group(1), m.group(2), m.group(3)
    sm = re.search(r'\sstyle="([^"$]*)"', attrs)
    if not sm: return m.group(0)
    cls = MAP.get(sm.group(1).strip().rstrip(";"))
    if not cls: return m.group(0)
    rest = attrs[:sm.start()] + attrs[sm.end():]
    if re.search(r'class="[^"]*\$\{', rest) or re.search(r'class=\$', rest): return m.group(0)   # 동적 class
    if "${" in rest and '"' in re.sub(r'(style|class|href|id|data-[\w-]+|aria-[\w-]+|title|placeholder|value|type|role|for|name|min|max|step|inputmode|maxlength|accept|list|autocomplete|colspan|rowspan|src|alt|loading|width|height|tabindex)="[^"]*"', "", rest): return m.group(0)
    cm = re.search(r'\sclass="([^"$]*)"', rest)
    if cm: rest = rest[:cm.start()] + f' class="{cm.group(1)} {cls}"' + rest[cm.end():]
    elif re.search(r'\sclass=', rest): return m.group(0)
    else: rest = f' class="{cls}"' + rest
    return f"<{tag}{rest}{slash}>"
used = set()
for p in FILES:
    s = open(p, encoding="utf-8").read(); n0 = len(re.findall(r'style="', s))
    s2 = TAG.sub(fix, s); n1 = len(re.findall(r'style="', s2))
    used |= set(re.findall(r'\bx2-\d+\b', s2))
    open(p, "w", encoding="utf-8").write(s2); print(p, n0, "->", n1)
css = ["/* v35: 남은 인라인 style → x2-* (dev/v34/inline_to_class35.py) · 굵기 700/800은 600 */"]
for k, c in MAP.items():
    if c in used:
        decl = re.sub(r"font-weight:\s*[78]00", "font-weight:600", k)
        css.append(f".{c} {{ {decl}; }}")
open("/tmp/x2.css", "w").write("\n".join(css) + "\n"); print(len(css) - 1, "classes")
