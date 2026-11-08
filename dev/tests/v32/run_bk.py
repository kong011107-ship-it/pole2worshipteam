# v32: 백업찬양 직접 더한 곡 고치기 · 지우기 (인도자 화면 · 리더십 관리 화면) — v31 시험 틀(가짜 sb) 그대로
import asyncio, os, subprocess, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../v31"))
import run as R
from playwright.async_api import async_playwright
PNG = os.path.join(os.path.dirname(__file__), "p.png")
I = lambda n: "backup/%s.jpg" % (str(n) * 8 + "-1111-1111-1111-111111111111")
SETUP = """FIX.tables.backup_books = [{ id: 1, active: true, label: 'Ver.2605', path: 'books/1.pdf' }];
  FIX.tables.backup_songs = [1,2,3].map((i) => ({ id: i, book_id: 1, code: 'g' + i + '1', title: '곡' + i, key: 'g', topic: i, page: i, pages: 1, hidden: false, norm: 'n' + i }))
    .concat([{ id: 10, book_id: null, code: 'x1', title: '사진 곡', key: null, topic: null, pages: 2, images: ['%s', '%s'], hidden: false, norm: '사진곡' },
             { id: 11, book_id: null, code: 'x2', title: '숨긴 곡', key: null, topic: null, pages: 1, images: ['%s'], hidden: true, norm: '숨긴곡' }]);
  window.LIVE = { seq: 1, can_lead: true, candidates: [10, 1], pub_candidates: [10, 1], active: false, confirmed: true };
  FIX.tables.backup_bpm = [{ code: 'x1', bpm: 72, meter: '4/4' }];
  FIX.rpc.backup_state_live = () => window.LIVE; FIX.rpc.proc_on = [];
  FIX.rpc.backup_update = (a) => (window.LIVE = { ...window.LIVE, ...a.p, seq: window.LIVE.seq + 1 });
  FIX.rpc.backup_edit_custom = (a) => { const i = FIX.tables.backup_songs.findIndex((x) => x.id === a.p_id), s = (FIX.tables.backup_songs[i] = { ...FIX.tables.backup_songs[i] });
    Object.assign(s, { title: a.p_title, key: a.p_key, topic: a.p_topic, code: a.p_code || s.code, images: a.p_images || s.images, pages: (a.p_images || s.images).length }); return { ...s }; };
  FIX.rpc.backup_delete_custom = (a) => { FIX.tables.backup_songs = FIX.tables.backup_songs.filter((x) => x.id !== a.p_id);
    window.LIVE = { ...window.LIVE, candidates: window.LIVE.candidates.filter((x) => x !== a.p_id), pub_candidates: window.LIVE.pub_candidates.filter((x) => x !== a.p_id), seq: window.LIVE.seq + 1 }; return window.LIVE; };
  0;""" % (I(1), I(2), I(3))
rpcs = lambda pg, n: pg.evaluate(f"CALLS.filter((c) => c.name === '{n}').map((c) => c.args)")

