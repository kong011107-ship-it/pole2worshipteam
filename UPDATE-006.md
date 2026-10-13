# 업데이트: 리더십 응답 화면 · 응답 직접 수정 · 불가자 배치

DB 변경 없음. 파일만 교체하세요.

## GitHub에 올릴 파일
- 루트: `index.html`, `apply.html`, `login.html`, `me.html`, `admin.html`
- `assets/` 폴더 안: `admin.js`, `common.js`, `app.css`
  → 저장소에서 **assets 폴더로 들어간 뒤** Upload files 하세요 (루트에 올리면 적용 안 됨)
- `assets/config.js`는 올리지 마세요

## 확인
사이트 주소 뒤에 `/assets/admin.js?v=6` 를 열고 Ctrl+F로 `a-btn` 이 보이면 정상 반영된 거예요.
이번부터 HTML이 `?v=6` 처럼 버전을 붙여 불러서, 브라우저가 예전 파일을 쓰는 일이 없어요.
