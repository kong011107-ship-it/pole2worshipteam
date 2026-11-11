# v34.3: 단추 · 탭 · 세그먼트 · 하단 탭의 실제 크기(글자 · 굵기 · 높이)를 재요. 가짜 sb로 콘티 쓰기 · 리더십 · 팀원 화면을 열어요.
#   python3 dev/v34/measure.py   → 종류별로 '글자/굵기/높이' 조합과 개수
import asyncio, json, os, re, subprocess, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tests", "v31"))
from playwright.async_api import async_playwright
import run as R
SRC = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "shell_shots.py"), encoding="utf-8").read()
FIX = SRC[SRC.index('FIX = """') + 9: SRC.index('"""', SRC.index('FIX = """') + 9)]
GROUPS = {
  "주 행동(큰 단추)": ".ce-bar .btn, .ce-bar .u-b, .bk-foot .btn, .btn-block, .u-b:not(.u-sm), .btn:not(.btn-sm)",
  "줄 안 단추": ".btn-sm, .u-b.u-sm",
  "키 단추": ".ce2-keys button",
  "밑줄 탭": ".tabs button, .hx-tabs button, .page-tabs button",
  "세그먼트": ".segbar button, .u-seg button",
  "하단 탭": ".tabbar a, .tabbar button, .ad-tb",
}
JS = """(G) => { const out = {}; for (const [k, sel] of Object.entries(G)) { const m = {};
  document.querySelectorAll(sel).forEach((e) => { if (!e.offsetWidth) return; if (k === '주 행동(큰 단추)' && (e.matches('.btn-sm, .u-sm') )) return;
    const cs = getComputedStyle(e), key = `${parseFloat(cs.fontSize)}px/${cs.fontWeight}/${Math.round(e.getBoundingClientRect().height)}h`;
    (m[key] ||= []).push((e.textContent || '').trim().slice(0, 10)); });
  out[k] = Object.fromEntries(Object.entries(m).map(([a, b]) => [a, `${b.length} · ${[...new Set(b)].slice(0, 4).join(' | ')}`])); } return out; }"""
async def main():
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(R.PORT), "--bind", "127.0.0.1"], cwd=R.ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(0.8)
    res = {}
    try:
        async with async_playwright() as p:
            for mob, w in ((False, 820), (True, None)):
                tag = "휴대폰" if mob else "태블릿"
                b, pg = await R.page(p, mobile=mob, w=w)
                await pg.goto(R.BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(500)
                await pg.evaluate(R.HISTE); await pg.evaluate("CONTI.openEditor('s1')"); await pg.wait_for_timeout(800)
                await pg.fill("#ceQ", "은혜"); await pg.wait_for_timeout(300); await pg.click("[data-add='1']"); await pg.wait_for_timeout(500)
                await pg.locator(".ce-row .ce2-hd").click(); await pg.wait_for_timeout(400)
                res[f"콘티 쓰기 · {tag}"] = await pg.evaluate(JS, GROUPS); await b.close()
                b = await p.chromium.launch(executable_path=R.CHROME)
                ctx = await b.new_context(viewport={"width": 390 if mob else 1280, "height": 844}, has_touch=mob, is_mobile=mob)
                await ctx.route(re.compile(r"https?://(?!localhost).*"), lambda r: r.fulfill(body="", status=200))
                await ctx.route(re.compile(r".*supabase-js@2.*"), lambda r: r.fulfill(path=R.ROOT + "/dev/tests/v31/fake-sb.js", content_type="text/javascript"))
                await ctx.add_init_script(FIX)
                pg = await ctx.new_page()
                for h in ("schedule", "settings", "history", "attendance"):
                    await pg.goto(R.BASE + f"/admin.html#{h}"); await pg.wait_for_timeout(1500)
                    res[f"리더십 {h} · {'휴대폰' if mob else 'PC'}"] = await pg.evaluate(JS, GROUPS)
                # 팀원 화면 (찬양 › 콘티 · 백업찬양 · 기록 / 섬김 / 홈)
                pg = await ctx.new_page()
                for h in ("worship", "backup", "lineup", "home"):
                    await pg.goto(R.BASE + f"/me.html#{h}"); await pg.wait_for_timeout(1500)
                    res[f"팀원 {h} · {'휴대폰' if mob else 'PC'}"] = await pg.evaluate(JS, GROUPS)
                await b.close()
    finally: srv.terminate()
    for k, v in res.items():
        print("==", k)
        for g, m in v.items():
            for a, b in m.items(): print(f"  {g:10s} {a:16s} {b}")
asyncio.run(main())
