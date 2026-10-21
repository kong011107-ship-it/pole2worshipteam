// 공통 유틸 — config.js, supabase-js 다음에 불러옵니다.
(function () {
  const cfg = window.APP_CONFIG;
  window.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  window.$ = (sel, root = document) => root.querySelector(sel);
  window.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  window.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  window.toast = (msg, ms = 2600) => {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const el = document.createElement("div");
    el.className = "toast"; el.setAttribute("role", "status"); el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  };

  // ---------- 날짜 (한국 시간 기준) ----------
  const TZ = "Asia/Seoul";
  window.fmtDate = (iso, opt = {}) => {
    if (!iso) return "";
    const d = typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T00:00:00+09:00") : new Date(iso);
    return d.toLocaleString("ko-KR", { timeZone: TZ, month: "numeric", day: "numeric", ...opt });
  };
  window.fmtDateTime = (iso) => fmtDate(iso, { weekday: "short", hour: "numeric", minute: "2-digit" });
  window.todayISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
  window.addDays = (iso, n) => {
    const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const dow = (iso) => new Date(iso + "T00:00:00Z").getUTCDay();
  window.dowOf = dow;
  window.nextSaturday = () => {
    const t = todayISO();
    return addDays(t, ((6 - dow(t) + 7) % 7) || 7);
  };
  // 오늘이 토요일이면 오늘, 아니면 다가오는 토요일
  window.upcomingSaturday = (iso = todayISO()) => addDays(iso, (6 - dow(iso) + 7) % 7);
  // 오늘이 토요일이면 오늘, 아니면 지난 토요일
  window.lastSaturday = (iso = todayISO()) => addDays(iso, -((dow(iso) + 1) % 7));
  window.md = (iso) => { const [, m, d] = iso.split("-"); return `${+m}/${+d}`; };
  // 11/21 (토)
  window.mdw = (iso) => `${md(iso)} (${["주일", "월", "화", "수", "목", "금", "토"][dow(iso)]})`;
  // 그 달의 주일 목록 (monthISO = "YYYY-MM-01")
  window.sundaysOf = (monthISO) => {
    const out = []; let d = monthISO;
    while (dow(d) !== 0) d = addDays(d, 1);
    while (d.slice(0, 7) === monthISO.slice(0, 7)) { out.push(d); d = addDays(d, 7); }
    return out;
  };
  // 그 달의 토요일 목록
  window.saturdaysOf = (monthISO) => {
    const out = []; let d = monthISO;
    while (dow(d) !== 6) d = addDays(d, 1);
    while (d.slice(0, 7) === monthISO.slice(0, 7)) { out.push(d); d = addDays(d, 7); }
    return out;
  };
  window.monthOf = (iso) => iso.slice(0, 8) + "01";
  window.addMonths = (monthISO, n) => {
    const [y, m] = monthISO.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1 + n, 1));
    return t.toISOString().slice(0, 10);
  };
  window.monthLabel = (monthISO) => `${+monthISO.slice(5, 7)}월`;
  window.dday = (iso) => {
    const n = Math.round((new Date(iso) - new Date(todayISO())) / 86400000);
    return n > 0 ? `D-${n}` : n === 0 ? "오늘 마감" : "마감 지남";
  };

  // ---------- 시간 ----------
  // "19:00:00" → "19:00"
  window.hm = (t) => (t ? String(t).slice(0, 5) : "");
  window.timeRange = (a, b) => (a ? `${hm(a)}${b ? "–" + hm(b) : ""}` : "");
  window.toMin = (t) => { const [h, m] = hm(t).split(":").map(Number); return h * 60 + m; };
  window.fromMin = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
  // 기본 시간 (설정 표가 아직 없으면 이 값)
  window.DEFAULT_TIMES = { sat_practice_start: "11:00", sat_practice_end: "13:30", sunday_start: "09:00", sunday_end: "12:30" };
  let settingsCache = null;
  window.loadSettings = async (force = false) => {
    if (settingsCache && !force) return settingsCache;
    const { data } = await sb.from("team_settings").select("*").eq("id", 1).maybeSingle();
    settingsCache = { ...DEFAULT_TIMES, rec_order: ["skill", "balance", "consecutive", "gender"], rec_basis: "month", ...(data || {}) };
    if (!settingsCache.rec_order.includes("gender")) settingsCache.rec_order = [...settingsCache.rec_order, "gender"];
    return settingsCache;
  };
  // 토요 연습 / 주일 시간: 그날 바꾼 시간이 있으면 그것, 없으면 기본 시간
  window.satTime = (row, st) => [row?.practice_start || st.sat_practice_start, row?.practice_end || st.sat_practice_end];
  window.sunTime = (svc, st) => [svc?.start_time || st.sunday_start, svc?.end_time || st.sunday_end];

  // ---------- 사역 연습 가능 시간 ----------
  // 후보 날짜: 골라 둔 날짜(poll_dates)가 있으면 그것, 없으면 poll_from ~ poll_to
  window.pollDays = (mi) => {
    if (mi?.poll_dates?.length) return [...mi.poll_dates].sort();
    const out = [];
    for (let d = mi?.poll_from; d && mi.poll_to && d <= mi.poll_to; d = addDays(d, 1)) out.push(d);
    return out;
  };
  // 하루 안의 30분 칸 시작 시각
  window.pollTimes = (mi) => {
    const out = [];
    for (let t = toMin(mi.poll_day_start); t < toMin(mi.poll_day_end); t += 30) out.push(fromMin(t));
    return out;
  };
  window.GENDER = { m: "남", f: "여" };
  // ---------- 생일 (016 · 양력) ----------
  // 다가오는 생일: { date: 올해 또는 내년 생일, days: 오늘부터 며칠 } · 2/29는 평년이면 2/28
  window.nextBirthday = (birth, today = todayISO()) => {
    if (!birth) return null;
    const md2 = birth.slice(5, 10);
    const on = (y) => { const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; return `${y}-${md2 === "02-29" && !leap ? "02-28" : md2}`; };
    let y = +today.slice(0, 4), d = on(y);
    if (d < today) d = on(++y);
    return { date: d, days: Math.round((new Date(d + "T00:00:00Z") - new Date(today + "T00:00:00Z")) / 864e5), age: y - +birth.slice(0, 4) };
  };
  window.birthLabel = (birth) => (birth ? `${+birth.slice(0, 4)}. ${+birth.slice(5, 7)}. ${+birth.slice(8, 10)}` : "");
  window.GIFT = { true: "참여", false: "미참여", null: "미정" };

  // ---------- 출석 ----------
  window.ATT = { present: "출석", late: "지각", absent: "결석" };
  window.REASON_TAGS = ["직장", "학업·시험", "가족 일정", "건강", "여행·지방", "교회 다른 섬김"];
  window.MEETING = { yes: "있음", no: "없음", tbd: "미정" };

  // ---------- 수습 일정 ----------
  // n주차 토요일 = 시작일 + 7×(n−1) + (n주차 이전·당일에 시작된 연기 주 수 합)×7
  // postpones: [{ from_week, weeks }]
  window.traineeWeekSat = (start, n, postpones = []) => {
    const shift = postpones.filter((p) => p.from_week <= n).reduce((s, p) => s + p.weeks, 0);
    return addDays(start, 7 * (n - 1 + shift));
  };
  // { week: 0 시작 전 · 1~5 · 6 완료, paused: 연기로 쉬는 중, resume: 다시 시작하는 토요일 }
  window.traineeState = (start, postpones = []) => {
    if (!start) return { week: 0, paused: false };
    const today = todayISO();
    let week = 0;
    for (let n = 1; n <= 5; n++) if (traineeWeekSat(start, n, postpones) <= today) week = n;
    if (week === 0) return { week: 0, paused: false, resume: traineeWeekSat(start, 1, postpones) };
    const weekEnd = addDays(traineeWeekSat(start, week, postpones), 7);
    if (today < weekEnd) return { week, paused: false };
    if (week === 5) return { week: 6, paused: false };
    return { week, paused: true, nextWeek: week + 1, resume: traineeWeekSat(start, week + 1, postpones) };
  };
  window.traineeWeek = (start, postpones = []) => traineeState(start, postpones).week;
  window.TRAINEE_WEEKS = [
    { no: 1, range: "1~2주", title: "참관 + 적응", desc: "팀 문화에 적응하며 함께 지켜봐요." },
    { no: 2, range: "1~2주", title: "참관 + 적응", desc: "팀 문화에 적응하며 함께 지켜봐요." },
    { no: 3, range: "3주", title: "부담 적은 투입", desc: "축도·봉헌송 연습 시간에 연주로 참여해요." },
    { no: 4, range: "4주", title: "실전 연주", desc: "지정곡 1곡을 맡아 연습 시간에 함께해요." },
    { no: 5, range: "5주", title: "전환 면접", desc: "리더십과 커피챗으로 5주를 함께 돌아봐요." },
  ];

  // ---------- 포지션 ----------
  let positionsCache = null;
  window.loadPositions = async (force = false) => {
    if (positionsCache && !force) return positionsCache;
    const { data, error } = await sb.from("positions").select("*").order("sort_order");
    if (error) throw error;
    positionsCache = data;
    return data;
  };
  window.positionName = (code) => positionsCache?.find((p) => p.code === code)?.name ?? code ?? "";
  window.POS_SHORT = { leader: "인도", singer: "싱어", key_main: "메인", key_second: "세컨", e_guitar: "일렉", acoustic: "어쿠", bass: "베이스", drum: "드럼" };

  // ---------- 로그인 ----------
  // 로그인 뒤 돌아올 곳 (015: 알림을 눌렀는데 로그인이 풀려 있던 경우 그 화면으로)
  const here = () => encodeURIComponent(location.pathname.replace(/^.*\//, "/") + location.hash);
  window.safeNext = (v) => { v = String(v || ""); return /^\/(me|admin)\.html(#[A-Za-z0-9:_.\/-]{0,120})?$/.test(v) ? v : null; };
  window.requireMember = async ({ admin = false } = {}) => {
    const back = here();   // 화면이 주소를 정리하기 전에 기억 (알림 주소의 항목 부분까지)
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace(`login.html?next=${back}`); return null; }
    const { data: me } = await sb.from("members").select("*").eq("id", session.user.id).maybeSingle();
    if (!me || !me.is_active) { await sb.auth.signOut(); location.replace("login.html?denied=1"); return null; }
    if (me.must_change_password) { location.replace(`login.html?change=1&next=${back}`); return null; }
    if (admin && me.role !== "admin") { location.replace("me.html"); return null; }
    return { session, me };
  };
  window.logout = async () => { await sb.auth.signOut(); location.replace("login.html"); };

  // ---------- 안내 문구 ----------
  // 템플릿의 [대괄호] 자리를 아는 값으로 채움. 모르는 자리는 그대로 둠.
  window.fillTemplate = (body, v = {}) => {
    const map = {
      "이름": v.name,
      "면접 일시": v.interviewAt ? fmtDateTime(v.interviewAt) : null,
      "면접 장소": v.interviewPlace,
      "수습 시작일": v.traineeStart ? fmtDate(v.traineeStart, { weekday: "short" }) : null,
      "사이트 주소": location.origin + "/login.html",
      "아이디": v.email,
      "임시 비밀번호": v.tempPassword,
    };
    return body.replace(/\[([^\]]+)\]/g, (m, key) => (map[key] ? map[key] : m));
  };

  window.copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch {}
      ta.remove(); return ok;
    }
  };

  // ---------- 아이콘 ----------
  const P = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  window.ICON = {
    home: `<svg viewBox="0 0 24 24" ${P}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>`,
    check: `<svg viewBox="0 0 24 24" ${P}><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 9h18M8.5 14.5l2.5 2.5 4.5-5"/></svg>`,
    table: `<svg viewBox="0 0 24 24" ${P}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/></svg>`,
    user: `<svg viewBox="0 0 24 24" ${P}><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>`,
    pray: `<svg viewBox="0 0 24 24" ${P}><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/><path d="M12 11v5M9.5 13.5h5"/></svg>`,
    bell: `<svg viewBox="0 0 24 24" ${P}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>`,
    download: `<svg viewBox="0 0 24 24" ${P}><path d="M12 3v12M7 10l5 5 5-5M4 19h16"/></svg>`,
    music: `<svg viewBox="0 0 24 24" ${P}><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>`,
    share: `<svg viewBox="0 0 24 24" ${P}><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>`,
  };

  // ---------- 013: 앱(홈 화면에 추가) · 푸시 알림 ----------
  const UA = navigator.userAgent || "";
  const b64ToBytes = (s) => {
    const pad = "=".repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  };
  window.PWA = {
    isStandalone: () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true,
    platform: () => (/iphone|ipad|ipod/i.test(UA) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) ? "ios" : /android/i.test(UA) ? "android" : "desktop",
    // 카카오톡 등 앱 안 브라우저: 설치·알림이 안 됨
    inApp: () => /KAKAOTALK|NAVER\(|Instagram|FBAN|FBAV|Line\/|DaumApps/i.test(UA),
    pushSupported: () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
    async register() {
      if (!("serviceWorker" in navigator)) return null;
      try { return await navigator.serviceWorker.register("/sw.js"); } catch { return null; }
    },
    async subscription() {
      if (!PWA.pushSupported()) return null;
      const reg = await navigator.serviceWorker.getRegistration("/");
      return reg ? reg.pushManager.getSubscription() : null;
    },
    // on · off · denied · install(아이폰: 홈 화면 앱에서만) · inapp · unsupported
    async state() {
      if (PWA.inApp()) return "inapp";
      if (PWA.platform() === "ios" && !PWA.isStandalone()) return "install";
      if (!PWA.pushSupported()) return "unsupported";
      if (Notification.permission === "denied") return "denied";
      const sub = await PWA.subscription();
      if (!sub) return "off";
      // 이 기기 구독이 지금 계정으로 저장돼 있는지 (다른 계정에서 켰던 기기일 수 있음)
      const { data } = await sb.from("push_subscriptions").select("endpoint").eq("endpoint", sub.endpoint).maybeSingle();
      return data ? "on" : "off";
    },
    async enable() {
      const reg = (await PWA.register()) || (await navigator.serviceWorker.ready);
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error(perm === "denied" ? "알림이 차단돼 있어요. 휴대폰 설정에서 이 앱의 알림을 허용해 주세요." : "알림을 허용해야 받을 수 있어요.");
      const r = await fetch("/api/push-key");
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.key) throw new Error(j.error || "알림 키를 불러오지 못했어요. 리더에게 알려 주세요.");
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(j.key) });
      const k = sub.toJSON().keys || {};
      const { error } = await sb.rpc("save_push_subscription", { p_endpoint: sub.endpoint, p_p256dh: k.p256dh, p_auth: k.auth, p_ua: UA.slice(0, 300) });
      if (error) throw new Error("알림을 켜지 못했어요. 다시 시도해 주세요.");
      return true;
    },
    async disable() {
      const sub = await PWA.subscription();
      if (!sub) return;
      await sb.rpc("remove_push_subscription", { p_endpoint: sub.endpoint });
      try { await sub.unsubscribe(); } catch {}
    },
  };
  window.NOTIFY_KIND = { open: "응답", minopen: "응답", poll: "연습", remind: "마감", lineup: "배치", practice: "연습", apply: "지원", trainee: "수습", notice: "공지", message: "안내", prayer: "기도", birthday: "생일" };

  // ---------- 013: 배치표 표 (보기 · 이미지 저장) ----------
  //  row = { date: "9월 6일", sub: "ONE STEP" | "", green: 사역 줄, cells: { leader: [{ n, b, me }], singer: [...], key_main, ... } }
  //  b = 싱어 리더·밴드 마스터(굵게), 칸이 비면 X
  const LCOLS_ALL = [["leader", "인도"], ["singer", "싱어"], ["key_main", "메인"], ["key_second", "세컨"], ["e_guitar", "일렉"], ["bass", "베이스"], ["drum", "드럼"], ["acoustic", "어쿠스틱"]];
  // 021: 선택 포지션(어쿠스틱)은 그 표에 한 명이라도 있을 때만 칸을 만듦
  const OPTIONAL = new Set(["acoustic"]);
  const colsOf = (rows) => LCOLS_ALL.filter(([k]) => !OPTIONAL.has(k) || rows.some((r) => (r.cells[k] || []).length));
  const korDate = (iso) => `${+iso.slice(5, 7)}월 ${+iso.slice(8, 10)}일`;
  // 019: 한 칸에 5명 이상(싱어 5~6명)이면 두 줄로 나눠 칸이 너무 넓어지지 않게
  const cellLines = (list) => (list.length > 4 ? [list.slice(0, Math.ceil(list.length / 2)), list.slice(Math.ceil(list.length / 2))] : [list]);
  window.LTABLE = {
    COLS: LCOLS_ALL,
    colsOf,
    korDate,
    cellLines,
    html(rows) {
      const LCOLS = colsOf(rows);
      const one = (x) => `<span class="${x.b ? "b" : ""} ${x.me ? "me" : ""}">${esc(x.n)}</span>`;
      const cell = (list) => list.length ? cellLines(list).map((ln) => ln.map(one).join(" ")).join("<br>") : `<span>X</span>`;
      return `<div class="lt-wrap"><table class="lt"><thead><tr><th class="lt-d"></th>${LCOLS.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr class="${r.green ? "g" : ""}"><th class="lt-d" scope="row">${esc(r.date)}${r.sub ? `<br><span>${esc(r.sub)}</span>` : ""}</th>
          ${LCOLS.map(([k]) => `<td>${cell(r.cells[k] || [])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    },
    // 보내 준 표 모양 그대로 PNG로 (2배 해상도)
    async png(rows, title) {
      const LCOLS = colsOf(rows);
      const FONT = '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
      const allText = (title || "") + rows.map((r) => r.date + r.sub + Object.values(r.cells).flat().map((x) => x.n).join("")).join("") + "인도싱어메인세컨일렉베이스드럼어쿠스틱XPole2 찬양팀";
      try { await Promise.all([500, 700, 800].map((w) => document.fonts.load(`${w} 19px "Pretendard Variable"`, allText))); } catch {}
      const S = 2, FS = 19, PX = 18, PY = 16, LH = 26, GAP = 9, M = 22;
      const cv = document.createElement("canvas"), g = cv.getContext("2d");
      const font = (w, size = FS) => `${w} ${size}px ${FONT}`;
      const tw = (t, w) => { g.font = font(w); return g.measureText(t).width; };
      const lineW = (ln) => ln.reduce((s, x, i) => s + tw(x.n, x.b ? 800 : 500) + (i ? GAP : 0), 0);
      const cellW = (list) => list.length ? Math.max(...cellLines(list).map(lineW)) : tw("X", 500);
      const widths = [Math.max(120, ...rows.map((r) => Math.max(tw(r.date, 800), r.sub ? tw(r.sub, 800) : 0) + PX * 2)),
        ...LCOLS.map(([k, l]) => Math.max(tw(l, 700), ...rows.map((r) => cellW(r.cells[k] || []))) + PX * 2)];
      const linesOf = (r) => Math.max(r.sub ? 2 : 1, ...LCOLS.map(([k]) => cellLines(r.cells[k] || []).length));
      const rowH = rows.map((r) => linesOf(r) * LH + PY * 2), headH = LH + PY * 2;
      const titleH = title ? 44 : 0;
      const W = Math.ceil(widths.reduce((a, b) => a + b, 0) + M * 2), H = Math.ceil(M * 2 + titleH + headH + rowH.reduce((a, b) => a + b, 0));
      cv.width = W * S; cv.height = H * S; g.scale(S, S);
      g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, W, H);
      g.textBaseline = "middle";
      if (title) {
        g.fillStyle = "#17092E"; g.font = font(800, 22); g.fillText(title, M + 2, M + 14);
        const tx = M + 2 + g.measureText(title).width + 10;
        g.fillStyle = "#6B7684"; g.font = font(500, 15); g.fillText("Pole2 찬양팀", tx, M + 16);
      }
      const x0 = M, y0 = M + titleH;
      const xs = widths.reduce((acc, w) => acc.concat(acc[acc.length - 1] + w), [x0]);
      // 배경: 헤더 줄 + 날짜 열
      g.fillStyle = "#EAF2FB";
      g.fillRect(x0, y0, xs[xs.length - 1] - x0, headH);
      g.fillRect(x0, y0, widths[0], headH + rowH.reduce((a, b) => a + b, 0));
      // 글자
      g.fillStyle = "#17092E"; g.font = font(700);
      LCOLS.forEach(([, l], i) => g.fillText(l, xs[i + 1] + PX, y0 + headH / 2));
      let y = y0 + headH;
      rows.forEach((r, ri) => {
        const h = rowH[ri], color = r.green ? "#4E9A6A" : "#17092E";
        g.fillStyle = color; g.font = font(800);
        if (r.sub) { g.fillText(r.date, x0 + PX, y + PY + LH / 2); g.fillText(r.sub, x0 + PX, y + PY + LH * 1.5); }
        else g.fillText(r.date, x0 + PX, y + h / 2);
        LCOLS.forEach(([k], i) => {
          const list = r.cells[k] || [];
          if (!list.length) { g.font = font(500); g.fillText("X", xs[i + 1] + PX, y + PY + LH / 2); return; }
          cellLines(list).forEach((ln, li) => {
            let x = xs[i + 1] + PX; const cy = y + PY + LH / 2 + li * LH;
            ln.forEach((nm) => { g.font = font(nm.b ? 800 : 500); g.fillText(nm.n, x, cy); x += g.measureText(nm.n).width + GAP; });
          });
        });
        y += h;
      });
      // 선
      g.strokeStyle = "#DCE5EF"; g.lineWidth = 1;
      const yEnd = y0 + headH + rowH.reduce((a, b) => a + b, 0);
      const hline = (py) => { g.beginPath(); g.moveTo(x0, py); g.lineTo(xs[xs.length - 1], py); g.stroke(); };
      let yy = y0;
      [0, headH, ...rowH].forEach((h) => { yy += h; hline(yy >= yEnd ? yEnd - 0.5 : yy + 0.5); });
      xs.forEach((x, i) => { const px = i === xs.length - 1 ? x - 0.5 : x + 0.5; g.beginPath(); g.moveTo(px, y0); g.lineTo(px, yEnd); g.stroke(); });
      return new Promise((ok) => cv.toBlob((b) => ok(b), "image/png"));
    },
    // 폰: 공유 창(카톡으로 바로) · PC: 다운로드
    async save(blob, name) {
      const file = new File([blob], name, { type: "image/png" });
      const touch = matchMedia("(pointer: coarse)").matches;
      if (touch && navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file] }); return "shared"; }
        catch (e) { if (e.name === "AbortError") return "cancel"; }
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      return "saved";
    },
  };

  document.querySelectorAll("[data-team-name]").forEach((el) => (el.textContent = cfg.TEAM_NAME));
})();
