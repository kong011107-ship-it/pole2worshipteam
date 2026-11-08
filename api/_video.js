// =====================================================================
//  032: 예배 영상 자동 연결 — YouTube 재생목록 'Pole2대학부' → 기록 탭 콘티
//  · 영상 1개 = 그 주일 콘티 1개. 제목에서 날짜, 설명란에서 곡마다 시작 지점('03:51 : 놀라우신 은혜')
//  · 날짜 읽기 (먼저 맞는 것부터)
//      1) '2026년 8월 30일 …'                       → 그대로
//      2) '25. 10.26 Pole2 대학부…_곡1_곡2'           → 제목 곡 이름을 그날 콘티와 비교해서 한 번 더 확인
//         (그날 콘티와 하나도 안 맞고 가까운 다른 주일과 맞으면 그 날로 두고 리더십이 확인)
//      3) 날짜가 없으면 올린 날의 직전 주일 (그날이 주일이면 그날) → 확신 낮음, 리더십이 확인
//  · 같은 재생목록에 설교 영상도 있어요: 제목에 성경 구절(요한복음 3:16 · 롬 8:28) · 설교 · 말씀 · sermon → 건너뜀, 찬양 · worship · praise → 찬양 영상,
//    둘 다 없으면 설명란 곡 마커가 그날 콘티와 맞을 때만 찬양으로 보고 아니면 리더십 확인(kind)
//  · 콘티 기록이 있는 기간(첫 콘티 ~ 오늘) 밖의 영상은 건너뛰어요
//  · 곡 이름 맞추기: 띄어쓰기 · 대소문자 · 괄호 무시 → 별칭(리더십이 직접 연결한 것) → 한쪽이 다른 쪽을 품으면(하나뿐일 때)
//      '00:00 : 찬양 List'처럼 곡이 아닌 줄은 건너뛰고, '찬양 인도자 : 이름 & 이름'은 그날 인도자와 비교만 해요
//  · 곡 시간 = 다음 마커 − 이 마커 (마지막 곡은 영상 끝까지). 메들리(한 마커에 여러 곡 · 이어 부른 곡)는 시간 통계에서 빼요
//  순수 함수(parse* · matchVideo)는 dev/tests/v32/unit_video.mjs에서 시험해요
// =====================================================================

export const PLAYLIST = "PLH1dfOmrHoct-UOzuYzLZiBOAyBiyycIj";
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

// ------------------------------------------------------------------ 이름 맞추기
const PUNCT = /[\s '"`‘’“”.,!?·•…:;~\-–—_*#()[\]{}<>（）［］【】「」『』]/g;
export const normFull = (s) => String(s || "").toLowerCase().normalize("NFC").replace(PUNCT, "");
// 괄호 안(영어 제목 · 편곡 메모 등)까지 빼고
export const normCore = (s) => normFull(String(s || "").replace(/\([^)]*\)|\[[^\]]*\]|（[^）]*）|【[^】]*】/g, " "));
const untitle = (n) => String(n || "").replace(/\s*(목사님|전도사님|간사님|목사|전도사|간사|형제|자매)$/, "").trim();
const SKIP = /시그널|signal|특순|특송|특별찬양|광고|^(찬양)?(list|리스트|목록|순서|콘티)$|^(intro|outro|opening|ending|인트로|아웃트로|오프닝|엔딩|시작|끝|end|기도|대표기도|합심기도|광고|말씀|설교|축도|멘트|환영|광고및환영|예배시작|예배의부름|입례|입례송|찬양시작)$/i;

// ------------------------------------------------------------------ 날짜
const pad = (n) => String(n).padStart(2, "0");
const isoOf = (y, m, d) => {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
};
export const kstDate = (ts) => new Date(new Date(ts).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
export const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (iso) => new Date(iso + "T00:00:00Z").getUTCDay();
const dayDiff = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 864e5);
// 올린 날의 직전 주일 (그날이 주일이면 그날)
export const sundayOnOrBefore = (iso) => addDays(iso, -dow(iso));

