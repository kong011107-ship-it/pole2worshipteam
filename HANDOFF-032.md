# HANDOFF-032 (v32 · 2026-11-08)

## 상태

- 구현과 시험은 끝났어요. **실제 사이트에는 아직 적용하지 않았어요.** 올리는 순서는 `UPDATE-032.md`에 있어요.
- 기준: GitHub 최신본(v31 중간본, `ytp.js` 없음) + v31 최종 묶음 + v32.
- 받은 묶음: `v32-update.zip`. GitHub과 다른 파일만 들어 있어요(v31 마지막 변경분 포함).
- 이번 세션에서 사용자가 더 요청한 것: 백업찬양 직접 더한 곡 고치기 · 지우기, 아이폰 블루투스 페달.

| 구분 | 파일 |
|---|---|
| DB | `migration_031.sql` (A 예배 영상 · C 실연주 출처 · B 백업찬양 곡 고치기) |
| 서버 | `api/_video.js`(새 파일) · `api/conti.js`(video-* action) · `api/cron.js`(새벽 5시 단계) |
| 화면 | `assets/history.js` · `conti.js` · `backup.js` · `share.js` · `pedal.js`(새 파일) · `v32.css`(새 파일) · `ytp.js`(v31) · HTML 6개(?v=34) |
| 문서 | `UPDATE-032.md` · `CHANGELOG.md` · 이 파일 |
| 시험 | `dev/tests/v32/` (단위 · 가짜 DB 동기화 · Playwright 3개) · `dev/tests/v32_db/` (PG16 스텁) |

## 들어간 것 · 어디에

### 예배 영상 (api/_video.js)
- **순수 함수**: `parseTitleDate` · `titleSongs` · `parseDesc` · `songMatcher` · `matchVideo` · `median`. 단위 시험은 `unit_video.mjs`에 있어요.
  - 날짜 src: `title`(확실) · `title-short`(`25. 10.26`, 제목 곡으로 ±21일 확인) · `title-md`(`8월 30일` + 올린 해) · `upload`(직전 주일, 확인) · `manual`
  - 상태 `linked | review | skipped`. `reasons`: date · songs · noconti · leader(참고). `skip_why`: outside · noconti · manual
  - 곡 이름 맞추기: normFull / normCore(괄호 안 빼고) 일치 → 별칭(song_aliases) → 한쪽이 다른 쪽을 품고 하나뿐일 때
  - 마커 → `video_songs(start, end = 다음 마커 · 마지막은 영상 길이, medley, located)`. 한 마커에 여러 곡이 있거나 join_prev면 medley. 마커 없는 콘티 곡은 located=false, 0초부터
  - `pinned`: 리더십이 정한 날짜 · 빼기. 다시 맞출 때 날짜는 그대로, 곡만 다시 맞춰요
- **IO**
  - `loadCtx`: published · 오늘까지 · 사역 예배 콘티는 빼요(history_bundle과 같은 기준)
  - `saveMatched`: worship_videos upsert, video_songs는 지우고 다시 넣어요. linked_at은 처음 것을 유지해요
  - `rematch({ ids | recent })`: YouTube를 다시 부르지 않아요
  - `syncPlaylist({ budgetMs, restart })`: playlistItems 50개씩 읽고, 저장 안 된 영상만 videos(길이)를 불러요. 시간 예산을 넘기면 page_token과 pending을 남겨요
  - `videoCron(db, now)`: 5시 KST에 하루 1번(last_day) 처음부터 확인하고, pending이면 다음 시간에 이어요. 끝나면 `rematch({ recent: 60 })`
- **API** `api/conti.js` (리더십만): `video-sync` · `video-rematch` · `video-set { id, date | skip | reset }` · `video-alias { id, label, song_id }`(norm 두 개를 저장한 뒤 전체 다시 맞추기)

### DB (migration_031)
- `worship_videos` · `video_songs` · `song_aliases` · `video_sync(id=1)`. 쓰기는 service role만 해요
- 읽기: 영상 · 곡 위치는 팀원, 별칭 · sync는 리더십
- `video_bundle()`: 팀원용이고 linked만 줘요 `{ videos: [id, 날짜, 길이, 제목, linked_at, 마커 있음], songs: [영상, 곡, 시작, 끝, 메들리, 위치 앎] }`
- `setlist_items.duration_src`에 `'live'`를 더했어요
- B: `backup_code_used` · `backup_edit_custom` · `backup_delete_custom`(앞 절 참고)

