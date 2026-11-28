-- Live map updates: publish reports (and comments, if 06 has been run) to Supabase Realtime.
-- Safe to re-run.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reports') then
    alter publication supabase_realtime add table public.reports;
  end if;
  if to_regclass('public.report_comments') is not null
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'report_comments') then
    alter publication supabase_realtime add table public.report_comments;
  end if;
end $$;
