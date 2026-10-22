// =====================================================================
//  찬양 기록 (021) — 통계 · 곡 · 콘티 · 라인업
//  DB(songs · setlists · setlist_items · lineup_history)를 history_bundle()로 한 번에 읽고,
//  화면에서 통계를 계산해요. 팀원(찬양 탭)과 리더십(찬양 › 기록)이 같은 화면을 써요.
//  HISTORY.mount(root, { admin, tab })  ·  HISTORY.load(force)  ·  HISTORY.reset()
// =====================================================================
(function () {
  const POS_LABEL = { leader: "인도", singer: "싱어", key_main: "메인", key_second: "세컨", e_guitar: "일렉", acoustic: "어쿠스틱", bass: "베이스", drum: "드럼" };
  const POS_ORDER = ["메인", "세컨", "일렉", "어쿠스틱", "베이스", "드럼", "싱어"];
  const POSS = ["인도", "싱어", "메인", "세컨", "일렉", "어쿠스틱", "베이스", "드럼"];
  const untitle = (n) => String(n || "").replace(/\s*(목사님|전도사님|목사|전도사)$/, "");
  const startKey = (k) => (k || "").split(/[-~>]/)[0];
  const today = () => (window.todayISO ? todayISO() : new Date().toISOString().slice(0, 10));
  const dayDiff = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
  const minusDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map((x) => x[0]);

  // ------------------------------------------------------------------ 데이터 만들기
  function build(raw) {
    const T = today();
    const st = {}; (raw.songs || []).forEach((s) => (st[s.id] = s.title));
    const mainKey = {}; (raw.songs || []).forEach((s) => (mainKey[s.id] = s.main_key));
    const svc = {}, plays = [], sids = {};
    (raw.setlists || []).forEach((sl) => {
      svc[sl.d] = [sl.leaders || [], sl.note || ""];
      // 025: 플랫폼 콘티 — 그 예배 · 고칠 수 있는지 (콘티 e · 악보 es)
      if (sl.sid) sids[sl.d] = { sid: sl.sid, e: !!sl.e, es: !!sl.es };
      (sl.items || []).forEach(([ord, sid, key, medley, refs, bpm]) => plays.push([sl.d, ord, sid, st[sid] || "", key || "", refs || [], medley ? 1 : 0, bpm || null]));
    });
    // 025: 적용찬양 [id, 날짜, 곡 이름, 키, 사진, 묶음 이름, 예배, 사역 이름]
    const applied = (raw.applied || []).map(([id, d, title, key, images, norm, sid, min]) => ({ id, date: d, title, key: key || "", images: images || [], norm: norm || "", sid, min: min || "" }));
    const lrows = {};
    (raw.lineup || []).forEach(([d, pos, slot, name, guest]) => { (lrows[d] = lrows[d] || []).push({ pos, slot, name, guest }); if (!svc[d]) svc[d] = [[], ""]; });
    const DATES = Object.keys(svc).sort();
    const CD = [...new Set(plays.map((p) => p[0]))].sort();

    // 곡
    const G = new Map();
    plays.forEach(([d, , sid, , key, refs]) => {
      const g = G.get(sid) || { sid, dates: new Set(), keys: {}, leads: {}, refs: new Map() };
      if (!g.dates.has(d)) { g.dates.add(d); svc[d][0].forEach((n) => (g.leads[n] = (g.leads[n] || 0) + 1)); }
      if (key) g.keys[key] = (g.keys[key] || 0) + 1;
      refs.forEach(([id, t, note]) => {
        const r = g.refs.get(id) || { id, n: 0, note: "", t: 0, last: "" };
        r.n++; if (d > r.last) r.last = d; if (t && !r.t) r.t = t; if (note) r.note = note;
        g.refs.set(id, r);
      });
      G.set(sid, g);
    });
    const ytSongs = {};
    G.forEach((g) => g.refs.forEach((r) => { (ytSongs[r.id] = ytSongs[r.id] || new Set()).add(g.sid); }));
    const songs = [...G.values()].map((g) => {
      const ds = [...g.dates].sort();
      const refs = [...g.refs.values()].sort((a, b) => b.n - a.n || b.last.localeCompare(a.last));
      return {
        id: g.sid, title: st[g.sid], count: ds.length, first: ds[0], last: ds[ds.length - 1],
        days_since: dayDiff(ds[ds.length - 1], T), last12: ds.filter((d) => dayDiff(d, T) <= 365).length,
        key_main: mainKey[g.sid] || top(g.keys, 1)[0] || "", keys: top(g.keys, 9).join(" · "), leaders: top(g.leads, 3).join(" · "),
        link: refs[0]?.id || "", refs: refs.map((r) => [r.id, r.n, r.note, r.t, r.last]),
      };
    }).sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, "ko"));
    const firstOf = {}; songs.forEach((s) => (firstOf[s.id] = s.first));

    const years = [...new Set(DATES.map((d) => d.slice(0, 4)))].map((y) => {
      const ps = plays.filter((p) => p[0].slice(0, 4) === y), cd = CD.filter((d) => d.slice(0, 4) === y);
      const uniq = new Set(ps.map((p) => p[2]));
      return { year: y, unique: uniq.size, new: [...uniq].filter((s) => firstOf[s].slice(0, 4) === y).length, songs: ps.length,
        services: cd.length, all: DATES.filter((d) => d.slice(0, 4) === y).length, avg: cd.length ? Math.round(10 * ps.length / cd.length) / 10 : 0 };
    });
    const kc = {}; plays.forEach((p) => { const k = startKey(p[4]); if (k) kc[k] = (kc[k] || 0) + 1; });
    const keys = Object.entries(kc).sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, plays: n }));
    const L = {};
    DATES.forEach((d) => svc[d][0].forEach((n) => { (L[n] = L[n] || []).push(d); }));
    const leaders = Object.entries(L).map(([leader, ds]) => {
      const sc = {}; plays.filter((p) => ds.includes(p[0])).forEach((p) => (sc[p[2]] = (sc[p[2]] || 0) + 1));
      return { leader, services: ds.length, first: ds[0], last: ds[ds.length - 1], unique: Object.keys(sc).length, top: top(sc, 3).map((s) => st[s]).join(" · ") };
    }).sort((a, b) => b.services - a.services);

    // 라인업
    const list = DATES.map((d) => {
      const rows = (lrows[d] || []).slice().sort((a, b) => a.slot - b.slot);
      const lead = rows.filter((r) => r.pos === "leader").map((r) => r.name);
      return { date: d, note: svc[d][1], lead: rows.length ? lead : svc[d][0].map(untitle),
        people: rows.filter((r) => r.pos !== "leader").map((r) => [r.name, POS_LABEL[r.pos] || r.pos, r.guest]), partial: !rows.length };
    });
    const LTO = DATES[DATES.length - 1], cut = minusDays(LTO, 364);
    const PP = new Map();
    list.forEach((l) => {
      const mine = new Map();
      l.people.forEach(([n, p, g]) => { const m = mine.get(n) || { pos: new Set(), g: true }; m.pos.add(p); m.g = m.g && g; mine.set(n, m); });
      l.lead.forEach((n) => { const m = mine.get(n) || { pos: new Set(), g: false }; m.pos.add("인도"); m.g = false; mine.set(n, m); });
      mine.forEach((m, n) => {
        const R = PP.get(n) || { name: n, total: 0, y1: 0, first: l.date, last: l.date, gN: 0 };
        R.total++; R.last = l.date; if (m.g) R.gN++; if (l.date > cut) R.y1++;
        PP.set(n, R);
      });
    });
    const people = [...PP.values()].map((r) => ({ ...r, guest: r.gN === r.total })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ko"));
    const lyears = {}; DATES.forEach((d) => (lyears[d.slice(0, 4)] = (lyears[d.slice(0, 4)] || 0) + 1));

    return {
      summary: { services: DATES.length, conti: CD.length, plays: plays.length, unique: songs.length, once: songs.filter((s) => s.count === 1).length,
        avg: CD.length ? Math.round(100 * plays.length / CD.length) / 100 : 0, from: DATES[0], to: LTO, lineup: list.filter((l) => !l.partial).length },
      songs, plays, years, keys, leaders, st, svc, sids, applied, multi: Object.keys(ytSongs).filter((id) => ytSongs[id].size > 1),
      lineup: { services: DATES.length, from: DATES[0], to: LTO, years: lyears, list, people },
    };
  }

  let cache = null, loading = null;
  async function load(force = false) {
    if (cache && !force) return cache;
    if (loading && !force) return loading;
    loading = (async () => {
      const { data, error } = await sb.rpc("history_bundle");
      if (error) throw new Error("기록을 불러오지 못했어요");
      cache = build(data || {});
      loading = null;
      return cache;
    })();
    return loading;
  }

  // ------------------------------------------------------------------ 화면
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const dot = (s) => (s ? s.replace(/-/g, ".") : "");
  const fmt = (n) => Number(n).toLocaleString("ko-KR");
  const mmss = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  const yt = (id, t, label, cls) => { if (!/^[A-Za-z0-9_-]{11}$/.test(id || "")) return null; const a = el("a", cls || "hx-yt", label || "▶ 영상"); a.href = `https://youtu.be/${id}` + (t ? `?t=${t}` : ""); a.target = "_blank"; a.rel = "noopener"; return a; };
  const WD = ["일", "월", "화", "수", "목", "금", "토"];
  const TABS = [["ov", "통계"], ["lib", "곡"], ["his", "콘티"], ["app", "적용찬양"], ["lin", "라인업"]];
  const state = { tab: "ov" };

  async function mount(root, opts = {}) {
    if (opts.tab) state.tab = opts.tab;
    root.innerHTML = `<div class="hx ${opts.admin ? "adm" : ""}"><div class="empty">기록을 불러오는 중…</div></div>`;
    let D;
    try { D = await load(); } catch (e) { root.innerHTML = `<div class="hx"><div class="empty">${esc(e.message)}</div></div>`; return; }
    if (!D.summary.services) { root.innerHTML = `<div class="hx"><div class="empty">아직 기록이 없어요.</div></div>`; return; }
    const H = root.querySelector(".hx");
    H.innerHTML = `
      <div class="tabs hx-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-hx="${k}" aria-selected="${state.tab === k}">${l}</button>`).join("")}</div>
      <section data-page="ov"></section><section data-page="lib" hidden></section><section data-page="his" hidden></section><section data-page="app" hidden></section><section data-page="lin" hidden></section>
      <p class="hx-foot">카카오톡 콘티방(${dot(D.summary.from).slice(0, 7)} ~) 기록에서 정리 · 모든 기록은 그 주의 주일 날짜로 맞춤 · 주일 ${D.summary.services}번 중 콘티 ${D.summary.conti}번 · 라인업 ${D.summary.lineup}번</p>`;
    const $ = (s) => H.querySelector(s);
    const pages = {};
    const show = (k) => {
      state.tab = k;
      H.querySelectorAll("[data-hx]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.hx === k)));
      H.querySelectorAll("[data-page]").forEach((s) => (s.hidden = s.dataset.page !== k));
      if (!pages[k]) { pages[k] = true; ({ ov: drawOv, lib: drawLib, his: drawHis, app: drawApp, lin: drawLin })[k](H.querySelector(`[data-page="${k}"]`), D); }
      try { sessionStorage.setItem("pole2.hx", k); } catch {}
    };
    H.querySelector(".hx-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-hx]"); if (b) { show(b.dataset.hx); H.scrollIntoView({ block: "start" }); } });
    // 025: 지난 예배 콘티 보기 · 고치기 (리더십 · 그 예배 인도자 · 밴드 마스터 · 밴드는 악보만) — 고치면 기록을 다시 불러옴
    H.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-hxc]"); if (!b || !window.CONTI) return;
      const sid = b.dataset.sid, a = b.dataset.hxc;
      const remount = () => { cache = null; mount(root, { ...opts, tab: state.tab }); };
      if (a === "view") { try { CONTI.openViewer(await CONTI.loadOne(sid), {}); } catch (err) { toast(err.message, 3500); } return; }
      if (a === "edit") return CONTI.openEditor(sid, { after: remount });
      if (a === "applied") { try { CONTI.openApplied(await CONTI.loadOne(sid), { after: remount }); } catch (err) { toast(err.message, 3500); } return; }
    });
    if (!opts.tab) { try { const k = sessionStorage.getItem("pole2.hx"); if (TABS.some((t) => t[0] === k)) state.tab = k; } catch {} }
    show(state.tab);
  }

  // ---------- 공통 조각
  const MULTI = (D) => new Set(D.multi);
  function songRow(D, s, compact) {
    const r = el("div", "hx-song");
    r.append(el("div", "t", s.title));
    const m = el("div", "meta");
    if (s.key_main) m.append(el("span", "chip chip-violet", s.key_main));
    if (!compact && s.keys && s.keys !== s.key_main) m.append(el("span", null, "쓴 키 " + s.keys));
    m.append(el("span", null, `마지막 ${dot(s.last)}`));
    if (!compact && s.leaders) m.append(el("span", null, s.leaders));
    r.append(m);
    const right = el("div", "r"); right.append(el("span", "n", `${s.count}번`));
    const main = s.refs.find((x) => x[0] === s.link);
    const a = yt(s.link, main && main[3]); if (a) right.append(a);
    r.append(right);
    return r;
  }
  const segOf = (items) => { const s = el("div", "hx-seg"); items.forEach(([v, t]) => { const b = el("button", null, t); b.type = "button"; b.dataset.v = v; b.setAttribute("aria-pressed", "false"); s.append(b); }); return s; };
  const press = (box, f) => box.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(f(b.dataset.v))));
  const row = (label, ...kids) => { const r = el("div", "hx-fr"); r.append(el("span", "hx-fl", label), ...kids); return r; };
  const card = (title, note) => { const c = el("div", "hx-card"); const h = el("div", "hx-ch"); h.append(el("h2", null, title)); c.append(h); if (note) c.append(el("p", "hx-note", note)); return c; };
  // 휴대폰에서는 조건 패널을 접어 둠
  function foldable(f) {
    const t = el("button", "hx-ftog"); t.type = "button";
    const set = (open) => { f.classList.toggle("closed", !open); t.textContent = open ? "조건 접기 ▴" : "조건 설정 ▾"; t.setAttribute("aria-expanded", String(open)); };
    t.addEventListener("click", () => set(f.classList.contains("closed")));
    f.before(t); set(window.innerWidth > 640);
  }

  // ---------- 통계
  function drawOv(P, D) {
    const S = D.summary, first = D.songs[0];
    const hero = el("div", "hx-hero");
    hero.innerHTML = `<p class="eyebrow">${dot(S.from)} ~ ${dot(S.to)}</p><div class="big">주일 ${fmt(S.services)}번, ${fmt(S.unique)}곡을 불렀어요</div>
      <p class="sub">가장 많이 부른 곡은 「${esc(first.title)}」(${first.count}번). ${fmt(S.once)}곡은 딱 한 번만 불렀어요. 콘티가 남은 주일은 ${S.conti}번이에요.</p>
      <div class="hx-stats">${[["주일", fmt(S.services)], ["부른 곡", fmt(S.plays)], ["곡 종류", fmt(S.unique)], ["주일당 평균", S.avg + "곡"]].map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join("")}</div>`;
    const hbar = (box, rows, lab, val, hiN) => {
      const max = Math.max(...rows.map((r) => r[val]));
      rows.forEach((r, i) => { const t = el("div", "t"), b = el("i", i < hiN ? "hi" : ""); b.style.width = (100 * r[val] / max) + "%"; t.append(b); const l = el("div", "l", r[lab]); l.title = r[lab]; box.append(l, t, el("div", "v", fmt(r[val]))); });
    };
    const g1 = el("div", "hx-grid");
    const c1 = card("가장 많이 부른 곡", "전체 기간 · 부른 주일 수"); const hb1 = el("div", "hx-hb"); hbar(hb1, D.songs.slice(0, 15), "title", "count", 3); c1.append(hb1);
    const c2 = card("해마다 부른 곡", `${D.years[0].year}년은 ${+D.summary.from.slice(5, 7)}월부터, ${D.years[D.years.length - 1].year}년은 ${+D.summary.to.slice(5, 7)}월까지`);
    c2.insertAdjacentHTML("beforeend", `<div class="hx-legend"><span><i style="background:var(--violet-soft)"></i>부른 곡 종류</span><span><i style="background:var(--violet)"></i>새로 부른 곡</span></div>`);
    const yb = el("div", "hx-years"); yb.style.gridTemplateColumns = `repeat(${D.years.length}, minmax(0, 1fr))`;
    const ymax = Math.max(...D.years.map((y) => y.unique));
    D.years.forEach((y) => {
      const c = el("div", "yr"), bars = el("div", "bars");
      [["", y.unique], ["n", y.new]].forEach(([cls, v]) => { const i = el("i", cls); i.style.height = (130 * v / ymax) + "px"; i.append(el("em", null, v)); bars.append(i); });
      c.title = `${y.year}년 · 주일 ${y.all}번 (콘티 ${y.services}번) · 주일당 ${y.avg}곡`;
      c.append(bars, el("div", "y", y.year)); yb.append(c);
    });
    c2.append(yb); g1.append(c1, c2);
    const g2 = el("div", "hx-grid");
    const c3 = card("키 분포", "곡을 부른 횟수 · 전조는 시작 키로 셈"); const hb3 = el("div", "hx-hb"); hbar(hb3, D.keys.filter((k) => k.plays >= 4), "key", "plays", 3); c3.append(hb3);
    const c4 = card("한동안 안 부른 단골곡", "5번 이상 불렀지만 1년 넘게 안 부른 곡");
    const dorm = D.songs.filter((s) => s.count >= 5 && s.days_since > 365).sort((a, b) => b.count - a.count);
    const dl = el("div", "hx-list"), dm = el("button", "hx-more", "전체 보기"); dm.type = "button";
    const dd = (n) => { dl.replaceChildren(...dorm.slice(0, n).map((s) => songRow(D, s, true))); dm.hidden = dorm.length <= n; if (!dorm.length) dl.append(el("p", "muted small", "없어요")); };
    dm.addEventListener("click", () => dd(dorm.length)); dd(8); c4.append(dl, dm); g2.append(c3, c4);
    const c5 = card("인도자별", "인도 횟수는 전체 주일 기준 · 곡 종류는 콘티 기준 · 함께 인도하면 각각 셈");
    const tb = el("table", "hx-lead");
    tb.innerHTML = `<thead><tr><th>인도자</th><th class="n">인도</th><th class="n">곡 종류</th><th class="wide">자주 고른 곡</th><th class="wide">기간</th></tr></thead>`;
    const body = el("tbody");
    D.leaders.forEach((l) => { const tr = el("tr"); [[l.leader], [l.services, "n"], [l.unique, "n"], [l.top, "wide muted small"], [`${dot(l.first).slice(2)} ~ ${dot(l.last).slice(2)}`, "wide muted small"]].forEach(([v, c]) => tr.append(el("td", c, v))); body.append(tr); });
    tb.append(body); c5.append(tb);
    P.append(hero, g1, g2, c5);
  }

  // ---------- 곡 · 콘티 공통: 주일 조건
  function ctx(D) {
    const P = D.plays.map((p) => ({ date: p[0], order: p[1], sid: p[2], title: p[3], key: p[4], refs: p[5], medley: !!p[6], bpm: p[7] }));
    const SV = D.svc, DATES = Object.keys(SV).sort();
    const KEYS = Object.entries(P.reduce((a, p) => { const k = startKey(p.key); if (k) a[k] = (a[k] || 0) + 1; return a; }, {})).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
    const LEADS = Object.entries(DATES.reduce((a, d) => { SV[d][0].forEach((n) => { a[n] = (a[n] || 0) + 1; }); return a; }, {})).sort((a, b) => b[1] - a[1]);
    return { P, SV, DATES, CDS: new Set(P.map((p) => p.date)), FIRST: DATES[0], LASTD: DATES[DATES.length - 1], YEARS: [...new Set(DATES.map((d) => d.slice(0, 4)))], KEYS, LEADS, ST: D.st };
  }
  function svcFilter(C, box, redraw) {
    const F = { per: "all", years: [], from: "", to: "", lead: "", kind: "all" };
    const per = segOf([["all", "전체"], ["y1", "최근 1년"], ["m6", "최근 6개월"], ["m3", "최근 3개월"]]);
    const yrs = segOf(C.YEARS.map((y) => [y, y + "년"]));
    const dates = el("span", "hx-dates"), from = el("input"), to = el("input");
    [from, to].forEach((i) => { i.type = "date"; i.min = C.FIRST; i.max = C.LASTD; });
    from.setAttribute("aria-label", "시작일"); to.setAttribute("aria-label", "종료일");
    dates.append(from, document.createTextNode(" ~ "), to);
    const lead = el("select", "hx-sel"); lead.append(new Option("누구든", ""));
    C.LEADS.forEach(([n, c]) => lead.append(new Option(`${n} (${c})`, n)));
    lead.setAttribute("aria-label", "인도자");
    const kind = segOf([["all", "전체"], ["sun", "주일만"], ["special", "특별예배만"]]);
    box.append(row("기간", per, yrs, dates), row("인도자", lead, el("span", "hx-fl", "예배"), kind));
    const shift = (days) => minusDays(C.LASTD, days);
    const sync = () => {
      press(per, (v) => !F.years.length && !F.from && !F.to && v === F.per); press(yrs, (v) => F.years.includes(v)); press(kind, (v) => v === F.kind);
      lead.value = F.lead; if (document.activeElement !== from) from.value = F.from; if (document.activeElement !== to) to.value = F.to;
    };
    per.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; F.per = b.dataset.v; F.years = []; F.from = F.to = ""; redraw(); });
    yrs.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; const v = b.dataset.v; F.years = F.years.includes(v) ? F.years.filter((x) => x !== v) : [...F.years, v].sort(); F.per = "all"; F.from = F.to = ""; redraw(); });
    kind.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; F.kind = b.dataset.v; redraw(); });
    lead.addEventListener("change", () => { F.lead = lead.value; redraw(); });
    [[from, "from"], [to, "to"]].forEach(([i, k]) => { i.addEventListener("change", () => { if (i.value && !i.validity.valid) return; F[k] = i.value; F.years = []; F.per = "all"; redraw(); }); i.addEventListener("blur", sync); });
    return {
      F, sync,
      reset() { Object.assign(F, { per: "all", years: [], from: "", to: "", lead: "", kind: "all" }); },
      ok(d) {
        if (F.years.length && !F.years.includes(d.slice(0, 4))) return false;
        if (F.from && d < F.from) return false;
        if (F.to && d > F.to) return false;
        if (!F.years.length && !F.from && !F.to && F.per !== "all" && d <= shift({ y1: 365, m6: 182, m3: 91 }[F.per])) return false;
        const sv = C.SV[d] || [[], ""];
        if (F.lead && !sv[0].includes(F.lead)) return false;
        if (F.kind === "sun" && sv[1]) return false;
        if (F.kind === "special" && !sv[1]) return false;
        return true;
      },
      describe() {
        const c = [];
        if (F.years.length) c.push(F.years.join("·") + "년");
        else if (F.from || F.to) c.push(`${F.from ? dot(F.from) : "처음"} ~ ${F.to ? dot(F.to) : "지금"}`);
        else c.push({ all: "전체 기간", y1: "최근 1년", m6: "최근 6개월", m3: "최근 3개월" }[F.per]);
        if (F.lead) c.push(`${F.lead} 인도`);
        if (F.kind !== "all") c.push(F.kind === "sun" ? "주일만" : "특별예배만");
        return c;
      },
    };
  }
  const bucketsOf = (dates) => {
    const monthly = dates.length && dates[0].slice(0, 4) === dates[dates.length - 1].slice(0, 4);
    const kf = (d) => (monthly ? d.slice(0, 7) : d.slice(0, 4));
    const tot = {}; dates.forEach((d) => { tot[kf(d)] = (tot[kf(d)] || 0) + 1; });
    return { monthly, kf, keys: Object.keys(tot).sort(), tot };
  };
  const cells = (B, counts) => {
    const ys = el("span", "hx-yrs" + (B.monthly ? " mo" : ""));
    B.keys.forEach((k) => {
      const b = el("b"), c = counts[k] || 0, sp = el("span", null, c || "·");
      sp.style.background = c ? `rgba(106, 43, 201, ${Math.min(0.12 + c / Math.max(B.tot[k], 1) * 1.6, 0.6)})` : "transparent";
      b.title = `${k} · 주일 ${B.tot[k]}번 중 ${c}번`;
      b.append(sp, document.createTextNode(B.monthly ? `${+k.slice(5)}` : `'${k.slice(2)}`)); ys.append(b);
    });
    return ys;
  };
  const cntText = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n || 99).map(([k, v]) => `${k} ${v}`).join(" · ");
  const splitQ = (v) => v.split(",").map((x) => x.trim().toLowerCase().replace(/\s/g, "")).filter(Boolean);

  // ---------- 곡
  function drawLib(Pg, D) {
    const C = ctx(D), MU = MULTI(D);
    const c = card("곡", "콘티가 남은 주일 중 조건에 맞는 날만 세요 · 같은 날 두 번 불러도 1번");
    const flt = el("div", "hx-flt"), sum = el("div", "hx-fsum"), list = el("div", "hx-list"), more = el("button", "hx-more", "더 보기"); more.type = "button";
    c.append(flt, sum, list, more); Pg.append(c);
    const LS = svcFilter(C, flt, () => draw());
    const keys = segOf(C.KEYS.map((k) => [k, k])), cnt = segOf([["all", "전체"], ["1", "한 번만"], ["2", "2번 이상"], ["5", "5번 이상"]]);
    const med = segOf([["all", "전체"], ["solo", "단독으로"], ["medley", "메들리로"]]);
    const sort = segOf([["n", "많이 부른 순"], ["last", "최근에 부른 순"], ["old", "오래 안 부른 순"], ["first", "처음 부른 순"], ["name", "가나다 순"]]);
    const q = el("input", "hx-search"); q.type = "search"; q.placeholder = "곡 이름 (쉼표로 여러 곡)"; q.setAttribute("aria-label", "곡 이름");
    const reset = el("button", "hx-reset", "조건 초기화"); reset.type = "button";
    flt.append(row("키", keys, el("span", "hx-hint", "시작 키 기준 · 여러 개 고를 수 있어요")), row("곡", q, med), row("횟수", cnt), row("정렬", sort, reset));
    foldable(flt);
    const LF = { keys: [], cnt: "all", med: "all", sort: "n" };
    keys.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; const v = b.dataset.v; LF.keys = LF.keys.includes(v) ? LF.keys.filter((x) => x !== v) : [...LF.keys, v]; draw(); });
    [[cnt, "cnt"], [med, "med"], [sort, "sort"]].forEach(([s, k]) => s.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; LF[k] = b.dataset.v; draw(); }));
    q.addEventListener("input", () => draw());
    reset.addEventListener("click", () => { LS.reset(); Object.assign(LF, { keys: [], cnt: "all", med: "all", sort: "n" }); q.value = ""; draw(); });
    let lim = 40;
    more.addEventListener("click", () => { lim += 60; draw(true); });
    function draw(keep) {
      if (!keep) lim = 40;
      LS.sync(); press(keys, (v) => LF.keys.includes(v)); press(cnt, (v) => v === LF.cnt); press(med, (v) => v === LF.med); press(sort, (v) => v === LF.sort);
      const sdates = C.DATES.filter((d) => C.CDS.has(d) && LS.ok(d)), okD = new Set(sdates), qs = splitQ(q.value);
      const plays = C.P.filter((p) => okD.has(p.date) && (!LF.keys.length || LF.keys.includes(startKey(p.key))) && (LF.med === "all" || (LF.med === "medley") === p.medley)
        && (!qs.length || qs.some((x) => (C.ST[p.sid] || "").toLowerCase().replace(/\s/g, "").includes(x))));
      const B = bucketsOf(sdates), G = new Map();
      plays.forEach((p) => {
        const g = G.get(p.sid) || { sid: p.sid, title: C.ST[p.sid] || p.title, dates: new Set(), keys: {}, leads: {}, b: {}, refs: new Map(), first: p.date, last: p.date, log: [] };
        if (!g.dates.has(p.date)) { g.dates.add(p.date); g.b[B.kf(p.date)] = (g.b[B.kf(p.date)] || 0) + 1; C.SV[p.date][0].forEach((n) => { g.leads[n] = (g.leads[n] || 0) + 1; }); }
        if (p.key) g.keys[p.key] = (g.keys[p.key] || 0) + 1;
        if (p.date < g.first) g.first = p.date; if (p.date > g.last) g.last = p.date;
        p.refs.forEach(([id, t, note]) => { const r = g.refs.get(id) || { id, n: 0, keys: {}, last: "", t: 0, notes: new Set() }; r.n++; if (p.key) r.keys[p.key] = (r.keys[p.key] || 0) + 1; if (p.date > r.last) r.last = p.date; if (t && !r.t) r.t = t; if (note) r.notes.add(note); g.refs.set(id, r); });
        g.log.push(p); G.set(p.sid, g);
      });
      let rows = [...G.values()].map((g) => ({ ...g, n: g.dates.size }));
      if (LF.cnt === "1") rows = rows.filter((g) => g.n === 1);
      if (LF.cnt === "2") rows = rows.filter((g) => g.n >= 2);
      if (LF.cnt === "5") rows = rows.filter((g) => g.n >= 5);
      const cmp = { n: (a, b) => b.n - a.n || b.last.localeCompare(a.last), last: (a, b) => b.last.localeCompare(a.last), old: (a, b) => a.last.localeCompare(b.last), first: (a, b) => a.first.localeCompare(b.first), name: (a, b) => a.title.localeCompare(b.title, "ko") }[LF.sort];
      rows.sort((a, b) => cmp(a, b) || a.title.localeCompare(b.title, "ko"));
      const cond = LS.describe();
      if (LF.keys.length) cond.push(LF.keys.join("·") + " 키");
      if (LF.med !== "all") cond.push(LF.med === "solo" ? "단독" : "메들리");
      if (qs.length) cond.push(`'${q.value.trim()}'`);
      if (LF.cnt !== "all") cond.push({ 1: "한 번만", 2: "2번 이상", 5: "5번 이상" }[LF.cnt]);
      sum.replaceChildren(el("b", null, cond.join(" · ")), el("span", null, `콘티 있는 주일 ${sdates.length}번 · ${rows.length}곡 · 총 ${fmt(rows.reduce((a, g) => a + g.n, 0))}번`));
      if (sdates.length) sum.append(el("span", "muted", `${dot(sdates[0])} ~ ${dot(sdates[sdates.length - 1])}`));
      const max = Math.max(1, ...rows.map((g) => g.n));
      list.replaceChildren(...(rows.length ? rows.slice(0, lim).map((g) => songCard(C, MU, g, sdates.length, max, B)) : [el("p", "muted", "조건에 맞는 곡이 없어요.")]));
      more.hidden = rows.length <= lim;
    }
    draw();
  }
  function songCard(C, MU, g, nsvc, max, B) {
    const r = el("div", "hx-sc"), head = el("div", "hx-sch");
    head.append(el("div", "t", g.title));
    const tot = el("div", "tot"); tot.append(el("span", null, `${g.n}번`), el("small", null, nsvc ? `주일의 ${Math.round(100 * g.n / nsvc)}%` : ""));
    head.append(tot); r.append(head);
    const tr = el("div", "hx-tr"), bi = el("i"); bi.style.width = (100 * g.n / max) + "%"; tr.append(bi); r.append(tr);
    const kv = el("div", "hx-kv");
    const kk = el("span"); kk.append(el("em", null, "키"));
    Object.entries(g.keys).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => kk.append(el("span", "chip chip-violet", `${k} ${n}`)));
    if (!Object.keys(g.keys).length) kk.append(el("span", "chip chip-gray", "기록 없음"));
    const ll = el("span"); ll.append(el("em", null, "인도"), document.createTextNode(" " + (cntText(g.leads, 4) || "-")));
    kv.append(kk, ll); r.append(kv);
    const sub = el("div", "hx-sub"); sub.append(cells(B, g.b), el("span", null, `${dot(g.first).slice(2)} ~ ${dot(g.last).slice(2)}`)); r.append(sub);
    const refs = [...g.refs.values()].sort((a, b) => b.n - a.n || b.last.localeCompare(a.last));
    if (refs.length) {
      const det = el("details", "hx-refs"); det.append(el("summary", null, `레퍼런스 ${refs.length}개`));
      const ul = el("ul");
      refs.forEach((x, i) => {
        const li = el("li"); const lk = yt(x.id, x.t, `영상 ${i + 1}`, "hx-rl"); if (lk) li.append(lk);
        Object.entries(x.keys).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => li.append(el("span", "chip chip-violet", `${k}${n > 1 ? " ×" + n : ""}`)));
        const info = [`${x.n}번 사용`, `마지막 ${dot(x.last).slice(2)}`];
        if (x.t) info.push(`${mmss(x.t)}부터`);
        if (x.notes.size) info.push([...x.notes].join(" · "));
        if (MU.has(x.id) && !x.notes.has("메들리")) info.push("여러 곡이 담긴 영상");
        li.append(el("span", "muted small", info.join(" · "))); ul.append(li);
      });
      det.append(ul); r.append(det);
    }
    const det2 = el("details", "hx-refs"); det2.append(el("summary", null, `부른 기록 ${g.dates.size}번`));
    const ul2 = el("ul");
    g.log.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach((p) => {
      const li = el("li"); li.append(el("b", null, dot(p.date).slice(2)));
      if (p.key) li.append(el("span", "chip chip-violet", p.key));
      li.append(el("span", "muted small", (C.SV[p.date][0].join(" · ") || "") + (C.SV[p.date][1] ? ` · ${C.SV[p.date][1]}` : "") + (p.medley ? " · 메들리" : "")));
      p.refs.slice(0, 3).forEach((rf, i) => { const a = yt(rf[0], rf[1], p.refs.length > 1 ? `▶${i + 1}` : "▶", "hx-yt"); if (a) li.append(a); });
      ul2.append(li);
    });
    det2.append(ul2); r.append(det2);
    return r;
  }

  // ---------- 콘티
  function lineupLine(l) {
    const box = el("div", "hx-lu"), grp = {};
    l.people.forEach(([n, p, g]) => { (grp[p] = grp[p] || []).push(n + (g ? "(객원)" : "")); });
    POS_ORDER.filter((p) => grp[p]).forEach((p) => { const sp = el("span"); sp.append(el("em", null, p), document.createTextNode(" " + grp[p].join(", "))); box.append(sp); });
    return box;
  }
  function drawHis(Pg, D) {
    const C = ctx(D), LU = new Map(D.lineup.list.map((l) => [l.date, l]));
    const c = card("콘티", "주일마다 부른 곡과 그날 라인업");
    const flt = el("div", "hx-flt"), sum = el("div", "hx-fsum"), list = el("div"), more = el("button", "hx-more", "더 보기"); more.type = "button";
    c.append(flt, sum, list, more); Pg.append(c);
    const HS = svcFilter(C, flt, () => draw());
    const keys = segOf(C.KEYS.map((k) => [k, k]));
    const q = el("input", "hx-search"); q.type = "search"; q.placeholder = "곡 이름 (쉼표로 여러 곡 · 모두 있는 콘티)"; q.setAttribute("aria-label", "곡 이름");
    const pq = el("input", "hx-search"); pq.type = "search"; pq.placeholder = "섬긴 사람 (쉼표로 여러 명)"; pq.setAttribute("aria-label", "섬긴 사람");
    const nn = segOf([["all", "전체"], ["3", "3곡 이하"], ["5", "5곡"], ["6", "6곡 이상"]]), sort = segOf([["new", "최신 순"], ["old", "오래된 순"]]);
    const reset = el("button", "hx-reset", "조건 초기화"); reset.type = "button";
    flt.append(row("곡", q), row("키", keys, el("span", "hx-hint", "이 키로 부른 곡이 있는 콘티")), row("사람", pq), row("곡 수", nn, el("span", "hx-fl", "정렬"), sort, reset));
    foldable(flt);
    const HF = { keys: [], n: "all", sort: "new" };
    keys.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; const v = b.dataset.v; HF.keys = HF.keys.includes(v) ? HF.keys.filter((x) => x !== v) : [...HF.keys, v]; draw(); });
    [[nn, "n"], [sort, "sort"]].forEach(([s, k]) => s.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; HF[k] = b.dataset.v; draw(); }));
    [q, pq].forEach((i) => i.addEventListener("input", () => draw()));
    reset.addEventListener("click", () => { HS.reset(); Object.assign(HF, { keys: [], n: "all", sort: "new" }); q.value = pq.value = ""; draw(); });
    const byDate = new Map(); C.P.forEach((p) => { if (!byDate.has(p.date)) byDate.set(p.date, []); byDate.get(p.date).push(p); });
    byDate.forEach((v) => v.sort((a, b) => a.order - b.order));
    let lim = 20;
    more.addEventListener("click", () => { lim += 30; draw(true); });
    function draw(keep) {
      if (!keep) lim = 20;
      HS.sync(); press(keys, (v) => HF.keys.includes(v)); press(nn, (v) => v === HF.n); press(sort, (v) => v === HF.sort);
      const qs = splitQ(q.value), ps = pq.value.split(",").map((x) => x.trim()).filter(Boolean);
      const hit = (p) => qs.some((x) => (C.ST[p.sid] || "").toLowerCase().replace(/\s/g, "").includes(x));
      let rows = C.DATES.filter(HS.ok).filter((d) => {
        const songs = byDate.get(d) || [];
        if (qs.length && !qs.every((x) => songs.some((p) => (C.ST[p.sid] || "").toLowerCase().replace(/\s/g, "").includes(x)))) return false;
        if (HF.keys.length && !songs.some((p) => HF.keys.includes(startKey(p.key)))) return false;
        if (HF.n !== "all" && !songs.length) return false;
        if (HF.n === "3" && songs.length > 3) return false;
        if (HF.n === "5" && songs.length !== 5) return false;
        if (HF.n === "6" && songs.length < 6) return false;
        if (ps.length) { const lu = LU.get(d); const names = new Set([...(lu ? lu.people.map((x) => x[0]) : []), ...(lu ? lu.lead : []), ...C.SV[d][0]]); if (!ps.every((x) => [...names].some((n) => n.includes(x)))) return false; }
        return true;
      });
      if (HF.sort === "new") rows.reverse();
      const cond = HS.describe();
      if (qs.length) cond.push(`'${q.value.trim()}' 포함`);
      if (HF.keys.length) cond.push(HF.keys.join("·") + " 키");
      if (ps.length) cond.push(`${ps.join("·")} 섬긴 날`);
      if (HF.n !== "all") cond.push({ 3: "3곡 이하", 5: "5곡", 6: "6곡 이상" }[HF.n]);
      const nsongs = rows.reduce((a, d) => a + (byDate.get(d) || []).length, 0);
      sum.replaceChildren(el("b", null, cond.join(" · ")), el("span", null, `주일 ${rows.length}번 · 곡 ${fmt(nsongs)}`));
      if (rows.length) { const s = rows.slice().sort(); sum.append(el("span", "muted", `${dot(s[0])} ~ ${dot(s[s.length - 1])}`)); }
      list.replaceChildren(...(rows.length ? rows.slice(0, lim).map((d) => {
        const songs = byDate.get(d) || [], box = el("div", "hx-svc"), h = el("div", "hx-svch");
        h.append(el("b", null, `${dot(d)} (${WD[new Date(d + "T00:00:00").getDay()]})`));
        if (C.SV[d][0].length) h.append(el("span", "chip chip-gray", "인도 " + C.SV[d][0].join(" · ")));
        if (C.SV[d][1]) h.append(el("span", "chip chip-violet", C.SV[d][1]));
        const sx = D.sids[d];
        if (sx) {
          const acts = el("span", "hx-acts");
          const btn = (t, a, cls) => { const b = el("button", `btn ${cls || "btn-ghost"} btn-sm`, t); b.type = "button"; b.dataset.hxc = a; b.dataset.sid = sx.sid; return b; };
          acts.append(btn("악보", "view"));
          if (sx.e) acts.append(btn("콘티 고치기", "edit", "btn-soft"), btn("적용찬양", "applied"));
          else if (sx.es) acts.append(btn("악보 고치기", "edit", "btn-soft"));
          h.append(acts);
        }
        const ol = el("ol");
        songs.forEach((x) => {
          const on = (qs.length && hit(x)) || (HF.keys.length && HF.keys.includes(startKey(x.key)));
          const li = el("li", on ? "hit" : ""), rw = el("div", "row");
          rw.append(el("span", null, C.ST[x.sid] || x.title));
          if (x.key) rw.append(el("span", "chip chip-violet", x.key));
          if (x.bpm) rw.append(el("span", "chip chip-gray", `♩=${x.bpm}`));
          x.refs.forEach((rf, i) => { const a = yt(rf[0], rf[1], (x.refs.length > 1 ? `▶ ${i + 1}` : "▶ 영상") + (rf[2] && rf[2] !== "메들리" ? ` ${rf[2]}` : ""), "hx-yt"); if (a) rw.append(a); });
          li.append(rw); ol.append(li);
        });
        if (!songs.length) ol.append(el("li", "muted", "콘티 기록 없음"));
        box.append(h, ol);
        const lu = LU.get(d);
        if (lu && lu.people.length) box.append(lineupLine(lu)); else box.append(el("div", "hx-lu", "라인업 기록 없음"));
        return box;
      }) : [el("p", "muted", "조건에 맞는 콘티가 없어요.")]));
      more.hidden = rows.length <= lim;
    }
    draw();
  }

  // ---------- 025: 적용찬양 (날짜별 목록 · 곡별 횟수) — 같은 곡은 이름으로 묶음 (띄어쓰기 · 문장부호 무시)
  function drawApp(Pg, D) {
    const A = D.applied || [];
    const c = card("적용찬양", "지난 예배에 올린 적용찬양 · 사진을 누르면 악보가 열려요 (내 메모도 써져요)");
    Pg.append(c);
    if (!A.length) { c.append(el("p", "muted", "아직 기록된 적용찬양이 없어요. 예배가 지나면 여기에 쌓여요.")); return; }
    const groups = new Map();
    A.forEach((x) => { const g = groups.get(x.norm) || { norm: x.norm, list: [], keys: {} }; g.list.push(x); if (x.key) g.keys[x.key] = (g.keys[x.key] || 0) + 1; groups.set(x.norm, g); });
    const G = [...groups.values()].map((g) => { g.list.sort((a, b) => b.date.localeCompare(a.date)); g.title = g.list[0].title; g.n = new Set(g.list.map((x) => x.date)).size; g.last = g.list[0].date; return g; });
    const hero = el("div", "hx-fsum");
    hero.append(el("b", null, `적용찬양 ${fmt(A.length)}번 · ${fmt(G.length)}곡`), el("span", "muted", `${dot(A[0].date)} ~ ${dot(A[A.length - 1].date)}`));
    const mode = segOf([["date", "날짜별"], ["song", "곡별 횟수"]]);
    const q = el("input", "hx-search"); q.type = "search"; q.placeholder = "곡 이름"; q.setAttribute("aria-label", "적용찬양 곡 이름");
    const list = el("div", "hx-list hx-app"), more = el("button", "hx-more", "더 보기"); more.type = "button";
    c.append(hero, row("보기", mode, q), list, more);
    const F = { mode: "date", lim: 30 };
    const photoBtn = (x) => { const b = el("button", "btn btn-ghost btn-sm", `사진 ${x.images.length}장`); b.type = "button"; b.dataset.apOpen = x.id; return b; };
    const qn = () => q.value.toLowerCase().replace(/[\s()[\]·.,!?'"-]/g, "");
    function draw(keep) {
      if (!keep) F.lim = 30;
      press(mode, (v) => v === F.mode);
      const s = qn();
      if (F.mode === "date") {
        const rows = A.filter((x) => !s || x.norm.includes(s)).slice().reverse();
        list.replaceChildren(...(rows.length ? rows.slice(0, F.lim).map((x) => {
          const r = el("div", "hx-arow");
          r.append(el("b", "d", `${dot(x.date).slice(2)}${x.min ? ` ${x.min}` : ""}`));
          const t = el("span", "t", x.title); r.append(t);
          if (x.key) r.append(el("span", "chip chip-violet", x.key));
          const gl = groups.get(x.norm)?.list || [];
          r.append(el("span", "muted small", gl.length > 1 ? `${gl.filter((y) => y.date <= x.date).length}번째 · 모두 ${gl.length}번` : "처음"), photoBtn(x));
          return r;
        }) : [el("p", "muted", "찾는 적용찬양이 없어요.")]));
        more.hidden = rows.length <= F.lim;
      } else {
        const rows = G.filter((g) => !s || g.norm.includes(s)).sort((a, b) => b.n - a.n || b.last.localeCompare(a.last));
        list.replaceChildren(...(rows.length ? rows.slice(0, F.lim).map((g) => {
          const r = el("div", "hx-sc"), head = el("div", "hx-sch");
          head.append(el("div", "t", g.title));
          const tot = el("div", "tot"); tot.append(el("span", null, `${g.n}번`), el("small", null, `마지막 ${dot(g.last).slice(2)}`)); head.append(tot); r.append(head);
          const kv = el("div", "hx-kv"), kk = el("span"); kk.append(el("em", null, "키"));
          Object.entries(g.keys).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => kk.append(el("span", "chip chip-violet", `${k} ${n}`)));
          if (!Object.keys(g.keys).length) kk.append(el("span", "chip chip-gray", "기록 없음"));
          kv.append(kk); r.append(kv);
          const det = el("details", "hx-refs"); det.append(el("summary", null, `부른 날 ${g.list.length}번`));
          const ul = el("ul");
          g.list.forEach((x) => { const li = el("li"); li.append(el("b", null, dot(x.date).slice(2))); if (x.title !== g.title) li.append(el("span", "muted small", x.title)); if (x.key) li.append(el("span", "chip chip-violet", x.key)); li.append(photoBtn(x)); ul.append(li); });
          det.append(ul); r.append(det);
          return r;
        }) : [el("p", "muted", "찾는 적용찬양이 없어요.")]));
        more.hidden = rows.length <= F.lim;
      }
    }
    mode.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; F.mode = b.dataset.v; draw(); });
    q.addEventListener("input", () => draw());
    more.addEventListener("click", () => { F.lim += 40; draw(true); });
    list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-ap-open]"); if (!b || !window.CONTI) return;
      const x = A.find((y) => y.id === +b.dataset.apOpen); if (!x) return;
      CONTI.openViewer(null, { title: `${dot(x.date)} 적용찬양 · ${x.title}`, items: [{ id: `a:${x.id}`, tag: "적용", kind: "applied", title: x.title, key: x.key,
        src: x.images.map((img, k) => ({ img, ink: { key: `a:${x.id}`, page: k + 1, anorm: x.norm } })) }] });
    });
    draw();
  }

  // ---------- 라인업
  function drawLin(Pg, D) {
    const LN = D.lineup, YRS = Object.keys(LN.years), LAST = LN.to;
    const regular = LN.people.filter((p) => !p.guest), y1n = regular.filter((p) => p.y1 > 0).length;
    const hero = el("div", "hx-hero");
    hero.innerHTML = `<p class="eyebrow">${dot(LN.from)} ~ ${dot(LN.to)} 라인업</p><div class="big">${fmt(regular.length)}명이 주일 ${fmt(LN.services)}번을 섬겼어요</div>
      <p class="sub">가장 많이 선 사람은 ${esc(regular[0]?.name || "")}(${regular[0]?.total || 0}번). 최근 1년에 한 번이라도 선 사람은 ${y1n}명이에요.</p>
      <div class="hx-stats">${[["주일", fmt(LN.services)], ["섬긴 사람", fmt(regular.length)], ["최근 1년", y1n + "명"], ["객원", LN.people.length - regular.length + "명"]].map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join("")}</div>`;
    const c = card("누가 얼마나 섬겼나", "조건에 맞는 주일만 세요 · 같은 날 두 자리를 맡아도 1번 · 라인업이 없는 주일은 인도자만 셈");
    const flt = el("div", "hx-flt"), sum = el("div", "hx-fsum"), list = el("div");
    c.append(flt, sum, list); Pg.append(hero, c);
    const SVC = LN.list;
    const F0 = () => ({ per: "all", years: [], from: "", to: "", pos: [], lead: "", kind: "all", guest: "member", sort: "n" });
    let F = F0();
    const per = segOf([["all", "전체"], ["y1", "최근 1년"], ["m6", "최근 6개월"], ["m3", "최근 3개월"]]), yr = segOf(YRS.map((y) => [y, y + "년"]));
    const dates = el("span", "hx-dates"), from = el("input"), to = el("input");
    [from, to].forEach((i) => { i.type = "date"; i.min = LN.from; i.max = LAST; }); from.setAttribute("aria-label", "시작일"); to.setAttribute("aria-label", "종료일");
    dates.append(from, document.createTextNode(" ~ "), to);
    const pos = segOf(POSS.map((p) => [p, p]));
    const lead = el("select", "hx-sel"); lead.append(new Option("누구든", "")); lead.setAttribute("aria-label", "인도자");
    const lc = {}; SVC.forEach((l) => l.lead.forEach((n) => (lc[n] = (lc[n] || 0) + 1)));
    Object.entries(lc).sort((a, b) => b[1] - a[1]).forEach(([n, k]) => lead.append(new Option(`${n} (${k})`, n)));
    const kind = segOf([["all", "전체"], ["sun", "주일만"], ["special", "특별예배만"]]);
    const q = el("input", "hx-search"); q.type = "search"; q.placeholder = "이름 (쉼표로 여러 명)"; q.setAttribute("aria-label", "이름");
    const guest = segOf([["member", "팀원만"], ["all", "객원 포함"]]);
    const sort = segOf([["n", "많이 선 순"], ["rate", "참여율 순"], ["last", "최근에 선 순"], ["first", "먼저 선 순"], ["name", "가나다 순"]]);
    const reset = el("button", "hx-reset", "조건 초기화"); reset.type = "button";
    flt.append(row("기간", per, yr, dates), row("포지션", pos, el("span", "hx-hint", "여러 개 고르면 그중 하나라도 맡은 날")),
      row("인도자", lead, el("span", "hx-fl", "예배"), kind), row("사람", q, guest), row("정렬", sort, reset));
    foldable(flt);
    const minus = (days) => minusDays(LAST, days);
    const sync = () => {
      press(per, (v) => !F.years.length && !F.from && !F.to && v === F.per); press(yr, (v) => F.years.includes(v)); press(pos, (v) => F.pos.includes(v));
      press(kind, (v) => v === F.kind); press(guest, (v) => v === F.guest); press(sort, (v) => v === F.sort);
      lead.value = F.lead; if (document.activeElement !== from) from.value = F.from; if (document.activeElement !== to) to.value = F.to;
    };
    per.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; F.per = b.dataset.v; F.years = []; F.from = F.to = ""; draw(); });
    yr.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; const v = b.dataset.v; F.years = F.years.includes(v) ? F.years.filter((x) => x !== v) : [...F.years, v].sort(); F.from = F.to = ""; F.per = "all"; draw(); });
    pos.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; const v = b.dataset.v; F.pos = F.pos.includes(v) ? F.pos.filter((x) => x !== v) : [...F.pos, v]; draw(); });
    [[kind, "kind"], [guest, "guest"], [sort, "sort"]].forEach(([s, k]) => s.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; F[k] = b.dataset.v; draw(); }));
    lead.addEventListener("change", () => { F.lead = lead.value; draw(); });
    [[from, "from"], [to, "to"]].forEach(([i, k]) => { i.addEventListener("change", () => { if (i.value && !i.validity.valid) return; F[k] = i.value; F.years = []; F.per = "all"; draw(); }); i.addEventListener("blur", sync); });
    q.addEventListener("input", draw);
    reset.addEventListener("click", () => { F = F0(); q.value = ""; draw(); });
    const ok = (l) => {
      if (F.years.length && !F.years.includes(l.date.slice(0, 4))) return false;
      if (F.from && l.date < F.from) return false;
      if (F.to && l.date > F.to) return false;
      if (!F.years.length && !F.from && !F.to && F.per !== "all" && l.date <= minus({ y1: 365, m6: 182, m3: 91 }[F.per])) return false;
      if (F.lead && !l.lead.includes(F.lead)) return false;
      if (F.kind === "sun" && l.note) return false;
      if (F.kind === "special" && !l.note) return false;
      return true;
    };
    function draw() {
      sync();
      const svcs = SVC.filter(ok), names = q.value.split(",").map((x) => x.trim()).filter(Boolean);
      const P = new Map(), span = svcs.length ? [svcs[0].date, svcs[svcs.length - 1].date] : null;
      const monthly = span && span[0].slice(0, 4) === span[1].slice(0, 4) && F.years.length <= 1;
      const kf = (d) => (monthly ? d.slice(0, 7) : d.slice(0, 4));
      const buckets = [...new Set(svcs.map((l) => kf(l.date)))].sort();
      const bs = {}; svcs.forEach((l) => { bs[kf(l.date)] = (bs[kf(l.date)] || 0) + 1; });
      svcs.forEach((l) => {
        const mine = new Map();
        l.people.forEach(([n, p, g]) => { if (!n) return; const m = mine.get(n) || { pos: new Set(), guest: true }; m.pos.add(p); m.guest = m.guest && g; mine.set(n, m); });
        l.lead.forEach((n) => { const m = mine.get(n) || { pos: new Set(), guest: false }; m.pos.add("인도"); m.guest = false; mine.set(n, m); });
        mine.forEach((m, n) => {
          const pp = F.pos.length ? [...m.pos].filter((p) => F.pos.includes(p)) : [...m.pos];
          if (!pp.length) return;
          const R = P.get(n) || { name: n, n: 0, pos: {}, b: {}, first: l.date, last: l.date, gN: 0 };
          R.n++; R.last = l.date; if (m.guest) R.gN++;
          pp.forEach((p) => { R.pos[p] = (R.pos[p] || 0) + 1; }); R.b[kf(l.date)] = (R.b[kf(l.date)] || 0) + 1;
          P.set(n, R);
        });
      });
      let rows = [...P.values()].map((r) => ({ ...r, guest: r.gN === r.n, rate: svcs.length ? r.n / svcs.length : 0 }));
      if (F.guest === "member") rows = rows.filter((r) => !r.guest);
      if (names.length) rows = rows.filter((r) => names.some((x) => r.name.includes(x)));
      const cmp = { n: (a, b) => b.n - a.n, rate: (a, b) => b.rate - a.rate, last: (a, b) => b.last.localeCompare(a.last), first: (a, b) => a.first.localeCompare(b.first), name: () => 0 }[F.sort];
      rows.sort((a, b) => cmp(a, b) || b.n - a.n || a.name.localeCompare(b.name, "ko"));
      if (F.sort === "name") rows.sort((a, b) => a.name.localeCompare(b.name, "ko"));
      const cond = [];
      if (F.years.length) cond.push(F.years.join("·") + "년");
      else if (F.from || F.to) cond.push(`${F.from ? dot(F.from) : "처음"} ~ ${F.to ? dot(F.to) : "지금"}`);
      else cond.push({ all: "전체 기간", y1: "최근 1년", m6: "최근 6개월", m3: "최근 3개월" }[F.per]);
      if (F.pos.length) cond.push(F.pos.join("·"));
      if (F.lead) cond.push(`${F.lead} 인도`);
      if (F.kind !== "all") cond.push(F.kind === "sun" ? "주일만" : "특별예배만");
      if (F.guest === "all") cond.push("객원 포함");
      sum.replaceChildren(el("b", null, cond.join(" · ")), el("span", null, `주일 ${svcs.length}번 · ${rows.length}명 · 총 ${fmt(rows.reduce((a, r) => a + r.n, 0))}자리`));
      if (span) sum.append(el("span", "muted", `${dot(span[0])} ~ ${dot(span[1])}`));
      const max = Math.max(1, ...rows.map((r) => r.n));
      let rank = 0, prev = null;
      list.replaceChildren(...(rows.length ? rows.map((p, i) => {
        const key = F.sort === "rate" ? p.rate : F.sort === "n" ? p.n : i;
        if (key !== prev) { rank = i + 1; prev = key; }
        const r = el("div", "hx-person");
        r.append(el("div", "rk", F.sort === "n" || F.sort === "rate" ? rank : i + 1));
        const nm = el("div", "nm", p.name);
        if (p.guest) nm.append(el("span", "chip chip-gray", "객원"));
        Object.entries(p.pos).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => nm.append(el("span", "chip chip-violet", `${k} ${n}`)));
        const tot = el("div", "tot"); tot.append(el("span", null, `${p.n}번`), el("small", null, `${Math.round(p.rate * 100)}%`));
        r.append(nm, tot);
        const tr = el("div", "hx-tr"), bi = el("i"); bi.style.width = (100 * p.n / max) + "%"; tr.append(bi); r.append(tr);
        const sub = el("div", "hx-sub"), ys = el("span", "hx-yrs" + (monthly ? " mo" : ""));
        buckets.forEach((k) => {
          const b = el("b"), cc = p.b[k] || 0, sp = el("span", null, cc || "·");
          sp.style.background = cc ? `rgba(106, 43, 201, ${Math.min(0.08 + cc / (bs[k] * 0.9), 0.55)})` : "transparent";
          b.title = `${k} · 주일 ${bs[k]}번 중 ${cc}번`;
          b.append(sp, document.createTextNode(monthly ? `${+k.slice(5)}` : `'${k.slice(2)}`)); ys.append(b);
        });
        sub.append(ys, el("span", null, `${dot(p.first).slice(2)} ~ ${dot(p.last).slice(2)}`)); r.append(sub);
        return r;
      }) : [el("p", "muted", "조건에 맞는 사람이 없어요.")]));
    }
    draw();
  }

  window.HISTORY = { load, mount, reset: () => { cache = null; }, build, POS_LABEL };
})();