// 제목 → { date, src, songs } (못 읽으면 null)
export function parseTitleDate(title, publishedAt) {
  const t = String(title || "");
  let m = t.match(/(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) { const d = isoOf(+m[1], +m[2], +m[3]); if (d) return { date: d, src: "title", songs: titleSongs(t) }; }
  m = t.match(/(20\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?!\d)/);
  if (m) { const d = isoOf(+m[1], +m[2], +m[3]); if (d) return { date: d, src: "title", songs: titleSongs(t) }; }
  // '25. 10.26' · '25.10.26' · '251026'
  m = t.match(/(?:^|[^\d])(\d{2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})(?!\d)/) || t.match(/(?:^|[^\d])(\d{2})(\d{2})(\d{2})(?!\d)/);
  if (m) { const d = isoOf(2000 + +m[1], +m[2], +m[3]); if (d) return { date: d, src: "title-short", songs: titleSongs(t) }; }
  // '8월 30일' → 올린 해 (올린 날보다 뒤면 지난해)
  m = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m && publishedAt) {
    const up = kstDate(publishedAt); let y = +up.slice(0, 4);
    let d = isoOf(y, +m[1], +m[2]); if (d && d > addDays(up, 3)) d = isoOf(y - 1, +m[1], +m[2]);
    if (d) return { date: d, src: "title-md", songs: titleSongs(t) };
  }
  return null;
}
// '…_주일예배 찬양_곡1_곡2' → ['곡1', '곡2']
export function titleSongs(t) {
  const parts = String(t || "").split(/[_|｜]/).map((x) => x.trim()).filter(Boolean);
  const i = parts.findIndex((x) => /찬양\s*$/.test(x) || /예배\s*찬양/.test(x));
  return i >= 0 ? parts.slice(i + 1).filter((x) => x.length <= 60) : [];
}

// ------------------------------------------------------------------ 설명란
// '03:51 : 놀라우신 은혜' · '1:03:51 - 곡' · '3:51 곡' / '찬양 인도자 : 이름 & 이름'
export function parseDesc(desc) {
  const marks = [], leaders = [];
  String(desc || "").split(/\r?\n/).forEach((line) => {
    const l = line.trim(); if (!l) return;
    const lm = l.match(/^찬양\s*인도(?:자)?\s*[:：\-]\s*(.+)$/);
    if (lm) { lm[1].split(/\s*(?:&|,|·|\/|\+|그리고|and)\s*/i).map(untitle).filter(Boolean).forEach((n) => leaders.push(n)); return; }
    const m = l.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*(?:[:：\-–—~|.)]\s*)?(.+)$/);
    if (!m) return;
    const t = (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3];
    const label = m[4].replace(/^[\s:：\-–—|.]+/, "").trim();
    if (label && +m[3] < 60) marks.push({ t, label: label.slice(0, 120) });
  });
  marks.sort((a, b) => a.t - b.t);
  return { marks: marks.filter((x, i, a) => !i || x.t !== a[i - 1].t || x.label !== a[i - 1].label), leaders };
}

// ------------------------------------------------------------------ 맞추기
// ctx = { setlists: Map(date → { date, leaders, items: [{ ord, song_id, title, join_prev }] }), dates: [..정렬], aliases: Map(norm → song_id), today }
export function songMatcher(items, aliases) {
  const keys = items.map((x) => ({ id: x.song_id, f: normFull(x.title), c: normCore(x.title) }));
  return (text) => {
    const f = normFull(text), c = normCore(text);
    if (!f) return null;
    let k = keys.find((x) => x.f === f || (c && x.c === c));
    if (k) return k.id;
    const al = aliases?.get(f) ?? aliases?.get(c);
    if (al) return al;
    if (c.length >= 3) {
      const hit = keys.filter((x) => x.c.length >= 3 && (x.c.includes(c) || c.includes(x.c)));
      if (hit.length === 1) return hit[0].id;
    }
    return null;
  };
}
// 한 마커 → 곡 id들 (메들리 '곡A + 곡B'면 여러 곡)
function matchLabel(label, match) {
  const one = match(label);
  if (one) return [one];
  const parts = label.split(/\s*(?:\+|＋|\/|→|->|&)\s*/).filter((x) => normFull(x));
  if (parts.length > 1) { const ids = parts.map(match); if (ids.every(Boolean)) return [...new Set(ids)]; }
  return null;
}
const scoreDate = (ctx, date, songs) => {
  const sl = ctx.setlists.get(date); if (!sl || !songs?.length) return 0;
  const m = songMatcher(sl.items, ctx.aliases);
  return songs.filter((x) => m(x)).length;
};

