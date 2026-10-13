# 업데이트: 서약서를 찬양팀 규정 기반으로 + 서약서 편집

## 1. DB (Supabase SQL Editor)
`supabase/migration_006.sql` 실행 → 새 서약서(찬양팀 규정)가 적용돼요.
이미 서약한 사람은 서약 당시 문구가 그대로 남아요.

## 2. GitHub 파일 교체
- 루트: `index.html`, `apply.html`, `login.html`, `me.html`, `admin.html`
- `assets/` 폴더 안: `admin.js`, `app.css`
- `assets/config.js`는 올리지 마세요

## 앞으로 서약서 고칠 때
관리자 › **안내 문구·서약서** › 서약서 내용 수정 → **새 버전으로 저장**
