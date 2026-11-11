# v34.3 리더십 셸(B안) 화면 확인 — 실제 서버 없이 가짜 supabase(dev/tests/v31/fake-sb.js)로 admin.html을 열어 캡처해요.
#   python3 dev/v34/shell_shots.py [출력 폴더]   → PC 1280(펼침 · 접힘 · 떠 있는 메뉴) · 태블릿 820 · 휴대폰 390
import asyncio, os, re, subprocess, sys, time
from playwright.async_api import async_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/shell_shots"
PORT = 8933; BASE = f"http://localhost:{PORT}"
CHROME = os.popen("ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome | head -1").read().strip()
FIX = """window.FIX = { user: { id: 'u-adm', email: 'admin@x.com' }, rpc: { can_upload_sheet: true, conti_week: [], conti_one: null, my_pending_votes: [], is_admin: true }, tables: {
  members: [ { id: 'u-adm', name: '공준혁', email: 'admin@x.com', role: 'admin', is_active: true, status: 'active', main_position: 'leader', is_owner: true, must_change_password: false },
    { id: 'u-2', name: '김하람', role: 'member', is_active: true, status: 'active', main_position: 'singer' }, { id: 'u-3', name: '이서윤', role: 'member', is_active: true, status: 'trainee', main_position: 'key_main' } ],
  positions: [ { code: 'leader', name: '인도', kind: 'vocal', sort_order: 1 }, { code: 'singer', name: '싱어', kind: 'vocal', sort_order: 2 }, { code: 'key_main', name: '메인 건반', kind: 'band', sort_order: 3 } ],
  applications: [], message_log: [], member_extra_positions: [], interview_evaluations: [], message_templates: [], eval_items: [], trainee_postpones: [], alumni: [], guests: [], member_skills: [],
  team_meetings: [], services: [], availability_months: [], availability: [], team_settings: [{ id: 1 }], settings: [{ id: 1 }] } };"""
async def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=CHROME)
            async def shot(w, h, mobile, name, pre=None):
                ctx = await b.new_context(viewport={"width": w, "height": h}, has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
                await ctx.route(re.compile(r"https?://(?!localhost).*"), lambda r: r.fulfill(body="", status=200))
                await ctx.route(re.compile(r".*supabase-js@2.*"), lambda r: r.fulfill(path=os.path.join(ROOT, "dev/tests/v31/fake-sb.js"), content_type="text/javascript"))
                await ctx.add_init_script(FIX)
                if pre: await ctx.add_init_script(pre)
                pg = await ctx.new_page(); errs = []
                pg.on("pageerror", lambda e: errs.append(str(e)))
                pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)
                await pg.goto(BASE + "/admin.html#dashboard"); await pg.wait_for_timeout(1500)
                await pg.screenshot(path=f"{OUT}/{name}_dash.png")
                if errs: print("after load", pg.url, errs[:5])
                # 섬김 › 출석
                if w <= 760:
                    await pg.click('#adTab [data-area="serve"]'); await pg.wait_for_timeout(900)
                    await pg.click('#adSeg [data-nav-m="attendance"]'); await pg.wait_for_timeout(1200)
                else:
                    await pg.click('#adRail [data-area="serve"]'); await pg.wait_for_timeout(500)
                    a = pg.locator('#adItems a[data-nav="attendance"]')
                    if await a.is_visible(): await a.click()
                    else: await pg.evaluate("nav('attendance')")
                    await pg.wait_for_timeout(1200)
                await pg.screenshot(path=f"{OUT}/{name}_att.png")
                info = await pg.evaluate("""() => ({ hash: location.hash, on: [...document.querySelectorAll('#adItems a.on, #adTab .on, #adRailAreas .on')].map(e => e.textContent.trim()),
                    area: document.querySelector('#adAreaTitle')?.textContent, shut: document.querySelector('#adPw')?.classList.contains('shut'), scrollW: document.documentElement.scrollWidth, w: innerWidth })""")
                print(name, info, "ERR" if errs else "", errs[:3])
                return pg, ctx
            pg, ctx = await shot(1280, 820, False, "pc_open", "localStorage.setItem('pole2.adShut','0')")
            await pg.click("#adShut"); await pg.wait_for_timeout(500); await pg.screenshot(path=f"{OUT}/pc_shut.png")
            await pg.hover('#adRail [data-area="worship"]'); await pg.wait_for_timeout(400); await pg.screenshot(path=f"{OUT}/pc_fly.png")
            print("fly", await pg.evaluate("document.querySelector('#adFly').hidden"), await pg.evaluate("[...document.querySelectorAll('#adFly a')].map(a => a.textContent.trim())"))
            await pg.click('#adMe'); await pg.wait_for_timeout(300); await pg.screenshot(path=f"{OUT}/pc_me.png")
            await ctx.close()
            pg, ctx = await shot(820, 1180, True, "tab"); await ctx.close()
            pg, ctx = await shot(390, 844, True, "m")
            await pg.click("#adMeM"); await pg.wait_for_timeout(400); await pg.screenshot(path=f"{OUT}/m_me.png")
            await ctx.close()
            await b.close()
    finally: srv.terminate()
asyncio.run(main())
