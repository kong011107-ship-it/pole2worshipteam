// v33 단위: 실연주 구간 종류 (solo · medley · split · unsure · odd) · 메들리 묶음 시간
import { matchVideo, playSec, normFull } from "../../../api/_video.js";
let ok = 0, bad = 0;
const eq = (a, b, m) => { const s = JSON.stringify(a) === JSON.stringify(b); s ? ok++ : bad++; console.log(s ? "  ok " : "  BAD", m, s ? "" : `→ ${JSON.stringify(a)} (기대 ${JSON.stringify(b)})`); };
const SL = (date, items) => [date, { date, leaders: [], items: items.map(([song_id, title, join_prev], i) => ({ ord: i + 1, song_id, title, join_prev: !!join_prev })) }];
const ctx = { today: "2026-11-08", aliases: new Map(),
  refSec: new Map([[1, 300], [2, 240], [3, 200], [4, 180], [5, 300], [6, 120], [20, 300], [21, 240], [30, 300]]),
  setlists: new Map([
    // v26 뒤 메들리: 2 → 3 이어서
    SL("2026-09-06", [[1, "가"], [2, "나"], [3, "다", true], [4, "라"]]),
    // 예전 기록(이어서 표시 없음)
    SL("2025-05-04", [[20, "마"], [21, "바"], [22, "사"]]),
    SL("2025-05-11", [[30, "아"], [31, "안 부른 곡"]]),
  ]) };
ctx.dates = [...ctx.setlists.keys()].sort();
const V = (title, description, dur = 2000) => matchVideo({ id: "AAAAAAAAAAA", title, description, duration_sec: dur }, ctx);
const row = (r, id) => r.rows.find((x) => x.song_id === id) || {};
const seg = (r, id) => row(r, id).seg;

// 1) 콘티 메들리 + 편집자가 한 구간 ('나 + 다')
let r = V("2026년 9월 6일 찬양", "00:00 : 가\n05:00 : 나 + 다\n12:00 : 라", 720 + 180);
eq([seg(r, 1), seg(r, 2), seg(r, 3), seg(r, 4)], ["solo", "medley", "medley", "solo"], "메들리 한 구간 → medley");
eq([row(r, 2).grp, row(r, 2).grp_sec, row(r, 3).grp_sec], ["2+3", 420, 420], "묶음 시간 = 구간 전체");
eq([playSec(row(r, 1)), playSec(row(r, 2))], [300, null], "곡 시간은 solo만");

// 1-b) 콘티 메들리 + 첫 곡 마커만
r = V("2026년 9월 6일 찬양", "00:00 : 가\n05:00 : 나\n12:00 : 라");
eq([seg(r, 2), seg(r, 3), row(r, 3).start_sec, row(r, 2).grp_sec], ["medley", "medley", 300, 420], "첫 곡 마커만 → 이어 부른 곡까지 한 구간");

// 2) 콘티 메들리 + 편집자가 곡마다 나눔 → split, 곡 시간에서 빼고 묶음 시간은 같은 값
r = V("2026년 9월 6일 찬양", "00:00 : 가\n05:00 : 나\n09:00 : 다\n12:00 : 라");
eq([seg(r, 2), seg(r, 3), playSec(row(r, 2)), playSec(row(r, 3))], ["split", "split", null, null], "나눈 메들리 → split · 곡 시간 안 씀");
eq([row(r, 2).grp, row(r, 2).grp_sec, row(r, 3).grp_sec], ["2+3", 420, 420], "나눠도 묶음 시간은 같은 420초");
eq([row(r, 2).start_sec, row(r, 3).start_sec], [300, 540], "재생 위치는 나눈 대로");

