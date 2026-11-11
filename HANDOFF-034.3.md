# HANDOFF-034.3 (v34.3 · 2026-11-11)

## 상태
- 구현은 끝났어요. 시험 결과는 아래 '검증'에 있어요. **실제 사이트에는 아직 적용하지 않았어요.** 올리는 순서는 `UPDATE-034.3.md`.
- 기준: GitHub 최신본(v34.2 · 커밋 `739de8b`).
- PLAN-034의 3단계가 이걸로 끝이에요. 다음은 실기기 확인 뒤 남은 '화면별 정리'(아래 '다음에 볼 것').

| 구분 | 파일 |
|---|---|
| DB | 없음 |
| HTML | `admin.html`(구조 새로) · 6개 모두 `?v=38` |
| JS | `admin.js`(메뉴 B안 모듈 · 대시보드 · 뼈대 로딩 · 페이지 탭) · `conti.js`(추천 서랍) |
| CSS | `ui.css` — 맨 끝 'v34.3' 층(줄 안 단추 · 추천 서랍 · `ad-*` 셸 · 대시보드 `steps` · `x-*` 유틸) · 옛 `.side`/`.nav-*`/`.ce-x`/`.ce-shsel`/`.ce-more*` 규칙 지움 |
| 문서 | `UPDATE-034.3.md` · `CHANGELOG.md` · 이 파일 |
| 시험 · 도구 | `dev/tests/h.py`(`navclick` 새 메뉴) · `e2e_v21.py` · `v31/run.py`(추천 서랍) · `dev/v34/capture.py` · **새**: `dev/v34/shell_shots.py`(가짜 sb로 셸 캡처) · `dev/v34/inline_to_class.py` · `dev/v34/prune_css.py` |

## 들어간 것 · 어디에

### 리더십 메뉴 B안 (admin.html · admin.js '리더십 메뉴 B안' 구역 · ui.css `.ad-*`)
- **admin.html**: `.ad-shell` > `#adRail`(로고 · `#adRailAreas` 영역 단추 · 설정 · `#adMe` · `#adFly` 뜨는 메뉴) + `#adPw`(`.ad-panel`: `#adAreaTitle` · `#adShut` · `#adItems` · '팀원 화면으로') + `.ad-main`(`#adMtop` 휴대폰 위 막대 · `#adSeg` 세그먼트 · `#adStrip` 접힘 위치 표시 · `#content`) + `#adTab`(휴대폰 하단 탭). `#whoName`은 `.u-sr`로 남겨 뒀어요(다른 코드가 찾아서).
- **admin.js**
  - `AREAS`(key · label · menus[[nav, label]]) — 메뉴 하나를 옮기려면 여기만. `settings`는 `rail: false`(레일 아래 고정 단추).
  - `NAV` = { key, shut, sub, last, fly }. `pole2.adShut`(접힘 · 처음엔 1024px 미만이면 접힘) · `pole2.adLast`(영역별 마지막 메뉴).
  - `navSync(key)` → `adDraw()`: 레일 `.on` · 메뉴 칸 항목(`itemHTML`: `a.ad-pi[data-nav]` + `small` 상태) · 위치 표시 · 하단 탭(`.ad-tabin` 한 번만 그리고 `.on`만 바꿈 · `UI.ind`로 선택 칸 이동) · 세그먼트(영역이 바뀔 때만 다시 그림). `route()`가 `navOf`로 상세 주소를 메뉴로 접어 부름(`templates` → settings).
  - `adShut(on)` · `adFly(areaKey | "me", anchor)`(접힌 상태 hover · `(hover: hover)`일 때만 · 160ms 뒤 사라짐 · Esc) · `adGoArea(key)`(마지막 메뉴 기억).
  - **`setNavSub(key, text)`**(window에도) — 메뉴 상태 한 줄. 기본값은 `defaultSubs()`(S에서 셈), 대시보드가 이번 주 값으로 덮어써요. `updateTodoCount()`는 `#todoCount`(메뉴 칸 안) · `.ad-dot`(레일 · 하단 탭 '사람') · pipeline 상태를 같이 바꿔요.
  - 휴대폰 내 계정(`#adMeM`)은 `UI.sheet`. 로그아웃은 `[data-logout]`.
  - `PAGE_TABS`: `SERVE_TABS`(일정 | 응답) · `SET_TABS`(기본 | 안내 문구·서약서 | 백업 · 복원 | 변경 기록). MutationObserver가 `.page-head` **아래**에 붙여요(없으면 맨 위). `MAIN`에 backup · audit 추가(뒤로가기 = 대시보드). '설정으로 돌아가기' 링크는 뺐어요.
  - `route()`: 화면을 바꿀 때 `UI.skel(2, 3)`을 먼저 넣어요(제목 포함). 바로 그리는 화면은 곧 덮어써요. `renderDashboard`의 예전 '불러오는 중…' 분기는 없앴어요.
