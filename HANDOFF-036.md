# HANDOFF-036 (v36 · 2026-11-14)

## 상태
- 구현과 시험은 끝났어요. **실제 사이트에는 아직 올리지 않았어요.** 올리는 순서는 `UPDATE-036.md`에 있어요.
- 기준: GitHub 최신본(v35 · 커밋 `5af9082`).
- 양육 플랫폼 쪽 파일: `api/grades.js` 1개 + `UPDATE-024.md`(양육 저장소에 따로 올려요).

| 구분 | 파일 |
|---|---|
| DB | `supabase/migration_035.sql` — part_sheets/part_picks 대상 셋 · can_upload_object · prayers.anon + 이름 칸 막기 + `prayer_rows()` · nurture_grades · nurture_sync |
| HTML | 6개 모두 `?v=41` |
| JS | `conti.js`(PARTS 대상 셋 · viewerItems `pt` · 악보 받기) · `ink.js`(pageImage `o.memo`) · `history.js`(곡 카드 → 곡 상세) · `admin.js`(나눔 관리 prayer_rows · 양육 등급) · `me.html`(기도제목 익명) |
| API | `_nurture.js`(새) · `members-bulk.js`(`nurture-sync`) · `cron.js`(5시) · `notify.js`(급한 기도 익명) |
| CSS | `ui.css` 맨 끝 'v36' 층 |
| 시험 | `dev/tests/e2e_v36.py`(새) · `dev/tests/v36/db.sql`(새) · `dev/v34/reset_stack.sh`(034를 기본에) |

## 들어간 것 · 어디에

### 파트 악보 대상 (conti.js `PARTS`)
- `pt` = `s:곡` · `p:worship_proc.id` · `x:service_extras.id`. `ptNorm`(숫자만 주면 곡) · `ptCol` · `ptOf(파트 악보 행)`.
- `viewerItems`: 콘티 곡 · 진행곡(`x.id`가 있을 때) · 특별순서에 `pt` · `rawKey`. 악보 보기는 `x.song` 대신 `x.pt`로 판단(`partsFor` · `drawPart` · `partMenu` · `setAlt` · 처음 불러오기).
- `part_picks.tgt`는 생성 칼럼(`s:` · `p:` · `x:`) · 기본 키 (member_id, service_id, tgt) · upsert onConflict `member_id,service_id,tgt`.
- 진행곡을 지우면(행 삭제) 그 파트 악보 · 고른 기록도 같이 지워져요(cascade). 저장소 파일은 남아요(예전과 같은 정책).
- 곡 상세(`songDetail`)는 그대로 `PARTS.list([곡 id])` · `PARTS.upload(곡 id, …)`.

### 기록 › 곡 (history.js)
- `songCard`(곡 탭)와 `songRow`(다른 곳)에 `data-sid` · `.hx-open`. `mount`의 클릭 · Enter에서 `CONTI.songDetail`. a · button · summary · details 안쪽 · 입력칸은 제외.

### 악보 받기 (conti.js 'v36: 악보 받기' 구역 · `songDetail` 바로 위)
- `exportSheet({ items, title, cur, pick })` — 악보 보기와 같은 items. 쪽 그림 `pageCanvas` = `INK.pageImage(pg, 1500, { memo })`(공유 필기는 `pg.shared`를 비워서 끔).
- `exportService(svc, { song })` = `svcItems`(viewerItems + 백업찬양 + 내가 고른 파트 악보로 바꿔치기) → `exportSheet`.
- 두 단계: 만들기(진행 쪽 수 표시) → 저장하기(사용자 누름 → `navigator.share` 가능하면 공유 창 · 아니면 내려받기 · 여러 장이면 `zipStore` 압축 없는 zip).
- 공유 창은 휴대폰 · 태블릿에서만(`mobileShare`). PC에서 공유 창이 뜨면 오히려 불편해서.
- 설정 기억: `localStorage pole2.export`(형식 · 공유 필기 · 내 메모).
- 진입: 콘티 카드 `[data-cv-export]`(공개된 콘티) · 곡 서랍 `[data-cv-sxp]`(공개 + 악보 있는 곡) · 악보 보기 `[data-cvv="export"]`.
- `window.CONTI.exportSheet` · `exportService` 공개.

### 익명 기도제목
- DB: `revoke select on prayers` → `grant select (id, body, urgent, week_of, created_at, updated_at, hidden_at, anon)`. 수정 · 숨기기 RLS(author_id)는 그대로 동작해요(시험 확인).
- `prayer_rows(p_from)`: 익명이면 리더십 · 올린 사람 · 주인이 아닌 한 member_id · author_id = null. `mine` = 올린 사람이거나 주인. 숨긴 것은 리더십만. hidden_by는 리더십만.
- 트리거: 올린 뒤 anon 바꾸기 거부.
- me.html `pwho(p)` · 폼 줄마다 `data-anon` · 인원 수는 익명을 따로 셈.
- admin.js 나눔 관리: `prayer_rows('2000-01-01'…)` · '익명' 칩 · 거르기 `by=anon`.
- notify.js: 익명만이면 '{대상}님을' → '익명으로 올라온 기도제목을'(`anonFix`).
- **표를 직접 `select("*")`하는 코드는 이제 팀원 · 리더십 모두 실패해요.** 새 화면에서 기도제목을 읽을 땐 `prayer_rows`를 써 주세요(서버 service_role은 상관없음).

