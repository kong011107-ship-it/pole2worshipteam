# HANDOFF-034.2 (v34.2 · 2026-11-11)

## 상태
- 구현과 시험은 끝났어요. **실제 사이트에는 아직 적용하지 않았어요.** 올리는 순서는 `UPDATE-034.2.md`에 있어요(목 ~ 토).
- 기준: GitHub 최신본(v34.1 포함, 커밋 `0178019`).
- 다음은 **v34.3 리더십 메뉴(B안) + 대시보드 + 화면별 정리**예요(PLAN-034).

| 구분 | 파일 |
|---|---|
| DB | 없음 |
| CSS | `assets/ui.css` — 하단 탭 `.u-ind`(B안) · 맨 끝 'v34.2 콘티 쓰기' 층(`ce2-` 접두어) |
| JS | `assets/conti.js` — `openEditor` 안의 화면 함수 · 이벤트만 |
| HTML | 6개 `?v=37` |
| 문서 | `UPDATE-034.2.md` · `CHANGELOG.md` · 이 파일 |
| 시험 | `dev/tests/v31/run.py`(새 시험 24개 · 임시 저장 읽기) · v22 · v23 · v25 · v26 · v32 video · v33 seg · v34 e2e_ui 기대값 고침 · `dev/v34/src_layer.css`(하단 탭만 같이 고침) |

## 들어간 것 · 어디에

### 하단 탭 선택 표시 (ui.css)
- `.u-ind`: `top:0; bottom:0; padding:0 3px` → 버튼 칸 전체. `.u-ind i`: `flex:1; max-width:120px; border-radius: var(--radius)`. ui.js `placeInd`는 그대로(버튼 폭 · 위치만 따라감).

### 콘티 쓰기 (conti.js `openEditor`)
**데이터 · 로직은 그대로예요**: `E.items` 모양, `regroup` · `recompute` · `persist`(`pole2.conti.draft|sheets.<sid>`) · `submit` · `planSheets` · 알림 · 업로드. 화면 함수만 바꿨어요.
- 화면: `sumCard()`(예전 `rtCard`) · `rowHTML(x, i)` → `basicTab` · `sheetTab` · `refTab` · `bpmTab`(밴드) + 예전 `refChip` · `refCands` · `prevField` · `bpmCell` · `sheetList` 그대로 · `searchHTML()` · `pdfHTML()`(겉 카드만) · `draw()` · `drawBar()`
  - 예전 `rowSheetHTML` · `sheetlessCount` · 줄 안 `.ce-shsel` · '메모 · 레퍼런스 · 메들리' 더보기는 없앴어요.
- 상태: `E.open` = 펼친 줄(예전엔 악보 목록 열림), `E.tab` = 탭(`basic|sheet|ref|prev`, 밴드 `sheet|bpm`), `E._plan` = draw 때 `planSheets` 한 번, `E.co` = 함께 부른 횟수 표(한 번 계산).
- 새 동작(`data-ce`): `toggle`(줄 머리 · Enter/Space) · `tab` · `key`(`data-k`) · `join`(곡 사이 '이어서 부르기') · `up` · `down` · `jump-sheet`(요약 칩) · `sheet-fix`(고른 악보 필기 — `addFile`과 같은 `openViewer` 인자)
  - 예전 이름은 남겨 뒀어요: `more` → 기본 탭, `sheet-open` → 악보 탭. `data-f` 입력(key · dur · memo · diff · bpm · meter · refurl · rs · re · sheetname · join)도 그대로예요.
- 도우미: `bareIdx()`(악보 없이 나갈 줄 = 예전 `sheetlessCount` 규칙) · `moveItem(from, to)`(위로 · 아래로 · 끌기 같이, 통합본 쪽 표시 따라감) · `setJoin(x, on)`(예전 체크 상자 규칙) · `afterOpen(i)`(레퍼런스 탭이면 후보 영상 제목) · `precheck()`(달라 보이는 악보 · 새 악보 이름) · `pubDialog(btn)`
- 올리기: `publish` → 지난 예배면 바로 `submit` · 아니면 `precheck()` → `pubDialog` → `[data-pub=go]` → `submit(true, btn, false, { copy })`. 성공하면 `copy`일 때 `copyPop(await loadOne(sid))`. 켬 · 끔은 `ls` `pole2.conti.copyafter`.
- 함께 부른 곡: `coSuggest()` — `E.H.plays`(`[날짜, ord, 곡]`)를 날짜별 곡 집합으로 → 곡 쌍 횟수 → 넣은 곡마다 합(이유는 가장 많이 같이 부른 곡 하나), 넣은 곡 빼고 5곡. `searchHTML()`은 `q`가 비면 이 목록(`.ce2-lab` '지금 곡들과 자주 같이 부른 곡'), 있으면 예전 찾기(메들리 포함).
- 결과 줄: `.ce-orow` > `.ce-o[data-add]`(제목 · 설명 · 칩) · `.ce-oplay` · `.ce-oprev` · `.ce-oadd[data-add]`(+). **한 줄에 `[data-add]`가 2개**예요(시험에서 `.first`).
- 아이콘: `CEI`(편집기 전용 · 예전 `IC`와 이름이 겹쳐서). 위 막대 `#ceSaved`(persist가 시각을 고침).