- **ui.css**: `.ad-rail` 76px sticky · `.ad-pw` 220px(접히면 width 0 · `.ad-panel` opacity 0 + **visibility hidden**(시험에서 `is_visible`이 참이 되지 않게)) · `.ad-fly` · `.ad-strip` · ≤760px: `.ad-mtop` sticky 56 · `.ad-seg` sticky 56 · `.ad-tabbar` fixed · `.content` 아래 여백 96px. 옛 `.shell`의 세로 배치 규칙은 `.ad-shell`이 덮어요(같은 특이도 · 뒤에 있어서).
- 시험 도우미 `h.py navclick(pg, key)`: 메뉴 칸에 보이면 누르고, 아니면 레일 영역 → 메뉴 칸 → 뜨는 메뉴 → 펼치기 순으로, 휴대폰 폭이면 하단 탭 + 세그먼트.

### 대시보드 '이번 주 예배' (admin.js `renderDashboard`)
- `svc` = 이번 주 주일 `services` 행, `conti = CONTI.loadOne(svc.id)`(없으면 null). `week` IIFE가 네 칸(`.steps > a.stp.{ok|wait}`)을 만들고 `setNavSub('lineup' · 'conti' · 'attendance' · 'schedule')`을 채워요. `setNavSub('dashboard', 할 일 n)`.
- 출석 칸은 지난 토요일(`lastSat`) 기준: 연습 · 팀모임 · 리허설 중 비어 있는 것.

### 단추 · 탭 크기 규칙 (ui.css 맨 끝 'v34.3 크기 규칙' 표 · 이게 마지막 말)
- 주 행동 `.btn:not(.btn-sm)` · `.u-b:not(.u-sm)` · `.btn-block` · `.bk-foot .btn` · `.praybar .btn` · `.ce-bar` 단추: 14 · 500 · 40, `(pointer: coarse)` 44. 예전 `.u-b` 44 고정 · `.btn-block` 48 · `.bk-foot` 50은 이 규칙이 덮어요.
- 줄 안 `.btn-sm, .u-b.u-sm`: 32 · 12 · 500 · `::before inset -4px`(터치 -5px)로 누르는 범위 40. svg 14. `.linkbtn` · `.cv-go`도 12 · 500. 곡 상세 `#sdPartSel` 32.
- 키 `.ce2-keys button` 40 · 14 · 500(고른 키 600). 밑줄 탭 `.tabs button` 40 · 14 · 500(고른 탭 600 · 글자색 foreground · 밑줄 2px primary). 세그먼트 `.segbar/.u-seg/.m-subnav .segbar/.ad-segbar/.ce2-tabs button` 32(터치 34) · 14 · 500. 하단 탭 `.tabbar a/button` · `.ad-tb` 52 · 11 · 500(600) · 아이콘 22.
- 예외(손대지 않음): `.bk-go` 등 백업찬양 진행 · 악보 보기 · 필기 · 메트로놈 · 페달 · 입력칸 16.
- 확인 도구 `dev/v34/measure.py`: 콘티 쓰기(태블릿 · 휴대폰) · 리더십 4화면 · 팀원 4화면에서 종류별 '글자/굵기/높이' 조합을 출력해요. 새 화면을 만들면 여기서 조합이 하나씩만 나오는지 보면 돼요.

### 추천 서랍 (conti.js `searchHTML` · `data-ce="sug"` · ui.css `.ce2-sug*`)
- `E.sugOpen`(기본 false · 편집기를 여는 동안만). 머리 `button.ce2-sugh[aria-expanded]` + `.ce2-sugl#ceSugList`. 검색어가 있으면 예전처럼 결과 목록.

