-- FixMyCity update 4: fixes from the QA report (docs/QA-REPORT.md).
-- Run ONCE in Supabase > SQL Editor, after schema.sql (and 02-demo-and-circles.sql if you ran an older schema).
-- Safe to re-run: every object is dropped first if it already exists.

-- ============================================================
-- 1. Moderation: the admin can delete any report (spam, test entries).
--    Citizens keep their existing rule: own report, only while "submitted".
-- ============================================================
drop policy if exists "reports delete admin" on public.reports;
create policy "reports delete admin" on public.reports for delete to authenticated
  using (public.is_admin());

-- ============================================================
-- 2. Storage: deleting a report can now remove its photo.
--    remove() needs SELECT as well as DELETE on storage.objects.
-- ============================================================
drop policy if exists "report images read own" on storage.objects;
create policy "report images read own" on storage.objects for select to authenticated
  using (bucket_id = 'report-images' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists "report images admin delete" on storage.objects;
create policy "report images admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'report-images' and public.is_admin());

-- ============================================================
-- 3. image_url may only point at the reporter's own folder in this project's bucket.
--    Stops hotlinking arbitrary images or "javascript:" strings via the API.
--    NOT VALID = existing rows are not re-checked, new inserts/updates are.
-- ============================================================
alter table public.reports drop constraint if exists reports_image_url_own_bucket;
alter table public.reports add constraint reports_image_url_own_bucket check (
  image_url is null
  or image_url like '%/storage/v1/object/public/report-images/' || user_id::text || '/%'
     and image_url like 'https://%.supabase.co/%'
) not valid;

-- ============================================================
-- 4. Rate limit: at most 10 reports per user per hour (admins and demo data exempt).
-- ============================================================
create or replace function public.limit_report_rate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not new.is_demo and not public.is_admin() and (
    select count(*) from public.reports
    where user_id = new.user_id and created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'You have sent 10 reports in the last hour. Please wait a little before reporting again.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists before_report_insert_rate on public.reports;
create trigger before_report_insert_rate
  before insert on public.reports
  for each row execute function public.limit_report_rate();

-- ============================================================
-- 5. Action Circles can't be created with a date in the past.
--    Insert-only trigger, so editing an old circle still works.
-- ============================================================
create or replace function public.check_activity_date() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not new.is_demo and new.event_date is not null and new.event_date < now() - interval '5 minutes' then
    raise exception 'Choose a date and time in the future.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists before_activity_insert_date on public.activities;
create trigger before_activity_insert_date
  before insert on public.activities
  for each row execute function public.check_activity_date();

-- ============================================================
-- 6. Keep text fields bounded (the UI already limits them).
-- ============================================================
alter table public.activities drop constraint if exists activities_text_len;
alter table public.activities add constraint activities_text_len check (
  coalesce(char_length(description), 0) <= 1000 and coalesce(char_length(location), 0) <= 160
) not valid;
alter table public.profiles drop constraint if exists profiles_name_len;
alter table public.profiles add constraint profiles_name_len check (
  name is null or char_length(name) between 1 and 60
) not valid;
