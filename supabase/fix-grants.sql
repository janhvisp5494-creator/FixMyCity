-- ============================================================
-- Run this once if you already ran schema.sql and see "permission denied"
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

