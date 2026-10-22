// =====================================================================
//  백업찬양 (023) — 기도찬양 후보 고르기 · 진행(인도자) · 따라가기(팀원) + 리더십 관리(악보집 · 예배 진행곡)
//  BACKUP.mount(root, { me })      : 팀원 앱 찬양 탭 › 백업찬양
//  BACKUP.openLive()                : 진행 화면 (인도자 = 조작판 · 팀원 = 따라가기)
//  BACKUP.mountAdmin(root)          : 관리자 찬양 › 곡 — 백업찬양 악보집 · 예배 진행곡
//  지금 진행 상태는 backup_live 한 줄 (기록은 남기지 않음). Realtime이 있으면 바로, 없으면 몇 초마다 확인
//  악보집 PDF 한 개를 기기에 저장해 두고 쪽 단위로 보여 줌. 직접 더한 곡은 그림
// =====================================================================
(function () {
  const L = () => CONTI.lib;
  const KEYS = ["b", "c", "d", "e", "f", "g", "a"];
  const DEF_TOPICS = { 1: "결단/선포", 2: "믿음/신뢰", 3: "위로/소망", 4: "임재/경배", 5: "간구/중보" };
  const LSK = "pole2.backup.cache";
  const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const B = { book: null, songs: [], live: null, proc: [], q: "", keys: new Set(), topics: new Set(), me: null, root: null, loaded: false,
    ch: null, timer: null, layer: null, follow: true, view: null, pg: 0, saved: null, adding: false, toastT: null, offline: false };

  // ------------------------------------------------------------------ 데이터
  async function loadData(force) {
    if (B.loaded && !force) return;
    const [bk, sg, lv, pr] = await Promise.all([
      sb.from("backup_books").select("*").eq("active", true).maybeSingle(),
      sb.from("backup_songs").select("id, book_id, code, title, key, topic, page, pages, images, norm").eq("hidden", false).order("code"),
      sb.rpc("backup_state_live"), sb.rpc("proc_on", { p_date: todayISO() }),
    ]);
    if (bk.error || sg.error || lv.error) {
      const c = ls.get(LSK);
      if (!c) throw new Error("백업찬양을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.");
      Object.assign(B, { book: c.book, songs: c.songs, proc: c.proc || [], live: c.live || null, offline: true, loaded: true });
      return;
    }
    B.book = bk.data || null;
    B.songs = (sg.data || []).filter((x) => x.book_id === null || x.book_id === B.book?.id);
    B.live = lv.data; B.proc = pr.data || []; B.loaded = true; B.offline = false;
    ls.set(LSK, { book: B.book, songs: B.songs, proc: B.proc, live: B.live, at: Date.now() });
  }
  const topics = () => ({ ...DEF_TOPICS, ...(B.book?.topics || {}) });
  const songOf = (id) => B.songs.find((s) => s.id === +id);
  const byCode = (c) => B.songs.find((s) => s.code === String(c || "").trim().toLowerCase());
  const altsOf = (s) => (s ? B.songs.filter((x) => x.id !== s.id && x.norm && x.norm === s.norm).sort((a, b) => KEYS.indexOf(a.key) - KEYS.indexOf(b.key)) : []);
  const procOf = (k) => B.proc.find((p) => p.kind === k);
  const canLead = () => !!B.live?.can_lead;
  const amLeader = () => B.live?.active && B.live.leader_id === B.me?.id;
  const cands = () => (B.live?.candidates || []).map(songOf).filter(Boolean);
  // ref: 'b:12' (백업찬양 곡) · 'p:benediction' (예배 진행곡)
  function refInfo(ref) {
    if (!ref) return null;
    const [t, v] = ref.split(":");
    if (t === "b") { const s = songOf(v); return s ? { ref, code: s.code, title: s.title, song: s } : { ref, code: "?", title: "목록에 없는 곡" }; }
    const p = procOf(v), name = L().PROC[v]?.[0] || v;
    return { ref, code: L().PROC[v]?.[1] || "", title: p ? `${name} · ${p.title}` : name, proc: p, kind: v };
  }
  function pagesOf(ref) {
    const r = refInfo(ref); if (!r) return [];
    if (r.song) {
      const s = r.song;
      // 024: 내 메모는 곡 코드 기준 (악보집이 새 판으로 바뀌면 '이전 판 메모')
      const ink = (k) => ({ key: `b:${s.code}`, page: k + 1, ver: s.book_id ? String(s.book_id) : `c${s.id}` });
      if (s.images?.length) return s.images.map((img, k) => ({ img, ink: ink(k) }));
      if (B.book && s.page) return Array.from({ length: s.pages || 1 }, (_, k) => ({ path: B.book.path, p: s.page + k, ink: ink(k) }));
      return [];
    }
    return r.proc ? L().procPages(r.proc) : [];
  }
  const codeHTML = (c, cls = "") => `<span class="bk-code ${cls}">${esc(c || "")}</span>`;

  // ------------------------------------------------------------------ 실시간 · 확인
  function watch(fast) {
    clearInterval(B.timer);
    B.timer = setInterval(() => { if (B.layer || (B.root && B.root.offsetParent)) refreshLive(); else clearInterval(B.timer); }, fast ? 3000 : 15000);
    if (!B.ch && sb.channel) {
      try { B.ch = sb.channel("backup-live").on("postgres_changes", { event: "*", schema: "public", table: "backup_live" }, () => refreshLive()).subscribe(); } catch { B.ch = null; }
    }
  }
  let busy = false;
  async function refreshLive() {
    if (busy) return; busy = true;
    try {
      const { data, error } = await sb.rpc("backup_state_live");
      if (error || !data) return;
      if (B.live && data.seq === B.live.seq) return;
      const prev = B.live; B.live = data;
      if (B.layer) onLiveChange(prev); else if (B.root?.offsetParent) drawHome();
    } finally { busy = false; }
  }
  async function update(patch) {
    const { data, error } = await sb.rpc("backup_update", { p: patch });
    if (error) { toast(error.message || "바꾸지 못했어요", 4000); return false; }
    const prev = B.live; B.live = data;
    if (B.layer) onLiveChange(prev, true); else drawHome();
    return true;
  }

  // =================================================================== 찬양 탭 › 백업찬양 (후보 고르기 · 둘러보기)
  async function mount(root, { me } = {}) {
    B.root = root; B.me = me || B.me;
    root.innerHTML = `<div class="empty">백업찬양을 불러오는 중…</div>`;
    try { await loadData(true); } catch (e) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    drawHome(); watch(false); checkSaved();
  }
  async function checkSaved() {
    if (!B.book) return;
    try { const c = await caches.open(L().CACHE); B.saved = !!(await c.match(L().ckey(B.book.path))); } catch { B.saved = false; }
    const el = B.root?.querySelector("#bkSaved"); if (el) el.innerHTML = savedHTML();
  }
  const savedHTML = () => (B.saved ? `<span class="ok">이 기기에 저장됨</span>` : `<button type="button" class="linkbtn" data-bk="save">이 기기에 받아 두기${B.book?.size_bytes ? ` (${L().mb(B.book.size_bytes)})` : ""}</button>`);

  function listHTML(lead) {
    const q = B.q.trim().toLowerCase().replace(/\s/g, ""), T = topics();
    const picked = (B.live?.candidates || []).map(Number);
    const hits = B.songs.filter((s) => (!B.keys.size || B.keys.has(s.key)) && (!B.topics.size || B.topics.has(String(s.topic ?? "x")))
      && (!q || s.code.startsWith(q) || (s.norm || "").includes(q) || s.title.toLowerCase().replace(/\s/g, "").includes(q)));
    const groups = new Map();
    hits.sort((a, b) => (a.topic ?? 99) - (b.topic ?? 99) || KEYS.indexOf(a.key) - KEYS.indexOf(b.key) || a.code.localeCompare(b.code)).forEach((s) => {
      const g = s.topic != null && T[s.topic] ? T[s.topic] : s.book_id ? "기타" : "직접 더한 곡";
      if (!groups.has(g)) groups.set(g, []); groups.get(g).push(s);
    });
    if (!hits.length) return `<div class="bk-list"><p class="muted small" style="margin:12px 0">${q ? `'${esc(B.q)}'에 맞는 곡이 없어요` : "곡이 없어요"}</p></div>`;
    return `<div class="bk-list">${[...groups].map(([g, list]) => `<span class="bk-grp">${esc(g)}</span>${list.slice(0, 200).map((s) => {
      const n = picked.indexOf(s.id) + 1, alts = altsOf(s);
      return `<div class="bk-item"><button type="button" class="bk-main" data-bk-song="${s.id}">${codeHTML(s.code)}<span><b>${esc(s.title)}</b><small>${[alts.length ? `다른 키 ${alts.map((a) => a.code).join(" · ")}` : "", s.images ? `그림 ${s.images.length}장` : ""].filter(Boolean).join(" · ")}</small></span>
          ${lead ? `<span class="bk-ck ${n ? "on" : ""}" aria-label="${n ? `${n}번 후보` : "후보 아님"}">${n || ""}</span>` : ""}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-bk-view="${s.id}">악보</button></div>`;
    }).join("")}`).join("")}</div>`;
  }
  function drawHome() {
    const root = B.root; if (!root) return;
    const focus = document.activeElement?.id === "bkQ", pos = focus ? document.activeElement.selectionStart : null;
    const lead = canLead(), live = B.live?.active, T = topics(), cs = cands();
    const slots = Math.max(lead ? 4 : 0, cs.length);
    root.innerHTML = `${B.offline ? `<div class="notice warn">인터넷 연결이 없어 저장해 둔 목록을 보여 줘요.</div>` : ""}
      ${live ? `<button type="button" class="bk-livecard" data-bk="join"><span class="bk-dot"></span><span><b>백업찬양 진행 중</b><small>${esc(B.live.leader || "인도자")} 인도${B.live.now ? ` · 지금 ${esc(refInfo(B.live.now)?.code || "")} ${esc(refInfo(B.live.now)?.title || "")}` : ""}</small></span><span class="btn btn-primary btn-sm">${amLeader() ? "진행 화면" : "참여"}</span></button>` : ""}
      <div class="bk-head"><h2>백업찬양 후보</h2><span class="small muted">${B.book ? `악보집 ${esc(B.book.label)} · ${B.songs.filter((s) => s.book_id).length}곡 · <span id="bkSaved">${savedHTML()}</span>` : "악보집이 아직 없어요"}</span></div>
      ${slots ? `<div class="bk-slots">${Array.from({ length: slots }, (_, i) => { const s = cs[i];
          return s ? `<button type="button" class="bk-slot" data-bk-view="${s.id}"><span class="h">${codeHTML(s.code)}<span class="n">${i + 1}</span></span><b>${esc(s.title)}</b></button>` : `<div class="bk-slot empty">${i + 1}</div>`; }).join("")}</div>`
        : `<p class="muted small" style="margin:0">아직 후보가 없어요. 이번 주 인도자가 고르면 여기에 보여요.</p>`}
      ${lead ? `<span class="small muted">누른 순서대로 1 · 2 · 3번 후보가 돼요. 다시 누르면 빠져요 · 고르는 즉시 팀원 화면에도 보여요</span>` : ""}
      ${B.songs.length ? `<input class="input bk-q" id="bkQ" value="${esc(B.q)}" placeholder="코드나 곡 이름 (예: g5, 성령)" autocomplete="off" aria-label="백업찬양 찾기">
        <div class="bk-kchips" role="group" aria-label="키">${KEYS.map((k) => `<button type="button" data-bk-key="${k}" aria-pressed="${B.keys.has(k)}">${k}</button>`).join("")}</div>
        <div class="bk-tchips" role="group" aria-label="주제"><button type="button" data-bk-topic="" aria-pressed="${!B.topics.size}">전체</button>${Object.entries(T).map(([k, v]) => `<button type="button" data-bk-topic="${k}" aria-pressed="${B.topics.has(k)}">${esc(v)}</button>`).join("")}${B.songs.some((s) => !s.book_id) ? `<button type="button" data-bk-topic="x" aria-pressed="${B.topics.has("x")}">직접 더한 곡</button>` : ""}</div>
        ${listHTML(lead)}` : `<div class="empty">${B.book ? "곡 목록이 비어 있어요." : "리더십이 관리자 화면 찬양 › 곡에서 악보집을 올리면 여기에 보여요."}</div>`}
      ${lead ? addHTML() : ""}
      ${lead ? `<div class="bk-foot"><span>후보는 팀원 화면에 바로 보여요 · 기록은 남기지 않아요</span>${live ? `<button type="button" class="btn btn-primary" data-bk="join">진행 화면</button>` : `<button type="button" class="btn btn-primary" data-bk="start" ${cs.length ? "" : "disabled"}>기도회 시작</button>`}</div>` : ""}`;
    if (focus) { const q = root.querySelector("#bkQ"); q?.focus(); try { q?.setSelectionRange(pos, pos); } catch {} }
    root.onclick = onHomeClick; root.oninput = onHomeInput; root.onchange = onHomeChange;
  }
  function addHTML() {
    if (!B.adding) return `<button type="button" class="btn btn-soft btn-sm" data-bk="add" style="align-self:flex-start">+ 이미지로 곡 더하기</button>`;
    return `<section class="card bk-add"><div class="card-title cv-ct">이미지로 곡 더하기 <small>악보집에 없는 곡</small></div>
      <label class="field">곡 이름<input class="input" id="bkAT" maxlength="80"></label>
      <div class="row" style="gap:10px;align-items:flex-end"><label class="field" style="flex:1">키<select class="select" id="bkAK"><option value="">모름</option>${KEYS.map((k) => `<option value="${k}">${k.toUpperCase()}</option>`).join("")}</select></label>
        <label class="field" style="flex:1">코드 <span class="hint">· 비우면 x1, x2 …</span><input class="input" id="bkAC" maxlength="6" placeholder="예: x1"></label></div>
      <label class="btn btn-ghost btn-sm cv-upl" style="align-self:flex-start">악보 사진 고르기<input type="file" accept="image/*" multiple id="bkAF" hidden></label>
      <span class="small muted" id="bkAP">고른 사진 없음</span>
      <div class="row"><button type="button" class="btn btn-primary btn-sm" data-bk="add-save">더하고 후보에 넣기</button><button type="button" class="btn btn-ghost btn-sm" data-bk="add-cancel">취소</button></div></section>`;
  }
  let candT = null;
  function onHomeInput(e) {
    if (e.target.id === "bkQ") { B.q = e.target.value; const box = B.root.querySelector(".bk-list"); if (box) box.outerHTML = listHTML(canLead()); }
  }
  function onHomeChange(e) { if (e.target.id === "bkAF") B.root.querySelector("#bkAP").textContent = e.target.files.length ? `사진 ${e.target.files.length}장` : "고른 사진 없음"; }
  async function onHomeClick(e) {
    const k = e.target.closest("[data-bk-key]"); if (k) { const v = k.dataset.bkKey; B.keys.has(v) ? B.keys.delete(v) : B.keys.add(v); return drawHome(); }
    const t = e.target.closest("[data-bk-topic]"); if (t) { const v = t.dataset.bkTopic; if (!v) B.topics.clear(); else B.topics.has(v) ? B.topics.delete(v) : B.topics.add(v); return drawHome(); }
    const v = e.target.closest("[data-bk-view]"); if (v) return preview(+v.dataset.bkView);
    const s = e.target.closest("[data-bk-song]");
    if (s) {
      if (!canLead()) return preview(+s.dataset.bkSong);
      const id = +s.dataset.bkSong, cur = (B.live?.candidates || []).map(Number);
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      if (next.length > 16) return toast("후보는 16곡까지예요");
      B.live = { ...B.live, candidates: next }; drawHome();
      clearTimeout(candT); candT = setTimeout(() => update({ candidates: B.live.candidates }), 250);
      return;
    }
    const b = e.target.closest("[data-bk]"); if (!b) return;
    const a = b.dataset.bk;
    if (a === "save") { b.disabled = true; b.textContent = "받는 중…"; try { await L().sheetBytes(B.book.path); B.saved = true; toast("악보집을 이 기기에 저장했어요"); } catch (err) { toast(err.message, 4000); } return checkSaved(); }
    if (a === "join") return openLive();
    if (a === "start") {
      clearTimeout(candT);
      const cs = (B.live?.candidates || []).map(Number);
      if (!cs.length) return toast("후보를 먼저 골라 주세요");
      b.disabled = true;
      if (await update({ candidates: cs, active: true, now: `b:${cs[0]}`, next: cs[1] ? `b:${cs[1]}` : null })) openLive();
      else b.disabled = false;
      return;
    }
    if (a === "add") { B.adding = true; drawHome(); return B.root.querySelector("#bkAT")?.focus(); }
    if (a === "add-cancel") { B.adding = false; return drawHome(); }
    if (a === "add-save") {
      const title = B.root.querySelector("#bkAT").value.trim(), files = [...(B.root.querySelector("#bkAF").files || [])];
      if (!title) return toast("곡 이름을 적어 주세요");
      if (!files.length) return toast("악보 사진을 골라 주세요");
      if (files.length > 12) return toast("사진은 12장까지예요");
      b.disabled = true;
      try {
        const images = await L().uploadImages(files, "backup/", (n, t2) => (b.textContent = `올리는 중 ${n}/${t2}…`));
        const { data, error } = await sb.rpc("backup_add_custom", { p_title: title, p_key: B.root.querySelector("#bkAK").value || null, p_code: B.root.querySelector("#bkAC").value || null, p_images: images });
        if (error) throw new Error(error.message || "더하지 못했어요");
        B.songs.push(data); B.adding = false;
        await update({ candidates: [...(B.live?.candidates || []).map(Number), data.id] });
        toast(`${data.code} ${data.title}을 더했어요`);
      } catch (err) { toast(err.message || "더하지 못했어요", 4000); b.disabled = false; b.textContent = "더하고 후보에 넣기"; }
    }
  }
  function preview(id) {
    const s = songOf(id); if (!s) return;
    const alts = altsOf(s);
    CONTI.openViewer(null, { title: `${s.code} ${s.title}`, items: [s, ...alts].map((x) => ({ id: `b:${x.id}`, tag: x.code, title: x.title, src: pagesOf(`b:${x.id}`) })) });
  }

  // =================================================================== 진행 화면 (인도자 조작판 · 팀원 따라가기)
  async function openLive() {
    if (!B.loaded) { try { await loadData(); } catch (e) { return toast(e.message, 4000); } }
    if (!B.live?.active) return toast("지금 진행 중인 백업찬양이 없어요");
    B.follow = true; B.view = B.live.now; B.pg = 0;
    const el = L().openLayer("bk-live", `<div class="bk-livebar" id="bkBar"></div><div class="bk-band" id="bkBand"></div><div class="bk-mini" id="bkMini"></div>
      <div class="iv-host hidden" id="bkInk"></div>
      <div class="bk-stage" id="bkStage"><canvas id="bkCanvas" aria-label="악보"></canvas><div class="cvv-blank hidden" id="bkBlank"></div>
        <button type="button" class="cvv-tap l" data-bkl="prev" aria-label="이전 쪽"><span>‹ 이전</span></button><button type="button" class="cvv-tap r" data-bkl="next" aria-label="다음 쪽"><span>다음 ›</span></button>
        <div class="cvv-load" id="bkLoad">불러오는 중…</div><div class="bk-toast hidden" id="bkToast"></div></div>
      <div class="bk-dock" id="bkDock"></div>`, () => { B.iv?.destroy(); B.iv = null; B.layer = null; document.removeEventListener("keydown", onKey); watch(false); if (B.root?.offsetParent) drawHome(); });
    B.layer = el;
    // 024: 내 메모 · 확대 — 따라가는 중에도 쓸 수 있고, 인도자가 넘기면 쓰던 메모를 먼저 저장하고 같이 넘어감
    B.iv = window.INK ? INK.view({ stage: $("#bkStage", el), canvas: $("#bkCanvas", el), root: el, bar: $("#bkInk", el), onTurn: (d) => turn(d) }) : null;
    el._iv = B.iv;
    B.iv?.prefetch([...cands().map((s) => `b:${s.code}`), ...B.proc.map((p) => `p:${p.id}`)]);
    el.addEventListener("click", onLiveClick);
    el.addEventListener("keydown", (e) => { if (e.target.id === "bkCode" && e.key === "Enter") reserveCode(); });
    document.addEventListener("keydown", onKey);
    if (!B.iv) window.addEventListener("resize", () => { if (B.layer) drawSheet(); });
    watch(true);
    renderLive(); drawSheet();
    // 후보 악보를 미리 받아 둠
    if (B.book) L().sheetDoc(B.book.path).catch(() => {});
    cands().forEach((s) => s.images?.forEach((p) => L().sheetImage(p).catch(() => {})));
  }
  const onKey = (e) => {
    if (!B.layer || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (["ArrowRight", "PageDown"].includes(e.key)) { e.preventDefault(); turn(1); }
    if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); turn(-1); }
  };
  function turn(d) { const n = pagesOf(B.view).length; const p = Math.max(0, Math.min(n - 1, B.pg + d)); if (p !== B.pg) { B.pg = p; drawSheet(); } }
  function onLiveChange(prev, mine) {
    if (!B.live.active) { const el = B.layer; if (el) { L().closeLayer(); toast("기도회가 끝났어요"); } return; }
    if (!mine && !amLeader() && B.live.next && B.live.next !== prev?.next) showToast(B.live.next);
    if (B.live.now !== prev?.now && (B.follow || amLeader())) { B.view = B.live.now; B.pg = 0; drawSheet(); }
    renderLive();
  }
  function showToast(ref) {
    const r = refInfo(ref), t = B.layer?.querySelector("#bkToast"); if (!r || !t) return;
    t.innerHTML = `<span>다음 곡 예약</span>${codeHTML(r.code, "inv")}${esc(r.title)}`; t.classList.remove("hidden");
    clearTimeout(B.toastT); B.toastT = setTimeout(() => t.classList.add("hidden"), 4000);
  }
  function renderLive() {
    const el = B.layer; if (!el) return;
    const lv = B.live, lead = amLeader(), now = refInfo(lv.now), nx = refInfo(lv.next), cs = cands();
    $("#bkBar", el).innerHTML = lead
      ? `<span><span class="bk-dot"></span>기도회 진행 중 · 내가 인도</span><span class="sp"></span>${B.iv ? `<button type="button" class="bk-pill bk-pen hidden" data-iv="hide"></button><button type="button" class="bk-pill bk-pen" data-iv="pen"></button>` : ""}<button type="button" class="bk-pill" data-bkl="end">끝내기</button><button type="button" class="bk-pill" data-bkl="close">나가기</button>`
      : `<span><span class="bk-dot"></span>${esc(lv.leader || "인도자")} 인도 · 백업찬양</span><span class="sp"></span><button type="button" class="bk-pill ${B.follow ? "on" : ""}" data-bkl="follow" aria-pressed="${B.follow}">${B.follow ? "● 따라가는 중" : "따라가기"}</button>${canLead() ? `<button type="button" class="bk-pill" data-bkl="take">내가 이어서 진행</button>` : ""}${B.iv ? `<button type="button" class="bk-pill bk-pen hidden" data-iv="hide"></button><button type="button" class="bk-pill bk-pen" data-iv="pen"></button>` : ""}<button type="button" class="bk-pill" data-bkl="close">나가기</button>`;
    B.iv?.sync();
    $("#bkBand", el).innerHTML = `<div class="now"><small>지금</small>${now ? `${codeHTML(now.code)}<b>${esc(now.title)}</b>` : `<b class="muted">아직 없음</b>`}</div>
      <div class="nx"><small>다음</small>${nx ? `${codeHTML(nx.code, "inv")}<b>${esc(nx.title)}</b>` : `<b>${lead ? "후보를 눌러 예약" : "아직 없음"}</b>`}</div>`;
    const procKinds = L().PROC_ORDER.filter((k) => k !== "entrance" && procOf(k));
    if (lead) {
      $("#bkMini", el).innerHTML = "";
      const alts = altsOf(now?.song);
      $("#bkDock", el).innerHTML = `<div class="bk-tiles">${cs.map((s) => { const ref = `b:${s.id}`, st = ref === lv.now ? "now" : ref === lv.next ? "next" : "";
          return `<button type="button" class="bk-tile ${st}" data-bk-tile="${ref}">${codeHTML(s.code, st === "now" ? "inv" : "")}<b>${esc(s.title)}</b><span class="st">${st === "now" ? "지금" : st === "next" ? "다음 · 다시 누르면 취소" : "누르면 다음으로"}</span></button>`; }).join("")}</div>
        <div class="bk-row bk-prow"><span class="lb">예배 진행곡</span>${procKinds.map((k) => `<button type="button" data-bk-tile="p:${k}" class="${lv.next === `p:${k}` ? "next" : lv.now === `p:${k}` ? "now" : ""}">${L().PROC[k][0]}</button>`).join("") || `<span class="small muted">없음</span>`}<button type="button" class="cn" data-bkl="conti">콘티 악보 ›</button></div>
        <div class="bk-row"><input class="bk-codein" id="bkCode" placeholder="코드" aria-label="코드로 다음 곡 예약" autocomplete="off" maxlength="6">
          ${alts.slice(0, 2).map((a) => `<button type="button" class="bk-alt" data-bk-tile="b:${a.id}">다른 키 ${esc(a.code)}</button>`).join("")}
          <button type="button" class="bk-go" data-bkl="go" ${nx ? "" : "disabled"}>다음 곡 시작 ▶${nx ? ` ${esc(nx.code)} ${esc(nx.title)}` : ""}</button></div>`;
    } else {
      $("#bkDock", el).innerHTML = "";
      const chips = [...cs.map((s) => ({ ref: `b:${s.id}`, code: s.code, title: s.title })), ...procKinds.map((k) => ({ ref: `p:${k}`, title: L().PROC[k][0], pg: true }))];
      $("#bkMini", el).innerHTML = chips.map((c) => `<button type="button" data-bk-see="${c.ref}" class="${c.ref === lv.now ? "on" : ""} ${c.ref === lv.next ? "nx" : ""} ${c.pg ? "pgc" : ""} ${c.ref === B.view && !B.follow ? "see" : ""}">${c.code ? `<em>${esc(c.code)}</em>` : ""}${esc(c.title)}</button>`).join("")
        + `<button type="button" class="pgc" data-bkl="conti">콘티 ›</button>`;
    }
  }
  async function drawSheet() {
    const el = B.layer; if (!el) return;
    const pages = pagesOf(B.view), pg = pages[B.pg], r = refInfo(B.view);
    const cv = $("#bkCanvas", el), blank = $("#bkBlank", el), load = $("#bkLoad", el);
    const t = (B.tok = (B.tok || 0) + 1);
    if (!pg) { B.iv?.clear(); cv.classList.add("hidden"); load.classList.add("hidden"); blank.classList.remove("hidden"); blank.innerHTML = r ? `<b>${esc(r.code)} ${esc(r.title)}</b><span>악보가 없어요</span>` : `<b>백업찬양</b><span>인도자가 곡을 시작하면 여기에 보여요</span>`; return; }
    blank.classList.add("hidden"); load.classList.remove("hidden"); load.textContent = "불러오는 중…";
    try {
      if (B.iv) { if (!(await B.iv.show(pg, () => t !== B.tok))) return; }
      else await L().drawPageInto(cv, $("#bkStage", el), pg, () => t !== B.tok);
      if (t !== B.tok) return;
      cv.classList.remove("hidden"); load.classList.add("hidden");
    } catch (err) { if (t === B.tok) load.textContent = err.message || "악보를 열지 못했어요"; }
  }
  async function reserveCode() {
    const inp = B.layer?.querySelector("#bkCode"); if (!inp) return;
    const s = byCode(inp.value);
    if (!s) return toast(`'${inp.value}' 코드를 찾을 수 없어요`);
    inp.value = ""; await update({ next: `b:${s.id}` });
  }
  async function contiNow() {
    const { data } = await sb.rpc("conti_week", { p_from: addDays(todayISO(), -1), p_to: addDays(todayISO(), 7) });
    const list = (data || []).filter((s) => s?.setlist?.status === "published");
    const svc = list.find((s) => !s.ministry_id && s.date >= todayISO()) || list[0];
    if (!svc) return toast("이번 주 올라온 콘티가 없어요");
    CONTI.openViewer(svc, {});
  }
  async function onLiveClick(e) {
    const tile = e.target.closest("[data-bk-tile]");
    if (tile) { const ref = tile.dataset.bkTile; if (ref === B.live.now) return; return update({ next: ref === B.live.next ? null : ref }); }
    const see = e.target.closest("[data-bk-see]");
    if (see) {
      const ref = see.dataset.bkSee;
      if (ref === B.view && !B.follow) { B.follow = true; B.view = B.live.now; } else { B.follow = ref === B.live.now; B.view = ref; }
      B.pg = 0; renderLive(); return drawSheet();
    }
    const b = e.target.closest("[data-bkl]"); if (!b) return;
    const a = b.dataset.bkl;
    if (a === "prev") return turn(-1);
    if (a === "next") return turn(1);
    if (a === "close") return L().closeLayer();
    if (a === "conti") return contiNow();
    if (a === "follow") { B.follow = !B.follow; if (B.follow) { B.view = B.live.now; B.pg = 0; drawSheet(); } return renderLive(); }
    if (a === "take") { if (!confirm("이 기도회를 내가 이어서 진행할까요?")) return; return update({ active: true }); }
    if (a === "go") { if (!B.live.next) return; b.disabled = true; return update({ now: B.live.next, next: null }); }
    if (a === "end") { if (!confirm("기도회를 끝낼까요? 팀원 화면도 함께 닫혀요. 후보는 남아요.")) return; return update({ active: false }); }
  }
  // 찬양 탭 위 띠 (콘티 칸에서도 진행 중이면 보여 줌)
  async function liveBanner() {
    try { const { data } = await sb.rpc("backup_state_live"); B.live = data || B.live; } catch {}
    if (!B.live?.active) return "";
    return `<button type="button" class="bk-livecard" data-bk-join><span class="bk-dot"></span><span><b>백업찬양 진행 중</b><small>${esc(B.live.leader || "인도자")} 인도 · 누르면 함께 넘겨 봐요</small></span><span class="btn btn-primary btn-sm">참여</span></button>`;
  }

  // =================================================================== 리더십: 찬양 › 곡 — 백업찬양 악보집 · 예배 진행곡
  async function mountAdmin(root) {
    root.innerHTML = `<div class="empty">불러오는 중…</div>`;
    const [bk, cnt, cust, pr] = await Promise.all([
      sb.from("backup_books").select("*").order("created_at", { ascending: false }).limit(5),
      sb.from("backup_songs").select("book_id", { count: "exact", head: false }).not("book_id", "is", null),
      sb.from("backup_songs").select("id, code, title, key, images, hidden, created_at").is("book_id", null).order("created_at", { ascending: false }),
      sb.from("worship_proc").select("*").order("start_date", { ascending: false }).order("id", { ascending: false }),
    ]);
    if (bk.error) { root.innerHTML = `<div class="empty">백업찬양을 불러오지 못했어요. migration_022를 실행했는지 확인해 주세요.</div>`; return; }
    const act = (bk.data || []).find((x) => x.active);
    const nIn = (cnt.data || []).filter((x) => x.book_id === act?.id).length;
    const today = todayISO(), procs = pr.data || [];
    const cur = (k) => procs.filter((x) => x.kind === k && x.start_date <= today)[0];
    const next = (k) => procs.filter((x) => x.kind === k && x.start_date > today).slice(-1)[0];
    const P = L().PROC;
    root.innerHTML = `<section class="panel" id="bkAdmin"><h2>백업찬양 악보집 <small>찬양 탭 › 백업찬양 · 기도회 때 함께 넘겨 봐요</small></h2>
        ${act ? `<div class="devrow"><span><b>${esc(act.label)}</b> <span class="small muted">· ${act.pages}쪽 · 곡 ${nIn}개 · ${act.size_bytes ? L().mb(act.size_bytes) + " · " : ""}${fmtDateTime(act.created_at)} 올림</span></span>
            <div class="row" style="gap:6px;flex:none"><button type="button" class="btn btn-ghost btn-sm" data-bka="songs">곡 목록 고치기</button><button type="button" class="btn btn-ghost btn-sm" data-bka="view">보기</button></div></div>`
          : `<p class="small muted" style="margin:0">아직 올린 악보집이 없어요. 악보집 PDF를 올리면 쪽마다 첫 줄의 코드(예: g40)와 곡 이름을 읽어서 목록을 만들어요.</p>`}
        <label class="btn btn-soft btn-sm cv-upl" style="align-self:flex-start">${act ? "새 버전 올리기 (PDF)" : "악보집 PDF 올리기"}<input type="file" accept="application/pdf" id="bkBookFile" hidden></label>
        ${(cust.data || []).length ? `<details><summary class="small" style="cursor:pointer;font-weight:700;color:var(--violet)">이미지로 더한 곡 ${(cust.data || []).filter((x) => !x.hidden).length}곡</summary>
          <div class="bk-alist">${(cust.data || []).map((x) => `<div class="devrow"><span>${codeHTML(x.code)} <b>${esc(x.title)}</b> <span class="small muted">${x.images?.length || 0}장${x.hidden ? " · 숨김" : ""}</span></span>
            <button type="button" class="btn btn-ghost btn-sm" data-bka="hide" data-id="${x.id}" data-h="${x.hidden ? 0 : 1}">${x.hidden ? "다시 보이기" : "숨기기"}</button></div>`).join("")}</div></details>` : ""}
      </section>
      <section class="panel" id="procAdmin"><h2>예배 진행곡 <small>종류마다 1곡(성찬 찬양은 2곡) · 바꿀 때만 고쳐요 · RT에 넣지 않아요</small></h2>
        <div class="bk-alist">${L().PROC_ORDER.map((k) => { const c = cur(k), n = next(k);
          return `<div class="devrow"><span style="display:flex;flex-direction:column;gap:2px"><span><span class="cv-ptag">${P[k][0]}</span> ${c ? `<b>${esc(c.title)}</b>${c.key ? ` <span class="small muted">${esc(c.key)}</span>` : ""}` : `<span class="muted">아직 없어요</span>`}${k === "entrance" ? ` <span class="small muted">· 특별예배 · 수련회 때만</span>` : k.startsWith("communion") ? ` <span class="small muted">· 성찬식 주일에만</span>` : ""}</span>
            <span class="small muted">${c ? `${md(c.start_date)}부터 · ${c.images?.length ? `그림 ${c.images.length}장` : c.pages ? `PDF ${c.pages}쪽` : "악보 없음"}` : ""}${n ? ` · ${md(n.start_date)}부터 '${esc(n.title)}'로 바뀜` : ""}</span></span>
            <div class="row" style="gap:6px;flex:none">${c && (c.path || c.images?.length) ? `<button type="button" class="btn btn-ghost btn-sm" data-bka="proc-view" data-id="${c.id}">보기</button>` : ""}<button type="button" class="btn btn-ghost btn-sm" data-bka="proc" data-k="${k}">바꾸기</button></div></div>`; }).join("")}</div>
        ${procs.some((x) => x !== cur(x.kind) && x !== next(x.kind)) ? `<details><summary class="small" style="cursor:pointer;font-weight:700;color:var(--violet)">지난 곡 기록</summary><div class="bk-alist">${procs.filter((x) => x !== cur(x.kind) && x !== next(x.kind)).map((x) => `<div class="devrow"><span><span class="cv-ptag">${P[x.kind][0]}</span> ${esc(x.title)} <span class="small muted">${md(x.start_date)}부터</span></span></div>`).join("")}</div></details>` : ""}
      </section>`;
    root.onclick = async (e) => {
      const b = e.target.closest("[data-bka]"); if (!b) return;
      const a = b.dataset.bka;
      if (a === "view" && act) return CONTI.openViewer(null, { single: { title: `백업찬양 악보집 ${act.label}`, path: act.path, pages: act.pages } });
      if (a === "songs" && act) return openSongEditor(act, () => mountAdmin(root));
      if (a === "hide") { const { error } = await sb.from("backup_songs").update({ hidden: b.dataset.h === "1" }).eq("id", +b.dataset.id); toast(error ? "바꾸지 못했어요" : "바꿨어요"); return mountAdmin(root); }
      if (a === "proc") return openProcEdit(b.dataset.k, cur(b.dataset.k), () => mountAdmin(root));
      if (a === "proc-view") { const x = procs.find((y) => y.id === +b.dataset.id); return CONTI.openViewer(null, { title: `${P[x.kind][0]} · ${x.title}`, items: [{ title: x.title, key: x.key, src: L().procPages(x) }] }); }
    };
    root.onchange = (e) => { if (e.target.id === "bkBookFile" && e.target.files?.[0]) openBookImport(e.target.files[0], act, () => mountAdmin(root)); };
  }

  // 악보집 읽기: 쪽마다 첫 줄 글자에서 코드(키 · 주제 · 번호, 예: g40)와 곡 이름
  const CODE_RE = /^\s*([a-gA-G])\s?([0-9])\s?([0-9])(?![0-9])\s*[.\-·:)\]]*\s*(.*)$/;
  async function readBook(doc, onStep) {
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      onStep?.(p, doc.numPages);
      let lines = [];
      try {
        const tc = await (await doc.getPage(p)).getTextContent();
        const rows = new Map();
        tc.items.forEach((it) => { if (!it.str) return; const y = Math.round(it.transform[5] / 3) * 3; if (!rows.has(y)) rows.set(y, []); rows.get(y).push(it); });
        // 글자 사이가 벌어진 곳만 띄어 씀 (글자마다 따로 나오는 PDF도 있어요)
        const join = (xs) => xs.sort((a, b) => a.transform[4] - b.transform[4]).reduce((acc, x) => {
          const fs = Math.abs(x.transform[0]) || x.height || 10;
          const gap = acc.end == null ? 0 : x.transform[4] - acc.end;
          acc.t += (acc.end != null && gap > fs * 0.25 ? " " : "") + x.str; acc.end = x.transform[4] + (x.width || 0); return acc;
        }, { t: "", end: null }).t;
        lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, xs]) => join(xs).replace(/\s+/g, " ").trim()).filter(Boolean);
      } catch {}
      let code = "", title = "";
      // 첫 줄(머리말이 있으면 둘째 줄까지)에서 코드로 시작하는 줄 · 목차처럼 코드가 여러 개인 줄은 곡이 아님
      for (let i = 0; i < Math.min(2, lines.length); i++) {
        const m = lines[i].match(CODE_RE);
        if (m && !/(^|[^a-z0-9])[a-g]\s?[0-9]\s?[0-9](?![0-9])/i.test(m[4] || "")) { code = `${m[1]}${m[2]}${m[3]}`.toLowerCase(); title = (m[4] || "").trim() || (lines[i + 1] || "").trim(); break; }
      }
      out.push({ page: p, code, title: title.slice(0, 80), first: (lines[0] || "").slice(0, 60) });
    }
    return out;
  }
  async function openBookImport(file, act, after) {
    if (file.type && file.type !== "application/pdf") return toast("PDF 파일을 골라 주세요");
    const el = L().openLayer("cv-sheetpage", `<div class="cvs-top"><button type="button" class="cvv-back light" data-bi="close" aria-label="닫기">${L().ICO.back}</button><b>백업찬양 악보집 올리기</b></div><div class="cvs-body" id="biBody"><div class="empty" id="biStep">PDF를 읽는 중…</div></div>`);
    const body = $("#biBody", el);
    let bytes, doc, rows;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
      doc = await (await L().pdfjs()).getDocument({ data: bytes.slice() }).promise;
      rows = await readBook(doc, (p, n) => { const s = $("#biStep", el); if (s) s.textContent = `쪽마다 코드 · 곡 이름 읽는 중 ${p}/${n}`; });
    } catch (err) { body.innerHTML = `<div class="empty">${esc(err.message || "PDF를 읽지 못했어요")}</div>`; return; }
    const prevTopics = { ...DEF_TOPICS, ...(act?.topics || {}) };
    const label = (file.name.match(/ver\.?\s?\d+/i)?.[0] || file.name.replace(/\.pdf$/i, "")).slice(0, 40);
    const found = rows.filter((r) => r.code).length;
    const draw = () => {
      const codes = rows.filter((r) => r.code).map((r) => r.code), dup = new Set(codes.filter((c, i) => codes.indexOf(c) !== i));
      body.innerHTML = `<p class="small muted" style="margin:0">${doc.numPages}쪽 중 <b>${rows.filter((r) => r.code).length}쪽</b>을 곡으로 읽었어요${found ? "" : " (글자가 없는 스캔 PDF면 코드를 직접 적어 주세요)"}. 코드가 빈 쪽은 곡이 아닌 쪽(표지 · 목차)으로 빼요. 틀린 칸만 고쳐 주세요.</p>
        <div class="row" style="gap:10px;align-items:flex-end;flex-wrap:wrap"><label class="field" style="flex:1 1 160px">버전 이름<input class="input" id="biLabel" value="${esc(label)}" maxlength="40"></label>
          <span class="small muted">${L().mb(bytes.length)}${bytes.length > 25 * 1048576 ? " · 25MB가 넘어서 올릴 때 줄여요" : ""}</span></div>
        <div class="field"><span>주제 이름 <span class="hint">· 코드 둘째 자리 숫자</span></span><div class="bi-topics">${Object.entries(prevTopics).map(([k, v]) => `<label><b>${k}</b><input class="input" data-topic="${k}" value="${esc(v)}" maxlength="20"></label>`).join("")}</div></div>
        <div class="bi-table" role="table">${rows.map((r, i) => `<div class="bi-row ${r.code ? "" : "skip"} ${dup.has(r.code) ? "dup" : ""}" role="row" data-i="${i}"><span class="bi-p">${r.page}쪽</span>
            <input class="input" data-bi="code" value="${esc(r.code)}" maxlength="6" placeholder="코드" aria-label="${r.page}쪽 코드"><input class="input" data-bi="title" value="${esc(r.title)}" maxlength="80" placeholder="${esc(r.first || "곡 아님")}" aria-label="${r.page}쪽 곡 이름">
            <button type="button" class="btn btn-ghost btn-sm" data-bi="see">보기</button></div>`).join("")}</div>
        <div class="bk-foot static"><span id="biSum">${rows.filter((r) => r.code).length}곡${dup.size ? ` · 같은 코드가 두 번: ${[...dup].join(", ")}` : ""}</span><button type="button" class="btn btn-primary" data-bi="save">이 악보집으로 바꾸기</button></div>`;
    };
    draw();
    el.addEventListener("input", (e) => {
      const row = e.target.closest(".bi-row"); if (!row) return;
      const r = rows[+row.dataset.i];
      if (e.target.dataset.bi === "code") { r.code = e.target.value.trim().toLowerCase(); row.classList.toggle("skip", !r.code); }
      if (e.target.dataset.bi === "title") r.title = e.target.value;
      const codes = rows.filter((x) => x.code).map((x) => x.code), dup = new Set(codes.filter((c, i) => codes.indexOf(c) !== i));
      $("#biSum", el).textContent = `${codes.length}곡${dup.size ? ` · 같은 코드가 두 번: ${[...dup].join(", ")}` : ""}`;
    });
    el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-bi]"); if (!b || b.tagName === "INPUT") return;
      const a = b.dataset.bi;
      if (a === "close") return L().closeLayer();
      if (a === "see") { const r = rows[+b.closest(".bi-row").dataset.i]; return previewPage(doc, r.page); }
      if (a === "save") {
        const list = rows.filter((r) => r.code);
        if (!list.length) return toast("곡이 하나도 없어요. 코드를 적어 주세요");
        const bad = list.find((r) => !/^[a-z0-9+]{1,6}$/.test(r.code) || !r.title.trim());
        if (bad) return toast(`${bad.page}쪽: 코드(영문 소문자 · 숫자)와 곡 이름을 확인해 주세요`, 4000);
        const codes = list.map((r) => r.code); if (new Set(codes).size !== codes.length) return toast("같은 코드가 두 번 있어요");
        const lbl = $("#biLabel", el).value.trim(); if (!lbl) return toast("버전 이름을 적어 주세요");
        const T = {}; el.querySelectorAll("[data-topic]").forEach((x) => { if (x.value.trim()) T[x.dataset.topic] = x.value.trim(); });
        b.disabled = true;
        try {
          let up = bytes;
          if (bytes.length > 25 * 1048576) { b.textContent = "PDF 줄이는 중…"; const small = await L().compressPdf(doc, bytes.length); if (small) up = small; }
          if (up.length > 30 * 1048576) throw new Error("30MB가 넘어서 올릴 수 없어요. 쪽 수를 줄이거나 해상도를 낮춰 주세요.");
          b.textContent = "올리는 중…";
          const path = `book/${L().uuid()}.pdf`;
          const { error } = await sb.storage.from("sheets").upload(path, up, { contentType: "application/pdf", upsert: false });
          if (error) throw new Error("악보집을 올리지 못했어요. 인터넷 연결을 확인해 주세요.");
          try { const c = await caches.open(L().CACHE); await c.put(L().ckey(path), new Response(up, { headers: { "Content-Type": "application/pdf" } })); } catch {}
          const songs = list.map((r) => { const m = r.code.match(/^([a-g])([0-9])/); return { code: r.code, title: r.title.trim(), key: m?.[1] || null, topic: m ? +m[2] : null, page: r.page }; });
          const { data, error: e2 } = await sb.rpc("backup_book_save", { p_label: lbl, p_path: path, p_pages: doc.numPages, p_size: up.length, p_topics: T, p_songs: songs });
          if (e2) throw new Error(e2.message || "저장하지 못했어요");
          toast(`악보집 ${lbl}로 바꿨어요 · ${data.songs}곡`, 4000); B.loaded = false; L().closeLayer(); after?.();
        } catch (err) { toast(err.message || "저장하지 못했어요", 5000); b.disabled = false; b.textContent = "이 악보집으로 바꾸기"; }
      }
    });
  }
  // 올리기 전 PDF 한 쪽 보기 (작은 창)
  async function previewPage(doc, p) {
    const w = document.createElement("div"); w.className = "bi-pv"; w.innerHTML = `<div class="bi-pv-in"><b>${p}쪽</b><button type="button" class="btn btn-ghost btn-sm">닫기</button><canvas></canvas></div>`;
    document.body.appendChild(w);
    w.addEventListener("click", (e) => { if (e.target === w || e.target.closest("button")) w.remove(); });
    try { const c = await L().renderPage(doc, p, Math.min(900, window.innerWidth - 40)); const cv = w.querySelector("canvas"); cv.width = c.width; cv.height = c.height; cv.getContext("2d").drawImage(c, 0, 0); } catch {}
  }
  async function openSongEditor(act, after) {
    const { data } = await sb.from("backup_songs").select("id, code, title, page, hidden").eq("book_id", act.id).order("page");
    const el = L().openLayer("cv-sheetpage", `<div class="cvs-top"><button type="button" class="cvv-back light" data-se="close" aria-label="닫기">${L().ICO.back}</button><b>${esc(act.label)} 곡 목록</b></div>
      <div class="cvs-body"><p class="small muted" style="margin:0">곡 이름을 고치면 바로 저장돼요. 숨긴 곡은 찾기 · 후보에서 빠져요.</p>
        <div class="bi-table">${(data || []).map((x) => `<div class="bi-row ${x.hidden ? "skip" : ""}" data-id="${x.id}"><span class="bi-p">${x.page}쪽</span>${codeHTML(x.code)}<input class="input" data-se="title" value="${esc(x.title)}" maxlength="80" aria-label="${esc(x.code)} 곡 이름">
          <button type="button" class="btn btn-ghost btn-sm" data-se="hide" data-h="${x.hidden ? 0 : 1}">${x.hidden ? "보이기" : "숨기기"}</button></div>`).join("")}</div></div>`, () => after?.());
    el.addEventListener("change", async (e) => {
      if (e.target.dataset.se !== "title") return;
      const id = +e.target.closest("[data-id]").dataset.id, v = e.target.value.trim(); if (!v) return toast("곡 이름을 적어 주세요");
      const { error } = await sb.from("backup_songs").update({ title: v }).eq("id", id); toast(error ? "저장하지 못했어요" : "저장했어요");
    });
    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-se=close]")) return L().closeLayer();
      const h = e.target.closest("[data-se=hide]"); if (!h) return;
      const row = h.closest("[data-id]"), hide = h.dataset.h === "1";
      const { error } = await sb.from("backup_songs").update({ hidden: hide }).eq("id", +row.dataset.id);
      if (error) return toast("바꾸지 못했어요");
      row.classList.toggle("skip", hide); h.dataset.h = hide ? "0" : "1"; h.textContent = hide ? "보이기" : "숨기기";
    });
  }
  // 예배 진행곡 바꾸기: 곡 이름 · 키 · 악보(PDF 또는 그림) · 적용 시작일 · 알림
  function openProcEdit(kind, cur, after) {
    const P = L().PROC;
    const el = L().openLayer("cv-sheetpage", `<div class="cvs-top"><button type="button" class="cvv-back light" data-pe="close" aria-label="닫기">${L().ICO.back}</button><b>${P[kind][0]} 바꾸기</b></div>
      <div class="cvs-body"><section class="card" style="display:flex;flex-direction:column;gap:12px">
        ${cur ? `<span class="small muted">지금: <b>${esc(cur.title)}</b>${cur.key ? ` · ${esc(cur.key)}` : ""} · ${md(cur.start_date)}부터 · 바꿔도 지난 곡은 기록으로 남아요</span>` : ""}
        <label class="field">곡 이름<input class="input" id="peT" maxlength="80" value="${esc(cur?.title || "")}"></label>
        <div class="row" style="gap:10px;align-items:flex-end"><label class="field" style="flex:0 0 110px">키<input class="input" id="peK" maxlength="12" value="${esc(cur?.key || "")}"></label>
          <label class="field" style="flex:1">적용 시작일<input type="date" class="input" id="peD" value="${todayISO()}"></label></div>
        <label class="btn btn-soft btn-sm cv-upl" style="align-self:flex-start">악보 고르기 (PDF 1개 또는 사진 여러 장)<input type="file" accept="application/pdf,image/*" multiple id="peF" hidden></label>
        <span class="small muted" id="peP">${cur ? "고르지 않으면 지금 악보를 그대로 써요" : "고른 파일 없음"}</span>
        <label class="checkrow"><input type="checkbox" id="peN"><span><b>팀원에게 알리기</b><small>'예배 진행곡이 바뀌었어요' 알림 (팀원 전체)</small></span></label>
        <button type="button" class="btn btn-primary" data-pe="save">저장</button></section></div>`, () => after?.());
    el.addEventListener("change", (e) => { if (e.target.id === "peF") $("#peP", el).textContent = [...e.target.files].map((f) => f.name).join(", ") || "고른 파일 없음"; });
    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-pe=close]")) return L().closeLayer();
      const b = e.target.closest("[data-pe=save]"); if (!b) return;
      const title = $("#peT", el).value.trim(), files = [...($("#peF", el).files || [])];
      if (!title) return toast("곡 이름을 적어 주세요");
      const pdfs = files.filter((f) => f.type === "application/pdf"), pics = files.filter((f) => /^image\//.test(f.type));
      if (pdfs.length > 1 || (pdfs.length && pics.length)) return toast("PDF 1개 또는 사진 여러 장을 골라 주세요");
      b.disabled = true;
      try {
        const row = { kind, title, key: $("#peK", el).value.trim() || null, start_date: $("#peD", el).value || todayISO() };
        if (pdfs.length) {
          b.textContent = "올리는 중…";
          let bytes = new Uint8Array(await pdfs[0].arrayBuffer());
          const doc = await (await L().pdfjs()).getDocument({ data: bytes.slice() }).promise;
          if (bytes.length > 5 * 1048576) { const small = await L().compressPdf(doc, bytes.length); if (small) bytes = small; }
          const path = `proc/${L().uuid()}.pdf`;
          const { error } = await sb.storage.from("sheets").upload(path, bytes, { contentType: "application/pdf", upsert: false });
          if (error) throw new Error("악보를 올리지 못했어요");
          Object.assign(row, { path, pages: doc.numPages });
        } else if (pics.length) {
          Object.assign(row, { images: await L().uploadImages(pics, "proc/", (n, t) => (b.textContent = `올리는 중 ${n}/${t}…`)) });
        } else if (cur) Object.assign(row, { path: cur.path, pages: cur.pages, images: cur.images });
        const { data, error } = await sb.from("worship_proc").insert(row).select("id").single();
        if (error) throw new Error(error.message || "저장하지 못했어요");
        let msg = `${P[kind][0]}을 바꿨어요`;
        if ($("#peN", el).checked) { try { const r = await L().meApi("/api/notify", { kind: "proc", ids: [data.id] }); msg += ` · ${r.recipients}명에게 알렸어요`; } catch (err) { msg += ` · 알리지 못했어요 (${err.message})`; } }
        toast(msg, 3500); L().closeLayer();
      } catch (err) { toast(err.message || "저장하지 못했어요", 4000); b.disabled = false; b.textContent = "저장"; }
    });
  }

  window.BACKUP = { mount, openLive, liveBanner, mountAdmin, refresh: refreshLive, _test: { readBook, CODE_RE, B } };
})();
