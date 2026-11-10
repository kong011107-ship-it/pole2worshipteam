# HANDOFF-034.1 (v34.1 · 2026-11-10)

## 상태
- 구현과 시험은 끝났어요. **실제 사이트에는 아직 적용하지 않았어요.** 올리는 순서는 `UPDATE-034.1.md`에 있어요.
- 기준: GitHub 최신본(v33 포함, `pole2worshipteam-main_2.zip`과 같음).
- 다음은 **v34.2 콘티 쓰기 · 고치기 + 함께 부른 곡 추천**이에요(PLAN-034). 그 전에 v34.1을 월 · 화에 올리고 실기기 확인을 받아요.

| 구분 | 파일 |
|---|---|
| DB | `migration_033.sql` (`delete_sheet` 새로 · `edit_sheet` 권한 고침) |
| CSS | `assets/ui.css` (새 · app/v30/v31/v32.css를 합침 → 네 파일 지움) |
| JS | `assets/ui.js`(새) · `conti.js` · `share.js` · `admin.js` · `backup.js` · `history.js` |
| HTML | 6개 모두 `ui.css` 하나만 · `ui.js`는 share.html 빼고 common.js 앞 · `?v=36` |
| 문서 | `UPDATE-034.1.md` · `CHANGELOG.md` · 이 파일 |
| 시험 | `dev/v34/`(CSS 만든 스크립트) · `dev/tests/v34/`(DB · 화면) · 옛 e2e 기대값 고침 |

## 들어간 것 · 어디에

### ui.css (하나의 CSS)
- 순서: 토큰(`dev/v34/src_tokens.css`) → 원래 app → v30 → v31 → v32(글자 크기 · 굵기만 바꿈) → v34 층(`dev/v34/src_layer.css`).
- `dev/v34/build_ui_css.py`로 한 번 만들었어요. 원래 네 파일은 저장소에서 지웠으니, **이제부터는 ui.css를 직접 고쳐요.** 다시 만들 일이 있으면 `CSS_SRC=<원래 네 파일 폴더>`로 돌려요(v33 git에서 꺼내요).
- 글자 크기 바꾸기 규칙(`size_map`): 28↑→26 · 22~26→20(숫자 `b`면 24) · 20→17 · 18~19→16 · 17→15 · 16 그대로 · 15→14 · 14→13 · 12~13→12 · 11→11 · 그 아래 10.5. 굵기 700/800/900→600.
  - 그대로 둔 것(`KEEP`): `.cvv` · `.iv*` · `.ink` · `.memo` · `.bk-live/pill/pen/go/codein…` · `.metro` · `.bpm-pop` · `.pedal` · `.pt-pop`, 입력칸, app.css의 '진행 화면' · '024 내 메모' 구역.
  - me.html · admin.js의 인라인 style도 같은 규칙으로 바꿨어요(입력칸 태그는 뺌). conti.js · ink.js · backup.js 인라인은 안 건드렸어요(악보 보기 쪽).
