create table if not exists public.tests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  questions jsonb not null,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.tests add column if not exists is_public boolean not null default true;

create table if not exists public.results (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.tests(id) on delete cascade,
  student_name text not null,
  student_phone text,
  score integer not null check (score >= 0),
  total integer not null check (total > 0 and score <= total),
  submitted_at timestamptz not null default now()
);

alter table public.results add column if not exists student_phone text;

create table if not exists public.app_config (
  id integer primary key default 1 check (id = 1),
  teacher_salt text not null,
  teacher_hash text not null,
  site_passcode_salt text not null,
  site_passcode_hash text not null,
  session_secret text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config
  add column if not exists site_passcode_salt text,
  add column if not exists site_passcode_hash text;

create index if not exists results_test_score_idx
  on public.results (test_id, score desc, submitted_at asc);

create or replace view public.test_stats
with (security_invoker = true)
as
select t.id, t.name, t.questions, t.created_at,
       count(r.id)::integer as results_count, t.is_public
from public.tests t
left join public.results r on r.test_id = t.id
group by t.id, t.name, t.questions, t.created_at, t.is_public;

alter table public.tests enable row level security;
alter table public.results enable row level security;
alter table public.app_config enable row level security;
revoke all on table public.tests from anon, authenticated;
revoke all on table public.results from anon, authenticated;
revoke all on table public.app_config from anon, authenticated;
revoke all on table public.test_stats from anon, authenticated;
grant all on table public.tests to service_role;
grant all on table public.results to service_role;
grant all on table public.app_config to service_role;
grant select on table public.test_stats to service_role;

-- Store only password hashes with independent salts. Never commit app_config values or secret keys.