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
    $$(".side nav a").forEach((a) => a.classList.toggle("on", a.dataset.nav === (view === "app" ? "pipeline" : view)));
    updateTodoCount();
    if (view === "app" && id) return renderDetail(id);
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

  // ---------------------------------------------------------------- 멤버
  function renderMembers() {
    const f = S.memberFilter;
    const list = f === "alumni" ? [] : S.members.filter((m) => f === "all" ? m.is_active : f === "trainee" ? m.is_active && m.status === "trainee"
      : f === "active" ? m.is_active && m.status === "active" : !m.is_active);
    const cnt = (fn) => S.members.filter(fn).length;
    $("#content").innerHTML = `
      <div class="page-head"><h1 class="page-title">멤버</h1>
        <div class="seg" id="mFilter">
          <button type="button" data-f="all" aria-pressed="${f === "all"}">활동 ${cnt((m) => m.is_active)}</button>
          <button type="button" data-f="active" aria-pressed="${f === "active"}">정식 ${cnt((m) => m.is_active && m.status === "active")}</button>
          <button type="button" data-f="trainee" aria-pressed="${f === "trainee"}">수습 ${cnt((m) => m.is_active && m.status === "trainee")}</button>
          <button type="button" data-f="off" aria-pressed="${f === "off"}">휴면·종료 ${cnt((m) => !m.is_active)}</button>
          <button type="button" data-f="alumni" aria-pressed="${f === "alumni"}">탈퇴 기록 ${(S.alumni || []).length}</button></div></div>
      <p class="lead">${f === "alumni" ? "탈퇴할 때 재가입 확인용으로 이름·포지션·활동 기간·사유만 남겨요. 연락처 등 나머지 정보는 지워졌어요."
        : "추가 포지션을 지정하면 배치표 후보에 반영돼요. 리더십으로 지정한 사람은 관리자 화면을 쓰고 면접 평가표에 참여해요."}</p>
      ${f === "alumni" ? `<div class="loglist">${(S.alumni || []).map((x) => `<div style="grid-template-columns:140px 120px minmax(0,1fr)">
          <b>${esc(x.name)}</b><span class="muted">${esc(positionName(x.main_position))}</span>
          <span class="muted">${x.joined_at ? fmtDate(x.joined_at, { year: "numeric", month: "numeric", day: "numeric" }) + " ~ " : ""}${fmtDate(x.left_at, { year: "numeric", month: "numeric", day: "numeric" })}${x.reason ? " · " + esc(x.reason) : ""}</span></div>`).join("")
          || `<div><span class="muted">아직 탈퇴 기록이 없어요</span></div>`}</div>`
        : `<div class="mlist" id="mList">${list.map(memberHTML).join("") || `<div class="empty">해당하는 멤버가 없어요.</div>`}</div>`}`;
    $("#mFilter").onclick = (e) => { const b = e.target.closest("button"); if (b) { S.memberFilter = b.dataset.f; renderMembers(); } };
    if (!$("#mList")) return;
    $("#mList").onclick = onMemberClick;
    $("#mList").onchange = onMemberChange;
  }
  const openMembers = new Set();
  function memberHTML(m) {
    const ex = S.extras.filter((e) => e.member_id === m.id).map((e) => e.position_code);
    const ps = window.__allPositions || [];
    return `<article class="mitem" data-id="${m.id}">
      <button type="button" aria-expanded="${openMembers.has(m.id)}" data-toggle>
        <span class="nm">${esc(m.name)} ${m.role === "admin" ? `<span class="chip chip-violet" style="margin-left:4px">리더십</span>` : ""}${m.status === "trainee" ? `<span class="chip chip-mid" style="margin-left:4px">수습</span>` : ""}</span>
        <span class="chip ${m.is_active ? "chip-ok" : "chip-gray"}" style="grid-row:1 / span 2;grid-column:2">${m.is_active ? "활동" : "휴식·종료"}</span>
        <span class="mt">${esc(positionName(m.main_position))}${ex.length ? " + " + ex.map(positionName).join(", ") : ""}</span>
      </button>
      <div class="body ${openMembers.has(m.id) ? "" : "hidden"}">
        <dl class="kv"><dt>연락처</dt><dd>${esc(m.phone) || "—"}</dd><dt>이메일</dt><dd>${esc(m.email) || "—"}</dd><dt>가입일</dt><dd>${fmtDate(m.joined_at, { year: "numeric", month: "long", day: "numeric" })}</dd></dl>
        <div class="field"><span>추가 포지션</span><div style="display:flex;flex-wrap:wrap;gap:6px 14px">${ps.filter((p) => p.code !== m.main_position).map((p) =>
          `<label style="display:inline-flex;align-items:center;gap:6px;font-weight:500;font-size:14px"><input type="checkbox" data-extra="${p.code}" ${ex.includes(p.code) ? "checked" : ""} style="width:18px;height:18px;accent-color:var(--violet)">${esc(p.name)}</label>`).join("")}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${m.id !== S.me.id ? `<button type="button" class="btn btn-ghost btn-sm" data-act="active">${m.is_active ? "휴면으로 전환" : "활동으로 전환"}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="role">${m.role === "admin" ? "리더십 해제" : "리더십으로 지정"}</button>` : ""}
          <button type="button" class="btn btn-ghost btn-sm" data-act="reset">비밀번호 초기화</button>
          ${m.id !== S.me.id ? `<button type="button" class="btn btn-danger btn-sm" data-act="remove">탈퇴 처리</button>` : ""}
          ${m.application_id ? `<a class="btn btn-ghost btn-sm" href="#app/${m.application_id}">지원·수습 기록</a>` : ""}
        </div>
      </div></article>`;
  }
  async function onMemberClick(e) {
    const item = e.target.closest(".mitem"); if (!item) return;
    const m = S.members.find((x) => x.id === item.dataset.id);
    if (e.target.closest("[data-toggle]")) { openMembers.has(m.id) ? openMembers.delete(m.id) : openMembers.add(m.id); return renderMembers(); }
    const act = e.target.closest("[data-act]")?.dataset.act; if (!act) return;
    if (act === "active" || act === "role") {
      const patch = act === "active" ? { is_active: !m.is_active } : { role: m.role === "admin" ? "member" : "admin" };
      const { error } = await sb.from("members").update(patch).eq("id", m.id);
      if (error) return toast("바꾸지 못했습니다");
      Object.assign(m, patch);
      toast(act === "active" ? (m.is_active ? `${m.name}님 활동으로 전환` : `${m.name}님 휴식으로 전환`) : (m.role === "admin" ? `${m.name}님 리더십 지정` : `${m.name}님 리더십 해제`));
      return renderMembers();
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
  function openRemove(m) {
    modal({
      step: "탈퇴 처리", title: `${m.name}님 탈퇴 처리`,
      body: `<div class="field"><span>사유</span><div class="seg" id="rmWhy">${REMOVE_REASONS.map((r, i) => `<button type="button" data-v="${r}" aria-pressed="${i === 0}">${r}</button>`).join("")}</div></div>
        <label class="field">메모 (선택)<input type="text" id="rmNote" maxlength="100" placeholder="예: 2026년 가을 파송"></label>
        <div class="grid2" style="font-size:14px">
          <div class="card" style="background:var(--bg);padding:12px 14px"><b>남는 것</b><ul style="margin:6px 0 0;padding-left:18px">
            <li>탈퇴 기록: 이름·포지션·활동 기간·사유 (재가입 확인용)</li><li>지난 배치표의 이름</li></ul></div>
          <div class="card" style="background:var(--bad-bg);padding:12px 14px"><b>지워지는 것</b><ul style="margin:6px 0 0;padding-left:18px">
            <li>로그인 계정, 연락처·이메일</li><li>지원서·서약, 평가표, 수습 기록</li><li>섬김 응답, 출석</li></ul></div>
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
        await loadAll(); close(); toast(`${m.name}님을 탈퇴 처리했어요`); renderMembers();
      },
    });
    $("#mOk").disabled = true;
  }

  async function onMemberChange(e) {
    const cb = e.target.closest("[data-extra]"); if (!cb) return;
    const id = cb.closest(".mitem").dataset.id, code = cb.dataset.extra;
    const q = cb.checked ? sb.from("member_extra_positions").insert({ member_id: id, position_code: code })
      : sb.from("member_extra_positions").delete().match({ member_id: id, position_code: code });
    const { error } = await q;
    if (error) { cb.checked = !cb.checked; return toast("저장하지 못했습니다"); }
    S.extras = cb.checked ? S.extras.concat([{ member_id: id, position_code: code }]) : S.extras.filter((x) => !(x.member_id === id && x.position_code === code));
    toast(`${positionName(code)} ${cb.checked ? "추가" : "제외"}`);
    renderMembers();
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
    const published = withAsg.length > 0 && withAsg.every((s) => s.status === "published");
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
      return `<button type="button" class="lu-date ${V.sel === i ? "on" : ""}" data-sel="${i}"><b>${md(d)} 주일</b><span>가능 ${n}명${svc(d)?.status === "published" ? " · 공개" : ""}</span></button>`;
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
          <span class="chip ${published ? "chip-ok" : "chip-violet"}" style="font-size:13px;padding:5px 12px;border-radius:999px">${published ? "공개됨 · 멤버에게 보여요" : "임시저장 · 멤버에게 안 보여요"}</span>
          <button type="button" class="btn btn-ghost" id="luClear">전체 비우기</button>
          <button type="button" class="btn btn-primary" id="luPublish">${published ? "공개 문구 다시 복사" : "확정하고 공개"}</button></div></div>
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

    $("#luPublish").addEventListener("click", () => {
      const msg = `[찬양팀] ${monthLabel(V.data.month)} 배치표가 나왔어요. 확인 부탁드려요!\n\n${location.origin}/me.html#lineup`;
      if (published) return copyText(msg).then((ok) => toast(ok ? "공개 문구를 복사했어요" : "복사하지 못했어요"));
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

  // ================================================================ 토요 출석 (연습 · 팀모임)
  //  연습: 그 주 주일 배치 인원 / 팀모임: 활동 중인 전체 팀원(수습 포함)
  const A = { month: null, sel: null, data: null };
  const ATT_KEYS = ["present", "late", "absent", "excused"];
  const byPos = (a, b) => (posOrder()[a.main_position] ?? 99) - (posOrder()[b.main_position] ?? 99) || a.name.localeCompare(b.name, "ko");
  // 기존 팀원은 계정 등록일과 관계없이 대상 (지난 토요일도 뒤늦게 기록할 수 있게). 수습생만 시작 전 토요일 제외
  const meetingPeople = (d) => S.members.filter((m) => m.is_active && !(m.status === "trainee" && m.joined_at && m.joined_at > d)).sort(byPos);
  const MS_CHIP = { yes: "chip-ok", no: "chip-gray", tbd: "chip-mid" };

  // 없는 토요일 줄을 만들어 둠 (기본 '미정')
  async function ensureSaturdays(dates) {
    if (!dates.length) return;
    await sb.from("team_meetings").upsert(dates.map((d) => ({ meeting_date: d })), { onConflict: "meeting_date", ignoreDuplicates: true });
  }

  // 그 토요일 연습 대상 = 다음 날 주일 배치 인원 (임시저장 포함, 한 사람은 한 번)
  function practicePeople(d, services, recs = []) {
    const s = services.find((x) => x.service_date === addDays(d, 1));
    const seen = new Set(), list = [];
    (s?.assignments || []).slice()
      .sort((a, b) => (posOrder()[a.position_code] ?? 99) - (posOrder()[b.position_code] ?? 99) || a.slot - b.slot)
      .forEach((a) => {
        const m = S.members.find((x) => x.id === a.member_id);
        if (m && !seen.has(m.id)) { seen.add(m.id); list.push({ m, pos: a.position_code }); }
      });
    // 기록은 있는데 배치에서 빠진 사람도 보여 줌
    recs.filter((r) => r.kind === "practice" && !seen.has(r.member_id)).forEach((r) => {
      const m = S.members.find((x) => x.id === r.member_id);
      if (m) { seen.add(m.id); list.push({ m, pos: m.main_position, off: true }); }
    });
    return { list, status: s?.status || null };
  }

  async function renderAttendance() {
    if (!A.month) A.month = monthOf(lastSaturday());
    const sats = saturdaysOf(A.month);
    if (!A.sel || !sats.includes(A.sel)) A.sel = sats.includes(lastSaturday()) ? lastSaturday() : sats[0];
    await ensureSaturdays(sats);
    const [tm, sv] = await Promise.all([
      sb.from("team_meetings").select("*, attendance(*)").in("meeting_date", sats),
      sb.from("services").select("service_date, status, assignments(member_id, position_code, slot)").in("service_date", sats.map((d) => addDays(d, 1))),
    ]);
    if (tm.error || sv.error) { toast("출석을 불러오지 못했습니다. migration_008을 실행했는지 확인해 주세요.", 4000); console.error(tm.error || sv.error); }
    A.data = { sats, meetings: tm.data || [], services: sv.data || [] };
    drawAttendance();
  }

  function drawAttendance() {
    const { sats, meetings, services } = A.data;
    const today = todayISO();
    const mt = (d) => meetings.find((x) => x.meeting_date === d) || { meeting_status: "tbd", attendance: [] };
    const recOf = (row, mid, kind) => row.attendance.find((r) => r.member_id === mid && r.kind === kind)?.status;
    const d = A.sel, row = mt(d), ms = row.meeting_status;
    const prac = practicePeople(d, services, row.attendance);
    const meet = meetingPeople(d);
    const future = d > today;

    const tabs = sats.map((s) => {
      const r = mt(s);
      const p = practicePeople(s, services, r.attendance).list.length;
      const pr = r.attendance.filter((x) => x.kind === "practice").length;
      const mr = r.attendance.filter((x) => x.kind === "meeting").length;
      const info = s > today ? `팀모임 ${MEETING[r.meeting_status]}` : `연습 ${pr}/${p} · 모임 ${r.meeting_status === "no" ? "없음" : mr + "/" + meetingPeople(s).length}`;
      return `<button type="button" class="sat-tab ${s === d ? "on" : ""} ${s === lastSaturday() ? "today" : ""}" data-sat="${s}"><b>${md(s)} 토</b><span>${info}</span></button>`;
    }).join("");

    const seg = (mid, kind, cur) => `<div class="seg" role="group" aria-label="출석" data-mid="${mid}" data-kind="${kind}">${ATT_KEYS.map((k) =>
      `<button type="button" data-v="${k}" data-tone="${k}" aria-pressed="${cur === k}" ${future ? "disabled" : ""}>${ATT[k]}</button>`).join("")}</div>`;
    const sum = (kind, total) => {
      const rs = row.attendance.filter((r) => r.kind === kind);
      const c = (k) => rs.filter((r) => r.status === k).length;
      return `<div class="att-sum"><span class="chip chip-ok">출석 ${c("present")}</span><span class="chip chip-mid">지각 ${c("late")}</span>
        <span class="chip ${c("absent") ? "chip-bad" : "chip-gray"}">결석 ${c("absent")}</span><span class="chip chip-gray">사유 ${c("excused")}</span>
        <span class="chip chip-gray">미기록 ${Math.max(total - rs.length, 0)}</span></div>`;
    };
    const personRow = (m, kind, extra = "") => `<div class="att-row"><span class="who"><b>${esc(m.name)}${m.status === "trainee" ? ` <span class="chip chip-mid">수습</span>` : ""}</b>
      <span>${extra || esc(positionName(m.main_position))}</span></span>${seg(m.id, kind, recOf(row, m.id, kind))}</div>`;

    const pracCol = `<section class="att-col" aria-label="토요 연습">
      <div class="dcard-head"><h2>토요 연습</h2><span class="small muted">${md(addDays(d, 1))} 주일 섬김 ${prac.list.filter((x) => !x.off).length}명${prac.status === "draft" ? " · 배치 임시저장" : ""}</span></div>
      ${prac.list.length ? `${sum("practice", prac.list.length)}
        ${prac.list.map(({ m, pos, off }) => personRow(m, "practice", off ? "배치에서 빠짐" : esc(positionName(pos)))).join("")}
        ${future ? "" : `<button type="button" class="btn btn-soft btn-sm" data-allin="practice" style="align-self:flex-start">남은 사람 모두 출석</button>`}`
      : `<div class="empty" style="padding:20px">${md(addDays(d, 1))} 주일 배치가 아직 없어요.<br><a href="#lineup" data-lmonth="${monthOf(addDays(d, 1))}">배치표로 가기</a></div>`}
    </section>`;

    const meetCol = `<section class="att-col ${ms === "no" ? "off" : ""}" aria-label="팀모임">
      <div class="dcard-head"><h2>팀모임</h2><span class="small muted">활동 중인 팀원 ${meet.length}명 · 수습 포함</span></div>
      ${ms === "no" ? `<div class="empty" style="padding:20px">이번 주는 팀모임이 없어요.</div>`
        : `${ms === "tbd" && !future ? `<p class="notice warn" style="margin:0">팀모임 여부가 '미정'이에요. 출석을 체크하면 '있음'으로 바뀌어요.</p>` : ""}
        ${sum("meeting", meet.length)}
        ${meet.map((m) => personRow(m, "meeting")).join("")}
        ${future ? "" : `<button type="button" class="btn btn-soft btn-sm" data-allin="meeting" style="align-self:flex-start">남은 사람 모두 출석</button>`}`}
    </section>`;

    // 이 달 한눈에 보기
    const short = { present: "출", late: "지", absent: "결", excused: "사" };
    const cell = (r, kind, m, s) => {
      if (kind === "meeting" && r.meeting_status === "no") return `<td class="m-off">·</td>`;
      if (kind === "practice" && !practicePeople(s, services, r.attendance).list.some((x) => x.m.id === m.id)) return `<td class="m-off">·</td>`;
      const v = recOf(r, m.id, kind);
      return `<td class="${v ? "m-" + v : "m-off"}">${v ? short[v] : s > today ? "" : "–"}</td>`;
    };
    const everyone = meetingPeople(sats[sats.length - 1]);
    const table = `<div class="evaltable"><table class="att-table">
      <thead><tr><th rowspan="2">이름</th>${sats.map((s) => `<th colspan="2" style="text-align:center;border-left:1px solid var(--line)">${md(s)} <span class="chip ${MS_CHIP[mt(s).meeting_status]}" style="margin-left:4px">모임 ${MEETING[mt(s).meeting_status]}</span></th>`).join("")}</tr>
        <tr>${sats.map(() => `<th style="border-left:1px solid var(--line);font-size:12px">연습</th><th style="font-size:12px">모임</th>`).join("")}</tr></thead>
      <tbody>${everyone.map((m) => `<tr><td style="font-weight:700">${esc(m.name)}</td>${sats.map((s) => {
        const r = mt(s);
        return cell(r, "practice", m, s).replace("<td", `<td style="border-left:1px solid var(--line)"`) + cell(r, "meeting", m, s);
      }).join("")}</tr>`).join("") || `<tr><td colspan="99" class="muted">활동 중인 팀원이 없어요.</td></tr>`}</tbody></table></div>
      <p class="small muted" style="margin:0">출 출석 · 지 지각 · 결 결석 · 사 사유결석 · – 미기록 · · 대상 아님(연습은 그 주 섬김 인원만)</p>`;

    $("#content").innerHTML = `
      <div class="page-head">${monthNav("토요 출석", A.month)}</div>
      <p class="lead">토요일마다 연습(그 주 섬김 인원)과 팀모임(전체)을 따로 체크해요. 이미 누른 칸을 다시 누르면 기록이 지워져요.</p>
      <div class="sat-tabs" role="tablist" aria-label="토요일">${tabs}</div>
      <section class="card bordered" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px">
        <div style="display:flex;flex-direction:column;gap:2px"><b style="font-size:17px">${fmtDate(d, { month: "long", day: "numeric", weekday: "short" })} 팀모임</b>
          <span class="small muted">${future ? "정해지면 팀원 홈에 바로 보여요" : "연습 후 팀모임이 있었는지 골라 주세요"}</span></div>
        <div class="seg" id="msSeg">${["yes", "no", "tbd"].map((k) => `<button type="button" data-v="${k}" aria-pressed="${ms === k}">${MEETING[k]}</button>`).join("")}</div>
      </section>
      ${future ? `<p class="notice ok" style="margin:0">아직 오지 않은 토요일이에요. 출석은 그날부터 체크할 수 있어요.</p>` : ""}
      <div class="att-cols">${pracCol}${meetCol}</div>
      <h2 style="font-size:19px;font-weight:800;margin-top:8px">${monthLabel(A.month)} 한눈에 보기</h2>
      ${table}`;

    bindMonthNav((n) => { A.month = addMonths(A.month, n); A.sel = null; renderAttendance(); });
    bindAttendance(row);
  }

  function bindAttendance(row) {
    const content = $("#content");
    content.querySelectorAll("[data-sat]").forEach((b) => b.addEventListener("click", () => { A.sel = b.dataset.sat; drawAttendance(); }));
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
          body: `<p style="margin:0">이 날 적어 둔 팀모임 출석 ${n}건이 지워져요. 연습 출석은 그대로 남아요.</p>`,
          confirmLabel: "없음으로 바꾸기", danger: true, onConfirm: async (close) => { close(); await setStatus("no"); } });
      }
      setStatus(b.dataset.v);
    });

    content.querySelectorAll(".att-col .seg[data-mid]").forEach((g) => g.addEventListener("click", async (e) => {
      const b = e.target.closest("button"); if (!b || b.disabled) return;
      const key = { meeting_id: row.id, member_id: g.dataset.mid, kind: g.dataset.kind };
      const clear = b.getAttribute("aria-pressed") === "true";
      const { error } = clear
        ? await sb.from("attendance").delete().match(key)
        : await sb.from("attendance").upsert({ ...key, status: b.dataset.v });
      if (error) return toast(error.message?.includes("팀모임이 없는") ? error.message : "저장하지 못했습니다", 3500);
      row.attendance = row.attendance.filter((r) => !(r.member_id === key.member_id && r.kind === key.kind));
      if (!clear) {
        row.attendance.push({ ...key, status: b.dataset.v });
        if (key.kind === "meeting" && row.meeting_status === "tbd") row.meeting_status = "yes";
      }
      drawAttendance();
    }));

    content.querySelectorAll("[data-allin]").forEach((b) => b.addEventListener("click", async () => {
      const kind = b.dataset.allin;
      const people = kind === "practice" ? practicePeople(A.sel, A.data.services, row.attendance).list.map((x) => x.m) : meetingPeople(A.sel);
      const rest = people.filter((m) => !row.attendance.some((r) => r.member_id === m.id && r.kind === kind));
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

  // ================================================================ 대시보드
  const STREAK_LIMIT = 5;      // 팀모임 연속 결석 경고 기준
  const LATE_WEEKS = 4;        // 연습 지각을 보는 기간(주)

  // 팀모임 연속 결석: '있음'이었던 지난 팀모임을 최근부터 거슬러 셈. 사유결석·미기록은 건너뜀
  function absenceStreak(m, meetings, today) {
    let n = 0, last = null;
    for (const mt of meetings.slice().sort((a, b) => b.meeting_date.localeCompare(a.meeting_date))) {
      if (mt.meeting_status !== "yes" || mt.meeting_date > today) continue;
      if (m.joined_at && mt.meeting_date < m.joined_at) break;
      const r = mt.attendance.find((x) => x.member_id === m.id && x.kind === "meeting");
      if (!r || r.status === "excused") continue;
      if (r.status === "absent") n++; else { last = mt.meeting_date; break; }
    }
    return { n, last };
  }

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

    // ---------- 이번 주 할 일 ----------
    const todos = [];
    const item = (tone, text, sub, href, attrs = "") => `<li><a href="${href}" ${attrs}><i class="dot ${tone}"></i><span>${text}</span><small>${sub || ""}</small></a></li>`;
    const ts = mtOf(thisSat);
    todos.push(ts.meeting_status === "tbd"
      ? item("", `${md(thisSat)} 팀모임 여부 정하기`, "미정", "#attendance", `data-sat="${thisSat}"`)
      : item("ok", `${md(thisSat)} 팀모임 ${MEETING[ts.meeting_status]}`, "정해짐", "#attendance", `data-sat="${thisSat}"`));
    const POS = window.__allPositions || [];
    suns.forEach((sun) => {
      const s = services.find((x) => x.service_date === sun), list = (s?.assignments || []).filter((a) => a.member_id);
      const href = `#lineup`, at = `data-lmonth="${monthOf(sun)}"`;
      if (!list.length) return todos.push(item("", `${md(sun)} 주일 배치표 비어 있음`, "배치하기", href, at));
      const kinds = list.map((x) => POS.find((p) => p.code === x.position_code)?.kind);
      const miss = [kinds.includes("vocal") && !list.some((x) => x.is_singer_leader) && "싱어 리더", kinds.includes("band") && !list.some((x) => x.is_band_master) && "밴드 마스터"].filter(Boolean);
      if (s.status !== "published") todos.push(item("", `${md(sun)} 주일 배치표 아직 공개 전`, `${list.length}명 배치 · 임시저장`, href, at));
      else if (miss.length) todos.push(item("mid", `${md(sun)} 주일 ${miss.join(", ")} 미지정`, `${list.length}명 배치 · 공개됨`, href, at));
      else todos.push(item("ok", `${md(sun)} 주일 배치표 공개됨`, `${list.length}명`, href, at));
    });
    {   // 지난(또는 오늘) 토요일 출석 기록이 비었는지
      const r = mtOf(lastSat);
      const p = practicePeople(lastSat, services, r.attendance).list.length;
      const pr = r.attendance.filter((x) => x.kind === "practice").length;
      const mr = r.attendance.filter((x) => x.kind === "meeting").length, mtot = meetingPeople(lastSat).length;
      const gaps = [p > pr && `연습 ${pr}/${p}`, r.meeting_status === "yes" && mtot > mr && `모임 ${mr}/${mtot}`, r.meeting_status === "tbd" && "팀모임 여부 미정"].filter(Boolean);
      if (gaps.length) todos.push(item("", `${md(lastSat)} 출석 기록 마저 하기`, gaps.join(" · "), "#attendance", `data-sat="${lastSat}"`));
    }
    const pend = S.apps.filter((a) => cardTodo(a).pending).length;
    if (pend) todos.push(item("", `모집·수습 할 일 ${pend}건`, "안내 문구·단계", "#pipeline"));
    const nextM = addMonths(monthOf(today), 1);
    if (+today.slice(8) >= 15 && !months.some((m) => m.month === nextM))
      todos.push(item("", `${monthLabel(nextM)} 섬김 응답 열기`, "아직 안 열었어요", "#respond", `data-rmonth="${nextM}"`));
    openMonths.filter((m) => m.deadline && m.deadline < today).forEach((m) =>
      todos.push(item("mid", `${monthLabel(m.month)} 섬김 응답 마감일 지남`, "마감하기", "#respond", `data-rmonth="${m.month}"`)));
    todos.sort((a, b) => (a.includes('dot ok') ? 1 : 0) - (b.includes('dot ok') ? 1 : 0));

    // ---------- 섬김 응답 ----------
    const respHTML = resp.length ? resp.map(({ m, total, done, partial, none }) => `
      <div style="display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><b>${monthLabel(m.month)} 응답</b>
          <span class="small muted">${m.deadline ? `${fmtDate(m.deadline, { month: "long", day: "numeric", weekday: "short" })} 마감 · ${dday(m.deadline)}` : "마감일 미정"}</span></div>
        <div class="dstat"><div><b>${done.length}<span class="small muted" style="font-weight:600">/${total}</span></b><span>응답 완료</span></div>
          <div><b>${partial.length}</b><span>응답 중</span></div><div><b style="color:${none.length ? "var(--warn)" : "inherit"}">${none.length}</b><span>미응답</span></div></div>
        ${none.length + partial.length ? `<span class="small"><b>아직 남은 사람</b> ${[...none, ...partial].map((p) => esc(p.name)).join(", ")}</span>
          <button type="button" class="btn btn-soft btn-sm" data-nudge="${m.month}" style="align-self:flex-start">독촉 문구 복사</button>` : `<span class="small" style="color:var(--ok);font-weight:700">모두 응답했어요</span>`}
      </div>`).join(`<hr style="border:0;border-top:1px solid var(--line);margin:4px 0">`)
      : `<p class="muted small" style="margin:0">지금 응답 받는 달이 없어요.</p>`;

    // ---------- 출석 ----------
    const past = meetings.filter((x) => x.meeting_date <= today);
    const held = past.filter((x) => x.meeting_status === "yes").slice(-8);
    const rec = held.flatMap((x) => x.attendance.filter((a) => a.kind === "meeting"));
    const rate = rec.length ? Math.round(100 * rec.filter((a) => ["present", "late"].includes(a.status)).length / rec.length) : null;
    const people = S.members.filter((m) => m.is_active);
    const streaks = people.map((m) => ({ m, ...absenceStreak(m, meetings, today) })).filter((x) => x.n >= STREAK_LIMIT).sort((a, b) => b.n - a.n);
    const near = people.map((m) => ({ m, ...absenceStreak(m, meetings, today) })).filter((x) => x.n >= 3 && x.n < STREAK_LIMIT);
    const lateFrom = addDays(lastSat, -7 * (LATE_WEEKS - 1));
    const lateSats = past.filter((x) => x.meeting_date >= lateFrom);
    const lates = people.map((m) => {
      const marks = lateSats.map((x) => x.attendance.find((a) => a.member_id === m.id && a.kind === "practice")?.status || null);
      return { m, marks, n: marks.filter((s) => s === "late").length };
    }).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || byPos(a.m, b.m));
    const dots = (marks) => `<span class="dots" aria-hidden="true">${marks.map((s) => `<i class="${s === "present" ? "" : s || "none"}"></i>`).join("")}</span>`;

    // ---------- 팀 구성 ----------
    const act = S.members.filter((m) => m.is_active && m.status === "active");
    const trainees = S.members.filter((m) => m.is_active && m.status === "trainee");
    const dormant = S.members.filter((m) => !m.is_active).length;
    const posCount = POS.map((p) => ({ p, n: act.filter((m) => m.main_position === p.code).length,
      multi: S.extras.filter((e) => e.position_code === p.code && act.some((m) => m.id === e.member_id)).length }));
    const maxN = Math.max(1, ...posCount.map((x) => x.n + x.multi));

    $("#content").innerHTML = `
      <div class="page-head"><h1 class="page-title">대시보드</h1><span class="small muted">${fmtDate(today, { month: "long", day: "numeric", weekday: "long" })}</span></div>
      <div class="dash-grid">
        <section class="dcard" aria-label="이번 주 할 일">
          <div class="dcard-head"><h2>이번 주 할 일</h2></div>
          <ul class="dtodo">${todos.join("")}</ul>
        </section>
        <section class="dcard" aria-label="섬김 응답 현황">
          <div class="dcard-head"><h2>섬김 응답</h2><a href="#respond">응답 현황</a></div>
          ${respHTML}
        </section>
        <section class="dcard" aria-label="출석 현황">
          <div class="dcard-head"><h2>출석</h2><a href="#attendance">토요 출석</a></div>
          <div class="dstat"><div><b>${rate === null ? "–" : rate + "%"}</b><span>팀모임 출석률<br>최근 ${held.length}회</span></div>
            <div><b style="color:${streaks.length ? "var(--bad)" : "inherit"}">${streaks.length}</b><span>팀모임 연속 결석<br>${STREAK_LIMIT}회 이상</span></div>
            <div><b style="color:${lates.length ? "var(--mid)" : "inherit"}">${lates.reduce((s, x) => s + x.n, 0)}</b><span>연습 지각<br>최근 ${LATE_WEEKS}주</span></div></div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <b class="small">팀모임 연속 결석 ${STREAK_LIMIT}회 이상</b>
            ${streaks.length ? `<div class="dlist">${streaks.map((x) => `<div><span><b>${esc(x.m.name)}</b> <span class="muted small">${esc(positionName(x.m.main_position))}</span></span>
              <span class="small"><b style="color:var(--bad)">${x.n}회 연속</b> · ${x.last ? `마지막 출석 ${md(x.last)}` : "최근 16주 출석 없음"}</span></div>`).join("")}</div>`
              : `<span class="small muted">없어요${near.length ? ` · 3~4회: ${near.map((x) => esc(x.m.name)).join(", ")}` : ""}</span>`}
          </div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <b class="small">연습 지각 · 최근 ${LATE_WEEKS}주</b>
            ${lates.length ? `<div class="dlist">${lates.map((x) => `<div><span><b>${esc(x.m.name)}</b> <span class="muted small">${esc(positionName(x.m.main_position))}</span></span>
              <span style="display:flex;align-items:center;gap:8px"><b class="small" style="color:var(--mid)">${x.n}회</b>${dots(x.marks)}</span></div>`).join("")}</div>`
              : `<span class="small muted">없어요</span>`}
          </div>
        </section>
        <section class="dcard" aria-label="팀 구성">
          <div class="dcard-head"><h2>팀 구성</h2><a href="#members">멤버</a></div>
          <div class="dstat"><div><b>${act.length}</b><span>정식</span></div><div><b>${trainees.length}</b><span>수습</span></div><div><b>${dormant}</b><span>휴면·종료</span></div></div>
          <div style="display:flex;flex-direction:column;gap:8px">${posCount.map(({ p, n, multi }) => `<div class="pbar"><span>${esc(p.name)}</span>
            <span class="track" title="주 포지션 ${n}명${multi ? ` · 멀티 ${multi}명` : ""}"><span class="fill" style="display:block;width:${Math.round(100 * n / maxN)}%"></span></span>
            <b>${n}${multi ? `<span class="small muted" style="font-weight:600">+${multi}</span>` : ""}</b></div>`).join("")}</div>
          <span class="small muted">숫자 = 주 포지션 인원 · +는 멀티 포지션</span>
          ${trainees.length ? `<div style="display:flex;flex-direction:column;gap:4px"><b class="small">수습 중</b><div class="dlist">${trainees.map((m) => {
            const a = S.apps.find((x) => x.user_id === m.id);
            const st = a ? tstate(a) : { week: 0 };
            const label = !a ? "" : st.paused ? `${st.nextWeek}주차 연기 중` : st.week === 0 ? `${md(st.resume || a.trainee_start)} 시작` : st.week > 5 ? "5주 완료 · 전환 결정" : `${st.week}주차 · ${TRAINEE_WEEKS[st.week - 1].title}`;
            return `<div><span><b>${esc(m.name)}</b> <span class="muted small">${esc(positionName(m.main_position))}</span></span>
              ${a ? `<a class="small" href="#app/${a.id}" style="font-weight:700;text-decoration:none">${label}</a>` : ""}</div>`;
          }).join("")}</div></div>` : ""}
        </section>
      </div>`;

    const c = $("#content");
    c.querySelectorAll("[data-sat]").forEach((a) => a.addEventListener("click", () => { A.sel = a.dataset.sat; A.month = monthOf(a.dataset.sat); }));
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
            <li>지난 8주 토요 출석 (연습·팀모임, 연속 결석·지각 사례 포함)</li></ul></div>
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
