-- FixMyCity: Supabase schema, Row Level Security, storage and helper functions.
-- Run once in Supabase > SQL Editor on a fresh project.
-- After your first sign-up, make yourself the demo admin (see bottom of file).

-- ============================================================
-- 1. Tables
-- ============================================================

-- "users" from the plan. Email lives in auth.users, so profiles holds only app data.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text,
  role        text not null default 'citizen' check (role in ('citizen', 'admin')),
  created_at  timestamptz not null default now()
);

create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 3 and 120),
  description  text check (char_length(description) <= 2000),
  category     text not null check (category in
                 ('pothole', 'garbage', 'streetlight', 'drainage', 'water_logging', 'other')),
  image_url    text,
  latitude     double precision not null check (latitude between -90 and 90),
  longitude    double precision not null check (longitude between -180 and 180),
  area         text,
  status       text not null default 'submitted' check (status in
                 ('submitted', 'community_confirmed', 'acknowledged', 'in_progress', 'resolved')),
  user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  is_demo      boolean not null default false   -- labelled demo data, set only by the seed script
);
create index reports_category_idx on public.reports (category);
create index reports_status_idx   on public.reports (status);
create index reports_geo_idx      on public.reports (latitude, longitude);
create index reports_user_idx     on public.reports (user_id);

create table public.verifications (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.reports (id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  vote        text not null check (vote in ('still_exists', 'worse', 'resolved')),
  created_at  timestamptz not null default now(),
  unique (report_id, user_id)               -- one verification per user per report
);

create table public.activities (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(title) between 3 and 120),
  description  text,
  location     text,
  event_date   timestamptz,
  creator_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  is_demo      boolean not null default false
);

create table public.activity_members (
  id           uuid primary key default gen_random_uuid(),
  activity_id  uuid not null references public.activities (id) on delete cascade,
  user_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  unique (activity_id, user_id)
);

create table public.status_history (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.reports (id) on delete cascade,
  old_status  text,
  new_status  text not null,
  updated_by  uuid references public.profiles (id) on delete set null,  -- null = system
  created_at  timestamptz not null default now()
);
create index status_history_report_idx on public.status_history (report_id, created_at);

-- ============================================================
-- 2. Helper functions and triggers
-- ============================================================

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Create a profile whenever someone signs up.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)));
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Log the first status ("submitted") of every new report.
create function public.log_new_report() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.status_history (report_id, old_status, new_status, updated_by)
  values (new.id, null, new.status, new.user_id);
  return new;
end;
$$;
create trigger on_report_created
  after insert on public.reports
  for each row execute function public.log_new_report();

-- Community confirmation: once 2 residents other than the reporter say the issue
-- still exists (or got worse), a "submitted" report becomes "community_confirmed".
-- This is NOT an official verification.
create function public.auto_confirm_report() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r public.reports%rowtype;
  n integer;
  threshold constant integer := 2;
begin
  select * into r from public.reports where id = new.report_id;
  if r.status = 'submitted' then
    select count(*) into n
    from public.verifications v
    where v.report_id = r.id
      and v.vote in ('still_exists', 'worse')
      and v.user_id <> r.user_id;
    if n >= threshold then
      update public.reports set status = 'community_confirmed' where id = r.id;
      insert into public.status_history (report_id, old_status, new_status, updated_by)
      values (r.id, 'submitted', 'community_confirmed', null);
    end if;
  end if;
  return new;
end;
$$;
create trigger on_verification_changed
  after insert or update on public.verifications
  for each row execute function public.auto_confirm_report();