// 제목에 성경 구절이 있으면 설교 영상 ('요한복음 3:16' · '롬 8:28-30' · '마태복음 5장' · '(시 23:1)')
const BOOKS = "창세기|출애굽기|레위기|민수기|신명기|여호수아|사사기|룻기|사무엘[상하]|열왕기[상하]|역대[상하]|에스라|느헤미야|에스더|욥기|시편|잠언|전도서|아가|이사야|예레미야애가|예레미야|에스겔|다니엘|호세아|요엘|아모스|오바댜|요나|미가|나훔|하박국|스바냐|학개|스가랴|말라기|마태복음|마가복음|누가복음|요한복음|사도행전|로마서|고린도[전후]서|갈라디아서|에베소서|빌립보서|골로새서|데살로니가[전후]서|디모데[전후]서|디도서|빌레몬서|히브리서|야고보서|베드로[전후]서|요한[일이삼]서|유다서|요한계시록";
const ABBR = "창|출|레|민|신|수|삿|룻|삼상|삼하|왕상|왕하|대상|대하|스|느|에|욥|시|잠|전|아|사|렘|애|겔|단|호|욜|암|옵|욘|미|나|합|습|학|슥|말|마|막|눅|요|행|롬|고전|고후|갈|엡|빌|골|살전|살후|딤전|딤후|딛|몬|히|약|벧전|벧후|요일|요이|요삼|유|계";
const BIBLE_FULL = new RegExp(`(?:${BOOKS})\\s*\\d{1,3}\\s*(?:장|편|:)`);
const BIBLE_ABBR = new RegExp(`(?:^|[^가-힣])(?:${ABBR})\\s*\\d{1,3}\\s*:\\s*\\d{1,3}`);
export const hasBibleRef = (title) => { const t = String(title || ""); return BIBLE_FULL.test(t) || BIBLE_ABBR.test(t); };
// 찬양 영상인지: 'praise' | 'sermon' | 'other'(시그널 · 특순 · 광고 등) | null(제목만으로는 모름)
export function kindOf(title) {
  const t = String(title || "").toLowerCase();
  if (hasBibleRef(title)) return "sermon";
  if (/설교|말씀|sermon|메시지|message/.test(t)) return "sermon";
  if (/시그널|signal|특순|특송|특별\s*찬양|광고|티저|teaser|trailer|트레일러|예고|하이라이트|highlight|shorts|쇼츠|v-?log|브이로그|비하인드|behind/.test(t)) return "other";
  if (/찬양|워십|worship|praise/.test(t)) return "praise";
  return null;
}
// 영상 하나 → { service_date, date_src, status, reasons, skip_why, marks, leaders_said, rows }
//  v = { id, title, description, published_at, duration_sec, pinned, service_date, status, skip_why }
export function matchVideo(v, ctx) {
  const { marks: raw, leaders } = parseDesc(v.description);
  const out = { service_date: null, date_src: null, status: "review", reasons: [], skip_why: null, marks: raw.map((x) => ({ ...x, songs: null, skip: false })), leaders_said: leaders, rows: [] };
  let date = null, sure = false;
  if (v.pinned) {
    // 리더십이 정한 날짜 · 상태는 그대로 (곡만 다시 맞춤)
    out.date_src = "manual";
    if (v.status === "skipped") return { ...out, status: "skipped", skip_why: v.skip_why || "manual", service_date: v.service_date };
    date = v.service_date; sure = !!date;
  } else {
    const kind = kindOf(v.title);
    if (kind === "sermon" || kind === "other") return { ...out, status: "skipped", skip_why: kind };
    const t = parseTitleDate(v.title, v.published_at);
    if (t) {
      date = t.date; out.date_src = t.src;
      sure = t.src === "title" || !!ctx.setlists.get(date);
      if (t.src !== "title" && t.songs.length) {
        // 제목 곡 이름으로 날짜 한 번 더 확인
        const here = scoreDate(ctx, date, t.songs);
        if (!here) {
          let best = null, bs = 0;
          for (let k = -21; k <= 21; k++) { if (!k) continue; const d = addDays(date, k), s = scoreDate(ctx, d, t.songs); if (s > bs) { bs = s; best = d; } }
          if (best && bs >= Math.min(2, t.songs.length)) { date = best; sure = false; }
          else if (ctx.setlists.get(date)) sure = false;
        }
      }
    } else if (v.published_at) {
      date = sundayOnOrBefore(kstDate(v.published_at)); out.date_src = "upload"; sure = false;
    }
  }
  out.service_date = date;
  if (!date) { out.reasons = ["date"]; return out; }
  const first = ctx.dates[0];
  if (!v.pinned && (!first || date < first || date > ctx.today)) return { ...out, status: "skipped", skip_why: "outside" };
  const sl = ctx.setlists.get(date);
  if (!sl) {
    if (sure && !v.pinned) return { ...out, status: "skipped", skip_why: "noconti", reasons: ["noconti"] };
    out.reasons = ["date", "noconti"];
    return out;
  }
  if (!sure) out.reasons.push("date");

  // 곡 마커 맞추기
  const match = songMatcher(sl.items, ctx.aliases);
  const dur = v.duration_sec || null, rows = new Map();
  let unmatched = 0;
  out.marks.forEach((mk, i) => {
    const ids = matchLabel(mk.label, match);
    const end = out.marks[i + 1]?.t ?? dur;
    if (!ids) {
      if (SKIP.test(normCore(mk.label)) || SKIP.test(normFull(mk.label))) mk.skip = true; else unmatched++;
      return;
    }
    mk.songs = ids;
    // 이어 부른 곡(join_prev)은 같은 구간을 함께 (메들리)
    const group = [...ids];
    ids.forEach((id) => {
      const at = sl.items.findIndex((x) => x.song_id === id);
      for (let j = at + 1; at >= 0 && j < sl.items.length && sl.items[j].join_prev; j++) {
        const jid = sl.items[j].song_id;
        if (!out.marks.some((q) => q !== mk && q.songs?.includes(jid)) && !raw.some((q, qi) => qi > i && match(q.label) === jid)) group.push(jid);
      }
    });
    const medley = new Set(group).size > 1;
    [...new Set(group)].forEach((id) => {
      if (rows.has(id)) return;   // 다시 부른 곡은 처음 것만
      rows.set(id, { song_id: id, start_sec: mk.t, end_sec: end && end > mk.t ? end : null, medley, located: true });
    });
  });
  // 리더십이 '넘기기'를 누른 연결 영상은 못 맞춘 곡 이름을 다시 묻지 않아요
  if (unmatched && !v.dismissed) out.reasons.push("songs");
  // 제목에 찬양 · 설교 표시가 없고 곡 마커도 하나도 안 맞으면 찬양 영상인지 확인
  if (!v.pinned && !kindOf(v.title) && !out.marks.some((m) => m.songs)) out.reasons.unshift("kind");
  // 위치를 모르는 콘티 곡 (마커가 없거나 못 맞춘 곡) → 영상 처음부터
  sl.items.forEach((x) => { if (!rows.has(x.song_id)) rows.set(x.song_id, { song_id: x.song_id, start_sec: 0, end_sec: null, medley: false, located: false }); });
  out.rows = [...rows.values()];
  // 인도자 확인 (참고용)
  if (leaders.length && sl.leaders?.length) {
    const said = leaders.map(normFull), have = sl.leaders.map((n) => normFull(untitle(n)));
    if (!said.some((n) => have.some((h) => h && (h === n || h.includes(n) || n.includes(h))))) out.reasons.push("leader");
  }
  out.status = out.reasons.includes("date") || out.reasons.includes("kind") ? "review" : "linked";
  return out;
}
// 곡 시간으로 쓸 수 있는 구간 (메들리 · 위치 모름 · 너무 짧거나 긴 것 빼고)
export const playSec = (r) => (r.located && !r.medley && r.end_sec ? r.end_sec - r.start_sec : null);
export const usableSec = (s) => s != null && s >= 40 && s <= 1200;
export function median(xs) {
  const a = xs.filter((x) => x != null).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

// ------------------------------------------------------------------ DB · YouTube
const isoSec = (iso) => { const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || ""); return m ? (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0)) : null; };
const todayKST = () => kstDate(Date.now());

