// =====================================================================
//  섬김이 팀 공유 화면 (025) — share.html?t=링크
//  로그인 없이 보기만: 다가오는 예배 콘티(곡 순서 · 키 · BPM · 악보 + 공유 필기) · 적용찬양 · 예배 진행곡 · 백업찬양
//  백업찬양 기도회 중에는 지금 곡 · 다음 곡이 몇 초마다 바뀌어요. 라인업 · 멤버 정보 · 내 메모 · 고치기는 없어요.
//  데이터는 /api/conti { action: "share" | "share-live", t } — 악보 파일은 서명된 주소(6시간)로 받아요
// =====================================================================
(function () {
  const T = new URLSearchParams(location.search).get("t") || "";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const md = (iso) => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;
  const mdw = (iso) => `${md(iso)}(${DOW[new Date(iso + "T00:00:00Z").getUTCDay()]})`;
  const hm = (t) => (t ? String(t).slice(0, 5) : "");
  const kdt = (iso) => { const k = new Date(Date.parse(iso) + 9 * 3600e3).toISOString(); return `${md(k.slice(0, 10))} ${k.slice(11, 16)}`; };
  const PROC = { blessing: ["축복송", "축복"], communion: ["성찬 찬양 1", "성찬 1"], communion2: ["성찬 찬양 2", "성찬 2"], offering: ["봉헌송", "봉헌"], benediction: ["축도송", "축도"], entrance: ["등단송", "등단"] };
  const LS = `pole2.share.${T.slice(0, 8)}`;
  const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const S = { data: null, focus: null, ver: null, live: null, viewer: null, offline: false, loading: false };
  const toast = (msg, ms = 2600) => { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); };

  async function api(action) {
    const r = await fetch("/api/conti", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, t: T }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || "불러오지 못했어요"); e.status = r.status; throw e; }
    return j;
  }
  async function load(quiet) {
    if (S.loading) return; S.loading = true;
    try {
      S.data = await api("share"); S.offline = false;
      ls.set(LS, { data: S.data, at: Date.now() });
      const lv = await api("share-live").catch(() => null); if (lv) { S.ver = lv.ver; S.live = lv; }
    } catch (e) {
      if (e.status === 404) { S.loading = false; return dead(e.message); }
      const c = ls.get(LS); if (!c) { S.loading = false; return dead("인터넷 연결을 확인해 주세요."); }
      S.data = c.data; S.offline = true;
    }
    S.loading = false;
    if (!S.data.services.some((s) => s.id === S.focus)) S.focus = (S.data.services.find((s) => s.setlist) || S.data.services[0])?.id || null;
    render();
    if (S.viewer) S.viewer.refresh();
    if (!quiet) poll();
  }
  function dead(msg) {
    $("#shMain").innerHTML = `<div class="empty"><b>이 링크로는 볼 수 없어요</b><br>${esc(msg)}</div>`;
    clearTimeout(S.timer);
  }

  // ------------------------------------------------------------------ 화면
  function render() {
    const D = S.data, f = D.services.find((s) => s.id === S.focus);
    $("#shLabel").textContent = `${D.label} · 보기 전용`;
    document.title = `${D.label} · 예배 콘티`;
    const bk = D.backup, lv = S.live || bk;
    const songOf = (ref) => (ref?.startsWith("b:") ? bk.songs.find((x) => x.id === +ref.slice(2)) : null);
    const refText = (ref) => { if (!ref) return ""; const s = songOf(ref); if (s) return `${s.code} ${s.title}`; const k = ref.slice(2); return PROC[k]?.[0] || "예배 진행곡"; };
    const items = f?.setlist?.items || [];
    const sc = f?.setlist?.sheet_changes, ch = f?.setlist?.changes;
    $("#shMain").innerHTML = `${S.offline ? `<div class="notice warn">인터넷 연결이 없어 저장해 둔 콘티를 보여 줘요.</div>` : ""}
      ${lv.active ? `<button type="button" class="bk-livecard" data-sh="live"><span class="bk-dot"></span><span><b>백업찬양 진행 중</b><small>지금 ${esc(refText(lv.now) || "준비 중")}${lv.next ? ` · 다음 ${esc(refText(lv.next))}` : ""}</small></span><span class="btn btn-primary btn-sm">악보 따라 보기</span></button>` : ""}
      ${D.services.length > 1 ? `<div class="chips2 shv-svcs">${D.services.map((s) => `<button type="button" data-sv="${s.id}" aria-pressed="${s.id === S.focus}">${mdw(s.date)} ${esc(s.title)}</button>`).join("")}</div>` : ""}
      ${f ? `<section class="hero cv-hero"><span class="eyebrow">${f.date === D.today ? "오늘" : "다가오는 예배"} · ${mdw(f.date)}${f.start_time ? ` ${hm(f.start_time)}` : ""}</span>
          <span class="big">${f.ministry ? esc(f.title) : `${md(f.date)} 주일`} 콘티</span>
          <div class="pills">${f.communion ? "<span>성찬식 주일</span>" : ""}${items.length ? `<span>${items.length}곡</span>` : ""}</div></section>
        ${f.setlist ? `<button type="button" class="cv-pdfbar" data-sh="open"><span class="cv-pdfic">PDF</span><span class="cv-pdft"><b>악보 보기</b><span class="small muted">${ch?.at ? `${kdt(ch.at)} 수정됨` : f.setlist.published_at ? `${kdt(f.setlist.published_at)} 올라옴` : ""}</span></span><span class="btn btn-primary btn-sm">열기</span></button>`
          : `<div class="cv-wait"><span><b>아직 콘티가 올라오지 않았어요</b><span class="small muted">올라오면 이 화면에 바로 보여요</span></span></div>`}
        ${items.length ? `<section class="card"><div class="card-title cv-ct">곡 순서 <span class="cv-chips">${ch?.text?.length ? `<span class="chip chip-mid" title="${esc(ch.text.join(" · "))}">수정됨 · ${esc(ch.text.slice(0, 2).join(" · "))}${ch.text.length > 2 ? " 외" : ""}</span>` : ""}${sc && (!ch?.at || sc.at > ch.at) ? `<span class="chip chip-violet">악보 바뀜 · ${esc(kdt(sc.at))}</span>` : ""}</span></div>
          <div class="cv-slist">${items.map((x, i) => { const jn = i > 0 && x.join_prev; return `<div class="cv-srow ${jn ? "join" : ""}"><span class="cv-sn">${jn ? "+" : gno(items, i)}</span><button type="button" class="cv-st" data-sh-at="c:${i}"><b>${esc(x.title)}</b><small>${jn ? "앞 곡에 이어서" : `${x.sheet ? `${x.sheet.pages}쪽` : "악보 없음"}${items[i + 1]?.join_prev ? " · 메들리" : ""}`}</small></button><span></span>
            ${x.bpm ? `<span class="cv-bpm">♩=${x.bpm}${x.meter && x.meter !== "4/4" ? ` · ${esc(x.meter)}` : ""}</span>` : "<span></span>"}<span class="cv-key">${esc(kt(x))}</span>${x.memo ? `<span class="cv-memo">${esc(x.memo)}</span>` : ""}</div>`; }).join("")}</div>${items.some((x) => x.diff_key) ? `<p class="small muted cv-dk">* 음원(레퍼런스)과 키가 달라요</p>` : ""}</section>` : ""}
        ${f.applied.length ? `<section class="card"><div class="card-title cv-ct">적용찬양 <small>${f.applied.length}곡</small></div>${f.applied.map((x, i) => `<button type="button" class="cv-prow" data-sh-at="a:${i}"><span class="cv-ptag">적용</span><span class="cv-st2"><b>${esc(x.title)}</b><small>${[x.key, `${(x.images || []).length}장`, x.note].filter(Boolean).map(esc).join(" · ")}</small></span><span class="cv-go">보기</span></button>`).join("")}</section>` : ""}
        ${f.proc.length ? `<section class="card"><div class="card-title cv-ct">예배 진행곡 <small>${f.communion ? "성찬식 주일" : ""}</small></div>${f.proc.map((x) => `<button type="button" class="cv-prow" data-sh-at="p:${x.kind}"><span class="cv-ptag">${PROC[x.kind][0]}</span><span class="cv-st2"><b>${esc(x.title)}</b><small>${[x.key, x.images?.length ? `${x.images.length}장` : x.pages ? `${x.pages}쪽` : ""].filter(Boolean).map(esc).join(" · ")}</small></span><span class="cv-go">보기</span></button>`).join("")}</section>` : ""}`
        : `<div class="empty">앞으로 2주 안에 공개된 예배가 없어요.</div>`}
      ${(lv.candidates || []).length ? `<section class="card"><div class="card-title cv-ct">백업찬양 후보 <small>${lv.active ? "기도회 진행 중" : "기도회 때 쓰는 곡"}</small></div>
        <div class="bk-slots">${lv.candidates.map((id, i) => { const s = bk.songs.find((x) => x.id === id); if (!s) return ""; const r = `b:${id}`;
          return `<button type="button" class="bk-slot ${lv.now === r ? "now" : lv.next === r ? "next" : ""}" data-sh-bk="${id}"><span class="h"><span class="bk-code">${esc(s.code)}</span><span class="n">${lv.now === r ? "지금" : lv.next === r ? "다음" : i + 1}</span></span><b>${esc(s.title)}</b></button>`; }).join("")}</div></section>` : ""}
      <p class="small muted shv-foot">보기 전용 화면이에요 · 홈 화면에 추가하면 앱처럼 열 수 있어요 · 콘티가 바뀌면 자동으로 새로 보여요</p>`;
  }
  document.addEventListener("click", (e) => {
    const sv = e.target.closest("[data-sv]"); if (sv) { S.focus = sv.dataset.sv; return render(); }
    const a = e.target.closest("[data-sh]"); if (a?.dataset.sh === "open") return openViewer(0);
    if (a?.dataset.sh === "live") return openViewer(null, true);
    const at = e.target.closest("[data-sh-at]"); if (at) return openViewer(at.dataset.shAt);
    const b = e.target.closest("[data-sh-bk]"); if (b) return openViewer(`b:${b.dataset.shBk}`, false, true);
  });

  // ------------------------------------------------------------------ 실시간 (몇 초마다)
  async function poll() {
    clearTimeout(S.timer);
    const fast = S.live?.active || S.viewer?.live;
    S.timer = setTimeout(async () => {
      if (document.visibilityState === "visible") {
        try {
          const lv = await api("share-live");
          const known = (r) => !r || !r.startsWith("b:") || S.data.backup.songs.some((x) => x.id === +r.slice(2));
          const prev = S.live; S.live = lv;
          if (lv.ver !== S.ver || !known(lv.now) || !known(lv.next) || lv.candidates.some((id) => !S.data.backup.songs.some((x) => x.id === id))) {
            const changed = lv.ver !== S.ver && S.ver !== null;
            await load(true); if (changed) toast("콘티가 바뀌어서 새로 불러왔어요");
          } else if (!prev || prev.seq !== lv.seq) { render(); S.viewer?.onLive(prev); }
        } catch (e) { if (e.status === 404) return dead(e.message); }
      }
      poll();
    }, fast ? 3000 : 15000);
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.data) { poll(); wake(!!S.viewer); } });

  // ------------------------------------------------------------------ 악보 파일
  const LIB = { pdfjs: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", worker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js" };
  let pdfLoad = null;
  const pdfjs = () => pdfLoad || (pdfLoad = new Promise((ok, no) => {
    if (window.pdfjsLib) return ok(window.pdfjsLib);
    const s = document.createElement("script"); s.src = LIB.pdfjs; s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIB.worker; ok(window.pdfjsLib); }; s.onerror = () => { pdfLoad = null; no(new Error("악보 도구를 불러오지 못했어요")); };
    document.head.appendChild(s);
  }));
  const CACHE = "pole2-share-v1", files = new Map(), docs = new Map(), imgs = new Map();
  async function bytes(path) {
    if (!files.has(path)) files.set(path, (async () => {
      const key = new Request(`${location.origin}/__share/${path}`);
      try { const c = await caches.open(CACHE); const hit = await c.match(key); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch {}
      const url = S.data.urls[path]; if (!url) throw new Error("악보 주소가 없어요. 새로고침해 주세요.");
      const r = await fetch(url); if (!r.ok) throw new Error("악보를 받지 못했어요. 새로고침해 주세요.");
      const b = new Uint8Array(await r.arrayBuffer());
      try { const c = await caches.open(CACHE); await c.put(key, new Response(b)); } catch {}
      return b;
    })().catch((e) => { files.delete(path); throw e; }));
    return files.get(path);
  }
  const doc = (path) => docs.get(path) || docs.set(path, (async () => (await pdfjs()).getDocument({ data: (await bytes(path)).slice() }).promise)().catch((e) => { docs.delete(path); throw e; })).get(path);
  const image = (path) => imgs.get(path) || imgs.set(path, (async () => {
    const url = URL.createObjectURL(new Blob([await bytes(path)], { type: /\.png$/.test(path) ? "image/png" : /\.webp$/.test(path) ? "image/webp" : "image/jpeg" }));
    return await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error("그림을 열지 못했어요")); im.src = url; });
  })().catch((e) => { imgs.delete(path); throw e; })).get(path);
  const isImg = (p) => /\.(jpg|png|webp)$/.test(p || "");
  // 공유 필기 (악보 위 필기 층): 펜 · 형광펜은 곱하기, 수정 테이프는 덮기
  function paintInk(g, strokes, k) {
    g.lineCap = "round"; g.lineJoin = "round";
    for (const st of strokes) {
      const p = st.p || []; if (!p.length) continue;
      g.save();
      if (st.t === "t") g.strokeStyle = "#FFFFFF"; else { g.globalCompositeOperation = "multiply"; if (st.t === "h") g.globalAlpha = 0.4; g.strokeStyle = st.c; }
      g.lineWidth = Math.max(0.6, (st.w / 10000) * k);
      g.beginPath(); const X = (i) => (p[2 * i] / 10000) * k, Y = (i) => (p[2 * i + 1] / 10000) * k, n = p.length / 2;
      g.moveTo(X(0), Y(0)); if (n === 1) g.lineTo(X(0) + 0.01, Y(0));
      for (let i = 1; i < n - 1; i++) g.quadraticCurveTo(X(i), Y(i), (X(i) + X(i + 1)) / 2, (Y(i) + Y(i + 1)) / 2);
      if (n > 1) g.lineTo(X(n - 1), Y(n - 1));
      g.stroke(); g.restore();
    }
  }
  async function drawPage(cv, stage, pg) {
    const r = stage.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    let w, h;
    if (pg.img) {
      const im = await image(pg.img), fit = Math.min(r.width / im.naturalWidth, r.height / im.naturalHeight);
      w = Math.floor(im.naturalWidth * fit); h = Math.floor(im.naturalHeight * fit);
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height);
    } else {
      const d = await doc(pg.path), page = await d.getPage(pg.p), v1 = page.getViewport({ scale: 1 });
      const fit = Math.min(r.width / v1.width, r.height / v1.height); w = Math.floor(v1.width * fit); h = Math.floor(v1.height * fit);
      const vp = page.getViewport({ scale: (w * dpr) / v1.width });
      cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      if (pg.ink?.length) paintInk(g, pg.ink, cv.width);
    }
    cv.style.width = `${w}px`; cv.style.height = `${h}px`;
  }

  // ------------------------------------------------------------------ 악보 보기 (콘티 · 적용찬양 · 진행곡 · 백업찬양 따라가기)
  const WAKE = { lock: null };
  async function wake(on) {
    try {
      if (on && !WAKE.lock && navigator.wakeLock && document.visibilityState === "visible") { WAKE.lock = await navigator.wakeLock.request("screen"); WAKE.lock.addEventListener?.("release", () => { WAKE.lock = null; }); }
      if (!on && WAKE.lock) { const l = WAKE.lock; WAKE.lock = null; await l.release(); }
    } catch { WAKE.lock = null; }
  }
  const procPages = (x) => (x.images?.length ? x.images.map((img) => ({ img })) : x.path ? (isImg(x.path) ? [{ img: x.path }] : Array.from({ length: x.pages || 1 }, (_, k) => ({ path: x.path, p: k + 1 }))) : []);
  // 026: 음원과 키 다름(*) · 메들리 번호
  const kt = (x) => (x.key ? `${x.key}${x.diff_key ? "*" : ""}` : x.diff_key ? "*" : "–");
  const gno = (items, i) => { let n = 0; for (let k = 0; k <= i; k++) if (!(k > 0 && items[k].join_prev)) n++; return n; };
  function serviceItems(f) {
    const it0 = f?.setlist?.items || [];
    const out = it0.map((x, i) => ({ id: `c:${i}`, tag: i > 0 && x.join_prev ? "+" : String(gno(it0, i)), title: x.title, key: kt(x) === "–" ? "" : kt(x), bpm: x.bpm, meter: x.meter,
      src: x.sheet ? Array.from({ length: x.sheet.pages || 1 }, (_, k) => ({ path: x.sheet.path, p: k + 1, ink: (x.sheet.ink || []).filter((s) => s.page === k + 1) })) : [] }));
    (f?.applied || []).forEach((x, i) => out.push({ id: `a:${i}`, tag: "적용", kind: "applied", title: x.title, key: x.key, src: (x.images || []).map((img) => ({ img })) }));
    (f?.proc || []).forEach((x) => out.push({ id: `p:${x.kind}`, tag: PROC[x.kind][1], kind: "proc", title: x.title, key: x.key, src: procPages(x) }));
    return out;
  }
  function backupItems() {
    const D = S.data, bk = D.backup, lv = S.live || bk, f = D.services.find((s) => s.date >= D.today) || D.services[0];
    const pagesOf = (s) => (s.images?.length ? s.images.map((img) => ({ img })) : bk.book && s.page ? Array.from({ length: s.pages || 1 }, (_, k) => ({ path: bk.book.path, p: s.page + k })) : []);
    const out = lv.candidates.map((id) => bk.songs.find((x) => x.id === id)).filter(Boolean).map((s) => ({ id: `b:${s.id}`, tag: s.code, title: s.title, src: pagesOf(s) }));
    [lv.now, lv.next].forEach((r) => { if (r?.startsWith("b:") && !out.some((x) => x.id === r)) { const s = bk.songs.find((x) => x.id === +r.slice(2)); if (s) out.push({ id: r, tag: s.code, title: s.title, src: pagesOf(s) }); } });
    (f?.proc || []).filter((x) => x.kind !== "entrance").forEach((x) => out.push({ id: `p:${x.kind}`, tag: PROC[x.kind][1], kind: "proc", title: x.title, key: x.key, src: procPages(x) }));
    return out;
  }
  function openViewer(at, live = false, backup = false) {
    S.viewer?.close();
    const V = { live, follow: live, backup: live || backup, cur: 0, token: 0, items: [], pages: [] };
    const el = document.createElement("div"); el.className = "cv-layer cv-viewer shv-viewer";
    document.body.appendChild(el); document.body.classList.add("cv-open");
    history.pushState({ shv: 1 }, "");
    const build = () => {
      const f = S.data.services.find((s) => s.id === S.focus);
      V.items = V.backup ? backupItems() : serviceItems(f);
      V.pages = []; V.items.forEach((x, i) => (x.src.length ? x.src.forEach((pg, k) => V.pages.push({ i, ...pg, n: k + 1, of: x.src.length })) : V.pages.push({ i, n: 1, of: 1 })));
    };
    build();
    const lv = () => S.live || S.data.backup;
    const head = () => {
      const f = S.data.services.find((s) => s.id === S.focus);
      el.innerHTML = `<div class="cvv-top"><button type="button" class="cvv-back" data-v="close" aria-label="닫기"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
          <b class="cvv-title">${V.backup ? "백업찬양" : `${md(f.date)} ${esc(f.ministry ? f.title : "주일")} · 악보`}</b><span class="cvv-pg" id="vPg"></span>
          ${V.backup && lv().active ? `<button type="button" class="bk-pill ${V.follow ? "on" : ""}" data-v="follow" aria-pressed="${V.follow}">${V.follow ? "● 따라가는 중" : "따라가기"}</button>` : ""}</div>
        ${V.backup && lv().active ? `<div class="bk-band shv-band" id="vBand"></div>` : ""}
        <div class="cvv-strip"><span class="cvv-bpmbox" id="vBpm"></span><div class="cvv-jump" role="tablist">${V.items.map((x, i) => `<button type="button" data-vi="${i}" class="${x.kind || ""}"><i>${esc(x.tag)}</i>${esc(x.title)}${x.key ? ` · ${esc(x.key)}` : ""}</button>`).join("")}</div></div>
        <div class="cvv-stage" id="vStage"><canvas id="vCv" aria-label="악보"></canvas><div class="cvv-blank hidden" id="vBlank"></div>
          <button type="button" class="cvv-tap l" data-v="prev" aria-label="이전 쪽"><span>‹ 이전</span></button><button type="button" class="cvv-tap r" data-v="next" aria-label="다음 쪽"><span>다음 ›</span></button><div class="cvv-load" id="vLoad">불러오는 중…</div></div>
        <div class="cvv-foot"><span id="vNext"></span><span class="small">보기 전용</span></div>`;
    };
    const band = () => {
      const b = $("#vBand", el); if (!b) return;
      const name = (r) => { const x = V.items.find((y) => y.id === r) || (r?.startsWith("p:") ? { tag: PROC[r.slice(2)]?.[1], title: PROC[r.slice(2)]?.[0] } : null); return x ? `<span class="bk-code">${esc(x.tag || "")}</span><b>${esc(x.title)}</b>` : `<b class="muted">아직 없음</b>`; };
      b.innerHTML = `<div class="now"><small>지금</small>${name(lv().now)}</div><div class="nx"><small>다음</small>${name(lv().next)}</div>`;
    };
    const draw = async () => {
      const pg = V.pages[V.cur]; if (!pg) return;
      const t = ++V.token, x = V.items[pg.i];
      $("#vPg", el).textContent = `${V.cur + 1} / ${V.pages.length}쪽`;
      el.querySelectorAll("[data-vi]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.vi === pg.i)));
      el.querySelector(`[data-vi="${pg.i}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
      $("#vBpm", el).innerHTML = x.bpm ? `<span class="cvv-bpm"><b>♩=${x.bpm}</b>${x.meter && x.meter !== "4/4" ? `<small>${esc(x.meter)}</small>` : ""}</span>` : "";
      const nx = V.pages[V.cur + 1];
      $("#vNext", el).textContent = nx ? `다음 쪽: ${V.items[nx.i].title}${nx.of > 1 ? ` ${nx.n}/${nx.of}` : ""}` : "마지막 쪽이에요";
      const cv = $("#vCv", el), blank = $("#vBlank", el), ld = $("#vLoad", el);
      if (!pg.path && !pg.img) { cv.classList.add("hidden"); ld.classList.add("hidden"); blank.classList.remove("hidden"); blank.innerHTML = `<b>${esc(x.title)}</b><span>${x.key ? esc(x.key) + " · " : ""}악보가 없어요</span>`; return; }
      blank.classList.add("hidden"); ld.classList.remove("hidden"); ld.textContent = "불러오는 중…";
      try { const tmp = document.createElement("canvas"); await drawPage(tmp, $("#vStage", el), pg); if (t !== V.token) return; cv.width = tmp.width; cv.height = tmp.height; cv.style.width = tmp.style.width; cv.style.height = tmp.style.height; cv.getContext("2d").drawImage(tmp, 0, 0); cv.classList.remove("hidden"); ld.classList.add("hidden"); }
      catch (err) { if (t === V.token) ld.textContent = err.message || "악보를 열지 못했어요"; }
    };
    const go = (k) => { const n = Math.max(0, Math.min(V.pages.length - 1, k)); if (n !== V.cur) { V.cur = n; draw(); } };
    const goItem = (id) => { const i = V.items.findIndex((x) => x.id === id); if (i >= 0) { V.cur = Math.max(0, V.pages.findIndex((p) => p.i === i)); } };
    const reflow = () => { head(); band(); draw(); };
    head(); band();
    if (live) goItem(lv().now); else if (typeof at === "string") goItem(at); else V.cur = 0;
    draw(); wake(true);
    const onKey = (e) => { if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(V.cur + 1); } if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); go(V.cur - 1); } };
    document.addEventListener("keydown", onKey);
    let sx = null, sy = null;
    el.addEventListener("pointerdown", (e) => { if (e.target.closest("#vStage")) { sx = e.clientX; sy = e.clientY; } });
    el.addEventListener("pointerup", (e) => { if (sx === null) return; const dx = e.clientX - sx, dy = e.clientY - sy; sx = null; if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { V.follow = false; go(V.cur + (dx < 0 ? 1 : -1)); } });
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (b) { const a = b.dataset.v; if (a === "close") return history.back(); if (a === "prev") return go(V.cur - 1); if (a === "next") return go(V.cur + 1);
        if (a === "follow") { V.follow = !V.follow; if (V.follow) goItem(lv().now); return reflow(); } }
      const i = e.target.closest("[data-vi]"); if (i) { if (V.backup && V.follow && V.items[+i.dataset.vi].id !== lv().now) { V.follow = false; head(); band(); } go(V.pages.findIndex((p) => p.i === +i.dataset.vi)); }
    });
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    const onPop = () => { if (S.viewer === api) api.close(true); };
    window.addEventListener("popstate", onPop);
    const api = {
      live: V.backup,
      close(fromPop) { window.removeEventListener("popstate", onPop); window.removeEventListener("resize", onResize); document.removeEventListener("keydown", onKey); el.remove(); document.body.classList.remove("cv-open"); S.viewer = null; wake(false); if (!fromPop && history.state?.shv) history.back(); },
      refresh() { const id = V.items[V.pages[V.cur]?.i]?.id; build(); if (id) goItem(id); if (V.cur >= V.pages.length) V.cur = 0; reflow(); },
      onLive(prev) {
        if (!V.backup) return;
        if (!lv().active && V.live) { toast("기도회가 끝났어요"); return api.close(); }
        build(); if (V.follow && lv().now !== prev?.now) goItem(lv().now);
        reflow();
      },
    };
    S.viewer = api;
    return api;
  }

  if (!T) dead("링크 주소가 올바르지 않아요."); else load();
})();
