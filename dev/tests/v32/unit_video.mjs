// v32 단위: 예배 영상 날짜 · 마커 읽기 · 콘티 맞추기 (api/_video.js 순수 함수)
import { hasBibleRef, kindOf, parseTitleDate, titleSongs, parseDesc, matchVideo, normCore, normFull, sundayOnOrBefore, median, playSec } from "../../../api/_video.js";
let ok = 0, bad = 0;
const eq = (a, b, m) => { const s = JSON.stringify(a) === JSON.stringify(b); s ? ok++ : bad++; console.log(s ? "  ok " : "  BAD", m, s ? "" : `→ ${JSON.stringify(a)} (기대 ${JSON.stringify(b)})`); };

// 날짜
eq(parseTitleDate("2026년 8월 30일 온누리교회 Pole2 대학부 주일예배 찬양")?.date, "2026-08-30", "1) 'YYYY년 M월 D일'");
eq(parseTitleDate("2026년 8월 30일 온누리교회 Pole2 대학부 주일예배 찬양")?.src, "title", "1) 확실");
const t2 = parseTitleDate("25. 10.26 Pole2 대학부(온누리교회)_주일예배 찬양_놀라우신 은혜_주 품에");
eq([t2?.date, t2?.src, t2?.songs], ["2025-10-26", "title-short", ["놀라우신 은혜", "주 품에"]], "2) 'YY. MM.DD …_찬양_곡1_곡2'");
eq(parseTitleDate("25.3.9 Pole2 대학부_주일예배 찬양")?.date, "2025-03-09", "2) 붙여 쓴 'YY.M.D'");
eq(parseTitleDate("Pole2 2024.11.03 예배")?.date, "2024-11-03", "'YYYY.MM.DD'");
eq(parseTitleDate("8월 30일 주일예배 찬양", "2026-09-01T10:00:00Z")?.date, "2026-08-30", "'M월 D일' → 올린 해");
eq(parseTitleDate("12월 28일 주일예배", "2026-01-02T10:00:00Z")?.date, "2025-12-28", "'M월 D일' 연말 → 지난해");
eq(parseTitleDate("Pole2 대학부 주일예배 찬양", "2026-09-01T10:00:00Z"), null, "3) 제목에 날짜 없음");
eq(parseTitleDate("Pole2 26. 13.40 찬양"), null, "없는 날짜는 무시");
eq(sundayOnOrBefore("2026-09-01"), "2026-08-30", "올린 날(화) → 직전 주일");
eq(sundayOnOrBefore("2026-08-30"), "2026-08-30", "올린 날이 주일이면 그날");
eq(titleSongs("Pole2 대학부 주일예배 찬양"), [], "곡 없는 제목");

// 설명란
const D = `오늘의 찬양
00:00 : 찬양 List
03:51 : 놀라우신 은혜
9:12 - 주 품에 (In Christ Alone)
14:05 : 곡A + 곡B
1:02:03 : 마지막 곡
찬양 인도자 : 김철수 전도사님 & 이영희
https://example.com`;
const P = parseDesc(D);
eq(P.marks.map((x) => [x.t, x.label]), [[0, "찬양 List"], [231, "놀라우신 은혜"], [552, "주 품에 (In Christ Alone)"], [845, "곡A + 곡B"], [3723, "마지막 곡"]], "마커 시간 · 이름");
eq(P.leaders, ["김철수", "이영희"], "찬양 인도자 (호칭 빼고)");
eq(normCore("주 품에 (In Christ Alone)"), normCore("주품에"), "괄호 · 띄어쓰기 무시");
eq(normFull("Way Maker"), normFull("waymaker"), "대소문자 무시");

// 맞추기
const SL = (date, leaders, items) => [date, { date, leaders, items: items.map(([song_id, title, join_prev], i) => ({ ord: i + 1, song_id, title, join_prev: !!join_prev })) }];
const ctx = { today: "2026-11-08", aliases: new Map([[normFull("Amazing Grace"), 1]]),
  setlists: new Map([
    SL("2025-03-02", ["김철수"], [[9, "처음 곡"]]),
    SL("2026-08-30", ["김철수 전도사님"], [[1, "놀라우신 은혜"], [2, "주 품에"], [3, "곡A"], [4, "곡B"], [5, "마지막 곡"], [6, "안 부른 곡"]]),
    SL("2025-10-26", ["박민수"], [[1, "놀라우신 은혜"], [2, "주 품에"]]),
    SL("2025-11-02", ["박민수"], [[7, "다른 곡"], [8, "또 다른 곡"]]),
    SL("2026-09-06", ["이영희"], [[10, "메들리 머리"], [11, "이어 부른 곡", true], [12, "그다음"]]),
  ]) };
