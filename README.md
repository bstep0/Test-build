# SplashDesk

Pool service management software in the spirit of Skimmer, Pool Brain and GoSplash.
Zero npm dependencies: Node 22.13+ (built-in `node:sqlite` + `http`) and a vanilla-JS front end.

## Run it

```bash
npm run demo     # starts on http://127.0.0.1:3000 with sample customers, routes and history
npm start        # same, but with an empty database (data/splashdesk.db)
npm test         # API + dosing tests
```

Env vars: `PORT` (3000), `HOST` (127.0.0.1), `DB_PATH` (data/splashdesk.db).

## Features

| Area | What it does |
|---|---|
| **Customers & pools** | Contact info, gate codes, access notes, per-visit rate; multiple pools per customer with volume, surface, sanitizer and equipment notes |
| **Routes** | Recurring stops by weekday (weekly / every 2–4 weeks) assigned to technicians; daily route view per tech with reordering, one-off stops and map links |
| **Tech visit screen** (mobile-friendly) | Log FC, pH, TA, CYA, CH, salt, temp; task checklist; chemicals used (with optional charge); notes; complete or skip. Shows last visit's readings |
| **Dosing** | Live in-range check and chemical amounts (liquid chlorine, acid, soda ash, baking soda, stabilizer, calcium, salt, partial-drain %) scaled to pool volume. Also a standalone calculator |
| **Work orders** | Repairs with price, due date, tech, status; completed ones flow to billing |
| **Invoicing** | One click bundles unbilled completed visits, chemical charges and finished work orders; record payment, print/PDF, email link, void |
| **Dashboard** | Today's progress by tech, open work orders, outstanding/overdue/collected, and pools whose latest test is out of range |

## Layout

```
server.js        HTTP server + JSON API (routes, validation, invoicing)
lib/db.js        SQLite schema      lib/schedule.js  recurring-stop → visit generation
public/          SPA (index.html, app.js, style.css) + dosing.js (shared with server)
seed.js          demo data          test/            node:test suite
```

## Known limits / next steps

- **No authentication.** It binds to localhost by default; put it behind a login/reverse proxy before exposing it. Next step: user accounts with tech vs. admin roles.
- Dosing uses standard rule-of-thumb factors (per 10k gal) — a guide, not a substitute for technician judgement.
- Not yet built: online payments (Stripe), customer portal, SMS/email notifications, photo uploads, route optimisation, offline mode, recurring/monthly billing.
