# HANDOFF-031 (v31 · 2026-11-07)

## 상태

구현과 시험은 끝났어요. 실제 사이트 적용 · 실기기 확인은 아직이에요.

- 기준: GitHub 최신본(v30.1).
- 받은 묶음: `v31-update.zip`

| 구분 | 파일 |
|---|---|
| DB | `migration_030.sql` |
| 화면 | `assets/conti.js` · `ink.js` · `backup.js` · `admin.js` · `share.js`(v30.css 번호만) · `v31.css`(새 파일) · HTML 6개(?v=33) |
| API | `api/conti.js` · `api/notify.js` |
| 문서 | `UPDATE-031.md` · `CHANGELOG.md` |
| 시험 | `dev/tests/v31/`(가짜 sb + Playwright · 단위) · `dev/tests/v31_db/`(PG16 스텁) |

## 들어간 것 · 어디에

### 악보 없이 올리기 · 처음 채워진 악보 알림
- **conti.js `submit`**
  - '새로 저장' 이름 검사는 통합본(E.up)이 있고 계획이 `new`인 곡만 해요.
  - 통합본 없이 올리는 경우의 confirm은 없앴어요.
- **`sheetlessCount()`**: 바(#ceBar)에 '악보 없는 곡 N곡'을 보여요.
- **'악보 저장'(sheetsOnly) 뒤** `meApi("/api/conti", { action: "sheet-notify" })`를 불러요.
- **api/conti.js**
  - `sheetSongs(sl)`: 악보 있는 곡 = `sheet_id` 또는 `page_from`이 있는 곡이에요. `join_prev`인 곡은 빼요.
  - `tellFilled(db, s, sl, have, me)`: `setlists.sheet_told`에 없는 곡만 알려요. 이때 `conti_edit` 설정을 쓰고, 문구 `{바뀐 것}`은 "악보 올라옴: …"이에요. deliverOnce 키는 `conti-sheet:<setlist>:<song ids>`예요.
  - `sheet_told`가 null이면 지금 상태를 기준으로 삼고 알리지 않아요.
  - `notify`: 처음 올림 · 일반 수정 · 지난 예배 · 알림이 꺼진 경우 모두 `sheet_told = 지금 악보 있는 곡`으로 맞춰요. 악보 · BPM만 바뀐 경우에는 `tellFilled`로 갈라져요.
  - 새 action `sheet-notify`: 그 예배 라인업이나 리더십만 부를 수 있어요.
- **migration_030**
  - `setlists.sheet_told bigint[]`를 더하고, 올라온 콘티는 지금 상태로 채워요.

### 원본 악보 지우기 · 사진으로 원본
- **migration_030**: `edit_sheet`를 다시 썼어요.
  - 지우기는 올라온 콘티에 쓰인 악보만 막아요. 임시 저장 콘티에 쓰인 건 FK `on delete set null`로 풀려요.
  - 같은 path를 쓰는 다른 행(필기본)이 있으면 `path`를 null로 돌려줘요. 그러면 파일을 지우지 않아요.
  - 빈 이름으로 이름 바꾸기는 막아요.
- **conti.js**
  - 곡 상세 · 메들리 상세의 원본 줄에 `data-sheet-del`을 달았어요(`up` = can_upload_sheet). 문서 전체 클릭(capture)으로 처리해요.
  - 저장소 remove는 리더십만 돼요(정책). 올린 사람이 리더십이 아니면 파일은 남아요.
  - `#sdOrig` · `#mdOrig`는 `accept="application/pdf,image/*" multiple`이고, `filesToPdf`를 써요.

### 레퍼런스 앱 안 재생 (conti.js)
- 모듈 위쪽: `playRef(id, start, end, title)`(.ytp 창, youtube-nocookie embed) · `playAttrs()` · `ytThumb()`. 문서 전체 `[data-play]` 클릭을 capture로 받아요.
- 편집기 곡 줄은 `refChip()`, 펼침 후보는 `refCands()`(`data-ce="ref-use"`)예요.
- 펼침을 열 때 후보 영상 제목을 `loadYt`로 가져와요. `yt_videos` select에 `title`을 더했어요.
- 곡 찾기 `searchHTML`: `.ce-orow` > `.ce-o` + `.ce-oplay`.
- 팀원 콘티 카드 `.cv-yt`, 곡 상세 · 메들리 상세 `.hx-yt`에 playAttrs를 달았어요(href는 그대로 남겨 둬서, 혹시 안 될 때 대신 열려요).

### 아이폰 고르기 창 (conti.js)
- `IOS` 감지(아이패드 데스크톱 모드 포함) → accept에 pdf와 image가 같이 있는 file input을 누르면 `pickFrom(inp)` `.fpick` 창이 떠요.
- '사진 보관함'은 accept를 잠깐 `image/*`로 바꾼 뒤 `inp.click()`. change가 오거나 60초가 지나면 원래대로 돌려요. `data-fp-go`로 다시 걸리지 않게 해요.

### 사역 연습 취합 같이 열기 (admin.js · api/notify.js)
- 사역 추가 창 `#pOpenNow`(새 사역 · 가능 시간 취합일 때만, 기본 켬) → insert에 `poll_open`.
- `askMinOpenPush` 문구를 바꿨어요. notify.js `minopen` 본문에 취합이 열려 있으면 " · 가능하면 연습 시간도 칠해 주세요"를 붙여요.

### 팀원 위쪽 탭 (me.html · v31.css)
- `stickTabs()`: showView · resize 때 `--stick-top = subnav의 top + 높이`를 넣어요. scroll이 2px을 넘으면 `body.m-scrolled`.
- v31.css: `.m-subnav` 아래 여백 10px, 붙었을 때 그림자, `#wsHist .hx-tabs { top: var(--stick-top) }`.

### 백업찬양 후보 편집 (backup.js)
- 인도자 화면의 `.bk-slots.edit`: `.bk-slot[data-slot]` 안에 `.bk-slot-v`(보기) · `.bk-grip`(☰) · `.bk-slot-x`(✕).
- `setCands(next)`: 고르기와 같은 250ms debounce → `backup_update`.
- `onSlotDrag`(root.onpointerdown)는 window에서 pointermove · up을 들어요. DOM을 옮기면 포인터 캡처가 풀리기 때문이에요.
- `data-bk="clear"`는 confirm 뒤 [].

### 부분 지우개 (ink.js)
- pref `er`("stroke" | "part") · `esz`(ER_SIZES 6 · 12 · 22 화면 px).
- `cutStroke(st, x, y, r)`: 선분을 r/3 간격으로 나눠 원 안 점을 빼요. 원래 꼭짓점과 끊긴 끝점만 남겨요. 조각에는 cid · author를 넣지 않아요.
- **메모**: 문지르는 동안 `V.strokes`를 바로 바꾸고, 시작할 때 사본을 떠 둬요 → undo `{ t: "snap", before }`.
- **공유**: 문지르는 동안 `V.shared`만 바꾸고 `er.dels`(원래 cid) · `er.adds`(새 조각)를 모아요. 손을 떼면 del · add shOp → undo `{ t: "cut", dels, adds }`(adds del + dels undel).
- 문지르는 동안에는 공유 필기를 새로 불러오지 않아요(`!V.erasing`).

## 검증

- `node --check` 모든 assets · api 통과.
- **PG16 스텁** (`dev/tests/v31_db`): 030을 두 번 실행했어요.
  - sheet_told 채우기(메들리 뒷곡 제외 · 임시 콘티는 null)
  - edit_sheet: 남은 막힘 · 올라온 콘티 막힘 · 임시 콘티는 null로 · 필기본 path 공유 시 path null · 빈 이름 막힘
- **단위** (`node dev/tests/v31/unit.mjs`, 16 통과): cutStroke(가운데 · 끝 · 점 · 직선 · 안 닿음) · sheetSongs · tellFilled(새 곡만 · 중복 키 · 이미 알린 곡 · null 기준 · 지난 예배).
- **Playwright + 가짜 sb** (`python3 dev/tests/v31/run.py`, 59 통과)
  - 콘티 쓰기: 미리 보기 · 칩 · 구간 · 후보 · 이 영상으로 · 악보 없이 올리기(확인 창 없음) · 알림 호출
  - 밴드 악보 저장 → sheet-notify
  - 아이폰 UA 고르기 창(사진 → image/*, 파일 → 원래대로, 취소) · 안드로이드는 창 없음 · 원본 지우기
  - 백업찬양 ✕ · 끌기 · 모두 비우기
  - 부분 지우개(메모 · 공유 · 되돌리기 · 획 지우개)
  - pdf.js · pdf-lib는 `/home/claude/libs`에 npm으로 받아 route로 대신했어요.
- 탭 여백은 `dev/tests/v31/tabs.html`로 390 · 820px에서 확인했어요(기록 탭 줄이 subnav 바로 아래 · 그림자).
- **못 한 것**
  - 실제 Supabase 전체 e2e
  - 실제 아이폰 사파리 file picker 동작
  - 사역 추가 창 화면 시험(admin.js 전체를 띄우지 못함 — 코드만 확인)

## 다음에 볼 것

- 실기기 확인 목록은 UPDATE-031 맨 아래에 있어요.
- 부분 지우개로 남의 획을 자르면 조각의 쓴 사람이 지운 사람으로 바뀌어요. 원래 쓴 사람을 남겨야 하면 ink_put에 author 지정(리더십만)을 더해야 해요.
- 부분 지우개 조각은 새 id라 쓴 순서(z-order)상 맨 위로 올라가요. 수정 테이프 아래 있던 펜 획을 자르면 그 조각이 테이프 위로 보일 수 있어요(드문 경우).
- 아이폰 자동 완성으로 입력 칸이 채워지는 문제(공지 · 투표)는 이번에 빼기로 했어요. 아직 남아 있어요.
