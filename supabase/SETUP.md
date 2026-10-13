# Supabase 세팅 순서

## 1. 프로젝트 만들기
- supabase.com → New project
- Region: **Northeast Asia (Seoul)**
- DB 비밀번호는 따로 보관

## 2. 스키마 실행
- 왼쪽 메뉴 **SQL Editor** → `schema.sql` 전체 붙여넣기 → Run
- 실행 전에 `pledge_versions` insert 부분의 서약서 문구를 실제 문구로 바꿔도 되고, 나중에 관리자 화면에서 새 버전을 만들어도 됩니다.

## 3. 회원가입 막기 (중요)
- **Authentication → Sign In / Providers → Email**
  - `Allow new users to sign up` **끄기**
  - (계정은 관리자 승인 시 초대 메일로만 생성됨)

## 4. 첫 관리자 계정 만들기
1. **Authentication → Users → Add user → Create new user** 로 본인 이메일·비밀번호 입력
2. 생성된 사용자의 UID 복사
3. SQL Editor에서 실행:

```sql
insert into public.members (id, name, email, role, main_position)
values ('여기에-UID', '공준혁', '본인이메일', 'admin', 'leader');
```

리더(관리자)가 여러 명이면 같은 방식으로 추가하거나, 이미 멤버인 사람은:

```sql
update public.members set role = 'admin' where email = '이메일';
```

## 5. 키 확인 (다음 단계에서 사용)
**Project Settings → API**
- `Project URL`, `anon public` 키 → 웹페이지에 넣어도 됨
- `service_role` 키 → **절대 웹페이지에 넣지 말 것.** Vercel 환경변수에만 저장

## 서약서 문구를 바꿀 때
기존 행을 수정하지 말고 새 버전을 추가하세요. 기존 멤버는 자기가 서명한 원문을 계속 보게 됩니다.

```sql
update public.pledge_versions set is_active = false where is_active;
insert into public.pledge_versions (title, content, is_active)
values ('찬양팀 서약서 (v2)', '새 문구...', true);
```