// Supabase는 한 번에 1000행까지만 줘요 → 끝까지 나눠 읽기 (mk: 매번 새 쿼리, 정렬 필수)
async function readAll(mk, what) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await mk().range(from, from + 999);
    if (error) throw new Error(`${what}을(를) 읽지 못했어요: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}
export async function loadCtx(db) {
  const today = todayKST();
  const [sl, sv, so, al, it] = await Promise.all([
    readAll(() => db.from("setlists").select("id, service_date, leaders, service_id, status").eq("status", "published").lte("service_date", today).order("id"), "콘티 기록"),
    readAll(() => db.from("services").select("id, ministry_id").not("ministry_id", "is", null).order("id"), "예배"),
    readAll(() => db.from("songs").select("id, title").order("id"), "곡"),
    readAll(() => db.from("song_aliases").select("norm, song_id").order("norm"), "별칭"),
    readAll(() => db.from("setlist_items").select("setlist_id, ord, song_id, join_prev").order("id"), "콘티 곡"),
  ]);
  const ministry = new Set(sv.map((x) => x.id));
  const lists = sl.filter((x) => !x.service_id || !ministry.has(x.service_id));
  const title = new Map(so.map((x) => [x.id, x.title]));
  const keep = new Set(lists.map((x) => x.id));
  const items = it.filter((x) => keep.has(x.setlist_id));
  const by = new Map();
  items.forEach((x) => { (by.get(x.setlist_id) || by.set(x.setlist_id, []).get(x.setlist_id)).push(x); });
  const setlists = new Map(lists.map((x) => [x.service_date, { date: x.service_date, leaders: x.leaders || [],
    items: (by.get(x.id) || []).sort((a, b) => a.ord - b.ord).map((i) => ({ ord: i.ord, song_id: i.song_id, title: title.get(i.song_id) || "", join_prev: !!i.join_prev })) }]));
  return { setlists, dates: [...setlists.keys()].sort(), aliases: new Map(al.map((x) => [x.norm, x.song_id])), today };
}

// 맞춘 결과 저장 (영상 행 + 곡 위치). videos = 저장된 행 또는 새로 읽은 영상
export async function saveMatched(db, videos, ctx) {
  // 같은 영상이 두 번 오면(재생목록에 두 번 · 나눠 읽다 겹침) 하나만 — upsert는 한 번에 같은 행을 두 번 못 바꿔요
  videos = [...new Map(videos.filter((v) => v?.id).map((v) => [v.id, v])).values()];
  if (!videos.length) return { linked: 0, review: 0, skipped: 0 };
  const now = new Date().toISOString(), cnt = { linked: 0, review: 0, skipped: 0 };
  const rows = [], songRows = [];
  for (const v of videos) {
    const r = matchVideo(v, ctx);
    cnt[r.status]++;
    rows.push({ id: v.id, title: v.title || "", description: (v.description || "").slice(0, 8000), published_at: v.published_at || null, duration_sec: v.duration_sec ?? null,
      service_date: r.service_date, date_src: r.date_src, status: r.status, reasons: r.reasons, skip_why: r.skip_why, marks: r.marks, leaders_said: r.leaders_said,
      pinned: !!v.pinned, dismissed: !!v.dismissed, linked_at: r.status === "linked" ? v.linked_at || now : v.linked_at || null, checked_at: now });
    if (r.status === "linked") r.rows.forEach((x) => songRows.push({ video_id: v.id, ...x }));
  }
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("worship_videos").upsert(rows.slice(i, i + 200));
    if (error) throw new Error("영상을 저장하지 못했어요: " + error.message);
  }
  const ids = rows.map((x) => x.id);
  for (let i = 0; i < ids.length; i += 200) await db.from("video_songs").delete().in("video_id", ids.slice(i, i + 200));
  for (let i = 0; i < songRows.length; i += 500) {
    const { error } = await db.from("video_songs").insert(songRows.slice(i, i + 500));
    if (error) throw new Error("곡 위치를 저장하지 못했어요: " + error.message);
  }
  return cnt;
}

// 저장된 영상 다시 맞추기 (YouTube를 다시 부르지 않음) — 별칭 · 날짜를 고친 뒤 · 콘티가 바뀐 뒤
export async function rematch(db, filter = {}) {
  const ctx = await loadCtx(db);
  // 나눠 읽을 때 겹치지 않게 id 순서로
  const all = await readAll(() => { let q = db.from("worship_videos").select("*").order("id"); if (filter.ids) q = q.in("id", filter.ids); return q; }, "저장된 영상");
  const pick = filter.recent ? all.filter((v) => v.status === "review" || (v.reasons || []).includes("songs") || (v.service_date && v.service_date >= addDays(ctx.today, -filter.recent)))
    : all.filter((v) => filter.ids || v.skip_why !== "outside");
  return { checked: pick.length, ...(await saveMatched(db, pick, ctx)) };
}

async function ytGet(path, key) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}&key=${encodeURIComponent(key)}`);
  if (!r.ok) {
    let msg = ""; try { msg = (await r.json())?.error?.message || ""; } catch {}
    throw new Error(`YouTube에서 읽지 못했어요 (${r.status}${msg ? " · " + msg.slice(0, 120) : ""}). API 키를 확인해 주세요.`);
  }
  return r.json();
}

