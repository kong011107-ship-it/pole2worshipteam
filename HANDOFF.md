# Pole2 찬양팀 운영 플랫폼 — 개발 인계 문서

마지막 갱신: 2026-10-22 (Claude 세션, 023 백업찬양 · 적용찬양 · 예배 진행곡 · 밴드 악보 · 토요 연습 투표/취소). 새 세션은 이 문서부터 읽고, 코드는 프로젝트 문서 `worship-platform/` 아래에서 가져오면 됩니다.

## 1. 무엇인가
- 폴투공동체 찬양팀(약 25명) 운영 웹. 팀장 공준혁, 리더십 = 관리자(admin). 배포 주소 pole2worshipteam.vercel.app
- 팀원·지원자는 폰(me.html, apply.html), 리더십은 PC(admin.html).
- 기능: 지원서+서약 → 모집 파이프라인 → 면접 평가표 → 수습 기록·미루기 → 카톡 안내 문구 → 수습 시작 때 계정 발급 → 월별 섬김 응답 → 배치표 → 멤버 관리 → 서약서 버전 → 테스트 데이터 → 대시보드 · 출석 · 멤버 상세 · 배치 공개 전환
- 011: 섬김 일정 · 사역 · 객원 · 숙련도 · 배치 자동 추천 · 라인업 카톡 복사
- 012: 배치표 개편(파트 탭 · 사역 열 · 성비 · 연습 시간 맞추기) · 멤버 연습 시간 고르기 · 성별 · 파비콘
- 013: PWA(홈 화면에 추가) · 웹 푸시 알림 9종 · 알림함 · 리더 공지 · 알림 설정(문구·시간) · 예약 알림(pg_cron) · 배치표 표 보기 + PNG 저장(관리자·팀원)
- **023**: 백업찬양(backup_books · backup_songs · backup_live, assets/backup.js) · 적용찬양(applied_songs) · 예배 진행곡(worship_proc) · 밴드 악보 권한(save_setlist_sheets) · 토요 연습 시간 투표/취소(practice_votes · team_meetings.practice_cancelled · polls.results_hidden)
- **022**: 콘티 작성·보기·RT·마감 알림·악보 저장(sheet_versions · Storage 'sheets' · assets/conti.js · api/conti.js) · 팀원 화면 태블릿 레이아웃
- **021**: 메뉴 그룹핑 · 팀원 탭 홈/섬김/찬양/나눔/내 정보 · 찬양 기록(songs · setlists · setlist_items · lineup_history, history_bundle()) · 예배MC/교역자(status mc/pastor) · 어쿠스틱(base 0)
- **020**: audit_log(변경 기록, 트리거 audit_row) · restore_audit · save_member/save_fields(칸 단위 동시 수정 보호, 409 PT409) · claim_notify(예약 알림 자리 잡기) · backup_log + GitHub Actions 주간 백업
- **019**: positions.base_count(기본/최대 인원, 추가 자리) · 인원 전망 주/보조 1 · 기 시작 월 · members.title_until · forecast_heirs(승계 후보) · 멤버 개별 등록 · 관리자 '나눔 관리'(prayers.hidden_at)
- **018**: members.role_title(직책, 직책마다 1명) · forecast_exits(이탈 가정, 리더십만) · team_settings.forecast(기준 jsonb) · 관리자 '인원 전망' 메뉴
- **017**: members/applications.cohort · birth_date, members.gift_join(리더십만) · 구글 폼 응답 시트 일괄 등록 · 생일 알림(birthday_soon/birthday_today, notifications.kind birthday)
- **016**: 공지 투표(polls · poll_options · poll_votes, poll_view/poll_views/vote/close_poll) · 팀모임 불참 미리 알리기(attendance.self_reported_at, report_meeting_absence/cancel_meeting_absence)
- **015**: 일괄 등록 같은 임시 비번(기본)·첫 로그인 전 필터 · 최상위 리더십(members.is_owner, 넘기기) · 알림 딥링크(#view/arg) + 로그인 뒤 복귀 · 기도 탭(prayers, prayer_taps, pray()/prayer_status()/team_roster())
- 014: 보내기 창(푸시+카톡 문구, 보낸 기록, 다시 보내기 경고) · 뒤로가기 개선(메뉴 기록 안 쌓임, 창은 뒤로가기로 닫힘, 탭 유지) · 사역 '가능' 즉시 연습 칸 · 섬김 응답 표 사역 연습|본 섬김 칸 · 멤버 엑셀 일괄 등록 · 여러 명 휴면/삭제 · 설정 › 초기화 · 모바일 전환 버튼·스크롤바 정리

## 2. 스택
- Vercel 정적 HTML + `api/*.js`(Node ESM, supabase-js). `api/_lib.js` 공용. `api/_notify.js`(013) 푸시 공용(밑줄 파일은 Vercel 라우트 아님).
- Supabase Postgres + RLS + Auth. 브라우저 anon 키(`assets/config.js`), 서버만 service_role.
- 바닐라 JS, 해시 라우팅, supabase-js CDN UMD, Pretendard CDN.
- 캐시 무효화: asset 참조 `?v=25`(023, 5개 HTML 모두). **asset 바꾸면 5개 HTML의 v 숫자 올리기.**
- 사용자 `assets/config.js`는 덮어쓰지 말 것.
- 013 의존성: `web-push` (package.json). Vercel 환경변수: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET` (값은 v13-update.zip의 `환경변수.txt`로만 전달, 프로젝트 문서엔 없음).

## 3. 디자인
보라 #410A85, 그라데이션 #6A2BC9→#410A85, 틴트 #F5EFFC/#EDE3FA, 잉크 #17092E, Pretendard. 로고 png는 사용자 GitHub에만 있음. app.css 끝 `011:` `012:` `013:` `014:` 블록이 새 스타일. 앱 아이콘: assets/icon-192/512.png(보라 배경 흰 마크, apple-touch-icon 확대), badge-72.png(알림 배지용 흰 마크).
UI 시안 캔버스(Design): https://claude.ai/artifact/DKhSZDRdW1zArQ9GmyjCUi — v13 줄(LineupTableV13, LineupImageV13, PushRulesV13, MemberLineupV13, InstallV13, NoticeMemberV13, NoticeAdminV13, NoticeSettingsV13).
배치 표 모양 = 사용자가 보낸 표: 연파랑 헤더·날짜 열(#EAF2FB), 테두리 #DCE5EF, 사역 줄 초록 글씨(#4E9A6A) + 날짜 아래 사역명, 싱어 리더·밴드 마스터 굵게, 공석 X, 객원 이름(G).

## 4. 파일 지도
| 파일 | 내용 |
|---|---|
| me.html | 홈(앱 안내 배너 appBanner · 응답 카드), 섬김 응답, 배치표(예배별 / 전체 표 drawLineupTable), **알림함 #alerts**(renderAlerts), **설치 안내 #install**(renderInstall), 내 정보(이 기기 알림 #devCard renderDevCard), 상단 종(refreshBell) |
| admin.js | 라우트 + `notify`(공지 · 알림: drawNotice / drawNotifySettings / drawNotifyLog). 푸시 헬퍼 `pushRow(kind, keys, who)`(확인 창 체크박스) · `pushChecked()` · `sendPush(kind, params)`. 배치 현황 탭 `tableRows(cols, multiTab)` + `#luImg`. |
| common.js | `PWA`(register/state/enable/disable · 카톡 인앱 감지), `LTABLE`(html/png/save — 캔버스로 표 그림), `NOTIFY_KIND` |
| sw.js | 푸시 표시 · 클릭 시 url로 이동 (캐시 없음) |
| manifest.webmanifest | start_url /me.html, standalone |
| api/notify.js | 관리자: open · minopen · poll · lineup · practice · notice · test |
| api/cron.js | pg_cron이 매시 GET (헤더 x-cron-key) → 마감 임박 · 수습 기록 |
| api/apply-notify.js | 지원서 제출 직후(apply.html이 id를 만들어 insert 후 호출) → 리더십 |
| api/push-key.js | VAPID 공개 키 |
| supabase/migration_012.sql | 013 DB (재실행 안전) |
| supabase/cron_012.sql | pg_cron 등록 (프로젝트 문서엔 `__CRON_SECRET__` 자리표시, 사용자 zip엔 실제 키) |
| **014** admin.js | `openSend(o)` 보내기 창(groups·push(sel)·text(sel,names)·ctx) · `recentSends` · `nav(hash)` 뒤로가기(history.state.lv 0 대시보드/1 메뉴/2+ 상세, 모달은 pushState → close 시 back) · `restoreUI/saveUI`(sessionStorage) · 멤버 `bindMemberBulk`/`setActive`/`openBulkDelete`/`openBulkAdd`(SheetJS 0.18.5 jsdelivr 지연 로드)/`showTempPasswords` · 설정 `#resetAll` · renderRespondAdmin 연습 칸(type prac: 정해진=practice_answers, poll 확정=칠한 시간 자동 a-auto, 취합 중=polled/pollnone) |
| **014** me.html | `go(v)` 뒤로가기(lv 0 홈/1 탭) · `fixedAsk` · `minRows` 안 `.prac-in`/`.poll-in[data-poll-inline]` · `afterServiceAnswer` · `drawPoll(v,D,pick,only,keep)` + `paints` 맵 · sessionStorage 탭 유지 |
| **014** api/members-bulk.js | action add(일괄 등록, 사람별 임시 비번) · delete(완전 삭제, '삭제' 확인) · reset('초기화' 확인 → 비관리자 계정 삭제 + rpc reset_team_data) — Vercel 함수 수(현재 10개) 아끼려고 한 파일 |
| **014** supabase/migration_013.sql | notifications kind 'message' + ctx_key · team_settings.resend_warn_hours(기본 24) · reset_team_data() (service_role 전용) |

## 4-1. 015 지도
- 딥링크: me.html `takeDeep()`·`deep`(한 번 쓰고 주소는 #view만 남김) · renderRespond→`focusRespond` · renderLineup·renderAlerts·renderPray가 deep 소비 · `resolvePractice()`. admin.html `#app/<id>/week<n>` (renderDetail(id, sub), deepSeen). common.js requireMember가 `?next=`(호출 시점 주소) → login.html `safeNext`.
- 서버 URL: open `#respond/month:M` · minopen `#respond/min:ID` · poll/remind poll `#respond/poll:all` · lineup `#lineup/M` · practice `#practice/ID` · notice `#alerts/{id}`(deliver가 id로 바꿈) · trainee `/admin.html#app/ID/weekN` · prayer `#pray` / 급한 기도 `#pray/ID`. message는 notify.js `ME_URL` 정규식.
- 최상위: migration_014 members_guard_update(로그인 없음/service_role 통과) · _lib `guardOwner`/`ownerId` · members-bulk `transfer-owner`(비번은 별도 클라이언트 signInWithPassword로 확인) · reset은 owner만.
- 기도: notify.js `prayer_urgent`(팀원 호출, 30분 안·한 번·하루 3번) · cron prayer_new({dow,hour}부터 하루 창, key prayer_new:주) · prayer_remind({days[],hour}) · notify_settings 3종.

## 4-2. 016 지도
- 투표 만들기: admin.js drawNotice `NV.vote`(newVote · voteDeadline) → api/notify.js notice + `poll`(checkPoll: 2~10개 · 중복 X · 10분 뒤~60일) — 투표 먼저 insert → deliver → polls.notification_id 연결. 푸시 제목 `[공지]`→`[투표]`, 내용 끝에 `투표 · 마감`.
- 대상 = 그 공지 notification_inbox 받은 사람(poll_targeted). poll_votes는 RLS 정책 없음(함수로만). poll_view: 팀원은 마감 뒤 count/names, 리더십은 늘 + pending. 익명이면 names 없음.
- 관리자 drawVotes(공지 · 알림 › 투표 탭) · 독촉 openSend ctx `votenudge:ID` url `/me.html#alerts/NID` · close_poll.
- 팀원 me.html: renderAlerts가 공지 아래 voteCard(.vote) · 클릭 위임으로 rpc vote(누르면 저장, 같은 걸 다시 누르면 취소) · 홈 voteBanners(#voteBanners, 홈 돌아올 때 refreshVoteBanners). 링크 `#alerts/ID` 클릭도 deep 처리.
- cron remind: polls(닫히지 않고 deadline > 지금) type "vote", 날짜 = 마감 KST 날짜, votePending(_notify.js).
- 불참: meetingCard(prerep · prerep-form, 문서 클릭 위임 data-pre=open/close/send/cancel) · 마감 = 그 토요일 12:00 KST(meeting_report_until). 리더가 이미 기록했으면 거부. status가 absent가 아니게 바뀌면 트리거가 self_reported_at 지움. 관리자 출석 preList/preN · chip-pre '미리 알림' · 대시보드 .prebox.

## 5. DB 핵심
- 011까지: (생략, 이전과 같음) team_settings, ministries, services, ministry_availability, ministry_poll, ministry_practices(service_id), practice_answers, practice_attendance, guests, assignments, member_skills, published_lineups, gender, rec_order 4개, poll_dates.
- **013(migration_012)**: push_subscriptions(endpoint pk, member_id; 저장은 rpc save_push_subscription — 같은 기기 다른 계정이면 갈아끼움, 삭제 rpc remove_push_subscription) · notifications(kind, title, body, url, target_label, recipients, pushed, created_by) · notification_inbox(notification_id, member_id, 개인화 title/body, read_at; rpc mark_notifications_read(ids|null)) · notify_settings(kind pk, enabled, title, body, schedule jsonb — remind: [{days,hour}] 최대 2, trainee: {dow,hour}) · notify_sent(key — 'open:월', 'minopen:id', 'poll:id', 'lineup:svc', 'practice:id', 'remind:type:id:마감일:days', 'trainee:app:week', 'apply:id').
- 쓰기는 서버(service_role)만. 팀원은 자기 inbox·구독만 읽음, 관리자는 전부 읽음.

## 6. 결정 사항(사용자 확정)
- 이전 결정은 그대로.
- **014 (2026-10-15)**: 팀원 대상 복사 버튼 → '보내기' 창(푸시+복사 함께, 못 받는 사람 이름 표시, 알림 누르면 해당 화면), 라인업 보고·지원/면접 단계 안내는 복사 유지. 발송 기록 + 같은 대상 24시간 내 재발송 경고(기준 시간 알림 설정에서 변경). 뒤로가기: 메뉴·탭 기록 안 쌓음, 메뉴에서 뒤로=홈, 홈에서 뒤로=바로 종료(1안), 상세는 목록 복귀, 창은 뒤로가기로 닫힘, 새로고침해도 탭 유지. 사역 '불가'로 바꾸면 연습 숨김·취합 제외, 기록은 남겨 복원(1안). 섬김 응답 표 사역 '연습|본 섬김', 취합 중이면 응답/미응답(2안), 미응답 카드·독촉에 연습 시간 미응답 포함. 일괄 등록은 임시 비밀번호(b안, 사람마다 다름). 초기화 버튼(객원도 삭제). 비활성 = 기존 '휴면'(is_active=false)과 같은 것으로 정리하고 여러 명 휴면/활동 전환 추가.
- **013 (2026-10-15)**: 앱은 PWA(앱스토어 X). 알림 9종 전부 채택: 응답 열림 · 사역 응답 열림 · 연습 시간 요청 · 마감 임박(미완료자만) · 배치표 공개(배치된 사람은 내 섬김 포함) · 연습 확정(그 예배 배치자) · 새 지원서(리더십) · 수습 기록 차례(나눔 리더, 없으면 리더십) · 리더 공지(전체/리더십/특정 날짜 섬김자/직접 고르기, 알림함에도 남김). 마감 임박 기본 = 마감 하루 전 18시 + 당일 10시(2번, 사용자 OK). 시각은 정시 단위(분 단위 불필요). 이벤트 알림은 확인 창 '푸시 알림도 보내기'(처음 켬, 다시는 끔). 알림 끄기는 기기 단위만. 알림 시간·문구는 관리자 화면에서 설정. 배치표 표 + 이미지(사용자 표 그대로, 사역 초록, 수련회 등 예배 여러 개는 그 탭에서 따로, 팀원도 가능, 객원 (G)). 카톡 문구 복사 유지.
- 기존 25명은 세팅 끝난 뒤 **엑셀 일괄 등록** 예정 (014에서 구현됨).
- 작업 방식: 수정사항을 모아 한 번에. UI 변경은 목업부터 보여 주고 확정 후 작업.

## 7. 로컬 테스트 스택
- 사이트 /home/claude/wp (v12-update 폴더 + api/_lib.js + 013 파일). 베이스 SQL /home/claude/base/supabase(schema~009는 축약본, 010은 원본) — 축약본은 이번 세션에서 다시 씀(템플릿·서약 본문 축약, assignments_validate는 010이 덮어씀).
- 스택 /home/claude/pgrst: PostgREST v12.2.3 static(github 릴리스에서 받음), `npm i pg@8`, server.mjs(dev/server.mjs: PUSH_SINK=push.log로 실제 발송 대신 기록, CRON_SECRET=cron-test, vapid.env는 테스트 키), pgrst.conf.
- 사이트 폴더 `npm i @supabase/supabase-js@2 web-push@3 xlsx@0.18.5 --no-save` (xlsx는 테스트에서 CDN 대신 로컬 파일로 route).
- 새 컨테이너에서 코드 가져오기: 사용자 PC Downloads의 v11~v14-update 폴더(device_stage_files) + 프로젝트 문서. 세션 기록(jsonl)에서 project_read 결과를 추출하면 다시 타이핑할 필요 없음.
- `dev/reset_stack.sh`(이번엔 /home/claude/reset_stack.sh): 기본 011+012+013까지. `EXTRA_MIGS="migration_011"`면 v12 상태.
- 테스트(각각 새 DB): `e2e_v13_admin.py`(40: 배치 표·굵게·초록·PNG·수련회 표, 전체/개별 공개 푸시 기본값, 응답 열기/다시 열기, 사역 응답 알림, 취합 열기, 연습 확정 대상, 공지 대상 4종, 알림 설정 저장·미리보기·끄기·테스트, 기록) · `e2e_v13_member.py`(42: cron 마감 임박 시각·중복·당일·연습 시간, 수습 기록, 지원서 알림, SW·manifest, 배너, 벨, 알림함 필터·읽음·모두 읽음, 이 기기 알림 켜기/끄기(PushManager 가짜), 설치 안내 안드/아이폰/카톡, 팀원 표·나 표시·(G)·PNG·수련회). **014**: `e2e_v14.py`(57: 응답 표 연습 칸·자동 칸 덮어쓰기, 보내기 창·그룹·경고·0시간·뒤로가기로 창 닫기, 사역/연습 안내 보내기, 사역 탭 유지, 관리자 뒤로가기 단계, 여러 명 휴면·삭제, 엑셀 양식·업로드 미리보기·등록·임시 비번 로그인, PC 탭 overflow, 모바일 전환 버튼, 초기화) · `e2e_v14_member.py`(27: 고정 연습 펼침/숨김/복원, 칠하기 즉시 펼침·스크롤·저장·불가 후 복원, 탭 유지, 메인 탭 기록 1칸, 딥링크 뒤로=홈) · v13 두 테스트 회귀 통과(40·42). members_guard_update 때문에 테스트에서 psql로 is_active 바꿀 땐 트리거를 잠깐 끔. v12 회귀: e2e_v12(16) · e2e_v12_admin(22, notify 포함) 통과, e2e_v12_mobile 10/11 — 'home banner' 1개는 데모 데이터상 demo02가 이미 다 응답해서 v12 원본에서도 똑같이 실패(회귀 아님).
- h.py: 모바일 컨텍스트는 안드로이드 크롬 UA, accept_downloads.

## 8. 배포 상태
- 사용자: GitHub → Vercel, SQL은 Supabase SQL Editor. 011까지 실제 적용 확인(2026-10-15). 기존 팀원 성별 아직 미입력.
- 전달: v14-update.zip (채팅으로 전달) — migration_013, HTML 5개, assets 3개, api 4개(members-bulk 새 파일), UPDATE-014. 적용 여부 미확인.
- 이전: v13-update.zip (Downloads에 저장) — migration_012, cron_012(키 포함), HTML 5개, sw.js, manifest, package.json, assets 6개, api 5개, UPDATE-013, 환경변수.txt.

## 9. 남은 일 / 열린 질문
1. 기존 팀원 25명 엑셀 일괄 등록 (세팅 후). 기존 멤버 성별 입력.
2. 실제 기기 푸시 확인은 사용자가 배포 후 '나에게 테스트'로 (로컬은 가짜 구독).
3. 연습 지각 경고 기준 횟수, 연속 결석 5회는 '우선' 값. 사역 연습 출석은 사역 화면에서만.
4. 안내 슬라이드(https://claude.ai/artifact/5uqR2ivFkRkT3QXx1Si9Mp) — 011·012·013 장 없음.
5. 예약은 pg_cron 매시. pg_net 호출이 실패하면 `cron.job_run_details`에서 확인.

## 10-10. 023 상태 (백업찬양 · 적용찬양 · 예배 진행곡 · 밴드 악보 · 토요 연습 투표/취소)
- 2026-10-22 v23-update.zip 전달: migration_022, HTML 5(?v=25), assets backup.js(새) · conti.js · admin.js · app.css, api conti · notify · _notify, UPDATE-023. Vercel 함수 11개 그대로. 객원 전화번호 로그인은 사용자가 보류(잊어도 됨).
- 결정(사용자): 토요 연습 시간을 바꾸면 대상(배치 인원 → 배치 전이면 월말 응답 토요 '가능')에게 가능/불가 투표, 대상 수정 가능, 결과는 리더십만, 불가 사유 없음. 결정 = 확정 / 원래 시간 / 취소(당일 리허설만). 취소 주: 토요 연습 출석 · 통계 · 지각 제외, 리허설 유지, 취소 알림에 주일 리허설 시간(주일 시간 함께 수정 가능), '토 연습 불가 → 섬김 불가' 규칙 미적용. 팀모임은 별개. '불가'는 월말 응답을 안 바꾸고 배치표 경고만(확정 시 유지, 되돌림·취소 시 제거). 밴드 라인업도 악보만 수정, 악보만 바뀌면 푸시 없음 '악보 바뀜'. 적용찬양 = 교역자에게 받아 리더십이 사진으로 업로드(콘티와 백업 사이). 백업찬양도 사진으로 곡 추가.
- DB(migration_022, 재실행 안전): team_meetings.practice_cancelled · polls.results_hidden(poll_view: show = admin 또는 (마감 and not hidden), hidden이면 voters null) · practice_votes(meeting_date pk, poll_id, prev/new start·end, state voting|confirmed|reverted|cancelled) · attendance_practice_guard 트리거 · practice_vote_board(dates[]) · decide_practice(date, confirm|revert|cancel|restore, sun_start, sun_end). is_band_of · can_edit_sheets · can_upload_sheet(밴드 포함) · add_song(밴드 제외 유지) · setlists.sheet_changes · save_setlist_sheets(svc, data, base: 곡 순서 같아야, version+1 = notified_version). paths_ok · applied_songs(service_id, ord, title, key, note, images[] `applied/{svc}/{uuid}.jpg`) · worship_proc(kind, title, key, path pdf|images[], start_date) · proc_on(date) · conti_one에 can_edit_sheets · can_applied · practice_cancelled · applied · proc · setlist.sheet_changes. backup_books(label, path `book/{uuid}.pdf`, pages, topics, active 하나) · backup_songs(book_id null = 사진 곡, code `^[a-z0-9+]{1,6}$`, key a-g, topic, page, pages, images, norm 생성 칸 → 다른 키) · backup_live(id=1, active, leader_id, candidates[], now_ref/next_ref `b:id|p:kind`, seq; supabase_realtime 등록) · can_lead_backup(admin · 어제~7일 인도자) · backup_update(jsonb) · backup_state_live · backup_add_custom · backup_book_save. can_upload_object(name) = Storage 경로별 권한, 버킷 mime PDF+JPEG/PNG/WebP. notify_settings sat_vote · sat_decide · proc(알림 종류는 notice로 저장).
- api/notify.js: sat_vote(시간 바꾸고 · 투표(results_hidden) 만들고 · notice 전달 · practice_votes upsert, 진행 중이면 이전 투표 마감 · prev 유지) · sat_decide(투표 대상 또는 member_ids) · proc. api/conti.js notify: 바뀐 것이 '악보 PDF 교체'뿐이면 푸시 없이 sheet_changes.
- 화면: admin.js 섬김 일정 openSatTime · openSatDecision · openSatCancel(popWait로 창 이어 열기), 배치표 B.satNo · B.satOff · ans(sat)=취소 주 true, 출석(주간 · 월간 · 통계 · 멤버 상세 · 대시보드) 취소 반영, 곡 페이지 #songExtra → BACKUP.mountAdmin. conti.js: viewerItems(콘티 → 적용 → 진행곡 → CONTI.onBackup 칩) · drawPageInto(PDF 쪽/그림) · sheetImage · compressImage · uploadImages · openApplied · 편집기 sheetsOnly(밴드) · CONTI.lib 공개. backup.js: mount(후보) · openLive(인도자 조작판/팀원 따라가기, Realtime + 3초 확인) · liveBanner · mountAdmin(악보집 읽기 readBook: 첫 두 줄 CODE_RE, 코드 여러 개 줄은 제외) · openProcEdit. me.html: #worshipNav 콘티|백업찬양|기록, #wsLive 띠, CONTI.onBackup.
- 로컬: server.mjs Storage가 can_upload_object + 이미지 mime. reset_stack 기본 migration_022까지. 테스트 fixture는 /home/claude/tests/mkfx.py · mkfx2.py(크롬 PDF 출력이라 글자 레이어 있음).
- 테스트: e2e_v23.py 134(투표 권한 · 숨김 · 재질문 · 배치표 경고 · 결정 · 취소(출석 지움 · 막힘 · 주일 시간 · 알림) · 다시 열기 · 밴드 권한/저장/409/푸시 없음 · 적용찬양/진행곡 Storage 권한 · 백업 권한 · 악보집 읽기/저장 · 진행곡 UI · 적용찬양 UI · 밴드 편집기 · 보기 칩 · 백업 후보/검색/키/사진 곡/시작/따라가기/예약/코드/진행곡/미리보기/끝내기) + e2e_v22 · e2e_v21 회귀.
- 남은 확인: 실제 악보집 PDF 글자 레이어(스캔이면 수동 입력) · Supabase Realtime 동작 · 아이패드에서 진행 화면 크기.

## 10-9. 022 상태 (콘티 · 태블릿)
- 2026-10-22 v22-update.zip 전달: migration_021, HTML 5(?v=24), assets conti.js(새) · admin.js · app.css · common.js, api conti.js(새) · _notify · cron · notify, UPDATE-022. 선택 환경변수 YOUTUBE_API_KEY. Vercel 함수 11개(한도 12).
- 범위(합의): v22 = 콘티 작성·보기·RT·마감 알림·악보 저장. v23 = 백업찬양·예배 진행곡, v24 = 내 메모(필기)는 아직.
- DB(migration_021, 재실행 안전): songs.team_sec · yt_videos(영상 길이 캐시) · song_refs(곡별 영상 구간) · sheet_versions(kind sheet|original, path `sheets|originals/{song}/{uuid}.pdf`, thumb ≤60KB dataURL, setlist_id) · setlist_versions(다시 올릴 때 이전 스냅숏). setlists: service_id(unique, cascade) · status draft|published · version · notified_version · published_at · updated_at/by · target_sec · deadline · pages · changes{text[],key_songs[],at}(처음 올릴 땐 null → '수정됨' 판단 기준). service_date unique는 import 행만(부분 인덱스). setlist_items: sheet_id · page_from/to · duration_sec · duration_src(manual|team|video) · memo. team_settings.conti {deadline_dow 3, deadline_hour 22, rt_first 1200, rt_other 1500, min_days 3}.
- 함수: can_edit_conti(svc)(admin · 그 예배 인도/밴마) · can_upload_sheet()(admin · 오늘-14일 이후 예배 인도/밴마) · conti_deadline · conti_target · conti_one(svc) · conti_week(from,to) · song_sheets(ids[]) · add_song · add_original_sheet · edit_sheet · save_setlist(svc, data, publish, base)(PT409, 새 악보 sheet_versions, manual → songs.team_sec, ref_range → song_refs, changes 계산) · set_conti_meta. RLS: setlists/items는 published 또는 can_edit만. history_bundle은 올라온 주일 콘티 중 **예배 날이 지난 것**만.
- 알림: notify_settings conti_open({days,hour} 예배 n일 전, 인도자) · conti_remind([{days,hour}] 마감 기준) · conti_up · conti_edit(섬김자, 올린 사람 빼고, api/conti notify — 버전마다 한 번 notified_version). notifications.kind 'conti'. url `/me.html#worship/{service_id}`.
- 화면: assets/conti.js `CONTI.mountWeek(root,{me,focus})` · `openEditor(sid,{after})` · `openViewer(svc,{song,single})` · `songDetail(id)` · `mountAdmin(root)`. 겹쳐 띄우는 화면은 `.cv-layer`(history.pushState, popstate로 닫힘, conti.js 리스너가 먼저 받고 stopImmediatePropagation). pdf.js 3.11.174(cdnjs) · pdf-lib 1.17.1(jsdelivr) 지연 로드. 악보 파일은 Cache API `pole2-sheets-v1`. 작성 중 내용은 localStorage `pole2.conti.draft.{sid}`. me.html: #worshipNav(콘티|기록, sessionStorage pole2.worship) · #wsConti/#wsHist · deep `#worship/{sid}`. admin.js: nav 찬양 › 콘티(renderConti) · 곡 페이지(team_sec · 악보 수 · yt-fill · 곡 상세) · 알림 설정 4종(conti_remind는 remind와 같은 편집기, conti_open은 #scBd).
- 태블릿: app.css 끝 '022 · 태블릿' — 700px↑ .m-wrap 880 · 여백 32 · topbar 흰 띠 전체 폭(::before), 1000px↑ 1120 + 홈/배치표/응답/내 정보/콘티 2열 grid(제목·고르기는 전체 폭). login/index `.m-solo`, apply `.m-form`(가운데 카드).
- 로컬 스택: server.mjs에 Storage 흉내(/storage/v1/object/(authenticated/)sheets/… → can_upload_sheet 검사, PDF만, /home/claude/pgrst/storage). reset_stack 기본 migration_021까지 + storage 폴더 비움. h.py: pdf.js/pdf-lib CDN을 /home/claude/libs/node_modules로 route, navclick(pg,key).
- 테스트: e2e_v22.py 105(권한 · 임시 저장 숨김 · 409 · 업로드 권한 · 작성 화면(검색 · 새 곡 · 시간 · 끌기 · 초안 PDF · 통합본 · 쪽 고치기) · 올리기 알림 · 수정 알림 · 달라 보임 확인 · 팀원 딥링크 · 보기 넘기기 · 오프라인 · 곡 상세 · 리더십 콘티 · 마감/목표 · 알림 설정 · 곡 · 원본 업로드 · 5MB 압축 · cron 안내/독촉 · 기록 반영) · e2e_v21 67 회귀(찬양 탭은 '기록' 누른 뒤). tabshots.py = 태블릿 세로 820 · 가로 1180 스크린숏.
- 남은 확인: 실제 Supabase Storage 정책 · 아이패드 노트 앱 PDF(주석 포함) 쪽 나누기 · 페달 키 매핑(대부분 → / PageDown).

## 10-8. 021.1 상태 (관리자 메뉴 서랍)
- 2026-10-22 v21.1-update.zip 전달 (SQL 없음: admin.html(?v=23), assets admin.js · app.css, UPDATE-021.1). **캐시 번호: admin.html만 ?v=23, 나머지 HTML은 ?v=22** — 다음 asset 변경 때 5개 모두 24로 맞출 것.
- 결정: 묶음(사람·섬김·찬양·소통) 서랍, 한 번에 하나만 열림(1안). 대시보드·설정은 묶음 밖.
- 구조: admin.html nav 안 `.nav-sec[data-sec]` > `button.nav-group[aria-expanded]`(+ `.nav-dot`, `.nav-chev`) + `.nav-items > div > a`. 구분선은 `.nav-div`. 링크는 이제 nav의 직계 자식이 아님(`.side nav a`로 찾기).
- admin.js `메뉴 서랍 (021.1)` 블록(라우팅 위): navOpen(key, remember) · navSync()(route()에서 호출: 지금 메뉴 묶음 열기, 묶음 밖 메뉴면 localStorage `pole2.navOpen` 복원) · has-on(닫힌 묶음 제목 보라) · has-todo(updateTodoCount가 토글, 보라 점). app.css 끝 '021.1' 블록, 760px 아래는 가로 줄에서 열린 묶음 메뉴만 펼침.
- 테스트: 정적 하네스 12개(열기·하나만·자동 열기·닫힌 묶음 표시·기억·모바일). **e2e에서 메뉴 링크를 바로 클릭하던 곳은 닫힌 묶음이면 안 보여서 실패할 수 있음 → page.goto(#hash)나 묶음 버튼 먼저 누르기.**

## 10-7. 021 상태 (v2.0 1단계)
- 2026-10-22 v21-update.zip 전달 (migration_020 + migration_020_history, HTML 5(?v=22), assets admin.js · app.css · common.js · **history.js(새)**, api _notify · notify · members-bulk, UPDATE-021). v20 적용 여부 미확인.
- v2.0 분할(사용자 합의): v21 메뉴·기록·MC/교역자·어쿠스틱 → v21.5 라인업 이름 매칭(20기 등록 뒤) → v22 콘티 작성·악보·RT → v23 백업찬양·예배 진행곡 → v24 내 메모(필기). 설계 전체는 `worship-platform/v2/CONTI-INTEGRATION.md`.
- 결정: 예배MC · 교역자 = 관전자 + 리더십. 리더십 권한·알림·정보, 배치는 어느 자리든(주/보조 포지션 기록 안 함), 응답·출석·자동 추천·인원 전망 제외. 지정·해제는 최상위 리더십만.
- DB(migration_020): members_status_check에 mc/pastor · members_observer_guard(바꾸기는 owner/service_role만, mc/pastor면 role=admin·직책 비움) · assignments_validate(포지션 검사는 active만) · positions base 0 허용 + acoustic(0/1, sort 8) · songs(norm unique, songs_norm 트리거, audit) · setlists(service_date unique, leaders text[] — 호칭 포함 원문, note=특별예배 이름, source import|platform) · setlist_items(ord, song_id, key, medley, refs jsonb [[yt, 시작초, 메모]]) · lineup_history(position=positions.code, 인도는 'leader', member_id는 v21.5에서) · RLS 읽기 is_member, 쓰기 is_admin · history_bundle()(한 번에 json, 1000줄 제한 회피). migration_020_history: id 고정(songs 1..387, setlists 100001..) + setval, 다시 실행하면 import 데이터 지우고 다시 넣음.
- 화면: history.js `HISTORY.mount(root,{admin,tab})` · `load(force)` · `reset()` · `build(raw)`(통계 페이지 fix.py 계산을 클라이언트로: y1 = 마지막 날짜 기준 1년). CSS는 app.css 끝 `.hx-*`(021 블록). admin.js: nav `.nav-group` · route songs/history · navOf respond→schedule · PAGE_TABS + MutationObserver로 #schedule/#respond 위에 `.page-tabs` · renderHistory · renderSongs(SG) · OBS/isObs/obsChip · memberAction 'kind'(구분 바꾸기) · openMemberEdit obs면 포지션·숙련도·직책 칸 없음 · 배치표 후보 맨 아래 observers(canPlace는 obs면 어디든) · meetingPeople에서 obs 제외 · lineupText/현황 카드 base 0 빈 자리 생략 · 설정 기본 인원 0. common.js: ICON.music · POS_SHORT acoustic · LTABLE.colsOf(rows)(어쿠스틱은 쓴 표에만 칸). me.html: OBS/isObs · #serveNav(배치표|섬김 응답, sessionStorage pole2.serve) · tabOf(respond/lineup→serve) · #view-worship(처음 한 번 mount) · obs면 respond 뷰·배너 없음. _notify activeMembers({observers}) → 배치표 공개 알림만 obs 포함.
- 테스트: e2e_v21.py 67 · e2e_v20 70 통과. reset_stack 기본 migration_020_history까지.
- 다음: v21.5 이름 매칭(라인업 71명 ↔ 멤버, 호칭·동명이인 수동 연결 화면, served_since 제안, 멤버 상세 섬김 통계 최근 2년에 과거 기록 포함). 남은 결정: 플랫폼 배치표 기준 전환일(20기 첫 주일 추천).

## 10-6. 020 상태 (Phase 1 마무리)
- 2026-10-21 v20-update.zip 전달 (migration_019, HTML 5(?v=21), assets admin.js · app.css, api 4(_notify, cron, notify, apply-notify), .github/workflows/backup.yml, UPDATE-020). manifest·sw는 그대로(?v=20).
- 배경: 6개 영역 점검(무결성·권한·개인정보·자동 배치·알림·복구) 뒤 1~4번(백업 · 감사 기록 · 낙관적 잠금 · 알림 키 선점)을 묶음. 자동 배치 공정성(실력 균형 항이 '하'에게 불리, 기본 기준 이번 달)은 Phase 2 이후 과제로 남김.
- DB(migration_019):
  - audit_log + audit_row() 트리거 19개 표. 인자 5개(키, 멤버 칸, 지원서 칸, 무시 칸, 부모 칸:표). UPDATE는 바뀐 칸만, DELETE는 줄 전체, INSERT는 줄 전체. pg_trigger_depth()>1 건너뜀 + **연쇄 삭제는 깊이가 안 올라가서** 부모 줄 존재 확인으로 건너뜀.
  - audit_forget_member(멤버 삭제 시 member_ref 기록 삭제 + 이름 한 줄) · audit_forget_application(app_ref 기록 삭제). reset_team_data가 audit_log 비우고 '초기화' 한 줄.
  - restore_audit(id): DELETE는 AUD_UNDO_DEL 표만 재삽입(overriding system value), UPDATE는 changed 칸이 지금 new_row와 같을 때만 old로. definer + is_admin.
  - save_member(id, before, after) · save_fields(table, key, before, after; applications.admin_memo · trainee_weeks): invoker. 칸마다 cur≠before && cur≠after면 충돌 → `raise using errcode='PT409'`(HTTP 409), detail=[{field,label,now}]. 아니면 바뀐 칸만 저장. 추가 포지션은 집합 차이, 숙련도는 포지션별, 메모 포함, 직책 이동 원자적.
  - notify_sent.done/claimed_at + claim_notify(key)(service_role만): insert on conflict, 10분 지난 미완료는 재점유.
  - backup_log(관리자 읽기). Actions가 psql로 한 줄.
- API: _notify.js claim/release/deliverOnce. cron.js 전부 deliverOnce + 항목별 try/catch(out.errors) + 4시 정리. apply-notify deliverOnce. notify.js prayerUrgent 자리 잡기.
- 화면(admin.js): saveRpc/fieldText/conflictBox 헬퍼(api() 위). openMemberEdit base 스냅샷 → save_member, 충돌 시 #eConflict + base 갱신 → 두 번째 저장은 덮어씀. 관리자 메모 #memoConflict/#memoForce. 수습 주차 [data-wconflict]. 설정 #safeCard(마지막 백업 칩 · 변경 기록 링크). #audit 화면 renderAudit(AUD, AUD_TBL/GROUP/COL, audWhat, audChanges, data-undo-aid) — navOf audit→settings. app.css '020' 블록(.aud-*).
- 백업 워크플로: 일요일 03:17 KST, pg_dump 17(PGDG noble) public 전체 + auth.users/identities 데이터, gpg AES256(BACKUP_PASSPHRASE), artifact 90일, Session pooler 주소(SUPABASE_DB_URL). 로컬에서 덤프→새 DB 복원 확인(public 스키마 이미 있음 오류 1개만).
- 테스트: e2e_v20 70 · v19 84 · v19_fc 61 · v17 36 · v16 79 · v15 97 · v14 57 · v14_member 27 · v13_member 42 통과. reset_stack 기본 019까지.
- Phase 2 (사용자 목표 v2.0): 콘티 아카이빙 · 레퍼런스 아카이빙 · 공유 · 실시간 악보 공유 · QT/성경읽기 등 커뮤니티 강화. 실사용하며 준비.

## 10-5. 019.5 상태
- 2026-10-21 v19.5-update.zip 전달 (SQL 없음: HTML 5, manifest, sw.js, assets admin.js · app.css + 아이콘 7개, UPDATE-019.5). 캐시 ?v=20, manifest·sw 아이콘 경로에도 ?v=20.
- 결정: 승계 카드 긴급도 순(빨강 비어 있음·다음 기 공백 후보 없음·후보 부족 / 주황 공백 예정 후보 없음 / 초록) · 후보는 칩 원클릭(✓ 누르면 빼기, '다른 사람'은 창) · 측면 선 없이 .kpi/.box와 같은 카드, 급한 정도는 테두리 색 + 배지 · 인구 구조 B안 3열(왼쪽 숫자+포지션별 인원=필터 · 가운데 피라미드 · 오른쪽 리더십 4자리), 1280px 아래 2열, 760px 아래 1열 · 슬라이더 제거 · 사람 칸 = 직책 이름표(.rt)+보라 1px 테두리, 주 포지션 12px/700, 보조 '+이름' 10.5px/600 · 기수 숫자 20px + '기' 옆 · 아이콘 = 사용자 마크(흰 바탕 보라, 원본은 사용자가 채팅으로 준 이미지, favicon.svg는 potrace로 벡터화).
- 디자인 원칙(사용자 지적): 새 UI는 app.css 토큰·기존 클래스 크기(테두리 1px, 칩 12px/700)를 따를 것, 측면 강조선 같은 새 패턴 금지, 시안은 캔버스 손그림 대신 실제 코드 화면을 재배치·캡처해서 보여 주기.
- 지도(admin.js): leadLevel/LV_RANK/sortLeads/leadWho/leadBadge · fcLeadHTML(plan: .fc-lead-st 배지, .fc-lead-term 임기, .fc-heir-chips [data-pick]/[data-unpick]) · bindFcLeads가 칩 insert/delete · drawFcPyramid: posStat/PS, posPanel(#fcPf 안 button.fc-pos-row[data-pf]), .fc-ctl(#fcAt 라벨) · .fc-3col(.fc-col-l/.fc-col-p/.fc-col-r). app.css 끝 '019.5' 블록.
- 테스트: e2e_v19_fc 61 · e2e_v19 84 · v17·v16·v15·v14·v14_member 통과. e2e_v18은 0.5 계산·옛 문구·.lead 클래스 기준이라 13개 실패(의도된 변경, v19_fc가 대신 확인).

## 10-4. 019 상태
- 2026-10-20 v19-update.zip 전달 (migration_018, HTML 5, assets 3(admin.js, app.css, common.js), api 2(cron, notify), UPDATE-019). v18 적용 여부 미확인.
- 결정: 포지션 기본/최대 = 인도 1/2 · 싱어 4/6 · 일렉 1/2 · 나머지 1/1, 자동 추천은 기본까지만 · 추가 자리는 비어도 공석 아님(X 없음) · 라인업 문구 `인도: A, B`, 밴드 칸 `A·B` · 인원 전망 주/보조 모두 1(0.5 폐지), 보조는 따로 표시 · 기 시작 월 기본 11월(변동 가능) · 직책 예상 종료(비면 졸업까지) · 승계 후보 직책마다 2명 · 비관 = 직책 1년마다 교체 · 개별 등록(엑셀과 같은 항목) · 리더십 메뉴 '나눔 관리'(기도 탭, QT·성경읽기는 나중에 탭 추가) · 기도제목은 숨김(복원 가능), 작성자 알림 없음 · 파비콘은 보류(시안: v18 캔버스 FaviconV19 보드).
- 지도(admin.js): `멤버 개별 등록 (019)` 블록 · positions.base_count 처리(2142 부근, 배치표 extra 행 2426, 추천 2856) · `나눔 관리 (019, 리더십)` 블록 · 설정 포지션별 인원 카드(#posCard) · 인원 전망 블록에 019 주석(주/보조 1, 기 시작 월 termMonth/termStart, 승계 카드 data-lead · data-until · 후보 창 #hpList). common.js `LTABLE.cellLines`(5명 이상 두 줄). me.html 인도자 여러 명 표시, 숨긴 기도 제외. api/cron·notify: prayers hidden_at null만.
- DB(migration_018): positions.base_count + positions_counts_check(base ≤ max, assignments slot ≤ max) · members.title_until(직책 바뀌면 비움, 관리자만) · forecast_heirs(PK role_title+member_id, 2명 트리거, RLS 관리자) · prayers.hidden_at/hidden_by(숨기기는 관리자만, 팀원 select에서 제외) · reset_team_data에 heirs.
- 테스트: e2e_v19.py 84 · e2e_v19_fc.py 41 통과. v18·v17·v16·v15·v14·v14_member 회귀. reset_stack 기본 018까지.

## 10-3. 018 상태
- 2026-10-20 v18-update.zip 전달 (migration_017, HTML 5, assets 2(admin.js, app.css), UPDATE-018). v17은 사용자 사이트에 적용 확인됨.
- 결정: 팀 기는 1년 단위, N기에는 N+15기까지 남음 · 직책 4개(팀장·싱어팀장·밴드팀장·총무), 임기 1년이지만 보통 계속 → 승계 경고는 졸업·이탈 시점 기준 · 불확실 이탈은 확률 대신 리더십이 고른 사람(낙관 / 비관 = 낙관 + 추가) · 멀티 포지션 0.5(포지션 수로 나눔) · 유지 목표는 최소 운영 + 지금 규모 둘 다 · 실제 목적은 연간 충원 계획 · 목업: 캔버스 https://claude.ai/artifact/QXW7DAKbzi6YKXzMzynSKQ (파비콘 시안도 있음 — 아이콘 변경은 보류, 양육 플랫폼이 지금 로고를 쓸 예정).
- 지도: admin.js `// 인원 전망 (018)` 블록 — FC(tab·sc·plan·t, UI 유지) · FC_DEFAULT · fcCfg() · fcModel(cfg, exits, sc) → { stateAt(p,k) grad/mil/gone/on, run(plan none|min|keep) → years[k]{have,need,minT,keepT,heads,add}, moves, leads } · drawFcPlan/drawFcPyramid/drawFcExits/openFcExit/drawFcSettings · TITLES/TITLE_SHORT/TITLE_ORDER(파일 위쪽) · leaderChip에 직책 칩 · openMemberEdit #eTitle(다른 사람이 맡고 있으면 그 사람 것을 비우고 옮김) · 표 칸 data-cell="pos:기", 합계 줄 data-row=min|keep.
- 계산: 충원자는 young + k - recruitAge 기수, 앞 기 충원자는 남는다고 셈. min = ceil(최소 - 남는 인원), keep = max(min, N0 - 인원). 직책 후보 = 다음 기에도 남고, 햇수(함께한 날 기준, 올해 1년째) + k ≥ 조건, 포지션 조건. 새 충원자는 후보에서 뺌.
- 테스트: e2e_v18.py 65 통과 (멤버 10명을 SQL로 넣고 계산값 확인, 시나리오·슬라이더·이탈 가정 CRUD·설정·직책 이동·RLS·초기화). v17·v16·v15·v14·v14_member 회귀.
- 이번 세션도 사용자 PC 연결 없이 프로젝트 문서에서 코드를 가져옴: project_read로 읽은 뒤 세션 jsonl(/root/.claude/projects/-home-claude/<세션>.jsonl)에서 결과를 스크립트로 추출(큰 파일은 local_file 경로). reset_stack 기본 017까지.

## 10-2. 017 상태
- 2026-10-20 v17-update.zip 전달 (migration_016, HTML 5, assets 3, api 4, UPDATE-017). 사용자 사이트에 적용 확인(2026-10-20).
- 결정: 인도자는 폼 포지션에서 일부러 뺌 · 생년월일 리더십만 · 정산 여부 본인 변경 불가(리더십에 문의) · 양력만 · 기수 = 공동체 기수(34~43기).
- 지도: common.js nextBirthday/birthLabel · admin.js parseBulk(hnorm으로 "1. 이름" 번호 제거, 정확한 열 이름 먼저, 타임스탬프 열 있으면 같은 이메일은 마지막 줄만, parseBirth) · 멤버 그룹 "cohort" · 대시보드 .bdays · cron 생일 블록(sentKey kind:member:year) · migration_016 members_copy_gender가 기수·생년월일도 복사, members_guard_update에 3칸 추가.
- 테스트: e2e_v17.py 36 통과, v16(79)·v15(97)·v14(57, 양식 열 순서 맞춰 고침)·v14_member(27) 회귀 통과.
- 20기 신청서(구글 폼, 10/20~31) 응답으로 기존 멤버 일괄 등록 예정. 11/7 팀모임에서 안내.

## 10-1. 016 상태
- 2026-10-17 v16-update.zip 전달 (migration_015, HTML 5, assets 2(admin.js, app.css), api 3(notify, cron, _notify), UPDATE-016). 적용 여부 미확인. v15 적용 여부도 미확인.
- 테스트: e2e_v16.py 79 통과, e2e_v15(97)·e2e_v14(57)·e2e_v14_member(27) 회귀 통과. reset_stack 기본 015까지.
- dev/server.mjs 토큰 만료 30일로 늘림 (테스트에서 브라우저 시계를 앞당겨 불참 알리기 확인 — ctx.clock.set_fixed_time).
- 이번 세션은 코드를 프로젝트 문서에서 직접 가져옴(사용자 PC 폴더 연결 없음): 세션 jsonl의 project_read 결과를 스크립트로 추출, postgrest v12.2.3 static은 github 릴리스에서 받음.
- 다음 후보(사용자 보류): 생일 정산(결제 모듈 대신 송금 링크 + 납부 체크 방향만 이야기함), 실시간 악보 공유·필기(다른 세션에서 브레인스토밍 예정 — 저장 한도: 무료 1GB, 곡 라이브러리 + 업로드 압축 구조로 하자고 제안).

## 10-0. 015 상태
- 2026-10-16 v15-update.zip 전달 (migration_014, HTML 5, assets 3, api 8). 적용 여부 미확인.
- 테스트: e2e_v15.py 97 통과, e2e_v14(57, 일괄 등록은 '사람마다' 고르도록 수정)·e2e_v14_member(27) 회귀 통과. reset_stack 기본 014까지, admin@x.com을 owner로.
- 기도 탭 다음 후보(사용자 보류): QT 나눔 · 성경읽기.

## 10. 다음 세션 시작점
- **최신(023)**: v23 적용 여부 · 실제 악보집 PDF 읽기 결과 · 백업찬양 실사용 피드백 확인 → v24(내 메모 필기) 또는 v21.5(라인업 이름 매칭).
- 현재 상태: v14 구현·테스트 완료, v14-update.zip 전달(2026-10-15). v13은 사용자 사이트에 적용 확인됨. v14 적용 여부와 실제 폰 뒤로가기·보내기 동작을 첫 질문으로 확인.
- 다음 후보: 안내 슬라이드 013·014 장, 사역 연습 출석 통계 반영, 사역 상세 응답 탭에도 연습 칸.
- 이전처럼 요청을 모으고 → 목업(캔버스에 v14 줄) → 확정 → 구현 → zip + UPDATE-0NN.md.

## 11. 작업 방식(사용자 선호)
한국어, 간결·직설, 솔직한 비판. 묻는 것에 먼저 답하고, 스펙이 애매하면 먼저 질문. 업데이트는 zip + UPDATE-0NN.md.
