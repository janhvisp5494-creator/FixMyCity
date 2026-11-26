-- FixMyCity demo data for videos and screenshots. Everything created here is flagged is_demo = true,
-- and the app shows a "Demo data" label on it. These are NOT real reports or real city statistics.
-- Run AFTER schema.sql (and 02-demo-and-circles.sql if you ran the older schema).
-- To remove it all later:  delete from public.reports where is_demo;  delete from public.activities where is_demo;
--
-- Change the two numbers below to your own city centre (default: Vadodara).

drop table if exists pg_temp.params, pg_temp.demo_users, pg_temp.demo_seed;

create temp table params as select 22.3072::double precision as lat0, 73.1812::double precision as lng0;

do $$
declare n_demo int;
begin
  if exists (select 1 from public.reports where is_demo) then
    raise exception 'Demo data is already present. Delete it first (see comment at the top of this file).';
  end if;
  -- 4 demo residents (cannot log in; they only own demo reports and votes)
  for i in 1..4 loop
    begin
      insert into auth.users (id, email, aud, role, raw_user_meta_data, created_at, updated_at)
      values (gen_random_uuid(), 'demo' || i || '@demo.fixmycity.invalid', 'authenticated', 'authenticated',
              jsonb_build_object('name', (array['Demo Asha','Demo Ravi','Demo Meera','Demo Kabir'])[i]), now(), now());
    exception when others then
      raise notice 'Demo user % not created: %', i, sqlerrm;
    end;
  end loop;
  select count(*) into n_demo from public.profiles p join auth.users u on u.id = p.id where u.email like '%@demo.fixmycity.invalid';
  if n_demo = 0 then
    raise exception 'Could not create demo residents (see notices). Tell your developer the error.';
  end if;
end $$;

create temp table demo_users as
  select row_number() over (order by p.id) as n, p.id
  from public.profiles p join auth.users u on u.id = p.id
  where u.email like '%@demo.fixmycity.invalid';

-- title, category, metres north/east of the centre, final status, days ago, area, confirmations, description
create temp table demo_seed as
select row_number() over () as idx, * from (values
  ('Deep pothole near the bus stop',        'pothole',       0,    0,  'acknowledged',        12, 'Demo Ward 1', 2, 'Wide pothole that fills with water when it rains. Two-wheelers swerve around it.'),
  ('Pothole at the junction',               'pothole',      45,  -30,  'submitted',             9, 'Demo Ward 1', 1, 'Crater at the edge of the junction, hard to see at night.'),
  ('Road surface broken outside the shop',  'pothole',     -60,   40,  'submitted',             7, 'Demo Ward 1', 1, 'Tarmac has crumbled over about a metre.'),
  ('New pothole after last week''s rain',   'pothole',      90,   70,  'submitted',             4, 'Demo Ward 1', 0, 'Appeared this week.'),
  ('Pothole on the service lane',           'pothole',     -20, -110,  'submitted',             3, 'Demo Ward 1', 0, 'Small but deepening.'),
  ('Garbage pile near the market gate',     'garbage',     400, -300,  'acknowledged',         10, 'Demo Ward 2', 2, 'Waste has not been collected for several days.'),
  ('Overflowing bin on the main road',      'garbage',     430, -260,  'community_confirmed',   6, 'Demo Ward 2', 2, 'Bin overflowing onto the footpath.'),
  ('Rubbish dumped beside the wall',        'garbage',     380, -340,  'submitted',             2, 'Demo Ward 2', 0, 'Mixed waste dumped overnight.'),
  ('Streetlight not working on the lane',   'streetlight',-500,  200,  'in_progress',          15, 'Demo Ward 3', 2, 'Whole stretch is dark after sunset.'),
  ('Flickering streetlight near the park',  'streetlight',-520,  260,  'submitted',             8, 'Demo Ward 3', 1, 'Flickers on and off all evening.'),
  ('Blocked drain after the market',        'drainage',    200,  500,  'community_confirmed',   5, 'Demo Ward 2', 2, 'Drain is clogged with plastic and mud.'),
  ('Water standing on the underpass road',  'water_logging',-300,-450, 'submitted',             1, 'Demo Ward 3', 0, 'Water stays for hours after light rain.'),
  ('Garbage cleared from the corner plot',  'garbage',     100,  300,  'resolved',             28, 'Demo Ward 2', 3, 'Cleared after neighbours raised it.'),
  ('Pothole repaired on the ring road',     'pothole',    -800, -300,  'resolved',             33, 'Demo Ward 3', 2, 'Patched and levelled.'),
  ('Large pothole near the school',         'pothole',     900,  600,  'resolved',             20, 'Demo Ward 2', 2, 'Filled in after being flagged.')
) as t(title, category, north_m, east_m, status, days_ago, area, conf, descr);

insert into public.reports (title, description, category, latitude, longitude, area, status, user_id, created_at, is_demo)
select s.title, s.descr, s.category,
       p.lat0 + s.north_m / 111320.0,
       p.lng0 + s.east_m / (111320.0 * cos(radians(p.lat0))),
       s.area, s.status,
       (select id from demo_users where n = 1 + (s.idx % (select count(*) from demo_users))),
       now() - make_interval(days => s.days_ago::int), true
from demo_seed s, params p;

-- Community votes from the other demo residents
insert into public.verifications (report_id, user_id, vote, created_at)
select r.id, u.id, case when s.status = 'resolved' then 'resolved' else 'still_exists' end, r.created_at + interval '1 day'
from demo_seed s
join public.reports r on r.title = s.title and r.is_demo
cross join lateral (select id from demo_users du where du.id <> r.user_id order by du.id limit s.conf) u;

-- Status history that matches each report's final status
delete from public.status_history where report_id in (select id from public.reports where is_demo);
insert into public.status_history (report_id, old_status, new_status, updated_by, created_at)
select r.id,
       case when st.k = 1 then null else (array['submitted','community_confirmed','acknowledged','in_progress','resolved'])[st.k - 1] end,
       (array['submitted','community_confirmed','acknowledged','in_progress','resolved'])[st.k],
       case when st.k <= 2 then (case when st.k = 1 then r.user_id else null end)
            else (select du.id from demo_users du where du.id <> r.user_id order by du.id limit 1) end,
       r.created_at + make_interval(days => st.k - 1)
from demo_seed s
join public.reports r on r.title = s.title and r.is_demo
cross join lateral generate_series(1, array_position(array['submitted','community_confirmed','acknowledged','in_progress','resolved'], s.status)) as st(k);

-- Action Circles (demo)
insert into public.activities (title, description, location, event_date, creator_id, is_demo)
select a.title, a.descr, a.loc, now() + make_interval(days => a.d), (select id from demo_users where n = a.who), true
from (values
  ('Saturday neighbourhood clean-up',  'Bring gloves and a bag. We clear litter from the market gate and sort recyclables. No heavy lifting or hazardous waste.', 'Demo Ward 2, market gate',  3, 2),
  ('Tree planting morning',            'Plant saplings along the lane with the residents'' association. Tools and saplings provided.',                          'Demo Ward 3, community park', 9, 3),
  ('Report-it walk',                   'A relaxed walk to spot and report issues together, and show new neighbours how the app works.',                         'Demo Ward 1, bus stop',     5, 1)
) as a(title, descr, loc, d, who);

insert into public.activity_members (activity_id, user_id)
select ac.id, du.id
from public.activities ac
join demo_users du on du.n <= 2 + (ac.title like 'Saturday%')::int + (ac.title like 'Tree%')::int
where ac.is_demo;

drop table if exists pg_temp.params, pg_temp.demo_users, pg_temp.demo_seed;
