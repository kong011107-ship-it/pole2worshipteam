// =====================================================================
//  관리자 화면 — 모집·수습 파이프라인 / 지원자 상세 / 멤버 / 안내 문구
// =====================================================================
(function () {
  const S = {
    me: null, apps: [], logs: [], members: [], extras: [], evals: [], templates: [], items: [], postpones: [],
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

  const app = (id) => S.apps.find((a) => a.id === id);
  const tpl = (code) => S.templates.find((t) => t.code === code);
  const memberName = (id) => S.members.find((m) => m.id === id)?.name ?? "—";
  const admins = () => S.members.filter((m) => m.role === "admin" && m.is_active);
  const sent = (appId, code) => S.logs.some((l) => l.application_id === appId && l.template_code === code);
  const ctxOf = (a, extra = {}) => ({ name: a.name, email: a.email, interviewAt: a.interview_at,
    interviewPlace: a.interview_place, traineeStart: a.trainee_start, ...extra });
  const pp = (appId) => S.postpones.filter((p) => p.application_id === appId);
  const alumniOf = (a) => (S.alumni || []).filter((x) => x.name === a.name);
  const REMOVE_REASONS = ["졸업·파송", "MC 콜링", "휴면 연장 의사 미전달", "본인 요청", "기타"];
  const tstate = (a) => traineeState(a.trainee_start, pp(a.id));

  // ---------------------------------------------------------------- 데이터
  async function loadAll() {
    const [apps, logs, members, extras, evals, templates, items, postpones, alumni] = await Promise.all([
      sb.from("applications").select("*").order("created_at", { ascending: false }),
      sb.from("message_log").select("*").order("sent_at"),
      sb.from("members").select("*").order("name"),
      sb.from("member_extra_positions").select("*"),
      sb.from("interview_evaluations").select("*"),
      sb.from("message_templates").select("*").order("sort_order"),
      sb.from("eval_items").select("*").order("sort_order"),
      sb.from("trainee_postpones").select("*").order("from_week"),
      sb.from("alumni").select("*").order("left_at", { ascending: false }),
    ]);
    const err = [apps, logs, members, extras, evals, templates, items, postpones].find((r) => r.error);
    if (err) { toast("데이터를 불러오지 못했습니다. 새로고침해 주세요."); console.error(err.error); }
    S.apps = apps.data || []; S.logs = logs.data || []; S.members = members.data || [];
    S.extras = extras.data || []; S.evals = evals.data || []; S.templates = templates.data || []; S.items = items.data || [];
    S.postpones = postpones.data || [];
    S.alumni = alumni.data || [];
    await loadPositions(true);
  }

  async function logMessage(appId, code) {
    if (!code) return;
    const { data, error } = await sb.from("message_log").insert({ application_id: appId, template_code: code, sent_by: S.me.id }).select().single();
    if (!error && data) S.logs.push(data);
  }

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

  // ---------------------------------------------------------------- 라우팅
  function route() {
    const h = location.hash.slice(1) || "dashboard";
    const [view, id] = h.split("/");
    $$(".side nav a").forEach((a) => a.classList.toggle("on", a.dataset.nav === (view === "app" ? "pipeline" : view === "member" ? "members" : view)));
    updateTodoCount();
    if (view === "app" && id) return renderDetail(id);
    if (view === "member" && id) return renderMemberDetail(id);
    if (view === "pipeline") return renderPipeline();
    if (view === "attendance") return renderAttendance();
    if (view === "members") return renderMembers();
    if (view === "respond") return renderRespondAdmin();
    if (view === "settings") return renderSettings();
    if (view === "lineup") return renderLineupAdmin();
    if (view === "templates") return renderTemplates();
    return renderDashboard();
  }
  window.addEventListener("hashchange", () => { route(); window.scrollTo(0, 0); });
  // 이미 보고 있는 메뉴를 다시 누르면 새로 불러오기
  document.addEventListener("click", async (e) => {
    const a = e.target.closest(".side nav a");
    if (a && a.getAttribute("href") === location.hash) { e.preventDefault(); await loadAll(); route(); }
  });

  function updateTodoCount() {
    const n = S.apps.filter((a) => cardTodo(a).pending).length;
    $("#todoCount").textContent = n;
    $("#todoCount").classList.toggle("hidden", !n);
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
  function modal({ step, title, body, confirmLabel, onConfirm, onInput, cancelLabel = "취소", danger = false }) {
    const root = $("#modalRoot");
    root.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle">
      ${step ? `<span class="step">${esc(step)}</span>` : ""}
      <h3 id="mTitle">${esc(title)}</h3>
      <div id="mBody" style="display:flex;flex-direction:column;gap:14px">${body}</div>
      <div class="actions"><button type="button" class="btn btn-ghost" id="mCancel">${cancelLabel}</button>
        ${confirmLabel ? `<button type="button" class="btn ${danger ? "btn-bad" : "btn-primary"}" id="mOk">${esc(confirmLabel)}</button>` : ""}</div>
    </div></div>`;
    const close = () => (root.innerHTML = "");
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
  async function renderDetail(id) {
    const a = app(id);
    if (!a) { $("#content").innerHTML = `<div class="empty">지원자를 찾을 수 없습니다. <a href="#pipeline">모집·수습으로</a></div>`; return; }
    const { data: weeks } = await sb.from("trainee_weeks").select("*").eq("application_id", id).order("week");
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
      row.querySelector("[data-save]").addEventListener("click", async () => {
        const val = (f) => { const p = row.querySelector(`.seg[data-field=${f}] [aria-pressed=true]`); return p ? p.dataset.v === "true" : null; };
        const patch = {
          application_id: a.id, week: +row.dataset.week,
          sat_attended: val("sat_attended"), sun_attended: val("sun_attended"),
          leader_id: row.querySelector("[data-field=leader_id]").value || null,
          note: row.querySelector("[data-field=note]").value.trim() || null,
          updated_by: S.me.id,
        };
        const { error } = await sb.from("trainee_weeks").upsert(patch);
        if (error) return toast("저장하지 못했습니다");
        toast(`${patch.week}주차 기록을 저장했어요`);
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
    const q = [a.q_practice && "토요 연습·팀모임 참석", a.q_sunday && "주일 예배 참여", a.q_group && "순모임 소속"].filter(Boolean);
    body.innerHTML = `<section class="card bordered"><dl class="kv" style="grid-template-columns:140px minmax(0,1fr);gap:14px 20px;line-height:1.65">
      <dt>지원 자격</dt><dd>${q.join(" · ")} ${q.length === 3 ? `<span class="chip chip-ok">3항목 확인</span>` : ""}</dd>
      <dt>연락처</dt><dd>${esc(a.phone)}</dd><dt>이메일</dt><dd>${esc(a.email)}</dd><dt>순모임</dt><dd>${esc(a.small_group) || "—"}</dd>
      <dt>지원 포지션</dt><dd>${esc(positionName(a.applied_position))}</dd>
      <dt>지원 동기</dt><dd>${esc(a.motivation) || "—"}</dd><dt>이루고 싶은 것</dt><dd>${esc(a.goal) || "—"}</dd>
      <dt>서약</dt><dd>${esc(a.pledge_title)} · ${fmtDate(a.pledged_at)} 서약
        <details style="margin-top:8px"><summary style="cursor:pointer;color:var(--violet);font-weight:700">원문 보기</summary><div class="pledge-box" style="margin-top:8px">${esc(a.pledge_content)}</div></details></dd>
      <dt>관리자 메모</dt><dd><textarea class="input" id="memo" maxlength="1000" style="min-height:80px" placeholder="리더십끼리만 보는 메모">${esc(a.admin_memo || "")}</textarea></dd>
    </dl></section>`;
    $("#memo").addEventListener("change", async (e) => {
      const { error } = await sb.from("applications").update({ admin_memo: e.target.value.trim() || null }).eq("id", a.id);
      if (error) return toast("저장하지 못했습니다");
      a.admin_memo = e.target.value.trim() || null; toast("메모를 저장했어요");
    });
  }

  function renderLog(a, body) {
    const logs = S.logs.filter((l) => l.application_id === a.id);
    const due = S.templates.filter((t) => !sent(a.id, t.code));
    body.innerHTML = `<section class="loglist">${logs.length ? logs.map((l) => `<div><span class="muted" style="font-weight:600">${fmtDate(l.sent_at, { hour: "numeric", minute: "2-digit" })}</span>
        <b>${esc(tpl(l.template_code)?.title || l.template_code)}</b><span class="muted">${esc(memberName(l.sent_by))}</span></div>`).join("")
      : `<div><span class="muted">아직 보낸 안내가 없어요</span></div>`}</section>
      <p class="small muted" style="margin:0">지원자가 "지금 내가 어느 단계에 있는지" 항상 알 수 있게 하는 게 목적이에요. 위의 "안내 문구 보내기"로 보내면 여기에 남아요.</p>`;
  }

  // ================================================================ 활동 데이터 (섬김 · 출석 공용)
  //  공개된 배치표 = 섬김 통계, 토요일 줄(team_meetings) + 출석 = 출석 통계
  const ACT_KINDS = { practice: "토요 연습", meeting: "팀모임", rehearsal: "주일 리허설" };
  async function loadActivity(fromDate) {
    const [tm, sv] = await Promise.all([
      sb.from("team_meetings").select("id, meeting_date, meeting_status, attendance(*)").gte("meeting_date", fromDate).order("meeting_date"),
      sb.from("services").select("service_date, status, assignments(member_id, position_code, slot, is_singer_leader, is_band_master)").gte("service_date", fromDate).order("service_date"),
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
          <button type="button" data-f="off" aria-pressed="${f === "off"}">휴면·종료 ${cnt((m) => !m.is_active)}</button>
          <button type="button" data-f="alumni" aria-pressed="${f === "alumni"}">탈퇴 기록 ${(S.alumni || []).length}</button></div></div>`;
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
      : f === "active" ? m.is_active && m.status === "active" : !m.is_active).filter((m) => !q || m.name.includes(q));
    const rowHTML = (m) => {
      const s = stat(m);
      const badges = [m.role === "admin" && `<span class="chip chip-violet">리더십</span>`,
        m.status === "trainee" && `<span class="chip chip-mid">${traineeLabel(m)}</span>`,
        !m.is_active && `<span class="chip chip-gray">휴면</span>`,
        s.streak >= STREAK_LIMIT && `<span class="chip chip-bad">팀모임 ${s.streak}회 연속 결석</span>`].filter(Boolean).join("");
      return `<a class="mrow" href="#member/${m.id}"><span class="nm">${esc(m.name)} ${badges}</span><span class="sub">${esc(posText(m))}</span>
        ${m.status === "trainee" ? `<span class="sub">–</span><span class="sub">–</span>` : `<span class="num"><b>${s.monthN}</b>회</span><span class="num"><b>${s.q3}</b>회</span>`}
        ${s.marks.length ? dotsHTML(s.marks) : `<span class="sub">–</span>`}
        ${s.lates ? `<span style="color:var(--mid);font-weight:800">${s.lates}회</span>` : `<span class="sub">–</span>`}<span class="arrow">›</span></a>`;
    };
    const byName = (a, b) => a.name.localeCompare(b.name, "ko");
    let body;
    if (S.memberGroup === "name") body = list.slice().sort(byName).map(rowHTML).join("");
    else body = ["leader", "vocal", "band"].map((part) => {
      const g = list.filter((m) => partOf(m.main_position) === part).sort((a, b) => (m2o(a) - m2o(b)) || byName(a, b));
      return g.length ? `<div class="group-label">${PART_LABEL[part]} · ${g.length}명</div>${g.map(rowHTML).join("")}` : "";
    }).join("");
    function m2o(m) { return posOrder()[m.main_position] ?? 99; }

    $("#content").innerHTML = `${head}
      <div class="mtools">
        <input class="search" id="mSearch" type="search" placeholder="이름 검색" value="${esc(q)}" aria-label="이름 검색">
        <div class="seg" id="mGroup"><span class="small muted" style="align-self:center;margin-right:4px">묶어 보기</span>
          <button type="button" data-g="part" aria-pressed="${S.memberGroup !== "name"}">파트별</button><button type="button" data-g="name" aria-pressed="${S.memberGroup === "name"}">이름순</button></div>
      </div>
      <div class="mtable">
        <div class="mrow head"><span>이름</span><span>포지션</span><span>이번 달 섬김</span><span>최근 3개월</span><span>최근 팀모임 ${held.length}회</span><span>지각 ${LATE_WEEKS}주</span><span></span></div>
        ${body || `<div class="empty" style="border:0;border-radius:0">해당하는 멤버가 없어요.</div>`}
      </div>
      <p class="small muted" style="margin:0">줄을 누르면 상세 화면에서 정보 수정·섬김 통계·출석을 볼 수 있어요. 지각은 토요 연습·주일 리허설 합계예요.</p>`;
    bindMemberHead();
    $("#mGroup").onclick = (e) => { const b = e.target.closest("button"); if (b) { S.memberGroup = b.dataset.g; renderMembers(); } };
    $("#mSearch").oninput = (e) => {
      S.memberQuery = e.target.value;
      clearTimeout(renderMembers.t); renderMembers.t = setTimeout(async () => { await renderMembers(); const i = $("#mSearch"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250);
    };
  }
  function bindMemberHead() {
    $("#mFilter").onclick = (e) => { const b = e.target.closest("button"); if (b) { S.memberFilter = b.dataset.f; renderMembers(); } };
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
      if (kind !== "meeting" && !servedOnSun(d) && !recOf(row, id, kind)) return `<span class="c o">·</span>`;
      const r = recOf(row, id, kind);
      if (!r) return `<span class="c n" title="${md(d)} ${ACT_KINDS[kind]} 미기록">–</span>`;
      return `<span class="c ${r.status[0]}" title="${md(kind === "rehearsal" ? addDays(d, 1) : d)} ${ACT_KINDS[kind]} ${ATT[r.status]}${r.status === "absent" ? " · " + esc(reasonText(r)) : ""}">${short[r.status]}</span>`;
    };
    const absences = weeks.slice().reverse().flatMap((d) => ["practice", "meeting", "rehearsal"].map((k) => ({ d, k, r: recOf(mt(d), id, k) })))
      .filter((x) => x.r?.status === "absent");

    $("#content").innerHTML = `
      <a href="#members" class="back" style="align-self:flex-start">멤버로 돌아가기</a>
      <section class="phead">
        <div>
          <h1>${esc(m.name)} <span class="chip ${m.is_active ? "chip-ok" : "chip-gray"}">${m.is_active ? "활동" : "휴면·종료"}</span>
            ${m.role === "admin" ? `<span class="chip chip-violet">리더십</span>` : ""}${m.status === "trainee" ? `<span class="chip chip-mid">${traineeLabel(m)}</span>` : ""}
            ${streak.n >= STREAK_LIMIT ? `<span class="chip chip-bad">팀모임 ${streak.n}회 연속 결석</span>` : ""}</h1>
          <span class="muted">${esc(positionName(m.main_position))} · ${extrasOf(id).length ? "추가 " + extrasOf(id).map(positionName).join(", ") : "추가 포지션 없음"}</span>
          <dl><div><dt>연락처</dt><dd>${esc(m.phone) || "—"}</dd></div><div><dt>이메일 (로그인)</dt><dd>${esc(m.email) || "—"}</dd></div>
            <div><dt>순모임</dt><dd>${esc(m.small_group) || "—"}</dd></div>
            <div><dt>함께한 날</dt><dd>${fmtDate(sinceOf(m), { year: "numeric", month: "long", day: "numeric" })} · ${durText(sinceOf(m))}</dd></div></dl>
        </div>
        <div class="acts">
          <button type="button" class="btn btn-primary btn-sm" data-act="edit">정보 수정</button>
          ${m.id !== S.me.id ? `<button type="button" class="btn btn-ghost btn-sm" data-act="active">${m.is_active ? "휴면으로 전환" : "활동으로 전환"}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="role">${m.role === "admin" ? "리더십 해제" : "리더십으로 지정"}</button>` : ""}
          <button type="button" class="btn btn-ghost btn-sm" data-act="reset">비밀번호 초기화</button>
          ${m.application_id ? `<a class="btn btn-ghost btn-sm" href="#app/${m.application_id}">지원·수습 기록</a>` : ""}
          ${m.id !== S.me.id ? `<button type="button" class="btn btn-danger btn-sm" data-act="remove">탈퇴 처리</button>` : ""}
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
          <h2>섬김 통계 <small>공개된 배치표 기준</small></h2>
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
    if (act === "active" || act === "role") {
      const patch = act === "active" ? { is_active: !m.is_active } : { role: m.role === "admin" ? "member" : "admin" };
      const { error } = await sb.from("members").update(patch).eq("id", m.id);
      if (error) return toast("바꾸지 못했습니다");
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
    modal({
      step: "멤버 정보", title: `${m.name} 정보 수정`,
      body: `<div class="grid2">
          <label class="field">이름<input type="text" id="eName" maxlength="30" value="${esc(m.name)}"></label>
          <label class="field">연락처<input type="tel" id="ePhone" maxlength="13" value="${esc(m.phone || "")}" placeholder="010-0000-0000"></label>
          <label class="field">순모임<input type="text" id="eGroup" maxlength="30" value="${esc(m.small_group || "")}" placeholder="예: 3순"></label>
          <label class="field">함께한 날 <span class="hint">실제 찬양팀 합류일</span><input type="date" id="eSince" value="${sinceOf(m) || ""}"></label>
        </div>
        <label class="field">이메일 (로그인 아이디)<input type="email" id="eEmail" value="${esc(m.email || "")}">
          <span class="hint">바꾸면 다음 로그인부터 새 이메일로 로그인해요. 본인에게 꼭 알려 주세요.</span></label>
        <div class="field"><span>주 포지션</span>
          <div class="seg" id="eMain">${ps.map((p) => `<button type="button" data-v="${p.code}" aria-pressed="${p.code === m.main_position}">${esc(p.name)}</button>`).join("")}</div>
          <span class="hint">이미 짜인 배치표는 그대로 남아요. 다음 배치부터 새 포지션 후보로 보여요.</span></div>
        <div class="field"><span>추가 포지션</span><div id="eExtra" style="display:flex;flex-wrap:wrap;gap:6px 14px">${ps.map((p) =>
          `<label style="display:inline-flex;align-items:center;gap:6px;font-weight:500;font-size:14px" data-for="${p.code}" class="${p.code === m.main_position ? "hidden" : ""}"><input type="checkbox" value="${p.code}" ${ex.includes(p.code) ? "checked" : ""} style="width:18px;height:18px;accent-color:var(--violet)">${esc(p.name)}</label>`).join("")}</div></div>
        <label class="field">리더십 메모 <span class="hint">리더십끼리만 봐요. 본인에게는 안 보여요.</span><textarea id="eNote" maxlength="1000" style="min-height:80px">${esc(noteText)}</textarea></label>`,
      onInput: (e) => {
        const b = e?.target?.closest?.("#eMain button");
        if (b) {
          $$("#eMain button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          $$("#eExtra label").forEach((l) => { l.classList.toggle("hidden", l.dataset.for === b.dataset.v); if (l.dataset.for === b.dataset.v) l.querySelector("input").checked = false; });
        }
      },
      confirmLabel: "저장",
      onConfirm: async (close) => {
        const name = $("#eName").value.trim(), phone = $("#ePhone").value.trim() || null, email = $("#eEmail").value.trim().toLowerCase();
        const main = $("#eMain [aria-pressed=true]").dataset.v;
        if (!name) throw new Error("이름을 입력해 주세요.");
        if (phone && !/^[0-9\-]{9,13}$/.test(phone)) throw new Error("연락처를 010-0000-0000 형식으로 입력해 주세요.");
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("이메일 주소를 다시 확인해 주세요.");
        const patch = { name, phone, small_group: $("#eGroup").value.trim() || null, served_since: $("#eSince").value || null, main_position: main };
        const { error } = await sb.from("members").update(patch).eq("id", m.id);
        if (error) throw new Error("저장하지 못했습니다");
        // 추가 포지션 맞추기
        const want = $$("#eExtra input:checked").map((x) => x.value).filter((c) => c !== main);
        const have = extrasOf(m.id);
        const add = want.filter((c) => !have.includes(c)), del = have.filter((c) => !want.includes(c));
        if (add.length) await sb.from("member_extra_positions").insert(add.map((c) => ({ member_id: m.id, position_code: c })));
        if (del.length) await sb.from("member_extra_positions").delete().eq("member_id", m.id).in("position_code", del);
        // 리더십 메모
        const nt = $("#eNote").value.trim();
        if (nt !== noteText) {
          const { error: ne } = nt ? await sb.from("member_notes").upsert({ member_id: m.id, note: nt, updated_by: S.me.id })
            : await sb.from("member_notes").delete().eq("member_id", m.id);
          if (ne) throw new Error("메모를 저장하지 못했습니다");
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
            <li>로그인 계정, 연락처·이메일</li><li>지원서·서약, 평가표, 수습 기록</li><li>섬김 응답, 출석, 리더십 메모</li></ul></div>
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
        await loadAll(); close(); toast(`${m.name}님을 탈퇴 처리했어요`); location.hash = "members";
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
  const V = { month: null, lineupMonth: null, sel: 0, drag: null, picked: null };
  const servingMembers = () => S.members.filter((m) => m.is_active && m.status === "active");
  const slotsOfMonth = (month) => sundaysOf(month).flatMap((sun) => [
    { date: addDays(sun, -1), kind: "sat_practice", sun }, { date: sun, kind: "sunday", sun }]);
  const posOrder = () => Object.fromEntries((window.__allPositions || []).map((p) => [p.code, p.sort_order]));
  const defaultMonth = () => addMonths(monthOf(todayISO()), 1);

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

  function monthNav(label, month, onMove) {
    return `<div style="display:flex;align-items:center;gap:8px">
      <button type="button" class="btn btn-ghost btn-sm" data-mnav="-1" aria-label="이전 달">이전</button>
      <h1 class="page-title">${monthLabel(month)} ${label}</h1>
      <button type="button" class="btn btn-ghost btn-sm" data-mnav="1" aria-label="다음 달">다음</button></div>`;
  }
  function bindMonthNav(onMove) {
    $$("[data-mnav]").forEach((b) => b.addEventListener("click", () => onMove(+b.dataset.mnav)));
  }

  // ---------------------------------------------------------------- 섬김 응답 현황
  async function renderRespondAdmin() {
    if (!V.month) V.month = defaultMonth();
    const month = V.month;
    const { slots, info, avail, notes } = await loadMonth(month);
    const people = servingMembers().sort((a, b) => (posOrder()[a.main_position] ?? 99) - (posOrder()[b.main_position] ?? 99) || a.name.localeCompare(b.name, "ko"));
    const answered = (m) => slots.filter((s) => answerOf(avail, m.id, s.date, s.kind) !== undefined).length;
    const done = people.filter((m) => answered(m) === slots.length);
    const partial = people.filter((m) => answered(m) > 0 && answered(m) < slots.length);
    const none = people.filter((m) => answered(m) === 0);
    const sundays = sundaysOf(month);

    const status = !info ? `<span class="chip chip-gray">아직 열지 않음</span>`
      : info.is_open ? `<span class="chip chip-ok">응답 받는 중${info.deadline ? " · " + fmtDate(info.deadline, { month: "long", day: "numeric", weekday: "short" }) + "까지" : ""}</span>`
      : `<span class="chip chip-gray">마감됨</span>`;
    const actions = !info
      ? `<label class="field" style="flex-direction:row;align-items:center;gap:8px;font-size:14px">마감일<input type="date" id="dl" value="${addDays(sundays[0], -2)}" style="min-height:40px;width:auto"></label>
         <button type="button" class="btn btn-primary" id="openMonth">${monthLabel(month)} 응답 받기 열기</button>`
      : info.is_open
      ? `<label class="field" style="flex-direction:row;align-items:center;gap:8px;font-size:14px">마감일<input type="date" id="dl" value="${info.deadline || ""}" style="min-height:40px;width:auto"></label>
         <button type="button" class="btn btn-ghost" id="saveDl">마감일 저장</button>
         <button type="button" class="btn btn-ghost" id="copyOpen">응답 안내 문구 복사</button>
         <button type="button" class="btn btn-danger" id="closeMonth">마감하기</button>`
      : `<button type="button" class="btn btn-ghost" id="reopen">다시 열기</button>`;

    const cell = (m, s) => {
      const v = answerOf(avail, m.id, s.date, s.kind);
      const [cls, label, next] = v === true ? ["a-yes", "가능", "불가"] : v === false ? ["a-no", "불가", "미응답"] : ["a-none", "–", "가능"];
      return `<td class="${cls}"><button type="button" class="a-btn" data-mid="${m.id}" data-date="${s.date}" data-kind="${s.kind}" data-v="${v === undefined ? "" : v}"
        aria-label="${esc(m.name)} ${md(s.date)} ${s.kind === "sunday" ? "주일" : "토 연습"} ${v === undefined ? "미응답" : label}, 누르면 ${next}">${label}</button></td>`;
    };
    const countRow = (kind) => sundays.map((sun) => {
      const d = kind === "sunday" ? sun : addDays(sun, -1);
      return `<td style="font-weight:800;color:var(--violet)">${people.filter((m) => answerOf(avail, m.id, d, kind) === true).length}</td>`;
    });

    $("#content").innerHTML = `
      <div class="page-head">${monthNav("섬김 응답", month)}<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${status}</div></div>
      <section class="card bordered" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">${actions}</section>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
        <div class="card bordered"><span class="muted small">응답 완료</span><div style="font-size:26px;font-weight:800">${done.length}<span class="muted" style="font-size:15px;font-weight:600"> / ${people.length}명</span></div></div>
        <div class="card bordered"><span class="muted small">응답 중</span><div style="font-size:26px;font-weight:800">${partial.length}<span class="muted" style="font-size:15px;font-weight:600">명</span></div></div>
        <div class="card bordered" style="display:flex;flex-direction:column;gap:6px"><span class="muted small">미응답 ${none.length + partial.length}명</span>
          <span style="font-size:14px;font-weight:600">${[...none, ...partial].map((m) => esc(m.name)).join(", ") || "없음"}</span>
          ${info?.is_open && (none.length + partial.length) ? `<button type="button" class="btn btn-soft btn-sm" id="copyNudge" style="align-self:flex-start">독촉 문구 복사</button>` : ""}</div>
      </div>
      <p class="lead" style="margin:0">칸을 누르면 리더십이 직접 바꿀 수 있어요 (가능 → 불가 → 미응답). 마감한 뒤에도 바꿀 수 있어요.</p>
      <div class="evaltable"><table class="resp-table">
        <thead><tr><th rowspan="2">이름</th><th rowspan="2">포지션</th>${sundays.map((d) => `<th colspan="2" style="text-align:center;border-left:1px solid var(--line)">${md(d)} 주일</th>`).join("")}<th rowspan="2" style="border-left:1px solid var(--line)">전할 말</th></tr>
          <tr>${sundays.map(() => `<th class="sub" style="border-left:1px solid var(--line)">토</th><th class="sub">주</th>`).join("")}</tr></thead>
        <tbody>${people.map((m) => `<tr><td style="font-weight:700;white-space:nowrap">${esc(m.name)}</td><td class="muted small" style="white-space:nowrap">${esc(positionName(m.main_position))}</td>
          ${sundays.map((sun) => cell(m, { date: addDays(sun, -1), kind: "sat_practice" }) + cell(m, { date: sun, kind: "sunday" })).join("")}
          <td class="small" style="max-width:220px">${esc(notes.find((n) => n.member_id === m.id)?.note || "")}</td></tr>`).join("") || `<tr><td colspan="99" class="muted">정식 팀원이 아직 없어요.</td></tr>`}
        <tr style="background:var(--bg)"><td colspan="2" class="small" style="font-weight:700">가능 인원 (토 / 주)</td>
          ${sundays.map((sun) => {
            const sat = people.filter((m) => answerOf(avail, m.id, addDays(sun, -1), "sat_practice") === true).length;
            const su = people.filter((m) => answerOf(avail, m.id, sun, "sunday") === true).length;
            return `<td style="font-weight:800;color:var(--violet);border-left:1px solid var(--line)">${sat}</td><td style="font-weight:800;color:var(--violet)">${su}</td>`;
          }).join("")}<td></td></tr></tbody></table></div>
      ${info ? `<a class="btn btn-primary" href="#lineup" style="align-self:flex-start" id="goLineup">${monthLabel(month)} 배치하러 가기</a>` : ""}`;

    bindMonthNav((n) => { V.month = addMonths(V.month, n); renderRespondAdmin(); });
    $$(".a-btn").forEach((b) => b.addEventListener("click", async () => {
      const cur = b.dataset.v;   // "true" | "false" | ""
      const next = cur === "true" ? false : cur === "false" ? null : true;
      const key = { member_id: b.dataset.mid, date: b.dataset.date, kind: b.dataset.kind };
      const { error } = next === null
        ? await sb.from("availability").delete().match(key)
        : await sb.from("availability").upsert({ ...key, available: next });
      if (error) return toast("바꾸지 못했습니다");
      renderRespondAdmin();
    }));
    $("#goLineup")?.addEventListener("click", () => { V.lineupMonth = month; });
    const openMsg = () => `[찬양팀] ${monthLabel(month)} 섬김 응답을 받고 있어요.\n${info?.deadline || $("#dl")?.value ? fmtDate(info?.deadline || $("#dl").value, { month: "long", day: "numeric", weekday: "short" }) + "까지 " : ""}토요 연습·주일 예배 가능 여부를 체크해 주세요.\n\n${location.origin}/me.html#respond`;
    $("#openMonth")?.addEventListener("click", async () => {
      const { error } = await sb.from("availability_months").insert({ month, deadline: $("#dl").value || null, is_open: true });
      if (error) return toast("열지 못했습니다");
      await copyText(openMsg()); toast(`${monthLabel(month)} 응답을 열었어요. 안내 문구를 복사했어요`); renderRespondAdmin();
    });
    $("#saveDl")?.addEventListener("click", async () => {
      const { error } = await sb.from("availability_months").update({ deadline: $("#dl").value || null }).eq("month", month);
      toast(error ? "저장하지 못했습니다" : "마감일을 저장했어요"); renderRespondAdmin();
    });
    $("#copyOpen")?.addEventListener("click", async () => toast((await copyText(openMsg())) ? "응답 안내 문구를 복사했어요" : "복사하지 못했어요"));
    $("#copyNudge")?.addEventListener("click", async () => {
      const names = [...none, ...partial].map((m) => m.name + "님").join(", ");
      const msg = `[찬양팀] ${names}\n${monthLabel(month)} 섬김 응답이 아직 남아 있어요.${info.deadline ? " " + fmtDate(info.deadline, { month: "long", day: "numeric", weekday: "short" }) + "까지" : ""} 체크 부탁드려요!\n\n${location.origin}/me.html#respond`;
      toast((await copyText(msg)) ? "독촉 문구를 복사했어요" : "복사하지 못했어요");
    });
    const setOpen = async (open) => {
      const { error } = await sb.from("availability_months").update({ is_open: open }).eq("month", month);
      toast(error ? "바꾸지 못했습니다" : open ? "다시 열었어요" : "응답을 마감했어요"); renderRespondAdmin();
    };
    $("#closeMonth")?.addEventListener("click", () => modal({ title: `${monthLabel(month)} 응답 마감`, body: `<p style="margin:0">마감하면 팀원들이 더 이상 응답을 바꿀 수 없어요. 필요하면 다시 열 수 있어요.</p>`,
      confirmLabel: "마감하기", onConfirm: async (close) => { close(); await setOpen(false); } }));
    $("#reopen")?.addEventListener("click", () => setOpen(true));
  }

  // ---------------------------------------------------------------- 배치표
  async function renderLineupAdmin() {
    if (!V.lineupMonth) V.lineupMonth = defaultMonth();
    const month = V.lineupMonth;
    const sundays = sundaysOf(month);
    const [{ avail }, sv] = await Promise.all([
      loadMonth(month),
      sb.from("services").select("*, assignments(*)").gte("service_date", sundays[0]).lte("service_date", sundays[sundays.length - 1]),
    ]);
    const services = sv.data || [];
    V.data = { month, sundays, avail, services };
    if (V.sel >= sundays.length) V.sel = 0;
    drawLineup();
  }

  function drawLineup() {
    const { month, sundays, avail, services } = V.data;
    const POS = window.__allPositions || [];
    const svc = (d) => services.find((s) => s.service_date === d);
    const asg = (d) => svc(d)?.assignments || [];
    const at = (d, pos, slot) => asg(d).find((x) => x.position_code === pos && x.slot === slot);
    const mem = (id) => S.members.find((m) => m.id === id);
    const posOf = (m) => [m.main_position, ...S.extras.filter((e) => e.member_id === m.id).map((e) => e.position_code)];
    const counts = {};
    services.forEach((s) => (s.assignments || []).forEach((a) => (counts[a.member_id] = (counts[a.member_id] || 0) + 1)));
    const ans = (m, d, kind) => answerOf(avail, m.id, kind === "sat" ? addDays(d, -1) : d, kind === "sat" ? "sat_practice" : "sunday");
    // 불가로 응답한 사람도 리더십 판단으로 배치 가능 (칸에 경고 표시)
    const canPlace = (mid, d, pos) => { const m = mem(mid); return !!m && posOf(m).includes(pos); };
    const active = V.drag?.mid || V.picked;
    const withAsg = services.filter((s) => (s.assignments || []).length);
    const pubN = withAsg.filter((s) => s.status === "published").length;
    const published = withAsg.length > 0 && pubN === withAsg.length;
    const anyPublished = services.some((s) => s.status === "published");

    const check = (d) => {
      const list = asg(d);
      let total = 0, empty = 0;
      POS.forEach((p) => { for (let k = 1; k <= p.max_count; k++) { total++; if (!at(d, p.code, k)) empty++; } });
      const kinds = list.map((x) => POS.find((p) => p.code === x.position_code)?.kind);
      const miss = [kinds.includes("vocal") && !list.some((x) => x.is_singer_leader) && "싱어 리더", kinds.includes("band") && !list.some((x) => x.is_band_master) && "밴드 마스터"].filter(Boolean);
      return { total, empty, miss, has: list.length > 0 };
    };

    const head = sundays.map((d, i) => {
      const n = servingMembers().filter((m) => ans(m, d, "sun") === true).length;
      const sv = svc(d), has = (sv?.assignments || []).length > 0, pub = sv?.status === "published";
      return `<div class="lu-date ${V.sel === i ? "on" : ""}"><button type="button" class="lu-sel" data-sel="${i}"><b>${md(d)} 주일</b><span>가능 ${n}명</span></button>
        <button type="button" class="lu-pub" data-pub="${d}" aria-pressed="${pub}" ${has || pub ? "" : "disabled"} title="${pub ? "누르면 이 주일만 비공개" : has ? "누르면 이 주일만 공개" : "배치한 뒤 공개할 수 있어요"}">${pub ? "공개" : "비공개"}</button></div>`;
    }).join("");

    const rows = POS.flatMap((p) => Array.from({ length: p.max_count }, (_, k) => k + 1).map((slot) => {
      const cells = sundays.map((d) => {
        const a = at(d, p.code, slot), m = a && mem(a.member_id);
        const valid = active && canPlace(active, d, p.code);
        if (a && !m) {
          return `<div class="lu-cell ${valid ? "valid" : ""}" data-d="${d}" data-pos="${p.code}" data-slot="${slot}">
            <div class="lu-chip" data-aid="${a.id}" style="cursor:default;opacity:.75"><span class="nm">${esc(a.former_name || "탈퇴한 멤버")} (탈퇴)</span>
              <button type="button" class="lu-x" data-remove aria-label="${esc(a.former_name || "탈퇴한 멤버")} 빼기"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></div>`;
        }
        if (m) {
          const dup = asg(d).filter((x) => x.member_id === m.id).length > 1;
          const satNo = ans(m, d, "sat") === false, sunNo = ans(m, d, "sun") === false;
          const role = p.kind === "vocal" ? ["leader", "리더", a.is_singer_leader] : p.kind === "band" ? ["bm", "밴마", a.is_band_master] : null;
          return `<div class="lu-cell ${valid ? "valid" : ""}" data-d="${d}" data-pos="${p.code}" data-slot="${slot}">
            <div class="lu-chip ${role && role[2] ? "role-on" : ""}" draggable="true" data-aid="${a.id}" data-mid="${m.id}">
              <span class="nm">${esc(m.name)}</span>
              ${role ? `<button type="button" class="lu-role" data-role="${role[0]}" aria-pressed="${role[2]}" title="${role[0] === "leader" ? "싱어 리더로 지정" : "밴드 마스터로 지정"}">${role[1]}</button>` : ""}
              <button type="button" class="lu-x" data-remove aria-label="${esc(m.name)} 빼기"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
            </div>
            ${dup ? `<span class="lu-warn">같은 날 중복 배치</span>` : sunNo ? `<span class="lu-warn">주일 불가로 응답함</span>` : satNo ? `<span class="lu-warn">토 연습 불가</span>` : ""}
          </div>`;
        }
        return `<div class="lu-cell empty ${valid ? "valid" : ""}" data-d="${d}" data-pos="${p.code}" data-slot="${slot}"><span>${valid ? "여기에 놓기" : "공석"}</span></div>`;
      }).join("");
      return `<div class="lu-row ${slot === 1 ? "first" : ""}"><div class="lu-label"><b>${esc(p.name)}${p.max_count > 1 ? " " + slot : ""}</b>${slot === 1 && p.max_count > 1 ? `<span>최대 ${p.max_count}명</span>` : ""}</div>${cells}</div>`;
    })).join("");

    const foot = sundays.map((d) => {
      const c = check(d);
      return `<div class="lu-check"><span class="${c.empty === 0 ? "ok" : c.empty === c.total ? "" : "warn"}">${c.empty === 0 ? "모두 채움" : c.empty === c.total ? "비어 있음" : "공석 " + c.empty}</span>
        ${c.miss.length ? `<span class="warn">${c.miss.join(", ")} 미지정</span>` : c.has ? `<span>리더·밴마 지정됨</span>` : ""}</div>`;
    }).join("");

    const selD = sundays[V.sel];
    const order = posOrder();
    const pool = servingMembers().filter((m) => ans(m, selD, "sun") !== false)
      .sort((a, b) => (ans(b, selD, "sun") === true) - (ans(a, selD, "sun") === true) || (order[a.main_position] ?? 99) - (order[b.main_position] ?? 99) || (counts[a.id] || 0) - (counts[b.id] || 0));
    const unavailable = servingMembers().filter((m) => ans(m, selD, "sun") === false);
    const candHTML = (m) => {
      const placed = asg(selD).some((x) => x.member_id === m.id);
      const sun = ans(m, selD, "sun"), sat = ans(m, selD, "sat");
      return `<div class="lu-cand ${V.picked === m.id ? "picked" : ""} ${placed ? "placed" : ""} ${sun === false ? "unavail" : ""}" draggable="true" data-mid="${m.id}" tabindex="0" role="button" aria-pressed="${V.picked === m.id}">
        <span style="display:flex;flex-direction:column;flex:1;min-width:0"><b>${esc(m.name)}</b><span class="small muted">${posOf(m).map(positionName).join(" · ")}</span></span>
        ${sun === undefined ? `<span class="chip chip-warn">미응답</span>` : ""}${sun === false ? `<span class="chip chip-gray">주일 불가</span>` : ""}${sat === false ? `<span class="chip chip-warn">토 연습 불가</span>` : ""}${placed ? `<span class="chip chip-violet">배치됨</span>` : ""}
        <b class="small" style="width:30px;text-align:right">${counts[m.id] || 0}회</b></div>`;
    };

    $("#content").innerHTML = `
      <div class="page-head">${monthNav("배치표", month)}
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <span class="small muted" style="font-weight:600">${published ? "멤버에게 보여요" : pubN ? `일부 공개 (${pubN}/${withAsg.length}주)` : "멤버에게 안 보여요"}</span>
          <div class="seg" id="luPub" role="group" aria-label="이 달 배치표 공개 여부">
            <button type="button" data-v="on" aria-pressed="${published}">공개</button><button type="button" data-v="off" aria-pressed="${!pubN}">비공개</button></div>
          <button type="button" class="btn btn-ghost" id="luClear">전체 비우기</button>
          ${pubN ? `<button type="button" class="btn btn-primary" id="luPublish">공개 문구 복사</button>` : ""}</div></div>
      <p class="lead">오른쪽 후보를 칸으로 끌어다 놓으세요. 놓을 수 있는 칸이 표시돼요. 이름을 눌러 고른 뒤 칸을 눌러도 돼요.${anyPublished ? " 공개된 주일을 고치면 멤버 화면에 바로 반영돼요." : ""}</p>
      <div style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start">
        <section class="lu-board" aria-label="주일별 배치"><div class="lu-inner" style="--cols:${sundays.length}">
          <div class="lu-row lu-head"><div class="lu-label muted small">포지션</div>${head}</div>
          ${rows}
          <div class="lu-row lu-foot"><div class="lu-label muted small">점검</div>${foot}</div>
        </div></section>
        <aside class="lu-pool ${V.drag?.from ? "drop" : ""}" id="luPool" aria-label="후보">
          <div><h2 style="font-size:17px;font-weight:800">${md(selD)} 주일 후보</h2><span class="muted small">가능 응답 우선 · 이번 달 배치 횟수</span></div>
          <div style="display:flex;flex-direction:column;gap:6px">${pool.map(candHTML).join("") || `<span class="muted small">이 날 가능한 팀원이 없어요</span>`}</div>
          ${unavailable.length ? `<div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--line);padding-top:12px">
            <span class="small muted"><b style="color:var(--ink-2)">불가로 응답</b> · 일정이 바뀌었으면 끌어다 놓을 수 있어요</span>
            ${unavailable.map(candHTML).join("")}</div>` : ""}
        </aside>
      </div>`;

    bindMonthNav((n) => { V.lineupMonth = addMonths(V.lineupMonth, n); V.picked = null; renderLineupAdmin(); });
    bindLineup({ canPlace, svc, at, asg, mem, check, published });
  }

  async function ensureService(d) {
    const ex = V.data.services.find((s) => s.service_date === d);
    if (ex) return ex;
    const { data, error } = await sb.from("services").insert({ service_date: d }).select("*, assignments(*)").single();
    if (error) throw new Error("주일을 만들지 못했습니다");
    V.data.services.push(data);
    return data;
  }

  async function placeMember(mid, d, pos, slot, fromAid) {
    try {
      const s = await ensureService(d);
      const target = s.assignments.find((x) => x.position_code === pos && x.slot === slot);
      if (fromAid && target?.id === fromAid) return;
      if (fromAid) { const { error } = await sb.from("assignments").delete().eq("id", fromAid); if (error) throw error; }
      if (target) { const { error } = await sb.from("assignments").delete().eq("id", target.id); if (error) throw error; }
      const { error } = await sb.from("assignments").insert({ service_id: s.id, position_code: pos, slot, member_id: mid });
      if (error) throw new Error(error.message);
    } catch (e) { toast(e.message?.includes("포지션") ? e.message : "배치하지 못했습니다", 3500); }
    V.drag = null; V.picked = null;
    await renderLineupAdmin();
  }

  function bindLineup({ canPlace, svc, check, published }) {
    const content = $("#content");
    content.querySelectorAll("[data-sel]").forEach((b) => b.addEventListener("click", () => { V.sel = +b.dataset.sel; drawLineup(); }));

    // 드래그 시작: 후보 또는 칸의 이름표
    content.addEventListener("dragstart", (e) => {
      const chip = e.target.closest(".lu-chip, .lu-cand"); if (!chip) return;
      V.drag = { mid: chip.dataset.mid, from: chip.dataset.aid || null };
      e.dataTransfer.setData("text/plain", chip.dataset.mid); e.dataTransfer.effectAllowed = "move";
      // 놓을 수 있는 칸 표시 (다시 그리지 않고 클래스만)
      content.querySelectorAll(".lu-cell").forEach((c) => c.classList.toggle("valid", canPlace(V.drag.mid, c.dataset.d, c.dataset.pos)));
      if (V.drag.from) $("#luPool").classList.add("drop");
    });
    content.addEventListener("dragend", () => {
      V.drag = null;
      content.querySelectorAll(".lu-cell.valid").forEach((c) => c.classList.remove("valid"));
      $("#luPool")?.classList.remove("drop");
    });
    content.querySelectorAll(".lu-cell").forEach((c) => {
      c.addEventListener("dragover", (e) => { if (V.drag && canPlace(V.drag.mid, c.dataset.d, c.dataset.pos)) e.preventDefault(); });
      c.addEventListener("drop", (e) => {
        e.preventDefault();
        if (V.drag && canPlace(V.drag.mid, c.dataset.d, c.dataset.pos)) placeMember(V.drag.mid, c.dataset.d, c.dataset.pos, +c.dataset.slot, V.drag.from);
      });
      c.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        if (V.picked && canPlace(V.picked, c.dataset.d, c.dataset.pos)) return placeMember(V.picked, c.dataset.d, c.dataset.pos, +c.dataset.slot, null);
        const i = V.data.sundays.indexOf(c.dataset.d);
        if (i !== V.sel) { V.sel = i; drawLineup(); }
      });
    });
    const pool = $("#luPool");
    pool.addEventListener("dragover", (e) => { if (V.drag?.from) e.preventDefault(); });
    pool.addEventListener("drop", async (e) => {
      e.preventDefault();
      if (!V.drag?.from) return;
      await sb.from("assignments").delete().eq("id", V.drag.from);
      V.drag = null; renderLineupAdmin();
    });
    pool.querySelectorAll(".lu-cand").forEach((c) => {
      const pick = () => { V.picked = V.picked === c.dataset.mid ? null : c.dataset.mid; drawLineup(); };
      c.addEventListener("click", pick);
      c.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    });

    // 이름표 버튼: 빼기 / 리더·밴마
    content.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const { error } = await sb.from("assignments").delete().eq("id", b.closest(".lu-chip").dataset.aid);
      if (error) toast("빼지 못했습니다");
      renderLineupAdmin();
    }));
    content.querySelectorAll(".lu-role").forEach((b) => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const aid = b.closest(".lu-chip").dataset.aid, cell = b.closest(".lu-cell");
      const field = b.dataset.role === "leader" ? "is_singer_leader" : "is_band_master";
      const on = b.getAttribute("aria-pressed") !== "true";
      const s = svc(cell.dataset.d);
      if (on) await sb.from("assignments").update({ [field]: false }).eq("service_id", s.id).eq(field, true);
      const { error } = await sb.from("assignments").update({ [field]: on }).eq("id", aid);
      if (error) toast("지정하지 못했습니다");
      renderLineupAdmin();
    }));

    $("#luClear").addEventListener("click", () => modal({
      title: `${monthLabel(V.data.month)} 배치 전체 비우기`, body: `<p style="margin:0">이 달의 모든 배치를 지워요. 공개된 배치표도 함께 비워져요.</p>`,
      confirmLabel: "전체 비우기", danger: true,
      onConfirm: async (close) => {
        const ids = V.data.services.map((s) => s.id);
        if (ids.length) { const { error } = await sb.from("assignments").delete().in("service_id", ids); if (error) throw new Error("비우지 못했습니다"); }
        close(); toast("비웠어요"); renderLineupAdmin();
      },
    }));

    const pubMsg = `[찬양팀] ${monthLabel(V.data.month)} 배치표가 나왔어요. 확인 부탁드려요!\n\n${location.origin}/me.html#lineup`;
    $("#luPublish")?.addEventListener("click", () => copyText(pubMsg).then((ok) => toast(ok ? "공개 문구를 복사했어요" : "복사하지 못했어요")));
    const unpublish = (targets, label) => modal({
      title: `${label} 비공개로 바꾸기`,
      body: `<p style="margin:0">멤버 화면 배치표와 홈의 '나의 섬김'에서 바로 사라져요. 배치 내용은 그대로 남고, 언제든 다시 공개할 수 있어요.</p>`,
      confirmLabel: "비공개로 바꾸기", danger: true,
      onConfirm: async (close) => {
        const { error } = await sb.from("services").update({ status: "draft", published_at: null }).in("id", targets.map((s) => s.id));
        if (error) throw new Error("바꾸지 못했습니다");
        close(); toast(`${label} 비공개로 바꿨어요`); renderLineupAdmin();
      },
    });
    content.querySelectorAll("[data-pub]").forEach((b) => b.addEventListener("click", async () => {
      const s = svc(b.dataset.pub); if (!s) return;
      if (s.status === "published") return unpublish([s], `${md(b.dataset.pub)} 주일`);
      const c = check(b.dataset.pub);
      const { error } = await sb.from("services").update({ status: "published", published_at: new Date().toISOString() }).eq("id", s.id);
      if (error) return toast("공개하지 못했습니다");
      toast(`${md(b.dataset.pub)} 주일을 공개했어요${c.miss.length ? ` · ${c.miss.join(", ")} 미지정` : ""}`, 3500); renderLineupAdmin();
    }));
    $("#luPub").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const msg = pubMsg;
      if (b.dataset.v === "off") {
        const on = V.data.services.filter((s) => s.status === "published");
        if (!on.length) return;
        return unpublish(on, `${monthLabel(V.data.month)} 배치표`);
      }
      if (published) return;
      const issues = V.data.sundays.map((d) => {
        const c = check(d);
        const parts = [c.has && c.empty ? `공석 ${c.empty}` : "", ...c.miss.map((x) => x + " 미지정")].filter(Boolean);
        return c.has && parts.length ? `<li>${md(d)} 주일 · ${parts.join(", ")}</li>` : "";
      }).join("");
      const targets = V.data.services.filter((s) => (s.assignments || []).length);
      if (!targets.length) return toast("배치한 주일이 없어요");
      modal({
        title: `${monthLabel(V.data.month)} 배치표 공개`,
        body: `<p style="margin:0">공개하면 멤버 화면 배치표와 홈에 바로 보여요.</p>
          ${issues ? `<div class="notice warn" style="margin:0">확인해 주세요<ul style="margin:6px 0 0;padding-left:18px">${issues}</ul></div>` : ""}
          ${msgBox(msg)}`,
        confirmLabel: "공개하고 문구 복사",
        onConfirm: async (close) => {
          const { error } = await sb.from("services").update({ status: "published", published_at: new Date().toISOString() }).in("id", targets.map((s) => s.id));
          if (error) throw new Error("공개하지 못했습니다");
          await copyText(msg);
          close(); toast("공개했어요. 카톡 문구를 복사했어요"); renderLineupAdmin();
        },
      });
    });
  }

  // ================================================================ 출석 (토요 연습 · 팀모임 · 주일 리허설)
  //  한 주 = 토요일 한 줄(team_meetings). 연습·리허설: 그 주 주일 배치 인원 / 팀모임: 활동 중 전체(수습 포함)
  //  리허설 기록도 토요일 줄에 kind = rehearsal 로 저장 (날짜는 다음 날 주일)
  const A = { tab: "week", month: null, sel: null, data: null, open: null, mfilter: "all", skind: "meeting", srange: 12 };
  const ATT_KEYS = ["present", "late", "absent"];
  const byPos = (a, b) => (posOrder()[a.main_position] ?? 99) - (posOrder()[b.main_position] ?? 99) || a.name.localeCompare(b.name, "ko");
  // 기존 팀원은 계정 등록일과 관계없이 대상 (지난 토요일도 뒤늦게 기록할 수 있게). 수습생만 시작 전 토요일 제외
  const meetingPeople = (d) => S.members.filter((m) => m.is_active && !(m.status === "trainee" && m.joined_at && m.joined_at > d)).sort(byPos);
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
      sb.from("services").select("service_date, status, assignments(member_id, position_code, slot)").in("service_date", sats.map((d) => addDays(d, 1))),
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
        : servePeople(s, services, mt(s).attendance, kind).list.some((x) => x.m.id === m.id);
      const cell = (s, kind, m, first) => {
        const bl = first ? ` style="border-left:1px solid var(--line)"` : "";
        if (!target(s, kind, m)) return `<td class="m-off"${bl}>·</td>`;
        const r = recOf(mt(s), m.id, kind);
        const day = kind === "rehearsal" ? addDays(s, 1) : s;
        return `<td class="${r ? "m-" + r.status : "m-off"}"${bl} ${r ? `title="${md(day)} ${ACT_KINDS[kind]} ${ATT[r.status]}${r.status === "absent" ? " · " + esc(reasonText(r)) : ""}"` : ""}>${r ? short[r.status] : day > today ? "" : "–"}</td>`;
      };
      const everyone = meetingPeople(sats[sats.length - 1]);
      const tally = (m, st) => sats.reduce((n, s) => n + kinds.filter((k) => recOf(mt(s), m.id, k)?.status === st).length, 0);
      const absences = sats.flatMap((s) => kinds.flatMap((k) => mt(s).attendance.filter((r) => r.kind === k && r.status === "absent").map((r) => ({ s, k, r }))))
        .sort((a, b) => b.s.localeCompare(a.s));
      $("#content").innerHTML = `${head}${tabsHTML}
        <div class="evaltable"><table class="att-table">
          <thead><tr><th rowspan="2">이름</th>${sats.map((s) => `<th colspan="${kinds.length}" style="text-align:center;border-left:1px solid var(--line)">${md(s)} 주 ${kinds.includes("meeting") ? `<span class="chip ${MS_CHIP[mt(s).meeting_status]}" style="margin-left:4px">모임 ${MEETING[mt(s).meeting_status]}</span>` : ""}</th>`).join("")}
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
      const info = s > today ? `팀모임 ${MEETING[r.meeting_status]}`
        : `연습 ${c("practice")}/${p} · 모임 ${r.meeting_status === "no" ? "없음" : c("meeting") + "/" + meetingPeople(s).length} · 리허설 ${c("rehearsal")}/${p}`;
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
        <span>${extra || esc(positionName(m.main_position))}${r?.status === "absent" ? ` · <button type="button" class="rs" data-redit>결석: ${esc(reasonText(r))}</button>` : ""}</span></span>
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
      : col("meeting", "팀모임", `활동 중 ${meet.length}명 · 수습 포함`, meet.map((m) => ({ m })), futureSat,
          "").replace(`<div class="att-sum">`, `${ms === "tbd" && !futureSat ? `<p class="notice warn" style="margin:0">팀모임 여부가 '미정'이에요. 출석을 체크하면 '있음'으로 바뀌어요.</p>` : ""}<div class="att-sum">`);

    $("#content").innerHTML = `${head}${tabsHTML}
      <div class="sat-tabs" role="tablist" aria-label="주">${tabs}</div>
      <section class="card bordered" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px">
        <div style="display:flex;flex-direction:column;gap:2px"><b style="font-size:17px">${fmtDate(d, { month: "long", day: "numeric", weekday: "short" })} 팀모임</b>
          <span class="small muted">${futureSat ? "정해지면 팀원 홈에 바로 보여요" : "연습 후 팀모임이 있었는지 골라 주세요"}</span></div>
        <div class="seg" id="msSeg">${["yes", "no", "tbd"].map((k) => `<button type="button" data-v="${k}" aria-pressed="${ms === k}">${MEETING[k]}</button>`).join("")}</div>
      </section>
      ${futureSat ? `<p class="notice ok" style="margin:0">아직 오지 않은 주예요. 출석은 그날부터 체크할 수 있어요.</p>` : ""}
      <div class="att-cols att3">
        ${col("practice", "토요 연습", `${md(sun)} 섬김 ${prac.list.filter((x) => !x.off).length}명${prac.status === "draft" ? " · 배치 임시저장" : ""}`, prac.list, futureSat, noLineup(sun))}
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
      row.attendance = row.attendance.filter((r) => !(r.member_id === key.member_id && r.kind === key.kind));
      row.attendance.push({ ...key, status, reason_tag: status === "absent" ? reason.tag || null : null, reason: status === "absent" ? reason.text || null : null });
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
    const counted = (ws) => ws.filter((d) => kind !== "meeting" || mt(d)?.meeting_status === "yes");
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
    const [tm, sv, mo] = await Promise.all([
      sb.from("team_meetings").select("*, attendance(*)").gte("meeting_date", since).lte("meeting_date", thisSat).order("meeting_date"),
      sb.from("services").select("*, assignments(*)").in("service_date", [...new Set([...suns, addDays(lastSat, 1)])]),
      sb.from("availability_months").select("*").gte("month", monthOf(today)).order("month"),
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
      const s = services.find((x) => x.service_date === sun), list = (s?.assignments || []).filter((a) => a.member_id);
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
      const gaps = [p > c("practice") && `연습 ${c("practice")}/${p}`, r.meeting_status === "yes" && mtot > c("meeting") && `모임 ${c("meeting")}/${mtot}`,
        addDays(lastSat, 1) <= today && p > c("rehearsal") && `리허설 ${c("rehearsal")}/${p}`, r.meeting_status === "tbd" && "팀모임 여부 미정"].filter(Boolean);
      if (gaps.length) todos.push(item("", `${md(lastSat)} 출석 기록 마저 하기`, gaps.join(" · "), "#attendance", `data-sat="${lastSat}"`));
      else done.push(`${md(lastSat)} 출석 기록`);
    }
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
      ${r0.none.length + r0.partial.length ? `<button type="button" class="btn btn-soft btn-sm" data-nudge="${r0.m.month}" style="align-self:flex-start">독촉 문구 복사</button>` : `<span class="small" style="color:var(--ok);font-weight:700">모두 응답했어요</span>`}
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
    const shortPos = { leader: "인도", singer: "싱어", key_main: "메인", key_second: "세컨", e_guitar: "일렉", bass: "베이스", drum: "드럼" };

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
          <div class="plist">
            ${streaks.map((x) => `<div><a href="#member/${x.m.id}" style="color:inherit;text-decoration:none"><b>${esc(x.m.name)}</b> <span class="muted small">${esc(positionName(x.m.main_position))}</span></a>
              <span class="chip chip-bad">모임 ${x.n}회 연속 결석${x.lastReason ? " · " + esc(x.lastReason) : ""}</span></div>`).join("")}
            ${lates.map((x) => `<div><a href="#member/${x.m.id}" style="color:inherit;text-decoration:none"><b>${esc(x.m.name)}</b> <span class="muted small">${esc(positionName(x.m.main_position))}</span></a>
              <span class="chip chip-mid">지각 ${x.n} / ${LATE_WEEKS}주</span></div>`).join("")}
            ${!streaks.length && !lates.length ? `<div><span class="small muted">팀모임 연속 결석 ${STREAK_LIMIT}회 이상·최근 ${LATE_WEEKS}주 지각 없음</span></div>` : ""}
          </div></section>
        <section class="box" aria-label="팀 구성"><h2>팀 구성 <a href="#members">멤버</a></h2>
          <div class="head-num"><b>${act.length}</b><span class="muted">정식 · 수습 ${trainees.length} · 휴면 ${dormant}</span></div>
          <div class="mini-bars">${POS.map((p) => {
            const n = act.filter((m) => m.main_position === p.code).length;
            const multi = S.extras.filter((e) => e.position_code === p.code && act.some((m) => m.id === e.member_id)).length;
            return `<div title="${esc(p.name)} 주 포지션 ${n}명${multi ? ` · 멀티 ${multi}명` : ""}"><b>${n}${multi ? `<span class="small muted" style="font-weight:600">+${multi}</span>` : ""}</b>${shortPos[p.code] || esc(p.name)}</div>`;
          }).join("")}</div>
          <span class="small muted">숫자 = 주 포지션 인원 · +는 멀티 포지션</span>
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
    c.querySelectorAll("[data-lmonth]").forEach((a) => a.addEventListener("click", () => { V.lineupMonth = a.dataset.lmonth; }));
    c.querySelectorAll("[data-rmonth]").forEach((a) => a.addEventListener("click", () => { V.month = a.dataset.rmonth; }));
    c.querySelectorAll("[data-nudge]").forEach((b) => b.addEventListener("click", async () => {
      const r = resp.find((x) => x.m.month === b.dataset.nudge);
      const names = [...r.none, ...r.partial].map((p) => p.name + "님").join(", ");
      const msg = `[찬양팀] ${names}\n${monthLabel(r.m.month)} 섬김 응답이 아직 남아 있어요.${r.m.deadline ? " " + fmtDate(r.m.deadline, { month: "long", day: "numeric", weekday: "short" }) + "까지" : ""} 체크 부탁드려요!\n\n${location.origin}/me.html#respond`;
      toast((await copyText(msg)) ? "독촉 문구를 복사했어요" : "복사하지 못했어요");
    }));
  }

  // ---------------------------------------------------------------- 설정 · 테스트 데이터
  async function renderSettings() {
    $("#content").innerHTML = `<div class="page-head"><h1 class="page-title">설정</h1></div><div class="empty">불러오는 중…</div>`;
    let st = { members: 0, applications: 0, password: "" };
    try { st = await api("/api/demo", { action: "status" }); } catch (e) { toast(e.message); }
    const has = st.members + st.applications > 0;
    $("#content").innerHTML = `
      <div class="page-head"><h1 class="page-title">설정</h1></div>
      <section class="card bordered" style="display:flex;flex-direction:column;gap:14px">
        <div style="display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px">
          <h2 style="font-size:17px;font-weight:800">리더십 테스트 데이터</h2>
          <span class="chip ${has ? "chip-mid" : "chip-gray"}">${has ? `테스트 팀원 ${st.members}명 · 지원서 ${st.applications}건 있음` : "없음"}</span>
        </div>
        <p style="margin:0">실제 운영 전에 리더십이 기능을 눌러볼 수 있도록 가상의 팀원·지원자·응답·배치표를 만들어요.
          이름 끝에 <b>(T)</b>, 이메일은 <b>@pole2.test</b>로 표시되고, <b>모두 지우기</b>는 이 표시가 있는 데이터만 지워요.</p>
        <div class="grid2" style="font-size:14px">
          <div class="card" style="background:var(--bg)"><b>만들어지는 것</b><ul style="margin:6px 0 0;padding-left:18px;line-height:1.8">
            <li>정식 팀원 11명 + 휴면 1명 (포지션·멀티 포지션 포함)</li>
            <li>지원자: 접수 2 · 면접 1 · 수습 3주차 1 · 재가입 면담 1 · 종료 2 (그중 1건은 3개월 지난 일괄 삭제 대상)</li>
            <li>다음 달 섬김 응답 (열린 상태, 미응답자 포함)</li>
            <li>지난 4주 + 이번 달 남은 주일 배치표 (공개 상태)</li>
            <li>지난 8주 출석 (연습·팀모임·주일 리허설, 결석 사유·연속 결석·지각 사례 포함)</li></ul></div>
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
      </section>`;
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
      title: "테스트 데이터 모두 지우기", body: `<p style="margin:0">(T) · @pole2.test 표시가 있는 팀원·지원서·응답·배치를 모두 지워요. 되돌릴 수 없어요.</p>`,
      confirmLabel: "모두 지우기", danger: true,
      onConfirm: async (close) => {
        const r = await api("/api/demo", { action: "clear" });
        await loadAll(); close(); toast(`테스트 계정 ${r.removedMembers}개 · 지원서 ${r.removedApplications}건을 지웠어요`); renderSettings();
      },
    }));
  }

  // ---------------------------------------------------------------- 시작
  (async function init() {
    const ctx = await requireMember({ admin: true });
    if (!ctx) return;
    S.me = ctx.me;
    $("#whoName").textContent = `${S.me.name}님`;
    await loadAll();
    window.__allPositions = await loadPositions();
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
