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
| **Routes** | Recurring stops by weekday (weekly / every 2–4 weeks) assigned to technicians; daily route view per tech with a route map, drive-time/mileage estimates, reordering, one-off stops and navigation links |
| **Route builder** | Weekly board: drag unscheduled pools onto days, drag stops between days/reorder, per-day mileage & time, weekly revenue. Mobile-friendly ▲▼ / ⋯ controls as an alternative to dragging |
| **Route optimizer** | Nearest-neighbour + 2-opt per technician per day, starting/ending at your shop. Preview shows miles & time saved before you apply. Works on a single day, the recurring weekday template, or all days at once |
| **Tech visit screen** (mobile-friendly) | Log FC, pH, TA, CYA, CH, salt, temp; task checklist; chemicals used (with optional charge); notes; complete or skip. Shows last visit's readings |
| **Dosing** | Live in-range check and chemical amounts (liquid chlorine, acid, soda ash, baking soda, stabilizer, calcium, salt, partial-drain %) scaled to pool volume. Also a standalone calculator |
| **Work orders** | Repairs with price, due date, tech, status; completed ones flow to billing |
| **Invoicing** | One click bundles unbilled completed visits, chemical charges and finished work orders; record payment, print/PDF, email link, void |
| **Dashboard** | Today's progress by tech, open work orders, outstanding/overdue/collected, and pools whose latest test is out of range |

## Layout

```
server.js        HTTP server + JSON API (routes, validation, invoicing, optimiser endpoint)
lib/db.js        SQLite schema      lib/schedule.js  recurring-stop → visit generation
public/          SPA (index.html, app.js, style.css) + dosing.js / geo.js (shared with server)
seed.js          demo data          test/            node:test suite
```

## Known limits / next steps

- **No authentication.** It binds to localhost by default; put it behind a login/reverse proxy before exposing it. Next step: user accounts with tech vs. admin roles.
- Dosing uses standard rule-of-thumb factors (per 10k gal) — a guide, not a substitute for technician judgement.
- Route optimisation needs map locations: enter lat/lng on a customer, or use the *Look up* / *Locate missing customers* buttons (these send addresses to OpenStreetMap's Nominatim service; nothing is sent unless you click). Distances are straight-line × 1.3, not live traffic, and the route map is schematic (no map tiles).
- Not yet built: online payments (Stripe), customer portal, SMS/email notifications, photo uploads, turn-by-turn/traffic-aware routing, offline mode, recurring/monthly billing.
