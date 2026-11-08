// 031: 유튜브 영상 — 앱 안에서 바로 재생 (아래에서 올라오는 창 · 구간이 있으면 그 시작부터 끝에서 멈춤)
//  · data-play="영상ID" (data-ps 시작초 · data-pe 끝초 · data-pt 제목) 를 누르면 재생
//  · 그 밖에 화면 안의 유튜브 링크(youtu.be · youtube.com/watch · shorts · live)도 모두 앱 안에서 재생
//    (새 창으로 열고 싶으면 창 안의 '유튜브에서 열기' · 링크에 data-yt-ext를 달면 예외)
//  me.html · admin.html · share.html 이 불러요. window.YTP = { play, attrs, thumb, idOf }
(function () {
  if (window.YTP) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;
  const ID = /^[A-Za-z0-9_-]{11}$/;
  const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
  const attrs = (id, start, end, title) => `data-play="${esc(id)}" data-ps="${start || 0}"${end ? ` data-pe="${end}"` : ""}${title ? ` data-pt="${esc(title)}"` : ""}`;
  // 유튜브 주소 → { id, t }
  function idOf(href) {
    let u; try { u = new URL(href, location.href); } catch { return null; }
    const h = u.hostname.replace(/^www\.|^m\./, "");
    let id = null;
    if (h === "youtu.be") id = u.pathname.slice(1, 12);
    else if (/(^|\.)youtube(-nocookie)?\.com$/.test(h)) id = u.searchParams.get("v") || (u.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})/) || [])[1] || null;
    if (!id || !ID.test(id)) return null;
    const t = u.searchParams.get("t") || u.searchParams.get("start") || "";
    const m = String(t).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
    const sec = m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
    return { id, t: sec };
  }
  const X = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
  function play(id, start, end, title) {
    if (!ID.test(id || "")) return;
    document.querySelector(".ytp")?.remove();
    const q = new URLSearchParams({ autoplay: "1", playsinline: "1", rel: "0", modestbranding: "1" });
    if (start) q.set("start", String(Math.floor(start)));
    if (end && end > (start || 0)) q.set("end", String(Math.floor(end)));
    const w = document.createElement("div");
    w.className = "ytp"; w.setAttribute("role", "dialog"); w.setAttribute("aria-label", title || "영상");
    w.innerHTML = `<div class="ytp-back" data-ytp="x"></div><div class="ytp-box">
      <div class="ytp-hd"><b>${esc(title || "영상")}</b>${start || end ? `<span class="ytp-rg">${mmss(start || 0)}~${end ? mmss(end) : "끝"}</span>` : ""}
        <a class="ytp-ext" data-yt-ext href="https://youtu.be/${id}${start ? `?t=${Math.floor(start)}` : ""}" target="_blank" rel="noopener">유튜브에서 열기</a><button type="button" class="ytp-x" data-ytp="x" aria-label="닫기">${X}</button></div>
      <div class="ytp-fr"><iframe src="https://www.youtube-nocookie.com/embed/${id}?${q}" title="${esc(title || "영상")}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div></div>`;
    const close = () => { w.remove(); document.removeEventListener("keydown", key); };
    const key = (e) => { if (e.key === "Escape") close(); };
    w.addEventListener("click", (e) => { if (e.target.closest("[data-ytp=x]")) close(); });
    document.addEventListener("keydown", key);
    document.body.appendChild(w);
  }
  // 링크 글자가 '▶ 영상'처럼 짧으면 둘레에서 곡 이름을 찾아 제목으로
  function titleNear(a) {
    const own = (a.getAttribute("aria-label") || "").replace(/\s*(레퍼런스)?\s*\(새 창\)\s*$/, "").trim();
    if (own) return own;
    const row = a.closest("li, tr, .cv-sheet, .cv-ref, .hx-svc, .cv-song, .ce-row, section");
    const b = row?.querySelector("b, .song-name, .t");
    return (b?.textContent || a.textContent || "").replace(/^▶\s*/, "").trim().slice(0, 80);
  }
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const b = e.target.closest("[data-play]");
    if (b) { e.preventDefault(); e.stopPropagation(); return play(b.dataset.play, +b.dataset.ps || 0, +b.dataset.pe || null, b.dataset.pt || ""); }
    const a = e.target.closest("a[href]");
    if (!a || a.closest(".ytp") || a.hasAttribute("data-yt-ext")) return;
    const y = idOf(a.getAttribute("href")); if (!y) return;
    e.preventDefault(); e.stopPropagation();
    play(y.id, y.t, null, titleNear(a));
  }, true);
  window.YTP = { play, attrs, thumb, idOf };
})();