ctx.dates = [...ctx.setlists.keys()].sort();
const V = (o) => ({ id: "AAAAAAAAAAA", title: "", description: "", published_at: null, duration_sec: 4000, ...o });
let r = matchVideo(V({ title: "2026년 8월 30일 온누리교회 Pole2 대학부 주일예배 찬양", description: D }), ctx);
eq([r.status, r.service_date, r.reasons], ["linked", "2026-08-30", []], "제목 날짜 + 마커 → 연결 (인도자 맞음)");
const row = (id) => r.rows.find((x) => x.song_id === id);
eq(row(1), { song_id: 1, start_sec: 231, end_sec: 552, medley: false, located: true, seg: "solo", grp: null, grp_sec: null }, "곡 시간 = 다음 마커 − 이 마커");
eq([row(3).medley, row(4).medley, row(3).start_sec, row(4).end_sec], [true, true, 845, 3723], "'곡A + 곡B' → 메들리 (같은 구간)");
eq(row(5).end_sec, 4000, "마지막 곡은 영상 끝까지");
eq([row(6).located, row(6).start_sec], [false, 0], "마커 없는 콘티 곡 → 위치 모름");
eq(r.marks[0].skip, true, "'찬양 List' 건너뜀");
eq(playSec(row(1)), 321, "실연주 초"); eq(playSec(row(3)), null, "메들리는 시간 통계에서 뺌");

r = matchVideo(V({ title: "2026년 8월 30일 주일예배", description: "03:00 : 처음 듣는 곡\n05:00 : Amazing Grace\n찬양 인도자 : 홍길동" }), ctx);
eq([r.status, r.reasons], ["linked", ["songs", "leader"]], "못 맞춘 곡 · 다른 인도자 → 연결하되 확인 목록");
eq(r.rows.find((x) => x.song_id === 1)?.start_sec, 300, "별칭으로 맞춤 (Amazing Grace → 놀라우신 은혜)");

