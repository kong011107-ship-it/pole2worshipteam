// 공통 유틸 — 모든 페이지에서 config.js, supabase-js 다음에 불러옵니다.
(function () {
  const cfg = window.APP_CONFIG;
  window.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  window.esc = function (s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  };

  window.toast = function (msg, ms = 2400) {
    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  };

  window.fmtDate = function (iso, withTime = false) {
    if (!iso) return "";
    const d = new Date(iso);
    const opt = { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul" };
    if (withTime) Object.assign(opt, { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleString("ko-KR", opt);
  };

  let positionsCache = null;
  window.loadPositions = async function () {
    if (positionsCache) return positionsCache;
    const { data, error } = await sb.from("positions").select("*").order("sort_order");
    if (error) throw error;
    positionsCache = data;
    return data;
  };
  window.positionName = function (code) {
    return positionsCache?.find((p) => p.code === code)?.name ?? code ?? "";
  };

  // 로그인 상태 + 멤버 정보 확인. 조건이 안 맞으면 로그인 페이지로 보냄.
  window.requireMember = async function ({ admin = false } = {}) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace("login.html"); return null; }
    const { data: me } = await sb.from("members").select("*").eq("id", session.user.id).maybeSingle();
    if (!me || !me.is_active) { await sb.auth.signOut(); location.replace("login.html?denied=1"); return null; }
    if (me.must_change_password) { location.replace("login.html?change=1"); return null; }
    if (admin && me.role !== "admin") { location.replace("me.html"); return null; }
    return { session, me };
  };

  window.logout = async function () {
    await sb.auth.signOut();
    location.replace("login.html");
  };

  document.querySelectorAll("[data-team-name]").forEach((el) => (el.textContent = cfg.TEAM_NAME));
})();
