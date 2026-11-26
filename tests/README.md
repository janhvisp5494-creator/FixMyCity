# UI smoke tests
Headless-browser tests that load the real app code against an in-memory fake of Supabase, Leaflet and Chart.js.
Run: `npm i playwright && node tests/run.js` (needs Chromium: `npx playwright install chromium`).
These do not touch a real database. Database rules were tested separately against Postgres.
