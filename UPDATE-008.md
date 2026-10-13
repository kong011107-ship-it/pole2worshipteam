# 업데이트: 탈퇴·파기 · 재가입 · 테스트 데이터

## 1. DB (Supabase SQL Editor)
`supabase/migration_007.sql` 실행

## 2. GitHub 파일 교체
- 루트: `index.html`, `apply.html`, `login.html`, `me.html`, `admin.html`
- `api/` 폴더 안: `remove-member.js`, `demo.js` (새 파일), `start-trainee.js`
- `assets/` 폴더 안: `admin.js`, `common.js`, `app.css`
- `assets/config.js`는 올리지 마세요

## 새로 생긴 것
- 멤버 › 펼치기 › **탈퇴 처리** (이름 입력해야 실행) / **탈퇴 기록** 탭
- 모집·수습 › 종료 칸 › **종료 3개월 지난 지원서 n건 삭제**
- 면접 → 수습 시작 창: 같은 이름 탈퇴 기록이 있으면 **재가입(수습 생략)** 선택
- 설정 › **테스트 데이터 만들기 / 모두 지우기**
