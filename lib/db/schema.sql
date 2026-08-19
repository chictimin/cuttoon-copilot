-- 컷툰 제작 AI 코파일럿 — DB 스키마
--
-- 계층은 PRD.md 3절대로 Project → Session → Output 세 단계다.
-- 워크스페이스·초대코드·권한은 협업 제외로 없앴으므로 users 테이블도 두지 않는다.
--
-- 접근 경로: 서버(app/api/*)에서만 붙는다. 클라이언트에서 직접 붙지 않으므로
-- anon key를 쓰지 않고 service role key를 서버 환경변수로만 쓴다. 인증이 없는
-- 단일 사용자 전제라 RLS로 나눌 주체 자체가 없다 — 대신 클라이언트에 키를
-- 절대 내려보내지 않는 것으로 막는다.
--
-- 배포하지 않고 각자 로컬에서 실행하는 것을 전제로 한다(발표도 로컬 시연).
-- 외부에서 API를 호출할 경로가 없으므로 라우트 인증을 따로 두지 않는다.
-- 배포하게 되면 그 시점에 라우트 보호를 먼저 붙여야 한다 — 특히 이미지를
-- 생성하는 라우트는 열리는 순간 크레딧이 소모된다.
--
-- DB 구조 변경은 A③만 (README.md git 규칙 4번).

-- ─────────────────────────────────────────────────────────────
-- projects — 프리셋 하나가 지배하는 작업 단위
-- ─────────────────────────────────────────────────────────────
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  -- project_name의 정본은 이 컬럼이다 (issue #7 결정).
  -- preset JSON의 project_name은 API가 출력할 때 이 값으로 채워 내려보낸다.
  -- 목록 화면에서 jsonb를 파싱하지 않아도 되고, 이름을 바꿀 때 JSON을 다시 쓰지 않는다.
  name        text not null check (length(name) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- presets — preset.schema.json v1.1 문서를 통째로 보관
-- ─────────────────────────────────────────────────────────────
create table if not exists presets (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  -- 스키마 버전을 컬럼으로 꺼내둔다. data->>'preset_version'으로도 읽히지만,
  -- 버전별 마이그레이션을 할 때 jsonb를 훑지 않고 인덱스로 고르기 위해서다.
  version     text not null,
  -- 프리셋 문서 전체. 필드를 컬럼으로 펼치지 않는 이유는 포맷 소유권이 A①이고
  -- (PRD.md 5절) 스키마가 바뀔 때마다 DDL을 따라 고치게 되면 계약이 DB에 묶인다.
  -- 검증은 저장 전에 lib/llm/preset-guard.ts가 한다.
  data        jsonb not null,
  created_at  timestamptz not null default now()
);

create index if not exists presets_project_id_idx on presets (project_id);

-- ─────────────────────────────────────────────────────────────
-- sessions — 컷툰 한 편
-- ─────────────────────────────────────────────────────────────
create table if not exists sessions (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  -- 세션이 어느 프리셋으로 만들어졌는지 고정한다. 프리셋을 나중에 고쳐도
  -- 이미 만든 컷툰이 따라 바뀌면 안 된다.
  preset_id     uuid not null references presets(id) on delete restrict,
  subject       text not null check (length(subject) > 0),
  -- 저장은 하되 기능은 만들지 않는 컬럼 (PRD.md 6절). 컷 재생성 시
  -- previous_response_id 체인을 복구하려면 필요해질 값이라 자리를 비워둔다.
  chat_history  jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists sessions_project_id_idx on sessions (project_id);

-- ─────────────────────────────────────────────────────────────
-- session_versions — 되돌리기 1단계를 위한 버전 보관
-- ─────────────────────────────────────────────────────────────
-- PRD.md 3절이 버전 비교(diff) UI를 제외했으므로 목록을 보여줄 일이 없다.
-- 화면은 최신 하나만 표시하고 "되돌리기" 버튼 하나만 둔다. 그래도 v2 저장은
-- P2 통과 조건이므로 행은 쌓아둔다.
create table if not exists session_versions (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  version     integer not null check (version >= 1),
  -- storyboard.schema.json 문서 전체 (4컷 + cast + 캡션).
  storyboard  jsonb not null,
  created_at  timestamptz not null default now(),
  unique (session_id, version)
);

create index if not exists session_versions_session_id_version_idx
  on session_versions (session_id, version desc);

-- ─────────────────────────────────────────────────────────────
-- assets — asset:// 참조를 실제 저장 위치로 푸는 표
-- ─────────────────────────────────────────────────────────────
-- 스키마의 모든 이미지 필드가 asset:// 문자열이다. 그 문자열을 여기서 해석한다.
-- 변환 계층 자체는 issue #3 소관이고, 이 표는 그 계층이 쓸 자리다.
create table if not exists assets (
  id            uuid primary key default gen_random_uuid(),
  -- asset://characters/kriee-fairy-instructor.png 의 "characters/kriee-..." 부분.
  -- asset:// 접두사는 저장하지 않는다 — 규약이 바뀌면 접두사만 갈아끼운다.
  ref_path      text not null unique,
  storage_path  text not null,
  mime_type     text not null,
  -- 계약 ④가 요구하는 메타. 말풍선을 얹을 때 좌표 계산에 쓴다.
  width         integer,
  height        integer,
  created_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- selections — 어떤 안을 골랐는지 기록. 판정 로직은 만들지 않는다
-- ─────────────────────────────────────────────────────────────
-- PRD.md 6절: 저장 규칙만 지키면 나중에 읽는 코드만 붙이면 된다.
-- 표지컷 3안 중 무엇을 골랐는지가 쌓이면 프리셋 승격 규칙을 만들 수 있지만,
-- 그 판정 로직은 지금 만들지 않는다.
create table if not exists selections (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references sessions(id) on delete cascade,
  cut_index      integer not null check (cut_index between 1 and 4),
  variant_index  integer not null check (variant_index >= 0),
  created_at     timestamptz not null default now()
);

create index if not exists selections_session_id_idx on selections (session_id);

-- ─────────────────────────────────────────────────────────────
-- updated_at 자동 갱신
-- ─────────────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists projects_set_updated_at on projects;
create trigger projects_set_updated_at
  before update on projects
  for each row execute function set_updated_at();

drop trigger if exists sessions_set_updated_at on sessions;
create trigger sessions_set_updated_at
  before update on sessions
  for each row execute function set_updated_at();
