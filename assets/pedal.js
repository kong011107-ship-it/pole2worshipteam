// =====================================================================
//  032: 블루투스 페달 · 키보드로 악보 넘기기 (콘티 악보 보기 · 백업찬양 진행 · 섬김이 링크 공통)
//  PEDAL.attach(el, turn) → 떼기 함수. turn(1) 다음 · turn(-1) 이전
//  · 페달은 기종 · 모드마다 보내는 키가 달라요: ← → ↑ ↓ · PageUp/Down · Space · Enter · 미디어 키
//    예전 iOS는 key 이름이 'UIKeyInputDownArrow'처럼 오고, 이름이 비면 keyCode로 봐요
//  · 아이폰 · 아이패드는 화면 안에 포커스가 없으면 키가 페이지에 안 들어올 때가 있어서
//    악보 화면에 포커스를 잡아 두고, 다른 곳을 누른 뒤에도 다시 잡아요 (입력 칸을 쓰는 중이면 그대로)
//  · 페달을 누르고 있으면 오는 반복 키 · 한 번에 두 번 오는 키는 한 번만 넘겨요
// =====================================================================
(function () {
  const NEXT = new Set(["ArrowRight", "ArrowDown", "PageDown", "Enter", "MediaTrackNext", "MediaNextTrack",
    "UIKeyInputRightArrow", "UIKeyInputDownArrow", "UIKeyInputPageDown", "Right", "Down"]);
  const PREV = new Set(["ArrowLeft", "ArrowUp", "PageUp", "MediaTrackPrevious", "MediaPreviousTrack",
    "UIKeyInputLeftArrow", "UIKeyInputUpArrow", "UIKeyInputPageUp", "Left", "Up"]);
  const CODES = { 39: 1, 40: 1, 34: 1, 32: 1, 13: 1, 176: 1, 37: -1, 38: -1, 33: -1, 177: -1 };
  const field = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
  const pressable = (t) => !!t?.closest?.("button, a[href], summary, [role=button]");

  function dir(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return 0;
    const k = e.key;
    if (k === " " || k === "Spacebar") return e.shiftKey ? -1 : 1;
    if (NEXT.has(k)) return 1;
    if (PREV.has(k)) return -1;
    if (!k || k === "Unidentified") return CODES[e.keyCode || e.which] || 0;
    return 0;
  }

  function attach(el, turn) {
    let last = 0;
    if (!el.hasAttribute("tabindex")) el.tabIndex = -1;
    el.classList.add("pedal-host");
    const grab = () => {
      if (!document.body.contains(el)) return;
      const a = document.activeElement;
      if (field(a) || a?.tagName === "IFRAME" || a === el) return;
      try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch {} }
    };
    const onKey = (e) => {
      if (!document.body.contains(el) || e.defaultPrevented) return;
      if (field(e.target) || document.querySelector(".ytp")) return;
      const d = dir(e); if (!d) return;
      // 단추에 포커스가 있을 때 Enter · Space는 그 단추를 누르는 키예요
      if ((e.key === "Enter" || e.key === " ") && e.target !== el && pressable(e.target)) return;
      e.preventDefault();
      const t = Date.now();
      if (e.repeat || t - last < 160) return;
      last = t;
      turn(d);
    };
    const onUp = () => setTimeout(grab, 0);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerup", onUp, true);
    window.addEventListener("focus", onUp);
    grab();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("focus", onUp);
    };
  }

  window.PEDAL = { attach, dir };
})();
