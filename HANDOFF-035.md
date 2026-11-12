# HANDOFF-035 (v35 · 2026-11-12)

## 상태
- 구현 · 시험은 끝났어요. **실제 사이트에는 아직 적용하지 않았어요.** 올리는 순서는 `UPDATE-035.md`.
- 기준: GitHub 최신본(v34.4 · 커밋 `1605d6d`).
- 목업(사용자 확인): claude.ai 캔버스 'v35 목업 — 콘티 곡 추천 기준'. 확인 뒤 바뀐 것은 세 가지예요. ① 추천 줄의 키 칸은 빼고 키는 비워 둠(키 단추 숫자로만 안내) ② 싱어 칩은 유지 ③ + 단추는 키 칸 크기로.

| 구분 | 파일 |
|---|---|
| DB | `supabase/migration_034.sql` — `lineup_rows()`에 member_id(6번째) · `edit_sheet` 지우기 경로 고침 |
| HTML | 6개 모두 `?v=40` |
| JS | `conti.js`(추천 · 키 단추 · 리더십 콘티 목록) · `history.js`(라인업 member_id · `D.lu`) · `admin.js`(태블릿 접힌 메뉴 · 인라인 style) |
| CSS | `ui.css` 맨 끝: 'v35 곡 추천' 층 · 'v35 화면별 정리'(콘티 목록 · 고르는 카드 · 카드 제목) · `x2-*`(인라인 style) · `.hidden` 다시 |
| 문서 | `UPDATE-035.md` · `CHANGELOG.md` · 이 파일 |
| 시험 · 도구 | `dev/tests/v31/run.py`(`rec_tests` 새로) · `h.py`(`ca_row` · `ca_more`) · e2e v22 · v23 · v24 · v25 · v26 · v29(콘티 목록 줄 · 더보기, v23 · v24 · v25 백업찬양 따라가기를 033 악보 보기 기준으로) · `v32/run_video.py`(상대 날짜) · `dev/v34/capture.py`(기록 화면 추가) · **새**: `dev/v34/inline_to_class35.py` |

## 들어간 것 · 어디에