r = matchVideo(V({ title: "25. 10.26 Pole2 대학부(온누리교회)_주일예배 찬양_놀라우신 은혜_주 품에" }), ctx);
eq([r.status, r.service_date, r.reasons], ["linked", "2025-10-26", []], "2) 제목 곡이 그날 콘티와 맞음 → 연결");
eq(r.rows.every((x) => !x.located), true, "마커 없는 예전 영상 → 위치 모름");
r = matchVideo(V({ title: "25. 10.25 Pole2 대학부(온누리교회)_주일예배 찬양_놀라우신 은혜_주 품에" }), ctx);
eq([r.status, r.service_date, r.reasons], ["review", "2025-10-26", ["date"]], "2) 날짜 오타 → 곡이 맞는 가까운 주일 · 확인");
r = matchVideo(V({ title: "25. 11.02 Pole2 대학부(온누리교회)_주일예배 찬양_놀라우신 은혜_주 품에" }), ctx);
eq([r.status, r.service_date], ["review", "2025-10-26"], "2) 그날 콘티와 곡이 다르면 확인");
r = matchVideo(V({ title: "Pole2 대학부 주일예배 찬양", published_at: "2026-09-01T03:00:00Z" }), ctx);
eq([r.status, r.service_date, r.date_src, r.reasons], ["review", "2026-08-30", "upload", ["date"]], "3) 날짜 없음 → 올린 날 직전 주일 · 확인");
r = matchVideo(V({ title: "2024년 1월 7일 주일예배" }), ctx);
eq([r.status, r.skip_why], ["skipped", "outside"], "콘티 기록 전 영상 → 건너뜀");
r = matchVideo(V({ title: "2026년 10월 4일 주일예배" }), ctx);
eq([r.status, r.skip_why], ["skipped", "noconti"], "그날 콘티 없음 → 건너뜀");
r = matchVideo(V({ title: "2026년 9월 6일", description: "01:00 : 메들리 머리\n06:00 : 그다음" }), ctx);
eq([r.rows.find((x) => x.song_id === 11)?.start_sec, r.rows.find((x) => x.song_id === 11)?.medley, r.rows.find((x) => x.song_id === 10)?.medley], [60, true, true], "이어 부른 곡(join_prev)은 앞 곡 구간을 함께");
r = matchVideo(V({ title: "아무거나", pinned: true, service_date: "2025-11-02", status: "review", description: "00:10 : 또 다른 곡" }), ctx);
eq([r.status, r.service_date, r.date_src, r.rows.find((x) => x.song_id === 8)?.start_sec], ["linked", "2025-11-02", "manual", 10], "리더십이 정한 날짜는 그대로");
r = matchVideo(V({ title: "2026년 8월 30일", pinned: true, status: "skipped", skip_why: "manual" }), ctx);
eq(r.status, "skipped", "리더십이 뺀 영상은 계속 빠짐");
// 성경 구절 → 설교
const SERMON = ["2026년 8월 30일 온누리교회 Pole2 대학부 | 요한복음 3:16-18", "25. 10.26 Pole2 대학부(온누리교회)_롬 8:28", "믿음의 길 (마태복음 5장 1-12절)", "시편 23편 · 김철수 목사", "2026.08.30 히브리서 11:1", "(사 9:6) 평강의 왕", "고전13:4 사랑은"];
const PRAISE = ["2026년 8월 30일 온누리교회 Pole2 대학부 주일예배 찬양", "25. 10.26 Pole2 대학부(온누리교회)_주일예배 찬양_주 품에_놀라우신 은혜", "Pole2 대학부 주일예배 찬양 8/30", "2026.08.30 예배 찬양 (Live)"];
eq(SERMON.map(hasBibleRef), SERMON.map(() => true), "성경 구절 있는 제목 → 설교");
eq(PRAISE.map(hasBibleRef), PRAISE.map(() => false), "찬양 제목은 성경 구절로 잘못 보지 않음");
eq(kindOf("2026년 8월 30일 주일예배 찬양 | 요한복음 3:16"), "sermon", "성경 구절이 있으면 '찬양'이 있어도 설교로");
// 시그널 · 특순 등 → 건너뜀 (확인 목록에 안 올림)
eq(["2026년 8월 30일 찬양 시그널", "Pole2 특순 - 청년부", "8/30 주일예배 특송", "Pole2 대학부 광고", "수련회 하이라이트", "#shorts 찬양"].map(kindOf), ["other", "other", "other", "other", "other", "other"], "시그널 · 특순 · 특송 · 광고 · 하이라이트 · shorts");
r = matchVideo(V({ title: "2026년 8월 30일 찬양 시그널" }), ctx);
eq([r.status, r.skip_why], ["skipped", "other"], "찬양 시그널 영상 → 확인 없이 건너뜀");
r = matchVideo(V({ title: "2026년 8월 30일 주일예배 찬양", description: "00:00 : 찬양 시그널\n00:40 : 특순\n03:51 : 놀라우신 은혜" }), ctx);
eq([r.status, r.reasons, r.marks.filter((m) => m.skip).length], ["linked", [], 2], "설명란 '찬양 시그널' · '특순' 줄은 곡이 아닌 줄로");
r = matchVideo(V({ title: "2026년 8월 30일 주일예배 찬양", description: "03:00 : 처음 듣는 곡", dismissed: true }), ctx);
eq([r.status, r.reasons], ["linked", []], "넘긴 연결 영상은 곡 이름을 다시 묻지 않음");
// 설교 영상 (같은 재생목록)
eq([kindOf("2026년 8월 30일 온누리교회 Pole2 대학부 주일예배 설교"), kindOf("25. 10.26 Pole2 대학부_주일예배 말씀"), kindOf("2026년 8월 30일 … 주일예배 찬양"), kindOf("Pole2 대학부 8/30")], ["sermon", "sermon", "praise", null], "제목으로 찬양 · 설교 구분");
r = matchVideo(V({ title: "2026년 8월 30일 온누리교회 Pole2 대학부 주일예배 설교", description: D }), ctx);
eq([r.status, r.skip_why, r.rows.length], ["skipped", "sermon", 0], "설교 영상 → 건너뜀 (콘티에 안 붙음)");
r = matchVideo(V({ title: "2026년 8월 30일 Pole2" }), ctx);
eq([r.status, r.reasons], ["review", ["kind"]], "찬양 · 설교 표시 없고 마커도 없음 → 찬양 영상인지 확인");
r = matchVideo(V({ title: "2026년 8월 30일 Pole2", description: "03:51 : 놀라우신 은혜" }), ctx);
eq(r.status, "linked", "표시가 없어도 곡 마커가 콘티와 맞으면 찬양 영상");
eq(median([300, 100, 200]), 200, "중간값 (홀수)"); eq(median([100, 200, 300, 400]), 250, "중간값 (짝수)"); eq(median([]), null, "기록 없음");
console.log(`ok ${ok} bad ${bad}`);
