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
  window.nextSaturday = () => {
    const t = todayISO(); const dow = new Date(t + "T00:00:00Z").getUTCDay();
    return addDays(t, ((6 - dow + 7) % 7) || 7);
  };
  window.md = (iso) => { const [, m, d] = iso.split("-"); return `${+m}/${+d}`; };
  // 그 달의 주일 목록 (monthISO = "YYYY-MM-01")
  window.sundaysOf = (monthISO) => {
    const out = []; let d = monthISO;
    while (new Date(d + "T00:00:00Z").getUTCDay() !== 0) d = addDays(d, 1);
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
