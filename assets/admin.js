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
  const tstate = (a) => traineeState(a.trainee_start, pp(a.id));

  // ---------------------------------------------------------------- 데이터
  async function loadAll() {
    const [apps, logs, members, extras, evals, templates, items, postpones] = await Promise.all([
      sb.from("applications").select("*").order("created_at", { ascending: false }),
      sb.from("message_log").select("*").order("sent_at"),
      sb.from("members").select("*").order("name"),
      sb.from("member_extra_positions").select("*"),
      sb.from("interview_evaluations").select("*"),
      sb.from("message_templates").select("*").order("sort_order"),
      sb.from("eval_items").select("*").order("sort_order"),
      sb.from("trainee_postpones").select("*").order("from_week"),
    ]);
    const err = [apps, logs, members, extras, evals, templates, items, postpones].find((r) => r.error);
    if (err) { toast("데이터를 불러오지 못했습니다. 새로고침해 주세요."); console.error(err.error); }
    S.apps = apps.data || []; S.logs = logs.data || []; S.members = members.data || [];
    S.extras = extras.data || []; S.evals = evals.data || []; S.templates = templates.data || []; S.items = items.data || [];
    S.postpones = postpones.data || [];
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
    const h = location.hash.slice(1) || "pipeline";
    const [view, id] = h.split("/");
    $$(".side nav a").forEach((a) => a.classList.toggle("on", a.dataset.nav === (view === "app" ? "pipeline" : view)));
    if (view === "app" && id) return renderDetail(id);
    if (view === "members") return renderMembers();
    if (view === "respond") return renderRespondAdmin();
    if (view === "lineup") return renderLineupAdmin();
    if (view === "templates") return renderTemplates();
    return renderPipeline();
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
      </section>`;

    renderRecruitChips();
    bindBoard();
    updateTodoCount();
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
  function modal({ step, title, body, confirmLabel, onConfirm, onInput, cancelLabel = "취소" }) {
    const root = $("#modalRoot");
    root.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle">
      ${step ? `<span class="step">${esc(step)}</span>` : ""}
      <h3 id="mTitle">${esc(title)}</h3>
      <div id="mBody" style="display:flex;flex-direction:column;gap:14px">${body}</div>
      <div class="actions"><button type="button" class="btn btn-ghost" id="mCancel">${cancelLabel}</button>
        ${confirmLabel ? `<button type="button" class="btn btn-primary" id="mOk">${esc(confirmLabel)}</button>` : ""}</div>
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
    modal({
      step: t.timing, title: `${a.name}님 · 면접 → 수습 시작`,
      body: `${weak ? `<p class="notice warn" style="margin:0">평가표에 '미흡'이 ${weak}개 있어요. 판정 기준상 보류 또는 조건부 수습을 검토해 주세요.</p>` : ""}
        <div class="field"><span>면접 결과</span>
          <div class="seg" id="res"><button type="button" data-v="pass" aria-pressed="${weak ? "false" : "true"}">합격 (수습 전환)</button><button type="button" data-v="pass_cond" aria-pressed="${weak ? "true" : "false"}">조건부 수습</button></div></div>
        <label class="field" id="condWrap">조건 (수습 때 함께 볼 점)<input type="text" id="cond" maxlength="500" placeholder="예: 합주 시 타 파트 청취 보완"></label>
        <div class="grid2">
          <label class="field">주 포지션<select id="pos"></select></label>
          <label class="field">수습 시작일 (토요일)<input type="date" id="start" value="${nextSaturday()}"></label>
        </div>
        <p class="small muted" style="margin:0">수습을 시작하면 로그인 계정이 만들어지고, 임시 비밀번호가 아래 문구에 들어가요.</p>
        ${msgBox("")}`,
      onInput: (e) => {
        if (e?.target?.closest?.("#res button")) {
          $$("#res button").forEach((b) => b.setAttribute("aria-pressed", String(b === e.target.closest("button"))));
        }
        $("#condWrap").classList.toggle("hidden", $("#res [aria-pressed=true]").dataset.v !== "pass_cond");
        $("#mMsg").textContent = fillTemplate(t.body, ctxOf(a, { traineeStart: $("#start").value }));
      },
      confirmLabel: "계정 만들고 수습 시작",
      onConfirm: async (close) => {
        const result = $("#res [aria-pressed=true]").dataset.v;
        const start = $("#start").value;
        if (!start) throw new Error("수습 시작일을 정해 주세요.");
        const r = await api("/api/start-trainee", { applicationId: a.id, mainPosition: $("#pos").value, startDate: start, result, condition: $("#cond").value });
        await logMessage(a.id, "4");
        await loadAll();
        const text = fillTemplate(t.body, ctxOf(app(a.id), { tempPassword: r.tempPassword }));
        close();
        modal({
          step: "③ 합격 + ④ 수습 시작 안내", title: `${a.name}님 수습을 시작했어요`,
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
    const list = S.members.filter((m) => f === "all" ? m.is_active : f === "trainee" ? m.is_active && m.status === "trainee"
      : f === "active" ? m.is_active && m.status === "active" : !m.is_active);
    const cnt = (fn) => S.members.filter(fn).length;
    $("#content").innerHTML = `
      <div class="page-head"><h1 class="page-title">멤버</h1>
        <div class="seg" id="mFilter">
          <button type="button" data-f="all" aria-pressed="${f === "all"}">활동 ${cnt((m) => m.is_active)}</button>
          <button type="button" data-f="active" aria-pressed="${f === "active"}">정식 ${cnt((m) => m.is_active && m.status === "active")}</button>
          <button type="button" data-f="trainee" aria-pressed="${f === "trainee"}">수습 ${cnt((m) => m.is_active && m.status === "trainee")}</button>
          <button type="button" data-f="off" aria-pressed="${f === "off"}">휴식·종료 ${cnt((m) => !m.is_active)}</button></div></div>
      <p class="lead">추가 포지션을 지정하면 배치표 후보에 반영돼요. 리더십으로 지정한 사람은 관리자 화면을 쓰고 면접 평가표에 참여해요.</p>
      <div class="mlist" id="mList">${list.map(memberHTML).join("") || `<div class="empty">해당하는 멤버가 없어요.</div>`}</div>`;
    $("#mFilter").onclick = (e) => { const b = e.target.closest("button"); if (b) { S.memberFilter = b.dataset.f; renderMembers(); } };
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
          ${m.id !== S.me.id ? `<button type="button" class="btn btn-ghost btn-sm" data-act="active">${m.is_active ? "휴식으로 전환" : "활동으로 전환"}</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="role">${m.role === "admin" ? "리더십 해제" : "리더십으로 지정"}</button>` : ""}
          <button type="button" class="btn btn-ghost btn-sm" data-act="reset">비밀번호 초기화</button>
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
  function renderTemplates() {
    $("#content").innerHTML = `
      <div class="page-head"><h1 class="page-title">안내 문구</h1></div>
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
      return v === true ? `<td class="a-yes" title="가능">가능</td>` : v === false ? `<td class="a-no" title="불가">불가</td>` : `<td class="a-none" title="미응답">–</td>`;
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
    const canPlace = (mid, d, pos) => { const m = mem(mid); return !!m && posOf(m).includes(pos) && ans(m, d, "sun") !== false; };
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
          <div style="display:flex;flex-direction:column;gap:6px">${pool.map((m) => {
            const placed = asg(selD).some((x) => x.member_id === m.id);
            const sun = ans(m, selD, "sun"), sat = ans(m, selD, "sat");
            return `<div class="lu-cand ${V.picked === m.id ? "picked" : ""} ${placed ? "placed" : ""}" draggable="true" data-mid="${m.id}" tabindex="0" role="button" aria-pressed="${V.picked === m.id}">
              <span style="display:flex;flex-direction:column;flex:1;min-width:0"><b>${esc(m.name)}</b><span class="small muted">${posOf(m).map(positionName).join(" · ")}</span></span>
              ${sun === undefined ? `<span class="chip chip-warn">미응답</span>` : ""}${sat === false ? `<span class="chip chip-warn">토 연습 불가</span>` : ""}${placed ? `<span class="chip chip-violet">배치됨</span>` : ""}
              <b class="small" style="width:30px;text-align:right">${counts[m.id] || 0}회</b></div>`;
          }).join("") || `<span class="muted small">이 날 가능한 팀원이 없어요</span>`}</div>
          <p class="small muted" style="margin:0;border-top:1px solid var(--line);padding-top:10px"><b style="color:var(--ink-2)">불가</b> ${unavailable.map((m) => esc(m.name)).join(", ") || "없음"}</p>
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
      confirmLabel: "전체 비우기",
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
        if (!location.hash || location.hash === "#pipeline") route(); else updateTodoCount();
      })
      .subscribe();
  })();
})();
