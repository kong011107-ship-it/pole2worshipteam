v33 시험 (실제 서버 없이)
- 단위: node dev/tests/v33/unit_seg.mjs  (구간 종류 solo · medley · split · unsure · odd · 메들리 묶음 시간)
- cron: node dev/tests/v33/sync_rule.mjs  (규칙 버전이 오르면 저장된 영상 전체 다시 맞추기 · 한 번만)
- 화면: python3 dev/tests/v33/run_seg.py  (곡 실연주 solo만 · 메들리 실연주 · 콘티 쓰기 메들리 RT · '시간 제외')
- DB: migration_031 → migration_032 두 번 (v32_db/stub.sql 위에서) — 기존 메들리 행 seg 채우기 · 제약 · video_bundle 9칸