### 화면
- **history.js**
  - `load()`가 `history_bundle`과 `video_bundle`을 함께 불러요. video_bundle이 실패하면 영상 없이 보여요
  - `build(raw, vb)` → `D.V = { byDate, perf[sid], live[sid] }`
  - `HISTORY.perfs(D, sid, key)`: 같은 키 먼저, 최근 먼저. 키가 없으면 key_main 기준
  - `HISTORY.liveSec` · `keyNorm`
  - 콘티 탭: `.hx-wv`(▶ 예배 영상) · `.hx-live`(▶ 우리 연주). '새 영상'은 linked 7일 안 + 주일 21일 안
  - 리더십(`opts.admin`): `videoAdmin()` 카드
    - 확인 목록 = review이거나, linked인데 reasons에 songs가 있는 것
    - 건너뛴 영상(outside 빼고)은 details에 접어 둬요
    - '처음 전체 맞추기 / 지금 확인'은 `done`이 될 때까지 최대 30번 다시 불러요
- **conti.js**
  - `fillVideoNews(root)` → `.cv-vnews`. 닫으면 `pole2.vnews.<id>`를 남겨요
  - 편집기: `E.H` · `E.pvOpen` · `E.pvAll` · `prevList()` · `prevField()` · `[data-ce-prev]` · `[data-ce-pvall]`
  - 키를 바꿀 때 펼침이 열려 있으면 다시 그려요
  - `guessDur` · `recompute`: team → live(`liveOf`) → video. srcTag는 `live` → '실연주'
  - 곡 상세 KPI에 '실연주'를 더했어요
- **backup.js**
  - `editForm(s, done)`: 인도자 · 관리 화면 공통이고, 이벤트는 폼 안에서 stopPropagation해요
  - `fillEdit()` · `B.editing` · `B.editEl`: 다시 그려도 폼 · 포커스를 유지해요
  - 더하기 폼 선택자는 `.bk-add:not(.bk-edit)`예요(버그 수정)
  - 관리 화면은 `loadData(true)`를 같이 불러요(코드 겹침 · 후보 확인용)
- **pedal.js**
  - `PEDAL.attach(el, turn)` → 떼기 함수
  - 콘티 뷰어 · 백업찬양 진행 · share.js에서 써요. 예전 onKey 핸들러 3개는 없앴어요

## 검증

- `node --check` 모든 api · assets 통과
- **단위**: `node dev/tests/v32/unit_video.mjs` 39 · v31 unit 16
- **동기화**(가짜 DB + 가짜 YouTube): `node dev/tests/v32/sync_video.mjs` 19
  - 나눠 읽기 · 이어 읽기 · 비공개 빼기 · 새 영상만 길이 · 별칭 다시 맞추기(API 안 부름) · 직접 날짜 · linked_at 유지 · cron 5시 · 하루 1번 · 이어서 · 키 없음
- **PG16** `dev/tests/v32_db`: 031을 두 번 실행해요
  - 백업찬양 고치기 · 지우기(권한 · 겹침 · 필기 · BPM 이동 · 사진 바꾼 쪽만 필기 지움 · 기도회 중 막기 · 확정 후보에서도 빼기)
  - 예배 영상 check 제약 · RLS(팀원 쓰기 막힘, 별칭 · sync는 리더십만) · video_bundle(linked만, 로그인 안 하면 null) · 곡 지우면 위치도 · duration_src live
- **Playwright**(v31 틀 · 가짜 sb)
  - `run_video.py` 43: 기록 탭 ▶ · 리더십 확인 목록 · 콘티 쓰기 이전 연주 · 실연주 RT 저장 · 콘티 화면 새 영상
  - `run_bk.py` 29 · `run_pedal.py` 22
  - v31 `run.py` 65(회귀)
- **못 한 것**
  - 실제 YouTube API 응답: 재생목록 순서, playlistItems의 description이 전체인지. 길이와 설명은 videos API로 한 번 더 받아요
  - 실제 설명란 형식이 PLAN 예시와 다른 경우
  - 실제 Supabase e2e · 실기기(아이폰 페달)
  - admin.js 안의 기록 화면(HISTORY.mount admin)을 실제로 띄우지는 않았어요. 모듈만 시험했어요

## 다음에 볼 것

- 처음 전체 맞추기 뒤 확인 목록이 많으면, 실제 제목 · 설명란 형식을 보고 `parseTitleDate` · `parseDesc` · `SKIP`을 보강해요(단위 시험에 사례를 더해서)
- 실연주 기준은 아직 '팀 기준'을 덮어쓰지 않아요. 써 보고 기본값을 바꿀지 정해요
- 이전 연주는 곡 상세에는 아직 목록이 없어요(KPI만 있어요). 원하면 더해요
- 미뤄 둔 것(그대로): 아이폰 자동 완성(공지 · 투표), 부분 지우개 조각의 쓴 사람
