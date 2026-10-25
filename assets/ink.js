// =====================================================================
//  악보 필기 (024 내 메모 · 025 공유 필기) — 악보 위에 손으로 쓰기 · 확대/축소 · 악보 밖 여백 필기
//  INK.view({ stage, canvas, root, bar, onTurn })  : 악보 보기 무대(stage)에 붙임 (콘티 악보 보기 · 백업찬양 진행 화면)
//    iv.show(pg, stale)  쪽 그리기 (pg = { path, p } | { img })
//        pg.ink    = { key, page, ver, song, anorm }   내 메모 (나만 보기 · sheet_notes)
//        pg.shared = { sheet, page, date, svc, canEdit, canEraseAll, kind, name, fork(name) → 새 악보 id }
//                    공유 필기 (저장된 악보 위 필기 층 · sheet_ink) — 그 예배 날짜 기준으로 보여요
//                    027: sheet가 글자면 콘티 곡 밖 (ink_extra) — 'a:<적용찬양 id>' · 'p:<예배 진행곡 id>' · 'b:<백업찬양 코드>'(+ ver 악보집 판)
//                         kind = 'extra' → 새 악보로 저장 없음 · 지난 필기 보기(적용찬양 anorm · 백업찬양 이전 판)
//    iv.clear()          악보 없는 쪽
//    iv.prefetch(keys)   여러 악보의 내 메모를 한 번에 받아 둠
//    iv.destroy()        닫을 때 (쓰던 필기 저장)
//  · 좌표: 쪽 너비 = 10000. 내 메모 여백은 쪽 너비의 절반까지(음수 · 10000 넘는 값). 공유 필기는 쪽 안에만
//  · 섞기(025): 펜 · 형광펜은 '곱하기' — 흰 바탕엔 색이, 검은 음표 · 글자는 그대로 위에 보여요. 수정 테이프만 위에 덮어요
//  · 직선(025): 긋고 끝에서 0.5초쯤 멈추면 직선으로 펴져요
//  · 인터넷이 끊기면 이 기기에 먼저 저장하고, 연결되면 올림
// =====================================================================
(function () {
  // 029: 섬김이 링크는 CONTI 없이 자기 악보 도구(lib)를 넘겨요
  let LIB = null;
  const L = () => LIB || CONTI.lib;
  const U = 10000, M = 0.5;
  const PENS = ["#1F1A2B", "#D93025", "#1F5C99", "#1F7A55", "#E8710A", "#6A2BC9", "#D63384", "#0F8FA8"];
  const PEN_NAMES = ["검정", "빨강", "파랑", "초록", "주황", "보라", "분홍", "청록"];
  const HIS = ["#FFE14D", "#9BE15D", "#7FD3F7", "#FF9EC7"];
  const HI_NAMES = ["노랑", "연두", "하늘", "분홍"];
  const SIZES = [[16, "가늘게"], [30, "보통"], [56, "굵게"]];
  const HI_SIZES = [[90, "가늘게"], [150, "보통"], [240, "굵게"]];
  const TAPE_SIZES = [[110, "가늘게"], [190, "보통"], [300, "굵게"]];
  const TAPE = "#FFFFFF";
  const WHO = ["#D93025", "#1F5C99", "#1F7A55", "#E8710A", "#6A2BC9", "#D63384", "#0F8FA8", "#8B6B12"];
  const HOLD_MS = 500;
  const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const PREF_K = "pole2.ink.pref";
  const pref = Object.assign({ tool: "pen", pc: 2, hc: 0, sz: 1, hsz: 1, tsz: 1, finger: false, hide: false, who: false }, ls.get(PREF_K) || {});
  const savePref = () => ls.set(PREF_K, pref);
  const sizeOf = (tool) => (tool === "hl" ? (HI_SIZES[pref.hsz] || HI_SIZES[1])[0] : tool === "tape" ? (TAPE_SIZES[pref.tsz] || TAPE_SIZES[1])[0] : (SIZES[pref.sz] || SIZES[1])[0]);
  const cidOf = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);

  // ------------------------------------------------------------------ 저장소: 내 메모 (서버 + 이 기기)
  const S = { uid: null, name: null, mem: new Map(), loaded: new Set(), timer: null, busy: false };
  const idOf = (key, page) => `${key}|${page}`;
  async function uid() {
    if (S.local) { S.uid = "local"; return S.uid; }
    if (S.uid) return S.uid;
    try { const { data } = await sb.auth.getSession(); S.uid = data?.session?.user?.id || null; } catch {}
    if (S.uid && !S.name) sb.from("members").select("name").eq("id", S.uid).maybeSingle().then((r) => { S.name = r.data?.name || null; }, () => {});
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
    if (S.local) return localReady();
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
    if (S.local) return localPut(id, v);
    const p = pendingAll(); p[id] = v; ls.set(lsk("pending"), p);
    cacheWrite();
    clearTimeout(S.timer); S.timer = setTimeout(flush, 900);
  }
  async function flush() {
    clearTimeout(S.timer);
    if (S.local) return;
    if (S.busy) { S.timer = setTimeout(flush, 600); return; }
    const me = await uid(); if (!me) return;
    await flushShared();
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
  const pendingCount = () => Object.keys(pendingAll()).length + shPending().length;

  // ------------------------------------------------------------------ 029: 이 기기에만 저장 (섬김이 링크 · 로그인 없음)
  //  IndexedDB 'pole2-ink' (안 되면 localStorage). 링크마다 따로: id = '<링크>|<악보 key>|<쪽>'
  let localLoad = null;
  const idb = () => new Promise((ok, no) => { try { const r = indexedDB.open("pole2-ink", 1); r.onupgradeneeded = () => r.result.createObjectStore("notes"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); } catch (e) { no(e); } });
  function localReady() {
    if (localLoad) return localLoad;
    const pre = `${S.local}|`;
    localLoad = (async () => {
      try {
        const db = await idb();
        const rows = await new Promise((ok, no) => { const out = []; const q = db.transaction("notes").objectStore("notes").openCursor(); q.onsuccess = () => { const c = q.result; if (!c) return ok(out); if (String(c.key).startsWith(pre)) out.push([String(c.key).slice(pre.length), c.value]); c.continue(); }; q.onerror = () => no(q.error); });
        rows.forEach(([id, v]) => S.mem.set(id, v)); S.idb = db;
      } catch {
        const all = ls.get(`pole2.ink.local.${S.local}`) || {};
        Object.entries(all).forEach(([id, v]) => S.mem.set(id, v));
      }
    })();
    return localLoad;
  }
  function localPut(id, v) {
    const key = `${S.local}|${id}`;
    if (S.idb) {
      try { const st = S.idb.transaction("notes", "readwrite").objectStore("notes"); if (v.strokes?.length) st.put(v, key); else st.delete(key); return; } catch {}
    }
    const all = ls.get(`pole2.ink.local.${S.local}`) || {};
    if (v.strokes?.length) all[id] = v; else delete all[id];
    try { localStorage.setItem(`pole2.ink.local.${S.local}`, JSON.stringify(all)); } catch { toast("이 기기 저장 공간이 모자라 메모를 저장하지 못했어요", 4000); }
  }

  // ------------------------------------------------------------------ 저장소: 공유 필기 (악보마다 획 한 줄씩)
  //  행: { cid, page, stroke, author, author_name, valid_from, deleted_from, id }
  const SH = { rows: new Map(), at: new Map(), timer: null, busy: false, warned: 0 };
  const shPending = () => ls.get(lsk("shpend")) || [];
  const shSave = (list) => ls.set(lsk("shpend"), list);
  //  027: 숫자 = 콘티 악보(sheet_ink) · 글자 = 콘티 밖(ink_extra: a: · p: · b:)
  async function shLoad(sheets, force) {
    sheets = [...new Set(sheets.filter(Boolean))].filter((s) => force || !SH.rows.has(s));
    if (!sheets.length) return false;
    const nums = sheets.filter((s) => typeof s === "number"), strs = sheets.filter((s) => typeof s === "string");
    const [a, b] = await Promise.all([
      nums.length ? sb.from("sheet_ink").select("id, sheet_id, cid, page, stroke, author, author_name, valid_from, deleted_from").in("sheet_id", nums).order("id") : { data: [] },
      strs.length ? sb.from("ink_extra").select("id, target, ver, cid, page, stroke, author, author_name, valid_from, deleted_from").in("target", strs).order("id") : { data: [] },
    ]);
    if (a.error || b.error) return false;
    const data = [...(a.data || []), ...(b.data || []).map((r) => ({ ...r, sheet_id: r.target }))];
    let changed = false;
    sheets.forEach((s) => {
      const m = new Map();
      data.filter((r) => r.sheet_id === s).forEach((r) => m.set(r.cid, r));
      // 아직 올리지 못한 내 획 · 지우기를 다시 얹음
      shPending().filter((o) => o.sheet === s).forEach((o) => shApplyLocal(m, o));
      const old = SH.rows.get(s), sig = (mm) => [...mm.values()].map((r) => `${r.cid}${r.deleted_from || ""}`).join();
      if (!old || sig(old) !== sig(m)) changed = true;
      SH.rows.set(s, m); SH.at.set(s, Date.now());
    });
    return changed;
  }
  function shApplyLocal(m, o) {
    if (o.op === "add") { if (!m.has(o.cid)) m.set(o.cid, { cid: o.cid, page: o.page, ver: o.ver || null, stroke: o.stroke, author: S.uid, author_name: S.name || "나", valid_from: o.date, deleted_from: null, id: 1e15 + (o.n || 0) }); }
    else if (o.op === "del") { const r = m.get(o.cid); if (r && (!r.deleted_from || r.deleted_from > o.date)) r.deleted_from = o.date; }
    else if (o.op === "undel") { const r = m.get(o.cid); if (r) r.deleted_from = null; }
  }
  let shN = 0;
  function shOp(o) {
    o.n = ++shN;
    const m = SH.rows.get(o.sheet) || new Map(); SH.rows.set(o.sheet, m);
    shApplyLocal(m, o);
    const list = shPending(); list.push(o); shSave(list);
    clearTimeout(SH.timer); SH.timer = setTimeout(flushShared, 350);
  }
  async function flushShared() {
    clearTimeout(SH.timer);
    if (SH.busy) { SH.timer = setTimeout(flushShared, 500); return; }
    let list = shPending(); if (!list.length) return;
    SH.busy = true;
    try {
      while (list.length) {
        const head = list[0], batch = list.filter((o) => o.svc === head.svc && o.sheet === head.sheet && (o.ver || null) === (head.ver || null)).slice(0, 200);
        const ops = { add: [], del: [], undel: [] };
        batch.forEach((o) => { if (o.op === "add") ops.add.push({ cid: o.cid, page: o.page, stroke: o.stroke }); else ops[o.op].push(o.cid); });
        const { data, error } = typeof head.sheet === "string"
          ? await sb.rpc("ink_put", { p_service: head.svc, p_target: head.sheet, p_ver: head.ver || null, p_ops: ops })
          : await sb.rpc("sheet_ink_put", { p_service: head.svc, p_sheet: head.sheet, p_ops: ops });
        if (error && /fetch|network|Failed/i.test(error.message || "")) break;
        if (error) toast(error.message || "필기를 저장하지 못했어요", 4500);
        else if (data?.skipped && Date.now() - SH.warned > 4000) { SH.warned = Date.now(); toast("다른 사람 필기는 수정 테이프로 덮어 주세요", 3500); }
        const done = new Set(batch.map((o) => o.n));
        list = shPending().filter((o) => !done.has(o.n)); shSave(list);
        if (error) { await shLoad([head.sheet], true); views.forEach((v) => v.refreshShared?.()); }
      }
    } catch { /* 연결되면 다시 */ } finally { SH.busy = false; }
  }
  // 그 예배 날짜에 보이는 획 (쓴 차례대로) · 027: ver(백업찬양 악보집 판)가 있으면 그 판만 · page가 null이면 모든 쪽
  const shLive = (r, date, ver) => r.valid_from <= date && !(r.deleted_from && r.deleted_from <= date) && (!ver || r.ver === ver);
  function shVisible(sheet, page, date, ver) {
    const m = SH.rows.get(sheet); if (!m) return [];
    return [...m.values()].filter((r) => (page == null || r.page === page) && shLive(r, date, ver))
      .sort((a, b) => a.id - b.id).map((r) => ({ ...r.stroke, cid: r.cid, author: r.author, author_name: r.author_name }));
  }
  const views = new Set();

  // 이 곡의 다른 악보 · 같은 적용찬양에 쓴 내 메모 (지난 메모 보기)
  async function songHistory(ink) {
    await uid();
    if (ink.key.startsWith("a:")) {
      if (!ink.anorm) return [];
      const { data } = await sb.from("sheet_notes").select("key, page, strokes, updated_at").eq("anorm", ink.anorm).like("key", "a:%").neq("key", ink.key);
      const rows = (data || []).filter((r) => r.strokes?.length);
      if (!rows.length) return [];
      const ids = [...new Set(rows.map((r) => +r.key.slice(2)))];
      const { data: ap } = await sb.from("applied_songs").select("id, title, images, services(service_date)").in("id", ids);
      return (ap || []).map((a) => { const notes = rows.filter((r) => r.key === `a:${a.id}`), d = a.services?.service_date || "";
        return { label: `${d ? md(d) + " · " : ""}${a.title}`, notes, at: Math.max(...notes.map((r) => Date.parse(r.updated_at) || 0)), src: (page) => ({ img: a.images[page - 1] }) }; })
        .filter((v) => v.notes.some((x) => v.src(x.page).img)).sort((a, b) => b.at - a.at);
    }
    const { data } = await sb.from("sheet_notes").select("key, page, strokes, updated_at").eq("song_id", ink.song).like("key", "s:%").neq("key", ink.key);
    const rows = (data || []).filter((r) => r.strokes?.length);
    if (!rows.length) return [];
    const ids = [...new Set(rows.map((r) => +r.key.slice(2)))];
    const { data: sv } = await sb.from("sheet_versions").select("id, name, key, path, pages, created_at").in("id", ids);
    return (sv || []).map((v) => { const notes = rows.filter((r) => r.key === `s:${v.id}`);
      return { label: `${v.name} · ${md(v.created_at.slice(0, 10))}`, notes, at: Math.max(...notes.map((r) => Date.parse(r.updated_at) || 0)), src: (page) => ({ path: v.path, p: page }) }; })
      .sort((a, b) => b.at - a.at);
  }

  // 027: 공유 필기 지난 것 — 적용찬양: 같은 곡 이름의 지난 예배 사진에 쓴 필기 · 백업찬양: 이전 판 악보집에 쓴 필기
  async function shHistory(sh) {
    const [t, v] = String(sh.sheet).split(":");
    const group = (rows) => [...new Set(rows.map((r) => r.page))].sort((a, b) => a - b).map((pg) => ({ page: pg, strokes: rows.filter((r) => r.page === pg).map((r) => r.stroke) }));
    if (t === "a") {
      if (!sh.anorm) return [];
      const { data: ap } = await sb.from("applied_songs").select("id, title, images, services(service_date)").eq("norm", sh.anorm).neq("id", +v);
      if (!ap?.length) return [];
      const { data } = await sb.from("ink_extra").select("target, page, stroke").in("target", ap.map((a) => `a:${a.id}`)).is("deleted_from", null).order("id");
      return ap.map((a) => { const d = a.services?.service_date || "";
        return { label: `${d ? md(d) + " · " : ""}${a.title}`, d, notes: group((data || []).filter((r) => r.target === `a:${a.id}`)), src: (page) => ({ img: a.images[page - 1] }) }; })
        .filter((x) => x.notes.some((n) => x.src(n.page).img)).sort((a, b) => (b.d > a.d ? 1 : b.d < a.d ? -1 : 0));
    }
    if (t === "b") {
      const m = SH.rows.get(sh.sheet); if (!m) return [];
      const rows = [...m.values()].filter((r) => r.ver && r.ver !== sh.ver && !r.deleted_from);
      const out = [];
      for (const ver of [...new Set(rows.map((r) => r.ver))]) {
        const mine = rows.filter((r) => r.ver === ver);
        let src = null, label = "";
        if (/^c\d+$/.test(ver)) {
          const { data: x } = await sb.from("backup_songs").select("title, images").eq("id", +ver.slice(1)).maybeSingle();
          if (x?.images?.length) { src = (page) => ({ img: x.images[page - 1] }); label = `사진 악보 · ${x.title}`; }
        } else {
          const { data: x } = await sb.from("backup_songs").select("title, page, backup_books(label, path)").eq("book_id", +ver).eq("code", v).maybeSingle();
          if (x?.page && x.backup_books?.path) { src = (page) => ({ path: x.backup_books.path, p: x.page + page - 1 }); label = `${x.backup_books.label} · ${x.title}`; }
        }
        if (src) out.push({ label, at: Math.max(...mine.map((r) => r.id)), notes: group(mine), src });
      }
      return out.filter((x) => x.notes.some((n) => { const s = x.src(n.page); return s.img || s.path; })).sort((a, b) => b.at - a.at);
    }
    return [];
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
  const lw = (st, tf) => Math.max(0.6, (st.w / U) * tf.k);
  // 내 메모 겹 (화면에서 '곱하기'로 악보와 섞임): 형광펜 먼저, 그 위에 펜. 수정 테이프는 따로(paintTape)
  function paintStrokes(g, strokes, tf) {
    g.lineCap = "round"; g.lineJoin = "round";
    for (const pass of ["h", "p"]) {
      for (const st of strokes) {
        if (st.t !== pass || !st.p?.length) continue;
        g.save();
        if (st.t === "h") { g.globalAlpha = 0.4; g.globalCompositeOperation = "multiply"; }
        g.strokeStyle = st.c; g.lineWidth = lw(st, tf);
        trace(g, st, tf); g.stroke(); g.restore();
      }
    }
  }
  function paintTape(g, strokes, tf) {
    g.lineCap = "round"; g.lineJoin = "round";
    for (const st of strokes) { if (st.t !== "t" || !st.p?.length) continue; g.save(); g.strokeStyle = TAPE; g.lineWidth = lw(st, tf); trace(g, st, tf); g.stroke(); g.restore(); }
  }
  // 공유 필기를 악보 쪽 그림에 바로 그림 (쓴 차례대로): 펜 · 형광펜은 곱하기, 테이프는 덮기
  //  colorOf: '고친 사람 보기' — 사람마다 색 (테이프는 반투명)
  function paintOnPage(g, strokes, tf, colorOf) {
    g.lineCap = "round"; g.lineJoin = "round";
    for (const st of strokes) {
      if (!st.p?.length) continue;
      g.save();
      const c = colorOf ? colorOf(st) : null;
      if (st.t === "t") { if (c) { g.globalAlpha = 0.55; g.strokeStyle = c; } else g.strokeStyle = TAPE; }
      else { g.globalCompositeOperation = "multiply"; if (st.t === "h") g.globalAlpha = 0.4; g.strokeStyle = c || st.c; }
      g.lineWidth = lw(st, tf);
      trace(g, st, tf); g.stroke(); g.restore();
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
  const MAXPX = 12e6;
  async function pageMeta(pg) {
    if (pg.img) { const im = await L().sheetImage(pg.img); return { A: im.naturalHeight / im.naturalWidth, im, maxW: im.naturalWidth * 1.25 }; }
    const doc = await L().sheetDoc(pg.path), page = await doc.getPage(pg.p), v1 = page.getViewport({ scale: 1 });
    return { A: v1.height / v1.width, doc, maxW: 1e9 };
  }
  // 029: 앞뒤 쪽을 미리 그려 둔 그림 (최근 6장)
  const RC = new Map();
  const targetW = (meta, wpx) => Math.max(100, Math.round(Math.min(wpx, meta.maxW, Math.sqrt(MAXPX / meta.A))));
  const rcKey = (pg, w) => `${pg.img || pg.path}|${pg.p || 0}|${w}`;
  function rcPut(k, cv) { RC.delete(k); RC.set(k, cv); while (RC.size > 6) RC.delete(RC.keys().next().value); }
  async function paintCached(pg, meta, wpx) {
    const w = targetW(meta, wpx), k = rcKey(pg, w);
    if (RC.has(k)) { const cv = RC.get(k); RC.delete(k); RC.set(k, cv); return { cv, w, hit: true }; }
    const cv = document.createElement("canvas"); await paintPage(cv, pg, meta, wpx); rcPut(k, cv);
    return { cv, w, hit: false };
  }
  async function paintPage(cv, pg, meta, wpx) {
    const w = targetW(meta, wpx);
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
    const tapeCv = document.createElement("canvas"); tapeCv.className = "iv-tape";
    const ink = document.createElement("canvas"); ink.className = "iv-ink";
    const paper = document.createElement("div"); paper.className = "iv-paper hidden";
    const hint = document.createElement("div"); hint.className = "iv-hint hidden";
    const legend = document.createElement("div"); legend.className = "iv-legend hidden";
    stage.insertBefore(paper, canvas); canvas.after(tapeCv); tapeCv.after(ink); stage.appendChild(hint); stage.appendChild(legend);
    stage.classList.add("iv-stage"); canvas.classList.add("iv-page");
    const V = {
      pg: null, ink: null, sh: null, meta: null, base: null, A: 1.414, k: 1, ox: 0, oy: 0, rendered: 0, token: 0, pen: false, layer: "memo",
      strokes: [], shared: [], undo: [], cur: null, ptr: new Map(), pinch: null, pan: null, swipe: null, lastTap: 0, penAt: 0,
      rerender: null, raf: 0, dead: false, oldVer: false, hist: null, forkAsk: false, hold: null,
    };
    const dpr = () => Math.min(window.devicePixelRatio || 1, 2.5);
    const SW = () => stage.clientWidth, SH_ = () => stage.clientHeight;
    const shared = () => V.pen && V.layer === "shared";
    const visible = () => !pref.hide || (V.pen && V.layer === "memo");
    const canWrite = () => (shared() ? !!V.sh?.canEdit && V.sh.kind !== "original" && !V.forkAsk : !!V.ink) && !!V.meta;
    // 볼 범위: 쪽 + (메모가 보이면) 여백의 메모
    const contentBox = () => {
      let b = { x0: 0, y0: 0, x1: 1, y1: V.A };
      const bb = visible() && V.strokes.length ? bboxOf(V.strokes) : null;
      if (bb) b = { x0: Math.max(-M, Math.min(0, bb.x0)), y0: Math.max(-M, Math.min(0, bb.y0)), x1: Math.min(1 + M, Math.max(1, bb.x1)), y1: Math.min(V.A + M, Math.max(V.A, bb.y1)) };
      return b;
    };
    const marginBox = () => (shared() ? { x0: 0, y0: 0, x1: 1, y1: V.A } : { x0: -M, y0: -M, x1: 1 + M, y1: V.A + M });
    const hasMargin = () => { const b = contentBox(); return b.x0 < 0 || b.y0 < 0 || b.x1 > 1 || b.y1 > V.A; };
    const fitK = (b) => Math.min(SW() / (b.x1 - b.x0), SH_() / (b.y1 - b.y0));
    const kPage = () => fitK({ x0: 0, y0: 0, x1: 1, y1: V.A });
    const kMax = () => kPage() * 6;
    const zoomed = () => V.k > fitK(contentBox()) * 1.03;
    const kMinOf = () => Math.min(fitK(contentBox()) * (hasMargin() ? 0.96 : 1), V.pen ? fitK(marginBox()) : Infinity);
    function fit() {
      const b = contentBox(), k = fitK(b) * (hasMargin() ? 0.96 : 1);
      V.k = k; V.ox = (SW() - (b.x1 - b.x0) * k) / 2 - b.x0 * k; V.oy = (SH_() - (b.y1 - b.y0) * k) / 2 - b.y0 * k;
      apply(); V.fitted = true;
    }
    function clamp() {
      V.k = Math.max(kMinOf(), Math.min(kMax(), V.k));
      const b = V.pen ? marginBox() : contentBox();
      const fix = (o, a0, a1, S) => { const w = (a1 - a0) * V.k; return w <= S ? (S - w) / 2 - a0 * V.k : Math.min(-a0 * V.k, Math.max(S - a1 * V.k, o)); };
      V.ox = fix(V.ox, b.x0, b.x1, SW()); V.oy = fix(V.oy, b.y0, b.y1, SH_());
    }
    function apply() {
      if (!V.meta) return;
      clamp();
      Object.assign(canvas.style, { left: `${V.ox}px`, top: `${V.oy}px`, width: `${V.k}px`, height: `${V.k * V.A}px` });
      const showPaper = V.pen && V.layer === "memo" ? canWrite() : visible() && V.strokes.length && hasMargin();
      paper.classList.toggle("hidden", !showPaper);
      if (showPaper) { const b = V.pen ? marginBox() : contentBox(); Object.assign(paper.style, { left: `${V.ox + b.x0 * V.k}px`, top: `${V.oy + b.y0 * V.k}px`, width: `${(b.x1 - b.x0) * V.k}px`, height: `${(b.y1 - b.y0) * V.k}px` }); }
      stage.classList.toggle("iv-zoom", zoomed());
      redraw();
      clearTimeout(V.rerender);
      if (V.k * dpr() > V.rendered * 1.2 && V.rendered < Math.sqrt(MAXPX / V.A) * 0.95) V.rerender = setTimeout(sharpen, 280);
    }
    async function sharpen() {
      const t = V.token, pg = V.pg, meta = V.meta; if (!pg || !meta) return;
      const tmp = document.createElement("canvas");
      const w = await paintPage(tmp, pg, meta, V.k * dpr()).catch(() => 0);
      if (!w || t !== V.token) return;
      V.base = tmp; V.rendered = w; compose();
    }
    // 쪽 그림 = 원래 악보 + 공유 필기
    const whoColors = new Map();
    const colorOf = (st) => { const k = st.author || st.author_name || "?"; if (!whoColors.has(k)) whoColors.set(k, WHO[whoColors.size % WHO.length]); return whoColors.get(k); };
    function compose() {
      if (!V.base) return;
      if (canvas.width !== V.base.width || canvas.height !== V.base.height) { canvas.width = V.base.width; canvas.height = V.base.height; }
      const g = canvas.getContext("2d"); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
      g.drawImage(V.base, 0, 0);
      const showWho = pref.who && shared();
      if (V.shared.length) paintOnPage(g, V.shared, { ox: 0, oy: 0, k: canvas.width }, showWho ? colorOf : null);
      drawLegend();
    }
    function drawLegend() {
      const on = pref.who && shared() && V.shared.length;
      legend.classList.toggle("hidden", !on);
      if (!on) return;
      const names = new Map(); V.shared.forEach((st) => { const k = st.author || st.author_name || "?"; if (!names.has(k)) names.set(k, { name: st.author === S.uid ? "나" : st.author_name || "?", c: colorOf(st), n: 0 }); names.get(k).n++; });
      legend.innerHTML = `<b>고친 사람</b>${[...names.values()].map((x) => `<span><i style="background:${x.c}"></i>${esc(x.name)} ${x.n}</span>`).join("")}`;
    }
    function refreshShared() {
      if (!V.sh) return;
      V.shared = V.sh.static || shVisible(V.sh.sheet, V.sh.page, V.sh.date, V.sh.ver);
      if (V.shared.length && V.shHist) { V.shHist = null; renderHint(); }
      compose();
    }
    function redraw() {
      if (V.raf) return;
      V.raf = requestAnimationFrame(() => {
        V.raf = 0;
        const d = dpr(), w = Math.round(SW() * d), h = Math.round(SH_() * d);
        for (const c of [ink, tapeCv]) { if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } const g = c.getContext("2d"); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); }
        if (!V.meta) return;
        const tf = { ox: V.ox, oy: V.oy, k: V.k };
        const gi = ink.getContext("2d"), gt = tapeCv.getContext("2d");
        gi.setTransform(d, 0, 0, d, 0, 0); gt.setTransform(d, 0, 0, d, 0, 0);
        const mine = visible() ? V.strokes : [];
        const cur = V.cur ? [V.cur] : [];
        paintTape(gt, [...mine, ...cur], tf);
        paintStrokes(gi, [...mine, ...cur], tf);
      });
    }
    // ---------------------------------------------------------------- 도구 막대
    function barHTML() {
      const tool = pref.tool, sh = V.layer === "shared";
      if (sh && V.forkAsk) {
        const orig = V.sh?.kind === "original";
        return `<div class="iv-bar iv-shared" role="toolbar" aria-label="새 악보로 저장"><div class="iv-scroll">
          <span class="iv-on sh">${ICON_PEN}<span>${orig ? "원본 악보예요" : "새 악보로 저장"}</span></span>
          <span class="small iv-tip">${orig ? "원본은 그대로 두고, 이름을 붙인 새 악보에 고쳐요" : "지금 필기를 옮긴 새 악보를 만들어 이 콘티에 써요"}</span>
          <input class="iv-name" id="ivForkName" maxlength="60" value="${esc(V.forkName || "")}" aria-label="새 악보 이름" placeholder="새 악보 이름">
          <button type="button" data-iv="fork-ok" class="iv-ok">만들고 고치기</button>${orig ? "" : `<button type="button" data-iv="fork-cancel">취소</button>`}</div>
          <button type="button" class="iv-done" data-iv="done">완료</button></div>`;
      }
      const cols = tool === "hl" ? HIS : PENS, names = tool === "hl" ? HI_NAMES : PEN_NAMES, ci = tool === "hl" ? pref.hc : pref.pc;
      const sizes = tool === "hl" ? HI_SIZES : tool === "tape" ? TAPE_SIZES : SIZES, si = tool === "hl" ? pref.hsz : tool === "tape" ? pref.tsz : pref.sz;
      const note = sh ? "" : !V.ink ? "이 악보에는 메모를 쓰지 않아요" : V.oldVer ? "이전 판 메모" : "";
      const myUndo = V.undo.filter((u) => u.layer === V.layer).length;
      return `<div class="iv-bar ${sh ? "iv-shared" : ""}" role="toolbar" aria-label="${sh ? "악보 고치기 도구" : "메모 도구"}"><div class="iv-scroll">
        <span class="iv-on ${sh ? "sh" : ""}">${ICON_PEN}<span>${sh ? "악보 고치는 중" : "필기 중"}</span></span>
        <span class="iv-grp">${[["pen", "펜"], ["hl", "형광펜"], ["tape", "수정 테이프"], ["eraser", "지우개"]].map(([k, n]) => `<button type="button" data-iv-tool="${k}" aria-pressed="${tool === k}">${n}</button>`).join("")}</span>
        ${tool === "eraser" ? `<span class="small iv-tip">${sh && !V.sh?.canEraseAll ? "내가 쓴 획만 지워요 · 남의 필기는 수정 테이프로" : "지울 획을 문질러요"}</span>`
          : tool === "tape" ? `<span class="small iv-tip">흰색으로 덮어요 · 그 위에 새로 써요</span>`
          : `<span class="iv-grp iv-sw">${cols.map((c, i) => `<button type="button" class="iv-c" data-iv-c="${i}" style="--c:${c}" aria-pressed="${ci === i}" aria-label="${names[i]}"></button>`).join("")}</span>`}
        ${tool !== "eraser" ? `<span class="iv-grp">${sizes.map(([w, n], i) => `<button type="button" class="iv-sz" data-iv-sz="${i}" aria-pressed="${si === i}" aria-label="${n}"><i style="width:${4 + i * 4}px;height:${4 + i * 4}px"></i></button>`).join("")}</span>` : ""}
        <button type="button" data-iv="undo" ${myUndo ? "" : "disabled"}>되돌리기</button>
        ${sh ? `<button type="button" data-iv="who" aria-pressed="${pref.who}">고친 사람 보기</button>${V.sh?.kind === "extra" ? "" : `<button type="button" data-iv="fork">새 악보로 저장</button>`}${V.sh?.canEraseAll ? `<button type="button" data-iv="wipe">전부 지우기</button>` : ""}` : ""}
        <button type="button" data-iv="finger" aria-pressed="${pref.finger}" title="애플펜슬이 없으면 켜요">손가락으로 쓰기</button>
        <span class="iv-sp"></span>
        ${sh ? `<span class="iv-me sh">모두에게 보여요 · 알림 없음</span>` : note ? `<span class="chip ${V.oldVer ? "chip-warn" : "chip-gray"}">${note}</span>` : S.local ? `<span class="iv-me" title="아이폰 · 아이패드는 사파리와 홈 화면 앱이 따로 저장해요">이 기기에만 저장돼요</span>` : `<span class="iv-me">나만 보여요</span>`}</div>
        <button type="button" class="iv-pg" data-iv="prevpg" aria-label="이전 쪽">‹</button><button type="button" class="iv-pg" data-iv="nextpg" aria-label="다음 쪽">›</button>
        <button type="button" class="iv-done" data-iv="done">완료</button></div>`;
    }
    function renderBar() {
      if (bar) { bar.innerHTML = V.pen ? barHTML() : ""; bar.classList.toggle("hidden", !V.pen); }
      root.querySelectorAll("[data-iv=pen]").forEach((b) => {
        b.disabled = !V.ink; b.setAttribute("aria-pressed", String(V.pen && V.layer === "memo"));
        b.innerHTML = `${ICON_PEN}<span>${pref.hide && !V.pen ? "메모 숨김" : "메모"}</span>`;
        b.title = V.ink ? "" : "이 악보에는 메모를 쓰지 않아요";
      });
      root.querySelectorAll("[data-iv=fix]").forEach((b) => {
        const can = !!V.sh?.canEdit;
        b.classList.toggle("hidden", !can); b.disabled = !can; b.setAttribute("aria-pressed", String(V.pen && V.layer === "shared"));
        b.innerHTML = `${ICON_FIX}<span>악보 고치기</span>`;
      });
      root.querySelectorAll("[data-iv=hide]").forEach((b) => { b.setAttribute("aria-pressed", String(!pref.hide)); b.textContent = pref.hide ? "메모 보이기" : "메모 숨기기"; b.classList.toggle("hidden", !V.ink || V.pen || (!V.strokes.length && !pref.hide)); });
      stage.classList.toggle("iv-pen", V.pen);
      stage.classList.toggle("iv-fixing", shared());
    }
    function setPen(on, layer = "memo") {
      endStroke();
      const was = V.pen && V.layer;
      V.pen = !!on; V.layer = layer;
      if (V.pen && layer === "memo" && pref.hide) { pref.hide = false; savePref(); }
      if (V.pen && layer === "memo" && S.local && !ls.get("pole2.ink.localtip")) { ls.set("pole2.ink.localtip", 1); toast("메모는 이 기기 · 이 브라우저에만 저장돼요. 아이폰 · 아이패드는 사파리와 홈 화면 앱이 따로 저장하니 한쪽에서만 써 주세요", 6000); }
      if (V.pen && layer === "shared") {
        V.forkAsk = V.sh?.kind === "original";
        if (V.forkAsk) V.forkName = V.sh.defName || "";
        if (pref.tool === "eraser" && !V.sh) pref.tool = "pen";
        shLoad([V.sh?.sheet], true).then((c) => { if (c) refreshShared(); });
      }
      if (!V.pen) { V.forkAsk = false; save(); flush(); }
      renderBar(); renderHint(); apply();
      if (was === "shared" || (V.pen && layer === "shared")) compose();
      if (!V.pen && !zoomed()) fit();
      if (V.forkAsk) setTimeout(() => bar?.querySelector("#ivForkName")?.focus(), 0);
    }
    function save() { if (V.ink && V.dirty) { put(V.ink, V.strokes); V.dirty = false; } }
    // ---------------------------------------------------------------- 쪽 바꾸기
    async function show(pg, stale = () => false) {
      endStroke(); save();
      const t = ++V.token;
      V.pg = pg; V.ink = pg.ink && pg.ink.key ? pg.ink : null; V.sh = pg.shared && pg.shared.sheet ? pg.shared : null;
      V.undo = []; V.cur = null; V.hist = null; V.shHist = null; hint.classList.add("hidden"); closeRef();
      if (V.pen && V.layer === "shared" && !V.sh?.canEdit) { V.pen = false; V.layer = "memo"; }
      if (V.pen && V.layer === "memo" && !V.ink) V.pen = false;
      V.forkAsk = V.pen && V.layer === "shared" && V.sh?.kind === "original";
      if (V.forkAsk) V.forkName = V.sh.defName || "";
      await uid();
      await Promise.all([V.ink ? load([V.ink.key]) : null, V.sh && !V.sh.static ? shLoad([V.sh.sheet]).catch(() => {}) : null]);
      const meta = await pageMeta(pg);
      if (t !== V.token || stale()) return false;
      V.meta = meta; V.A = meta.A;
      const n = V.ink ? S.mem.get(idOf(V.ink.key, V.ink.page)) : null;
      V.strokes = n?.strokes ? n.strokes.slice() : [];
      V.shared = V.sh ? (V.sh.static || shVisible(V.sh.sheet, V.sh.page, V.sh.date, V.sh.ver)) : [];
      V.oldVer = !!(V.ink?.ver && n?.ver && n.ver !== V.ink.ver && V.strokes.length);
      // 처음 볼 때: 쪽(+ 여백 메모)에 맞춤
      const b = contentBox(), k = fitK(b);
      const { cv: base, w: rw } = await paintCached(pg, meta, Math.max(k, kPage()) * dpr());
      V.rendered = rw;
      if (t !== V.token || stale()) return false;
      V.base = base; compose();
      canvas.classList.remove("hidden"); ink.classList.remove("hidden"); tapeCv.classList.remove("hidden");
      fit(); renderBar();
      renderHint();
      if (!S.local && V.sh && !V.shared.length && V.sh.kind === "extra" && /^[ab]:/.test(V.sh.sheet)) checkShHistory(t);
      if (!S.local && V.ink && ((V.ink.song && V.ink.key.startsWith("s:")) || (V.ink.anorm && V.ink.key.startsWith("a:")))) checkHistory(t);
      return true;
    }
    function clear() {
      endStroke(); save();
      V.token++; V.pg = null; V.ink = null; V.sh = null; V.meta = null; V.base = null; V.strokes = []; V.shared = []; V.undo = [];
      if (V.pen) { V.pen = false; V.layer = "memo"; }
      canvas.classList.add("hidden"); ink.classList.add("hidden"); tapeCv.classList.add("hidden"); paper.classList.add("hidden"); hint.classList.add("hidden"); legend.classList.add("hidden"); closeRef();
      stage.classList.remove("iv-zoom"); renderBar();
    }
    // 이 곡 지난 메모 (새 악보로 저장돼 이 악보엔 메모가 없을 때 · 적용찬양은 같은 곡 이름)
    async function checkHistory(t) {
      const key = V.ink.key;
      const any = [...S.mem.entries()].some(([id, v]) => id.startsWith(key + "|") && v.strokes?.length);
      if (any) return;
      let h = [];
      try { h = await songHistory(V.ink); } catch {}
      if (t !== V.token || !h.length) return;
      V.hist = h; renderHint();
    }
    // 027: 쪽 위 안내 — 이전 판 메모 · 이 곡 지난 메모 보기 · 지난 공유 필기 보기
    function renderHint() {
      const parts = [];
      if (V.oldVer && visible()) parts.push(`<span class="iv-oldtag">이전 판 악보집에 쓴 메모</span>`);
      if (V.hist?.length) parts.push(`<button type="button" data-iv="hist">이 곡 지난 메모 보기</button>`);
      if (V.shHist?.length) parts.push(`<button type="button" data-iv="shhist" class="sh">${String(V.sh?.sheet).startsWith("b:") ? "이전 판 필기 보기" : "이 곡 지난 필기 보기"}</button>`);
      hint.innerHTML = parts.join("");
      hint.classList.toggle("hidden", !parts.length);
    }
    async function checkShHistory(t) {
      let h = [];
      try { h = await shHistory(V.sh); } catch {}
      if (t !== V.token || !h.length || V.shared.length) return;
      V.shHist = h; renderHint();
    }
    // 027: 전부 지우기 — 이 곡(모든 쪽)에 이 예배 날짜에 보이는 공유 필기를 모두 (인도자 · 밴드 마스터 · 리더십)
    function wipeShared() {
      if (!V.sh?.canEraseAll) return;
      const all = shVisible(V.sh.sheet, null, V.sh.date, V.sh.ver);
      if (!all.length) return toast("지울 필기가 없어요");
      if (!confirm(`이 곡에 쓴 공유 필기 ${all.length}획을 모두 지울까요? 이 예배부터 안 보여요 (지난 예배는 그대로).`)) return;
      all.forEach((st) => shOp({ op: "del", svc: V.sh.svc, sheet: V.sh.sheet, ver: V.sh.ver, cid: st.cid, date: V.sh.date }));
      V.undo.push({ layer: "shared", t: "erase", items: all.map((st) => ({ st })) });
      refreshShared(); renderBar();
      toast("모두 지웠어요 · 되돌리기로 살릴 수 있어요", 3000);
    }
    let ref = null;
    function closeRef() { ref?.remove(); ref = null; }
    async function openRef(sh = false) {
      const h = sh ? V.shHist : V.hist; if (!h?.length) return;
      closeRef();
      ref = document.createElement("div"); ref.className = "iv-ref";
      const R = { s: 0, n: 0 };
      const pagesOf = (v) => v.notes.map((x) => x.page).sort((a, b) => a - b);
      ref.innerHTML = `<div class="iv-ref-top"><select class="iv-ref-sel" aria-label="악보">${h.map((v, i) => `<option value="${i}">${esc(v.label)}</option>`).join("")}</select>
        <span class="iv-ref-pg"></span><button type="button" data-ref="prev" aria-label="이전">‹</button><button type="button" data-ref="next" aria-label="다음">›</button><button type="button" data-ref="close" aria-label="닫기">닫기</button></div>
        <div class="iv-ref-body"><canvas></canvas></div><div class="iv-ref-foot small">${sh ? "지난 필기는 보기만 해요. 필요한 건 '악보 고치기'로 이 악보에 다시 적어 주세요." : "지난 메모는 보기만 해요. 필요한 건 이 악보에 다시 적어 주세요."}</div>`;
      stage.appendChild(ref);
      const draw = async () => {
        const v = h[R.s], ps = pagesOf(v), page = ps[R.n];
        ref.querySelector(".iv-ref-pg").textContent = `${page}쪽 · ${R.n + 1}/${ps.length}`;
        const box = ref.querySelector(".iv-ref-body"), cv = ref.querySelector("canvas");
        const pg = v.src(page), meta = await pageMeta(pg);
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
        const tf = { ox: -b.x0 * k, oy: -b.y0 * k, k };
        if (sh) paintOnPage(g, strokes, tf); else { paintTape(g, strokes, tf); paintOnPage(g, strokes.filter((s) => s.t !== "t"), tf); }
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
    // ---------------------------------------------------------------- 새 악보로 저장 (공유 필기)
    async function doFork() {
      const name = (bar?.querySelector("#ivForkName")?.value || "").trim();
      if (!name) return toast("새 악보 이름을 적어 주세요");
      if (!V.sh?.fork) return;
      const btn = bar?.querySelector("[data-iv=fork-ok]"); if (btn) btn.disabled = true;
      try {
        const nid = await V.sh.fork(name);
        await shLoad([nid], true);
        V.sh = { ...V.sh, sheet: nid, kind: "sheet", name };
        V.forkAsk = false; V.undo = V.undo.filter((u) => u.layer !== "shared");
        refreshShared(); renderBar();
        toast(`'${name}' 악보로 저장했어요 · 이 콘티에 이 악보를 써요`, 3500);
      } catch (err) { toast(err.message || "새 악보를 만들지 못했어요", 4500); if (btn) btn.disabled = false; }
    }
    // ---------------------------------------------------------------- 손 · 펜 입력
    const world = (e) => { const r = stage.getBoundingClientRect(); return [((e.clientX - r.left - V.ox) / V.k) * U, ((e.clientY - r.top - V.oy) / V.k) * U]; };
    const local = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const drawsWith = (e) => V.pen && canWrite() && (e.pointerType === "pen" || e.pointerType === "mouse" || (e.pointerType === "touch" && pref.finger && Date.now() - V.penAt > 800));
    const box = () => { const b = marginBox(); return [b.x0 * U, b.y0 * U, b.x1 * U, b.y1 * U]; };
    const inBox = (x, y) => { const [x0, y0, x1, y1] = box(); return x >= x0 && x <= x1 && y >= y0 && y <= y1; };
    const clampPt = (x, y) => { const [x0, y0, x1, y1] = box(); return [Math.max(x0, Math.min(x1, x)), Math.max(y0, Math.min(y1, y))]; };
    function beginStroke(e) {
      const [x, y] = world(e);
      if (pref.tool === "eraser") { V.cur = null; V.erasing = { removed: [], denied: 0 }; eraseAt(x, y); return; }
      if (!inBox(x, y)) return;
      const t = pref.tool === "hl" ? "h" : pref.tool === "tape" ? "t" : "p";
      V.cur = { t, c: t === "h" ? HIS[pref.hc] || HIS[0] : t === "t" ? TAPE : PENS[pref.pc] || PENS[0], w: sizeOf(pref.tool), p: [Math.round(x), Math.round(y)] };
      V.hold = { x: e.clientX, y: e.clientY, line: false };
      armHold();
      redraw();
    }
    // 25: 긋고 멈추면 직선
    function armHold() {
      clearTimeout(V.holdT);
      V.holdT = setTimeout(() => {
        const c = V.cur; if (!c || !V.hold || V.hold.line) return;
        const p = c.p; if (p.length < 6) return;
        const len = Math.hypot(p[p.length - 2] - p[0], p[p.length - 1] - p[1]) * (V.k / U);
        if (len < 12) return;
        c.p = [p[0], p[1], p[p.length - 2], p[p.length - 1]]; c.line = true; V.hold.line = true;
        if (navigator.vibrate) try { navigator.vibrate(8); } catch {}
        redraw();
      }, HOLD_MS);
    }
    function moveStroke(e) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs.length ? evs : [e]) {
        const [x, y] = world(ev);
        if (V.erasing) { eraseAt(x, y); continue; }
        if (!V.cur) continue;
        const [cx, cy] = clampPt(x, y);
        const p = V.cur.p;
        if (V.hold?.line) { p[2] = Math.round(cx); p[3] = Math.round(cy); continue; }
        const lx = p[p.length - 2], ly = p[p.length - 1];
        if (Math.hypot(cx - lx, cy - ly) * (V.k / U) < 0.8) continue;
        p.push(Math.round(cx), Math.round(cy));
      }
      if (V.cur && V.hold && !V.hold.line && Math.hypot(e.clientX - V.hold.x, e.clientY - V.hold.y) > 5) { V.hold.x = e.clientX; V.hold.y = e.clientY; armHold(); }
      redraw();
    }
    function eraseAt(x, y) {
      const r = (10 / V.k) * U;
      if (shared()) {
        for (let i = V.shared.length - 1; i >= 0; i--) {
          const st = V.shared[i];
          if (!hits(st, x, y, r)) continue;
          if (st.author !== S.uid && !V.sh.canEraseAll) { V.erasing.denied++; continue; }
          V.erasing.removed.push({ i, st }); V.shared.splice(i, 1);
          shOp({ op: "del", svc: V.sh.svc, sheet: V.sh.sheet, ver: V.sh.ver, cid: st.cid, date: V.sh.date });
        }
        if (V.erasing.removed.length) compose();
        return;
      }
      for (let i = V.strokes.length - 1; i >= 0; i--) if (hits(V.strokes[i], x, y, r)) { V.erasing.removed.push({ i, st: V.strokes[i] }); V.strokes.splice(i, 1); }
      redraw();
    }
    function endStroke(cancel) {
      clearTimeout(V.holdT); V.hold = null;
      if (V.erasing) {
        const er = V.erasing; V.erasing = null;
        if (er.removed.length) { V.undo.push({ layer: V.layer, t: "erase", items: er.removed }); if (V.layer === "memo") { V.dirty = true; save(); } }
        if (er.denied && !er.removed.length && Date.now() - SH.warned > 3000) { SH.warned = Date.now(); toast("다른 사람 필기는 지울 수 없어요 · 수정 테이프로 덮어 주세요", 3500); }
        renderBar(); return;
      }
      if (!V.cur) return;
      const st = V.cur; V.cur = null; delete st.line;
      if (!cancel && st.p.length >= 2) {
        if (shared()) {
          const cid = cidOf();
          shOp({ op: "add", svc: V.sh.svc, sheet: V.sh.sheet, ver: V.sh.ver, page: V.sh.page, cid, stroke: st, date: V.sh.date });
          V.undo.push({ layer: "shared", t: "add", cid });
          V.shared = shVisible(V.sh.sheet, V.sh.page, V.sh.date, V.sh.ver); compose();
        } else { V.strokes.push(st); V.undo.push({ layer: "memo", t: "add", st }); V.dirty = true; save(); }
        renderBar();
      }
      redraw();
    }
    function undo() {
      const i = V.undo.map((u) => u.layer).lastIndexOf(V.layer); if (i < 0) return;
      const [u] = V.undo.splice(i, 1);
      if (u.layer === "shared") {
        if (u.t === "add") shOp({ op: "del", svc: V.sh.svc, sheet: V.sh.sheet, ver: V.sh.ver, cid: u.cid, date: V.sh.date });
        if (u.t === "erase") u.items.forEach(({ st }) => shOp({ op: "undel", svc: V.sh.svc, sheet: V.sh.sheet, ver: V.sh.ver, cid: st.cid, date: V.sh.date }));
        refreshShared(); renderBar(); return;
      }
      if (u.t === "add") { const k = V.strokes.lastIndexOf(u.st); if (k >= 0) V.strokes.splice(k, 1); }
      if (u.t === "erase") u.items.slice().reverse().forEach(({ i: at, st }) => V.strokes.splice(Math.min(at, V.strokes.length), 0, st));
      V.dirty = true; save(); renderBar(); redraw();
    }
    function zoomAt(f, cx, cy) {
      V.fitted = false;
      const k0 = V.k, k = Math.max(kMinOf(), Math.min(kMax(), k0 * f));
      V.ox = cx - ((cx - V.ox) * k) / k0; V.oy = cy - ((cy - V.oy) * k) / k0; V.k = k; apply();
    }
    const onDown = (e) => {
      if (!V.meta || e.target.closest(".iv-ref, .iv-hint, .bk-toast, .iv-legend")) return;
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
      if (b.dataset.ivSz) { if (pref.tool === "hl") pref.hsz = +b.dataset.ivSz; else if (pref.tool === "tape") pref.tsz = +b.dataset.ivSz; else pref.sz = +b.dataset.ivSz; savePref(); return renderBar(); }
      const a = b.dataset.iv;
      if (a === "pen") return setPen(!(V.pen && V.layer === "memo"), "memo");
      if (a === "fix") return setPen(!(V.pen && V.layer === "shared"), "shared");
      if (a === "done") return setPen(false);
      if (a === "undo") return undo();
      if (a === "finger") { pref.finger = !pref.finger; savePref(); toast(pref.finger ? "손가락으로도 써져요 · 두 손가락은 확대 · 이동" : "펜으로만 써져요 · 손가락은 확대 · 이동"); return renderBar(); }
      if (a === "who") { pref.who = !pref.who; savePref(); compose(); return renderBar(); }
      if (a === "fork") { V.forkAsk = true; V.forkName = V.sh?.defName || `${V.sh?.name || "악보"} 수정`; renderBar(); return setTimeout(() => bar?.querySelector("#ivForkName")?.select(), 0); }
      if (a === "fork-cancel") { V.forkAsk = false; return renderBar(); }
      if (a === "fork-ok") return doFork();
      if (a === "hide") { pref.hide = !pref.hide; savePref(); renderHint(); renderBar(); fit(); return; }
      if (a === "wipe") return wipeShared();
      if (a === "shhist") return openRef(true);
      if (a === "prevpg") return onTurn?.(-1);
      if (a === "nextpg") return onTurn?.(1);
      if (a === "hist") return openRef(false);
    });
    bar?.addEventListener("keydown", (e) => { if (e.target.id === "ivForkName" && e.key === "Enter") { e.preventDefault(); doFork(); } });
    bar?.addEventListener("input", (e) => { if (e.target.id === "ivForkName") V.forkName = e.target.value; });
    // 무대 크기가 바뀌면(화면 돌림 · 도구 막대) 맞춤이었으면 다시 맞추고, 확대 중이면 그대로
    let lastWH = "";
    const onResize = () => {
      if (V.dead) return;
      const wh = `${SW()}x${SH_()}`; if (wh === lastWH) return; lastWH = wh;
      if (!V.meta) return redraw();
      if (V.fitted) fit(); else apply();
    };
    window.addEventListener("resize", onResize);
    const ro = window.ResizeObserver ? new ResizeObserver(onResize) : null; ro?.observe(stage);
    // 다른 사람이 고친 공유 필기 따라오기 (악보 고치는 중 4초 · 볼 때 16초)
    let tick = 0;
    const poll = setInterval(async () => {
      if (V.dead || !V.sh || V.sh.static || document.hidden) return;
      tick++; if (!shared() && tick % 4) return;
      if (SH.busy || shPending().some((o) => o.sheet === V.sh.sheet)) return;
      const sheet = V.sh.sheet;
      if (await shLoad([sheet], true).catch(() => false) && V.sh?.sheet === sheet && !V.cur) refreshShared();
    }, 4000);
    renderBar();
    // 029: 다음 · 이전 쪽을 지금 화면 크기로 미리 그려 둠 (넘길 때 바로)
    async function warm(pg) {
      if (!pg || (!pg.path && !pg.img) || V.dead) return;
      try { const meta = await pageMeta(pg); const k = Math.min(SW(), SH_() / meta.A); if (k > 0) await paintCached(pg, meta, k * dpr()); } catch {}
    }
    const api = {
      show, clear, fit, setPen, warm, sync: renderBar, refreshShared, prefetch: (keys) => load(keys).catch(() => {}),
      flush: () => { endStroke(); save(); return flush(); },
      destroy() { endStroke(); save(); flush(); V.dead = true; clearInterval(poll); views.delete(api); window.removeEventListener("resize", onResize); ro?.disconnect(); },
      get state() { return { k: V.k, kFit: V.meta ? fitK(contentBox()) : 0, kPage: V.meta ? kPage() : 0, pen: V.pen, layer: V.layer, strokes: V.strokes.length, shared: V.shared.length,
        sheet: V.sh?.sheet || null, forkAsk: V.forkAsk, zoomed: V.meta ? zoomed() : false, key: V.ink?.key || null, page: V.ink?.page || null, oldVer: V.oldVer, hist: V.hist?.length || 0, shHist: V.shHist?.length || 0, target: V.sh?.sheet ?? null, ver: V.sh?.ver || null, canEdit: !!V.sh?.canEdit,
        pending: pendingCount(), ox: V.ox, oy: V.oy, last: V.strokes[V.strokes.length - 1] || null, lastShared: V.shared[V.shared.length - 1] || null }; },
    };
    views.add(api);
    return api;
  }
  const ICON_PEN = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
  const ICON_FIX = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;

  // 공유 필기를 악보 쪽 캔버스에 그려 넣기 (초안 PDF · 공유 링크)
  async function sharedFor(sheets, date) { await uid(); await shLoad(sheets, true); return (sheet, page) => shVisible(sheet, page, date); }
  // 029: 섬김이 링크 — 메모는 이 기기에만 (링크마다), 악보 도구는 링크 화면 것으로
  function setup({ lib, local } = {}) { if (lib) LIB = lib; if (local) { S.local = String(local); S.uid = "local"; } }
  window.INK = { view, flush, load, setup, PENS, HIS, _S: S, _SH: SH, _RC: RC, ICON_PEN, paintOnPage, paintTape, sharedFor, U };
  flush();
})();
