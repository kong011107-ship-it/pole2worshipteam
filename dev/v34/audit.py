# v34.3 크기 점검 — 실제 스택(데이터 있음)에서 모든 화면의 단추 · 입력칸 크기를 재요.
#   준비: 스택 + 데이터(예: e2e_v29.py를 한 번 돌린 뒤)  →  python3 dev/v34/audit.py [출력.json]
#   단추: 종류(주 행동 · 줄 안 · 키 · 탭 · 세그먼트 · 하단 탭 · 아이콘 · 칩 · 기타)별 '글자/굵기/높이' 조합과 예
#   입력칸: input · select · textarea 글자 크기(16 미만이면 아이폰이 확대) · 높이
import asyncio, json, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tests"))
from playwright.async_api import async_playwright
from h import BASE, browser, login, navclick
PW = "pole2test!"
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/audit.json"
JS = r"""(screen) => {
  const vis = (e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false; const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0; };
  const kind = (e) => {
    if (e.closest('.bk-live, .cv-viewer .cvv-bar, .ink-bar, .iv-host, .metro, .pedal-host .pd-')) return '예외(악보 · 진행)';
    if (e.closest('.ad-tabin, .tabbar') || e.matches('.ad-tb')) return '하단 탭';
    if (e.closest('#adRail') && e.matches('.ad-rb')) return '레일';
    if (e.matches('.ad-pi, .ad-fi')) return '메뉴 항목';
    if (e.closest('.ce2-keys')) return '키 단추';
    if (e.closest('.tabs')) return '밑줄 탭';
    if (e.closest('.segbar, .u-seg, .ce2-tabs')) return '세그먼트';
    if (e.matches('.btn-sm, .u-sm')) return '줄 안 단추';
    if (e.matches('.btn, .u-b, .btn-block')) return '주 행동';
    if (e.matches('.ad-ib, .icon-btn, .u-ib, [aria-label]') && !(e.textContent || '').trim()) return '아이콘';
    if (e.closest('.seg, .chips, .u-chips') || e.matches('.chip, .u-chip')) return '칩(필터)';
    return '기타';
  };
  const B = [], I = [];
  document.querySelectorAll('button, a.btn, a.u-b, a.btn-sm, [role=button], [role=tab]').forEach((e) => {
    if (!vis(e)) return; const cs = getComputedStyle(e), r = e.getBoundingClientRect();
    B.push({ screen, kind: kind(e), fs: parseFloat(cs.fontSize), fw: +cs.fontWeight, h: Math.round(r.height), t: (e.textContent || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 16), cls: (e.className && e.className.baseVal === undefined ? e.className : '').split(' ').slice(0, 2).join('.') });
  });
  document.querySelectorAll('input, select, textarea').forEach((e) => {
    if (['checkbox', 'radio', 'hidden', 'range', 'file', 'color', 'submit', 'button'].includes(e.type) || !vis(e)) return;
    const cs = getComputedStyle(e), r = e.getBoundingClientRect();
    I.push({ screen, tag: e.tagName.toLowerCase() + (e.type && e.tagName === 'INPUT' ? ':' + e.type : ''), fs: parseFloat(cs.fontSize), h: Math.round(r.height), id: e.id || e.name || e.placeholder?.slice(0, 14) || '', cls: (e.className || '').split(' ').slice(0, 2).join('.') });
  });
  return { B, I };
}"""
R = {"B": [], "I": []}
async def grab(pg, name):
    await pg.wait_for_timeout(900)
    try:
        r = await pg.evaluate(JS, name); R["B"] += r["B"]; R["I"] += r["I"]
    except Exception as e: print("ERR", name, e)
async def clicks(pg, sel, name, back=None):
    loc = pg.locator(sel)
    if await loc.count():
        try:
            await loc.first.click(); await grab(pg, name)
        except Exception as e: print("skip", name, str(e)[:80])
        if back: await back()
