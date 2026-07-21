# meyers-bujo

Paul's Bullet Journal + Mission Control dashboard, deployed on Netlify.

- `index.html` — the BuJo app (auto-fills from the live inbox on load).
- `mission-control/` — the dashboard (served at /mission-control).
- `netlify/functions/inbox.mjs` — the "locker": a Function backed by Netlify
  Blobs that stores the day's items. The app reads it at `/api/inbox`; Higgins
  writes to it with a secret. Requires the `BUJO_PUSH_SECRET` env var (set in
  Netlify site settings).

Deployed via GitHub → Netlify continuous deployment so the function's
dependency (@netlify/blobs) is installed at build time.
