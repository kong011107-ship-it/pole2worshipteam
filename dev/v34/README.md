v34.1 시험 · 캡처 (실제 스택: PG16 + PostgREST + dev/server.mjs)
- 스택: dev/v34/reset_stack.sh (SITE=저장소 경로, 마이그레이션 033까지 · shim.sql · dev/stack_extra.sql)
- 캡처용 데이터: 관리자 › 설정 › 테스트 데이터 만들기(api/demo seed) + seed_conti.sql(11/15 콘티) + share_links 한 줄(토큰 20자 이상)
- 전후 캡처: python3 dev/v34/capture.py <폴더> [m|s|a]  (휴대폰 390 · 태블릿 820 · PC 1280)
- 시험: python3 dev/tests/v34/db_delete.py (리셋 직후) · python3 dev/tests/v34/e2e_ui.py (캡처용 데이터 위)
- ui.css는 build_ui_css.py로 한 번 만들었어요(원래 네 파일은 v33 git에서: CSS_SRC=폴더). 이제는 ui.css를 직접 고쳐요.
