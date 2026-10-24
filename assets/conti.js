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
    sync: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 19c.8-3 2.8-4.5 5-4.5s4.2 1.5 5 4.5M11 19c.8-3 2.8-4.5 5-4.5s4.2 1.5 5 4.5"/></svg>`,
  };

  // ------------------------------------------------------------------ 025: BPM · 박자 · 메트로놈 · 화면 켜 두기
  const METERS = ["4/4", "3/4", "6/8", "1/4"];
  const beatsOf = (m) => (m === "3/4" ? 3 : m === "6/8" ? 6 : m === "1/4" ? 1 : 4);
  const bpmText = (bpm, meter) => (bpm ? `♩=${bpm}${meter && meter !== "4/4" ? ` · ${meter}` : ""}` : "");
  // 026: 음원과 키 다름 = 키 뒤 '*'
  const keyText = (x) => (x.key ? `${x.key}${x.diff_key ? "*" : ""}` : x.diff_key ? "*" : "–");
  // 026: 메들리 묶음 — join_prev(앞 곡에 이어서)인 곡은 앞 번호 아래로. n = 묶음 번호
  function groupInfo(items, i) {
    let n = 0; for (let k = 0; k <= i; k++) if (!(k > 0 && items[k].join_prev)) n++;
    const join = i > 0 && !!items[i].join_prev, head = !join && !!items[i + 1]?.join_prev;
    return { n, join, head, medley: !!items[i].medley_id };
  }
  function groupsOf(items) {
    const out = []; items.forEach((x, i) => { if (i > 0 && x.join_prev && out.length) out[out.length - 1].push(x); else out.push([x]); }); return out;
  }
  // 026: 카톡 복사 문구 — 'YYMMDD 찬양콘티' · 번호. 곡 키(*) · 레퍼런스 · 메들리는 '+ 곡 키' · 맨 아래 섬김이 팀 링크
  function contiText(svc, links = []) {
    const items = svc.setlist?.items || [];
    const d = String(svc.date || "").slice(2).replace(/-/g, "");
    const head = `${d} ${svc.ministry_id ? `${svc.ministry_name || "사역"}${svc.label ? " " + svc.label : ""} ` : ""}찬양콘티`;
    const kt = (x) => (x.key || x.diff_key ? ` ${x.key || ""}${x.diff_key ? "*" : ""}` : "");
    const blocks = groupsOf(items).map((g, n) => {
      const lines = g.map((x, k) => `${k ? "+ " : `${n + 1}. `}${x.title}${kt(x)}`);
      const ref = g.map((x) => x.refs?.[0]).find((r) => r?.[0]);
      if (ref) lines.push(ytLink(ref[0], ref[1]));
      return lines.join("\n");
    });
    const tail = links.length ? "\n\n" + links.map((l) => `${l.label}: ${shareUrl(l.token)}`).join("\n") : "";
    return `${head}\n\n${blocks.join("\n\n")}${tail}`;
  }
  async function copyPop(svc) {
    let links = [];
    try { const { data } = await sb.rpc("conti_share_links", { p_service: svc.id }); links = data || []; } catch {}
    const KEY = "pole2.copy.links", prev = ls.get(KEY);
    const on = new Set(links.filter((l) => !prev || prev.includes(l.label)).map((l) => l.id));
    const box = document.createElement("div"); box.className = "modal-back cp-back";
    box.innerHTML = `<div class="modal cp-modal" role="dialog" aria-label="카톡으로 복사"><div class="modal-head"><b>카톡으로 복사</b><button type="button" class="ce-x" data-cp="close" aria-label="닫기">${ICO.x}</button></div>
      ${links.length ? `<div class="field">섬김이 팀 링크 <span class="hint">· 붙일 팀만 골라요</span><div class="chips2" id="cpLinks">${links.map((l) => `<button type="button" data-cp-link="${l.id}" aria-pressed="${on.has(l.id)}">${esc(l.label)}</button>`).join("")}</div></div>`
        : `<p class="small muted" style="margin:0">섬김이 팀 링크가 아직 없어요 · 리더십이 찬양 › 콘티 › 섬김이 팀 링크에서 만들어요</p>`}
      <textarea class="input cp-text" id="cpText" rows="12" readonly></textarea>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn btn-ghost btn-sm" data-cp="close">닫기</button><button type="button" class="btn btn-primary btn-sm" data-cp="copy">복사</button></div></div>`;
    document.body.appendChild(box);
    const draw = () => { box.querySelector("#cpText").value = contiText(svc, links.filter((l) => on.has(l.id))); };
    draw();
    box.addEventListener("click", async (e) => {
      if (e.target === box || e.target.closest("[data-cp=close]")) return box.remove();
      const l = e.target.closest("[data-cp-link]");
      if (l) { const id = +l.dataset.cpLink; on.has(id) ? on.delete(id) : on.add(id); l.setAttribute("aria-pressed", String(on.has(id))); ls.set(KEY, links.filter((x) => on.has(x.id)).map((x) => x.label)); return draw(); }
      if (e.target.closest("[data-cp=copy]")) { const ok = await copyText(box.querySelector("#cpText").value); toast(ok ? "콘티 문구를 복사했어요 · 카톡에 붙여 넣으세요" : "복사하지 못했어요 · 글을 길게 눌러 복사해 주세요", 3000); if (ok) box.remove(); }
    });
  }
  //  점을 누르면 깜빡임만 → 깜빡임 + 소리 → 끄기. 첫 박은 높은 소리(1/4은 모든 박이 같은 소리). Web Audio로 박을 미리 예약해서 정확하게
  //  026: 박 쪼개기 — 4분(그대로) · 8분 · 16분. 원래 박은 큰 소리, 쪼갠 박은 작은 소리. 사람마다 (이 기기에 저장)
  const SUBS = [1, 2, 4];
  const SUB_LABEL = { 1: "♩", 2: "♪♪", 4: "♬♬" };
  const SUB_NAME = { 1: "쪼개기 없음", 2: "8분음표로 쪼개기", 4: "16분음표로 쪼개기" };
  const METRO = (() => {
    const st = Object.assign({ mode: 0, vol: 0.6, sub: 1 }, ls.get("pole2.metro") || {});
    if (![0, 1, 2].includes(st.mode)) st.mode = 0;
    if (!SUBS.includes(st.sub)) st.sub = 1;
    st.mode = 0;   // 열 때마다 꺼진 상태로 시작
    let ctx = null, gain = null, timer = 0, raf = 0, bpm = 0, beats = 4, flat = false, t0 = 0, aT0 = 0, nextTick = 0, lastN = -1, clicks = 0, subClicks = 0;
    // 027: 함께 맞추기 — anchor = 첫 박 시각(performance.now 기준). 함께일 때는 쪽을 넘겨도 내 BPM으로 바뀌지 않음
    let anchor = null, sync = null, own = { b: 0, meter: "4/4" }, beatsSeen = [];
    const els = new Set();
    const save = () => ls.set("pole2.metro", { vol: st.vol, sub: st.sub });
    const MODE = ["메트로놈 꺼짐", "깜빡임", "깜빡임 + 소리"];
    function paint() {
      els.forEach((el) => { if (!document.body.contains(el)) return els.delete(el);
        el.className = `cvv-dot m${st.mode}${sync ? " sync" : ""}`; el.setAttribute("aria-label", `메트로놈${sync ? "(함께)" : ""}: ${MODE[st.mode]}`); el.title = MODE[st.mode];
        const box = el.parentElement;
        const v = box?.querySelector(".cvv-vol"); if (v) { v.classList.toggle("hidden", st.mode !== 2); v.value = String(Math.round(st.vol * 100)); }
        const s = box?.querySelector(".cvv-sub"); if (s) { s.classList.toggle("hidden", st.mode !== 2); s.textContent = SUB_LABEL[st.sub]; s.setAttribute("aria-label", `박 쪼개기: ${SUB_NAME[st.sub]}`); s.title = SUB_NAME[st.sub]; s.setAttribute("aria-pressed", String(st.sub > 1)); } });
    }
    function flash(acc) { els.forEach((el) => { el.classList.add("on"); el.classList.toggle("acc", acc); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on", "acc"), Math.min(120, 30000 / bpm)); }); }
    function audio() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
        try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}   // 아이폰 무음 모드에서도 (지원하는 기기만)
        ctx = new AC(); gain = ctx.createGain(); gain.gain.value = st.vol; gain.connect(ctx.destination);
      }
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      return ctx;
    }
    // k = 쪼갠 박 번호. 원래 박(k % sub = 0)은 큰 소리, 쪼갠 박은 낮고 작은 소리
    function click(t, k, sub) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      const main = k % sub === 0, i = Math.floor(k / sub) % beats;
      const peak = main ? 1 : 0.32;
      o.frequency.value = !main ? 800 : flat ? 1000 : i === 0 ? 1760 : beats === 6 && i === 3 ? 1320 : 1000;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + (main ? 0.06 : 0.035));
      o.connect(g); g.connect(gain); o.start(t); o.stop(t + 0.08);
      if (main) clicks++; else subClicks++;
    }
    function stop() { clearInterval(timer); cancelAnimationFrame(raf); timer = 0; raf = 0; lastN = -1; }
    function use(b, meter, anc) { const nb = +b || 0, nm = beatsOf(meter), nf = meter === "1/4"; if (nb === bpm && nm === beats && nf === flat && anc === anchor) return false; bpm = nb; beats = nm; flat = nf; anchor = anc; return true; }
    function start() {
      stop();
      if (!st.mode || !bpm) return paint();
      const per = 60 / bpm;
      if (st.mode === 2 && audio()) {
        const sub = st.sub, step = per / sub;
        if (anchor != null) {   // 함께: 정해진 첫 박에 맞춰 이어서 (지나간 박은 건너뜀)
          aT0 = ctx.currentTime + (anchor - performance.now()) / 1000; t0 = anchor;
          nextTick = Math.max(0, Math.ceil((ctx.currentTime + 0.05 - aT0) / step));
        } else { aT0 = ctx.currentTime + 0.08; t0 = performance.now() + 80; nextTick = 0; }
        const sched = () => { while (aT0 + nextTick * step < ctx.currentTime + 0.15) { click(aT0 + nextTick * step, nextTick, sub); nextTick++; } };
        sched(); timer = setInterval(sched, 25);
      } else t0 = anchor ?? performance.now();
      const loop = () => {
        const n = Math.floor((performance.now() - t0) / (per * 1000));
        if (n >= 0 && n !== lastN) { lastN = n; flash(!flat && n % beats === 0); if (sync) { beatsSeen.push(performance.now()); if (beatsSeen.length > 8) beatsSeen.shift(); } }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop); paint();
    }
    return {
      bind(el) { els.add(el); paint(); },
      set(b, meter) { own = { b, meter }; if (!sync && use(b, meter, null)) start(); },
      // 027: x = { bpm, meter, anchor, by } · null이면 함께 끝 (내 메트로놈은 꺼진 채로)
      follow(x) {
        const was = !!sync; sync = x || null;
        if (sync) { const ch = use(x.bpm, x.meter, x.anchor); if (!was && !st.mode) st.mode = 1; if (ch || !was) { beatsSeen = []; start(); } }
        else if (was) { st.mode = 0; use(own.b, own.meter, null); start(); }
        paint();
      },
      cycle() { st.mode = (st.mode + 1) % 3; if (st.mode === 2) audio(); save(); start(); return st.mode; },
      cycleSub() { st.sub = SUBS[(SUBS.indexOf(st.sub) + 1) % SUBS.length]; save(); start(); return st.sub; },
      volume(v) { st.vol = Math.max(0, Math.min(1, v)); if (gain) gain.gain.value = st.vol; save(); },
      off() { st.mode = 0; stop(); paint(); },
      get state() { return { mode: st.mode, bpm, beats, flat, sub: st.sub, running: !!raf, audio: ctx ? ctx.state : null, clicks, subClicks, vol: st.vol,
        sync: !!sync, anchor, by: sync?.by || null, beatsSeen: beatsSeen.slice(), lastN }; },
    };
  })();
  // =================================================================== 027: 메트로놈 함께 맞추기 (예배마다 metro_live 한 줄)
  //  인도자 · 밴드 마스터 · 드럼이 '함께'를 켜면 그 예배 라인업 기기가 같은 BPM · 박자 · 첫 박으로 깜빡여요 (소리는 각자 켬)
  //  서버 시계와 이 기기 시계의 차이를 재서(가장 빨리 돌아온 응답 기준) 첫 박 시각을 이 기기 시계로 바꿔요
  //  켠 사람이 다른 곡으로 넘기면 그 곡 BPM을 따라가요 (다른 사람이 넘기는 건 영향 없음). Realtime이 없으면 몇 초마다 확인
  function metroSync(svc, onChange) {
    const M = { row: null, on: false, can: !!svc?.can_metro, me: null, off: null, rtt: null, ch: null, timer: 0, dead: false, inLineup: false, pend: 0, last: "" };
    if (!svc?.id) return null;
    const fresh = (r) => !!r?.on_ && r.bpm && (M.off == null || Date.now() + M.off - Date.parse(r.updated_at) < 3 * 3600e3);
    async function clock() {
      let best = null;
      for (let i = 0; i < 4; i++) {
        const a = Date.now(), { data, error } = await sb.rpc("metro_now"), b = Date.now();
        if (error || data == null) continue;
        const rtt = b - a, off = Number(data) - (a + b) / 2;
        if (!best || rtt < best.rtt) best = { rtt, off };
      }
      if (best) { M.off = best.off; M.rtt = best.rtt; }
      return !!best;
    }
    const perfOf = (serverMs) => serverMs - M.off - Date.now() + performance.now();
    async function apply(r) {
      if (M.dead) return;
      M.row = r || null;
      const on = fresh(r) && (M.inLineup || M.can);
      if (on && M.off == null && !(await clock())) return;
      const sig = on ? `${r.seq}:${r.bpm}:${r.meter}:${r.t0}` : "off";
      M.on = on;
      if (sig !== M.last) { M.last = sig; METRO.follow(on ? { bpm: r.bpm, meter: r.meter, anchor: perfOf(Number(r.t0)), by: r.by_name } : null); }
      onChange?.();
    }
    async function fetchRow() {
      if (M.dead || M.pend) return;
      const { data, error } = await sb.from("metro_live").select("*").eq("service_id", svc.id).maybeSingle();
      if (!error) await apply(data);
    }
    (async () => {
      const { data: { session } } = await sb.auth.getSession();
      M.me = session?.user?.id || null;
      M.inLineup = (svc.lineup || []).some((x) => x.member_id && x.member_id === M.me);
      if (!M.inLineup && !M.can) return;
      await fetchRow();
      M.timer = setInterval(() => { if (!document.hidden) fetchRow(); }, 4000);
      try { M.ch = sb.channel(`metro-${svc.id}`).on("postgres_changes", { event: "*", schema: "public", table: "metro_live", filter: `service_id=eq.${svc.id}` }, () => fetchRow()).subscribe(); } catch { M.ch = null; }
    })();
    async function set(p) {
      M.pend++;
      try {
        if (M.off == null) await clock();
        const { data, error } = await sb.rpc("metro_set", { p_service: svc.id, p });
        if (error) throw new Error(error.message || "메트로놈을 맞추지 못했어요");
        await apply({ on_: data.on, bpm: data.bpm, meter: data.meter, t0: data.t0, ord: data.ord, title: data.title, by_id: data.by_id, by_name: data.by_name, seq: data.seq, updated_at: data.updated_at });
        return data;
      } finally { M.pend--; }
    }
    let followT = 0;
    return {
      get on() { return M.on; }, get row() { return M.row; }, get can() { return M.can; }, get driving() { return M.on && M.row?.by_id === M.me; },
      get state() { return { on: M.on, can: M.can, inLineup: M.inLineup, off: M.off, rtt: M.rtt, row: M.row, driving: M.on && M.row?.by_id === M.me }; },
      start: (x) => set({ on: true, bpm: x.bpm, meter: x.meter || "4/4", ord: x.ord ?? null, title: x.title || null }),
      stop: () => set({ on: false }),
      // 켠 사람이 다른 곡으로 넘기면 그 곡 BPM으로 (0.4초 머물면)
      follow(x) {
        clearTimeout(followT);
        if (!this.driving || !x?.song || !x.bpm) return;
        if (x.bpm === M.row.bpm && (x.meter || "4/4") === M.row.meter && (x.ord ?? null) === (M.row.ord ?? null)) return;
        followT = setTimeout(() => set({ on: true, bpm: x.bpm, meter: x.meter || "4/4", ord: x.ord ?? null, title: x.title || null }).catch(() => {}), 400);
      },
      destroy() { M.dead = true; clearInterval(M.timer); clearTimeout(followT); try { M.ch && sb.removeChannel(M.ch); } catch {} if (M.on) METRO.follow(null); },
    };
  }
  // 악보 보는 동안 화면이 꺼지지 않게 (지원하는 기기만)
  const WAKE = { lock: null, want: false };
  async function wake(on) {
    WAKE.want = on;
    try {
      if (on && !WAKE.lock && navigator.wakeLock && document.visibilityState === "visible") { WAKE.lock = await navigator.wakeLock.request("screen"); WAKE.lock.addEventListener?.("release", () => { WAKE.lock = null; }); }
      if (!on && WAKE.lock) { const l = WAKE.lock; WAKE.lock = null; await l.release(); }
    } catch { WAKE.lock = null; }
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && WAKE.want) wake(true); });
  // BPM 고치기 작은 창 (콘티 곡 보기 · 악보 보기)
  function bpmPop(anchor, cur, onSave) {
    document.querySelector(".bpm-pop")?.remove();
    const el = document.createElement("div"); el.className = "bpm-pop"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "BPM 고치기");
    let meter = cur.meter || "4/4";
    el.innerHTML = `<b>BPM · 박자</b><div class="row"><input class="input" id="bpmIn" inputmode="numeric" maxlength="3" value="${cur.bpm || ""}" placeholder="예: 72" aria-label="BPM">
      <span class="chips2" id="bpmMeter">${METERS.map((m) => `<button type="button" data-m="${m}" aria-pressed="${m === meter}">${m}</button>`).join("")}</span></div>
      <span class="small muted">팀 기준으로 저장돼요 · 다음에 이 곡을 넣으면 자동으로 채워져요 · 알림 없음</span>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn btn-ghost btn-sm" data-bp="cancel">취소</button><button type="button" class="btn btn-primary btn-sm" data-bp="save">저장</button></div>`;
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect(), w = Math.min(320, window.innerWidth - 24);
    Object.assign(el.style, { width: `${w}px`, left: `${Math.max(12, Math.min(window.innerWidth - w - 12, r.left))}px`, top: `${Math.min(window.innerHeight - 200, r.bottom + 6)}px` });
    const inp = el.querySelector("#bpmIn"); setTimeout(() => { inp.focus(); inp.select(); }, 0);
    const close = () => { el.remove(); document.removeEventListener("pointerdown", outside, true); };
    const outside = (e) => { if (!el.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
    const go = async () => {
      const v = inp.value.trim(), n = v ? +v : null;
      if (v && !(Number.isInteger(n) && n >= 20 && n <= 320)) return toast("BPM은 20~320 사이 숫자로 적어 주세요");
      const btn = el.querySelector("[data-bp=save]"); btn.disabled = true;
      try { await onSave(n, meter); close(); } catch (err) { toast(err.message || "저장하지 못했어요", 4000); btn.disabled = false; }
    };
    el.addEventListener("click", (e) => {
      const m = e.target.closest("[data-m]"); if (m) { meter = m.dataset.m; el.querySelectorAll("[data-m]").forEach((b) => b.setAttribute("aria-pressed", String(b === m))); return; }
      const b = e.target.closest("[data-bp]"); if (!b) return;
      if (b.dataset.bp === "cancel") return close();
      go();
    });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } if (e.key === "Escape") close(); });
    return el;
  }
  async function saveBpm(svc, ord, bpm, meter) {
    const { data, error } = await sb.rpc("set_bpm", { p_service: svc.id, p_ord: ord, p_bpm: bpm, p_meter: meter });
    if (error) throw new Error(error.message || "BPM을 저장하지 못했어요");
    const it = svc.setlist?.items?.find((x) => x.ord === ord); if (it) { it.bpm = data.bpm; it.meter = data.meter; if (data.bpm) { it.team_bpm = data.bpm; it.team_meter = data.meter; } }
    return data;
  }

  // ------------------------------------------------------------------ 악보 파일 (기기에 저장)
  const CACHE = "pole2-sheets-v1";
  const ckey = (path) => new Request(`${location.origin}/__sheets/${path}`);
  const docs = new Map();
  // 025: 필기본(새 악보)은 원래 파일을 함께 써요 — 'sheets/…/uuid.pdf#구분자'
  const fileOf = (path) => String(path || "").split("#")[0];
  async function sheetBytes(path) {
    path = fileOf(path);
    try { const c = await caches.open(CACHE); const hit = await c.match(ckey(path)); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch {}
    const { data, error } = await sb.storage.from("sheets").download(path);
    if (error || !data) throw new Error("악보 파일을 받지 못했어요. 인터넷 연결을 확인해 주세요.");
    const buf = new Uint8Array(await data.arrayBuffer());
    try { const c = await caches.open(CACHE); await c.put(ckey(path), new Response(buf, { headers: { "Content-Type": mimeOf(path) } })); } catch {}
    return buf;
  }
  // 023: 이미지 악보 (적용찬양 · 예배 진행곡 · 직접 더한 백업찬양)
  const mimeOf = (path) => ({ jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[String(path).split(".").pop()] || "application/pdf");
  const isImg = (path) => /\.(jpg|png|webp)$/.test(path || "");
  const imgs = new Map();
  async function sheetImage(path) {
    if (!imgs.has(path)) imgs.set(path, (async () => {
      const bytes = await sheetBytes(path);
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeOf(path) }));
      return await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error("악보 그림을 열지 못했어요")); im.src = url; });
    })().catch((e) => { imgs.delete(path); throw e; }));
    return imgs.get(path);
  }
  // 사진 · 스캔을 올리기 전에 줄임 (긴 변 2000px · JPEG)
  async function compressImage(file, max = 2000) {
    const url = URL.createObjectURL(file);
    try {
      const im = await new Promise((ok, no) => { const x = new Image(); x.onload = () => ok(x); x.onerror = () => no(new Error("그림 파일을 읽지 못했어요")); x.src = url; });
      const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
      const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.84));
      return { bytes: new Uint8Array(await blob.arrayBuffer()), thumb: (() => { const t = document.createElement("canvas"), tk = 120 / c.width; t.width = 120; t.height = Math.round(c.height * tk); t.getContext("2d").drawImage(c, 0, 0, t.width, t.height); return t.toDataURL("image/jpeg", 0.6); })() };
    } finally { URL.revokeObjectURL(url); }
  }
  // 그림 여러 장 올리기 → 경로 목록 (prefix 예: 'applied/예배id/')
  async function uploadImages(files, prefix, onStep) {
    const out = [];
    for (let i = 0; i < files.length; i++) {
      onStep?.(i + 1, files.length);
      const { bytes } = await compressImage(files[i]);
      const path = `${prefix}${uuid()}.jpg`;
      const { error } = await sb.storage.from("sheets").upload(path, bytes, { contentType: "image/jpeg", upsert: false });
      if (error) throw new Error("그림을 올리지 못했어요. 인터넷 연결을 확인해 주세요.");
      try { const c = await caches.open(CACHE); await c.put(ckey(path), new Response(bytes, { headers: { "Content-Type": "image/jpeg" } })); } catch {}
      out.push(path);
    }
    return out;
  }
  async function sheetDoc(path) {
    path = fileOf(path);
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
  // 026: 메들리 첫 곡은 메들리 악보 (뒤 곡은 그 곡 악보)
  const sheetsOf = (E, x) => E.sheets[x.medley_id && !x.join ? "m" + x.medley_id : x.song_id] || [];
  const unknownN = (items) => items.filter((x) => !x.duration_sec && x.duration_src !== "medley").length;

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
    const editBtn = f.can_edit ? `<button type="button" class="btn ${pub ? "btn-ghost" : "btn-primary"} btn-sm" data-cv-edit="${f.id}">${pub ? "콘티 고치기" : sl ? "이어서 쓰기" : "콘티 쓰기"}</button>`
      : pub && f.can_edit_sheets ? `<button type="button" class="btn btn-ghost btn-sm" data-cv-edit="${f.id}">악보 고치기</button>` : "";
    // 023: 악보만 바뀐 때 (알림 없이) — 마지막 '수정됨'보다 나중이면 보여 줌
    const shChg = pub && sl.sheet_changes && (!sl.changes?.at || sl.sheet_changes.at > sl.changes.at) ? sl.sheet_changes : null;
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
      ${editBtn ? `<div class="cv-editrow">${editBtn}${f.can_edit && !pub && sl ? `<span class="small muted">임시 저장은 팀원에게 안 보여요</span>` : !f.can_edit && f.can_edit_sheets ? `<span class="small muted">이 예배 밴드는 악보를 고칠 수 있어요 · 곡 · 키 · 순서는 인도자가</span>` : ""}</div>` : ""}
      ${pub || (f.can_edit && items.length) ? `<section class="card"><div class="card-title cv-ct">곡 순서 <span class="cv-chips">${changed ? `<span class="chip chip-mid" title="${esc(changed.text.join(" · "))}">수정됨 · ${esc(changed.text.slice(0, 2).join(" · "))}${changed.text.length > 2 ? " 외" : ""}</span>` : !pub ? `<span class="chip chip-gray">임시 저장</span>` : ""}${shChg ? `<span class="chip chip-violet" title="${esc(fmtDateTime(shChg.at))}${shChg.by ? " · " + esc(shChg.by) : ""}">악보 바뀜 · ${esc(fmtDateTime(shChg.at))}</span>` : ""}</span></div>
        <div class="cv-slist">${items.map((x, i) => { const gi = groupInfo(items, i); return `<div class="cv-srow ${gi.join ? "join" : ""}">
          <span class="cv-sn">${gi.join ? "+" : gi.n}</span>
          <button type="button" class="cv-st" data-cv-song="${x.song_id}"><b>${esc(x.title)}</b>
            <small>${gi.join ? `앞 곡에 이어서${gi.medley ? "" : ""}` : `${x.sheet_pages ? `${x.sheet_pages}쪽` : "악보 없음"}${x.duration_sec ? ` · ${mmss(x.duration_sec)}` : ""}${gi.head ? ` · 메들리${x.medley_title ? ` '${esc(x.medley_title)}'` : ""}` : ""}`}</small></button>
          ${!gi.join && x.refs?.[0]?.[0] ? `<a class="cv-yt" href="${ytLink(x.refs[0][0], x.refs[0][1])}" target="_blank" rel="noopener" aria-label="${esc(x.title)} 레퍼런스">${ICO.play}레퍼런스</a>` : "<span></span>"}
          ${x.bpm || (pub && f.can_edit_sheets) ? `<button type="button" class="cv-bpm ${x.bpm ? "" : "none"}" data-cv-bpm="${x.ord}" ${pub && f.can_edit_sheets ? "" : "disabled"} aria-label="${esc(x.title)} BPM${x.bpm ? " " + x.bpm : " 입력"}">${x.bpm ? esc(bpmText(x.bpm, x.meter)) : "BPM"}</button>` : "<span></span>"}
          <span class="cv-key ${keySongs.has(x.song_id) ? "chg" : ""}" ${x.diff_key ? `title="음원과 키가 달라요"` : ""}>${esc(keyText(x))}</span>
          ${x.memo ? `<span class="cv-memo">${esc(x.memo)}</span>` : ""}</div>`; }).join("") || `<p class="muted small" style="margin:0">곡이 아직 없어요.</p>`}</div>
        ${items.some((x) => x.diff_key) ? `<p class="small muted cv-dk">* 음원(레퍼런스)과 키가 달라요</p>` : ""}
        ${f.can_edit && items.length ? `<div class="cv-copyrow"><button type="button" class="btn btn-soft btn-sm" data-cv-copy>카톡으로 복사</button><span class="small muted">찬양팀 방에 붙여 넣는 콘티 문구 · 섬김이 팀 링크를 골라 붙일 수 있어요</span></div>` : ""}</section>` : ""}
      ${appliedCard(f)}
      ${procCard(f)}
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
      const at = e.target.closest("[data-cv-at]"); if (at) return openViewer(f, { at: at.dataset.cvAt });
      if (e.target.closest("[data-cv-applied]")) return openApplied(f, { after: () => mountWeek(root, { me }) });
      if (e.target.closest("[data-cv-copy]")) return copyPop(f);
      // 025: BPM · 박자 (인도자 · 밴드 마스터 · 리더십 · 그 예배 밴드)
      const bp = e.target.closest("[data-cv-bpm]");
      if (bp && !bp.disabled) { const it = items.find((x) => x.ord === +bp.dataset.cvBpm); return bpmPop(bp, it, async (b, m) => { await saveBpm(f, it.ord, b, m); toast(b ? `${it.title} ${bpmText(b, m)} · 팀 기준으로 저장했어요` : "BPM을 지웠어요"); mountWeek(root, { me }); }); }
    };
  }
  // 023: 적용찬양 카드 (콘티와 백업 사이) — 리더십 · 콘티를 고칠 수 있는 사람이 그림으로 올림
  function appliedCard(f) {
    const list = f.applied || [];
    if (!list.length && !f.can_applied) return "";
    const ed = list.length && f.applied_meta?.edited_at ? f.applied_meta : null;
    return `<section class="card"><div class="card-title cv-ct">적용찬양 <small>${list.length ? `${list.length}곡` : "아직 없어요"}</small>${ed ? `<span class="chip chip-mid cv-aped" title="${esc(ed.edited_by || "")}">수정됨 · ${esc(fmtDateTime(ed.edited_at))}</span>` : ""}</div>
      ${list.map((x) => `<button type="button" class="cv-prow" data-cv-at="a:${x.id}"><span class="cv-ptag">적용</span><span class="cv-st2"><b>${esc(x.title)}</b><small>${[x.key, `${x.images.length}장`, x.note].filter(Boolean).map(esc).join(" · ")}</small></span><span class="cv-go">보기</span></button>`).join("")}
      ${f.can_applied ? `<button type="button" class="btn btn-soft btn-sm" data-cv-applied style="align-self:flex-start">${list.length ? "적용찬양 고치기" : "+ 적용찬양 올리기"}</button>` : ""}</section>`;
  }
  // 023: 예배 진행곡 카드 (축복송 · 봉헌송 · 축도송 · 등단송) — 등단송은 사역(특별예배 · 수련회) 때만
  function procCard(f) {
    const list = f.proc || [];
    if (!list.length) return "";
    const special = !!f.ministry_id;
    return `<section class="card"><div class="card-title cv-ct">예배 진행곡 <small>${f.communion ? "성찬식 주일 · " : ""}RT에 넣지 않아요</small></div>
      ${PROC_ORDER.map((k) => { const x = list.find((y) => y.kind === k); if (!x) return "";
        const dim = k === "entrance" && !special;
        return `<button type="button" class="cv-prow ${dim ? "dim" : ""}" data-cv-at="p:${k}" ${dim ? "disabled" : ""}><span class="cv-ptag">${PROC[k][0]}</span><span class="cv-st2"><b>${esc(x.title)}</b><small>${dim ? "특별예배 · 수련회 때만" : [x.key, x.images?.length ? `${x.images.length}장` : x.pages ? `${x.pages}쪽` : ""].filter(Boolean).map(esc).join(" · ")}</small></span>${dim ? "" : `<span class="cv-go">보기</span>`}</button>`; }).join("")}</section>`;
  }
  function lineupHTML(lu, meId) {
    const by = {}; lu.forEach((x) => (by[x.pos] = by[x.pos] || []).push(x));
    const nm = (x) => `<span class="${x.member_id === meId ? "me" : ""}">${esc(x.name)}${x.guest ? "(G)" : ""}${x.sl || x.bm ? "*" : ""}</span>`;
    return Object.keys(POS).filter((k) => by[k]).map((k) => `<span><b>${POS[k]}</b>${by[k].map(nm).join(", ")}</span>`).join("");
  }

  // =================================================================== 악보 보기 (태블릿 세로 · 한 쪽씩)
  //  023: 콘티 곡 → 적용찬양 → 예배 진행곡(축복 · 성찬 · 봉헌 · 축도, 사역이면 등단) → '백업찬양 ›' 순서로 이어서 넘김
  //  쪽 = PDF 한 쪽({ path, p }) 또는 그림 한 장({ img })
  // 024: 성찬 찬양 1 · 2 — 성찬식 주일에만 (서버가 그 주에 맞춰 보내 줌)
  const PROC = { blessing: ["축복송", "축복"], communion: ["성찬 찬양 1", "성찬 1"], communion2: ["성찬 찬양 2", "성찬 2"], offering: ["봉헌송", "봉헌"], benediction: ["축도송", "축도"], entrance: ["등단송", "등단"] };
  const PROC_ORDER = ["blessing", "communion", "communion2", "offering", "benediction", "entrance"];
  // 024: 쪽마다 내 메모 자리(ink) — 예배 진행곡은 그 곡(id) × 쪽
  // 027: ctx = { svc, date, canEdit, canEraseAll } 가 있으면 공유 필기(악보 고치기)도 — 리더십이 그 곡을 바꿀 때까지 쌓여요
  const procPages = (x, ctx) => (x.images?.length ? x.images.map((img) => ({ img })) : x.path ? (isImg(x.path) ? [{ img: x.path }] : Array.from({ length: x.pages || 1 }, (_, k) => ({ path: x.path, p: k + 1 }))) : [])
    .map((pg, k) => (x.id ? { ...pg, ink: { key: `p:${x.id}`, page: k + 1 },
      shared: ctx?.svc ? { sheet: `p:${x.id}`, page: k + 1, date: ctx.date, svc: ctx.svc, canEdit: !!ctx.canEdit, canEraseAll: !!ctx.canEraseAll, kind: "extra", name: x.title } : null } : pg));
  function viewerItems(svc) {
    const sl = svc.setlist, pub = sl?.status === "published";
    const leader = (svc.lineup || []).find((x) => x.pos === "leader")?.name || "";
    // 026: 메들리 — 뒤 곡은 '+' 칩. 뒤 곡에 악보가 없으면(합친 악보) 앞 칩 이름에 이어 붙임
    const src0 = pub || svc.can_edit ? sl?.items || [] : [];
    const out = src0.map((x, i) => ({ id: `c:${i}`, tag: groupInfo(src0, i).join ? "+" : String(groupInfo(src0, i).n), join: groupInfo(src0, i).join, title: x.title, key: keyText(x) === "–" ? "" : keyText(x), ord: x.ord ?? i + 1, bpm: x.bpm, meter: x.meter, song: true,
      src: x.sheet_path ? Array.from({ length: x.sheet_pages || 1 }, (_, k) => ({ path: x.sheet_path, p: k + 1,
        // 내 메모: 원래 악보 기준 (필기본이 새로 생겨도 이어서 보여요)
        ink: x.sheet_id ? { key: `s:${x.sheet_base || x.sheet_id}`, page: k + 1, song: x.song_id } : null,
        // 025: 공유 필기 — 그 예배 날짜 기준
        shared: x.sheet_id ? { sheet: x.sheet_id, page: k + 1, date: svc.date, svc: svc.id, canEdit: !!svc.can_edit_sheets && pub, canEraseAll: !!svc.can_edit,
          kind: x.sheet_kind, name: x.sheet_name, defName: `${leader || "인도자"} ${x.key || ""}`.trim() } : null })) : [] }));
    for (let k = out.length - 1; k > 0; k--) if (out[k].join && !out[k].src.length && out[k - 1].song) {
      out[k - 1].title += ` + ${out[k].title}`; if (out[k].key) out[k - 1].key = [out[k - 1].key, out[k].key].filter(Boolean).join(" / "); out.splice(k, 1);
    }
    // 027: 적용찬양 · 예배 진행곡도 악보 고치기 (권한 · 지우기는 콘티와 같아요) — 적용찬양은 그 예배 사진에만
    const ctx = { svc: svc.id, date: svc.date, canEdit: !!svc.can_edit_sheets, canEraseAll: !!svc.can_edit };
    (svc.applied || []).forEach((x) => out.push({ id: `a:${x.id}`, tag: "적용", kind: "applied", title: x.title, key: x.key,
      src: (x.images || []).map((img, k) => ({ img, ink: { key: `a:${x.id}`, page: k + 1, anorm: x.norm || null },
        shared: { sheet: `a:${x.id}`, page: k + 1, date: svc.date, svc: svc.id, canEdit: ctx.canEdit, canEraseAll: ctx.canEraseAll, kind: "extra", name: x.title, anorm: x.norm || null } })) }));
    const special = !!svc.ministry_id;
    (svc.proc || []).filter((x) => x.kind !== "entrance" || special).sort((a, b) => PROC_ORDER.indexOf(a.kind) - PROC_ORDER.indexOf(b.kind))
      .forEach((x) => out.push({ id: `p:${x.kind}`, tag: PROC[x.kind][1], kind: "proc", title: x.title, key: x.key, src: procPages(x, ctx) }));
    return out;
  }
  async function openViewer(svc, { song = 0, at = null, single = null, items: given = null, title: givenTitle = null } = {}) {
    // single: { title, path, pages } — 곡 상세에서 악보 하나만 볼 때 · items: 이미 만든 목록(백업찬양 등)
    const items = given || (single ? [{ title: single.title, key: single.key, src: single.images ? single.images.map((img) => ({ img })) : Array.from({ length: single.pages || 1 }, (_, k) => ({ path: single.path, p: k + 1, ink: single.ink ? { ...single.ink, page: k + 1 } : null, shared: single.shared ? { ...single.shared, page: k + 1 } : null })) }] : viewerItems(svc));
    const pages = [];
    items.forEach((x, i) => {
      if (x.src?.length) x.src.forEach((pg, k) => pages.push({ i, ...pg, n: k + 1, of: x.src.length }));
      else pages.push({ i, path: null, n: 1, of: 1 });
    });
    // 025: 새 악보로 저장 (필기본) — 이 콘티 곡의 악보를 바꾸고, 그 곡의 모든 쪽이 새 악보를 따라감
    const forkItem = async (i, name) => {
      const x = items[i];
      const { data, error } = await sb.rpc("sheet_fork", { p_service: svc.id, p_ord: x.ord, p_name: name });
      if (error) throw new Error(error.message || "새 악보를 만들지 못했어요");
      pages.filter((p) => p.i === i && p.shared).forEach((p) => Object.assign(p.shared, { sheet: data.sheet_id, kind: "sheet", name }));
      const it = svc.setlist?.items?.find((y) => (y.ord ?? 0) === x.ord); if (it) Object.assign(it, { sheet_id: data.sheet_id, sheet_kind: "sheet", sheet_name: name });
      if (svc.setlist) svc.setlist.version = data.version;
      return data.sheet_id;
    };
    pages.forEach((p) => { if (p.shared) p.shared.fork = (name) => forkItem(p.i, name); });
    const title = givenTitle || (single ? single.title : `${md(svc.date)} ${svc.ministry_id ? svc.ministry_name || "사역" : "주일"} · 악보`);
    const contiItems = single || given ? [] : (svc.setlist?.items || []);
    const rt = rtOf(contiItems);
    const backupLink = !single && !given && typeof CONTI.onBackup === "function";
    const hasBpm = !single && !given;
    const first = at ? Math.max(0, items.findIndex((x) => x.id === at)) : song;
    const V = { cur: Math.max(0, pages.findIndex((x) => x.i === first)), token: 0 };
    const el = openLayer("cv-viewer", `<div class="cvv-top"><button type="button" class="cvv-back" data-cvv="close" aria-label="닫기">${ICO.back}</button>
        <b class="cvv-title">${esc(title)}</b>${contiItems.length && svc.target_sec ? `<span class="cvv-rt">RT ${mmss(rt)} / ${mmss(svc.target_sec)}</span>` : ""}<span class="cvv-pg" id="cvvPg"></span>${window.INK ? `<button type="button" class="cvv-pen cvv-hide hidden" data-iv="hide"></button><button type="button" class="cvv-pen cvv-fix hidden" data-iv="fix"></button><button type="button" class="cvv-pen" data-iv="pen"></button>` : ""}</div>
      <div class="cvv-strip">${hasBpm ? `<span class="cvv-bpmbox" id="cvvBpm"></span>` : ""}<div class="cvv-jump" role="tablist">${single ? "" : items.map((x, i) => `<button type="button" data-cvv-song="${i}" class="${x.kind || ""}"><i>${esc(x.tag || String(i + 1))}</i>${esc(x.title)}${x.key ? ` · ${esc(x.key)}` : ""}</button>`).join("")}${backupLink ? `<button type="button" class="go" data-cvv="backup">백업찬양 ›</button>` : ""}</div></div>
      <div class="iv-host hidden" id="cvvInk"></div>
      <div class="cvv-stage" id="cvvStage"><canvas id="cvvCanvas" aria-label="악보"></canvas><div class="cvv-blank hidden" id="cvvBlank"></div>
        <button type="button" class="cvv-tap l" data-cvv="prev" aria-label="이전 쪽"><span>‹ 이전</span></button><button type="button" class="cvv-tap r" data-cvv="next" aria-label="다음 쪽"><span>다음 ›</span></button>
        <div class="cvv-load" id="cvvLoad">불러오는 중…</div></div>
      <div class="cvv-foot"><span class="cvv-dots" id="cvvDots"></span><span id="cvvNext"></span></div>`, () => { document.removeEventListener("keydown", onKey); V.ink?.destroy(); V.ms?.destroy(); METRO.off(); wake(false); document.querySelector(".bpm-pop")?.remove(); });
    wake(true);
    // 024: 내 메모 · 확대 (INK) — 밀어서 넘기기 · 크기 맞춤도 여기서
    if (window.INK) {
      V.ink = INK.view({ stage: $("#cvvStage", el), canvas: $("#cvvCanvas", el), root: el, bar: $("#cvvInk", el), onTurn: (d) => V.go?.(V.cur + d) });
      V.ink.prefetch(pages.map((p) => p.ink?.key));
    }
    // 025: BPM (곡 칩 옆) · 메트로놈 점
    const canBpm = hasBpm && !!svc?.can_edit_sheets && svc?.setlist?.status === "published";
    // 027: 메트로놈 함께 맞추기 — 함께 켜져 있으면 적용찬양 · 예배 진행곡 쪽에서도 깜빡임은 계속
    V.ms = hasBpm ? metroSync(svc, () => drawBpm()) : null;
    const drawBpm = () => {
      const box = $("#cvvBpm", el); if (!box) return;
      const x = items[pages[V.cur]?.i], ms = V.ms, sync = !!ms?.on, r = ms?.row;
      if (!x?.song && !sync) { box.innerHTML = ""; box.classList.add("hidden"); METRO.set(0); return; }
      box.classList.remove("hidden");
      const own = x?.song ? x : null;
      const dotHTML = `<button type="button" class="cvv-dot" data-cvv="metro"></button><button type="button" class="cvv-sub hidden" data-cvv="sub"></button><input type="range" class="cvv-vol hidden" min="0" max="100" aria-label="메트로놈 음량">`;
      const bpmHTML = own?.bpm ? `<button type="button" class="cvv-bpm" data-cvv="bpm" ${canBpm ? "" : "disabled"} aria-label="BPM ${own.bpm}${canBpm ? " 고치기" : ""}"><b>♩=${own.bpm}</b>${own.meter && own.meter !== "4/4" ? `<small>${esc(own.meter)}</small>` : ""}</button>`
        : own && canBpm ? `<button type="button" class="cvv-bpm none" data-cvv="bpm">BPM 입력</button>` : "";
      const syncHTML = sync
        ? (ms.can ? `<button type="button" class="cvv-sync on" data-cvv="sync" aria-pressed="true" title="함께 맞추기 끄기">${ICO.sync}<span>함께 ♩=${r.bpm}${r.meter !== "4/4" ? ` ${esc(r.meter)}` : ""}</span></button>`
                  : `<span class="cvv-synctag" title="${esc(r.by_name || "")}님이 켠 메트로놈">${ICO.sync}<span>함께 ♩=${r.bpm}${r.meter !== "4/4" ? ` ${esc(r.meter)}` : ""} · ${esc(r.by_name || "")}</span></span>`)
        : ms?.can && own?.bpm ? `<button type="button" class="cvv-sync" data-cvv="sync" aria-pressed="false" title="라인업 기기를 같은 박으로">${ICO.sync}<span>함께</span></button>` : "";
      box.innerHTML = `${bpmHTML}${sync || own?.bpm ? dotHTML : ""}${syncHTML}`;
      const dot = box.querySelector(".cvv-dot"); if (dot) METRO.bind(dot);
      METRO.set(own?.bpm || 0, own?.meter);
      if (sync && own) ms.follow(own);
    };
    const draw = async () => {
      const pg = pages[V.cur]; if (!pg) return;
      const t = ++V.token, x = items[pg.i];
      $("#cvvPg", el).textContent = `${V.cur + 1} / ${pages.length}쪽`;
      el.querySelectorAll("[data-cvv-song]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.cvvSong === pg.i)));
      el.querySelector(`[data-cvv-song="${pg.i}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
      drawBpm();
      const dots = pages.length <= 24 ? pages.map((_, k) => `<i class="${k === V.cur ? "cur" : k < V.cur ? "on" : ""}"></i>`).join("") : "";
      $("#cvvDots", el).innerHTML = dots;
      const nx = pages[V.cur + 1];
      $("#cvvNext", el).textContent = nx ? `다음 쪽: ${items[nx.i].title}${nx.of > 1 ? ` ${nx.n}/${nx.of}` : ""}` : backupLink ? "마지막 쪽 · 다음은 백업찬양" : "마지막 쪽이에요";
      const cv = $("#cvvCanvas", el), blank = $("#cvvBlank", el), load = $("#cvvLoad", el);
      if (!pg.path && !pg.img) { V.ink?.clear(); cv.classList.add("hidden"); blank.classList.remove("hidden"); load.classList.add("hidden"); blank.innerHTML = `<b>${esc(x.title)}</b><span>${x.key ? esc(x.key) + " · " : ""}악보가 없는 곡이에요</span>`; return; }
      blank.classList.add("hidden"); load.classList.remove("hidden");
      try {
        if (V.ink) { if (!(await V.ink.show(pg, () => t !== V.token))) return; }
        else await drawPageInto(cv, $("#cvvStage", el), pg, () => t !== V.token);
        if (t !== V.token) return;
        cv.classList.remove("hidden"); load.classList.add("hidden");
        // 다음 쪽 미리 받아 둠
        const n2 = pages[V.cur + 1]; if (n2?.path) sheetDoc(n2.path).catch(() => {}); if (n2?.img) sheetImage(n2.img).catch(() => {});
      } catch (err) { if (t === V.token) { load.textContent = err.message || "악보를 열지 못했어요"; } }
    };
    const go = (k) => { const n = Math.max(0, Math.min(pages.length - 1, k)); if (n !== V.cur) { V.cur = n; draw(); } };
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cvv]"); if (b) { const a = b.dataset.cvv; if (a === "close") return closeLayer(); if (a === "prev") return go(V.cur - 1); if (a === "next") return go(V.cur + 1);
        if (a === "backup") { closeLayer(); return setTimeout(() => CONTI.onBackup?.(), 300); }
        if (a === "sub") { const n = METRO.cycleSub(); toast(SUB_NAME[n] + (n > 1 ? " · 쪼갠 박은 작은 소리" : ""), 1600); return; }
        if (a === "metro") { const m = METRO.cycle(); toast(["메트로놈을 껐어요", "박자에 맞춰 깜빡여요", "소리도 나요 · 예배 중에는 이어폰으로 · 무음 모드면 안 들릴 수 있어요"][m] + (V.ms?.on && m === 0 ? " · 이 기기만 (함께 맞추기는 그대로)" : ""), m === 2 ? 4000 : 1800); return; }
        if (a === "sync" && V.ms?.can) {
          const x = items[pages[V.cur].i]; b.disabled = true;
          (V.ms.on ? V.ms.stop() : V.ms.start(x)).then((d) => toast(d.on ? "라인업 기기가 같은 박으로 깜빡여요 · 소리는 각자 켜요 · 내가 곡을 넘기면 그 곡 BPM으로 바뀌어요" : "함께 맞추기를 껐어요", d.on ? 4500 : 2000))
            .catch((err) => toast(err.message, 4000)).finally(() => { b.disabled = false; drawBpm(); });
          return;
        }
        if (a === "bpm" && canBpm) { const x = items[pages[V.cur].i]; return bpmPop(b, x, async (bpm, meter) => { await saveBpm(svc, x.ord, bpm, meter); x.bpm = bpm; x.meter = bpm ? meter : null; drawBpm(); toast(bpm ? `${x.title} ${bpmText(bpm, meter)} · 팀 기준으로 저장했어요` : "BPM을 지웠어요"); }); }
        return; }
      const s = e.target.closest("[data-cvv-song]"); if (s) go(pages.findIndex((p) => p.i === +s.dataset.cvvSong));
    });
    el.addEventListener("input", (e) => { if (e.target.matches(".cvv-vol")) METRO.volume(+e.target.value / 100); });
    // 밀어서 넘기기 (내 메모가 있으면 INK가 맡음)
    if (!V.ink) {
      let sx = null, sy = null;
      $("#cvvStage", el).addEventListener("pointerdown", (e) => { sx = e.clientX; sy = e.clientY; });
      $("#cvvStage", el).addEventListener("pointerup", (e) => { if (sx === null) return; const dx = e.clientX - sx, dy = e.clientY - sy; sx = null; if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(V.cur + (dx < 0 ? 1 : -1)); });
    }
    const onKey = (e) => { if (!document.body.contains(el) || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return; if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(V.cur + 1); } if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); go(V.cur - 1); } };
    document.addEventListener("keydown", onKey);
    if (!V.ink) window.addEventListener("resize", () => { if (document.body.contains(el)) draw(); });
    V.go = go; el._viewer = V;
    draw();
    return el;
  }
  // 한 쪽(PDF 쪽 또는 그림)을 무대(stage) 크기에 맞춰 캔버스에 그림
  async function drawPageInto(cv, stage, pg, stale) {
    const r = stage.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (pg.img) {
      const im = await sheetImage(pg.img);
      if (stale()) return;
      const fit = Math.min(r.width / im.naturalWidth, r.height / im.naturalHeight);
      const w = Math.max(100, Math.floor(im.naturalWidth * fit)), h = Math.max(100, Math.floor(im.naturalHeight * fit));
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height);
      cv.style.width = `${w}px`; cv.style.height = `${h}px`;
      return;
    }
    const doc = await sheetDoc(pg.path);
    if (stale()) return;
    const page = await doc.getPage(pg.p), v1 = page.getViewport({ scale: 1 });
    const fit = Math.min(r.width / v1.width, r.height / v1.height);
    const tmp = await renderPage(doc, pg.p, Math.max(200, Math.floor(v1.width * fit * dpr)));
    if (stale()) return;
    cv.width = tmp.width; cv.height = tmp.height; cv.getContext("2d").drawImage(tmp, 0, 0);
    cv.style.width = `${Math.floor(v1.width * fit)}px`; cv.style.height = `${Math.floor(v1.height * fit)}px`;
  }

  // =================================================================== 023: 적용찬양 올리기 · 고치기 (그림)
  // 025: 같은 곡 묶기 — 이름에서 띄어쓰기 · 괄호 · 문장부호를 뺀 값 (DB applied_songs.norm과 같은 규칙)
  const anorm = (t) => String(t || "").toLowerCase().replace(/[\s()[\]·.,!?'"-]/g, "");
  async function appliedNames() {
    const { data } = await sb.from("applied_songs").select("title, norm, created_at").order("created_at", { ascending: false }).limit(3000);
    const by = new Map();
    (data || []).forEach((x) => { const g = by.get(x.norm) || { title: x.title, norm: x.norm, n: 0 }; g.n++; by.set(x.norm, g); });
    return [...by.values()].sort((a, b) => b.n - a.n || a.title.localeCompare(b.title, "ko"));
  }
  async function openApplied(svcIn, { after } = {}) {
    let svc = svcIn;
    let SUG = await appliedNames().catch(() => []);
    const draw = () => {
      const list = svc.applied || [];
      body.innerHTML = `<p class="small muted" style="margin:0">교역자님께 받은 적용찬양 악보를 사진 · 그림으로 올려요. 콘티 악보 다음, 백업찬양 앞에 이어서 보여요.</p>
        <section class="card"><div class="card-title cv-ct">올린 곡 <small>${list.length}곡</small></div>
          ${list.map((x, i) => `<div class="cv-sheet" data-ap="${x.id}"><span class="cv-thumb ap" data-ap-thumb="${esc(x.images[0])}"></span>
            <span class="cv-st2"><b>${esc(x.title)}</b><small>${[x.key, `${x.images.length}장`, x.note].filter(Boolean).map(esc).join(" · ")}</small></span>
            <span class="row" style="gap:6px">${i ? `<button type="button" class="btn btn-ghost btn-sm" data-apa="up">위로</button>` : ""}<label class="btn btn-ghost btn-sm cv-upl">사진 바꾸기<input type="file" accept="image/*" multiple data-apa-img hidden></label><button type="button" class="btn btn-ghost btn-sm" data-apa="del">지우기</button></span></div>`).join("") || `<p class="muted small" style="margin:0">아직 없어요.</p>`}</section>
        <p class="small muted" style="margin:0">${svc.applied_meta?.notified_at ? "처음 올릴 때 라인업에 알렸어요 · 그 뒤로 고치면 알림 없이 '수정됨'으로 보여요" : "처음 올리면 이 예배 라인업에 알림이 가요 · 그 뒤로 고치면 알림 없이 '수정됨'으로 보여요"}</p>
        <section class="card ap-form"><div class="card-title cv-ct">곡 더하기</div>
          <label class="field">곡 이름 <span class="hint">· 전에 쓴 이름을 고르면 같은 곡으로 묶여 기록에 쌓여요</span><input class="input" id="apTitle" maxlength="80" list="apSug" autocomplete="off" placeholder="예: 주의 손에 나의 손을 포개고"></label>
          <datalist id="apSug">${SUG.map((x) => `<option value="${esc(x.title)}">${x.n}번</option>`).join("")}</datalist>
          <div class="ap-sug" id="apHint"></div>
          <div class="row" style="gap:10px;align-items:flex-end"><label class="field" style="flex:0 0 110px">키<input class="input" id="apKey" maxlength="12" placeholder="G"></label>
            <label class="field" style="flex:1">메모 <span class="hint">· 팀원에게 보여요</span><input class="input" id="apNote" maxlength="200" placeholder="예: 설교 후 · 1절만"></label></div>
          <label class="btn btn-soft btn-sm cv-upl" style="align-self:flex-start">악보 사진 고르기 (여러 장)<input type="file" accept="image/*" multiple id="apFiles" hidden></label>
          <span class="small muted" id="apPicked">고른 사진 없음 · 순서대로 이어서 보여요</span>
          <button type="button" class="btn btn-primary" id="apSave">올리기</button></section>`;
      body.querySelectorAll("[data-ap-thumb]").forEach(async (t) => { try { const im = await sheetImage(t.dataset.apThumb); t.innerHTML = ""; const c = im.cloneNode(); c.alt = ""; t.appendChild(c); } catch {} });
    };
    const el = openLayer("cv-sheetpage", `<div class="cvs-top"><button type="button" class="cvv-back light" data-ap-close aria-label="닫기">${ICO.back}</button><b>적용찬양 · ${esc(svcShort(svc))}</b></div><div class="cvs-body" id="apBody"></div>`, () => after?.());
    const body = $("#apBody", el);
    draw();
    const reload = async () => { svc = await loadOne(svc.id); draw(); };
    // 같은 곡 이름 추천
    el.addEventListener("input", (e) => {
      if (e.target.id !== "apTitle") return;
      const q = anorm(e.target.value), box = $("#apHint", el);
      if (!q) { box.innerHTML = ""; return; }
      const same = SUG.find((x) => x.norm === q);
      const near = SUG.filter((x) => x.norm !== q && (x.norm.includes(q) || q.includes(x.norm) || KO.match(x.title, e.target.value))).slice(0, 4);
      box.innerHTML = `${same ? `<span class="chip chip-ok">같은 곡으로 묶여요 · 지금까지 ${same.n}번</span>` : `<span class="chip chip-gray">처음 쓰는 이름</span>`}${near.map((x) => `<button type="button" class="pillbtn" data-ap-pick="${esc(x.title)}">${esc(x.title)} · ${x.n}번</button>`).join("")}`;
    });
    el.addEventListener("change", async (e) => {
      if (e.target.id === "apFiles") $("#apPicked", el).textContent = e.target.files.length ? `사진 ${e.target.files.length}장 · 순서대로 이어서 보여요` : "고른 사진 없음";
      // 027: 사진 바꾸기 — 그 곡에 쓴 악보 고치기 필기는 함께 지워져요
      if (e.target.matches("[data-apa-img]")) {
        const files = [...(e.target.files || [])], id = +e.target.closest("[data-ap]").dataset.ap, x = (svc.applied || []).find((y) => y.id === id);
        if (!files.length || !x) return;
        if (files.length > 12) return toast("사진은 12장까지예요");
        if (!confirm(`'${x.title}' 사진을 새로 고른 ${files.length}장으로 바꿀까요? 이 곡에 고친 필기는 함께 지워져요.`)) { e.target.value = ""; return; }
        const lb = e.target.closest("label"); lb.classList.add("disabled");
        try {
          const images = await uploadImages(files, `applied/${svc.id}/`, (n, t) => (lb.firstChild.textContent = `올리는 중 ${n}/${t}…`));
          const { error } = await sb.from("applied_songs").update({ images, updated_at: new Date().toISOString() }).eq("id", id);
          if (error) throw new Error(error.message || "바꾸지 못했어요");
          toast("사진을 바꿨어요"); await reload();
        } catch (err) { toast(err.message || "바꾸지 못했어요", 4000); lb.classList.remove("disabled"); lb.firstChild.textContent = "사진 바꾸기"; }
      }
    });
    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-ap-close]")) return closeLayer();
      const pk = e.target.closest("[data-ap-pick]"); if (pk) { const t = $("#apTitle", el); t.value = pk.dataset.apPick; t.dispatchEvent(new Event("input", { bubbles: true })); return; }
      const a = e.target.closest("[data-apa]");
      if (a) {
        const id = +a.closest("[data-ap]").dataset.ap, list = svc.applied || [], i = list.findIndex((x) => x.id === id);
        if (a.dataset.apa === "del") {
          if (!confirm(`'${list[i].title}'을 적용찬양에서 뺄까요?`)) return;
          const { error } = await sb.from("applied_songs").delete().eq("id", id);
          if (error) return toast("지우지 못했어요", 3500);
          toast("뺐어요"); return reload();
        }
        if (a.dataset.apa === "up" && i > 0) {
          const order = list.map((x) => x.id); [order[i - 1], order[i]] = [order[i], order[i - 1]];
          for (let k = 0; k < order.length; k++) await sb.from("applied_songs").update({ ord: k + 1 }).eq("id", order[k]);
          return reload();
        }
      }
      if (e.target.id === "apSave") {
        const btn = e.target, title = $("#apTitle", el).value.trim(), files = [...($("#apFiles", el).files || [])];
        if (!title) return toast("곡 이름을 적어 주세요");
        if (!files.length) return toast("악보 사진을 골라 주세요");
        if (files.length > 12) return toast("사진은 12장까지예요");
        btn.disabled = true;
        try {
          const images = await uploadImages(files, `applied/${svc.id}/`, (n, t) => (btn.textContent = `올리는 중 ${n}/${t}…`));
          const ord = Math.min(20, (svc.applied || []).reduce((m, x) => Math.max(m, x.ord), 0) + 1);
          const { error } = await sb.from("applied_songs").insert({ service_id: svc.id, ord, title, key: $("#apKey", el).value.trim() || null, note: $("#apNote", el).value.trim() || null, images });
          if (error) throw new Error(error.message || "저장하지 못했어요");
          SUG = await appliedNames().catch(() => SUG);
          // 027: 처음 올릴 때만 그 예배 라인업에 알림 (그 뒤로는 '수정됨')
          let msg = "적용찬양을 올렸어요";
          if (!svc.applied_meta?.notified_at && !svc.past) {
            try { const r = await meApi("/api/conti", { action: "applied-notify", service_id: svc.id }); if (!r.skipped) msg += ` · ${r.recipients}명에게 알렸어요`; } catch { msg += " · 알림은 보내지 못했어요"; }
          }
          toast(msg, 3500); await reload();
        } catch (err) { toast(err.message || "올리지 못했어요", 4000); btn.disabled = false; btn.textContent = "올리기"; }
      }
    });
    return el;
  }

  // =================================================================== 곡 상세 (원본 악보 · 저장된 악보 · 레퍼런스 · 부른 기록)
  async function songDetail(songId) {
    const [{ data: song }, { data: sheets }, H, up] = await Promise.all([
      sb.from("songs").select("id, title, main_key, memo, team_sec, team_bpm, team_meter").eq("id", songId).maybeSingle(),
      sb.rpc("song_sheets", { p_songs: [songId] }),
      HISTORY.load().catch(() => null), canUpload().catch(() => false),
    ]);
    if (!song) return toast("곡을 찾을 수 없어요");
    const st = H?.songs.find((x) => x.id === songId);
    const inMd = ((await sb.rpc("medley_list")).data || []).filter((m) => m.songs.some((x) => x.song_id === songId));
    const orig = (sheets || []).filter((x) => x.kind === "original"), saved = (sheets || []).filter((x) => x.kind === "sheet");
    const log = H ? H.plays.filter((p) => p[2] === songId).sort((a, b) => b[0].localeCompare(a[0])) : [];
    const sheetRow = (x) => `<div class="cv-sheet"><span class="cv-thumb ${x.thumb ? "" : "none"}">${x.thumb ? `<img src="${x.thumb}" alt="">` : ""}</span>
        <span class="cv-st2"><b>${esc(x.name)}</b><small>${x.kind === "original" ? `${x.key ? esc(x.key) + " · " : ""}필기 없음 · ${x.pages}쪽${x.by ? ` · ${esc(x.by)} 올림` : ""}` : `${x.from_date ? md(x.from_date) + " · " : ""}${x.pages}쪽 · ${x.used}번 씀${x.ink ? ` · 필기 ${x.ink}` : ""}${x.base_id ? " · 필기본" : ""}`}</small></span>
        <button type="button" class="btn btn-ghost btn-sm" data-sd-view="${x.id}">보기</button></div>`;
    const el = openLayer("cv-sheetpage", `<div class="cvs-top"><button type="button" class="cvv-back light" data-sd="close" aria-label="닫기">${ICO.back}</button><b>곡</b></div>
      <div class="cvs-body">
        <div class="cvs-head"><h2>${esc(song.title)}</h2><span class="small muted">${[song.main_key || st?.key_main ? `주로 부른 키 ${esc(song.main_key || st.key_main)}` : "", st?.keys ? esc(st.keys) : "", st?.leaders ? `인도 ${esc(st.leaders)}` : ""].filter(Boolean).join(" · ")}</span></div>
        <div class="cvs-kpis"><div><span>부른 횟수</span><b>${st?.count || 0}</b></div><div><span>최근 1년</span><b>${st?.last12 || 0}</b></div><div><span>마지막</span><b>${st?.last ? md(st.last) : "–"}</b><small>${st?.last ? `${st.days_since}일 전` : ""}</small></div><div><span>곡 시간</span><b>${song.team_sec ? mmss(song.team_sec) : "–"}</b><small>${song.team_sec ? "팀 기준" : ""}</small></div><div><span>BPM</span><b>${song.team_bpm || "–"}</b><small>${song.team_bpm ? `${esc(song.team_meter || "4/4")} · 팀 기준` : ""}</small></div></div>
        ${inMd.length ? `<section class="card"><div class="card-title cv-ct">메들리 <small>이 곡이 든 메들리 · 합친 악보는 메들리에</small></div>${inMd.map((m) => `<button type="button" class="cv-prow" data-sd-md="${m.id}"><span class="cv-ptag">메들리</span><span class="cv-st2"><b>${esc(m.title)}</b><small>${m.used || 0}번 · 악보 ${m.sheets || 0}</small></span><span class="cv-go">보기</span></button>`).join("")}</section>` : ""}
        <section class="card"><div class="card-title cv-ct">원본 악보 <small>필기 없는 깨끗한 악보 · 키별</small></div>
          ${orig.map(sheetRow).join("") || `<p class="muted small" style="margin:0">아직 없어요.</p>`}
          ${up ? `<label class="btn btn-soft btn-sm cv-upl">+ 원본 악보 올리기<input type="file" accept="application/pdf" id="sdOrig" hidden></label>` : ""}</section>
        <section class="card"><div class="card-title cv-ct">저장된 악보 <small>콘티에서 이름을 붙여 저장한 것</small></div>
          ${saved.map(sheetRow).join("") || `<p class="muted small" style="margin:0">아직 없어요. 콘티에 이 곡을 넣고 통합본을 올리면 쌓여요.</p>`}</section>
        ${st?.refs?.length ? `<section class="card"><div class="card-title cv-ct">레퍼런스 <small>${st.refs.length}개</small></div>
          ${st.refs.slice(0, 6).map((r, i) => `<div class="cv-ref"><a class="hx-yt" href="${ytLink(r[0], r[3])}" target="_blank" rel="noopener">▶ 영상 ${i + 1}</a><span class="small muted">${r[1]}번 사용 · 마지막 ${r[4] ? r[4].slice(2).replace(/-/g, ".") : ""}${r[2] ? ` · ${esc(r[2])}` : ""}</span></div>`).join("")}</section>` : ""}
        ${log.length ? `<section class="card"><div class="card-title cv-ct">부른 기록 <small>${st?.count || log.length}번</small></div>
          ${log.slice(0, 12).map((p) => `<div class="cv-ref"><b class="small">${p[0].replace(/-/g, ".")}</b><span class="small muted">${esc((H.svc[p[0]]?.[0] || []).join(" · "))}</span>${p[7] ? `<span class="cv-bpm sm">♩=${p[7]}</span>` : ""}${p[4] ? `<span class="cv-key">${esc(p[4])}</span>` : ""}</div>`).join("")}</section>` : ""}
      </div>`);
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-sd=close]")) return closeLayer();
      const mdb = e.target.closest("[data-sd-md]"); if (mdb) return medleyDetail(+mdb.dataset.sdMd);
      const v = e.target.closest("[data-sd-view]");
      if (v) { const x = (sheets || []).find((s) => s.id === +v.dataset.sdView); if (x) { openViewer(null, { single: { title: `${song.title} · ${x.name}`, key: x.key, path: x.path, pages: x.pages, ink: x.kind === "sheet" ? { key: `s:${x.base_id || x.id}`, song: song.id } : null, shared: x.kind === "sheet" ? { sheet: x.id, date: todayISO(), canEdit: false } : null } }); } }
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

  // =================================================================== 026: 메들리 상세 (합친 악보 · 원본 · 레퍼런스 · 곡)
  async function medleyDetail(mid) {
    const [{ data: list }, { data: sheets }, up] = await Promise.all([sb.rpc("medley_list"), sb.rpc("medley_sheets", { p_ids: [mid] }), canUpload().catch(() => false)]);
    const m = (list || []).find((x) => x.id === mid); if (!m) return toast("메들리를 찾을 수 없어요");
    const orig = (sheets || []).filter((x) => x.kind === "original"), saved = (sheets || []).filter((x) => x.kind === "sheet");
    const sheetRow = (x) => `<div class="cv-sheet"><span class="cv-thumb ${x.thumb ? "" : "none"}">${x.thumb ? `<img src="${x.thumb}" alt="">` : ""}</span>
        <span class="cv-st2"><b>${esc(x.name)}</b><small>${x.kind === "original" ? `${x.key ? esc(x.key) + " · " : ""}필기 없음 · ${x.pages}쪽` : `${x.from_date ? md(x.from_date) + " · " : ""}${x.pages}쪽 · ${x.used}번 씀${x.ink ? ` · 필기 ${x.ink}` : ""}`}</small></span>
        <button type="button" class="btn btn-ghost btn-sm" data-md-view="${x.id}">보기</button></div>`;
    const el = openLayer("cv-sheetpage", `<div class="cvs-top"><button type="button" class="cvv-back light" data-md="close" aria-label="닫기">${ICO.back}</button><b>메들리</b></div>
      <div class="cvs-body">
        <div class="cvs-head"><h2>${esc(m.title)}</h2><span class="small muted">${m.songs.map((x) => `${esc(x.title)}${x.key ? " " + esc(x.key) : ""}`).join(" + ")}</span></div>
        <div class="cvs-kpis"><div><span>부른 횟수</span><b>${m.used || 0}</b></div><div><span>마지막</span><b>${m.last ? md(m.last) : "–"}</b></div><div><span>메들리 시간</span><b>${m.team_sec ? mmss(m.team_sec) : "–"}</b><small>${m.team_sec ? "예상 RT에 이 시간 하나로" : ""}</small></div></div>
        <section class="card"><div class="card-title cv-ct">곡 <small>통계 · 부른 기록은 곡마다 따로 쌓여요</small></div>
          ${m.songs.map((x) => `<button type="button" class="cv-prow" data-md-song="${x.song_id}"><span class="cv-ptag">${x.key ? esc(x.key) : "곡"}</span><span class="cv-st2"><b>${esc(x.title)}</b><small>${x.team_bpm ? esc(bpmText(x.team_bpm, x.team_meter)) : ""}</small></span><span class="cv-go">곡 보기</span></button>`).join("")}</section>
        ${m.ref_yt ? `<section class="card"><div class="card-title cv-ct">레퍼런스</div><div class="cv-ref"><a class="hx-yt" href="${ytLink(m.ref_yt, m.ref_start)}" target="_blank" rel="noopener">▶ 영상</a></div></section>` : ""}
        <section class="card"><div class="card-title cv-ct">원본 악보 <small>필기 없는 합친 악보</small></div>
          ${orig.map(sheetRow).join("") || `<p class="muted small" style="margin:0">아직 없어요.</p>`}
          ${up ? `<label class="btn btn-soft btn-sm cv-upl">+ 원본 악보 올리기<input type="file" accept="application/pdf" id="mdOrig" hidden></label>` : ""}</section>
        <section class="card"><div class="card-title cv-ct">저장된 악보 <small>콘티에서 메들리로 저장한 것</small></div>
          ${saved.map(sheetRow).join("") || `<p class="muted small" style="margin:0">아직 없어요. 콘티에 이 메들리를 넣고 통합본을 올리면 쌓여요.</p>`}</section>
      </div>`);
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-md=close]")) return closeLayer();
      const sg = e.target.closest("[data-md-song]"); if (sg) return songDetail(+sg.dataset.mdSong);
      const v = e.target.closest("[data-md-view]");
      if (v) { const x = (sheets || []).find((q) => q.id === +v.dataset.mdView); if (x) openViewer(null, { single: { title: `${m.title} · ${x.name}`, key: x.key, path: x.path, pages: x.pages, ink: x.kind === "sheet" ? { key: `s:${x.base_id || x.id}` } : null, shared: x.kind === "sheet" ? { sheet: x.id, date: todayISO(), canEdit: false } : null } }); }
    });
    $("#mdOrig", el)?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      const key = (prompt("이 원본 악보의 키를 적어 주세요 (예: G-A)", m.songs.map((x) => x.key).filter(Boolean).join("-")) || "").trim();
      try {
        toast("올리는 중…", 8000);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const doc = await (await pdfjs()).getDocument({ data: bytes.slice() }).promise;
        const path = `originals/${m.songs[0].song_id}/${uuid()}.pdf`;
        const { error } = await sb.storage.from("sheets").upload(path, bytes, { contentType: "application/pdf", upsert: false });
        if (error) throw new Error("파일을 올리지 못했어요");
        const { error: e2 } = await sb.rpc("add_medley_original", { p_medley: mid, p_key: key || null, p_name: `원본${key ? " " + key : ""}`, p_path: path, p_pages: doc.numPages, p_size: bytes.length, p_thumb: await thumbOf(doc) });
        if (e2) throw new Error(e2.message);
        toast("원본 악보를 올렸어요"); medleyDetail(mid);
      } catch (err) { toast(err.message || "올리지 못했어요", 4000); }
    });
  }

  // =================================================================== 콘티 작성 (인도자 · 밴드 마스터 · 리더십)
  async function openEditor(sid, { after } = {}) {
    let svc;
    try { svc = await loadOne(sid); } catch (e) { return toast(e.message, 4000); }
    // 023: 그 예배 밴드는 올라온 콘티의 악보만 고쳐요 (곡 · 키 · 순서 · 메모는 그대로)
    const sheetsOnly = !svc.can_edit && !!svc.can_edit_sheets && svc.setlist?.status === "published";
    if (!svc.can_edit && !sheetsOnly) return toast(svc.can_edit_sheets ? "콘티가 올라온 뒤에 악보를 고칠 수 있어요" : "이 예배의 콘티를 고칠 수 있는 사람이 아니에요", 4000);
    const [sr, H, meRes, mr] = await Promise.all([sb.from("songs").select("id, title, main_key, team_sec, team_bpm, team_meter").order("title"), HISTORY.load().catch(() => null), sb.auth.getUser(), sb.rpc("medley_list")]);
    const stats = new Map((H?.songs || []).map((x) => [x.id, x]));
    const songs = (sr.data || []).map((x) => ({ ...x, st: stats.get(x.id) }));
    const sl = svc.setlist;
    const E = {
      svc, base: sl ? sl.version : null, pub: sl?.status === "published", songs, stats, medleys: mr?.data || [],
      target: sl?.target_sec ?? null, targetDefault: svc.target_sec, sheets: {}, yt: {}, ranges: {}, ytConfigured: true,
      items: (sl?.items || []).map((x, i) => ({ song_id: x.song_id, title: x.title, key: x.key || "", medley: x.medley, join: i > 0 && !!x.join_prev, medley_id: x.medley_id || null, medley_title: x.medley_title || null, diff: !!x.diff_key, refs: x.refs || [], dur: x.duration_sec, src: x.duration_src,
        memo: x.memo || "", sheet: x.sheet_id ? { mode: "saved", id: x.sheet_id } : sl?.status === "published" ? { mode: "none" } : { mode: "new", name: "" }, page_from: x.page_from, page_to: x.page_to,
        bpm: x.bpm ?? null, meter: x.meter || (x.bpm ? "4/4" : null), bpm0: x.bpm ?? null, meter0: x.meter || (x.bpm ? "4/4" : null) })),
      up: null, dirty: false, open: null, preview: null, more: null, q: "", sheetsOnly,
      past: svc.past ?? svc.date < todayISO(),
    };
    // 이 기기에 남겨 둔 작성 중 내용 (PDF는 빼고)
    const DKEY = `pole2.conti.${sheetsOnly ? "sheets" : "draft"}.${sid}`;
    const saved = ls.get(DKEY);
    let restored = false;
    if (saved && saved.base === E.base && saved.items?.length && (!sheetsOnly || saved.items.map((x) => x.song_id).join() === E.items.map((x) => x.song_id).join())) { E.items = saved.items; E.target = saved.target ?? E.target; restored = true; }
    const leaderName = (svc.lineup || []).find((x) => x.pos === "leader")?.name || "";
    await loadSongMeta(E, E.items.map((x) => x.song_id));
    await loadMedleyMeta(E, E.items.filter((x) => x.medley_id && !x.join).map((x) => x.medley_id));
    const el = openLayer("cv-editor", `<header class="ce-top"><button type="button" class="cvv-back light" data-ce="close" aria-label="닫기">${ICO.back}</button>
        <span><span class="small muted">${esc(svcShort(svc))}</span><b>${esc(svcTitle(svc))} ${sheetsOnly ? "악보 고치기" : `콘티 ${E.pub ? "고치기" : "쓰기"}`}${E.past ? ` <span class="chip chip-gray">지난 예배</span>` : ""}</b></span></header>
      <div class="ce-body" id="ceBody"></div>
      <div class="ce-bar" id="ceBar"></div>`, () => after?.());
    const body = $("#ceBody", el);
    const persist = () => { E.dirty = true; ls.set(DKEY, { base: E.base, target: E.target, items: E.items.map(({ title, ...x }) => ({ title, ...x })), at: Date.now() }); };
    const target = () => E.target ?? E.targetDefault;
    const songById = (id) => E.songs.find((x) => x.id === id);
    const gnum = (i) => { let n = 0; for (let k = 0; k <= i; k++) if (!(k > 0 && E.items[k].join)) n++; return n; };
    // 026: 묶음 정리 — 맨 앞은 이어서 아님, 메들리 id가 묶음 전체에 같지 않으면 그냥 이어 붙인 묶음으로. 뒤 곡 시간은 0, 첫 곡은 묶음 합계(직접 · 메들리 기준이 아니면)
    function regroup() {
      if (E.items[0]) E.items[0].join = false;
      let g = [];
      const flush = () => {
        if (!g.length) return;
        const ids = new Set(g.map((x) => x.medley_id || 0));
        if (g.length === 1 || ids.size > 1 || ids.has(0)) g.forEach((x) => { if (g.length === 1 || ids.size > 1) { x.medley_id = null; x.medley_title = null; } });
        const h = g[0];
        g.slice(1).forEach((x) => { x.dur = 0; x.src = "medley"; });
        if (g.length > 1 && h.src !== "manual" && !(h.medley_id && h.src === "team")) {
          const parts = g.map((x) => recompute(E, { ...x, join: false, medley_id: null }).dur);
          h.dur = parts.every(Boolean) ? parts.reduce((a, b) => a + b, 0) : parts.find(Boolean) ? parts.reduce((a, b) => a + (b || 0), 0) : null; h.src = h.dur ? "medley" : null;
        }
        if (g.length === 1 && h.src === "medley") Object.assign(h, recompute(E, h));
        g = [];
      };
      E.items.forEach((x, i) => { if (!(i > 0 && x.join)) flush(); g.push(x); }); flush();
    }

    function rtCard() {
      const total = rtOf(E.items.map((x) => ({ duration_sec: x.dur }))), unk = E.items.filter((x) => !x.dur && !x.join).length, tg = target();
      const pct = tg ? Math.min(100, Math.round(100 * total / Math.max(tg, total || 1))) : 0, tick = tg ? Math.min(100, Math.round(100 * tg / Math.max(tg, total))) : 0;
      const diff = tg ? tg - total : null;
      const first = !!svc.communion;
      return `<section class="ce-rt" id="ceRt"><div class="ce-rt-top"><span><small>예상 RT</small><b>${mmss(total)}</b>${tg ? `<span class="of">/ ${mmss(tg)}</span>` : ""}</span>
          ${tg ? `<span class="chip ${diff >= 0 ? "chip-ok" : "chip-warn"}">${diff >= 0 ? `${mmss(diff)} 남음` : `${mmss(-diff)} 초과`}</span>` : ""}</div>
        ${tg ? `<div class="ce-rtbar"><i style="width:${pct}%"></i><span class="tick" style="left:${tick}%"></span></div>` : ""}
        <span class="small muted">${svc.ministry_id ? "사역" : first ? "성찬식 주일" : "주일"} · ${tg ? `목표 ${Math.round(tg / 60)}분${E.target != null ? " (이번만 바꿈)" : ""}` : "목표 RT 없음"}${unk ? ` · 시간 모르는 곡 ${unk}곡` : ""} · <button type="button" class="linkbtn" data-ce="target">${tg ? "이번만 바꾸기" : "목표 정하기"}</button>
          ${E.target != null ? ` · <button type="button" class="linkbtn" data-ce="target-reset">기본으로</button>` : ""}</span></section>`;
    }
    function rowHTML(x, i) {
      if (sheetsOnly) return rowSheetHTML(x, i);
      const s = songById(x.song_id), st = s?.st, list = sheetsOf(E, x);
      const ref = x.refs?.[0], rng = ref ? E.ranges[`${x.song_id}:${ref[0]}`] : null;
      const sheet = x.sheet.mode === "saved" ? list.find((v) => v.id === x.sheet.id) : null;
      const grpHead = !x.join && !!E.items[i + 1]?.join;
      const srcTag = { manual: ["me", `직접${x.orig ? ` · 원래 ${mmss(x.orig)}` : ""}`], team: ["team", x.medley_id && grpHead ? "메들리 기준" : "팀 기준"], video: ["vid", "영상"], medley: ["team", "메들리 합계"] }[x.src] || ["none", "모름"];
      const open = E.open === i;
      return `<div class="ce-row ${x.join ? "join" : ""}" data-i="${i}">
        <span class="ce-grip" data-grip aria-label="끌어서 순서 바꾸기" role="button" tabindex="0">${ICO.grip}</span><span class="cv-sn">${x.join ? "+" : gnum(i)}</span>
        <span class="ce-t"><b>${esc(x.title)}</b><small>${x.join ? `<span class="ce-join">앞 곡에 이어서</span> · ` : grpHead ? `<span class="ce-join">메들리${x.medley_id ? ` '${esc(x.medley_title || "")}'` : ""}</span> · ` : ""}${x.diff ? "음원과 키 다름 · " : ""}${ref ? `<a href="${ytLink(ref[0], rng?.start_sec ?? ref[1])}" target="_blank" rel="noopener">▶ 영상</a>${rng ? ` · 구간 ${mmss(rng.start_sec)}~${rng.end_sec ? mmss(rng.end_sec) : "끝"}` : ""}` : "레퍼런스 없음"}${st?.count ? ` · ${st.count}번` : ""}${st?.last ? ` · 마지막 ${md(st.last)}` : ""}</small></span>
        <input class="ce-key" list="ceKeys" value="${esc(x.key)}" data-f="key" aria-label="${esc(x.title)} 키" maxlength="12" placeholder="키">
        ${x.join ? `<span class="ce-tm"><em class="ce-src team">앞 곡 시간에 포함</em></span>` : `<span class="ce-tm"><input value="${x.dur ? mmss(x.dur) : ""}" data-f="dur" inputmode="numeric" aria-label="${esc(x.title)} ${grpHead ? "메들리 전체 시간" : "곡 시간"}" placeholder="0:00"><em class="ce-src ${srcTag[0]}">${srcTag[1]}</em></span>`}
        ${bpmCell(x)}
        <button type="button" class="ce-x" data-ce="rm" aria-label="${esc(x.title)} 빼기">${ICO.x}</button>
        <div class="ce-sh"><span class="ce-lab">악보</span>${x.sheet.mode === "new"
          ? `<div class="ce-new"><span class="ce-tag">새로 저장</span><input value="${esc(x.sheet.name)}" data-f="sheetname" aria-label="${esc(x.title)} 악보 이름" maxlength="60"><button type="button" class="linkbtn" data-ce="sheet-cancel">${list.length ? "취소" : "악보 없이"}</button>${list.length ? "" : `<span class="small muted ce-hint">저장된 악보가 아직 없어요</span>`}</div>`
          : `<button type="button" class="ce-shsel ${open ? "open" : ""}" data-ce="sheet-open"><span class="nm">${sheet ? esc(sheet.name) : x.sheet.mode === "saved" ? "고른 악보" : "악보 없이"}</span><span class="mt">${sheet ? [sheet.kind === "original" ? "원본 · 필기 없음" : sheet.from_date ? md(sheet.from_date) : "", `${sheet.pages}쪽`, sheet.kind === "sheet" ? `${sheet.used}번 씀` : ""].filter(Boolean).join(" · ") : list.length ? `저장된 악보 ${list.length}개` : ""}</span><span class="cv">▾</span></button>`}
          ${open ? sheetList(x, list) : ""}</div>
        <div class="ce-more"><button type="button" class="linkbtn" data-ce="more">${E.more === i ? "접기" : `메모 · 레퍼런스 · 메들리${x.memo ? " · 메모 있음" : ""}${x.diff ? " · 키 다름*" : ""}`}</button>
          ${E.more === i ? `<div class="ce-morebox">
            <label class="field">메모 <span class="hint">· 팀원에게 보여요</span><input class="input" data-f="memo" value="${esc(x.memo)}" maxlength="200" placeholder="예: A → Bb로 올림"></label>
            <label class="checkrow"><input type="checkbox" data-f="diff" ${x.diff ? "checked" : ""}><span><b>음원과 키 다름</b><small>레퍼런스와 다른 키로 불러요 · 키 뒤에 * 표시</small></span></label>
            ${i > 0 ? `<label class="checkrow"><input type="checkbox" data-f="join" ${x.join ? "checked" : ""}><span><b>앞 곡에 이어서 (메들리)</b><small>앞 곡 번호 아래로 · 예상 RT는 묶음 전체 시간 하나로</small></span></label>` : ""}
            ${grpHead ? (x.medley_id ? `<div class="ce-mdl"><span>메들리 <b>'${esc(x.medley_title || "")}'</b>로 넣었어요 · 악보 · 레퍼런스 · 시간은 메들리 기준</span></div>`
              : `<div class="ce-mdl"><span>이 묶음을 <b>메들리로 저장</b>하면 다음에 한 번에 넣고, 합친 악보 · 레퍼런스 · 시간을 같이 써요</span><button type="button" class="btn btn-soft btn-sm" data-ce="save-medley">메들리로 저장</button></div>`) : ""}
            <div class="field">레퍼런스 영상<div class="ce-refs">${(st?.refs || []).slice(0, 4).map((r) => `<button type="button" class="pillbtn" data-ref="${esc(r[0])}" data-t="${r[3] || 0}" aria-pressed="${ref?.[0] === r[0]}">${esc(r[0].slice(0, 5))}… ${r[1]}번</button>`).join("")}</div>
              <input class="input" data-f="refurl" placeholder="유튜브 주소 붙여 넣기" value="${ref ? ytLink(ref[0], ref[1] || 0) : ""}"></div>
            ${ref ? `<div class="row ce-range"><span class="small" style="font-weight:700">구간</span><input class="input" data-f="rs" value="${mmss(rng?.start_sec ?? ref[1] ?? 0)}" aria-label="시작"> ~ <input class="input" data-f="re" value="${rng?.end_sec ? mmss(rng.end_sec) : ""}" placeholder="끝" aria-label="끝">
              <span class="small muted">${E.yt[ref[0]]?.duration_sec ? `영상 길이 ${mmss(E.yt[ref[0]].duration_sec)}` : E.ytConfigured ? "" : "영상 길이를 아직 몰라요"}</span></div>` : ""}
          </div>` : ""}</div>
      </div>`;
    }
    // 025: BPM · 박자 칸 (적으면 팀 기준으로 저장 · 다음에 자동으로 채워짐)
    function bpmCell(x) {
      return `<span class="ce-bpm"><input value="${x.bpm || ""}" data-f="bpm" inputmode="numeric" maxlength="3" aria-label="${esc(x.title)} BPM" placeholder="BPM">
        <select data-f="meter" aria-label="${esc(x.title)} 박자">${METERS.map((m) => `<option ${(x.meter || "4/4") === m ? "selected" : ""}>${m}</option>`).join("")}</select></span>`;
    }
    // 밴드: 곡은 읽기만, 악보 · BPM 칸만
    function rowSheetHTML(x, i) {
      const list = sheetsOf(E, x), open = E.open === i;
      const sheet = x.sheet.mode === "saved" ? list.find((v) => v.id === x.sheet.id) : null;
      return `<div class="ce-row ro" data-i="${i}"><span></span><span class="cv-sn">${i + 1}</span>
        <span class="ce-t"><b>${esc(x.title)}</b><small>${x.memo ? esc(x.memo) : x.join ? "앞 곡에 이어서" : x.medley ? "메들리" : ""}</small></span>
        <span class="cv-key">${esc(keyText({ key: x.key, diff_key: x.diff }))}</span><span></span>${bpmCell(x)}<span></span>
        <div class="ce-sh"><span class="ce-lab">악보</span>${x.sheet.mode === "new"
          ? `<div class="ce-new"><span class="ce-tag">새로 저장</span><input value="${esc(x.sheet.name)}" data-f="sheetname" aria-label="${esc(x.title)} 악보 이름" maxlength="60"><button type="button" class="linkbtn" data-ce="sheet-cancel">${list.length ? "취소" : "악보 없이"}</button></div>`
          : `<button type="button" class="ce-shsel ${open ? "open" : ""}" data-ce="sheet-open"><span class="nm">${sheet ? esc(sheet.name) : x.sheet.mode === "saved" ? "고른 악보" : "악보 없이"}</span><span class="mt">${sheet ? [sheet.kind === "original" ? "원본 · 필기 없음" : sheet.from_date ? md(sheet.from_date) : "", `${sheet.pages}쪽`].filter(Boolean).join(" · ") : list.length ? `저장된 악보 ${list.length}개` : ""}</span><span class="cv">▾</span></button>`}
          ${open ? sheetList(x, list) : ""}</div></div>`;
    }
    function sheetList(x, list) {
      const pv = E.preview && E.preview.song === x.song_id ? list.find((v) => v.id === E.preview.id) : null;
      return `<div class="ce-shlist">${list.map((v) => `<button type="button" class="ce-opt ${x.sheet.mode === "saved" && x.sheet.id === v.id ? "on" : ""} ${pv?.id === v.id ? "pv" : ""}" data-ce="sheet-pv" data-id="${v.id}">
          <span class="cv-thumb sm">${v.thumb ? `<img src="${v.thumb}" alt="">` : ""}</span><b>${esc(v.name)}</b><span>${[v.kind === "original" ? "원본 · 필기 없음" : v.from_date ? md(v.from_date) : "", `${v.pages}쪽`, v.kind === "sheet" ? `${v.used}번 씀` : "", v.ink ? `필기 ${v.ink}` : ""].filter(Boolean).join(" · ")}</span><i>${x.sheet.mode === "saved" && x.sheet.id === v.id ? "✓" : ""}</i></button>
          ${pv?.id === v.id ? `<div class="ce-prev"><span class="cv-thumb lg">${v.thumb ? `<img src="${v.thumb}" alt="${esc(v.name)} 첫 쪽">` : ""}</span>
            <span class="ce-prev-i"><small>미리보기</small><b>${esc(v.name)}</b><span>${[v.kind === "original" ? "원본 악보" : v.from_date ? fmtDate(v.from_date, { year: "numeric", month: "numeric", day: "numeric" }) : "", v.kind !== "original" && v.from_leaders?.length ? `${esc(v.from_leaders.join(", "))} 콘티` : "", `${v.pages}쪽`].filter(Boolean).join(" · ")}</span>
              <span class="row"><button type="button" class="btn btn-ghost btn-sm" data-ce="sheet-big" data-id="${v.id}">크게 보기</button><button type="button" class="btn btn-primary btn-sm" data-ce="sheet-use" data-id="${v.id}">이 악보 쓰기</button></span></span></div>` : ""}`).join("")}
        <button type="button" class="ce-opt new" data-ce="sheet-new"><span class="cv-thumb sm plus">+</span><b>새 악보로 저장</b><span>올린 통합본의 이 곡 쪽을 새 이름으로</span><i></i></button>
        <button type="button" class="ce-opt" data-ce="sheet-none"><span class="cv-thumb sm none"></span><b>악보 없이</b><span>보기 화면에 빈 쪽으로</span><i>${x.sheet.mode === "none" ? "✓" : ""}</i></button></div>`;
    }
    function searchHTML() {
      const q = E.q.trim().toLowerCase().replace(/\s/g, ""), total = rtOf(E.items.map((x) => ({ duration_sec: x.dur }))), tg = target();
      const hits = q ? E.songs.filter((s) => KO.match(s.title, q)).sort((a, b) => (b.st?.count || 0) - (a.st?.count || 0)).slice(0, 8) : [];
      const exact = E.songs.some((s) => s.title.toLowerCase().replace(/\s/g, "") === q);
      // 026: 메들리도 찾아요 (메들리 이름 · 안에 든 곡 이름)
      const mh = q ? (E.medleys || []).filter((m) => KO.match(m.title, E.q) || m.songs.some((x) => KO.match(x.title, E.q))).slice(0, 4) : [];
      const mHTML = mh.map((m) => { const d = m.team_sec, after = total + (d || 0);
        const chip = !d ? "" : tg ? (after <= tg ? `<span class="chip chip-ok">넣으면 ${mmss(after)}</span>` : `<span class="chip chip-warn">넣으면 ${mmss(after - tg)} 초과</span>`) : `<span class="chip chip-gray">${mmss(d)}</span>`;
        return `<button type="button" class="ce-o" data-addm="${m.id}"><b><span class="tag-m">메들리</span>${esc(m.title)}</b><small>${m.songs.map((x) => esc(x.title) + (x.key ? " " + esc(x.key) : "")).join(" + ")}${m.used ? ` · ${m.used}번` : ""}${d ? ` · ${mmss(d)}` : ""}</small><span class="r">${chip}</span></button>`; }).join("");
      return q ? `<div class="ce-drop" id="ceDrop">${mHTML}${hits.map((s) => {
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
        ${E.past ? `<div class="notice warn ce-past" style="margin:0"><b>지난 예배 콘티예요</b> · 고쳐도 알림을 보내지 않아요. 고치면 기록 · 통계에 바로 반영되고, 이전 버전은 남아요.</div>`
          : sheetsOnly ? "" : `<div class="ce-dl ${dl.cls}">${dl.text} · ${esc(dlText(svc.deadline))}<span class="sp"></span><small>섬김자 ${new Set((svc.lineup || []).map((x) => x.member_id).filter(Boolean)).size}명 · 올리면 바로 알림</small></div>`}
        ${sheetsOnly ? `<div class="notice" style="margin:0">이 예배 밴드라서 <b>악보만</b> 고칠 수 있어요. 곡 · 키 · 순서 · 메모는 인도자 · 밴드 마스터가 고쳐요. 악보만 바뀌면 알림 없이 콘티에 '악보 바뀜'으로 보여요.</div>` : rtCard()}
        <section class="panel"><h2>곡 <small>${sheetsOnly ? "곡마다 쓸 악보" : "손잡이를 끌어서 순서 바꾸기"}</small></h2>
          ${sheetsOnly ? "" : `<div class="ce-search"><input class="input" id="ceQ" placeholder="곡 이름으로 찾기" aria-label="곡 검색" autocomplete="off" value="${esc(E.q)}">${searchHTML()}</div>`}
          <datalist id="ceKeys">${KEYS.map((k) => `<option value="${k}">`).join("")}</datalist>
          <div class="ce-list" id="ceList">${E.items.map(rowHTML).join("") || `<p class="muted small" style="margin:6px 0">위에서 곡을 찾아 넣어 주세요.</p>`}</div></section>
        ${pdfHTML()}`;
      drawBar();
    }
    function drawBar() {
      const ppl = new Set((svc.lineup || []).map((x) => x.member_id).filter(Boolean)).size;
      if (sheetsOnly) {
        $("#ceBar", el).innerHTML = `<span class="ce-who small muted">${E.past ? "지난 예배 · " : ""}악보 · BPM만 바뀌면 알림을 보내지 않아요</span><button type="button" class="btn btn-primary ce-go" data-ce="sheets">악보 저장</button>`;
        return;
      }
      if (E.past) {
        $("#ceBar", el).innerHTML = `<span class="ce-who small muted">지난 예배 · ${sl ? `마지막 저장 ${fmtDateTime(sl.updated_at)}` : "콘티가 없던 예배"} · 알림 없음</span>
          <button type="button" class="btn btn-primary ce-go" data-ce="publish">${E.pub ? "고친 콘티 저장" : "콘티 기록 남기기"} · 알림 없음</button>`;
        return;
      }
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
      if (f === "diff") { x.diff = t.checked; persist(); return redrawList(); }
      if (f === "join") {
        x.join = t.checked;
        if (!x.join) { x.medley_id = null; x.medley_title = null; Object.assign(x, recompute(E, x)); const l = sheetsOf(E, x); if (x.sheet.mode === "none" && l[0]) x.sheet = { mode: "saved", id: l[0].id }; }
        else if (x.sheet.mode === "new" && !E.up) x.sheet = { mode: "none" };
        regroup(); persist(); return redrawList();
      }
      if (f === "bpm") {
        const v = t.value.trim(), n = v ? +v : null;
        if (v && !(Number.isInteger(n) && n >= 20 && n <= 320)) { toast("BPM은 20~320 사이 숫자로 적어 주세요"); t.value = x.bpm || ""; return; }
        x.bpm = n; if (n && !x.meter) x.meter = "4/4"; persist();
      }
      if (f === "meter") { x.meter = t.value; persist(); }
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
      const addm = e.target.closest("[data-addm]");
      if (addm) { await addMedley(+addm.dataset.addm); return; }
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
      if (a === "rm") { if (!x.join && E.items[i + 1]?.join) { E.items[i + 1].join = false; E.items[i + 1].medley_id = null; } E.items.splice(i, 1); regroup(); if (E.up) E.up.tags = E.up.tags.map((t) => (t == null ? null : t === i ? null : t > i ? t - 1 : t)); E.open = E.more = null; persist(); return redrawList(); }
      if (a === "more") { E.more = E.more === i ? null : i; return redrawList(); }
      if (a === "sheet-open") { E.open = E.open === i ? null : i; E.preview = null; return redrawList(); }
      if (a === "sheet-pv") { E.preview = { song: x.song_id, id: +b.dataset.id }; return redrawList(); }
      if (a === "sheet-use") { x.sheet = { mode: "saved", id: +b.dataset.id }; x.cmp = null; E.open = null; E.preview = null; await checkSame(E); persist(); return redrawList(); }
      if (a === "sheet-big") { const v = sheetsOf(E, x).find((s) => s.id === +b.dataset.id); if (v) openViewerOver(x.title, v, svc.date); return; }
      if (a === "sheet-new") { x.sheet = { mode: "new", name: defaultName(x) }; x.cmp = null; E.open = null; persist(); return redrawList(); }
      if (a === "sheet-none") { x.sheet = { mode: "none" }; x.cmp = null; E.open = null; persist(); return redrawList(); }
      if (a === "sheet-cancel") { const list = sheetsOf(E, x); x.sheet = x.sheet.fromId ? { mode: "saved", id: x.sheet.fromId } : list[0] ? { mode: "saved", id: list[0].id } : { mode: "none" }; x.cmp = x.sheet.fromId ? "keep" : null; persist(); return redrawList(); }
      if (a === "save-medley") return saveGroupAsMedley(i, b);
      if (a === "draft") return downloadDraft(E, svc);
      if (a === "save") return submit(false, b);
      if (a === "publish") return submit(true, b);
      if (a === "sheets") return submit(true, b, true);
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
          E.open = E.more = null; regroup(); persist();
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
      const x = { song_id: id, title: s.title, key: s.main_key || st?.key_main || "", medley: false, refs: ref ? [[ref[0], ref[3] || 0, ""]] : [], dur: null, src: null, memo: "", sheet: { mode: "none" },
        bpm: s.team_bpm || null, meter: s.team_meter || (s.team_bpm ? "4/4" : null) };
      if (ref) await loadYt(E, [ref[0]]);
      Object.assign(x, recompute(E, x));
      const list = E.sheets[id] || [];
      const keyMatch = list.find((v) => v.kind === "sheet" && (v.key || "") === x.key) || list.find((v) => v.kind === "sheet");
      x.sheet = keyMatch ? { mode: "saved", id: keyMatch.id } : { mode: "new", name: defaultName(x) };
      E.items.push(x); E.q = ""; persist(); redrawList();
      setTimeout(() => $("#ceQ", el)?.focus(), 0);
    }
    // 026: 메들리 넣기 — 곡들이 한 번호 아래로, 첫 곡에 메들리 악보 · 레퍼런스 · 시간
    async function addMedley(mid) {
      const m = (E.medleys || []).find((q) => q.id === mid); if (!m) return;
      if (E.items.length + m.songs.length > 30) return toast("곡은 30곡까지 넣을 수 있어요");
      await loadSongMeta(E, m.songs.map((x) => x.song_id)); await loadMedleyMeta(E, [mid]);
      if (m.ref_yt) await loadYt(E, [m.ref_yt]);
      const ms = E.sheets["m" + mid] || [];
      m.songs.forEach((ms_, k) => {
        const so = songById(ms_.song_id) || { id: ms_.song_id, title: ms_.title };
        const x = { song_id: ms_.song_id, title: so.title, key: ms_.key || so.main_key || "", medley: true, join: k > 0, medley_id: mid, medley_title: m.title, diff: false,
          refs: k === 0 && m.ref_yt ? [[m.ref_yt, m.ref_start || 0, ""]] : [], dur: k === 0 ? m.team_sec || null : 0, src: k === 0 ? (m.team_sec ? "team" : null) : "medley", memo: "",
          sheet: { mode: "none" }, bpm: so.team_bpm || null, meter: so.team_meter || (so.team_bpm ? "4/4" : null) };
        if (k === 0) { const v = ms.find((q) => q.kind === "sheet") || ms[0]; x.sheet = v ? { mode: "saved", id: v.id } : { mode: "new", name: `${leaderName || "인도자"} ${m.title}`.slice(0, 60) }; }
        E.items.push(x);
      });
      regroup(); E.q = ""; persist(); redrawList();
      toast(`메들리 '${m.title}'를 넣었어요 · ${m.songs.length}곡이 한 번호 아래로`, 3000);
    }
    async function saveGroupAsMedley(i, btn) {
      const g = [E.items[i]]; for (let k = i + 1; k < E.items.length && E.items[k].join; k++) g.push(E.items[k]);
      if (g.length < 2) return toast("앞 곡에 이어서 부르는 곡이 있어야 메들리로 저장해요");
      const def = g.map((x) => x.title).join(" + ");
      const title = prompt("메들리 이름 (곡 라이브러리에 메들리로 저장돼요)", def); if (title === null) return;
      const h = g[0], ref = h.refs?.[0], rng = ref ? E.ranges[`${h.song_id}:${ref[0]}`] : null;
      btn.disabled = true;
      const { data, error } = await sb.rpc("save_medley", { p_id: null, p_service: svc.id, p_data: { title: title.trim() || def, songs: g.map((x) => ({ song_id: x.song_id, key: x.key || null })),
        ref_yt: ref?.[0] || null, ref_start: rng?.start_sec ?? ref?.[1] ?? null, ref_end: rng?.end_sec ?? null, team_sec: h.dur || null, sheet_id: h.sheet.mode === "saved" ? h.sheet.id : null } });
      btn.disabled = false;
      if (error) return toast(error.message || "메들리를 저장하지 못했어요", 4000);
      const r = await sb.rpc("medley_list"); E.medleys = r.data || E.medleys;
      g.forEach((x) => { x.medley_id = data.id; x.medley_title = data.title; });
      delete E.sheets["m" + data.id]; delete E.sheets[h.song_id]; await loadSongMeta(E, [h.song_id]); await loadMedleyMeta(E, [data.id]);
      persist(); redrawList(); toast(`메들리 '${data.title}'로 저장했어요 · 다음부터 곡 찾기에서 메들리로 넣을 수 있어요`, 4000);
    }
    function defaultName(x) { return `${leaderName || "인도자"} ${x.medley_id && !x.join && x.medley_title ? x.medley_title : x.key || ""}`.trim().slice(0, 60); }
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
    async function submit(publish, btn, sheetsSave = false) {
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
          const it = { song_id: x.song_id, key: x.key || null, medley: !!x.medley, join_prev: i > 0 && !!x.join, medley_id: x.medley_id || null, diff_key: !!x.diff,
            refs: x.join ? [] : x.refs || [], duration_sec: x.join ? 0 : x.dur || null, duration_src: x.join ? "medley" : x.dur ? x.src : null, memo: x.memo || null, sheet_id: null,
            bpm: x.bpm || null, meter: x.bpm ? x.meter || "4/4" : null };
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
        if (sheetsSave) {
          const sp = { pages: payload.pages, items: payload.items.map((it) => ({ song_id: it.song_id, sheet_id: it.sheet_id, new_sheet: it.new_sheet, page_from: it.page_from, page_to: it.page_to })) };
          const { error } = await sb.rpc("save_setlist_sheets", { p_service: sid, p_data: sp, p_base: E.base });
          if (error) { if (error.code === "PT409") { toast(error.message, 6000); btn.disabled = false; btn.textContent = label; return; } throw new Error(error.message || "저장하지 못했어요"); }
          // 025: 밴드도 BPM은 고쳐요 (알림 없음)
          for (let i = 0; i < E.items.length; i++) { const x = E.items[i]; if ((x.bpm || null) !== (x.bpm0 || null) || (x.bpm && (x.meter || "4/4") !== (x.meter0 || "4/4"))) await saveBpm(svc, i + 1, x.bpm || null, x.bpm ? x.meter || "4/4" : null); }
          ls.del(DKEY); E.dirty = false; toast("악보를 저장했어요 · 콘티에 '악보 바뀜'으로 보여요", 4000); closeLayer(); return;
        }
        const { data, error } = await sb.rpc("save_setlist", { p_service: sid, p_data: payload, p_publish: publish, p_base: E.base });
        if (error) {
          if (error.code === "PT409") { toast(error.message, 6000); btn.disabled = false; btn.textContent = label; return; }
          throw new Error(error.message || "저장하지 못했어요");
        }
        ls.del(DKEY); E.dirty = false;
        let msg = publish ? (data.republished ? "수정한 콘티를 올렸어요" : "콘티를 올렸어요") : "임시 저장했어요";
        if (publish && (E.past || data.past)) msg = "지난 예배 콘티를 고쳤어요 · 알림은 보내지 않았어요 · 기록에 바로 반영돼요";
        else if (publish) {
          try { const r = await meApi("/api/conti", { action: "notify", service_id: sid }); if (r.sheetOnly) msg += " · 악보만 바뀌어서 알림은 보내지 않았어요"; else if (r.bpmOnly) msg += " · BPM만 바뀌어서 알림은 보내지 않았어요"; else if (!r.skipped) msg += ` · ${r.recipients}명에게 알렸어요`; }
          catch (err) { msg += ` · 알림을 보내지 못했어요 (${err.message})`; }
        }
        if (window.HISTORY) HISTORY.reset();
        toast(msg, 4000);
        closeLayer();
      } catch (err) { toast(err.message || "저장하지 못했어요", 5000); btn.disabled = false; btn.textContent = label; }
    }
    return el;
  }
  // 곡 상세 위에 악보 하나 크게 보기 (편집 화면은 그대로)
  function openViewerOver(title, v, date) {
    const keep = layer; layer = null; keep.el.style.display = "none"; document.body.classList.add("cv-open");
    openViewer(null, { single: { title: `${title} · ${v.name}`, key: v.key, path: v.path, pages: v.pages, shared: v.kind === "sheet" ? { sheet: v.id, date: date || todayISO(), canEdit: false } : null } }).then((vel) => {
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
  async function loadMedleyMeta(E, ids) {
    ids = [...new Set(ids)].filter((id) => id && !E.sheets["m" + id]);
    if (!ids.length) return;
    const { data } = await sb.rpc("medley_sheets", { p_ids: ids });
    ids.forEach((id) => (E.sheets["m" + id] = (data || []).filter((v) => v.medley_id === id).sort((a, b) => (a.kind === b.kind ? b.created_at.localeCompare(a.created_at) : a.kind === "sheet" ? -1 : 1))));
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
    if (x.medley_id && !x.join) { const m = (E.medleys || []).find((q) => q.id === x.medley_id); if (m?.team_sec) return { dur: m.team_sec, src: "team" }; }
    const s = E.songs.find((q) => q.id === x.song_id);
    if (s?.team_sec) return { dur: s.team_sec, src: "team" };
    const d = guessDur(E, { ...s, team_sec: null, id: x.song_id }, x);
    return d ? { dur: d, src: "video" } : { dur: null, src: null };
  }
  // 올린 통합본 쪽 → 곡 (곡 순서대로). 고른 악보가 있으면 그 쪽 수, 나머지는 남는 쪽을 고르게
  function suggestTags(E, n) {
    const want = E.items.map((x) => { if (x.join && x.sheet.mode === "none") return 0; const v = x.sheet.mode === "saved" ? sheetsOf(E, x).find((s) => s.id === x.sheet.id) : null; return v ? v.pages : null; });
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
      if (!r) return { ...base, state: "none", text: x.sheet.mode === "saved" ? "올린 쪽 없음 · 고른 악보를 그대로 써요" : x.join ? "메들리 · 앞 곡 악보에 함께" : "올린 쪽 없음 · 악보 없이" };
      const n = r.to - r.from + 1;
      if (x.sheet.mode === "new") return { ...base, state: "new", text: `새로 저장 → '${esc(x.sheet.name || "")}' · ${n}쪽` };
      if (x.sheet.mode === "saved") {
        const v = sheetsOf(E, x).find((s) => s.id === x.sheet.id);
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
      const v = sheetsOf(E, x).find((s) => s.id === x.sheet.id), r = rangeOf(U, i);
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
        if (x.join && x.sheet.mode !== "saved") continue;   // 026: 메들리 뒤 곡 · 합친 악보는 앞 곡에
        const v = x.sheet.mode === "saved" ? sheetsOf(E, x).find((s) => s.id === x.sheet.id) : null;
        if (v && v.ink && window.INK) {
          // 025: 공유 필기가 있는 악보는 필기를 그려 넣은 쪽으로
          const doc = await sheetDoc(v.path), ink = await INK.sharedFor([v.id], svc.date);
          for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p), v1 = page.getViewport({ scale: 1 });
            const cv = await renderPage(doc, p, 1654), strokes = ink(v.id, p);
            if (strokes.length) INK.paintOnPage(cv.getContext("2d"), strokes, { ox: 0, oy: 0, k: cv.width });
            const jpg = await out.embedJpg(cv.toDataURL("image/jpeg", 0.85));
            out.addPage([v1.width, v1.height]).drawImage(jpg, { x: 0, y: 0, width: v1.width, height: v1.height });
          }
          have++;
        } else if (v) {
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
  // 025: 리더십 콘티 화면 = 다가오는 예배 | 지난 예배 | 섬김이 팀 링크
  const CA = { tab: "up", month: null };
  async function mountAdmin(root) {
    CA.month = CA.month || todayISO().slice(0, 8) + "01";
    root.innerHTML = `<div class="tabs ca-tabs" role="tablist">${[["up", "다가오는 예배"], ["past", "지난 예배"], ["share", "섬김이 팀 링크"]].map(([k, l]) => `<button type="button" role="tab" data-catab="${k}" aria-selected="${CA.tab === k}">${l}</button>`).join("")}</div>
      <div id="caBody" style="display:flex;flex-direction:column;gap:16px"></div>`;
    root.querySelector(".ca-tabs").onclick = (e) => { const b = e.target.closest("[data-catab]"); if (b && b.dataset.catab !== CA.tab) { CA.tab = b.dataset.catab; mountAdmin(root); } };
    const body = root.querySelector("#caBody");
    if (CA.tab === "past") return mountPast(body, root);
    if (CA.tab === "share") return mountShare(body, root);
    return mountUpcoming(body, root);
  }
  // 지난 예배: 달별로 넘겨 보고, 콘티 · 적용찬양을 고쳐요 (알림 없음 · 기록에 바로 반영)
  async function mountPast(root, outer) {
    const m = CA.month, today = todayISO(), end = addDays(addMonths(m, 1), -1);
    root.innerHTML = `<div class="empty">불러오는 중…</div>`;
    let rows = [];
    if (m <= today) {
      const { data } = await sb.rpc("conti_week", { p_from: m, p_to: end < today ? end : addDays(today, -1) });
      rows = (data || []).filter(Boolean).filter((s) => s.date < today).reverse();
    }
    const cur = today.slice(0, 8) + "01";
    root.innerHTML = `<section class="panel" id="caPast"><div class="ca-mnav"><button type="button" class="btn btn-ghost btn-sm" data-capm="-1">이전 달</button><h2>${monthLabel(m)} 지난 예배</h2><button type="button" class="btn btn-ghost btn-sm" data-capm="1" ${m >= cur ? "disabled" : ""}>다음 달</button></div>
        <p class="small muted" style="margin:0">지난 예배 콘티 · 적용찬양을 고칠 수 있어요. <b>알림은 보내지 않고</b>, 고치면 찬양 › 기록 통계에 바로 반영돼요. 이전 버전은 남아요. 그 예배 인도자 · 밴드 마스터도 팀원 화면 찬양 › 기록에서 고칠 수 있어요.</p>
        <div class="song-wrap"><table class="hx-lead ca-table"><thead><tr><th>예배</th><th>인도</th><th>콘티</th><th>적용찬양</th><th></th></tr></thead><tbody>
        ${rows.map((s) => { const sl = s.setlist, p = sl?.status === "published", items = sl?.items || [];
          return `<tr data-sid="${s.id}"><td><b>${esc(svcShort(s, rows))}</b>${s.ministry_id ? ` <span class="chip chip-violet">사역</span>` : ""}</td>
            <td class="small">${(s.lineup || []).filter((x) => x.pos === "leader").map((x) => esc(x.name)).join(", ") || "<span class='muted'>—</span>"}</td>
            <td class="small">${p ? `${items.length}곡 · ${items.map((x) => esc(x.title)).slice(0, 3).join(" · ")}${items.length > 3 ? " …" : ""}${sl.changes ? ` <span class="chip chip-mid">수정됨</span>` : ""}` : `<span class="muted">${sl ? "임시 저장만" : "콘티 없음"}</span>`}</td>
            <td class="small">${s.applied?.length ? s.applied.map((x) => esc(x.title)).join(" · ") : "<span class='muted'>—</span>"}</td>
            <td class="ca-acts">${p ? `<button type="button" class="btn btn-ghost btn-sm" data-cap="view">악보</button>` : ""}<button type="button" class="btn btn-ghost btn-sm" data-cap="edit">${sl ? "고치기" : "쓰기"}</button><button type="button" class="btn btn-ghost btn-sm" data-cap="applied">적용찬양${s.applied?.length ? ` ${s.applied.length}` : ""}</button></td></tr>`; }).join("")
          || `<tr><td colspan="5" class="muted">${monthLabel(m)}에 지난 예배가 없어요.</td></tr>`}</tbody></table></div></section>`;
    root.onclick = (e) => {
      const n = e.target.closest("[data-capm]"); if (n) { CA.month = addMonths(CA.month, +n.dataset.capm); return mountPast(root, outer); }
      const b = e.target.closest("[data-cap]"); if (!b) return;
      const s = rows.find((x) => x.id === b.closest("tr").dataset.sid);
      if (b.dataset.cap === "view") return openViewer(s, {});
      if (b.dataset.cap === "edit") return openEditor(s.id, { after: () => mountPast(root, outer) });
      if (b.dataset.cap === "applied") return openApplied(s, { after: () => { if (window.HISTORY) HISTORY.reset(); mountPast(root, outer); } });
    };
  }
  // 섬김이 팀 링크 (자막팀 · 방송팀 …): 팀마다 고정 링크 · 로그인 없이 보기만 · 끊고 새로 만들 수 있어요
  const newToken = () => { const a = new Uint8Array(24); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const shareUrl = (t) => `${location.origin}/share.html?t=${t}`;
  async function mountShare(root, outer) {
    root.innerHTML = `<div class="empty">불러오는 중…</div>`;
    const { data, error } = await sb.from("share_links").select("*").order("created_at");
    if (error) { root.innerHTML = `<div class="empty">링크를 불러오지 못했어요. migration_024를 실행했는지 확인해 주세요.</div>`; return; }
    const list = data || [];
    root.innerHTML = `<section class="panel" id="caShare"><h2>섬김이 팀 링크 <small>자막팀 · 방송팀처럼 팀마다 고정 링크</small></h2>
        <p class="small muted" style="margin:0">로그인 없이 링크로 열어요. 열 때마다 <b>다가오는 예배</b>의 콘티(곡 순서 · 키 · BPM · 악보) · 적용찬양 · 예배 진행곡(성찬식 주일엔 성찬 찬양) · 백업찬양 후보를 보여 주고, 기도회 중에는 지금 곡 · 다음 곡이 실시간으로 바뀌어요. 라인업 · 멤버 정보 · 내 메모 · 고치기는 보이지 않아요. 홈 화면에 추가하면 앱처럼 쓸 수 있어요.</p>
        <p class="notice warn" style="margin:0">링크는 누구에게나 전달될 수 있어요. 팀이 바뀌거나 링크가 퍼졌으면 '새 링크로 바꾸기'나 '끊기'를 눌러 주세요.</p>
        <div class="bk-alist" id="shList">${list.map((x) => `<div class="devrow lk-row ${x.active ? "" : "off"}" data-id="${x.id}"><span style="display:flex;flex-direction:column;gap:2px;min-width:0">
            <span><b>${esc(x.label)}</b> ${x.active ? `<span class="chip chip-ok">켜짐</span>` : `<span class="chip chip-gray">끊김</span>`}</span>
            <span class="small muted lk-url">${x.active ? esc(shareUrl(x.token)) : "이 링크로는 열리지 않아요"}</span>
            <span class="small muted">${fmtDateTime(x.created_at)} 만듦${x.last_seen_at ? ` · 마지막으로 연 때 ${fmtDateTime(x.last_seen_at)}` : " · 아직 안 열어 봄"}</span></span>
          <div class="row" style="gap:6px;flex:none;flex-wrap:wrap;justify-content:flex-end">${x.active ? `<button type="button" class="btn btn-soft btn-sm" data-sh="copy">링크 복사</button><a class="btn btn-ghost btn-sm" href="${esc(shareUrl(x.token))}" target="_blank" rel="noopener">열기</a>` : ""}
            <button type="button" class="btn btn-ghost btn-sm" data-sh="renew">새 링크로 바꾸기</button><button type="button" class="btn btn-ghost btn-sm" data-sh="toggle">${x.active ? "끊기" : "다시 켜기"}</button><button type="button" class="btn btn-ghost btn-sm" data-sh="del">지우기</button></div></div>`).join("")
          || `<p class="small muted" style="margin:0">아직 만든 링크가 없어요.</p>`}</div>
        <div class="row"><input class="input" id="shLabel" maxlength="30" placeholder="팀 이름 (예: 자막팀)" style="max-width:240px"><button type="button" class="btn btn-primary btn-sm" data-sh="add">링크 만들기</button></div></section>`;
    root.onclick = async (e) => {
      const b = e.target.closest("[data-sh]"); if (!b) return;
      const a = b.dataset.sh, id = +b.closest("[data-id]")?.dataset.id, x = list.find((y) => y.id === id);
      if (a === "add") {
        const label = $("#shLabel", root).value.trim(); if (!label) return toast("팀 이름을 적어 주세요");
        const { error: er } = await sb.from("share_links").insert({ label, token: newToken() });
        toast(er ? "만들지 못했어요" : `${label} 링크를 만들었어요`); return mountShare(root, outer);
      }
      if (a === "copy") return toast((await copyText(shareUrl(x.token))) ? `${x.label} 링크를 복사했어요` : "복사하지 못했어요");
      if (a === "renew") { if (!confirm(`${x.label} 링크를 새로 바꿀까요? 지금 링크는 더 이상 열리지 않아요.`)) return; const { error: er } = await sb.from("share_links").update({ token: newToken(), active: true, last_seen_at: null }).eq("id", id); toast(er ? "바꾸지 못했어요" : "새 링크로 바꿨어요 · 팀에 다시 보내 주세요", 3500); return mountShare(root, outer); }
      if (a === "toggle") { const { error: er } = await sb.from("share_links").update({ active: !x.active }).eq("id", id); toast(er ? "바꾸지 못했어요" : x.active ? "링크를 끊었어요" : "링크를 다시 켰어요"); return mountShare(root, outer); }
      if (a === "del") { if (!confirm(`${x.label} 링크를 지울까요?`)) return; const { error: er } = await sb.from("share_links").delete().eq("id", id); toast(er ? "지우지 못했어요" : "지웠어요"); return mountShare(root, outer); }
    };
  }

  async function mountUpcoming(root, outer) {
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
          return `<tr data-sid="${s.id}"><td><b>${esc(svcShort(s, rows))}</b>${s.ministry_id ? ` <span class="chip chip-violet">사역</span>` : s.communion ? ` <span class="chip chip-violet">성찬식</span>` : ""}</td>
            <td class="small">${(s.lineup || []).filter((x) => x.pos === "leader").map((x) => esc(x.name)).join(", ") || "<span class='muted'>—</span>"}</td>
            <td><span class="chip ${c}">${t}</span>${items.length ? ` <span class="small muted">${items.length}곡</span>` : ""}</td>
            <td class="small">${esc(dlText(s.deadline))}${s.setlist?.deadline ? ` <span class="chip chip-gray">바꿈</span>` : ""}</td>
            <td class="n small">${items.length ? mmss(rt) : "—"}${s.target_sec ? ` / ${mmss(s.target_sec)}` : ""}</td>
            <td class="ca-acts">${s.setlist?.status === "published" ? `<button type="button" class="btn btn-ghost btn-sm" data-ca="view">악보</button><button type="button" class="btn btn-ghost btn-sm" data-ca="copy">카톡 복사</button>` : ""}<button type="button" class="btn btn-ghost btn-sm" data-ca="edit">${s.setlist ? "고치기" : "쓰기"}</button><button type="button" class="btn btn-ghost btn-sm" data-ca="applied">적용찬양${s.applied?.length ? ` ${s.applied.length}` : ""}</button><button type="button" class="btn btn-ghost btn-sm" data-ca="meta">마감 · 목표</button>${s.ministry_id ? "" : `<button type="button" class="btn btn-ghost btn-sm" data-ca="communion" aria-pressed="${!!s.communion}">${s.communion ? "성찬식 빼기" : "성찬식 넣기"}</button>`}</td></tr>`; }).join("")
          || `<tr><td colspan="6" class="muted">앞으로 8주 안에 배치된 예배가 없어요.</td></tr>`}</tbody></table></div></section>
      <section class="panel" id="caSet"><h2>기본값 <small>예배마다 '마감 · 목표'로 따로 바꿀 수 있어요</small></h2>
        <div class="row"><span style="font-weight:700">주일 콘티 마감</span><select class="select" id="caDow" style="width:auto">${KDOW.map((w, i) => `<option value="${i}" ${C.deadline_dow === i ? "selected" : ""}>${w}요일</option>`).join("")}</select><select class="select" id="caHour" style="width:auto">${hours(C.deadline_hour)}</select></div>
        <div class="row"><span style="font-weight:700">사역 콘티 마감</span><select class="select" id="caMin" style="width:auto">${[1, 2, 3, 4, 5, 7].map((n) => `<option value="${n}" ${C.min_days === n ? "selected" : ""}>예배 ${n}일 전</option>`).join("")}</select><span class="small muted">22:00</span></div>
        <div class="row"><span style="font-weight:700">목표 RT</span><label class="row" style="gap:6px">성찬식 주일<input type="number" class="input" id="caFirst" min="5" max="90" value="${Math.round(C.rt_first / 60)}" style="width:80px;min-height:40px">분</label>
          <label class="row" style="gap:6px">나머지 주일<input type="number" class="input" id="caOther" min="5" max="90" value="${Math.round(C.rt_other / 60)}" style="width:80px;min-height:40px">분</label></div>
        <div class="row"><button type="button" class="btn btn-primary btn-sm" id="caSave">저장</button><span class="small muted">콘티 알림(안내 · 독촉 · 올라옴 · 수정됨)은 공지 · 알림 › 알림 설정에서 바꿔요.</span></div></section>`;
    root.onclick = async (e) => {
      const b = e.target.closest("[data-ca]"); if (b) {
        const s = rows.find((x) => x.id === b.closest("tr").dataset.sid);
        if (b.dataset.ca === "view") return openViewer(s, {});
        if (b.dataset.ca === "copy") return copyPop(s);
        if (b.dataset.ca === "edit") return openEditor(s.id, { after: () => mountAdmin(outer) });
        if (b.dataset.ca === "applied") return openApplied(s, { after: () => mountAdmin(outer) });
        // 024: 이 주일 성찬식 켬 · 끔 (첫째 주는 자동으로 켜져 있어요) — 성찬 찬양 · 목표 RT가 따라감
        if (b.dataset.ca === "communion") {
          b.disabled = true;
          const { data, error } = await sb.rpc("set_communion", { p_service: s.id, p_on: !s.communion });
          toast(error ? error.message || "바꾸지 못했어요" : data ? `${svcShort(s, rows)} 성찬식 있음 · 성찬 찬양이 보여요` : `${svcShort(s, rows)} 성찬식 없음`);
          return mountAdmin(outer);
        }
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
          toast(error ? error.message || "바꾸지 못했어요" : "바꿨어요"); return mountAdmin(outer);
        }
      }
      if (e.target.id === "caSave") {
        const v = { deadline_dow: +$("#caDow").value, deadline_hour: +$("#caHour").value, min_days: +$("#caMin").value, rt_first: Math.round(+$("#caFirst").value * 60), rt_other: Math.round(+$("#caOther").value * 60) };
        if (!(v.rt_first >= 300 && v.rt_other >= 300)) return toast("목표 RT는 5분 이상으로 적어 주세요");
        const { error } = await sb.from("team_settings").update({ conti: v }).eq("id", 1);
        toast(error ? "저장하지 못했어요" : "저장했어요"); if (!error) mountAdmin(outer);
      }
    };
  }

  window.CONTI = { mountWeek, mountAdmin, openEditor, openViewer, openApplied, songDetail, medleyDetail, contiText, loadOne, closeLayer, onBackup: null, METRO, bpmText, viewerItems,
    // 023: 백업찬양 · 예배 진행곡 화면이 함께 씀
    lib: { openLayer, closeLayer, sheetBytes, sheetDoc, sheetImage, renderPage, drawPageInto, thumbOf, compressPdf, compressImage, uploadImages, pdfjs, pdflib, uuid, ICO, mb, isImg, procPages, PROC, PROC_ORDER, CACHE, ckey, isAdminPage, meApi, wake, fileOf, anorm },
    _test: { suggestTags, setTag, parseMmss, mmss, looksSame } };
})();
