-- =====================================================================
-- ENTRENADOR PWA · FASE 0 · Esquema completo (idempotente)
-- Ejecutar entero en Supabase > SQL Editor (proyecto en región UE)
-- =====================================================================

-- ---------- 1. TABLAS ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'client' check (role in ('trainer','client')),
  full_name text,
  email text not null,
  trainer_id uuid references public.profiles(id) on delete set null,
  is_minor boolean not null default false,
  guardian_name text,
  guardian_consent_at timestamptz,
  gdpr_accepted_at timestamptz,
  gdpr_version text,
  created_at timestamptz not null default now()
);

create table if not exists public.client_invites (
  email text primary key check (email = lower(email)),
  trainer_id uuid not null references public.profiles(id) on delete cascade,
  full_name text,
  is_minor boolean not null default false,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text,
  muscle_group text,
  video_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  start_date date,
  end_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  week_number int not null default 1 check (week_number >= 1),
  day_number int not null default 1 check (day_number between 1 and 7),
  title text not null,
  notes text,
  sort_order int not null default 0
);

create table if not exists public.session_exercises (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  exercise_id uuid references public.exercises(id) on delete set null,
  exercise_name text not null,
  sets int check (sets > 0),
  reps text,
  rest_seconds int check (rest_seconds >= 0),
  rpe numeric(3,1) check (rpe between 0 and 10),
  tempo text,
  notes text,
  sort_order int not null default 0
);

create table if not exists public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  session_exercise_id uuid references public.session_exercises(id) on delete set null,
  set_number int not null default 1 check (set_number >= 1),
  reps_done int check (reps_done >= 0),
  weight_kg numeric(6,2) check (weight_kg >= 0),
  rpe numeric(3,1) check (rpe between 0 and 10),
  pain_flag boolean not null default false,
  pain_note text,
  logged_at timestamptz not null default now()
);

create table if not exists public.habits_nutrition (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  category text not null default 'habito' check (category in ('alimentacion','descanso','habito')),
  title text not null,
  content text,
  frequency text,
  sort_order int not null default 0
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.trainer_notes (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_trainer on public.profiles(trainer_id);
create index if not exists idx_exercises_trainer on public.exercises(trainer_id);
create index if not exists idx_plans_client on public.plans(client_id);
create index if not exists idx_plans_trainer on public.plans(trainer_id);
create index if not exists idx_sessions_plan on public.sessions(plan_id);
create index if not exists idx_sess_ex_session on public.session_exercises(session_id);
create index if not exists idx_logs_client on public.workout_logs(client_id, logged_at);
create index if not exists idx_habits_plan on public.habits_nutrition(plan_id);
create index if not exists idx_msg_sender on public.messages(sender_id);
create index if not exists idx_msg_recipient on public.messages(recipient_id);
create index if not exists idx_notes_client on public.trainer_notes(client_id);

-- ---------- 2. FUNCIONES AUXILIARES (para las políticas RLS) ----------
create or replace function public.is_trainer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'trainer');
$$;

create or replace function public.has_consent() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and gdpr_accepted_at is not null
      and (not is_minor or guardian_consent_at is not null)
  );
$$;

