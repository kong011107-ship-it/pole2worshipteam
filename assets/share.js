// =====================================================================
//  섬김이 팀 공유 화면 (025) — share.html?t=링크
//  로그인 없이 보기만: 다가오는 예배 콘티(곡 순서 · 키 · BPM · 레퍼런스 · 악보 + 공유 필기) · 적용찬양 · 예배 진행곡 · 특별순서 · 백업찬양
//  029: 예배 순서대로 이어서 넘겨요 (백업찬양 후보도 그 자리에) · 확대 · 축소 · 내 메모(이 기기에만) · 기도회는 실시간(Broadcast)
//       라인업 · 멤버 정보 · 고치기는 없어요
//  데이터는 /api/conti { action: "share" | "share-live", t } — 악보 파일은 서명된 주소(6시간)로 받아 파일 경로 기준으로 이 기기에 저장
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
  const S = { data: null, focus: null, ver: null, live: null, viewer: null, offline: false, loading: false, rt: null, rtOk: false, topic: null };
  const toast = (msg, ms = 2600) => { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); };
  // ink.js가 쓰는 공용 도구
  if (!window.esc) window.esc = esc;
  if (!window.toast) window.toast = toast;
  const ytLink = (id, t) => `https://youtu.be/${id}${t ? `?t=${t}` : ""}`;
  const bpmText = (b, m) => (b ? `♩=${b}${m && m !== "4/4" ? ` · ${m}` : ""}` : "");
  const PLAY = `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;

  async function api(action) {
    const r = await fetch("/api/conti", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, t: T }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || "불러오지 못했어요"); e.status = r.status; throw e; }
    return j;
  }
  async function load(quiet) {
    if (S.loading) { S.again = true; return; }
    S.loading = true;
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
    realtime();
    prefetch();
    if (!quiet) poll();
    if (S.again) { S.again = false; load(true); }
  }
  function dead(msg) {
    $("#shMain").innerHTML = `<div class="empty"><b>이 링크로는 볼 수 없어요</b><br>${esc(msg)}</div>`;
    clearTimeout(S.timer);
    try { S.rt && S.ch && S.rt.removeChannel(S.ch); } catch {}
  }

  // ------------------------------------------------------------------ 예배 순서 (예배마다 · 서버가 정리해서 보내요)
  const gno = (items, i) => { let n = 0; for (let k = 0; k <= i; k++) if (!(k > 0 && items[k].join_prev)) n++; return n; };
  const kt = (x) => (x.key ? `${x.key}${x.diff_key ? "*" : ""}` : x.diff_key ? "*" : "–");
  const lv = () => S.live || S.data.backup;
  const bkMine = (f) => { const b = S.data.backup; return !!f && (lv().service_id || b.service_id) === f.id; };
  function flowRows(f) {
    return (f.flow || []).map((k) => {
      if (k === "conti") return null;
      if (k === "applied") return f.applied.length ? { k, at: `a:${f.applied[0].id}`, tag: "적용", title: "적용찬양", sub: f.applied.map((x) => x.title).join(" · ") } : null;
      if (k === "backup") { const c = bkMine(f) ? lv().candidates || [] : []; const songs = c.map((id) => S.data.backup.songs.find((x) => x.id === id)).filter(Boolean);
        return { k, at: "backup", tag: "백업", title: "백업찬양", sub: lv().active && bkMine(f) ? "기도회 진행 중" : songs.length ? songs.map((x) => x.code).join(" · ") : "확정 전" }; }
      if (k.startsWith("x:")) { const x = f.extras.find((y) => y.id === +k.slice(2)); return x ? { k, at: k, tag: "특별", title: x.title, sub: [x.key, bpmText(x.bpm, x.meter), x.memo].filter(Boolean).join(" · ") } : null; }
      const x = f.proc.find((y) => y.kind === k); return x ? { k, at: `p:${k}`, tag: PROC[k][0], title: x.title, sub: [x.key, bpmText(x.bpm, x.meter)].filter(Boolean).join(" · ") } : null;
    }).filter(Boolean);
  }

  // ------------------------------------------------------------------ 화면
  function render() {
    const D = S.data, f = D.services.find((s) => s.id === S.focus);
    $("#shLabel").textContent = `${D.label} · 보기 전용`;
    document.title = `${D.label} · 예배 콘티`;
    const bk = D.backup, L = lv();
    const songOf = (ref) => (ref?.startsWith("b:") ? bk.songs.find((x) => x.id === +ref.slice(2)) : null);
    const refText = (ref) => { if (!ref) return ""; const s = songOf(ref); if (s) return `${s.code} ${s.title}`; const k = ref.slice(2); return PROC[k]?.[0] || "예배 진행곡"; };
    const items = f?.setlist?.items || [];
    const sc = f?.setlist?.sheet_changes, ch = f?.setlist?.changes;
    const rows = f ? flowRows(f) : [];
    const flowChg = f?.flow_at && f.setlist?.published_at && f.flow_at > f.setlist.published_at;
    $("#shMain").innerHTML = `${S.offline ? `<div class="notice warn">인터넷 연결이 없어 저장해 둔 콘티를 보여 줘요.</div>` : ""}
      ${L.active ? `<button type="button" class="bk-livecard" data-sh="live"><span class="bk-dot"></span><span><b>백업찬양 진행 중</b><small>지금 ${esc(refText(L.now) || "준비 중")}${L.next ? ` · 다음 ${esc(refText(L.next))}` : ""}</small></span><span class="btn btn-primary btn-sm">악보 따라 보기</span></button>` : ""}
      ${D.services.length > 1 ? `<div class="chips2 shv-svcs">${D.services.map((s) => `<button type="button" data-sv="${s.id}" aria-pressed="${s.id === S.focus}">${mdw(s.date)} ${esc(s.title)}</button>`).join("")}</div>` : ""}
      ${f ? `<section class="hero cv-hero"><span class="eyebrow">${f.date === D.today ? "오늘" : "다가오는 예배"} · ${mdw(f.date)}${f.start_time ? ` ${hm(f.start_time)}` : ""}</span>
          <span class="big">${f.ministry ? esc(f.title) : `${md(f.date)} 주일`} 콘티</span>
          <div class="pills">${f.communion ? "<span>성찬식 주일</span>" : ""}${items.length ? `<span>${items.length}곡</span>` : ""}</div></section>
        ${f.setlist ? `<button type="button" class="cv-pdfbar" data-sh="open"><span class="cv-pdfic">PDF</span><span class="cv-pdft"><b>악보 보기</b><span class="small muted">${ch?.at ? `${kdt(ch.at)} 수정됨` : f.setlist.published_at ? `${kdt(f.setlist.published_at)} 올라옴` : ""}</span></span><span class="btn btn-primary btn-sm">열기</span></button>`
          : `<div class="cv-wait"><span><b>아직 콘티가 올라오지 않았어요</b><span class="small muted">올라오면 이 화면에 바로 보여요</span></span></div>`}
        ${items.length ? `<section class="card"><div class="card-title cv-ct">곡 순서 <span class="cv-chips">${ch?.text?.length ? `<span class="chip chip-mid" title="${esc(ch.text.join(" · "))}">수정됨 · ${esc(ch.text.slice(0, 2).join(" · "))}${ch.text.length > 2 ? " 외" : ""}</span>` : ""}${sc && (!ch?.at || sc.at > ch.at) ? `<span class="chip chip-violet">악보 바뀜 · ${esc(kdt(sc.at))}</span>` : ""}</span></div>
          <div class="cv-slist">${items.map((x, i) => { const jn = i > 0 && x.join_prev; return `<div class="cv-srow ${jn ? "join" : ""}"><span class="cv-sn">${jn ? "+" : gno(items, i)}</span><button type="button" class="cv-st" data-sh-at="c:${i}"><b>${esc(x.title)}</b><small>${jn ? "앞 곡에 이어서" : `${x.sheet ? `${x.sheet.pages}쪽` : "악보 없음"}${items[i + 1]?.join_prev ? " · 메들리" : ""}`}</small></button>
            ${x.ref ? `<a class="cv-yt" href="${ytLink(x.ref[0], x.ref[1])}" target="_blank" rel="noopener" aria-label="${esc(x.title)} 레퍼런스">${PLAY}레퍼런스</a>` : "<span></span>"}
            ${x.bpm ? `<span class="cv-bpm">${esc(bpmText(x.bpm, x.meter))}</span>` : "<span></span>"}<span class="cv-key">${esc(kt(x))}</span>${x.memo ? `<span class="cv-memo">${esc(x.memo)}</span>` : ""}</div>`; }).join("")}</div>${items.some((x) => x.diff_key) ? `<p class="small muted cv-dk">* 음원(레퍼런스)과 키가 달라요</p>` : ""}</section>` : ""}
        ${rows.length ? `<section class="card"><div class="card-title cv-ct">예배 순서 <small>${f.communion ? "성찬식 주일 · " : ""}콘티 다음 차례대로</small>${flowChg ? `<span class="chip chip-mid">순서 바뀜 · ${esc(kdt(f.flow_at))}</span>` : ""}</div>
          ${rows.map((r) => `<button type="button" class="cv-prow" data-sh-at="${esc(r.at)}"><span class="cv-ptag">${esc(r.tag)}</span><span class="cv-st2"><b>${esc(r.title)}</b><small>${esc(r.sub || "")}</small></span><span class="cv-go">보기</span></button>`).join("")}</section>` : ""}`
        : `<div class="empty">앞으로 2주 안에 공개된 예배가 없어요.</div>`}
      ${(L.candidates || []).length ? `<section class="card"><div class="card-title cv-ct">백업찬양 후보 <small>${L.active ? "기도회 진행 중" : "기도회 때 쓰는 곡"}</small></div>
        <div class="bk-slots">${L.candidates.map((id, i) => { const s = bk.songs.find((x) => x.id === id); if (!s) return ""; const r = `b:${id}`;
          return `<button type="button" class="bk-slot ${L.now === r ? "now" : L.next === r ? "next" : ""}" data-sh-bk="${id}"><span class="h"><span class="bk-code">${esc(s.code)}</span><span class="n">${L.now === r ? "지금" : L.next === r ? "다음" : i + 1}</span></span><b>${esc(s.title)}</b></button>`; }).join("")}</div></section>` : ""}
      <p class="small muted shv-foot">보기 전용 화면이에요 · 악보에 쓴 메모는 이 기기에만 저장돼요 · 홈 화면에 추가하면 앱처럼 열 수 있어요 · 콘티가 바뀌면 자동으로 새로 보여요</p>`;
  }
  document.addEventListener("click", (e) => {
    const sv = e.target.closest("[data-sv]"); if (sv) { S.focus = sv.dataset.sv; render(); return prefetch(); }
    const a = e.target.closest("[data-sh]"); if (a?.dataset.sh === "open") return openViewer(null);
    if (a?.dataset.sh === "live") { const f = S.data.services.find((s) => s.id === lv().service_id); if (f) S.focus = f.id; render(); return openViewer(null, true); }
    const at = e.target.closest("[data-sh-at]"); if (at) return openViewer(at.dataset.shAt);
    const b = e.target.closest("[data-sh-bk]"); if (b) { const f = S.data.services.find((s) => s.id === lv().service_id); if (f && f.id !== S.focus) { S.focus = f.id; render(); } return openViewer(`b:${b.dataset.shBk}`); }
  });

  // ------------------------------------------------------------------ 실시간: Broadcast(바로) + 몇 초마다 확인(끊기면 이걸로)
  function applyLive(lvNew, src) {
    const known = (r) => !r || !r.startsWith("b:") || S.data.backup.songs.some((x) => x.id === +r.slice(2));
    const prev = S.live; S.live = { ...(S.live || {}), ...lvNew };
    if (lvNew.ver !== undefined && lvNew.ver !== S.ver && S.ver !== null) { load(true).then(() => toast("콘티가 바뀌어서 새로 불러왔어요")); return; }
    if (!known(S.live.now) || !known(S.live.next) || (S.live.candidates || []).some((id) => !S.data.backup.songs.some((x) => x.id === id)) || (lvNew.service_id && lvNew.service_id !== S.data.backup.service_id)) return load(true);
    if (!prev || prev.seq !== S.live.seq || prev.active !== S.live.active) { render(); S.viewer?.onLive(prev); }
    S.lastLive = { at: Date.now(), src };
  }
  function realtime() {
    const topic = S.data?.rt?.topic, cfg = window.APP_CONFIG;
    if (!topic || !window.supabase?.createClient || !cfg?.SUPABASE_URL || S.topic === topic) return;
    try {
      if (!S.rt) S.rt = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      if (S.ch) S.rt.removeChannel(S.ch);
      S.topic = topic; S.rtOk = false;
      let reloadT = 0;
      S.ch = S.rt.channel(topic)
        .on("broadcast", { event: "live" }, (m) => applyLive(m.payload || {}, "rt"))
        .on("broadcast", { event: "reload" }, () => { clearTimeout(reloadT); reloadT = setTimeout(() => load(true), 400); })
        .subscribe((st) => { const was = S.rtOk; S.rtOk = st === "SUBSCRIBED"; if (was !== S.rtOk) poll(); });
    } catch { S.rtOk = false; }
  }
  async function poll() {
    clearTimeout(S.timer);
    const active = S.live?.active || S.viewer?.hasLive;
    // 실시간이 붙어 있으면 확인은 가끔 (혹시 놓친 것만) · 아니면 기도회 중 3초 · 악보 보는 중 6초 · 평소 15초
    const ms = S.rtOk ? (active ? 10000 : 30000) : active ? 3000 : S.viewer ? 6000 : 15000;
    S.timer = setTimeout(async () => {
      if (document.visibilityState === "visible") {
        try { applyLive(await api("share-live"), "poll"); } catch (e) { if (e.status === 404) return dead(e.message); }
      }
      poll();
    }, ms);
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.data) { poll(); wake(!!S.viewer); api("share-live").then((x) => applyLive(x, "wake"), () => {}); } });

  // ------------------------------------------------------------------ 악보 파일 (파일 경로 기준으로 이 기기에 저장 · 350MB 넘으면 오래 안 본 것부터 지움)
  const LIB = { pdfjs: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", worker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js" };
  let pdfLoad = null;
  const pdfjs = () => pdfLoad || (pdfLoad = new Promise((ok, no) => {
    if (window.pdfjsLib) return ok(window.pdfjsLib);
    const s = document.createElement("script"); s.src = LIB.pdfjs; s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIB.worker; ok(window.pdfjsLib); }; s.onerror = () => { pdfLoad = null; no(new Error("악보 도구를 불러오지 못했어요")); };
    document.head.appendChild(s);
  }));
  const CACHE = "pole2-share-v1", files = new Map(), docs = new Map(), imgs = new Map();
  const IDX = "pole2.share.idx", CAP = 350 * 1048576;
  const ckey = (path) => new Request(`${location.origin}/__share/${path}`);
  function touch(path, n) { const m = ls.get(IDX) || {}; m[path] = { n: n ?? m[path]?.n ?? 0, t: Date.now() }; ls.set(IDX, m); }
  async function evict() {
    const m = ls.get(IDX) || {}; let total = Object.values(m).reduce((a, x) => a + (x.n || 0), 0);
    if (total <= CAP) return;
    const keep = new Set(allPaths());
    try { const c = await caches.open(CACHE); for (const [p, v] of Object.entries(m).sort((a, b) => a[1].t - b[1].t)) { if (total <= CAP * 0.85) break; if (keep.has(p)) continue; await c.delete(ckey(p)); total -= v.n || 0; delete m[p]; } } catch {}
    ls.set(IDX, m);
  }
  async function bytes(path) {
    if (!files.has(path)) files.set(path, (async () => {
      try { const c = await caches.open(CACHE); const hit = await c.match(ckey(path)); if (hit) { const b = new Uint8Array(await hit.arrayBuffer()); touch(path, b.length); return b; } } catch {}
      const url = S.data.urls[path]; if (!url) throw new Error("악보 주소가 없어요. 새로고침해 주세요.");
      const r = await fetch(url); if (!r.ok) throw new Error("악보를 받지 못했어요. 새로고침해 주세요.");
      const b = new Uint8Array(await r.arrayBuffer());
      try { const c = await caches.open(CACHE); await c.put(ckey(path), new Response(b)); touch(path, b.length); evict(); } catch {}
      return b;
    })().catch((e) => { files.delete(path); throw e; }));
    return files.get(path);
  }
  const doc = (path) => docs.get(path) || docs.set(path, (async () => (await pdfjs()).getDocument({ data: (await bytes(path)).slice() }).promise)().catch((e) => { docs.delete(path); throw e; })).get(path);
  const image = (path) => imgs.get(path) || imgs.set(path, (async () => {
    const url = URL.createObjectURL(new Blob([await bytes(path)], { type: /\.png$/.test(path) ? "image/png" : /\.webp$/.test(path) ? "image/webp" : "image/jpeg" }));
    return await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error("그림을 열지 못했어요")); im.src = url; });
  })().catch((e) => { imgs.delete(path); throw e; })).get(path);
  async function renderPage(d, n, width, canvas) {
    const page = await d.getPage(n), v1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: width / v1.width });
    canvas = canvas || document.createElement("canvas"); canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const g = canvas.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    return canvas;
  }
  const isImg = (p) => /\.(jpg|png|webp)$/.test(p || "");
  // 미리 받아 두기: 보고 있는 예배(와이파이면 2주 안 모든 예배) — 백업찬양 악보집은 와이파이 · 기도회 중에만
  const svcFiles = (f) => !f ? [] : [...(f.setlist?.items || []).map((x) => x.sheet?.path), ...f.applied.flatMap((a) => a.images || []), ...f.proc.flatMap((p) => [p.path, ...(p.images || [])]), ...(f.extras || []).flatMap((x) => [x.path, ...(x.images || [])])];
  const allPaths = () => S.data ? S.data.services.flatMap(svcFiles).filter(Boolean) : [];
  let preQ = Promise.resolve(); const pre = new Set();
  function prefetch() {
    if (!S.data || S.offline || navigator.connection?.saveData) return;
    const wifi = ["wifi", "ethernet"].includes(navigator.connection?.type);
    const f = S.data.services.find((s) => s.id === S.focus);
    const bk = S.data.backup, mine = bkMine(f);
    const bkFiles = mine ? (lv().candidates || []).map((id) => bk.songs.find((x) => x.id === id)).filter(Boolean).flatMap((s) => (s.images?.length ? s.images : (wifi || lv().active) && bk.book ? [bk.book.path] : [])) : [];
    const list = [...new Set([...svcFiles(f), ...bkFiles, ...(wifi ? S.data.services.flatMap(svcFiles) : [])].filter(Boolean))].filter((p) => !pre.has(p) && S.data.urls[p]);
    list.forEach((p) => pre.add(p));
    preQ = preQ.then(async () => { for (const p of list) { try { await bytes(p); } catch { pre.delete(p); } } });
  }

  // ------------------------------------------------------------------ 악보 보기
  const WAKE = { lock: null };
  async function wake(on) {
    try {
      if (on && !WAKE.lock && navigator.wakeLock && document.visibilityState === "visible") { WAKE.lock = await navigator.wakeLock.request("screen"); WAKE.lock.addEventListener?.("release", () => { WAKE.lock = null; }); }
      if (!on && WAKE.lock) { const l = WAKE.lock; WAKE.lock = null; await l.release(); }
    } catch { WAKE.lock = null; }
  }
  // 쪽마다: 내 메모(이 기기에만 · key는 팀원 화면과 같은 규칙) · 공유 필기(보기만)
  const inkOf = (x, k) => (x.ink || []).filter((s) => s.page === k + 1);
  const pagesFor = (srcs, key, x, ver) => srcs.map((pg, k) => ({ ...pg, ink: { key, page: k + 1, ver: ver || null }, shared: { sheet: key, page: k + 1, static: inkOf(x, k), canEdit: false } }));
  const imgOrPdf = (x) => (x.images?.length ? x.images.map((img) => ({ img })) : x.path ? (isImg(x.path) ? [{ img: x.path }] : Array.from({ length: x.pages || 1 }, (_, k) => ({ path: x.path, p: k + 1 }))) : []);
  function serviceItems(f) {
    if (!f) return [];
    const it0 = f.setlist?.items || [], bk = S.data.backup, L = lv(), mine = bkMine(f);
    const out = [];
    for (const k of f.flow || ["conti"]) {
      if (k === "conti") it0.forEach((x, i) => out.push({ id: `c:${i}`, tag: i > 0 && x.join_prev ? "+" : String(gno(it0, i)), title: x.title, key: kt(x) === "–" ? "" : kt(x), bpm: x.bpm, meter: x.meter, ref: x.ref,
        src: x.sheet ? pagesFor(Array.from({ length: x.sheet.pages || 1 }, (_, k2) => ({ path: x.sheet.path, p: k2 + 1 })), `s:${x.sheet.base || x.sheet.id}`, x.sheet) : [] }));
      else if (k === "applied") f.applied.forEach((x) => out.push({ id: `a:${x.id}`, tag: "적용", kind: "applied", title: x.title, key: x.key, bpm: x.bpm, meter: x.meter, src: pagesFor((x.images || []).map((img) => ({ img })), `a:${x.id}`, x) }));
      else if (k === "backup") {
        if (f.date < addDays(S.data.today, -1)) continue;
        const ids = mine ? [...(L.candidates || [])] : [];
        if (mine && L.active) [L.now, L.next].forEach((r) => { if (r?.startsWith("b:") && !ids.includes(+r.slice(2))) ids.push(+r.slice(2)); });
        const songs = ids.map((id) => bk.songs.find((x) => x.id === id)).filter(Boolean);
        songs.forEach((s) => { const ver = s.book_id ? String(s.book_id) : `c${s.id}`;
          const srcs = s.images?.length ? s.images.map((img) => ({ img })) : bk.book && s.page ? Array.from({ length: s.pages || 1 }, (_, j) => ({ path: bk.book.path, p: s.page + j })) : [];
          out.push({ id: `b:${s.id}`, tag: s.code, kind: "backup", title: s.title, key: s.key ? s.key.toUpperCase() : "", bpm: s.bpm, meter: s.meter, src: pagesFor(srcs, `b:${s.code}`, s, ver) }); });
        if (!songs.length) out.push({ id: "bk:none", tag: "백업", kind: "backup", title: "백업찬양", note: "확정 전이에요 · 인도자가 확정하면 여기에 이어서 보여요", src: [] });
      } else if (k.startsWith("x:")) { const x = (f.extras || []).find((y) => y.id === +k.slice(2)); if (x) out.push({ id: k, tag: "특별", kind: "extra", title: x.title, key: x.key, memo: x.memo, bpm: x.bpm, meter: x.meter, src: pagesFor(imgOrPdf(x), k, x) }); }
      else { const x = f.proc.find((y) => y.kind === k); if (x) out.push({ id: `p:${k}`, tag: PROC[k][1], kind: "proc", title: x.title, key: x.key, bpm: x.bpm, meter: x.meter, src: pagesFor(imgOrPdf(x), `p:${x.id}`, x) }); }
    }
    return out;
  }
  const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  function openViewer(at, follow = false) {
    S.viewer?.close();
    if (window.INK) INK.setup({ lib: { sheetDoc: doc, sheetImage: image, renderPage }, local: `share:${T.slice(0, 12)}` });
    const V = { follow: false, cur: 0, token: 0, items: [], pages: [] };
    const el = document.createElement("div"); el.className = "cv-layer cv-viewer shv-viewer";
    document.body.appendChild(el); document.body.classList.add("cv-open");
    history.pushState({ shv: 1 }, "");
    const svc = () => S.data.services.find((s) => s.id === S.focus);
    const build = () => {
      V.items = serviceItems(svc());
      V.pages = []; V.items.forEach((x, i) => (x.src.length ? x.src.forEach((pg, k) => V.pages.push({ i, ...pg, n: k + 1, of: x.src.length })) : V.pages.push({ i, n: 1, of: 1 })));
    };
    const liveOn = () => lv().active && bkMine(svc());
    build();
    const f0 = svc();
    el.innerHTML = `<div class="cvv-top"><button type="button" class="cvv-back" data-v="close" aria-label="닫기"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
        <b class="cvv-title">${f0 ? `${md(f0.date)} ${esc(f0.ministry ? f0.title : "주일")} · 악보` : "악보"}</b><span class="cvv-pg" id="vPg"></span><a class="cvv-ref hidden" id="vRef" target="_blank" rel="noopener">${PLAY}<span>레퍼런스</span></a>${window.INK ? `<button type="button" class="cvv-pen cvv-hide hidden" data-iv="hide"></button><button type="button" class="cvv-pen" data-iv="pen"></button>` : ""}</div>
      <div class="cvv-strip"><span class="cvv-bpmbox" id="vBpm"></span><div class="cvv-jump" role="tablist" id="vJump"></div></div>
      <div class="iv-host hidden" id="vInk"></div>
      <div class="cvv-stage" id="vStage"><canvas id="vCv" aria-label="악보"></canvas><div class="cvv-blank hidden" id="vBlank"></div>
        <button type="button" class="cvv-tap l" data-v="prev" aria-label="이전 쪽"><span>‹ 이전</span></button><button type="button" class="cvv-tap r" data-v="next" aria-label="다음 쪽"><span>다음 ›</span></button><div class="cvv-load" id="vLoad">불러오는 중…</div></div>
      <div class="cvv-live hidden" id="vLive"></div>
      <div class="cvv-foot"><span id="vNext"></span><span class="small">보기 전용 · 메모는 이 기기에만</span></div>`;
    const iv = window.INK ? INK.view({ stage: $("#vStage", el), canvas: $("#vCv", el), root: el, bar: $("#vInk", el), onTurn: (d) => go(V.cur + d) }) : null;
    V.ink = iv;
    const strip = () => { $("#vJump", el).innerHTML = V.items.map((x, i) => `<button type="button" data-vi="${i}" class="${x.kind || ""}"><i>${esc(x.tag)}</i>${esc(x.title)}${x.key ? ` · ${esc(x.key)}` : ""}</button>`).join(""); };
    const liveName = (ref) => { const x = V.items.find((y) => y.id === ref); if (x) return `${x.kind === "backup" ? x.tag + " " : ""}${x.title}`; return PROC[String(ref || "").slice(2)]?.[0] || "준비 중"; };
    const drawLive = () => {
      const bar = $("#vLive", el);
      if (!liveOn()) { bar.classList.add("hidden"); bar.innerHTML = ""; V.follow = false; return; }
      bar.classList.remove("hidden");
      bar.innerHTML = V.follow
        ? `<span class="cvv-lv-on"><span class="bk-dot"></span>기도회 따라가는 중 · 지금 <b>${esc(liveName(lv().now))}</b></span><button type="button" class="cvv-lv-free" data-v="unfollow">그만 따라가기</button>`
        : `<button type="button" class="cvv-lv-go" data-v="golive"><span class="bk-dot"></span><span>기도회로 가기 · 지금 곡: <b>${esc(liveName(lv().now))}</b></span></button>`;
    };
    const draw = async () => {
      const pg = V.pages[V.cur]; if (!pg) return;
      const t = ++V.token, x = V.items[pg.i];
      $("#vPg", el).textContent = `${V.cur + 1} / ${V.pages.length}쪽`;
      el.querySelectorAll("[data-vi]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.vi === pg.i)));
      el.querySelector(`[data-vi="${pg.i}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
      $("#vBpm", el).innerHTML = x.bpm ? `<span class="cvv-bpm"><b>♩=${x.bpm}</b>${x.meter && x.meter !== "4/4" ? `<small>${esc(x.meter)}</small>` : ""}</span>` : "";
      const ref = $("#vRef", el);
      if (x.ref?.[0]) { ref.href = ytLink(x.ref[0], x.ref[1]); ref.classList.remove("hidden"); ref.setAttribute("aria-label", `${x.title} 레퍼런스 (새 창)`); } else ref.classList.add("hidden");
      drawLive();
      const nx = V.pages[V.cur + 1];
      $("#vNext", el).textContent = nx ? `다음 쪽: ${V.items[nx.i].title}${nx.of > 1 ? ` ${nx.n}/${nx.of}` : ""}` : "마지막 쪽이에요";
      const cv = $("#vCv", el), blank = $("#vBlank", el), ld = $("#vLoad", el);
      if (!pg.path && !pg.img) { iv?.clear(); cv.classList.add("hidden"); ld.classList.add("hidden"); blank.classList.remove("hidden"); blank.innerHTML = x.note ? `<b>백업찬양</b><span>${esc(x.note)}</span>` : `<b>${esc(x.title)}</b><span>${x.key ? esc(x.key) + " · " : ""}${x.memo ? esc(x.memo) + " · " : ""}악보가 없어요</span>`; return; }
      blank.classList.add("hidden"); ld.classList.remove("hidden"); ld.textContent = "불러오는 중…";
      try {
        if (iv) { if (!(await iv.show(pg, () => t !== V.token))) return; }
        if (t !== V.token) return;
        cv.classList.remove("hidden"); ld.classList.add("hidden");
        for (const n2 of [V.pages[V.cur + 1], V.pages[V.cur - 1]]) { if (!n2) continue; if (n2.path) doc(n2.path).catch(() => {}); if (n2.img) image(n2.img).catch(() => {}); iv?.warm?.(n2); }
      } catch (err) { if (t === V.token) ld.textContent = err.message || "악보를 열지 못했어요"; }
    };
    const go = (k, auto) => { const n = Math.max(0, Math.min(V.pages.length - 1, k)); if (!auto && V.follow) { V.follow = false; drawLive(); } if (n !== V.cur) { V.cur = n; draw(); } };
    const goItem = (id, auto) => { const i = V.items.findIndex((x) => x.id === id); if (i >= 0) go(Math.max(0, V.pages.findIndex((p) => p.i === i)), auto); };
    const rebuild = () => {
      const pg = V.pages[V.cur], id = V.items[pg?.i]?.id, n = pg?.n || 1;
      build(); strip();
      let c = V.pages.findIndex((p) => V.items[p.i]?.id === id && p.n === n); if (c < 0) c = V.pages.findIndex((p) => V.items[p.i]?.id === id);
      V.cur = c >= 0 ? c : Math.min(V.cur, V.pages.length - 1);
      draw();
    };
    strip();
    const first = follow && liveOn() ? lv().now : at;
    if (first) { const i = first === "backup" ? V.items.findIndex((x) => x.kind === "backup") : V.items.findIndex((x) => x.id === first); V.cur = Math.max(0, V.pages.findIndex((p) => p.i === Math.max(0, i))); }
    V.follow = !!(follow && liveOn());
    draw(); wake(true);
    const onKey = (e) => { if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(V.cur + 1); } if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); go(V.cur - 1); } };
    document.addEventListener("keydown", onKey);
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]");
      if (b) { const a = b.dataset.v; if (a === "close") return history.back(); if (a === "prev") return go(V.cur - 1); if (a === "next") return go(V.cur + 1);
        if (a === "golive") { V.follow = true; drawLive(); if (lv().now) goItem(lv().now, true); return; }
        if (a === "unfollow") { V.follow = false; return drawLive(); } }
      const i = e.target.closest("[data-vi]"); if (i) go(V.pages.findIndex((p) => p.i === +i.dataset.vi));
    });
    const onPop = () => { if (S.viewer === vapi) vapi.close(true); };
    window.addEventListener("popstate", onPop);
    const vapi = {
      get hasLive() { return liveOn(); },
      close(fromPop) { window.removeEventListener("popstate", onPop); document.removeEventListener("keydown", onKey); iv?.destroy(); el.remove(); document.body.classList.remove("cv-open"); S.viewer = null; wake(false); if (!fromPop && history.state?.shv) history.back(); },
      refresh() { rebuild(); },
      onLive(prev) {
        const was = !!(prev?.active);
        rebuild();
        if (!liveOn()) { if (was && V.follow) toast("기도회가 끝났어요"); V.follow = false; return drawLive(); }
        if (V.follow && lv().now !== prev?.now) goItem(lv().now, true);
        drawLive();
      },
    };
    el._viewer = V; V.api = vapi;
    S.viewer = vapi;
    poll();
    return vapi;
  }

  window.__share = { S, applyLive, load, poll };   // 테스트 · 고장 확인용
  if (!T) dead("링크 주소가 올바르지 않아요."); else load();
})();