### 인라인 style → `x-*` (dev/v34/inline_to_class.py)
- 자주 쓰던 36가지를 유틸로. 동적 class(`${…}`)가 있는 태그는 건너뛰어요. 남은 인라인(admin.js 333)은 값이 제각각이라 그대로예요.
- 옛 CSS 정리(dev/v34/prune_css.py): 선택자에 `.side` · `.nav-*` · `.ce-x` · `.ce-shsel` · `.ce-more*`가 든 규칙 97개 지움(tinycss2로 파싱 확인 · 2679 → 2586 규칙).

## 검증
- `node --check` admin.js · conti.js · me.html 안 스크립트
- 하네스(가짜 sb): `dev/tests/v31/run.py` **92/92**(추천 서랍 2개 추가) · 크기 규칙 뒤 다시: v31 92/92 · v32 bk 29/29 · pedal 22/22 · v33 seg 12/12 · songs 17/17
- `dev/v34/measure.py`: 모든 종류가 표의 값 한 가지로만 나와요(주 행동 40/44 · 줄 안 32 · 키 40 · 탭 40 · 세그먼트 32/34 · 하단 탭 52).
- `dev/v34/shell_shots.py`: PC 1280(펼침 · 접힘 · 뜨는 메뉴 · 나) · 태블릿 820(접힘 기본) · 휴대폰 390(하단 탭 · 세그먼트 · 내 계정 시트) — 가로 넘침 없음 · 오류 없음. 리더십 15개 화면 PC · 휴대폰 캡처로 깨진 곳 없음 확인.
- 하네스 전체(Opus 서브에이전트로 실행): v31 unit 16/16 · v32 unit_video 50/50 · sync_video 21/21 · run_video 46 + **1 실패**(날짜 고정 fixture `2026-11-02` · 7일이 지나서 '새 영상'이 안 붙음 · v34.1 때부터 같은 것) · run_bk 29/29 · run_pedal 22/22 · v33 unit_seg 22/22 · sync_rule 4/4 · run_seg 12/12 · run_songs 17/17
- **실제 스택 e2e(v21~v29 · v34 db_delete · e2e_ui)는 못 돌렸어요.** 이 세션 환경엔 PostgREST가 없고 내려받기가 막혔어요. 다음 세션에서 `/home/claude/pgrst/postgrest`(v12.2 정적 바이너리)를 둔 뒤 `dev/v34/reset_stack.sh`로 돌려요. 시험 파일을 코드로 읽어 본 범위에서는 옛 선택자(`.side nav a`)는 남아 있지 않고, 추천 목록이 열려 있다고 가정한 e2e도 없어요. **실행해야 알 수 있는 위험**: 화면을 바꿀 때 뼈대 로딩이 먼저 들어가서, `navclick` 뒤 짧게 기다리고 내용을 읽는 시험은 타이밍 실패가 날 수 있어요(기다리는 시간을 늘리면 돼요).
- 못 한 것: 실제 Supabase · 실기기(아이폰 사파리 하단 탭 safe-area · backdrop-filter · hover 없는 기기에서 접힌 메뉴).

## 다음에 볼 것
- 실기기 확인 뒤: 남은 인라인 style(admin.js 333 · me.html 93), 각 화면의 필터 칩(`.seg`) · 화면 탭(`.tabs`) 모양이 4단계 규칙에 맞는지 한 화면씩(출석의 주 선택 카드 · 배치표 파트 탭 · 기록 `.hx-tabs`).
- 접힌 메뉴를 터치 기기(태블릿)에서 쓰기: 지금은 레일 탭 → 그 영역 첫(마지막) 메뉴로 바로 이동. 메뉴 둘 이상인 영역에서 다른 메뉴로 가려면 펼쳐야 해요. 필요하면 탭 때도 `adFly`를 띄우는 안.
- 시험 정리(그대로): v23 백업찬양 진행 · v25 원본 지우기 shared file.
- 미뤄 둔 것(그대로): 인도자가 지운 악보 파일(저장소에 남음) · 아이폰 자동 완성 · 실연주 우선 여부.