// 재생목록 읽기 — 저장 안 된 영상만 길이를 받아서 맞춰요. budgetMs를 넘기면 page_token을 남기고 다음에 이어서
//   restart: 처음 쪽부터 다시 (하루 1번 확인) · 그 밖에는 남겨 둔 자리부터
export async function syncPlaylist(db, { budgetMs = 7000, restart = false } = {}) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YouTube API 키(YOUTUBE_API_KEY)가 아직 설정되지 않았어요. Vercel 환경변수에 넣어 주세요.");
  const t0 = Date.now();
  const { data: st } = await db.from("video_sync").select("*").eq("id", 1).maybeSingle();
  const list = st?.playlist || PLAYLIST;
  let token = restart ? null : st?.page_token || null;
  let ctx = null, pages = 0, seen = 0, added = 0;
  const cnt = { linked: 0, review: 0, skipped: 0 };
  let done = false;
  while (true) {
    const j = await ytGet(`playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${encodeURIComponent(list)}${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`, key);
    pages++;
    const items = (j.items || []).map((it) => ({ id: it.contentDetails?.videoId || it.snippet?.resourceId?.videoId, title: it.snippet?.title || "", description: it.snippet?.description || "",
      published_at: it.contentDetails?.videoPublishedAt || null })).filter((x) => YT_ID.test(x.id || "") && x.title !== "Private video" && x.title !== "Deleted video");
    seen += items.length;
    if (items.length) {
      const { data: have } = await db.from("worship_videos").select("id").in("id", items.map((x) => x.id));
      const known = new Set((have || []).map((x) => x.id));
      const fresh = items.filter((x) => !known.has(x.id) && (known.add(x.id), true));
      if (fresh.length) {
        const vj = await ytGet(`videos?part=contentDetails,snippet&id=${fresh.map((x) => x.id).join(",")}`, key);
        const det = new Map((vj.items || []).map((x) => [x.id, x]));
        fresh.forEach((x) => { const d = det.get(x.id); x.duration_sec = isoSec(d?.contentDetails?.duration); if (d?.snippet?.description) x.description = d.snippet.description; if (!x.published_at) x.published_at = d?.snippet?.publishedAt || null; });
        ctx = ctx || (await loadCtx(db));
        const c = await saveMatched(db, fresh, ctx);
        added += fresh.length; Object.keys(cnt).forEach((k) => (cnt[k] += c[k]));
      }
    }
    token = j.nextPageToken || null;
    if (!token) { done = true; break; }
    if (Date.now() - t0 > budgetMs) break;
  }
  const result = { pages, seen, added, ...cnt, done, at: new Date().toISOString() };
  await db.from("video_sync").update({ page_token: done ? null : token, pending: !done, full_done: st?.full_done || done, last_run: new Date().toISOString(), last_result: result }).eq("id", 1);
  return result;
}

// cron: 하루 1번 (새벽 5시 KST) 처음부터 확인하고, 덜 끝났으면 다음 시간에 이어서. 확인한 뒤 최근 영상 · 확인 목록을 다시 맞춰요(콘티가 바뀌었을 수 있어서)
export async function videoCron(db, now, hour = 5) {
  if (!process.env.YOUTUBE_API_KEY) return null;
  const { data: st, error } = await db.from("video_sync").select("*").eq("id", 1).maybeSingle();
  if (error || !st) return null;   // migration_031 전
  const fresh = now.hour === hour && st.last_day !== now.date;
  if (!fresh && !st.pending) return null;
  if (fresh) await db.from("video_sync").update({ last_day: now.date }).eq("id", 1);
  const r = await syncPlaylist(db, { budgetMs: 6000, restart: fresh && st.full_done });
  if (r.done) r.rematched = await rematch(db, { recent: 60 });
  return r;
}
