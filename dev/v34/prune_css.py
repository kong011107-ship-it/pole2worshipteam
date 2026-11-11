# v34.3: ui.css에서 더는 쓰지 않는 선택자 규칙을 지워요 (옛 리더십 메뉴 .side/.nav-* · 옛 콘티 쓰기 .ce-x/.ce-shsel/.ce-more/.ce-morebox).
#   python3 dev/v34/prune_css.py assets/ui.css   → 제자리 수정 · 지운 규칙 수 출력
import re, sys
DEAD = re.compile(r"(^|[\s>+~(,])(\.side(-top)?|\.nav-(sec|group|items|chev|dot|div|switch)|\.switch-btn|\.ce-x|\.ce-shsel|\.ce-more(box)?)(?![\w-])")
def dead(sel): return bool(DEAD.search(sel))
def prune(css):
    out, i, n, removed = [], 0, len(css), 0
    def take_block(j):   # j = '{' 위치 → 짝 '}' 다음 위치
        d = 0
        while j < n:
            c = css[j]
            if c == "{": d += 1
            elif c == "}":
                d -= 1
                if d == 0: return j + 1
            j += 1
        return n
    while i < n:
        if css.startswith("/*", i):
            j = css.find("*/", i); j = n if j < 0 else j + 2; out.append(css[i:j]); i = j; continue
        m = re.compile(r"\s+").match(css, i)
        if m: out.append(m.group(0)); i = m.end(); continue
        j = css.find("{", i); k = css.find(";", i)
        if j < 0 or (0 <= k < j and css[i:k].lstrip().startswith("@")):   # @import 같은 한 줄 문장
            e = (k if k >= 0 else n) + 1; out.append(css[i:e]); i = e; continue
        head = css[i:j].strip(); e = take_block(j); body = css[j + 1:e - 1]
        if head.startswith("@media") or head.startswith("@supports"):
            inner, r = prune(body); removed += r
            if inner.strip(): out.append(f"{head} {{{inner}}}")
            else: removed += 1
            i = e; continue
        if head.startswith("@"): out.append(css[i:e]); i = e; continue
        sels = [x.strip() for x in head.split(",")]
        keep = [x for x in sels if not dead(x)]
        if not keep: removed += 1; i = e; continue
        out.append((", ".join(keep) if len(keep) != len(sels) else head) + " {" + body + "}")
        i = e
    return "".join(out), removed
p = sys.argv[1]; css = open(p, encoding="utf-8").read()
new, r = prune(css)
new = re.sub(r"\n{3,}", "\n\n", new)
open(p, "w", encoding="utf-8").write(new); print("removed", r, "rules;", len(css), "->", len(new), "bytes")
