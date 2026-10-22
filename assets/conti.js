// =====================================================================
//  콘티 (022) — 이번 주 콘티 · 콘티 작성(RT · 곡 · 악보) · 악보 보기 · 곡 상세 · 리더십 콘티 현황
//  팀원 화면(찬양 탭)과 관리자 화면(찬양 › 콘티)이 함께 써요.
//  CONTI.mountWeek(root, { me, focus })  ·  CONTI.openEditor(serviceId)  ·  CONTI.openViewer(svc)
//  CONTI.songDetail(songId)  ·  CONTI.mountAdmin(root)
//  악보 파일: Storage 'sheets' 버킷 (sheets/곡/uuid.pdf · originals/곡/uuid.pdf) — 한 번 연 파일은 이 기기에 저장
// =====================================================================
(function () {
  // ------------------------------------------------------------------ 라이브러리 (필요할 때만)
  const LIB = {
    pdfjs: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    worker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
    pdflib: "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js",
  };
  const loading = {};
  const script = (src) => loading[src] || (loading[src] = new Promise((ok, no) => {
    const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => { delete loading[src]; no(new Error("악보 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.")); };
    document.head.appendChild(s);
  }));
  async function pdfjs() {
    if (!window.pdfjsLib) await script(LIB.pdfjs);
    if (!window.pdfjsLib) throw new Error("악보 도구를 불러오지 못했어요.");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = LIB.worker;
    return window.pdfjsLib;
  }
  async function pdflib() { if (!window.PDFLib) await script(LIB.pdflib); if (!window.PDFLib) throw new Error("악보 도구를 불러오지 못했어요."); return window.PDFLib; }

  // ------------------------------------------------------------------ 공용
  const KEYS = ["C", "C#", "Db", "D", "Eb", "E", "F", "F#", "Gb", "G", "Ab", "A", "Bb", "B"];
  const POS = { leader: "인도", singer: "싱어", key_main: "메인", key_second: "세컨", e_guitar: "일렉", acoustic: "어쿠", bass: "베이스", drum: "드럼" };
  const LIMIT = 5 * 1024 * 1024;   // 5MB 이하는 압축 없이
  const mmss = (s) => (s == null || isNaN(s) ? "–:––" : `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`);
  const parseMmss = (v) => { const m = String(v || "").trim().match(/^(\d{1,2})(?::(\d{1,2}))?$/); if (!m) return null; const s = +m[1] * (m[2] !== undefined ? 60 : 60) + (m[2] !== undefined ? +m[2] : 0); return s > 0 && s <= 3600 ? s : null; };
  const mb = (n) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)}MB`);
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }));
  const KDOW = ["주일", "월", "화", "수", "목", "금", "토"];
  const kst = (iso) => { const k = new Date(new Date(iso).getTime() + 9 * 3600e3); return { date: k.toISOString().slice(0, 10), hm: k.toISOString().slice(11, 16) }; };
  const dlText = (iso) => { if (!iso) return ""; const k = kst(iso); return `${md(k.date)}(${KDOW[dowOf(k.date)]}) ${k.hm}`; };
  const dlLeft = (iso) => {
    const ms = new Date(iso) - Date.now();
    if (ms < 0) return { cls: "bad", text: "마감 지남" };
    const k = kst(iso), today = todayISO();
    if (k.date === today) return { cls: "warn", text: "오늘 마감" };
    if (k.date === addDays(today, 1)) return { cls: "warn", text: "내일 마감" };
    return { cls: "mid", text: `D-${Math.round((new Date(k.date) - new Date(today)) / 864e5)}` };
  };
  const svcTitle = (s, all) => {
    if (!s.ministry_id) return `${fmtDate(s.date, { month: "long", day: "numeric" })} 주일`;
    const multi = (all || []).filter((x) => x.ministry_id === s.ministry_id).length > 1;
    return `${s.ministry_name || "사역"}${multi && s.label ? " · " + s.label : ""}`;
  };
  const svcShort = (s, all) => (s.ministry_id ? `${svcTitle(s, all)} · ${mdw(s.date)}` : `${md(s.date)} 주일`);
  const ytOf = (v) => { const m = String(v || "").match(/(?:youtu\.be\/|v=|\/shorts\/|\/live\/|\/embed\/)([A-Za-z0-9_-]{11})/) || String(v || "").match(/^([A-Za-z0-9_-]{11})$/); return m ? m[1] : null; };
  const ytLink = (id, t) => `https://youtu.be/${id}${t ? `?t=${t}` : ""}`;
  const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }, del(k) { try { localStorage.removeItem(k); } catch {} } };
  const isAdminPage = () => /admin\.html/.test(location.pathname);
  async function meApi(path, payload) {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "보내지 못했어요");
    return j;
  }
  const ICO = {
    back: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`,
    grip: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h14"/></svg>`,
    x: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
    play: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`,
  };

  // ------------------------------------------------------------------ 악보 파일 (기기에 저장)
  const CACHE = "pole2-sheets-v1";
  const ckey = (path) => new Request(`${location.origin}/__sheets/${path}`);
  const docs = new Map();
  async function sheetBytes(path) {
    try { const c = await caches.open(CACHE); const hit = await c.match(ckey(path)); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch {}
    const { data, error } = await sb.storage.from("sheets").download(path);
    if (error || !data) throw new Error("악보 파일을 받지 못했어요. 인터넷 연결을 확인해 주세요.");
    const buf = new Uint8Array(await data.arrayBuffer());
    try { const c = await caches.open(CACHE); await c.put(ckey(path), new Response(buf, { headers: { "Content-Type": "application/pdf" } })); } catch {}
    return buf;
  }
  async function sheetDoc(path) {
    if (!docs.has(path)) docs.set(path, (async () => (await pdfjs()).getDocument({ data: (await sheetBytes(path)).slice() }).promise)().catch((e) => { docs.delete(path); throw e; }));
    return docs.get(path);
  }
  async function renderPage(doc, n, width, canvas) {
    const page = await doc.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    const scale = width / v1.width;
    const vp = page.getViewport({ scale });
    canvas = canvas || document.createElement("canvas");
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    const g = canvas.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    return canvas;
  }
  const thumbOf = async (doc, n = 1, w = 120) => (await renderPage(doc, n, w)).toDataURL("image/jpeg", 0.62);
  // 두 쪽 그림이 비슷한지 (확인 장치) — 작게 줄여 흑백으로 비교
  async function looksSame(urlA, urlB) {
    const load = (u) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = u; });
    const [a, b] = await Promise.all([load(urlA), load(urlB)]);
    if (!a || !b) return false;
    const W = 36, H = 48, px = (im) => { const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d"); g.drawImage(im, 0, 0, W, H); const d = g.getImageData(0, 0, W, H).data; const o = []; for (let i = 0; i < d.length; i += 4) o.push((d[i] + d[i + 1] + d[i + 2]) / 3); return o; };
    const A = px(a), B = px(b);
    let s = 0; for (let i = 0; i < A.length; i++) s += Math.abs(A[i] - B[i]);
    return s / A.length < 14;
  }

  // ------------------------------------------------------------------ 겹쳐 띄우는 화면 (뒤로가기로 닫힘)
  let layer = null;
  function openLayer(cls, html, onClose) {
    const reuse = !!layer?.pushed;   // 이미 쌓아 둔 기록이 있으면 그대로 씀 (화면만 바꿈)
    if (layer) { layer.pushed = false; closeLayer(true); }
    const el = document.createElement("div");
    el.className = `cv-layer ${cls}`; el.innerHTML = html;
    document.body.appendChild(el); document.body.classList.add("cv-open");
    if (!reuse) history.pushState({ ...(history.state || {}), cv: (history.state?.cv || 0) + 1 }, "");
    layer = { el, onClose, pushed: true };
    return el;
  }
  function closeLayer(silent) {
    if (!layer) return;
    const l = layer; layer = null;
    l.el.remove(); document.body.classList.remove("cv-open");
    try { l.onClose?.(); } catch {}
    if (l.pushed && !silent) { l.pushed = false; skipPop = true; history.back(); }
  }
  let skipPop = false;
  window.addEventListener("popstate", (e) => {
    if (skipPop) { skipPop = false; e.stopImmediatePropagation(); return; }
    if (layer) { layer.pushed = false; closeLayer(true); e.stopImmediatePropagation(); }
  });

  // ------------------------------------------------------------------ 데이터
  let canUploadCache = null;
  const canUpload = async () => (canUploadCache ??= (await sb.rpc("can_upload_sheet")).data === true);
  async function loadWeek(from, to) {
    const { data, error } = await sb.rpc("conti_week", { p_from: from, p_to: to });
    if (error) { const c = ls.get("pole2.conti.cache"); if (c) return { list: c.list, offline: true, at: c.at }; throw new Error("콘티를 불러오지 못했어요"); }
    ls.set("pole2.conti.cache", { list: data || [], at: new Date().toISOString() });
    return { list: data || [] };
  }
  async function loadOne(sid) {
    const { data, error } = await sb.rpc("conti_one", { p_service: sid });
    if (error || !data) throw new Error("예배를 찾을 수 없어요. 배치표가 아직 공개되지 않았을 수 있어요.");
    return data;
  }
  const rtOf = (items) => items.reduce((a, x) => a + (x.duration_sec || 0), 0);
  const unknownN = (items) => items.filter((x) => !x.duration_sec).length;

  // =================================================================== 팀원: 이번 주 콘티
  const W = { focus: null };
  async function mountWeek(root, opts = {}) {
    const me = opts.me;
    if (opts.focus) W.focus = opts.focus;
    root.innerHTML = `<div class="empty">콘티를 불러오는 중…</div>`;
    let R;
    try { R = await loadWeek(todayISO(), addDays(todayISO(), 42)); } catch (e) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const list = R.list.filter(Boolean);
    if (!list.length) { root.innerHTML = `<div class="empty">아직 공개된 배치표가 없어요.<br>배치표가 나오면 여기에서 콘티를 볼 수 있어요.</div>`; return; }
    const mineIn = (s) => (s.lineup || []).find((x) => x.member_id === me?.id);
    if (!list.some((s) => s.id === W.focus)) W.focus = (list.find((s) => mineIn(s) && s.setlist) || list.find(mineIn) || list.find((s) => !s.ministry_id) || list[0]).id;
    const f = list.find((s) => s.id === W.focus);
    const my = mineIn(f), sl = f.setlist, items = sl?.items || [];
    const pub = sl?.status === "published";
    const leads = (f.lineup || []).filter((x) => x.pos === "leader").map((x) => x.name);
    const bm = (f.lineup || []).find((x) => x.bm);
    const rt = rtOf(items);
    const pills = [leads.length && `인도 ${leads.map(esc).join(", ")}`, bm && `밴마 ${esc(bm.name)}`,
      pub && (f.target_sec ? `RT ${mmss(rt)} / ${mmss(f.target_sec)}` : `RT ${mmss(rt)}`), f.ministry_id && f.start_time && `${mdw(f.date)} ${hm(f.start_time)}`].filter(Boolean);
    const dl = dlLeft(f.deadline);
    const changed = pub && sl.changes?.text?.length ? sl.changes : null;
    const keySongs = new Set(changed?.key_songs || []);
    const role = my ? (my.pos === "leader" ? "인도" : `${POS[my.pos] || ""}${my.sl ? " · 싱어 리더" : my.bm ? " · 밴드 마스터" : ""}`) : "";
    const pages = items.reduce((a, x) => a + (x.sheet_pages || 0), 0);
    const editBtn = f.can_edit ? `<button type="button" class="btn ${pub ? "btn-ghost" : "btn-primary"} btn-sm" data-cv-edit="${f.id}">${pub ? "콘티 고치기" : sl ? "이어서 쓰기" : "콘티 쓰기"}</button>` : "";
    root.innerHTML = `${R.offline ? `<div class="notice warn">인터넷 연결이 없어 ${fmtDateTime(R.at)}에 불러온 콘티를 보여 줘요.</div>` : ""}
      <section class="hero cv-hero">
        <span class="eyebrow">${f.date <= addDays(todayISO(), 7) ? "이번 주" : "다가오는 예배"}${my ? ` · 나도 섬겨요 (${esc(role)})` : ""}</span>
        <span class="big">${esc(svcTitle(f, list))} 콘티</span>
        ${pills.length ? `<div class="pills">${pills.map((p) => `<span>${p}</span>`).join("")}</div>` : ""}
      </section>
      ${pub ? `<button type="button" class="cv-pdfbar" data-cv-open="${f.id}"><span class="cv-pdfic">PDF</span>
          <span class="cv-pdft"><b>악보 ${pages ? `· ${pages}쪽` : "보기"}</b><span class="small muted">${sl.changes ? `${fmtDateTime(sl.updated_at)} 수정됨` : `${fmtDateTime(sl.published_at)} 올라옴`}${sl.updated_by ? ` · ${esc(sl.updated_by)}` : ""}</span></span>
          <span class="btn btn-primary btn-sm">열기</span></button>`
        : `<div class="cv-wait"><span><b>${sl ? "콘티를 쓰는 중이에요" : "아직 콘티 전이에요"}</b><span class="small muted">마감 ${esc(dlText(f.deadline))}${leads.length ? ` · 인도 ${leads.map(esc).join(", ")}` : ""}</span></span>
          <span class="chip chip-${dl.cls === "bad" ? "warn" : dl.cls === "warn" ? "warn" : "gray"}">${dl.text}</span></div>`}
      ${editBtn ? `<div class="cv-editrow">${editBtn}${f.can_edit && !pub && sl ? `<span class="small muted">임시 저장은 팀원에게 안 보여요</span>` : ""}</div>` : ""}
      ${pub || (f.can_edit && items.length) ? `<section class="card"><div class="card-title cv-ct">곡 순서 ${changed ? `<span class="chip chip-mid" title="${esc(changed.text.join(" · "))}">수정됨 · ${esc(changed.text.slice(0, 2).join(" · "))}${changed.text.length > 2 ? " 외" : ""}</span>` : !pub ? `<span class="chip chip-gray">임시 저장</span>` : ""}</div>
        <div class="cv-slist">${items.map((x, i) => `<div class="cv-srow">
          <span class="cv-sn">${i + 1}</span>
          <button type="button" class="cv-st" data-cv-song="${x.song_id}"><b>${esc(x.title)}</b>
            <small>${x.sheet_pages ? `${x.sheet_pages}쪽` : "악보 없음"}${x.duration_sec ? ` · ${mmss(x.duration_sec)}` : ""}${x.medley ? " · 메들리" : ""}</small></button>
          ${x.refs?.[0]?.[0] ? `<a class="cv-yt" href="${ytLink(x.refs[0][0], x.refs[0][1])}" target="_blank" rel="noopener" aria-label="${esc(x.title)} 레퍼런스">${ICO.play}레퍼런스</a>` : "<span></span>"}
          <span class="cv-key ${keySongs.has(x.song_id) ? "chg" : ""}">${esc(x.key || "–")}</span>
          ${x.memo ? `<span class="cv-memo">${esc(x.memo)}</span>` : ""}</div>`).join("") || `<p class="muted small" style="margin:0">곡이 아직 없어요.</p>`}</div></section>` : ""}
      ${(f.lineup || []).length ? `<section class="card"><div class="card-title cv-ct">라인업</div><div class="cv-lu">${lineupHTML(f.lineup, me?.id)}</div></section>` : ""}
      ${list.length > 1 ? `<div class="cv-others">${list.filter((s) => s.id !== f.id).map((s) => {
        const p = s.setlist?.status === "published", d2 = dlLeft(s.deadline), mine = mineIn(s);
        return `<button type="button" class="cv-wk" data-cv-focus="${s.id}"><span><b>${esc(svcShort(s, list))}</b>
          <span class="small muted">${(s.lineup || []).filter((x) => x.pos === "leader").map((x) => `인도 ${esc(x.name)}`).join(", ") || "인도 미정"}${p ? ` · ${s.setlist.items.length}곡` : ` · 마감 ${esc(dlText(s.deadline))}`}${mine ? " · 나도 섬겨요" : ""}</span></span>
          <span class="chip ${p ? "chip-ok" : s.setlist ? "chip-mid" : "chip-gray"}">${p ? (s.setlist.changes ? "수정됨" : "올라옴") : s.setlist && s.can_edit ? "쓰는 중" : d2.cls === "bad" ? "마감 지남" : "대기"}</span></button>`;
      }).join("")}</div>` : ""}`;
    root.onclick = async (e) => {
      const fb = e.target.closest("[data-cv-focus]"); if (fb) { W.focus = fb.dataset.cvFocus; mountWeek(root, { me }); return root.scrollIntoView({ block: "start" }); }
      const ob = e.target.closest("[data-cv-open]"); if (ob) return openViewer(list.find((s) => s.id === ob.dataset.cvOpen), {});
      const eb = e.target.closest("[data-cv-edit]"); if (eb) return openEditor(eb.dataset.cvEdit, { after: () => mountWeek(root, { me }) });
      const sb2 = e.target.closest("[data-cv-song]"); if (sb2) return songDetail(+sb2.dataset.cvSong);
    };
  }
  function lineupHTML(lu, meId) {
    const by = {}; lu.forEach((x) => (by[x.pos] = by[x.pos] || []).push(x));
    const nm = (x) => `<span class="${x.member_id === meId ? "me" : ""}">${esc(x.name)}${x.guest ? "(G)" : ""}${x.sl || x.bm ? "*" : ""}</span>`;
    return Object.keys(POS).filter((k) => by[k]).map((k) => `<span><b>${POS[k]}</b>${by[k].map(nm).join(", ")}</span>`).join("");
  }

  // =================================================================== 악보 보기 (태블릿 세로 · 한 쪽씩)
  async function openViewer(svc, { song = 0, single = null } = {}) {
    // single: { title, path, pages } — 곡 상세에서 악보 하나만 볼 때
    const items = single ? [{ title: single.title, key: single.key, sheet_path: single.path, sheet_pages: single.pages }] : (svc.setlist?.items || []);
    const pages = [];
    items.forEach((x, i) => {
      if (x.sheet_path) for (let p = 1; p <= (x.sheet_pages || 1); p++) pages.push({ i, path: x.sheet_path, p, of: x.sheet_pages || 1 });
      else pages.push({ i, path: null, p: 1, of: 1 });
    });
    const title = single ? single.title : `${md(svc.date)} ${svc.ministry_id ? svc.ministry_name || "사역" : "주일"} · 악보`;
    const rt = rtOf(items);
    const V = { cur: Math.max(0, pages.findIndex((x) => x.i === song)), token: 0 };
    const el = openLayer("cv-viewer", `<div class="cvv-top"><button type="button" class="cvv-back" data-cvv="close" aria-label="닫기">${ICO.back}</button>
        <b class="cvv-title">${esc(title)}</b>${!single && svc.target_sec ? `<span class="cvv-rt">RT ${mmss(rt)} / ${mmss(svc.target_sec)}</span>` : ""}<span class="cvv-pg" id="cvvPg"></span></div>
      <div class="cvv-jump" role="tablist">${single ? "" : items.map((x, i) => `<button type="button" data-cvv-song="${i}"><i>${i + 1}</i>${esc(x.title)}${x.key ? ` · ${esc(x.key)}` : ""}</button>`).join("")}</div>
      <div class="cvv-stage" id="cvvStage"><canvas id="cvvCanvas" aria-label="악보"></canvas><div class="cvv-blank hidden" id="cvvBlank"></div>
        <button type="button" class="cvv-tap l" data-cvv="prev" aria-label="이전 쪽"><span>‹ 이전</span></button><button type="button" class="cvv-tap r" data-cvv="next" aria-label="다음 쪽"><span>다음 ›</span></button>
        <div class="cvv-load" id="cvvLoad">불러오는 중…</div></div>
      <div class="cvv-foot"><span class="cvv-dots" id="cvvDots"></span><span id="cvvNext"></span></div>`, () => document.removeEventListener("keydown", onKey));
    const draw = async () => {
      const pg = pages[V.cur]; if (!pg) return;
      const t = ++V.token, x = items[pg.i];
      $("#cvvPg", el).textContent = `${V.cur + 1} / ${pages.length}쪽`;
      el.querySelectorAll("[data-cvv-song]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.cvvSong === pg.i)));
      el.querySelector(`[data-cvv-song="${pg.i}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
      const dots = pages.length <= 24 ? pages.map((_, k) => `<i class="${k === V.cur ? "cur" : k < V.cur ? "on" : ""}"></i>`).join("") : "";
      $("#cvvDots", el).innerHTML = dots;
      const nx = pages[V.cur + 1];
      $("#cvvNext", el).textContent = nx ? `다음 쪽: ${items[nx.i].title}${nx.of > 1 ? ` ${nx.p}/${nx.of}` : ""}` : "마지막 쪽이에요";
      const cv = $("#cvvCanvas", el), blank = $("#cvvBlank", el), load = $("#cvvLoad", el);
      if (!pg.path) { cv.classList.add("hidden"); blank.classList.remove("hidden"); load.classList.add("hidden"); blank.innerHTML = `<b>${esc(x.title)}</b><span>${x.key ? esc(x.key) + " · " : ""}악보가 없는 곡이에요</span>`; return; }
      blank.classList.add("hidden"); load.classList.remove("hidden");
      try {
        const doc = await sheetDoc(pg.path);
        if (t !== V.token) return;
        const st = $("#cvvStage", el), r = st.getBoundingClientRect();
        const page = await doc.getPage(pg.p), v1 = page.getViewport({ scale: 1 });
        const fit = Math.min(r.width / v1.width, r.height / v1.height), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const tmp = await renderPage(doc, pg.p, Math.max(200, Math.floor(v1.width * fit * dpr)));
        if (t !== V.token) return;
        cv.width = tmp.width; cv.height = tmp.height; cv.getContext("2d").drawImage(tmp, 0, 0);
        cv.style.width = `${Math.floor(v1.width * fit)}px`; cv.style.height = `${Math.floor(v1.height * fit)}px`;
        cv.classList.remove("hidden"); load.classList.add("hidden");
        // 다음 쪽 미리 받아 둠
        const n2 = pages[V.cur + 1]; if (n2?.path) sheetDoc(n2.path).catch(() => {});
      } catch (err) { if (t === V.token) { load.textContent = err.message || "악보를 열지 못했어요"; } }
    };
    const go = (k) => { const n = Math.max(0, Math.min(pages.length - 1, k)); if (n !== V.cur) { V.cur = n; draw(); } };
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cvv]"); if (b) { const a = b.dataset.cvv; if (a === "close") return closeLayer(); if (a === "prev") return go(V.cur - 1); if (a === "next") return go(V.cur + 1); }
      const s = e.target.closest("[data-cvv-song]"); if (s) go(pages.findIndex((p) => p.i === +s.dataset.cvvSong));
    });
    // 밀어서 넘기기
    let sx = null, sy = null;
    $("#cvvStage", el).addEventListener("pointerdown", (e) => { sx = e.clientX; sy = e.clientY; });
    $("#cvvStage", el).addEventListener("pointerup", (e) => { if (sx === null) return; const dx = e.clientX - sx, dy = e.clientY - sy; sx = null; if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(V.cur + (dx < 0 ? 1 : -1)); });
    const onKey = (e) => { if (!document.body.contains(el)) return; if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(V.cur + 1); } if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); go(V.cur - 1); } };
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", () => { if (document.body.contains(el)) draw(); });
    V.go = go; el._viewer = V;
    draw();
    return el;
  }

  // =================================================================== 곡 상세 (원본 악보 · 저장된 악보 · 레퍼런스 · 부른 기록)
  async function songDetail(songId) {
    const [{ data: song }, { data: sheets }, H, up] = await Promise.all([
      sb.from("songs").select("id, title, main_key, memo, team_sec").eq("id", songId).maybeSingle(),
      sb.rpc("song_sheets", { p_songs: [songId] }),
      HISTORY.load().catch(() => null), canUpload().catch(() => false),
    ]);
    if (!song) return toast("곡을 찾을 수 없어요");
    const st = H?.songs.find((x) => x.id === songId);
    const orig = (sheets || []).filter((x) => x.kind === "original"), saved = (sheets || []).filter((x) => x.kind === "sheet");
    const log = H ? H.plays.filter((p) => p[2] === songId).sort((a, b) => b[0].localeCompare(a[0])) : [];
    const sheetRow = (x) => `<div class="cv-sheet"><span class="cv-thumb ${x.thumb ? "" : "none"}">${x.thumb ? `<img src="${x.thumb}" alt="">` : ""}</span>
        <span class="cv-st2"><b>${esc(x.name)}</b><small>${x.kind === "original" ? `${x.key ? esc(x.key) + " · " : ""}필기 없음 · ${x.pages}쪽${x.by ? ` · ${esc(x.by)} 올림` : ""}` : `${x.from_date ? md(x.from_date) + " · " : ""}${x.pages}쪽 · ${x.used}번 씀`}</small></span>
        <button type="button" class="btn btn-ghost btn-sm" data-sd-view="${x.id}">보기</button></div>`;
    const el = openLayer("cv-sheetpage", `<div class="cvs-top"><button type="button" class="cvv-back light" data-sd="close" aria-label="닫기">${ICO.back}</button><b>곡</b></div>
      <div class="cvs-body">
        <div class="cvs-head"><h2>${esc(song.title)}</h2><span class="small muted">${[song.main_key || st?.key_main ? `주로 부른 키 ${esc(song.main_key || st.key_main)}` : "", st?.keys ? esc(st.keys) : "", st?.leaders ? `인도 ${esc(st.leaders)}` : ""].filter(Boolean).join(" · ")}</span></div>
        <div class="cvs-kpis"><div><span>부른 횟수</span><b>${st?.count || 0}</b></div><div><span>최근 1년</span><b>${st?.last12 || 0}</b></div><div><span>마지막</span><b>${st?.last ? md(st.last) : "–"}</b><small>${st?.last ? `${st.days_since}일 전` : ""}</small></div><div><span>곡 시간</span><b>${song.team_sec ? mmss(song.team_sec) : "–"}</b><small>${song.team_sec ? "팀 기준" : ""}</small></div></div>
        <section class="card"><div class="card-title cv-ct">원본 악보 <small>필기 없는 깨끗한 악보 · 키별</small></div>
          ${orig.map(sheetRow).join("") || `<p class="muted small" style="margin:0">아직 없어요.</p>`}
          ${up ? `<label class="btn btn-soft btn-sm cv-upl">+ 원본 악보 올리기<input type="file" accept="application/pdf" id="sdOrig" hidden></label>` : ""}</section>
        <section class="card"><div class="card-title cv-ct">저장된 악보 <small>콘티에서 이름을 붙여 저장한 것</small></div>
          ${saved.map(sheetRow).join("") || `<p class="muted small" style="margin:0">아직 없어요. 콘티에 이 곡을 넣고 통합본을 올리면 쌓여요.</p>`}</section>
        ${st?.refs?.length ? `<section class="card"><div class="card-title cv-ct">레퍼런스 <small>${st.refs.length}개</small></div>
          ${st.refs.slice(0, 6).map((r, i) => `<div class="cv-ref"><a class="hx-yt" href="${ytLink(r[0], r[3])}" target="_blank" rel="noopener">▶ 영상 ${i + 1}</a><span class="small muted">${r[1]}번 사용 · 마지막 ${r[4] ? r[4].slice(2).replace(/-/g, ".") : ""}${r[2] ? ` · ${esc(r[2])}` : ""}</span></div>`).join("")}</section>` : ""}
        ${log.length ? `<section class="card"><div class="card-title cv-ct">부른 기록 <small>${st?.count || log.length}번</small></div>
          ${log.slice(0, 12).map((p) => `<div class="cv-ref"><b class="small">${p[0].replace(/-/g, ".")}</b><span class="small muted">${esc((H.svc[p[0]]?.[0] || []).join(" · "))}</span>${p[4] ? `<span class="cv-key">${esc(p[4])}</span>` : ""}</div>`).join("")}</section>` : ""}
      </div>`);
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-sd=close]")) return closeLayer();
      const v = e.target.closest("[data-sd-view]");
      if (v) { const x = (sheets || []).find((s) => s.id === +v.dataset.sdView); if (x) { openViewer(null, { single: { title: `${song.title} · ${x.name}`, key: x.key, path: x.path, pages: x.pages } }); } }
    });
    $("#sdOrig", el)?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      const key = (prompt("이 원본 악보의 키를 적어 주세요 (예: G)", song.main_key || "") || "").trim();
      try {
        toast("올리는 중…", 8000);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const doc = await (await pdfjs()).getDocument({ data: bytes.slice() }).promise;
        const path = `originals/${songId}/${uuid()}.pdf`;
        const { error } = await sb.storage.from("sheets").upload(path, bytes, { contentType: "application/pdf", upsert: false });
        if (error) throw new Error("파일을 올리지 못했어요");
        const { error: e2 } = await sb.rpc("add_original_sheet", { p_song: songId, p_key: key || null, p_name: `원본${key ? " " + key : ""}`, p_path: path, p_pages: doc.numPages, p_size: bytes.length, p_thumb: await thumbOf(doc) });
        if (e2) throw new Error(e2.message);
        toast("원본 악보를 올렸어요"); songDetail(songId);
      } catch (err) { toast(err.message || "올리지 못했어요", 4000); }
    });
  }

  // =================================================================== 콘티 작성 (인도자 · 밴드 마스터 · 리더십)
  async function openEditor(sid, { after } = {}) {
    let svc;
    try { svc = await loadOne(sid); } catch (e) { return toast(e.message, 4000); }
    if (!svc.can_edit) return toast("이 예배의 콘티를 고칠 수 있는 사람이 아니에요", 4000);
    const [sr, H, meRes] = await Promise.all([sb.from("songs").select("id, title, main_key, team_sec").order("title"), HISTORY.load().catch(() => null), sb.auth.getUser()]);
    const stats = new Map((H?.songs || []).map((x) => [x.id, x]));
    const songs = (sr.data || []).map((x) => ({ ...x, st: stats.get(x.id) }));
    const sl = svc.setlist;
    const E = {
      svc, base: sl ? sl.version : null, pub: sl?.status === "published", songs, stats,
      target: sl?.target_sec ?? null, targetDefault: svc.target_sec, sheets: {}, yt: {}, ranges: {}, ytConfigured: true,
      items: (sl?.items || []).map((x) => ({ song_id: x.song_id, title: x.title, key: x.key || "", medley: x.medley, refs: x.refs || [], dur: x.duration_sec, src: x.duration_src,
        memo: x.memo || "", sheet: x.sheet_id ? { mode: "saved", id: x.sheet_id } : sl?.status === "published" ? { mode: "none" } : { mode: "new", name: "" }, page_from: x.page_from, page_to: x.page_to })),
      up: null, dirty: false, open: null, preview: null, more: null, q: "",
    };
    // 이 기기에 남겨 둔 작성 중 내용 (PDF는 빼고)
    const DKEY = `pole2.conti.draft.${sid}`;
    const saved = ls.get(DKEY);
    let restored = false;
    if (saved && saved.base === E.base && saved.items?.length) { E.items = saved.items; E.target = saved.target ?? E.target; restored = true; }
    const leaderName = (svc.lineup || []).find((x) => x.pos === "leader")?.name || "";
    await loadSongMeta(E, E.items.map((x) => x.song_id));
    const el = openLayer("cv-editor", `<header class="ce-top"><button type="button" class="cvv-back light" data-ce="close" aria-label="닫기">${ICO.back}</button>
        <span><span class="small muted">${esc(svcShort(svc))}</span><b>${esc(svcTitle(svc))} 콘티 ${E.pub ? "고치기" : "쓰기"}</b></span></header>
      <div class="ce-body" id="ceBody"></div>
      <div class="ce-bar" id="ceBar"></div>`, () => after?.());
    const body = $("#ceBody", el);
    const persist = () => { E.dirty = true; ls.set(DKEY, { base: E.base, target: E.target, items: E.items.map(({ title, ...x }) => ({ title, ...x })), at: Date.now() }); };
    const target = () => E.target ?? E.targetDefault;
    const songById = (id) => E.songs.find((x) => x.id === id);

    function rtCard() {
      const total = rtOf(E.items.map((x) => ({ duration_sec: x.dur }))), unk = E.items.filter((x) => !x.dur).length, tg = target();
      const pct = tg ? Math.min(100, Math.round(100 * total / Math.max(tg, total || 1))) : 0, tick = tg ? Math.min(100, Math.round(100 * tg / Math.max(tg, total))) : 0;
      const diff = tg ? tg - total : null;
      const first = !svc.ministry_id && +svc.date.slice(8) <= 7;
      return `<section class="ce-rt" id="ceRt"><div class="ce-rt-top"><span><small>예상 RT</small><b>${mmss(total)}</b>${tg ? `<span class="of">/ ${mmss(tg)}</span>` : ""}</span>
          ${tg ? `<span class="chip ${diff >= 0 ? "chip-ok" : "chip-warn"}">${diff >= 0 ? `${mmss(diff)} 남음` : `${mmss(-diff)} 초과`}</span>` : ""}</div>
        ${tg ? `<div class="ce-rtbar"><i style="width:${pct}%"></i><span class="tick" style="left:${tick}%"></span></div>` : ""}
        <span class="small muted">${svc.ministry_id ? "사역" : first ? "첫째 주 주일(성찬식)" : "주일"} · ${tg ? `목표 ${Math.round(tg / 60)}분${E.target != null ? " (이번만 바꿈)" : ""}` : "목표 RT 없음"}${unk ? ` · 시간 모르는 곡 ${unk}곡` : ""} · <button type="button" class="linkbtn" data-ce="target">${tg ? "이번만 바꾸기" : "목표 정하기"}</button>
          ${E.target != null ? ` · <button type="button" class="linkbtn" data-ce="target-reset">기본으로</button>` : ""}</span></section>`;
    }
    function rowHTML(x, i) {
      const s = songById(x.song_id), st = s?.st, list = E.sheets[x.song_id] || [];
      const ref = x.refs?.[0], rng = ref ? E.ranges[`${x.song_id}:${ref[0]}`] : null;
      const sheet = x.sheet.mode === "saved" ? list.find((v) => v.id === x.sheet.id) : null;
      const srcTag = { manual: ["me", `직접${x.orig ? ` · 원래 ${mmss(x.orig)}` : ""}`], team: ["team", "팀 기준"], video: ["vid", "영상"] }[x.src] || ["none", "모름"];
      const open = E.open === i;
      return `<div class="ce-row" data-i="${i}">
        <span class="ce-grip" data-grip aria-label="끌어서 순서 바꾸기" role="button" tabindex="0">${ICO.grip}</span><span class="cv-sn">${i + 1}</span>
        <span class="ce-t"><b>${esc(x.title)}</b><small>${ref ? `<a href="${ytLink(ref[0], rng?.start_sec ?? ref[1])}" target="_blank" rel="noopener">▶ 영상</a>${rng ? ` · 구간 ${mmss(rng.start_sec)}~${rng.end_sec ? mmss(rng.end_sec) : "끝"}` : ""}` : "레퍼런스 없음"}${st?.count ? ` · ${st.count}번` : ""}${st?.last ? ` · 마지막 ${md(st.last)}` : ""}</small></span>
        <input class="ce-key" list="ceKeys" value="${esc(x.key)}" data-f="key" aria-label="${esc(x.title)} 키" maxlength="12" placeholder="키">
        <span class="ce-tm"><input value="${x.dur ? mmss(x.dur) : ""}" data-f="dur" inputmode="numeric" aria-label="${esc(x.title)} 곡 시간" placeholder="0:00"><em class="ce-src ${srcTag[0]}">${srcTag[1]}</em></span>
        <button type="button" class="ce-x" data-ce="rm" aria-label="${esc(x.title)} 빼기">${ICO.x}</button>
        <div class="ce-sh"><span class="ce-lab">악보</span>${x.sheet.mode === "new"
          ? `<div class="ce-new"><span class="ce-tag">새로 저장</span><input value="${esc(x.sheet.name)}" data-f="sheetname" aria-label="${esc(x.title)} 악보 이름" maxlength="60"><button type="button" class="linkbtn" data-ce="sheet-cancel">${list.length ? "취소" : "악보 없이"}</button>${list.length ? "" : `<span class="small muted ce-hint">저장된 악보가 아직 없어요</span>`}</div>`
          : `<button type="button" class="ce-shsel ${open ? "open" : ""}" data-ce="sheet-open"><span class="nm">${sheet ? esc(sheet.name) : x.sheet.mode === "saved" ? "고른 악보" : "악보 없이"}</span><span class="mt">${sheet ? [sheet.kind === "original" ? "원본 · 필기 없음" : sheet.from_date ? md(sheet.from_date) : "", `${sheet.pages}쪽`, sheet.kind === "sheet" ? `${sheet.used}번 씀` : ""].filter(Boolean).join(" · ") : list.length ? `저장된 악보 ${list.length}개` : ""}</span><span class="cv">▾</span></button>`}
          ${open ? sheetList(x, list) : ""}</div>
        <div class="ce-more"><button type="button" class="linkbtn" data-ce="more">${E.more === i ? "접기" : `메모 · 레퍼런스${x.memo ? " · 메모 있음" : ""}${x.medley ? " · 메들리" : ""}`}</button>
          ${E.more === i ? `<div class="ce-morebox">
            <label class="field">메모 <span class="hint">· 팀원에게 보여요</span><input class="input" data-f="memo" value="${esc(x.memo)}" maxlength="200" placeholder="예: A → Bb로 올림"></label>
            <label class="checkrow"><input type="checkbox" data-f="medley" ${x.medley ? "checked" : ""}><span><b>메들리</b><small>앞 곡과 이어서 불러요</small></span></label>
            <div class="field">레퍼런스 영상<div class="ce-refs">${(st?.refs || []).slice(0, 4).map((r) => `<button type="button" class="pillbtn" data-ref="${esc(r[0])}" data-t="${r[3] || 0}" aria-pressed="${ref?.[0] === r[0]}">${esc(r[0].slice(0, 5))}… ${r[1]}번</button>`).join("")}</div>
              <input class="input" data-f="refurl" placeholder="유튜브 주소 붙여 넣기" value="${ref ? ytLink(ref[0], ref[1] || 0) : ""}"></div>
            ${ref ? `<div class="row ce-range"><span class="small" style="font-weight:700">구간</span><input class="input" data-f="rs" value="${mmss(rng?.start_sec ?? ref[1] ?? 0)}" aria-label="시작"> ~ <input class="input" data-f="re" value="${rng?.end_sec ? mmss(rng.end_sec) : ""}" placeholder="끝" aria-label="끝">
              <span class="small muted">${E.yt[ref[0]]?.duration_sec ? `영상 길이 ${mmss(E.yt[ref[0]].duration_sec)}` : E.ytConfigured ? "" : "영상 길이를 아직 몰라요"}</span></div>` : ""}
          </div>` : ""}</div>
      </div>`;
    }
    function sheetList(x, list) {
      const pv = E.preview && E.preview.song === x.song_id ? list.find((v) => v.id === E.preview.id) : null;
      return `<div class="ce-shlist">${list.map((v) => `<button type="button" class="ce-opt ${x.sheet.mode === "saved" && x.sheet.id === v.id ? "on" : ""} ${pv?.id === v.id ? "pv" : ""}" data-ce="sheet-pv" data-id="${v.id}">
          <span class="cv-thumb sm">${v.thumb ? `<img src="${v.thumb}" alt="">` : ""}</span><b>${esc(v.name)}</b><span>${[v.kind === "original" ? "원본 · 필기 없음" : v.from_date ? md(v.from_date) : "", `${v.pages}쪽`, v.kind === "sheet" ? `${v.used}번 씀` : ""].filter(Boolean).join(" · ")}</span><i>${x.sheet.mode === "saved" && x.sheet.id === v.id ? "✓" : ""}</i></button>
          ${pv?.id === v.id ? `<div class="ce-prev"><span class="cv-thumb lg">${v.thumb ? `<img src="${v.thumb}" alt="${esc(v.name)} 첫 쪽">` : ""}</span>
            <span class="ce-prev-i"><small>미리보기</small><b>${esc(v.name)}</b><span>${[v.kind === "original" ? "원본 악보" : v.from_date ? fmtDate(v.from_date, { year: "numeric", month: "numeric", day: "numeric" }) : "", v.kind !== "original" && v.from_leaders?.length ? `${esc(v.from_leaders.join(", "))} 콘티` : "", `${v.pages}쪽`].filter(Boolean).join(" · ")}</span>
              <span class="row"><button type="button" class="btn btn-ghost btn-sm" data-ce="sheet-big" data-id="${v.id}">크게 보기</button><button type="button" class="btn btn-primary btn-sm" data-ce="sheet-use" data-id="${v.id}">이 악보 쓰기</button></span></span></div>` : ""}`).join("")}
        <button type="button" class="ce-opt new" data-ce="sheet-new"><span class="cv-thumb sm plus">+</span><b>새 악보로 저장</b><span>올린 통합본의 이 곡 쪽을 새 이름으로</span><i></i></button>
        <button type="button" class="ce-opt" data-ce="sheet-none"><span class="cv-thumb sm none"></span><b>악보 없이</b><span>보기 화면에 빈 쪽으로</span><i>${x.sheet.mode === "none" ? "✓" : ""}</i></button></div>`;
    }
    function searchHTML() {
      const q = E.q.trim().toLowerCase().replace(/\s/g, ""), total = rtOf(E.items.map((x) => ({ duration_sec: x.dur }))), tg = target();
      const hits = q ? E.songs.filter((s) => s.title.toLowerCase().replace(/\s/g, "").includes(q)).sort((a, b) => (b.st?.count || 0) - (a.st?.count || 0)).slice(0, 8) : [];
      const exact = E.songs.some((s) => s.title.toLowerCase().replace(/\s/g, "") === q);
      return q ? `<div class="ce-drop" id="ceDrop">${hits.map((s) => {
          const d = guessDur(E, s, null), after = total + (d || 0);
          const chip = !d ? "" : tg ? (after <= tg ? `<span class="chip chip-ok">넣으면 ${mmss(after)}</span>` : `<span class="chip chip-warn">넣으면 ${mmss(after - tg)} 초과</span>`) : `<span class="chip chip-gray">${mmss(d)}</span>`;
          return `<button type="button" class="ce-o" data-add="${s.id}"><b>${esc(s.title)}</b><small>${s.st?.count ? `${s.st.count}번 · 마지막 ${s.st.last.slice(2).replace(/-/g, ".")}` : "아직 안 부름"}${s.main_key || s.st?.key_main ? ` · 주로 ${esc(s.main_key || s.st.key_main)}` : ""}${d ? ` · ${mmss(d)}` : ""}</small><span class="r">${chip}</span></button>`;
        }).join("")}${!exact ? `<button type="button" class="ce-o add" data-ce="newsong">+ '${esc(E.q.trim())}'으로 새 곡 추가</button>` : ""}</div>` : "";
    }
    function pdfHTML() {
      const U = E.up, n = E.items.length;
      const haveSheets = E.items.filter((x) => x.sheet.mode === "saved").length;
      let pages = "", sum = "";
      if (U) {
        const tag = (p) => U.tags[p];
        pages = `<div class="ce-pages">${U.thumbs.map((t, p) => { const j = tag(p); const x = j == null ? null : E.items[j];
            return `<button type="button" class="ce-pg" data-pg="${p}" aria-label="${p + 1}쪽 · ${x ? esc(x.title) : "곡 아님"}"><span class="pp"><img src="${t}" alt=""></span><span class="tag c${j == null ? "x" : (j % 6) + 1}">${x ? `${j + 1} ${esc(x.title.slice(0, 6))}` : "곡 아님"}</span>${p + 1}쪽</button>`; }).join("")}</div>
          ${E.pgPick != null ? `<div class="ce-pgpick"><b>${E.pgPick + 1}쪽부터 어느 곡이에요?</b><div class="chips2">${E.items.map((x, j) => `<button type="button" data-pgset="${j}" aria-pressed="${U.tags[E.pgPick] === j}">${j + 1} ${esc(x.title)}</button>`).join("")}<button type="button" data-pgset="-1">곡 아님</button></div></div>` : ""}`;
        const plan = planSheets(E);
        sum = `<div class="ce-sum" id="ceSum">${plan.map((p) => `<div class="ce-sum-r ${p.state}"><b>${p.i + 1} ${esc(p.title)}</b><span>${p.text}</span>
            ${p.state === "ask" ? `<div class="ce-cmp"><span class="cv-thumb lg">${p.old ? `<img src="${p.old}" alt="저장된 악보">` : ""}<small>저장된 '${esc(p.oldName)}'</small></span><span class="cv-thumb lg"><img src="${p.neu}" alt="올린 쪽"><small>올린 통합본</small></span>
              <span class="ce-cmp-a"><b>올린 쪽이 고른 악보와 달라 보여요</b><span class="small muted">필기를 새로 했으면 새로 저장하세요.</span>
                <button type="button" class="btn btn-primary btn-sm" data-cmp="new" data-i="${p.i}">새 악보로 저장</button><button type="button" class="btn btn-ghost btn-sm" data-cmp="keep" data-i="${p.i}">그대로 쓰기</button></span></div>` : ""}</div>`).join("")}</div>`;
      }
      return `<section class="panel ce-pdf"><h2>악보 PDF <small>필기 포함 통합본 1개</small></h2>
        <div class="ce-draft"><span><b>① 초안 받기</b><span class="small muted">곡마다 고른 악보(저장된 악보 · 원본)를 콘티 순서대로 이어 붙인 PDF · ${n}곡 중 ${haveSheets}곡 있음${n > haveSheets ? ", 없는 곡은 빈 쪽" : ""}</span></span>
          <button type="button" class="btn btn-soft btn-sm" data-ce="draft" ${n ? "" : "disabled"}>초안 PDF 받기</button></div>
        <span class="ce-step">② 노트 앱에서 고친 통합본 올리기</span>
        <div class="ce-upl">${U ? `<span class="cv-pdfic">PDF</span><span class="ce-upl-t"><b>${esc(U.name)}</b><span class="small">${mb(U.size)} · ${U.size <= LIMIT ? `<span class="ok">5MB 이하라 압축 없이 그대로</span>` : `<span class="warn">5MB가 넘어서 올릴 때 줄여서 저장해요</span>`} · ${U.thumbs.length}쪽</span></span>`
          : `<span class="cv-pdfic">PDF</span><span class="ce-upl-t"><b>${E.pub && E.items.some((x) => x.sheet.mode === "saved") ? "지금 악보를 그대로 써요" : "아직 올린 통합본이 없어요"}</b><span class="small muted">${E.pub ? "PDF를 바꿀 때만 새로 올려 주세요" : "올리면 곡별로 나눠서 저장해요"}</span></span>`}
          <label class="btn btn-ghost btn-sm">${U ? "다른 파일" : "PDF 고르기"}<input type="file" accept="application/pdf" data-ce-file hidden></label></div>
        ${U ? `<span class="small" style="font-weight:700">곡별 페이지 <span class="muted" style="font-weight:500">· 곡 순서대로 나눠 뒀어요. 틀린 쪽만 눌러 고쳐 주세요</span></span>${pages}${sum}` : ""}
      </section>`;
    }
    function draw() {
      E.items.forEach((x) => { if (x.sheet.mode === "new" && x.sheet.name == null) x.sheet.name = defaultName(x); if (x.sheet.mode === "new" && x.sheet.name === "" && !x.sheet.touched) x.sheet.name = defaultName(x); });
      const dl = dlLeft(svc.deadline);
      body.innerHTML = `${restored ? `<div class="notice ok ce-restored">이 기기에서 쓰던 내용을 불러왔어요. <button type="button" class="linkbtn" data-ce="discard">처음 상태로</button></div>` : ""}
        <div class="ce-dl ${dl.cls}">${dl.text} · ${esc(dlText(svc.deadline))}<span class="sp"></span><small>섬김자 ${new Set((svc.lineup || []).map((x) => x.member_id).filter(Boolean)).size}명 · 올리면 바로 알림</small></div>
        ${rtCard()}
        <section class="panel"><h2>곡 <small>손잡이를 끌어서 순서 바꾸기</small></h2>
          <div class="ce-search"><input class="input" id="ceQ" placeholder="곡 이름으로 찾기" aria-label="곡 검색" autocomplete="off" value="${esc(E.q)}">${searchHTML()}</div>
          <datalist id="ceKeys">${KEYS.map((k) => `<option value="${k}">`).join("")}</datalist>
          <div class="ce-list" id="ceList">${E.items.map(rowHTML).join("") || `<p class="muted small" style="margin:6px 0">위에서 곡을 찾아 넣어 주세요.</p>`}</div></section>
        ${pdfHTML()}`;
      drawBar();
    }
    function drawBar() {
      const ppl = new Set((svc.lineup || []).map((x) => x.member_id).filter(Boolean)).size;
      $("#ceBar", el).innerHTML = `<span class="ce-who small muted">${E.pub ? `${sl?.changes ? "수정한 적 있음 · " : ""}올라온 콘티예요 · 고치면 '수정됨'으로 알려요` : sl ? `마지막 저장 ${fmtDateTime(sl.updated_at)} · 임시 저장은 팀원에게 안 보여요` : "임시 저장은 팀원에게 안 보여요"}</span>
        ${E.pub ? "" : `<button type="button" class="btn btn-ghost" data-ce="save">임시 저장</button>`}
        <button type="button" class="btn btn-primary ce-go" data-ce="publish">${E.pub ? "수정 올리기" : "올리기"} · ${ppl}명에게 알림</button>`;
    }
    const redrawList = () => { const y = window.scrollY, sc = body.scrollTop; draw(); body.scrollTop = sc; window.scrollTo(0, y); };
    draw();
    // ---- 이벤트
    el.addEventListener("input", (e) => {
      const t = e.target;
      if (t.id === "ceQ") { E.q = t.value; const box = $(".ce-search", el); box.querySelector("#ceDrop")?.remove(); box.insertAdjacentHTML("beforeend", searchHTML()); return; }
      const row = t.closest(".ce-row"); if (!row) return;
      const x = E.items[+row.dataset.i], f = t.dataset.f;
      if (f === "key") x.key = t.value.trim();
      if (f === "memo") x.memo = t.value;
      if (f === "sheetname") { x.sheet.name = t.value; x.sheet.touched = true; }
      persist();
    });
    el.addEventListener("change", async (e) => {
      const t = e.target;
      if (t.matches("[data-ce-file]")) return pickPdf(t.files?.[0]);
      const row = t.closest(".ce-row"); if (!row) return;
      const x = E.items[+row.dataset.i], f = t.dataset.f;
      if (f === "dur") {
        const v = parseMmss(t.value);
        if (t.value.trim() && v == null) { toast("곡 시간은 4:30처럼 적어 주세요"); t.value = x.dur ? mmss(x.dur) : ""; return; }
        if (v !== x.dur) { if (x.src !== "manual") x.orig = x.dur; x.dur = v; x.src = v ? "manual" : null; if (!v) Object.assign(x, recompute(E, x)); persist(); redrawList(); }
      }
      if (f === "medley") { x.medley = t.checked; persist(); }
      if (f === "refurl") {
        const id = ytOf(t.value);
        if (t.value.trim() && !id) return toast("유튜브 주소를 확인해 주세요");
        const tm = +(String(t.value).match(/[?&]t=(\d+)/)?.[1] || 0);
        x.refs = id ? [[id, tm, ""]] : []; await loadYt(E, id ? [id] : []); if (x.src !== "manual") Object.assign(x, recompute(E, x)); persist(); redrawList();
      }
      if (f === "rs" || f === "re") {
        const ref = x.refs?.[0]; if (!ref) return;
        const s = row.querySelector('[data-f="rs"]').value.trim(), en = row.querySelector('[data-f="re"]').value.trim();
        const sv = s ? parseMmss(s) ?? (s === "0:00" || s === "0" ? 0 : null) : 0, ev = en ? parseMmss(en) : null;
        if (sv == null || (en && ev == null) || (ev != null && ev <= sv)) return toast("구간은 0:30 ~ 4:50처럼 적어 주세요");
        E.ranges[`${x.song_id}:${ref[0]}`] = { start_sec: sv, end_sec: ev };
        x.ref_range = { yt: ref[0], start: sv, end: ev };
        if (x.src !== "manual") Object.assign(x, recompute(E, x));
        persist(); redrawList();
      }
    });
    el.addEventListener("click", async (e) => {
      const add = e.target.closest("[data-add]");
      if (add) { await addSong(+add.dataset.add); return; }
      const pg = e.target.closest("[data-pg]"); if (pg) { E.pgPick = E.pgPick === +pg.dataset.pg ? null : +pg.dataset.pg; return redrawList(); }
      const ps = e.target.closest("[data-pgset]"); if (ps) { setTag(E.up, E.pgPick, +ps.dataset.pgset); E.pgPick = null; await checkSame(E); return redrawList(); }
      const cmp = e.target.closest("[data-cmp]"); if (cmp) { const x = E.items[+cmp.dataset.i]; x.cmp = cmp.dataset.cmp; if (x.cmp === "new") { x.sheet = { mode: "new", name: defaultName(x), fromId: x.sheet.id }; } persist(); return redrawList(); }
      const b = e.target.closest("[data-ce]"); if (!b) { if (!e.target.closest(".ce-search")) { if (E.q && !e.target.closest("#ceQ")) { /* 바깥 누르면 검색 결과 닫기 */ } } return; }
      const a = b.dataset.ce, row = b.closest(".ce-row"), i = row ? +row.dataset.i : null, x = i != null ? E.items[i] : null;
      if (a === "close") return closeLayer();
      if (a === "discard") { ls.del(DKEY); return openEditor(sid, { after }); }
      if (a === "target") {
        const v = prompt(`이번 예배 목표 RT를 분으로 적어 주세요${E.targetDefault ? ` (기본 ${Math.round(E.targetDefault / 60)}분)` : ""}`, target() ? String(Math.round(target() / 60)) : "");
        if (v === null) return; const n = +String(v).trim(); if (!(n >= 1 && n <= 120)) return toast("1~120분으로 적어 주세요");
        E.target = Math.round(n * 60); persist(); return redrawList();
      }
      if (a === "target-reset") { E.target = null; persist(); return redrawList(); }
      if (a === "newsong") {
        const { data, error } = await sb.rpc("add_song", { p_title: E.q.trim() });
        if (error) return toast(error.message || "곡을 더하지 못했어요", 4000);
        if (!songById(data)) E.songs.push({ id: data, title: E.q.trim(), main_key: null, team_sec: null, st: null });
        return addSong(data);
      }
      if (a === "rm") { E.items.splice(i, 1); if (E.up) E.up.tags = E.up.tags.map((t) => (t == null ? null : t === i ? null : t > i ? t - 1 : t)); E.open = E.more = null; persist(); return redrawList(); }
      if (a === "more") { E.more = E.more === i ? null : i; return redrawList(); }
      if (a === "sheet-open") { E.open = E.open === i ? null : i; E.preview = null; return redrawList(); }
      if (a === "sheet-pv") { E.preview = { song: x.song_id, id: +b.dataset.id }; return redrawList(); }
      if (a === "sheet-use") { x.sheet = { mode: "saved", id: +b.dataset.id }; x.cmp = null; E.open = null; E.preview = null; await checkSame(E); persist(); return redrawList(); }
      if (a === "sheet-big") { const v = (E.sheets[x.song_id] || []).find((s) => s.id === +b.dataset.id); if (v) openViewerOver(x.title, v); return; }
      if (a === "sheet-new") { x.sheet = { mode: "new", name: defaultName(x) }; x.cmp = null; E.open = null; persist(); return redrawList(); }
      if (a === "sheet-none") { x.sheet = { mode: "none" }; x.cmp = null; E.open = null; persist(); return redrawList(); }
      if (a === "sheet-cancel") { const list = E.sheets[x.song_id] || []; x.sheet = x.sheet.fromId ? { mode: "saved", id: x.sheet.fromId } : list[0] ? { mode: "saved", id: list[0].id } : { mode: "none" }; x.cmp = x.sheet.fromId ? "keep" : null; persist(); return redrawList(); }
      if (a === "draft") return downloadDraft(E, svc);
      if (a === "save") return submit(false, b);
      if (a === "publish") return submit(true, b);
    });
    // 끌어서 순서 바꾸기
    el.addEventListener("pointerdown", (e) => {
      const g = e.target.closest("[data-grip]"); if (!g) return;
      e.preventDefault();
      const row = g.closest(".ce-row"), list = $("#ceList", el), from = +row.dataset.i, y0 = e.clientY;
      row.classList.add("drag"); g.setPointerCapture?.(e.pointerId);
      let to = from;
      const move = (ev) => {
        row.style.transform = `translateY(${ev.clientY - y0}px)`;
        const others = [...list.querySelectorAll(".ce-row")].filter((r) => r !== row);
        to = others.filter((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2 < ev.clientY; }).length;
      };
      const up = () => {
        g.removeEventListener("pointermove", move); g.removeEventListener("pointerup", up); g.removeEventListener("pointercancel", up);
        row.classList.remove("drag"); row.style.transform = "";
        if (to !== from) {
          const [it] = E.items.splice(from, 1); E.items.splice(to, 0, it);
          if (E.up) { const map = E.items.map((x) => x); E.up.tags = E.up.tags.map((t) => (t == null ? null : map.indexOf(E.prevOrder[t]))); }
          E.open = E.more = null; persist();
        }
        E.prevOrder = E.items.slice(); redrawList();
      };
      E.prevOrder = E.items.slice();
      g.addEventListener("pointermove", move); g.addEventListener("pointerup", up); g.addEventListener("pointercancel", up);
    });
    E.prevOrder = E.items.slice();

    async function addSong(id) {
      const s = songById(id); if (!s) return;
      if (E.items.length >= 30) return toast("곡은 30곡까지 넣을 수 있어요");
      await loadSongMeta(E, [id]);
      const st = s.st, ref = st?.refs?.[0];
      const x = { song_id: id, title: s.title, key: s.main_key || st?.key_main || "", medley: false, refs: ref ? [[ref[0], ref[3] || 0, ""]] : [], dur: null, src: null, memo: "", sheet: { mode: "none" } };
      if (ref) await loadYt(E, [ref[0]]);
      Object.assign(x, recompute(E, x));
      const list = E.sheets[id] || [];
      const keyMatch = list.find((v) => v.kind === "sheet" && (v.key || "") === x.key) || list.find((v) => v.kind === "sheet");
      x.sheet = keyMatch ? { mode: "saved", id: keyMatch.id } : { mode: "new", name: defaultName(x) };
      E.items.push(x); E.q = ""; persist(); redrawList();
      setTimeout(() => $("#ceQ", el)?.focus(), 0);
    }
    function defaultName(x) { return `${leaderName || "인도자"} ${x.key || ""}`.trim(); }
    async function pickPdf(file) {
      if (!file) return;
      if (file.type && file.type !== "application/pdf") return toast("PDF 파일을 골라 주세요");
      toast("PDF를 읽는 중…", 6000);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const doc = await (await pdfjs()).getDocument({ data: bytes.slice() }).promise;
        const thumbs = [];
        for (let p = 1; p <= doc.numPages; p++) thumbs.push(await thumbOf(doc, p, 110));
        E.up = { name: file.name, size: bytes.length, bytes, doc, thumbs, tags: suggestTags(E, doc.numPages) };
        E.pgPick = null;
        await checkSame(E);
        document.querySelectorAll(".toast").forEach((t) => t.remove());
        redrawList();
        $(".ce-pdf", el)?.scrollIntoView({ block: "start" });
      } catch (err) { toast(err.message || "PDF를 읽지 못했어요", 4000); }
    }
    async function submit(publish, btn) {
      if (!E.items.length && publish) return toast("곡을 하나 이상 넣어 주세요");
      const plan = E.up ? planSheets(E) : [];
      if (publish && plan.some((p) => p.state === "ask")) { $("#ceSum", el)?.scrollIntoView({ block: "center" }); return toast("달라 보이는 악보를 새로 저장할지 먼저 골라 주세요", 4000); }
      if (E.items.some((x) => x.sheet.mode === "new" && !String(x.sheet.name || "").trim())) return toast("새로 저장할 악보 이름을 적어 주세요");
      if (publish && !E.up && E.items.some((x) => x.sheet.mode === "new")) {
        if (!confirm("새로 저장할 악보가 있는데 통합본을 아직 안 올렸어요. 그 곡은 악보 없이 올릴까요?")) return;
      }
      btn.disabled = true; const label = btn.textContent;
      try {
        let src = E.up?.bytes, srcDoc = E.up?.doc;
        const payload = { target_sec: E.target, pages: E.up ? E.up.thumbs.length : sl?.pages ?? null, items: [] };
        if (E.up && publish && E.up.size > LIMIT) {
          btn.textContent = "PDF 줄이는 중…";
          const small = await compressPdf(srcDoc, E.up.size);
          if (small) { src = small; srcDoc = null; }
        }
        let PL = null, srcPdf = null;
        for (let i = 0; i < E.items.length; i++) {
          const x = E.items[i], p = plan.find((q) => q.i === i);
          const it = { song_id: x.song_id, key: x.key || null, medley: !!x.medley, refs: x.refs || [], duration_sec: x.dur || null, duration_src: x.dur ? x.src : null, memo: x.memo || null, sheet_id: null };
          if (x.ref_range) it.ref_range = x.ref_range;
          if (p) { it.page_from = p.from + 1; it.page_to = p.to + 1; }
          if (x.sheet.mode === "saved") it.sheet_id = x.sheet.id;
          if (x.sheet.mode === "new" && p && publish) {
            btn.textContent = `악보 저장 중 ${i + 1}/${E.items.length}…`;
            PL = PL || (await pdflib()); srcPdf = srcPdf || (await PL.PDFDocument.load(src));
            const out = await PL.PDFDocument.create();
            const cp = await out.copyPages(srcPdf, Array.from({ length: p.to - p.from + 1 }, (_, k) => p.from + k));
            cp.forEach((pg) => out.addPage(pg));
            const bytes = await out.save();
            const path = `sheets/${x.song_id}/${uuid()}.pdf`;
            const { error } = await sb.storage.from("sheets").upload(path, bytes, { contentType: "application/pdf", upsert: false });
            if (error) throw new Error("악보 파일을 올리지 못했어요. 인터넷 연결을 확인해 주세요.");
            try { const c = await caches.open(CACHE); await c.put(ckey(path), new Response(bytes, { headers: { "Content-Type": "application/pdf" } })); } catch {}
            it.new_sheet = { name: x.sheet.name.trim(), path, pages: p.to - p.from + 1, size: bytes.length, thumb: E.up.thumbs[p.from] };
          }
          payload.items.push(it);
        }
        btn.textContent = publish ? "올리는 중…" : "저장 중…";
        const { data, error } = await sb.rpc("save_setlist", { p_service: sid, p_data: payload, p_publish: publish, p_base: E.base });
        if (error) {
          if (error.code === "PT409") { toast(error.message, 6000); btn.disabled = false; btn.textContent = label; return; }
          throw new Error(error.message || "저장하지 못했어요");
        }
        ls.del(DKEY); E.dirty = false;
        let msg = publish ? (data.republished ? "수정한 콘티를 올렸어요" : "콘티를 올렸어요") : "임시 저장했어요";
        if (publish) {
          try { const r = await meApi("/api/conti", { action: "notify", service_id: sid }); if (!r.skipped) msg += ` · ${r.recipients}명에게 알렸어요`; }
          catch (err) { msg += ` · 알림을 보내지 못했어요 (${err.message})`; }
        }
        toast(msg, 4000);
        closeLayer();
      } catch (err) { toast(err.message || "저장하지 못했어요", 5000); btn.disabled = false; btn.textContent = label; }
    }
    return el;
  }
  // 곡 상세 위에 악보 하나 크게 보기 (편집 화면은 그대로)
  function openViewerOver(title, v) {
    const keep = layer; layer = null; keep.el.style.display = "none"; document.body.classList.add("cv-open");
    openViewer(null, { single: { title: `${title} · ${v.name}`, key: v.key, path: v.path, pages: v.pages } }).then((vel) => {
      const prev = layer; prev.onClose = () => { keep.el.style.display = ""; layer = keep; document.body.classList.add("cv-open"); };
    });
  }
  async function loadSongMeta(E, ids) {
    ids = [...new Set(ids)].filter((id) => !E.sheets[id]);
    if (ids.length) {
      const [{ data: sh }, { data: rr }] = await Promise.all([sb.rpc("song_sheets", { p_songs: ids }), sb.from("song_refs").select("*").in("song_id", ids)]);
      ids.forEach((id) => (E.sheets[id] = (sh || []).filter((v) => v.song_id === id).sort((a, b) => (a.kind === b.kind ? b.created_at.localeCompare(a.created_at) : a.kind === "sheet" ? -1 : 1))));
      (rr || []).forEach((r) => (E.ranges[`${r.song_id}:${r.youtube_id}`] = r));
    }
    const yts = E.items.filter((x) => ids.includes(x.song_id)).map((x) => x.refs?.[0]?.[0]).filter(Boolean);
    await loadYt(E, yts);
  }
  async function loadYt(E, ids) {
    ids = [...new Set(ids)].filter((id) => id && !E.yt[id]);
    if (!ids.length) return;
    const { data } = await sb.from("yt_videos").select("id, duration_sec").in("id", ids);
    (data || []).forEach((v) => (E.yt[v.id] = v));
    const miss = ids.filter((id) => !E.yt[id]);
    if (miss.length) {
      try { const r = await meApi("/api/conti", { action: "yt", ids: miss }); Object.assign(E.yt, r.videos || {}); E.ytConfigured = r.configured !== false; } catch { E.ytConfigured = false; }
    }
  }
  // 곡 시간: 직접 고친 값 > 팀 기준 > 영상 길이(구간)
  function guessDur(E, s, x) {
    if (s?.team_sec) return s.team_sec;
    const ref = x ? x.refs?.[0] : s?.st?.refs?.[0] ? [s.st.refs[0][0], s.st.refs[0][3]] : null;
    if (!ref) return null;
    const r = E.ranges[`${s.id}:${ref[0]}`], v = E.yt[ref[0]]?.duration_sec;
    if (r?.end_sec) return r.end_sec - (r.start_sec || 0);
    if (v) return Math.max(30, v - (r?.start_sec ?? ref[1] ?? 0));
    return null;
  }
  function recompute(E, x) {
    const s = E.songs.find((q) => q.id === x.song_id);
    if (s?.team_sec) return { dur: s.team_sec, src: "team" };
    const d = guessDur(E, { ...s, team_sec: null, id: x.song_id }, x);
    return d ? { dur: d, src: "video" } : { dur: null, src: null };
  }
  // 올린 통합본 쪽 → 곡 (곡 순서대로). 고른 악보가 있으면 그 쪽 수, 나머지는 남는 쪽을 고르게
  function suggestTags(E, n) {
    const want = E.items.map((x) => { const v = x.sheet.mode === "saved" ? (E.sheets[x.song_id] || []).find((s) => s.id === x.sheet.id) : null; return v ? v.pages : null; });
    const known = want.reduce((a, w) => a + (w || 0), 0), unk = want.filter((w) => w == null).length;
    const each = unk ? Math.max(1, Math.floor((n - known) / unk)) : 0;
    let extra = unk ? Math.max(0, n - known - each * unk) : 0;
    const tags = []; E.items.forEach((x, j) => { let c = want[j] ?? each + (extra-- > 0 ? 1 : 0); while (c-- > 0 && tags.length < n) tags.push(j); });
    while (tags.length < n) tags.push(E.items.length ? E.items.length - 1 : null);
    return tags;
  }
  function setTag(U, p, j) {
    if (!U || p == null) return;
    U.tags[p] = j < 0 ? null : j;
    if (j < 0) return;
    for (let q = p + 1; q < U.tags.length && U.tags[q] != null && U.tags[q] < j; q++) U.tags[q] = j;
    for (let q = p - 1; q >= 0 && U.tags[q] != null && U.tags[q] > j; q--) U.tags[q] = j;
  }
  function rangeOf(U, j) { const ps = U.tags.map((t, p) => (t === j ? p : -1)).filter((p) => p >= 0); return ps.length ? { from: ps[0], to: ps[ps.length - 1] } : null; }
  // 곡마다 저장 계획: 새로 저장 · 그대로(저장 안 함) · 달라 보임(물어봄) · 쪽 없음
  function planSheets(E) {
    const U = E.up; if (!U) return [];
    return E.items.map((x, i) => {
      const r = rangeOf(U, i); const base = { i, title: x.title, ...(r || {}) };
      if (!r) return { ...base, state: "none", text: x.sheet.mode === "saved" ? "올린 쪽 없음 · 고른 악보를 그대로 써요" : "올린 쪽 없음 · 악보 없이" };
      const n = r.to - r.from + 1;
      if (x.sheet.mode === "new") return { ...base, state: "new", text: `새로 저장 → '${esc(x.sheet.name || "")}' · ${n}쪽` };
      if (x.sheet.mode === "saved") {
        const v = (E.sheets[x.song_id] || []).find((s) => s.id === x.sheet.id);
        if (x.cmp === "keep") return { ...base, state: "keep", text: `'${esc(v?.name || "")}'를 그대로 써서 저장하지 않아요 (올린 ${n}쪽은 쓰지 않음)` };
        if (x.same === false) return { ...base, state: "ask", text: "", old: v?.thumb, oldName: v?.name || "", neu: U.thumbs[r.from] };
        return { ...base, state: "keep", text: `'${esc(v?.name || "")}'를 그대로 써서 저장하지 않아요` };
      }
      return { ...base, state: "none", text: `악보 없이 · 올린 ${n}쪽은 쓰지 않음` };
    });
  }
  async function checkSame(E) {
    const U = E.up; if (!U) return;
    for (let i = 0; i < E.items.length; i++) {
      const x = E.items[i]; if (x.sheet.mode !== "saved") { x.same = null; continue; }
      const v = (E.sheets[x.song_id] || []).find((s) => s.id === x.sheet.id), r = rangeOf(U, i);
      if (!v || !r) { x.same = null; continue; }
      x.same = r.to - r.from + 1 === v.pages && v.thumb ? await looksSame(v.thumb, U.thumbs[r.from]) : false;
    }
  }
  // 초안 PDF: 고른 악보를 콘티 순서대로 + 악보 없는 곡은 곡 이름만 적힌 빈 쪽
  async function downloadDraft(E, svc) {
    try {
      toast("초안을 만드는 중…", 8000);
      const PL = await pdflib();
      const out = await PL.PDFDocument.create();
      let have = 0;
      for (const x of E.items) {
        const v = x.sheet.mode === "saved" ? (E.sheets[x.song_id] || []).find((s) => s.id === x.sheet.id) : null;
        if (v) {
          const src = await PL.PDFDocument.load(await sheetBytes(v.path));
          (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p)); have++;
        } else {
          const c = document.createElement("canvas"); c.width = 1240; c.height = 1754;
          const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
          g.fillStyle = "#17092E"; g.font = '700 56px "Pretendard Variable", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif'; g.fillText(x.title, 90, 150);
          g.fillStyle = "#8B7BA8"; g.font = '500 34px "Pretendard Variable", sans-serif'; g.fillText(`${x.key ? x.key + " · " : ""}악보 없음`, 90, 210);
          const png = await out.embedPng(c.toDataURL("image/png"));
          const p = out.addPage([595.28, 841.89]); p.drawImage(png, { x: 0, y: 0, width: 595.28, height: 841.89 });
        }
      }
      const bytes = await out.save();
      const name = `${svc.date.slice(5).replace("-", "")} ${svc.ministry_id ? svc.ministry_name || "사역" : "주일"} 콘티 초안.pdf`;
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })); a.download = name;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      document.querySelectorAll(".toast").forEach((t) => t.remove());
      toast(`초안을 받았어요 · ${E.items.length}곡 중 ${have}곡 악보`, 3500);
    } catch (err) { toast(err.message || "초안을 만들지 못했어요", 4000); }
  }
  // 5MB가 넘으면 쪽을 이미지로 다시 만들어 줄임 (줄인 게 더 크면 원본)
  async function compressPdf(doc, origSize) {
    const PL = await pdflib();
    const out = await PL.PDFDocument.create();
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p), v1 = page.getViewport({ scale: 1 });
      const cv = await renderPage(doc, p, Math.min(1400, Math.max(900, v1.width * 2)));
      const jpg = await out.embedJpg(cv.toDataURL("image/jpeg", 0.72));
      const pg = out.addPage([v1.width, v1.height]); pg.drawImage(jpg, { x: 0, y: 0, width: v1.width, height: v1.height });
    }
    const bytes = await out.save();
    return bytes.length < origSize ? bytes : null;
  }

  // =================================================================== 리더십: 찬양 › 콘티 (현황 · 마감 · 목표 · 설정)
  async function mountAdmin(root) {
    root.innerHTML = `<div class="empty">불러오는 중…</div>`;
    const [{ list }, { data: ts }] = await Promise.all([loadWeek(todayISO(), addDays(todayISO(), 56)).catch(() => ({ list: [] })), sb.from("team_settings").select("conti").eq("id", 1).maybeSingle()]);
    const C = { deadline_dow: 3, deadline_hour: 22, rt_first: 1200, rt_other: 1500, min_days: 3, ...(ts?.conti || {}) };
    const rows = list.filter(Boolean);
    const st = (s) => {
      const p = s.setlist?.status === "published";
      if (p) return s.setlist.changes ? ["chip-mid", "수정됨"] : ["chip-ok", "올라옴"];
      if (!s.published) return ["chip-gray", "배치 전"];
      if (new Date(s.deadline) < Date.now()) return ["chip-warn", "마감 지남"];
      return s.setlist?.items?.length ? ["chip-violet", "쓰는 중"] : ["chip-gray", "대기"];
    };
    const hours = (sel) => Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === sel ? "selected" : ""}>${String(h).padStart(2, "0")}:00</option>`).join("");
    root.innerHTML = `<section class="panel"><h2>다가오는 예배 <small>배치표가 공개되면 인도자에게 콘티 안내가 가요</small></h2>
        <div class="song-wrap"><table class="hx-lead ca-table"><thead><tr><th>예배</th><th>인도</th><th>상태</th><th>마감</th><th class="n">RT</th><th></th></tr></thead><tbody>
        ${rows.map((s) => { const [c, t] = st(s), items = s.setlist?.items || [], rt = rtOf(items);
          return `<tr data-sid="${s.id}"><td><b>${esc(svcShort(s, rows))}</b>${s.ministry_id ? ` <span class="chip chip-violet">사역</span>` : ""}</td>
            <td class="small">${(s.lineup || []).filter((x) => x.pos === "leader").map((x) => esc(x.name)).join(", ") || "<span class='muted'>—</span>"}</td>
            <td><span class="chip ${c}">${t}</span>${items.length ? ` <span class="small muted">${items.length}곡</span>` : ""}</td>
            <td class="small">${esc(dlText(s.deadline))}${s.setlist?.deadline ? ` <span class="chip chip-gray">바꿈</span>` : ""}</td>
            <td class="n small">${items.length ? mmss(rt) : "—"}${s.target_sec ? ` / ${mmss(s.target_sec)}` : ""}</td>
            <td class="ca-acts">${s.setlist?.status === "published" ? `<button type="button" class="btn btn-ghost btn-sm" data-ca="view">악보</button>` : ""}<button type="button" class="btn btn-ghost btn-sm" data-ca="edit">${s.setlist ? "고치기" : "쓰기"}</button><button type="button" class="btn btn-ghost btn-sm" data-ca="meta">마감 · 목표</button></td></tr>`; }).join("")
          || `<tr><td colspan="6" class="muted">앞으로 8주 안에 배치된 예배가 없어요.</td></tr>`}</tbody></table></div></section>
      <section class="panel" id="caSet"><h2>기본값 <small>예배마다 '마감 · 목표'로 따로 바꿀 수 있어요</small></h2>
        <div class="row"><span style="font-weight:700">주일 콘티 마감</span><select class="select" id="caDow" style="width:auto">${KDOW.map((w, i) => `<option value="${i}" ${C.deadline_dow === i ? "selected" : ""}>${w}요일</option>`).join("")}</select><select class="select" id="caHour" style="width:auto">${hours(C.deadline_hour)}</select></div>
        <div class="row"><span style="font-weight:700">사역 콘티 마감</span><select class="select" id="caMin" style="width:auto">${[1, 2, 3, 4, 5, 7].map((n) => `<option value="${n}" ${C.min_days === n ? "selected" : ""}>예배 ${n}일 전</option>`).join("")}</select><span class="small muted">22:00</span></div>
        <div class="row"><span style="font-weight:700">목표 RT</span><label class="row" style="gap:6px">첫째 주(성찬식)<input type="number" class="input" id="caFirst" min="5" max="90" value="${Math.round(C.rt_first / 60)}" style="width:80px;min-height:40px">분</label>
          <label class="row" style="gap:6px">나머지 주일<input type="number" class="input" id="caOther" min="5" max="90" value="${Math.round(C.rt_other / 60)}" style="width:80px;min-height:40px">분</label></div>
        <div class="row"><button type="button" class="btn btn-primary btn-sm" id="caSave">저장</button><span class="small muted">콘티 알림(안내 · 독촉 · 올라옴 · 수정됨)은 공지 · 알림 › 알림 설정에서 바꿔요.</span></div></section>`;
    root.onclick = async (e) => {
      const b = e.target.closest("[data-ca]"); if (b) {
        const s = rows.find((x) => x.id === b.closest("tr").dataset.sid);
        if (b.dataset.ca === "view") return openViewer(s, {});
        if (b.dataset.ca === "edit") return openEditor(s.id, { after: () => mountAdmin(root) });
        if (b.dataset.ca === "meta") {
          const k = kst(s.deadline);
          const dv = prompt(`${svcShort(s, rows)} 콘티 마감 (YYYY-MM-DD HH:MM · 비우면 기본값)`, s.setlist?.deadline ? `${k.date} ${k.hm}` : "");
          if (dv === null) return;
          const mt = dv.trim() ? dv.trim().match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})$/) : null;
          if (dv.trim() && !mt) return toast("2026-11-11 22:00처럼 적어 주세요");
          const tv = prompt("목표 RT (분 · 비우면 기본값)", s.setlist?.target_sec ? String(Math.round(s.setlist.target_sec / 60)) : "");
          if (tv === null) return;
          if (tv.trim() && !(+tv >= 1 && +tv <= 120)) return toast("목표 RT는 1~120분으로 적어 주세요");
          const { error } = await sb.rpc("set_conti_meta", { p_service: s.id, p_deadline: mt ? `${mt[1]}T${mt[2].padStart(2, "0")}:${mt[3]}:00+09:00` : null, p_target: tv.trim() ? Math.round(+tv * 60) : null });
          toast(error ? error.message || "바꾸지 못했어요" : "바꿨어요"); return mountAdmin(root);
        }
      }
      if (e.target.id === "caSave") {
        const v = { deadline_dow: +$("#caDow").value, deadline_hour: +$("#caHour").value, min_days: +$("#caMin").value, rt_first: Math.round(+$("#caFirst").value * 60), rt_other: Math.round(+$("#caOther").value * 60) };
        if (!(v.rt_first >= 300 && v.rt_other >= 300)) return toast("목표 RT는 5분 이상으로 적어 주세요");
        const { error } = await sb.from("team_settings").update({ conti: v }).eq("id", 1);
        toast(error ? "저장하지 못했어요" : "저장했어요"); if (!error) mountAdmin(root);
      }
    };
  }

  window.CONTI = { mountWeek, mountAdmin, openEditor, openViewer, songDetail, loadOne, closeLayer, _test: { suggestTags, setTag, parseMmss, mmss, looksSame } };
})();
