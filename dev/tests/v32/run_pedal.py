# v32: 블루투스 페달 · 키보드로 악보 넘기기 (콘티 악보 보기 · 백업찬양 진행) — v31 시험 틀
import asyncio, os, subprocess, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../v31"))
import run as R
from playwright.async_api import async_playwright
IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
SYN = """([k, code, rep]) => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, repeat: !!rep });
  if (code) Object.defineProperty(e, 'keyCode', { get: () => code }); (document.activeElement || document.body).dispatchEvent(e); }"""

async def viewer(p):
    print("== 콘티 악보 보기: 페달 키")
    b, pg = await R.page(p, mobile=True, ua=IOS)
    await pg.goto(R.BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(400)
    await pg.evaluate("CONTI.openViewer({ id: 's1', date: '2026-11-07', setlist: null, proc: [], extras: [], applied: [] }, { items: [1,2,3,4,5].map((i) => ({ title: '곡' + i, key: 'G', src: [{ path: 'sheets/1/a.pdf', p: 1 }] })) })")
    await pg.wait_for_timeout(1500)
    cur = lambda: pg.evaluate("document.querySelector('.cv-viewer')._viewer.cur")
    R.check(await pg.evaluate("document.activeElement === document.querySelector('.cv-viewer')"), "열면 악보 화면에 포커스")
    async def press(k, want, msg):
        await pg.keyboard.press(k); await pg.wait_for_timeout(220); c = await cur(); R.check(c == want, f"{msg} → {c}")
    await press("ArrowDown", 1, "↓ 다음")
    await press("ArrowUp", 0, "↑ 이전")
    await press("PageDown", 1, "PageDown 다음")
    await press("Space", 2, "Space 다음")
    await press("Enter", 3, "Enter 다음")
    await press("ArrowLeft", 2, "← 이전")
    await press("PageUp", 1, "PageUp 이전")
    await pg.evaluate(SYN, ["UIKeyInputDownArrow", 0, False]); await pg.wait_for_timeout(220); R.check(await cur() == 2, "옛 iOS 키 이름 UIKeyInputDownArrow")
    await pg.evaluate(SYN, ["Unidentified", 33, False]); await pg.wait_for_timeout(220); R.check(await cur() == 1, "이름 없는 키는 keyCode (33 = PageUp)")
    await pg.evaluate(SYN, ["ArrowDown", 0, True]); await pg.wait_for_timeout(220); R.check(await cur() == 1, "누르고 있을 때 반복 키는 무시")
    await pg.keyboard.press("ArrowDown"); await pg.keyboard.press("ArrowDown"); await pg.wait_for_timeout(250)
    R.check(await cur() == 2, "한꺼번에 두 번 오면 한 번만")
    # 다른 곳(곡 띠)을 누른 뒤에도 페달이 그대로
    await pg.wait_for_timeout(200)
    await pg.click("[data-cvv-song='0']"); await pg.wait_for_timeout(300)
    await pg.evaluate("document.activeElement.blur()"); await pg.mouse.click(200, 400); await pg.wait_for_timeout(250)
    R.check(await pg.evaluate("document.activeElement === document.querySelector('.cv-viewer')"), "누른 뒤 다시 포커스")
    c0 = await cur(); await pg.keyboard.press("ArrowDown"); await pg.wait_for_timeout(220)
    R.check(await cur() == c0 + 1, "누른 뒤에도 페달로 넘김")
    # 단추에 포커스가 있으면 Enter는 그 단추 (이중 동작 없음)
    await pg.focus("[data-cvv-song='4']"); c0 = await cur(); await pg.keyboard.press("Enter"); await pg.wait_for_timeout(300)
    R.check(await cur() == 4, f"단추 포커스 + Enter → 그 단추만 ({c0}→{await cur()})")
    # 입력 칸에 쓰는 중에는 안 넘김
    await pg.evaluate("const i = document.createElement('input'); i.id = 'tx'; document.querySelector('.cv-viewer').appendChild(i); i.focus()")
    c0 = await cur(); await pg.keyboard.press("ArrowUp"); await pg.wait_for_timeout(220)
    R.check(await cur() == c0, "입력 칸에서는 넘기지 않음")
    await pg.evaluate("document.getElementById('tx').remove()")
    # 닫으면 키를 듣지 않음
    await pg.evaluate("CONTI.closeLayer()"); await pg.wait_for_timeout(300)
    await pg.keyboard.press("ArrowDown"); await pg.wait_for_timeout(200)
    errs = [e for e in pg.errs if "pdf" not in e.lower()]
    R.check(not errs, f"오류 없음 {errs}")
    await b.close()

async def backup_live(p):
    print("== 백업찬양 진행 화면: 페달 키")
    b, pg = await R.page(p, mobile=True, ua=IOS)
    await pg.goto(R.BASE + "/dev/tests/v31/harness.html"); await pg.wait_for_timeout(400)
    I = lambda n: "backup/%s.jpg" % (str(n) * 8 + "-1111-1111-1111-111111111111")
    await pg.evaluate("""(imgs) => { FIX.tables.backup_books = [];
      FIX.tables.backup_songs = [{ id: 10, book_id: null, code: 'x1', title: '사진 곡', pages: 3, images: imgs, hidden: false, norm: 'a' }];
      window.LIVE = { seq: 1, can_lead: true, candidates: [10], active: true, now: 'b:10', leader_id: 'u-lead', service_id: null };
      FIX.rpc.backup_state_live = () => window.LIVE; FIX.rpc.proc_on = []; FIX.rpc.backup_update = (a) => (window.LIVE = { ...window.LIVE, ...a.p }); }""", [I(1), I(2), I(3)])
    await pg.evaluate("BACKUP.mount(document.getElementById('root'), { me: { id: 'u-lead' } }).then(() => BACKUP.openLive())"); await pg.wait_for_timeout(1500)
    pgn = lambda: pg.evaluate("BACKUP._test.B.pg")
    R.check(await pg.locator(".bk-live").count() == 1, "진행 화면 열림")
    await pg.keyboard.press("ArrowDown"); await pg.wait_for_timeout(220); R.check(await pgn() == 1, "↓ 다음 쪽")
    await pg.keyboard.press("Space"); await pg.wait_for_timeout(220); R.check(await pgn() == 2, "Space 다음 쪽 (예전엔 안 됨)")
    await pg.keyboard.press("ArrowUp"); await pg.wait_for_timeout(220); R.check(await pgn() == 1, "↑ 이전 쪽")
    errs = [e for e in pg.errs if "pdf" not in e.lower()]
    R.check(not errs, f"오류 없음 {errs}")
    await b.close()

async def main():
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(R.PORT), "-d", R.ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            for t in [viewer, backup_live]:
                try: await t(p)
                except Exception as e: R.check(False, f"{t.__name__} 예외: {e}")
    finally: srv.kill()
    print(f"ok {R.ok} bad {R.bad}")
if __name__ == "__main__": asyncio.run(main())
