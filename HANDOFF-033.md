# HANDOFF-033 (v33 · 2026-11-09)

## 상태

- 구현과 시험은 끝났어요. **실제 사이트에는 아직 적용하지 않았어요.** 올리는 순서는 `UPDATE-033.md`에 있어요.
- 기준: GitHub 최신본(v32 포함, `pole2worshipteam-main_3.zip`).
- 범위: 실연주 시간의 메들리 처리 기준(사용자 확정 1~4). 그 밖의 미뤄 둔 것은 그대로예요(아래).

| 구분 | 파일 |
|---|---|
| DB | `migration_032.sql` (video_songs.seg · grp · grp_sec, video_sync.rule_ver, video_bundle 9칸) |
| 서버 | `api/_video.js` (`classify` · `loadCtx` 레퍼런스 길이 · `RULE_VER` · `videoCron` 다시 맞추기) |
| 화면 | `assets/history.js` · `assets/conti.js` · HTML 6개(?v=35) |
| 문서 | `UPDATE-033.md` · `CHANGELOG.md` · 이 파일 |
| 시험 | `dev/tests/v33/` · `dev/tests/v32/unit_video.mjs`(행 모양 기대값만 고침) |

## 들어간 것 · 어디에

### 구간 종류 (api/_video.js `classify(rows, items, marks, refSec)`)
- `matchVideo`가 마커 → 행을 만든 직후에 불러요. 행에 임시로 `_mi`(마커 번호) · `_grp`(한 마커에 함께 적힌 곡)를 넣었다가 지워요.
- 종류
  - `medley`: 한 마커에 여러 곡(`곡A + 곡B`) 또는 첫 곡 마커만 있고 콘티 '이어서' 곡이 따라옴
  - `split`: 콘티 '이어서' 묶음에 든 곡인데 자기 마커가 따로 있음
  - `unsure`: 콘티 바로 다음 곡이 위치를 모르고, 다음 마커가 '못 맞춘 곡 이름'이 아님 → 숨은 메들리 의심
    - 단, 구간이 레퍼런스의 0.5~1.25배(`HIDE_OK`)면 solo(콘티에만 있고 안 부른 곡)
  - `odd`: 레퍼런스의 0.5배(`ODD_LO`) 미만 · 1.5배(`ODD_HI`) 초과
  - `solo`: 나머지. 위치 모르는 행도 `solo`(시간이 없어서 어차피 안 쓰임)
- 묶음 키 `grp` = 콘티 순서대로 `곡id+곡id`. 콘티 '이어서' 묶음이 있으면 그 기준, 없으면(예전 기록) 마커에 함께 적힌 곡들.
- `grp_sec` = 묶음 첫 곡 시작 ~ 시작이 가장 늦은 행의 끝. 조건: 묶음 곡이 모두 위치가 있고, 마커 사이에 다른 곡 마커가 없고, 묶음 뒤 숨은 곡 의심이 없을 때만.
- `playSec`: `seg === 'solo'`만(seg가 없으면 예전처럼 `!medley`).
- 레퍼런스 길이: `loadCtx`가 `song_refs`(곡마다 가장 최근 updated_at) + `yt_videos.duration_sec`로 `ctx.refSec`를 만들어요. 30초 미만은 무시.

### 다시 분류
- `RULE_VER = 33`. 전체 `rematch(db, {})`가 끝나면 `video_sync.rule_ver`를 올려요('다시 맞추기' 단추와 같음).
- `videoCron`: `rule_ver < RULE_VER && full_done && !pending`이면 YouTube 없이 전체 다시 맞추기를 한 번 해요. 처음 전체 맞추기가 덜 끝났으면 그쪽이 먼저예요.
- migration_032는 예전 `medley = true` 행을 `seg = 'medley'`로 채워 둬요(다시 맞추기 전에도 곡 시간에서 빠지게).
- 규칙을 다시 바꾸면 `RULE_VER`만 올리면 돼요.

### 화면
- **history.js** `build`: `video_bundle.songs` 9칸 `[영상, 곡, 시작, 끝, 메들리, 위치 앎, seg, grp, grp_sec]`(6칸이어도 동작). `V.live`는 solo만, `V.mlive[grp]`는 영상마다 묶음 하나씩 모아 중간값(40초~30분). `HISTORY.medleyLiveSec(D, [곡id…])`.
- **conti.js** `regroup`: 묶음 머리 시간 순서 = 직접 → 메들리 기준(team) → **메들리 실연주(src 'live')** → 곡 시간 합('medley'). 곡 상세 KPI 문구 '단독 연주 N번 중간값'. 이전 연주 목록에 unsure · odd → '시간 제외'(title에 이유).

## 검증

- `node --check` api · assets 통과
- 단위 `dev/tests/v33/unit_seg.mjs` 22 · cron `sync_rule.mjs` 4
- v32 회귀: `unit_video.mjs` 50 · `sync_video.mjs` 21
- PG16(v32_db stub): migration_031 → 032 두 번, 기존 메들리 행 seg 채움, seg · grp 제약, video_bundle 9칸
- Playwright: `v33/run_seg.py` 12 · v32 `run_video.py` 47 · `run_bk.py` 29 · `run_pedal.py` 22 · v31 `run.py` 65
- **못 한 것**: 실제 재생목록 데이터로 다시 맞춘 결과(종류별 개수), 실제 Supabase e2e

## 다음에 볼 것

- 다시 맞춘 뒤 `seg`별 개수를 보고 기준값(0.5 · 1.25 · 1.5)을 조정할지 정해요. 사례는 `unit_seg.mjs`에 더해요.
- 제안했지만 이번에 안 한 것: 리더십이 기록 탭 지난 콘티에서 '앞 곡에 이어서'를 직접 체크(예전 기록인데 곡마다 나눈 메들리는 지금은 길이 규칙으로만 걸러요).
- 미뤄 둔 것(그대로): 아이폰 자동 완성(공지 · 투표), 실연주를 팀 기준보다 우선할지, 곡 상세 '이전 연주' 목록, 부분 지우개 조각의 쓴 사람
