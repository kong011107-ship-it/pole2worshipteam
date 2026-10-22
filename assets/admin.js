// =====================================================================
//  관리자 화면 — 모집·수습 파이프라인 / 지원자 상세 / 멤버 / 안내 문구
//  섬김 일정·사역 / 배치표(자동 추천·객원) / 출석 / 대시보드 / 설정
// =====================================================================
(function () {
  const S = {
    me: null, apps: [], logs: [], members: [], extras: [], evals: [], templates: [], items: [], postpones: [],
    guests: [], skills: [], settings: null,
    drag: null, newIds: new Set(), memberFilter: "all",
  };
  const STAGES = [
    { id: "applied", title: "접수", hint: "서류 확인 후 면접 대상자 선정", next: "면접으로 이동" },
    { id: "interview", title: "면접", hint: "면접관별 평가표 입력", next: "수습 시작" },
    { id: "trainee", title: "수습 5주", hint: "주간 나눔 기록 · 주차별 안내", next: "정식 전환" },
    { id: "member", title: "정식 전환", hint: "최근 60일 · 팀 앞 소개와 기도로 환영" },
  ];
  const STAGE_IDX = Object.fromEntries(STAGES.map((s, i) => [s.id, i]));
  const REASON = { not_selected: "미선발", hold: "보류", reapply: "추후 재지원 권유", withdrawn: "중도 하차" };
  const REASON_TPL = { not_selected: "2-1", hold: "3-hold", reapply: "3-reapply", withdrawn: null };
  const SCORE = { ok: "충분", mid: "보완 필요", weak: "미흡" };
  const RESULT = { pass: "합격 (수습 전환)", pass_cond: "조건부 수습", hold: "보류", reapply: "추후 재지원 권유" };
  const LEVEL = { 3: "상", 2: "중", 1: "하" };
  // 리더십 직책 (018)
  const TITLES = { team_lead: "팀장", singer_lead: "싱어팀장", band_lead: "밴드팀장", treasurer: "총무" };
  const TITLE_SHORT = { team_lead: "팀장", singer_lead: "싱팀", band_lead: "밴팀", treasurer: "총무" };
  const TITLE_ORDER = ["team_lead", "singer_lead", "band_lead", "treasurer"];

  const app = (id) => S.apps.find((a) => a.id === id);
  const tpl = (code) => S.templates.find((t) => t.code === code);
  const memberName = (id) => S.members.find((m) => m.id === id)?.name ?? "—";
  const admins = () => S.members.filter((m) => m.role === "admin" && m.is_active);
  // 최상위 리더십 (015)
  const isOwner = () => !!S.me?.is_owner;
  // 021: 예배MC · 교역자 — 리더십 권한(알림 · 정보), 섬김 응답 · 출석 · 자동 추천에서는 빠짐. 배치는 어느 자리든
  const OBS = { mc: "예배MC", pastor: "교역자" };
  const isObs = (m) => !!OBS[m?.status];
  const obsChip = (m) => (isObs(m) ? `<span class="chip chip-obs">${OBS[m.status]}</span>` : "");
  const ownerOf = () => S.members.find((m) => m.is_owner);
  const lockedFor = (m) => !!m.is_owner && m.id !== S.me.id;   // 다른 리더가 보는 최상위 리더십 계정
  const leaderChip = (m) => (m.is_owner ? `<span class="chip chip-owner">최상위 리더십</span>` : isObs(m) ? obsChip(m) : m.role === "admin" ? `<span class="chip chip-violet">리더십</span>` : "")
    + (m.role_title ? `<span class="chip chip-title">${TITLES[m.role_title]}</span>` : "");
  const firstLogin = (m) => m.is_active && m.must_change_password;
  const sent = (appId, code) => S.logs.some((l) => l.application_id === appId && l.template_code === code);
  const ctxOf = (a, extra = {}) => ({ name: a.name, email: a.email, interviewAt: a.interview_at,
    interviewPlace: a.interview_place, traineeStart: a.trainee_start, ...extra });
  const pp = (appId) => S.postpones.filter((p) => p.application_id === appId);
  const alumniOf = (a) => (S.alumni || []).filter((x) => x.name === a.name);
  const REMOVE_REASONS = ["졸업·파송", "MC 콜링", "휴면 연장 의사 미전달", "본인 요청", "기타"];
  const tstate = (a) => traineeState(a.trainee_start, pp(a.id));
  // 숙련도: 비워 두면 '중'(2)
  const skillOf = (mid, pos) => S.skills.find((k) => k.member_id === mid && k.position_code === pos)?.level || 2;
  const skillSet = (mid, pos) => S.skills.find((k) => k.member_id === mid && k.position_code === pos)?.level || null;

  // ---------------------------------------------------------------- 데이터
  async function loadAll() {
    const [apps, logs, members, extras, evals, templates, items, postpones, alumni, guests, skills] = await Promise.all([
      sb.from("applications").select("*").order("created_at", { ascending: false }),
      sb.from("message_log").select("*").order("sent_at"),
      sb.from("members").select("*").order("name"),
      sb.from("member_extra_positions").select("*"),
      sb.from("interview_evaluations").select("*"),
      sb.from("message_templates").select("*").order("sort_order"),
      sb.from("eval_items").select("*").order("sort_order"),
      sb.from("trainee_postpones").select("*").order("from_week"),
      sb.from("alumni").select("*").order("left_at", { ascending: false }),
      sb.from("guests").select("*").order("name"),
      sb.from("member_skills").select("*"),
    ]);
    const err = [apps, logs, members, extras, evals, templates, items, postpones].find((r) => r.error);
    if (err) { toast("데이터를 불러오지 못했습니다. 새로고침해 주세요."); console.error(err.error); }
    if (guests.error || skills.error) console.error("migration_010을 실행했는지 확인해 주세요.", guests.error || skills.error);
    S.apps = apps.data || []; S.logs = logs.data || []; S.members = members.data || [];
    const meNow = S.members.find((m) => m.id === S.me?.id); if (meNow) S.me = meNow;
    S.extras = extras.data || []; S.evals = evals.data || []; S.templates = templates.data || []; S.items = items.data || [];
    S.postpones = postpones.data || [];
    S.alumni = alumni.data || [];
    S.guests = guests.data || []; S.skills = skills.data || [];
    S.settings = await loadSettings(true);
    await loadPositions(true);
  }

  async function logMessage(appId, code) {
    if (!code) return;
    const { data, error } = await sb.from("message_log").insert({ application_id: appId, template_code: code, sent_by: S.me.id }).select().single();
    if (!error && data) S.logs.push(data);
  }

  // 020: 동시 수정 보호 — 연 때의 값(before)과 저장할 값(after)을 함께 보내 내가 바꾼 칸만 저장
  //  그 사이 다른 리더가 같은 칸을 고쳤으면 아무것도 저장하지 않고 { conflict: [{ field, label, now }] }
  async function saveRpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args);
    if (!error) return { data };
    if (error.code === "PT409") { let c = []; try { c = JSON.parse(error.details || "[]"); } catch {} return { conflict: c }; }
    throw new Error(error.message || "저장하지 못했습니다");
  }
  // 칸 값 → 사람이 읽는 글 (충돌 안내 · 변경 기록)
  const DAYS = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${+v.slice(0, 4)}. ${+v.slice(5, 7)}. ${+v.slice(8, 10)}` : v);
  function fieldText(field, v) {
    if (v === null || v === undefined || v === "") return "비어 있음";
    const f = String(field).replace(/^skill:/, "level");
    if (f === "gender") return GENDER[v] || v;
    if (f === "gift_join") return v ? "참여" : "미참여";
    if (["main_position", "position_code"].includes(f)) return positionName(v);
    if (f === "role_title") return TITLES[v] || v;
    if (f === "role") return v === "admin" ? "리더십" : "팀원";
    if (f === "level") return LEVEL[v] || v;
    if (f === "status") return ATT[v] || { active: "정식", trainee: "수습", mc: "예배MC", pastor: "교역자" }[v] || v;
    if (f === "meeting_status") return MEETING[v] || v;
    if (f === "cohort") return v + "기";
    if (f === "title_until") return v + "기까지";
    if (["leader_id", "member_id", "interviewer_id"].includes(f)) return memberName(v);
    if (f === "stage") return { applied: "접수", interview: "면접", trainee: "수습", member: "정식 전환", closed: "종료" }[v] || v;
    if (typeof v === "boolean") return v ? "예" : "아니요";
    if (typeof v === "object") return Array.isArray(v) ? v.map((x) => fieldText(f, x)).join(", ") : "(바뀜)";
    const s = DAYS(String(v));
    return s.length > 40 ? s.slice(0, 40) + "…" : s;
  }
  const conflictBox = (list, tail) => `<div class="notice warn conflict" role="alert" style="display:flex;flex-direction:column;gap:6px">
    <b>저장하지 않았어요 · 그 사이 다른 리더가 먼저 고친 칸이 있어요</b>
    <ul style="margin:0;padding-left:18px;font-weight:500;line-height:1.7">${list.map((c) => `<li>${esc(c.label)} · 지금 <b>${esc(fieldText(c.field, c.now))}</b></li>`).join("")}</ul>
    <span class="small" style="font-weight:500">${tail}</span></div>`;

  async function api(path, payload) {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "요청을 처리하지 못했습니다.");
    return j;
  }

  // ---------------------------------------------------------------- 메뉴 서랍 (021.1)
  //  묶음(사람·섬김·찬양·소통)은 한 번에 하나만 열림. 메뉴를 옮기면 그 메뉴의 묶음이 열리고 나머지는 닫힘
  //  마지막으로 연 묶음은 이 기기에 기억(대시보드·설정처럼 묶음 밖 메뉴에서 새로고침해도 그대로)
  //  닫힌 묶음: 지금 보는 메뉴가 있으면 제목이 보라, 할 일 숫자가 있으면 점
  const NAV_KEY = "pole2.navOpen";
  const navSecs = () => $$(".side .nav-sec");
  function navOpen(key, remember = true) {
    navSecs().forEach((sec) => {
      const on = sec.dataset.sec === key;
      sec.classList.toggle("open", on);
      sec.querySelector(".nav-group").setAttribute("aria-expanded", String(on));
    });
    if (remember) { try { localStorage.setItem(NAV_KEY, key || ""); } catch {} }
  }
  function navSync() {
    const cur = $(".side nav a.on")?.closest(".nav-sec");
    navSecs().forEach((sec) => {
      sec.classList.toggle("has-on", sec === cur);
      sec.classList.toggle("has-todo", !!sec.querySelector(".badge-count:not(.hidden)"));
    });
    if (cur) navOpen(cur.dataset.sec);
    else if (!$(".side .nav-sec.open")) { let k = ""; try { k = localStorage.getItem(NAV_KEY) || ""; } catch {} navOpen(k, false); }
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest(".side button.nav-group");
    if (!b) return;
    const sec = b.closest(".nav-sec");
    navOpen(sec.classList.contains("open") ? "" : sec.dataset.sec);
  });

  // ---------------------------------------------------------------- 라우팅
  let routed = null;
  function route() {
    routed = location.hash;
    const h = location.hash.slice(1) || "dashboard";
    const [view, id, sub] = h.split("/");
    const navOf = { app: "pipeline", member: "members", ministry: "schedule", audit: "settings", respond: "schedule" };
    $$(".side nav a").forEach((a) => a.classList.toggle("on", a.dataset.nav === (navOf[view] || view)));
    updateTodoCount();
    navSync();
    if (view === "app" && id) return renderDetail(id, sub);
    if (view === "member" && id) return renderMemberDetail(id);
    if (view === "ministry" && id) return renderMinistry(id);
    if (view === "pipeline") return renderPipeline();
    if (view === "attendance") return renderAttendance();
    if (view === "members") return renderMembers();
    if (view === "schedule") return renderSchedule();
    if (view === "respond") return renderRespondAdmin();
    if (view === "settings") return renderSettings();
    if (view === "lineup") return renderLineupAdmin();
    if (view === "templates") return renderTemplates();
    if (view === "notify") return renderNotify();
    if (view === "forecast") return renderForecast();
    if (view === "sharing") return renderSharing();
    if (view === "audit") return renderAudit();
    if (view === "songs") return renderSongs();
    if (view === "conti") return renderConti();
    if (view === "history") return renderHistory();
    return renderDashboard();
  }
  // ---------------------------------------------------------------- 뒤로가기 (014)
  //  기록: [대시보드] → 메뉴 한 칸 → 상세(멤버·사역·지원자) …
  //  메뉴끼리 옮길 때는 메뉴 칸을 바꿔 끼워서, 어느 메뉴에서든 뒤로가기 = 대시보드, 대시보드에서 뒤로가기 = 종료
  //  창(모달)이 열려 있으면 뒤로가기는 창만 닫음
  const MAIN = ["dashboard", "pipeline", "members", "forecast", "schedule", "respond", "lineup", "attendance", "conti", "songs", "history", "notify", "sharing", "templates", "settings"];
  const lv = () => history.state?.lv ?? 0;
  let curClose = null;
  let pendingNav = null, modalPushed = false, popWait = null, popDone = null;
  const routeTop = () => { route(); window.scrollTo(0, 0); };
  function nav(hash) {
    hash = String(hash).replace(/^#/, "") || "dashboard";
    if (popWait) return void popWait.then(() => nav(hash));   // 창 닫기(뒤로) 처리 뒤에
    if ("#" + hash === location.hash) return routeTop();
    if (hash === "dashboard") {
      if (lv() > 0) return void history.go(-lv());
      history.replaceState({ lv: 0 }, "", "#dashboard"); return routeTop();
    }
    if (MAIN.includes(hash)) {
      if (lv() === 0) history.pushState({ lv: 1 }, "", "#" + hash);
      else if (lv() === 1) history.replaceState({ lv: 1 }, "", "#" + hash);
      else { pendingNav = hash; return void history.go(-(lv() - 1)); }   // 상세에서 다른 메뉴로: 메뉴 칸까지 돌아가서 바꿔 끼움
      return routeTop();
    }
    history.pushState({ lv: lv() + 1 }, "", "#" + hash);
    routeTop();
  }
  window.nav = nav;
  window.addEventListener("popstate", () => {
    if (popDone) { const f = popDone; popDone = null; popWait = null; return f(); }   // 우리가 닫은 창의 기록
    if (modalPushed && $("#modalRoot").innerHTML) { modalPushed = false; $("#modalRoot").innerHTML = ""; return; }   // 뒤로가기로 창 닫기
    if (pendingNav) { const h = pendingNav; pendingNav = null; history.replaceState({ lv: 1 }, "", "#" + h); }
    if (location.hash !== routed) routeTop();
  });
  window.addEventListener("hashchange", () => {   // 주소창에 직접 쓴 경우: 기록 단계를 붙여 둠
    if (!(history.state && "lv" in history.state)) history.replaceState({ lv: location.hash.includes("/") ? 2 : ["", "#", "#dashboard"].includes(location.hash) ? 0 : 1 }, "");
    if (location.hash !== routed) routeTop();
  });
  // 화면 안 링크(#…)도 같은 규칙으로
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    nav(a.getAttribute("href"));
  });
  // 이미 보고 있는 메뉴를 다시 누르면 새로 불러오기
  document.addEventListener("click", async (e) => {
    const a = e.target.closest(".side nav a");
    if (a && a.getAttribute("href") === location.hash) { e.preventDefault(); await loadAll(); route(); }
  });

  function updateTodoCount() {
    const n = S.apps.filter((a) => cardTodo(a).pending).length;
    $("#todoCount").textContent = n;
    $("#todoCount").classList.toggle("hidden", !n);
    $("#todoCount").closest(".nav-sec")?.classList.toggle("has-todo", !!n);
  }

  // ---------------------------------------------------------------- 파이프라인
  function cardTodo(a) {
    if (a.stage === "applied")
      return sent(a.id, "1") ? { text: "① 접수 확인 보냄" } : { text: "① 접수 확인 보내기", pending: true, code: "1" };
    if (a.stage === "interview") {
      if (!sent(a.id, "2")) return { text: "② 면접 일정 안내 보내기", pending: true, code: "2" };
      const n = new Set(S.evals.filter((e) => e.application_id === a.id && Object.keys(e.scores || {}).length).map((e) => e.interviewer_id)).size;
      return { text: `평가표 ${n}/${admins().length} 입력`, pending: false, partial: n < admins().length };
    }
    if (a.stage === "trainee") {
      const st = tstate(a), w = st.week;
      // ⑤는 3주차 시작 전(2주차 중), ⑥은 5주차 시작 전(4주차 중)에 보낼 차례
      if (w >= 4 && w <= 5 && !sent(a.id, "6")) return { text: "⑥ 인터뷰 일정 안내 보내기", pending: true, code: "6" };
      if (w >= 2 && w <= 5 && !sent(a.id, "5")) return { text: "⑤ 3주차 실전 투입 예고 보내기", pending: true, code: "5" };
      if (w > 5) return { text: "5주 완료 · 커피챗 후 전환 결정", pending: true };
      if (st.paused) return { text: `${st.nextWeek}주차 연기 · ${md(st.resume)} 재개`, partial: true };
      return { text: w === 0 ? "④ 수습 시작 안내 보냄" : `${w}주차 · ${TRAINEE_WEEKS[w - 1].title}` };
    }
    if (a.stage === "member")
      return sent(a.id, "7") ? { text: "⑦ 전환 통보 보냄" } : { text: "⑦ 전환 통보 보내기", pending: true, code: "7" };
    return { text: "" };
  }

  function cardMeta(a) {
    if (a.stage === "applied") return `${md(a.created_at.slice(0, 10))} 접수${a.small_group ? " · " + a.small_group : ""}`;
    if (a.stage === "interview") return a.interview_at ? `면접 ${fmtDateTime(a.interview_at)}${a.interview_place ? " · " + a.interview_place : ""}` : "면접 일정 미정";
    if (a.stage === "trainee") {
      const st = tstate(a), w = st.week;
      if (st.paused) return `수습 ${w}주차까지 · ${md(st.resume)}부터 ${st.nextWeek}주차`;
      return w === 0 ? `${fmtDate(st.resume, { weekday: "short" })} 수습 시작` : w > 5 ? "수습 5주 완료" : `수습 ${w}주차`;
    }
    if (a.stage === "member") return `${md((a.converted_at || a.stage_changed_at).slice(0, 10))} 정식 전환`;
    return "";
  }

  function renderPipeline() {
    const cutoff = addDays(todayISO(), -60);
    const byStage = (st) => S.apps.filter((a) => a.stage === st && (st !== "member" || (a.converted_at || a.stage_changed_at || "").slice(0, 10) >= cutoff));
    const closed = S.apps.filter((a) => a.stage === "closed").slice(0, 16);

    $("#content").innerHTML = `
      <div class="page-head">
        <h1 class="page-title">모집·수습</h1>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="small muted" style="font-weight:600">지원서에 보이는 모집 포지션</span>
          <span id="recruitChips" style="display:flex;gap:6px;flex-wrap:wrap"></span>
        </div>
      </div>
      <p class="lead">카드를 다음 단계로 끌어 놓으면 그 시점에 보낼 표준 안내 문구가 떠요. 민감한 안내(미선발·보류·재지원 권유)는 전화 먼저 하고 문자로 확인해요.</p>
      <div class="board">
        ${STAGES.map((st) => {
          const list = byStage(st.id);
          return `<section class="col" data-stage="${st.id}" aria-label="${st.title}">
            <div class="col-head"><h2>${st.title}</h2><span>${list.length}명</span></div>
            <p class="col-hint">${st.hint}</p>
            ${list.map(cardHTML).join("") || ""}
          </section>`;
        }).join("")}
      </div>
      <section class="endzone" id="endzone" aria-label="종료">
        <div style="display:flex;flex-direction:column;gap:2px;min-width:200px">
          <h2 style="font-size:15px;font-weight:800">종료</h2>
          <span class="small" style="color:var(--muted-2)">미선발 · 보류 · 재지원 권유 · 중도 하차 — 여기로 끌어 놓기</span>
        </div>
        <div class="ended">${closed.map((a) => `<a href="#app/${a.id}">${esc(a.name)}<small>${REASON[a.closed_reason] || ""}</small></a>`).join("") || `<span class="small muted">아직 없어요</span>`}</div>
        <div id="purgeBox" style="margin-left:auto"></div>
      </section>`;

    renderRecruitChips();
    renderPurgeBox();
    bindBoard();
    updateTodoCount();
  }

  // 종료 후 3개월 지난 지원서 일괄 삭제 (개인정보 파기)
  async function renderPurgeBox() {
    const { data } = await sb.rpc("purgeable_applications");
    const list = data || [];
    const box = $("#purgeBox"); if (!box) return;
    box.innerHTML = list.length
      ? `<button type="button" class="btn btn-danger btn-sm" id="purgeBtn">종료 3개월 지난 지원서 ${list.length}건 삭제</button>`
      : `<span class="small muted">종료 후 3개월 지난 지원서 없음</span>`;
    $("#purgeBtn")?.addEventListener("click", () => modal({
      title: `지원서 ${list.length}건 삭제`,
      body: `<p style="margin:0">미선발·보류·재지원 권유로 종료된 지 3개월이 지난 지원서예요. 지원서·서약·평가표·안내 기록이 모두 지워지고 되돌릴 수 없어요.</p>
        <ul style="margin:0;padding-left:18px;font-size:14px">${list.map((x) => `<li>${esc(x.name)} · ${REASON[x.closed_reason]} · ${fmtDate(x.closed_at, { year: "numeric", month: "numeric", day: "numeric" })} 종료</li>`).join("")}</ul>`,
      confirmLabel: `${list.length}건 삭제`, danger: true,
      onConfirm: async (close) => {
        const { data: n, error } = await sb.rpc("purge_closed_applications");
        if (error) throw new Error("삭제하지 못했습니다");
        await loadAll(); close(); toast(`지원서 ${n}건을 삭제했어요`); route();
      },
    }));
  }

  async function renderRecruitChips() {
    const ps = await loadPositions();
    $("#recruitChips").innerHTML = ps.map((p) =>
      `<button type="button" class="pillbtn" data-code="${p.code}" aria-pressed="${p.is_recruiting}">${esc(p.name)}</button>`).join("");
    $("#recruitChips").onclick = async (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const on = b.getAttribute("aria-pressed") !== "true";
      const { error } = await sb.from("positions").update({ is_recruiting: on }).eq("code", b.dataset.code);
      if (error) return toast("바꾸지 못했습니다");
      b.setAttribute("aria-pressed", String(on));
      await loadPositions(true);
      toast(`${positionName(b.dataset.code)} 모집 ${on ? "시작" : "마감"}`);
    };
  }

  function cardHTML(a) {
    const t = cardTodo(a);
    const st = STAGES[STAGE_IDX[a.stage]];
    const w = a.stage === "trainee" ? tstate(a).week : 0;
    return `<article class="kcard" draggable="true" data-id="${a.id}" style="${S.newIds.has(a.id) ? "border-color:var(--violet-mid);box-shadow:0 0 0 2px rgba(134,84,203,.2)" : ""}">
      <div class="row1"><a class="name" href="#app/${a.id}">${esc(a.name)}</a><span class="chip chip-violet">${esc(positionName(a.applied_position))}</span></div>
      ${["applied", "interview"].includes(a.stage) && alumniOf(a).length ? `<span class="chip chip-mid" style="align-self:flex-start">같은 이름 탈퇴 기록 · 재가입?</span>` : ""}
      <span class="meta">${esc(cardMeta(a))}</span>
      ${a.stage === "trainee" ? `<div class="weeks">${[1,2,3,4,5].map((i) => `<span class="${i < w ? "done" : i === w ? "now" : ""}"></span>`).join("")}</div>` : ""}
      ${t.text ? `<button type="button" class="todo ${t.pending ? "pending" : t.partial ? "pending" : "done"}" ${t.code ? `data-msg="${t.code}"` : "disabled"}>${esc(t.text)}</button>` : ""}
      ${st.next ? `<button type="button" class="next" data-next="${a.id}">${st.next}</button>` : ""}
    </article>`;
  }

  function bindBoard() {
    const board = $(".board"), end = $("#endzone");
    board.addEventListener("click", (e) => {
      const msg = e.target.closest("[data-msg]");
      if (msg) return openMessage(app(msg.closest(".kcard").dataset.id), msg.dataset.msg);
      const nx = e.target.closest("[data-next]");
      if (nx) { const a = app(nx.dataset.next); return openMove(a, STAGES[STAGE_IDX[a.stage] + 1].id); }
    });
    board.addEventListener("dragstart", (e) => {
      const c = e.target.closest(".kcard"); if (!c) return;
      S.drag = c.dataset.id; c.classList.add("dragging");
      e.dataTransfer.setData("text/plain", c.dataset.id); e.dataTransfer.effectAllowed = "move";
      const a = app(S.drag);
      const nextCol = $(`.col[data-stage="${STAGES[STAGE_IDX[a.stage] + 1]?.id}"]`);
      nextCol?.classList.add("drop-ok");
      if (a.stage !== "member") end.classList.add("drop-ok");
    });
    board.addEventListener("dragend", () => {
      S.drag = null;
      $$(".drop-ok").forEach((x) => x.classList.remove("drop-ok"));
      $$(".dragging").forEach((x) => x.classList.remove("dragging"));
    });
    const allowCol = (col) => S.drag && STAGE_IDX[app(S.drag).stage] + 1 === STAGE_IDX[col.dataset.stage];
    $$(".col").forEach((col) => {
      col.addEventListener("dragover", (e) => { if (allowCol(col)) e.preventDefault(); });
      col.addEventListener("drop", (e) => { e.preventDefault(); if (allowCol(col)) openMove(app(S.drag), col.dataset.stage); });
    });
    end.addEventListener("dragover", (e) => { if (S.drag && app(S.drag).stage !== "member") e.preventDefault(); });
    end.addEventListener("drop", (e) => { e.preventDefault(); if (S.drag) openMove(app(S.drag), "closed"); });
  }

  // ---------------------------------------------------------------- 모달
  function modal({ step, title, body, confirmLabel, onConfirm, onInput, cancelLabel = "취소", danger = false, wide = false }) {
    const root = $("#modalRoot");
    root.innerHTML = `<div class="modal-back"><div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="mTitle">
      ${step ? `<span class="step">${esc(step)}</span>` : ""}
      <h3 id="mTitle">${esc(title)}</h3>
      <div id="mBody" style="display:flex;flex-direction:column;gap:14px">${body}</div>
      <div class="actions"><button type="button" class="btn btn-ghost" id="mCancel">${cancelLabel}</button>
        ${confirmLabel ? `<button type="button" class="btn ${danger ? "btn-bad" : "btn-primary"}" id="mOk">${esc(confirmLabel)}</button>` : ""}</div>
    </div></div>`;
    if (!modalPushed) { history.pushState({ ...(history.state || {}), modal: true }, ""); modalPushed = true; }
    const close = () => {
      root.innerHTML = "";
      if (modalPushed) {   // 창이 쌓아 둔 기록을 걷어 냄 (뒤로가기 한 번 = 이전 화면)
        modalPushed = false;
        popWait = new Promise((ok) => (popDone = ok));
        history.back();
      }
    };
    curClose = close;
    $("#mCancel").onclick = close;
    $(".modal-back").addEventListener("click", (e) => { if (e.target.classList.contains("modal-back")) close(); });
    document.onkeydown = (e) => { if (e.key === "Escape") close(); };
    if (onInput) { $("#mBody").addEventListener("input", onInput); $("#mBody").addEventListener("click", onInput); onInput(); }
    if (onConfirm) $("#mOk").onclick = async () => {
      $("#mOk").disabled = true;
      try { await onConfirm(close); } catch (err) { toast(err.message || "처리하지 못했습니다", 4000); }
      if ($("#mOk")) $("#mOk").disabled = false;
    };
    ($("#modalRoot input, #modalRoot select, #modalRoot textarea") || $("#mOk") || $("#mCancel"))?.focus();
    return { close };
  }

  // ---------------------------------------------------------------- 푸시 알림 (013)
  const NOTIFY_NAME = { open: "섬김 응답 열림", minopen: "사역 응답 열림", poll: "연습 시간 요청", remind: "마감 임박", lineup: "배치표 공개", practice: "연습 시간 확정", apply: "새 지원서", trainee: "수습 기록 차례", notice: "리더 공지",
    prayer_new: "기도제목 올라옴", prayer_remind: "주중 함께 기도", prayer_urgent: "급한 기도", birthday_soon: "생일 다가옴", birthday_today: "생일 당일",
    conti_open: "콘티 준비 안내", conti_remind: "콘티 마감 임박", conti_up: "콘티 올라옴", conti_edit: "콘티 수정됨",
    sat_vote: "연습 시간 변경 투표", sat_decide: "연습 시간 결정 · 취소", proc: "예배 진행곡 바뀜" };
  async function notifyEnabled(kind) {
    const { data } = await sb.from("notify_settings").select("enabled").eq("kind", kind).maybeSingle();
    return data ? data.enabled : true;
  }
  async function sentAny(keys) {
    if (!keys.length) return false;
    const { data } = await sb.from("notify_sent").select("key").in("key", keys);
    return (data || []).length > 0;
  }
  // 확인 창 안 '푸시 알림도 보내기' — 처음 보내는 거면 켜진 채로, 이미 보냈으면 꺼진 채로
  async function pushRow(kind, keys, who) {
    if (!(await notifyEnabled(kind))) return `<p class="small muted" style="margin:0">푸시 알림: '${NOTIFY_NAME[kind]}'은 공지 · 알림 › 알림 설정에서 꺼져 있어요.</p>`;
    const again = await sentAny(keys);
    return `<label class="pushrow"><input type="checkbox" id="pushChk" ${again ? "" : "checked"}><span><b>푸시 알림도 보내기</b><small>${esc(who)}${again ? " · 이미 한 번 보냈어요" : ""}</small></span></label>`;
  }
  const pushChecked = () => !!$("#pushChk")?.checked;
  async function sendPush(kind, params) {
    try {
      const r = await api("/api/notify", { kind, ...params });
      if (r.skipped) return "";
      return r.noPushReady ? ` · 알림함 ${r.recipients}명 (푸시 키 설정 필요)` : ` · 푸시 ${r.pushed}명 / 알림함 ${r.recipients}명`;
    } catch (e) { return ` · 알림을 보내지 못했어요 (${e.message})`; }
  }
  const msgOnly = (text) => `<div class="msg" id="mMsg">${esc(text)}</div>`;

  // ---------------------------------------------------------------- 보내기 창 (014)
  //  팀원에게 가는 안내·독촉: 푸시 발송 + 카톡 문구 복사(푸시를 못 받는 사람용)를 한 창에서
  //  o = { title, ctx: 같은 안내끼리 묶는 키, label: 보낸 기록 이름, url,
  //        groups: [{ id, label, people }], push(sel) → { title, body }, text(sel, names) → 카톡 문구 }
  const warnHours = () => S.settings?.resend_warn_hours ?? 24;
  async function recentSends(ctx) {
    if (!ctx) return [];
    const { data } = await sb.from("notifications").select("id, created_at, created_by, recipients, pushed, notification_inbox(member_id)")
      .eq("ctx_key", ctx).order("created_at", { ascending: false }).limit(5);
    return data || [];
  }
  const sentLine = (n) => `${fmtDateTime(n.created_at)} · ${esc(n.created_by ? memberName(n.created_by) : "자동")} · 푸시 ${n.pushed}명 / 알림함 ${n.recipients}명`;
  async function openSend(o) {
    const groups = o.groups.filter((g) => g.people.length);
    if (!groups.length) return toast("보낼 사람이 없어요");
    const sel = new Set(groups.map((g) => g.id));
    const [{ data: subs }, recent] = await Promise.all([sb.from("push_subscriptions").select("member_id"), recentSends(o.ctx)]);
    const canPush = new Set((subs || []).map((s) => s.member_id));
    const H = warnHours(), since = Date.now() - H * 3600e3;
    const touched = (o.edited = { title: false, body: false, text: false });
    const people = () => { const seen = new Map(); groups.filter((g) => sel.has(g.id)).forEach((g) => g.people.forEach((m) => seen.set(m.id, m))); return [...seen.values()]; };
    const split = () => { const ps = people(); return { ps, yes: ps.filter((m) => canPush.has(m.id)), no: ps.filter((m) => !canPush.has(m.id)) }; };
    const kakaoNames = () => { const { ps, yes, no } = split(); return yes.length && no.length ? no : ps; };
    const first = o.push([...sel]);
    modal({ title: o.title, wide: true, cancelLabel: "닫기", confirmLabel: "푸시 보내기",
      body: `${groups.length > 1 ? `<div class="row" id="sGroups">${groups.map((g) => `<label class="pillchk"><input type="checkbox" data-g="${g.id}" checked> ${esc(g.label)} ${g.people.length}명</label>`).join("")}</div>` : ""}
        <div class="sendwho" id="sWho"></div>
        <div id="sWarn"></div>
        <section class="sendbox"><div class="sendhd"><b>푸시 알림</b><span class="small muted" id="sPushN"></span></div>
          <label class="field">제목<input type="text" id="sT" maxlength="80" value="${esc(first.title)}"></label>
          <label class="field">내용<textarea id="sB" maxlength="500" style="min-height:64px">${esc(first.body)}</textarea></label>
          <div class="phone-pv"><img src="assets/icon-192.png" alt=""><span><small>Pole2 찬양팀 · 지금</small><b id="sPT"></b><span class="pb" id="sPB"></span></span></div>
          <span class="small muted">알림을 누르면 팀원 화면의 해당 페이지가 열려요. 알림을 꺼 둔 사람도 앱 안 알림함에는 남아요.</span></section>
        <section class="sendbox"><div class="sendhd"><b>카톡 문구</b><button type="button" class="btn btn-soft btn-sm" id="sCopy">문구 복사</button></div>
          <span class="small muted" id="sCopyHint"></span>
          <textarea class="input" id="sText" style="min-height:130px">${esc(o.text([...sel], kakaoNames()))}</textarea></section>
        ${recent.length ? `<details class="sendlog"${recent.some((n) => Date.parse(n.created_at) > since) ? " open" : ""}><summary>보낸 기록 ${recent.length}건</summary>
          <ul>${recent.map((n) => `<li>${sentLine(n)}</li>`).join("")}</ul></details>` : ""}`,
      onInput: (e) => {
        if (e?.target?.dataset?.g) {
          e.target.checked ? sel.add(e.target.dataset.g) : sel.delete(e.target.dataset.g);
          const nx = o.push([...sel]);
          if (!touched.title) $("#sT").value = nx.title;
          if (!touched.body) $("#sB").value = nx.body;
        }
        if (e?.type === "input" && ["sT", "sB", "sText"].includes(e.target.id)) touched[{ sT: "title", sB: "body", sText: "text" }[e.target.id]] = true;
        const { ps, yes, no } = split();
        if (!touched.text) $("#sText").value = o.text([...sel], kakaoNames());
        $("#sWho").innerHTML = `<b>대상 ${ps.length}명</b><span>푸시 받을 수 있는 ${yes.length}명 · 못 받는 ${no.length}명</span>
          <div class="ppl">${ps.map((m) => `<span class="${canPush.has(m.id) ? "on" : ""}" title="${canPush.has(m.id) ? "알림 켠 기기 있음" : "알림 켠 기기 없음"}">${esc(m.name)}</span>`).join("")}</div>`;
        const again = recent.filter((n) => Date.parse(n.created_at) > since)
          .map((n) => ({ n, hit: ps.filter((m) => (n.notification_inbox || []).some((x) => x.member_id === m.id)) })).filter((x) => x.hit.length);
        $("#sWarn").innerHTML = H && again.length ? `<div class="notice warn" style="margin:0">${again.map(({ n, hit }) =>
          `${fmtDateTime(n.created_at)}에 ${esc(n.created_by ? memberName(n.created_by) : "자동")}님이 이미 보냈어요. 지금 대상 중 ${hit.length}명(${hit.slice(0, 4).map((m) => esc(m.name)).join(", ")}${hit.length > 4 ? " 외" : ""})이 ${H}시간 안에 받았어요.`).join("<br>")}</div>` : "";
        $("#sPushN").textContent = yes.length ? `${yes.length}명 휴대폰으로 · ${ps.length}명 알림함에` : `알림 켠 사람이 없어서 알림함에만 남아요`;
        $("#sCopyHint").textContent = yes.length && no.length ? `푸시를 못 받는 ${no.length}명(${no.slice(0, 5).map((m) => m.name).join(", ")}${no.length > 5 ? " 외" : ""})에게 카톡으로 보낼 때 써요.` : yes.length ? "모두 푸시를 받을 수 있어요. 단체방에 함께 올릴 때 써요." : "아직 아무도 알림을 켜지 않았어요. 카톡으로 보내 주세요.";
        $("#sPT").textContent = $("#sT").value || " "; $("#sPB").textContent = $("#sB").value;
        const ok = $("#mOk"); if (ok) { ok.textContent = `${again.length && H ? "그래도 " : ""}푸시 보내기 · ${ps.length}명`; ok.disabled = !ps.length; ok.classList.toggle("btn-bad", !!(again.length && H)); }
      },
      onConfirm: async (close) => {
        const { ps } = split();
        if (!$("#sT").value.trim()) throw new Error("알림 제목을 적어 주세요");
        const r = await api("/api/notify", { kind: "message", title: $("#sT").value, body: $("#sB").value, member_ids: ps.map((m) => m.id), url: (typeof o.url === "function" ? o.url([...sel]) : o.url) || "/me.html#respond", ctx_key: o.ctx, label: o.label });
        close();
        toast(r.noPushReady ? `알림함 ${r.recipients}명에게 남겼어요 (푸시 키 설정 필요)` : `보냈어요 · 푸시 ${r.pushed}명 / 알림함 ${r.recipients}명`, 4000);
        o.after?.();
      } });
    $("#sCopy").onclick = async () => toast((await copyText($("#sText").value)) ? "카톡 문구를 복사했어요" : "복사하지 못했어요. 문구를 길게 눌러 복사해 주세요");
  }
  const dlText = (d) => d ? fmtDate(d, { month: "long", day: "numeric", weekday: "short" }) + "까지" : "";
  const namesNim = (list) => list.map((m) => m.name + "님").join(", ");

  const msgBox = (text) => `<div class="msg" id="mMsg">${esc(text)}</div>
    <p class="small muted" style="margin:0">남은 [대괄호] 부분을 채워서 보내 주세요. 보낸 기록이 남아요.</p>`;
  const sensitiveNote = `<p class="notice warn" style="margin:0">민감한 안내예요. 전화로 먼저 이야기한 뒤 이 문구로 확인해 주세요.</p>`;

  // 단계와 무관하게 안내 문구 보내기 (①⑤⑥⑦ 등)
  function openMessage(a, code) {
    const t = tpl(code); if (!t) return toast("안내 문구를 찾을 수 없습니다");
    const text = fillTemplate(t.body, ctxOf(a));
    modal({
      step: t.timing, title: `${a.name}님 · ${t.title}`,
      body: (t.sensitive ? sensitiveNote : "") + msgBox(text),
      confirmLabel: "문구 복사하고 보냄 기록",
      onConfirm: async (close) => {
        await copyText($("#mMsg").textContent);
        await logMessage(a.id, code);
        close(); toast("문구를 복사했어요. 카톡에 붙여 넣어 보내 주세요"); route();
      },
    });
  }

  function openMove(a, to) {
    const from = a.stage;
    if (to === "interview") return moveToInterview(a);
    if (to === "trainee") return moveToTrainee(a);
    if (to === "member") return moveToMember(a);
    if (to === "closed") return moveToClosed(a, from);
  }

  function moveToInterview(a) {
    const t = tpl("2");
    modal({
      step: t.timing, title: `${a.name}님 · 접수 → 면접`,
      body: `<div class="grid2">
          <label class="field">면접 일시<input type="datetime-local" id="ivAt"></label>
          <label class="field">면접 장소<input type="text" id="ivPlace" maxlength="100" placeholder="예: 본당 2층"></label>
        </div>${msgBox("")}`,
      onInput: () => { $("#mMsg").textContent = fillTemplate(t.body, ctxOf(a, { interviewAt: kst($("#ivAt").value), interviewPlace: $("#ivPlace").value.trim() })); },
      confirmLabel: "문구 복사하고 면접으로 이동",
      onConfirm: async (close) => {
        const at = kst($("#ivAt").value), place = $("#ivPlace").value.trim() || null;
        const { error } = await sb.rpc("advance_application", { p_id: a.id, p_to: "interview", p_interview_at: at, p_interview_place: place });
        if (error) throw new Error(error.message);
        await copyText($("#mMsg").textContent);
        await logMessage(a.id, "2");
        Object.assign(a, { stage: "interview", interview_at: at, interview_place: place, stage_changed_at: new Date().toISOString() });
        close(); toast("면접으로 옮겼어요. 문구를 복사했어요"); route();
      },
    });
  }
  const kst = (v) => (v ? new Date(v + ":00+09:00").toISOString() : null);

  function moveToTrainee(a) {
    const t = tpl("4");
    const myEvals = S.evals.filter((e) => e.application_id === a.id);
    const weak = myEvals.reduce((n, e) => n + Object.values(e.scores || {}).filter((v) => v === "weak").length, 0);
    const prev = alumniOf(a);
    const rejoinMsg = (extra = {}) => fillTemplate(`안녕하세요, [이름]님.\n폴투공동체 찬양팀장입니다.\n\n다시 찬양팀으로 돌아와 주셔서 감사하고 반가워요. 면담에서 나눈 대로 수습 없이 바로 함께하게 되었습니다.\n\n로그인해서 섬김 응답과 배치표를 확인할 수 있어요.\n· 주소: [사이트 주소]\n· 아이디: [아이디]\n· 임시 비밀번호: [임시 비밀번호]\n(첫 로그인 때 비밀번호를 바꿔 주세요)\n\n다시 함께 걸어갈 날들을 기대하며 기도하겠습니다.\n\n폴투공동체 찬양팀장 드림`, ctxOf(a, extra));
    modal({
      step: t.timing, title: `${a.name}님 · 면접 → 수습 시작`,
      body: `${prev.length ? `<div class="notice warn" style="margin:0;display:flex;flex-direction:column;gap:8px">
            <span>같은 이름의 탈퇴 기록이 있어요: ${prev.map((x) => `${esc(positionName(x.main_position))} · ${x.joined_at ? md(x.joined_at.slice(0, 10)) + " ~ " : ""}${md(x.left_at)} 탈퇴${x.reason ? " (" + esc(x.reason) + ")" : ""}`).join(" / ")}</span>
            <label style="display:flex;gap:8px;align-items:center;font-weight:700;color:var(--ink)"><input type="checkbox" id="rejoin" style="width:18px;height:18px;accent-color:var(--violet)"> 재가입 — 면담만 하고 수습 없이 바로 정식 (규정 제3조 바항)</label></div>` : ""}
        <div id="traineeFields" style="display:flex;flex-direction:column;gap:14px">
        ${weak ? `<p class="notice warn" style="margin:0">평가표에 '미흡'이 ${weak}개 있어요. 판정 기준상 보류 또는 조건부 수습을 검토해 주세요.</p>` : ""}
        <div class="field"><span>면접 결과</span>
          <div class="seg" id="res"><button type="button" data-v="pass" aria-pressed="${weak ? "false" : "true"}">합격 (수습 전환)</button><button type="button" data-v="pass_cond" aria-pressed="${weak ? "true" : "false"}">조건부 수습</button></div></div>
        <label class="field" id="condWrap">조건 (수습 때 함께 볼 점)<input type="text" id="cond" maxlength="500" placeholder="예: 합주 시 타 파트 청취 보완"></label>
        </div>
        <div class="grid2">
          <label class="field">주 포지션<select id="pos"></select></label>
          <label class="field" id="startWrap">수습 시작일 (토요일)<input type="date" id="start" value="${nextSaturday()}"></label>
        </div>
        <p class="small muted" style="margin:0">로그인 계정이 만들어지고, 임시 비밀번호가 아래 문구에 들어가요.</p>
        ${msgBox("")}`,
      onInput: (e) => {
        if (e?.target?.closest?.("#res button")) {
          $$("#res button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.target.closest("button"))));
        }
        const rj = !!$("#rejoin")?.checked;
        $("#traineeFields").classList.toggle("hidden", rj);
        $("#startWrap").classList.toggle("hidden", rj);
        $("#condWrap").classList.toggle("hidden", rj || $("#res [aria-pressed=true]").dataset.v !== "pass_cond");
        $("#mMsg").textContent = rj ? rejoinMsg() : fillTemplate(t.body, ctxOf(a, { traineeStart: $("#start").value }));
        $("#mOk").textContent = rj ? "계정 만들고 바로 정식 전환" : "계정 만들고 수습 시작";
      },
      confirmLabel: "계정 만들고 수습 시작",
      onConfirm: async (close) => {
        const rj = !!$("#rejoin")?.checked;
        const result = $("#res [aria-pressed=true]").dataset.v;
        const start = $("#start").value;
        if (!rj && !start) throw new Error("수습 시작일을 정해 주세요.");
        const r = await api("/api/start-trainee", rj
          ? { applicationId: a.id, mainPosition: $("#pos").value, rejoin: true }
          : { applicationId: a.id, mainPosition: $("#pos").value, startDate: start, result, condition: $("#cond").value });
        await logMessage(a.id, rj ? "7" : "4");
        await loadAll();
        const text = rj ? rejoinMsg({ tempPassword: r.tempPassword }) : fillTemplate(t.body, ctxOf(app(a.id), { tempPassword: r.tempPassword }));
        close();
        modal({
          step: rj ? "재가입 안내" : "③ 합격 + ④ 수습 시작 안내", title: rj ? `${a.name}님 다시 함께해요` : `${a.name}님 수습을 시작했어요`,
          body: `<p style="margin:0">임시 비밀번호 <span class="temp-pw">${esc(r.tempPassword)}</span></p>
            <p class="small muted" style="margin:0">임시 비밀번호는 지금 한 번만 보여요. 문구를 복사해 카톡으로 보내 주세요.</p>${msgBox(text)}`,
          cancelLabel: "닫기", confirmLabel: "문구 복사",
          onConfirm: async () => { toast((await copyText(text)) ? "복사했어요" : "복사하지 못했어요. 문구를 길게 눌러 복사해 주세요"); },
        });
        route();
      },
    });
    loadPositions().then((ps) => {
      $("#pos").innerHTML = ps.map((p) => `<option value="${p.code}" ${p.code === a.applied_position ? "selected" : ""}>${esc(p.name)}</option>`).join("");
    });
  }

  function moveToMember(a) {
    const t = tpl("7");
    modal({
      step: t.timing, title: `${a.name}님 · 수습 → 정식 전환`,
      body: `<p style="margin:0">5주차 커피챗에서 전환을 결정했다면 진행해 주세요. 멤버 화면에서 '수습' 표시가 사라지고 섬김 배치 대상이 돼요.</p>${msgBox(fillTemplate(t.body, ctxOf(a)))}`,
      confirmLabel: "문구 복사하고 정식 전환",
      onConfirm: async (close) => {
        const { error } = await sb.rpc("advance_application", { p_id: a.id, p_to: "member" });
        if (error) throw new Error(error.message);
        await copyText($("#mMsg").textContent);
        await logMessage(a.id, "7");
        await loadAll();
        close(); toast(`${a.name}님을 정식 팀원으로 맞이했어요`); route();
      },
    });
  }

  function moveToClosed(a, from) {
    const options = from === "applied" ? ["not_selected"] : from === "interview" ? ["hold", "reapply", "not_selected"] : ["hold", "withdrawn"];
    modal({
      step: "종료", title: `${a.name}님 · ${STAGES[STAGE_IDX[from]].title} → 종료`,
      body: `<div class="field"><span>종료 사유</span><div class="seg" id="why">${options.map((o, i) =>
          `<button type="button" data-v="${o}" aria-pressed="${i === 0}">${REASON[o]}</button>`).join("")}</div></div>
        ${from === "trainee" ? `<p class="small muted" style="margin:0">수습생 계정은 로그인할 수 없게 바뀌어요.</p>` : ""}
        <div id="whyMsg"></div>`,
      onInput: (e) => {
        if (e?.target?.closest?.("#why button")) $$("#why button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.target.closest("button"))));
        const code = REASON_TPL[$("#why [aria-pressed=true]").dataset.v];
        const t = code && tpl(code);
        if (!$("#whyMsg").dataset.code || $("#whyMsg").dataset.code !== String(code)) {
          $("#whyMsg").dataset.code = String(code);
          $("#whyMsg").innerHTML = t ? `<span class="step" style="font-size:13px;font-weight:700;color:var(--violet-mid)">${esc(t.title)}</span>${sensitiveNote}${msgBox(fillTemplate(t.body, ctxOf(a)))}`
            : `<p class="small muted" style="margin:0">보낼 표준 문구가 없는 사유예요.</p>`;
        }
      },
      confirmLabel: "종료 처리",
      onConfirm: async (close) => {
        const reason = $("#why [aria-pressed=true]").dataset.v;
        const { error } = await sb.rpc("advance_application", { p_id: a.id, p_to: "closed", p_reason: reason });
        if (error) throw new Error(error.message);
        const code = REASON_TPL[reason];
        if (code) { await copyText($("#mMsg").textContent); await logMessage(a.id, code); }
        await loadAll();
        close(); toast(code ? "종료했어요. 문구를 복사했어요" : "종료했어요"); route();
      },
    });
  }

  // ---------------------------------------------------------------- 지원자 상세
  let detailTab = null;
  const deepSeen = new Set();   // 알림으로 들어온 주소는 한 번만 그 자리로 (015)
  async function renderDetail(id, sub) {
    const a = app(id);
    if (!a) { $("#content").innerHTML = `<div class="empty">지원자를 찾을 수 없습니다. 이미 지워졌을 수 있어요. <a href="#pipeline">모집·수습으로</a></div>`; return; }
    const { data: weeks } = await sb.from("trainee_weeks").select("*").eq("application_id", id).order("week");
    const deepWeek = /^week[1-5]$/.test(sub || "") && !deepSeen.has(location.hash) ? +sub.slice(4) : 0;
    if (deepWeek) { deepSeen.add(location.hash); detailTab = { id, tab: "trainee" }; }
    if (!detailTab || detailTab.id !== id) detailTab = { id, tab: a.stage === "trainee" || a.stage === "member" ? "trainee" : "eval" };

    const order = ["applied", "interview", "trainee", "member"];
    const reached = a.stage === "closed" ? order.indexOf(a.closed_from) : order.indexOf(a.stage);
    const stageLabel = { applied: "지원", interview: "면접", trainee: "수습", member: "정식 전환" };
    const stages = order.map((s, i) => {
      if (a.stage === "closed" && i === reached) return `<li class="closed">${stageLabel[s]} · ${REASON[a.closed_reason]}</li>`;
      if (i < reached) return `<li>${stageLabel[s]} 완료</li>`;
      if (i === reached) {
        const tw = tstate(a);
        const label = s !== "trainee" ? stageLabel[s] : tw.paused ? `수습 ${tw.nextWeek}주차 연기 중` : tw.week ? `수습 ${Math.min(tw.week, 5)}주차` : "수습 시작 전";
        return `<li class="now">${label}</li>`;
      }
      return `<li class="todo">${stageLabel[s]}</li>`;
    }).join("");
    const nextSt = STAGES[STAGE_IDX[a.stage] + 1];
    const active = ["applied", "interview", "trainee"].includes(a.stage);

    const tabs = [["eval", "면접 평가표"], ...(a.trainee_start ? [["trainee", "수습 기록"]] : []), ["app", "지원서"], ["log", "안내 기록"]];
    if (!tabs.some(([k]) => k === detailTab.tab)) detailTab.tab = "eval";

    $("#content").innerHTML = `
      <a href="#pipeline" style="font-size:14px;font-weight:600;text-decoration:none;align-self:flex-start">모집·수습으로 돌아가기</a>
      <section class="headcard">
        <div style="display:flex;flex-direction:column;gap:6px">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h1 class="page-title">${esc(a.name)}</h1>
            <span class="chip chip-violet">${esc(positionName(a.applied_position))}</span></div>
          <span class="small muted">${esc(a.phone)} · ${esc(a.email)}${a.small_group ? " · " + esc(a.small_group) : ""} · ${md(a.created_at.slice(0, 10))} 지원</span>
        </div>
        <ol class="stages" aria-label="진행 단계">${stages}</ol>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <select class="select" id="sendSel" aria-label="안내 문구 보내기" style="width:auto;min-height:44px"><option value="">안내 문구 보내기…</option>
            ${S.templates.map((t) => `<option value="${t.code}">${esc(t.title)}${sent(a.id, t.code) ? " ✓" : ""}</option>`).join("")}</select>
          ${active && nextSt ? `<button type="button" class="btn btn-primary" id="dNext">${nextSt && STAGES[STAGE_IDX[a.stage]].next}</button>` : ""}
          ${active ? `<button type="button" class="btn btn-danger" id="dClose">종료</button>` : ""}
        </div>
      </section>
      <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${detailTab.tab === k}">${l}</button>`).join("")}</div>
      <div id="tabBody"></div>`;

    $("#sendSel").onchange = (e) => { if (e.target.value) { openMessage(a, e.target.value); e.target.value = ""; } };
    $("#dNext")?.addEventListener("click", () => openMove(a, nextSt.id));
    $("#dClose")?.addEventListener("click", () => openMove(a, "closed"));
    $(".tabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) { detailTab.tab = b.dataset.tab; renderDetail(id); } };

    const body = $("#tabBody");
    if (detailTab.tab === "eval") renderEval(a, body);
    if (detailTab.tab === "trainee") renderWeeks(a, weeks || [], body);
    if (deepWeek) {
      const row = body.querySelector(`.weekrow[data-week="${deepWeek}"]`);
      if (row) {
        row.scrollIntoView({ block: "center" }); row.classList.add("deep-hit");
        const note = row.querySelector("[data-field=note]");
        if (note && !note.value.trim()) note.focus({ preventScroll: true });
        else toast(`${deepWeek}주차 기록은 이미 남겼어요. 고칠 수 있어요`, 3500);
      }
    }
    if (detailTab.tab === "app") renderAppTab(a, body);
    if (detailTab.tab === "log") renderLog(a, body);
  }

  function renderEval(a, body) {
    const evals = S.evals.filter((e) => e.application_id === a.id);
    const mine = evals.find((e) => e.interviewer_id === S.me.id) || { scores: {}, note: "" };
    const others = admins().filter((m) => m.id !== S.me.id);
    const weak = evals.reduce((n, e) => n + Object.values(e.scores || {}).filter((v) => v === "weak").length, 0);
    const filled = Object.keys(mine.scores || {}).length;
    const chip = (v) => v ? `<span class="chip ${v === "ok" ? "chip-ok" : v === "mid" ? "chip-mid" : "chip-bad"}">${SCORE[v]}</span>` : `<span class="small" style="color:var(--faint)">—</span>`;
    let prevArea = null;
    body.innerHTML = `<section style="display:flex;flex-direction:column;gap:14px">
      <div class="verdict ${weak ? "warn" : "ok"}"><b>${weak ? `'미흡' ${weak}개 — 보류 또는 조건부 수습 검토` : "'미흡' 없음"}</b>
        <span class="small">내 평가 ${filled} / ${S.items.length} 입력 · 판정 기준: '미흡' 1개 이상이면 보류 또는 조건부 수습</span></div>
      ${a.interview_result ? `<p class="notice ${a.interview_result.startsWith("pass") ? "ok" : "warn"}" style="margin:0">면접 결과: ${RESULT[a.interview_result]}${a.interview_condition ? " · 조건: " + esc(a.interview_condition) : ""}</p>` : ""}
      <div class="evaltable"><table>
        <thead><tr><th>영역</th><th>항목</th>${others.map((m) => `<th>${esc(m.name)}</th>`).join("")}<th class="me">내 평가 · ${esc(S.me.name)}</th></tr></thead>
        <tbody>${S.items.map((it) => {
          const start = it.area !== prevArea; prevArea = it.area;
          return `<tr class="${start ? "area-start" : ""}"><td class="area">${start ? esc(it.area) : ""}</td><td style="font-weight:600">${esc(it.label)}</td>
            ${others.map((m) => `<td>${chip(evals.find((e) => e.interviewer_id === m.id)?.scores?.[it.code])}</td>`).join("")}
            <td><div class="seg" role="radiogroup" aria-label="${esc(it.label)}" data-item="${it.code}">${["ok", "mid", "weak"].map((k) =>
              `<button type="button" data-v="${k}" data-tone="${k}" aria-pressed="${mine.scores?.[it.code] === k}">${SCORE[k]}</button>`).join("")}</div></td></tr>`;
        }).join("")}</tbody></table></div>
      <div class="notes3">
        ${others.map((m) => `<div><b>${esc(m.name)} 메모</b><span style="white-space:pre-wrap">${esc(evals.find((e) => e.interviewer_id === m.id)?.note) || `<span class="muted small">아직 없어요</span>`}</span></div>`).join("")}
        <label style="border-color:var(--violet-soft)"><b style="color:var(--violet)">내 메모</b>
          <textarea id="myNote" maxlength="1000" placeholder="면접에서 나눈 이야기, 수습 때 함께 볼 점" style="border:0;padding:0;min-height:60px;resize:vertical;outline:none;font-size:14px">${esc(mine.note || "")}</textarea></label>
      </div></section>`;

    const save = async (patch) => {
      const cur = S.evals.find((e) => e.application_id === a.id && e.interviewer_id === S.me.id);
      const row = { application_id: a.id, interviewer_id: S.me.id, scores: cur?.scores || {}, note: cur?.note ?? null, ...patch };
      const { data, error } = await sb.from("interview_evaluations").upsert(row).select().single();
      if (error) { toast("저장하지 못했습니다"); return false; }
      S.evals = S.evals.filter((e) => !(e.application_id === a.id && e.interviewer_id === S.me.id)).concat([data]);
      return true;
    };
    body.querySelectorAll(".seg[data-item]").forEach((g) => g.addEventListener("click", async (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const cur = S.evals.find((x) => x.application_id === a.id && x.interviewer_id === S.me.id)?.scores || {};
      const scores = { ...cur };
      if (scores[g.dataset.item] === b.dataset.v) delete scores[g.dataset.item]; else scores[g.dataset.item] = b.dataset.v;
      if (await save({ scores })) renderEval(a, body);
    }));
    $("#myNote").addEventListener("change", async (e) => { if (await save({ note: e.target.value.trim() || null })) toast("메모를 저장했어요"); });
  }

  function renderWeeks(a, weeks, body) {
    const leaders = admins();
    const list = pp(a.id), st = tstate(a), w = st.week;
    const canPostpone = (n) => a.stage === "trainee" && n >= Math.max(st.paused ? st.nextWeek : w, 1);
    const attSeg = (field, val) => `<div class="seg" data-field="${field}">
      <button type="button" data-v="true" data-tone="ok" aria-pressed="${val === true}">참석</button>
      <button type="button" data-v="false" data-tone="no" aria-pressed="${val === false}">불참</button></div>`;
    body.innerHTML = `<section style="display:flex;flex-direction:column;gap:12px">
      <p class="lead" style="margin:0">그 주 나눔을 맡은 리더가 3줄로 남겨요. 5주차 커피챗에서 이 기록을 함께 보고 전환을 결정해요.</p>
      ${a.interview_condition ? `<p class="notice warn" style="margin:0">조건부 수습 · ${esc(a.interview_condition)}</p>` : ""}
      ${st.paused ? `<p class="notice warn" style="margin:0">${st.nextWeek}주차가 미뤄져 있어요 · ${fmtDate(st.resume, { weekday: "short" })}부터 다시 시작해요</p>` : ""}
      ${[1, 2, 3, 4, 5].map((n) => {
        const r = weeks.find((x) => x.week === n) || { week: n };
        const info = TRAINEE_WEEKS[n - 1];
        const sat = traineeWeekSat(a.trainee_start, n, list);
        const moved = list.filter((p) => p.from_week === n).map((p) => `
          <div class="postpone" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:10px 14px;border-radius:12px;background:var(--warn-bg);color:var(--warn);font-size:14px;font-weight:600">
            <span>${n}주차부터 ${p.weeks}주 연기${p.reason ? " · " + esc(p.reason) : ""}</span>
            <span class="small" style="font-weight:500;color:#8A5A3A">${esc(memberName(p.created_by))} · ${fmtDate(p.created_at)}</span>
            ${a.stage === "trainee" ? `<button type="button" class="btn btn-ghost btn-sm" data-undo="${p.id}" style="margin-left:auto">되돌리기</button>` : ""}
          </div>`).join("");
        return `${moved}<article class="weekrow ${n === w && !st.paused ? "now" : ""}" data-week="${n}">
          <div style="display:flex;flex-direction:column;gap:4px"><span class="wk">${n}주</span><span class="wt">${esc(info.title)}</span>
            <span class="small muted">${md(sat)} – ${md(addDays(sat, 1))}</span>
            ${canPostpone(n) ? `<button type="button" class="btn btn-ghost btn-sm" data-postpone="${n}" style="align-self:flex-start;margin-top:6px">이 주부터 미루기</button>` : ""}</div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;flex-direction:column;gap:4px"><span class="small muted" style="font-weight:700">토 연습</span>${attSeg("sat_attended", r.sat_attended)}</div>
            <div style="display:flex;flex-direction:column;gap:4px"><span class="small muted" style="font-weight:700">주일 9시 참관</span>${attSeg("sun_attended", r.sun_attended)}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <label class="field" style="font-size:13px">${n === 5 ? "커피챗" : "나눔 리더"}<select class="select" data-field="leader_id" style="min-height:40px;font-size:15px">
              <option value="">선택</option>${leaders.map((m) => `<option value="${m.id}" ${r.leader_id === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></label>
            <textarea class="input" data-field="note" maxlength="500" placeholder="나눔 후 3줄로 남겨 주세요">${esc(r.note || "")}</textarea>
            <div data-wconflict></div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
              <span class="small muted">${r.updated_by ? `${esc(memberName(r.updated_by))} · ${fmtDate(r.updated_at)} 저장` : ""}</span>
              <button type="button" class="btn btn-soft btn-sm" data-save>저장</button></div>
          </div></article>`;
      }).join("")}
      ${a.stage === "trainee" ? `<div class="decision"><span style="display:flex;flex-direction:column;gap:2px;margin-right:8px"><b style="font-size:15px">5주차 커피챗 결정</b>
        <span class="small muted">정식 전환을 누르면 ⑦ 전환 통보 문구가 떠요</span></span>
        <button type="button" class="btn btn-primary" id="decConvert">정식 전환</button>
        <button type="button" class="btn btn-ghost" id="decClose">보류 · 중도 하차</button></div>` : ""}
    </section>`;

    body.querySelectorAll(".weekrow").forEach((row) => {
      row.querySelectorAll(".seg").forEach((g) => g.addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        const on = b.getAttribute("aria-pressed") !== "true";
        g.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(on && x === b)));
      }));
      // 020: 연 때의 값 기준으로 저장 — 같은 주차를 다른 리더가 먼저 고쳤으면 덮어쓰지 않고 알려 줌
      const r0 = weeks.find((x) => x.week === +row.dataset.week) || {};
      const wbase = { leader_id: r0.leader_id ?? null, sat_attended: r0.sat_attended ?? null, sun_attended: r0.sun_attended ?? null, note: r0.note ?? null };
      row.querySelector("[data-save]").addEventListener("click", async (ev) => {
        const val = (f) => { const p = row.querySelector(`.seg[data-field=${f}] [aria-pressed=true]`); return p ? p.dataset.v === "true" : null; };
        const week = +row.dataset.week;
        const after = {
          sat_attended: val("sat_attended"), sun_attended: val("sun_attended"),
          leader_id: row.querySelector("[data-field=leader_id]").value || null,
          note: row.querySelector("[data-field=note]").value.trim() || null,
        };
        const btn = ev.currentTarget; btn.disabled = true;
        let res;
        try { res = await saveRpc("save_fields", { p_table: "trainee_weeks", p_key: { application_id: a.id, week }, p_before: wbase, p_after: after }); }
        catch (e) { btn.disabled = false; return toast(e.message || "저장하지 못했습니다"); }
        btn.disabled = false;
        if (res.conflict) {
          res.conflict.forEach((c) => (wbase[c.field] = c.now));
          row.querySelector("[data-wconflict]").innerHTML = conflictBox(res.conflict, "확인했으면 저장을 한 번 더 누르세요. 내가 적은 값으로 바꿔요.");
          return;
        }
        toast(`${week}주차 기록을 저장했어요`);
        renderDetail(a.id);
      });
    });
    $("#decConvert")?.addEventListener("click", () => openMove(a, "member"));
    $("#decClose")?.addEventListener("click", () => openMove(a, "closed"));
    body.querySelectorAll("[data-postpone]").forEach((b) => b.addEventListener("click", () => openPostpone(a, +b.dataset.postpone)));
    body.querySelectorAll("[data-undo]").forEach((b) => b.addEventListener("click", () => {
      const p = list.find((x) => String(x.id) === b.dataset.undo);
      modal({
        title: `${p.from_week}주차 연기 되돌리기`,
        body: `<p style="margin:0">${p.from_week}주차부터 ${p.weeks}주 미뤘던 일정을 원래대로 돌려요.</p>`,
        confirmLabel: "되돌리기",
        onConfirm: async (close) => {
          const { error } = await sb.from("trainee_postpones").delete().eq("id", p.id);
          if (error) throw new Error("되돌리지 못했습니다");
          S.postpones = S.postpones.filter((x) => x.id !== p.id);
          close(); toast("일정을 되돌렸어요"); renderDetail(a.id);
        },
      });
    }));
  }

  function openPostpone(a, from) {
    const list = pp(a.id);
    const preview = () => {
      const k = +$("#ppWeeks").value;
      const after = list.concat([{ from_week: from, weeks: k }]);
      $("#ppPreview").innerHTML = [1, 2, 3, 4, 5].map((n) => {
        const before = traineeWeekSat(a.trainee_start, n, list), now = traineeWeekSat(a.trainee_start, n, after);
        return `<div style="display:grid;grid-template-columns:48px 1fr;gap:8px;padding:4px 0;${n < from ? "color:var(--faint)" : ""}">
          <b>${n}주</b><span>${before === now ? md(before) + " (그대로)" : `${md(before)} → <b style="color:var(--violet)">${md(now)}</b>`}</span></div>`;
      }).join("");
    };
    modal({
      step: "수습 일정", title: `${a.name}님 · ${from}주차부터 미루기`,
      body: `<p style="margin:0">${from > 1 ? `1~${from - 1}주차 날짜와 기록은 그대로 두고, ` : ""}${from}주차부터 뒤로 밀어요.</p>
        <div class="grid2">
          <label class="field">얼마나 미룰까요<select id="ppWeeks">${[1, 2, 3, 4].map((k) => `<option value="${k}">${k}주</option>`).join("")}</select></label>
          <label class="field">사유 (리더십만 봐요)<input type="text" id="ppReason" maxlength="200" placeholder="예: 가족 일정으로 불참"></label>
        </div>
        <div id="ppPreview" style="background:var(--bg);border-radius:12px;padding:12px 16px;font-size:14px"></div>
        <p class="small muted" style="margin:0">수습생 홈의 주차와 일정도 함께 바뀌어요. 바뀐 일정은 카톡으로 따로 알려 주세요.</p>`,
      onInput: preview,
      confirmLabel: "미루기",
      onConfirm: async (close) => {
        const row = { application_id: a.id, from_week: from, weeks: +$("#ppWeeks").value, reason: $("#ppReason").value.trim() || null, created_by: S.me.id };
        const { data, error } = await sb.from("trainee_postpones").insert(row).select().single();
        if (error) throw new Error(error.message || "미루지 못했습니다");
        S.postpones.push(data);
        close(); toast(`${from}주차부터 ${row.weeks}주 미뤘어요`); renderDetail(a.id);
      },
    });
  }

  function renderAppTab(a, body) {
    const q = [a.q_practice && "팀모임 참여", a.q_sunday && "주일 예배 참여", a.q_group && "순모임 참여"].filter(Boolean);
    body.innerHTML = `<section class="card bordered"><dl class="kv" style="grid-template-columns:140px minmax(0,1fr);gap:14px 20px;line-height:1.65">
      <dt>지원 자격</dt><dd>${q.join(" · ")} ${q.length === 3 ? `<span class="chip chip-ok">3항목 확인</span>` : ""}</dd>
      <dt>연락처</dt><dd>${esc(a.phone)}</dd><dt>이메일</dt><dd>${esc(a.email)}</dd><dt>순모임</dt><dd>${esc(a.small_group) || "—"}</dd>
      <dt>기수 · 생년월일</dt><dd>${a.cohort ? a.cohort + "기" : "—"} · ${a.birth_date ? birthLabel(a.birth_date) : "—"}</dd>
      <dt>지원 포지션</dt><dd>${esc(positionName(a.applied_position))}</dd>
      <dt>지원 동기</dt><dd>${esc(a.motivation) || "—"}</dd><dt>이루고 싶은 것</dt><dd>${esc(a.goal) || "—"}</dd>
      <dt>서약</dt><dd>${esc(a.pledge_title)} · ${fmtDate(a.pledged_at)} 서약
        <details style="margin-top:8px"><summary style="cursor:pointer;color:var(--violet);font-weight:700">원문 보기</summary><div class="pledge-box" style="margin-top:8px">${esc(a.pledge_content)}</div></details></dd>
      <dt>관리자 메모</dt><dd><textarea class="input" id="memo" maxlength="1000" style="min-height:80px" placeholder="리더십끼리만 보는 메모">${esc(a.admin_memo || "")}</textarea>
        <div id="memoConflict" style="margin-top:8px"></div></dd>
    </dl></section>`;
    // 020: 연 때의 메모를 기준으로 저장 — 그 사이 다른 리더가 고쳤으면 덮어쓰지 않고 알려 줌
    let memoBase = a.admin_memo || null;
    const saveMemo = async () => {
      const v = $("#memo").value.trim() || null;
      const r = await saveRpc("save_fields", { p_table: "applications", p_key: { id: a.id }, p_before: { admin_memo: memoBase }, p_after: { admin_memo: v } });
      if (r.conflict) {
        memoBase = r.conflict[0]?.now ?? null;
        $("#memoConflict").innerHTML = conflictBox(r.conflict, `지금 저장된 메모는 아래와 같아요. 내 내용은 칸에 그대로 있어요. 합쳐서 고친 뒤
          <button type="button" class="btn btn-soft btn-sm" id="memoForce">내 내용으로 저장</button>`)
          + `<div class="note-box" style="white-space:pre-wrap;margin-top:8px">${esc(memoBase || "(비어 있음)")}</div>`;
        $("#memoForce").onclick = saveMemo;
        return;
      }
      memoBase = v; a.admin_memo = v; $("#memoConflict").innerHTML = ""; toast("메모를 저장했어요");
    };
    $("#memo").addEventListener("change", () => saveMemo().catch((e) => toast(e.message)));
  }

  function renderLog(a, body) {
    const logs = S.logs.filter((l) => l.application_id === a.id);
    body.innerHTML = `<section class="loglist">${logs.length ? logs.map((l) => `<div><span class="muted" style="font-weight:600">${fmtDate(l.sent_at, { hour: "numeric", minute: "2-digit" })}</span>
        <b>${esc(tpl(l.template_code)?.title || l.template_code)}</b><span class="muted">${esc(memberName(l.sent_by))}</span></div>`).join("")
      : `<div><span class="muted">아직 보낸 안내가 없어요</span></div>`}</section>
      <p class="small muted" style="margin:0">지원자가 "지금 내가 어느 단계에 있는지" 항상 알 수 있게 하는 게 목적이에요. 위의 "안내 문구 보내기"로 보내면 여기에 남아요.</p>`;
  }

  // ================================================================ 활동 데이터 (섬김 · 출석 공용)
  //  공개된 배치표 = 섬김 통계, 토요일 줄(team_meetings) + 출석 = 출석 통계
  //  (주일 배치만. 사역 예배는 사역 화면에서 따로 봄)
  const ACT_KINDS = { practice: "토요 연습", meeting: "팀모임", rehearsal: "주일 리허설" };
  async function loadActivity(fromDate) {
    const [tm, sv] = await Promise.all([
      sb.from("team_meetings").select("id, meeting_date, meeting_status, practice_cancelled, attendance(*)").gte("meeting_date", fromDate).order("meeting_date"),
      sb.from("services").select("service_date, status, assignments(member_id, position_code, slot, is_singer_leader, is_band_master)").is("ministry_id", null).gte("service_date", fromDate).order("service_date"),
    ]);
    if (tm.error || sv.error) console.error(tm.error || sv.error);
    return { meetings: tm.data || [], services: sv.data || [] };
  }
  const recOf = (mt, mid, kind) => (mt?.attendance || []).find((r) => r.member_id === mid && r.kind === kind);
  const reasonText = (r) => [r?.reason_tag, r?.reason].filter(Boolean).join(" · ");
  // 그 사람이 섬긴(공개된) 주일 목록
  const servedList = (services, mid) => services.filter((s) => s.status === "published")
    .flatMap((s) => (s.assignments || []).filter((a) => a.member_id === mid).map((a) => ({ date: s.service_date, ...a })))
    .reduce((out, a) => (out.some((x) => x.date === a.date) ? out : out.concat([a])), []);
  // 팀모임 연속 결석: '있음'이었던 지난 팀모임을 최근부터 셈. 미기록은 건너뜀
  function absenceStreak(m, meetings, today = todayISO()) {
    let n = 0, last = null, lastReason = null;
    for (const mt of meetings.slice().sort((a, b) => b.meeting_date.localeCompare(a.meeting_date))) {
      if (mt.meeting_status !== "yes" || mt.meeting_date > today) continue;
      if (m.status === "trainee" && m.joined_at && mt.meeting_date < m.joined_at) break;
      const r = recOf(mt, m.id, "meeting");
      if (!r) continue;
      if (r.status === "absent") { n++; if (!lastReason) lastReason = reasonText(r); } else { last = mt.meeting_date; break; }
    }
    return { n, last, lastReason };
  }
  const STREAK_LIMIT = 5;      // 팀모임 연속 결석 경고 기준
  const LATE_WEEKS = 4;        // 지각을 보는 기간(주)
  const partOf = (code) => ({ leader: "leader", vocal: "vocal", band: "band" }[(window.__allPositions || []).find((p) => p.code === code)?.kind] || "band");
  const PART_LABEL = { leader: "인도자", vocal: "싱어", band: "밴드" };
  const extrasOf = (mid) => S.extras.filter((e) => e.member_id === mid).map((e) => e.position_code);
  const posText = (m) => [m.main_position, ...extrasOf(m.id)].map(positionName).join(" + ");
  const sinceOf = (m) => m.served_since || m.joined_at;
  const durText = (iso) => {
    const [y1, m1] = iso.split("-").map(Number), [y2, m2] = todayISO().split("-").map(Number);
    const months = (y2 - y1) * 12 + (m2 - m1);
    return months < 1 ? "이번 달" : months < 12 ? `${months}개월` : `${Math.floor(months / 12)}년${months % 12 ? ` ${months % 12}개월` : ""}`;
  };
  const traineeLabel = (m) => {
    const a = S.apps.find((x) => x.user_id === m.id);
    if (!a) return "수습";
    const st = tstate(a);
    return st.paused ? `수습 ${st.nextWeek}주차 연기` : st.week === 0 ? "수습 시작 전" : st.week > 5 ? "수습 5주 완료" : `수습 ${st.week}주차`;
  };
  const dotsHTML = (marks) => `<span class="dots" aria-hidden="true">${marks.map((s) => `<i class="${s === "present" ? "" : s || "none"}"></i>`).join("")}</span>`;

  // ---------------------------------------------------------------- 멤버 목록
  async function renderMembers() {
    const f = S.memberFilter;
    const today = todayISO();
    const cnt = (fn) => S.members.filter(fn).length;
    const head = `<div class="page-head"><h1 class="page-title">멤버</h1>
        <div class="seg" id="mFilter">
          <button type="button" data-f="all" aria-pressed="${f === "all"}">활동 ${cnt((m) => m.is_active)}</button>
          <button type="button" data-f="active" aria-pressed="${f === "active"}">정식 ${cnt((m) => m.is_active && m.status === "active")}</button>
          <button type="button" data-f="trainee" aria-pressed="${f === "trainee"}">수습 ${cnt((m) => m.is_active && m.status === "trainee")}</button>
          ${cnt((m) => m.is_active && isObs(m)) || f === "obs" ? `<button type="button" data-f="obs" aria-pressed="${f === "obs"}">예배MC·교역자 ${cnt((m) => m.is_active && isObs(m))}</button>` : ""}
          <button type="button" data-f="off" aria-pressed="${f === "off"}">휴면·종료 ${cnt((m) => !m.is_active)}</button>
          ${cnt(firstLogin) || f === "first" ? `<button type="button" data-f="first" aria-pressed="${f === "first"}">첫 로그인 전 ${cnt(firstLogin)}</button>` : ""}
          <button type="button" data-f="guests" aria-pressed="${f === "guests"}">객원 ${S.guests.length}</button>
          <button type="button" data-f="alumni" aria-pressed="${f === "alumni"}">탈퇴 기록 ${(S.alumni || []).length}</button></div></div>`;
    if (f === "guests") {
      $("#content").innerHTML = `${head}<p class="lead">우리 섬김을 대신 서 주는 외부 분들이에요. 계정 없이 이름·포지션만 저장하고, 배치표에서 '객원'으로 끌어다 넣어요. 출석·통계에는 들어가지 않아요.</p>
        <div><button type="button" class="btn btn-primary" id="gAdd">+ 객원 추가</button></div>
        <div class="mtable">${S.guests.map((g) => `<div class="mrow grow" style="grid-template-columns:minmax(140px,1fr) minmax(160px,1.4fr) 130px minmax(0,1fr) auto">
            <span class="nm">${esc(g.name)} <span class="chip chip-violet">객원</span>${g.is_active ? "" : ` <span class="chip chip-gray">숨김</span>`}</span>
            <span class="sub">${g.positions.map(positionName).join(" · ")}</span><span class="sub">${esc(g.phone) || "—"}</span><span class="sub">${esc(g.note) || ""}</span>
            <span><button type="button" class="btn btn-ghost btn-sm" data-gedit="${g.id}">수정</button></span></div>`).join("")
          || `<div class="empty" style="border:0;border-radius:0">아직 저장한 객원이 없어요.</div>`}</div>`;
      bindMemberHead();
      $("#gAdd").onclick = () => openGuestEdit(null, () => renderMembers());
      $$("[data-gedit]").forEach((b) => b.addEventListener("click", () => openGuestEdit(S.guests.find((g) => g.id === b.dataset.gedit), () => renderMembers())));
      return;
    }
    if (f === "alumni") {
      $("#content").innerHTML = `${head}<p class="lead">탈퇴할 때 재가입 확인용으로 이름·포지션·활동 기간·사유만 남겨요. 연락처 등 나머지 정보는 지워졌어요.</p>
        <div class="loglist">${(S.alumni || []).map((x) => `<div style="grid-template-columns:140px 120px minmax(0,1fr)">
          <b>${esc(x.name)}</b><span class="muted">${esc(positionName(x.main_position))}</span>
          <span class="muted">${x.joined_at ? fmtDate(x.joined_at, { year: "numeric", month: "numeric", day: "numeric" }) + " ~ " : ""}${fmtDate(x.left_at, { year: "numeric", month: "numeric", day: "numeric" })}${x.reason ? " · " + esc(x.reason) : ""}</span></div>`).join("")
          || `<div><span class="muted">아직 탈퇴 기록이 없어요</span></div>`}</div>`;
      return bindMemberHead();
    }
    const act = await loadActivity(addDays(today, -100));
    const lastSat = lastSaturday(today);
    const lateFrom = addDays(lastSat, -7 * (LATE_WEEKS - 1));
    const pastMeetings = act.meetings.filter((x) => x.meeting_date <= today);
    const held = pastMeetings.filter((x) => x.meeting_status === "yes").slice(-5);
    const stat = (m) => {
      const served = servedList(act.services, m.id);
      const monthN = served.filter((s) => s.date.slice(0, 7) === today.slice(0, 7)).length;
      const q3 = served.filter((s) => s.date >= addDays(today, -91) && s.date.slice(0, 7) <= today.slice(0, 7)).length;
      const marks = held.map((x) => recOf(x, m.id, "meeting")?.status || null);
      const lates = pastMeetings.filter((x) => x.meeting_date >= lateFrom)
        .flatMap((x) => ["practice", "rehearsal"].map((k) => recOf(x, m.id, k))).filter((r) => r?.status === "late").length;
      return { monthN, q3, marks, lates, streak: absenceStreak(m, act.meetings, today).n };
    };
    const q = (S.memberQuery || "").trim();
    const list = S.members.filter((m) => f === "all" ? m.is_active : f === "trainee" ? m.is_active && m.status === "trainee"
      : f === "active" ? m.is_active && m.status === "active" : f === "obs" ? m.is_active && isObs(m) : f === "first" ? firstLogin(m) : !m.is_active).filter((m) => !q || m.name.includes(q));
    const rowHTML = (m) => {
      const s = stat(m);
      const badges = [leaderChip(m), firstLogin(m) && `<span class="chip chip-first">첫 로그인 전</span>`,
        m.status === "trainee" && `<span class="chip chip-mid">${traineeLabel(m)}</span>`,
        !m.is_active && `<span class="chip chip-gray">휴면</span>`,
        s.streak >= STREAK_LIMIT && `<span class="chip chip-bad">팀모임 ${s.streak}회 연속 결석</span>`].filter(Boolean).join("");
      const pick = S.memberSelect;
      const tag = pick ? `label class="mrow pickrow ${S.picked.has(m.id) ? "on" : ""}"` : `a class="mrow" href="#member/${m.id}"`;
      const box = pick ? `<input type="checkbox" data-pick="${m.id}" ${S.picked.has(m.id) ? "checked" : ""} ${m.id === S.me.id ? `disabled title="본인 계정은 고를 수 없어요"` : m.is_owner ? `disabled title="최상위 리더십 계정은 고를 수 없어요"` : ""} aria-label="${esc(m.name)} 고르기">` : "";
      return `<${tag}><span class="nm">${box}${esc(m.name)} ${badges}</span><span class="sub">${m.cohort ? `<b class="coh">${m.cohort}기</b> · ` : ""}${isObs(m) ? "배치는 어느 자리든" : esc(posText(m))}</span>
        ${m.status === "trainee" ? `<span class="sub">–</span><span class="sub">–</span>` : `<span class="num"><b>${s.monthN}</b>회</span><span class="num"><b>${s.q3}</b>회</span>`}
        ${s.marks.length ? dotsHTML(s.marks) : `<span class="sub">–</span>`}
        ${s.lates ? `<span style="color:var(--mid);font-weight:800">${s.lates}회</span>` : `<span class="sub">–</span>`}<span class="arrow">${pick ? "" : "›"}</span></${pick ? "label" : "a"}>`;
    };
    const byName = (a, b) => a.name.localeCompare(b.name, "ko");
    let body;
    if (S.memberGroup === "name") body = list.slice().sort(byName).map(rowHTML).join("");
    else if (S.memberGroup === "cohort") body = [...new Set(list.map((m) => m.cohort ?? null))].sort((a, b) => (a ?? 999) - (b ?? 999)).map((c) => {
      const g = list.filter((m) => (m.cohort ?? null) === c).sort(byName);
      return `<div class="group-label">${c ? c + "기" : "기수 미입력"} · ${g.length}명</div>${g.map(rowHTML).join("")}`;
    }).join("");
    else body = ["leader", "vocal", "band"].map((part) => {
      const g = list.filter((m) => !isObs(m) && partOf(m.main_position) === part).sort((a, b) => (m2o(a) - m2o(b)) || byName(a, b));
      return g.length ? `<div class="group-label">${PART_LABEL[part]} · ${g.length}명</div>${g.map(rowHTML).join("")}` : "";
    }).join("") + (() => {
      const g = list.filter(isObs).sort((a, b) => a.status.localeCompare(b.status) || byName(a, b));
      return g.length ? `<div class="group-label">예배MC · 교역자 · ${g.length}명</div>${g.map(rowHTML).join("")}` : "";
    })();
    function m2o(m) { return posOrder()[m.main_position] ?? 99; }

    $("#content").innerHTML = `${head}
      <div class="mtools">
        <div class="row"><input class="search" id="mSearch" type="search" placeholder="이름 검색" value="${esc(q)}" aria-label="이름 검색">
          <button type="button" class="btn btn-ghost btn-sm" id="mPickMode" aria-pressed="${!!S.memberSelect}">${S.memberSelect ? "고르기 끝" : "여러 명 고르기"}</button>
          <button type="button" class="btn btn-soft btn-sm" id="mAddOne">+ 개별 등록</button>
          <button type="button" class="btn btn-ghost btn-sm" id="mBulkAdd">엑셀로 일괄 등록</button></div>
        <div class="seg" id="mGroup"><span class="small muted" style="align-self:center;margin-right:4px">묶어 보기</span>
          <button type="button" data-g="part" aria-pressed="${!["name", "cohort"].includes(S.memberGroup)}">파트별</button><button type="button" data-g="cohort" aria-pressed="${S.memberGroup === "cohort"}">기수별</button><button type="button" data-g="name" aria-pressed="${S.memberGroup === "name"}">이름순</button></div>
      </div>
      <div class="mtable">
        <div class="mrow head"><span>이름</span><span>포지션</span><span>이번 달 섬김</span><span>최근 3개월</span><span>최근 팀모임 ${held.length}회</span><span>지각 ${LATE_WEEKS}주</span><span></span></div>
        ${body || `<div class="empty" style="border:0;border-radius:0">해당하는 멤버가 없어요.</div>`}
      </div>
      ${f === "first" ? `<section class="card bordered" style="display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;padding:14px 18px">
          <span style="flex:1 1 320px;display:flex;flex-direction:column;gap:2px"><b>아직 임시 비밀번호를 쓰고 있어요</b>
            <span class="small muted">첫 로그인 때 비밀번호를 바꾸면 이 목록에서 빠져요. 로그인 전이라 푸시는 못 받으니 카톡으로 챙겨 주세요.</span></span>
          <button type="button" class="btn btn-soft btn-sm" id="firstCopy" ${list.length ? "" : "disabled"}>카톡 안내 문구 복사 · ${list.length}명</button></section>` : ""}
      <p class="small muted" style="margin:0">줄을 누르면 상세 화면에서 정보 수정·섬김 통계·출석을 볼 수 있어요. 지각은 토요 연습·주일 리허설 합계예요.</p>
      ${S.memberSelect ? `<div class="selbar" id="selBar"></div>` : ""}`;
    bindMemberHead();
    bindMemberBulk(list);
    $("#firstCopy")?.addEventListener("click", async () => {
      const text = `[찬양팀] ${namesNim(list)}\n아직 찬양팀 플랫폼에 처음 로그인을 안 하셨어요. 임시 비밀번호로 로그인해서 비밀번호를 바꿔 주세요. 바꾸기 전에는 다른 사람도 같은 비밀번호로 들어갈 수 있어요.\n\n${location.origin}/login.html\n비밀번호를 잊었으면 리더에게 말해 주세요.`;
      toast((await copyText(text)) ? `${list.length}명에게 보낼 문구를 복사했어요` : "복사하지 못했어요");
    });
    $("#mGroup").onclick = (e) => { const b = e.target.closest("button"); if (b) { S.memberGroup = b.dataset.g; renderMembers(); } };
    $("#mSearch").oninput = (e) => {
      S.memberQuery = e.target.value;
      clearTimeout(renderMembers.t); renderMembers.t = setTimeout(async () => { await renderMembers(); const i = $("#mSearch"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250);
    };
  }
  // ---------------------------------------------------------------- 여러 명 고르기 · 휴면 · 삭제 · 일괄 등록 (014)
  S.picked = new Set();
  function bindMemberBulk(list) {
    $("#mPickMode").onclick = () => { S.memberSelect = !S.memberSelect; S.picked.clear(); renderMembers(); };
    $("#mBulkAdd").onclick = () => openBulkAdd();
    $("#mAddOne").onclick = () => openMemberAdd();
    if (!S.memberSelect) return;
    const pickable = list.filter((m) => m.id !== S.me.id && !m.is_owner);
    const bar = () => {
      const ms = S.members.filter((m) => S.picked.has(m.id));
      const anyOn = ms.some((m) => m.is_active), anyOff = ms.some((m) => !m.is_active);
      $("#selBar").innerHTML = `<b>${ms.length}명 골랐어요</b>
        <button type="button" class="btn btn-ghost btn-sm" id="selAll">${pickable.every((m) => S.picked.has(m.id)) && pickable.length ? "모두 해제" : `보이는 ${pickable.length}명 모두`}</button>
        <span style="flex:1"></span>
        ${anyOn ? `<button type="button" class="btn btn-ghost btn-sm" id="selOff">휴면으로</button>` : ""}
        ${anyOff ? `<button type="button" class="btn btn-ghost btn-sm" id="selOn">활동으로</button>` : ""}
        <button type="button" class="btn btn-danger btn-sm" id="selDel" ${ms.length ? "" : "disabled"}>삭제</button>`;
      $("#selAll").onclick = () => { const all = pickable.every((m) => S.picked.has(m.id)); pickable.forEach((m) => all ? S.picked.delete(m.id) : S.picked.add(m.id)); renderMembers(); };
      $("#selOff")?.addEventListener("click", () => setActive(ms.filter((m) => m.is_active), false));
      $("#selOn")?.addEventListener("click", () => setActive(ms.filter((m) => !m.is_active), true));
      $("#selDel").onclick = () => openBulkDelete(ms);
    };
    $$("[data-pick]").forEach((c) => c.addEventListener("change", () => {
      c.checked ? S.picked.add(c.dataset.pick) : S.picked.delete(c.dataset.pick);
      c.closest(".pickrow")?.classList.toggle("on", c.checked); bar();
    }));
    bar();
  }
  // 휴면: 로그인·응답·출석·배치 추천에서 빠지고, 지난 기록·통계는 그대로. 언제든 활동으로 되돌릴 수 있어요
  function setActive(ms, on) {
    if (!ms.length) return;
    modal({ title: `${ms.length}명 ${on ? "활동으로 전환" : "휴면으로 전환"}`,
      body: `<p style="margin:0">${ms.map((m) => esc(m.name)).join(", ")}</p>
        <p class="small muted" style="margin:0">${on ? "다시 로그인하고 응답·배치 대상에 들어가요." : "로그인할 수 없고 섬김 응답·출석·배치 추천 대상에서 빠져요. 지난 출석·섬김 기록과 통계는 그대로 남고, 언제든 활동으로 되돌릴 수 있어요."}</p>`,
      confirmLabel: on ? "활동으로" : "휴면으로",
      onConfirm: async (close) => {
        const { error } = await sb.from("members").update({ is_active: on }).in("id", ms.map((m) => m.id));
        if (error) throw new Error("바꾸지 못했습니다: " + error.message);
        await loadAll(); S.picked.clear(); close(); toast(`${ms.length}명을 ${on ? "활동" : "휴면"}으로 바꿨어요`); renderMembers();
      } });
  }
  function openBulkDelete(ms) {
    modal({ title: `${ms.length}명 삭제`, danger: true, confirmLabel: `${ms.length}명 삭제`,
      body: `<p class="notice warn" style="margin:0">정식 운영 전 정리용이에요. 계정·연락처·지원서·응답·출석 기록이 모두 지워지고 되돌릴 수 없어요. 탈퇴 기록도 남지 않아요.<br>운영 중에는 삭제 대신 <b>휴면</b>(기록 유지)이나 상세 화면의 <b>탈퇴 처리</b>를 써 주세요.</p>
        <p style="margin:0;font-size:14px">${ms.map((m) => esc(m.name)).join(", ")}</p>
        <label class="field">확인을 위해 <b>삭제</b>라고 적어 주세요<input type="text" id="delConfirm" autocomplete="off"></label>`,
      onInput: () => { const ok = $("#mOk"); if (ok) ok.disabled = $("#delConfirm").value.trim() !== "삭제"; },
      onConfirm: async (close) => {
        if ($("#delConfirm").value.trim() !== "삭제") throw new Error("'삭제'라고 적어 주세요");
        $("#mOk").textContent = "지우는 중…";
        const r = await api("/api/members-bulk", { action: "delete", ids: ms.map((m) => m.id), confirm: "삭제" });
        await loadAll(); S.picked.clear(); close();
        toast(`${r.removed}명을 삭제했어요${r.failed.length ? ` · 실패 ${r.failed.join(", ")}` : ""}`, 4000); renderMembers();
      } });
  }

  // 엑셀 도구 (SheetJS) — 일괄 등록할 때만 불러옴
  let xlsxP = null;
  const loadXLSX = () => xlsxP || (xlsxP = new Promise((ok, no) => {
    if (window.XLSX) return ok(window.XLSX);
    const sc = document.createElement("script");
    sc.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    sc.onload = () => (window.XLSX ? ok(window.XLSX) : no(new Error("엑셀 도구를 불러오지 못했어요")));
    sc.onerror = () => { xlsxP = null; no(new Error("엑셀 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요")); };
    document.head.appendChild(sc);
  }));
  const BULK_HEAD = ["이름", "이메일(아이디)", "연락처", "성별(남/여)", "기수", "생년월일", "주 포지션", "추가 포지션", "생일선물 정산(참여/미참여)", "숙련도(상/중/하)", "순모임", "구분(정식/수습)"];
  async function downloadTemplate() {
    const X = await loadXLSX();
    const ps = window.__allPositions || [];
    const ws = X.utils.aoa_to_sheet([BULK_HEAD,
      ["홍길동(예시)", "gildong@example.com", "010-1234-5678", "남", "39기", "2003. 2. 4", "싱어", "", "참여", "중", "1순", "정식"],
      ["김예시(예시)", "yesi@example.com", "010-2345-6789", "여", "41기", "2005-11-20", "메인건반", "세컨건반, 싱어", "미참여", "상", "", "정식"]]);
    ws["!cols"] = [12, 26, 16, 10, 8, 14, 12, 18, 18, 14, 10, 14].map((w) => ({ wch: w }));
    const guide = X.utils.aoa_to_sheet([["항목", "적는 법"], ["이름 · 이메일 · 주 포지션", "꼭 적어 주세요. 이메일이 로그인 아이디가 돼요"],
      ["포지션", ps.map((p) => p.name).join(", ") + " (줄여서 " + Object.values(POS_SHORT).join(", ") + "도 돼요)"],
      ["추가 포지션", "여러 개면 쉼표로 (예: 세컨건반, 싱어)"], ["성별", "남 / 여 (배치 성비에 써요)"],
      ["기수", "숫자만 또는 39기"], ["생년월일", "양력 · 2003. 2. 4 / 2003-02-04 / 20030204 모두 돼요"], ["생일선물 정산", "참여 / 미참여 (참여합니다 · 참여하지 않습니다도 돼요). 비우면 미정"],
      ["구글 폼 응답", "20기 찬양팀 신청서 응답 시트를 그대로 올려도 돼요. 같은 이메일로 여러 번 냈으면 마지막 응답만 써요"], ["숙련도", "상 / 중 / 하 — 주 포지션 기준, 비우면 '중'"],
      ["구분", "정식 / 수습 — 비우면 정식"], ["예시 줄", "이름에 (예시)가 들어간 줄은 등록하지 않아요. 지우고 써도 돼요"]]);
    guide["!cols"] = [{ wch: 24 }, { wch: 80 }];
    const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, "팀원"); X.utils.book_append_sheet(wb, guide, "적는 법");
    X.writeFile(wb, "Pole2_멤버_일괄등록_양식.xlsx");
  }
  // 엑셀 한 장 → [{ line, raw, row, errors }]
  function parseBulk(X, buf) {
    const wb = X.read(buf, { type: "array" });
    let aoa = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: true });
    const hnorm = (c) => String(c).replace(/\s/g, "").replace(/^\d+[.)]/, "");
    const hi = aoa.findIndex((r) => r.some((c) => hnorm(c) === "이름"));
    if (hi < 0) throw new Error("첫 줄에 '이름' 칸이 있는 양식으로 올려 주세요");
    const head = aoa[hi].map(hnorm);
    const col = (...keys) => { for (const k of keys) { const i = head.indexOf(k); if (i >= 0) return i; } return head.findIndex((h) => keys.some((k) => h.startsWith(k))); };
    const C = { name: col("이름"), email: col("이메일", "아이디"), phone: col("연락처", "전화", "휴대폰"), gender: col("성별"), main: col("주포지션", "주섬김", "포지션"),
      extra: col("추가포지션", "추가"), skill: col("숙련도"), group: col("순모임이름", "순모임명", "소속순모임"), status: col("구분", "상태"),
      cohort: col("기수"), birth: col("생년월일", "생일"), gift: col("생일선물", "정산"), ts: col("타임스탬프", "Timestamp") };
    if (C.group < 0) { const gi = head.findIndex((h) => h === "순모임"); C.group = gi; }
    if (C.name < 0 || C.email < 0 || C.main < 0) throw new Error("이름 · 이메일 · 주 포지션 칸이 필요해요. 양식을 내려받아 써 주세요");
    const ps = window.__allPositions || [];
    // 구글 폼 응답: 같은 이메일로 여러 번 냈으면 마지막(아래쪽) 응답만 씀
    if (C.ts >= 0) {
      const last = new Map();
      aoa.slice(hi + 1).forEach((r, i) => { const e = String(r[C.email] ?? "").trim().toLowerCase(); if (e) last.set(e, i); });
      aoa = aoa.slice(0, hi + 1).concat(aoa.slice(hi + 1).map((r, i) => { const e = String(r[C.email] ?? "").trim().toLowerCase(); return e && last.get(e) !== i ? [] : r; }));
    }
    const norm = (v) => String(v ?? "").replace(/\s/g, "");
    const POSMAP = {};
    ps.forEach((p) => { POSMAP[norm(p.name)] = p.code; POSMAP[p.code] = p.code; if (POS_SHORT[p.code]) POSMAP[POS_SHORT[p.code]] = p.code; });
    Object.assign(POSMAP, { "인도자": "leader", "보컬": "singer", "건반": "key_main", "메인건반": "key_main", "세컨": "key_second", "일렉": "e_guitar", "기타": "e_guitar", "베이스": "bass", "드럼": "drum" });
    const have = new Set(S.members.map((m) => String(m.email || "").toLowerCase()));
    const seen = new Map();
    const out = [];
    aoa.slice(hi + 1).forEach((r, i) => {
      const get = (k) => (C[k] >= 0 ? r[C[k]] ?? "" : "");
      const name = String(get("name")).trim();
      if (!name && !String(get("email")).trim()) return;
      if (name.includes("예시")) return;
      const errors = [];
      const email = String(get("email")).trim().toLowerCase();
      let phone = get("phone"); if (typeof phone === "number") phone = "0" + phone; phone = String(phone).trim();
      const g = norm(get("gender")), gender = /^(남|남자|m|male)$/i.test(g) ? "m" : /^(여|여자|f|female)$/i.test(g) ? "f" : g ? "?" : null;
      const main = POSMAP[norm(get("main"))];
      const extraRaw = String(get("extra")).split(/[,，/·]/).map(norm).filter(Boolean);
      const extra = extraRaw.map((x) => POSMAP[x]);
      const sk = norm(get("skill")), skill = { "상": 3, "중": 2, "하": 1 }[sk] ?? (sk ? "?" : null);
      const st = norm(get("status")), status = st === "수습" ? "trainee" : !st || st === "정식" ? "active" : "?";
      const ch = norm(get("cohort")), cohort = !ch ? null : /^\d{1,3}기?$/.test(ch) && +ch.replace("기", "") <= 200 ? +ch.replace("기", "") : "?";
      const birth = parseBirth(get("birth"));
      const gf = norm(get("gift")), gift = !gf ? null : /^(참여|참여합니다|o|y|예)$/i.test(gf) ? true : /^(미참여|불참|참여하지않습니다|참여안함|x|n|아니오)$/i.test(gf) ? false : "?";
      if (!name) errors.push("이름 없음");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push(email ? "이메일 형식" : "이메일 없음");
      else if (have.has(email)) errors.push("이미 등록된 이메일");
      else if (seen.has(email) && C.ts < 0) errors.push(`${seen.get(email)}번 줄과 이메일 중복`);
      if (!main) errors.push(get("main") ? `포지션 '${get("main")}'?` : "주 포지션 없음");
      extra.forEach((c, k) => { if (!c) errors.push(`추가 포지션 '${extraRaw[k]}'?`); });
      if (gender === "?") errors.push("성별은 남/여");
      if (skill === "?") errors.push("숙련도는 상/중/하");
      if (status === "?") errors.push("구분은 정식/수습");
      if (cohort === "?") errors.push(`기수 '${get("cohort")}'?`);
      if (birth === "?") errors.push(`생년월일 '${get("birth")}'?`);
      if (gift === "?") errors.push("생일선물 정산은 참여/미참여");
      if (email && !seen.has(email)) seen.set(email, hi + i + 2);
      out.push({ line: hi + i + 2, errors, row: { name, email, phone, gender: gender === "?" ? null : gender, main_position: main, extra_positions: extra.filter(Boolean),
        skill: skill === "?" ? null : skill, small_group: String(get("group")).trim(), status: status === "?" ? "active" : status,
        cohort: cohort === "?" ? null : cohort, birth_date: birth === "?" ? null : birth, gift_join: gift === "?" ? null : gift } });
    });
    return out;
  }
  // 생년월일: "2003. 2. 4" · "2003-02-04" · "2003/2/4" · "20030204" · 엑셀 날짜 숫자. 비면 null, 못 읽으면 "?"
  function parseBirth(v) {
    if (v === "" || v === null || v === undefined) return null;
    let y, m, d;
    if (typeof v === "number" && v > 10000 && v < 80000) {   // 엑셀 날짜(1900 기준 일 수)
      const t = new Date(Date.UTC(1899, 11, 30) + v * 864e5); y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate();
    } else {
      const s2 = String(v).trim().replace(/\s/g, "");
      let r = s2.match(/^(\d{4})[.\-/년](\d{1,2})[.\-/월](\d{1,2})[.일]?$/) || s2.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (!r) return "?";
      [, y, m, d] = r.map(Number);
    }
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const t = new Date(iso + "T00:00:00Z");
    if (isNaN(t) || t.getUTCDate() !== d || iso < "1940-01-01" || iso > "2020-12-31") return "?";
    return iso;
  }
  // 함께 쓰는 임시 비밀번호 검사 — 서버(_lib.js sharedPasswordProblem)와 같은 규칙
  const WEAK_PW = ["12345678", "123456789", "1234567890", "password", "password1", "qwerty12", "qwer1234", "abcd1234", "a1234567", "pole21234", "pole2pole2", "worship1"];
  function pwProblem(pw, emails = []) {
    if (pw.length < 8) return "8자 이상으로 정해 주세요";
    if (pw.length > 40) return "40자 이하로 정해 주세요";
    if (/\s/.test(pw)) return "띄어쓰기 없이 정해 주세요";
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "영문과 숫자를 섞어 주세요";
    const low = pw.toLowerCase();
    if (WEAK_PW.includes(low) || /^(.)\1+$/.test(pw)) return "너무 쉬운 비밀번호예요";
    if (/(0123|1234|2345|3456|4567|5678|6789|abcd|qwer)/.test(low) && low.replace(/[^a-z]/g, "").length <= 4) return "너무 쉬운 비밀번호예요";
    if (emails.map((e) => String(e || "").split("@")[0].toLowerCase()).some((u) => u.length >= 3 && low.includes(u))) return "이메일 아이디가 들어간 비밀번호는 쓸 수 없어요";
    return null;
  }
  function openBulkAdd() {
    let parsed = null;
    let pwMode = "same";
    const pwState = () => {
      if (pwMode !== "same") return { ok: true };
      const v = $("#bkPw")?.value || "";
      const why = v ? pwProblem(v, (parsed || []).filter((x) => !x.errors.length).map((x) => x.row.email)) : "함께 쓸 임시 비밀번호를 정해 주세요";
      return { ok: !why, why, v };
    };
    const drawPw = () => {
      const s = pwState(), el = $("#bkPwMsg"); if (!el) return;
      el.className = `small ${s.ok ? "bk-ok" : $("#bkPw").value ? "bk-err" : "muted"}`;
      el.textContent = pwMode !== "same" ? "" : s.ok ? "쓸 수 있어요" : $("#bkPw").value ? s.why : "8자 이상 · 영문과 숫자를 섞어서";
      const ok = parsed ? parsed.filter((x) => !x.errors.length) : [];
      const b = $("#mOk"); if (b) b.disabled = !ok.length || !s.ok;
    };
    const draw = () => {
      const ok = parsed ? parsed.filter((x) => !x.errors.length) : [];
      const bad = parsed ? parsed.filter((x) => x.errors.length) : [];
      $("#bkPrev").innerHTML = !parsed ? "" : !parsed.length ? `<div class="empty">등록할 줄이 없어요.</div>` : `
        <div class="row"><span class="chip chip-ok">등록할 수 있어요 ${ok.length}명</span>${bad.length ? `<span class="chip chip-warn">고칠 곳 있음 ${bad.length}명 · 등록하지 않아요</span>` : ""}</div>
        <div class="evaltable" style="max-height:340px;overflow:auto"><table class="bk-table"><thead><tr><th>줄</th><th>이름</th><th>이메일(아이디)</th><th>포지션</th><th>성별</th><th>기수</th><th>생년월일</th><th>정산</th><th>숙련도</th><th>구분</th><th>확인</th></tr></thead>
          <tbody>${parsed.map((x) => `<tr class="${x.errors.length ? "bad" : ""}"><td>${x.line}</td><td><b>${esc(x.row.name)}</b></td><td>${esc(x.row.email)}</td>
            <td>${esc([x.row.main_position && positionName(x.row.main_position), ...x.row.extra_positions.map(positionName)].filter(Boolean).join(", "))}</td>
            <td>${x.row.gender ? GENDER[x.row.gender] : "–"}</td><td>${x.row.cohort ? x.row.cohort + "기" : "–"}</td><td>${x.row.birth_date ? birthLabel(x.row.birth_date) : "–"}</td>
            <td>${x.row.gift_join === true ? "참여" : x.row.gift_join === false ? "미참여" : "–"}</td><td>${x.row.skill ? LEVEL[x.row.skill] : "–"}</td><td>${x.row.status === "trainee" ? "수습" : "정식"}</td>
            <td>${x.errors.length ? `<span class="bk-err">${esc(x.errors.join(" · "))}</span>` : `<span class="bk-ok">OK</span>`}</td></tr>`).join("")}</tbody></table></div>
        ${bad.length ? `<p class="small muted" style="margin:0">빨간 줄은 엑셀에서 고쳐 다시 올리거나, 나머지만 먼저 등록하고 따로 추가해도 돼요.</p>` : ""}`;
      const b = $("#mOk"); if (b) b.textContent = ok.length ? `${ok.length}명 등록` : "등록";
      drawPw();
    };
    modal({ title: "엑셀로 멤버 일괄 등록", wide: true, confirmLabel: "등록",
      body: `<ol class="bk-steps"><li>양식을 내려받아 한 줄에 한 명씩 채워 주세요. <button type="button" class="btn btn-soft btn-sm" id="bkTpl">양식 내려받기</button><br><span class="small muted">구글 폼 응답 시트(파일 › 다운로드 › .xlsx 또는 .csv)를 그대로 올려도 돼요. 같은 이메일로 여러 번 냈으면 마지막 응답만 써요.</span></li>
          <li>채운 파일(.xlsx · .csv)을 올리면 등록 전에 미리 보여 줘요. <label class="btn btn-ghost btn-sm">파일 고르기<input type="file" id="bkFile" accept=".xlsx,.xls,.csv" hidden></label><span class="small muted" id="bkName"></span></li>
          <li>임시 비밀번호를 정해요. 첫 로그인 때 각자 바꿔야 해요.
            <div class="bk-pw" id="bkPwBox">
              <label class="radio1 on"><input type="radio" name="bkPwMode" value="same" checked><span><b>모두 같은 비밀번호</b><small>단체방에 한 번에 안내하기 쉬워요</small></span></label>
              <div class="bk-pw-in" id="bkPwIn"><input type="text" class="input" id="bkPw" maxlength="40" autocomplete="off" spellcheck="false" placeholder="영문+숫자 8자 이상" aria-label="함께 쓸 임시 비밀번호"><span id="bkPwMsg" class="small"></span>
                <span class="small muted">모두 같은 비밀번호를 쓰는 동안에는 다른 사람 계정으로도 들어갈 수 있어요. 등록한 뒤 바로 안내하고, 멤버 › <b>첫 로그인 전</b>에서 아직 안 바꾼 사람을 챙겨 주세요.</span></div>
              <label class="radio1"><input type="radio" name="bkPwMode" value="each"><span><b>사람마다 다르게</b><small>목록을 받아 개인 카톡으로 하나씩 전해요</small></span></label>
            </div></li></ol>
        <div id="bkPrev" style="display:flex;flex-direction:column;gap:10px"></div>`,
      onInput: (e) => {
        const r = e?.target?.closest?.("[name=bkPwMode]");
        if (r) {
          pwMode = r.value;
          $$("#bkPwBox .radio1").forEach((l) => l.classList.toggle("on", l.querySelector("input").checked));
          $("#bkPwIn").classList.toggle("hidden", pwMode !== "same");
        }
        if (e?.target?.id === "bkPw" || r) drawPw();
      },
      onConfirm: async (close) => {
        const rows = (parsed || []).filter((x) => !x.errors.length).map((x) => x.row);
        if (!rows.length) throw new Error("등록할 사람이 없어요");
        const s = pwState();
        if (!s.ok) throw new Error(s.why);
        $("#mOk").textContent = `등록하는 중… (${rows.length}명)`;
        const r = await api("/api/members-bulk", { action: "add", rows, ...(pwMode === "same" ? { password: s.v } : {}) });
        if (pwMode === "same") rememberSharedPw(s.v);
        await loadAll(); close(); await (popWait || Promise.resolve()); renderMembers();
        showTempPasswords(r.results, r.shared);
      } });
    draw();
    $("#bkTpl").onclick = async () => { try { await downloadTemplate(); } catch (e) { toast(e.message, 4000); } };
    $("#bkFile").onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      $("#bkName").textContent = f.name;
      try { const X = await loadXLSX(); parsed = parseBulk(X, await f.arrayBuffer()); }
      catch (err) { parsed = null; toast(err.message, 4500); }
      draw();
    };
  }
  // ---------------------------------------------------------------- 멤버 개별 등록 (019)
  //  엑셀 양식과 같은 항목을 화면에서 바로 입력 · 서버는 일괄 등록(members-bulk add)을 한 명으로 씀
  //  임시 비밀번호: 이 기기에서 마지막으로 쓴 공통 임시 비밀번호를 미리 채움(바꿀 수 있음) · 또는 자동으로 만들기
  const SHARED_PW_KEY = "pole2.sharedTempPw";
  const rememberSharedPw = (v) => { try { localStorage.setItem(SHARED_PW_KEY, v); } catch {} };
  const lastSharedPw = () => { try { return localStorage.getItem(SHARED_PW_KEY) || ""; } catch { return ""; } };
  function openMemberAdd() {
    const ps = window.__allPositions || [];
    const last = lastSharedPw();
    let pwMode = "same", gender = null, gift = null, skill = null, status = "active", confirmDup = null;
    const segBtns = (id, opts, cur) => `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${String(v) === String(cur)}">${l}</button>`).join("")}</div>`;
    const val = () => {
      const g = (id) => ($("#" + id)?.value || "").trim();
      const main = g("aMain");
      return { name: g("aName"), email: g("aEmail").toLowerCase(), phone: g("aPhone"), gender, cohort: g("aCohort") ? +g("aCohort").replace(/\D/g, "") : null,
        birth_date: g("aBirth") || null, main_position: main, extra_positions: $$("#aExtra input:checked").map((x) => x.value).filter((c) => c !== main),
        gift_join: gift, skill, small_group: g("aGroup"), status };
    };
    const problems = (v) => {
      const out = [];
      if (!v.name) out.push("이름을 적어 주세요");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) out.push(v.email ? "이메일 형식을 확인해 주세요" : "이메일(아이디)을 적어 주세요");
      else if (S.members.some((m) => String(m.email || "").toLowerCase() === v.email)) out.push("이미 등록된 이메일이에요");
      if (!v.main_position && !OBS[v.status]) out.push("주 포지션을 골라 주세요");
      if (v.phone && !/^[0-9\-]{9,13}$/.test(v.phone)) out.push("연락처는 010-0000-0000 형식으로");
      if (v.cohort !== null && !(v.cohort >= 1 && v.cohort <= 200)) out.push("기수를 숫자로 적어 주세요");
      if (v.birth_date && (v.birth_date < "1940-01-01" || v.birth_date > "2020-12-31")) out.push("생년월일을 확인해 주세요");
      if (pwMode === "same") { const why = pwProblem($("#aPw").value, [v.email]); if (why) out.push("임시 비밀번호: " + why); }
      return out;
    };
    // 같은 이름 · 같은 연락처 · 탈퇴 기록 (재등록일 수 있어서 막지는 않고 확인만)
    const dupOf = (v) => {
      const digits = (x) => String(x || "").replace(/\D/g, "");
      const ms = S.members.filter((m) => (v.name && m.name === v.name) || (digits(v.phone).length >= 9 && digits(m.phone) === digits(v.phone)));
      const al = (S.alumni || []).filter((x) => v.name && x.name === v.name);
      return [...ms.map((m) => `${m.name}${m.is_active ? "" : " (휴면)"} · ${m.name === v.name ? "같은 이름" : "같은 연락처"}`), ...al.map((x) => `${x.name} · 탈퇴 기록 (${fmtDate(x.left_at, { year: "numeric", month: "numeric" })})`)];
    };
    const draw = () => {
      const v = val(), pr = problems(v), dup = dupOf(v);
      $("#aMsg").innerHTML = dup.length ? `<div class="notice warn" style="margin:0">이미 비슷한 사람이 있어요: ${dup.map(esc).join(", ")}<br><span class="small">탈퇴 후 다시 등록하는 경우라면 그대로 등록해도 돼요.</span></div>` : "";
      const b = $("#mOk"); if (b) { b.disabled = pr.length > 0; b.textContent = dup.length && confirmDup !== JSON.stringify(dup) ? "확인하고 등록" : "등록"; }
      $("#aHint").textContent = pr[0] || "";
      $$("#aExtra label").forEach((l) => { const off = l.querySelector("input").value === v.main_position; l.classList.toggle("hidden", off); if (off) l.querySelector("input").checked = false; });
    };
    modal({ title: "멤버 개별 등록", wide: true, confirmLabel: "등록",
      body: `<p class="small muted" style="margin:0">엑셀 양식과 같은 항목이에요. <b>*</b> 표시만 꼭 적으면 되고, 나머지는 나중에 멤버 › 정보 수정에서 채워도 돼요.</p>
        <div class="grid2">
          <label class="field">이름 *<input type="text" id="aName" maxlength="30" autocomplete="off"></label>
          <label class="field">이메일(아이디) *<input type="email" id="aEmail" autocomplete="off" placeholder="name@example.com"></label>
          <label class="field">연락처<input type="tel" id="aPhone" inputmode="numeric" placeholder="010-0000-0000"></label>
          <div class="field"><span>성별</span>${segBtns("aGender", [["m", "남"], ["f", "여"]], gender)}</div>
          <label class="field">기수<span style="display:flex;align-items:center;gap:6px"><input type="text" id="aCohort" inputmode="numeric" maxlength="3" placeholder="예: 41" style="min-width:0">기</span></label>
          <label class="field">생년월일 (양력)<input type="date" id="aBirth" min="1940-01-01" max="2020-12-31"></label>
          <label class="field">주 포지션 *<select class="select" id="aMain"><option value="">고르기</option>${ps.map((p) => `<option value="${p.code}">${esc(p.name)}</option>`).join("")}</select></label>
          <label class="field">순모임<input type="text" id="aGroup" maxlength="30" placeholder="예: 3순"></label>
        </div>
        <div class="field"><span>추가 포지션 <span class="hint">· 여러 개 고를 수 있어요</span></span><div class="pick-people" id="aExtra" style="max-height:none">${ps.map((p) => `<label><input type="checkbox" value="${p.code}">${esc(p.name)}</label>`).join("")}</div></div>
        <div class="grid2">
          <div class="field"><span>숙련도 <span class="hint">· 주 포지션 · 비우면 '중'</span></span>${segBtns("aSkill", [[3, "상"], [2, "중"], [1, "하"]], skill)}</div>
          <div class="field"><span>생일선물 정산</span>${segBtns("aGift", [["true", "참여"], ["false", "미참여"]], gift)}</div>
          <div class="field"><span>구분</span>${segBtns("aStatus", [["active", "정식"], ["trainee", "수습"], ...(isOwner() ? [["mc", "예배MC"], ["pastor", "교역자"]] : [])], status)}</div>
        </div>
        <div class="field"><span>임시 비밀번호 <span class="hint">· 첫 로그인 때 바꿔요</span></span>
          <div class="bk-pw" id="aPwBox" style="margin-top:0">
            <label class="radio1 on"><input type="radio" name="aPwMode" value="same" checked><span><b>공통 임시 비밀번호</b><small>${last ? "이 기기에서 일괄 등록 때 쓴 비밀번호를 채워 뒀어요. 바꿔도 돼요" : "단체방에 안내한 공통 비밀번호가 있으면 그걸 적어 주세요"}</small></span></label>
            <div class="bk-pw-in" id="aPwIn"><input type="text" class="input" id="aPw" maxlength="40" autocomplete="off" spellcheck="false" value="${esc(last)}" placeholder="영문+숫자 8자 이상" aria-label="임시 비밀번호"></div>
            <label class="radio1"><input type="radio" name="aPwMode" value="each"><span><b>자동으로 만들기</b><small>이 사람만 쓰는 비밀번호를 만들어 개인 카톡으로 전해요</small></span></label>
          </div></div>
        <p class="small muted hidden" id="aObsNote" style="margin:0">예배MC · 교역자는 리더십 권한(알림 · 정보 보기)을 받아요. 주 포지션은 비워도 되고, 섬김 응답 · 출석 · 자동 추천에서는 빠져요. 배치표에는 어느 자리든 넣을 수 있어요.</p>
        <div id="aMsg"></div><span class="small bk-err" id="aHint"></span>`,
      onInput: (e) => {
        const seg = e?.target?.closest?.(".seg button");
        if (seg && e.type === "click") {
          const box = seg.closest(".seg"), on = seg.getAttribute("aria-pressed") !== "true";
          const vv = on ? seg.dataset.v : null;
          if (box.id === "aStatus") {
            status = vv || "active"; $$("#aStatus button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.v === status)));
            $("#aObsNote").classList.toggle("hidden", !OBS[status]);
          }
          else {
            if (box.id === "aGender") gender = vv;
            if (box.id === "aSkill") skill = vv ? +vv : null;
            if (box.id === "aGift") gift = vv === null ? null : vv === "true";
            $$("#" + box.id + " button").forEach((x) => x.setAttribute("aria-pressed", String(on && x === seg)));
          }
        }
        const r = e?.target?.closest?.("[name=aPwMode]");
        if (r) { pwMode = r.value; $$("#aPwBox .radio1").forEach((l) => l.classList.toggle("on", l.querySelector("input").checked)); $("#aPwIn").classList.toggle("hidden", pwMode !== "same"); }
        if (e?.target?.id === "aPhone") { const d = e.target.value.replace(/\D/g, "").slice(0, 11); e.target.value = d.length < 4 ? d : d.length < 8 ? `${d.slice(0, 3)}-${d.slice(3)}` : `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(-4)}`; }
        draw();
      },
      onConfirm: async (close) => {
        const v = val(), pr = problems(v);
        if (pr.length) throw new Error(pr[0]);
        const dup = dupOf(v), key = JSON.stringify(dup);
        if (dup.length && confirmDup !== key) { confirmDup = key; draw(); $("#aMsg .notice")?.classList.add("deep-hit"); throw new Error("비슷한 사람이 있어요. 확인했으면 한 번 더 눌러 주세요"); }
        $("#mOk").textContent = "등록하는 중…";
        const pw = pwMode === "same" ? $("#aPw").value : null;
        const r = await api("/api/members-bulk", { action: "add", rows: [v], ...(pw ? { password: pw } : {}) });
        const res = r.results[0];
        if (!res?.ok) throw new Error(res?.error || "등록하지 못했어요");
        if (pw) rememberSharedPw(pw);
        await loadAll(); close(); await (popWait || Promise.resolve()); renderMembers();   // 앞 창의 뒤로가기 기록을 걷어 낸 뒤 새 창
        modal({ title: `${res.name}님을 등록했어요`, cancelLabel: "닫기", confirmLabel: "안내 문구 복사",
          body: `<p class="small muted" style="margin:0">${pw ? "공통 임시 비밀번호로 만들었어요." : "이 창을 닫으면 임시 비밀번호를 다시 볼 수 없어요."} 첫 로그인 때 비밀번호를 바꾸게 돼요.</p>
            <div class="msg" id="mMsg">${esc(accountMsg(res))}</div>`,
          onConfirm: async () => toast((await copyText(accountMsg(res))) ? `${res.name}님 안내 문구를 복사했어요` : "복사하지 못했어요") });
      } });
    draw();
  }
  const accountMsg = (r) => `[찬양팀] ${r.name}님, 찬양팀 플랫폼 계정이 만들어졌어요.\n· 주소: ${location.origin}/login.html\n· 아이디: ${r.email}\n· 임시 비밀번호: ${r.tempPassword}\n첫 로그인 때 비밀번호를 바꿔 주세요. 로그인한 뒤 '홈 화면에 추가'하면 알림도 받을 수 있어요.`;
  // 같은 비밀번호로 등록했을 때 단체방에 올릴 안내 (아이디는 각자 이메일)
  const groupAccountMsg = (pw) => `[찬양팀] 찬양팀 플랫폼 계정이 만들어졌어요.\n· 주소: ${location.origin}/login.html\n· 아이디: 각자 리더에게 알려 준 이메일\n· 임시 비밀번호: ${pw}\n\n오늘 안에 로그인해서 비밀번호를 꼭 바꿔 주세요. 바꾸기 전에는 다른 사람도 같은 비밀번호로 들어갈 수 있어요.\n로그인한 뒤 '홈 화면에 추가'하면 알림도 받을 수 있어요.`;
  function showTempPasswords(results, shared = false) {
    const ok = results.filter((x) => x.ok), bad = results.filter((x) => !x.ok);
    const pw = shared && ok[0]?.tempPassword;
    modal({ title: `${ok.length}명 등록했어요`, wide: true, cancelLabel: "닫기", confirmLabel: ok.length ? (pw ? "단체방 안내 문구 복사" : "목록 내려받기 (엑셀)") : "",
      body: `${ok.length && pw ? `<div class="bk-shared"><span class="small muted">모두 같은 임시 비밀번호</span><span class="temp-pw">${esc(pw)}</span>
          <span class="small">아이디는 각자의 이메일이에요. 단체방에 안내 문구를 올리고, 멤버 › <b>첫 로그인 전</b>에서 아직 비밀번호를 안 바꾼 사람을 챙겨 주세요.</span></div>
        <div class="msg" id="mMsg">${esc(groupAccountMsg(pw))}</div>
        <div class="evaltable" style="max-height:260px;overflow:auto"><table class="bk-table"><thead><tr><th>이름</th><th>아이디</th><th></th></tr></thead>
          <tbody>${ok.map((x, i) => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.email)}</td>
            <td><button type="button" class="btn btn-ghost btn-sm" data-acopy="${i}">개인 문구 복사</button></td></tr>`).join("")}</tbody></table></div>`
      : ok.length ? `<p class="notice warn" style="margin:0">임시 비밀번호는 이 창을 닫으면 다시 볼 수 없어요. 목록을 내려받거나 사람마다 문구를 복사해 개인 카톡으로 보내 주세요. 다 전한 뒤에는 내려받은 파일을 지워 주세요.</p>
        <div class="evaltable" style="max-height:360px;overflow:auto"><table class="bk-table"><thead><tr><th>이름</th><th>아이디</th><th>임시 비밀번호</th><th></th></tr></thead>
          <tbody>${ok.map((x, i) => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.email)}</td><td class="temp-pw" style="font-size:16px">${esc(x.tempPassword)}</td>
            <td><button type="button" class="btn btn-ghost btn-sm" data-acopy="${i}">문구 복사</button></td></tr>`).join("")}</tbody></table></div>` : ""}
        ${bad.length ? `<div class="notice error" style="margin:0">등록하지 못한 ${bad.length}명: ${bad.map((x) => `${esc(x.name || x.email)} (${esc(x.error)})`).join(", ")}</div>` : ""}`,
      onConfirm: pw ? async () => toast((await copyText(groupAccountMsg(pw))) ? "단체방 안내 문구를 복사했어요" : "복사하지 못했어요")
      : ok.length ? async () => {
        const X = await loadXLSX();
        const ws = X.utils.aoa_to_sheet([["이름", "아이디(이메일)", "임시 비밀번호", "보낼 문구"], ...ok.map((x) => [x.name, x.email, x.tempPassword, accountMsg(x)])]);
        ws["!cols"] = [{ wch: 12 }, { wch: 28 }, { wch: 16 }, { wch: 90 }];
        const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, "임시 비밀번호");
        X.writeFile(wb, `Pole2_임시비밀번호_${todayISO()}.xlsx`);
      } : null });
    $$("[data-acopy]").forEach((b) => b.addEventListener("click", async () => toast((await copyText(accountMsg(ok[+b.dataset.acopy]))) ? `${ok[+b.dataset.acopy].name}님 안내 문구를 복사했어요` : "복사하지 못했어요")));
  }

  function bindMemberHead() {
    $("#mFilter").onclick = (e) => { const b = e.target.closest("button"); if (b) { S.memberFilter = b.dataset.f; renderMembers(); } };
  }

  // ---------------------------------------------------------------- 객원 추가·수정
  function openGuestEdit(g, after) {
    const ps = window.__allPositions || [];
    const has = (c) => (g?.positions || []).includes(c);
    modal({
      step: "객원", title: g ? `${g.name} 수정` : "객원 추가",
      body: `<div class="grid2">
          <label class="field">이름<input type="text" id="gName" maxlength="30" value="${esc(g?.name || "")}"></label>
          <label class="field"><span class="lrow">연락처 <span class="hint">선택</span></span><input type="tel" id="gPhone" maxlength="13" value="${esc(g?.phone || "")}" placeholder="010-0000-0000"></label>
        </div>
        <div class="field"><span>포지션 <span class="hint">여러 개 고를 수 있어요</span></span>
          <div class="seg" id="gPos">${ps.map((p) => `<button type="button" data-v="${p.code}" aria-pressed="${has(p.code)}">${esc(p.name)}</button>`).join("")}</div></div>
        <label class="field"><span class="lrow">메모 <span class="hint">선택 · 예: 다른 공동체 드러머</span></span><input type="text" id="gNote" maxlength="200" value="${esc(g?.note || "")}"></label>
        ${g ? `<label style="display:flex;gap:8px;align-items:center;font-size:14px;font-weight:600"><input type="checkbox" id="gHide" ${g.is_active ? "" : "checked"} style="width:18px;height:18px;accent-color:var(--violet)"> 배치표 후보에서 숨기기</label>` : ""}
        ${g ? `<button type="button" class="btn btn-danger btn-sm" id="gDel" style="align-self:flex-start">객원 삭제</button>
          <span class="small muted" style="margin-top:-8px">삭제해도 지난 배치표에는 이름이 '(객원)'으로 남아요.</span>` : ""}`,
      onInput: (e) => {
        const b = e?.target?.closest?.("#gPos button");
        if (b && e.type === "click") b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
      },
      confirmLabel: g ? "저장" : "추가",
      onConfirm: async (close) => {
        const row = { name: $("#gName").value.trim(), phone: $("#gPhone").value.trim() || null, note: $("#gNote").value.trim() || null,
          positions: $$("#gPos [aria-pressed=true]").map((b) => b.dataset.v), is_active: g ? !$("#gHide").checked : true };
        if (!row.name) throw new Error("이름을 입력해 주세요.");
        if (!row.positions.length) throw new Error("포지션을 하나 이상 골라 주세요.");
        if (row.phone && !/^[0-9\-]{9,13}$/.test(row.phone)) throw new Error("연락처를 010-0000-0000 형식으로 입력해 주세요.");
        const { error } = g ? await sb.from("guests").update(row).eq("id", g.id) : await sb.from("guests").insert(row);
        if (error) throw new Error("저장하지 못했습니다");
        const { data } = await sb.from("guests").select("*").order("name"); S.guests = data || [];
        close(); toast(g ? "저장했어요" : `${row.name}님을 객원으로 추가했어요`); after?.();
      },
    });
    $("#gDel")?.addEventListener("click", async () => {
      if (!confirm(`${g.name}님을 객원 목록에서 지울까요?`)) return;
      const { error } = await sb.from("guests").delete().eq("id", g.id);
      if (error) return toast("지우지 못했습니다");
      S.guests = S.guests.filter((x) => x.id !== g.id);
      curClose?.(); toast("지웠어요"); after?.();
    });
  }

  // ---------------------------------------------------------------- 멤버 상세
  async function renderMemberDetail(id) {
    const m = S.members.find((x) => x.id === id);
    if (!m) { $("#content").innerHTML = `<div class="empty">멤버를 찾을 수 없어요. <a href="#members">멤버로</a></div>`; return; }
    const today = todayISO();
    const lastSat = lastSaturday(today);
    const weeks = Array.from({ length: 12 }, (_, i) => addDays(lastSat, -7 * (11 - i)));
    const from = addDays(monthOf(today), -31 * 6).slice(0, 8) + "01";
    const [act, note, avail] = await Promise.all([
      loadActivity(from < weeks[0] ? from : weeks[0]),
      sb.from("member_notes").select("*").eq("member_id", id).maybeSingle(),
      (async () => {
        const { data: mo } = await sb.from("availability_months").select("*").eq("is_open", true).gte("month", monthOf(today)).order("month").limit(1);
        const open = mo?.[0]; if (!open) return null;
        const slots = slotsOfMonth(open.month);
        const { data } = await sb.from("availability").select("date").eq("member_id", id).gte("date", slots[0].date).lte("date", slots[slots.length - 1].date);
        return { open, total: slots.length, done: (data || []).length };
      })(),
    ]);
    const mt = (d) => act.meetings.find((x) => x.meeting_date === d);
    const served = servedList(act.services, id);
    const past = served.filter((s) => s.date <= today);

    // 요약 숫자
    const q3 = served.filter((s) => s.date >= addDays(today, -91) && s.date.slice(0, 7) <= today.slice(0, 7)).length;
    const actives = S.members.filter((x) => x.is_active && x.status === "active");
    const avg = actives.length ? actives.reduce((s, x) => s + servedList(act.services, x.id).filter((v) => v.date >= addDays(today, -91) && v.date.slice(0, 7) <= today.slice(0, 7)).length, 0) / actives.length : 0;
    const monthN = served.filter((s) => s.date.slice(0, 7) === today.slice(0, 7)).length;
    const heldWeeks = weeks.filter((d) => mt(d)?.meeting_status === "yes");
    const mrec = heldWeeks.map((d) => recOf(mt(d), id, "meeting")).filter(Boolean);
    const mAtt = mrec.filter((r) => r.status !== "absent").length, mLate = mrec.filter((r) => r.status === "late").length;
    const srec = weeks.flatMap((d) => ["practice", "rehearsal"].map((k) => recOf(mt(d), id, k))).filter(Boolean);
    const sLate = srec.filter((r) => r.status === "late").length;
    const streak = absenceStreak(m, act.meetings, today);
    const lastLate = weeks.slice().reverse().find((d) => ["practice", "rehearsal", "meeting"].some((k) => recOf(mt(d), id, k)?.status === "late"));
    const respTile = m.status !== "active" ? `<span>섬김 응답</span><b class="muted">대상 아님</b><small>${m.status === "trainee" ? "수습 중" : ""}</small>`
      : !avail ? `<span>섬김 응답</span><b class="muted">–</b><small>지금 받는 달 없음</small>`
      : avail.done >= avail.total ? `<span>섬김 응답</span><b style="color:var(--ok)">완료</b><small>${monthLabel(avail.open.month)} 응답${avail.open.deadline ? " · " + dday(avail.open.deadline) : ""}</small>`
      : `<span>섬김 응답</span><b style="color:var(--warn)">${avail.done ? `${avail.done}/${avail.total}` : "미응답"}</b><small>${monthLabel(avail.open.month)} 응답${avail.open.deadline ? " · " + dday(avail.open.deadline) : ""}</small>`;

    // 섬김 통계: 최근 6개월 막대
    const months = Array.from({ length: 6 }, (_, i) => addMonths(monthOf(today), i - 5));
    const perMonth = months.map((mo) => served.filter((s) => s.date.slice(0, 7) === mo.slice(0, 7)).length);
    const maxM = Math.max(1, ...perMonth);
    const byPosCount = {};
    past.forEach((s) => { byPosCount[s.position_code] = (byPosCount[s.position_code] || 0) + 1; });
    const sl = past.filter((s) => s.is_singer_leader).length, bm = past.filter((s) => s.is_band_master).length;
    const recent = served.filter((s) => s.date <= addDays(today, 14)).slice(-5).reverse();
    const sunStatus = (s) => {
      if (s.date > today) return `<span class="muted small">예정</span>`;
      const sat = mt(addDays(s.date, -1));
      const p = recOf(sat, id, "practice"), r = recOf(sat, id, "rehearsal");
      const t = (x, label) => !x ? "" : `<span style="color:${x.status === "present" ? "var(--ok)" : x.status === "late" ? "var(--mid)" : "var(--bad)"}">${label} ${ATT[x.status]}</span>`;
      return `<span class="small" style="font-weight:700;display:flex;gap:8px">${[t(p, "연습"), t(r, "리허설")].filter(Boolean).join("") || `<span class="muted">출석 기록 없음</span>`}</span>`;
    };

    // 출석 12주
    const short = { present: "출", late: "지", absent: "결" };
    const servedOnSun = (d) => served.some((s) => s.date === addDays(d, 1));
    const cell = (d, kind) => {
      const row = mt(d);
      if (!row) return `<span class="c o" title="${md(d)} 기록 없음">·</span>`;
      if (kind === "meeting" && row.meeting_status === "no") return `<span class="c o">없음</span>`;
      if (kind === "practice" && row.practice_cancelled) return `<span class="c o" title="${md(d)} 토요 연습 취소 · 당일 리허설만">취소</span>`;
      if (kind !== "meeting" && !servedOnSun(d) && !recOf(row, id, kind)) return `<span class="c o">·</span>`;
      const r = recOf(row, id, kind);
      if (!r) return `<span class="c n" title="${md(d)} ${ACT_KINDS[kind]} 미기록">–</span>`;
      return `<span class="c ${r.status[0]}" title="${md(kind === "rehearsal" ? addDays(d, 1) : d)} ${ACT_KINDS[kind]} ${ATT[r.status]}${r.status === "absent" ? " · " + esc(reasonText(r)) : ""}">${short[r.status]}</span>`;
    };
    const absences = weeks.slice().reverse().flatMap((d) => ["practice", "meeting", "rehearsal"].map((k) => ({ d, k, r: recOf(mt(d), id, k) })))
      .filter((x) => x.r?.status === "absent");
    const myPos = [m.main_position, ...extrasOf(id)];
    const skillLine = myPos.map((c) => `${POS_SHORT[c] || positionName(c)} ${skillSet(id, c) ? LEVEL[skillSet(id, c)] : "–"}`).join(" · ");

    $("#content").innerHTML = `
      <a href="#members" class="back" style="align-self:flex-start">멤버로 돌아가기</a>
      <section class="phead">
        <div>
          <h1>${esc(m.name)} <span class="chip ${m.is_active ? "chip-ok" : "chip-gray"}">${m.is_active ? "활동" : "휴면·종료"}</span>
            ${leaderChip(m)}${firstLogin(m) ? `<span class="chip chip-first">첫 로그인 전</span>` : ""}${m.status === "trainee" ? `<span class="chip chip-mid">${traineeLabel(m)}</span>` : ""}
            ${streak.n >= STREAK_LIMIT ? `<span class="chip chip-bad">팀모임 ${streak.n}회 연속 결석</span>` : ""}</h1>
          <span class="muted">${isObs(m) ? `${OBS[m.status]} · 리더십 권한으로 알림 · 정보를 받아요 · 배치는 어느 자리든 할 수 있어요` : `${esc(positionName(m.main_position))} · ${extrasOf(id).length ? "추가 " + extrasOf(id).map(positionName).join(", ") : "추가 포지션 없음"}`}</span>
          <dl><div><dt>연락처</dt><dd>${esc(m.phone) || "—"}</dd></div><div><dt>이메일 (로그인)</dt><dd>${esc(m.email) || "—"}</dd></div>
            <div><dt>순모임</dt><dd>${esc(m.small_group) || "—"}</dd></div>
            <div><dt>성별</dt><dd>${m.gender ? GENDER[m.gender] : `<span style="color:var(--warn)">미입력</span>`}</dd></div>
            <div><dt>기수</dt><dd>${m.cohort ? m.cohort + "기" : "—"}</dd></div>
            <div><dt>생년월일 · 리더십만</dt><dd>${m.birth_date ? `${birthLabel(m.birth_date)}${(() => { const nb = nextBirthday(m.birth_date); return nb.days === 0 ? ` <span class="chip chip-bday">오늘 생일</span>` : nb.days <= 14 ? ` <span class="chip chip-bday">생일 D-${nb.days}</span>` : ""; })()}` : "—"}</dd></div>
            <div><dt>생일선물 정산</dt><dd>${m.gift_join === true ? "참여" : m.gift_join === false ? "미참여" : `<span class="muted">미정</span>`}</dd></div>
            <div><dt>함께한 날</dt><dd>${fmtDate(sinceOf(m), { year: "numeric", month: "long", day: "numeric" })} · ${durText(sinceOf(m))}</dd></div>
            <div><dt>숙련도 · 리더십만</dt><dd>${esc(skillLine)}</dd></div></dl>
        </div>
        <div class="acts">
          <button type="button" class="btn btn-primary btn-sm" data-act="edit">정보 수정</button>
          ${m.id !== S.me.id && !m.is_owner ? `<button type="button" class="btn btn-ghost btn-sm" data-act="active">${m.is_active ? "휴면으로 전환" : "활동으로 전환"}</button>` : ""}
          ${m.id !== S.me.id && isOwner() && !m.is_owner && m.status !== "trainee" ? `<button type="button" class="btn btn-ghost btn-sm" data-act="kind">구분 바꾸기</button>` : ""}
          ${m.id !== S.me.id && isOwner() && m.status === "active" ? `<button type="button" class="btn btn-ghost btn-sm" data-act="role">${m.role === "admin" ? "리더십 해제" : "리더십으로 지정"}</button>` : ""}
          ${lockedFor(m) ? "" : `<button type="button" class="btn btn-ghost btn-sm" data-act="reset">비밀번호 초기화</button>`}
          ${m.application_id ? `<a class="btn btn-ghost btn-sm" href="#app/${m.application_id}">지원·수습 기록</a>` : ""}
          ${m.id !== S.me.id && !m.is_owner ? `<button type="button" class="btn btn-danger btn-sm" data-act="remove">탈퇴 처리</button>` : ""}
          ${lockedFor(m) ? `<span class="lockline">최상위 리더십 계정은 본인만 휴면·탈퇴·비밀번호·이메일을 바꿀 수 있어요</span>`
            : m.id !== S.me.id && !isOwner() && m.status === "active" ? `<span class="lockline">리더십 지정·해제는 최상위 리더십(${esc(ownerOf()?.name || "—")})만 할 수 있어요</span>` : ""}
        </div>
      </section>

      <div class="kpis">
        <div class="kpi"><span>섬김 · 최근 3개월</span><b>${q3}회</b><small>팀 평균 ${avg.toFixed(1)}회 · 이번 달 ${monthN}회</small></div>
        <div class="kpi"><span>팀모임 출석률 · 최근 12주</span><b>${mrec.length ? Math.round(100 * mAtt / mrec.length) + "%" : "–"}</b><small>${mrec.length ? `${mrec.length}회 중 ${mAtt}회 (지각 ${mLate})` : "기록 없음"}</small></div>
        <div class="kpi"><span>지각 · 최근 12주</span><b style="color:${sLate ? "var(--mid)" : "inherit"}">${sLate}회</b><small>연습·리허설 기록 ${srec.length}회 중</small></div>
        <div class="kpi">${respTile}</div>
      </div>

      <div class="two">
        <section class="panel">
          <h2>섬김 통계 <small>공개된 주일 배치표 기준</small></h2>
          <div class="bars" role="img" aria-label="최근 6개월 월별 섬김 횟수">${months.map((mo, i) => `<div><b>${perMonth[i]}</b><i class="${i === 5 ? "cur" : ""}" style="height:${Math.max(4, Math.round(100 * perMonth[i] / maxM))}%" title="${monthLabel(mo)} ${perMonth[i]}회"></i>${monthLabel(mo)}</div>`).join("")}</div>
          <div class="split">${Object.entries(byPosCount).map(([c, n]) => `<span>${esc(positionName(c))}<b>${n}</b></span>`).join("")}
            ${sl ? `<span>싱어 리더<b>${sl}</b></span>` : ""}${bm ? `<span>밴드 마스터<b>${bm}</b></span>` : ""}${!past.length ? `<span class="muted">최근 6개월 섬김 기록 없음</span>` : ""}</div>
          ${recent.length ? `<div><b class="small">최근 섬김</b><div class="hist" style="margin-top:4px">${recent.map((s) => `<div><b>${md(s.date)}</b>
            <span>${esc(positionName(s.position_code))} ${s.is_singer_leader ? `<span class="chip chip-violet">싱어 리더</span>` : ""}${s.is_band_master ? `<span class="chip chip-violet">밴마</span>` : ""}</span>${sunStatus(s)}</div>`).join("")}</div></div>` : ""}
        </section>
        <section class="panel">
          <h2>출석 <small>최근 12주</small></h2>
          <div class="agrid" style="grid-template-columns:64px repeat(12, minmax(0, 1fr))">
            <span></span>${weeks.map((d) => `<span class="h">${md(d)}</span>`).join("")}
            <span class="l">토 연습</span>${weeks.map((d) => cell(d, "practice")).join("")}
            <span class="l">팀모임</span>${weeks.map((d) => cell(d, "meeting")).join("")}
            <span class="l">주일 리허설</span>${weeks.map((d) => cell(d, "rehearsal")).join("")}
          </div>
          <div class="legend"><span><i style="background:var(--ok-bg)"></i>출석</span><span><i style="background:var(--mid-bg)"></i>지각</span><span><i style="background:var(--bad)"></i>결석</span><span>– 미기록 · · 섬김 없는 주</span></div>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">
            <div style="background:var(--bg);border-radius:10px;padding:10px 12px"><b style="font-size:20px;color:${streak.n >= STREAK_LIMIT ? "var(--bad)" : "inherit"}">${streak.n}회</b><br><span class="small muted">팀모임 연속 결석</span></div>
            <div style="background:var(--bg);border-radius:10px;padding:10px 12px"><b style="font-size:20px">${lastLate ? md(lastLate) : "–"}</b><br><span class="small muted">마지막 지각</span></div>
          </div>
          ${absences.length ? `<div><b class="small">결석 사유</b><div class="hist" style="margin-top:4px">${absences.map((x) => `<div style="grid-template-columns:56px 84px minmax(0,1fr)"><b>${md(x.k === "rehearsal" ? addDays(x.d, 1) : x.d)}</b><span class="muted small">${ACT_KINDS[x.k]}</span><span>${esc(reasonText(x.r))}</span></div>`).join("")}</div></div>` : ""}
        </section>
      </div>

      <section class="panel">
        <h2>리더십 메모 <small>리더십끼리만 봐요 · 본인에게는 안 보여요</small></h2>
        ${note.data ? `<div class="note-box" style="white-space:pre-wrap">${esc(note.data.note)}</div><span class="small muted">${esc(memberName(note.data.updated_by))} · ${fmtDate(note.data.updated_at)} 저장</span>`
          : `<span class="small muted">아직 메모가 없어요. '정보 수정'에서 남길 수 있어요.</span>`}
      </section>`;

    $(".phead .acts").onclick = (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act; if (!act) return;
      if (act === "edit") return openMemberEdit(m, note.data?.note || "");
      memberAction(m, act);
    };
  }

  async function memberAction(m, act) {
    if (act === "kind") {   // 021: 정식 ↔ 예배MC ↔ 교역자 (최상위 리더십만)
      let to = m.status;
      const ps = await loadPositions();
      const draw = () => {
        $$("#kSeg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === to)));
        $("#kPos").classList.toggle("hidden", !(to === "active" && isObs(m)));
        $("#kNote").innerHTML = to === m.status ? "" : OBS[to]
          ? `${OBS[to]}은 리더십 권한을 받아요(관리자 화면 · 알림 · 정보). 섬김 응답 · 출석 · 자동 추천 · 인원 전망에서는 빠지고, 배치표에는 어느 자리든 직접 넣을 수 있어요.${m.role_title ? " 직책은 해제돼요." : ""}`
          : "정식 팀원이 되면 섬김 응답 · 출석 대상이 되고, 리더십 권한은 해제돼요. 필요하면 다시 리더십으로 지정해 주세요.";
        $("#mOk").disabled = to === m.status;
      };
      modal({ title: `${m.name}님 구분 바꾸기`, confirmLabel: "바꾸기",
        body: `<div class="seg" id="kSeg">${[["active", "정식"], ["mc", "예배MC"], ["pastor", "교역자"]].map(([k, l]) => `<button type="button" data-v="${k}">${l}</button>`).join("")}</div>
          <label class="field hidden" id="kPos">주 포지션 *<select class="select" id="kMain"><option value="">고르기</option>${ps.map((p) => `<option value="${p.code}" ${p.code === m.main_position ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
          <p class="small muted" id="kNote" style="margin:0"></p>`,
        onInput: (e) => { const b = e?.target?.closest?.("#kSeg button"); if (b && e.type === "click") to = b.dataset.v; draw(); },
        onConfirm: async (close) => {
          const patch = { status: to };
          if (to === "active") {
            patch.role = "member";
            if (isObs(m)) { if (!$("#kMain").value) throw new Error("주 포지션을 골라 주세요"); patch.main_position = $("#kMain").value; }
          }
          const { error } = await sb.from("members").update(patch).eq("id", m.id);
          if (error) throw new Error(/최상위/.test(error.message) ? error.message : "바꾸지 못했어요");
          Object.assign(m, patch, OBS[to] ? { role: "admin", role_title: null, title_until: null } : {});
          close(); toast(`${m.name}님 → ${OBS[to] || "정식"}`); route();
        } });
      return;
    }
    if (act === "role") {
      const on = m.role !== "admin";
      return modal({ title: on ? `${m.name}님을 리더십으로 지정` : `${m.name}님 리더십 해제`,
        body: `<p style="margin:0">${on ? "관리자 화면에 들어올 수 있고, 지원서·평가표·멤버 정보·리더십 메모를 볼 수 있어요." : "관리자 화면에 들어올 수 없게 돼요. 지금까지 남긴 평가·기록은 그대로 남아요."}</p>`,
        confirmLabel: on ? "리더십으로 지정" : "리더십 해제", danger: !on,
        onConfirm: async (close) => {
          const { error } = await sb.from("members").update({ role: on ? "admin" : "member" }).eq("id", m.id);
          if (error) throw new Error(error.message);
          m.role = on ? "admin" : "member"; close();
          toast(on ? `${m.name}님 리더십 지정` : `${m.name}님 리더십 해제`); route();
        } });
    }
    if (act === "active") {
      const patch = { is_active: !m.is_active };
      const { error } = await sb.from("members").update(patch).eq("id", m.id);
      if (error) return toast(/최상위/.test(error.message) ? error.message : "바꾸지 못했습니다", 4000);
      Object.assign(m, patch);
      toast(act === "active" ? (m.is_active ? `${m.name}님 활동으로 전환` : `${m.name}님 휴면으로 전환`) : (m.role === "admin" ? `${m.name}님 리더십 지정` : `${m.name}님 리더십 해제`));
      return route();
    }
    if (act === "remove") return openRemove(m);
    if (act === "reset") {
      modal({
        title: `${m.name}님 비밀번호 초기화`, body: `<p style="margin:0">새 임시 비밀번호를 발급해요. 지금 쓰는 비밀번호로는 더 이상 로그인할 수 없어요.</p>`,
        confirmLabel: "초기화",
        onConfirm: async (close) => {
          const r = await api("/api/reset-password", { memberId: m.id });
          close();
          const text = `[찬양팀] ${r.name}님, 새 로그인 정보입니다.\n\n주소: ${location.origin}/login.html\n아이디: ${r.email}\n임시 비밀번호: ${r.tempPassword}\n\n로그인 후 비밀번호를 바꿔 주세요.`;
          modal({ title: `${m.name}님 임시 비밀번호`, cancelLabel: "닫기", confirmLabel: "문구 복사",
            body: `<p style="margin:0">임시 비밀번호 <span class="temp-pw">${esc(r.tempPassword)}</span></p><p class="small muted" style="margin:0">지금 한 번만 보여요.</p>${msgBox(text)}`,
            onConfirm: async () => toast((await copyText(text)) ? "복사했어요" : "복사하지 못했어요") });
        },
      });
    }
  }

  // ---------------------------------------------------------------- 정보 수정
  function openMemberEdit(m, noteText) {
    const ps = window.__allPositions || [];
    const ex = extrasOf(m.id);
    const obs = isObs(m);   // 021: 예배MC · 교역자는 포지션 · 숙련도 · 직책 칸이 없음
    // 숙련도: 화면에서 고친 값 (포지션을 바꿔도 유지)
    const lv = Object.fromEntries(S.skills.filter((k) => k.member_id === m.id).map((k) => [k.position_code, k.level]));
    // 020: 창을 연 때의 값 — 저장할 때 함께 보내서 내가 바꾼 칸만 저장 (다른 리더가 그 사이 고친 칸은 덮어쓰지 않음)
    const PROF = ["name", "phone", "small_group", "served_since", "main_position", "gender", "cohort", "birth_date", "gift_join", "role_title"];
    const base = { ...Object.fromEntries(PROF.map((k) => [k, m[k] ?? null])), extras: ex.slice(), skills: { ...lv }, note: noteText || null };
    const curPos = () => {
      const main = $("#eMain [aria-pressed=true]")?.dataset.v || m.main_position;
      return [main, ...$$("#eExtra input:checked").map((x) => x.value).filter((c) => c !== main)];
    };
    const drawSkills = () => {
      $("#eSkills").innerHTML = curPos().map((c, i) => `<div class="skrow"><span><b>${esc(positionName(c))}</b>${i === 0 ? ` <span class="chip chip-violet">주</span>` : ""}</span>
        <div class="seg" data-skill="${c}">${[3, 2, 1].map((k) => `<button type="button" data-v="${k}" aria-pressed="${lv[c] === k}">${LEVEL[k]}</button>`).join("")}</div></div>`).join("");
    };
    modal({
      step: "멤버 정보", title: `${m.name} 정보 수정`,
      body: `<div id="eConflict" style="display:contents"></div><div class="grid2">
          <label class="field"><span class="lrow">이름</span><input type="text" id="eName" maxlength="30" value="${esc(m.name)}"></label>
          <label class="field"><span class="lrow">연락처</span><input type="tel" id="ePhone" maxlength="13" value="${esc(m.phone || "")}" placeholder="010-0000-0000"></label>
          <label class="field"><span class="lrow">순모임</span><input type="text" id="eGroup" maxlength="30" value="${esc(m.small_group || "")}" placeholder="예: OOO순"></label>
          <label class="field"><span class="lrow">함께한 날 <span class="hint">· 실제 찬양팀 합류일</span></span><input type="date" id="eSince" value="${sinceOf(m) || ""}"></label>
          <label class="field"><span class="lrow">기수</span><span style="display:flex;align-items:center;gap:6px"><input type="text" id="eCohort" inputmode="numeric" maxlength="3" value="${m.cohort ?? ""}" placeholder="예: 39" style="min-width:0">기</span></label>
          <label class="field"><span class="lrow">생년월일 <span class="hint">· 양력 · 리더십만 봐요</span></span><input type="date" id="eBirth" min="1940-01-01" max="2020-12-31" value="${m.birth_date || ""}"></label>
        </div>
        <div class="field"><span class="lrow">생일선물 정산 <span class="hint">· 참여한 사람만 생일 선물을 받아요. 바꿀 땐 본인이 리더십에게 말해요</span></span>
          <div class="seg" id="eGift"><button type="button" data-v="true" aria-pressed="${m.gift_join === true}">참여</button><button type="button" data-v="false" aria-pressed="${m.gift_join === false}">미참여</button></div></div>
        ${obs ? "" : `<label class="field"><span class="lrow">리더십 직책 <span class="hint">· 인원 전망의 승계 계산에 써요. 다른 사람이 맡고 있으면 그 사람 직책은 비워져요</span></span>
          <select class="select" id="eTitle"><option value="">없음</option>${TITLE_ORDER.map((t) => { const h = S.members.find((x) => x.role_title === t && x.id !== m.id);
            return `<option value="${t}" ${m.role_title === t ? "selected" : ""}>${TITLES[t]}${h ? ` (지금 ${esc(h.name)})` : ""}</option>`; }).join("")}</select></label>`}
        <div class="field"><span class="lrow">성별 <span class="hint">· 배치 추천에서 싱어 성비에 써요</span></span>
          <div class="seg" id="eGender"><button type="button" data-v="m" aria-pressed="${m.gender === "m"}">남</button><button type="button" data-v="f" aria-pressed="${m.gender === "f"}">여</button></div></div>
        <label class="field">이메일 (로그인 아이디)<input type="email" id="eEmail" value="${esc(m.email || "")}" ${lockedFor(m) ? "disabled" : ""}>
          <span class="hint">${lockedFor(m) ? "최상위 리더십 계정의 이메일은 본인만 바꿀 수 있어요." : "바꾸면 다음 로그인부터 새 이메일로 로그인해요. 본인에게 꼭 알려 주세요."}</span></label>
        ${obs ? `<p class="small muted" style="margin:0">${OBS[m.status]}은 주 포지션 · 추가 포지션 · 숙련도 없이 배치표 어느 자리든 넣을 수 있어요.</p>` : `<div class="field"><span>주 포지션</span>
          <div class="seg" id="eMain">${ps.map((p) => `<button type="button" data-v="${p.code}" aria-pressed="${p.code === m.main_position}">${esc(p.name)}</button>`).join("")}</div>
          <span class="hint">이미 짜인 배치표는 그대로 남아요. 다음 배치부터 새 포지션 후보로 보여요.</span></div>
        <div class="field"><span>추가 포지션</span><div id="eExtra" style="display:flex;flex-wrap:wrap;gap:6px 14px">${ps.map((p) =>
          `<label style="display:inline-flex;align-items:center;gap:6px;font-weight:500;font-size:14px" data-for="${p.code}" class="${p.code === m.main_position ? "hidden" : ""}"><input type="checkbox" value="${p.code}" ${ex.includes(p.code) ? "checked" : ""} style="width:18px;height:18px;accent-color:var(--violet)">${esc(p.name)}</label>`).join("")}</div></div>
        <div class="field"><span class="lrow">포지션별 숙련도 <span class="chip chip-violet">리더십만 봐요</span></span>
          <div id="eSkills" class="sklist"></div>
          <span class="hint">배치 자동 추천에서 주마다 실력이 고르게 섞이도록 써요. 비워 두면 '중'으로 계산해요.</span></div>`}
        <label class="field">리더십 메모 <span class="hint">리더십끼리만 봐요. 본인에게는 안 보여요.</span><textarea id="eNote" maxlength="1000" style="min-height:80px">${esc(noteText)}</textarea></label>`,
      onInput: (e) => {
        if (!obs && !$("#eSkills").children.length && !e) drawSkills();
        if (!e) return;
        const b = e.target?.closest?.("#eMain button");
        if (b && e.type === "click") {
          $$("#eMain button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          $$("#eExtra label").forEach((l) => { l.classList.toggle("hidden", l.dataset.for === b.dataset.v); if (l.dataset.for === b.dataset.v) l.querySelector("input").checked = false; });
          drawSkills();
        }
        if (e.target?.closest?.("#eExtra input") && e.type === "input") drawSkills();
        const fb = e.target?.closest?.("#eGift button");
        if (fb && e.type === "click") $$("#eGift button").forEach((x) => x.setAttribute("aria-pressed", String(x === fb && x.getAttribute("aria-pressed") !== "true")));
        const gb = e.target?.closest?.("#eGender button");
        if (gb && e.type === "click") $$("#eGender button").forEach((x) => x.setAttribute("aria-pressed", String(x === gb && x.getAttribute("aria-pressed") !== "true")));
        const k = e.target?.closest?.("[data-skill] button");
        if (k && e.type === "click") {
          const c = k.closest("[data-skill]").dataset.skill, v = +k.dataset.v;
          lv[c] = lv[c] === v ? null : v;
          drawSkills();
        }
      },
      confirmLabel: "저장",
      onConfirm: async (close) => {
        const name = $("#eName").value.trim(), phone = $("#ePhone").value.trim() || null, email = $("#eEmail").value.trim().toLowerCase();
        const main = obs ? m.main_position : $("#eMain [aria-pressed=true]").dataset.v;
        if (!name) throw new Error("이름을 입력해 주세요.");
        if (phone && !/^[0-9\-]{9,13}$/.test(phone)) throw new Error("연락처를 010-0000-0000 형식으로 입력해 주세요.");
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("이메일 주소를 다시 확인해 주세요.");
        const coh = $("#eCohort").value.replace(/\D/g, ""), birth = $("#eBirth").value || null;
        if (coh && +coh > 200) throw new Error("기수를 확인해 주세요.");
        if (birth && (birth < "1940-01-01" || birth > "2020-12-31")) throw new Error("생년월일을 확인해 주세요.");
        const gv = $("#eGift [aria-pressed=true]")?.dataset.v;
        const want = obs ? ex.slice() : $$("#eExtra input:checked").map((x) => x.value).filter((c) => c !== main);
        // 숙련도: 지금 포지션만 남김 (빠진 포지션 · 비운 칸은 null = 지움)
        const keep = [main, ...want];
        const skills = obs ? { ...base.skills } : Object.fromEntries([...new Set([...Object.keys(base.skills), ...keep])].map((c) => [c, keep.includes(c) && lv[c] ? lv[c] : null]));
        const after = { name, phone, small_group: $("#eGroup").value.trim() || null, served_since: $("#eSince").value || null, main_position: main,
          gender: $("#eGender [aria-pressed=true]")?.dataset.v || null, cohort: coh ? +coh : null, birth_date: birth, gift_join: gv === undefined ? null : gv === "true",
          role_title: obs ? null : $("#eTitle").value || null, extras: want, skills, note: $("#eNote").value.trim() || null };
        // 한 번에 저장 (직책 옮기기 · 추가 포지션 · 숙련도 · 메모까지) — 다른 리더가 먼저 고친 칸이 있으면 아무것도 저장하지 않음
        const r = await saveRpc("save_member", { p_id: m.id, p_before: base, p_after: after });
        if (r.conflict) {
          for (const c of r.conflict) {   // 다음 저장은 지금 값을 기준으로 → 한 번 더 누르면 내가 적은 값으로
            if (c.field.startsWith("skill:")) base.skills[c.field.slice(6)] = c.now; else base[c.field] = c.now;
          }
          $("#eConflict").innerHTML = conflictBox(r.conflict, "확인했으면 저장을 한 번 더 누르세요. 위 칸들도 내가 적은 값으로 바꿔요. 다른 칸은 아직 저장되지 않았어요.");
          $("#mOk").textContent = "내 값으로 저장";
          $(".modal")?.scrollTo({ top: 0 }); $(".modal-back")?.scrollTo({ top: 0 });
          return;
        }
        // 로그인 이메일 (서버에서 계정과 함께 변경)
        if (email !== (m.email || "").toLowerCase()) await api("/api/update-email", { memberId: m.id, email });
        await loadAll(); close(); toast("저장했어요"); route();
      },
    });
  }

  function openRemove(m) {
    modal({
      step: "탈퇴 처리", title: `${m.name}님 탈퇴 처리`,
      body: `<div class="field"><span>사유</span><div class="seg" id="rmWhy">${REMOVE_REASONS.map((r, i) => `<button type="button" data-v="${r}" aria-pressed="${i === 0}">${r}</button>`).join("")}</div></div>
        <label class="field">메모 (선택)<input type="text" id="rmNote" maxlength="100" placeholder="예: 2026년 가을 파송"></label>
        <div class="grid2" style="font-size:14px">
          <div class="card" style="background:var(--bg);padding:12px 14px"><b>남는 것</b><ul style="margin:6px 0 0;padding-left:18px">
            <li>탈퇴 기록: 이름·포지션·활동 기간·사유 (재가입 확인용)</li><li>지난 배치표의 이름</li></ul></div>
          <div class="card" style="background:var(--bad-bg);padding:12px 14px"><b>지워지는 것</b><ul style="margin:6px 0 0;padding-left:18px">
            <li>로그인 계정, 연락처·이메일</li><li>지원서·서약, 평가표, 수습 기록</li><li>섬김 응답, 출석, 리더십 메모·숙련도</li></ul></div>
        </div>
        <p class="notice warn" style="margin:0">되돌릴 수 없어요. 잠시 쉬는 경우라면 탈퇴 대신 '휴면으로 전환'을 써 주세요.</p>
        <label class="field">확인을 위해 이름을 입력해 주세요<input type="text" id="rmName" placeholder="${esc(m.name)}" autocomplete="off"></label>`,
      onInput: (e) => {
        if (e?.target?.closest?.("#rmWhy button")) $$("#rmWhy button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.target.closest("button"))));
        $("#mOk").disabled = $("#rmName").value.trim() !== m.name;
      },
      confirmLabel: "탈퇴 처리", danger: true,
      onConfirm: async (close) => {
        const why = $("#rmWhy [aria-pressed=true]").dataset.v, note = $("#rmNote").value.trim();
        await api("/api/remove-member", { memberId: m.id, reason: note ? `${why} · ${note}` : why, confirmName: $("#rmName").value.trim() });
        await loadAll(); close(); toast(`${m.name}님을 탈퇴 처리했어요`); nav("members");
      },
    });
    $("#mOk").disabled = true;
  }

  // ---------------------------------------------------------------- 안내 문구
  async function renderTemplates() {
    const { data: pledges } = await sb.from("pledge_versions").select("*").order("created_at", { ascending: false });
    const pv = pledges || [];
    const active = pv.find((p) => p.is_active);
    const signers = (id) => S.apps.filter((a) => a.pledge_version_id === id).length;
    $("#content").innerHTML = `
      <div class="page-head"><h1 class="page-title">안내 문구·서약서</h1></div>

      <section class="card bordered" id="pledgeCard" style="display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px">
          <h2 style="font-size:17px;font-weight:800">서약서 <span class="chip chip-ok" style="margin-left:6px">지원서에 쓰는 중</span></h2>
          <span class="small muted">${active ? `${fmtDate(active.created_at, { year: "numeric", month: "long", day: "numeric" })}부터 · 서약 ${signers(active.id)}명` : "활성 서약서 없음"}</span>
        </div>
        <p class="small muted" style="margin:0">고쳐서 저장하면 <b>새 버전</b>이 돼요. 이미 서약한 사람은 서약 당시 문구가 그대로 남고, 새 지원자부터 바뀐 문구로 서약해요.</p>
        <label class="field">제목<input type="text" id="pTitle" maxlength="100" value="${esc(active?.title || "")}"></label>
        <label class="field">내용<textarea id="pBody" style="min-height:420px;font-size:14px;line-height:1.8">${esc(active?.content || "")}</textarea></label>
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <details><summary class="small" style="cursor:pointer;color:var(--violet);font-weight:700">이전 버전 ${Math.max(pv.length - 1, 0)}개</summary>
            <ul style="margin:8px 0 0;padding-left:18px;font-size:14px">${pv.filter((p) => !p.is_active).map((p) =>
              `<li>${esc(p.title)} · ${fmtDate(p.created_at, { year: "numeric", month: "numeric", day: "numeric" })} · 서약 ${signers(p.id)}명</li>`).join("") || "<li>없음</li>"}</ul></details>
          <button type="button" class="btn btn-primary btn-sm" id="pSave">새 버전으로 저장</button>
        </div>
      </section>

      <h2 style="font-size:19px;font-weight:800;margin-top:8px">안내 문구</h2>
      <p class="lead">정해진 시점 · 정해진 문구 · 정해진 발신자. 톤은 인사 → 본론 → 유의사항 → 축복의 마무리로 맞춰요.</p>
      <p class="notice ok" style="margin:0">자동으로 채워지는 자리: [이름] [면접 일시] [면접 장소] [수습 시작일] [사이트 주소] [아이디] [임시 비밀번호]. 나머지 [대괄호]는 보낼 때 직접 채워요.</p>
      <div style="display:flex;flex-direction:column;gap:12px" id="tplList">${S.templates.map((t) => `
        <section class="card bordered" data-code="${t.code}" style="display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px">
            <h2 style="font-size:17px;font-weight:800">${esc(t.title)}</h2>
            <span style="display:flex;gap:6px;flex-wrap:wrap"><span class="chip chip-violet">${esc(t.timing)}</span>${t.sensitive ? `<span class="chip chip-warn">전화 먼저</span>` : ""}</span>
          </div>
          <textarea class="input" style="min-height:220px;font-size:14px" aria-label="${esc(t.title)} 문구">${esc(t.body)}</textarea>
          <div style="display:flex;justify-content:flex-end"><button type="button" class="btn btn-soft btn-sm" data-save>저장</button></div>
        </section>`).join("")}</div>`;
    $("#tplList").onclick = async (e) => {
      if (!e.target.closest("[data-save]")) return;
      const sec = e.target.closest("[data-code]");
      const body = sec.querySelector("textarea").value.trim();
      if (!body) return toast("문구를 비워 둘 수 없어요");
      const { error } = await sb.from("message_templates").update({ body }).eq("code", sec.dataset.code);
      if (error) return toast("저장하지 못했습니다");
      tpl(sec.dataset.code).body = body;
      toast("문구를 저장했어요");
    };
    $("#pSave").onclick = () => {
      const title = $("#pTitle").value.trim(), content = $("#pBody").value.trim();
      if (!title || !content) return toast("제목과 내용을 채워 주세요");
      if (active && title === active.title && content === active.content) return toast("바뀐 내용이 없어요");
      modal({
        title: "서약서 새 버전 저장",
        body: `<p style="margin:0">지금부터 지원서에는 새 문구가 보여요. 이미 서약한 ${active ? signers(active.id) + "명을 포함한 " : ""}기존 지원자·팀원의 서약 기록은 바뀌지 않아요.</p>`,
        confirmLabel: "새 버전으로 저장",
        onConfirm: async (close) => {
          // 활성 서약서는 하나만: 기존 것을 먼저 내리고 새 것을 올림
          if (active) { const { error } = await sb.from("pledge_versions").update({ is_active: false }).eq("id", active.id); if (error) throw new Error("저장하지 못했습니다"); }
          const { error } = await sb.from("pledge_versions").insert({ title, content, is_active: true });
          if (error) {
            if (active) await sb.from("pledge_versions").update({ is_active: true }).eq("id", active.id);   // 되돌리기
            throw new Error("저장하지 못했습니다");
          }
          close(); toast("서약서를 새 버전으로 저장했어요"); renderTemplates();
        },
      });
    };
  }

  // ================================================================ 섬김 (응답 · 배치)
  //  한 달 화면 = 주일 + 예배 1개짜리 사역(날짜순으로 끼워 넣음)
  //  예배 2개 이상인 사역(수련회 등)은 같은 화면 안의 따로 탭
  const V = { month: null, respView: "month", lineupMonth: null, view: "month", part: "vocal", sel: 0, drag: null, picked: null,
    basis: null, rec: null, recMsg: null, sugg: {}, extraOpen: {} };
  const servingMembers = () => S.members.filter((m) => m.is_active && m.status === "active");
  const slotsOfMonth = (month) => sundaysOf(month).flatMap((sun) => [
    { date: addDays(sun, -1), kind: "sat_practice", sun }, { date: sun, kind: "sunday", sun }]);
  const posOrder = () => Object.fromEntries((window.__allPositions || []).map((p) => [p.code, p.sort_order]));
  const defaultMonth = () => addMonths(monthOf(todayISO()), 1);
  const svcSort = (a, b) => a.service_date.localeCompare(b.service_date) || (a.sort_order || 0) - (b.sort_order || 0) || hm(a.start_time).localeCompare(hm(b.start_time));
  const isTarget = (mi, m) => mi.target_mode === "all" || (mi.ministry_targets || []).some((t) => t.member_id === m.id);

  async function loadMonth(month) {
    const slots = slotsOfMonth(month);
    const from = slots[0].date, to = slots[slots.length - 1].date;
    const [mo, av, nt] = await Promise.all([
      sb.from("availability_months").select("*").eq("month", month).maybeSingle(),
      sb.from("availability").select("*").gte("date", from).lte("date", to),
      sb.from("availability_notes").select("*").eq("month", month),
    ]);
    return { slots, info: mo.data, avail: av.data || [], notes: nt.data || [] };
  }
  const answerOf = (avail, memberId, date, kind) => avail.find((a) => a.member_id === memberId && a.date === date && a.kind === kind)?.available;

  // 그 달에 시작하는 사역 (예배 · 배치 · 연습 · 대상 포함)
  async function loadMonthMinistries(month) {
    const { data: sv } = await sb.from("services").select("ministry_id").not("ministry_id", "is", null)
      .gte("service_date", month).lt("service_date", addMonths(month, 1));
    const ids = [...new Set((sv || []).map((x) => x.ministry_id))];
    if (!ids.length) return [];
    const { data, error } = await sb.from("ministries").select("*, services(*, assignments(*)), ministry_practices(*), ministry_targets(member_id)").in("id", ids);
    if (error) { console.error(error); return []; }
    return (data || []).filter((mi) => mi.services.length).map((mi) => {
      const svs = mi.services.slice().sort(svcSort);
      return { ...mi, svs, multi: svs.length > 1, first: svs[0].service_date };
    }).filter((mi) => monthOf(mi.first) === month).sort((a, b) => a.first.localeCompare(b.first) || a.name.localeCompare(b.name, "ko"));
  }

  function monthNav(label, month) {
    return `<div style="display:flex;align-items:center;gap:8px">
      <button type="button" class="btn btn-ghost btn-sm" data-mnav="-1" aria-label="이전 달">이전</button>
      <h1 class="page-title">${monthLabel(month)} ${label}</h1>
      <button type="button" class="btn btn-ghost btn-sm" data-mnav="1" aria-label="다음 달">다음</button></div>`;
  }
  function bindMonthNav(onMove) {
    $$("[data-mnav]").forEach((b) => b.addEventListener("click", () => onMove(+b.dataset.mnav)));
  }
  // 월간 / 예배 여러 개 사역 탭
  const viewPills = (multis, cur, month) => multis.length ? `<div class="vpills" role="tablist" aria-label="보기">
      <button type="button" role="tab" data-view="month" aria-selected="${cur === "month"}"><b>${monthLabel(month)} 주일·사역</b><span>주일 ${sundaysOf(month).length}${multis.length ? " · 예배 1개 사역" : ""}</span></button>
      ${multis.map((mi) => `<button type="button" role="tab" data-view="${mi.id}" aria-selected="${cur === mi.id}"><b>${esc(mi.name)}</b><span>${md(mi.first)}–${md(mi.svs[mi.svs.length - 1].service_date)} · 예배 ${mi.svs.length}</span></button>`).join("")}
    </div>` : "";

  // ---------------------------------------------------------------- 섬김 응답 현황
  async function renderRespondAdmin() {
    if (!V.month) V.month = defaultMonth();
    const month = V.month;
    const [{ slots, info, avail, notes }, mins] = await Promise.all([loadMonth(month), loadMonthMinistries(month)]);
    const sids = mins.flatMap((mi) => mi.svs.map((s) => s.id));
    const pids = mins.flatMap((mi) => (mi.ministry_practices || []).map((p) => p.id));
    const pollIds = mins.filter((mi) => mi.practice_mode === "poll").map((mi) => mi.id);
    const [{ data: mav }, { data: pans }, { data: polls }] = await Promise.all([
      sids.length ? sb.from("ministry_availability").select("service_id, member_id, available").in("service_id", sids) : { data: [] },
      pids.length ? sb.from("practice_answers").select("practice_id, member_id, available").in("practice_id", pids) : { data: [] },
      pollIds.length ? sb.from("ministry_poll").select("ministry_id, member_id, slots").in("ministry_id", pollIds) : { data: [] },
    ]);
    const mAns = (sid, mid) => (mav || []).find((a) => a.service_id === sid && a.member_id === mid)?.available;
    const pAns = (pid, mid) => (pans || []).find((a) => a.practice_id === pid && a.member_id === mid)?.available;
    const slotsOf = (miId, mid) => (polls || []).find((p) => p.ministry_id === miId && p.member_id === mid)?.slots;
    // 칠한 시간이 확정된 연습 시간을 모두 덮는지 (30분 칸)
    const covers = (slots, p) => { const set = new Set(slots); for (let t = toMin(p.start_time); t < toMin(p.end_time); t += 30) if (!set.has(`${p.practice_date} ${fromMin(t)}`)) return false; return true; };
    const multis = mins.filter((mi) => mi.multi), singles = mins.filter((mi) => !mi.multi);
    if (V.respView !== "month" && !multis.some((mi) => mi.id === V.respView)) V.respView = "month";
    const curMi = multis.find((mi) => mi.id === V.respView);
    const people = servingMembers().sort((a, b) => (posOrder()[a.main_position] ?? 99) - (posOrder()[b.main_position] ?? 99) || a.name.localeCompare(b.name, "ko"));
    const sundays = sundaysOf(month);
    const monthlyMins = mins.filter((x) => x.response_mode === "monthly");

    // 칸: 토 연습 · 주일 · 사역(연습 | 본 섬김) (날짜순, 사역 연습은 그 예배 바로 앞)
    //  연습 칸: 정해진 연습 = 팀원 답 / 취합으로 정한 연습 = 칠한 시간 기준 자동 / 취합 중 = 응답·미응답만
    const pracOf = (mi, svc) => (mi.ministry_practices || []).filter((p) => !p.service_id || p.service_id === svc.id)
      .sort((a, b) => a.practice_date.localeCompare(b.practice_date) || a.start_time.localeCompare(b.start_time));
    const minCols = (mi, svc) => {
      const prs = pracOf(mi, svc);
      const out = prs.map((p) => ({ type: "prac", date: svc.service_date, mi, svc, prac: p, auto: mi.practice_mode === "poll" }));
      if (!prs.length && mi.practice_mode === "poll" && mi.poll_open) out.push({ type: "prac", date: svc.service_date, mi, svc, prac: null, polling: true });
      return [...out, { type: "min", date: svc.service_date, svc, mi }];
    };
    const units = curMi ? curMi.svs.map((s) => minCols(curMi, s))
      : [...sundays.map((sun) => [{ type: "sat", date: addDays(sun, -1) }, { type: "sun", date: sun }]),
        ...singles.map((mi) => minCols(mi, mi.svs[0]))].sort((a, b) => a[a.length - 1].date.localeCompare(b[b.length - 1].date) || (a[0].type === "sat" ? -1 : 1));
    const cols = units.flat();
    const val = (m, c) => {
      if (c.type === "sat" || c.type === "sun") return answerOf(avail, m.id, c.date, c.type === "sat" ? "sat_practice" : "sunday");
      if (!isTarget(c.mi, m)) return "x";
      if (c.type === "min") return mAns(c.svc.id, m.id);
      if (mAns(c.svc.id, m.id) !== true) return "off";   // 본 섬김이 '가능'일 때만 연습을 물어요
      if (c.polling) return slotsOf(c.mi.id, m.id)?.length ? "polled" : "pollnone";
      const x = pAns(c.prac.id, m.id);
      if (x !== undefined || !c.auto) return x;
      const sl = slotsOf(c.mi.id, m.id);
      return sl?.length ? (covers(sl, c.prac) ? "auto-yes" : "auto-no") : undefined;
    };
    const counts = (c) => c.type !== "prac" || (!c.auto && !c.polling);   // 응답 완료 계산에 들어가는 칸
    const shown = curMi ? people.filter((m) => isTarget(curMi, m)) : people;
    const need = (m) => cols.filter((c) => counts(c) && !["x", "off"].includes(val(m, c)));
    const answered = (m) => need(m).filter((c) => val(m, c) !== undefined).length;
    const done = shown.filter((m) => answered(m) === need(m).length);
    const partial = shown.filter((m) => answered(m) > 0 && answered(m) < need(m).length);
    const none = shown.filter((m) => answered(m) === 0 && need(m).length);
    const pollCols = cols.filter((c) => c.polling);
    const pollPend = shown.filter((m) => pollCols.some((c) => val(m, c) === "pollnone"));
    const pollMins = [...new Map(pollCols.map((c) => [c.mi.id, c.mi])).values()];

    const status = !info ? `<span class="chip chip-gray">월말 응답 아직 열지 않음</span>`
      : info.is_open ? `<span class="chip chip-ok">월말 응답 받는 중${info.deadline ? " · " + fmtDate(info.deadline, { month: "long", day: "numeric", weekday: "short" }) + "까지" : ""}</span>`
      : `<span class="chip chip-gray">월말 응답 마감됨</span>`;
    const sepChips = mins.filter((x) => x.response_mode === "separate").map((x) =>
      `<span class="chip ${x.response_open ? "chip-solid" : "chip-gray"}">${esc(x.name)} 따로 받기${x.response_open ? (x.response_deadline ? " · " + md(x.response_deadline) + "까지" : "") : " · 마감"}</span>`).join("");
    const actions = curMi ? `<span>${curMi.response_mode === "monthly" ? `${monthLabel(month)} 월말 응답에 포함` : `따로 받기 · ${curMi.response_open ? "응답 받는 중" : "마감됨"}${curMi.response_deadline ? " · " + md(curMi.response_deadline) + "까지" : ""}`}</span>
        <a class="btn btn-ghost btn-sm" href="#ministry/${curMi.id}">사역 화면에서 응답 열기·마감</a>`
      : !info
      ? `<label class="field" style="flex-direction:row;align-items:center;gap:8px;font-size:14px">마감일<input type="date" id="dl" value="${addDays(sundays[0], -2)}" style="min-height:40px;width:auto"></label>
         <button type="button" class="btn btn-primary" id="openMonth">${monthLabel(month)} 응답 받기 열기</button>`
      : info.is_open
      ? `<label class="field" style="flex-direction:row;align-items:center;gap:8px;font-size:14px">마감일<input type="date" id="dl" value="${info.deadline || ""}" style="min-height:40px;width:auto"></label>
         <button type="button" class="btn btn-ghost" id="saveDl">마감일 저장</button>
         <button type="button" class="btn btn-ghost" id="copyOpen">응답 안내 보내기</button>
         <button type="button" class="btn btn-danger" id="closeMonth">마감하기</button>`
      : `<button type="button" class="btn btn-ghost" id="reopen">다시 열기</button>`;

    // 왼쪽 선: 주일은 토 연습과, 사역 본 섬김은 그 연습과 한 묶음
    const lineAt = (i) => i === 0 || !(cols[i].type === "sun" || (cols[i].type === "min" && cols[i - 1]?.type === "prac"));
    const cell = (m, c, i) => {
      const v = val(m, c);
      const bl = lineAt(i) ? ` style="border-left:1px solid var(--line)"` : "";
      if (v === "x") return `<td class="a-off"${bl}><span class="small" style="color:var(--faint)">대상 아님</span></td>`;
      if (v === "off") return `<td class="a-off"${bl} title="본 섬김이 '가능'일 때만 연습을 물어요"><span style="color:var(--faint)">–</span></td>`;
      if (v === "polled" || v === "pollnone") return `<td class="${v === "polled" ? "a-yes" : "a-none"} a-min"${bl}><span class="a-txt">${v === "polled" ? "응답" : "미응답"}</span></td>`;
      const auto = v === "auto-yes" || v === "auto-no";
      const b = v === true || v === "auto-yes" ? true : v === false || v === "auto-no" ? false : undefined;
      const [cls, label, next] = b === true ? ["a-yes", "가능", "불가"] : b === false ? ["a-no", "불가", auto ? "가능" : "미응답"] : ["a-none", "–", "가능"];
      const key = c.type === "min" ? `data-sid="${c.svc.id}"` : c.type === "prac" ? `data-pid="${c.prac.id}"` : `data-date="${c.date}" data-kind="${c.type === "sat" ? "sat_practice" : "sunday"}"`;
      const what = c.type === "min" ? esc(c.mi.name) : c.type === "prac" ? esc(c.mi.name) + " 연습" : c.type === "sun" ? "주일" : "토 연습";
      return `<td class="${cls} ${c.type !== "sat" && c.type !== "sun" ? "a-min" : ""} ${auto ? "a-auto" : ""}"${bl}${auto ? ` title="칠한 시간 기준 (누르면 직접 정해요)"` : ""}><button type="button" class="a-btn" data-mid="${m.id}" ${key} data-v="${b === undefined ? "" : b}"${auto ? ` data-auto="1"` : ""}
        aria-label="${esc(m.name)} ${md(c.date)} ${what} ${b === undefined ? "미응답" : label}${auto ? " (칠한 시간 기준)" : ""}, 누르면 ${next}">${label}</button></td>`;
    };
    const head = cols.map((c, i) => {
      const style = `${lineAt(i) ? "border-left:1px solid var(--line);" : ""}text-align:center`;
      if (c.type === "prac") return `<th class="th-min th-prac" style="${style}">${esc(curMi ? c.svc.label || c.mi.name : c.mi.name)} 연습<br><span class="small" style="font-weight:600">${c.prac
        ? `${mdw(c.prac.practice_date)} ${hm(c.prac.start_time)}` : "시간 취합 중"}</span></th>`;
      return `<th class="${c.type === "min" ? "th-min" : ""}" style="${style}">${c.type === "min"
        ? `${esc(curMi ? c.svc.label || c.mi.name : c.mi.name)}<br><span class="small" style="font-weight:600">${mdw(c.date)}${c.svc.start_time ? " " + hm(c.svc.start_time) : ""}</span>`
        : `${md(c.date)}<br><span class="small" style="font-weight:600">${c.type === "sat" ? "토 연습" : "주일"}</span>`}</th>`;
    }).join("");
    const isYes = (v) => v === true || v === "auto-yes" || v === "polled";

    $("#content").innerHTML = `
      <div class="page-head">${monthNav("섬김 응답", month)}<div class="row">${status}${sepChips}</div></div>
      ${viewPills(multis, V.respView, month)}
      <section class="card bordered" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">${actions}</section>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
        <div class="card bordered"><span class="muted small">응답 완료</span><div style="font-size:26px;font-weight:800">${done.length}<span class="muted" style="font-size:15px;font-weight:600"> / ${shown.length}명</span></div></div>
        <div class="card bordered"><span class="muted small">응답 중</span><div style="font-size:26px;font-weight:800">${partial.length}<span class="muted" style="font-size:15px;font-weight:600">명</span></div></div>
        <div class="card bordered" style="display:flex;flex-direction:column;gap:6px"><span class="muted small">미응답 ${none.length + partial.length}명${pollCols.length ? ` · 연습 시간 미응답 ${pollPend.length}명` : ""}</span>
          <span style="font-size:14px;font-weight:600">${[...none, ...partial].map((m) => esc(m.name)).join(", ") || "없음"}</span>
          ${pollCols.length ? `<span class="small" style="font-weight:600"><span class="muted">연습 시간 (${esc(pollMins.map((x) => x.name).join(", "))}) ·</span> ${pollPend.map((m) => esc(m.name)).join(", ") || "모두 골랐어요"}</span>` : ""}
          ${(none.length + partial.length + pollPend.length) ? `<button type="button" class="btn btn-soft btn-sm" id="copyNudge" style="align-self:flex-start">독촉 보내기</button>` : ""}</div>
      </div>
      <p class="lead" style="margin:0">칸을 누르면 리더십이 직접 바꿀 수 있어요 (가능 → 불가 → 미응답).${curMi ? " 예배마다 따로 응답받아요." : singles.length ? " 보라색 칸은 사역이에요 — 따로 받는 사역도 여기서 함께 봐요. 예배가 2개 이상인 사역은 위 탭에서 봐요." : ""}</p>
      <div class="evaltable"><table class="resp-table">
        <thead><tr><th>이름</th><th>포지션</th>${head}${curMi ? "" : `<th style="border-left:1px solid var(--line)">전할 말</th>`}</tr></thead>
        <tbody>${shown.map((m) => `<tr><td style="font-weight:700;white-space:nowrap">${esc(m.name)}</td><td class="muted small" style="white-space:nowrap">${esc(positionName(m.main_position))}</td>
          ${cols.map((c, i) => cell(m, c, i)).join("")}
          ${curMi ? "" : `<td class="small" style="max-width:220px">${esc(notes.find((n) => n.member_id === m.id)?.note || "")}</td>`}</tr>`).join("") || `<tr><td colspan="99" class="muted">응답 대상이 없어요.</td></tr>`}
        <tr style="background:var(--bg)"><td colspan="2" class="small" style="font-weight:700">가능 인원</td>
          ${cols.map((c, i) => `<td style="font-weight:800;color:var(--violet);${lineAt(i) ? "border-left:1px solid var(--line)" : ""}">${shown.filter((m) => isYes(val(m, c))).length}</td>`).join("")}${curMi ? "" : "<td></td>"}</tr></tbody></table></div>
      ${cols.some((c) => c.type === "prac") ? `<p class="small muted" style="margin:-8px 0 0">사역 연습 칸은 본 섬김이 '가능'인 사람만 물어요. 점선 칸은 칠한 시간으로 자동 표시한 것이고, 누르면 직접 정할 수 있어요.</p>` : ""}
      ${info || mins.length ? `<a class="btn btn-primary" href="#lineup" style="align-self:flex-start" id="goLineup">${curMi ? esc(curMi.name) : monthLabel(month)} 배치하러 가기</a>` : ""}`;

    bindMonthNav((n) => { V.month = addMonths(V.month, n); V.respView = "month"; renderRespondAdmin(); });
    $$("[data-view]").forEach((b) => b.addEventListener("click", () => { V.respView = b.dataset.view; renderRespondAdmin(); }));
    $$(".a-btn").forEach((b) => b.addEventListener("click", async () => {
      const cur = b.dataset.v;   // "true" | "false" | ""
      // 칠한 시간 기준 자동 칸은 누르면 반대로 직접 정함, 직접 정한 칸은 가능 → 불가 → 미응답(자동으로 돌아감)
      const next = b.dataset.auto ? cur !== "true" : cur === "true" ? false : cur === "false" ? null : true;
      let error;
      if (b.dataset.pid) {
        const key = { practice_id: b.dataset.pid, member_id: b.dataset.mid };
        ({ error } = next === null ? await sb.from("practice_answers").delete().match(key) : await sb.from("practice_answers").upsert({ ...key, available: next }));
      } else if (b.dataset.sid) {
        const key = { service_id: b.dataset.sid, member_id: b.dataset.mid };
        ({ error } = next === null ? await sb.from("ministry_availability").delete().match(key) : await sb.from("ministry_availability").upsert({ ...key, available: next }));
      } else {
        const key = { member_id: b.dataset.mid, date: b.dataset.date, kind: b.dataset.kind };
        ({ error } = next === null ? await sb.from("availability").delete().match(key) : await sb.from("availability").upsert({ ...key, available: next }));
      }
      if (error) return toast("바꾸지 못했습니다");
      renderRespondAdmin();
    }));
    $("#goLineup")?.addEventListener("click", () => { V.lineupMonth = month; V.view = V.respView; V.sel = 0; });
    const openMsg = () => `[찬양팀] ${monthLabel(month)} 섬김 응답을 받고 있어요.\n${info?.deadline || $("#dl")?.value ? fmtDate(info?.deadline || $("#dl").value, { month: "long", day: "numeric", weekday: "short" }) + "까지 " : ""}토요 연습·주일 예배${monthlyMins.length ? "·" + monthlyMins.map((x) => x.name).join("·") : ""} 가능 여부를 체크해 주세요.\n\n${location.origin}/me.html#respond`;
    $("#openMonth")?.addEventListener("click", async () => {
      const dl = $("#dl").value || null, msg = openMsg();
      const pr = await pushRow("open", [`open:${month}`], "정식 팀원 전체에게 '응답을 받고 있어요' 알림");
      modal({ title: `${monthLabel(month)} 응답 받기 열기`,
        body: `<p style="margin:0">${dl ? fmtDate(dl, { month: "long", day: "numeric", weekday: "short" }) + "까지 " : ""}토요 연습·주일${monthlyMins.length ? "·" + esc(monthlyMins.map((x) => x.name).join("·")) : ""} 가능 여부를 받아요.</p>${pr}${msgOnly(msg)}`,
        confirmLabel: "열고 문구 복사",
        onConfirm: async (close) => {
          const push = pushChecked();
          const { error } = await sb.from("availability_months").insert({ month, deadline: dl, is_open: true });
          if (error) throw new Error("열지 못했습니다");
          await copyText(msg);
          const t = push ? await sendPush("open", { month }) : "";
          close(); toast(`${monthLabel(month)} 응답을 열었어요. 안내 문구를 복사했어요${t}`, 4000); renderRespondAdmin();
        } });
    });
    $("#saveDl")?.addEventListener("click", async () => {
      const { error } = await sb.from("availability_months").update({ deadline: $("#dl").value || null }).eq("month", month);
      toast(error ? "저장하지 못했습니다" : "마감일을 저장했어요"); renderRespondAdmin();
    });
    const people4open = () => (curMi && curMi.target_mode === "custom" ? shown : people);
    $("#copyOpen")?.addEventListener("click", () => openSend({
      title: `${monthLabel(month)} 응답 안내 보내기`, ctx: `open-info:${month}`, label: `${monthLabel(month)} 응답 안내`, url: curMi && curMi.response_mode === "separate" ? `/me.html#respond/min:${curMi.id}` : `/me.html#respond/month:${month}`,
      groups: [{ id: "all", label: "정식 팀원", people: people4open() }],
      push: () => ({ title: `${monthLabel(month)} 섬김 응답을 받고 있어요`, body: `${dlText(info?.deadline)} 토요 연습·주일${monthlyMins.length ? "·" + monthlyMins.map((x) => x.name).join("·") : ""} 가능 여부를 체크해 주세요`.trim() }),
      text: () => openMsg(),
    }));
    $("#copyNudge")?.addEventListener("click", () => {
      const what = curMi ? `${curMi.name} 섬김 응답` : `${monthLabel(month)} 섬김 응답`;
      const dl = curMi ? (curMi.response_mode === "separate" ? curMi.response_deadline : info?.deadline) : info?.deadline;
      const pdl = pollMins.map((x) => x.poll_deadline).filter(Boolean).sort()[0];
      const pname = pollMins.map((x) => x.name).join("·");
      openSend({
        title: "독촉 보내기", ctx: curMi ? `nudge-min:${curMi.id}` : `nudge:${month}`, label: `${what} 독촉`,
        url: (sel) => !sel.includes("resp") ? "/me.html#respond/poll:all" : curMi && curMi.response_mode === "separate" ? `/me.html#respond/min:${curMi.id}` : `/me.html#respond/month:${month}`,
        groups: [{ id: "resp", label: "섬김 응답 미응답", people: [...none, ...partial] }, { id: "poll", label: `${pname} 연습 시간 미응답`, people: pollPend }],
        push: (sel) => sel.includes("resp") && sel.includes("poll") ? { title: `${what} · 연습 시간이 아직 남아 있어요`, body: "체크 부탁드려요!" }
          : sel.includes("poll") ? { title: `${pname} 연습 시간을 아직 안 고르셨어요`, body: `${dlText(pdl)} 되는 칸을 눌러 주세요`.trim() }
          : { title: `${what}이 아직 남아 있어요`, body: `${dlText(dl)} 체크 부탁드려요!`.trim() },
        text: (sel, names) => sel.length > 1
          ? `[찬양팀] ${namesNim(names)}\n아직 남은 응답이 있어요.\n· ${what}${dl ? ` (${dlText(dl)})` : ""}\n· ${pname} 연습 가능 시간${pdl ? ` (${dlText(pdl)})` : ""}\n체크 부탁드려요!\n\n${location.origin}/me.html#respond`
          : sel.includes("poll") ? `[찬양팀] ${namesNim(names)}\n${pname} 연습 가능 시간을 아직 안 칠하셨어요.${pdl ? " " + dlText(pdl) : ""} 부탁드려요!\n\n${location.origin}/me.html#respond`
          : `[찬양팀] ${namesNim(names)}\n${what}이 아직 남아 있어요.${dl ? " " + dlText(dl) : ""} 체크 부탁드려요!\n\n${location.origin}/me.html#respond`,
      });
    });
    const setOpen = async (open) => {
      const { error } = await sb.from("availability_months").update({ is_open: open }).eq("month", month);
      toast(error ? "바꾸지 못했습니다" : open ? "다시 열었어요" : "응답을 마감했어요"); renderRespondAdmin();
    };
    $("#closeMonth")?.addEventListener("click", () => modal({ title: `${monthLabel(month)} 응답 마감`, body: `<p style="margin:0">마감하면 팀원들이 더 이상 응답을 바꿀 수 없어요. 월말 응답에 포함된 사역도 함께 마감돼요. 필요하면 다시 열 수 있어요.</p>`,
      confirmLabel: "마감하기", onConfirm: async (close) => { close(); await setOpen(false); } }));
    $("#reopen")?.addEventListener("click", async () => {
      const pr = await pushRow("open", [`open:${month}`], "정식 팀원 전체에게 '응답을 받고 있어요' 알림");
      modal({ title: `${monthLabel(month)} 응답 다시 열기`, body: `<p style="margin:0">팀원들이 다시 응답을 바꿀 수 있어요.</p>${pr}`, confirmLabel: "다시 열기",
        onConfirm: async (close) => {
          const push = pushChecked();
          const { error } = await sb.from("availability_months").update({ is_open: true }).eq("month", month);
          if (error) throw new Error("바꾸지 못했습니다");
          const t = push ? await sendPush("open", { month }) : "";
          close(); toast(`다시 열었어요${t}`, 4000); renderRespondAdmin();
        } });
    });
  }

  // ================================================================ 배치표
  //  B = { month, view, cols: 이 탭 열, allCols: 이 달 전체 열(공개·횟수), hist, ans(m, col, "sun"|"sat") ... }
  //  열(col) = { key, type: "sun"|"min", date, title, sub, svc, ensure(), mi? }
  //  파트 탭: 인도·싱어(vocal) / 밴드(band) / 배치 현황(status). 추천은 파트 탭마다
  const XSVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
  const PART_NAME = { vocal: "인도·싱어", band: "밴드" };
  const partOfPos = (code) => (window.__allPositions || []).find((p) => p.code === code)?.kind === "band" ? "band" : "vocal";
  const partPositions = (part) => (window.__allPositions || []).filter((p) => partOfPos(p.code) === part);
  const weekKey = (d) => addDays(d, (7 - dowOf(d)) % 7);   // 그 주의 주일 (사역은 같은 주말 주일과 같은 주로 셈)
  // 019: 기본 인원(자동 추천·공석 표시) / 최대 인원(직접 추가할 수 있는 자리)
  const baseOf = (p) => Math.min(p.base_count ?? p.max_count, p.max_count);

  // 카톡 보고 문구 — 기본 자리가 비면 X, 기본을 넘는 자리는 채웠을 때만 (같은 포지션 2명은 인도 A, B / 밴드는 A·B)
  function lineupText(date, title, list) {
    const POS = window.__allPositions || [];
    const nm = (a) => S.members.find((m) => m.id === a.member_id)?.name || S.guests.find((g) => g.id === a.guest_id)?.name || a.former_name || "X";
    const of = (code) => list.filter((x) => x.position_code === code).sort((a, b) => a.slot - b.slot);
    const leads = of("leader");
    // 021: 기본 인원 0인 선택 포지션(어쿠스틱)은 채웠을 때만
    const band = POS.filter((p) => p.kind === "band" && (baseOf(p) > 0 || of(p.code).length)).sort((a, b) => a.sort_order - b.sort_order);
    const singers = of("singer");
    return [`📍${md(date)}${title ? " " + title : ""} 라인업`, `인도: ${leads.length ? leads.map(nm).join(", ") : "X"}`,
      `[${band.map((p) => POS_SHORT[p.code] || p.name).join(" ")}]`,
      band.map((p) => { const xs = of(p.code); return xs.length ? xs.map((a) => nm(a) + (a.is_band_master ? "*" : "")).join("·") : "X"; }).join(" "),
      "[싱어]", singers.length ? singers.map((a) => nm(a) + (a.is_singer_leader ? "*" : "")).join(" ") : "X"].join("\n");
  }

  // ---- 사역 연습 시간
  const pollSet = (mi, mid) => new Set((V.board?.polls || []).find((p) => p.ministry_id === mi.id && p.member_id === mid)?.slots || []);
  const hasPoll = (mi, mid) => (V.board?.polls || []).some((p) => p.ministry_id === mi.id && p.member_id === mid);
  const winOf = (p) => ({ d: p.practice_date, s: hm(p.start_time), e: hm(p.end_time) });
  const winText = (w) => `${mdw(w.d)} ${w.s}–${w.e}`;
  const sameWin = (a, b) => !!(a && b && a.d === b.d && a.s === b.s && a.e === b.e);
  const overlap = (a, b) => a.d === b.d && toMin(a.s) < toMin(b.e) && toMin(b.s) < toMin(a.e);
  // 이 열(예배)에 확정된 연습: 예배별(service_id) 또는 예배 1개 사역의 사역 전체 연습
  const practiceOf = (col) => col.type !== "min" ? null
    : (col.mi.ministry_practices || []).find((p) => p.service_id === col.svc.id) || (!col.mi.multi ? (col.mi.ministry_practices || []).find((p) => !p.service_id) : null) || null;
  const isPollCol = (col) => col.type === "min" && col.mi.practice_mode === "poll";
  function allWins(mi) {
    const len = mi.practice_minutes || 120, end = toMin(mi.poll_day_end), out = [];
    pollDays(mi).forEach((d) => { for (let t = toMin(mi.poll_day_start); t + len <= end; t += 30) out.push({ d, s: fromMin(t), e: fromMin(t + len) }); });
    return out;
  }
  const canWin = (mi, mid, w, set = pollSet(mi, mid)) => { for (let t = toMin(w.s); t < toMin(w.e); t += 30) if (!set.has(`${w.d} ${fromMin(t)}`)) return false; return true; };
  // 다른 예배의 확정 연습과 겹치는지 (그 예배에 배치된 경우만)
  function busyClash(mid, col, w) {
    return (V.board?.allCols || []).some((c) => c.key !== col.key && c.type === "min" && asgOf(c).some((a) => a.member_id === mid)
      && practiceOf(c) && overlap(winOf(practiceOf(c)), w));
  }
  const canPractice = (m, col, w) => !!w && hasPoll(col.mi, m.id) && canWin(col.mi, m.id, w) && !busyClash(m.id, col, w);

  async function renderLineupAdmin() {
    if (!V.lineupMonth) V.lineupMonth = defaultMonth();
    if (!V.basis) V.basis = S.settings?.rec_basis || "month";
    const month = V.lineupMonth;
    const sundays = sundaysOf(month);
    const histFrom = addDays(month, -7 * 13);
    const mins = await loadMonthMinistries(month);
    const multis = mins.filter((mi) => mi.multi);
    if (V.view !== "month" && !multis.some((mi) => mi.id === V.view)) V.view = "month";
    const minSids = mins.flatMap((mi) => mi.svs.map((s) => s.id));
    const pollIds = mins.filter((mi) => mi.practice_mode === "poll").map((mi) => mi.id);
    const [{ avail }, sv, hist, tm, mav, poll, pv] = await Promise.all([
      loadMonth(month),
      sb.from("services").select("*, assignments(*)").is("ministry_id", null).gte("service_date", sundays[0]).lte("service_date", sundays[sundays.length - 1]),
      sb.from("services").select("service_date, ministry_id, assignments(member_id)").gte("service_date", histFrom).lt("service_date", month),
      sb.from("team_meetings").select("meeting_date, practice_start, practice_end, practice_cancelled").in("meeting_date", sundays.map((d) => addDays(d, -1))),
      minSids.length ? sb.from("ministry_availability").select("service_id, member_id, available").in("service_id", minSids) : { data: [] },
      pollIds.length ? sb.from("ministry_poll").select("ministry_id, member_id, slots").in("ministry_id", pollIds) : { data: [] },
      sb.rpc("practice_vote_board", { p_dates: sundays.map((d) => addDays(d, -1)) }),
    ]);
    const services = sv.data || [];
    // 023: 토요 연습 취소한 주는 '토 연습 불가 → 섬김 불가'를 쓰지 않음 · 바뀐 시간에 '불가'라고 한 사람은 경고만
    const satCancelled = (sun) => !!(tm.data || []).find((x) => x.meeting_date === addDays(sun, -1))?.practice_cancelled;
    const satVoteNo = (sun, mid) => { const v = (pv.data || []).find((x) => x.date === addDays(sun, -1)); return !!v && ["voting", "confirmed"].includes(v.state) && v.no.includes(mid); };
    const sunCols = sundays.map((d) => {
      const col = { key: d, type: "sun", date: d, title: `${md(d)} 주일` };
      Object.defineProperty(col, "svc", { get: () => services.find((s) => s.service_date === d) });
      col.ensure = async () => {
        if (col.svc) return col.svc;
        const { data, error } = await sb.from("services").insert({ service_date: d }).select("*, assignments(*)").single();
        if (error) throw new Error("주일을 만들지 못했습니다");
        services.push(data); return data;
      };
      return col;
    });
    const minCol = (mi, s) => ({ key: s.id, type: "min", date: s.service_date, mi, svc: s, ensure: async () => s,
      title: mi.multi ? s.label || mi.name : mi.name, sub: `${mdw(s.service_date)}${s.start_time ? " " + hm(s.start_time) : ""}` });
    const monthCols = [...sunCols, ...mins.filter((mi) => !mi.multi).map((mi) => minCol(mi, mi.svs[0]))]
      .sort((a, b) => a.date.localeCompare(b.date) || (a.type === "sun" ? 0 : 1) - (b.type === "sun" ? 0 : 1));
    const multiCols = multis.flatMap((mi) => mi.svs.map((s) => minCol(mi, s)));
    const curMi = multis.find((mi) => mi.id === V.view);
    const cols = curMi ? multiCols.filter((c) => c.mi.id === curMi.id) : monthCols;
    const mAns = (sid, mid) => (mav.data || []).find((a) => a.service_id === sid && a.member_id === mid)?.available;
    if (V.boardKey !== `${month}|${V.view}`) { V.boardKey = `${month}|${V.view}`; V.sel = 0; V.picked = null; V.rec = null; V.recMsg = null; }
    V.board = {
      month, view: V.view, curMi, mins, multis, cols, allCols: [...monthCols, ...multiCols], services, hist: hist.data || [], meetings: tm.data || [],
      polls: poll.data || [],
      ans: (m, col, k) => col.type === "min"
        ? (k === "sun" ? (isTarget(col.mi, m) ? mAns(col.svc.id, m.id) : false) : undefined)
        : k === "sat" && satCancelled(col.date) ? true
        : answerOf(avail, m.id, k === "sat" ? addDays(col.date, -1) : col.date, k === "sat" ? "sat_practice" : "sunday"),
      satNo: (m, col) => col.type === "sun" && satVoteNo(col.date, m.id),
      satOff: (col) => col.type === "sun" && satCancelled(col.date),
      notTarget: (m, col) => col.type === "min" && !isTarget(col.mi, m),
      reload: renderLineupAdmin,
    };
    if (V.sel >= cols.length) V.sel = 0;
    drawBoard();
  }

  // ---- 공용 계산
  const asgOf = (col) => col.svc?.assignments || [];
  const atOf = (col, pos, slot) => asgOf(col).find((x) => x.position_code === pos && x.slot === slot);
  const memOf = (id) => S.members.find((m) => m.id === id);
  const guestOf = (id) => S.guests.find((g) => g.id === id);
  const posOfM = (m) => [m.main_position, ...extrasOf(m.id)];
  const lvOfAsg = (a) => (a.member_id ? skillOf(a.member_id, a.position_code) : 2);
  // 이 달 섬김 횟수 (주일 + 사역, 이 화면 밖의 탭 포함)
  const monthCount = (mid) => (V.board?.allCols || []).filter((c) => asgOf(c).some((a) => a.member_id === mid)).length;
  // 성비: 인도자 + 싱어 (정식 팀원 중 성별이 있는 사람)
  function sexOf(list) {
    let m = 0, f = 0, unknown = 0;
    list.filter((a) => a.member_id && (a.position_code === "leader" || partOfPos(a.position_code) === "vocal")).forEach((a) => {
      const g = memOf(a.member_id)?.gender; if (g === "m") m++; else if (g === "f") f++; else unknown++;
    });
    return { m, f, unknown };
  }
  function partAvg(list, part) {
    const xs = list.filter((a) => (a.member_id || a.guest_id) && (part === "vocal" ? a.position_code === "singer" : partOfPos(a.position_code) === "band"));
    return xs.length ? xs.reduce((s, a) => s + lvOfAsg(a), 0) / xs.length : null;
  }
  // 점검: part = "vocal" | "band" | "all"
  function colCheck(col, part) {
    const list = asgOf(col), out = [];
    const W = (t) => ({ t, c: "warn" }), O = (t) => ({ t, c: "ok" }), N = (t) => ({ t, c: "" });
    const has = list.some((a) => a.member_id || a.guest_id);
    if (part !== "band") {
      const lead = list.some((a) => a.position_code === "leader"), singers = list.filter((a) => a.position_code === "singer");
      if (!lead && !singers.length) out.push(N(part === "all" ? "인도·싱어 비어 있음" : "비어 있음"));
      else {
        if (!lead) out.push(W("인도자 공석"));
        out.push(singers.length ? N(`싱어 ${singers.length}명`) : W("싱어 없음"));
        if (singers.length && !singers.some((a) => a.is_singer_leader)) out.push(W("싱어 리더 미지정"));
        const sx = sexOf(list);
        if (sx.m + sx.f >= 2) out.push(sx.m === 0 ? W(`남 없음 · 여 ${sx.f}`) : sx.f === 0 ? W(`여 없음 · 남 ${sx.m}`) : N(`남 ${sx.m} · 여 ${sx.f}`));
        if (sx.unknown) out.push(N(`성별 미입력 ${sx.unknown}`));
        const av = partAvg(list, "vocal"); if (av !== null) out.push(N(`싱어 숙련도 ${av.toFixed(1)}`));
      }
    }
    if (part !== "vocal") {
      const band = partPositions("band");
      // 공석은 기본 자리만 셈 (기본을 넘는 자리는 비어 있어도 괜찮음)
      const empty = band.reduce((n, p) => n + Array.from({ length: baseOf(p) }, (_, k) => !atOf(col, p.code, k + 1)).filter(Boolean).length, 0);
      const total = band.reduce((n, p) => n + baseOf(p), 0);
      const bl = list.filter((a) => partOfPos(a.position_code) === "band");
      if (!bl.length) out.push(N(part === "all" ? "밴드 비어 있음" : "비어 있음"));
      else {
        out.push(empty ? W(`밴드 공석 ${empty}`) : O("밴드 모두 채움"));
        if (!bl.some((a) => a.is_band_master)) out.push(W("밴드 마스터 미지정"));
        const av = partAvg(list, "band"); if (av !== null) out.push(N(`밴드 숙련도 ${av.toFixed(1)}`));
      }
      void total;
    }
    if (part === "all" && isPollCol(col) && has) out.push(practiceOf(col) ? O("연습 확정") : W("연습 미정"));
    return out;
  }
  const issuesOf = (col, part) => colCheck(col, part).filter((x) => x.c === "warn").length;
  // 주일 연속 섬김 (사역은 같은 주말 주일과 같은 주로 셈)
  function streakAt(mid, date) {
    const B = V.board;
    const weeks = new Set([...B.allCols.filter((c) => asgOf(c).some((a) => a.member_id === mid)).map((c) => weekKey(c.date)),
      ...B.hist.filter((h) => (h.assignments || []).some((a) => a.member_id === mid)).map((h) => weekKey(h.service_date))]);
    let n = 0, d = weekKey(date);
    while (weeks.has(d)) { n++; d = addDays(d, -7); }
    return n;
  }
  function reasonFor(col, a) {
    if (!a.member_id) return "";
    const st = streakAt(a.member_id, col.date);
    if (st >= 2) return `<span class="lu-why warn">${st}주 연속</span>`;
    const n = V.board.allCols.filter((c) => c.date <= col.date && asgOf(c).some((x) => x.member_id === a.member_id)).length;
    return `<span class="lu-why">이번 달 ${n}회째</span>`;
  }

  // 배치 표(이미지) 한 줄 = 예배 하나. 배치가 있는 예배만
  function tableRows(cols, multiTab) {
    const nm = (a) => { const m = memOf(a.member_id), g = guestOf(a.guest_id);
      return m ? m.name : g ? `${g.name}(G)` : a.former_name ? `${a.former_name}${a.is_guest ? "(G)" : ""}` : "—"; };
    return cols.filter((c) => asgOf(c).length).map((c) => {
      const list = asgOf(c);
      const cell = (code) => list.filter((a) => a.position_code === code).sort((x, y) => x.slot - y.slot).map((a) => ({ n: nm(a), b: !!(a.is_singer_leader || a.is_band_master) }));
      return { date: LTABLE.korDate(c.date), sub: c.type === "min" ? (multiTab ? (c.svc.label || c.mi.name) : c.mi.name) : "", green: c.type === "min" && !multiTab,
        cells: Object.fromEntries(LTABLE.COLS.map(([k]) => [k, cell(k)])) };
    });
  }

  function drawBoard() {
    const B = V.board;
    const POS = window.__allPositions || [];
    const cols = B.cols, part = V.part;
    const canPlace = (who, pos) => {
      if (who?.startsWith?.("g:")) return !!guestOf(who.slice(2))?.positions.includes(pos);
      const m = memOf(who); return !!m && (isObs(m) || posOfM(m).includes(pos));   // 021: 예배MC · 교역자는 어느 자리든
    };
    const active = V.drag?.who || V.picked;
    // 공개: 이 달 전체(주일 · 사역 · 수련회)
    const withAsg = B.allCols.filter((c) => asgOf(c).length);
    const pubN = withAsg.filter((c) => c.svc.status === "published").length;
    const published = withAsg.length > 0 && pubN === withAsg.length;
    const viewN = cols.filter((c) => asgOf(c).length);
    const selCol = cols[V.sel] || cols[0];

    const head = `<div class="page-head">${monthNav("배치표", B.month)}
        <div class="row">
          <span class="small muted" style="font-weight:600">${published ? "이 달 전체 공개됨" : pubN ? `일부 공개 (${pubN}/${withAsg.length}${B.mins.length ? " · 사역 포함" : ""})` : "멤버에게 안 보여요"}</span>
          <div class="seg" id="luPub" role="group" aria-label="이 달 배치표 공개 여부">
            <button type="button" data-v="on" aria-pressed="${published}">전체 공개</button><button type="button" data-v="off" aria-pressed="${!pubN}">비공개</button></div>
          <button type="button" class="btn btn-ghost" id="luClear">${B.curMi ? esc(B.curMi.name) + " " : ""}비우기</button>
          ${pubN ? `<button type="button" class="btn btn-primary" id="luPublish">공개 문구 복사</button>` : ""}</div></div>
      ${viewPills(B.multis, B.view, B.month)}
      <div class="tabs" role="tablist" id="partTabs">${[["vocal", "인도·싱어"], ["band", "밴드"], ["status", "배치 현황"]].map(([k, l]) => {
        const n = k === "status" ? 0 : cols.reduce((s, c) => s + issuesOf(c, k), 0);
        return `<button type="button" role="tab" data-part="${k}" aria-selected="${part === k}">${l}${n ? ` <span class="tab-badge">점검 ${n}</span>` : ""}</button>`;
      }).join("")}</div>`;

    if (part === "status") {
      const tRows = tableRows(cols, !!B.curMi);
      const tTitle = B.curMi ? `${B.curMi.name} 배치표` : `${monthLabel(B.month)} 배치표`;
      $("#content").innerHTML = `${head}
        <section class="lt-card" aria-label="배치 표">
          <div class="lt-head"><h2>${B.curMi ? esc(B.curMi.name) + " 배치" : monthLabel(B.month) + " 전체 배치"}</h2>
            <span class="small muted">굵은 이름 = 싱어 리더·밴드 마스터 · X = 공석 · (G) = 객원${B.curMi ? "" : " · 초록 = 사역"}</span>
            <span style="flex:1"></span>
            ${tRows.length ? `<button type="button" class="btn btn-ink" id="luImg">${ICON.download}이미지로 저장</button>` : ""}</div>
          ${tRows.length ? LTABLE.html(tRows) : `<div class="empty">아직 배치한 예배가 없어요.</div>`}
          ${!B.curMi && B.multis.length ? `<p class="small muted" style="margin:0">${esc(B.multis.map((x) => x.name).join(", "))}은(는) 위 탭에서 따로 표로 저장해요.</p>` : ""}
        </section>
        <div class="row" style="justify-content:space-between"><p class="lead" style="margin:0">예배별로 점검 · 카톡 라인업 복사 · 공개를 해요.</p>
          ${viewN.length ? `<button type="button" class="btn btn-soft" id="luCopyAll">라인업 전체 복사</button>` : ""}</div>
        <div class="stcards">${cols.map((c, ci) => {
          const list = asgOf(c), pub = c.svc?.status === "published";
          const nm1 = (a) => { const n = memOf(a.member_id)?.name || guestOf(a.guest_id)?.name || a.former_name || "—";
            return esc(n) + (a.guest_id || a.is_guest ? "(G)" : "") + (a.is_singer_leader || a.is_band_master ? "*" : ""); };
          // 같은 포지션 여러 명: 인도 A, B / 밴드 일렉 A·B · 비면 X
          const nm = (pos, sep = ", ") => { const xs = list.filter((a) => a.position_code === pos).sort((a, b) => a.slot - b.slot); return xs.length ? xs.map(nm1).join(sep) : `<span class="x">X</span>`; };
          const singers = list.filter((a) => a.position_code === "singer").sort((a, b) => a.slot - b.slot).map(nm1);
          const pr = practiceOf(c);
          return `<article class="stcard ${c.type === "min" ? "min" : ""}">
            <div class="row" style="justify-content:space-between;align-items:flex-start"><div><b style="font-size:16px">${esc(c.title)}</b>${c.type === "min" ? ` <span class="chip chip-violet">사역</span>` : ""}
              <div class="small muted">${c.type === "min" ? c.sub : `${hm(sunTime(c.svc, S.settings)[0])} · 토요 연습 ${md(addDays(c.date, -1))}`}</div></div>
              <button type="button" class="lu-pub" data-pub="${ci}" aria-pressed="${pub}" ${list.length || pub ? "" : "disabled"}>${pub ? "공개" : "비공개"}</button></div>
            <dl class="stl"><dt>인도</dt><dd>${nm("leader")}</dd><dt>싱어</dt><dd>${singers.join(" · ") || `<span class="x">X</span>`}</dd>
              <dt>밴드</dt><dd>${partPositions("band").filter((p) => baseOf(p) > 0 || list.some((a) => a.position_code === p.code)).map((p) => `${POS_SHORT[p.code] || p.name} ${nm(p.code)}`).join(" · ")}</dd>
              ${isPollCol(c) || (c.type === "min" && pr) ? `<dt>연습</dt><dd>${pr ? winText(winOf(pr)) : V.sugg[c.key] ? `미정 <span class="small muted">(추천 ${winText(V.sugg[c.key])})</span>` : "미정"}</dd>` : ""}</dl>
            <div class="row" style="gap:6px">${colCheck(c, "all").map((x) => `<span class="pill ${x.c}">${esc(x.t)}</span>`).join("")}</div>
            ${list.length ? `<button type="button" class="btn btn-ghost btn-sm" data-copy="${ci}" style="align-self:flex-start">라인업 복사</button>` : ""}
          </article>`;
        }).join("")}</div>`;
      bindBoardEvents({ canPlace, published });
      $("#luImg")?.addEventListener("click", async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try {
          const blob = await LTABLE.png(tRows, tTitle);
          const r = await LTABLE.save(blob, `${tTitle}.png`);
          if (r !== "cancel") toast(r === "shared" ? "이미지를 공유했어요" : `${tTitle}.png를 저장했어요`);
        } catch { toast("이미지를 만들지 못했어요"); }
        b.disabled = false;
      });
      return;
    }

    // ---- 파트 탭
    const PP = partPositions(part);
    const counts = {};
    S.members.forEach((m) => { const n = monthCount(m.id); if (n) counts[m.id] = n; });
    const headCols = cols.map((col, i) => {
      const n = servingMembers().filter((m) => B.ans(m, col, "sun") === true).length;
      const has = asgOf(col).length > 0, pub = col.svc?.status === "published";
      const time = col.type === "sun" ? sunTime(col.svc, S.settings)[0] : col.svc?.start_time;
      const pr = practiceOf(col), sg = V.sugg[col.key];
      const prac = isPollCol(col) ? (pr ? `<span class="pchip ok">연습 ${md(pr.practice_date)} ${hm(pr.start_time)} 확정</span>`
        : sg ? `<span class="pchip sug">추천 연습 ${md(sg.d)} ${sg.s}</span>` : `<span class="pchip warn">연습 미정</span>`)
        : col.type === "min" && pr ? `<span class="pchip ok">연습 ${md(pr.practice_date)} ${hm(pr.start_time)}</span>`
        : B.satOff(col) ? `<span class="pchip">토 연습 없음 · 당일 리허설</span>` : "";
      return `<div class="lu-date ${V.sel === i ? "on" : ""} ${col.type === "min" ? "min" : ""}"><button type="button" class="lu-sel" data-sel="${i}">
          <b>${esc(col.title)}${col.type === "min" && !B.curMi ? ` <i class="mtag">사역</i>` : ""}</b><span>${col.type === "min" ? col.sub : (time ? hm(time) : "")} · 가능 ${n}명</span>${prac}</button>
        <button type="button" class="lu-pub" data-pub="${i}" aria-pressed="${pub}" ${has || pub ? "" : "disabled"} title="${pub ? "누르면 비공개" : has ? "누르면 공개" : "배치한 뒤 공개할 수 있어요"}">${pub ? "공개" : "비공개"}</button></div>`;
    }).join("");

    const chipHTML = (a, p, col) => {
      const m = a.member_id && memOf(a.member_id), g = a.guest_id && guestOf(a.guest_id);
      const name = m ? m.name : g ? g.name : a.former_name ? `${a.former_name} (${a.is_guest ? "객원" : "탈퇴"})` : "탈퇴한 멤버";
      const role = p.kind === "vocal" ? ["leader", "리더", a.is_singer_leader] : p.kind === "band" ? ["bm", "밴마", a.is_band_master] : null;
      const live = !!(m || g);
      return `<div class="lu-chip ${role && role[2] ? "role-on" : ""} ${a.recommended ? "rec" : ""} ${g ? "guest" : ""}" ${live ? `draggable="true"` : `style="cursor:default;opacity:.75"`} data-aid="${a.id}" ${m ? `data-who="${m.id}"` : g ? `data-who="g:${g.id}"` : ""} tabindex="0">
        <span class="nm">${esc(name)}</span>
        ${role && role[2] ? `<span class="rtag">${role[1]}</span>` : ""}
        <span class="lu-acts">${role && live ? `<button type="button" class="lu-role" data-role="${role[0]}" aria-pressed="${role[2]}">${role[2] ? role[1] + " 해제" : role[1] + " 지정"}</button>` : ""}
          <button type="button" class="lu-x" data-remove aria-label="${esc(name)} 빼기">${XSVG}</button></span></div>`;
    };

    // 019: 기본 자리는 늘, 기본을 넘는 자리(인도 2 · 싱어 5·6 · 일렉 2 …)는 열었거나 이미 채운 경우만
    const usedExtra = (p, slot) => cols.some((c) => atOf(c, p.code, slot));
    const extraSlots = PP.flatMap((p) => Array.from({ length: p.max_count - baseOf(p) }, (_, k) => ({ p, slot: baseOf(p) + k + 1 })));
    const extraOpen = !!(V.extraOpen || {})[part];
    //  추가 자리 하나를 채우면 그다음 추가 자리도 보여 줌 (싱어 5를 넣으면 싱어 6 칸이 열림)
    const showSlot = (p, slot) => slot <= baseOf(p) || extraOpen || usedExtra(p, slot) || (slot - 1 > baseOf(p) && usedExtra(p, slot - 1));
    const extraLabel = (() => {
      const by = {}; extraSlots.forEach(({ p, slot }) => (by[p.code] ||= []).push(slot));
      return Object.entries(by).map(([c, ss]) => `${POS_SHORT[c] || positionName(c)} ${ss.join("·")}`).join(" · ");
    })();
    const extraHidden = extraSlots.filter(({ p, slot }) => !showSlot(p, slot)).length;
    const rows = PP.flatMap((p) => Array.from({ length: p.max_count }, (_, k) => k + 1).filter((slot) => showSlot(p, slot)).map((slot) => {
      const extra = slot > baseOf(p);
      const cells = cols.map((col, ci) => {
        const a = atOf(col, p.code, slot);
        const valid = active && canPlace(active, p.code);
        const base = `class="lu-cell ${a ? "" : "empty"} ${valid ? "valid" : ""} ${col.type === "min" ? "min" : ""} ${extra ? "extra" : ""}" data-ci="${ci}" data-pos="${p.code}" data-slot="${slot}"`;
        if (!a) return `<div ${base}><span>${valid ? "여기에 놓기" : extra ? "추가 자리" : "공석"}</span></div>`;
        const m = a.member_id && memOf(a.member_id), g = a.guest_id && guestOf(a.guest_id);
        let warn = "";
        if (m) {
          const dup = asgOf(col).filter((x) => x.member_id === m.id).length > 1;
          const pr = practiceOf(col), sg = V.sugg[col.key];
          warn = dup ? "같은 날 중복 배치" : B.notTarget(m, col) ? "응답 대상 아님" : B.ans(m, col, "sun") === false ? "불가로 응답함"
            : col.type === "sun" && B.ans(m, col, "sat") === false ? "토 연습 불가"
            : B.satNo(m, col) ? "바뀐 연습 시간 불가"
            : isPollCol(col) && pr && !canPractice(m, col, winOf(pr)) ? "연습 불가"
            : isPollCol(col) && !pr && sg && !canPractice(m, col, sg) ? "추천 연습 불가"
            : isPollCol(col) && !hasPoll(col.mi, m.id) ? "연습 시간 안 냄" : "";
        }
        const lvTxt = m ? `<b class="lvt l${skillOf(m.id, p.code)}">${LEVEL[skillOf(m.id, p.code)]}</b>` : g ? `<b class="lvt g">객원</b>` : "";
        const gTxt = part === "vocal" && m?.gender ? `<span class="gtag ${m.gender}">${GENDER[m.gender]}</span>` : "";
        const why = warn ? `<span class="lu-why warn">${warn}</span>` : a.recommended ? reasonFor(col, a)
          : m && streakAt(m.id, col.date) >= 3 ? `<span class="lu-why warn">${streakAt(m.id, col.date)}주 연속</span>` : "";
        return `<div ${base}>${chipHTML(a, p, col)}<div class="lu-meta">${lvTxt}${gTxt}${why}</div></div>`;
      }).join("");
      const sub = extra ? "추가 자리" : slot === 1 && p.max_count > 1 ? (p.max_count > baseOf(p) ? `기본 ${baseOf(p)} · 최대 ${p.max_count}` : `최대 ${p.max_count}명`) : "";
      return `<div class="lu-row ${slot === 1 ? "first" : ""} ${extra ? "extra" : ""}" data-row="${p.code}:${slot}"><div class="lu-label"><b>${esc(p.name)}${p.max_count > 1 ? " " + slot : ""}</b>${sub ? `<span>${sub}</span>` : ""}</div>${cells}</div>`;
    })).join("");
    const extraBar = extraSlots.length ? `<div class="lu-extra"><span class="small muted">기본 인원은 자동 추천이 채우고, <b>추가 자리</b>(${esc(extraLabel)})는 그 주에 필요할 때 직접 넣어요. 비어 있어도 공석으로 치지 않아요.</span>
        ${extraOpen ? `<button type="button" class="btn btn-ghost btn-sm" id="luExtra" data-open="0">추가 자리 접기</button>`
          : extraHidden ? `<button type="button" class="btn btn-soft btn-sm" id="luExtra" data-open="1">+ 추가 자리 열기</button>` : ""}</div>` : "";

    const foot = cols.map((col) => `<div class="lu-check">${colCheck(col, part).map((x) => `<span class="${x.c}">${esc(x.t)}</span>`).join("")}</div>`).join("");

    // ---- 후보: 이 파트 포지션이 있는 사람
    const order = posOrder();
    const inPart = (m) => posOfM(m).some((c) => partOfPos(c) === part);
    const cands = servingMembers().filter((m) => inPart(m) && !B.notTarget(m, selCol));
    const pool = cands.filter((m) => B.ans(m, selCol, "sun") !== false)
      .sort((a, b) => (B.ans(b, selCol, "sun") === true) - (B.ans(a, selCol, "sun") === true) || (order[a.main_position] ?? 99) - (order[b.main_position] ?? 99) || (counts[a.id] || 0) - (counts[b.id] || 0));
    const unavailable = cands.filter((m) => B.ans(m, selCol, "sun") === false);
    const selPr = practiceOf(selCol), selSg = V.sugg[selCol.key];
    const commonWith = (m) => {
      const team = asgOf(selCol).map((a) => a.member_id && memOf(a.member_id)).filter(Boolean).filter((x) => x.id !== m.id);
      return allWins(selCol.mi).filter((w) => [...team, m].every((x) => canPractice(x, selCol, w))).length;
    };
    const candHTML = (m) => {
      const placedHere = asgOf(selCol).find((x) => x.member_id === m.id);
      const placedPart = placedHere ? partOfPos(placedHere.position_code) : null;
      const sun = B.ans(m, selCol, "sun"), sat = selCol.type === "sun" ? B.ans(m, selCol, "sat") : undefined;
      const tags = [];
      if (sun === undefined) tags.push(`<span class="chip chip-warn">미응답</span>`);
      if (sun === false) tags.push(`<span class="chip chip-gray">불가</span>`);
      if (sat === false) tags.push(`<span class="chip chip-warn">토 연습 불가</span>`);
      if (B.satNo(m, selCol)) tags.push(`<span class="chip chip-warn">바뀐 시간 불가</span>`);
      if (placedPart === part) tags.push(`<span class="chip chip-violet">배치됨</span>`);
      else if (placedPart) tags.push(`<span class="chip chip-gray">${placedPart === "band" ? "밴드" : "싱어"} 배치</span>`);
      if (isPollCol(selCol) && !placedPart && sun !== false) {
        if (!hasPoll(selCol.mi, m.id)) tags.push(`<span class="chip chip-warn">시간 안 냄</span>`);
        else if (selPr) tags.push(canPractice(m, selCol, winOf(selPr)) ? `<span class="chip chip-ok">연습 ✓</span>` : `<span class="chip chip-warn">연습 불가</span>`);
        else { const n = commonWith(m); tags.push(n ? `<span class="chip chip-ok">연습 맞음 ${n}</span>` : `<span class="chip chip-warn">넣으면 연습 시간 없음</span>`); }
      }
      const pos = posOfM(m).filter((c) => partOfPos(c) === part).map((c) => `${POS_SHORT[c] || positionName(c)}${skillSet(m.id, c) ? " " + LEVEL[skillSet(m.id, c)] : ""}`).join(" · ");
      return `<div class="lu-cand ${V.picked === m.id ? "picked" : ""} ${placedPart ? "placed" : ""} ${sun === false ? "unavail" : ""}" draggable="true" data-who="${m.id}" tabindex="0" role="button" aria-pressed="${V.picked === m.id}">
        <span style="display:flex;flex-direction:column;flex:1;min-width:0"><b>${esc(m.name)}${part === "vocal" && m.gender ? ` <span class="gtag ${m.gender}">${GENDER[m.gender]}</span>` : ""}</b><span class="small muted">${pos}</span></span>
        ${tags.join("")}<b class="small" style="width:30px;text-align:right">${counts[m.id] || 0}회</b></div>`;
    };
    const guests = S.guests.filter((g) => g.is_active && g.positions.some((c) => partOfPos(c) === part));
    // 021: 예배MC · 교역자 — 응답 · 자동 추천 없이 필요할 때 직접 넣음
    const observers = S.members.filter((m) => m.is_active && isObs(m)).sort((a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name, "ko"));
    const obsHTML = (m) => {
      const placedHere = asgOf(selCol).find((x) => x.member_id === m.id);
      return `<div class="lu-cand guest ${V.picked === m.id ? "picked" : ""} ${placedHere ? "placed" : ""}" draggable="true" data-who="${m.id}" tabindex="0" role="button" aria-pressed="${V.picked === m.id}">
        <span style="display:flex;flex-direction:column;flex:1;min-width:0"><b>${esc(m.name)}</b><span class="small muted">어느 자리든</span></span>
        ${placedHere ? `<span class="chip chip-violet">배치됨</span>` : obsChip(m)}<b class="small" style="width:30px;text-align:right">${counts[m.id] || 0}회</b></div>`;
    };
    const guestHTML = (g) => {
      const placed = asgOf(selCol).some((x) => x.guest_id === g.id);
      const key = "g:" + g.id;
      return `<div class="lu-cand guest ${V.picked === key ? "picked" : ""} ${placed ? "placed" : ""}" draggable="true" data-who="${key}" tabindex="0" role="button" aria-pressed="${V.picked === key}">
        <span style="display:flex;flex-direction:column;flex:1;min-width:0"><b>${esc(g.name)}</b><span class="small muted">${g.positions.map((c) => POS_SHORT[c] || positionName(c)).join(" · ")}${g.note ? " · " + esc(g.note) : ""}</span></span>
        ${placed ? `<span class="chip chip-violet">배치됨</span>` : `<span class="chip chip-gray">객원</span>`}</div>`;
    };
    const recN = cols.reduce((n, c) => n + asgOf(c).filter((a) => a.recommended && partOfPos(a.position_code) === part).length, 0);
    const recBar = `<div class="recbar">
        <div class="row"><button type="button" class="btn btn-primary" id="recRun">✦ ${PART_NAME[part]} 자동 추천</button>
          <button type="button" class="btn btn-soft" id="recAgain" ${recN ? "" : "disabled"}>다시 추천</button>
          <span class="small" style="font-weight:700">골고루 기준</span>
          <div class="seg" id="recBasis"><button type="button" data-v="month" aria-pressed="${V.basis === "month"}">이번 달</button><button type="button" data-v="quarter" aria-pressed="${V.basis === "quarter"}">최근 3개월</button></div></div>
        <div class="row small muted"><span><span class="lu-legend fix">이름</span> 직접 넣음</span><span><span class="lu-legend rec">이름</span> 추천</span>
          <button type="button" class="btn btn-ghost btn-sm" id="recClear" ${recN ? "" : "disabled"}>추천 지우기${recN ? ` (${recN})` : ""}</button></div>
      </div>${V.recMsg && V.recMsg.part === part ? `<div class="notice ${V.recMsg.warn ? "warn" : "ok"}" style="margin:0">${V.recMsg.text}</div>` : ""}`;

    $("#content").innerHTML = `${head}
      ${recBar}
      ${practicePanel(selCol)}
      ${extraBar}
      <div style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start">
        <section class="lu-board" aria-label="배치"><div class="lu-inner" style="--cols:${cols.length}">
          <div class="lu-row lu-head"><div class="lu-label muted small">포지션</div>${headCols}</div>
          ${rows}
          <div class="lu-row lu-foot"><div class="lu-label muted small">점검</div>${foot}</div>
        </div></section>
        <aside class="lu-pool ${V.drag?.from ? "drop" : ""}" id="luPool" aria-label="후보">
          <div><h2 style="font-size:17px;font-weight:800">${esc(selCol.title)} 후보</h2><span class="muted small">${PART_NAME[part]} 포지션 · 가능 응답 우선 · 이번 달 섬김 횟수(주일+사역)</span></div>
          <div style="display:flex;flex-direction:column;gap:6px">${pool.map(candHTML).join("") || `<span class="muted small">가능한 팀원이 없어요</span>`}</div>
          ${unavailable.length ? `<div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--line);padding-top:12px">
            <span class="small muted"><b style="color:var(--ink-2)">불가로 응답</b> · 일정이 바뀌었으면 끌어다 놓을 수 있어요</span>
            ${unavailable.map(candHTML).join("")}</div>` : ""}
          <div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--line);padding-top:12px">
            <span class="small muted" style="display:flex;justify-content:space-between;align-items:center"><b style="color:var(--ink-2)">객원</b>
              <button type="button" class="btn btn-ghost btn-sm" id="guestAdd">+ 객원 추가</button></span>
            ${guests.map(guestHTML).join("") || `<span class="small muted">이 파트 객원이 없어요</span>`}</div>
          ${observers.length ? `<div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--line);padding-top:12px">
            <span class="small muted"><b style="color:var(--ink-2)">예배MC · 교역자</b> · 응답 없이 필요할 때 직접 넣어요</span>
            ${observers.map(obsHTML).join("")}</div>` : ""}
        </aside>
      </div>
      <p class="small muted" style="margin:0">이름표에 마우스를 올리면(폰은 한 번 누르면) ${part === "vocal" ? "싱어 리더" : "밴드 마스터"} 지정과 빼기 버튼이 나와요.</p>
      <details class="howrec"><summary>추천은 이렇게 해요</summary>
        <ol>
          <li><b>반드시 지켜요</b> — 주일은 토요 연습·주일 모두 '가능', 사역은 그 예배 '가능'인 사람만. 본인 포지션(주·추가)만, 하루에 한 자리만. 직접 넣은 칸과 다른 파트 탭에 들어간 사람은 그대로 두고 이 파트의 빈 칸만 채워요.</li>
          <li><b>사역 연습</b> — 가능 시간을 취합하는 사역은 연습 시간이 서로 맞는 사람끼리 짜요. 연습이 확정됐으면 그 시간에 되는 사람만, 아직이면 연습 시간도 함께 골라 '추천 연습'으로 보여 줘요.</li>
          <li><b>점수로 골라요</b> (설정에서 순서 변경) — ${(S.settings?.rec_order || []).map((k, i) => `${"①②③④"[i]} ${{ skill: `실력 균형: 주마다 ${part === "vocal" ? "싱어" : "밴드"} 숙련도 평균을 비슷하게`, balance: `골고루: ${V.basis === "quarter" ? "최근 3개월" : "이번 달"} 섬김 횟수(주일+사역)가 적은 사람 먼저`, consecutive: "연속 감점: 2주 연속은 작게, 3주 이상은 크게 (같은 주말 주일+사역은 한 번)", gender: "성비: 인도자+싱어에 남녀 최소 1명씩, 되도록 반반" }[k]}`).join(" ")}. 주 포지션이 추가 포지션보다 앞서요.${part === "vocal" ? " 남녀 최소 1명씩은 순서와 상관없이 강하게 지켜요." : ""}</li>
          <li>싱어 리더·밴드 마스터와 객원은 추천하지 않아요. 직접 지정하세요.</li>
        </ol></details>`;
    bindBoardEvents({ canPlace, published });
  }

  // ---- 연습 시간 맞추기 패널 (가능 시간을 취합하는 사역 예배를 골랐을 때)
  function practicePanel(col) {
    if (!col || col.type !== "min") return "";
    const mi = col.mi, pr = practiceOf(col);
    if (mi.practice_mode !== "poll") {
      const list = (mi.ministry_practices || []).filter((p) => !p.service_id || p.service_id === col.svc.id);
      return list.length ? `<section class="ppanel"><b>${esc(col.title)} 연습</b> <span class="small muted">정해진 연습: ${list.map((p) => winText(winOf(p))).join(", ")}</span></section>` : "";
    }
    const team = asgOf(col).map((a) => a.member_id && memOf(a.member_id)).filter(Boolean);
    const noPaint = team.filter((m) => !hasPoll(mi, m.id));
    const painted = team.filter((m) => hasPoll(mi, m.id));
    const head = `<div class="row" style="align-items:baseline"><h2 style="font-size:16px;font-weight:800">${esc(col.title)} 연습 시간 맞추기</h2>
      <span class="small muted">연습 ${mi.practice_minutes % 60 ? `${Math.floor(mi.practice_minutes / 60)}시간 ${mi.practice_minutes % 60}분` : `${mi.practice_minutes / 60}시간`} · 지금 넣은 ${team.length}명이 고른 시간 (객원 제외)</span>
      ${mi.poll_open ? `<span class="chip chip-warn">취합 중</span>` : `<span class="chip chip-gray">취합 닫힘</span>`}</div>`;
    if (pr) {
      const cant = team.filter((m) => !canPractice(m, col, winOf(pr)));
      return `<section class="ppanel">${head}<div class="pconf"><b>${winText(winOf(pr))} 확정</b>
        <span class="${cant.length ? "warnt" : "okt"}">${cant.length ? "연습 불가: " + cant.map((m) => esc(m.name)).join(", ") : "넣은 사람 모두 가능해요"}</span>
        <button type="button" class="btn btn-ghost btn-sm" id="prUnconfirm" data-pid="${pr.id}">확정 풀기</button></div></section>`;
    }
    const days = pollDays(mi), times = pollTimes(mi);
    if (!days.length) return `<section class="ppanel">${head}<p class="small muted" style="margin:0">후보 날짜가 없어요. <a href="#ministry/${mi.id}">사역 수정</a>에서 정해 주세요.</p></section>`;
    const wins = allWins(mi).filter((w) => painted.every((m) => canPractice(m, col, w)));
    const flex = (w) => servingMembers().filter((m) => col.mi && isTarget(mi, m) && V.board.ans(m, col, "sun") === true && canPractice(m, col, w)).length;
    const sg = V.sugg[col.key];
    const top = wins.map((w) => ({ w, f: flex(w), s: sameWin(w, sg) })).sort((a, b) => b.s - a.s || b.f - a.f || a.w.d.localeCompare(b.w.d) || a.w.s.localeCompare(b.w.s))
      .reduce((acc, x) => (acc.length < 4 && !acc.some((y) => y.w.d === x.w.d && Math.abs(toMin(y.w.s) - toMin(x.w.s)) < 60) ? acc.concat([x]) : acc), []);
    const blockers = !wins.length && painted.length > 1 ? painted.filter((m) => allWins(mi).some((w) => painted.filter((x) => x !== m).every((x) => canPractice(x, col, w)))) : [];
    const max = Math.max(1, painted.length);
    const n = (d, t) => painted.filter((m) => pollSet(mi, m.id).has(`${d} ${t}`)).length;
    const heat = `<div class="pheat2" style="grid-template-columns:84px repeat(${times.length}, minmax(20px,1fr));min-width:${84 + times.length * 22}px">
        <span></span>${times.map((t) => `<span class="h">${t.endsWith(":00") ? +t.slice(0, 2) : ""}</span>`).join("")}
        ${days.map((d) => `<span class="d">${mdw(d)}</span>${times.map((t) => {
          const k = n(d, t), all = painted.length && k === painted.length, inSg = sg && sg.d === d && toMin(t) >= toMin(sg.s) && toMin(t) < toMin(sg.e);
          return `<span class="c ${all ? "all" : k ? "some" : ""} ${inSg ? "sg" : ""}" title="${mdw(d)} ${t} · ${k}/${painted.length}명${k ? ": " + esc(painted.filter((m) => pollSet(mi, m.id).has(`${d} ${t}`)).map((m) => m.name).join(", ")) : ""}">${k || ""}</span>`;
        }).join("")}`).join("")}</div>`;
    void max;
    return `<section class="ppanel">${head}
      <div class="pgrid"><div style="overflow-x:auto;flex:1 1 460px;min-width:0">${heat}</div>
        <div class="pwins"><b class="small">넣은 사람이 모두 되는 시간</b>
          ${top.map((x) => `<div class="pwin ${x.s ? "sug" : ""}"><span style="flex:1;min-width:0"><b>${winText(x.w)}</b><br><span class="small muted">${x.s ? "추천 · " : ""}이 시간 되는 후보 ${x.f}명</span></span>
            <button type="button" class="btn ${x.s ? "btn-primary" : "btn-soft"} btn-sm" data-win="${x.w.d}|${x.w.s}|${x.w.e}">확정</button></div>`).join("")}
          ${wins.length > top.length ? `<span class="small muted">외 ${wins.length - top.length}개 시간도 모두 가능해요</span>` : ""}
          ${!painted.length ? `<div class="note-box small">아직 넣은 사람이 없어요. 후보 옆 '연습 맞음 n'을 보고 넣거나, 자동 추천을 돌리면 연습 시간까지 같이 골라요.</div>`
            : !wins.length ? `<div class="notice warn" style="margin:0">지금 넣은 사람끼리 겹치는 시간이 없어요.${blockers.length ? " 이 중 한 명을 빼면 맞아요: " + blockers.map((m) => esc(m.name)).join(", ") : ""}</div>` : ""}
          ${noPaint.length ? `<span class="small" style="color:var(--warn);font-weight:700">시간 안 낸 사람: ${noPaint.map((m) => esc(m.name)).join(", ")}</span>` : ""}
        </div></div></section>`;
  }

  async function confirmPractice(col, w) {
    const mi = col.mi;
    const text = `[찬양팀] ${mi.name}${mi.multi ? " " + (col.svc.label || "") : ""} 연습 안내\n${fmtDate(w.d, { month: "long", day: "numeric", weekday: "short" })} ${w.s}–${w.e}에 모여요.\n\n${location.origin}/me.html`;
    const n = asgOf(col).filter((a) => a.member_id).length;
    const pr = await pushRow("practice", [], `${esc(col.title)}에 넣은 ${n}명에게 '연습 시간이 정해졌어요' 알림`);
    modal({ title: "연습 시간 확정", body: `<p style="margin:0"><b>${esc(col.title)}</b> 연습을 <b>${winText(w)}</b>로 확정할까요? 멤버 화면에 바로 보여요.</p>${pr}${msgOnly(text)}`,
      confirmLabel: "확정하고 문구 복사",
      onConfirm: async (close) => {
        const push = pushChecked();
        const { data: np, error } = await sb.from("ministry_practices").insert({ ministry_id: mi.id, service_id: col.svc.id, practice_date: w.d, start_time: w.s, end_time: w.e }).select("id").single();
        if (error) throw new Error("연습을 저장하지 못했습니다");
        // 모든 예배의 연습이 정해지면 취합을 닫음
        const done = new Set([...(mi.ministry_practices || []).map((p) => p.service_id), col.svc.id]);
        if (mi.poll_open && mi.svs.every((s) => done.has(s.id))) await sb.from("ministries").update({ poll_open: false }).eq("id", mi.id);
        await copyText($("#mMsg").textContent);
        const t = push ? await sendPush("practice", { practice_id: np.id }) : "";
        delete V.sugg[col.key];
        close(); toast(`연습을 확정했어요. 안내 문구를 복사했어요${t}`, 4000); V.board.reload();
      } });
  }

  async function placeOn(who, col, pos, slot, fromAid) {
    try {
      const s = await col.ensure();
      const target = (s.assignments || []).find((x) => x.position_code === pos && x.slot === slot);
      if (fromAid && target?.id === fromAid) return;
      if (fromAid) { const { error } = await sb.from("assignments").delete().eq("id", fromAid); if (error) throw error; }
      if (target) { const { error } = await sb.from("assignments").delete().eq("id", target.id); if (error) throw error; }
      const row = { service_id: s.id, position_code: pos, slot, recommended: false, ...(who.startsWith("g:") ? { guest_id: who.slice(2) } : { member_id: who }) };
      const { error } = await sb.from("assignments").insert(row);
      if (error) throw new Error(error.message);
    } catch (e) { toast(e.message?.includes("포지션") ? e.message : "배치하지 못했습니다", 3500); }
    V.drag = null; V.picked = null;
    await V.board.reload();
  }

  function bindBoardEvents({ canPlace, published }) {
    const B = V.board;
    const root = $("#content");
    const col = (el) => B.cols[+el.dataset.ci];
    bindMonthNav((n) => { V.lineupMonth = addMonths(V.lineupMonth, n); V.view = "month"; V.picked = null; V.rec = null; V.recMsg = null; V.sugg = {}; renderLineupAdmin(); });
    root.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { V.view = b.dataset.view; renderLineupAdmin(); }));
    root.querySelectorAll("[data-part]").forEach((b) => b.addEventListener("click", () => { V.part = b.dataset.part; V.picked = null; drawBoard(); }));
    root.querySelectorAll("[data-sel]").forEach((b) => b.addEventListener("click", () => { V.sel = +b.dataset.sel; drawBoard(); }));

    // 카톡 라인업 복사
    const titleOf = (c) => c.type === "min" ? (c.mi.multi ? `${c.mi.name} ${c.svc.label || ""}`.trim() : c.mi.name) : "";
    const textOf = (c) => lineupText(c.date, titleOf(c), asgOf(c));
    root.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
      const c = B.cols[+b.dataset.copy];
      toast((await copyText(textOf(c))) ? `${c.title} 라인업을 복사했어요` : "복사하지 못했어요");
    }));
    $("#luCopyAll")?.addEventListener("click", async () => {
      const text = B.cols.filter((c) => asgOf(c).length).map(textOf).join("\n\n");
      toast((await copyText(text)) ? "라인업을 복사했어요" : "복사하지 못했어요");
    });

    // 공개
    const minNames = [...new Set(B.allCols.filter((c) => c.type === "min" && asgOf(c).length).map((c) => c.mi.name))];
    const pubMsg = `[찬양팀] ${monthLabel(B.month)} 배치표가 나왔어요${minNames.length ? ` (${minNames.join("·")} 포함)` : ""}. 확인 부탁드려요!\n\n${location.origin}/me.html#lineup`;
    $("#luPublish")?.addEventListener("click", () => copyText(pubMsg).then((ok) => toast(ok ? "공개 문구를 복사했어요" : "복사하지 못했어요")));
    const unpublish = (targets, label) => modal({
      title: `${label} 비공개로 바꾸기`,
      body: `<p style="margin:0">멤버 화면 배치표와 홈의 '나의 섬김'에서 바로 사라져요. 배치 내용은 그대로 남고, 언제든 다시 공개할 수 있어요.</p>`,
      confirmLabel: "비공개로 바꾸기", danger: true,
      onConfirm: async (close) => {
        const { error } = await sb.from("services").update({ status: "draft", published_at: null }).in("id", targets.map((s) => s.id));
        if (error) throw new Error("바꾸지 못했습니다");
        close(); toast(`${label} 비공개로 바꿨어요`); B.reload();
      },
    });
    const pubLabel = (c) => c.type === "sun" ? `${md(c.date)} 주일` : c.mi.multi ? `${c.mi.name} ${c.svc.label || ""}`.trim() : c.mi.name;
    root.querySelectorAll("[data-pub]").forEach((b) => b.addEventListener("click", async () => {
      const c = B.cols[+b.dataset.pub], s = c.svc; if (!s) return;
      if (s.status === "published") return unpublish([s], c.title);
      const miss = colCheck(c, "all").filter((x) => x.c === "warn").map((x) => x.t);
      const pr = await pushRow("lineup", [`lineup:${s.id}`], "팀원 전체에게 · 배치된 사람은 내 섬김이 함께 가요");
      modal({ title: `${c.title} 공개`, body: `<p style="margin:0">멤버 화면 배치표와 홈에 바로 보여요.</p>${miss.length ? `<div class="notice warn" style="margin:0">${esc(miss.join(", "))}</div>` : ""}${pr}`,
        confirmLabel: "공개하기",
        onConfirm: async (close) => {
          const push = pushChecked();
          const { error } = await sb.from("services").update({ status: "published", published_at: new Date().toISOString() }).eq("id", s.id);
          if (error) throw new Error("공개하지 못했습니다");
          const t = push ? await sendPush("lineup", { service_ids: [s.id], label: pubLabel(c) }) : "";
          close(); toast(`${c.title} 공개했어요${t}`, 4000); B.reload();
        } });
    }));
    $("#luPub").addEventListener("click", async (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.v === "off") {
        const on = B.allCols.map((c) => c.svc).filter((s) => s?.status === "published");
        if (!on.length) return;
        return unpublish(on, `${monthLabel(B.month)} 배치표 전체`);
      }
      if (published) return;
      const targetCols = B.allCols.filter((c) => asgOf(c).length);
      if (!targetCols.length) return toast("배치한 칸이 없어요");
      const issues = targetCols.map((c) => { const w = colCheck(c, "all").filter((x) => x.c === "warn").map((x) => x.t); return w.length ? `<li>${esc(c.title)} · ${esc(w.join(", "))}</li>` : ""; }).join("");
      const recLeft = targetCols.reduce((n, c) => n + asgOf(c).filter((a) => a.recommended).length, 0);
      const pr = await pushRow("lineup", targetCols.map((c) => `lineup:${c.svc.id}`), "팀원 전체에게 '배치표가 나왔어요' · 배치된 사람은 내 섬김이 함께 가요");
      modal({
        title: `${monthLabel(B.month)} 배치표 전체 공개`,
        body: `<p style="margin:0">주일 ${targetCols.filter((c) => c.type === "sun").length}주${minNames.length ? ` + 사역(${esc(minNames.join(", "))})` : ""}을 한 번에 공개해요. 멤버 화면 배치표와 홈에 바로 보여요.</p>
          ${issues ? `<div class="notice warn" style="margin:0">확인해 주세요<ul style="margin:6px 0 0;padding-left:18px">${issues}</ul></div>` : ""}
          ${recLeft ? `<p class="small muted" style="margin:0">추천으로 들어간 ${recLeft}칸도 그대로 공개돼요.</p>` : ""}
          ${pr}${msgOnly(pubMsg)}`,
        confirmLabel: "공개하고 문구 복사",
        onConfirm: async (close) => {
          const push = pushChecked();
          const { error } = await sb.from("services").update({ status: "published", published_at: new Date().toISOString() }).in("id", targetCols.map((c) => c.svc.id));
          if (error) throw new Error("공개하지 못했습니다");
          await copyText(pubMsg);
          const t = push ? await sendPush("lineup", { service_ids: targetCols.map((c) => c.svc.id), month: B.month }) : "";
          close(); toast(`공개했어요. 카톡 문구를 복사했어요${t}`, 4000); B.reload();
        },
      });
    });
    $("#luClear")?.addEventListener("click", () => {
      const label = B.curMi ? `${B.curMi.name} 배치` : `${monthLabel(B.month)} 주일·사역 배치`;
      modal({
        title: `${label} 비우기`, body: `<p style="margin:0">이 탭의 모든 배치를 지워요${B.curMi ? "" : " (예배 2개 이상인 사역 탭은 그대로)"}. 공개된 배치표도 함께 비워져요.</p>`,
        confirmLabel: "비우기", danger: true,
        onConfirm: async (close) => {
          const ids = B.cols.map((c) => c.svc?.id).filter(Boolean);
          if (ids.length) { const { error } = await sb.from("assignments").delete().in("service_id", ids); if (error) throw new Error("비우지 못했습니다"); }
          close(); toast("비웠어요"); B.reload();
        },
      });
    });
    if (V.part === "status") return;
    $("#luExtra")?.addEventListener("click", (e) => { V.extraOpen = { ...V.extraOpen, [V.part]: e.currentTarget.dataset.open === "1" }; drawBoard(); });

    // ---- 끌어 놓기 · 눌러서 놓기
    root.ondragstart = (e) => {
      const chip = e.target.closest(".lu-chip[data-who], .lu-cand"); if (!chip) return;
      V.drag = { who: chip.dataset.who, from: chip.dataset.aid || null };
      e.dataTransfer.setData("text/plain", chip.dataset.who); e.dataTransfer.effectAllowed = "move";
      root.querySelectorAll(".lu-cell").forEach((c) => c.classList.toggle("valid", canPlace(V.drag.who, c.dataset.pos)));
      if (V.drag.from) $("#luPool").classList.add("drop");
    };
    root.ondragend = () => {
      V.drag = null;
      root.querySelectorAll(".lu-cell.valid").forEach((c) => c.classList.remove("valid"));
      $("#luPool")?.classList.remove("drop");
    };
    root.querySelectorAll(".lu-cell").forEach((c) => {
      c.addEventListener("dragover", (e) => { if (V.drag && canPlace(V.drag.who, c.dataset.pos)) e.preventDefault(); });
      c.addEventListener("drop", (e) => {
        e.preventDefault();
        if (V.drag && canPlace(V.drag.who, c.dataset.pos)) placeOn(V.drag.who, col(c), c.dataset.pos, +c.dataset.slot, V.drag.from);
      });
      c.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        const chip = e.target.closest(".lu-chip");
        if (chip && !V.picked) {   // 이름표 누르기 = 지정·빼기 버튼 열기 (폰)
          const on = !chip.classList.contains("open");
          root.querySelectorAll(".lu-chip.open").forEach((x) => x.classList.remove("open"));
          chip.classList.toggle("open", on);
          return;
        }
        if (V.picked && canPlace(V.picked, c.dataset.pos)) return placeOn(V.picked, col(c), c.dataset.pos, +c.dataset.slot, null);
        const i = +c.dataset.ci;
        if (i !== V.sel) { V.sel = i; drawBoard(); }
      });
    });
    document.onclick = (e) => { if (!e.target.closest(".lu-chip")) $$(".lu-chip.open").forEach((x) => x.classList.remove("open")); };
    const pool = $("#luPool");
    pool.addEventListener("dragover", (e) => { if (V.drag?.from) e.preventDefault(); });
    pool.addEventListener("drop", async (e) => {
      e.preventDefault();
      if (!V.drag?.from) return;
      await sb.from("assignments").delete().eq("id", V.drag.from);
      V.drag = null; B.reload();
    });
    pool.querySelectorAll(".lu-cand").forEach((c) => {
      const pick = () => { V.picked = V.picked === c.dataset.who ? null : c.dataset.who; drawBoard(); };
      c.addEventListener("click", pick);
      c.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    });
    $("#guestAdd").addEventListener("click", () => openGuestEdit(null, () => drawBoard()));

    // 이름표 버튼: 빼기 / 리더·밴마
    root.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const { error } = await sb.from("assignments").delete().eq("id", b.closest(".lu-chip").dataset.aid);
      if (error) toast("빼지 못했습니다");
      B.reload();
    }));
    root.querySelectorAll(".lu-role").forEach((b) => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const aid = b.closest(".lu-chip").dataset.aid, s = col(b.closest(".lu-cell")).svc;
      const field = b.dataset.role === "leader" ? "is_singer_leader" : "is_band_master";
      const on = b.getAttribute("aria-pressed") !== "true";
      if (on) await sb.from("assignments").update({ [field]: false }).eq("service_id", s.id).eq(field, true);
      const { error } = await sb.from("assignments").update({ [field]: on }).eq("id", aid);
      if (error) toast("지정하지 못했습니다");
      B.reload();
    }));

    // ---- 연습 시간 확정
    root.querySelectorAll("[data-win]").forEach((b) => b.addEventListener("click", () => {
      const [d, s, e] = b.dataset.win.split("|");
      confirmPractice(B.cols[V.sel], { d, s, e });
    }));
    $("#prUnconfirm")?.addEventListener("click", (e) => {
      const pid = e.target.dataset.pid;
      modal({ title: "연습 확정 풀기", body: `<p style="margin:0">이 연습과 연습 출석 기록이 지워지고, 멤버 화면에서도 사라져요.</p>`, confirmLabel: "확정 풀기", danger: true,
        onConfirm: async (close) => { const { error } = await sb.from("ministry_practices").delete().eq("id", pid); if (error) throw new Error("풀지 못했습니다"); close(); toast("연습 확정을 풀었어요"); B.reload(); } });
    });

    // ---- 자동 추천 (이 파트만)
    $("#recBasis")?.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && b.dataset.v !== V.basis) { V.basis = b.dataset.v; V.rec = null; drawBoard(); } });
    $("#recRun")?.addEventListener("click", () => runRecommend(false));
    $("#recAgain")?.addEventListener("click", () => runRecommend(true));
    $("#recClear")?.addEventListener("click", async () => {
      await clearRecommended(V.part); V.rec = null; V.recMsg = null; toast("추천을 지웠어요"); B.reload();
    });
  }

  async function clearRecommended(part) {
    const ids = V.board.cols.map((c) => c.svc?.id).filter(Boolean);
    const codes = partPositions(part).map((p) => p.code);
    if (ids.length) await sb.from("assignments").delete().in("service_id", ids).in("position_code", codes).eq("recommended", true);
  }

  // ================================================================ 배치 자동 추천 (파트별)
  //  반드시: 주일은 토·주 모두 가능 / 사역은 그 예배 가능(응답 대상) / 본인 포지션 / 하루 한 자리
  //          직접 넣은 칸 + 다른 파트에 들어간 사람(추천 포함)은 고정
  //          가능 시간 취합 사역: 연습 시간이 맞는 사람끼리 (확정 전이면 연습 시간도 함께 고름)
  //  점수(낮을수록 좋음): 실력 균형(파트별 숙련도 평균 분산) · 골고루(횟수 제곱합) · 연속(같은 주말은 한 번) · 성비
  //  여러 번 무작위로 시작해 고쳐 나가고(언덕 오르기), 점수가 좋은 서로 다른 안을 순서대로 보여 줌
  function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function buildPlans(part) {
    const B = V.board, PP = partPositions(part);
    const cols = B.cols;
    const order = S.settings?.rec_order || ["skill", "balance", "consecutive", "gender"];
    const W = Object.fromEntries(order.map((k, i) => [k, [9, 3, 1, 0.5][i] ?? 0.5]));
    const people = servingMembers();
    const boardKeys = new Set(cols.map((c) => c.key));
    // 고정 횟수·주: 지난 기록(골고루는 3개월 기준일 때만 직전 2개월) + 이 화면 밖의 이 달 배치
    const baseCount = {}, baseWeeks = {};
    const qFrom = addMonths(B.month, -2);
    B.hist.forEach((h) => (h.assignments || []).forEach((a) => {
      if (!a.member_id) return;
      (baseWeeks[a.member_id] ||= new Set()).add(weekKey(h.service_date));
      if (V.basis === "quarter" && h.service_date >= qFrom) baseCount[a.member_id] = (baseCount[a.member_id] || 0) + 1;
    }));
    B.allCols.filter((c) => !boardKeys.has(c.key)).forEach((c) => new Set(asgOf(c).map((a) => a.member_id).filter(Boolean)).forEach((mid) => {
      baseCount[mid] = (baseCount[mid] || 0) + 1; (baseWeeks[mid] ||= new Set()).add(weekKey(c.date));
    }));
    // 칸
    const fixed = cols.map((c) => asgOf(c).filter((a) => !(a.recommended && partOfPos(a.position_code) === part)));
    const open = [];
    //  019: 추천은 기본 인원까지만 (기본을 넘는 자리는 리더십이 직접)
    //       직접 넣은 사람(추가 자리 포함)이 기본 인원만큼 있으면 그 포지션은 더 채우지 않음
    cols.forEach((c, w) => PP.forEach((p) => {
      const taken = new Set(fixed[w].filter((a) => a.position_code === p.code).map((a) => a.slot));
      let need = Math.max(0, baseOf(p) - taken.size);
      for (let k = 1; k <= p.max_count && need > 0; k++) if (!taken.has(k)) { open.push({ w, pos: p.code, slot: k }); need--; }
    }));
    const eligible = cols.map((c) => people.filter((m) => c.type === "sun" ? B.ans(m, c, "sun") === true && B.ans(m, c, "sat") === true
      : !B.notTarget(m, c) && B.ans(m, c, "sun") === true));
    const fixedIds = fixed.map((list) => new Set(list.map((a) => a.member_id).filter(Boolean)));
    // 연습 시간 후보 (가능 시간 취합 사역): 확정이면 그 시간, 아니면 고정 인원이 모두 되는 시간 중 되는 사람이 많은 순
    const winOpts = cols.map((c, w) => {
      if (!isPollCol(c)) return [null];
      const pr = practiceOf(c);
      if (pr) return [winOf(pr)];
      const team = [...fixedIds[w]].map(memOf).filter(Boolean).filter((m) => hasPoll(c.mi, m.id));
      const ws = allWins(c.mi).filter((x) => team.every((m) => canPractice(m, c, x)))
        .map((x) => ({ x, n: eligible[w].filter((m) => canPractice(m, c, x)).length })).filter((o) => o.n > 0)
        .sort((a, b) => b.n - a.n).map((o) => o.x);
      return ws.length ? ws.slice(0, 8) : ["none"];
    });
    const fixedLv = fixed.map((list) => list.filter((a) => (a.member_id || a.guest_id) && (part === "vocal" ? a.position_code === "singer" : partOfPos(a.position_code) === "band")).map(lvOfAsg));
    const fixedDays = {};
    fixed.forEach((list, w) => list.forEach((a) => { if (a.member_id) (fixedDays[a.member_id] ||= new Set()).add(w); }));
    const fixedSex = fixed.map((list) => sexOf(list));
    const weekList = (() => {
      const ks = [...new Set(cols.map((c) => weekKey(c.date)))].sort();
      const out = []; for (let d = addDays(ks[0], -21); d <= ks[ks.length - 1]; d = addDays(d, 7)) out.push(d);
      return out;
    })();
    const runPen = (r) => (r <= 1 ? 0 : r === 2 ? 1 : r === 3 ? 4 : 9 + (r - 4) * 5);

    function score(plan) {
      // 실력 균형 (이 파트만: 싱어끼리 / 밴드끼리)
      const sums = fixedLv.map((l) => [l.reduce((s, x) => s + x, 0), l.length]);
      const days = {}; let extra = 0;
      const sex = fixedSex.map((x) => ({ ...x }));
      plan.forEach((mid, i) => {
        if (!mid) return;
        const o = open[i]; const m = memOf(mid);
        if (part === "band" || o.pos === "singer") { sums[o.w][0] += skillOf(mid, o.pos); sums[o.w][1]++; }
        (days[mid] ||= new Set()).add(o.w);
        if (m.main_position !== o.pos) extra++;
        if (part === "vocal") { if (m.gender === "m") sex[o.w].m++; else if (m.gender === "f") sex[o.w].f++; }
      });
      const avgs = sums.filter(([, n]) => n).map(([s, n]) => s / n);
      const mean = avgs.reduce((s, x) => s + x, 0) / (avgs.length || 1);
      const skill = avgs.reduce((s, x) => s + (x - mean) ** 2, 0) * 8;
      // 골고루 + 연속 (주일+사역, 같은 주말은 한 주)
      let bal = 0, con = 0;
      people.forEach((m) => {
        const ws = new Set([...(fixedDays[m.id] || []), ...(days[m.id] || [])]);
        bal += (ws.size + (baseCount[m.id] || 0)) ** 2;
        const wk = new Set([...(baseWeeks[m.id] || [])]); ws.forEach((w) => wk.add(weekKey(cols[w].date)));
        let run = 0;
        weekList.forEach((d) => { if (wk.has(d)) run++; else { con += runPen(run); run = 0; } });
        con += runPen(run);
      });
      // 성비 (인도자+싱어): 남녀 최소 1명씩은 강하게, 반반은 약하게
      let gStrong = 0, gWeak = 0;
      if (part === "vocal") sex.forEach((x) => { if (x.m + x.f >= 2) { if (!x.m || !x.f) gStrong++; gWeak += Math.abs(x.m - x.f); } });
      // 빈 칸: 인도자 > 싱어 1·2 · 밴드 > 싱어 3번째부터 (싱어는 기본 인원을 다 안 채워도 됨)
      const empty = plan.reduce((n, x, i) => n + (!x && cands0[i].length ? (open[i].pos === "leader" ? 3 : open[i].pos === "singer" && open[i].slot > 2 ? 0.15 : 1) : 0), 0);
      return W.skill * skill + W.balance * bal * 0.5 + W.consecutive * con * 2 + 60 * gStrong + W.gender * gWeak * 1.5 + extra * 0.6 + empty * 1000;
    }

    const cands0 = open.map((o) => eligible[o.w].filter((m) => posOfM(m).includes(o.pos) && !fixedIds[o.w].has(m.id)).map((m) => m.id));
    const solve = (seed) => {
      const r = rng(seed);
      // 사역 열마다 연습 시간 하나 고르기 (첫 안은 가장 많이 되는 시간). 같은 사역의 다른 예배와는 되도록 안 겹치게
      const wins = [];
      winOpts.forEach((ws, k) => {
        const start = seed % 10 === 0 ? 0 : Math.floor(r() * Math.min(3, ws.length));
        const taken = wins.filter((w, j) => w?.d && cols[j].mi?.id === cols[k].mi?.id);
        let pickW = ws[start];
        for (let n = 0; n < ws.length; n++) { const w = ws[(start + n) % ws.length]; if (!w?.d || !taken.some((t) => overlap(t, w))) { pickW = w; break; } }
        wins.push(pickW);
      });
      const cands = open.map((o, i) => {
        const c = cols[o.w], w = wins[o.w];
        if (w === "none") return [];
        return w ? cands0[i].filter((mid) => canPractice(memOf(mid), c, w)) : cands0[i];
      });
      const plan = new Array(open.length).fill(null);
      const usedDay = (mid, w, except) => (fixedDays[mid]?.has(w)) || plan.some((x, i) => i !== except && x === mid && open[i].w === w);
      const idx = open.map((_, i) => i).sort((a, b) => cands[a].length - cands[b].length || r() - 0.5);
      for (const i of idx) {
        const opts = cands[i].filter((mid) => !usedDay(mid, open[i].w, i));
        if (!opts.length) continue;
        let best = null, bs = Infinity;
        for (const mid of opts) { plan[i] = mid; const s = score(plan) + r() * 2; if (s < bs) { bs = s; best = mid; } }
        plan[i] = best;
      }
      let cur = score(plan);
      for (let it = 0; it < 1200; it++) {
        const i = Math.floor(r() * open.length);
        if (!cands[i].length) continue;
        const mid = cands[i][Math.floor(r() * cands[i].length)];
        if (mid === plan[i] || fixedDays[mid]?.has(open[i].w)) continue;
        const old = plan[i];
        const j = plan.findIndex((x, k) => k !== i && x === mid && open[k].w === open[i].w);
        if (j >= 0) { if (old && !cands[j].includes(old)) continue; plan[j] = old; }
        plan[i] = mid;
        const s = score(plan);
        if (s <= cur) cur = s; else { plan[i] = old; if (j >= 0) plan[j] = mid; }
      }
      // 확정 전 연습: 고른 시간에 안 되는 고정 인원 수만큼 크게 감점
      const clash = wins.reduce((n, w, k) => n + (w && w !== "none" ? [...fixedIds[k]].map(memOf).filter((m) => m && !canPractice(m, cols[k], w)).length : 0), 0);
      // 예배 여러 개: 두 예배에 다 들어간 사람이 있으면 연습 시간이 겹치지 않게
      const teamOf = (k) => new Set([...fixedIds[k], ...plan.filter((x, i) => x && open[i].w === k)]);
      let both = 0;
      wins.forEach((a, k1) => wins.forEach((b, k2) => {
        if (k2 <= k1 || !a?.d || !b?.d || !overlap(a, b)) return;
        const t1 = teamOf(k1); teamOf(k2).forEach((x) => { if (t1.has(x)) both++; });
      }));
      return { plan, wins, score: cur + clash * 500 + both * 1500 };
    };
    const base = Math.floor(Math.random() * 1e6) * 10;
    const sols = [];
    for (let k = 0; k < 10; k++) {
      const s = solve(base + k);
      const sig = s.plan.join(",") + "|" + s.wins.map((w) => (w && w.d ? w.d + w.s : "")).join(",");
      if (!sols.some((x) => x.sig === sig)) sols.push({ ...s, sig });
    }
    sols.sort((a, b) => a.score - b.score);
    return { open, sols, unfillable: open.filter((_, i) => !cands0[i].length) };
  }

  async function runRecommend(again) {
    const part = V.part;
    $("#recRun").disabled = true; $("#recRun").textContent = "추천 중…";
    await new Promise((r) => setTimeout(r, 30));
    try {
      const prev = again && V.rec?.key === `${V.boardKey}|${part}` ? V.rec : null;
      await clearRecommended(part);
      await V.board.reload();
      const B = V.board;
      const built = buildPlans(part);
      const seen = new Set(prev?.seen || []);
      let idx = built.sols.findIndex((s) => !seen.has(s.sig));
      if (idx < 0) { seen.clear(); idx = 0; }
      const sol = built.sols[idx];
      seen.add(sol?.sig);
      V.rec = { key: `${V.boardKey}|${part}`, seen: [...seen], round: (prev?.round || 0) + 1 };
      const rows = [];
      for (let i = 0; i < built.open.length; i++) {
        if (!sol?.plan[i]) continue;
        const o = built.open[i];
        const s = await B.cols[o.w].ensure();
        rows.push({ service_id: s.id, position_code: o.pos, slot: o.slot, member_id: sol.plan[i], recommended: true });
      }
      if (rows.length) { const { error } = await sb.from("assignments").insert(rows); if (error) throw new Error(error.message); }
      // 확정 전 사역 연습: 추천 연습 시간
      const notes = [];
      (sol?.wins || []).forEach((w, k) => {
        const c = B.cols[k];
        if (!isPollCol(c) || practiceOf(c)) return;
        if (w && w !== "none") { V.sugg[c.key] = w; notes.push(`${c.title} ${winText(w)}`); }
        else { delete V.sugg[c.key]; notes.push(`${c.title} — 연습 시간이 맞는 사람이 없어요`); }
      });
      const byPos = {};
      built.unfillable.filter((o) => o.pos !== "singer").forEach((o) => { const d = B.cols[o.w].title; (byPos[o.pos] ||= []).includes(d) || byPos[o.pos].push(d); });
      const missText = Object.entries(byPos).map(([pos, ds]) => `${positionName(pos)}(${ds.length === B.cols.length ? "모든 열" : ds.join(", ")})`);
      V.recMsg = { part, warn: missText.length > 0,
        text: `<b>${PART_NAME[part]} 추천 완료${V.rec.round > 1 ? ` · ${V.rec.round}번째 안` : ""}</b> · 빈 칸 ${built.open.length}개 중 ${rows.length}개를 채웠어요.${missText.length ? ` ${esc(missText.join(", "))} — 조건에 맞는 사람이 없어 비워 뒀어요.` : ""}
          ${part === "vocal" ? "밴드" : "인도·싱어"} 탭에 들어간 사람은 그날 후보에서 뺐어요.${notes.length ? `<br>추천 연습 시간: ${esc(notes.join(" · "))} — 사역 열을 눌러 위 패널에서 확정해 주세요.` : ""}` };
      toast(again ? "다른 안으로 바꿨어요" : `빈 칸 ${rows.length}개를 추천으로 채웠어요`);
    } catch (e) { toast("추천하지 못했습니다: " + (e.message || ""), 4000); console.error(e); }
    await V.board.reload();
  }

  // ================================================================ 출석 (토요 연습 · 팀모임 · 주일 리허설)
  //  한 주 = 토요일 한 줄(team_meetings). 연습·리허설: 그 주 주일 배치 인원 / 팀모임: 활동 중 전체(수습 포함)
  //  리허설 기록도 토요일 줄에 kind = rehearsal 로 저장 (날짜는 다음 날 주일)
  //  사역 연습 출석은 사역 화면 › 출석 탭에서
  const A = { tab: "week", month: null, sel: null, data: null, open: null, mfilter: "all", skind: "meeting", srange: 12 };
  const ATT_KEYS = ["present", "late", "absent"];
  // 016: 팀원이 미리 알린 팀모임 불참 (결석으로 들어가 있음)
  const preList = (row) => (row?.attendance || []).filter((r) => r.kind === "meeting" && r.status === "absent" && r.self_reported_at);
  const preN = (row) => preList(row).length;
  const byPos = (a, b) => (posOrder()[a.main_position] ?? 99) - (posOrder()[b.main_position] ?? 99) || a.name.localeCompare(b.name, "ko");
  // 기존 팀원은 계정 등록일과 관계없이 대상 (지난 토요일도 뒤늦게 기록할 수 있게). 수습생만 시작 전 토요일 제외
  const meetingPeople = (d) => S.members.filter((m) => m.is_active && !isObs(m) && !(m.status === "trainee" && m.joined_at && m.joined_at > d)).sort(byPos);
  const MS_CHIP = { yes: "chip-ok", no: "chip-gray", tbd: "chip-mid" };

  // 없는 토요일 줄을 만들어 둠 (기본 '미정')
  async function ensureSaturdays(dates) {
    if (!dates.length) return;
    await sb.from("team_meetings").upsert(dates.map((d) => ({ meeting_date: d })), { onConflict: "meeting_date", ignoreDuplicates: true });
  }

  // 그 토요일 연습·리허설 대상 = 다음 날 주일 배치 인원 (임시저장 포함, 한 사람은 한 번)
  function servePeople(d, services, recs = [], kind = "practice") {
    const s = services.find((x) => x.service_date === addDays(d, 1));
    const seen = new Set(), list = [];
    (s?.assignments || []).slice()
      .sort((a, b) => (posOrder()[a.position_code] ?? 99) - (posOrder()[b.position_code] ?? 99) || a.slot - b.slot)
      .forEach((a) => {
        const m = S.members.find((x) => x.id === a.member_id);
        if (m && !seen.has(m.id)) { seen.add(m.id); list.push({ m, pos: a.position_code }); }
      });
    // 기록은 있는데 배치에서 빠진 사람도 보여 줌
    recs.filter((r) => r.kind === kind && !seen.has(r.member_id)).forEach((r) => {
      const m = S.members.find((x) => x.id === r.member_id);
      if (m) { seen.add(m.id); list.push({ m, pos: m.main_position, off: true }); }
    });
    return { list, status: s?.status || null };
  }

  async function renderAttendance() {
    if (!A.month) A.month = monthOf(lastSaturday());
    if (A.tab === "stats") return renderAttStats();
    const sats = saturdaysOf(A.month);
    if (!A.sel || !sats.includes(A.sel)) A.sel = sats.includes(lastSaturday()) ? lastSaturday() : sats[0];
    await ensureSaturdays(sats);
    const [tm, sv] = await Promise.all([
      sb.from("team_meetings").select("*, attendance(*)").in("meeting_date", sats),
      sb.from("services").select("service_date, status, assignments(member_id, position_code, slot)").is("ministry_id", null).in("service_date", sats.map((d) => addDays(d, 1))),
    ]);
    if (tm.error || sv.error) { toast("출석을 불러오지 못했습니다. migration_009를 실행했는지 확인해 주세요.", 4000); console.error(tm.error || sv.error); }
    A.data = { sats, meetings: tm.data || [], services: sv.data || [] };
    drawAttendance();
  }

  const attTabs = () => `<div class="tabs" role="tablist" id="attTabs">${[["week", "주간 체크"], ["month", "월간 보기"], ["stats", "통계"]].map(([k, l]) =>
    `<button type="button" role="tab" data-atab="${k}" aria-selected="${A.tab === k}">${l}</button>`).join("")}</div>`;
  function bindAttTabs() {
    $("#attTabs").onclick = (e) => { const b = e.target.closest("[data-atab]"); if (b && b.dataset.atab !== A.tab) { A.tab = b.dataset.atab; A.open = null; renderAttendance(); } };
  }

  function drawAttendance() {
    const { sats, meetings, services } = A.data;
    const today = todayISO();
    const mt = (d) => meetings.find((x) => x.meeting_date === d) || { meeting_status: "tbd", attendance: [] };
    const tabsHTML = attTabs();
    const head = `<div class="page-head">${monthNav("출석", A.month)}${A.tab === "month" ? `<div class="seg" id="mKind">${[["all", "전체"], ["practice", "연습"], ["meeting", "팀모임"], ["rehearsal", "리허설"]].map(([k, l]) =>
      `<button type="button" data-k="${k}" aria-pressed="${A.mfilter === k}">${l}</button>`).join("")}</div>` : ""}</div>`;

    if (A.tab === "month") {
      const kinds = A.mfilter === "all" ? ["practice", "meeting", "rehearsal"] : [A.mfilter];
      const sub = { practice: "연습", meeting: "모임", rehearsal: "리허설" };
      const short = { present: "출", late: "지", absent: "결" };
      const target = (s, kind, m) => kind === "meeting" ? mt(s).meeting_status !== "no" && meetingPeople(s).some((x) => x.id === m.id)
        : kind === "practice" && mt(s).practice_cancelled ? false
        : servePeople(s, services, mt(s).attendance, kind).list.some((x) => x.m.id === m.id);
      const cell = (s, kind, m, first) => {
        const bl = first ? ` style="border-left:1px solid var(--line)"` : "";
        if (!target(s, kind, m)) return `<td class="m-off"${bl}>·</td>`;
        const r = recOf(mt(s), m.id, kind);
        const day = kind === "rehearsal" ? addDays(s, 1) : s;
        return `<td class="${r ? "m-" + r.status : "m-off"}"${bl} ${r ? `title="${md(day)} ${ACT_KINDS[kind]} ${ATT[r.status]}${r.status === "absent" ? " · " + esc(reasonText(r)) : ""}${r.self_reported_at ? " · 미리 알림" : ""}"` : ""}>${r ? short[r.status] : day > today ? "" : "–"}</td>`;
      };
      const everyone = meetingPeople(sats[sats.length - 1]);
      const tally = (m, st) => sats.reduce((n, s) => n + kinds.filter((k) => recOf(mt(s), m.id, k)?.status === st).length, 0);
      const absences = sats.flatMap((s) => kinds.flatMap((k) => mt(s).attendance.filter((r) => r.kind === k && r.status === "absent").map((r) => ({ s, k, r }))))
        .sort((a, b) => b.s.localeCompare(a.s));
      $("#content").innerHTML = `${head}${tabsHTML}
        <div class="evaltable"><table class="att-table">
          <thead><tr><th rowspan="2">이름</th>${sats.map((s) => `<th colspan="${kinds.length}" style="text-align:center;border-left:1px solid var(--line)">${md(s)} 주 ${kinds.includes("meeting") ? `<span class="chip ${MS_CHIP[mt(s).meeting_status]}" style="margin-left:4px">모임 ${MEETING[mt(s).meeting_status]}</span>` : ""}${kinds.includes("practice") && mt(s).practice_cancelled ? `<span class="chip chip-gray" style="margin-left:4px">연습 취소</span>` : ""}</th>`).join("")}
            <th rowspan="2" style="border-left:1px solid var(--line)">지각</th><th rowspan="2">결석</th></tr>
            <tr>${sats.map(() => kinds.map((k, i) => `<th style="${i === 0 ? "border-left:1px solid var(--line);" : ""}font-size:12px">${sub[k]}</th>`).join("")).join("")}</tr></thead>
          <tbody>${everyone.map((m) => {
            const L = tally(m, "late"), X = tally(m, "absent");
            return `<tr><td style="font-weight:700"><a href="#member/${m.id}" style="color:inherit;text-decoration:none">${esc(m.name)}</a></td>${sats.map((s) => kinds.map((k, i) => cell(s, k, m, i === 0)).join("")).join("")}
              <td style="border-left:1px solid var(--line);${L ? "color:var(--mid);font-weight:800" : ""}">${L}</td><td style="${X ? "color:var(--bad);font-weight:800" : ""}">${X}</td></tr>`;
          }).join("") || `<tr><td colspan="99" class="muted">활동 중인 팀원이 없어요.</td></tr>`}</tbody></table></div>
        <p class="small muted" style="margin:0">출 출석 · 지 지각 · 결 결석(칸에 마우스를 올리면 사유) · – 미기록 · · 대상 아님 (연습·리허설은 그 주 섬김 인원만)</p>
        <section class="panel"><h2>${monthLabel(A.month)} 결석 사유 <small>${absences.length}건</small></h2>
          ${absences.length ? `<div class="rlist">${absences.map(({ s, k, r }) => {
            const m = S.members.find((x) => x.id === r.member_id);
            return `<div><b>${md(k === "rehearsal" ? addDays(s, 1) : s)}</b><span>${esc(m?.name || "—")}</span><span class="chip chip-bad" style="justify-self:start">${ACT_KINDS[k]}</span><span>${esc(reasonText(r))}</span></div>`;
          }).join("")}</div>` : `<span class="small muted">이 달 결석 기록이 없어요.</span>`}</section>`;
      bindMonthNav((n) => { A.month = addMonths(A.month, n); A.sel = null; renderAttendance(); });
      bindAttTabs();
      $("#mKind").onclick = (e) => { const b = e.target.closest("button"); if (b) { A.mfilter = b.dataset.k; drawAttendance(); } };
      return;
    }

    // ---------- 주간 체크 ----------
    const d = A.sel, row = mt(d), ms = row.meeting_status, sun = addDays(d, 1);
    const prac = servePeople(d, services, row.attendance, "practice");
    const reh = servePeople(d, services, row.attendance, "rehearsal");
    const meet = meetingPeople(d);
    const futureSat = d > today, futureSun = sun > today;

    const tabs = sats.map((s) => {
      const r = mt(s);
      const p = servePeople(s, services, r.attendance).list.length;
      const c = (k) => r.attendance.filter((x) => x.kind === k).length;
      const info = s > today ? `팀모임 ${MEETING[r.meeting_status]}${preN(r) ? ` · 불참 ${preN(r)}` : ""}`
        : `연습 ${r.practice_cancelled ? "취소" : c("practice") + "/" + p} · 모임 ${r.meeting_status === "no" ? "없음" : c("meeting") + "/" + meetingPeople(s).length} · 리허설 ${c("rehearsal")}/${p}`;
      return `<button type="button" class="sat-tab ${s === d ? "on" : ""} ${s === lastSaturday() ? "today" : ""}" data-sat="${s}"><b>${md(s)} – ${md(addDays(s, 1))}</b><span>${info}</span></button>`;
    }).join("");

    const seg = (m, kind, cur, disabled) => `<div class="seg" role="group" aria-label="${esc(m.name)} ${ACT_KINDS[kind]}" data-mid="${m.id}" data-kind="${kind}">${ATT_KEYS.map((k) =>
      `<button type="button" data-v="${k}" data-tone="${k}" aria-pressed="${cur === k}" ${disabled ? "disabled" : ""}>${ATT[k]}</button>`).join("")}</div>`;
    const sum = (kind, total) => {
      const rs = row.attendance.filter((r) => r.kind === kind);
      const c = (k) => rs.filter((r) => r.status === k).length;
      return `<div class="att-sum"><span class="chip chip-ok">출석 ${c("present")}</span><span class="chip chip-mid">지각 ${c("late")}</span>
        <span class="chip ${c("absent") ? "chip-bad" : "chip-gray"}">결석 ${c("absent")}</span><span class="chip chip-gray">미기록 ${Math.max(total - rs.length, 0)}</span></div>`;
    };
    const reasonBox = (r) => {
      const tag = r?.reason_tag || "";
      return `<div class="reason" data-reason>
        <b class="small" style="color:var(--bad)">결석 사유를 골라 주세요</b>
        <div class="chips">${REASON_TAGS.map((t) => `<button type="button" data-tag="${t}" aria-pressed="${t === tag}">${t}</button>`).join("")}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><input type="text" maxlength="200" data-rtext value="${esc(r?.reason || "")}" placeholder="직접 입력 (칩 없이 적어도 돼요)" style="flex:1 1 180px">
          <button type="button" class="btn btn-primary btn-sm" data-rsave>저장</button><button type="button" class="btn btn-ghost btn-sm" data-rcancel>취소</button></div></div>`;
    };
    const personRow = (m, kind, extra, disabled) => {
      const r = recOf(row, m.id, kind);
      const open = A.open && A.open.mid === m.id && A.open.kind === kind;
      return `<div class="att-row" data-row="${m.id}:${kind}"><span class="who"><b>${esc(m.name)}${m.status === "trainee" ? ` <span class="chip chip-mid">수습</span>` : ""}</b>
        <span>${extra || esc(positionName(m.main_position))}${r?.status === "absent" ? ` · <button type="button" class="rs" data-redit>결석: ${esc(reasonText(r))}</button>` : ""}${r?.self_reported_at ? ` <span class="chip chip-pre" title="${esc(fmtDateTime(r.self_reported_at))}에 본인이 알림">미리 알림</span>` : ""}</span></span>
        ${seg(m, kind, open ? "absent" : r?.status, disabled)}${open ? reasonBox(r) : ""}</div>`;
    };
    const col = (kind, title, sub, people, disabled, emptyMsg) => `<section class="att-col" aria-label="${title}">
      <div class="dcard-head"><h2>${title}</h2><span class="small muted">${sub}</span></div>
      ${people.length ? `${sum(kind, people.length)}
        ${people.map(({ m, pos, off }) => personRow(m, kind, off ? "배치에서 빠짐" : pos ? esc(positionName(pos)) : "", disabled)).join("")}
        ${disabled ? "" : `<button type="button" class="btn btn-soft btn-sm" data-allin="${kind}" style="align-self:flex-start">남은 사람 모두 출석</button>`}`
      : emptyMsg}</section>`;
    const noLineup = (day) => `<div class="empty" style="padding:20px">${md(day)} 주일 배치가 아직 없어요.<br><a href="#lineup" data-lmonth="${monthOf(day)}">배치표로 가기</a></div>`;

    const meetCol = ms === "no"
      ? `<section class="att-col off" aria-label="팀모임"><div class="dcard-head"><h2>팀모임</h2><span class="small muted">활동 중 ${meet.length}명</span></div><div class="empty" style="padding:20px">이번 주는 팀모임이 없어요.</div></section>`
      : col("meeting", "팀모임", `활동 중 ${meet.length}명 · 수습 포함${preN(row) ? ` · 불참 미리 알림 ${preN(row)}명` : ""}`, meet.map((m) => ({ m })), futureSat,
          "").replace(`<div class="att-sum">`, `${ms === "tbd" && !futureSat ? `<p class="notice warn" style="margin:0">팀모임 여부가 '미정'이에요. 출석을 체크하면 '있음'으로 바뀌어요.</p>` : ""}<div class="att-sum">`);

    $("#content").innerHTML = `${head}${tabsHTML}
      <div class="sat-tabs" role="tablist" aria-label="주">${tabs}</div>
      <section class="card bordered" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px">
        <div style="display:flex;flex-direction:column;gap:2px"><b style="font-size:17px">${fmtDate(d, { month: "long", day: "numeric", weekday: "short" })} 팀모임</b>
          <span class="small muted">${futureSat ? "정해지면 팀원 홈에 바로 보여요" : "연습 후 팀모임이 있었는지 골라 주세요"}</span></div>
        <div class="seg" id="msSeg">${["yes", "no", "tbd"].map((k) => `<button type="button" data-v="${k}" aria-pressed="${ms === k}">${MEETING[k]}</button>`).join("")}</div>
      </section>
      ${futureSat ? `<p class="notice ok" style="margin:0">아직 오지 않은 주예요. 출석은 그날부터 체크할 수 있어요.${ms === "yes" ? " 팀모임 불참은 팀원이 그날 낮 12시까지 미리 알릴 수 있고, 미리 알린 사람은 결석으로 들어가 있어요." : ""}</p>` : ""}
      <div class="att-cols att3">
        ${row.practice_cancelled
          ? `<section class="att-col off" aria-label="토요 연습"><div class="dcard-head"><h2>토요 연습</h2><span class="small muted">취소 · 당일 리허설만</span></div><div class="empty" style="padding:20px">이번 주는 토요 연습이 없어요.<br>리허설 출석만 체크해 주세요. <a href="#schedule">섬김 일정</a></div></section>`
          : col("practice", "토요 연습", `${timeRange(...satTime(row, S.settings))} · ${md(sun)} 섬김 ${prac.list.filter((x) => !x.off).length}명${prac.status === "draft" ? " · 배치 임시저장" : ""}`, prac.list, futureSat, noLineup(sun))}
        ${meetCol}
        ${col("rehearsal", "주일 리허설", `${md(sun)} (주일) · 섬김 ${reh.list.filter((x) => !x.off).length}명`, reh.list, futureSun, noLineup(sun))}
      </div>`;

    bindMonthNav((n) => { A.month = addMonths(A.month, n); A.sel = null; A.open = null; renderAttendance(); });
    bindAttTabs();
    bindAttendance(row);
  }

  function bindAttendance(row) {
    const content = $("#content");
    content.querySelectorAll("[data-sat]").forEach((b) => b.addEventListener("click", () => { A.sel = b.dataset.sat; A.open = null; drawAttendance(); }));
    content.querySelector("[data-lmonth]")?.addEventListener("click", (e) => { V.lineupMonth = e.target.dataset.lmonth; });

    const setStatus = async (v) => {
      const { error } = await sb.from("team_meetings").update({ meeting_status: v }).eq("id", row.id);
      if (error) return toast("바꾸지 못했습니다");
      toast(`${md(A.sel)} 팀모임 ${MEETING[v]}`);
      renderAttendance();
    };
    $("#msSeg").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b || b.getAttribute("aria-pressed") === "true") return;
      const n = row.attendance.filter((r) => r.kind === "meeting").length;
      if (b.dataset.v === "no" && n) {
        return modal({ title: `${md(A.sel)} 팀모임 없음으로 바꾸기`,
          body: `<p style="margin:0">이 날 적어 둔 팀모임 출석 ${n}건이 지워져요. 연습·리허설 출석은 그대로 남아요.</p>`,
          confirmLabel: "없음으로 바꾸기", danger: true, onConfirm: async (close) => { close(); await setStatus("no"); } });
      }
      setStatus(b.dataset.v);
    });

    const save = async (key, status, reason = {}) => {
      const { error } = await sb.from("attendance").upsert({ ...key, status, reason_tag: reason.tag || null, reason: reason.text || null });
      if (error) { toast(error.message?.includes("팀모임이 없는") || error.message?.includes("사유") ? error.message : "저장하지 못했습니다", 3500); return false; }
      const was = recOf(row, key.member_id, key.kind) || null;
      row.attendance = row.attendance.filter((r) => !(r.member_id === key.member_id && r.kind === key.kind));
      row.attendance.push({ ...key, status, reason_tag: status === "absent" ? reason.tag || null : null, reason: status === "absent" ? reason.text || null : null,
        self_reported_at: status === "absent" ? was?.self_reported_at || null : null });
      if (key.kind === "meeting" && row.meeting_status === "tbd") row.meeting_status = "yes";
      return true;
    };

    content.querySelectorAll(".att-row").forEach((rowEl) => {
      const [mid, kind] = rowEl.dataset.row.split(":");
      const key = { meeting_id: row.id, member_id: mid, kind };
      rowEl.querySelector(".seg").addEventListener("click", async (e) => {
        const b = e.target.closest("button"); if (!b || b.disabled) return;
        const cur = recOf(row, mid, kind);
        if (b.dataset.v === "absent") {
          if (A.open?.mid === mid && A.open?.kind === kind) { A.open = null; return drawAttendance(); }
          if (cur?.status === "absent") {   // 이미 결석 → 기록 지우기
            const { error } = await sb.from("attendance").delete().match(key);
            if (error) return toast("저장하지 못했습니다");
            row.attendance = row.attendance.filter((r) => !(r.member_id === mid && r.kind === kind));
            return drawAttendance();
          }
          A.open = { mid, kind }; return drawAttendance();   // 사유 입력 열기
        }
        A.open = null;
        if (cur?.status === b.dataset.v) {
          const { error } = await sb.from("attendance").delete().match(key);
          if (error) return toast("저장하지 못했습니다");
          row.attendance = row.attendance.filter((r) => !(r.member_id === mid && r.kind === kind));
        } else if (!(await save(key, b.dataset.v))) return;
        drawAttendance();
      });
      rowEl.querySelector("[data-redit]")?.addEventListener("click", () => { A.open = { mid, kind }; drawAttendance(); });
      const box = rowEl.querySelector("[data-reason]"); if (!box) return;
      box.querySelector(".chips").addEventListener("click", (e) => {
        const c = e.target.closest("[data-tag]"); if (!c) return;
        const on = c.getAttribute("aria-pressed") !== "true";
        box.querySelectorAll("[data-tag]").forEach((x) => x.setAttribute("aria-pressed", String(on && x === c)));
      });
      box.querySelector("[data-rtext]").focus();
      box.querySelector("[data-rtext]").addEventListener("keydown", (e) => { if (e.key === "Enter") box.querySelector("[data-rsave]").click(); });
      box.querySelector("[data-rcancel]").addEventListener("click", () => { A.open = null; drawAttendance(); });
      box.querySelector("[data-rsave]").addEventListener("click", async () => {
        const tag = box.querySelector("[data-tag][aria-pressed=true]")?.dataset.tag || null, text = box.querySelector("[data-rtext]").value.trim();
        if (!tag && !text) return toast("사유 칩을 고르거나 직접 적어 주세요");
        if (!(await save(key, "absent", { tag, text }))) return;
        A.open = null; drawAttendance();
      });
    });

    content.querySelectorAll("[data-allin]").forEach((b) => b.addEventListener("click", async () => {
      const kind = b.dataset.allin;
      const people = kind === "meeting" ? meetingPeople(A.sel) : servePeople(A.sel, A.data.services, row.attendance, kind).list.map((x) => x.m);
      const rest = people.filter((m) => !recOf(row, m.id, kind));
      if (!rest.length) return toast("모두 기록했어요");
      const rows = rest.map((m) => ({ meeting_id: row.id, member_id: m.id, kind, status: "present" }));
      const { error } = await sb.from("attendance").upsert(rows);
      if (error) return toast("저장하지 못했습니다");
      row.attendance.push(...rows);
      if (kind === "meeting" && row.meeting_status === "tbd") row.meeting_status = "yes";
      toast(`${rest.length}명을 출석으로 기록했어요`);
      drawAttendance();
    }));
  }

  // ---------------------------------------------------------------- 출석 통계
  async function renderAttStats() {
    const today = todayISO();
    const lastSat = lastSaturday(today);
    const n = A.srange, kind = A.skind;
    const weeks = Array.from({ length: n }, (_, i) => addDays(lastSat, -7 * (n - 1 - i)));
    const prevWeeks = weeks.map((d) => addDays(d, -7 * n));
    const act = await loadActivity(prevWeeks[0]);
    const mt = (d) => act.meetings.find((x) => x.meeting_date === d);
    const counted = (ws) => ws.filter((d) => kind === "meeting" ? mt(d)?.meeting_status === "yes" : !(kind === "practice" && mt(d)?.practice_cancelled));
    const recsIn = (ws) => counted(ws).flatMap((d) => (mt(d)?.attendance || []).filter((r) => r.kind === kind).map((r) => ({ ...r, d })));
    const cur = recsIn(weeks), prev = recsIn(prevWeeks);
    const rate = (rs) => rs.length ? Math.round(100 * rs.filter((r) => r.status !== "absent").length / rs.length) : null;
    const r1 = rate(cur), r0 = rate(prev);
    const lates = cur.filter((r) => r.status === "late"), abs = cur.filter((r) => r.status === "absent");
    const ppl = (rs) => new Set(rs.map((r) => r.member_id)).size;
    const streaks = S.members.filter((m) => m.is_active).map((m) => ({ m, ...absenceStreak(m, act.meetings, today) })).filter((x) => x.n >= STREAK_LIMIT);
    const label = ACT_KINDS[kind];
    const dayOf = (d) => kind === "rehearsal" ? addDays(d, 1) : d;

    // 주별 쌓은 막대 (SVG)
    const cw = counted(weeks);
    const per = cw.map((d) => {
      const rs = (mt(d)?.attendance || []).filter((r) => r.kind === kind);
      return { d, p: rs.filter((r) => r.status === "present").length, l: rs.filter((r) => r.status === "late").length, a: rs.filter((r) => r.status === "absent").length, rs };
    });
    const maxV = Math.max(5, ...per.map((x) => x.p + x.l + x.a));
    const top = Math.ceil(maxV / 5) * 5;
    const W = 640, H = 240, x0 = 36, y0 = 200, plotH = 180;
    const step = per.length ? (W - x0 - 10) / per.length : 0, bw = Math.min(40, step * 0.62);
    const yv = (v) => y0 - (v / top) * plotH;
    const C = { p: "#2E9E6E", l: "#D9A066", a: "#C2413A" };
    const bars = per.map((w, i) => {
      const x = x0 + step * i + (step - bw) / 2;
      let acc = 0;
      const segs = [["p", w.p], ["l", w.l], ["a", w.a]].filter(([, v]) => v).map(([k, v]) => {
        const yTop = yv(acc + v), yBot = yv(acc); acc += v;
        return `<rect x="${x.toFixed(1)}" y="${(yTop + 1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, yBot - yTop - 2).toFixed(1)}" rx="3" fill="${C[k]}"/>`;
      }).join("");
      const lbl = per.length <= 13 || i % 2 === 0 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${y0 + 18}" text-anchor="middle">${md(dayOf(w.d))}</text>` : "";
      return `<g class="wbar" data-i="${i}">${segs}<rect x="${(x0 + step * i).toFixed(1)}" y="${y0 - plotH}" width="${step.toFixed(1)}" height="${plotH}" fill="transparent"/>${lbl}</g>`;
    }).join("");
    const grid = [0, top / 3, (2 * top) / 3, top].map((v) => `<line x1="${x0}" y1="${yv(v)}" x2="${W - 6}" y2="${yv(v)}"/><text x="${x0 - 8}" y="${yv(v) + 4}" text-anchor="end">${Math.round(v)}</text>`).join("");

    // 결석 사유
    const tagCount = [...REASON_TAGS, "기타"].map((t) => ({ t, n: abs.filter((r) => (r.reason_tag || "기타") === t).length }));
    const maxT = Math.max(1, ...tagCount.map((x) => x.n));

    // 사람별 표
    const people = kind === "meeting" ? S.members.filter((m) => m.is_active)
      : S.members.filter((m) => cur.some((r) => r.member_id === m.id) || cw.some((d) => servedList(act.services, m.id).some((s) => s.date === addDays(d, 1))));
    const rowsP = people.map((m) => {
      const cells = weeks.map((d) => {
        const row = mt(d);
        if (!row) return { c: "o", t: `${md(dayOf(d))} 기록 없음` };
        if (kind === "meeting" && row.meeting_status === "no") return { c: "o", t: `${md(d)} 팀모임 없음` };
        if (kind === "practice" && row.practice_cancelled) return { c: "o", t: `${md(d)} 토요 연습 취소` };
        const r = recOf(row, m.id, kind);
        if (!r) return { c: kind !== "meeting" && !servedList(act.services, m.id).some((s) => s.date === addDays(d, 1)) ? "x" : "n", t: `${md(dayOf(d))} 미기록` };
        return { c: r.status[0], t: `${md(dayOf(d))} ${ATT[r.status]}${r.status === "absent" ? " · " + reasonText(r) : ""}` };
      });
      return { m, cells, L: cells.filter((x) => x.c === "l").length, X: cells.filter((x) => x.c === "a").length };
    }).sort((a, b) => b.X - a.X || b.L - a.L || byPos(a.m, b.m));

    $("#content").innerHTML = `
      <div class="page-head"><h1 class="page-title">출석</h1></div>
      ${attTabs()}
      <div class="filters" style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
        <div class="seg" id="sKind">${Object.entries(ACT_KINDS).map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${kind === k}">${l}</button>`).join("")}</div>
        <div class="seg" id="sRange">${[[4, "4주"], [12, "12주"], [26, "6개월"]].map(([k, l]) => `<button type="button" data-r="${k}" aria-pressed="${n === k}">${l}</button>`).join("")}</div>
        <span class="small muted">${md(dayOf(weeks[0]))} – ${md(dayOf(weeks[weeks.length - 1]))} · ${kind === "meeting" ? `팀모임 있었던 ${cw.length}회` : `${cw.length}주`}</span>
      </div>
      <div class="kp4">
        <div class="ktile"><span>${label} 출석률</span><b>${r1 === null ? "–" : r1 + "%"}</b><small>지각 포함${r0 === null ? "" : ` · 직전 ${n}주 ${r0}%`}</small></div>
        <div class="ktile"><span>지각</span><b style="color:${lates.length ? "#9A6418" : "inherit"}">${lates.length}건</b><small>${ppl(lates)}명</small></div>
        <div class="ktile"><span>결석</span><b style="color:${abs.length ? "var(--bad)" : "inherit"}">${abs.length}건</b><small>${ppl(abs)}명</small></div>
        <div class="ktile ${streaks.length ? "bad" : ""}"><span>팀모임 연속 결석 ${STREAK_LIMIT}회 이상</span><b style="color:${streaks.length ? "var(--bad)" : "inherit"}">${streaks.length}명</b><small>${streaks.map((x) => esc(x.m.name)).join(", ") || "없음"}</small></div>
      </div>
      <div class="cols">
        <section class="box" style="position:relative">
          <h2>주별 추이 <span class="lg"><span><i style="background:${C.p}"></i>출석</span><span><i style="background:${C.l}"></i>지각</span><span><i style="background:${C.a}"></i>결석</span></span></h2>
          ${per.length ? `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="주별 ${label} 출석·지각·결석 인원" id="wChart">
            <g stroke="#EDE3FA" stroke-width="1" font-size="13" fill="#675C7E">${grid}</g>
            <g font-size="13" fill="#675C7E">${bars}</g></svg>
            <div class="tip hidden" id="wTip"></div>` : `<div class="empty">이 기간에 ${kind === "meeting" ? "있었던 팀모임이" : "기록이"} 없어요.</div>`}
          <details class="small"><summary style="cursor:pointer;color:var(--violet);font-weight:700">표로 보기</summary>
            <table class="att-table" style="width:100%;margin-top:8px"><thead><tr><th>날짜</th><th>출석</th><th>지각</th><th>결석</th></tr></thead>
            <tbody>${per.map((w) => `<tr><td>${md(dayOf(w.d))}</td><td>${w.p}</td><td>${w.l}</td><td>${w.a}</td></tr>`).join("")}</tbody></table></details>
        </section>
        <section class="box">
          <h2>결석 사유 <span class="small muted" style="font-weight:600">${abs.length}건</span></h2>
          <div style="display:flex;flex-direction:column;gap:10px">${tagCount.map(({ t, n: c }) => `<div class="pbar" style="grid-template-columns:96px minmax(0,1fr) 28px">
            <span>${t}</span><span class="track" style="height:14px;background:none"><span class="fill" style="display:block;height:14px;border-radius:4px;width:${c ? Math.max(3, Math.round(100 * c / maxT)) : 1}%;background:${c ? "#8654CB" : "#C9B2EC"}"></span></span><b>${c}</b></div>`).join("")}</div>
          <span class="small muted">'기타' = 칩 없이 직접 적은 사유</span>
        </section>
      </div>
      <section class="box">
        <h2>사람별 ${n}주 <span class="lg"><span><i style="background:#CFEBDD"></i>출석</span><span><i style="background:${C.l}"></i>지각</span><span><i style="background:${C.a}"></i>결석</span><span><i style="background:#F4F1F8"></i>${kind === "meeting" ? "팀모임 없음" : "섬김 없음"}</span><span><i style="background:#fff;border:1px dashed #C3BACF"></i>미기록</span></span></h2>
        <div style="overflow-x:auto"><div class="heat" style="grid-template-columns:110px repeat(${weeks.length}, minmax(${n > 12 ? 14 : 22}px, 1fr)) 40px 40px;min-width:${110 + weeks.length * (n > 12 ? 16 : 26) + 90}px">
          <span></span>${weeks.map((d, i) => `<span class="h">${n <= 12 || i % 2 === 0 ? md(dayOf(d)) : ""}</span>`).join("")}<span class="h">지각</span><span class="h">결석</span>
          ${rowsP.map(({ m, cells, L, X }) => `<a class="n" href="#member/${m.id}">${esc(m.name)}</a>${cells.map((x) => `<span class="c ${x.c}" title="${esc(x.t)}"></span>`).join("")}
            <span class="t" style="color:#9A6418">${L}</span><span class="t" style="color:var(--bad)">${X}</span>`).join("") || `<span class="small muted" style="grid-column:1/-1">기록이 없어요</span>`}
        </div></div>
        <span class="small muted">칸에 마우스를 올리면 날짜와 결석 사유가 보여요 · 이름을 누르면 멤버 상세로 가요 · 결석 많은 순</span>
      </section>`;

    bindAttTabs();
    $("#sKind").onclick = (e) => { const b = e.target.closest("button"); if (b) { A.skind = b.dataset.k; renderAttStats(); } };
    $("#sRange").onclick = (e) => { const b = e.target.closest("button"); if (b) { A.srange = +b.dataset.r; renderAttStats(); } };
    const tip = $("#wTip"), chart = $("#wChart");
    chart?.querySelectorAll(".wbar").forEach((g) => {
      g.addEventListener("mouseenter", () => {
        const w = per[+g.dataset.i];
        const absNames = w.rs.filter((r) => r.status === "absent").map((r) => `${esc(memberName(r.member_id))} ${esc(reasonText(r))}`);
        tip.innerHTML = `<b>${md(dayOf(w.d))} ${label}</b><br>출석 ${w.p} · 지각 ${w.l} · 결석 ${w.a}${absNames.length ? `<br>결석: ${absNames.join(", ")}` : ""}`;
        const box = chart.getBoundingClientRect(), gb = g.getBoundingClientRect(), host = chart.parentElement.getBoundingClientRect();
        tip.classList.remove("hidden");
        tip.style.left = Math.min(gb.left - host.left + gb.width / 2 - 20, host.width - tip.offsetWidth - 8) + "px";
        tip.style.top = (box.top - host.top + 20) + "px";
      });
      g.addEventListener("mouseleave", () => tip.classList.add("hidden"));
    });
  }

  // ================================================================ 대시보드 (2×2)
  async function renderDashboard() {
    if (!$("#content").children.length) $("#content").innerHTML = `<div class="page-head"><h1 class="page-title">대시보드</h1></div><div class="empty">불러오는 중…</div>`;
    const today = todayISO();
    const thisSat = upcomingSaturday(today), lastSat = lastSaturday(today);
    const suns = [...new Set([addDays(lastSat, 1), addDays(thisSat, 1), addDays(thisSat, 8)])].filter((s) => s >= today);
    const since = addDays(lastSat, -7 * 15);
    await ensureSaturdays([...new Set([lastSat, thisSat])]);
    const [tm, sv, mo, msv] = await Promise.all([
      sb.from("team_meetings").select("*, attendance(*)").gte("meeting_date", since).lte("meeting_date", thisSat).order("meeting_date"),
      sb.from("services").select("*, assignments(*)").is("ministry_id", null).in("service_date", [...new Set([...suns, addDays(lastSat, 1)])]),
      sb.from("availability_months").select("*").gte("month", monthOf(today)).order("month"),
      sb.from("services").select("service_date, status, ministry_id, assignments(id), ministries(id, name, practice_mode, poll_open, poll_deadline, ministry_practices(id))")
        .not("ministry_id", "is", null).gte("service_date", today).lte("service_date", addDays(today, 30)).order("service_date"),
    ]);
    if (tm.error) console.error(tm.error);
    const meetings = tm.data || [], services = sv.data || [], months = mo.data || [];
    const mtOf = (d) => meetings.find((x) => x.meeting_date === d) || { meeting_status: "tbd", attendance: [] };
    const openMonths = months.filter((m) => m.is_open);
    const resp = await Promise.all(openMonths.map(async (m) => {
      const slots = slotsOfMonth(m.month);
      const { data } = await sb.from("availability").select("member_id, date, kind").gte("date", slots[0].date).lte("date", slots[slots.length - 1].date);
      const people = servingMembers();
      const cnt = (mm) => (data || []).filter((a) => a.member_id === mm.id).length;
      return { m, total: people.length, done: people.filter((p) => cnt(p) >= slots.length), partial: people.filter((p) => cnt(p) > 0 && cnt(p) < slots.length), none: people.filter((p) => cnt(p) === 0) };
    }));

    // ---------- 할 일: 남은 것만, 완료는 숨김 ----------
    const todos = [], done = [];
    const item = (tone, text, sub, href, attrs = "") => `<a href="${href}" ${attrs}><i class="ic ${tone}"></i><span>${text}</span><small>${sub || ""}</small><span class="go">›</span></a>`;
    const ts = mtOf(thisSat);
    if (ts.meeting_status === "tbd") todos.push(item("", `${md(thisSat)} 팀모임 여부 정하기`, "미정", "#attendance", `data-sat="${thisSat}"`));
    else done.push(`${md(thisSat)} 팀모임 ${MEETING[ts.meeting_status]}`);
    const POS = window.__allPositions || [];
    const missRole = [];
    suns.forEach((sun) => {
      const s = services.find((x) => x.service_date === sun), list = (s?.assignments || []).filter((a) => a.member_id || a.guest_id);
      const at = `data-lmonth="${monthOf(sun)}"`;
      if (!list.length) return todos.push(item("", `${md(sun)} 주일 배치표 비어 있음`, "배치하기", "#lineup", at));
      if (s.status !== "published") return todos.push(item("", `${md(sun)} 주일 배치표 아직 공개 전`, `${list.length}명 · 비공개`, "#lineup", at));
      const kinds = list.map((x) => POS.find((p) => p.code === x.position_code)?.kind);
      const miss = [kinds.includes("vocal") && !list.some((x) => x.is_singer_leader) && "싱어 리더", kinds.includes("band") && !list.some((x) => x.is_band_master) && "밴드 마스터"].filter(Boolean);
      if (miss.length) missRole.push({ sun, miss });
      else done.push(`${md(sun)} 배치표 공개`);
    });
    if (missRole.length) {
      const same = missRole.every((x) => x.miss.join() === missRole[0].miss.join());
      todos.push(same ? item("mid", `${missRole.map((x) => md(x.sun)).join(" · ")} ${missRole[0].miss.join(", ")} 미지정`, "공개됨", "#lineup", `data-lmonth="${monthOf(missRole[0].sun)}"`)
        : missRole.map((x) => item("mid", `${md(x.sun)} ${x.miss.join(", ")} 미지정`, "공개됨", "#lineup", `data-lmonth="${monthOf(x.sun)}"`)).join(""));
    }
    {
      const r = mtOf(lastSat);
      const p = servePeople(lastSat, services, r.attendance).list.length;
      const c = (k) => r.attendance.filter((x) => x.kind === k).length;
      const mtot = meetingPeople(lastSat).length;
      const gaps = [!r.practice_cancelled && p > c("practice") && `연습 ${c("practice")}/${p}`, r.meeting_status === "yes" && mtot > c("meeting") && `모임 ${c("meeting")}/${mtot}`,
        addDays(lastSat, 1) <= today && p > c("rehearsal") && `리허설 ${c("rehearsal")}/${p}`, r.meeting_status === "tbd" && "팀모임 여부 미정"].filter(Boolean);
      if (gaps.length) todos.push(item("", `${md(lastSat)} 출석 기록 마저 하기`, gaps.join(" · "), "#attendance", `data-sat="${lastSat}"`));
      else done.push(`${md(lastSat)} 출석 기록`);
    }
    // 사역: 30일 안에 있는 것
    const minis = [...new Map((msv.data || []).filter((s) => s.ministries).map((s) => [s.ministry_id, { ...s.ministries, first: s.service_date }])).values()];
    minis.forEach((mi) => {
      const its = (msv.data || []).filter((s) => s.ministry_id === mi.id);
      const href = `#ministry/${mi.id}`;
      if (!mi.ministry_practices.length) {
        if (mi.poll_open && mi.poll_deadline && mi.poll_deadline < today) todos.push(item("mid", `${esc(mi.name)} 연습 시간 확정하기`, "취합 마감일 지남", href));
        else if (!mi.poll_open) todos.push(item("", `${esc(mi.name)} 연습 일정 정하기`, `${md(mi.first)} 섬김`, href));
      }
      if (mi.first <= addDays(today, 14) && its.some((s) => s.status !== "published")) todos.push(item("", `${esc(mi.name)} 배치 ${its.some((s) => s.assignments.length) ? "공개 전" : "비어 있음"}`, `${md(mi.first)}`, "#lineup", `data-lmonth="${monthOf(mi.first)}" data-lview="${its.length > 1 ? mi.id : "month"}"`));
    });
    const pend = S.apps.filter((a) => cardTodo(a).pending).length;
    if (pend) todos.push(item("", `모집·수습 안내 ${pend}건`, "", "#pipeline"));
    const nextM = addMonths(monthOf(today), 1);
    if (+today.slice(8) >= 15 && !months.some((m) => m.month === nextM))
      todos.push(item("", `${monthLabel(nextM)} 섬김 응답 열기`, "아직 안 열었어요", "#respond", `data-rmonth="${nextM}"`));
    openMonths.filter((m) => m.deadline && m.deadline < today).forEach((m) =>
      todos.push(item("mid", `${monthLabel(m.month)} 섬김 응답 마감일 지남`, "마감하기", "#respond", `data-rmonth="${m.month}"`)));
    const todoN = todos.join("").split('class="ic').length - 1;

    // ---------- 섬김 응답 ----------
    const r0 = resp[0];
    const respBox = r0 ? `
      <div class="head-num"><b>${r0.done.length}</b><span class="muted">/ ${r0.total}명 완료${r0.m.deadline ? ` · ${fmtDate(r0.m.deadline, { month: "long", day: "numeric", weekday: "short" })} 마감 · ${dday(r0.m.deadline)}` : ""}</span></div>
      <div style="height:10px;border-radius:999px;background:var(--tint-2);overflow:hidden" role="img" aria-label="응답 완료 ${r0.done.length}/${r0.total}"><div style="width:${r0.total ? Math.round(100 * r0.done.length / r0.total) : 0}%;height:10px;background:var(--violet)"></div></div>
      <div class="plist"><div><span>미응답</span><b style="text-align:right">${r0.none.map((p) => esc(p.name)).join(", ") || "없음"}</b></div>
        <div><span>응답 중</span><b style="text-align:right">${r0.partial.map((p) => esc(p.name)).join(", ") || "없음"}</b></div></div>
      ${r0.none.length + r0.partial.length ? `<button type="button" class="btn btn-soft btn-sm" data-nudge="${r0.m.month}" style="align-self:flex-start">독촉 보내기</button>` : `<span class="small" style="color:var(--ok);font-weight:700">모두 응답했어요</span>`}
      ${resp.length > 1 ? `<span class="small muted">${resp.slice(1).map((x) => `${monthLabel(x.m.month)} 응답도 받는 중 (${x.done.length}/${x.total})`).join(" · ")}</span>` : ""}`
      : `<div class="head-num"><b class="muted">–</b><span class="muted">지금 응답 받는 달이 없어요</span></div>`;

    // ---------- 출석 ----------
    const past = meetings.filter((x) => x.meeting_date <= today);
    const held = past.filter((x) => x.meeting_status === "yes").slice(-7);
    const rec = held.flatMap((x) => x.attendance.filter((a) => a.kind === "meeting"));
    const rate = rec.length ? Math.round(100 * rec.filter((a) => a.status !== "absent").length / rec.length) : null;
    const people = S.members.filter((m) => m.is_active);
    const streaks = people.map((m) => ({ m, ...absenceStreak(m, meetings, today) })).filter((x) => x.n >= STREAK_LIMIT).sort((a, b) => b.n - a.n);
    const lateFrom = addDays(lastSat, -7 * (LATE_WEEKS - 1));
    const lates = people.map((m) => ({ m, n: past.filter((x) => x.meeting_date >= lateFrom).flatMap((x) => ["practice", "rehearsal"].map((k) => recOf(x, m.id, k))).filter((r) => r?.status === "late").length }))
      .filter((x) => x.n > 0).sort((a, b) => b.n - a.n || byPos(a.m, b.m));

    // ---------- 팀 구성 ----------
    const act = S.members.filter((m) => m.is_active && m.status === "active");
    const trainees = S.members.filter((m) => m.is_active && m.status === "trainee");
    const dormant = S.members.filter((m) => !m.is_active).length;

    $("#content").innerHTML = `
      <div class="page-head"><h1 class="page-title">대시보드</h1><span class="small muted">${fmtDate(today, { month: "long", day: "numeric", weekday: "long" })}</span></div>
      <div class="grid22">
        <section class="box" aria-label="이번 주 할 일"><h2>이번 주 할 일</h2>
          <div class="head-num"><b style="color:${todoN ? "var(--warn)" : "var(--ok)"}">${todoN}</b><span class="muted">${todoN ? "건 남음" : "남은 일 없음"}${done.length ? ` · 완료 ${done.length}건 숨김` : ""}</span>
            ${done.length ? `<button type="button" class="btn btn-ghost btn-sm" id="showDone" style="margin-left:auto">완료 보기</button>` : ""}</div>
          <div class="todo2">${todos.join("") || `<span class="small muted">이번 주 할 일을 모두 마쳤어요</span>`}</div>
          <div class="done-line hidden" id="doneLine">${done.map((x) => `<span>${esc(x)}</span>`).join("")}</div>
        </section>
        <section class="box" aria-label="섬김 응답"><h2>${r0 ? monthLabel(r0.m.month) + " " : ""}섬김 응답 <a href="#respond" ${r0 ? `data-rmonth="${r0.m.month}"` : ""}>응답 현황</a></h2>${respBox}</section>
        <section class="box" aria-label="출석"><h2>출석 <a href="#attendance" data-stats>통계 보기</a></h2>
          <a href="#attendance" data-stats class="head-num" style="text-decoration:none;color:inherit"><b>${rate === null ? "–" : rate + "%"}</b><span class="muted">팀모임 출석률 · 최근 ${held.length}회</span></a>
          ${ts.meeting_status === "yes" && preN(ts) ? `<a href="#attendance" data-sat="${thisSat}" class="prebox"><b>${md(thisSat)} 팀모임 불참 미리 알림 ${preN(ts)}명</b>
            <span class="small">${preList(ts).map((r) => `${esc(memberName(r.member_id))}${reasonText(r) ? ` <span class="muted">(${esc(reasonText(r))})</span>` : ""}`).join(", ")}</span></a>` : ""}
          <div class="plist">
            ${streaks.map((x) => `<div><a href="#member/${x.m.id}" style="color:inherit;text-decoration:none"><b>${esc(x.m.name)}</b> <span class="muted small">${esc(positionName(x.m.main_position))}</span></a>
              <span class="chip chip-bad">모임 ${x.n}회 연속 결석${x.lastReason ? " · " + esc(x.lastReason) : ""}</span></div>`).join("")}
            ${lates.map((x) => `<div><a href="#member/${x.m.id}" style="color:inherit;text-decoration:none"><b>${esc(x.m.name)}</b> <span class="muted small">${esc(positionName(x.m.main_position))}</span></a>
              <span class="chip chip-mid">지각 ${x.n} / ${LATE_WEEKS}주</span></div>`).join("")}
            ${!streaks.length && !lates.length ? `<div><span class="small muted">팀모임 연속 결석 ${STREAK_LIMIT}회 이상·최근 ${LATE_WEEKS}주 지각 없음</span></div>` : ""}
          </div></section>
        <section class="box" aria-label="팀 구성"><h2>팀 구성 <a href="#members">멤버</a></h2>
          <div class="head-num"><b>${act.length}</b><span class="muted">정식 · 수습 ${trainees.length} · 휴면 ${dormant}${S.guests.length ? ` · 객원 ${S.guests.length}` : ""}</span></div>
          <div class="mini-bars">${POS.map((p) => {
            const n = act.filter((m) => m.main_position === p.code).length;
            const multi = S.extras.filter((e) => e.position_code === p.code && act.some((m) => m.id === e.member_id)).length;
            return `<div title="${esc(p.name)} 주 포지션 ${n}명${multi ? ` · 멀티 ${multi}명` : ""}"><b>${n}${multi ? `<span class="small muted" style="font-weight:600">+${multi}</span>` : ""}</b>${POS_SHORT[p.code] || esc(p.name)}</div>`;
          }).join("")}</div>
          <span class="small muted">숫자 = 주 포지션 인원 · +는 멀티 포지션</span>
          ${(() => { const bs = S.members.filter((m) => m.is_active && m.birth_date).map((m) => ({ m, ...nextBirthday(m.birth_date, today) })).filter((x) => x.days <= 14).sort((a, b) => a.days - b.days);
            return bs.length ? `<div class="bdays"><b class="small">다가오는 생일 · 2주</b>${bs.map((x) => `<a href="#member/${x.m.id}"><span class="chip chip-bday">${x.days ? "D-" + x.days : "오늘"}</span><b>${esc(x.m.name)}</b><span class="small muted">${md(x.date)} (${["주일", "월", "화", "수", "목", "금", "토"][dowOf(x.date)]})</span>
              <span class="small ${x.m.gift_join ? "" : "muted"}" style="margin-left:auto">${x.m.gift_join === true ? "선물 대상" : x.m.gift_join === false ? "정산 미참여" : "정산 미정"}</span></a>`).join("")}</div>` : ""; })()}
          ${trainees.length ? `<div class="plist">${trainees.map((m) => {
            const a = S.apps.find((x) => x.user_id === m.id);
            return `<div><a href="#member/${m.id}" style="color:inherit;text-decoration:none"><b>${esc(m.name)}</b> <span class="muted small">${esc(positionName(m.main_position))}</span></a>
              ${a ? `<a class="small" href="#app/${a.id}" style="font-weight:700;text-decoration:none">${traineeLabel(m)}</a>` : ""}</div>`;
          }).join("")}</div>` : ""}
        </section>
      </div>`;

    const c = $("#content");
    $("#showDone")?.addEventListener("click", (e) => { $("#doneLine").classList.toggle("hidden"); e.target.textContent = $("#doneLine").classList.contains("hidden") ? "완료 보기" : "완료 숨기기"; });
    c.querySelectorAll("[data-sat]").forEach((a) => a.addEventListener("click", () => { A.tab = "week"; A.sel = a.dataset.sat; A.month = monthOf(a.dataset.sat); }));
    c.querySelectorAll("[data-stats]").forEach((a) => a.addEventListener("click", () => { A.tab = "stats"; }));
    c.querySelectorAll("[data-lmonth]").forEach((a) => a.addEventListener("click", () => { V.lineupMonth = a.dataset.lmonth; V.view = a.dataset.lview || "month"; }));
    c.querySelectorAll("[data-rmonth]").forEach((a) => a.addEventListener("click", () => { V.month = a.dataset.rmonth; }));
    c.querySelectorAll("[data-nudge]").forEach((b) => b.addEventListener("click", () => {
      const r = resp.find((x) => x.m.month === b.dataset.nudge);
      const what = `${monthLabel(r.m.month)} 섬김 응답`;
      openSend({ title: "독촉 보내기", ctx: `nudge:${r.m.month}`, label: `${what} 독촉`, url: `/me.html#respond/month:${r.m.month}`,
        groups: [{ id: "resp", label: "미응답", people: [...r.none, ...r.partial] }],
        push: () => ({ title: `${what}이 아직 남아 있어요`, body: `${dlText(r.m.deadline)} 체크 부탁드려요!`.trim() }),
        text: (sel, names) => `[찬양팀] ${namesNim(names)}\n${what}이 아직 남아 있어요.${r.m.deadline ? " " + dlText(r.m.deadline) : ""} 체크 부탁드려요!\n\n${location.origin}/me.html#respond` });
    }));
  }

  // ================================================================ 섬김 일정 (한 달: 토요 연습 · 주일 · 사역)
  const SC = { month: null };
  const REC_LABEL = { skill: ["실력 균형", "주마다 숙련도 평균을 비슷하게 (싱어끼리 · 밴드끼리)"], balance: ["골고루", "섬김 횟수(주일+사역)가 적은 사람 먼저"],
    consecutive: ["연속 감점", "2주 연속은 작게, 3주 이상은 크게 감점 (같은 주말 주일+사역은 한 번)"], gender: ["성비", "인도자+싱어 남녀가 되도록 반반 (최소 1명씩은 순서와 상관없이 지켜요)"] };

  async function renderSchedule() {
    if (!SC.month) SC.month = defaultMonth();
    const month = SC.month, next = addMonths(month, 1);
    const sundays = sundaysOf(month), sats = sundays.map((d) => addDays(d, -1));
    await ensureSaturdays(sats);
    const [tm, sv, ms, mo] = await Promise.all([
      sb.from("team_meetings").select("id, meeting_date, practice_start, practice_end, practice_cancelled").in("meeting_date", sats),
      sb.from("services").select("id, service_date, start_time, end_time, status").is("ministry_id", null).in("service_date", sundays),
      sb.from("services").select("ministry_id").not("ministry_id", "is", null).gte("service_date", month).lt("service_date", next),
      sb.from("availability_months").select("*").eq("month", month).maybeSingle(),
    ]);
    if (ms.error) { $("#content").innerHTML = `<div class="empty">섬김 일정을 불러오지 못했어요. migration_010을 실행했는지 확인해 주세요.</div>`; return console.error(ms.error); }
    // 023: 토요 연습 시간 변경 투표
    const { data: votes } = await sb.rpc("practice_vote_board", { p_dates: sats });
    const voteOf = (d) => (votes || []).find((v) => v.date === d);
    const ids = [...new Set((ms.data || []).map((x) => x.ministry_id))];
    const { data: mins } = ids.length ? await sb.from("ministries").select("*, services(id, service_date, label, start_time, end_time, status, sort_order), ministry_practices(*), ministry_poll(member_id)").in("id", ids) : { data: [] };
    const sids = (mins || []).flatMap((m) => m.services.map((s) => s.id));
    const { data: mav } = sids.length ? await sb.from("ministry_availability").select("service_id, member_id, available").in("service_id", sids) : { data: [] };
    const st = S.settings;
    const meet = (d) => (tm.data || []).find((x) => x.meeting_date === d);
    const svcOf = (d) => (sv.data || []).find((x) => x.service_date === d);
    const list = (mins || []).map((m) => {
      const svs = m.services.slice().sort((a, b) => a.service_date.localeCompare(b.service_date) || (a.sort_order - b.sort_order));
      return { ...m, svs, first: svs[0].service_date, last: svs[svs.length - 1].service_date };
    }).sort((a, b) => a.first.localeCompare(b.first));
    const availN = (m) => new Set((mav || []).filter((a) => a.available && m.svs.some((s) => s.id === a.service_id)).map((a) => a.member_id)).size;
    const respChip = (m) => m.response_mode === "monthly" ? `<span class="chip chip-gray">${monthLabel(monthOf(m.first))} 월말 응답</span>`
      : m.response_open ? `<span class="chip chip-solid">따로 받기${m.response_deadline ? " · " + md(m.response_deadline) + "까지" : ""}</span>` : `<span class="chip chip-gray">따로 받기 · 마감</span>`;
    const pracChip = (m) => {
      const pr = m.ministry_practices.slice().sort((a, b) => a.practice_date.localeCompare(b.practice_date));
      if (pr.length) return `<span class="chip chip-ok">${mdw(pr[0].practice_date)} ${hm(pr[0].start_time)} 확정${pr.length > 1 ? ` 외 ${pr.length - 1}` : ""}</span>`;
      if (m.practice_mode === "poll" && m.poll_open) return `<span class="chip chip-warn">가능 시간 취합 중 · ${m.ministry_poll.length}/${availN(m)}</span>`;
      return `<span class="chip chip-gray">연습 미정</span>`;
    };
    const voteChip = (d, mt) => {
      const v = voteOf(d);
      if (!v) return mt?.practice_cancelled ? `<span class="chip chip-bad">연습 취소</span>` : `<span class="small muted">—</span>`;
      if (v.state === "voting") return `<button type="button" class="chip chip-warn chipbtn" data-vote="${d}">${v.ended ? "투표 마감 · 결정 필요" : "투표 중"} · 가능 ${v.yes.length} · 불가 ${v.no.length}${v.pending.length ? ` · 미응답 ${v.pending.length}` : ""}</button>`;
      const t = { confirmed: ["chip-ok", "바꾼 시간 확정"], reverted: ["chip-gray", "원래 시간으로"], cancelled: ["chip-bad", "연습 취소"] }[v.state];
      return `<button type="button" class="chip ${t[0]} chipbtn" data-vote="${d}">${t[1]}${v.poll_id ? ` · 가능 ${v.yes.length} · 불가 ${v.no.length}` : ""}</button>`;
    };
    const timeBtn = (kind, d, [a, b], edited) => `<button type="button" class="tm ${edited ? "edited" : ""}" data-time="${kind}" data-d="${d}" title="눌러서 이날 시간 바꾸기">${hm(a)} – ${hm(b)}${edited ? ` <u>수정됨</u>` : ""}</button>`;
    const minRow = (m) => `<tr class="mrowx"><td>${m.first === m.last ? mdw(m.first) : `${md(m.first)} – ${md(m.last)}`}</td>
      <td><span class="kind"><i class="dot m"></i>${esc(m.name)}</span> <span class="chip chip-violet">사역${m.svs.length > 1 ? ` · 예배 ${m.svs.length}` : ""}</span></td>
      <td>${m.svs.length === 1 && m.svs[0].start_time ? `<b>${timeRange(m.svs[0].start_time, m.svs[0].end_time)}</b>` : `<span class="small muted">예배별 시간</span>`}</td>
      <td>${respChip(m)}</td><td>${pracChip(m)}</td><td><a class="btn btn-ghost btn-sm" href="#ministry/${m.id}">열기</a></td></tr>`;
    const used = new Set();
    const weeks = sundays.map((sun) => {
      const sat = addDays(sun, -1), mt = meet(sat), sv1 = svcOf(sun);
      const these = list.filter((m) => !used.has(m.id) && m.first > addDays(sun, -7) && m.first <= sun);
      these.forEach((m) => used.add(m.id));
      return `<tr class="wk"><td colspan="6">${fmtDate(sun, { month: "long", day: "numeric" })} 주일 주간</td></tr>
        <tr><td>${mdw(sat)}</td><td><span class="kind"><i class="dot"></i>토요 연습</span></td><td>${mt?.practice_cancelled
            ? `<button type="button" class="tm edited" data-time="sat" data-d="${sat}" title="눌러서 바꾸기">연습 없음 <u>당일 리허설</u></button>` : timeBtn("sat", sat, satTime(mt, st), !!mt?.practice_start)}</td>
          <td><span class="chip chip-gray">${monthLabel(month)} 월말 응답</span></td><td>${voteChip(sat, mt)}</td><td></td></tr>
        ${these.filter((m) => m.first < sun).map(minRow).join("")}
        <tr><td>${mdw(sun)}</td><td><span class="kind"><i class="dot"></i>주일 섬김</span></td><td>${timeBtn("sun", sun, sunTime(sv1, st), !!sv1?.start_time)}</td>
          <td><span class="chip chip-gray">${monthLabel(month)} 월말 응답</span></td><td class="small muted">${md(sat)} 토요 연습</td><td></td></tr>
        ${these.filter((m) => m.first >= sun).map(minRow).join("")}`;
    }).join("");
    const rest = list.filter((m) => !used.has(m.id));
    const pollingN = list.filter((m) => !m.ministry_practices.length).length;
    const openN = (mo.data?.is_open ? 1 : 0) + list.filter((m) => m.response_mode === "separate" && m.response_open).length;

    $("#content").innerHTML = `
      <div class="page-head">${monthNav("섬김 일정", month)}
        <div class="row"><button type="button" class="btn btn-ghost" id="scDefaults">기본 시간 설정</button><button type="button" class="btn btn-primary" id="scAdd">+ 사역 추가</button></div></div>
      <p class="lead">토요 연습·주일은 매달 자동으로 생겨요. 시간을 누르면 그날만 바꿀 수 있고, 바꾼 시간은 보라색으로 보여요.</p>
      <div class="kp4">
        <div class="ktile"><span>주일 섬김</span><b>${sundays.length}회</b><small>토요 연습 ${sats.length}회 · 기본 ${hm(st.sunday_start)}–${hm(st.sunday_end)}</small></div>
        <div class="ktile"><span>추가 사역</span><b>${list.length}건</b><small>${list.map((m) => esc(m.name)).join(" · ") || "없음"}</small></div>
        <div class="ktile"><span>응답 받는 중</span><b>${openN}건</b><small>${[mo.data?.is_open && `${monthLabel(month)} 월말 응답`, ...list.filter((m) => m.response_mode === "separate" && m.response_open).map((m) => esc(m.name))].filter(Boolean).join(" · ") || "없음"}</small></div>
        <div class="ktile"><span>연습 일정 미정</span><b style="color:${pollingN ? "var(--warn)" : "inherit"}">${pollingN}건</b><small>${list.filter((m) => !m.ministry_practices.length).map((m) => esc(m.name)).join(" · ") || "모두 정해짐"}</small></div>
      </div>
      <section class="box" style="padding:0;overflow:hidden"><div style="overflow-x:auto">
        <table class="sched"><thead><tr><th style="width:120px">날짜</th><th>일정</th><th style="width:190px">시간</th><th style="width:200px">응답</th><th style="width:200px">연습</th><th style="width:70px"></th></tr></thead>
          <tbody>${weeks}${rest.length ? `<tr class="wk"><td colspan="6">그 외</td></tr>${rest.map(minRow).join("")}` : ""}</tbody></table></div></section>`;

    bindMonthNav((n) => { SC.month = addMonths(SC.month, n); renderSchedule(); });
    $("#scAdd").onclick = () => openMinistryEdit(null);
    $("#scDefaults").onclick = () => openDefaultTimes(() => renderSchedule());
    $$("[data-time]").forEach((b) => b.addEventListener("click", () => {
      const d = b.dataset.d, sat = b.dataset.time === "sat";
      if (sat) return openSatTime(d, { mt: meet(d), vote: voteOf(d), svc: svcOf(addDays(d, 1)), after: renderSchedule });
      const cur = sunTime(svcOf(d), st);
      modal({
        step: "주일 섬김 시간", title: `${mdw(d)} 주일 섬김`,
        body: `<div class="row"><label class="field">시작<input type="time" id="tA" value="${hm(cur[0])}" step="600"></label><label class="field">끝<input type="time" id="tB" value="${hm(cur[1])}" step="600"></label></div>
          <p class="small muted" style="margin:0">이날만 바뀌어요. 기본 시간: ${hm(st.sunday_start)}–${hm(st.sunday_end)}</p>
          <button type="button" class="btn btn-ghost btn-sm" id="tReset" style="align-self:flex-start">기본 시간으로 되돌리기</button>`,
        confirmLabel: "저장",
        onConfirm: async (close) => {
          const a = $("#tA").value, z = $("#tB").value;
          if (!a || !z || z <= a) throw new Error("끝나는 시간이 시작보다 늦어야 해요.");
          await setDayTime(false, d, a, z); close(); toast("시간을 바꿨어요"); renderSchedule();
        },
      });
      $("#tReset").onclick = async () => { await setDayTime(false, d, null, null); curClose?.(); toast("기본 시간으로 되돌렸어요"); renderSchedule(); };
    }));
    $$("[data-vote]").forEach((b) => b.addEventListener("click", () => openSatDecision(b.dataset.vote, { mt: meet(b.dataset.vote), vote: voteOf(b.dataset.vote), svc: svcOf(addDays(b.dataset.vote, 1)), after: renderSchedule })));
    async function setDayTime(sat, d, a, z) {
      if (sat) {
        const { error } = await sb.from("team_meetings").update({ practice_start: a, practice_end: z }).eq("meeting_date", d);
        if (error) throw new Error("저장하지 못했습니다");
      } else {
        let s = svcOf(d);
        if (!s && a) ({ data: s } = await sb.from("services").insert({ service_date: d }).select().single());
        if (s) { const { error } = await sb.from("services").update({ start_time: a, end_time: z }).eq("id", s.id); if (error) throw new Error("저장하지 못했습니다"); }
      }
    }
  }

  // ---------------------------------------------------------------- 023: 토요 연습 시간 변경 · 투표 · 취소
  //  대상(자동): 다음 날 주일 배치 인원 → 배치 전이면 월말 응답에서 그 토요일 연습 '가능'인 사람. 고칠 수 있어요
  async function satTargets(d) {
    const sun = addDays(d, 1), act = new Set(S.members.filter((m) => m.is_active).map((m) => m.id));
    const { data: sv } = await sb.from("services").select("id, assignments(member_id)").is("ministry_id", null).eq("service_date", sun).maybeSingle();
    const ids = [...new Set((sv?.assignments || []).map((a) => a.member_id).filter((id) => id && act.has(id)))];
    if (ids.length) return { ids, basis: `${md(sun)} 주일 배치 인원` };
    const { data: av } = await sb.from("availability").select("member_id").eq("date", d).eq("kind", "sat_practice").eq("available", true);
    return { ids: [...new Set((av || []).map((x) => x.member_id))].filter((id) => act.has(id)), basis: `배치 전 · 월말 응답에서 ${md(d)} 토요 연습 '가능'` };
  }
  const localDT = (dt) => { const k = new Date(dt.getTime() - dt.getTimezoneOffset() * 60e3); return k.toISOString().slice(0, 16); };
  const rangeTxt = (a, z) => `${hm(a)}–${hm(z)}`;

  async function openSatTime(d, { mt, vote, after }) {
    const st = S.settings, cur = satTime(mt, st);
    const T = await satTargets(d);
    const pick = new Set(T.ids);
    const others = () => S.members.filter((m) => m.is_active && !pick.has(m.id)).sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const fri = new Date(`${addDays(d, -1)}T22:00:00+09:00`);
    const dl = fri.getTime() > Date.now() + 3600e3 ? fri : new Date(Math.ceil((Date.now() + 2 * 3600e3) / 1800e3) * 1800e3);
    const listHTML = () => [...pick].map((id) => `<button type="button" data-tm="${id}" aria-pressed="true">${esc(memberName(id))} ✕</button>`).join("") || `<span class="small muted">아직 아무도 없어요</span>`;
    modal({
      step: "토요 연습 시간", title: `${mdw(d)} 토요 연습`,
      body: `<div class="row"><label class="field">시작<input type="time" id="tA" value="${hm(cur[0])}" step="600"></label><label class="field">끝<input type="time" id="tB" value="${hm(cur[1])}" step="600"></label></div>
        <p class="small muted" style="margin:0">이날만 바뀌어요. 기본 시간: ${hm(st.sat_practice_start)}–${hm(st.sat_practice_end)}${vote?.state === "voting" ? ` · 지금 '${rangeTxt(vote.new_start, vote.new_end)}'로 묻는 중이에요` : ""}</p>
        ${mt?.practice_cancelled ? `<div class="notice warn" style="margin:0;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span style="flex:1">이 주는 토요 연습이 취소됐어요 (당일 리허설만).</span><button type="button" class="btn btn-ghost btn-sm" id="tRestore">연습 다시 열기</button></div>` : ""}
        <label class="checkrow"><input type="checkbox" id="tAsk"><span><b>대상자에게 가능 여부 묻기</b><small>투표(가능 / 불가)로 보내요 · 결과는 리더십만 봐요 · 불가 사유는 묻지 않아요</small></span></label>
        <div id="tAskBox" class="hidden" style="display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:12px;background:var(--bg)">
          <span class="small"><b id="tAskN">${pick.size}명</b> <span class="muted">· 자동: ${esc(T.basis)} · 누르면 빠져요</span></span>
          <div class="pick-chips" id="tAskList">${listHTML()}</div>
          <select class="select" id="tAskAdd"><option value="">+ 다른 팀원 더하기</option>${others().map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}</select>
          <label class="field">투표 마감<input type="datetime-local" id="tAskDl" class="input" value="${localDT(dl)}"></label>
        </div>
        <div class="row" style="justify-content:space-between"><button type="button" class="btn btn-ghost btn-sm" id="tReset">기본 시간으로 되돌리기</button>
          ${mt?.practice_cancelled ? "" : `<button type="button" class="btn btn-ghost btn-sm" id="tCancel" style="color:var(--bad)">이 주 연습 취소 · 당일 리허설만</button>`}</div>`,
      confirmLabel: "저장",
      onInput: (e) => {
        const ask = $("#tAsk")?.checked;
        $("#tAskBox")?.classList.toggle("hidden", !ask);
        if ($("#mOk")) $("#mOk").textContent = ask ? `저장하고 ${pick.size}명에게 묻기` : "저장";
        const x = e?.target?.closest?.("[data-tm]");
        if (x && e.type === "click") { pick.delete(x.dataset.tm); redraw(); }
        if (e?.target?.id === "tAskAdd" && e.type === "input" && e.target.value) { pick.add(e.target.value); redraw(); }
      },
      onConfirm: async (close) => {
        const a = $("#tA").value, z = $("#tB").value;
        if (!a || !z || z <= a) throw new Error("끝나는 시간이 시작보다 늦어야 해요.");
        if ($("#tAsk").checked) {
          if (!pick.size) throw new Error("물어볼 사람을 골라 주세요.");
          const dlv = $("#tAskDl").value; if (!dlv) throw new Error("투표 마감을 골라 주세요.");
          const r = await api("/api/notify", { kind: "sat_vote", date: d, start: a, end: z, member_ids: [...pick], deadline: new Date(dlv).toISOString() });
          close(); toast(`시간을 바꾸고 ${r.recipients}명에게 물었어요${r.noPushReady ? " · 푸시는 아직 설정 전" : ""}`, 3500);
        } else {
          const { error } = await sb.from("team_meetings").update({ practice_start: a, practice_end: z }).eq("meeting_date", d);
          if (error) throw new Error("저장하지 못했습니다");
          close(); toast("시간을 바꿨어요");
        }
        after?.();
      },
    });
    function redraw() {
      $("#tAskList").innerHTML = listHTML(); $("#tAskN").textContent = `${pick.size}명`;
      $("#tAskAdd").innerHTML = `<option value="">+ 다른 팀원 더하기</option>${others().map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}`;
      if ($("#mOk")) $("#mOk").textContent = `저장하고 ${pick.size}명에게 묻기`;
    }
    $("#tReset").onclick = async () => {
      const { error } = await sb.from("team_meetings").update({ practice_start: null, practice_end: null }).eq("meeting_date", d);
      if (error) return toast("저장하지 못했습니다");
      curClose?.(); toast("기본 시간으로 되돌렸어요"); after?.();
    };
    $("#tCancel")?.addEventListener("click", async () => { curClose?.(); await (popWait || Promise.resolve()); openSatCancel(d, { vote, after }); });
    $("#tRestore")?.addEventListener("click", async () => {
      const { error } = await sb.rpc("decide_practice", { p_date: d, p_decision: "restore" });
      if (error) return toast(error.message || "바꾸지 못했어요", 4000);
      curClose?.(); toast("토요 연습을 다시 열었어요"); after?.();
    });
  }

  async function openSatDecision(d, { mt, vote, after }) {
    if (!vote) return;
    const names = (ids) => ids.map((id) => esc(memberName(id))).sort((a, b) => a.localeCompare(b, "ko")).join(", ") || "—";
    const cancelled = vote.state === "cancelled" || mt?.practice_cancelled;
    const stTxt = { voting: vote.ended ? "투표 마감 · 결정해 주세요" : "투표 중", confirmed: "바꾼 시간으로 확정했어요", reverted: "원래 시간으로 되돌렸어요", cancelled: "연습을 취소했어요 · 당일 리허설만" }[vote.state];
    modal({
      step: "토요 연습 시간 변경", title: `${mdw(d)} 토요 연습`, cancelLabel: "닫기",
      body: `<div style="display:flex;flex-direction:column;gap:4px">
          <span><b>${vote.poll_id ? `${rangeTxt(vote.prev_start || S.settings.sat_practice_start, vote.prev_end || S.settings.sat_practice_end)} → ${rangeTxt(vote.new_start, vote.new_end)}` : "투표 없이 취소"}</b></span>
          <span class="small muted">${stTxt}${vote.poll_id && vote.deadline ? ` · 투표 마감 ${fmtDateTime(vote.deadline)}` : ""}${vote.decided_at ? ` · ${fmtDateTime(vote.decided_at)} 결정` : ""}</span></div>
        ${vote.poll_id ? `<div class="pv-res">
          <div><span class="chip chip-ok">가능 ${vote.yes.length}</span><span class="small">${names(vote.yes)}</span></div>
          <div><span class="chip chip-bad">불가 ${vote.no.length}</span><span class="small">${names(vote.no)}</span></div>
          <div><span class="chip chip-gray">미응답 ${vote.pending.length}</span><span class="small muted">${names(vote.pending)}</span></div></div>
          <p class="small muted" style="margin:0">결과는 리더십만 봐요. '불가'는 월말 응답을 바꾸지 않고, 배치표에 경고로만 보여요 (확정하면 경고 유지, 되돌리거나 취소하면 사라져요).</p>` : ""}
        <div class="row" style="flex-wrap:wrap;gap:8px">
          ${vote.poll_id && vote.state !== "confirmed" ? `<button type="button" class="btn btn-primary btn-sm" data-dec="confirm">바꾼 시간 확정</button>` : ""}
          ${vote.poll_id && vote.state !== "reverted" ? `<button type="button" class="btn btn-ghost btn-sm" data-dec="revert">원래 시간으로 되돌리기</button>` : ""}
          ${cancelled ? `<button type="button" class="btn btn-ghost btn-sm" data-dec="restore">연습 다시 열기</button>` : `<button type="button" class="btn btn-ghost btn-sm" data-dec="cancel" style="color:var(--bad)">연습 취소 · 당일 리허설만</button>`}</div>
        ${vote.poll_id ? `<label class="checkrow"><input type="checkbox" id="dNotify" checked><span><b>결정을 대상자에게 알리기</b><small>투표 대상 ${vote.targets.length}명에게 알림</small></span></label>` : ""}`,
    });
    $("#mBody").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-dec]"); if (!b) return;
      const dec = b.dataset.dec;
      if (dec === "cancel") { curClose?.(); await (popWait || Promise.resolve()); return openSatCancel(d, { vote, after }); }
      b.disabled = true;
      const { error } = await sb.rpc("decide_practice", { p_date: d, p_decision: dec });
      if (error) { b.disabled = false; return toast(error.message || "바꾸지 못했어요", 4000); }
      let msg = { confirm: "바꾼 시간으로 확정했어요", revert: "원래 시간으로 되돌렸어요", restore: "토요 연습을 다시 열었어요" }[dec];
      if ($("#dNotify")?.checked) {
        try { const r = await api("/api/notify", { kind: "sat_decide", date: d, decision: dec }); if (r.recipients) msg += ` · ${r.recipients}명에게 알렸어요`; }
        catch (err) { msg += ` · 알리지 못했어요 (${err.message})`; }
      }
      curClose?.(); toast(msg, 3500); after?.();
    });
  }

  async function openSatCancel(d, { vote, after }) {
    const sun = addDays(d, 1);
    const { data: svc } = await sb.from("services").select("id, start_time, end_time").is("ministry_id", null).eq("service_date", sun).maybeSingle();
    const cur = sunTime(svc, S.settings);
    const T = vote?.poll_id ? { ids: vote.targets, basis: "투표 대상" } : await satTargets(d);
    modal({
      step: "토요 연습 취소", title: `${mdw(d)} 토요 연습 취소`, danger: true, confirmLabel: "연습 취소",
      body: `<p style="margin:0">${mdw(d)} 토요 연습 없이 <b>${mdw(sun)} 당일 리허설</b>로만 해요.</p>
        <ul class="small" style="margin:0;padding-left:18px;line-height:1.7">
          <li>이 주 토요 연습 출석은 체크하지 않아요 (통계 · 지각에서 빠져요). 적어 둔 기록이 있으면 지워요</li>
          <li>리허설 출석은 그대로예요. 팀모임은 따로예요</li>
          <li>이 주는 배치표의 '토 연습 불가 → 섬김 불가' 규칙을 쓰지 않아요</li></ul>
        <div class="field"><span>${md(sun)} 주일(리허설) 시간 <span class="hint">· 바꾸면 그 주일 섬김 시간이 함께 바뀌어요</span></span>
          <div class="row"><input type="time" id="cA" class="input" value="${hm(cur[0])}" step="600" style="width:auto"><span>–</span><input type="time" id="cB" class="input" value="${hm(cur[1])}" step="600" style="width:auto"></div></div>
        <label class="checkrow"><input type="checkbox" id="cNotify" checked><span><b>대상자에게 알리기</b><small>${T.ids.length}명 · ${esc(T.basis)} · 리허설 시간 포함</small></span></label>`,
      onConfirm: async (close) => {
        const a = $("#cA").value, z = $("#cB").value;
        if (!a || !z || z <= a) throw new Error("주일 끝나는 시간이 시작보다 늦어야 해요.");
        const changed = a !== hm(cur[0]) || z !== hm(cur[1]);
        const { data, error } = await sb.rpc("decide_practice", { p_date: d, p_decision: "cancel", p_sun_start: changed ? a : null, p_sun_end: changed ? z : null });
        if (error) throw new Error(error.message || "취소하지 못했어요");
        let msg = `토요 연습을 취소했어요${data?.removed ? ` · 출석 기록 ${data.removed}건 지움` : ""}`;
        if ($("#cNotify").checked && T.ids.length) {
          try { const r = await api("/api/notify", { kind: "sat_decide", date: d, decision: "cancel", member_ids: T.ids }); if (r.recipients) msg += ` · ${r.recipients}명에게 알렸어요`; }
          catch (err) { msg += ` · 알리지 못했어요 (${err.message})`; }
        }
        close(); toast(msg, 4000); after?.();
      },
    });
  }

  function openDefaultTimes(after) {
    const st = S.settings;
    modal({
      step: "설정", title: "기본 시간",
      body: `<div class="grid2"><div class="field"><span>토요 연습</span><div class="row"><input type="time" id="dA" value="${hm(st.sat_practice_start)}" class="input" style="width:auto"><span>–</span><input type="time" id="dB" value="${hm(st.sat_practice_end)}" class="input" style="width:auto"></div></div>
          <div class="field"><span>주일 섬김</span><div class="row"><input type="time" id="dC" value="${hm(st.sunday_start)}" class="input" style="width:auto"><span>–</span><input type="time" id="dD" value="${hm(st.sunday_end)}" class="input" style="width:auto"></div></div></div>
        <p class="small muted" style="margin:0">토요 연습은 사전 모임 30분을 포함한 시간이에요. 날짜별로 바꾼 시간은 그대로 남아요.</p>`,
      confirmLabel: "저장",
      onConfirm: async (close) => {
        const v = { sat_practice_start: $("#dA").value, sat_practice_end: $("#dB").value, sunday_start: $("#dC").value, sunday_end: $("#dD").value };
        if (!(v.sat_practice_end > v.sat_practice_start && v.sunday_end > v.sunday_start)) throw new Error("끝나는 시간이 시작보다 늦어야 해요.");
        const { error } = await sb.from("team_settings").update(v).eq("id", 1);
        if (error) throw new Error("저장하지 못했습니다");
        S.settings = await loadSettings(true); close(); toast("기본 시간을 저장했어요"); after?.();
      },
    });
  }

  // ---------------------------------------------------------------- 사역 추가·수정
  async function openMinistryEdit(mi) {
    const ps = window.__allPositions || [];
    let svs = mi ? mi.services.slice().sort((a, b) => a.service_date.localeCompare(b.service_date) || a.sort_order - b.sort_order).map((s) => ({ ...s }))
      : [{ label: "본 섬김", service_date: "", start_time: "19:00", end_time: "21:00" }];
    let prs = mi ? (mi.ministry_practices || []).map((p) => ({ ...p })) : [];
    const targets = new Set(mi ? (mi.ministry_targets || []).map((t) => t.member_id) : []);
    const f = mi ? { ...mi } : { name: "", response_mode: "monthly", response_open: true, response_deadline: null, target_mode: "all", required_positions: [],
      practice_mode: "poll", poll_from: null, poll_to: null, poll_day_start: "10:00", poll_day_end: "23:00", practice_minutes: 120, poll_deadline: null };
    const svcRows = () => svs.map((s, i) => `<div class="svc" data-i="${i}">
        <input class="input" data-k="label" value="${esc(s.label || "")}" placeholder="예배 ${i + 1}" maxlength="30">
        <input class="input" type="date" data-k="service_date" value="${s.service_date || ""}">
        <input class="input" type="time" data-k="start_time" value="${hm(s.start_time)}" step="600"><span class="muted">–</span>
        <input class="input" type="time" data-k="end_time" value="${hm(s.end_time)}" step="600">
        <button type="button" class="lu-x" data-delsvc="${i}" aria-label="예배 빼기" ${svs.length < 2 ? "disabled" : ""}>${XSVG}</button></div>`).join("");
    const prRows = () => prs.map((p, i) => `<div class="svc pr" data-p="${i}">
        <input class="input" type="date" data-k="practice_date" value="${p.practice_date || ""}">
        <input class="input" type="time" data-k="start_time" value="${hm(p.start_time)}" step="600"><span class="muted">–</span>
        <input class="input" type="time" data-k="end_time" value="${hm(p.end_time)}" step="600">
        <button type="button" class="lu-x" data-delpr="${i}" aria-label="연습 빼기">${XSVG}</button></div>`).join("") || `<span class="small muted">아직 없어요</span>`;
    const mins = [90, 120, 150];
    const radio = (name, v, cur, title, sub) => `<label class="radio1 ${cur === v ? "on" : ""}"><input type="radio" name="${name}" value="${v}" ${cur === v ? "checked" : ""}><span><b>${title}</b><small>${sub}</small></span></label>`;
    const people = servingMembers().sort(byPos);
    // 후보 날짜: 기간 / 날짜 고르기(달력)
    let pdMode = f.poll_dates?.length ? "pick" : "range";
    const pdSet = new Set(f.poll_dates || []);
    let calMonth = monthOf(f.poll_dates?.[0] || f.poll_from || svs[0]?.service_date || todayISO());
    const calHTML = () => {
      const first = calMonth, offset = dowOf(first), last = addDays(addMonths(first, 1), -1);
      const svcDays = new Set(svs.map((x) => x.service_date).filter(Boolean));
      const cells = [];
      for (let i = 0; i < offset; i++) cells.push(`<span></span>`);
      for (let d = first; d <= last; d = addDays(d, 1)) {
        const dw = dowOf(d);
        cells.push(`<button type="button" data-d="${d}" aria-pressed="${pdSet.has(d)}" class="${svcDays.has(d) ? "svcday" : ""} ${dw === 0 || dw === 6 ? "we" : ""}" aria-label="${mdw(d)}${svcDays.has(d) ? " 섬김 날" : ""}">${+d.slice(8)}</button>`);
      }
      return `<div class="calhead"><button type="button" class="btn btn-ghost btn-sm" data-cal="-1" aria-label="이전 달">‹</button><b>${calMonth.slice(0, 4)}년 ${monthLabel(calMonth)}</b>
        <button type="button" class="btn btn-ghost btn-sm" data-cal="1" aria-label="다음 달">›</button><span class="small muted" style="margin-left:auto">후보 ${pdSet.size}일${pdSet.size ? " · " + [...pdSet].sort().slice(0, 6).map(md).join(", ") + (pdSet.size > 6 ? " …" : "") : ""}</span></div>
        <div class="cal"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span>${cells.join("")}</div>
        <span class="small muted"><i class="calkey"></i> 섬김(예배) 날</span>`;
    };

    modal({
      step: mi ? "사역 수정" : "사역 추가", title: mi ? `${mi.name} 수정` : "사역 추가", wide: true,
      body: `<label class="field">사역 이름<input type="text" id="miName" maxlength="40" value="${esc(f.name)}" placeholder="예: 원스텝, 대청 사역, 가을 수련회"></label>
        <div class="sec"><h4>① 섬김 일시</h4>
          <div class="svc head"><span>이름</span><span>날짜</span><span>시작</span><span></span><span>끝</span><span></span></div>
          <div id="svcRows">${svcRows()}</div>
          <button type="button" class="btn btn-ghost btn-sm" id="addSvc" style="align-self:flex-start">+ 예배 추가</button>
          <p class="small muted" style="margin:0">수련회처럼 예배가 여러 번이면 예배마다 한 줄씩 넣어요. 응답도 예배별로 받아요.</p></div>
        <div class="sec"><h4>② 섬김 가능 여부 응답</h4>
          <div class="radios" id="rMode">${radio("rmode", "monthly", f.response_mode, "월말 섬김 응답에 포함", "그 달 응답에 같이 나와요")}${radio("rmode", "separate", f.response_mode, "따로 바로 받기", "급하거나 큰 사역 · 마감일 지정")}</div>
          <div class="row ${f.response_mode === "separate" ? "" : "hidden"}" id="rDeadline"><span class="small" style="font-weight:700;width:72px">응답 마감</span><input type="date" class="input" id="miRDl" value="${f.response_deadline || ""}" style="width:auto"></div>
          <div class="row"><span class="small" style="font-weight:700;width:72px">응답 대상</span><div class="seg" id="tMode"><button type="button" data-v="all" aria-pressed="${f.target_mode === "all"}">활동 중 전체</button><button type="button" data-v="custom" aria-pressed="${f.target_mode === "custom"}">직접 고르기</button></div></div>
          <div id="tPick" class="pick-people ${f.target_mode === "custom" ? "" : "hidden"}">${people.map((m) => `<label><input type="checkbox" value="${m.id}" ${targets.has(m.id) ? "checked" : ""}>${esc(m.name)}<small>${esc(POS_SHORT[m.main_position] || "")}</small></label>`).join("")}</div>
          <div class="row"><span class="small" style="font-weight:700;width:72px">필수 포지션</span><div class="seg" id="reqPos">${ps.map((p) => `<button type="button" data-v="${p.code}" aria-pressed="${f.required_positions.includes(p.code)}">${esc(POS_SHORT[p.code] || p.name)}</button>`).join("")}</div></div>
          <p class="small muted" style="margin:-4px 0 0 82px">연습 시간을 추천할 때, 고른 포지션이 빠지는 시간은 경고하고 뒤로 미뤄요. 포지션 구성은 주일과 같아요.</p></div>
        <div class="sec"><h4>③ 연습 일정</h4>
          <div class="radios" id="pMode">${radio("pmode", "fixed", f.practice_mode, "이미 정해짐", "연습 일시를 보여 주고 가능/불가만 받아요")}${radio("pmode", "poll", f.practice_mode, "가능 시간 취합", "본 섬김 가능한 사람에게 시간을 받아요")}</div>
          <div class="subbox ${f.practice_mode === "fixed" ? "" : "hidden"}" id="pFixed"><div id="prRows">${prRows()}</div>
            <button type="button" class="btn btn-ghost btn-sm" id="addPr" style="align-self:flex-start">+ 연습 추가</button></div>
          <div class="subbox ${f.practice_mode === "poll" ? "" : "hidden"}" id="pPoll">
            <div class="row"><span class="small" style="font-weight:700;width:72px">후보 날짜</span><div class="seg" id="pdMode"><button type="button" data-v="range" aria-pressed="${pdMode === "range"}">기간</button><button type="button" data-v="pick" aria-pressed="${pdMode === "pick"}">날짜 고르기</button></div></div>
            <div class="row ${pdMode === "range" ? "" : "hidden"}" id="pdRange"><span style="width:72px"></span><input type="date" class="input" id="pFrom" value="${f.poll_from || ""}" style="width:auto"><span class="muted">–</span><input type="date" class="input" id="pTo" value="${f.poll_to || ""}" style="width:auto"></div>
            <div class="calbox ${pdMode === "pick" ? "" : "hidden"}" id="pdPick">${calHTML()}</div>
            <div class="row"><span class="small" style="font-weight:700;width:72px">시간대</span><input type="time" class="input" id="pDS" value="${hm(f.poll_day_start)}" step="1800" style="width:auto"><span class="muted">–</span><input type="time" class="input" id="pDE" value="${hm(f.poll_day_end)}" step="1800" style="width:auto"><span class="small muted">모든 날짜 같게 · 30분 칸 (주말 종일 + 평일 저녁이면 넓게)</span></div>
            <div class="row"><span class="small" style="font-weight:700;width:72px">연습 길이</span><div class="seg" id="pLen">${mins.map((n) => `<button type="button" data-v="${n}" aria-pressed="${f.practice_minutes === n}">${n % 60 ? `${Math.floor(n / 60)}시간 30분` : `${n / 60}시간`}</button>`).join("")}<button type="button" data-v="custom" aria-pressed="${!mins.includes(f.practice_minutes)}">직접</button></div>
              <input type="number" class="input ${mins.includes(f.practice_minutes) ? "hidden" : ""}" id="pLenN" min="30" max="480" step="30" value="${f.practice_minutes}" style="width:90px"><span class="small muted ${mins.includes(f.practice_minutes) ? "hidden" : ""}" id="pLenU">분</span></div>
            <div class="row"><span class="small" style="font-weight:700;width:72px">응답 마감</span><input type="date" class="input" id="pDl" value="${f.poll_deadline || ""}" style="width:auto"><span class="small muted">취합은 사역 화면에서 열어요</span></div></div></div>`,
      onInput: (e) => {
        if (!e) return;
        const t = e.target;
        const sv = t.closest?.(".svc[data-i] input"); if (sv && e.type === "input") svs[+t.closest(".svc").dataset.i][t.dataset.k] = t.value;
        const pv = t.closest?.(".svc[data-p] input"); if (pv && e.type === "input") prs[+t.closest(".svc").dataset.p][t.dataset.k] = t.value;
        if (e.type !== "click") return;
        const pm = t.closest("#pdMode button");
        if (pm) { pdMode = pm.dataset.v; $$("#pdMode button").forEach((x) => x.setAttribute("aria-pressed", String(x === pm))); $("#pdRange").classList.toggle("hidden", pdMode !== "range"); $("#pdPick").classList.toggle("hidden", pdMode !== "pick"); }
        const cm = t.closest("[data-cal]"); if (cm) { calMonth = addMonths(calMonth, +cm.dataset.cal); $("#pdPick").innerHTML = calHTML(); }
        const cd = t.closest("#pdPick [data-d]"); if (cd) { pdSet.has(cd.dataset.d) ? pdSet.delete(cd.dataset.d) : pdSet.add(cd.dataset.d); $("#pdPick").innerHTML = calHTML(); }
        if (t.closest("#addSvc")) { svs.push({ label: `예배 ${svs.length + 1}`, service_date: svs[svs.length - 1]?.service_date || "", start_time: svs[svs.length - 1]?.start_time || "", end_time: svs[svs.length - 1]?.end_time || "" }); $("#svcRows").innerHTML = svcRows(); }
        const ds = t.closest("[data-delsvc]"); if (ds && svs.length > 1) { svs.splice(+ds.dataset.delsvc, 1); $("#svcRows").innerHTML = svcRows(); }
        if (t.closest("#addPr")) { prs.push({ practice_date: "", start_time: "20:00", end_time: fromMin(toMin("20:00") + (f.practice_minutes || 120)) }); $("#prRows").innerHTML = prRows(); }
        const dp = t.closest("[data-delpr]"); if (dp) { prs.splice(+dp.dataset.delpr, 1); $("#prRows").innerHTML = prRows(); }
        const r = t.closest(".radio1 input");
        if (r) {
          $$(`input[name=${r.name}]`).forEach((x) => x.closest(".radio1").classList.toggle("on", x.checked));
          if (r.name === "rmode") $("#rDeadline").classList.toggle("hidden", r.value !== "separate");
          if (r.name === "pmode") { $("#pFixed").classList.toggle("hidden", r.value !== "fixed"); $("#pPoll").classList.toggle("hidden", r.value !== "poll"); }
        }
        const tb = t.closest("#tMode button");
        if (tb) { $$("#tMode button").forEach((x) => x.setAttribute("aria-pressed", String(x === tb))); $("#tPick").classList.toggle("hidden", tb.dataset.v !== "custom"); }
        const rq = t.closest("#reqPos button"); if (rq) rq.setAttribute("aria-pressed", String(rq.getAttribute("aria-pressed") !== "true"));
        const ln = t.closest("#pLen button");
        if (ln) { $$("#pLen button").forEach((x) => x.setAttribute("aria-pressed", String(x === ln))); const c = ln.dataset.v === "custom"; $("#pLenN").classList.toggle("hidden", !c); $("#pLenU").classList.toggle("hidden", !c); }
      },
      confirmLabel: mi ? "저장" : "추가하기",
      onConfirm: async (close) => {
        const name = $("#miName").value.trim();
        if (!name) throw new Error("사역 이름을 입력해 주세요.");
        svs.forEach((s, i) => { if (!s.label?.trim()) s.label = svs.length > 1 ? `예배 ${i + 1}` : "본 섬김"; });
        if (svs.some((s) => !s.service_date)) throw new Error("섬김 날짜를 모두 넣어 주세요.");
        if (svs.some((s) => (s.start_time && s.end_time && hm(s.end_time) <= hm(s.start_time)))) throw new Error("끝나는 시간이 시작보다 늦어야 해요.");
        const rmode = $("input[name=rmode]:checked").value, pmode = $("input[name=pmode]:checked").value;
        const lenBtn = $("#pLen [aria-pressed=true]")?.dataset.v;
        const minutes = lenBtn === "custom" ? +$("#pLenN").value : +(lenBtn || 120);
        const row = {
          name, response_mode: rmode, response_deadline: rmode === "separate" ? $("#miRDl").value || null : null,
          target_mode: $("#tMode [aria-pressed=true]").dataset.v, required_positions: $$("#reqPos [aria-pressed=true]").map((b) => b.dataset.v),
          practice_mode: pmode, poll_from: $("#pFrom").value || null, poll_to: $("#pTo").value || null, poll_dates: null,
          poll_day_start: $("#pDS").value || "10:00", poll_day_end: $("#pDE").value || "23:00", practice_minutes: minutes, poll_deadline: $("#pDl").value || null,
        };
        if (!(minutes >= 30 && minutes <= 480)) throw new Error("연습 길이는 30분~8시간 사이로 정해 주세요.");
        if (pmode === "poll" && pdMode === "pick") {
          const ds = [...pdSet].sort();
          if (!ds.length) throw new Error("연습 후보 날짜를 하루 이상 골라 주세요.");
          Object.assign(row, { poll_dates: ds, poll_from: ds[0], poll_to: ds[ds.length - 1] });
        }
        if (pmode === "poll") {
          if (!row.poll_from || !row.poll_to) throw new Error("연습 후보 기간을 정해 주세요.");
          if (row.poll_to < row.poll_from) throw new Error("후보 기간의 끝이 시작보다 빨라요.");
          if ((new Date(row.poll_to) - new Date(row.poll_from)) / 864e5 > 30) throw new Error("후보 기간은 31일 안으로 정해 주세요.");
          if (hm(row.poll_day_end) <= hm(row.poll_day_start)) throw new Error("하루 범위의 끝이 시작보다 늦어야 해요.");
        }
        if (pmode === "fixed" && prs.some((p) => !p.practice_date || !p.start_time || !p.end_time || hm(p.end_time) <= hm(p.start_time))) throw new Error("연습 날짜와 시간을 다시 확인해 주세요.");
        const pick = $$("#tPick input:checked").map((x) => x.value);
        if (row.target_mode === "custom" && !pick.length) throw new Error("응답 대상을 한 명 이상 골라 주세요.");
        // 사역
        let id = mi?.id;
        if (mi) { const { error } = await sb.from("ministries").update(row).eq("id", id); if (error) throw new Error("저장하지 못했습니다"); }
        else { const { data, error } = await sb.from("ministries").insert({ ...row, response_open: true }).select("id").single(); if (error) throw new Error("저장하지 못했습니다: " + error.message); id = data.id; }
        // 예배
        const keep = svs.filter((s) => s.id).map((s) => s.id);
        const gone = (mi?.services || []).filter((s) => !keep.includes(s.id)).map((s) => s.id);
        if (gone.length) await sb.from("services").delete().in("id", gone);
        for (let i = 0; i < svs.length; i++) {
          const s = svs[i], v = { service_date: s.service_date, label: s.label.trim(), start_time: s.start_time || null, end_time: s.end_time || null, sort_order: i };
          const { error } = s.id ? await sb.from("services").update(v).eq("id", s.id) : await sb.from("services").insert({ ...v, ministry_id: id });
          if (error) throw new Error("예배를 저장하지 못했습니다: " + error.message);
        }
        // 대상
        await sb.from("ministry_targets").delete().eq("ministry_id", id);
        if (row.target_mode === "custom") await sb.from("ministry_targets").insert(pick.map((mid) => ({ ministry_id: id, member_id: mid })));
        // 정해진 연습
        if (pmode === "fixed") {
          const pkeep = prs.filter((p) => p.id).map((p) => p.id);
          const pgone = (mi?.ministry_practices || []).filter((p) => !pkeep.includes(p.id)).map((p) => p.id);
          if (pgone.length) await sb.from("ministry_practices").delete().in("id", pgone);
          for (const p of prs) {
            const v = { practice_date: p.practice_date, start_time: p.start_time, end_time: p.end_time };
            const { error } = p.id ? await sb.from("ministry_practices").update(v).eq("id", p.id) : await sb.from("ministry_practices").insert({ ...v, ministry_id: id });
            if (error) throw new Error("연습을 저장하지 못했습니다");
          }
        }
        close(); toast(mi ? "저장했어요" : `${name}을(를) 추가했어요`);
        if (!mi && rmode === "separate") MS.askPush = id;
        nav(`ministry/${id}`);
      },
    });
  }

  // ---------------------------------------------------------------- 사역 상세
  const MS = { tab: "respond", id: null, open: null, askPush: null };
  // 따로 받는 사역: 응답 열림 알림 (사역을 새로 만든 직후 · '응답 알림 보내기')
  async function askMinOpenPush(mi, n) {
    if (!(await notifyEnabled("minopen"))) return toast("'사역 응답 열림' 알림이 알림 설정에서 꺼져 있어요", 3500);
    const again = await sentAny([`minopen:${mi.id}`]);
    modal({ title: `${mi.name} 응답 알림 보내기`,
      body: `<p style="margin:0">응답 대상 ${n}명에게 '${esc(mi.name)} 섬김 응답을 받고 있어요' 푸시 알림을 보내요.${again ? " <b>이미 한 번 보냈어요.</b>" : ""}</p>`,
      confirmLabel: again ? "한 번 더 보내기" : "보내기", cancelLabel: "나중에",
      onConfirm: async (close) => { const t = await sendPush("minopen", { ministry_id: mi.id }); close(); toast(`보냈어요${t}`, 4000); } });
  }
  async function renderMinistry(id) {
    if (MS.id !== id) { MS.id = id; MS.tab = "respond"; MS.open = null; V.sel = 0; V.picked = null; }
    const { data: mi, error } = await sb.from("ministries").select("*, services(*, assignments(*)), ministry_practices(*), ministry_targets(member_id)").eq("id", id).maybeSingle();
    if (error || !mi) { $("#content").innerHTML = `<div class="empty">사역을 찾을 수 없어요. <a href="#schedule">섬김 일정으로</a></div>`; return; }
    const svs = mi.services.slice().sort((a, b) => a.service_date.localeCompare(b.service_date) || a.sort_order - b.sort_order || (a.start_time || "").localeCompare(b.start_time || ""));
    const sids = svs.map((s) => s.id);
    const prs = mi.ministry_practices.slice().sort((a, b) => a.practice_date.localeCompare(b.practice_date) || a.start_time.localeCompare(b.start_time));
    const first = svs[0]?.service_date || todayISO(), month = monthOf(first);
    const [av, poll, ans, patt, mo, near] = await Promise.all([
      sids.length ? sb.from("ministry_availability").select("*").in("service_id", sids) : { data: [] },
      sb.from("ministry_poll").select("*").eq("ministry_id", id),
      prs.length ? sb.from("practice_answers").select("*").in("practice_id", prs.map((p) => p.id)) : { data: [] },
      prs.length ? sb.from("practice_attendance").select("*").in("practice_id", prs.map((p) => p.id)) : { data: [] },
      sb.from("availability_months").select("*").eq("month", month).maybeSingle(),
      sb.from("services").select("service_date, assignments(member_id)").gte("service_date", addMonths(month, -1)).lt("service_date", addMonths(month, 1)),
    ]);
    const today = todayISO();
    const targets = mi.target_mode === "all" ? servingMembers().sort(byPos)
      : servingMembers().filter((m) => mi.ministry_targets.some((t) => t.member_id === m.id)).sort(byPos);
    const aOf = (sid, mid) => (av.data || []).find((a) => a.service_id === sid && a.member_id === mid)?.available;
    const availPeople = targets.filter((m) => svs.some((s) => aOf(s.id, m.id) === true));
    const noPeople = targets.filter((m) => svs.length && svs.every((s) => aOf(s.id, m.id) === false));
    const pendPeople = targets.filter((m) => svs.some((s) => aOf(s.id, m.id) === undefined));
    const polled = (poll.data || []).filter((p) => availPeople.some((m) => m.id === p.member_id));
    const pollMissing = availPeople.filter((m) => !(poll.data || []).some((p) => p.member_id === m.id));
    const monthOpen = !!mo.data?.is_open;
    const respOpen = mi.response_mode === "monthly" ? monthOpen : mi.response_open;
    const cnt = (mid, mon) => (near.data || []).filter((s) => s.service_date.slice(0, 7) === mon.slice(0, 7) && (s.assignments || []).some((a) => a.member_id === mid)).length;
    const req = mi.required_positions || [];
    const dateText = svs.length === 1 ? `${fmtDate(first, { month: "long", day: "numeric", weekday: "short" })} ${timeRange(svs[0].start_time, svs[0].end_time)}`
      : `${md(first)} – ${md(svs[svs.length - 1].service_date)} · 예배 ${svs.length}개`;
    const respMsg = () => mi.response_mode === "monthly"
      ? `[찬양팀] ${monthLabel(month)} 섬김 응답에 ${mi.name}도 함께 있어요.\n${dateText} 가능 여부를 체크해 주세요.\n\n${location.origin}/me.html#respond`
      : `[찬양팀] ${mi.name} 섬김 응답을 받고 있어요.\n${mi.response_deadline ? fmtDate(mi.response_deadline, { month: "long", day: "numeric", weekday: "short" }) + "까지 " : ""}${svs.length > 1 ? "예배별 " : ""}가능 여부를 체크해 주세요.\n\n${location.origin}/me.html#respond`;

    const tabs = [["respond", "응답"], ["practice", "연습"], ["att", "연습 출석"]];
    $("#content").innerHTML = `
      <a href="#schedule" class="back" style="align-self:flex-start" id="msBack">‹ ${monthLabel(month)} 섬김 일정</a>
      <div class="page-head">
        <div><h1 class="page-title">${esc(mi.name)} <span class="chip chip-violet" style="vertical-align:middle">사역</span></h1>
          <p class="muted" style="margin:4px 0 0">${esc(dateText)} · 주일과 같은 포지션 구성${req.length ? ` · 필수 ${req.map((c) => POS_SHORT[c] || positionName(c)).join("·")}` : ""}</p></div>
        <div class="row"><a class="btn btn-primary" href="#lineup" id="msLineup">배치하기</a><button type="button" class="btn btn-ghost" id="msCopy">응답 안내 보내기</button><button type="button" class="btn btn-ghost" id="msEdit">수정</button><button type="button" class="btn btn-danger" id="msDel">삭제</button></div>
      </div>
      <div class="kp4">
        <div class="ktile"><span>본 섬김 가능</span><b>${availPeople.length}명</b><small>모두 불가 ${noPeople.length} · 미응답 ${pendPeople.length} · 대상 ${targets.length}</small></div>
        ${mi.practice_mode === "poll" ? `<div class="ktile ${mi.poll_open ? "focus" : ""}"><span>연습 시간 응답</span><b>${polled.length} / ${availPeople.length}</b><small>${mi.poll_open ? "취합 중" : prs.length ? "취합 끝" : "아직 안 열었어요"}${mi.poll_deadline ? ` · ${md(mi.poll_deadline)} 마감 · ${dday(mi.poll_deadline)}` : ""}</small></div>`
          : `<div class="ktile"><span>정해진 연습</span><b>${prs.length}회</b><small>가능 여부를 응답과 함께 받아요</small></div>`}
        <div class="ktile"><span>연습 길이</span><b>${mi.practice_minutes % 60 ? `${Math.floor(mi.practice_minutes / 60)}시간 ${mi.practice_minutes % 60}분` : `${mi.practice_minutes / 60}시간`}</b><small>${mi.practice_mode === "poll" && pollDays(mi).length ? (mi.poll_dates?.length ? `후보 ${pollDays(mi).length}일 (${pollDays(mi).slice(0, 3).map(md).join(", ")}${pollDays(mi).length > 3 ? " …" : ""})` : `후보 ${md(mi.poll_from)} – ${md(mi.poll_to)}`) : ""}</small></div>
        <div class="ktile"><span>연습 일정</span>${prs.length ? `<b style="color:var(--ok);font-size:20px">${mdw(prs[0].practice_date)} ${hm(prs[0].start_time)}</b><small>${prs.length > 1 ? `외 ${prs.length - 1}회` : timeRange(prs[0].start_time, prs[0].end_time)}</small>` : `<b style="color:var(--warn)">미정</b><small>${mi.practice_mode === "poll" ? "연습 탭에서 추천 시간 확정" : "연습을 추가해 주세요"}</small>`}</div>
      </div>
      <div class="tabs" role="tablist" id="msTabs">${tabs.map(([k, l]) => `<button type="button" role="tab" data-mtab="${k}" aria-selected="${MS.tab === k}">${l}</button>`).join("")}</div>
      <div id="msBody" style="display:flex;flex-direction:column;gap:16px"></div>`;

    $("#msBack").onclick = () => { SC.month = month; };
    $("#msLineup").onclick = () => { V.lineupMonth = month; V.view = svs.length > 1 ? mi.id : "month"; V.boardKey = null; };
    $("#msTabs").onclick = (e) => { const b = e.target.closest("[data-mtab]"); if (b && b.dataset.mtab !== MS.tab) { MS.tab = b.dataset.mtab; MS.open = null; renderMinistry(id); } };
    $("#msCopy").onclick = () => openSend({ title: `${mi.name} 응답 안내 보내기`, ctx: `min-info:${id}`, label: `${mi.name} 응답 안내`, url: mi.response_mode === "separate" ? `/me.html#respond/min:${id}` : "/me.html#respond",
      groups: [{ id: "all", label: "응답 대상", people: targets }],
      push: () => ({ title: `${mi.name} 섬김 응답을 받고 있어요`, body: `${mi.response_mode === "separate" ? dlText(mi.response_deadline) + " " : ""}${dateText} 가능 여부를 체크해 주세요`.trim() }),
      text: () => respMsg() });
    $("#msEdit").onclick = () => openMinistryEdit(mi);
    $("#msDel").onclick = () => modal({
      title: `${mi.name} 삭제`, body: `<p style="margin:0">예배·응답·연습·배치·연습 출석이 모두 지워지고 되돌릴 수 없어요.</p>`, confirmLabel: "삭제", danger: true,
      onConfirm: async (close) => { const { error } = await sb.from("ministries").delete().eq("id", id); if (error) throw new Error("삭제하지 못했습니다"); close(); toast("삭제했어요"); SC.month = month; nav("schedule"); },
    });
    const body = $("#msBody");
    const ctx = { mi, svs, prs, targets, availPeople, pendPeople, polled, pollMissing, aOf, av: av.data || [], poll: poll.data || [], ans: ans.data || [], patt: patt.data || [], respOpen, monthOpen, month, today, cnt, req, respMsg };

    // ---------- 응답 ----------
    if (MS.tab === "respond") {
      body.innerHTML = `<section class="card bordered" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
          ${mi.response_mode === "monthly" ? `<span>월말 응답에 포함 · <b>${monthLabel(month)} 응답 ${monthOpen ? "받는 중" : mo.data ? "마감됨" : "아직 안 열림"}</b></span>
            <a class="btn btn-ghost btn-sm" href="#respond" id="goResp">${monthLabel(month)} 응답 현황으로</a>`
          : `<span class="chip ${mi.response_open ? "chip-ok" : "chip-gray"}">${mi.response_open ? "응답 받는 중" : "마감됨"}</span>
            <label class="field" style="flex-direction:row;align-items:center;gap:8px;font-size:14px">마감일<input type="date" id="rdl" value="${mi.response_deadline || ""}" style="min-height:40px;width:auto"></label>
            <button type="button" class="btn btn-ghost" id="rdlSave">마감일 저장</button>
            <button type="button" class="btn ${mi.response_open ? "btn-danger" : "btn-primary"}" id="rToggle">${mi.response_open ? "마감하기" : "다시 열기"}</button>
            ${mi.response_open ? `<button type="button" class="btn btn-ghost" id="rPush">응답 알림 보내기</button>` : ""}`}
          ${pendPeople.length && respOpen ? `<button type="button" class="btn btn-soft" id="rNudge" style="margin-left:auto">미응답 ${pendPeople.length}명 독촉 보내기</button>` : ""}
        </section>
        <p class="lead" style="margin:0">칸을 누르면 리더십이 직접 바꿀 수 있어요 (가능 → 불가 → 미응답).${mi.target_mode === "custom" ? ` 응답 대상 ${targets.length}명만 보여요.` : ""}</p>
        <div class="evaltable"><table class="resp-table">
          <thead><tr><th>이름</th><th>포지션</th>${svs.map((s) => `<th style="border-left:1px solid var(--line)">${esc(s.label || mi.name)}<br><span class="small muted" style="font-weight:600">${mdw(s.service_date)} ${hm(s.start_time)}</span></th>`).join("")}</tr></thead>
          <tbody>${targets.map((m) => `<tr><td style="font-weight:700;white-space:nowrap">${esc(m.name)}</td><td class="muted small" style="white-space:nowrap">${esc(positionName(m.main_position))}</td>
            ${svs.map((s) => { const v = aOf(s.id, m.id); const [cls, label] = v === true ? ["a-yes", "가능"] : v === false ? ["a-no", "불가"] : ["a-none", "–"];
              return `<td class="${cls}" style="border-left:1px solid var(--line)"><button type="button" class="a-btn" data-sid="${s.id}" data-mid="${m.id}" data-v="${v === undefined ? "" : v}" aria-label="${esc(m.name)} ${esc(s.label || "")} ${label}">${label}</button></td>`; }).join("")}</tr>`).join("")
            || `<tr><td colspan="99" class="muted">응답 대상이 없어요.</td></tr>`}
            <tr style="background:var(--bg)"><td colspan="2" class="small" style="font-weight:700">가능 인원</td>${svs.map((s) => `<td style="font-weight:800;color:var(--violet);border-left:1px solid var(--line)">${targets.filter((m) => aOf(s.id, m.id) === true).length}</td>`).join("")}</tr>
          </tbody></table></div>`;
      $("#goResp")?.addEventListener("click", () => { V.month = month; });
      $("#rdlSave")?.addEventListener("click", async () => { const { error } = await sb.from("ministries").update({ response_deadline: $("#rdl").value || null }).eq("id", id); toast(error ? "저장하지 못했습니다" : "마감일을 저장했어요"); renderMinistry(id); });
      $("#rToggle")?.addEventListener("click", async () => {
        if (mi.response_open) { const { error } = await sb.from("ministries").update({ response_open: false }).eq("id", id); toast(error ? "바꾸지 못했습니다" : "응답을 마감했어요"); return renderMinistry(id); }
        const pr = await pushRow("minopen", [`minopen:${id}`], `응답 대상 ${targets.length}명에게 '응답을 받고 있어요' 알림`);
        modal({ title: `${mi.name} 응답 다시 열기`, body: `<p style="margin:0">팀원들이 다시 응답을 바꿀 수 있어요.</p>${pr}`, confirmLabel: "다시 열기",
          onConfirm: async (close) => {
            const push = pushChecked();
            const { error } = await sb.from("ministries").update({ response_open: true }).eq("id", id);
            if (error) throw new Error("바꾸지 못했습니다");
            const t = push ? await sendPush("minopen", { ministry_id: id }) : "";
            close(); toast(`다시 열었어요${t}`, 4000); renderMinistry(id);
          } });
      });
      $("#rPush")?.addEventListener("click", () => askMinOpenPush(mi, targets.length));
      if (MS.askPush === id) { MS.askPush = null; if (mi.response_mode === "separate" && mi.response_open) askMinOpenPush(mi, targets.length); }
      $("#rNudge")?.addEventListener("click", () => {
        const dl = mi.response_mode === "separate" ? mi.response_deadline : mo.data?.deadline;
        openSend({ title: "독촉 보내기", ctx: `nudge-min:${id}`, label: `${mi.name} 응답 독촉`, url: mi.response_mode === "separate" ? `/me.html#respond/min:${id}` : "/me.html#respond",
          groups: [{ id: "resp", label: "미응답", people: pendPeople }],
          push: () => ({ title: `${mi.name} 섬김 응답이 아직 남아 있어요`, body: `${dlText(dl)} 체크 부탁드려요!`.trim() }),
          text: (sel, names) => `[찬양팀] ${namesNim(names)}\n${mi.name} 섬김 응답이 아직 남아 있어요.${dl ? " " + dlText(dl) : ""} 체크 부탁드려요!\n\n${location.origin}/me.html#respond` });
      });
      $$(".a-btn[data-sid]").forEach((b) => b.addEventListener("click", async () => {
        const cur = b.dataset.v, nx = cur === "true" ? false : cur === "false" ? null : true;
        const key = { service_id: b.dataset.sid, member_id: b.dataset.mid };
        const { error } = nx === null ? await sb.from("ministry_availability").delete().match(key) : await sb.from("ministry_availability").upsert({ ...key, available: nx });
        if (error) return toast("바꾸지 못했습니다");
        renderMinistry(id);
      }));
    }

    // ---------- 연습 ----------
    if (MS.tab === "practice") drawPractice(body, ctx);

    // ---------- 연습 출석 ----------
    if (MS.tab === "att") drawPracticeAtt(body, ctx);
  }

  // 연습 탭: 정해진 연습 목록 + (취합이면) 칠한 시간 · 추천 · 확정
  function drawPractice(body, c) {
    const { mi, svs, prs, availPeople, polled, pollMissing, ans, today } = c;
    const id = mi.id, multi = svs.length > 1;
    const svcName = (sid) => { const s = svs.find((x) => x.id === sid); return s ? (s.label || mi.name) : multi ? "모든 예배" : ""; };
    const ansOf = (pid, mid) => ans.find((a) => a.practice_id === pid && a.member_id === mid)?.available;
    const prList = prs.map((p) => {
      const yes = availPeople.filter((m) => ansOf(p.id, m.id) === true), no = availPeople.filter((m) => ansOf(p.id, m.id) === false);
      const pend = availPeople.filter((m) => ansOf(p.id, m.id) === undefined);
      return `<div class="prow"><span>${multi ? `<span class="chip chip-violet" style="margin-right:6px">${esc(svcName(p.service_id))}</span>` : ""}<b>${fmtDate(p.practice_date, { month: "long", day: "numeric", weekday: "short" })} ${timeRange(p.start_time, p.end_time)}</b>
          ${mi.practice_mode === "fixed" ? `<span class="small muted"> · 가능 ${yes.length} · 불가 ${no.length}${no.length ? ` (${no.map((m) => esc(m.name)).join(", ")})` : ""}${pend.length ? ` · 미응답 ${pend.length}` : ""}</span>` : ""}</span>
        <span class="row"><button type="button" class="btn btn-ghost btn-sm" data-pcopy="${p.id}">연습 안내 보내기</button><button type="button" class="btn btn-ghost btn-sm" data-pdel="${p.id}">삭제</button></span></div>`;
    }).join("");
    let pollHTML = "";
    let wins = [];
    if (mi.practice_mode === "poll") {
      const days = pollDays(mi);
      const times = pollTimes(mi);
      const who = Object.fromEntries(polled.map((p) => [p.member_id, new Set(p.slots)]));
      const ppl = (d, t) => availPeople.filter((m) => who[m.id]?.has(`${d} ${t}`));
      const L = Math.ceil(mi.practice_minutes / 30);
      // 연속 L칸이 모두 되는 사람
      days.forEach((d) => { for (let i = 0; i + L <= times.length; i++) {
        let set = availPeople.filter((m) => who[m.id]);
        for (let k = 0; k < L; k++) set = set.filter((m) => who[m.id].has(`${d} ${times[i + k]}`));
        const missingReq = c.req.filter((pos) => !set.some((m) => posOfM(m).includes(pos)));
        wins.push({ d, i, start: times[i], end: fromMin(toMin(times[i]) + L * 30), set, missingReq });
      } });
      wins.sort((a, b) => a.missingReq.length - b.missingReq.length || b.set.length - a.set.length || a.d.localeCompare(b.d) || a.i - b.i);
      const top = [];
      for (const w of wins) { if (!w.set.length) break; if (top.some((x) => x.d === w.d && Math.abs(x.i - w.i) < L)) continue; top.push(w); if (top.length === 3) break; }
      wins = top;
      const max = Math.max(1, ...days.flatMap((d) => times.map((t) => ppl(d, t).length)));
      const col = (v) => { const r = v / max; const a = [245, 239, 252], b = [65, 10, 133]; return `rgb(${a.map((x, k) => Math.round(x + (b[k] - x) * r)).join(",")})`; };
      const best = top[0];
      const heat = days.length ? `<div style="overflow-x:auto"><div class="pheat" style="grid-template-columns:96px repeat(${times.length}, minmax(18px,1fr));min-width:${96 + times.length * 20}px">
          <span></span>${times.map((t) => `<span class="h">${t.endsWith(":00") ? +t.slice(0, 2) : ""}</span>`).join("")}
          ${days.map((d) => `<span class="d">${mdw(d)}</span>${times.map((t, i) => { const p = ppl(d, t); const on = best && best.d === d && i >= best.i && i < best.i + L;
            return `<span class="c ${on ? "best" : ""}" style="background:${col(p.length)};color:${p.length > max / 2 ? "#fff" : "var(--muted)"}" title="${mdw(d)} ${t} · ${p.length}명${p.length ? ": " + esc(p.map((m) => m.name).join(", ")) : ""}">${p.length || ""}</span>`; }).join("")}`).join("")}
        </div></div>` : `<div class="empty">후보 기간을 정하면 칠한 시간이 여기에 보여요.</div>`;
      pollHTML = `<section class="card bordered" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
          <span class="chip ${mi.poll_open ? "chip-warn" : "chip-gray"}">${mi.poll_open ? "가능 시간 취합 중" : "취합 닫힘"}</span>
          <span class="small muted">본 섬김 '가능' ${availPeople.length}명이 대상이에요${mi.poll_deadline ? ` · ${md(mi.poll_deadline)} 마감` : ""}</span>
          <button type="button" class="btn ${mi.poll_open ? "btn-danger" : "btn-primary"}" id="pToggle">${mi.poll_open ? "취합 마감" : "취합 열고 안내 문구 복사"}</button>
          ${multi ? `<span class="small" style="flex-basis:100%;color:var(--violet);font-weight:600">예배가 ${svs.length}개라 연습은 예배마다 따로 정해요. 배치표에서 팀을 짜면서 '연습 시간 맞추기'로 확정하는 게 편해요.</span>` : ""}
          ${mi.poll_open && pollMissing.length ? `<button type="button" class="btn btn-soft" id="pNudge" style="margin-left:auto">안 낸 ${pollMissing.length}명 독촉 보내기</button>` : ""}
        </section>
        <div class="cols2">
          <section class="box"><h2>연습 가능 시간 <small>칸 숫자 = 가능 인원 (${polled.length}명 응답)</small></h2>${heat}
            <div class="row small muted"><span>적음</span><span class="row" style="gap:2px">${[0, .25, .5, .75, 1].map((r) => `<i style="width:14px;height:14px;border-radius:3px;display:inline-block;background:${col(r * max)}"></i>`).join("")}</span><span>많음</span>
              <span style="margin-left:10px"><i style="width:14px;height:14px;border-radius:3px;outline:2px solid var(--violet);outline-offset:-1px;display:inline-block;vertical-align:-2px"></i> 추천 1위</span></div>
            <p class="note-box small" style="margin:0">칸에 마우스를 올리면 가능한 사람이 보여요.</p></section>
          <section class="box"><h2>추천 연습 시간 <small>${mi.practice_minutes}분 연속 기준</small></h2>
            ${top.length ? `<div class="recw">${top.map((w, k) => {
              const missing = c.availPeople.filter((m) => !w.set.includes(m));
              return `<div class="${k === 0 ? "top" : ""}"><span class="rk ${k ? "g" : ""}">${k + 1}</span>
                <span><b>${mdw(w.d)} ${w.start} – ${w.end}</b><div class="ppl"><span>가능 ${w.set.length}명</span>${w.missingReq.map((p) => `<span class="no strong">${esc(POS_SHORT[p] || positionName(p))} 없음</span>`).join("")}${missing.slice(0, 6).map((m) => `<span class="no">${esc(m.name)}</span>`).join("")}${missing.length > 6 ? `<span>외 ${missing.length - 6}명</span>` : ""}</div></span>
                <button type="button" class="btn ${k === 0 ? "btn-primary" : "btn-ghost"} btn-sm" data-win="${k}">확정</button></div>`;
            }).join("")}</div>` : `<div class="empty" style="padding:20px">${polled.length ? `${mi.practice_minutes}분 연속으로 겹치는 시간이 아직 없어요.` : "아직 칠한 사람이 없어요."}</div>`}
            ${pollMissing.length ? `<div style="border-top:1px solid var(--tint-2);padding-top:10px"><b class="small">아직 안 낸 사람 ${pollMissing.length}명</b><div class="ppl" style="margin-top:4px">${pollMissing.map((m) => `<span>${esc(m.name)}</span>`).join("")}</div></div>` : ""}
            <p class="small muted" style="margin:0">${multi ? "여기 추천은 '가능'으로 답한 사람 전체 기준이에요. 확정할 때 예배를 골라요." : "확정하면 연습이 멤버 화면에 보이고, 취합은 닫혀요."} 연습 출석 탭에서 출석을 체크해요.</p></section>
        </div>`;
    }
    body.innerHTML = `${pollHTML}
      <section class="box"><h2>정해진 연습 <small>${prs.length}회</small></h2>
        ${prList || `<span class="small muted">${mi.practice_mode === "poll" ? "추천 시간을 확정하거나 직접 추가해요." : "연습을 추가해 주세요."}</span>`}
        <button type="button" class="btn btn-ghost btn-sm" id="prAdd" style="align-self:flex-start">+ 연습 직접 추가</button></section>`;

    // 예배별 연습 (예배 1개면 그 예배, 여러 개면 고른 예배 · 정해진 연습은 '모든 예배'도 가능)
    const svcPick = (allowAll) => multi ? `<label class="field">어느 예배 연습인가요<select id="xS">${allowAll ? `<option value="">모든 예배</option>` : ""}${svs.map((s) => `<option value="${s.id}">${esc(s.label || mi.name)} · ${mdw(s.service_date)}</option>`).join("")}</select></label>` : "";
    const pickedSvc = () => multi ? ($("#xS")?.value || null) : svs[0]?.id || null;
    const addPractice = async (d, a, z, closePoll, sid) => {
      const { data, error } = await sb.from("ministry_practices").insert({ ministry_id: id, service_id: sid, practice_date: d, start_time: a, end_time: z }).select("id").single();
      if (error) throw new Error("연습을 저장하지 못했습니다");
      const done = new Set([...prs.map((p) => p.service_id), sid]);
      if (closePoll && mi.poll_open && (done.has(null) || svs.every((s) => done.has(s.id)))) await sb.from("ministries").update({ poll_open: false }).eq("id", id);
      return data.id;
    };
    const practicePush = () => pushRow("practice", [], "그 예배에 배치된 사람에게 '연습 시간이 정해졌어요' 알림 (배치 전이면 팀원 전체)");
    const pracMsg = (p) => `[찬양팀] ${mi.name}${multi && p.service_id ? " " + svcName(p.service_id) : ""} 연습 안내\n${fmtDate(p.practice_date, { month: "long", day: "numeric", weekday: "short" })} ${timeRange(p.start_time, p.end_time)}에 모여요.${c.req.length ? "" : ""}\n\n${location.origin}/me.html`;
    $$("[data-win]").forEach((b) => b.addEventListener("click", async () => {
      const w = wins[+b.dataset.win];
      const pr = await practicePush();
      modal({ title: "연습 시간 확정", body: `<p style="margin:0"><b>${mdw(w.d)} ${w.start} – ${w.end}</b>로 확정할까요? 가능 ${w.set.length}명${w.missingReq.length ? ` · <span style="color:var(--bad)">${w.missingReq.map((p) => POS_SHORT[p] || positionName(p)).join("·")} 없음</span>` : ""}</p>${svcPick(false)}${pr}${msgOnly(pracMsg({ practice_date: w.d, start_time: w.start, end_time: w.end }))}`,
        confirmLabel: "확정하고 문구 복사",
        onConfirm: async (close) => {
          const push = pushChecked();
          const pid = await addPractice(w.d, w.start, w.end, true, pickedSvc()); await copyText($("#mMsg").textContent);
          const t = push ? await sendPush("practice", { practice_id: pid }) : "";
          close(); toast(`연습을 확정했어요. 안내 문구를 복사했어요${t}`, 4000); renderMinistry(id);
        } });
    }));
    $("#prAdd").onclick = async () => {
      const pr = mi.practice_mode === "poll" ? await practicePush() : "";
      modal({ title: "연습 추가",
        body: `${svcPick(mi.practice_mode === "fixed")}<div class="row"><label class="field">날짜<input type="date" id="xD"></label><label class="field">시작<input type="time" id="xA" value="20:00" step="600"></label><label class="field">끝<input type="time" id="xB" value="${fromMin(toMin("20:00") + mi.practice_minutes)}" step="600"></label></div>${pr}`,
        confirmLabel: "추가",
        onConfirm: async (close) => {
          const d = $("#xD").value, a = $("#xA").value, z = $("#xB").value; if (!d || !a || !z || z <= a) throw new Error("날짜와 시간을 다시 확인해 주세요.");
          const push = pushChecked();
          const pid = await addPractice(d, a, z, false, pickedSvc());
          const t = push ? await sendPush("practice", { practice_id: pid }) : "";
          close(); toast(`연습을 추가했어요${t}`, 4000); renderMinistry(id);
        } });
    };
    $$("[data-pdel]").forEach((b) => b.addEventListener("click", () => modal({ title: "연습 삭제", body: `<p style="margin:0">이 연습의 가능 응답·출석 기록도 함께 지워져요.</p>`, confirmLabel: "삭제", danger: true,
      onConfirm: async (close) => { const { error } = await sb.from("ministry_practices").delete().eq("id", b.dataset.pdel); if (error) throw new Error("삭제하지 못했습니다"); close(); toast("삭제했어요"); renderMinistry(id); } })));
    // 연습 안내: 그 예배에 배치된 사람 (배치 전이면 본 섬김 '가능'인 사람)
    $$("[data-pcopy]").forEach((b) => b.addEventListener("click", () => {
      const p = prs.find((x) => x.id === b.dataset.pcopy);
      const ids = new Set(svs.filter((s) => !p.service_id || s.id === p.service_id).flatMap((s) => (s.assignments || []).map((a) => a.member_id)).filter(Boolean));
      const who = ids.size ? S.members.filter((m) => ids.has(m.id) && m.is_active) : availPeople;
      const nm = `${mi.name}${multi && p.service_id ? " " + svcName(p.service_id) : ""}`;
      openSend({ title: `${nm} 연습 안내 보내기`, ctx: `practice-info:${p.id}`, label: `${nm} 연습 안내`, url: `/me.html#practice/${p.id}`,
        groups: [{ id: "p", label: ids.size ? "배치된 사람" : "본 섬김 가능", people: who }],
        push: () => ({ title: `${nm} 연습 안내`, body: `${fmtDate(p.practice_date, { month: "long", day: "numeric", weekday: "short" })} ${timeRange(p.start_time, p.end_time)}에 모여요` }),
        text: () => pracMsg(p) });
    }));
    $("#pToggle")?.addEventListener("click", async () => {
      if (!mi.poll_open && !pollDays(mi).length) return toast("먼저 '수정'에서 후보 날짜를 정해 주세요");
      if (mi.poll_open) {
        const { error } = await sb.from("ministries").update({ poll_open: false }).eq("id", id);
        toast(error ? "바꾸지 못했습니다" : "취합을 마감했어요"); return renderMinistry(id);
      }
      const msg = `[찬양팀] ${mi.name} 연습 시간을 맞추려고 해요.\n${mi.poll_deadline ? fmtDate(mi.poll_deadline, { month: "long", day: "numeric", weekday: "short" }) + "까지 " : ""}${mi.poll_dates?.length ? pollDays(mi).map(md).join(", ") : `${md(mi.poll_from)}~${md(mi.poll_to)}`} 중 되는 시간을 골라 주세요.\n(본 섬김 '가능'으로 응답한 분만 보여요)\n\n${location.origin}/me.html#respond`;
      const pr = await pushRow("poll", [`poll:${id}`], `본 섬김 '가능' 응답자 ${availPeople.length}명에게 '연습 시간을 골라 주세요' 알림`);
      modal({ title: `${mi.name} 연습 가능 시간 취합 열기`, body: `${pr}${msgOnly(msg)}`, confirmLabel: "열고 문구 복사",
        onConfirm: async (close) => {
          const push = pushChecked();
          const { error } = await sb.from("ministries").update({ poll_open: true }).eq("id", id);
          if (error) throw new Error("바꾸지 못했습니다");
          await copyText(msg);
          const t = push ? await sendPush("poll", { ministry_id: id }) : "";
          close(); toast(`취합을 열었어요. 안내 문구를 복사했어요${t}`, 4000); renderMinistry(id);
        } });
    });
    $("#pNudge")?.addEventListener("click", () => openSend({ title: "연습 시간 독촉 보내기", ctx: `nudge-poll:${id}`, label: `${mi.name} 연습 시간 독촉`, url: "/me.html#respond/poll:all",
      groups: [{ id: "poll", label: "안 낸 사람", people: pollMissing }],
      push: () => ({ title: `${mi.name} 연습 시간을 아직 안 고르셨어요`, body: `${dlText(mi.poll_deadline)} 되는 칸을 눌러 주세요`.trim() }),
      text: (sel, names) => `[찬양팀] ${namesNim(names)}\n${mi.name} 연습 가능 시간을 아직 안 칠하셨어요.${mi.poll_deadline ? " " + dlText(mi.poll_deadline) : ""} 부탁드려요!\n\n${location.origin}/me.html#respond` }));
  }

  // 연습 출석: 이 사역에 배치된 사람
  function drawPracticeAtt(body, c) {
    const { mi, svs, prs, patt, today } = c;
    // 연습 대상: 그 예배에 배치된 사람 (예배 지정이 없으면 이 사역 전체)
    const peopleOf = (p) => [...new Set(svs.filter((s) => !p.service_id || s.id === p.service_id).flatMap((s) => (s.assignments || []).map((a) => a.member_id)).filter(Boolean))]
      .map(memOf).filter(Boolean).sort(byPos);
    const people = [...new Set(prs.flatMap((p) => peopleOf(p)))];
    const recOfP = (pid, mid) => patt.find((r) => r.practice_id === pid && r.member_id === mid);
    if (!prs.length) { body.innerHTML = `<div class="empty">정해진 연습이 아직 없어요. 연습 탭에서 확정해 주세요.</div>`; return; }
    if (!people.length) { body.innerHTML = `<div class="empty">배치된 사람이 아직 없어요. 배치표에서 먼저 배치해 주세요.</div>`; return; }
    body.innerHTML = `<p class="lead" style="margin:0">토요 연습과 같은 규칙이에요. 결석은 사유를 골라야 저장돼요. 객원은 출석을 따로 보지 않아요.</p>
      <div class="att-cols">${prs.map((p) => {
        const people = peopleOf(p);
        const future = p.practice_date > today;
        const rs = patt.filter((r) => r.practice_id === p.id);
        const cnt = (k) => rs.filter((r) => r.status === k).length;
        return `<section class="att-col"><div class="dcard-head"><h2>${svs.length > 1 && p.service_id ? esc(svs.find((s) => s.id === p.service_id)?.label || "") + " · " : ""}${mdw(p.practice_date)} ${hm(p.start_time)}</h2><span class="small muted">${timeRange(p.start_time, p.end_time)} · ${people.length}명</span></div>
          <div class="att-sum"><span class="chip chip-ok">출석 ${cnt("present")}</span><span class="chip chip-mid">지각 ${cnt("late")}</span><span class="chip ${cnt("absent") ? "chip-bad" : "chip-gray"}">결석 ${cnt("absent")}</span><span class="chip chip-gray">미기록 ${Math.max(people.length - rs.length, 0)}</span></div>
          ${future ? `<p class="notice ok" style="margin:0">아직 오지 않은 연습이에요. 그날부터 체크할 수 있어요.</p>` : ""}
          ${people.map((m) => {
            const r = recOfP(p.id, m.id), open = MS.open && MS.open.pid === p.id && MS.open.mid === m.id;
            return `<div class="att-row" data-p="${p.id}" data-m="${m.id}"><span class="who"><b>${esc(m.name)}</b><span>${esc(positionName(m.main_position))}${r?.status === "absent" ? ` · 결석: ${esc(reasonText(r))}` : ""}</span></span>
              <div class="seg">${ATT_KEYS.map((k) => `<button type="button" data-v="${k}" data-tone="${k}" aria-pressed="${open ? k === "absent" : r?.status === k}" ${future ? "disabled" : ""}>${ATT[k]}</button>`).join("")}</div>
              ${open ? `<div class="reason" data-reason><b class="small" style="color:var(--bad)">결석 사유를 골라 주세요</b>
                <div class="chips">${REASON_TAGS.map((t) => `<button type="button" data-tag="${t}" aria-pressed="${r?.reason_tag === t}">${t}</button>`).join("")}</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap"><input type="text" maxlength="200" data-rtext value="${esc(r?.reason || "")}" placeholder="직접 입력" style="flex:1 1 160px">
                  <button type="button" class="btn btn-primary btn-sm" data-rsave>저장</button><button type="button" class="btn btn-ghost btn-sm" data-rcancel>취소</button></div></div>` : ""}</div>`;
          }).join("")}
          ${future ? "" : `<button type="button" class="btn btn-soft btn-sm" data-pall="${p.id}" style="align-self:flex-start">남은 사람 모두 출석</button>`}</section>`;
      }).join("")}</div>`;
    const reload = () => renderMinistry(mi.id);
    body.querySelectorAll(".att-row").forEach((row) => {
      const key = { practice_id: row.dataset.p, member_id: row.dataset.m };
      const cur = recOfP(key.practice_id, key.member_id);
      row.querySelector(".seg").addEventListener("click", async (e) => {
        const b = e.target.closest("button"); if (!b || b.disabled) return;
        if (b.dataset.v === "absent" && cur?.status !== "absent") { MS.open = { pid: key.practice_id, mid: key.member_id }; return reload(); }
        MS.open = null;
        const { error } = cur?.status === b.dataset.v ? await sb.from("practice_attendance").delete().match(key)
          : await sb.from("practice_attendance").upsert({ ...key, status: b.dataset.v, reason_tag: null, reason: null });
        if (error) toast("저장하지 못했습니다");
        reload();
      });
      const box = row.querySelector("[data-reason]"); if (!box) return;
      box.querySelector(".chips").addEventListener("click", (e) => { const t = e.target.closest("[data-tag]"); if (!t) return; const on = t.getAttribute("aria-pressed") !== "true"; box.querySelectorAll("[data-tag]").forEach((x) => x.setAttribute("aria-pressed", String(on && x === t))); });
      box.querySelector("[data-rcancel]").onclick = () => { MS.open = null; reload(); };
      box.querySelector("[data-rsave]").onclick = async () => {
        const tag = box.querySelector("[data-tag][aria-pressed=true]")?.dataset.tag || null, text = box.querySelector("[data-rtext]").value.trim();
        if (!tag && !text) return toast("사유 칩을 고르거나 직접 적어 주세요");
        const { error } = await sb.from("practice_attendance").upsert({ ...key, status: "absent", reason_tag: tag, reason: text || null });
        if (error) return toast("저장하지 못했습니다");
        MS.open = null; reload();
      };
    });
    body.querySelectorAll("[data-pall]").forEach((b) => b.addEventListener("click", async () => {
      const rest = peopleOf(prs.find((p) => p.id === b.dataset.pall)).filter((m) => !recOfP(b.dataset.pall, m.id));
      if (!rest.length) return toast("모두 기록했어요");
      const { error } = await sb.from("practice_attendance").upsert(rest.map((m) => ({ practice_id: b.dataset.pall, member_id: m.id, status: "present" })));
      if (error) return toast("저장하지 못했습니다");
      toast(`${rest.length}명을 출석으로 기록했어요`); reload();
    }));
  }

  // ---------------------------------------------------------------- 설정 · 기본 시간 · 추천 기준 · 테스트 데이터
  // ================================================================ 나눔 관리 (019, 리더십)
  //  팀원 '나눔' 탭에 올라온 것을 리더십이 한눈에 보고 정리. 지금은 기도제목만 (QT · 성경읽기가 생기면 탭으로 붙임)
  //  숨기기: 팀원에게는 안 보이고(작성자 포함), 여기서 복원할 수 있어요. 작성자에게 알림은 가지 않아요
  const SH = { tab: "prayer", range: "4", week: "all", who: "all", by: "all", state: "shown", q: "" };
  const SH_PICK = new Set();
  async function renderSharing() {
    $("#content").innerHTML = `<div class="page-head"><h1 class="page-title">나눔 관리</h1></div><div class="empty">불러오는 중…</div>`;
    const thisWeek = lastSaturday(todayISO());
    const weeksBack = SH.range === "all" ? 520 : +SH.range;
    const from = addDays(thisWeek, -7 * (weeksBack - 1));
    const trendFrom = addDays(thisWeek, -7 * 7);
    const [ps, st, roster] = await Promise.all([
      sb.from("prayers").select("*").gte("week_of", SH.range === "all" ? "2000-01-01" : (from < trendFrom ? from : trendFrom)).order("created_at", { ascending: false }),
      sb.rpc("prayer_status", { p_from: from < trendFrom ? from : trendFrom }),
      sb.rpc("team_roster"),
    ]);
    if (ps.error) { $("#content").innerHTML = `<div class="empty">기도제목을 불러오지 못했어요. migration_018을 실행했는지 확인해 주세요.</div>`; return; }
    const all = ps.data || [];
    const nameOf = (id) => S.members.find((m) => m.id === id)?.name || (roster.data || []).find((m) => m.id === id)?.name || "팀원";
    const totals = new Map(((st.data || {}).weeks || []).map((w) => [w.week_of, w.total]));
    const inRange = all.filter((p) => p.week_of >= from);
    const shown = (p) => !p.hidden_at;
    // ---- 현황
    const cur = all.filter((p) => p.week_of === thisWeek && shown(p));
    const weeks = Array.from({ length: 8 }, (_, i) => addDays(thisWeek, -7 * (7 - i)));
    const perWeek = weeks.map((w) => ({ w, n: all.filter((p) => p.week_of === w && shown(p)).length, t: totals.get(w) || 0 }));
    const maxN = Math.max(1, ...perWeek.map((x) => x.n));
    const hiddenN = inRange.filter((p) => !shown(p)).length;
    // ---- 목록 (필터)
    const weekOpts = [...new Set(inRange.map((p) => p.week_of))].sort().reverse();
    if (SH.week !== "all" && !weekOpts.includes(SH.week)) SH.week = "all";
    const owners = [...new Set(inRange.map((p) => p.member_id))].map((id) => ({ id, name: nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
    if (SH.who !== "all" && !owners.some((o) => o.id === SH.who)) SH.who = "all";
    const q = SH.q.trim();
    const list = inRange.filter((p) => (SH.state === "hidden" ? !shown(p) : SH.state === "shown" ? shown(p) : true)
      && (SH.week === "all" || p.week_of === SH.week) && (SH.who === "all" || p.member_id === SH.who)
      && (SH.by === "all" || (SH.by === "self" ? !p.author_id || p.author_id === p.member_id : p.author_id && p.author_id !== p.member_id))
      && (!q || p.body.includes(q) || nameOf(p.member_id).includes(q)));
    [...SH_PICK].forEach((id) => { if (!list.some((p) => String(p.id) === id)) SH_PICK.delete(id); });
    const seg = (key, opts) => `<div class="seg" data-sh="${key}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${SH[key] === v}">${l}</button>`).join("")}</div>`;
    const row = (p) => {
      const proxy = p.author_id && p.author_id !== p.member_id;
      return `<div class="sh-row ${shown(p) ? "" : "off"} ${SH_PICK.has(String(p.id)) ? "on" : ""}" data-pid="${p.id}">
        <input type="checkbox" data-shpick="${p.id}" ${SH_PICK.has(String(p.id)) ? "checked" : ""} aria-label="${esc(nameOf(p.member_id))} 기도제목 고르기">
        <div class="sh-main"><div class="sh-hd"><b>${esc(nameOf(p.member_id))}</b>
            ${p.urgent ? `<span class="chip chip-warn">급한 기도</span>` : ""}
            ${proxy ? `<span class="chip chip-violet">${esc(nameOf(p.author_id))} 올림</span>` : `<span class="chip chip-gray">본인이 올림</span>`}
            ${shown(p) ? "" : `<span class="chip chip-bad">숨김</span>`}</div>
          <p class="sh-body">${esc(p.body)}</p>
          <span class="small muted">${md(p.week_of)} 주간 · ${fmtDateTime(p.created_at)}${p.hidden_at ? ` · ${fmtDateTime(p.hidden_at)} ${esc(nameOf(p.hidden_by))} 숨김` : ""}</span></div>
        <div class="sh-act">${shown(p) ? `<button type="button" class="btn btn-ghost btn-sm" data-shhide="${p.id}">숨기기</button>` : `<button type="button" class="btn btn-soft btn-sm" data-shshow="${p.id}">복원</button>`}</div></div>`;
    };
    $("#content").innerHTML = `<div class="page-head"><div style="display:flex;flex-direction:column;gap:4px"><h1 class="page-title">나눔 관리 <span class="chip chip-violet" style="vertical-align:6px">리더십 전용</span></h1>
        <p class="lead" style="margin:0">팀원 '나눔' 탭에 올라온 것을 한눈에 보고 정리해요. 숨긴 것은 팀원에게 안 보이고, 여기서 다시 복원할 수 있어요. 작성자에게 알림은 가지 않아요.</p></div></div>
      <div class="tabs" role="tablist"><button type="button" role="tab" data-shtab="prayer" aria-selected="true">기도</button></div>
      <div class="kpis">
        <div class="kpi" style="border-color:var(--violet-soft)"><span>이번 주 기도제목</span><b>${cur.length}개</b><small>${md(thisWeek)} 팀모임 주간</small></div>
        <div class="kpi"><span>이번 주 나눈 사람</span><b>${new Set(cur.map((p) => p.member_id)).size}명</b><small>대신 올린 것 ${cur.filter((p) => p.author_id && p.author_id !== p.member_id).length}개 · 급한 기도 ${cur.filter((p) => p.urgent).length}개</small></div>
        <div class="kpi"><span>이번 주 함께 기도</span><b>${totals.get(thisWeek) || 0}번</b><small>'기도했습니다' 누른 횟수</small></div>
        <div class="kpi"><span>숨긴 기도제목</span><b>${hiddenN}개</b><small>${SH.range === "all" ? "전체 기간" : `최근 ${SH.range}주`}</small></div>
      </div>
      <section class="panel"><h2>최근 8주 <small>막대 = 기도제목 수 · 아래 = 함께 기도 횟수</small></h2>
        <div class="sh-trend">${perWeek.map((x) => `<div class="${x.w === thisWeek ? "cur" : ""}" title="${md(x.w)} 주간 · 기도제목 ${x.n}개 · 함께 기도 ${x.t}번"><b>${x.n}</b><i style="height:${Math.max(x.n ? 6 : 2, Math.round(84 * x.n / maxN))}px"></i><span>${md(x.w)}</span><small>기도 ${x.t}</small></div>`).join("")}</div></section>
      <section class="panel" style="gap:12px">
        <div class="sh-filters">
          <div class="row"><span class="small muted" style="font-weight:700">기간</span>${seg("range", [["1", "이번 주"], ["4", "4주"], ["12", "12주"], ["all", "전체"]])}</div>
          <div class="row"><span class="small muted" style="font-weight:700">상태</span>${seg("state", [["shown", "보이는 것"], ["hidden", `숨김 ${hiddenN}`], ["any", "모두"]])}</div>
          <div class="row"><span class="small muted" style="font-weight:700">올린 방식</span>${seg("by", [["all", "전체"], ["self", "본인이 올림"], ["proxy", "나눔 리더가 대신"]])}</div>
          <div class="row">
            <select class="select" id="shWeek" aria-label="주차"><option value="all">모든 주차</option>${weekOpts.map((w) => `<option value="${w}" ${SH.week === w ? "selected" : ""}>${md(w)} 주간 · ${inRange.filter((p) => p.week_of === w).length}개</option>`).join("")}</select>
            <select class="select" id="shWho" aria-label="누구의 기도제목"><option value="all">모든 사람</option>${owners.map((o) => `<option value="${o.id}" ${SH.who === o.id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select>
            <input class="search" id="shQ" type="search" placeholder="내용·이름 검색" value="${esc(SH.q)}" aria-label="내용 검색"></div>
        </div>
        <div class="sh-bar"><label class="pillchk"><input type="checkbox" id="shAll" ${list.length && list.every((p) => SH_PICK.has(String(p.id))) ? "checked" : ""}>보이는 ${list.length}개 모두</label>
          <span class="small muted" style="flex:1">${SH_PICK.size ? `${SH_PICK.size}개 골랐어요` : "여러 개를 골라 한 번에 숨기거나 복원할 수 있어요"}</span>
          <button type="button" class="btn btn-ghost btn-sm" id="shHideN" ${[...SH_PICK].some((id) => shown(all.find((p) => String(p.id) === id) || {})) ? "" : "disabled"}>골라서 숨기기</button>
          <button type="button" class="btn btn-soft btn-sm" id="shShowN" ${[...SH_PICK].some((id) => !shown(all.find((p) => String(p.id) === id) || { hidden_at: null })) ? "" : "disabled"}>골라서 복원</button></div>
        <div class="sh-list">${list.map(row).join("") || `<div class="empty">${SH.state === "hidden" ? "숨긴 기도제목이 없어요." : "조건에 맞는 기도제목이 없어요."}</div>`}</div>
      </section>`;
    // ---- 이벤트
    $$("[data-sh]").forEach((box) => box.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; SH[box.dataset.sh] = b.dataset.v; SH_PICK.clear(); renderSharing(); }));
    $("#shWeek").onchange = (e) => { SH.week = e.target.value; renderSharing(); };
    $("#shWho").onchange = (e) => { SH.who = e.target.value; renderSharing(); };
    $("#shQ").oninput = (e) => { SH.q = e.target.value; clearTimeout(renderSharing.t); renderSharing.t = setTimeout(async () => { await renderSharing(); const i = $("#shQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 300); };
    $$("[data-shpick]").forEach((c) => c.addEventListener("change", () => { c.checked ? SH_PICK.add(c.dataset.shpick) : SH_PICK.delete(c.dataset.shpick); renderSharing(); }));
    $("#shAll").onchange = (e) => { list.forEach((p) => (e.target.checked ? SH_PICK.add(String(p.id)) : SH_PICK.delete(String(p.id)))); renderSharing(); };
    const setHidden = async (ids, hide) => {
      if (!ids.length) return;
      const { error } = await sb.from("prayers").update({ hidden_at: hide ? new Date().toISOString() : null }).in("id", ids.map(Number));
      if (error) return toast((hide ? "숨기지" : "복원하지") + " 못했어요: " + error.message, 4000);
      ids.forEach((id) => SH_PICK.delete(String(id)));
      toast(hide ? `${ids.length}개를 숨겼어요 · 팀원에게 안 보여요` : `${ids.length}개를 복원했어요`); renderSharing();
    };
    $$("[data-shhide]").forEach((b) => b.addEventListener("click", () => setHidden([b.dataset.shhide], true)));
    $$("[data-shshow]").forEach((b) => b.addEventListener("click", () => setHidden([b.dataset.shshow], false)));
    $("#shHideN").onclick = () => {
      const ids = [...SH_PICK].filter((id) => shown(all.find((p) => String(p.id) === id) || {}));
      modal({ title: `기도제목 ${ids.length}개 숨기기`, confirmLabel: "숨기기",
        body: `<p style="margin:0">팀원 '나눔' 탭에서 바로 사라져요(올린 사람에게도 안 보여요). 알림은 가지 않고, 여기 '숨김'에서 언제든 복원할 수 있어요.</p>`,
        onConfirm: async (close) => { close(); await setHidden(ids, true); } });
    };
    $("#shShowN").onclick = () => setHidden([...SH_PICK].filter((id) => !shown(all.find((p) => String(p.id) === id) || { hidden_at: null })), false);
  }

  // ================================================================ 공지 · 알림 (013)
  const NV = { tab: "send", sel: "remind", draft: null, target: "all", date: null, pick: new Set(), title: "", body: "", vote: null };
  // 016: 공지에 붙이는 투표 (기본: 하나만 · 실명 · 사흘 뒤 밤 9시 마감)
  const newVote = () => ({ on: false, options: ["", ""], multi: false, anonymous: false, date: addDays(todayISO(), 3), hour: 21 });
  const NKINDS = ["open", "minopen", "poll", "remind", "lineup", "practice", "apply", "trainee", "notice", "prayer_new", "prayer_remind", "prayer_urgent", "birthday_soon", "birthday_today", "conti_open", "conti_remind", "conti_up", "conti_edit", "sat_vote", "sat_decide", "proc"];
  const NINFO = {
    open: { who: "정식 팀원 전체", when: "리더가 월말 응답을 열 때 (확인 창에서 고름)", vars: ["월", "마감일", "이름"] },
    minopen: { who: "그 사역 응답 대상", when: "따로 받는 사역을 만들거나 응답을 다시 열 때 (확인 창에서 고름)", vars: ["사역", "마감일", "이름"] },
    poll: { who: "그 사역 본 섬김 '가능' 응답자", when: "연습 가능 시간 취합을 열 때 (확인 창에서 고름)", vars: ["사역", "마감일", "이름"] },
    remind: { who: "아직 안 끝낸 사람만", when: "", vars: ["무엇", "마감일", "남은 것", "이름"] },
    lineup: { who: "팀원 전체 (배치된 사람은 내 섬김 포함)", when: "배치표를 공개할 때 (확인 창에서 고름)", vars: ["월", "내 섬김", "이름"] },
    practice: { who: "그 예배에 배치된 사람", when: "사역 연습 시간을 확정할 때 (확인 창에서 고름)", vars: ["사역", "연습 일시"] },
    apply: { who: "리더십", when: "지원서가 들어오는 즉시", vars: ["지원자", "포지션"] },
    trainee: { who: "그 주차 나눔 리더 (안 정했으면 리더십)", when: "", vars: ["수습생", "주차"] },
    notice: { who: "공지를 쓸 때 고른 대상", when: "공지를 보낼 때", vars: ["제목", "내용", "이름"] },
    prayer_new: { who: "팀원 전체 (수습 포함)", when: "", vars: ["인원", "개수", "이름"] },
    prayer_remind: { who: "팀원 전체 (수습 포함)", when: "", vars: ["개수", "인원", "이름"] },
    prayer_urgent: { who: "올린 사람을 뺀 팀원 전체", when: "팀원이 '급한 기도'로 올릴 때", vars: ["대상", "이름"] },
    birthday_soon: { who: "리더십 (생일인 본인은 빼고)", when: "", vars: ["생일자", "며칠", "날짜", "정산", "이름"] },
    birthday_today: { who: "리더십 (생일인 본인은 빼고)", when: "", vars: ["생일자", "날짜", "정산", "이름"] },
    conti_open: { who: "그 예배 인도자 · 밴드 마스터", when: "", vars: ["예배", "마감", "인원", "이름"] },
    conti_remind: { who: "콘티를 아직 안 올린 예배의 인도자 · 밴드 마스터", when: "", vars: ["예배", "마감", "마감일", "이름"] },
    conti_up: { who: "그 예배 섬김자 (올린 사람 빼고)", when: "인도자가 콘티를 처음 올릴 때", vars: ["예배", "곡", "올린 사람", "이름"] },
    conti_edit: { who: "그 예배 섬김자 (올린 사람 빼고)", when: "올라온 콘티를 고쳐서 다시 올릴 때 (악보만 바뀌면 보내지 않아요)", vars: ["예배", "바뀐 것", "올린 사람", "이름"] },
    sat_vote: { who: "시간을 바꿀 때 고른 대상 (그 주 섬김 인원 · 배치 전이면 토요 연습 '가능' 응답자)", when: "섬김 일정에서 토요 연습 시간을 바꾸며 '가능 여부 묻기'를 고를 때", vars: ["날짜", "시간", "마감", "원래 시간", "이름"] },
    sat_decide: { who: "그 투표 대상 (투표 없이 취소하면 그 주 대상)", when: "바꾼 시간 확정 · 원래 시간으로 · 연습 취소를 고를 때 (확인 창에서 고름)", vars: ["날짜", "결정", "내용", "이름"] },
    proc: { who: "팀원 전체", when: "찬양 › 곡에서 예배 진행곡을 바꿀 때 (확인 창에서 고름)", vars: ["곡", "이름"] },
  };
  const NSAMPLE = { "월": "11월", "마감일": "10/31(토)", "사역": "원스텝", "무엇": "11월 섬김 응답", "남은 것": "3개 남았어요", "이름": "이은혜",
    "내 섬김": "11/8 싱어 리더 · 11/15 섬겨요", "연습 일시": "11/10(화) 19:00–21:00", "지원자": "이도현", "포지션": "싱어", "수습생": "이도현", "주차": "3",
    "제목": "이번 주 팀모임은 없어요", "내용": "토요 연습은 그대로 11:00에 있어요", "인원": "12", "개수": "12", "대상": "김하늘",
    "생일자": "김하늘", "며칠": "3일", "날짜": "10/23(금)", "정산": "생일선물 정산 참여 · 선물 준비해요",
    "예배": "11/8 주일", "마감": "11/4(수) 22:00", "곡": "주님 다시 오실 때까지 · 은혜 · 송축해 내 영혼", "바뀐 것": "키 A → Bb · 곡 추가: 은혜", "올린 사람": "이은혜",
    "시간": "14:00–17:00", "원래 시간": "13:00–16:00", "결정": "없어요" };
  const NDEF = {
    open: ["{월} 섬김 응답을 받고 있어요", "{마감일}까지 토요 연습·주일 가능 여부를 체크해 주세요"],
    minopen: ["{사역} 섬김 응답을 받고 있어요", "{마감일}까지 가능 여부를 체크해 주세요"],
    poll: ["{사역} 연습 시간을 골라 주세요", "{마감일}까지 · 되는 칸을 눌러 주세요"],
    remind: ["[{마감일} 마감] {무엇}", "{남은 것}. 지금 체크해 주세요"],
    lineup: ["{월} 배치표가 나왔어요", "{내 섬김}"],
    practice: ["{사역} 연습 시간이 정해졌어요", "{연습 일시}"],
    apply: ["새 지원서가 들어왔어요", "{지원자} · {포지션} · 모집에서 확인하세요"],
    trainee: ["{수습생}님 수습 {주차}주차 기록을 남겨 주세요", "오늘 나눔 내용을 적어 주세요"],
    notice: ["[공지] {제목}", "{내용}"],
    prayer_new: ["이번 주 기도제목이 올라왔어요", "{인원}명의 기도제목을 함께 품어요"],
    prayer_remind: ["오늘 저녁, 함께 기도해요", "이번 주 기도제목 {개수}개를 함께 기도해요"],
    prayer_urgent: ["급한 기도제목이 올라왔어요", "{대상}님을 위해 함께 기도해 주세요"],
    birthday_soon: ["{생일자}님 생일이 {며칠} 남았어요", "{날짜} · {정산}"],
    birthday_today: ["오늘은 {생일자}님 생일이에요", "{정산} · 축하 메시지를 보내 주세요"],
    conti_open: ["{예배} 콘티를 준비해 주세요", "{마감}까지 올려 주세요 · 섬김자 {인원}명"],
    conti_remind: ["[{마감일} 마감] {예배} 콘티", "아직 콘티가 올라오지 않았어요. {마감}까지 올려 주세요"],
    conti_up: ["{예배} 콘티가 올라왔어요", "{곡}"],
    conti_edit: ["{예배} 콘티가 수정됐어요", "{바뀐 것}"],
    sat_vote: ["[투표] {날짜} 토요 연습 시간이 바뀌었어요", "{시간}에 연습할 수 있는지 알려 주세요 · {마감} 마감"],
    sat_decide: ["{날짜} 토요 연습 {결정}", "{내용}"],
    proc: ["예배 진행곡이 바뀌었어요", "{곡}"],
  };
  const NSCHED = { remind: [{ days: 1, hour: 18 }, { days: 0, hour: 10 }], trainee: { dow: 6, hour: 18 }, prayer_new: { dow: 6, hour: 21 }, prayer_remind: { days: [2, 4], hour: 20 }, birthday_soon: { days: 3, hour: 9 }, birthday_today: { hour: 9 },
    conti_open: { days: 7, hour: 18 }, conti_remind: [{ days: 1, hour: 18 }, { days: 0, hour: 18 }] };
  const DOWN = ["주일", "월", "화", "수", "목", "금", "토"];
  const hourLabel = (h) => `${h < 12 ? "오전" : "오후"} ${h % 12 === 0 ? 12 : h % 12}시`;
  const dayLabel = (d) => (d ? `마감 ${d}일 전` : "마감 당일");
  // 서버(_notify.js fill)와 같은 규칙
  const nfill = (t, vars) => String(t || "").replace(/\{([^}]+)\}(까지)?/g, (m, k, kk) => {
    const v = vars[k]; if (v === undefined) return m; if (v === null || v === "") return "\u0000"; return v + (kk || "");
  }).replace(/\u0000\s*(·\s*)?/g, "").replace(/\s*·\s*$/, "").trim();
  const remindSched = (s) => [].concat(s?.schedule || [{ days: 1, hour: 18 }, { days: 0, hour: 10 }]);
  const whenOf = (k, s) => k === "remind" || k === "conti_remind" ? [].concat(s?.schedule ?? NSCHED[k]).map((x) => `${dayLabel(x.days)} ${hourLabel(x.hour)}`).join(" · ") || "보내는 때 없음"
    : k === "conti_open" ? `예배 ${s?.schedule?.days ?? 7}일 전 ${hourLabel(s?.schedule?.hour ?? 18)}`
    : k === "trainee" ? `매주 ${DOWN[s?.schedule?.dow ?? 6]}요일 ${hourLabel(s?.schedule?.hour ?? 18)}`
    : k === "prayer_new" ? `${DOWN[s?.schedule?.dow ?? 6]}요일 ${hourLabel(s?.schedule?.hour ?? 21)}부터 · 한 번`
    : k === "prayer_remind" ? `매주 ${([].concat(s?.schedule?.days ?? [2, 4])).map((d) => DOWN[d]).join("·") || "요일 없음"} ${hourLabel(s?.schedule?.hour ?? 20)}`
    : k === "birthday_soon" ? `생일 ${s?.schedule?.days ?? 3}일 전 ${hourLabel(s?.schedule?.hour ?? 9)}`
    : k === "birthday_today" ? `생일 당일 ${hourLabel(s?.schedule?.hour ?? 9)}`
    : NINFO[k].when.replace(/ \(.*\)$/, "");
  const kindTag = (k) => `<span class="ktag ${k}">${NOTIFY_KIND[k] || "알림"}</span>`;

  async function renderNotify() {
    const tabs = [["send", "공지 보내기"], ["votes", "투표"], ["settings", "알림 설정"], ["log", "보낸 기록"]];
    $("#content").innerHTML = `<div class="page-head"><h1 class="page-title">공지 · 알림</h1>
        <div class="row"><span class="small muted" id="myDev"></span><button type="button" class="btn btn-ghost btn-sm" id="myDevBtn" hidden></button></div></div>
      <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-ntab="${k}" aria-selected="${NV.tab === k}">${l}</button>`).join("")}</div>
      <div id="nBody" style="display:flex;flex-direction:column;gap:16px"></div>`;
    $$("[data-ntab]").forEach((b) => b.addEventListener("click", () => { NV.tab = b.dataset.ntab; renderNotify(); }));
    devLine();
    if (NV.tab === "send") return drawNotice();
    if (NV.tab === "settings") return drawNotifySettings();
    if (NV.tab === "votes") return drawVotes();
    return drawNotifyLog();
  }
  // 이 PC(브라우저)에서도 받기
  async function devLine() {
    const st = await PWA.state();
    const el = $("#myDev"), b = $("#myDevBtn"); if (!el) return;
    const T = { on: "이 브라우저에서도 알림을 받아요", off: "이 브라우저는 알림 꺼짐", denied: "이 브라우저는 알림이 차단돼 있어요", unsupported: "", install: "", inapp: "" };
    el.textContent = T[st] || "";
    if (st === "on" || st === "off") { b.hidden = false; b.textContent = st === "on" ? "끄기" : "이 브라우저에서도 받기"; }
    b.onclick = async () => {
      b.disabled = true;
      try { if (st === "on") await PWA.disable(); else await PWA.enable(); toast(st === "on" ? "알림을 껐어요" : "이 브라우저에서도 알림을 받아요"); }
      catch (e) { toast(e.message, 4000); }
      b.disabled = false; devLine();
    };
  }

  async function drawNotice() {
    const today = todayISO();
    const [subs, svs, sent] = await Promise.all([
      sb.from("push_subscriptions").select("member_id"),
      sb.from("services").select("service_date, ministry_id, label, ministries(name), assignments(member_id)").gte("service_date", today).lte("service_date", addDays(today, 56)).order("service_date"),
      sb.from("notifications").select("*").eq("kind", "notice").order("created_at", { ascending: false }).limit(10),
    ]);
    const people = S.members.filter((m) => m.is_active).sort(byPos);
    const subSet = new Set((subs.data || []).map((x) => x.member_id));
    const dates = [];
    (svs.data || []).forEach((s) => {
      let d = dates.find((x) => x.date === s.service_date);
      if (!d) dates.push(d = { date: s.service_date, names: [], ids: new Set() });
      d.names.push(s.ministry_id ? s.ministries?.name : "주일");
      (s.assignments || []).forEach((a) => a.member_id && d.ids.add(a.member_id));
    });
    if (NV.target === "date" && !dates.some((d) => d.date === NV.date)) NV.date = dates[0]?.date || null;
    const reads = sent.data?.length ? (await sb.from("notification_inbox").select("notification_id, read_at").in("notification_id", sent.data.map((n) => n.id))).data || [] : [];
    const votedN = sent.data?.length ? new Set(((await sb.from("polls").select("notification_id").in("notification_id", sent.data.map((n) => n.id))).data || []).map((x) => x.notification_id)) : new Set();
    if (!NV.vote) NV.vote = newVote();
    const VT = NV.vote;
    const recipients = () => NV.target === "all" ? people : NV.target === "lead" ? people.filter((m) => m.role === "admin")
      : NV.target === "date" ? people.filter((m) => dates.find((d) => d.date === NV.date)?.ids.has(m.id)) : people.filter((m) => NV.pick.has(m.id));
    const noSub = people.filter((m) => !subSet.has(m.id));
    const T = [["all", "전체"], ["lead", "리더십"], ["date", "특정 날짜 섬김자"], ["pick", "직접 고르기"]];

    $("#nBody").innerHTML = `<div class="ncols">
      <section class="panel"><h2>공지 보내기</h2>
        <label class="field">제목 <span class="hint">알림 첫 줄에 보여요 · 60자</span><input type="text" id="nTitle" maxlength="60" value="${esc(NV.title)}" placeholder="예: 이번 주 팀모임은 없어요"></label>
        <label class="field">내용 <span class="hint">500자</span><textarea id="nText" maxlength="500" style="min-height:96px" placeholder="예: 토요 연습은 그대로 11:00에 있어요">${esc(NV.body)}</textarea></label>
        <div class="field" role="group" aria-label="받는 사람">받는 사람
          <div class="chips2" id="nTarget">${T.map(([k, l]) => `<button type="button" data-t="${k}" aria-pressed="${NV.target === k}">${l}</button>`).join("")}</div>
          ${NV.target === "date" ? (dates.length ? `<div class="chips2" id="nDates">${dates.map((d) => `<button type="button" data-d="${d.date}" aria-pressed="${NV.date === d.date}">${mdw(d.date)} ${esc([...new Set(d.names)].join("·"))}</button>`).join("")}</div>`
            : `<span class="small muted" style="font-weight:400">앞으로 8주 안에 배치된 예배가 없어요.</span>`) : ""}
          ${NV.target === "pick" ? `<div class="pick-people" id="nPick">${people.map((m) => `<label><input type="checkbox" value="${m.id}" ${NV.pick.has(m.id) ? "checked" : ""}>${esc(m.name)} <small>${esc(POS_SHORT[m.main_position] || "")}</small></label>`).join("")}</div>` : ""}
          <span class="small" style="font-weight:400" id="nCount"></span></div>
        <section class="votebox ${VT.on ? "on" : ""}" id="vBox">
          <label class="checkrow" style="border:0;padding:0;background:none"><input type="checkbox" id="vOn" ${VT.on ? "checked" : ""}><span><b>투표 붙이기</b><small>받는 사람이 공지에서 바로 투표해요. 결과는 마감 뒤에 모두에게 공개돼요</small></span></label>
          ${VT.on ? `<div class="vopts" id="vOpts">${VT.options.map((o, i) => `<div class="vopt"><span class="vnum">${i + 1}</span><input type="text" class="input" data-vo="${i}" maxlength="40" value="${esc(o)}" placeholder="선택지 ${i + 1}" aria-label="선택지 ${i + 1}">
              ${VT.options.length > 2 ? `<button type="button" class="lu-x" data-vrm="${i}" aria-label="선택지 ${i + 1} 빼기">${XICON}</button>` : `<span></span>`}</div>`).join("")}
              ${VT.options.length < 10 ? `<button type="button" class="btn btn-ghost btn-sm" id="vAdd" style="align-self:flex-start">+ 선택지 추가</button>` : ""}</div>
            <div class="row" style="gap:6px"><label class="pillchk"><input type="checkbox" id="vMulti" ${VT.multi ? "checked" : ""}> 여러 개 고르기</label>
              <label class="pillchk"><input type="checkbox" id="vAnon" ${VT.anonymous ? "checked" : ""}> 익명</label></div>
            <div class="row" style="gap:8px;font-size:14px;font-weight:700">마감
              <input type="date" class="input" id="vDate" value="${VT.date}" min="${todayISO()}" style="width:170px;min-height:42px">
              <select class="select" id="vHour" style="width:120px;min-height:42px">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === VT.hour ? "selected" : ""}>${hourLabel(h)}</option>`).join("")}</select></div>
            <span class="small muted">마감 전까지는 각자 바꿀 수 있어요. ${VT.anonymous ? "익명이라 누가 무엇을 골랐는지는 리더십도 못 봐요 (참여 여부만 보여요)." : "결과에 누가 무엇을 골랐는지도 보여요."}</span>` : ""}
        </section>
        <div style="display:flex;flex-direction:column;gap:6px"><span class="small muted" style="font-weight:700">휴대폰에 이렇게 보여요</span>
          <div class="phone-pv"><img src="assets/icon-192.png" alt=""><span><small>Pole2 찬양팀 · 지금</small><b id="pvT"></b><span class="pb" id="pvB"></span></span></div></div>
        <button type="button" class="btn btn-primary btn-block" id="nSend">${VT.on ? "투표 공지 보내기" : "공지 보내기"}</button>
      </section>
      <div style="display:flex;flex-direction:column;gap:16px">
        <section class="panel"><h2>알림 받는 사람 <small>${people.length - noSub.length} / ${people.length}명</small></h2>
          <div class="reach"><i style="width:${people.length ? Math.round((people.length - noSub.length) / people.length * 100) : 0}%"></i></div>
          ${noSub.length ? `<p class="small" style="margin:0;line-height:1.6"><b>아직 안 켠 ${noSub.length}명</b> · ${noSub.map((m) => esc(m.name)).join(", ")}</p>` : `<p class="small" style="margin:0;color:var(--ok);font-weight:700">모두 알림을 켰어요</p>`}
          <p class="small muted" style="margin:0">알림을 안 켠 사람도 앱 안 알림함에는 공지가 남아요. 기기를 여러 개 켠 사람은 모두 받아요.</p>
          <button type="button" class="btn btn-ghost btn-sm" id="nGuide" style="align-self:flex-start">설치 안내 문구 복사 (카톡용)</button></section>
        <section class="panel"><h2>보낸 공지 <small>최근 10개 · 전체는 보낸 기록 탭</small></h2>
          <div class="sentlist">${(sent.data || []).map((n) => `<div><span class="h">${votedN.has(n.id) ? `<span class="ktag vtag">투표</span>` : ""}<b>${esc(n.title)}</b><span class="small muted">${fmtDateTime(n.created_at)}</span></span>
            ${n.body ? `<span class="small">${esc(n.body)}</span>` : ""}
            <span class="small muted">${esc(n.target_label || "")} · 푸시 ${n.pushed}명 · 읽음 ${reads.filter((r) => r.notification_id === n.id && r.read_at).length}명</span></div>`).join("") || `<span class="small muted">아직 보낸 공지가 없어요.</span>`}</div></section>
      </div></div>`;

    const preview = () => {
      NV.title = $("#nTitle").value; NV.body = $("#nText").value;
      const vd = voteDeadline();
      const v = { "제목": NV.title.trim() || "제목", "내용": VT.on ? [NV.body.trim(), `투표 · ${vd ? dlHour(vd) : "마감 일시"} 마감`].filter(Boolean).join("\n") : NV.body.trim(), "이름": "이은혜" };
      const st = NV.noticeSetting || NDEF.notice;
      $("#pvT").textContent = VT.on ? nfill(st[0], v).replace(/^\[공지\]/, "[투표]") : nfill(st[0], v); $("#pvB").textContent = nfill(st[1], v);
      const r = recipients(), on = r.filter((m) => subSet.has(m.id)).length;
      $("#nCount").innerHTML = `<b>${T.find((x) => x[0] === NV.target)[1]} ${r.length}명</b> · 알림 켠 ${on}명에게 푸시, 나머지는 알림함에만 남아요`;
    };
    if (!NV.noticeSetting) { const { data } = await sb.from("notify_settings").select("title, body").eq("kind", "notice").maybeSingle(); NV.noticeSetting = data ? [data.title, data.body] : NDEF.notice; }
    preview();
    $("#nTitle").addEventListener("input", preview); $("#nText").addEventListener("input", preview);
    $$("#nTarget [data-t]").forEach((b) => b.addEventListener("click", () => { NV.target = b.dataset.t; drawNotice(); }));
    $$("#nDates [data-d]").forEach((b) => b.addEventListener("click", () => { NV.date = b.dataset.d; drawNotice(); }));
    $("#nPick")?.addEventListener("change", (e) => { if (e.target.checked) NV.pick.add(e.target.value); else NV.pick.delete(e.target.value); preview(); });
    // 투표
    const keepVote = () => { $$("[data-vo]").forEach((el) => (VT.options[+el.dataset.vo] = el.value)); };
    $("#vOn").addEventListener("change", (e) => { keepVote(); VT.on = e.target.checked; drawNotice().then(() => VT.on && $("[data-vo]")?.focus()); });
    $$("[data-vo]").forEach((el) => el.addEventListener("input", () => { VT.options[+el.dataset.vo] = el.value; }));
    $$("[data-vo]").forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const nx = $(`[data-vo="${+el.dataset.vo + 1}"]`); if (nx) nx.focus(); else $("#vAdd")?.click(); } }));
    $("#vAdd")?.addEventListener("click", () => { keepVote(); VT.options.push(""); drawNotice().then(() => $(`[data-vo="${VT.options.length - 1}"]`)?.focus()); });
    $$("[data-vrm]").forEach((b) => b.addEventListener("click", () => { keepVote(); VT.options.splice(+b.dataset.vrm, 1); drawNotice(); }));
    $("#vMulti")?.addEventListener("change", (e) => { VT.multi = e.target.checked; });
    $("#vAnon")?.addEventListener("change", (e) => { keepVote(); VT.anonymous = e.target.checked; drawNotice(); });
    $("#vDate")?.addEventListener("change", (e) => { VT.date = e.target.value; preview(); });
    $("#vHour")?.addEventListener("change", (e) => { VT.hour = +e.target.value; preview(); });
    $("#nGuide").addEventListener("click", async () => {
      const msg = `[찬양팀] 앱으로 쓰고 알림 받기\n응답 요청 · 배치표 · 공지를 휴대폰 알림으로 받을 수 있어요.\n\n① 아래 링크를 사파리(아이폰) 또는 크롬(안드로이드)으로 열기\n   (카톡 안에서는 안 돼요: 오른쪽 아래/위 메뉴 → 다른 브라우저로 열기)\n② 공유 버튼 → '홈 화면에 추가'\n③ 홈 화면의 Pole2 아이콘으로 열고 '알림 켜기'\n\n${location.origin}/me.html#install`;
      toast((await copyText(msg)) ? "설치 안내 문구를 복사했어요" : "복사하지 못했어요");
    });
    $("#nSend").addEventListener("click", () => {
      keepVote();
      const title = NV.title.trim(), text = NV.body.trim(), r = recipients();
      if (!title) return toast(VT.on ? "제목(투표 질문)을 적어 주세요" : "제목을 적어 주세요");
      if (!r.length) return toast("받는 사람을 골라 주세요");
      const target = { type: NV.target, date: NV.date, ids: [...NV.pick] };
      let poll = null;
      if (VT.on) {
        const options = VT.options.map((x) => x.trim()).filter(Boolean), dl = voteDeadline();
        if (options.length < 2) return toast("선택지를 두 개 이상 적어 주세요");
        if (new Set(options).size !== options.length) return toast("같은 선택지가 두 번 있어요");
        if (!dl) return toast("마감 날짜를 골라 주세요");
        if (Date.parse(dl) < Date.now() + 10 * 60e3) return toast("마감은 지금부터 10분 뒤 이후로 골라 주세요");
        poll = { options, multi: VT.multi, anonymous: VT.anonymous, deadline: dl };
      }
      modal({ title: poll ? "투표 공지 보내기" : "공지 보내기", body: `<p style="margin:0"><b>${r.length}명</b>에게 보낼까요? 알림 켠 ${r.filter((m) => subSet.has(m.id)).length}명은 푸시로 바로 받아요.</p>
          <div class="phone-pv"><img src="assets/icon-192.png" alt=""><span><small>Pole2 찬양팀 · 지금</small><b>${esc($("#pvT").textContent)}</b><span class="pb">${esc($("#pvB").textContent)}</span></span></div>
          ${poll ? `<div class="note-box small" style="display:flex;flex-direction:column;gap:4px"><b>투표 · ${poll.multi ? "여러 개 고르기" : "하나만 고르기"}${poll.anonymous ? " · 익명" : ""}</b>
            <span>${poll.options.map((o, i) => `${i + 1}. ${esc(o)}`).join("<br>")}</span>
            <span class="muted">${dlHour(poll.deadline)} 마감 · 결과는 마감 뒤 공개 · 보낸 뒤에는 선택지를 바꿀 수 없어요</span></div>` : ""}`,
        confirmLabel: "보내기",
        onConfirm: async (close) => {
          const res = await api("/api/notify", { kind: "notice", title, body: text, target, ...(poll ? { poll } : {}) });
          close(); NV.title = ""; NV.body = ""; NV.vote = newVote();
          toast(`${poll ? "투표 공지를" : "공지를"} 보냈어요 · 푸시 ${res.pushed}명 / 알림함 ${res.recipients}명${res.noPushReady ? " (푸시 키 설정 필요)" : ""}`, 4000);
          if (poll) { NV.tab = "votes"; return renderNotify(); }
          drawNotice();
        } });
    });
  }

  // 투표 마감: 고른 날짜 + 시각 (한국 시간) → ISO
  const voteDeadline = () => { const V2 = NV.vote; return V2?.date ? new Date(`${V2.date}T${String(V2.hour).padStart(2, "0")}:00:00+09:00`).toISOString() : null; };
  const dlHour = (iso) => { const d = new Date(iso); const k = new Date(d.getTime() + 9 * 3600e3); const h = k.getUTCHours(), mi = k.getUTCMinutes();
    return `${mdw(k.toISOString().slice(0, 10))} ${hourLabel(h)}${mi ? " " + mi + "분" : ""}`; };
  const XICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

  // ---------------------------------------------------------------- 투표 (016)
  //  리더십은 진행 중에도 결과를 봐요. 팀원에게는 마감 뒤에 공개
  async function drawVotes() {
    const { data, error } = await sb.rpc("poll_views", { p_ids: null });
    if (error) { $("#nBody").innerHTML = `<div class="empty">투표를 불러오지 못했어요. migration_015를 실행했는지 확인해 주세요.</div>`; return console.error(error); }
    const list = data || [];
    const open = list.filter((p) => !p.ended), done = list.filter((p) => p.ended);
    const card = (p) => {
      const max = Math.max(1, ...p.options.map((o) => o.count || 0));
      const pend = (p.pending || []).map((id) => S.members.find((m) => m.id === id)).filter(Boolean);
      return `<section class="panel vcard ${p.ended ? "ended" : ""}" data-vid="${p.id}">
        <div class="vhead"><span class="chip ${p.ended ? "chip-gray" : "chip-ok"}">${p.ended ? "마감" : "진행 중"}</span>
          <b>${esc(p.question)}</b>
          <span class="small muted">${p.multi ? "여러 개" : "하나만"}${p.anonymous ? " · 익명" : ""} · ${p.ended ? (p.closed_at && Date.parse(p.closed_at) < Date.parse(p.deadline) ? dlHour(p.closed_at) + " 일찍 마감" : dlHour(p.deadline) + " 마감") : dlHour(p.deadline) + " 마감 · " + dday(new Date(Date.parse(p.deadline) + 9 * 3600e3).toISOString().slice(0, 10))}</span></div>
        <div class="vstat"><b>${p.voters}</b><span>/ ${p.targets}명 참여</span>
          <span class="reach" style="flex:1"><i style="width:${p.targets ? Math.round(100 * p.voters / p.targets) : 0}%"></i></span></div>
        <div class="vres">${p.options.map((o) => `<div class="vrow"><span class="vl">${esc(o.label)}</span>
            <span class="vbar"><i style="width:${o.count ? Math.max(4, Math.round(100 * o.count / max)) : 0}%"></i></span><b>${o.count ?? 0}</b>
            ${!p.anonymous && o.names?.length ? `<span class="vn small muted">${o.names.map(esc).join(", ")}</span>` : ""}</div>`).join("")}</div>
        ${!p.ended ? `<p class="small muted" style="margin:0">팀원에게는 마감 뒤에 결과가 보여요.${p.anonymous ? " 익명 투표라 리더십도 누가 무엇을 골랐는지는 못 봐요." : ""}</p>` : ""}
        ${pend.length ? `<div class="small" style="line-height:1.6"><b>${p.ended ? "참여 안 한" : "아직 안 한"} ${pend.length}명</b> · ${pend.map((m) => esc(m.name)).join(", ")}</div>` : p.targets ? `<span class="small" style="color:var(--ok);font-weight:700">모두 참여했어요</span>` : ""}
        ${!p.ended ? `<div class="row" style="justify-content:flex-end">
          ${pend.length ? `<button type="button" class="btn btn-soft btn-sm" data-vnudge="${p.id}">독촉 보내기</button>` : ""}
          <button type="button" class="btn btn-ghost btn-sm" data-vclose="${p.id}">지금 마감하기</button></div>` : ""}
      </section>`;
    };
    $("#nBody").innerHTML = `<p class="lead" style="margin:0">공지 보내기에서 '투표 붙이기'로 만들어요. 최근 60일 · 진행 중 ${open.length}개${done.length ? ` · 마감 ${done.length}개` : ""}</p>
      ${list.length ? `<div class="vgrid">${open.map(card).join("")}${done.map(card).join("")}</div>` : `<div class="empty">아직 만든 투표가 없어요.<br><button type="button" class="btn btn-soft btn-sm" id="vNew" style="margin-top:10px">투표 공지 만들기</button></div>`}`;
    $("#vNew")?.addEventListener("click", () => { NV.tab = "send"; NV.vote = { ...newVote(), on: true }; renderNotify(); });
    $$("[data-vclose]").forEach((b) => b.addEventListener("click", () => {
      const p = list.find((x) => x.id === +b.dataset.vclose);
      modal({ title: "투표 지금 마감하기", body: `<p style="margin:0">'${esc(p.question)}' 투표를 지금 마감할까요? ${p.voters}/${p.targets}명 참여했어요. 마감하면 팀원에게 결과가 공개되고, 다시 열 수 없어요.</p>`,
        confirmLabel: "마감하기", danger: true,
        onConfirm: async (close) => { const { error: e } = await sb.rpc("close_poll", { p_poll: p.id }); if (e) throw new Error(e.message); close(); toast("투표를 마감했어요. 결과가 공개됐어요"); drawVotes(); } });
    }));
    $$("[data-vnudge]").forEach((b) => b.addEventListener("click", () => {
      const p = list.find((x) => x.id === +b.dataset.vnudge);
      const pend = (p.pending || []).map((id) => S.members.find((m) => m.id === id)).filter(Boolean);
      const what = `'${p.question}' 투표`;
      openSend({ title: "투표 독촉 보내기", ctx: `votenudge:${p.id}`, label: `${what} 독촉`, url: `/me.html#alerts/${p.notification_id}`,
        groups: [{ id: "vote", label: "아직 안 한 사람", people: pend }],
        push: () => ({ title: `${what}에 아직 참여하지 않았어요`, body: `${dlHour(p.deadline)} 마감이에요. 한 번만 눌러 주세요!` }),
        text: (sel, names) => `[찬양팀] ${namesNim(names)}\n${what}에 아직 참여하지 않았어요. ${dlHour(p.deadline)} 마감이에요!\n\n${location.origin}/me.html#alerts/${p.notification_id}`,
        after: () => drawVotes() });
    }));
  }

  async function drawNotifySettings() {
    const { data } = await sb.from("notify_settings").select("*");
    const rows = Object.fromEntries((data || []).map((r) => [r.kind, r]));
    const cur = (k) => rows[k] || { kind: k, enabled: true, title: NDEF[k][0], body: NDEF[k][1], schedule: NSCHED[k] ? JSON.parse(JSON.stringify(NSCHED[k])) : null };
    if (!NV.draft || NV.draft.kind !== NV.sel) NV.draft = JSON.parse(JSON.stringify(cur(NV.sel)));
    const d = NV.draft, k = d.kind, info = NINFO[k];
    const dirty = JSON.stringify(d) !== JSON.stringify(cur(k));
    const hours = (sel) => Array.from({ length: 16 }, (_, i) => i + 7).map((h) => `<option value="${h}" ${h === sel ? "selected" : ""}>${hourLabel(h)}</option>`).join("");
    let whenHTML;
    if (k === "remind" || k === "conti_remind") {
      const sc = [].concat(d.schedule || []);
      whenHTML = [0, 1].map((i) => { const x = sc[i]; return `<div class="row" style="font-size:14px">
          <label class="row" style="gap:6px;font-weight:700"><input type="checkbox" data-sc-on="${i}" ${x ? "checked" : ""} style="width:18px;height:18px;accent-color:var(--violet)">${i ? "두 번째" : "첫 번째"}</label>
          <select data-sc-days="${i}" ${x ? "" : "disabled"} aria-label="며칠 전">${[0, 1, 2, 3].map((n) => `<option value="${n}" ${x?.days === n ? "selected" : ""}>${dayLabel(n)}</option>`).join("")}</select>
          <select data-sc-hour="${i}" ${x ? "" : "disabled"} aria-label="시각">${hours(x?.hour ?? 18)}</select></div>`; }).join("")
        + (k === "remind" ? `<span class="small muted">월말 응답 · 따로 받는 사역 응답 · 연습 시간 취합 · 공지 투표 마감에 모두 적용돼요. 마감일을 정해 둔 것만 보내요. 같은 알림은 한 번만 가요.</span>`
          : `<span class="small muted">콘티 마감(찬양 › 콘티에서 정함) 기준이에요. 콘티가 이미 올라온 예배에는 보내지 않아요.</span>`);
    } else if (k === "conti_open") {
      const sc = d.schedule || NSCHED.conti_open;
      whenHTML = `<div class="row" style="font-size:14px"><span>예배</span>
          <select id="scBd" aria-label="며칠 전">${[3, 4, 5, 6, 7, 10, 14].map((n) => `<option value="${n}" ${sc.days === n ? "selected" : ""}>${n}일 전</option>`).join("")}</select>
          <select id="scHour" aria-label="시각">${hours(sc.hour)}</select></div>
        <span class="small muted">배치표가 공개된 예배만 보내요. 그때 이미 콘티가 올라왔으면 보내지 않아요.</span>`;
    } else if (k === "trainee") {
      const sc = d.schedule || { dow: 6, hour: 18 };
      whenHTML = `<div class="row" style="font-size:14px"><span>수습 주차마다</span>
          <select id="scDow" aria-label="요일">${DOWN.map((w, i) => `<option value="${i}" ${sc.dow === i ? "selected" : ""}>${w}요일</option>`).join("")}</select>
          <select id="scHour" aria-label="시각">${hours(sc.hour)}</select><span>에 그 주차 기록이 비어 있으면</span></div>`;
    } else if (k === "prayer_new") {
      const sc = d.schedule || NSCHED.prayer_new;
      whenHTML = `<div class="row" style="font-size:14px"><span>기도 주간(토요일 팀모임부터)마다</span>
          <select id="scDow" aria-label="요일">${DOWN.map((w, i) => `<option value="${i}" ${sc.dow === i ? "selected" : ""}>${w}요일</option>`).join("")}</select>
          <select id="scHour" aria-label="시각">${hours(sc.hour)}</select><span>부터</span></div>
        <span class="small muted">그때까지 올라온 기도제목이 있으면 한 번 보내요. 없으면 하루 동안 기다렸다가 올라오는 대로 보내요.</span>`;
    } else if (k === "prayer_remind") {
      const sc = d.schedule || NSCHED.prayer_remind, days = [].concat(sc.days || []);
      whenHTML = `<div class="row" style="font-size:14px"><span>매주</span>
          <span class="chips2" id="scDays">${DOWN.map((w, i) => `<button type="button" data-day="${i}" aria-pressed="${days.includes(i)}">${w}</button>`).join("")}</span>
          <select id="scHour" aria-label="시각">${hours(sc.hour)}</select></div>
        <span class="small muted">이번 주 기도제목이 하나도 없으면 보내지 않아요.</span>`;
    } else if (k === "birthday_soon" || k === "birthday_today") {
      const sc = d.schedule || NSCHED[k];
      whenHTML = `<div class="row" style="font-size:14px"><span>생일</span>
          ${k === "birthday_soon" ? `<select id="scBd" aria-label="며칠 전">${[1, 2, 3, 4, 5, 7].map((n) => `<option value="${n}" ${sc.days === n ? "selected" : ""}>${n}일 전</option>`).join("")}</select>` : `<span>당일</span>`}
          <select id="scHour" aria-label="시각">${hours(sc.hour)}</select></div>
        <span class="small muted">생년월일이 들어 있는 활동 중인 멤버만 보내요 (양력 · 2/29 생일은 평년이면 2/28). 생일인 리더십 본인에게는 안 가요.</span>`;
    } else whenHTML = `<span class="small" style="font-weight:400">${esc(info.when)}에 바로 보내요.</span>`;

    $("#nBody").innerHTML = `<section class="card bordered warnset"><div><b>다시 보내기 경고</b><span class="small muted">'보내기' 창에서 같은 안내를 이 시간 안에 받은 사람에게 다시 보내려고 하면 경고해요. 0이면 경고하지 않아요.</span></div>
        <label class="row" style="gap:6px;font-weight:700"><input type="number" id="warnH" min="0" max="168" step="1" value="${warnHours()}" class="input" style="width:88px;min-height:40px"> 시간</label>
        <button type="button" class="btn btn-ghost btn-sm" id="warnSave">저장</button></section>
      <div class="nset">
      <nav class="nlist" aria-label="알림 종류">${NKINDS.map((x) => { const r = x === k ? d : cur(x); return `<button type="button" data-nk="${x}" aria-current="${x === k}">
        <span><b>${NOTIFY_NAME[x]}</b><small>${esc(whenOf(x, r))}</small></span><span class="onoff ${r.enabled ? "" : "off"}">${r.enabled ? "켬" : "끔"}</span></button>`; }).join("")}</nav>
      <section class="panel">
        <div class="devrow"><span><h2 style="display:block">${NOTIFY_NAME[k]}</h2><span class="small muted">받는 사람 · ${esc(info.who)}</span></span>
          <span class="small" style="font-weight:700;flex:none">${d.enabled ? "보내요" : "안 보내요"}</span>
          <button type="button" class="switch" role="switch" id="nOn" aria-checked="${d.enabled}" aria-label="이 알림 보내기"></button></div>
        ${k === "notice" && !d.enabled ? `<p class="notice warn" style="margin:0">꺼 두면 공지는 알림함에만 남고 푸시는 안 가요.</p>` : ""}
        <div class="whenbox"><b class="small">보내는 때</b>${whenHTML}</div>
        <label class="field">제목<input type="text" id="nsT" maxlength="80" value="${esc(d.title)}"></label>
        <label class="field">내용<textarea id="nsB" maxlength="300" style="min-height:70px">${esc(d.body)}</textarea></label>
        <div class="row"><span class="small muted" style="font-weight:700">넣을 수 있는 말</span>
          ${info.vars.map((v) => `<button type="button" class="varbtn" data-var="${v}" title="예: ${esc(NSAMPLE[v])}">{${v}}</button>`).join("")}
          <span class="small muted">누르면 마지막으로 누른 칸(제목·내용)에 들어가요</span></div>
        <div style="display:flex;flex-direction:column;gap:6px"><span class="small muted" style="font-weight:700">미리보기 · 예시 값</span>
          <div class="phone-pv"><img src="assets/icon-192.png" alt=""><span><small>Pole2 찬양팀 · ${NSCHED[k] ? "예약" : "지금"}</small><b id="nsPT"></b><span class="pb" id="nsPB"></span></span></div></div>
        <div class="row" style="justify-content:flex-end">${dirty ? `<span class="small" style="color:var(--warn);font-weight:700;margin-right:auto">저장 안 한 변경이 있어요</span>` : ""}
          <button type="button" class="btn btn-ghost" id="nsReset">기본 문구로</button>
          <button type="button" class="btn btn-ghost" id="nsTest">나에게 테스트</button>
          <button type="button" class="btn btn-primary" id="nsSave">저장</button></div>
      </section></div>`;

    $("#warnSave").addEventListener("click", async () => {
      const h = Math.round(+$("#warnH").value);
      if (!(h >= 0 && h <= 168)) return toast("0~168 사이로 적어 주세요");
      const { error } = await sb.from("team_settings").update({ resend_warn_hours: h }).eq("id", 1);
      if (error) return toast("저장하지 못했어요: " + error.message, 4000);
      S.settings = await loadSettings(true);
      toast(h ? `같은 안내를 ${h}시간 안에 다시 보내면 경고해요` : "다시 보내기 경고를 껐어요");
    });
    const pv = () => {
      const v = k === "remind" ? { ...NSAMPLE, "마감일": "내일" } : NSAMPLE;
      $("#nsPT").textContent = nfill(d.title, v) || " "; $("#nsPB").textContent = nfill(d.body, v);
    };
    pv();
    let lastField = "nsB";
    $("#nsT").addEventListener("focus", () => (lastField = "nsT")); $("#nsB").addEventListener("focus", () => (lastField = "nsB"));
    $("#nsT").addEventListener("input", (e) => { d.title = e.target.value; pv(); });
    $("#nsB").addEventListener("input", (e) => { d.body = e.target.value; pv(); });
    $$("[data-var]").forEach((b) => b.addEventListener("click", () => {
      const el = $("#" + lastField), tag = `{${b.dataset.var}}`;
      const a = el.selectionStart ?? el.value.length, z = el.selectionEnd ?? el.value.length;
      el.value = el.value.slice(0, a) + tag + el.value.slice(z);
      if (lastField === "nsT") d.title = el.value; else d.body = el.value;
      el.focus(); el.setSelectionRange(a + tag.length, a + tag.length); pv();
    }));
    $$("[data-nk]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.nk === k) return;
      const go = () => { NV.sel = b.dataset.nk; NV.draft = null; drawNotifySettings(); };
      if (JSON.stringify(d) !== JSON.stringify(cur(k))) return modal({ title: "저장하지 않고 넘어갈까요?", body: `<p style="margin:0">${NOTIFY_NAME[k]}에서 바꾼 내용이 사라져요.</p>`, confirmLabel: "넘어가기", onConfirm: async (close) => { close(); go(); } });
      go();
    }));
    $("#nOn").addEventListener("click", () => { d.enabled = !d.enabled; drawNotifySettings(); });
    const sched = () => {
      if (k === "remind" || k === "conti_remind") d.schedule = [0, 1].filter((i) => $(`[data-sc-on="${i}"]`).checked).map((i) => ({ days: +$(`[data-sc-days="${i}"]`).value, hour: +$(`[data-sc-hour="${i}"]`).value }));
      if (k === "trainee" || k === "prayer_new") d.schedule = { dow: +$("#scDow").value, hour: +$("#scHour").value };
      if (k === "prayer_remind") d.schedule = { days: $$("#scDays [aria-pressed=true]").map((b) => +b.dataset.day), hour: +$("#scHour").value };
      if (k === "birthday_soon" || k === "conti_open") d.schedule = { days: +$("#scBd").value, hour: +$("#scHour").value };
      if (k === "birthday_today") d.schedule = { hour: +$("#scHour").value };
    };
    $$("[data-sc-on], [data-sc-days], [data-sc-hour], #scDow, #scHour, #scBd").forEach((el) => el.addEventListener("change", () => { sched(); drawNotifySettings(); }));
    $$("#scDays [data-day]").forEach((b) => b.addEventListener("click", () => { b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); sched(); drawNotifySettings(); }));
    $("#nsReset").addEventListener("click", () => { d.title = NDEF[k][0]; d.body = NDEF[k][1]; drawNotifySettings(); });
    $("#nsTest").addEventListener("click", async (e) => {
      if (!d.title.trim()) return toast("제목을 적어 주세요");
      e.currentTarget.disabled = true;
      try { const r = await api("/api/notify", { kind: "test", test_kind: k, title: d.title, body: d.body });
        toast(r.noPushReady ? "알림함에 넣었어요 (푸시 키 설정 필요)" : r.pushed ? "내 기기로 테스트 알림을 보냈어요" : "알림함에 넣었어요. 이 계정으로 알림을 켠 기기가 없어서 푸시는 안 갔어요", 4500); }
      catch (err) { toast(err.message, 4000); }
      if ($("#nsTest")) $("#nsTest").disabled = false;
    });
    $("#nsSave").addEventListener("click", async () => {
      if (!d.title.trim()) return toast("제목을 적어 주세요");
      if ((k === "remind" || k === "conti_remind") && d.enabled && !d.schedule.length) return toast("보내는 때를 하나 이상 골라 주세요");
      if (k === "prayer_remind" && d.enabled && !d.schedule.days.length) return toast("요일을 하나 이상 골라 주세요");
      if ((k === "remind" || k === "conti_remind") && d.schedule.length === 2 && d.schedule[0].days === d.schedule[1].days && d.schedule[0].hour === d.schedule[1].hour) return toast("두 번이 같은 때예요. 다르게 골라 주세요");
      const { error } = await sb.from("notify_settings").upsert({ kind: k, enabled: d.enabled, title: d.title.trim(), body: d.body.trim(), schedule: d.schedule ?? null });
      if (error) return toast("저장하지 못했어요: " + error.message, 4000);
      toast(`${NOTIFY_NAME[k]} 설정을 저장했어요`); NV.draft = null; if (k === "notice") NV.noticeSetting = null; drawNotifySettings();
    });
  }

  async function drawNotifyLog() {
    const { data } = await sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(60);
    const list = data || [];
    const reads = list.length ? (await sb.from("notification_inbox").select("notification_id, read_at").in("notification_id", list.map((n) => n.id))).data || [] : [];
    $("#nBody").innerHTML = `<p class="lead" style="margin:0">최근 60개. 푸시 = 휴대폰으로 간 사람, 알림함 = 앱 안 알림 목록에 남은 사람이에요.</p>
      <section class="panel"><div class="sentlist">${list.map((n) => `<div><span class="h">${kindTag(n.kind)}<b>${esc(n.title)}</b><span class="small muted">${fmtDateTime(n.created_at)}</span></span>
          ${n.body ? `<span class="small">${esc(n.body)}</span>` : ""}
          <span class="small muted">${esc(n.target_label || "")} · 푸시 ${n.pushed}명 · 알림함 ${n.recipients}명 · 읽음 ${reads.filter((r) => r.notification_id === n.id && r.read_at).length}명${n.created_by ? " · " + esc(memberName(n.created_by)) : " · 자동"}</span></div>`).join("")
        || `<span class="small muted">아직 보낸 알림이 없어요.</span>`}</div></section>`;
  }

  async function renderSettings() {
    $("#content").innerHTML = `<div class="page-head"><h1 class="page-title">설정</h1></div><div class="empty">불러오는 중…</div>`;
    let st = { members: 0, applications: 0, password: "" };
    try { st = await api("/api/demo", { action: "status" }); } catch (e) { toast(e.message); }
    const has = st.members + st.applications > 0;
    const set = S.settings;
    let order = (set.rec_order || ["skill", "balance", "consecutive", "gender"]).slice();
    const orderHTML = () => order.map((k, i) => `<div class="ordrow"><span class="n">${i + 1}</span><span><b>${REC_LABEL[k][0]}</b><br><span class="small muted">${REC_LABEL[k][1]}</span></span>
      <span class="row" style="gap:4px"><button type="button" class="btn btn-ghost btn-sm" data-up="${i}" ${i ? "" : "disabled"} aria-label="${REC_LABEL[k][0]} 위로">↑</button><button type="button" class="btn btn-ghost btn-sm" data-down="${i}" ${i < order.length - 1 ? "" : "disabled"} aria-label="${REC_LABEL[k][0]} 아래로">↓</button></span></div>`).join("");
    // 020: 마지막 자동 백업
    const { data: bks } = await sb.from("backup_log").select("*").order("at", { ascending: false }).limit(1);
    const bk = bks?.[0], bkAge = bk ? Math.floor((Date.now() - Date.parse(bk.at)) / 864e5) : null;
    const bkChip = !bk ? `<span class="chip chip-warn">백업 기록 없음</span>`
      : !bk.ok ? `<span class="chip chip-bad">마지막 백업 실패 · ${fmtDate(bk.at, { month: "numeric", day: "numeric" })}</span>`
      : bkAge > 8 ? `<span class="chip chip-warn">마지막 백업 ${bkAge}일 전</span>`
      : `<span class="chip chip-ok">마지막 백업 ${fmtDateTime(bk.at)}${bk.size_bytes ? " · " + sizeText(bk.size_bytes) : ""}</span>`;
    const owner = ownerOf();
    const heirs = S.members.filter((m) => m.is_active && m.status === "active" && m.id !== S.me.id).sort((a, b) => (a.role === "admin" ? 0 : 1) - (b.role === "admin" ? 0 : 1) || a.name.localeCompare(b.name, "ko"));
    $("#content").innerHTML = `
      <div class="page-head"><h1 class="page-title">설정</h1></div>
      <section class="card bordered" style="display:flex;flex-direction:column;gap:12px" id="ownerCard">
        <h2 style="font-size:17px;font-weight:800">최상위 리더십</h2>
        <div class="owner-row"><span class="chip chip-owner">최상위 리더십</span><b>${esc(owner?.name || "아직 없음")}</b>
          <span class="small muted" style="flex:1 1 260px">리더십 지정·해제와 초기화는 이 사람만 할 수 있어요. 이 계정은 본인만 휴면·탈퇴·비밀번호·이메일을 바꿀 수 있어요.</span>
          ${isOwner() ? `<button type="button" class="btn btn-ghost btn-sm" id="ownerGive">넘기기</button>` : ""}</div>
        ${!owner ? `<p class="notice warn" style="margin:0">최상위 리더십이 정해져 있지 않아요. Supabase SQL Editor에서 <code>update members set is_owner = true where email = '이메일';</code>로 정해 주세요.</p>` : ""}
      </section>
      <section class="card bordered" id="safeCard" style="display:flex;flex-direction:column;gap:12px">
        <h2 style="font-size:17px;font-weight:800">백업 · 변경 기록</h2>
        <div class="owner-row">${bkChip}
          <span class="small muted" style="flex:1 1 260px">${bk ? "매주 일요일 새벽, GitHub이 데이터 전체를 암호화해서 백업해요 (90일 보관)." : "자동 백업이 아직 한 번도 돌지 않았어요. 업데이트 안내(UPDATE-020)의 '백업 설정'을 따라 GitHub에 설정해 주세요."}</span></div>
        <div class="owner-row"><b style="font-size:15px">변경 기록</b>
          <span class="small muted" style="flex:1 1 260px">누가 언제 무엇을 바꿨는지 1년 동안 남아요. 실수로 지운 출석 · 배치 · 메모는 여기서 되살릴 수 있어요.</span>
          <a class="btn btn-ghost btn-sm" href="#audit">변경 기록 보기</a></div>
      </section>
      <div class="two">
        <section class="card bordered" style="display:flex;flex-direction:column;gap:14px">
          <h2 style="font-size:17px;font-weight:800">기본 시간</h2>
          <div class="field"><span>토요 연습 <span class="hint">· 사전 모임 30분 포함</span></span><div class="row"><input type="time" id="sA" value="${hm(set.sat_practice_start)}" class="input" style="width:auto"><span>–</span><input type="time" id="sB" value="${hm(set.sat_practice_end)}" class="input" style="width:auto"></div></div>
          <div class="field"><span>주일 섬김</span><div class="row"><input type="time" id="sC" value="${hm(set.sunday_start)}" class="input" style="width:auto"><span>–</span><input type="time" id="sD" value="${hm(set.sunday_end)}" class="input" style="width:auto"></div></div>
          <p class="small muted" style="margin:0">날짜별로 바꾼 시간은 '섬김 일정'에서 그날 시간을 눌러 고쳐요.</p>
          <button type="button" class="btn btn-primary btn-sm" id="sTimeSave" style="align-self:flex-start">기본 시간 저장</button>
        </section>
        <section class="card bordered" style="display:flex;flex-direction:column;gap:12px">
          <h2 style="font-size:17px;font-weight:800">배치 추천 기준</h2>
          <p class="small muted" style="margin:0">위에 있을수록 더 크게 반영돼요.</p>
          <div class="ordrow lock"><span class="n">🔒</span><span><b>반드시 지킴</b><br><span class="small muted">주일은 토요 연습·주일 모두 가능, 사역은 그 예배 가능 · 본인 포지션 · 하루 한 자리 · 다른 파트 탭에 들어간 사람은 고정 · 남녀 최소 1명씩</span></span></div>
          <div id="ordList" style="display:flex;flex-direction:column;gap:8px">${orderHTML()}</div>
          <div class="row"><span class="small" style="font-weight:700">골고루 기본값</span><div class="seg" id="sBasis"><button type="button" data-v="month" aria-pressed="${set.rec_basis === "month"}">이번 달</button><button type="button" data-v="quarter" aria-pressed="${set.rec_basis === "quarter"}">최근 3개월</button></div></div>
          <div class="row"><button type="button" class="btn btn-ghost btn-sm" id="sRecReset">기본값으로</button><button type="button" class="btn btn-primary btn-sm" id="sRecSave">저장</button></div>
        </section>
      </div>
      <section class="card bordered" id="posCard" style="display:flex;flex-direction:column;gap:12px">
        <h2 style="font-size:17px;font-weight:800">포지션별 인원</h2>
        <p class="small muted" style="margin:0">자동 추천은 <b>기본</b> 인원까지 채우고, 비어 있으면 공석(X)으로 보여요. <b>최대</b> 인원까지는 그 주에 필요할 때 배치표에서 직접 더 넣어요(추가 자리). 주일 · 사역 모두 같아요.</p>
        <div style="overflow-x:auto"><table class="fc-table set pos-set"><thead><tr><th class="l">포지션</th><th>기본</th><th>최대</th><th class="l">배치표</th></tr></thead>
          <tbody>${(window.__allPositions || []).map((p) => `<tr data-pos="${p.code}"><td class="l"><b>${esc(p.name)}</b></td>
            <td><select class="select" id="pB_${p.code}" aria-label="${esc(p.name)} 기본 인원">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option ${n === baseOf(p) ? "selected" : ""}>${n}</option>`).join("")}</select></td>
            <td><select class="select" id="pM_${p.code}" aria-label="${esc(p.name)} 최대 인원">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option ${n === p.max_count ? "selected" : ""}>${n}</option>`).join("")}</select></td>
            <td class="l small muted" data-pos-txt></td></tr>`).join("")}</tbody></table></div>
        <button type="button" class="btn btn-primary btn-sm" id="sPosSave" style="align-self:flex-start">포지션 인원 저장</button>
      </section>
      <section class="card bordered" style="display:flex;flex-direction:column;gap:14px">
        <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px">
          <h2 style="font-size:17px;font-weight:800">리더십 테스트 데이터</h2>
          <span class="chip ${has ? "chip-mid" : "chip-gray"}">${has ? `테스트 팀원 ${st.members}명 · 지원서 ${st.applications}건 있음` : "없음"}</span>
        </div>
        <p style="margin:0">실제 운영 전에 리더십이 기능을 눌러볼 수 있도록 가상의 팀원·지원자·응답·배치표를 만들어요.
          이름 끝에 <b>(T)</b>, 이메일은 <b>@pole2.test</b>로 표시되고, <b>모두 지우기</b>는 이 표시가 있는 데이터만 지워요.</p>
        <div class="grid2" style="font-size:14px">
          <div class="card" style="background:var(--bg)"><b>만들어지는 것</b><ul style="margin:6px 0 0;padding-left:18px;line-height:1.8">
            <li>정식 팀원 11명 + 휴면 1명 (포지션·멀티 포지션·숙련도 포함)</li>
            <li>지원자: 접수 2 · 면접 1 · 수습 3주차 1 · 재가입 면담 1 · 종료 2 (그중 1건은 3개월 지난 일괄 삭제 대상)</li>
            <li>다음 달 섬김 응답 (열린 상태, 미응답자 포함)</li>
            <li>지난 4주 + 이번 달 남은 주일 배치표 (공개 상태)</li>
            <li>지난 8주 출석 (연습·팀모임·주일 리허설, 결석 사유·연속 결석·지각 사례 포함)</li>
            <li>객원 1명 · 다음 달 사역 '원스텝(T)'(예배 1개)과 '수련회(T)'(예배 3개) — 연습 시간 취합 중, 몇 명 골라 둠</li></ul></div>
          <div class="card" style="background:var(--bg)"><b>폰으로 로그인해 보기</b><ul style="margin:6px 0 0;padding-left:18px;line-height:1.8">
            <li>팀원: <b>demo02@pole2.test</b> (김하늘(T))</li>
            <li>수습생: <b>trainee1@pole2.test</b> (노새벽(T))</li>
            <li>비밀번호: <b>${esc(st.password || "pole2test!")}</b></li></ul></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="demoSeed" ${has ? "disabled" : ""}>테스트 데이터 만들기</button>
          <button type="button" class="btn btn-danger" id="demoClear" ${has ? "" : "disabled"}>테스트 데이터 모두 지우기</button>
        </div>
        <p class="small muted" style="margin:0">실제 운영을 시작하기 전에 꼭 지워 주세요. 테스트 중 리더십이 직접 만든 지원서·계정은 @pole2.test 이메일을 쓰면 함께 지워져요.</p>
      </section>
      <section class="card bordered danger-zone">
        <h2 style="font-size:17px;font-weight:800">초기화</h2>
        <p style="margin:0">정식 운영을 시작하기 전에 지금까지 쌓인 데이터를 한 번에 비워요. 되돌릴 수 없어요.</p>
        <div class="grid2" style="font-size:14px">
          <div class="card" style="background:var(--bad-bg)"><b>지워요</b><ul style="margin:6px 0 0;padding-left:18px;line-height:1.8">
            <li>관리자가 아닌 멤버 전원 (계정 포함)</li><li>섬김 일정 · 사역 · 응답 · 배치표 · 출석</li><li>객원 · 탈퇴 기록</li>
            <li>지원 · 면접 · 수습 기록</li><li>보낸 알림 · 공지 기록</li></ul></div>
          <div class="card" style="background:var(--ok-bg)"><b>남겨요</b><ul style="margin:6px 0 0;padding-left:18px;line-height:1.8">
            <li>관리자(리더십) 계정과 정보 · 관리자 본인 지원서</li><li>기본 시간 · 추천 기준 · 알림 설정</li><li>안내 문구 · 서약서</li></ul></div>
        </div>
        ${isOwner() || !owner ? `<button type="button" class="btn btn-bad" id="resetAll" style="align-self:flex-start">초기화</button>`
          : `<span class="lockline">초기화는 최상위 리더십(${esc(owner.name)})만 할 수 있어요</span>`}
      </section>`;
    $("#ownerGive")?.addEventListener("click", () => modal({
      title: "최상위 리더십 넘기기", danger: true, confirmLabel: "넘기기",
      body: `<p style="margin:0">넘기면 받는 사람이 최상위 리더십이 되고, 나는 일반 리더십이 돼요. 되돌리려면 받은 사람이 다시 넘겨 줘야 해요.</p>
        <label class="field">받는 사람<select class="select" id="ogTo"><option value="">고르기</option>${heirs.map((m) => `<option value="${m.id}">${esc(m.name)}${m.role === "admin" ? " · 리더십" : ""}</option>`).join("")}</select>
          <span class="hint">리더십이 아니면 리더십으로 함께 지정돼요.</span></label>
        <label class="field">내 비밀번호<input type="password" id="ogPw" autocomplete="current-password"><span class="hint">본인 확인을 위해 다시 입력해 주세요.</span></label>`,
      onInput: () => { const ok = $("#mOk"); if (ok) ok.disabled = !$("#ogTo").value || !$("#ogPw").value; },
      onConfirm: async (close) => {
        const r = await api("/api/members-bulk", { action: "transfer-owner", to: $("#ogTo").value, password: $("#ogPw").value });
        S.me.is_owner = false; await loadAll(); close();
        toast(`최상위 리더십을 ${r.name}님에게 넘겼어요`, 4000); renderSettings();
      } }));
    $("#sTimeSave").onclick = async () => {
      const v = { sat_practice_start: $("#sA").value, sat_practice_end: $("#sB").value, sunday_start: $("#sC").value, sunday_end: $("#sD").value };
      if (!(v.sat_practice_end > v.sat_practice_start && v.sunday_end > v.sunday_start)) return toast("끝나는 시간이 시작보다 늦어야 해요");
      const { error } = await sb.from("team_settings").update(v).eq("id", 1);
      if (error) return toast("저장하지 못했습니다");
      S.settings = await loadSettings(true); toast("기본 시간을 저장했어요");
    };
    // 019: 포지션별 기본 / 최대 인원
    const posTxt = () => $$("#posCard tr[data-pos]").forEach((tr) => {
      const c = tr.dataset.pos, b = +$("#pB_" + c).value, m = +$("#pM_" + c).value;
      tr.querySelector("[data-pos-txt]").textContent = b > m ? "기본이 최대보다 많아요" : b === 0 ? `선택 포지션 · 필요할 때 ${m}자리까지 직접` : m > b ? `${b}자리 + 추가 자리 ${m - b}` : `${b}자리`;
      tr.querySelector("[data-pos-txt]").style.color = b > m ? "var(--bad)" : "";
    });
    $("#posCard").addEventListener("change", posTxt); posTxt();
    $("#sPosSave").onclick = async () => {
      const P = window.__allPositions || [];
      const want = P.map((p) => ({ p, b: +$("#pB_" + p.code).value, m: +$("#pM_" + p.code).value }));
      if (want.some((x) => x.b > x.m)) return toast("기본 인원은 최대 인원보다 많을 수 없어요", 3500);
      const changed = want.filter((x) => x.b !== baseOf(x.p) || x.m !== x.p.max_count);
      if (!changed.length) return toast("바뀐 게 없어요");
      // 줄이는 최대 인원보다 뒷자리에 이미 배치된 예배(오늘 이후)가 있으면 막음
      const lower = changed.filter((x) => x.m < x.p.max_count);
      if (lower.length) {
        const { data: used } = await sb.from("assignments").select("position_code, slot, services!inner(service_date, label, ministry_id)").in("position_code", lower.map((x) => x.p.code)).gte("services.service_date", todayISO());
        const over = (used || []).filter((a) => a.slot > lower.find((x) => x.p.code === a.position_code).m);
        if (over.length) return toast(`${[...new Set(over.map((a) => `${md(a.services.service_date)} ${POS_SHORT[a.position_code] || a.position_code} ${a.slot}`))].slice(0, 4).join(", ")} 자리에 배치돼 있어요. 배치표에서 먼저 빼 주세요`, 5000);
      }
      for (const x of changed) {
        const { error } = await sb.from("positions").update({ base_count: x.b, max_count: x.m }).eq("code", x.p.code);
        if (error) return toast("저장하지 못했어요: " + error.message, 4000);
      }
      window.__allPositions = await loadPositions(true);
      toast(`포지션 인원을 저장했어요 · ${changed.map((x) => `${POS_SHORT[x.p.code] || x.p.name} ${x.b}/${x.m}`).join(", ")}`, 3500);
    };
    const bindOrder = () => {
      $$("#ordList [data-up]").forEach((b) => b.onclick = () => { const i = +b.dataset.up; [order[i - 1], order[i]] = [order[i], order[i - 1]]; $("#ordList").innerHTML = orderHTML(); bindOrder(); });
      $$("#ordList [data-down]").forEach((b) => b.onclick = () => { const i = +b.dataset.down; [order[i + 1], order[i]] = [order[i], order[i + 1]]; $("#ordList").innerHTML = orderHTML(); bindOrder(); });
    };
    bindOrder();
    $("#sBasis").onclick = (e) => { const b = e.target.closest("button"); if (b) $$("#sBasis button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); };
    $("#sRecReset").onclick = () => { order = ["skill", "balance", "consecutive", "gender"]; $("#ordList").innerHTML = orderHTML(); bindOrder(); $$("#sBasis button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.v === "month"))); };
    $("#sRecSave").onclick = async () => {
      const { error } = await sb.from("team_settings").update({ rec_order: order, rec_basis: $("#sBasis [aria-pressed=true]").dataset.v }).eq("id", 1);
      if (error) return toast("저장하지 못했습니다");
      S.settings = await loadSettings(true); V.basis = S.settings.rec_basis; toast("추천 기준을 저장했어요");
    };
    $("#resetAll")?.addEventListener("click", () => modal({
      title: "초기화", danger: true, confirmLabel: "초기화",
      body: `<p class="notice warn" style="margin:0">관리자 ${admins().length}명(${admins().map((m) => esc(m.name)).join(", ")})만 남기고 멤버 ${S.members.filter((m) => m.role !== "admin").length}명과 일정·응답·배치·출석·지원 기록을 모두 지워요. 되돌릴 수 없어요.</p>
        <label class="field">확인을 위해 <b>초기화</b>라고 적어 주세요<input type="text" id="rsConfirm" autocomplete="off"></label>`,
      onInput: () => { const ok = $("#mOk"); if (ok) ok.disabled = $("#rsConfirm").value.trim() !== "초기화"; },
      onConfirm: async (close) => {
        if ($("#rsConfirm").value.trim() !== "초기화") throw new Error("'초기화'라고 적어 주세요");
        $("#mOk").textContent = "비우는 중…";
        const r = await api("/api/members-bulk", { action: "reset", confirm: "초기화" });
        await loadAll(); close();
        toast(`초기화했어요 · 멤버 ${r.removedMembers}명 삭제, 관리자 ${r.keptAdmins}명 남김${r.failed ? ` · 계정 ${r.failed}개 실패` : ""}`, 5000); renderSettings();
      } }));
    $("#demoSeed").addEventListener("click", () => modal({
      title: "테스트 데이터 만들기", body: `<p style="margin:0">계정을 여러 개 만드느라 10~20초 걸려요. 실제 팀원 데이터는 바뀌지 않아요.</p>`,
      confirmLabel: "만들기",
      onConfirm: async (close) => {
        $("#mOk").textContent = "만드는 중…";
        const r = await api("/api/demo", { action: "seed" });
        await loadAll(); close();
        toast(`테스트 팀원 ${r.members}명 · 지원자 ${r.applicants}명 · 배치 ${r.lineups}주를 만들었어요`, 4000);
        renderSettings();
      },
    }));
    $("#demoClear").addEventListener("click", () => modal({
      title: "테스트 데이터 모두 지우기", body: `<p style="margin:0">(T) · @pole2.test 표시가 있는 팀원·지원서·응답·배치·사역·객원을 모두 지워요. 되돌릴 수 없어요.</p>`,
      confirmLabel: "모두 지우기", danger: true,
      onConfirm: async (close) => {
        const r = await api("/api/demo", { action: "clear" });
        await loadAll(); close(); toast(`테스트 계정 ${r.removedMembers}개 · 지원서 ${r.removedApplications}건을 지웠어요`); renderSettings();
      },
    }));
  }

  // ---------------------------------------------------------------- 변경 기록 (020)
  //  audit_log: 바꾼 것은 바뀐 칸만, 지운 것은 줄 전체 → '되살리기'(지운 것) · '되돌리기'(바꾼 것)
  //  그 뒤에 또 바뀐 칸이 있으면 되돌리지 않아요 (서버 restore_audit이 막음)
  const sizeText = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + "MB" : Math.max(1, Math.round(b / 1024)) + "KB");
  const AUD = { group: "all", q: "", limit: 100 };
  const AUD_TBL = {
    members: "멤버 정보", member_notes: "리더십 메모", member_skills: "숙련도", member_extra_positions: "추가 포지션",
    applications: "지원서", interview_evaluations: "면접 평가", trainee_weeks: "수습 기록", trainee_postpones: "수습 미루기",
    attendance: "출석", practice_attendance: "사역 연습 출석", team_meetings: "토요일 · 팀모임",
    assignments: "배치", services: "예배 · 배치표", guests: "객원", ministries: "사역",
    positions: "포지션 인원", team_settings: "설정", songs: "곡", forecast_exits: "이탈 가정", forecast_heirs: "승계 후보", reset: "초기화",
  };
  const AUD_GROUP = {
    member: ["members", "member_notes", "member_skills", "member_extra_positions", "forecast_exits", "forecast_heirs"],
    att: ["attendance", "practice_attendance", "team_meetings"],
    lineup: ["assignments", "services", "guests"],
    app: ["applications", "interview_evaluations", "trainee_weeks", "trainee_postpones"],
    set: ["positions", "team_settings", "ministries", "reset", "songs"],
  };
  const AUD_GROUP_NAME = { all: "전체", member: "멤버", att: "출석", lineup: "배치", app: "지원 · 수습", set: "일정 · 설정", del: "지운 것" };
  const AUD_COL = {
    name: "이름", phone: "연락처", email: "이메일", small_group: "순모임", served_since: "함께한 날", main_position: "주 포지션", gender: "성별",
    cohort: "기수", birth_date: "생년월일", gift_join: "생일선물 정산", role_title: "직책", title_until: "직책 예상 종료", role: "리더십", is_active: "활동",
    is_owner: "최상위 리더십", note: "메모", level: "숙련도", reason_tag: "사유", reason: "사유", self_reported_at: "미리 알림", meeting_status: "팀모임",
    admin_memo: "관리자 메모", stage: "단계", interview_result: "면접 결과", sat_attended: "토 연습", sun_attended: "주일 참관", leader_id: "나눔 리더",
    position_code: "포지션", slot: "자리", is_singer_leader: "싱어 리더", is_band_master: "밴드 마스터", recommended: "추천", member_id: "사람",
    base_count: "기본 인원", max_count: "최대 인원", is_recruiting: "모집 중", rec_order: "추천 기준 순서", rec_basis: "골고루 기준", forecast: "인원 전망 기준",
    practice_start: "연습 시작", practice_end: "연습 끝", sunday_start: "주일 시작", sunday_end: "주일 끝", sat_practice_start: "토요 연습 시작",
    sat_practice_end: "토요 연습 끝", resend_warn_hours: "다시 보내기 경고", scores: "평가", label: "이름", start_time: "시작", end_time: "끝",
    response_open: "응답 받기", poll_open: "연습 시간 취합", response_deadline: "응답 마감", poll_deadline: "취합 마감", positions: "포지션",
    title: "곡 이름", main_key: "대표 키", memo: "메모", scenario: "시나리오", out_term: "빠지는 기", back_term: "돌아오는 기", former_name: "이름", guest_id: "객원", kind: "종류",
  };
  const AUD_UNDO_DEL = ["member_notes", "member_skills", "member_extra_positions", "interview_evaluations", "trainee_postpones", "attendance", "practice_attendance", "assignments", "forecast_exits", "forecast_heirs"];
  const audWhat = (x) => {
    const r = x.old_row || x.new_row || {};
    if (x.tbl === "attendance") return `${ACT_KINDS[r.kind] || "출석"} ${ATT[r.status] || ""}${r.status === "absent" && (r.reason_tag || r.reason) ? " · " + [r.reason_tag, r.reason].filter(Boolean).join(" · ") : ""}`;
    if (x.tbl === "assignments") return `${positionName(r.position_code)} ${r.slot || ""}${r.is_singer_leader ? " · 싱어 리더" : ""}${r.is_band_master ? " · 밴마" : ""}`;
    if (x.tbl === "member_notes") return fieldText("note", r.note);
    if (x.tbl === "member_skills") return `${positionName(r.position_code)} ${LEVEL[r.level] || ""}`;
    if (x.tbl === "member_extra_positions") return positionName(r.position_code);
    if (x.tbl === "members" && x.op === "DELETE") return `${positionName(r.main_position)} · 탈퇴·삭제`;
    if (x.tbl === "forecast_heirs") return `${TITLES[r.role_title] || ""} 후보`;
    if (x.tbl === "trainee_postpones") return `${r.from_week}주차부터 ${r.weeks}주`;
    if (x.tbl === "services") return r.status === "published" ? "공개" : "비공개";
    if (x.tbl === "reset") return "데이터를 모두 비움";
    if (x.tbl === "songs") return r.title || "";
    return "";
  };
  const audChanges = (x) => (x.changed || []).filter((k) => !["updated_by", "hidden_by"].includes(k)).map((k) => {
    const o = x.old_row?.[k], n = x.new_row?.[k];
    const big = typeof o === "object" && o !== null || typeof n === "object" && n !== null;
    return `<span class="aud-ch"><b>${esc(AUD_COL[k] || k)}</b> ${big ? "바뀜" : `${esc(fieldText(k, o))} → ${esc(fieldText(k, n))}`}</span>`;
  }).join("");
  const audCanUndo = (x) => !x.restored_at && ((x.op === "DELETE" && AUD_UNDO_DEL.includes(x.tbl)) || (x.op === "UPDATE" && x.tbl !== "reset"));

  // ---------------------------------------------------------------- 섬김 일정 | 섬김 응답 (021: 한 메뉴)
  const PAGE_TABS = { schedule: [["schedule", "섬김 일정"], ["respond", "섬김 응답"]], respond: [["schedule", "섬김 일정"], ["respond", "섬김 응답"]] };
  new MutationObserver(() => {
    const v = (location.hash.slice(1) || "dashboard").split("/");
    const tabs = v.length === 1 && PAGE_TABS[v[0]];
    const c = $("#content"), cur = c.querySelector(":scope > .page-tabs");
    if (!tabs) return void cur?.remove();
    if (cur && cur === c.firstElementChild && cur.dataset.v === v[0]) return;
    cur?.remove();
    if (!c.firstElementChild) return;
    c.insertAdjacentHTML("afterbegin", `<div class="tabs page-tabs" role="tablist" data-v="${v[0]}">${tabs.map(([k, l]) => `<button type="button" role="tab" data-ptab="${k}" aria-selected="${k === v[0]}">${l}</button>`).join("")}</div>`);
  }).observe($("#content"), { childList: true });
  $("#content").addEventListener("click", (e) => { const b = e.target.closest("[data-ptab]"); if (b && b.getAttribute("aria-selected") !== "true") nav(b.dataset.ptab); });

  // ---------------------------------------------------------------- 찬양 › 콘티 (022)
  async function renderConti() {
    $("#content").innerHTML = `<div class="page-head"><h1 class="page-title">콘티</h1></div>
      <p class="lead">예배마다 인도자 · 밴드 마스터가 콘티를 쓰고 올려요. 리더십은 모든 예배의 콘티를 쓰고 고칠 수 있어요. 올리면 그 예배 섬김자에게 알림이 가고, 주일 콘티는 기록에 쌓여요.</p>
      <div id="caRoot" style="display:flex;flex-direction:column;gap:16px"></div>`;
    await CONTI.mountAdmin($("#caRoot"));
  }

  // ---------------------------------------------------------------- 찬양 › 기록 (021)
  async function renderHistory() {
    $("#content").innerHTML = `<div class="page-head"><h1 class="page-title">기록</h1></div>
      <p class="lead">카카오톡 콘티방 기록(2022.3~)을 정리한 통계예요. 팀원도 찬양 탭에서 같은 화면을 봐요.</p><div id="hxRoot"></div>`;
    await HISTORY.mount($("#hxRoot"), { admin: true });
  }

  // ---------------------------------------------------------------- 찬양 › 곡 (021)
  const SG = { q: "", sort: "n", lim: 60 };
  async function renderSongs() {
    const [sr, D, shr] = await Promise.all([sb.from("songs").select("id, title, main_key, memo, team_sec, team_bpm, team_meter").order("title"), HISTORY.load().catch(() => null), sb.from("sheet_versions").select("song_id")]);
    const shN = {}; (shr.data || []).forEach((r) => (shN[r.song_id] = (shN[r.song_id] || 0) + 1));
    if (sr.error) { $("#content").innerHTML = `<div class="empty">곡 목록을 불러오지 못했어요. migration_020을 실행했는지 확인해 주세요.</div>`; return console.error(sr.error); }
    const stat = new Map((D?.songs || []).map((x) => [x.id, x]));
    const all = (sr.data || []).map((x) => ({ ...x, st: stat.get(x.id) || { count: 0, last: "", keys: "", link: "" } }));
    $("#content").innerHTML = `<div class="page-head"><h1 class="page-title">곡</h1>
        <div class="row"><button type="button" class="btn btn-ghost btn-sm" id="songYt">영상 길이 채우기</button><button type="button" class="btn btn-primary btn-sm" id="songAdd">곡 추가</button></div></div>
      <p class="lead">콘티에 쓰는 곡 목록이에요. 곡 이름을 누르면 악보 · 레퍼런스 · 부른 기록을 봐요. 곡 시간(팀 기준)은 콘티 RT 계산에 써요. 콘티에서 시간을 직접 고치면 그 값이 팀 기준이 돼요.</p>
      <div id="songExtra" style="display:contents"></div>
      <section class="panel">
        <div class="hx-fr"><input type="search" class="hx-search" id="songQ" placeholder="곡 이름 찾기" aria-label="곡 이름 찾기" value="${esc(SG.q)}">
          <div class="hx-seg" id="songSort">${[["n", "많이 부른 순"], ["last", "최근 순"], ["name", "가나다 순"]].map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${SG.sort === k}">${l}</button>`).join("")}</div></div>
        <div class="small muted" id="songSum"></div>
        <div class="song-wrap"><table class="hx-lead song-table"><thead><tr><th>곡</th><th>대표 키</th><th class="n">부른 횟수</th><th>마지막</th><th class="n">곡 시간</th><th class="n">악보</th><th class="wide">쓴 키</th><th class="wide">메모</th><th></th></tr></thead><tbody id="songBody"></tbody></table></div>
        <button type="button" class="hx-more" id="songMore">더 보기</button>
      </section>`;
    // 023: 백업찬양 악보집 · 예배 진행곡
    if (window.BACKUP) BACKUP.mountAdmin($("#songExtra"));
    const draw = () => {
      const q = SG.q.toLowerCase().replace(/\s/g, "");
      let rows = all.filter((x) => !q || x.title.toLowerCase().replace(/\s/g, "").includes(q));
      const cmp = { n: (a, b) => b.st.count - a.st.count, last: (a, b) => (b.st.last || "").localeCompare(a.st.last || ""), name: () => 0 }[SG.sort];
      rows.sort((a, b) => cmp(a, b) || a.title.localeCompare(b.title, "ko"));
      $("#songSum").textContent = `${rows.length}곡${q ? ` · '${SG.q}'` : ""} · 전체 ${all.length}곡`;
      $("#songBody").innerHTML = rows.slice(0, SG.lim).map((x) => `<tr data-id="${x.id}">
          <td><button type="button" class="linkbtn song-name" data-detail="${x.id}">${esc(x.title)}</button>${x.st.link ? ` <a class="hx-yt" href="https://youtu.be/${esc(x.st.link)}" target="_blank" rel="noopener">▶</a>` : ""}</td>
          <td>${x.main_key ? `<span class="chip chip-violet">${esc(x.main_key)}</span>` : `<span class="muted small">—</span>`}</td>
          <td class="n">${x.st.count}</td><td class="small">${x.st.last ? x.st.last.slice(2).replace(/-/g, ".") : "—"}</td>
          <td class="n small">${x.team_sec ? `${Math.floor(x.team_sec / 60)}:${String(x.team_sec % 60).padStart(2, "0")}` : "—"}</td><td class="n small">${shN[x.id] || "—"}</td>
          <td class="wide small muted">${esc(x.st.keys || "")}</td><td class="wide small">${esc(x.memo || "")}</td>
          <td><button type="button" class="btn btn-ghost btn-sm" data-edit="${x.id}">고치기</button></td></tr>`).join("")
        || `<tr><td colspan="9" class="muted">찾는 곡이 없어요.</td></tr>`;
      $("#songMore").hidden = rows.length <= SG.lim;
    };
    draw();
    $("#songQ").addEventListener("input", (e) => { SG.q = e.target.value; SG.lim = 60; draw(); });
    $("#songSort").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; SG.sort = b.dataset.v; $$("#songSort button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); draw(); });
    $("#songMore").addEventListener("click", () => { SG.lim += 100; draw(); });
    $("#songBody").addEventListener("click", (e) => {
      const b = e.target.closest("[data-edit]"); if (b) return songEdit(all.find((x) => x.id === +b.dataset.edit));
      const d = e.target.closest("[data-detail]"); if (d) CONTI.songDetail(+d.dataset.detail);
    });
    $("#songYt").addEventListener("click", async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = "가져오는 중…";
      try { const r = await api("/api/conti", { action: "yt-fill" });
        toast(r.fetched ? `레퍼런스 영상 ${r.total}개 중 ${r.fetched}개의 길이를 가져왔어요${r.left ? ` · 남은 ${r.left}개는 한 번 더 눌러 주세요` : ""}` : `레퍼런스 영상 ${r.total}개의 길이를 이미 다 알고 있어요`, 5000); }
      catch (err) { toast(err.message, 6000); }
      btn.disabled = false; btn.textContent = "영상 길이 채우기";
    });
    $("#songAdd").addEventListener("click", () => songEdit(null));
    function songEdit(x) {
      modal({ title: x ? "곡 고치기" : "곡 추가", confirmLabel: "저장",
        body: `<label class="field">곡 이름 *<input type="text" id="sgTitle" maxlength="80" value="${esc(x?.title || "")}" autocomplete="off"></label>
          <label class="field">대표 키 <span class="hint">· 비우면 가장 많이 부른 키로 보여요</span><input type="text" id="sgKey" maxlength="12" value="${esc(x?.main_key || "")}" placeholder="예: G" autocomplete="off"></label>
          <label class="field">곡 시간 (팀 기준) <span class="hint">· 4:30처럼 · 비우면 레퍼런스 영상 길이로 셈</span><input type="text" id="sgSec" maxlength="5" inputmode="numeric" value="${x?.team_sec ? `${Math.floor(x.team_sec / 60)}:${String(x.team_sec % 60).padStart(2, "0")}` : ""}" placeholder="예: 4:30" autocomplete="off"></label>
          <div class="row" style="gap:10px;align-items:flex-end"><label class="field" style="flex:1">BPM (팀 기준) <span class="hint">· 콘티에 넣으면 자동으로 채워져요</span><input type="text" id="sgBpm" maxlength="3" inputmode="numeric" value="${x?.team_bpm || ""}" placeholder="예: 72" autocomplete="off"></label>
            <label class="field" style="flex:0 0 110px">박자<select class="select" id="sgMeter">${["4/4", "3/4", "6/8"].map((m) => `<option ${(x?.team_meter || "4/4") === m ? "selected" : ""}>${m}</option>`).join("")}</select></label></div>
          <label class="field">메모<textarea id="sgMemo" maxlength="300" rows="3" placeholder="예: 후렴 두 번 반복">${esc(x?.memo || "")}</textarea></label>
          ${x && x.st.count ? `<p class="small muted" style="margin:0">콘티 ${x.st.count}번에 쓰인 곡이에요. 이름을 바꾸면 지난 기록에도 바뀐 이름으로 보여요.</p>` : ""}
          <span class="small bk-err" id="sgErr"></span>`,
        onConfirm: async (close) => {
          const v = { title: $("#sgTitle").value.trim(), main_key: $("#sgKey").value.trim() || null, memo: $("#sgMemo").value.trim() || null };
          if (!v.title) { $("#sgErr").textContent = "곡 이름을 적어 주세요"; return; }
          const tv = $("#sgSec").value.trim(), tm = tv.match(/^(\d{1,2}):([0-5]\d)$/);
          if (tv && !tm) { $("#sgErr").textContent = "곡 시간은 4:30처럼 적어 주세요"; return; }
          v.team_sec = tm ? +tm[1] * 60 + +tm[2] : null;
          const bv = $("#sgBpm").value.trim();
          if (bv && !(/^\d{2,3}$/.test(bv) && +bv >= 20 && +bv <= 320)) { $("#sgErr").textContent = "BPM은 20~320 사이 숫자로 적어 주세요"; return; }
          v.team_bpm = bv ? +bv : null; v.team_meter = bv ? $("#sgMeter").value : null;
          const r = x ? await sb.from("songs").update(v).eq("id", x.id) : await sb.from("songs").insert(v);
          if (r.error) { $("#sgErr").textContent = r.error.code === "23505" ? "같은 이름의 곡이 이미 있어요 (띄어쓰기 · 대소문자는 같게 봐요)" : "저장하지 못했어요"; return; }
          close(); HISTORY.reset(); toast(x ? "곡을 고쳤어요" : "곡을 추가했어요"); renderSongs();
        } });
    }
  }

  async function renderAudit() {
    $("#content").innerHTML = `<a href="#settings" class="back" style="align-self:flex-start">설정으로 돌아가기</a>
      <div class="page-head"><h1 class="page-title">변경 기록</h1></div><div class="empty">불러오는 중…</div>`;
    let q = sb.from("audit_log").select("*").order("id", { ascending: false }).limit(AUD.limit + 1);
    if (AUD.group === "del") q = q.eq("op", "DELETE");
    else if (AUD.group !== "all") q = q.in("tbl", AUD_GROUP[AUD.group]);
    if (AUD.q.trim()) q = q.ilike("label", `%${AUD.q.trim().replace(/[%_]/g, "")}%`);
    const { data, error } = await q;
    if (error) { $("#content").innerHTML = `<div class="empty">변경 기록을 불러오지 못했어요. migration_019를 실행했는지 확인해 주세요.</div>`; return; }
    const rows = (data || []).slice(0, AUD.limit), more = (data || []).length > AUD.limit;
    const day = (iso) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    let prevDay = "";
    $("#content").innerHTML = `<a href="#settings" class="back" style="align-self:flex-start">설정으로 돌아가기</a>
      <div class="page-head"><h1 class="page-title">변경 기록</h1></div>
      <p class="lead">누가 언제 무엇을 바꿨는지 1년 동안 남아요. 지운 출석 · 배치 · 메모는 <b>되살리기</b>, 바꾼 칸은 <b>되돌리기</b>로 이전 값으로 돌릴 수 있어요. 탈퇴하거나 지운 사람의 기록은 개인정보 파기를 위해 함께 지워져요.</p>
      <section class="card bordered aud-tools">
        <div class="chips2" id="audGroup" role="group" aria-label="종류">${Object.entries(AUD_GROUP_NAME).map(([k, v]) => `<button type="button" data-g="${k}" aria-pressed="${AUD.group === k}">${v}</button>`).join("")}</div>
        <input type="search" class="search" id="audQ" placeholder="이름으로 찾기" value="${esc(AUD.q)}" aria-label="이름으로 찾기">
      </section>
      <section class="aud-list">${rows.map((x) => {
        const d = day(x.at), head = d !== prevDay ? `<h2 class="aud-day">${fmtDate(d, { month: "long", day: "numeric", weekday: "short" })}</h2>` : "";
        prevDay = d;
        const verb = { INSERT: "추가", UPDATE: "수정", DELETE: x.tbl === "reset" ? "" : "삭제" }[x.op];
        const what = audWhat(x);
        return `${head}<article class="aud-row ${x.op === "DELETE" ? "del" : ""}" data-aid="${x.id}">
          <span class="aud-time">${new Date(x.at).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit" })}</span>
          <div class="aud-main">
            <div class="aud-hd"><span class="chip ${x.op === "DELETE" ? "chip-warn" : x.op === "INSERT" ? "chip-ok" : "chip-violet"}">${esc(AUD_TBL[x.tbl] || x.tbl)}${verb ? " " + verb : ""}</span>
              <b>${esc(x.label || "")}</b>${what ? `<span class="aud-what">${esc(what)}</span>` : ""}</div>
            ${x.op === "UPDATE" ? `<div class="aud-chs">${audChanges(x)}</div>` : ""}
            <span class="small muted">${esc(x.actor_name || (x.actor ? "리더십" : "서버 · 자동"))}${x.restored_at ? ` · <b style="color:var(--ok)">${esc(memberName(x.restored_by))}님이 ${x.op === "DELETE" ? "되살림" : "되돌림"}</b>` : ""}</span>
          </div>
          ${audCanUndo(x) ? `<button type="button" class="btn btn-ghost btn-sm" data-undo-aid="${x.id}">${x.op === "DELETE" ? "되살리기" : "되돌리기"}</button>` : "<span></span>"}
        </article>`;
      }).join("") || `<div class="empty">${AUD.q || AUD.group !== "all" ? "조건에 맞는 기록이 없어요." : "아직 기록이 없어요."}</div>`}</section>
      ${more ? `<button type="button" class="btn btn-ghost" id="audMore" style="align-self:center">더 보기</button>` : ""}`;
    $("#audGroup").onclick = (e) => { const b = e.target.closest("[data-g]"); if (b) { AUD.group = b.dataset.g; AUD.limit = 100; renderAudit(); } };
    let t = null;
    $("#audQ").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { AUD.q = e.target.value; AUD.limit = 100; renderAudit().then(() => { const i = $("#audQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 350); };
    $("#audMore")?.addEventListener("click", () => { AUD.limit += 100; renderAudit(); });
    $$("[data-undo-aid]").forEach((b) => b.addEventListener("click", () => {
      const x = rows.find((r) => String(r.id) === b.dataset.undoAid);
      const del = x.op === "DELETE";
      modal({
        title: del ? "되살리기" : "되돌리기", confirmLabel: del ? "되살리기" : "되돌리기",
        body: `<p style="margin:0"><b>${esc(x.label || "")}</b> · ${esc(AUD_TBL[x.tbl] || x.tbl)}${audWhat(x) ? " · " + esc(audWhat(x)) : ""}</p>
          ${del ? `<p class="small muted" style="margin:0">지운 그대로 다시 넣어요. 같은 자리에 이미 다른 기록이 있으면 되살리지 않아요.</p>`
            : `<div class="aud-chs">${audChanges(x)}</div><p class="small muted" style="margin:0">바뀐 칸을 화살표 왼쪽(이전 값)으로 돌려요. 그 뒤에 또 바뀐 칸이 있으면 돌리지 않아요.</p>`}`,
        onConfirm: async (close) => {
          const { error } = await sb.rpc("restore_audit", { p_id: x.id });
          if (error) throw new Error(error.message);
          close(); toast(del ? "되살렸어요" : "되돌렸어요");
          await loadAll(); renderAudit();
        },
      });
    }));
  }

  // ---------------------------------------------------------------- 인원 전망 (018 · 019)
  //  기수로 졸업을 계산하고(지금 기 + 15기까지 남음), 리더십이 고른 이탈 가정(낙관 / 비관 = 낙관 + 추가)을 더해
  //  앞으로 몇 년 동안 포지션별로 몇 명을 뽑아야 하는지 보여 줌
  //  019: 주/보조 포지션 모두 1로 셈(보조는 따로 표시) · 기 시작 월(기본 11월)에 다음 기로 넘어감
  //       리더십 승계: 직책 예상 종료 · 비관은 직책이 해마다 바뀐다고 가정 · 승계 후보 지정
  const FC = { tab: "plan", sc: "opt", plan: "min", t: 0, pf: "all" };
  const EXIT_REASON = { military: "군입대", abroad: "유학", move: "지방·이직", etc: "기타" };
  const GAP_WHY = { grad: "졸업", term: "임기 종료", rotate: "1년 임기", ...EXIT_REASON };
  const FC_POS = ["leader", "singer", "key_main", "key_second", "e_guitar", "bass", "drum"];
  const FC_BAND = ["key_main", "key_second", "e_guitar", "bass", "drum"];
  const CAND_PART = { any: "포지션 무관", lead: "인도자 중에서", vocal: "싱어 중에서", band: "밴드 중에서" };
  const FC_DEFAULT = {
    term: 20, termMonth: 11, termStart: "2026-11", grad: 15, young: 43, recruitAge: 0, horizon: 5,
    min: { leader: 2, singer: 8, key_main: 2, key_second: 2, e_guitar: 2, bass: 2, drum: 2 },
    room: { leader: 3, singer: 10, key_main: 3, key_second: 3, e_guitar: 3, bass: 3, drum: 3 },
    cand: { team_lead: { part: "any", years: 2 }, singer_lead: { part: "vocal", years: 2 }, band_lead: { part: "band", years: 2 }, treasurer: { part: "any", years: 1 } },
  };
  function fcCfg() {
    const f = S.settings?.forecast || {};
    return { ...FC_DEFAULT, ...f, min: { ...FC_DEFAULT.min, ...(f.min || {}) }, room: { ...FC_DEFAULT.room, ...(f.room || {}) },
      cand: Object.fromEntries(TITLE_ORDER.map((t) => [t, { ...FC_DEFAULT.cand[t], ...((f.cand || {})[t] || {}) }])) };
  }
  // 지금 기: 저장한 기(term)가 시작된 달(termStart)부터 12개월마다 한 기씩 넘어감
  function termNow(cfg) {
    const tm = Math.min(12, Math.max(1, +cfg.termMonth || 11));
    const [ay, am] = String(cfg.termStart || `${todayISO().slice(0, 4)}-${String(tm).padStart(2, "0")}`).split("-").map(Number);
    const [y, m] = todayISO().split("-").map(Number);
    const adv = Math.max(0, Math.floor(((y * 12 + m) - (ay * 12 + am)) / 12));
    return { term: +cfg.term + adv, adv, startY: ay + adv, month: am };
  }
  const termStartLabel = (TN, k, full = false) => `${full ? TN.startY + k : `'${String(TN.startY + k).slice(2)}`}.${TN.month}`;
  // 함께한 햇수 (함께한 날 기준, 올해가 1년째)
  const expOf = (m) => {
    const s = sinceOf(m); if (!s) return 1;
    const [y1, m1] = s.split("-").map(Number), [y2, m2] = todayISO().split("-").map(Number);
    return Math.max(0, Math.floor(((y2 - y1) * 12 + (m2 - m1)) / 12)) + 1;
  };
  const fmtN = (x) => (Math.round(x * 10) / 10).toString();

  function fcModel(cfg, exits, sc, heirs = []) {
    const ex = new Map(exits.filter((e) => sc === "pess" || e.scenario === "opt").map((e) => [e.member_id, e]));
    const ppl = S.members.filter((m) => m.is_active).map((m) => {
      const main = m.main_position || null;
      const subs = extrasOf(m.id).filter((c) => c !== main);
      const pos = [main, ...subs].filter(Boolean);
      return { m, id: m.id, name: m.name, cohort: m.cohort ?? null, gender: m.gender, pos, main, subs,
        title: m.role_title || null, until: m.title_until ?? null, exp0: expOf(m), ex: ex.get(m.id) };
    });
    const TN = termNow(cfg);
    const T0 = TN.term, H = +cfg.horizon, G = +cfg.grad;
    const byCohort = (p, k) => p.cohort == null || p.cohort >= T0 + k + G;
    const stateAt = (p, k) => {
      if (!byCohort(p, k)) return "grad";
      const e = p.ex, T = T0 + k;
      if (e && T >= e.out_term && !(e.back_term && T >= e.back_term)) return e.reason === "military" ? "mil" : "gone";
      return "on";
    };
    const recruitCohort = (k) => +cfg.young + k - +cfg.recruitAge;
    function run(plan) {
      const recs = [], years = [];
      let N0 = 0;
      for (let k = 0; k <= H; k++) {
        const T = T0 + k;
        const main = Object.fromEntries(FC_POS.map((c) => [c, 0])), sub = Object.fromEntries(FC_POS.map((c) => [c, 0]));
        let heads = 0;
        // 019: 주/보조 상관없이 그 포지션에 1명으로 셈 (보조는 따로 모아 표시)
        ppl.forEach((p) => { if (stateAt(p, k) !== "on") return; heads++; if (p.main in main) main[p.main]++; p.subs.forEach((c) => { if (c in sub) sub[c]++; }); });
        recs.forEach((r) => { if (r.cohort < T + G) return; heads++; if (r.pos) main[r.pos] += 1; });
        const have = Object.fromEntries(FC_POS.map((c) => [c, main[c] + sub[c]]));
        if (k === 0) N0 = heads;
        const need = Object.fromEntries(FC_POS.map((c) => [c, k === 0 ? 0 : Math.max(0, Math.ceil(cfg.min[c] - have[c] - 1e-9))]));
        const minT = FC_POS.reduce((s, c) => s + need[c], 0);
        const keepT = k === 0 ? 0 : Math.max(0, N0 - heads);
        const add = k === 0 || plan === "none" ? 0 : plan === "keep" ? Math.max(minT, keepT) : minT;
        const mine = [];
        if (add) {
          FC_POS.forEach((c) => { for (let i = 0; i < need[c]; i++) mine.push({ k, pos: c, cohort: recruitCohort(k) }); });
          while (mine.length < add) mine.push({ k, pos: null, cohort: recruitCohort(k) });
        }
        recs.push(...mine);
        years.push({ k, T, have, main, sub, need, minT, keepT, heads, add, recs: mine, total: heads + add });
      }
      return { years, recs, N0 };
    }
    const moves = Array.from({ length: H + 1 }, (_, k) => {
      const T = T0 + k;
      if (!k) return { grads: [], outs: [], backs: [] };
      return {
        grads: ppl.filter((p) => byCohort(p, k - 1) && !byCohort(p, k)),
        outs: ppl.filter((p) => byCohort(p, k) && p.ex && +p.ex.out_term === T),
        backs: ppl.filter((p) => byCohort(p, k) && p.ex && +p.ex.back_term === T),
      };
    });
    const partOk = (p, part) => part === "lead" ? p.pos.includes("leader") : part === "vocal" ? p.pos.includes("singer")
      : part === "band" ? p.pos.some((c) => FC_BAND.includes(c)) : true;
    // 직책: 졸업·이탈 · 예상 종료(이 기까지) · 비관이면 1년 임기(다음 기에 바뀜) 중 가장 빠른 때 공백
    const leads = TITLE_ORDER.map((t) => {
      const h = ppl.find((p) => p.title === t), c = cfg.cand[t];
      const hs = heirs.filter((x) => x.role_title === t).sort((a, b) => a.rank - b.rank).map((x) => ppl.find((p) => p.id === x.member_id)).filter(Boolean);
      if (!h) return { t, holder: null, c, heirs: hs };
      let k = null, why = null;
      for (let i = 1; i <= H; i++) {
        const s = stateAt(h, i);
        if (s !== "on") { k = i; why = s === "grad" ? "grad" : h.ex?.reason || "etc"; break; }
        if (h.until != null && T0 + i > h.until) { k = i; why = "term"; break; }
        if (sc === "pess") { k = i; why = "rotate"; break; }
      }
      if (k === null) return { t, holder: h, c, k: null, heirs: hs };
      const cands = ppl.filter((p) => p !== h && stateAt(p, k) === "on" && stateAt(p, k + 1) === "on" && p.exp0 + k >= +c.years && partOk(p, c.part));
      // 지정 후보: 그 기에 남아 있는지
      const heirInfo = hs.map((p) => { const s = stateAt(p, k), s2 = stateAt(p, k + 1);
        return { p, ok: s === "on", note: s === "grad" ? "그때 졸업" : s !== "on" ? `그때 ${EXIT_REASON[p.ex?.reason] || "이탈"}` : s2 === "grad" ? "그다음 기 졸업" : s2 !== "on" ? `그다음 기 ${EXIT_REASON[p.ex?.reason] || "이탈"}` : "" }; });
      const okHeirs = heirInfo.filter((x) => x.ok);
      // 경고: 다음 기(1년 안)에 비는데 남아 있는 지정 후보가 없음 · 또는 지정 후보도 없고 조건 맞는 사람이 1명 이하
      const urgent = k <= 1 && !okHeirs.length;
      const thin = !okHeirs.length && cands.length <= 1;
      return { t, holder: h, c, k, T: T0 + k, why, cands, heirs: hs, heirInfo, okHeirs, alert: urgent || thin, urgent, thin };
    });
    return { cfg, TN, ppl, stateAt, byCohort, run, moves, leads, T0, H, G, noCohort: ppl.filter((p) => p.cohort == null) };
  }

  async function renderForecast() {
    const [{ data: exits, error }, hr] = await Promise.all([sb.from("forecast_exits").select("*").order("id"), sb.from("forecast_heirs").select("*")]);
    if (error) { $("#content").innerHTML = `<div class="empty">이탈 가정을 불러오지 못했어요. migration_017을 실행했는지 확인해 주세요.</div>`; return; }
    if (hr.error) console.error("migration_018을 실행했는지 확인해 주세요.", hr.error);
    S.fcExits = exits || []; S.fcHeirs = hr.data || [];
    const cfg = fcCfg();
    if (FC.t > +cfg.horizon) FC.t = 0;
    const TN = termNow(cfg);
    const scSeg = `<div class="seg" id="fcSc" role="group" aria-label="시나리오"><span class="small muted" style="align-self:center;margin-right:4px">시나리오</span>
        <button type="button" data-sc="opt" aria-pressed="${FC.sc === "opt"}">낙관</button><button type="button" data-sc="pess" data-tone="weak" aria-pressed="${FC.sc === "pess"}">비관</button></div>`;
    const TABS = [["plan", "충원 계획"], ["pyramid", "인구 구조"], ["exits", `이탈 가정 ${S.fcExits.length || ""}`], ["settings", "기준 설정"]];
    $("#content").innerHTML = `<div class="page-head"><div style="display:flex;flex-direction:column;gap:4px">
          <h1 class="page-title">인원 전망 <span class="chip chip-violet" style="vertical-align:6px">리더십 전용</span></h1>
          <p class="lead" style="margin:0">${TN.term}기 명단 기준 (${termStartLabel(TN, 0, true)}월 시작) · 졸업은 기수로 계산 (${TN.term}기에는 ${TN.term + +cfg.grad}기까지, ${TN.term + 1}기에는 ${TN.term + 1 + +cfg.grad}기까지)</p></div>
        ${["plan", "pyramid"].includes(FC.tab) ? scSeg : ""}</div>
      ${TN.adv ? `<div class="notice ok" style="margin:0">기 시작 월(${TN.month}월)이 지나 ${TN.term}기로 넘어갔어요. 기준 설정을 저장하면 이 기준으로 고정돼요.</div>` : ""}
      <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-fct="${k}" aria-selected="${FC.tab === k}">${l}</button>`).join("")}</div>
      <div id="fcBody" style="display:flex;flex-direction:column;gap:16px"></div>`;
    $$("[data-fct]").forEach((b) => b.addEventListener("click", () => { FC.tab = b.dataset.fct; renderForecast(); }));
    $$("#fcSc [data-sc]").forEach((b) => b.addEventListener("click", () => { FC.sc = b.dataset.sc; renderForecast(); }));
    const M = fcModel(cfg, S.fcExits, FC.sc, S.fcHeirs);
    if (FC.tab === "pyramid") return drawFcPyramid(M);
    if (FC.tab === "exits") return drawFcExits(M);
    if (FC.tab === "settings") return drawFcSettings(cfg);
    return drawFcPlan(M);
  }

  const fcNoCohort = (M) => M.noCohort.length ? `<div class="notice warn" style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center">
      <span>기수를 모르는 ${M.noCohort.length}명(${M.noCohort.slice(0, 6).map((p) => esc(p.name)).join(", ")}${M.noCohort.length > 6 ? " 외" : ""})은 졸업하지 않는 것으로 셈했어요.</span>
      <a href="#members" style="font-weight:800">멤버에서 기수 넣기</a></div>` : "";
  const posLine = (p) => p.subs.length ? `주 ${POS_SHORT[p.main] || "—"} · 보조 ${p.subs.map((c) => POS_SHORT[c] || c).join("·")}` : POS_SHORT[p.main] || "—";

  // 리더십 승계 카드 (019.5: 긴급도 순 · 짧은 상태 배지 · 후보 칩 한 번에 고르기). at = 인구 구조에서 보는 기(몇 년 뒤)
  // 단계: bad(빨강) = 비어 있음 · 다음 기 공백인데 후보 없음 · 후보 부족 / warn(주황) = 공백 예정, 후보 없음 / ok(초록) = 후보 있음 · 기간 안엔 그대로
  const leadLevel = (L) => (!L.holder ? "bad" : L.k == null ? "ok" : L.okHeirs?.length ? "ok" : L.alert ? "bad" : "warn");
  const LV_RANK = { bad: 0, warn: 1, ok: 2 };
  const sortLeads = (leads) => leads.slice().sort((a, b) => (LV_RANK[leadLevel(a)] - LV_RANK[leadLevel(b)])
    || ((a.holder ? 1 : 0) - (b.holder ? 1 : 0)) || ((a.k ?? 99) - (b.k ?? 99)) || (TITLE_ORDER.indexOf(a.t) - TITLE_ORDER.indexOf(b.t)));
  const leadWho = (h) => [esc(h.name), h.cohort ? `${h.cohort}기` : "", POS_SHORT[h.main] || ""].filter(Boolean).join(" · ");
  function leadBadge(M, L) {
    const lv = leadLevel(L);
    if (!L.holder) return [lv, "비어 있음"];
    if (L.k == null) return [lv, `${M.H}년 안에는 그대로`];
    const when = L.k === 1 ? `다음 기(${M.T0 + 1}기) 공백` : `${M.T0 + L.k}기부터 공백`;
    if (lv === "ok") return [lv, `${when} · 후보 있음`];
    if (lv === "bad") return [lv, `${when} · ${L.urgent ? "후보 없음" : "후보 부족"}`];
    return [lv, `${when} · 후보 없음`];
  }
  function fcLeadHTML(M, at = null) {
    const lastOn = (p) => (p.cohort == null ? null : p.cohort - M.G);   // 졸업 전 마지막 기
    return sortLeads(M.leads).map((L) => {
      const name = TITLES[L.t], [lv, btxt] = leadBadge(M, L);
      if (!L.holder) return `<div class="fc-lead empty lv-bad" data-lead="${L.t}" data-lv="bad"><b>${name}</b><span class="fc-badge bad">비어 있음</span><a href="#members" class="small">멤버 › 정보 수정에서 정하기</a></div>`;
      const h = L.holder, who = leadWho(h);
      if (at !== null) {
        // 인구 구조 오른쪽: 그 기 기준 짧게
        let txt, cls = lv;
        if (L.k === null || at < L.k) { const left = L.k === null ? null : L.k - at;
          txt = left === null ? `${M.H}년 안에는 그대로` : `${M.T0 + L.k}기부터 공백 · ${left === 1 ? "다음 해" : left + "년 뒤"}`; }
        else { txt = `공백 · ${GAP_WHY[L.why]}`; cls = L.okHeirs.length ? "warn" : "bad"; }
        const hs = L.okHeirs?.length ? L.okHeirs.map((x) => esc(x.p.name)).join(", ") : L.heirs.map((p) => esc(p.name)).join(", ");
        return `<div class="fc-lead lv-${cls}" data-lead="${L.t}" data-lv="${cls}"><div class="fc-lead-hd"><b>${name}</b><span>${who}</span></div>
          <span class="fc-badge ${cls}">${txt}</span>${hs ? `<span class="small muted">후보 ${hs}</span>` : ""}</div>`;
      }
      // 충원 계획: 이름 줄 → 상태 배지 → 임기 → 승계 후보 칩
      const last = lastOn(h);
      const opts = []; for (let t = M.T0; t <= M.T0 + M.H && (last == null || t < last); t++) opts.push(t);
      const until = `<select class="select fc-until" data-until="${h.id}" aria-label="${name} 예상 종료">
          <option value="" ${h.until == null ? "selected" : ""}>졸업까지${last != null ? ` (${last}기까지)` : ""}</option>
          ${opts.map((t) => `<option value="${t}" ${+h.until === t ? "selected" : ""}>${t}기까지 · ${t === M.T0 ? "이번 기" : `${t - M.T0}년 더`}</option>`).join("")}
          ${h.until != null && !opts.includes(+h.until) ? `<option value="${h.until}" selected>${h.until}기까지</option>` : ""}</select>`;
      const info = L.heirInfo || L.heirs.map((p) => ({ p, ok: true, note: "" }));
      const picked = new Set(L.heirs.map((p) => p.id));
      const more = (L.cands || []).filter((p) => !picked.has(p.id));
      const chips = info.map((x) => `<button type="button" class="fc-heir on ${x.ok ? (x.note ? "mid" : "ok") : "bad"}" data-unpick="${x.p.id}" data-t="${L.t}" title="누르면 후보에서 빼요 · ${esc(posLine(x.p))}" aria-pressed="true">✓ ${esc(x.p.name)}${x.p.cohort ? ` ${x.p.cohort}기` : ""}${x.note ? ` · ${x.note}` : ""}</button>`).join("")
        + more.slice(0, 6).map((p) => `<button type="button" class="fc-heir pick" data-pick="${p.id}" data-t="${L.t}" title="누르면 후보로 정해요 · ${esc(posLine(p))} · ${p.exp0}년째" aria-pressed="false">+ ${esc(p.name)}${p.cohort ? ` ${p.cohort}기` : ""}</button>`).join("");
      return `<div class="fc-lead lv-${lv}" data-lead="${L.t}" data-lv="${lv}">
        <div class="fc-lead-hd"><b>${name}</b><span>${who}</span></div>
        <div class="fc-lead-st"><span class="fc-badge ${lv}">${btxt}</span>${L.k != null ? `<small>${GAP_WHY[L.why]}</small>` : ""}</div>
        <label class="fc-lead-term"><span>임기</span>${until}</label>
        <div class="fc-heirs"><span class="fc-heirs-l">승계 후보 <small>${L.heirs.length}/2</small></span>
          <div class="fc-heir-chips">${chips || `<span class="small muted">조건 맞는 사람이 없어요</span>`}
          <button type="button" class="btn btn-ghost btn-sm" data-heir="${L.t}">다른 사람${more.length > 6 ? ` (+${more.length - 6})` : ""}</button></div>
          ${L.k != null ? `<small class="muted">${more.length ? "+ 이름은 조건 맞는 사람 · 누르면 바로 후보로 정해요" : ""}</small>` : ""}</div></div>`;
    }).join("");
  }
  // 예상 종료 · 승계 후보 고르기 (충원 계획 탭)
  function bindFcLeads(M) {
    $$("[data-until]").forEach((s) => s.addEventListener("change", async () => {
      const v = s.value === "" ? null : +s.value;
      const { error } = await sb.from("members").update({ title_until: v }).eq("id", s.dataset.until);
      if (error) return toast("저장하지 못했어요: " + error.message, 4000);
      const m = S.members.find((x) => x.id === s.dataset.until); if (m) m.title_until = v;
      toast(v == null ? "졸업까지 맡는 것으로 바꿨어요" : `${v}기까지 맡는 것으로 저장했어요`); renderForecast();
    }));
    $$("[data-heir]").forEach((b) => b.addEventListener("click", () => openFcHeirs(M, b.dataset.heir)));
    $$("[data-pick]").forEach((b) => b.addEventListener("click", async () => {
      const t = b.dataset.t, L = M.leads.find((x) => x.t === t);
      if (L.heirs.length >= 2) return toast("승계 후보는 직책마다 2명까지예요. 먼저 한 명을 빼 주세요");
      b.disabled = true;
      const { error } = await sb.from("forecast_heirs").insert({ role_title: t, member_id: b.dataset.pick, rank: L.heirs.length + 1, created_by: S.me.id });
      if (error) { b.disabled = false; return toast("저장하지 못했어요: " + error.message, 4000); }
      const p = M.ppl.find((x) => x.id === b.dataset.pick);
      toast(`${p ? p.name + "님을 " : ""}${TITLES[t]} 승계 후보로 정했어요`); renderForecast();
    }));
    $$("[data-unpick]").forEach((b) => b.addEventListener("click", async () => {
      const t = b.dataset.t; b.disabled = true;
      const { error } = await sb.from("forecast_heirs").delete().eq("role_title", t).eq("member_id", b.dataset.unpick);
      if (error) { b.disabled = false; return toast("저장하지 못했어요: " + error.message, 4000); }
      toast(`${TITLES[t]} 승계 후보에서 뺐어요`); renderForecast();
    }));
  }
  function openFcHeirs(M, t) {
    const L = M.leads.find((x) => x.t === t), k = L.k ?? 1;
    const cur = new Set(L.heirs.map((p) => p.id));
    const fit = new Set((L.cands || []).map((p) => p.id));
    const list = M.ppl.filter((p) => p !== L.holder && M.stateAt(p, 0) === "on")
      .sort((a, b) => (cur.has(b.id) - cur.has(a.id)) || (fit.has(b.id) - fit.has(a.id)) || (b.exp0 - a.exp0) || a.name.localeCompare(b.name, "ko"));
    const note = (p) => { const s = M.stateAt(p, k); return s === "grad" ? `${M.T0 + k}기에 졸업` : s !== "on" ? `${M.T0 + k}기에 ${EXIT_REASON[p.ex?.reason] || "이탈"}` : ""; };
    modal({
      step: L.holder ? `${TITLES[t]} · 지금 ${L.holder.name}` : TITLES[t], title: "승계 후보 지정",
      body: `<p class="small muted" style="margin:0">이 직책을 이어받을 사람을 2명까지 골라요. ${L.k ? `${M.T0 + L.k}기부터 비어요. ` : ""}<b>조건 맞음</b>은 기준 설정의 후보 조건(${CAND_PART[L.c.part]} · ${L.c.years}년째 이상)을 채운 사람이에요.</p>
        <div class="fc-heir-pick" id="hpList">${list.map((p) => `<label class="checkrow"><input type="checkbox" value="${p.id}" ${cur.has(p.id) ? "checked" : ""}>
          <span><b>${esc(p.name)}${p.cohort ? ` · ${p.cohort}기` : ""}${fit.has(p.id) ? ` <span class="chip chip-ok">조건 맞음</span>` : ""}${note(p) ? ` <span class="chip chip-warn">${note(p)}</span>` : ""}</b>
          <small>${esc(posLine(p))} · ${p.exp0}년째${p.title ? ` · ${TITLES[p.title]}` : ""}</small></span></label>`).join("")}</div>`,
      onInput: (e) => {
        const on = $$("#hpList input:checked");
        if (on.length > 2 && e?.target?.matches?.("#hpList input")) { e.target.checked = false; toast("직책마다 2명까지 골라요"); }
      },
      confirmLabel: "저장",
      onConfirm: async (close) => {
        const ids = $$("#hpList input:checked").map((x) => x.value).slice(0, 2);
        const { error: e1 } = await sb.from("forecast_heirs").delete().eq("role_title", t);
        if (e1) throw new Error("저장하지 못했어요");
        if (ids.length) { const { error } = await sb.from("forecast_heirs").insert(ids.map((id, i) => ({ role_title: t, member_id: id, rank: i + 1, created_by: S.me.id }))); if (error) throw new Error("저장하지 못했어요: " + error.message); }
        close(); toast(ids.length ? `${TITLES[t]} 승계 후보 ${ids.length}명을 저장했어요` : `${TITLES[t]} 승계 후보를 비웠어요`); renderForecast();
      },
    });
  }

  function drawFcPlan(M) {
    const cfg = M.cfg, minR = M.run("min"), keepR = M.run("keep");
    const Y = minR.years.slice(1), KY = keepR.years.slice(1);
    const sum = (a) => a.reduce((s, x) => s + x, 0);
    const peak = Y.reduce((b, y) => (y.minT > (b?.minT || 0) ? y : b), null);
    const warns = M.leads.filter((L) => L.k && L.alert);
    const posN = (c) => (window.__allPositions || []).find((p) => p.code === c)?.name || c;
    // 막대: 진한 = 주 포지션, 연한 빗금 = 보조 포지션 (여유 인원 기준 길이)
    const bar = (y, c) => { const full = Math.max(cfg.room[c], y.have[c], 1);
      return `<span class="fc-bar" aria-hidden="true"><i class="m" style="width:${Math.round(100 * y.main[c] / full)}%"></i><i class="s" style="width:${Math.round(100 * y.sub[c] / full)}%"></i><i class="ln" style="left:${Math.round(100 * cfg.min[c] / full)}%"></i></span>`; };
    const subDep = (y, c) => !y.need[c] && y.sub[c] > 0 && y.main[c] < cfg.min[c] - 1e-9;
    $("#fcBody").innerHTML = `${fcNoCohort(M)}
      <div class="kpis">
        <div class="kpi" style="border-color:var(--violet-soft)"><span>${M.T0 + 1}기 충원 목표</span><b>${Y[0].minT === KY[0].add ? `${Y[0].minT}명` : `${Y[0].minT}~${KY[0].add}명`}</b><small>최소 운영 ${Y[0].minT} · 지금 규모 유지 ${KY[0].add}</small></div>
        <div class="kpi"><span>${M.H}년 누적 충원</span><b>${sum(Y.map((y) => y.minT)) === sum(KY.map((y) => y.add)) ? sum(Y.map((y) => y.minT)) : `${sum(Y.map((y) => y.minT))}~${sum(KY.map((y) => y.add))}`}명</b><small>${M.T0 + 1}~${M.T0 + M.H}기 합계</small></div>
        <div class="kpi"><span>가장 큰 공백</span><b>${peak ? `${peak.T}기` : "없음"}</b><small>${peak ? FC_POS.filter((c) => peak.need[c]).map((c) => `${POS_SHORT[c]}${peak.need[c] > 1 ? " " + peak.need[c] : ""}`).join(" · ") : "최소 운영 인원이 계속 채워져요"}</small></div>
        <div class="kpi" style="${warns.length ? "border-color:#EBC3BF" : ""}"><span>리더십 승계 경고</span><b style="color:${warns.length ? "var(--bad)" : "inherit"}">${warns.length}건</b><small>${warns.length ? warns.map((L) => `${M.T0 + L.k}기 ${TITLES[L.t]}`).join(" · ") + " 후보 부족" : "비는 직책도 이어받을 후보가 있어요"}</small></div>
      </div>
      <section class="panel" style="padding:0;gap:0;overflow:hidden">
        <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px;padding:18px 20px 12px">
          <h2 style="margin:0">포지션별 충원 필요 <small>최소 운영 기준</small></h2>
          <span class="small muted">큰 숫자 = 그 기에 뽑을 인원 · 작은 글씨 = 충원 전 남는 인원(주·보조 모두 1명으로 셈) · 충원자는 ${+cfg.young + 1 - +cfg.recruitAge}기(${M.T0 + 1}기 충원)부터로 가정</span></div>
        <div style="overflow-x:auto"><table class="fc-table">
          <thead><tr><th class="l">포지션</th><th>지금 · ${M.T0}기<br><span>${termStartLabel(M.TN, 0)}~</span></th>${Y.map((y) => `<th>${y.T}기<br><span>${y.k}년 뒤 · ${termStartLabel(M.TN, y.k)}~</span></th>`).join("")}</tr></thead>
          <tbody>
            ${FC_POS.map((c) => { const y0 = minR.years[0]; return `<tr><td class="l"><b>${esc(posN(c))}</b><small>최소 ${cfg.min[c]} · 여유 ${cfg.room[c]}</small></td>
              <td class="c now ${y0.have[c] < cfg.min[c] - 1e-9 ? "low" : ""}" data-now="${c}" title="${esc(posN(c))} 지금: 주 포지션 ${y0.main[c]}명 · 보조 ${y0.sub[c]}명"><b>${fmtN(y0.have[c])}</b><small>${y0.sub[c] ? `주 ${y0.main[c]} · 보조 ${y0.sub[c]}` : "명"}</small>${bar(y0, c)}</td>
              ${Y.map((y) => { const n = y.need[c], h = y.have[c], dep = subDep(y, c);
                return `<td class="c ${n >= 2 ? "bad" : n ? "warn" : dep ? "sub" : h < cfg.room[c] - 1e-9 ? "thin" : "ok"}" data-cell="${c}:${y.T}" title="${y.T}기 ${esc(posN(c))}: 충원 전 ${fmtN(h)}명 (주 ${y.main[c]} · 보조 ${y.sub[c]})${n ? ` · ${n}명 필요` : dep ? " · 주 포지션만으로는 최소보다 적어요" : h < cfg.room[c] - 1e-9 ? " · 여유 기준보다 적음" : ""}"><b>${n ? "+" + n : "–"}</b><small>충원 전 ${fmtN(h)}${y.sub[c] ? ` · 보조 ${y.sub[c]}` : ""}</small>${bar(y, c)}${dep ? `<small class="dep">보조로 채움</small>` : ""}</td>`; }).join("")}</tr>`; }).join("")}
            <tr class="sum" data-row="heads"><td class="l">섬기는 사람 <small>충원 전 · 사람 수</small></td><td>${minR.N0}명</td>${Y.map((y) => `<td>${y.heads}명</td>`).join("")}</tr>
            <tr class="sum key" data-row="min"><td class="l">최소 운영 충원</td><td>–</td>${Y.map((y) => `<td>${y.minT}명</td>`).join("")}</tr>
            <tr class="sum key" data-row="keep"><td class="l">지금 규모(${keepR.N0}명) 유지 충원</td><td>–</td>${KY.map((y) => `<td>${y.add}명</td>`).join("")}</tr>
            <tr class="mv"><td class="l">졸업</td><td>–</td>${M.moves.slice(1).map((x) => `<td title="${esc(x.grads.map((p) => p.name).join(", "))}">${x.grads.length || "–"}</td>`).join("")}</tr>
            <tr class="mv"><td class="l">이탈 가정 (${FC.sc === "opt" ? "낙관" : "비관"})</td><td>–</td>${M.moves.slice(1).map((x) => `<td title="${esc(x.outs.map((p) => `${p.name} ${EXIT_REASON[p.ex.reason]}`).join(", "))}">${x.outs.length || "–"}</td>`).join("")}</tr>
            <tr class="mv"><td class="l">복귀</td><td>–</td>${M.moves.slice(1).map((x) => `<td title="${esc(x.backs.map((p) => p.name).join(", "))}">${x.backs.length || "–"}</td>`).join("")}</tr>
          </tbody></table></div>
        <div class="lg" style="padding:12px 20px 16px"><span><i style="background:var(--bad-bg);border:1px solid #EBC3BF"></i>2명 이상 필요</span><span><i style="background:var(--warn-bg)"></i>1명 필요</span>
          <span><i style="background:repeating-linear-gradient(135deg,#FFF6E8 0 3px,#fff 3px 6px);border:1px solid #E9C98F"></i>보조로만 최소를 채움</span><span><i style="background:#FBF8FE;border:1px dashed var(--violet-soft)"></i>최소는 되지만 여유 기준보다 적음</span>
          <span><i style="background:var(--violet-mid)"></i>주 포지션</span><span><i style="background:repeating-linear-gradient(135deg,var(--violet-soft) 0 2px,#fff 2px 4px)"></i>보조 포지션</span>
          <span>포지션 합계는 보조 포지션까지 세서 사람 수보다 커요 · 숫자에 마우스를 올리면 자세히 보여요</span></div>
      </section>
      <section class="panel"><h2>리더십 승계 <small>${FC.sc === "pess" ? "비관: 모든 직책이 1년마다 바뀐다고 가정 · " : ""}예상 종료는 직책마다 · 후보 조건은 기준 설정에서</small></h2>
        <div class="fc-leads">${fcLeadHTML(M)}</div></section>`;
    bindFcLeads(M);
  }

  function drawFcPyramid(M) {
    const cfg = M.cfg, k = Math.min(FC.t, M.H), T = M.T0 + k;
    const R = M.run(FC.plan), Y = R.years[k];
    const recs = R.recs.filter((r) => r.k <= k && r.cohort >= T + M.G);
    const last = T + M.G;
    const top = Math.max(+cfg.young + k, ...M.ppl.map((p) => p.cohort || 0), ...recs.map((r) => r.cohort));
    const grads = M.ppl.filter((p) => p.cohort != null && p.cohort < last);
    const pf = FC.pf !== "all" && FC_POS.includes(FC.pf) ? FC.pf : null;
    let mN = 0, fN = 0, away = 0;
    const chip = (p) => {
      const s = M.stateAt(p, k);
      if (s === "on") { if (p.gender === "m") mN++; else if (p.gender === "f") fN++; } else away++;
      // 019.5: 직책은 이름표 + 테두리, 주 포지션은 굵게, 보조 포지션은 '+이름'으로 (직책이 포지션을 가리지 않음)
      const t = p.title ? TITLE_SHORT[p.title] : "";
      const st = s === "mil" ? "mil" : s === "gone" ? "gone" : "";
      const hl = !pf ? "" : p.main === pf ? "pf-main" : p.subs.includes(pf) ? "pf-sub" : "pf-off";
      const subs = p.subs.map((c) => POS_SHORT[c] || c).join("·");
      return `<span class="fc-p ${p.gender || "x"} ${st} ${t ? "role" : ""} ${hl}" data-p="${p.id}" tabindex="0" title="${esc(`${p.name} · ${posLine(p)}${p.title ? " · " + TITLES[p.title] : ""}${s === "mil" ? " · 군복무 중" : s === "gone" ? " · " + EXIT_REASON[p.ex.reason] : ""}`)}">`
        + `${t ? `<em class="rt">${t}</em>` : ""}<b>${s === "mil" ? "복무" : esc(POS_SHORT[p.main] || "—")}</b>${subs ? `<i>+${esc(subs)}</i>` : ""}</span>`;
    };
    const rows = [];
    for (let c = last; c <= top; c++) {
      const g = M.ppl.filter((p) => p.cohort === c), rc = recs.filter((r) => r.cohort === c);
      const left = g.filter((p) => p.gender === "m").map(chip).join(""), right = g.filter((p) => p.gender !== "m").map(chip).join("")
        + rc.map((r) => `<span class="fc-p new ${r.pos ? "" : "extra"} ${pf ? (r.pos === pf ? "pf-main" : "pf-off") : ""}" title="${r.k + M.T0}기에 충원${r.pos ? " · " + esc(positionName(r.pos)) : ""}"><b>${r.pos ? POS_SHORT[r.pos] : "추가"}</b><i>충원</i></span>`).join("");
      const yl = c - last;
      rows.push(`<div class="fc-row"><div class="fc-m">${left}</div>
        <div class="fc-mid ${yl === 0 ? "last" : ""} ${rc.length && !g.length ? "new" : ""}"><b>${c}<small>기</small></b><span>${yl === 0 ? "이번 기 마지막" : `${yl}년 남음`}${rc.length ? ` · 충원 ${rc.length}` : ""}</span></div>
        <div class="fc-f">${right}</div></div>`);
    }
    const none = M.ppl.filter((p) => p.cohort == null);
    if (none.length) rows.push(`<div class="fc-row"><div class="fc-m">${none.filter((p) => p.gender === "m").map(chip).join("")}</div>
      <div class="fc-mid nocoh"><b>기수 ?</b><span>졸업 계산 안 됨</span></div><div class="fc-f">${none.filter((p) => p.gender !== "m").map(chip).join("")}</div></div>`);
    const total = Y.heads + Y.add, d = total - R.N0;
    const yrs = Array.from({ length: M.H + 1 }, (_, i) => i);
    // 019.5: 포지션별 인원 (그 기 · 주 + 보조 + 충원 예정, 최소와 비교)
    const recN = (c) => (Y.recs || []).filter((r) => r.pos === c).length;
    const posStat = (c) => { const main = Y.main[c] + recN(c), sub = Y.sub[c], tot = main + sub, min = +cfg.min[c];
      const lv = tot < min - 1e-9 ? "bad" : main < min - 1e-9 ? "warn" : "ok";
      return { c, main, sub, tot, min, lv, txt: lv === "bad" ? `부족 ${fmtN(min - tot)}` : lv === "warn" ? "보조로 채움" : "충족" }; };
    const PS = FC_POS.map(posStat);
    // 포지션별 인원 = 포지션 보기(필터) 겸용. 줄을 누르면 그 포지션만 강조, 다시 누르면 전체
    const posPanel = `<section class="panel fc-pos" style="gap:8px"><h2 style="font-size:15px">포지션별 인원 <small>${pf ? `<button type="button" class="btn btn-ghost btn-sm" data-pf="all">전체 보기</button>` : `${T}기 · 누르면 강조`}</small></h2>
        <div id="fcPf" role="group" aria-label="포지션 보기" style="display:flex;flex-direction:column;gap:2px">
        ${PS.map((x) => { const full = Math.max(x.min, x.tot, 1) * 1.15;
          return `<button type="button" class="fc-pos-row ${pf === x.c ? "on" : ""}" data-pf="${x.c}" data-pos="${x.c}" aria-pressed="${pf === x.c}" title="${esc(POS_SHORT[x.c])} ${T}기: 주 ${fmtN(x.main)} · 보조 ${fmtN(x.sub)} / 최소 ${x.min} · ${x.txt}"><b>${esc(POS_SHORT[x.c] || x.c)}</b>
            <span class="fc-pos-mid"><span class="fc-bar" aria-hidden="true"><i class="m" style="width:${Math.round(100 * x.main / full)}%"></i><i class="s" style="width:${Math.round(100 * x.sub / full)}%"></i><i class="ln" style="left:${Math.round(100 * x.min / full)}%"></i></span>
            <small>주 ${fmtN(x.main)}${recN(x.c) ? `(충원 ${recN(x.c)})` : ""} · 보조 ${fmtN(x.sub)} · 최소 ${x.min}</small></span>
            <span class="fc-badge ${x.lv}">${x.txt}</span></button>`; }).join("")}</div>
        <div class="lg" style="font-size:11.5px;gap:10px"><span><i style="background:var(--violet-mid)"></i>주</span><span><i style="background:repeating-linear-gradient(135deg,var(--violet-soft) 0 2px,#fff 2px 4px)"></i>보조</span><span><i style="background:var(--ink);width:2px"></i>최소</span></div></section>`;
    // 019.5 B안: 위는 한 줄(기 고르기 · 충원 반영), 아래는 3열(숫자·포지션 | 피라미드 | 리더십)
    $("#fcBody").innerHTML = `${fcNoCohort(M)}
      <section class="panel fc-ctl" style="border-color:var(--violet-soft)">
        <span class="fc-ctl-t" id="fcAt" style="font-size:17px;font-weight:800">${T}기 · ${k ? k + "년 뒤" : "지금"} <span class="small muted" style="font-weight:600">${termStartLabel(M.TN, k, true)}월 시작</span></span>
        <div class="fc-years" role="group" aria-label="볼 기">${yrs.map((i) => `<button type="button" data-k="${i}" aria-pressed="${i === k}"><b>${M.T0 + i}기</b><span>${i ? i + "년 뒤" : "지금"}</span></button>`).join("")}</div>
        <div class="seg" id="fcPlan" role="group" aria-label="충원 반영"><span class="small muted" style="align-self:center;margin-right:4px">충원 반영</span>
          ${[["none", "안 함"], ["min", "최소 운영"], ["keep", "규모 유지"]].map(([v, l]) => `<button type="button" data-plan="${v}" aria-pressed="${FC.plan === v}">${l}</button>`).join("")}</div>
      </section>
      <div class="fc-3col">
        <aside class="fc-col-l">
          <section class="panel" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
            <div class="fc-stat"><span>섬기는 인원</span><b>${total}명</b><small style="color:${d < 0 ? "var(--bad)" : "var(--muted)"}">${k ? (d === 0 ? "지금과 같음" : d > 0 ? `지금보다 +${d}` : `지금보다 ${d}`) : `${M.T0}기 기준`}</small></div>
            <div class="fc-stat"><span>자리 비움</span><b>${away}명</b><small>군복무·이탈 가정</small></div>
            ${k && Y.add ? `<div class="fc-stat" style="grid-column:1/-1"><span>${T}기 충원</span><b>${Y.add}명</b><small>${FC_POS.filter((c) => Y.need[c]).map((c) => `${POS_SHORT[c]} ${Y.need[c]}`).join(" · ")}${Y.add > Y.minT ? ` · 추가 ${Y.add - Y.minT}` : ""}</small></div>` : ""}
          </section>
          ${posPanel}
        </aside>
        <section class="panel fc-col-p" style="gap:6px;overflow-x:auto">
          <div class="fc-row head"><span style="text-align:right;color:#1F4E7A">남 ${mN}</span><span style="text-align:center">공동체 기수</span><span style="color:#7E2556">여 ${fN}</span></div>
          ${grads.length ? `<div class="fc-grad">졸업 · ${Math.min(...grads.map((p) => p.cohort))}${last - 1 > Math.min(...grads.map((p) => p.cohort)) ? `~${last - 1}` : ""}기 ${grads.length}명</div>` : ""}
          ${rows.join("")}
          <div class="lg" style="padding-top:12px;margin-top:6px;border-top:1px solid var(--tint)">
            <span><i style="background:#D9E8F7"></i>남</span><span><i style="background:#F6DCEA"></i>여</span>
            <span><b style="color:var(--ink)">싱어</b> 주 포지션</span><span><em class="lg-sub">+메인</em> 보조 포지션</span>
            <span><em class="lg-rt">팀장</em> 직책 (이름표 · 보라 테두리)</span>
            <span><i style="background:repeating-linear-gradient(135deg,#E6E1EE 0 3px,#F6F3F9 3px 6px);border:1px solid #CFC6DD"></i>군복무 중</span><span><i style="background:#fff;border:1px dashed #CFC6DD"></i>이탈 가정</span>
            <span><i style="background:#fff;border:1.5px dashed var(--violet-mid)"></i>충원 예정 (성별 미정)</span>
            ${pf ? `<span>실선 테두리 = 주 ${esc(POS_SHORT[pf])} · 점선 테두리 = 보조 ${esc(POS_SHORT[pf])}</span>` : ""}</div>
        </section>
        <aside class="fc-col-r">
          <section class="panel" style="gap:8px"><h2 style="font-size:15px">리더십 4자리 <small>급한 순${FC.sc === "pess" ? " · 비관 · 1년 임기" : ""}</small></h2><div class="fc-leads one">${fcLeadHTML(M, k)}</div></section>
        </aside>
      </div>`;
    const setK = (v) => { FC.t = +v; drawFcPyramid(M); };
    $$(".fc-years [data-k]").forEach((b) => b.addEventListener("click", () => setK(b.dataset.k)));
    $$("#fcPlan [data-plan]").forEach((b) => b.addEventListener("click", () => { FC.plan = b.dataset.plan; drawFcPyramid(M); }));
    $$(".fc-pos [data-pf]").forEach((b) => b.addEventListener("click", () => { FC.pf = b.dataset.pf === "all" || FC.pf === b.dataset.pf ? "all" : b.dataset.pf; drawFcPyramid(M); }));
  }

  function drawFcExits(M) {
    const T0 = M.T0, H = M.H;
    const list = (sc) => S.fcExits.filter((e) => e.scenario === sc).map((e) => ({ e, p: M.ppl.find((x) => x.id === e.member_id), m: S.members.find((x) => x.id === e.member_id) }));
    const terms = Array.from({ length: H }, (_, i) => T0 + 1 + i);
    const row = ({ e, m, p }) => {
      if (!m) return "";
      const gT = m.cohort ? m.cohort - M.G + 1 : null;   // 졸업으로 빠지는 기
      const late = gT && e.out_term >= gT;
      return `<div class="fc-ex" data-ex="${e.id}">
        <div class="who"><b>${esc(m.name)}${m.is_active ? "" : ` <span class="chip chip-gray">휴면</span>`}</b><span class="small muted">${esc((p?.pos || [m.main_position]).map((c) => POS_SHORT[c] || c).join("·"))} · ${m.cohort ? m.cohort + "기" : "기수 ?"}${m.gender ? " · " + GENDER[m.gender] : ""}${gT ? ` · ${gT}기에 졸업` : ""}</span></div>
        <select class="select" data-f="reason" aria-label="사유">${Object.entries(EXIT_REASON).map(([v, l]) => `<option value="${v}" ${e.reason === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select class="select" data-f="out_term" aria-label="빠지는 기">${[...new Set([...terms, e.out_term])].sort((a, b) => a - b).map((t) => `<option value="${t}" ${+e.out_term === t ? "selected" : ""}>${t}기부터 없음</option>`).join("")}</select>
        <select class="select" data-f="back_term" aria-label="돌아오는 기"><option value="">안 돌아옴</option>${[...new Set([...terms.filter((t) => t > e.out_term), ...(e.back_term ? [e.back_term] : [])])].sort((a, b) => a - b).map((t) => `<option value="${t}" ${+e.back_term === t ? "selected" : ""}>${t}기에 복귀</option>`).join("")}</select>
        <span class="row" style="gap:4px;flex-wrap:nowrap"><button type="button" class="btn btn-ghost btn-sm" data-move="${e.scenario === "opt" ? "pess" : "opt"}">${e.scenario === "opt" ? "비관으로" : "낙관으로"}</button>
          <button type="button" class="lu-x" data-del aria-label="${esc(m.name)} 가정 빼기"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></span>
        ${late ? `<span class="fc-ex-note">${gT}기에 졸업이라 이 가정은 결과에 영향이 없어요</span>` : e.note ? `<span class="fc-ex-note muted">${esc(e.note)}</span>` : ""}</div>`;
    };
    const opt = list("opt"), pess = list("pess");
    const sec = (sc, title, sub, rows, border) => `<section class="panel" style="${border}"><h2>${title} <small>${sub}</small></h2>
      ${rows.length ? `<div class="fc-ex head"><span>멤버</span><span>사유</span><span>빠지는 기</span><span>돌아오는 기</span><span></span></div>${rows.map(row).join("")}` : `<span class="small muted">아직 없어요.</span>`}
      <button type="button" class="btn btn-soft btn-sm" data-add="${sc}" style="align-self:flex-start">+ 멤버 골라서 추가</button></section>`;
    $("#fcBody").innerHTML = `<div class="note-box"><b>비관 = 낙관 + 비관에 추가한 사람</b> · 졸업은 기수로 자동 계산하니 따로 넣지 않아도 돼요. 졸업 전에 빠질 것 같은 사람만 골라 주세요. 리더십만 볼 수 있어요.</div>
      ${sec("opt", "낙관", `거의 확실한 이탈 · ${opt.length}명`, opt, "")}
      ${sec("pess", "비관에 추가", `가능성 있는 이탈 · ${pess.length}명`, pess, "border-color:#EBC3BF")}`;
    $$(".fc-ex[data-ex] select").forEach((s) => s.addEventListener("change", async () => {
      const id = +s.closest("[data-ex]").dataset.ex, e = S.fcExits.find((x) => x.id === id);
      const patch = { [s.dataset.f]: s.value === "" ? null : s.dataset.f === "reason" ? s.value : +s.value };
      if (s.dataset.f === "out_term" && e.back_term && e.back_term <= patch.out_term) patch.back_term = null;
      const { error } = await sb.from("forecast_exits").update(patch).eq("id", id);
      if (error) return toast("저장하지 못했어요", 3500);
      toast("저장했어요"); renderForecast();
    }));
    $$(".fc-ex [data-move]").forEach((b) => b.addEventListener("click", async () => {
      const id = +b.closest("[data-ex]").dataset.ex;
      const { error } = await sb.from("forecast_exits").update({ scenario: b.dataset.move }).eq("id", id);
      if (error) return toast("옮기지 못했어요", 3500);
      toast(b.dataset.move === "pess" ? "비관으로 옮겼어요" : "낙관으로 옮겼어요"); renderForecast();
    }));
    $$(".fc-ex [data-del]").forEach((b) => b.addEventListener("click", async () => {
      const id = +b.closest("[data-ex]").dataset.ex;
      const { error } = await sb.from("forecast_exits").delete().eq("id", id);
      if (error) return toast("빼지 못했어요", 3500);
      toast("가정에서 뺐어요"); renderForecast();
    }));
    $$("[data-add]").forEach((b) => b.addEventListener("click", () => openFcExit(M, b.dataset.add)));
  }

  function openFcExit(M, sc) {
    const used = new Set(S.fcExits.map((e) => e.member_id));
    const ms = S.members.filter((m) => m.is_active && !used.has(m.id) && (m.cohort == null || m.cohort >= M.T0 + 1 + M.G)).sort((a, b) => a.name.localeCompare(b.name, "ko"));
    const terms = Array.from({ length: M.H }, (_, i) => M.T0 + 1 + i);
    let reason = "military";
    modal({
      step: sc === "opt" ? "낙관 · 거의 확실한 이탈" : "비관에 추가 · 가능성 있는 이탈", title: "이탈 가정 추가",
      body: `${ms.length ? "" : `<p class="notice warn" style="margin:0">고를 수 있는 멤버가 없어요. 이미 가정에 넣었거나 ${M.T0 + 1}기 전에 졸업하는 사람은 빠져요.</p>`}
        <label class="field">멤버<select class="select" id="fxWho"><option value="">고르기</option>${ms.map((m) => `<option value="${m.id}">${esc(m.name)} · ${esc(POS_SHORT[m.main_position] || "")}${m.cohort ? " · " + m.cohort + "기" : ""}</option>`).join("")}</select></label>
        <div class="field"><span>사유</span><div class="seg" id="fxWhy">${Object.entries(EXIT_REASON).map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${v === reason}">${l}</button>`).join("")}</div></div>
        <div class="grid2">
          <label class="field">빠지는 기<select class="select" id="fxOut">${terms.map((t) => `<option value="${t}">${t}기부터 없음</option>`).join("")}</select></label>
          <label class="field">돌아오는 기 <span class="hint">· 군입대처럼 돌아오면</span><select class="select" id="fxBack"><option value="">안 돌아옴</option></select></label></div>
        <label class="field">메모 (선택)<input type="text" id="fxNote" maxlength="100" placeholder="예: 내년 3월 입대 예정"></label>`,
      onInput: (e) => {
        const b = e?.target?.closest?.("#fxWhy button");
        if (b && e.type === "click") { reason = b.dataset.v; $$("#fxWhy button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }
        if (!e || e.target?.id === "fxOut" || (b && e.type === "click")) {
          const out = +$("#fxOut").value, cur = $("#fxBack").value;
          const opts = terms.filter((t) => t > out);
          $("#fxBack").innerHTML = `<option value="">안 돌아옴</option>${opts.map((t) => `<option value="${t}">${t}기에 복귀</option>`).join("")}`;
          const want = cur && opts.includes(+cur) ? cur : reason === "military" && !cur && b ? String(out + 2 <= terms[terms.length - 1] ? out + 2 : "") : cur;
          $("#fxBack").value = opts.includes(+want) ? want : "";
        }
      },
      confirmLabel: "추가",
      onConfirm: async (close) => {
        const who = $("#fxWho").value;
        if (!who) throw new Error("멤버를 골라 주세요.");
        const back = $("#fxBack").value;
        const { error } = await sb.from("forecast_exits").insert({ member_id: who, scenario: sc, reason, out_term: +$("#fxOut").value, back_term: back ? +back : null, note: $("#fxNote").value.trim() || null, created_by: S.me.id });
        if (error) throw new Error(/duplicate|unique/i.test(error.message) ? "이미 가정에 넣은 사람이에요." : "저장하지 못했어요");
        close(); toast("이탈 가정에 넣었어요"); renderForecast();
      },
    });
  }

  function drawFcSettings(cfg) {
    const posN = (c) => (window.__allPositions || []).find((p) => p.code === c)?.name || c;
    const num = (id, v, min, max, w = 76) => `<input type="number" class="input fc-num" id="${id}" value="${v}" min="${min}" max="${max}" style="width:${w}px">`;
    $("#fcBody").innerHTML = `<section class="panel"><h2>기수 · 졸업 <small>기 시작 월이 지나면 다음 기로 자동으로 넘어가요</small></h2>
        <div class="fc-set">
          <label class="field">지금 명단의 기<span style="display:flex;align-items:center;gap:6px">${num("fsTerm", termNow(cfg).term, 1, 200)}기</span><span class="hint">멤버 목록이 몇 기 명단인지</span></label>
          <label class="field">기 시작 월<select class="select" id="fsMonth">${Array.from({ length: 12 }, (_, i) => i + 1).map((mo) => `<option value="${mo}" ${termNow(cfg).month === mo ? "selected" : ""}>${mo}월</option>`).join("")}</select><span class="hint" id="fsMonthTxt"></span></label>
          <label class="field">마지막 기수<span style="display:flex;align-items:center;gap:6px">기 + ${num("fsGrad", cfg.grad, 0, 60)}</span><span class="hint" id="fsGradTxt"></span></label>
          <label class="field">가장 어린 기수 (지금)<span style="display:flex;align-items:center;gap:6px">${num("fsYoung", cfg.young, 1, 200)}기</span><span class="hint">공동체에 새로 들어오는 기수 · 해마다 1씩 늘려 셈</span></label>
          <label class="field">충원자 기수<select class="select" id="fsAge">${[0, 1, 2, 3, 4].map((i) => `<option value="${i}" ${+cfg.recruitAge === i ? "selected" : ""}>${i ? `가장 어린 기수보다 ${i}기 위` : "가장 어린 기수"}</option>`).join("")}</select><span class="hint">어린 기수일수록 오래 섬겨서 다음 충원이 줄어요</span></label>
          <label class="field">전망 기간<select class="select" id="fsH">${[3, 5, 8].map((h) => `<option value="${h}" ${+cfg.horizon === h ? "selected" : ""}>${h}년</option>`).join("")}</select></label>
        </div></section>
      <section class="panel"><h2>포지션별 인원 기준 <small>한 사람이 한 달에 2번 이하로 섬기는 정도</small></h2>
        <div style="overflow-x:auto"><table class="fc-table set"><thead><tr><th class="l">포지션</th><th>주일 자리</th><th>최소</th><th>여유</th></tr></thead>
          <tbody>${FC_POS.map((c) => `<tr><td class="l"><b>${esc(posN(c))}</b></td><td>${(() => { const p = (window.__allPositions || []).find((x) => x.code === c); return p ? (p.max_count > baseOf(p) ? `${baseOf(p)} <span class="small muted">(최대 ${p.max_count})</span>` : baseOf(p)) : "–"; })()}</td>
            <td>${num("fsMin_" + c, cfg.min[c], 0, 30, 70)}</td><td>${num("fsRoom_" + c, cfg.room[c], 0, 30, 70)}</td></tr>`).join("")}</tbody></table></div>
        <span class="small muted">최소보다 적으면 그 기에 뽑을 인원으로 잡혀요. 최소는 되지만 여유보다 적으면 표에 연하게 표시돼요.</span></section>
      <section class="panel"><h2>직책 후보 조건 <small>그 직책이 비는 기에 지정 후보가 없고, 조건을 채운 사람도 1명 이하면 경고</small></h2>
        <div class="fc-cand">${TITLE_ORDER.map((t) => `<div><b>${TITLES[t]}</b>
          <select class="select" id="fsPart_${t}" aria-label="${TITLES[t]} 후보 포지션">${Object.entries(CAND_PART).map(([v, l]) => `<option value="${v}" ${cfg.cand[t].part === v ? "selected" : ""}>${l}</option>`).join("")}</select>
          <select class="select" id="fsYears_${t}" aria-label="${TITLES[t]} 섬긴 기간">${[1, 2, 3, 4].map((y) => `<option value="${y}" ${+cfg.cand[t].years === y ? "selected" : ""}>${y}년째 이상</option>`).join("")}</select></div>`).join("")}</div>
        <span class="small muted">함께한 날(멤버 정보)로 햇수를 세요. 다음 기에도 남아 있는 사람만 후보로 봐요. 직책별 예상 종료와 승계 후보는 충원 계획 탭 아래에서 정해요.</span></section>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn btn-ghost" id="fsReset">기본값으로</button><button type="button" class="btn btn-primary" id="fsSave">저장</button></div>`;
    const gradTxt = () => { const t = +$("#fsTerm").value || 0, g = +$("#fsGrad").value || 0; $("#fsGradTxt").textContent = `${t}기에는 ${t + g}기까지, ${t + 1}기에는 ${t + 1 + g}기까지 남아요`; };
    ["#fsTerm", "#fsGrad"].forEach((s) => $(s).addEventListener("input", gradTxt)); gradTxt();
    // 019: 기 시작 월 — 지금 기가 시작된 해는 그대로 두고 달만 바꿈. 해마다 이 달에 다음 기로 넘어가요
    const TN = termNow(cfg);
    const startOf = () => { const mo = +$("#fsMonth").value; return `${TN.startY}-${String(mo).padStart(2, "0")}`; };
    const monthTxt = () => { const mo = +$("#fsMonth").value, t = +$("#fsTerm").value || 0; $("#fsMonthTxt").textContent = `${t}기 ${TN.startY}.${mo}월 시작 · ${TN.startY + 1}.${mo}월에 ${t + 1}기로 넘어가요`; };
    ["#fsMonth", "#fsTerm"].forEach((s) => $(s).addEventListener("input", monthTxt)); $("#fsMonth").addEventListener("change", monthTxt); monthTxt();
    const save = async (val) => {
      const { error } = await sb.from("team_settings").update({ forecast: val }).eq("id", 1);
      if (error) return toast("저장하지 못했어요", 3500);
      S.settings = await loadSettings(true); toast(val ? "기준을 저장했어요" : "기본값으로 되돌렸어요"); renderForecast();
    };
    $("#fsReset").onclick = () => save(null);
    $("#fsSave").onclick = () => {
      const n = (id, lo, hi) => { const v = +$(id).value; if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(); return v; };
      try {
        const val = { term: n("#fsTerm", 1, 200), termMonth: +$("#fsMonth").value, termStart: startOf(), grad: n("#fsGrad", 0, 60), young: n("#fsYoung", 1, 200), recruitAge: +$("#fsAge").value, horizon: +$("#fsH").value,
          min: Object.fromEntries(FC_POS.map((c) => [c, n("#fsMin_" + c, 0, 30)])), room: Object.fromEntries(FC_POS.map((c) => [c, n("#fsRoom_" + c, 0, 30)])),
          cand: Object.fromEntries(TITLE_ORDER.map((t) => [t, { part: $("#fsPart_" + t).value, years: +$("#fsYears_" + t).value }])) };
        if (FC_POS.some((c) => val.room[c] < val.min[c])) return toast("여유는 최소보다 크거나 같아야 해요", 3500);
        if (val.young < val.term + val.grad) return toast("가장 어린 기수가 마지막 기수보다 작아요. 숫자를 확인해 주세요", 4000);
        save(val);
      } catch { toast("숫자를 확인해 주세요", 3000); }
    };
  }

  // ---------------------------------------------------------------- 새로고침해도 보던 탭 유지 (014)
  const UI_KEY = "pole2.admin.ui";
  const UI_FIELDS = [[S, ["memberFilter", "memberGroup"]], [V, ["month", "respView", "lineupMonth", "view", "part"]],
    [A, ["tab", "month", "mfilter", "skind", "srange"]], [SC, ["month"]], [MS, ["tab", "id"]], [NV, ["tab", "sel"]], [FC, ["tab", "sc", "plan", "t", "pf"]], [SH, ["tab", "range", "state", "by"]]];
  function restoreUI() {
    try {
      const u = JSON.parse(sessionStorage.getItem(UI_KEY) || "[]");
      UI_FIELDS.forEach(([o, ks], i) => ks.forEach((k) => { if (u[i] && u[i][k] != null) o[k] = u[i][k]; }));
    } catch {}
  }
  const saveUI = () => { try { sessionStorage.setItem(UI_KEY, JSON.stringify(UI_FIELDS.map(([o, ks]) => Object.fromEntries(ks.map((k) => [k, o[k] ?? null]))))); } catch {} };
  window.addEventListener("pagehide", saveUI);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveUI(); });

  // ---------------------------------------------------------------- 시작
  (async function init() {
    const ctx = await requireMember({ admin: true });
    if (!ctx) return;
    S.me = ctx.me;
    $("#whoName").textContent = `${S.me.name}님`;
    await loadAll();
    window.__allPositions = await loadPositions();
    if (!(history.state && "lv" in history.state)) {   // 대시보드를 맨 아래에 깔아 둠
      const first = location.hash && location.hash !== "#" ? location.hash : "#dashboard";
      history.replaceState({ lv: 0 }, "", "#dashboard");
      if (first !== "#dashboard") history.pushState({ lv: first.includes("/") ? 2 : 1 }, "", first);
    } else if (history.state.modal) history.replaceState({ lv: lv() }, "");   // 창이 열린 채 새로고침한 경우
    restoreUI();
    route();

    sb.channel("new-applications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "applications" }, async (payload) => {
        S.newIds.add(payload.new.id);
        toast(`새 지원서: ${payload.new.name}님`, 4000);
        await loadAll();
        if (["", "#pipeline", "#dashboard"].includes(location.hash)) route(); else updateTodoCount();
      })
      .subscribe();
  })();
})();