create or replace function public.my_trainer_id() returns uuid
language sql stable security definer set search_path = public as $$
  select trainer_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_my_client(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_trainer()
     and exists (select 1 from public.profiles where id = uid and trainer_id = auth.uid());
$$;

create or replace function public.owns_plan(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.plans where id = pid and trainer_id = auth.uid());
$$;

create or replace function public.sees_plan(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_consent()
     and exists (select 1 from public.plans
                 where id = pid and client_id = auth.uid() and status = 'active');
$$;

create or replace function public.owns_session(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sessions s join public.plans p on p.id = s.plan_id
                 where s.id = sid and p.trainer_id = auth.uid());
$$;

create or replace function public.sees_session(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sessions s where s.id = sid and public.sees_plan(s.plan_id));
$$;

create or replace function public.sees_session_exercise(seid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.session_exercises se
                 where se.id = seid and public.sees_session(se.session_id));
$$;

-- ---------- 3. TRIGGERS ----------
-- 3a. Al registrarse alguien se crea su perfil. SIEMPRE como 'client'.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv public.client_invites%rowtype;
begin
  select * into inv from public.client_invites
   where email = lower(new.email) and used_at is null;

  insert into public.profiles (id, role, email, full_name, trainer_id, is_minor)
  values (new.id, 'client', lower(new.email),
          coalesce(inv.full_name, split_part(new.email, '@', 1)),
          inv.trainer_id, coalesce(inv.is_minor, false));

  if inv.email is not null then
    update public.client_invites set used_at = now() where email = inv.email;
  end if;
  return new;
end $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3b. Auditoría RGPD: solo el propio usuario acepta; la fecha la pone el servidor.
create or replace function public.guard_profile_update() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null then
    if new.gdpr_version is distinct from old.gdpr_version
       or new.gdpr_accepted_at is distinct from old.gdpr_accepted_at then
      if auth.uid() <> new.id then
        raise exception 'Solo el propio usuario puede aceptar la política de privacidad';
      end if;
      new.gdpr_accepted_at := now();
    end if;
    if auth.uid() = new.id and (
         new.is_minor is distinct from old.is_minor
         or new.guardian_name is distinct from old.guardian_name
         or new.guardian_consent_at is distinct from old.guardian_consent_at) then
      raise exception 'Estos datos solo los puede modificar tu entrenador';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------- 4. PERMISOS POR COLUMNA ----------
revoke all on all tables in schema public from anon;

revoke update on public.profiles from authenticated;
grant update (full_name, is_minor, guardian_name, guardian_consent_at,
              gdpr_accepted_at, gdpr_version) on public.profiles to authenticated;

revoke update on public.messages from authenticated;
grant update (read_at) on public.messages to authenticated;

-- ---------- 5. ACTIVAR ROW LEVEL SECURITY EN TODAS LAS TABLAS ----------
alter table public.profiles          enable row level security;
alter table public.client_invites    enable row level security;
alter table public.exercises         enable row level security;
alter table public.plans             enable row level security;
alter table public.sessions          enable row level security;
alter table public.session_exercises enable row level security;
alter table public.workout_logs      enable row level security;
alter table public.habits_nutrition  enable row level security;
alter table public.messages          enable row level security;
alter table public.trainer_notes     enable row level security;

-- ---------- 6. POLÍTICAS RLS ----------
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- profiles
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_select_my_clients on public.profiles
  for select to authenticated using (trainer_id = auth.uid());
create policy profiles_select_my_trainer on public.profiles
  for select to authenticated using (id = public.my_trainer_id());
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_my_clients on public.profiles
  for update to authenticated
  using (public.is_my_client(id)) with check (public.is_my_client(id));

-- client_invites
create policy invites_trainer_all on public.client_invites
  for all to authenticated
  using (trainer_id = auth.uid() and public.is_trainer())
  with check (trainer_id = auth.uid() and public.is_trainer());

-- exercises
create policy exercises_trainer_all on public.exercises
  for all to authenticated
  using (trainer_id = auth.uid() and public.is_trainer())
  with check (trainer_id = auth.uid() and public.is_trainer());
create policy exercises_client_read on public.exercises
  for select to authenticated
  using (trainer_id = public.my_trainer_id() and public.has_consent());

-- plans
create policy plans_trainer_all on public.plans
  for all to authenticated
  using (trainer_id = auth.uid() and public.is_trainer())
  with check (trainer_id = auth.uid() and public.is_trainer() and public.is_my_client(client_id));
create policy plans_client_read on public.plans
  for select to authenticated
  using (client_id = auth.uid() and status = 'active' and public.has_consent());

-- sessions
create policy sessions_trainer_all on public.sessions
  for all to authenticated
  using (public.owns_plan(plan_id)) with check (public.owns_plan(plan_id));
create policy sessions_client_read on public.sessions
  for select to authenticated using (public.sees_plan(plan_id));

-- session_exercises
create policy sess_ex_trainer_all on public.session_exercises
  for all to authenticated
  using (public.owns_session(session_id)) with check (public.owns_session(session_id));
create policy sess_ex_client_read on public.session_exercises
  for select to authenticated using (public.sees_session(session_id));

-- habits_nutrition
create policy habits_trainer_all on public.habits_nutrition
  for all to authenticated
  using (public.owns_plan(plan_id)) with check (public.owns_plan(plan_id));
create policy habits_client_read on public.habits_nutrition
  for select to authenticated using (public.sees_plan(plan_id));

-- workout_logs
create policy logs_client_all on public.workout_logs
  for all to authenticated
  using (client_id = auth.uid() and public.has_consent())
  with check (client_id = auth.uid() and public.has_consent()
              and (session_exercise_id is null or public.sees_session_exercise(session_exercise_id)));
create policy logs_trainer_read on public.workout_logs
  for select to authenticated using (public.is_my_client(client_id));

-- messages
create policy messages_select on public.messages
  for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and ((public.has_consent() and recipient_id = public.my_trainer_id())
         or public.is_my_client(recipient_id))
  );
create policy messages_mark_read on public.messages
  for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- trainer_notes (privadas: el cliente NO tiene ninguna política)
create policy notes_trainer_all on public.trainer_notes
  for all to authenticated
  using (trainer_id = auth.uid() and public.is_trainer())
  with check (trainer_id = auth.uid() and public.is_trainer() and public.is_my_client(client_id));

-- ---------- 7. STORAGE: bucket privado de vídeos ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-videos', 'exercise-videos', false, 52428800, array['video/mp4','video/webm'])
on conflict (id) do nothing;

drop policy if exists videos_trainer_all on storage.objects;
create policy videos_trainer_all on storage.objects
  for all to authenticated
  using (bucket_id = 'exercise-videos' and public.is_trainer()
         and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'exercise-videos' and public.is_trainer()
         and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists videos_client_read on storage.objects;
create policy videos_client_read on storage.objects
  for select to authenticated
  using (bucket_id = 'exercise-videos' and public.has_consent()
         and (storage.foldername(name))[1] = public.my_trainer_id()::text);

-- ---------- 8. TU CUENTA DE ENTRENADOR (ejecutar DESPUÉS, solo una vez) ----------
-- Primero crea tu usuario en Authentication > Users > Add user (marca "Auto Confirm").
-- Después, quitando los dos guiones, ejecuta esto con TU email:
-- update public.profiles set role = 'trainer' where email = 'tu@email.com';
