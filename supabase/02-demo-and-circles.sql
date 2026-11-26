-- FixMyCity update 2: adds the "demo data" label, rebuilds the reports view and tightens insert rules.
-- Run ONCE in Supabase > SQL Editor if you already ran schema.sql earlier. Safe to re-run.
-- (A fresh install using the newest schema.sql does not need this file.)

alter table public.reports    add column if not exists is_demo boolean not null default false;
alter table public.activities add column if not exists is_demo boolean not null default false;

-- Citizens can never create rows flagged as demo data.
drop policy if exists "reports insert own" on public.reports;
create policy "reports insert own" on public.reports for insert to authenticated
  with check (user_id = auth.uid() and status = 'submitted' and not is_demo);
drop policy if exists "activities insert own" on public.activities;
create policy "activities insert own" on public.activities for insert to authenticated
  with check (creator_id = auth.uid() and not is_demo);

-- The view must be rebuilt so it includes the new is_demo column.
drop view if exists public.reports_with_counts;
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
grant select on public.reports_with_counts to anon, authenticated;
