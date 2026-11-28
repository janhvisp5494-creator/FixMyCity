-- FixMyCity update 5: report flags, leaderboard, resolution stats.
-- Run in Supabase > SQL Editor, after schema.sql and 04-fixes.sql.
-- Safe to re-run.

-- ============================================================
-- 1. report_flags: residents flag spam or wrong reports; admin reviews.
-- ============================================================
create table if not exists public.report_flags (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.reports (id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reason      text not null check (char_length(reason) between 3 and 300),
  created_at  timestamptz default now(),
  unique (report_id, user_id)               -- one flag per user per report
);

alter table public.report_flags enable row level security;

drop policy if exists "flags insert own" on public.report_flags;
create policy "flags insert own" on public.report_flags for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "flags select own or admin" on public.report_flags;
create policy "flags select own or admin" on public.report_flags for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "flags delete admin" on public.report_flags;
create policy "flags delete admin" on public.report_flags for delete to authenticated
  using (public.is_admin());

-- No anon access; RLS decides the rows.
revoke all on public.report_flags from anon;
grant select, insert, delete on public.report_flags to authenticated;

-- ============================================================
-- 2. Leaderboard: 10 pts per report, 2 per verification (not "resolved"),
--    5 per Action Circle joined. Admins excluded.
--    Call: supabase.rpc('leaderboard', { p_limit: 5 })
-- ============================================================
create or replace function public.leaderboard(p_limit int default 5)
returns table (user_id uuid, name text, points bigint)
language sql stable security definer set search_path = '' as $$
  select p.id,
         p.name,
         (
           (select count(*) from public.reports r where r.user_id = p.id) * 10
           + (select count(*) from public.verifications v
               where v.user_id = p.id and v.vote <> 'resolved') * 2
           + (select count(*) from public.activity_members m where m.user_id = p.id) * 5
         )::bigint as points
  from public.profiles p
  where p.role <> 'admin'
  order by points desc, p.name
  limit greatest(coalesce(p_limit, 5), 0);
$$;
revoke execute on function public.leaderboard(int) from public;
grant  execute on function public.leaderboard(int) to anon, authenticated;

-- ============================================================
-- 3. Resolution stats: average days from "submitted" to first "resolved".
--    Call: supabase.rpc('resolution_stats')
-- ============================================================
create or replace function public.resolution_stats()
returns table (avg_days_to_resolve numeric, resolved_count bigint, total_count bigint)
language sql stable security definer set search_path = '' as $$
  select
    (select round(avg(extract(epoch from (res.at - sub.at)) / 86400)::numeric, 1)
       from (select report_id, min(created_at) as at
               from public.status_history group by report_id) sub
       join (select report_id, min(created_at) as at
               from public.status_history where new_status = 'resolved' group by report_id) res
         on res.report_id = sub.report_id
       join public.reports r on r.id = sub.report_id and r.status = 'resolved'),
    (select count(*) from public.reports where status = 'resolved'),
    (select count(*) from public.reports);
$$;
revoke execute on function public.resolution_stats() from public;
grant  execute on function public.resolution_stats() to anon, authenticated;
