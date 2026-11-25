# FixMyCity

Report once. Understand together. Act as a community.

FixMyCity is a civic reporting web app built for the Tutedude CityFix Buildathon (#TutedudeBuildathon, #BuildForMyCity).
Residents report local issues with a photo and map pin, neighbours confirm them, and the **Repeat Issue Radar**
suggests clusters of same-category reports within a set distance so recurring problems become visible.

> Prototype. Not affiliated with any government body. Any demo data is labelled as such.

## Features
- Sign up / log in (Supabase Auth)
- Report an issue with title, category, description, photo and map location
- "Already reported nearby?" check while reporting
- Explore map with category filters and an adjustable-radius Repeat Issue Radar
- Community confirmations (still exists / worse / looks resolved), kept separate from official verification
- Status timeline: Submitted > Community confirmed > Acknowledged > In progress > Resolved
- Demo admin dashboard for reviewing clusters and updating status

## Structure
```
index.html          landing page
app/                the web app (plain HTML/CSS/JS, no build step)
  config.js         Supabase URL + anon key
supabase/schema.sql tables, Row Level Security, storage bucket, functions
```

## Setup
1. Create a Supabase project. In **SQL Editor**, run `supabase/schema.sql`.
2. In **Authentication > Providers > Email**, turn off "Confirm email" for the demo.
3. Put the project URL and **anon** key in `app/config.js` (never the service_role key).
4. Sign up in the app, then make yourself the demo admin by running the commented SQL at the bottom of `schema.sql`.
5. Run locally: `npx serve .` (or any static server) and open `/`.
6. Deploy: import the repo in Vercel, Framework preset "Other", no build command, output directory `.`.

## How the Repeat Issue Radar works
1. Take open reports of the same category.
2. Measure distance with the Haversine formula.
3. Group reports within a configurable radius (default 150 m) of the oldest unclustered report.
4. If a group has 3+ reports, suggest it as a possible recurring issue with its report count, community confirmations and oldest report date.
5. Clusters are suggestions for review. Reports are never merged automatically.

## Security notes
- Row Level Security is enabled on every table.
- Citizens can only edit their own reports' content fields. Status can only change via the admin-only `set_report_status()` function, which writes the history.
- One verification per user per report; reporters cannot confirm their own report.
- Photos upload only to a folder named after the user's id (5 MB, JPEG/PNG/WebP).

## Tools and technologies
Supabase (Auth, Postgres, Storage), Leaflet, OpenStreetMap tiles, supabase-js, Poppins and Inter (Google Fonts).
AI tools used: Claude (Anthropic) assisted with planning, code and copywriting.

## Limitations / future work
Action Circles, Neighbourhood Pulse analytics, AI photo classification, flood/outage alerts, official verification workflow.