// 3) 예전 기록: 첫 곡 마커만 (바 마커 없음) → 마 구간에 바가 섞였을 수 있음
r = V("2025년 5월 4일 찬양", "00:00 : 마\n09:00 : 사");
eq([seg(r, 20), playSec(row(r, 20))], ["unsure", null], "다음 곡 마커 없음 + 레퍼런스보다 길음 → unsure");
eq([row(r, 21).located, row(r, 21).start_sec], [false, 0], "바는 위치 모름");
// 예전 기록에 '마 + 바'
r = V("2025년 5월 4일 찬양", "00:00 : 마 + 바\n09:00 : 사");
eq([seg(r, 20), seg(r, 21), row(r, 20).grp, row(r, 20).grp_sec], ["medley", "medley", "20+21", 540], "예전 기록 '+' → 메들리 묶음");
// 예전 기록에서 다음 곡이 이름만 못 맞춘 마커 → 구간은 거기서 끝나요
r = V("2025년 5월 4일 찬양", "00:00 : 마\n05:10 : 바 (오타 편곡)ㅋ\n09:00 : 사");
eq(seg(r, 20), "solo", "다음 마커가 못 맞춘 곡 이름이면 숨은 곡 아님");

// 3-b) 콘티에만 있고 안 부른 곡: 레퍼런스 길이와 비슷하면 solo
r = V("2025년 5월 11일 찬양", "00:30 : 아", 30 + 310);
eq([seg(r, 30), playSec(row(r, 30))], ["solo", 310], "다음 곡 마커 없음이지만 레퍼런스 1.25배 이내 → solo");
r = V("2025년 5월 11일 찬양", "00:30 : 아", 30 + 420);
eq(seg(r, 30), "unsure", "1.25배 넘으면 unsure");

// 4) 길이 이상
r = V("2026년 9월 6일 찬양", "00:00 : 가\n10:30 : 나 + 다\n18:00 : 라", 18 * 60 + 180);
eq([seg(r, 1), playSec(row(r, 1))], ["odd", null], "레퍼런스(300초)의 1.5배 초과 → odd");
r = V("2026년 9월 6일 찬양", "00:00 : 가\n02:00 : 나 + 다\n09:00 : 라", 9 * 60 + 180);
eq(seg(r, 1), "odd", "0.5배 미만 → odd");
eq([seg(r, 4), playSec(row(r, 4))], ["solo", 180], "마지막 곡 · 다음 곡 없음 → solo");

// 메들리 묶음: 사이에 다른 곡 마커가 끼면 묶음 시간 없음
r = V("2026년 9월 6일 찬양", "00:00 : 나\n04:00 : 가\n08:00 : 다\n12:00 : 라");
eq([seg(r, 2), seg(r, 3), row(r, 2).grp_sec], ["split", "split", null], "묶음 곡 사이에 다른 곡 → 묶음 시간 없음");
// 묶음 뒤 콘티 다음 곡 마커가 없으면 묶음 시간 없음
r = V("2026년 9월 6일 찬양", "00:00 : 가\n05:00 : 나 + 다", 1500);
eq([row(r, 2).grp_sec, seg(r, 4)], [null, "solo"], "묶음 뒤 숨은 곡 의심 → 묶음 시간 없음");
// 마지막 곡이 영상 끝까지(기도 · 광고 포함)라 길면 odd
r = V("2026년 9월 6일 찬양", "00:00 : 가\n05:00 : 나 + 다\n12:00 : 라", 2000);
eq(seg(r, 4), "odd", "마지막 곡이 영상 끝까지 길게 → odd");
// 마커 없는 영상: 모두 위치 모름 · solo
r = V("2026년 9월 6일 찬양", "");
eq(r.rows.map((x) => [x.located, x.seg]), [[false, "solo"], [false, "solo"], [false, "solo"], [false, "solo"]], "마커 없음 → 위치 모름");
// 레퍼런스가 없으면 길이 규칙 없음
r = matchVideo({ id: "AAAAAAAAAAA", title: "2026년 9월 6일 찬양", description: "00:00 : 가\n15:00 : 나 + 다\n20:00 : 라", duration_sec: 1500 }, { ...ctx, refSec: new Map() });
eq(seg(r, 1), "solo", "레퍼런스 없음 → 길이로 빼지 않음");
eq(normFull("x") === "x", true, "기본");

console.log(`ok ${ok} bad ${bad}`);
process.exit(bad ? 1 : 0);