### CSS (ui.css 맨 끝 'v34.2' 층)
- `.cv-editor .ce-row.ce2-it { display:block }`로 예전 줄 격자를 끄고, 휴대폰 옛 규칙의 `grid-area`(g · n · t · k …)는 `.ce2-hd > *`에서 `auto`로 되돌려요. **옛 `.ce-*` 규칙을 지우지는 않았어요**(리더십 · 상세 화면에서 쓰는 것도 있어서). v34.3에서 정리하면 돼요.
- `.ce2-pub .u-shh > [data-u-close]`는 숨겨요(아래 '취소'와 겹침).

## 검증
- `node --check` conti.js
- **실제 스택**(PG16 + PostgREST 12.2 + dev/server.mjs, 마이그레이션 033까지, 시험마다 새로 만듦)

| 시험 | v34.1 기준(같은 스택) | v34.2 |
|---|---|---|
| e2e v26 | 108/108 | **110/110** (+확인 창 · '이어짐') |
| e2e v28 | 136/136 | **136/136** |
| e2e v29 | 148/148 | **148/148** |
| e2e v22 | FAIL 1(끌어서 순서) + 149줄에서 멈춤 | **108/108 끝까지** |
| e2e v23 | FAIL 4 + 386줄 멈춤 | **같은 FAIL 4 + 같은 곳 멈춤**(백업찬양 진행 · v33부터) · 새 '밴드 탭' 통과 |
| e2e v25 | FAIL 1 + 467줄 멈춤 | **같은 FAIL 1**(원본 지우기 shared file) · 편집기 부분 모두 지나 536줄(섬김이 링크 백업찬양 진행)에서 멈춤 |

- v22를 끝까지 돌리려고 고친 시험: '노트 앱으로' 접힘 열기(v30부터 `[data-ce=draft]`가 접혀 있어서 멈추던 곳) · 이미 고른 악보 미리보기는 '이 콘티에서 빼기' · v34.1 팀원 화면 기대값 2개('수정 ·' 칩 · 곡 서랍 → '곡 자세히'). v25도 같은 '노트 앱으로' 열기.
- **하네스**(가짜 sb · 스택 없이)
  - v31 run **90/90**(예전 66 + 새 24): 접힌 줄 · 상태 아이콘 · 함께 부른 곡(순서 · 이유 · 넣은 곡 빼기) · 확인 칩 · '악보 없는 곡' → 악보 탭 · 키 단추 · 위로/아래로(펼친 채로) · 이어서 부르기/끊기 · 자동 저장 시각 · 올리기 확인 창(아직 안 올라감 → 올리기) · 카톡 복사 창 · **v33 모양 임시 저장 데이터 그대로 읽기**(곡 · 메들리 · 키 · 키 다름 · 메모 · 목표 RT · BPM · '새 악보로 저장' 이름 · 임시 저장 payload)
  - v33 seg 12/12 · v32 video 46 + 1(날짜 고정 시험 · v34.1에서도 실패)
- **캡처**: 태블릿 820 · 휴대폰 390 — 기본 탭 · 악보 탭 · 아래(악보 한 번에) · 확인 창. 가로 넘침 없음.
- **못 한 것**
  - `v34/e2e_ui.py`: v34.1 세션의 '캡처용 데이터 덤프'가 저장소에 없어서 v34.1 코드에서도 안 돌아가요. 편집기 부분 선택자만 새 화면에 맞춰 뒀어요(덤프가 있으면 그대로 돌리면 돼요).
  - 실제 Supabase · 실기기(아이폰 사파리 · 안드로이드)

## 다음에 볼 것
- v34.3: 리더십 메뉴(B안) · 대시보드 · admin.js 인라인 style 약 530개 · 옛 `.ce-*` CSS 정리(새 편집기가 안 쓰는 것: `.ce-x` · `.ce-shsel` · `.ce-more` · `.ce-morebox` · 휴대폰 `.ce-row` 격자 등)
- 시험 정리: v23 백업찬양 진행(FAIL 4 · 멈춤) · v25 원본 지우기 shared file · v25 섬김이 링크 백업찬양 진행에서 멈춤 — 모두 v34.2 전부터 있던 것. v22 '끌어서 순서'는 새 화면에서 통과해요.
- 미뤄 둔 것(그대로): 인도자가 지운 악보 파일(저장소에 남음) · 아이폰 자동 완성(공지 · 투표) · 실연주를 팀 기준보다 우선할지
