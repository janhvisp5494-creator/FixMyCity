-- FixMyCity update 8: dispute a "Resolved" report.
-- Run in Supabase > SQL Editor, after 07-realtime.sql. Safe to re-run.
--
-- Residents who are not the reporter can say "not really fixed" on a resolved report.
-- When 2 residents do, the report goes back to "in_progress" (logged in status_history with
-- no admin user, so the timeline shows it as a community action) and that round of disputes is cleared.

create table if not exists public.report_disputes (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.reports (id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  note        text not null check (char_length(note) between 3 and 300),
  created_at  timestamptz default now(),
  unique (report_id, user_id)               -- one dispute per user per report
);
create index if not exists report_disputes_report_idx on public.report_disputes (report_id);

alter table public.report_disputes enable row level security;

-- Counts are public.
drop policy if exists "disputes readable" on public.report_disputes;
create policy "disputes readable" on public.report_disputes for select using (true);

-- Only on a resolved report, and never by its own reporter.
drop policy if exists "disputes insert own" on public.report_disputes;
create policy "disputes insert own" on public.report_disputes for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.reports r
                where r.id = report_id and r.status = 'resolved' and r.user_id <> auth.uid())
  );

drop policy if exists "disputes delete own" on public.report_disputes;
create policy "disputes delete own" on public.report_disputes for delete to authenticated
  using (user_id = auth.uid());

grant select on public.report_disputes to anon, authenticated;
grant insert, delete on public.report_disputes to authenticated;

-- Reopen at 2 disputes. Runs as the table owner so it can change status and write history.
create or replace function public.reopen_on_disputes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_status text;
  n int;
begin
  select status into old_status from public.reports where id = new.report_id for update;
  if old_status is distinct from 'resolved' then
    return new;
  end if;
  select count(*) into n from public.report_disputes where report_id = new.report_id;
  if n >= 2 then
    update public.reports set status = 'in_progress' where id = new.report_id;
    insert into public.status_history (report_id, old_status, new_status, updated_by)
    values (new.report_id, old_status, 'in_progress', null);
    delete from public.report_disputes where report_id = new.report_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.reopen_on_disputes() from public, anon, authenticated;

drop trigger if exists after_dispute_insert on public.report_disputes;
create trigger after_dispute_insert
  after insert on public.report_disputes
  for each row execute function public.reopen_on_disputes();
