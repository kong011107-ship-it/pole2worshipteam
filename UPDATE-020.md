# 업데이트 020: 백업 · 변경 기록 · 동시 수정 보호 · 알림 중복 방지

> 먼저 확인: **v19.5까지 적용돼 있어야 해요** (migration_018까지).
> 이번으로 Phase 1 마무리예요.

## 1. Supabase SQL
SQL Editor에서 `supabase/migration_019.sql` 전체를 붙여넣고 한 번 실행. 여러 번 실행해도 괜찮아요.

## 2. GitHub 파일 교체
- 루트: `index.html`, `apply.html`, `login.html`, `me.html`, `admin.html`
- `assets/` 안: `admin.js`, `app.css`
- `api/` 안: `_notify.js`, `cron.js`, `notify.js`, `apply-notify.js`
- **새 파일**: `.github/workflows/backup.yml` (폴더째 그대로 — 아래 3번)
- `assets/config.js`는 올리지 마세요.

## 3. 자동 백업 설정 (한 번만, 10분)
Supabase 무료 플랜은 자동 백업이 없어요. 대신 GitHub이 매주 일요일 새벽 3시 17분에 데이터 전체를 암호화해서 90일 동안 보관해요.

1. **DB 주소 복사** — Supabase 대시보드 › 위쪽 **Connect** › **Session pooler** 탭의 주소(`postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-...pooler.supabase.com:5432/postgres`).
   `[YOUR-PASSWORD]`를 DB 비밀번호로 바꿔요. 비밀번호를 모르면 Project Settings › Database › Reset database password.
   (Direct connection 주소는 GitHub에서 연결이 안 돼요. 꼭 Session pooler)
2. **백업 암호 정하기** — 20자 이상 아무 문장. **잃어버리면 백업을 못 열어요** — 비밀번호 관리 앱이나 종이에 따로 적어 두세요.
3. GitHub 저장소 › **Settings › Secrets and variables › Actions › New repository secret** 두 개:
   - `SUPABASE_DB_URL` = 1번 주소
   - `BACKUP_PASSPHRASE` = 2번 암호
4. `.github/workflows/backup.yml` 올리기 — 저장소 › Add file › Create new file › 이름 칸에 `.github/workflows/backup.yml` 그대로 적고 내용 붙여넣기 › Commit.
5. **바로 한 번 돌려 보기** — 저장소 › **Actions › DB 백업 › Run workflow**. 1~2분 뒤 초록 체크면 성공.
6. 사이트 **설정 › 백업 · 변경 기록**에 `마지막 백업 …`이 초록으로 뜨면 끝.

실패하면 GitHub이 메일을 보내고, 설정 화면에도 빨간색으로 떠요. 8일 넘게 백업이 없으면 주황색.

### 백업 파일로 되살리기 (큰 사고일 때만)
작은 실수(지운 출석 · 배치 · 메모, 잘못 고친 정보)는 **설정 › 변경 기록 보기**에서 바로 되살려요. 백업은 데이터베이스가 통째로 망가졌을 때 써요.

1. Actions › DB 백업 › 원하는 날짜 실행 › 아래 Artifacts에서 `pole2-backup-날짜.tar.gpg` 내려받기 (zip으로 한 번 더 감싸져 있어요)
2. 풀기: `gpg -d pole2-backup-날짜.tar.gpg > b.tar && tar xf b.tar` → `public-….dump`, `auth-….dump`
3. 새(또는 비운) Supabase 프로젝트에:
   ```
   pg_restore -d "<Session pooler 주소>" --no-owner auth-….dump
   pg_restore -d "<Session pooler 주소>" --no-owner --no-privileges public-….dump
   ```
   `schema "public" already exists` 오류 1개는 괜찮아요. 그 뒤 `cron_012.sql`을 다시 실행하고 Vercel 환경변수의 Supabase 주소·키를 새 프로젝트 것으로 바꿔요.
   막히면 파일과 함께 Claude에게 물어보세요.

## 확인
1. **동시 수정**: 두 브라우저(또는 PC·폰)에서 같은 멤버 '정보 수정'을 열고, 한쪽에서 연락처를 바꿔 저장 → 다른 쪽에서도 연락처를 바꿔 저장하면 *저장하지 않았어요 · 그 사이 다른 리더가 먼저 고친 칸이 있어요*가 떠야 해요. 한 번 더 누르면 내 값으로 저장.
2. **변경 기록**: 설정 › 백업 · 변경 기록 › 변경 기록 보기. 방금 바꾼 연락처가 `이전 → 새 값`으로 보이고, '되돌리기'를 누르면 이전 값으로.
3. **백업**: 위 3-5, 3-6.

## 바뀐 것

### 변경 기록 · 되살리기 (설정 › 변경 기록 보기)
- 멤버 정보 · 리더십 메모 · 숙련도 · 추가 포지션 · 지원서 · 면접 평가 · 수습 기록 · 출석 · 배치 · 일정 · 사역 · 설정을 누가 언제 바꿨는지 남아요 (리더십만 봐요)
- **지운 것은 되살리기**: 출석 · 배치 · 리더십 메모 · 숙련도 · 추가 포지션 · 면접 평가 · 수습 미루기 · 이탈 가정 · 승계 후보
- **바꾼 것은 되돌리기**: 바뀐 칸을 이전 값으로. 그 뒤에 또 바뀐 칸이 있으면 막아요
- 종류(멤버 · 출석 · 배치 · 지원·수습 · 일정·설정 · 지운 것)와 이름으로 찾기
- **개인정보**: 탈퇴하거나 지운 사람의 기록은 함께 지워지고 이름 한 줄만 남아요. 3개월 지난 지원서를 파기하면 그 지원서 기록도 지워져요. 1년 지난 기록은 매일 새벽 4시에 지워져요. 초기화하면 기록도 비워요
- 팀원 응답(섬김 가능 여부 · 연습 시간 · 기도제목 · 투표)은 기록하지 않아요

### 동시 수정 보호
- **멤버 정보 수정 · 지원서 관리자 메모 · 수습 주간 기록**은 이제 *내가 바꾼 칸만* 저장해요. 다른 리더가 그 사이 다른 칸을 고쳤으면 그대로 두고 합쳐요
- 같은 칸을 다른 리더가 먼저 고쳤으면 **아무것도 저장하지 않고** 지금 값을 보여 줘요. 확인 후 한 번 더 누르면 내 값으로
- 직책 옮기기 · 추가 포지션 · 숙련도 · 메모까지 한 번에 저장 (중간에 실패해서 직책이 사라지는 일 없음)

### 예약 알림 중복 방지
- 마감 임박 · 수습 기록 · 기도 · 생일 · 새 지원서 · 급한 기도는 **보내기 전에 자리를 먼저 잡아요**. 예약이 겹쳐 두 번 불려도 한 번만 가요
- 보내다 서버가 멈추면 잡은 자리를 풀어서 다음에 다시 보낼 수 있어요
- 알림 하나가 실패해도 나머지 예약 알림은 계속 보내요
