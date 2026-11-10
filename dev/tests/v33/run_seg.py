# v33: 실연주 구간 종류 — 곡 실연주는 solo만 · 메들리 실연주(묶음 시간) · 콘티 쓰기 메들리 RT · '시간 제외' 표시 (v31 시험 틀 · 가짜 sb)
import asyncio, json, os, subprocess, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../v31"))
import run as R
from playwright.async_api import async_playwright
FIX = """FIX.rpc.history_bundle = { songs: [{ id: 1, title: '은혜', main_key: 'G' }, { id: 2, title: '주님의 마음', main_key: 'A' }, { id: 3, title: '예수 피를 힘입어', main_key: 'D' }],
  setlists: [{ d: '2026-08-30', leaders: ['김철수'], note: '', items: [[1, 1, 'G', false, [], null], [2, 2, 'A', true, [], null], [3, 3, 'D', true, [], null]] },
             { d: '2026-10-25', leaders: ['공준혁'], note: '', items: [[1, 1, 'G', false, [], null], [2, 2, 'A', true, [], null], [3, 3, 'D', true, [], null]] },
             { d: '2026-11-01', leaders: ['이영희'], note: '', items: [[1, 1, 'G', false, [], null], [2, 2, 'A', false, [], null]] }], lineup: [], applied: [] };
// 8/30: 2+3 메들리를 한 구간(420초) · 10/25: 2+3을 곡마다 나눔(합 440초) · 11/1: 1 단독 300초, 2는 숨은 곡 의심(unsure)
FIX.rpc.video_bundle = { videos: [['VID00000001', '2026-08-30', 1800, '8/30', '2026-09-01T00:00:00Z', true], ['VID00000002', '2026-10-25', 1800, '10/25', '2026-10-26T00:00:00Z', true], ['VID00000003', '2026-11-01', 1800, '11/1', '2026-11-02T00:00:00Z', true]],
  songs: [['VID00000001', 1, 0, 320, false, true, 'solo', null, null], ['VID00000001', 2, 320, 740, true, true, 'medley', '2+3', 420], ['VID00000001', 3, 320, 740, true, true, 'medley', '2+3', 420],
          ['VID00000002', 1, 0, 900, false, true, 'odd', null, null], ['VID00000002', 2, 900, 1100, true, true, 'split', '2+3', 440], ['VID00000002', 3, 1100, 1340, true, true, 'split', '2+3', 440],
          ['VID00000003', 1, 0, 300, false, true, 'solo', null, null], ['VID00000003', 2, 300, 900, false, true, 'unsure', null, null]] };
0;"""

async def data(p):
    print("== 기록: 곡 실연주는 solo만 · 메들리 묶음 시간")
    b, pg = await R.page(p, mobile=True)
    await pg.goto(R.BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(400)
    await pg.evaluate(FIX)
    D = await pg.evaluate("HISTORY.load().then((D) => ({ l1: HISTORY.liveSec(D, 1), l2: HISTORY.liveSec(D, 2), l3: HISTORY.liveSec(D, 3), m: HISTORY.medleyLiveSec(D, [2, 3]), m1: HISTORY.medleyLiveSec(D, [3, 2]), seg: HISTORY.perfs(D, 2, '').map((x) => x.seg) }))")
    R.check(D["l1"] == {"sec": 310, "n": 2}, f"곡 1: solo 2번만(길이 이상 10/25 빼고) 중간값 310 {D['l1']}")
    R.check(D["l2"] is None and D["l3"] is None, f"메들리에 든 곡(묶음 · 나눔) · 숨은 곡 의심은 곡 시간 없음 {D['l2']} {D['l3']}")
    R.check(D["m"] == {"sec": 430, "n": 2}, f"메들리 2+3: 한 구간(420) · 나눔(440) 모두 → 중간값 430 {D['m']}")
    R.check(D["m1"] is None, "순서가 다르면 다른 메들리")
    R.check(sorted(D["seg"]) == ["medley", "split", "unsure"], f"이전 연주에 구간 종류 {D['seg']}")
    R.check(not [e for e in pg.errs if "pdf" not in e.lower()], f"오류 없음 {pg.errs}")
    await b.close()

async def editor(p):
    print("== 콘티 쓰기: 메들리 RT = 메들리 실연주 · '시간 제외'")
    b, pg = await R.page(p, mobile=True, w=430)
    await pg.goto(R.BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(400)
    await pg.evaluate(FIX)
    await pg.evaluate("CONTI.openEditor('s1')"); await pg.wait_for_timeout(900)
    for q, sid in [("주님의", 2), ("예수", 3)]:
        await pg.fill("#ceQ", q); await pg.wait_for_timeout(300)
        await pg.click(f"[data-add='{sid}']"); await pg.wait_for_timeout(600)
    R.check(await pg.locator(".ce-row").count() == 2, "곡 2개")
    durs = [x.strip() for x in await pg.locator(".ce-row .ce2-dur").all_text_contents()]   # v34.2: 접힌 줄의 시간
    R.check(durs == ["–", "–"], f"따로 넣으면 메들리에서만 부른 곡이라 실연주 시간 없음 {durs}")
    await pg.locator(".ce-row").nth(1).locator("[data-ce='join']").click(); await pg.wait_for_timeout(600)   # v34.2: 곡 사이 '이어서 부르기'
    head = pg.locator(".ce-row").first
    await head.locator(".ce2-hd").click(); await pg.wait_for_timeout(300)
    v = await head.locator("[data-f='dur']").input_value()
    R.check(v == "7:10" and "실연주" in await head.locator(".ce-src").inner_text(), f"이어서 켜면 묶음 시간 = 메들리 실연주 7:10 (출처 '실연주') {v}")
    await pg.click("[data-ce='publish']"); await pg.wait_for_timeout(400)
    await pg.locator(".ce2-pub [data-pub-copy]").uncheck(); await pg.click("[data-pub='go']"); await pg.wait_for_timeout(900)   # v34.2: 올리기 전 확인
    calls = await pg.evaluate("CALLS.filter(c => c.kind === 'rpc' && c.name === 'save_setlist')")
    its = calls[-1]["args"]["p_data"]["items"] if calls else []
    R.check(len(its) == 2 and its[0].get("duration_sec") == 430 and its[0].get("duration_src") == "live" and its[1].get("duration_src") == "medley", f"저장: 머리 430 'live' · 뒤 곡 'medley' {[(i.get('duration_sec'), i.get('duration_src')) for i in its]}")
    await pg.evaluate("CONTI.openEditor('s1')"); await pg.wait_for_timeout(900)
    await pg.fill("#ceQ", "주님의"); await pg.wait_for_timeout(300)
    await pg.click("[data-ce-prev='2']"); await pg.wait_for_timeout(300)
    t = await pg.inner_text(".ce-pvbox")
    R.check("시간 제외" in t and "메들리" in t, "이전 연주: 메들리 · 시간 제외 표시")
    await pg.screenshot(path="/tmp/v33_prev.png")
    R.check(not [e for e in pg.errs if "pdf" not in e.lower()], f"오류 없음 {pg.errs}")
    await b.close()

async def main():
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(R.PORT), "-d", R.ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            for t in [data, editor]:
                try: await t(p)
                except Exception as e: R.check(False, f"{t.__name__} 예외: {e}")
    finally: srv.kill()
    print(f"ok {R.ok} bad {R.bad}")
if __name__ == "__main__": asyncio.run(main())
