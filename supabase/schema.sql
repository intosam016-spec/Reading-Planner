-- =====================================================================
-- Study Planner — Supabase schema
--
-- Run this once in Supabase Studio -> SQL Editor -> New query -> Run.
--
-- Security model
-- --------------
-- Every table carries user_id. Row-level security is enabled and every
-- policy pins user_id to auth.uid(). That means the database itself
-- refuses to return another student's rows, even if the frontend has a
-- bug or somebody edits the JavaScript in devtools. The browser only
-- ever holds the PUBLIC anon key; the service-role key never ships.
-- =====================================================================

-- ---------- profiles ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "own profile read"   on public.profiles;
drop policy if exists "own profile write"  on public.profiles;
drop policy if exists "own profile insert" on public.profiles;

create policy "own profile read"   on public.profiles for select using (auth.uid() = id);
create policy "own profile write"  on public.profiles for update using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);

-- create the profile row automatically on sign-up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- courses ----------
create table if not exists public.courses (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  name               text not null,
  code               text,
  units              numeric,
  priority           text not null default 'medium' check (priority in ('low','medium','high')),
  difficulty         smallint not null default 3 check (difficulty between 1 and 5),
  exam_date          date,
  estimated_minutes  integer check (estimated_minutes is null or estimated_minutes >= 0),
  topics             jsonb not null default '[]'::jsonb,   -- [{id,name,minutes,done}]
  deadlines          jsonb not null default '[]'::jsonb,   -- [{id,title,date}]
  archived           boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists courses_user_idx on public.courses(user_id);

alter table public.courses enable row level security;
drop policy if exists "own courses" on public.courses;
create policy "own courses" on public.courses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- lectures (the weekly timetable) ----------
create table if not exists public.lectures (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  course_id   uuid references public.courses(id) on delete cascade,
  day         smallint not null check (day between 0 and 6),   -- 0 = Sunday
  start_time  text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time    text not null check (end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  location    text,
  created_at  timestamptz not null default now(),
  check (start_time < end_time)
);
create index if not exists lectures_user_idx on public.lectures(user_id);

alter table public.lectures enable row level security;
drop policy if exists "own lectures" on public.lectures;
create policy "own lectures" on public.lectures
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- availability (study windows + blocked periods) ----------
create table if not exists public.availability (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  day         smallint not null check (day between 0 and 6),
  start_time  text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time    text not null check (end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  kind        text not null default 'study' check (kind in ('study','blocked')),
  label       text,
  created_at  timestamptz not null default now(),
  check (start_time < end_time)
);
create index if not exists availability_user_idx on public.availability(user_id);

alter table public.availability enable row level security;
drop policy if exists "own availability" on public.availability;
create policy "own availability" on public.availability
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- generated reading sessions ----------
create table if not exists public.sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  course_id   uuid references public.courses(id) on delete cascade,
  topic_id    text,
  day         smallint not null check (day between 0 and 6),
  date        date not null,
  week        smallint not null default 0,
  start_time  text not null,
  end_time    text not null,
  start_min   integer not null,
  end_min     integer not null,
  minutes     integer not null check (minutes > 0),
  status      text not null default 'pending' check (status in ('pending','done','missed')),
  locked      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists sessions_user_idx on public.sessions(user_id);
create index if not exists sessions_date_idx on public.sessions(user_id, date);

alter table public.sessions enable row level security;
drop policy if exists "own sessions" on public.sessions;
create policy "own sessions" on public.sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- settings ----------
create table if not exists public.settings (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.settings enable row level security;
drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- keep updated_at honest ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists courses_touch on public.courses;
create trigger courses_touch before update on public.courses
  for each row execute function public.touch_updated_at();

drop trigger if exists sessions_touch on public.sessions;
create trigger sessions_touch before update on public.sessions
  for each row execute function public.touch_updated_at();

-- =====================================================================
-- Grants and schema cache
--
-- PostgREST only exposes a table when the API roles hold a privilege on
-- it. A table can therefore exist in Postgres yet be invisible to the
-- API, which surfaces as:
--   PGRST205  Could not find the table 'public.courses' in the schema cache
--
-- Granting to anon/authenticated does NOT weaken the security model.
-- Row-level security remains the gate, and for an anonymous request
-- auth.uid() is null, so every policy matches zero rows.
--
-- Deliberately scoped to these six tables only: a blanket grant over
-- the whole schema would also expose any unrelated table the project
-- already has.
-- =====================================================================
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on
  public.profiles,
  public.courses,
  public.lectures,
  public.availability,
  public.sessions,
  public.settings
  to anon, authenticated;

-- make PostgREST pick the tables up immediately
alter table public.profiles     enable row level security;
alter table public.courses      enable row level security;
alter table public.lectures     enable row level security;
alter table public.availability enable row level security;
alter table public.sessions     enable row level security;
alter table public.settings     enable row level security;

notify pgrst, 'reload schema';

-- ---------- verification ----------
-- Expect exactly six rows. If you see fewer, the script did not finish.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('profiles','courses','lectures','availability','sessions','settings')
order by table_name;
