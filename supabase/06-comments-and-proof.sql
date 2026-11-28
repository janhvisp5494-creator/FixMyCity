-- Comments on reports + admin "resolution proof" photo. Idempotent.
create table if not exists public.report_comments (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references public.reports on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles on delete cascade,
  body       text not null check (char_length(body) between 1 and 500),
  created_at timestamptz default now()
);
create index if not exists report_comments_report_idx on public.report_comments (report_id, created_at);
alter table public.report_comments enable row level security;

drop policy if exists "comments readable" on public.report_comments;
create policy "comments readable" on public.report_comments for select using (true);
drop policy if exists "comments insert own" on public.report_comments;
create policy "comments insert own" on public.report_comments for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "comments delete own or admin" on public.report_comments;
create policy "comments delete own or admin" on public.report_comments for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

grant select on public.report_comments to anon, authenticated;
grant insert, delete on public.report_comments to authenticated;

-- Resolution proof photo
alter table public.reports add column if not exists resolution_image_url text;

create or replace function public.set_resolution_photo(p_report_id uuid, p_url text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  update public.reports set resolution_image_url = p_url where id = p_report_id;
end;
$$;
revoke execute on function public.set_resolution_photo(uuid, text) from public, anon;
grant  execute on function public.set_resolution_photo(uuid, text) to authenticated;

-- Recreate the view so it picks up the new column
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

-- Admins may upload proof photos into report-images/resolved/
drop policy if exists "report images admin resolved upload" on storage.objects;
create policy "report images admin resolved upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'report-images' and (storage.foldername(name))[1] = 'resolved' and public.is_admin());
