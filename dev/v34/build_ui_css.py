# v34.1: app.css · v30 · v31 · v32.css → assets/ui.css 하나로
#  python3 dev/v34/build_ui_css.py  (한 번 돌리고 끝. 결과 ui.css를 직접 고쳐 나가요)
#  1) 네 파일을 예전과 같은 순서로 이어 붙여요 (v30 ↔ v31/v32 사이에 겹치는 선택자 없음 · 확인함)
#  2) 글자 크기 27가지 → 7단계 (PLAN-034 '글자 크기 기준'), 굵기 700 · 800 · 900 → 600
#     단, 악보 보기 · 필기 · 백업찬양 진행 · 메트로놈 · 입력칸(16)은 그대로
#  3) 맨 앞에 토큰(src_tokens.css), 맨 뒤에 v34 층(src_layer.css)
import os, re
HERE = os.path.dirname(os.path.abspath(__file__))
A = os.path.join(HERE, "../../assets")
SRC_DIR = os.environ.get("CSS_SRC", A)   # 원래 네 파일이 있는 곳 (v34.1부터 저장소에는 없어요)
SRC = ["app.css", "v30.css", "v31.css", "v32.css"]
KEEP = re.compile(r"\.(cvv|iv-|iv\b|ivm|ink|memo|bk-live|bk-livebar|bk-pill|bk-pen|bk-go|bk-codein|bk-now|bk-next|bk-tool|bk-cur|bk-run|bk-follow|metro|bpm-flash|bpm-pop|pedal|pt-pop|cvv-)")
# app.css 안의 '진행 화면'(백업찬양 진행) · '024 내 메모' 구역은 통째로 그대로
KEEP_RANGES = {"app.css": [("/* ---- 진행 화면", "/* ---- 관리자: 악보집"), ("/* ---------- 024: 내 메모", "/* =========================================================\n   025")]}

def size_map(px, sel):
    num = re.search(r"\sb$|\bb\s*$|\sstrong$", sel.strip()) is not None
    if px >= 28: return 26
    if px >= 22: return 24 if num else 20
    if px >= 20: return 17
    if px >= 18: return 16
    if px == 17: return 15
    if px in (16,): return 16
    if px >= 15: return 14
    if px >= 14: return 13
    if px >= 12: return 12
    if px >= 11: return 11
    return 10.5

def fix_block(sel, body):
    if KEEP.search(sel): return body
    if re.search(r"\b(input|select|textarea)\b|\.input\b|\.select\b", sel): return body
    def fs(m):
        v = float(m.group(1)); n = size_map(v, sel.split(",")[-1])
        return f"font-size: {n:g}px"
    body = re.sub(r"font-size:\s*([0-9.]+)px", fs, body)
    body = re.sub(r"font-weight:\s*(700|800|900)\b", "font-weight: 600", body)
    return body

def transform(css, name):
    # 보존 구역 잘라 두기
    holds = []
    for a, b in KEEP_RANGES.get(name, []):
        i = css.find(a); j = css.find(b, i + 1)
        if i < 0 or j < 0: raise SystemExit(f"구역 못 찾음 {name}: {a}")
        holds.append(css[i:j]); css = css[:i] + f"\0HOLD{len(holds)-1}\0" + css[j:]
    out, i = [], 0
    for m in re.finditer(r"([^{}]*)\{([^{}]*)\}", css):
        out.append(css[i:m.start()])
        sel, body = m.group(1), m.group(2)
        out.append(sel + "{" + fix_block(re.sub(r"/\*.*?\*/", "", sel, flags=re.S), body) + "}")
        i = m.end()
    out.append(css[i:])
    css = "".join(out)
    for k, h in enumerate(holds): css = css.replace(f"\0HOLD{k}\0", h)
    return css

parts = []
imp = ""
for f in SRC:
    css = open(os.path.join(SRC_DIR, f), encoding="utf-8").read()
    if f == "app.css":
        m = re.match(r'(@import[^;]+;)\s*', css); imp = m.group(1); css = css[m.end():]
    parts.append(f"\n/* ===================================================================== 원래 {f} ===== */\n" + transform(css, f))
tok = open(os.path.join(HERE, "src_tokens.css"), encoding="utf-8").read()
lay = open(os.path.join(HERE, "src_layer.css"), encoding="utf-8").read()
head = "/* Pole2 찬양팀 — ui.css (v34.1) · app.css · v30 · v31 · v32.css를 합친 하나의 CSS. HTML 6개가 모두 이것만 불러요. */\n"
open(os.path.join(A, "ui.css"), "w", encoding="utf-8").write(imp + "\n" + head + tok + "".join(parts) + "\n" + lay)
print("ui.css", sum(len(p) for p in parts) + len(tok) + len(lay))