### 양육 출석 등급
- 양육 `api/grades.js`: `x-share-key` = `GRADE_SHARE_KEY`(16자 이상, timingSafeEqual) → `{ as_of, people: [{ phone(숫자만), grade }] }`. 등급 = 명단과 같은 계산(attendance_summary 전체 기간 'sun' → 없으면 base_rate → grade_cuts). left · 번호 없음 · 등급 없음 제외.
- 찬양팀 `api/_nurture.js` `nurtureSync(db, { by })`: 활동 팀원(수습 포함) 번호 숫자만 비교 · 같은 번호에 다른 등급이면 못 찾음(이유) · 등급이 바뀌면 prev_grade/changed_at · 못 맞춘 사람 행 삭제 · `nurture_sync` 한 줄 기록(실패하면 ok=false + error만 바꾸고 예전 matched · missing은 그대로).
- 부르는 곳: cron 5시(`nurtureReady()`일 때만) · members-bulk `nurture-sync`(리더십).
- admin.js: `loadNurture`(60초 캐시) · `ngChip` · `nurtureBox`/`bindNurture`(멤버 › 활동 · 정식 · 수습 화면 아래) · 상세 `.ng-kpi` · 대시보드 출석 칸 `ngLows`(C·D·E).
- Vercel 함수 수: 찬양팀은 12개 그대로(새 기능은 members-bulk에 넣고 `_nurture.js`는 `_`라 함수가 아님). 양육은 7개.

## 검증
- `node --check` 모든 assets · api · me.html · admin.html 안 스크립트
- DB(`dev/tests/v36/db.sql`, 034까지 + 035, 실제 PG16): 진행곡 · 특별순서 · 곡 파트 악보 올리기 / 두 곳 동시 · 다른 경로 · 남의 파트 거부 / 업로드 경로 권한 / picks upsert / 진행곡 지우면 cascade / 기도제목 이름 칸 직접 읽기 거부 · `select *` 거부 · prayer_rows 가림(팀원 · 주인 · 올린 사람 · 리더십) · 올린 사람 수정 · 익명 바꾸기 거부 · 남의 글 수정 0줄 · 숨기기 / 양육 등급 팀원 0줄 · 쓰기 거부 · 리더십 읽기. 035 두 번 실행 OK.
- **e2e v36 58/58**(실제 스택): 진행곡 · 특별순서 파트 악보 올리기 · 고른 것 기억 · 드럼에게 안 보임 / 기록 › 곡 → 곡 상세 → 미리 올리기 · 레퍼런스 펼치기는 상세 안 엶 / 악보 받기 PDF 쪽 수 · 이미지 zip(곡 하나 끔) · 곡 서랍 한 곡 · 악보 보기 단추 '이 곡만' · 휴대폰 가로 넘침 없음 / 익명 기도제목 저장 · 내 카드 · 다른 팀원 카드 · REST 직접 읽기 거부 · 대신 올린 익명 주인에게 보임 · 급한 기도 알림 이름 없음 · 나눔 관리 실제 이름 + 거르기 / 양육 가짜 서버 → 지금 가져오기 3명 · 목록 칩 · 못 찾은 팀원 · 다시 가져오기 C→D · 팀원 못 읽음 · 못 부름 · 상세 C → D · 대시보드 C 이하만 · 키 틀림 502 + 예전 등급 유지 + 칸에 오류 · 환경변수 없음 400.
- 양육 `grades.js` 단위(가짜 db): 키 없음 · 틀림 401, 번호 숫자만 · 기록 · 엑셀 출석율 · 부재 E, 환경변수 없음 500.
- 회귀(실제 스택, 035까지): e2e v22 108 · v23 136 · v24 96 · v25 161 · v26 110 · v28 136 · v29 148 — 모두 통과.
- 하네스(가짜 sb): v31 unit 16 · run 114 · v32 bk 29 · pedal 22 · video 47 · v33 seg 12 · songs 17 — 모두 통과.
- 스택: `EXTRA=migration_035 SITE=<저장소> bash dev/v34/reset_stack.sh`. e2e v36은 `server.mjs`를 환경변수(NURTURE_*)와 함께 다시 띄우고 8799에 가짜 양육 서버를 둬요. 필요한 것: /home/claude/pgrst(postgrest 12.2.3 · pgrst.conf · server.mjs · node_modules pg), /home/claude/shim.sql(=dev/v34/shim.sql), /home/claude/libs(pdfjs-dist@3.11.174 · pdf-lib@1.17.1), /home/claude/tests(h.py · mkfx.py로 fx), /home/claude/wp → 저장소.

## 다음에 볼 것
- 실기기: 아이폰 · 아이패드 공유 창 저장(파일 · 사진), PWA(홈 화면 앱)에서 내려받기.
- 악보 받기 큰 콘티(20쪽 넘게)에서 휴대폰 메모리 · 시간 — 쪽 폭 1500px 고정이에요(`pageCanvas`).
- 적용찬양 · 백업찬양 파트 악보(이번엔 뺌).
- 기록 › 곡에는 부른 적 없는 곡이 안 나와요. 새 곡에 미리 올리려면 리더십 곡 목록(곡 상세)에서.
- 양육 등급 '못 찾은 팀원'이 많으면 번호 정리(어느 쪽이 맞는지 리더십이 판단).
- 미뤄 둔 것(그대로): 곡 주 키 자동 채움 여부(v35 질문) · 인도자가 지운 악보 파일 · 아이폰 자동 완성.
