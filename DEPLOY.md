# 배포 순서 (5~8단계)

## 5. DB 추가 설정 실행
Supabase **SQL Editor**에서 `supabase/migration_002.sql` 실행
(임시 비밀번호 방식 + 새 신청서 실시간 표시)

## 6. 키 넣기
`assets/config.js` 를 열어 두 값을 바꿉니다.
- `SUPABASE_URL` ← Project Settings → API → Project URL
- `SUPABASE_ANON_KEY` ← 같은 화면의 **anon public** 키

## 7. GitHub에 올리기
1. github.com → New repository → 이름 예: `worship-team` → **Private** 선택 → Create
2. 생성된 저장소 화면에서 **uploading an existing file** → 압축 푼 폴더 안의 파일·폴더 전부 끌어다 놓기 → Commit

## 8. Vercel에 연결
1. vercel.com → Add New → Project → 방금 만든 저장소 **Import**
2. Framework Preset: **Other** (그대로 두면 됨)
3. **Environment Variables** 두 개 추가 후 Deploy
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = Project Settings → API → **service_role** 키
4. 배포가 끝나면 주소(예: `worship-team.vercel.app`)로 접속

이후 GitHub에 파일을 다시 올리면 Vercel이 자동으로 다시 배포합니다.

## 확인해 볼 것
1. `/apply.html` 에서 본인이 테스트 신청 1건 제출
2. `/login.html` 에서 관리자 계정으로 로그인 → 가입 신청 탭에 바로 보이는지
3. 다른 이메일로 신청한 건을 승인 → 임시 비밀번호로 로그인 → 비밀번호 변경 → 내 정보 화면
