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
  window.POS_SHORT = { leader: "인도", singer: "싱어", key_main: "메인", key_second: "세컨", e_guitar: "일렉", bass: "베이스", drum: "드럼" };

  // ---------- 로그인 ----------
  window.requireMember = async ({ admin = false } = {}) => {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace("login.html"); return null; }
    const { data: me } = await sb.from("members").select("*").eq("id", session.user.id).maybeSingle();
    if (!me || !me.is_active) { await sb.auth.signOut(); location.replace("login.html?denied=1"); return null; }
    if (me.must_change_password) { location.replace("login.html?change=1"); return null; }
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
  };

  document.querySelectorAll("[data-team-name]").forEach((el) => (el.textContent = cfg.TEAM_NAME));
})();
