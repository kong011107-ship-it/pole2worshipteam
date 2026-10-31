# HANDOFF-030 (v30 · 2026-11-01)

## 상태

구현은 끝났어요. 사용자 확인 전이에요.

받은 묶음: `v30-update.zip`

| 구분 | 파일 |
|---|---|
| DB | `migration_029.sql` |
| 화면 | `assets/conti.js` · `ink.js` · `share.js` · `v30.css`(새 파일) · `admin.html` |
| 문서 | `UPDATE-030.md` |
| 시험 | `dev/tests/v30_db/` |

## 이번에 들어간 것

- **곡 칸 '＋ 파일로 추가'** (PDF 1개 또는 사진 12장까지)
  - 흐름: `filesToPdf` → Storage `sheets/<곡>/<uuid>.pdf` → `rpc add_song_sheet`
  - 그다음 `openViewer(single, { startFix })`로 악보 고치기를 켠 채 열어요.
- **통합본 보며 고치기**
  - 콘티 쓰기의 `viewAll()`이 가짜 svc(`E.items`)로 `openViewer(..., { noFork: true })`를 불러요.
  - `viewerItems`의 `fixOK = can_edit || (can_edit_sheets && 올라온 콘티)`
  - DB의 `sheet_in_service`: `can_edit_conti`이면 확정 전이나 아직 저장 안 한 고른 악보도 됨. `added_for` + 밴드는 올라온 콘티일 때만.
- **예전 통합본 PDF 흐름**: `<details class="ce-pdf">` 안에 접어 뒀어요. 올리는 중이면(`E.up`) 펼쳐져요.
- **파트 악보**
  - 표: `part_sheets`(곡 × 포지션 × 키), `part_picks`(예배 × 곡마다 내가 고른 것)
  - 함수: `my_parts()` / `has_part()`
  - 키: 내 메모 `sheet_notes` `t:<id>`, 공유 필기 `ink_extra` `t:<id>`. `ink_put`에 `t` 갈래가 있어요(그 포지션 + 리더십, 지우기는 모두).
  - Storage: `parts/<곡>/<uuid>.pdf`
  - 보기는 공용으로 먼저 열려요. 곡 칩 왼쪽 `#cvvPart` 메뉴에서 바꾸고, 지난번 고른 것은 메뉴 맨 위에 보여요. 곡 상세 `#sdParts` 칸도 있어요.
- **보기 방식 (한 쪽 · 두 쪽 · 세로)**
  - `INK.multi`가 `.ivm` 겹을 무대 위에 덮어요.
  - 두 쪽은 곡 안에서만 짝을 지어요. 세로는 IntersectionObserver로 쪽을 늦게 그려요.
  - 펜을 켜거나 두 번 누르면 잠깐 한 쪽(`V.temp`)으로 바꿔요.
  - 기기에 기억(`pole2.view.mode`)하고, share.js에도 같은 흐름이 있어요.
- **리더십 셸**
  - 761~1023px: 메뉴를 위쪽 가로 줄(sticky)로, 내용은 폭 전체로
  - 760px 이하: `.shell`을 column으로 바꿔서 메뉴 칸이 늘어나던 것 고침
- **기존 버그 고침**: `openViewerOver`가 뷰어의 `onClose`를 덮어써서 정리 코드가 빠지던 것. `overLayer`가 이어서 부르도록 했어요.

## 검증

- **실제 PG16 스텁 DB**: 029를 두 번 실행했고 권한 시험을 통과했어요. 이 시험 중에 `sheet_in_service` 구멍을 하나 찾아 고쳤어요.
- **Playwright + 가짜 sb**: 뷰어 · 콘티 쓰기 · 곡 상세 · 섬김이 링크 · 셸 폭별 화면을 확인했어요.
- **못 한 것**: 실제 Supabase 전체 e2e

## 다음에 볼 것

- 사용자 첫 사용 피드백. 특히 아래 세 가지예요.
  - 태블릿 두 쪽 보기
  - 일렉 · 드럼 팀원 파트 악보 올리기
  - 기도회 때 두 쪽 · 세로로 따라가기
- 메들리 통째 파트 악보는 아직 없어요. 필요하면 다음 버전에서 해요.
- me.html · share.html의 `?v`는 그대로예요(31). 다음에 HTML을 고칠 때 32로 올려요.
