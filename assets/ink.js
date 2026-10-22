// =====================================================================
//  내 메모 (024) — 악보 위에 손으로 쓰는 메모 · 확대/축소 · 악보 밖 여백 필기
//  INK.view({ stage, canvas, root, bar, onTurn })  : 악보 보기 무대(stage)에 붙임 (콘티 악보 보기 · 백업찬양 진행 화면)
//    iv.show(pg, stale)  쪽 그리기 (pg = { path, p } | { img }, pg.ink = { key, page, ver, song })
//    iv.clear()          악보 없는 쪽
//    iv.prefetch(keys)   여러 악보의 메모를 한 번에 받아 둠
//    iv.destroy()        닫을 때 (쓰던 메모 저장)
//  · 나만 보기: sheet_notes (회원 × 악보 × 쪽) — 획만 따로 저장, PDF는 그대로
//  · 좌표: 쪽 너비 = 10000. 여백은 쪽 너비의 절반까지(음수 · 10000 넘는 값)
//  · 인터넷이 끊기면 이 기기에 먼저 저장하고, 연결되면 올림
// =====================================================================
(function () {
  const L = () => CONTI.lib;
  const U = 10000, M = 0.5;
  const PENS = ["#1F1A2B", "#D93025", "#1F5C99", "#1F7A55", "#E8710A", "#6A2BC9", "#D63384", "#0F8FA8"];
  const PEN_NAMES = ["검정", "빨강", "파랑", "초록", "주황", "보라", "분홍", "청록"];
  const HIS = ["#FFE14D", "#9BE15D", "#7FD3F7", "#FF9EC7"];
  const HI_NAMES = ["노랑", "연두", "하늘", "분홍"];
  const SIZES = [[16, "가늘게"], [30, "보통"], [56, "굵게"]];
  const HI_W = 150;
  const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const PREF_K = "pole2.ink.pref";
  const pref = Object.assign({ tool: "pen", pc: 2, hc: 0, sz: 1, finger: false, hide: false }, ls.get(PREF_K) || {});
  const savePref = () => ls.set(PREF_K, pref);

  // ------------------------------------------------------------------ 저장소 (서버 + 이 기기)
  const S = { uid: null, mem: new Map(), loaded: new Set(), timer: null, busy: false };
  const idOf = (key, page) => `${key}|${page}`;
  async function uid() {
    if (S.uid) return S.uid;
    try { const { data } = await sb.auth.getSession(); S.uid = data?.session?.user?.id || null; } catch {}
    return S.uid;
  }
  const lsk = (what) => `pole2.ink.${S.uid || "x"}.${what}`;
  const pendingAll = () => ls.get(lsk("pending")) || {};
  function cacheWrite() {
    // 이 기기 사본: 최근 300쪽만
    const all = [...S.mem.entries()].filter(([, v]) => v.strokes?.length).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 300);
    ls.set(lsk("cache"), Object.fromEntries(all));
  }
  function cacheRead() { const c = ls.get(lsk("cache")) || {}; Object.entries(c).forEach(([k, v]) => { if (!S.mem.has(k)) S.mem.set(k, v); }); }
  async function load(keys) {
    await uid();
    keys = [...new Set(keys.filter(Boolean))].filter((k) => !S.loaded.has(k));
    if (!keys.length) return;
    cacheRead();
    const pend = pendingAll();
    try {
      const { data, error } = await sb.from("sheet_notes").select("key, page, ver, song_id, strokes, updated_at").in("key", keys);
      if (error) throw error;
      keys.forEach((k) => { for (const id of [...S.mem.keys()]) if (id.startsWith(k + "|") && !pend[id]) S.mem.delete(id); S.loaded.add(k); });
      (data || []).forEach((r) => { const id = idOf(r.key, r.page); if (!pend[id]) S.mem.set(id, { strokes: r.strokes || [], ver: r.ver, song: r.song_id, at: Date.parse(r.updated_at) || 0 }); });
      cacheWrite();
    } catch { /* 인터넷이 없으면 이 기기 사본으로 */ }
    Object.entries(pend).forEach(([id, v]) => S.mem.set(id, v));
  }
  function put(ink, strokes) {
    const id = idOf(ink.key, ink.page);
    const v = { key: ink.key, page: ink.page, strokes, ver: ink.ver || null, song: ink.song || null, at: Date.now() };
    S.mem.set(id, v);
    const p = pendingAll(); p[id] = v; ls.set(lsk("pending"), p);
    cacheWrite();
    clearTimeout(S.timer); S.timer = setTimeout(flush, 900);
  }
  async function flush() {
    clearTimeout(S.timer);
    if (S.busy) { S.timer = setTimeout(flush, 600); return; }
    const me = await uid(); if (!me) return;
    const p = pendingAll(), ids = Object.keys(p); if (!ids.length) return;
    S.busy = true;
    try {
      for (const id of ids) {
        const v = p[id];
        const r = v.strokes?.length
          ? await sb.from("sheet_notes").upsert({ member_id: me, key: v.key, page: v.page, ver: v.ver, song_id: v.song, strokes: v.strokes, updated_at: new Date(v.at).toISOString() }, { onConflict: "member_id,key,page" })
          : await sb.from("sheet_notes").delete().match({ member_id: me, key: v.key, page: v.page });
        if (r.error) { if (/fetch|network|Failed/i.test(r.error.message || "")) break; console.warn("메모 저장 실패", r.error.message); }
        const now = pendingAll(); if (now[id]?.at === v.at) { delete now[id]; ls.set(lsk("pending"), now); }
      }
    } catch { /* 연결되면 다시 */ } finally { S.busy = false; }
  }
  window.addEventListener("online", () => flush());
  const pendingCount = () => Object.keys(pendingAll()).length;
  // 이 곡의 다른 악보에 쓴 메모 (지난 메모 보기)
  async function songHistory(song, exceptKey) {
    await uid();
    const { data } = await sb.from("sheet_notes").select("key, page, strokes, updated_at").eq("song_id", song).like("key", "s:%").neq("key", exceptKey);
    const rows = (data || []).filter((r) => r.strokes?.length);
    if (!rows.length) return [];
    const ids = [...new Set(rows.map((r) => +r.key.slice(2)))];
    const { data: sv } = await sb.from("sheet_versions").select("id, name, key, path, pages, created_at").in("id", ids);
    return (sv || []).map((v) => ({ ...v, notes: rows.filter((r) => r.key === `s:${v.id}`), at: Math.max(...rows.filter((r) => r.key === `s:${v.id}`).map((r) => Date.parse(r.updated_at) || 0)) }))
      .sort((a, b) => b.at - a.at);
  }

  // ------------------------------------------------------------------ 획 그리기
  function trace(g, st, tf) {
    const p = st.p, n = p.length / 2;
    const X = (i) => tf.ox + (p[2 * i] / U) * tf.k, Y = (i) => tf.oy + (p[2 * i + 1] / U) * tf.k;
    g.beginPath();
    g.moveTo(X(0), Y(0));
    if (n === 1) { g.lineTo(X(0) + 0.01, Y(0)); return; }
    for (let i = 1; i < n - 1; i++) { const mx = (X(i) + X(i + 1)) / 2, my = (Y(i) + Y(i + 1)) / 2; g.quadraticCurveTo(X(i), Y(i), mx, my); }
    g.lineTo(X(n - 1), Y(n - 1));
  }
  function paintStrokes(g, strokes, tf) {
    g.lineCap = "round"; g.lineJoin = "round";
    for (const pass of ["h", "p"]) {
      for (const st of strokes) {
        if ((st.t === "h") !== (pass === "h") || !st.p?.length) continue;
        g.save();
        if (st.t === "h") { g.globalAlpha = 0.4; g.globalCompositeOperation = "multiply"; }
        g.strokeStyle = st.c; g.lineWidth = Math.max(0.6, (st.w / U) * tf.k);
        trace(g, st, tf); g.stroke(); g.restore();
      }
    }
  }
  const bboxOf = (strokes) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    strokes.forEach((s) => { const h = (s.w || 0) / 2; for (let i = 0; i < s.p.length; i += 2) { x0 = Math.min(x0, s.p[i] - h); x1 = Math.max(x1, s.p[i] + h); y0 = Math.min(y0, s.p[i + 1] - h); y1 = Math.max(y1, s.p[i + 1] + h); } });
    return x0 === Infinity ? null : { x0: x0 / U, y0: y0 / U, x1: x1 / U, y1: y1 / U };
  };
  const segDist = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  const hits = (st, x, y, r) => {
    const p = st.p, rr = r + (st.w || 0) / 2;
    if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) <= rr;
    for (let i = 0; i + 3 < p.length; i += 2) if (segDist(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= rr) return true;
    return false;
  };

  // 한 쪽(PDF 쪽 또는 그림)의 크기 · 그리기
  async function pageMeta(pg) {
    if (pg.img) { const im = await L().sheetImage(pg.img); return { A: im.naturalHeight / im.naturalWidth, im, maxW: im.naturalWidth * 1.25 }; }
    const doc = await L().sheetDoc(pg.path), page = await doc.getPage(pg.p), v1 = page.getViewport({ scale: 1 });
    return { A: v1.height / v1.width, doc, maxW: 1e9 };
  }
  async function paintPage(cv, pg, meta, wpx) {
    const w = Math.max(100, Math.round(Math.min(wpx, meta.maxW, Math.sqrt(16e6 / meta.A))));
    if (meta.im) {
      cv.width = w; cv.height = Math.round(w * meta.A);
      const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(meta.im, 0, 0, cv.width, cv.height);
    } else {
      const tmp = await L().renderPage(meta.doc, pg.p, w);
      cv.width = tmp.width; cv.height = tmp.height; cv.getContext("2d").drawImage(tmp, 0, 0);
    }
    return w;
  }

  // ------------------------------------------------------------------ 보기 (확대 · 이동 · 필기)
  function view({ stage, canvas, root, bar, onTurn, label = "" }) {
    const ink = document.createElement("canvas"); ink.className = "iv-ink";
    const paper = document.createElement("div"); paper.className = "iv-paper hidden";
    const hint = document.createElement("div"); hint.className = "iv-hint hidden";
    stage.insertBefore(paper, canvas); canvas.after(ink); stage.appendChild(hint);
    stage.classList.add("iv-stage"); canvas.classList.add("iv-page");
    const V = {
      pg: null, ink: null, meta: null, A: 1.414, k: 1, ox: 0, oy: 0, rendered: 0, token: 0, pen: false,
      strokes: [], undo: [], cur: null, ptr: new Map(), pinch: null, pan: null, swipe: null, lastTap: 0, penAt: 0,
      rerender: null, raf: 0, dead: false, oldVer: false, hist: null,
    };
    const dpr = () => Math.min(window.devicePixelRatio || 1, 2.5);
    const SW = () => stage.clientWidth, SH = () => stage.clientHeight;
    const visible = () => !pref.hide || V.pen;
    const canWrite = () => !!V.ink && !!V.meta;
    // 볼 범위: 쪽 + (메모가 보이면) 여백의 메모
    const contentBox = () => {
      let b = { x0: 0, y0: 0, x1: 1, y1: V.A };
      const bb = visible() && V.strokes.length ? bboxOf(V.strokes) : null;
      if (bb) b = { x0: Math.max(-M, Math.min(0, bb.x0)), y0: Math.max(-M, Math.min(0, bb.y0)), x1: Math.min(1 + M, Math.max(1, bb.x1)), y1: Math.min(V.A + M, Math.max(V.A, bb.y1)) };
      return b;
    };
    const marginBox = () => ({ x0: -M, y0: -M, x1: 1 + M, y1: V.A + M });
    const hasMargin = () => { const b = contentBox(); return b.x0 < 0 || b.y0 < 0 || b.x1 > 1 || b.y1 > V.A; };
    const fitK = (b) => Math.min(SW() / (b.x1 - b.x0), SH() / (b.y1 - b.y0));
    const kPage = () => fitK({ x0: 0, y0: 0, x1: 1, y1: V.A });
        const kMax = () => kPage() * 6;
    const zoomed = () => V.k > fitK(contentBox()) * 1.03;
    const kMinOf = () => Math.min(fitK(contentBox()) * (hasMargin() ? 0.96 : 1), V.pen ? fitK(marginBox()) : Infinity);
    function fit() {
      const b = contentBox(), k = fitK(b) * (hasMargin() ? 0.96 : 1);
      V.k = k; V.ox = (SW() - (b.x1 - b.x0) * k) / 2 - b.x0 * k; V.oy = (SH() - (b.y1 - b.y0) * k) / 2 - b.y0 * k;
      apply(); V.fitted = true;
    }
    function clamp() {
      V.k = Math.max(kMinOf(), Math.min(kMax(), V.k));
      const b = V.pen ? marginBox() : contentBox();
      const fix = (o, a0, a1, S) => { const w = (a1 - a0) * V.k; return w <= S ? (S - w) / 2 - a0 * V.k : Math.min(-a0 * V.k, Math.max(S - a1 * V.k, o)); };
      V.ox = fix(V.ox, b.x0, b.x1, SW()); V.oy = fix(V.oy, b.y0, b.y1, SH());
    }
    function apply() {
      if (!V.meta) return;
      clamp();
      Object.assign(canvas.style, { left: `${V.ox}px`, top: `${V.oy}px`, width: `${V.k}px`, height: `${V.k * V.A}px` });
      const showPaper = V.pen ? canWrite() : visible() && V.strokes.length && hasMargin();
      paper.classList.toggle("hidden", !showPaper);
      if (showPaper) { const b = V.pen ? marginBox() : contentBox(); Object.assign(paper.style, { left: `${V.ox + b.x0 * V.k}px`, top: `${V.oy + b.y0 * V.k}px`, width: `${(b.x1 - b.x0) * V.k}px`, height: `${(b.y1 - b.y0) * V.k}px` }); }
      stage.classList.toggle("iv-zoom", zoomed());
      redraw();
      clearTimeout(V.rerender);
      if (V.k * dpr() > V.rendered * 1.2 && V.rendered < Math.sqrt(16e6 / V.A) * 0.95) V.rerender = setTimeout(sharpen, 280);
    }
    async function sharpen() {
      const t = V.token, pg = V.pg, meta = V.meta; if (!pg || !meta) return;
      const tmp = document.createElement("canvas");
      const w = await paintPage(tmp, pg, meta, V.k * dpr()).catch(() => 0);
      if (!w || t !== V.token) return;
      canvas.width = tmp.width; canvas.height = tmp.height; canvas.getContext("2d").drawImage(tmp, 0, 0); V.rendered = w;
    }
    function redraw() {
      if (V.raf) return;
      V.raf = requestAnimationFrame(() => {
        V.raf = 0;
        const d = dpr(), w = Math.round(SW() * d), h = Math.round(SH() * d);
        if (ink.width !== w || ink.height !== h) { ink.width = w; ink.height = h; }
        const g = ink.getContext("2d"); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
        if (!V.meta || !visible()) return;
        g.setTransform(d, 0, 0, d, 0, 0);
        const tf = { ox: V.ox, oy: V.oy, k: V.k };
        paintStrokes(g, V.cur ? [...V.strokes, V.cur] : V.strokes, tf);
      });
    }
    // ---------------------------------------------------------------- 도구 막대
    function barHTML() {
      const tool = pref.tool, cols = tool === "hl" ? HIS : PENS, names = tool === "hl" ? HI_NAMES : PEN_NAMES, ci = tool === "hl" ? pref.hc : pref.pc;
      const note = !V.ink ? "이 악보에는 메모를 쓰지 않아요" : V.oldVer ? "이전 판 메모" : "";
      return `<div class="iv-bar" role="toolbar" aria-label="메모 도구"><div class="iv-scroll">
        <span class="iv-on">${ICON_PEN}<span>필기 중</span></span>
        <span class="iv-grp">${[["pen", "펜"], ["hl", "형광펜"], ["eraser", "지우개"]].map(([k, n]) => `<button type="button" data-iv-tool="${k}" aria-pressed="${tool === k}">${n}</button>`).join("")}</span>
        ${tool === "eraser" ? `<span class="small iv-tip">지울 획을 문질러요</span>` : `<span class="iv-grp iv-sw">${cols.map((c, i) => `<button type="button" class="iv-c" data-iv-c="${i}" style="--c:${c}" aria-pressed="${ci === i}" aria-label="${names[i]}"></button>`).join("")}</span>`}
        ${tool === "pen" ? `<span class="iv-grp">${SIZES.map(([w, n], i) => `<button type="button" class="iv-sz" data-iv-sz="${i}" aria-pressed="${pref.sz === i}" aria-label="${n}"><i style="width:${4 + i * 4}px;height:${4 + i * 4}px"></i></button>`).join("")}</span>` : ""}
        <button type="button" data-iv="undo" ${V.undo.length ? "" : "disabled"}>되돌리기</button>
        <button type="button" data-iv="finger" aria-pressed="${pref.finger}" title="애플펜슬이 없으면 켜요">손가락으로 쓰기</button>
        <span class="iv-sp"></span>
        ${note ? `<span class="chip ${V.oldVer ? "chip-warn" : "chip-gray"}">${note}</span>` : `<span class="iv-me">나만 보여요</span>`}</div>
        <button type="button" class="iv-pg" data-iv="prevpg" aria-label="이전 쪽">‹</button><button type="button" class="iv-pg" data-iv="nextpg" aria-label="다음 쪽">›</button>
        <button type="button" class="iv-done" data-iv="done">완료</button></div>`;
    }
    function renderBar() {
      if (bar) { bar.innerHTML = V.pen ? barHTML() : ""; bar.classList.toggle("hidden", !V.pen); }
      root.querySelectorAll("[data-iv=pen]").forEach((b) => {
        b.disabled = !V.ink; b.setAttribute("aria-pressed", String(V.pen));
        b.innerHTML = `${ICON_PEN}<span>${pref.hide && !V.pen ? "메모 숨김" : "메모"}</span>`;
        b.title = V.ink ? "" : "이 악보에는 메모를 쓰지 않아요";
      });
      root.querySelectorAll("[data-iv=hide]").forEach((b) => { b.setAttribute("aria-pressed", String(!pref.hide)); b.textContent = pref.hide ? "메모 보이기" : "메모 숨기기"; b.classList.toggle("hidden", !V.ink || V.pen || (!V.strokes.length && !pref.hide)); });
      stage.classList.toggle("iv-pen", V.pen);
    }
    function setPen(on) {
      endStroke();
      V.pen = !!on;
      if (V.pen && pref.hide) { pref.hide = false; savePref(); }
      if (!V.pen) { save(); flush(); }
      renderBar(); apply();
      if (!V.pen && !zoomed()) fit();
    }
    function save() { if (V.ink && V.dirty) { put(V.ink, V.strokes); V.dirty = false; } }
    // ---------------------------------------------------------------- 쪽 바꾸기
    async function show(pg, stale = () => false) {
      endStroke(); save();
      const t = ++V.token;
      V.pg = pg; V.ink = pg.ink && pg.ink.key ? pg.ink : null; V.undo = []; V.cur = null; V.hist = null; hint.classList.add("hidden"); closeRef();
      if (V.ink) await load([V.ink.key]);
      const meta = await pageMeta(pg);
      if (t !== V.token || stale()) return false;
      V.meta = meta; V.A = meta.A;
      const n = V.ink ? S.mem.get(idOf(V.ink.key, V.ink.page)) : null;
      V.strokes = n?.strokes ? n.strokes.slice() : [];
      V.oldVer = !!(V.ink?.ver && n?.ver && n.ver !== V.ink.ver && V.strokes.length);
      // 처음 볼 때: 쪽(+ 여백 메모)에 맞춤
      const b = contentBox(), k = fitK(b);
      V.rendered = await paintPage(canvas, pg, meta, Math.max(k, kPage()) * dpr());
      if (t !== V.token || stale()) return false;
      canvas.classList.remove("hidden"); ink.classList.remove("hidden");
      fit(); renderBar();
      if (V.oldVer) { hint.innerHTML = `<span class="iv-oldtag">이전 판 악보집에 쓴 메모</span>`; hint.classList.toggle("hidden", !visible()); }
      if (V.ink?.song && V.ink.key.startsWith("s:")) checkHistory(t);
      return true;
    }
    function clear() {
      endStroke(); save();
      V.token++; V.pg = null; V.ink = null; V.meta = null; V.strokes = []; V.undo = [];
      canvas.classList.add("hidden"); ink.classList.add("hidden"); paper.classList.add("hidden"); hint.classList.add("hidden"); closeRef();
      stage.classList.remove("iv-zoom"); renderBar();
    }
    // 이 곡 지난 메모 (새 악보로 저장돼 이 악보엔 메모가 없을 때)
    async function checkHistory(t) {
      const key = V.ink.key;
      const any = [...S.mem.entries()].some(([id, v]) => id.startsWith(key + "|") && v.strokes?.length);
      if (any) return;
      let h = [];
      try { h = await songHistory(V.ink.song, key); } catch {}
      if (t !== V.token || !h.length) return;
      V.hist = h;
      hint.innerHTML = `<button type="button" data-iv="hist">이 곡 지난 메모 보기</button>`; hint.classList.remove("hidden");
    }
    let ref = null;
    function closeRef() { ref?.remove(); ref = null; }
    async function openRef() {
      const h = V.hist; if (!h?.length) return;
      closeRef();
      ref = document.createElement("div"); ref.className = "iv-ref";
      const R = { s: 0, n: 0 };
      const pagesOf = (v) => v.notes.map((x) => x.page).sort((a, b) => a - b);
      ref.innerHTML = `<div class="iv-ref-top"><select class="iv-ref-sel" aria-label="악보">${h.map((v, i) => `<option value="${i}">${esc(v.name)} · ${md(v.created_at.slice(0, 10))}</option>`).join("")}</select>
        <span class="iv-ref-pg"></span><button type="button" data-ref="prev" aria-label="이전">‹</button><button type="button" data-ref="next" aria-label="다음">›</button><button type="button" data-ref="close" aria-label="닫기">닫기</button></div>
        <div class="iv-ref-body"><canvas></canvas></div><div class="iv-ref-foot small">지난 메모는 보기만 해요. 필요한 건 이 악보에 다시 적어 주세요.</div>`;
      stage.appendChild(ref);
      const draw = async () => {
        const v = h[R.s], ps = pagesOf(v), page = ps[R.n];
        ref.querySelector(".iv-ref-pg").textContent = `${page}쪽 · ${R.n + 1}/${ps.length}`;
        const box = ref.querySelector(".iv-ref-body"), cv = ref.querySelector("canvas");
        const pg = { path: v.path, p: page }, meta = await pageMeta(pg);
        const strokes = v.notes.find((x) => x.page === page)?.strokes || [];
        const bb = bboxOf(strokes) || { x0: 0, y0: 0, x1: 1, y1: meta.A };
        const b = { x0: Math.min(0, bb.x0), y0: Math.min(0, bb.y0), x1: Math.max(1, bb.x1), y1: Math.max(meta.A, bb.y1) };
        const k = Math.min(box.clientWidth / (b.x1 - b.x0), box.clientHeight / (b.y1 - b.y0)), d = dpr();
        const pc = document.createElement("canvas"); await paintPage(pc, pg, meta, k * d);
        cv.width = Math.round((b.x1 - b.x0) * k * d); cv.height = Math.round((b.y1 - b.y0) * k * d);
        cv.style.width = `${(b.x1 - b.x0) * k}px`; cv.style.height = `${(b.y1 - b.y0) * k}px`;
        const g = cv.getContext("2d"); g.setTransform(d, 0, 0, d, 0, 0);
        g.fillStyle = "#EEEAF3"; g.fillRect(0, 0, (b.x1 - b.x0) * k, (b.y1 - b.y0) * k);
        g.drawImage(pc, -b.x0 * k, -b.y0 * k, k, k * meta.A);
        paintStrokes(g, strokes, { ox: -b.x0 * k, oy: -b.y0 * k, k });
      };
      ref.addEventListener("change", (e) => { if (e.target.matches(".iv-ref-sel")) { R.s = +e.target.value; R.n = 0; draw(); } });
      ref.addEventListener("click", (e) => {
        const a = e.target.closest("[data-ref]")?.dataset.ref; if (!a) return;
        if (a === "close") return closeRef();
        const n = pagesOf(h[R.s]).length;
        R.n = Math.max(0, Math.min(n - 1, R.n + (a === "next" ? 1 : -1))); draw();
      });
      ref.addEventListener("pointerdown", (e) => e.stopPropagation());
      draw().catch(() => {});
    }
    // ---------------------------------------------------------------- 손 · 펜 입력
    const world = (e) => { const r = stage.getBoundingClientRect(); return [((e.clientX - r.left - V.ox) / V.k) * U, ((e.clientY - r.top - V.oy) / V.k) * U]; };
    const local = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const drawsWith = (e) => V.pen && canWrite() && (e.pointerType === "pen" || e.pointerType === "mouse" || (e.pointerType === "touch" && pref.finger && Date.now() - V.penAt > 800));
    const inMargin = (x, y) => Math.max(-M * U, Math.min((1 + M) * U, x)) === x && Math.max(-M * U, Math.min((V.A + M) * U, y)) === y;
    function beginStroke(e) {
      const [x, y] = world(e);
      if (pref.tool === "eraser") { V.cur = null; V.erasing = { removed: [] }; eraseAt(x, y); return; }
      if (!inMargin(x, y)) return;
      const hl = pref.tool === "hl";
      V.cur = { t: hl ? "h" : "p", c: hl ? HIS[pref.hc] || HIS[0] : PENS[pref.pc] || PENS[0], w: hl ? HI_W : (SIZES[pref.sz] || SIZES[1])[0], p: [Math.round(x), Math.round(y)] };
      redraw();
    }
    function moveStroke(e) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs.length ? evs : [e]) {
        const [x, y] = world(ev);
        if (V.erasing) { eraseAt(x, y); continue; }
        if (!V.cur) continue;
        const p = V.cur.p, lx = p[p.length - 2], ly = p[p.length - 1];
        const cx = Math.max(-M * U, Math.min((1 + M) * U, x)), cy = Math.max(-M * U, Math.min((V.A + M) * U, y));
        if (Math.hypot(cx - lx, cy - ly) * (V.k / U) < 0.8) continue;
        p.push(Math.round(cx), Math.round(cy));
      }
      redraw();
    }
    function eraseAt(x, y) {
      const r = (10 / V.k) * U;
      for (let i = V.strokes.length - 1; i >= 0; i--) if (hits(V.strokes[i], x, y, r)) { V.erasing.removed.push({ i, st: V.strokes[i] }); V.strokes.splice(i, 1); }
      redraw();
    }
    function endStroke(cancel) {
      if (V.erasing) {
        if (V.erasing.removed.length) { V.undo.push({ t: "erase", items: V.erasing.removed }); V.dirty = true; save(); }
        V.erasing = null; renderBar(); return;
      }
      if (!V.cur) return;
      const st = V.cur; V.cur = null;
      if (!cancel && st.p.length >= 2) { V.strokes.push(st); V.undo.push({ t: "add", st }); V.dirty = true; save(); renderBar(); }
      redraw();
    }
    function undo() {
      const u = V.undo.pop(); if (!u) return;
      if (u.t === "add") { const i = V.strokes.lastIndexOf(u.st); if (i >= 0) V.strokes.splice(i, 1); }
      if (u.t === "erase") u.items.slice().reverse().forEach(({ i, st }) => V.strokes.splice(Math.min(i, V.strokes.length), 0, st));
      V.dirty = true; save(); renderBar(); redraw();
    }
    function zoomAt(f, cx, cy) {
      V.fitted = false;
      const k0 = V.k, k = Math.max(kMinOf(), Math.min(kMax(), k0 * f));
      V.ox = cx - ((cx - V.ox) * k) / k0; V.oy = cy - ((cy - V.oy) * k) / k0; V.k = k; apply();
    }
    const onDown = (e) => {
      if (!V.meta || e.target.closest(".iv-ref, .iv-hint, .bk-toast")) return;
      if (e.pointerType === "pen") {
        V.penAt = Date.now();
        // 손바닥이 먼저 닿아 있어도 펜이 오면 펜만 씀
        for (const [id, q] of [...V.ptr]) if (q.type === "touch") V.ptr.delete(id);
        V.pinch = null; V.pan = null; V.swipe = null;
      }
      // 펜을 쓰는 중이면 손바닥(터치)은 무시
      if (e.pointerType === "touch" && V.ptr.size && [...V.ptr.values()].some((p) => p.type === "pen")) return;
      V.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      if (V.ptr.size === 1 && drawsWith(e)) {
        stage.setPointerCapture?.(e.pointerId); V.drawId = e.pointerId; beginStroke(e); e.preventDefault(); return;
      }
      if (V.ptr.size === 2) {
        if (V.drawId != null) { endStroke(true); V.drawId = null; }
        const [a, b] = [...V.ptr.values()];
        const [cx, cy] = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
        V.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx, cy }; V.pan = null; V.swipe = null; V.gestured = true; return;
      }
      if (V.ptr.size === 1) {
        V.gestured = false;
        if (e.pointerType === "touch" || e.pointerType === "mouse") {
          if (zoomed() || (V.pen && e.pointerType === "mouse")) V.pan = { x: e.clientX, y: e.clientY };
          else if (!V.pen) V.swipe = { x: e.clientX, y: e.clientY };
          else if (V.pen) V.pan = { x: e.clientX, y: e.clientY };
        }
      }
    };
    const onMove = (e) => {
      if (!V.ptr.has(e.pointerId)) return;
      const p = V.ptr.get(e.pointerId); p.x = e.clientX; p.y = e.clientY;
      if (V.drawId === e.pointerId) { moveStroke(e); e.preventDefault(); return; }
      if (V.pinch && V.ptr.size >= 2) {
        const [a, b] = [...V.ptr.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const [cx, cy] = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
        V.ox += cx - V.pinch.cx; V.oy += cy - V.pinch.cy;
        zoomAt(d / V.pinch.d, cx, cy);
        V.pinch = { d, cx, cy }; return;
      }
      if (V.pan) { const dx = e.clientX - V.pan.x, dy = e.clientY - V.pan.y; if (Math.abs(dx) + Math.abs(dy) > 3) { V.gestured = true; V.fitted = false; } V.ox += dx; V.oy += dy; V.pan = { x: e.clientX, y: e.clientY }; apply(); }
    };
    const onUp = (e) => {
      if (!V.ptr.has(e.pointerId)) return;
      const p = V.ptr.get(e.pointerId); V.ptr.delete(e.pointerId);
      if (V.drawId === e.pointerId) { V.drawId = null; endStroke(e.type === "pointercancel"); return; }
      if (V.pinch) { if (V.ptr.size < 2) { V.pinch = null; if (V.ptr.size === 1) { const q = [...V.ptr.values()][0]; V.pan = { x: q.x, y: q.y }; } } return; }
      if (V.swipe) {
        const dx = e.clientX - V.swipe.x, dy = e.clientY - V.swipe.y; V.swipe = null;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && e.type !== "pointercancel") { V.gestured = true; onTurn?.(dx < 0 ? 1 : -1); return; }
      }
      V.pan = null;
      // 두 번 톡 → 맞춤 (펜으로 그리는 중은 제외)
      if (!V.gestured && p.type !== "pen" && e.type === "pointerup") {
        const now = Date.now();
        if (now - V.lastTap < 320 && Math.hypot(e.clientX - V.lastXY[0], e.clientY - V.lastXY[1]) < 30) { V.lastTap = 0; fit(); return; }
        V.lastTap = now; V.lastXY = [e.clientX, e.clientY];
      }
    };
    const onWheel = (e) => {
      if (!V.meta) return;
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); const [cx, cy] = local(e); zoomAt(Math.exp(-e.deltaY / 300), cx, cy); return; }
      if (zoomed() || V.pen) { e.preventDefault(); V.fitted = false; V.ox -= e.deltaX; V.oy -= e.deltaY; apply(); }
    };
    // 확대 · 필기 중에는 화면 끝 탭으로 넘기지 않음 (펜 · 확대 후 손가락 뗄 때 click도 막음)
    const onClickCap = (e) => { if (e.target.closest(".cvv-tap, [data-bkl=prev], [data-bkl=next]") && (V.pen || zoomed() || V.gestured)) { e.stopPropagation(); e.preventDefault(); } };
    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);
    stage.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && V.drawId === e.pointerId) onUp(e); });
    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("click", onClickCap, true);
    stage.addEventListener("dblclick", (e) => { if (!V.pen) fit(); });
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-iv], [data-iv-tool], [data-iv-c], [data-iv-sz]"); if (!b || !root.contains(b)) return;
      if (b.dataset.ivTool) { pref.tool = b.dataset.ivTool; savePref(); return renderBar(); }
      if (b.dataset.ivC) { if (pref.tool === "hl") pref.hc = +b.dataset.ivC; else pref.pc = +b.dataset.ivC; savePref(); return renderBar(); }
      if (b.dataset.ivSz) { pref.sz = +b.dataset.ivSz; savePref(); return renderBar(); }
      const a = b.dataset.iv;
      if (a === "pen") return setPen(!V.pen);
      if (a === "done") return setPen(false);
      if (a === "undo") return undo();
      if (a === "finger") { pref.finger = !pref.finger; savePref(); toast(pref.finger ? "손가락으로도 써져요 · 두 손가락은 확대 · 이동" : "펜으로만 써져요 · 손가락은 확대 · 이동"); return renderBar(); }
      if (a === "hide") { pref.hide = !pref.hide; savePref(); if (V.oldVer) hint.classList.toggle("hidden", pref.hide); renderBar(); fit(); return; }
      if (a === "prevpg") return onTurn?.(-1);
      if (a === "nextpg") return onTurn?.(1);
      if (a === "hist") return openRef();
    });
    // 무대 크기가 바뀌면(화면 돌림 · 도구 막대) 맞춤이었으면 다시 맞추고, 확대 중이면 그대로
    let lastWH = "";
    const onResize = () => {
      if (V.dead) return;
      const wh = `${SW()}x${SH()}`; if (wh === lastWH) return; lastWH = wh;
      if (!V.meta) return redraw();
      if (V.fitted) fit(); else apply();
    };
    window.addEventListener("resize", onResize);
    const ro = window.ResizeObserver ? new ResizeObserver(onResize) : null; ro?.observe(stage);
    renderBar();
    const api = {
      show, clear, fit, setPen, sync: renderBar, prefetch: (keys) => load(keys).catch(() => {}),
      flush: () => { endStroke(); save(); return flush(); },
      destroy() { endStroke(); save(); flush(); V.dead = true; window.removeEventListener("resize", onResize); ro?.disconnect(); },
      get state() { return { k: V.k, kFit: V.meta ? fitK(contentBox()) : 0, kPage: V.meta ? kPage() : 0, pen: V.pen, strokes: V.strokes.length, zoomed: V.meta ? zoomed() : false, key: V.ink?.key || null, page: V.ink?.page || null, oldVer: V.oldVer, hist: V.hist?.length || 0, pending: pendingCount(), ox: V.ox, oy: V.oy }; },
    };
    return api;
  }
  const ICON_PEN = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

  window.INK = { view, flush, load, PENS, HIS, _S: S, ICON_PEN };
  flush();
})();
