v31 시험 (실제 서버 없이)
- 단위: node dev/tests/v31/unit.mjs
- 화면: python3 dev/tests/v31/run.py  (가짜 sb = fake-sb.js · 데이터 = fix.js · harness.html, pdf.js · pdf-lib는 /home/claude/libs에 npm으로)
- 탭 여백: tabs.html을 열어 스크롤
DB: dev/tests/v31_db — createdb t && psql -d t -f stub.sql && psql -d t -f test.sql (test.sql은 /tmp/m030.sql = migration_030.sql을 두 번 실행)
