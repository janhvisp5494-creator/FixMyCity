# FixMyCity

> **TODO before deploying:** replace `YOUR-DOMAIN` with the deployed URL in the `canonical`, `og:url`, `og:image` and `twitter:image` tags of `index.html` (social cards need absolute URLs).

Report once. Understand together. Act as a community.

FixMyCity is a civic reporting web app built for the Tutedude CityFix Buildathon (#TutedudeBuildathon, #BuildForMyCity).
Residents report local issues with a photo and map pin, neighbours confirm them, and the **Repeat Issue Radar**
suggests clusters of same-category reports within a set distance so recurring problems become visible.

> Prototype. Not affiliated with any government body. Any demo data is labelled as such.

**Follow FixMyCity:** [Instagram @fixmycity_official](https://www.instagram.com/fixmycity_official/)

## Features
- Sign up / log in (Supabase Auth)
- Report an issue with title, category, description, photo (upload or **camera capture**) and map location; **area autofill** from the pin
- "Already reported nearby?" check, with **confirm instead** of filing a duplicate
- Explore map with category filters, adjustable-radius Repeat Issue Radar, **marker bubbles** and a **density view**
- **Live updates** of reports and comments via Supabase Realtime
- Community confirmations (still exists / worse / looks resolved), kept separate from official verification
- **Priority score** per report from confirmations, age and nearby duplicates
- **Comments** on reports
- Status timeline: Submitted > Community confirmed > Acknowledged > In progress > Resolved
- **Resolution before/after photo** added by the admin; reporters can **edit their report photo**
- **Resolution stats** (resolved share, time to resolve) alongside Neighbourhood Pulse: totals, open vs resolved, categories, weekly trend, hotspots, area filter (Chart.js)
- **Share** a report; **flag** spam or wrong reports for admin review
- **In-app notifications** for status changes and activity on your reports
- Action Circles: neighbours create and join safe, voluntary activities
- Active neighbours leaderboard (10 pts per report, 2 per confirmation, 5 per circle joined)
- Demo admin dashboard: review clusters and flags, update status, **CSV export**
- **Translate the whole site into 60+ languages** from the Language dropdown in the header (Google Website Translator, loaded only when you pick a non-English language). Hindi and Gujarati also use curated built-in strings for navigation, titles, buttons, categories and statuses. Privacy: choosing a language other than English sends the page text to Google Translate.
- One site: the former landing page is the app's **Home** screen (`#/`), sharing one header, nav and design
- **Installable app** (PWA: `manifest.webmanifest`, service worker)
- Clearly labelled demo data (`is_demo`) for videos and screenshots
- **Live impact band** on Home: reports, resolved, neighbours and average days to fix, with a count-up (respects reduced motion)
- **Overdue / SLA badges**: per-category target days (pothole 7, garbage 2, streetlight 5, drainage 5, water logging 3, other 10). Overdue reports are flagged on the issue page, map popups, My reports and the admin table; Pulse adds an Overdue tile and an "Oldest unresolved" card
- **Dispute a resolution**: on a Resolved report, residents (not the reporter) can tap "Not really fixed" with a short reason; at 2 disputes the report reopens as In progress (needs `08-features.sql`)
- **Area report card** at `#/area/<name>`: open count, resolved %, median days to fix, oldest open item, top category and an A-D grade with the rule explained (aggregates only)
- **Shareable impact card**: a 1080x1080 PNG drawn in the browser (Pulse and area card), with Share image and Download PNG
- **Voice reporting**: a mic button on the description field (Web Speech API; hidden if unsupported; speech may go to the browser vendor)
- **Open data** at `#/data`: GeoJSON and CSV of non-demo reports, no personal data, coordinates rounded to 4 decimals
- **Guided tour** at `#/tour` (or `?tour=1`, or the "Take the tour" button on Home): 6 read-only spotlight steps, keyboard accessible (Esc closes)

## Structure
```
index.html          the single page shell: header, nav, #view, footer (hash routes: #/ home, #/map, #/report, #/pulse, #/circles, #/login ...)
sw.js, register-sw.js, manifest.webmanifest   installable app / offline shell (at the root so the service worker scope is /)
assets/             images (hero, issue illustrations, icons, social card)
app/                the app code (plain HTML/CSS/JS, no build step)
  app.js, app.css   routing, views, styles
  home.html, home.css, home.js   Home screen (former landing page), loaded by the #/ route
  brand.html, brand.css          Brand kit (logo, colours, type), loaded by the #/brand route
  tour.js           guided tour, loaded on demand by #/tour
  translate.js      language switcher (lazy-loads Google Website Translator)
  config.js         Supabase URL + anon key
docs/               DOCUMENTATION.md, VIDEO_SCRIPTS.md
supabase/schema.sql tables, Row Level Security, grants, storage bucket, functions
supabase/02-demo-and-circles.sql  upgrade for databases created from an older schema.sql
supabase/03-demo-data.sql         labelled demo reports, residents and Action Circles
supabase/fix-grants.sql           table permissions for databases created from an older schema.sql
supabase/04-fixes.sql             admin moderation, photo clean-up, rate limit, safer photo URLs
supabase/05-features.sql          report flags, leaderboard, resolution stats
supabase/06-comments-and-proof.sql  comments and admin resolution-proof photo
supabase/07-realtime.sql          publishes reports/comments to Realtime (live updates)
supabase/08-features.sql          report_disputes table, RLS and the reopen-at-2-disputes trigger
```

## Setup
1. Create a Supabase project. In **SQL Editor**, run `supabase/schema.sql`. (Already ran an older version? Run `fix-grants.sql` then `02-demo-and-circles.sql` instead.)
2. In **Authentication > Providers > Email**, turn off "Confirm email" for the demo. In **Authentication > URL Configuration**, add your app URL (e.g. `https://your-site.vercel.app/`) to Redirect URLs so password-reset links work.
3. Put the project URL and **anon** key in `app/config.js` (never the service_role key).
4. Run, in order: `04-fixes.sql`, `05-features.sql`, `06-comments-and-proof.sql`, `07-realtime.sql`, then `08-features.sql` (disputes). All are safe to re-run. The app degrades gracefully if a later script has not been run. `07` needs Realtime available on your project (Database > Replication; enabled by default).
5. Optional: run `supabase/03-demo-data.sql` to load labelled demo data. Delete it later with `delete from public.reports where is_demo; delete from public.activities where is_demo;`.
6. Sign up in the app, then make yourself the demo admin by running the commented SQL at the bottom of `schema.sql`.
7. Run locally: `npx serve .` (or any static server) and open `http://localhost:PORT/`. Use a server, not `file://`: the Home route fetches `app/home.html`.
8. Deploy: import the repo in Vercel, Framework preset "Other", no build command, output directory `.`.

## Routes
`#/` home, `#/map`, `#/report`, `#/issue/<id>`, `#/pulse`, `#/area/<url-encoded area name>` (area report card, linked from the Pulse area filter and the issue page), `#/circles`, `#/data` (open data downloads, linked in the footer), `#/tour` (guided tour), `#/mine`, `#/admin`, `#/brand`, `#/login`.

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
Supabase (Auth, Postgres, Storage), Leaflet, Chart.js, OpenStreetMap tiles, supabase-js, Poppins and Inter (Google Fonts).

## Limitations / future work
AI photo classification, flood/outage alerts, official verification workflow.

## Media
All illustrations were generated with ChatGPT (AI-generated).
- `assets/hero-community.webp` (1672x941): home page hero.
- `assets/issues/{pothole,garbage,streetlight,drainage,water-logging,other}.webp` (800x800): one per report category, used on the home page, report form and brand kit.
- `assets/og-image.jpg` (1200x675): social share card (`og:image` / `twitter:image`).

## Submission checklist
- [ ] Public GitHub repository
- [ ] Live URL (Vercel) working with Supabase configured
- [ ] Demo and launch videos recorded (see `docs/VIDEO_SCRIPTS.md`)
- [ ] Social posts published with #TutedudeBuildathon #BuildForMyCity