- 토큰: shadcn 이름(`--primary` · `--secondary` · `--accent` · `--border` · `--input` · `--ring` · `--muted-foreground` · `--radius` …), 글자(`--fs-page` 20 … `--fs-cap` 11 · `--fs-num` 24/26), 모션(`--d1` 120 · `--d2` 200 · `--d3` 280 · `--d-out` 180 · `--e-out` · `--e-in`).
  - **주의**: 예전 `--muted`는 글자색으로 쓰여 와서 그대로 글자색(#6B6080)이에요. shadcn의 muted 바탕은 `--muted-bg`. 예전 `--bg`도 옅은 바탕(#F6F3FA)으로 남기고, body만 흰색이에요.
- 새 부품은 `u-` 접두어: `u-card/u-ch/u-ct/u-cd/u-ca/u-cb/u-cf` · `u-b`(u-p · u-o · u-s · u-gh · u-d · u-sm) · `u-badge` · `u-itm/u-ig/u-im/u-ic` · `u-dbx` · `u-tl/u-tli` · `u-callout` · `u-empty` · `u-key/u-num/u-icr` · `u-acc/u-coll` · `u-avs/u-av1` · `u-wsw/u-wsel` · `u-rtl/u-pg` · `u-sh/u-sheet` · `u-kv/u-lur/u-dl` · `u-sk/u-skc` · `u-stag/u-vin`.
  - 단추 기본 글자 크기는 `:where(.u-b)`로 낮춰 뒀어요.
- 휴대폰(≤699px) `.m-main` 여백 16 · `.hx-tabs` 음수 여백도 16으로 맞췄어요(20에 맞춰져 있어서 4px 가로 넘침이 났었음). 태블릿 여백은 예전 그대로예요.

### ui.js (`window.UI`)
- `sheet({title, desc, html, onClose})` → `{el, body, close}`: 휴대폰은 아래에서, 761px↑는 가운데. 배경 · Esc · 닫기. 닫힐 때 `.u-out` 180ms 뒤 지움.
- `confirm({title, msg, ok, danger})` → Promise<bool>(`.u-confirm`). `leave(el, done)` · `vt(fn)`(View Transitions) · `skel(cards, rows)` · `saved(btn)` · `ICON`.
- 세그먼트(`.segbar` · `.u-seg`)는 문서 전체에서 자동으로 흰 칸(`.u-thumb`)을 붙여 `aria-pressed` 따라 움직여요(MutationObserver · ResizeObserver). 악보 보기 안은 빼요.
- 하단 탭 알약: `UI.ind($("#tabbar"))`(me.html `renderTabbar`), `.on` 따라 움직여요.
- admin.js `modal()`의 close가 `UI.leave`로 닫혀요(그사이 새 창이 열리면 그 창은 그대로).

### 팀원 화면 (me.html)
- 탭: `renderTabbar` — 홈 · 찬양 · 섬김 · 나눔(수습은 홈 · 찬양 · 나눔). 위 막대 `#meBtn`(→ `#info`, `.on`), `#whoName`은 `.u-sr`, `#infoName` 머리글.
- 홈 `renderMemberHome`: `homeTodos()`(= `respondTodos()` 예전 배너 → 줄 데이터 + 투표), `meetingData(sat)`, 이번 주 = 다가오는 토요일 다음 날까지, `fillWeekConti(sid)`(rpc `conti_one` → `HOME.svc`로 `CONTI.openViewer`). '콘티 보기' = `deep = {v:"worship", arg:sid}` → go.
  - 불참 알리기 · 취소: `[data-home-abs]` → `UI.sheet` / `UI.confirm` → `report_meeting_absence` · `cancel_meeting_absence`(RPC 그대로).
  - 홈으로 돌아올 때 `refreshTodos()`. 수습생 홈 · `meetingCard()`(#meetCard)는 예전 그대로예요.
- `showView`: respond · lineup · pray · alerts 처음 열 때 `UI.skel`.

### 찬양 › 콘티 (conti.js `mountWeek`)
- 마크업은 `.cvw` 안: `.cvw-sw`(◀ `[data-cv-step]` · `[data-cv-weeks]` ▶) · `.cvw-conti`(`.cv-srow` · `.cv-sn` · `.cv-key` · `.cv-yt` · `.cv-slist` · `.cv-dk` · `.cv-pdfbar[data-cv-open]` 이름은 시험 호환용으로 남김) · `#cvFlow`(`.u-acc`, `[data-cv-acc]`, `.cv-bkst`, `.cvw-dim`) · `.cvw-lu`.
- 서랍: `weeksSheet` · `lineupSheet` · `songSheet(x, f, items)`(HISTORY.load · perfAt, '곡 자세히' → `songDetail`).
- 팀원은 BPM을 곡 줄 설명에 글자로, 고칠 수 있는 사람(`can_edit_sheets`)만 `.cv-bpm[data-cv-bpm]` 단추.
- 다음 순서 꼬리표는 짧은 이름(`PROC[k][1]`: 축복 · 봉헌 · 축도 …), '본 콘티' 줄은 없어요(위 카드). `appliedCard()`는 이제 안 써요(적용찬양은 다음 순서 안).
- 예배를 바꿀 때 `UI.vt`(View Transitions).

### 섬김이 링크 (share.js)
- `render()` 가운데만 바꿨어요: `.shv-sw`(◀ ▶ `[data-sv]`) · `.shv-conti` · `.shv-flow`(`.cv-prow` · `.cv-ptag` 남김). ui.js는 안 불러요. `.shv-body`에서 모션 · 누름 꺼요.

### 악보 지우기
- **DB `delete_sheet(p_id, p_service, p_dry)`**
  - 권한: `is_admin` · 올린 사람 · `added_for` 예배를 고칠 수 있는 사람 · 그 악보를 쓴 콘티 예배를 고칠 수 있는 사람 · (`p_service`를 고칠 수 있고 그 콘티에 같은 곡/메들리가 있을 때). 전체를 `coalesce(…, false)`.
  - `p_dry` → `{name, kind, uses:[{date, published}], notes, ink}`.
  - 지우기: `setlist_items` sheet_id · page_from · page_to 비움 → 올라온 콘티는 `version`/`notified_version` +1(알림 없음) · `sheet_changes` · `sheet_told`에서 악보 없어진 곡 뺌 → `sheet_notes`(s:id) 지움 → 행 지움(`sheet_ink`는 FK). `versions`(service_id → 새 version) · `path`(같은 파일을 `#꼬리`로 쓰는 행이 있으면 null) 돌려줌.
- **conti.js**
  - `delSheet(id, svcId)`: dry → `UI.confirm` → 실행 → 저장소 remove · Cache 지움. 문서 전체 `[data-sheet-del]`(곡 · 메들리 상세, 원본 + 저장된 악보, `data-sheet-svc` 선택).
  - 편집기: 고른 악보 옆 `.ce-unlink`(= sheet-none), 미리보기 '이 콘티에서 빼기' · `.ce-shdel[data-ce=sheet-del]`(sheetsOnly면 없음) → `E.sheets`에서 빼고 쓰던 줄은 `none`, `E.base`는 내가 올린 만큼(+1)만 따라감.
- `edit_sheet`도 같은 NULL 구멍이 있어서 033에서 고쳤어요. 화면은 더는 `edit_sheet`로 지우지 않아요(이름 바꾸기만).

## 검증
- `node --check` assets · api 전부, me.html 스크립트
- **실제 스택**(PG16 + PostgREST + dev/server.mjs, 마이그레이션 033까지)
  - `dev/tests/v34/db_delete.py` **20/20**: 권한(팀원 · 밴드 · 상관없는 사람 · 다른 곡) · 미리 보기 · 올라온 콘티에서 빼기 · 버전/알림 · 내 메모 · 같은 파일 · edit_sheet 고침
  - `dev/tests/v34/e2e_ui.py` **48/48**(캡처용 데이터 위): 홈 · 탭 · 프로필 · 콘티 · 서랍 · 세그먼트 · 동작 줄이기 · 섬김이 링크 · 콘티 쓰기 빼기/지우기 · 밴드 지우기 없음
  - migration_033 두 번 실행
- **회귀**(v33 원래 코드 + 원래 시험과 비교)
  - e2e v26 108/108 · v28 136/136 · v29 148/148
  - v21 · v22 · v23 · v24 · v25: **v33에서도 똑같이 실패하는 것만** 남았어요(기록 hero 숫자 3개 · 끌어서 순서 · 백업찬양 진행 4개 + 진행 화면 `_iv` 멈춤 · 원본 지우기 shared file). 멈추는 줄도 v33과 같아요.
  - harness: v31 66 · v32 video 46(+'새 영상' 1개는 날짜 고정 시험이라 v33에서도 실패) · bk 29 · pedal 22 · v33 seg 12 · songs 17 · 단위 v31 16 · v32 50 · 21 · v33 22 · 4
  - 옛 시험 기대값을 새 화면에 맞춰 고쳤어요: v21(탭 4개) · v22(예배 고르기 · 임시 저장 카드 · 수정 배지) · v23(악보 바뀜 · 다음 순서 줄) · v24 · v29(짧은 꼬리표 · 본 콘티 줄 없음) · v25(팀원 BPM 글자) · v31 run(delete_sheet 확인 창)
- **캡처 전후 비교**: 휴대폰 390 · 태블릿 820 · PC 1280 × 팀원(홈 · 찬양 · 배치표 · 응답 · 나눔 · 내 정보) · 리더십(대시보드 · 출석 · 배치표 · 콘티 · 멤버) · 섬김이 링크. 가로 넘침 없음.
- **못 한 것**: 실제 Supabase · 실기기(아이폰 사파리 View Transitions · backdrop-filter), 사역 주간 홈 타임라인(데이터 없음)

## 다음에 볼 것
- v34.2: 콘티 쓰기 화면(목업 '콘티 쓰기 · 고치기'). 이번에 넣은 빼기 · 지우기 단추 자리를 새 곡 줄 펼침(악보 탭)으로 옮겨요. `'이 기기에 쓰던 내용'`(localStorage `pole2.conti.draft.<sid>`) 그대로 읽기 시험 필수.
- v34.3: 리더십 메뉴(B안). admin.js 인라인 style 약 530개 정리, conti.js `mountAdmin` 쪽 '불러오는 중'은 이번에 뼈대로만 바꿨어요.
- 저장소 파일 지우기는 리더십만 돼요(정책). 인도자가 지운 악보 파일은 남아요 → 필요하면 서버(api)에서 지우게 바꿔요.
- 미뤄 둔 것(그대로): 아이폰 자동 완성(공지 · 투표), 실연주를 팀 기준보다 우선할지, 부분 지우개 조각의 쓴 사람