async def esc(pg): await pg.keyboard.press("Escape"); await pg.wait_for_timeout(300)
ADMIN = ["dashboard", "schedule", "lineup", "attendance", "conti", "songs", "history", "members", "pipeline", "forecast", "notify", "sharing", "settings"]
EXTRA = ["respond", "templates", "backup", "audit"]
async def main():
    async with async_playwright() as p:
        for mob in (False, True):
            tag = "휴대폰" if mob else "PC"
            # 리더십
            b, ctx = await browser(p, mobile=mob)
            pg = await login(ctx, "admin@x.com", "adminpass")
            for k in ADMIN:
                try: await navclick(pg, k)
                except Exception: await pg.evaluate(f"nav('{k}')")
                await pg.wait_for_timeout(1200); await grab(pg, f"리더십 {k} · {tag}")
            for k in EXTRA:
                await pg.evaluate(f"nav('{k}')"); await pg.wait_for_timeout(1200); await grab(pg, f"리더십 {k} · {tag}")
            await pg.evaluate("nav('members')"); await pg.wait_for_timeout(1200)
            await clicks(pg, "#content [data-mid], #content .mrow, #content a[href^='#member/']", f"리더십 멤버 상세 · {tag}")
            await pg.evaluate("nav('notify')"); await pg.wait_for_timeout(1200)
            await pg.evaluate("nav('songs')"); await pg.wait_for_timeout(1500)
            await clicks(pg, "#content [data-song], #content .song-row", f"리더십 곡 상세 · {tag}", lambda: esc(pg))
            await b.close()
            # 팀원 (인도자: 콘티 쓰기까지)
            b, ctx = await browser(p, mobile=mob)
            pg = await login(ctx, "demo01@pole2.test", PW, dest=None)
            for h in ("home", "worship", "serve", "share", "info"):
                await pg.goto(BASE + f"/me.html#{h}"); await pg.wait_for_timeout(1500); await grab(pg, f"팀원 {h} · {tag}")
            await pg.goto(BASE + "/me.html#worship"); await pg.wait_for_timeout(1500)
            for ws in ("backup", "history"):
                await clicks(pg, f'#worshipNav [data-ws="{ws}"]', f"팀원 찬양 {ws} · {tag}")
            await clicks(pg, '#worshipNav [data-ws="conti"]', f"팀원 찬양 콘티 · {tag}")
            await clicks(pg, "[data-cv-edit]", f"콘티 쓰기 · {tag}")
            if await pg.locator(".cv-editor").count():
                await clicks(pg, ".ce-row .ce2-hd", f"콘티 쓰기 곡 펼침 · {tag}")
                for t in ("sheet", "ref", "prev"):
                    await clicks(pg, f'.ce-row [data-ce="tab"][data-tab="{t}"]', f"콘티 쓰기 탭 {t} · {tag}")
                await clicks(pg, "#ceDrop .ce2-sugh", f"콘티 쓰기 추천 서랍 · {tag}")
                await clicks(pg, "[data-ce=publish]", f"콘티 쓰기 올리기 확인 창 · {tag}")
            await b.close()
            # 로그인 · 지원서 · 첫 화면
            b, ctx = await browser(p, mobile=mob); pg = await ctx.new_page()
            for f in ("login.html", "apply.html", "index.html"):
                await pg.goto(BASE + "/" + f); await pg.wait_for_timeout(1200); await grab(pg, f"{f} · {tag}")
            await b.close()
    json.dump(R, open(OUT, "w"), ensure_ascii=False)
    # 요약
    from collections import defaultdict
    g = defaultdict(lambda: defaultdict(list))
    for x in R["B"]: g[x["kind"]][f'{x["fs"]:g}px/{x["fw"]}/{x["h"]}h'].append(x)
    print("== 단추 (종류 · 글자/굵기/높이 · 개수 · 예)")
    for k in sorted(g):
        for combo, xs in sorted(g[k].items(), key=lambda kv: -len(kv[1])):
            ex = " | ".join(sorted({f'{x["t"]}〔{x["cls"]}〕@{x["screen"]}' for x in xs})[:3])
            print(f"  {k:9s} {combo:16s} {len(xs):4d}  {ex}")
    gi = defaultdict(list)
    for x in R["I"]: gi[f'{x["fs"]:g}px/{x["h"]}h {x["tag"]}'].append(x)
    print("== 입력칸 (글자/높이 · 종류 · 개수 · 예)")
    for combo, xs in sorted(gi.items(), key=lambda kv: (float(kv[0].split("px")[0]), -len(kv[1]))):
        ex = " | ".join(sorted({f'{x["id"]}〔{x["cls"]}〕@{x["screen"]}' for x in xs})[:3])
        print(f"  {combo:28s} {len(xs):4d}  {ex}")
asyncio.run(main())