async def leader(p):
    print("== 인도자 화면: 직접 더한 곡 고치기 · 지우기")
    b, pg = await R.page(p, mobile=True, w=430)
    await pg.goto(R.BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(400)
    await pg.evaluate(SETUP)
    await pg.evaluate("BACKUP.mount(document.getElementById('root'), { me: { id: 'u-lead' } })"); await pg.wait_for_timeout(800)
    R.check(await pg.locator("[data-bk-ed]").count() == 1, "고치기는 직접 더한 곡에만 (숨긴 곡 · 악보집 곡 없음)")
    await pg.click("[data-bk-ed='10']"); await pg.wait_for_timeout(300)
    f = pg.locator(".bk-edit")
    R.check(await f.count() == 1 and await f.locator("#bkAT").input_value() == "사진 곡" and await f.locator("#bkAC").input_value() == "x1", "고치기 창: 지금 값")
    R.check(await pg.evaluate("document.activeElement.id") == "bkAT", "곡 이름 칸에 바로")
    await f.scroll_into_view_if_needed(); await pg.screenshot(path="/tmp/v32_bk_edit.png")
    await f.locator("#bkAT").fill("사진 곡 새 이름")
    await f.locator("#bkAK").select_option("a"); await f.locator("#bkATp").select_option("1"); await pg.wait_for_timeout(100)
    h = await f.locator("#bkACh").inner_text()
    R.check("a10" in h and await f.locator("[data-bke-code]").count() == 1, f"키 · 주제에 맞는 코드 추천 ({h})")
    # 몇 초마다 다시 그려져도 입력 · 포커스 그대로
    await f.locator("#bkAT").focus()
    await pg.evaluate("window.LIVE = { ...window.LIVE, seq: 9 }; BACKUP.refresh()"); await pg.wait_for_timeout(400)
    R.check(await pg.locator(".bk-edit #bkAT").input_value() == "사진 곡 새 이름" and await pg.evaluate("document.activeElement.id") == "bkAT", "다시 그려도 쓰던 값 · 포커스 그대로")
    await pg.click(".bk-edit [data-bke-code]")
    R.check(await pg.locator(".bk-edit #bkAC").input_value() == "a10", "추천 코드로 바꾸기")
    await pg.locator(".bk-edit #bkAC").fill("g11"); await pg.wait_for_timeout(100)
    R.check("이미 있는" in await pg.locator(".bk-edit #bkACh").inner_text(), "겹치는 코드 알림")
    await pg.click(".bk-edit [data-bke='save']"); await pg.wait_for_timeout(300)
    R.check(len(await rpcs(pg, "backup_edit_custom")) == 0, "겹치면 저장 안 함")
    await pg.locator(".bk-edit #bkAC").fill("a10")
    # 사진: 뒤에 이어 붙이기
    await pg.locator(".bk-edit #bkAF").set_input_files([PNG]); await pg.wait_for_timeout(200)
    R.check(await pg.locator(".bk-edit .bk-emode").is_visible(), "사진 고르면 '전부 바꾸기 / 이어 붙이기'")
    await pg.locator(".bk-edit input[value=append]").check(); await pg.wait_for_timeout(100)
    R.check("앞쪽 필기는 그대로" in await pg.locator(".bk-edit #bkAP").inner_text(), "이어 붙이기 안내")
    await pg.click(".bk-edit [data-bke='save']"); await pg.wait_for_timeout(900)
    a = (await rpcs(pg, "backup_edit_custom"))[-1]
    R.check(a["p_title"] == "사진 곡 새 이름" and a["p_key"] == "a" and a["p_topic"] == 1 and a["p_code"] == "a10", f"저장 값 {a}")
    R.check(len(a["p_images"]) == 3 and a["p_images"][:2] == [I(1), I(2)] and a["p_images"][2].startswith("backup/"), "사진 3장 (앞 2장 그대로)")
    R.check(await pg.locator(".bk-edit").count() == 0, "저장하면 창 닫힘")
    R.check("a10" in await pg.locator(".bk-slot[data-slot='10']").inner_text(), "후보 칸에도 새 코드")
    R.check(await pg.evaluate("BACKUP._test.B.bpm.a10?.bpm") == 72, "BPM도 새 코드로")
    # 취소
    await pg.click("[data-bk-ed='10']"); await pg.click(".bk-edit [data-bke='cancel']"); await pg.wait_for_timeout(200)
    R.check(await pg.locator(".bk-edit").count() == 0, "취소")
    # 곡 더하기를 열면 고치기는 닫힘
    await pg.click("[data-bk-ed='10']"); await pg.click("[data-bk='add']"); await pg.wait_for_timeout(200)
    R.check(await pg.locator(".bk-edit").count() == 0 and await pg.locator("#bkAddSlot .bk-add").count() == 1, "더하기 · 고치기는 하나만")
    await pg.click("[data-bk='add']")
    # 지우기: 기도회 중 후보면 막힘
    await pg.evaluate("window.LIVE = { ...window.LIVE, active: true, seq: 20 }; BACKUP.refresh()"); await pg.wait_for_timeout(300)
    await pg.click("[data-bk-ed='10']"); await pg.click(".bk-edit [data-bke='del']"); await pg.wait_for_timeout(300)
    R.check(len(await rpcs(pg, "backup_delete_custom")) == 0, "기도회 중 후보는 지우지 않음")
    await pg.evaluate("window.LIVE = { ...window.LIVE, active: false, seq: 21 }; BACKUP.refresh()"); await pg.wait_for_timeout(300)
    if not await pg.locator(".bk-edit").count(): await pg.click("[data-bk-ed='10']")
    await pg.click(".bk-edit [data-bke='del']"); await pg.wait_for_timeout(600)
    R.check(len(await rpcs(pg, "backup_delete_custom")) == 1, "지우기 (확인 뒤)")
    R.check(await pg.locator("[data-bk-ed]").count() == 0 and await pg.locator(".bk-slot[data-slot='10']").count() == 0, "목록 · 후보에서 사라짐")
    R.check(await pg.evaluate("BACKUP._test.B.live.candidates") == [1], "후보 [1]")
    errs = [e for e in pg.errs if "pdf" not in e.lower()]
    R.check(not errs, f"오류 없음 {errs}")
    await pg.screenshot(path="/tmp/v32_bk_leader.png")
    await b.close()

async def admin(p):
    print("== 리더십 관리 화면: 이미지로 더한 곡 고치기 · 지우기")
    b, pg = await R.page(p, w=1100)
    await pg.goto(R.BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(400)
    await pg.evaluate(SETUP + "FIX.tables.worship_proc = [];")
    await pg.evaluate("BACKUP.mountAdmin(document.getElementById('root'))"); await pg.wait_for_timeout(800)
    R.check(await pg.locator("[data-bka='cedit']").count() == 2, "이미지로 더한 곡 2곡(숨긴 곡 포함)에 고치기")
    await pg.click("#bkAdmin summary")
    await pg.click("[data-bka='cedit'][data-id='11']"); await pg.wait_for_timeout(300)
    R.check(await pg.locator(".bk-edit").count() == 1 and await pg.locator(".bk-edit #bkAT").input_value() == "숨긴 곡", "줄 아래 고치기 창")
    await pg.screenshot(path="/tmp/v32_bk_admin.png")
    await pg.locator(".bk-edit #bkAT").fill("숨긴 곡 2")
    await pg.click(".bk-edit [data-bke='save']"); await pg.wait_for_timeout(800)
    R.check((await rpcs(pg, "backup_edit_custom"))[-1]["p_title"] == "숨긴 곡 2", "저장")
    R.check("숨긴 곡 2" in await pg.inner_text("#bkAdmin") and await pg.locator("#bkAdmin details[open]").count() == 1, "다시 그려도 목록 펼친 채")
    await pg.click("[data-bka='cedit'][data-id='11']"); await pg.click(".bk-edit [data-bke='del']"); await pg.wait_for_timeout(800)
    R.check((await rpcs(pg, "backup_delete_custom"))[-1]["p_id"] == 11 and await pg.locator("[data-bka='cedit']").count() == 1, "지우기 → 목록에서 빠짐")
    # 같은 단추를 다시 누르면 닫힘
    await pg.click("[data-bka='cedit'][data-id='10']"); await pg.click("[data-bka='cedit'][data-id='10']"); await pg.wait_for_timeout(200)
    R.check(await pg.locator(".bk-edit").count() == 0, "다시 누르면 닫힘")
    errs = [e for e in pg.errs if "pdf" not in e.lower()]
    R.check(not errs, f"오류 없음 {errs}")
    await b.close()

async def main():
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(R.PORT), "-d", R.ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            for t in [leader, admin]:
                try: await t(p)
                except Exception as e: R.check(False, f"{t.__name__} 예외: {e}")
    finally: srv.kill()
    print(f"ok {R.ok} bad {R.bad}")
if __name__ == "__main__": asyncio.run(main())
