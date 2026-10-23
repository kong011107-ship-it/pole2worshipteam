import asyncio, os, base64, io, random
from PIL import Image, ImageDraw
from playwright.async_api import async_playwright
FX = "/home/claude/tests/fx/"
os.makedirs(FX, exist_ok=True)
def page(body, bg="#fff"): return f'<section style="page-break-after:always;height:270mm;background:{bg};padding:20mm;box-sizing:border-box;font-family:sans-serif">{body}</section>'
def staff(n=8, c="#000"):
    return "".join(f'<div style="margin:14px 0;border-top:1px solid {c};border-bottom:1px solid {c};height:24px"></div>' for _ in range(n))
async def pdf(pg, name, html):
    await pg.set_content(f"<html><body style='margin:0'>{html}</body></html>")
    await pg.pdf(path=FX + name, format="A4", print_background=True, margin={"top":"0","bottom":"0","left":"0","right":"0"})
async def main():
    async with async_playwright() as p:
        exe = os.popen("ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome | head -1").read().strip()
        b = await p.chromium.launch(executable_path=exe); pg = await b.new_page()
        await pdf(pg, "conti5.pdf", "".join(page(f"<h1>곡 {i}</h1>" + staff()) for i in range(1, 6)))
        await pdf(pg, "conti5b.pdf", "".join(page(f"<h1 style='font-size:60px'>다른 {i}</h1><div style='height:400px;background:#333'></div>" + staff(4), "#eee") for i in range(1, 6)))
        await pdf(pg, "proc.pdf", page("<h1>축도송</h1>" + staff()))
        songs = [("g40","비 준비하시니"),("g51","주의 이름 높이며"),("f40","비 준비하시니"),("g54","오직 주의 사랑에 매여"),("e50","나의 안에 거하라"),("g56","주 품에")]
        body = page("<h1>백업찬양 악보집 Ver.2605</h1>") + page("<h2>목차</h2><p>g40 비 준비하시니 · g51 주의 이름 높이며 · f40</p>")
        body += "".join(page(f"<div style='font-size:22px'>{c} {t}</div>" + staff()) for c, t in songs)
        await pdf(pg, "book.pdf", body)
        # big: 노이즈 이미지로 5MB 넘게
        imgs = ""
        for i in range(4):
            im = Image.frombytes("RGB", (1400, 1900), os.urandom(1400*1900*3)); bio = io.BytesIO(); im.save(bio, "JPEG", quality=92)
            imgs += page(f"<img style='width:100%' src='data:image/jpeg;base64,{base64.b64encode(bio.getvalue()).decode()}'>")
        await pdf(pg, "big.pdf", imgs)
        await b.close()
    for n, c in [("ap1.jpg", (230, 220, 250)), ("ap2.jpg", (250, 240, 220))]:
        im = Image.new("RGB", (1200, 1600), c); d = ImageDraw.Draw(im)
        for y in range(200, 1500, 60): d.line((80, y, 1120, y), fill=(0, 0, 0), width=3)
        im.save(FX + n, "JPEG")
    im = Image.new("RGB", (900, 1200), "white"); d = ImageDraw.Draw(im)
    for y in range(150, 1100, 50): d.line((60, y, 840, y), fill=(0, 0, 0), width=2)
    im.save(FX + "bk1.png")
asyncio.run(main())