-- Admin status changes go through this function so history is always written
-- and citizens can never change status directly.
create function public.set_report_status(p_report_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  old_status text;
begin
  if not public.is_admin() then
    raise exception 'Only administrators can change report status' using errcode = '42501';
  end if;
  if p_status not in ('submitted', 'community_confirmed', 'acknowledged', 'in_progress', 'resolved') then
    raise exception 'Invalid status: %', p_status;
  end if;
  select status into old_status from public.reports where id = p_report_id for update;
  if old_status is null then
    raise exception 'Report not found';
  end if;
  if old_status = p_status then
    return;
  end if;
  update public.reports set status = p_status where id = p_report_id;
  insert into public.status_history (report_id, old_status, new_status, updated_by)
  values (p_report_id, old_status, p_status, auth.uid());
end;
$$;
revoke execute on function public.set_report_status(uuid, text) from public, anon;
grant  execute on function public.set_report_status(uuid, text) to authenticated;

-- Repeat Issue Radar helper: same-category reports within p_radius_m metres (Haversine).
-- Call from the app: supabase.rpc('nearby_reports', { p_lat, p_lng, p_category, p_radius_m })
create function public.nearby_reports(
  p_lat double precision,
  p_lng double precision,
  p_category text,
  p_radius_m integer default 150
) returns table (
  id uuid, title text, status text, created_at timestamptz,
  distance_m double precision, confirmations bigint
)
language sql stable security invoker set search_path = '' as $$
  select r.id, r.title, r.status, r.created_at, d.dist,
         (select count(*) from public.verifications v
           where v.report_id = r.id and v.vote in ('still_exists', 'worse'))
  from public.reports r
  cross join lateral (
    select 2 * 6371000 * asin(least(1, sqrt(
      power(sin(radians(r.latitude - p_lat) / 2), 2) +
      cos(radians(p_lat)) * cos(radians(r.latitude)) *
      power(sin(radians(r.longitude - p_lng) / 2), 2)
    ))) as dist
  ) d
  where r.category = p_category
    and r.status <> 'resolved'
    and d.dist <= p_radius_m
  order by d.dist;
$$;

-- Reports plus confirmation counts, handy for the map and Neighbourhood Pulse.
create view public.reports_with_counts with (security_invoker = true) as
select r.*,
       coalesce(c.confirmations, 0)  as confirmations,
       coalesce(c.resolved_votes, 0) as resolved_votes
from public.reports r
left join (
  select report_id,
         count(*) filter (where vote in ('still_exists', 'worse')) as confirmations,
         count(*) filter (where vote = 'resolved')                 as resolved_votes
  from public.verifications
  group by report_id
) c on c.report_id = r.id;

-- ============================================================
-- 3. Row Level Security
-- ============================================================
alter table public.profiles         enable row level security;
alter table public.reports          enable row level security;
alter table public.verifications    enable row level security;
alter table public.activities       enable row level security;
alter table public.activity_members enable row level security;
alter table public.status_history   enable row level security;

-- profiles: anyone can read names; users edit only their own name (never their role).
create policy "profiles readable"    on public.profiles for select using (true);
create policy "profiles update own"  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from anon, authenticated;
grant  update (name) on public.profiles to authenticated;

-- reports: public read; citizens create their own; edit only own content fields.
create policy "reports readable" on public.reports for select using (true);
create policy "reports insert own" on public.reports for insert to authenticated
  with check (user_id = auth.uid() and status = 'submitted' and not is_demo);
create policy "reports update own" on public.reports for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "reports delete own unreviewed" on public.reports for delete to authenticated
  using (user_id = auth.uid() and status = 'submitted');
-- Column-level lock: status, user_id and coordinates can't be edited by citizens.
revoke update on public.reports from anon, authenticated;
grant  update (title, description, category, image_url, area) on public.reports to authenticated;

-- verifications: public read; one vote per user; reporters can't vote on their own report.
create policy "verifications readable" on public.verifications for select using (true);
create policy "verifications insert own" on public.verifications for insert to authenticated
  with check (
    user_id = auth.uid()
    and not exists (select 1 from public.reports r where r.id = report_id and r.user_id = auth.uid())
  );
create policy "verifications update own" on public.verifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "verifications delete own" on public.verifications for delete to authenticated
  using (user_id = auth.uid());
revoke update on public.verifications from anon, authenticated;
grant  update (vote) on public.verifications to authenticated;

-- activities: public read; creators (or admin) manage their own.
create policy "activities readable" on public.activities for select using (true);
create policy "activities insert own" on public.activities for insert to authenticated
  with check (creator_id = auth.uid() and not is_demo);
create policy "activities update own" on public.activities for update to authenticated
  using (creator_id = auth.uid() or public.is_admin())
  with check (creator_id = auth.uid() or public.is_admin());
create policy "activities delete own" on public.activities for delete to authenticated
  using (creator_id = auth.uid() or public.is_admin());

-- activity_members: public read; join and leave as yourself.
create policy "members readable" on public.activity_members for select using (true);
create policy "members join" on public.activity_members for insert to authenticated
  with check (user_id = auth.uid());
create policy "members leave" on public.activity_members for delete to authenticated
  using (user_id = auth.uid());

-- status_history: public read; no insert/update/delete policies, so only the
-- security-definer functions above can write to it.
create policy "history readable" on public.status_history for select using (true);

-- ============================================================
-- 4. Storage: report photos
-- ============================================================
-- Public bucket (photos show on the map), 5 MB limit, images only, and each user
-- can only upload into a folder named after their own user id: <uid>/<filename>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-images', 'report-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "report images upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'report-images' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "report images delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'report-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- 4b. Table permissions (GRANTs)
-- ============================================================
-- Supabase projects no longer grant API access to new tables automatically.
-- RLS policies above decide WHICH rows; these grants decide whether the role may
-- touch the table at all. Both are required.
grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.reports, public.verifications, public.activities,
                public.activity_members, public.status_history, public.reports_with_counts
  to anon, authenticated;
grant insert, delete on public.reports          to authenticated;
grant insert, delete on public.verifications    to authenticated;
grant insert, update, delete on public.activities to authenticated;
grant insert, delete on public.activity_members to authenticated;
-- column-level update rights (status, user_id and coordinates stay locked)
grant update (title, description, category, image_url, area) on public.reports       to authenticated;
grant update (vote)                                          on public.verifications to authenticated;
grant update (name)                                          on public.profiles      to authenticated;
grant execute on function public.nearby_reports(double precision, double precision, text, integer) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ============================================================
-- 5. Make yourself the demo admin (run AFTER you have signed up in the app)
-- ============================================================
-- update public.profiles set role = 'admin'
-- where id = (select id from auth.users where email = 'you@example.com');
