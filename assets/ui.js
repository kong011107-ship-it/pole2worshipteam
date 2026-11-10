// =====================================================================
//  v34.1 공통 UI — 시트 · 서랍 · 확인 창(닫힐 때 모션) · 화면 전환(View Transitions) · 뼈대 로딩 · 선택 표시 이동
//  window.UI = { sheet, confirm, leave, vt, skel, saved, seg, ind, reduced, ICON }
//  모든 HTML이 common.js 앞에서 불러요. 악보 보기 · 필기 · 백업찬양 진행 · 섬김이 링크는 쓰지 않아요.
// =====================================================================
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  const reduced = () => !!mq.matches;
  const OUT_MS = 180;

  const svg = (d, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    chev: svg('<path d="m6 9 6 6 6-6"/>'),
    left: svg('<path d="m15 18-6-6 6-6"/>'),
    right: svg('<path d="m9 18 6-6-6-6"/>'),
    updown: svg('<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>'),
    check: svg('<path d="M5 12l5 5 9-10"/>', 2.4),
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z" fill="currentColor"/></svg>',
    file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
    music: svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
    todo: svg('<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>'),
    vote: svg('<path d="M3 21h18M6 21V10M18 21V10M12 21V10M4 10l8-6 8 6"/>'),
    heart: svg('<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>'),
    cal: svg('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>'),
    bell: svg('<path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
    trash: svg('<path d="M3 6h18M8 6V4h8v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/>'),
    unlink: svg('<path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71M5.17 11.75l-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71M8 2v3M2 8h3M16 22v-3M22 16h-3"/>'),
  };

  // 나가는 모션 뒤에 지우기 (동작 줄이기면 바로)
  function leave(el, done) {
    if (!el || !el.isConnected) { done?.(); return; }
    if (reduced()) { done ? done() : el.remove(); return; }
    el.classList.add("u-out");
    setTimeout(() => { done ? done() : el.remove(); }, OUT_MS);
  }

  // 화면 전환: View Transitions가 있으면 쓰고, 없으면 그냥 바꿔요
  function vt(fn) {
    if (!document.startViewTransition || reduced()) { fn(); return; }
    try { document.startViewTransition(fn); } catch { fn(); }
  }

  // ---------- 시트 · 서랍 ----------
  //  UI.sheet({ title, desc, html, onClose, label }) → { el, body, close }
  //  휴대폰은 아래에서 올라오고, 넓은 화면은 가운데에 떠요. 배경 · Esc · 닫기 단추로 닫혀요.
  const stack = [];
  function sheet({ title = "", desc = "", html = "", onClose, label, closeText = "닫기", cls = "" } = {}) {
    const el = document.createElement("div");
    el.className = "u-sh " + cls;
    el.innerHTML = `<div class="u-scrim" data-u-close></div><section class="u-sheet" role="dialog" aria-modal="true" aria-label="${esc(label || title)}">
      <i class="u-grab"></i>
      <div class="u-shh"><div class="u-dh"><b>${esc(title)}</b>${desc ? `<span>${esc(desc)}</span>` : ""}</div><button type="button" class="u-b u-o u-sm" data-u-close>${esc(closeText)}</button></div>
      <div class="u-shb">${html}</div></section>`;
    document.body.appendChild(el);
    let closed = false;
    const prevFocus = document.activeElement;
    const close = (why) => {
      if (closed) return; closed = true;
      const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
      leave(el);
      try { prevFocus?.focus?.({ preventScroll: true }); } catch {}
      onClose?.(why);
    };
    el.addEventListener("click", (e) => { if (e.target.closest("[data-u-close]")) close("x"); });
    const api = { el, body: el.querySelector(".u-shb"), close, set(htmlNow) { api.body.innerHTML = htmlNow; } };
    stack.push(api);
    setTimeout(() => el.querySelector(".u-sheet")?.focus?.({ preventScroll: true }), 0);
    el.querySelector(".u-sheet").tabIndex = -1;
    return api;
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && stack.length) { e.stopPropagation(); stack[stack.length - 1].close("esc"); } }, true);

  // ---------- 확인 창 ----------
  //  await UI.confirm({ title, msg, ok: "지우기", danger: true }) → true / false
  function confirm({ title = "확인", msg = "", html = "", ok = "확인", cancel = "취소", danger = false } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const s = sheet({ title, label: title, closeText: cancel, cls: "u-confirm",
        html: `${msg ? `<div class="u-cf-body">${esc(msg)}</div>` : ""}${html}
          <div class="u-cf-acts"><button type="button" class="u-b u-o" data-u-close>${esc(cancel)}</button><button type="button" class="u-b ${danger ? "u-d" : "u-p"}" data-u-ok>${esc(ok)}</button></div>`,
        onClose: () => { if (!done) { done = true; resolve(false); } } });
      s.el.querySelector(".u-shh [data-u-close]").remove();   // 확인 창은 아래 단추 두 개로만
      s.el.querySelector("[data-u-ok]").addEventListener("click", () => { done = true; s.close("ok"); resolve(true); });
      setTimeout(() => s.el.querySelector("[data-u-ok]")?.focus(), 30);
    });
  }

  // ---------- 뼈대 로딩 ----------
  function skel(cards = 2, rows = 3) {
    let h = "";
    for (let c = 0; c < cards; c++) {
      h += `<div class="u-skc" aria-hidden="true"><i class="u-sk" style="height:18px;width:${40 + (c % 2) * 15}%"></i>`;
      for (let r = 0; r < rows; r++) h += `<i class="u-sk" style="height:${r ? 14 : 16}px;width:${r === rows - 1 ? 70 : 100}%"></i>`;
      h += `</div>`;
    }
    return `<div class="u-skw" role="status" aria-label="불러오는 중" style="display:flex;flex-direction:column;gap:12px">${h}</div>`;
  }

  // 저장 확인 (잠깐 '저장됨' 표시 후 원래대로)
  function saved(btn, text = "저장됨", ms = 1400) {
    if (!btn) return;
    const old = btn.innerHTML, w = btn.offsetWidth;
    btn.style.minWidth = w + "px";
    btn.innerHTML = `<span class="u-saved">${ICON.check}${esc(text)}</span>`;
    setTimeout(() => { btn.innerHTML = old; btn.style.minWidth = ""; }, ms);
  }

  // ---------- 선택 표시 이동 ----------
  //  세그먼트(.segbar · .u-seg): aria-pressed=true 버튼 밑으로 흰 칸이 움직여요
  function placeThumb(bar) {
    const th = bar.querySelector(":scope > .u-thumb"); if (!th) return;
    const on = bar.querySelector(':scope > button[aria-pressed="true"]');
    if (!on || !on.offsetWidth) { th.style.opacity = "0"; return; }
    th.style.opacity = "1";
    th.style.width = on.offsetWidth + "px";
    th.style.transform = `translateX(${on.offsetLeft}px)`;
  }
  function seg(bar) {
    if (!bar || bar.classList.contains("u-has-thumb")) return;
    const th = document.createElement("i"); th.className = "u-thumb"; th.setAttribute("aria-hidden", "true");
    bar.prepend(th); bar.classList.add("u-has-thumb");
    // 처음 자리는 모션 없이
    th.style.transition = "none"; placeThumb(bar); th.offsetWidth; th.style.transition = "";
    new MutationObserver(() => placeThumb(bar)).observe(bar, { subtree: true, attributes: true, attributeFilter: ["aria-pressed", "class", "hidden"], childList: true });
    segs.add(bar);
  }
  //  하단 탭: .on 버튼 칸 전체를 옅은 보라 칸이 덮고 움직여요
  function placeInd(box) {
    const ind = box.querySelector(":scope > .u-ind"); if (!ind) return;
    const on = box.querySelector(":scope > .on");
    if (!on || !on.offsetWidth) { ind.style.opacity = "0"; return; }
    ind.style.opacity = "1";
    ind.style.width = on.offsetWidth + "px";
    ind.style.transform = `translateX(${on.offsetLeft}px)`;
  }
  function ind(box) {
    if (!box || box.querySelector(":scope > .u-ind")) return;
    const el = document.createElement("span"); el.className = "u-ind"; el.setAttribute("aria-hidden", "true"); el.innerHTML = "<i></i>";
    box.prepend(el);
    el.style.transition = "none"; placeInd(box); el.offsetWidth; el.style.transition = "";
    new MutationObserver(() => placeInd(box)).observe(box, { subtree: true, attributes: true, attributeFilter: ["class"], childList: true });
    inds.add(box);
  }
  const segs = new Set(), inds = new Set();
  const replaceAll = () => { segs.forEach(placeThumb); inds.forEach(placeInd); };
  window.addEventListener("resize", replaceAll);
  // 보이지 않던 세그먼트가 보이게 되면 자리 다시 잡기
  document.addEventListener("transitionend", () => {}, { passive: true });
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(replaceAll);
    const watch = () => { segs.forEach((b) => ro.observe(b)); inds.forEach((b) => ro.observe(b)); };
    const _seg = seg, _ind = ind;
    seg = function (b) { _seg(b); watch(); };    // eslint-disable-line no-func-assign
    ind = function (b) { _ind(b); watch(); };    // eslint-disable-line no-func-assign
  }
  // 문서 안 모든 세그먼트에 자동으로 (뒤에 생기는 것 포함 · 악보 보기 안은 빼요)
  function scan(root = document) {
    root.querySelectorAll?.(".segbar, .u-seg").forEach((b) => { if (!b.closest(".cvv, .iv, .bk-live, .ivm")) seg(b); });
  }
  const boot = () => {
    scan();
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches?.(".segbar, .u-seg")) scan(n.parentNode); else if (n.querySelector?.(".segbar, .u-seg")) scan(n); } })
      .observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  window.UI = { sheet, confirm, leave, vt, skel, saved, seg: (b) => seg(b), ind: (b) => ind(b), place: replaceAll, reduced, esc, ICON };
})();