### 곡 추천 (conti.js `openEditor` 안 'v35: 곡 추천' 구역)
- 모듈 위쪽: `KEY_SP` · `keyParts(k)`(키 → 해 본 키 목록 · 같은 소리 한 이름(KEY12 철자: C# · Eb · F# · Ab · Bb) · 전조 둘 다 · 단조 'm') · `recPid(x)`(member_id 또는 mid → `m:…`, 없으면 호칭 뺀 이름 `n:…`) · `ini1(name)`(얼굴 점 한 글자).
- `recData()` → `E.rec = { P, co, since }`(한 번만): 최근 365일 `H.plays`를 날짜 → Map(sid → Set(키)), `H.lu`(날짜 → 라인업 행)와 맞춰 **사람 → Map(sid → { n, keys: Map(키 → 번), last })**. `co`는 같은 날 콘티 동시 출현(예전 coSuggest와 같지만 1년).
- `recPeople(g)`: `svc.lineup`에서 무리(`band` · `singer` · `all` · 인도자는 all만)별 사람(같은 사람 한 번).
- `coSuggest()` · `lineupSuggest(g)`(해 본 사람 수 → 횟수 → 최근 · 8곡) · `memberSuggest(pid)`(횟수 → 최근 · 8곡) · `covHTML`(얼굴 점 k/o/빈칸 · 기준 = 그 곡을 가장 많이 한 키) · `keyWho(sid)` · `keyWhoHTML(x)`.
- `searchHTML()` 빈 검색 → `.ce2-sug` 서랍 머리 '곡 추천 · 기준 이름(닫힘) / n곡(펼침)' + `recHead()`(`.ce3-seg` 기준 셋) + `recBody()`.
- 상태: `E.recMode`(co · lineup · member) · `E.recG`(band · singer · all) → `localStorage pole2.ce.rec`. 처음엔 라인업이 있으면 lineup. `E.recWho`(멤버별 고른 사람 · 저장 안 함 · 기본 = 밴드 첫 사람).
- 이벤트: `data-ce="rec-mode" data-m` · `rec-g data-g` · `rec-who data-p`.
- 키 단추: `basicTab`의 `.ce2-keys.ce3-keys` 단추마다 `<em>`(그 키로 해 본 사람 수) + `keyWhoHTML`. 숫자 기준은 위 칩 무리(`E.recG`).
- **추천에서 넣어도 `addSong`은 그대로**(곡의 주 키를 넣음). 사용자가 '키는 비워 두고 숫자로만'을 골랐는데, 평소 주 키 자동 채움까지 끄라는 뜻인지는 확인 못 했어요(아래 '다음에 볼 것').

### 기록 데이터 (history.js `build`)
- `raw.lineup` 한 줄 6번째 = member_id → `lrows[d]`의 `mid`. `D.lu = lrows`로 내보내요. 다른 화면은 안 써요.
- `migration_034` 전이면 6번째가 없어서 이름으로만 맞춰요(깨지지 않음).

### 리더십 찬양 › 콘티 목록 (conti.js `mountUpcoming` · `mountPast`)
- 표(`.ca-table`) → `.ca-list > .ca-row[data-sid]`(`.ca-main` 제목 · 칩 · 한 줄 설명 / `.ca-acts2` 악보 · 쓰기|고치기 · `.ca-more`).
- `moreMenu(s)` = `UI.sheet({ cls: "ca-sheet" })` 안 `.ca-mi[data-ca]`(copy · applied · order · meta · communion). 시트에서 누르면 닫고 `act(s, a, b)`. 기본값 저장은 `onSet`.
- 쓰기 단추: 배치가 공개됐거나 콘티가 있으면 primary, '배치 전'은 ghost.

### 그 밖의 정리
- 고르는 카드(`.sat-tab` · `.vpills button` · `.resp-pick button`): 고른 것 = `--accent` 바탕 + `--primary` 테두리(안쪽 1px 더).
- 태블릿 접힌 메뉴(admin.js 문서 click): `NAV.shut` + 레일 + `(hover: hover)` 아님 + 메뉴 둘 이상 + 그 영역 메뉴가 안 떠 있으면 → `adFly(area)`. 한 번 더 누르면 `adGoArea`.
- `.panel h2 small` 500 · 휴대폰에서 줄바꿈.
- 인라인 style: `inline_to_class35.py`가 두 번 이상 나오는 고정값을 `x2-1…65`로(이미 있는 `x-*`와 같은 값은 그것으로). **`!important`**를 붙였어요(인라인처럼 이기도록). 그래서 `.hidden`을 맨 끝에 한 번 더 둬요(인라인일 때도 `.hidden !important`가 이겼어요). `x2-22` · `x2-61`은 min-height를 빼서 입력칸 34 기준을 따라요. 남은 인라인은 admin.js 209 · me.html 53 · conti.js 10(값이 제각각이거나 `${…}`).
- 응답 마감 날짜 칸 두 곳에 `.input` 붙임(16/40 → 14/34).

## 검증
- `node --check` conti.js · admin.js · me.html 안 스크립트
- 하네스(가짜 sb): v31 unit 16/16 · **v31 run 114/114**(추천 새 시험 22개: 기본 기준 · 무리 칩 수 · 순서 · 1년 밖 제외 · 줄 설명 · 얼굴 점(Db = C# 묶음) · member_id로 예전 이름 같은 사람 · 싱어 칩 · 멤버별 순서 · 넣어도 키 그대로 · 넣은 곡 빠짐 · 키 단추 숫자 · 지금 키/다른 키로만 · + 단추 28 = 키 칸 · 기기 기억 · 라인업 없음 빈 상태 · 휴대폰 가로 넘침 없음) · v32 unit 50/50 · sync 21/21 · **run_video 47/47**(fixture 상대 날짜로) · run_bk 29/29 · pedal 22/22 · v33 unit 22/22 · sync_rule 4/4 · run_seg 12/12 · run_songs 17/17
- `migration_034` 실제 DB: `lineup_rows()` 6칸 · 이름을 '공준혁 전도사님'으로 바꾼 예전 행에도 member_id
- 실제 스택 e2e(PG16 + PostgREST 12.2.3 + server.mjs · 034까지 · 시험마다 새 DB)

| 시험 | v34.3 기준 | v35 |
|---|---|---|
| e2e v21 | 기록 hero 숫자 3개 | **같은 3개만**(데이터 수 기대값이 v33부터 낡음) |
| e2e v22 | 108/108 | **108/108** |
| e2e v23 | 팀원 따라가기(408줄)에서 멈춤 | **136/136** (따라가기를 악보 보기 기준으로 다시 씀) |
| e2e v24 | 백업찬양 `_iv` 멈춤 | **96/96** (끝까지) |
| e2e v25 | FAIL 1 + 536줄 멈춤 | **161/161** (끝까지 · '원본 지우기 shared file'은 `migration_034` edit_sheet 고침으로 통과) |
| e2e v26 | 110/110 | **110/110** |
| e2e v28 | 136/136 | **136/136** |
| e2e v29 | 148/148 | **148/148** |

- 캡처 전후(`dev/v34/capture.py` · PC 1280 · 태블릿 820 · 휴대폰 390): 인라인 style 정리 뒤 멤버 · 대시보드 화면은 바뀐 곳 없음(시각만), 바뀐 곳은 의도한 것(콘티 목록 · 고르는 카드)뿐.
- `dev/v34/audit.py`(26화면): 줄 안 단추 · 주 행동 · 키 · 탭 · 세그먼트가 한 조합씩. 콘티 목록 더보기 32 = 줄 안 단추.
- 스택 세우기는 HANDOFF-034.3과 같아요. `EXTRA=migration_034 SITE=<저장소> bash dev/v34/reset_stack.sh`. `pgrst.conf`는 저장소에 없고 프로젝트 문서 `worship-platform/dev/pgrst.conf`에 있어요.

## 다음에 볼 것
- **곡의 주 키 자동 채움**: 지금은 곡을 넣으면(추천이든 검색이든) 주 키가 들어가요. 키를 아예 비워 두길 원하면 `addSong`의 `key:` 한 줄만 바꾸면 돼요.
- 추천 기간(1년) · 개수(8곡)는 상수예요(`recData` `-365` · `slice(0, 8)`).
- 남은 인라인 style(admin.js 209 · me.html 53), 로그인 · 지원서 입력칸 16px(이 페이지는 의도적으로 그대로).
- 미뤄 둔 것(그대로): 인도자가 지운 악보 파일(저장소에 남음) · 아이폰 자동 완성 · 실연주 우선 여부.
