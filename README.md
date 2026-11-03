# SplashDesk

Pool-service management software in the spirit of Skimmer, Pool Brain and GoSplash: routes, mobile visit logging with
water-chemistry dosing, invoicing and card payments, customer portal, and reports.
**Zero npm dependencies** — Node 22.13+ (built-in `node:sqlite` and `http`) and a vanilla-JS front end.

## Run it

```bash
npm run demo     # http://127.0.0.1:3000 with sample data. Logins (password demo1234):
                 #   owner@demo.test · office@demo.test · tech@demo.test
npm start        # empty database; the first visit creates your owner account
npm test         # 26 API/logic tests
```

## What's in it

| Area | Highlights |
|---|---|
| **Accounts & roles** | Owner / office / technician. Technicians see only their own route and visits (enforced server-side). scrypt passwords, hashed sessions, login throttling, CSRF origin check, CSP, audit log, daily backups, customer archiving instead of deletion |
| **Routes** | Recurring weekly/bi-weekly stops, seasonal end dates, holidays, **drag-and-drop route builder**, **optimizer** (nearest-neighbour + 2-opt, preview savings before applying, optional real road distances via OSRM), reassign a day when a tech is out, reschedule a visit, route maps (schematic + optional street map) |
| **Field app (PWA)** | Installable, works offline: visits and photos queue on the device and sync on reconnect. Range gauges, live dosing, "I've arrived", "On my way" text, photos with client-side resize |
| **Dosing** | Chemical amounts scaled to pool volume; chlorine target scales with stabilizer (CYA); Langelier saturation index; partial-drain guidance |
| **Billing** | Per-visit or flat monthly pricing, chemical charges, repairs, sales tax, payment terms, Stripe card payments from a public pay link, saved-card autopay, QuickBooks-friendly CSV exports |
| **Quotes** | Send an estimate link; customer approves/declines online; approval creates a work order |
| **Inventory** | Products with stock, cost and price; stock is deducted when visits complete; low-stock alerts; chemical margin reporting |
| **Customer portal** | Private link: upcoming visits, latest water test, photos, invoices (pay now), quotes, service requests |
| **Messaging** | Service reports, invoice emails, ETA texts, weekly overdue reminders; everything recorded in an Outbox |
| **Reports** | Revenue, receivables aging, technician quality/revenue, route profitability (revenue per hour), chemical usage and margin, top customers |
| **Design** | Responsive "deep ocean" design system: command palette (Ctrl/⌘K), dark mode, animated charts and route lines, skeleton loading, micro-interactions |

## Deploy

One deployment per company. Persist the `/data` volume (SQLite database, photos, backups).

```bash
docker compose up -d --build        # or: render.yaml (Render) / fly.toml (Fly.io)
```

Set `PUBLIC_URL` (used in emails, pay links and the portal) and `COOKIE_SECURE=1` behind HTTPS. See `.env.example`.

| Variable | Purpose |
|---|---|
| `PUBLIC_URL`, `COOKIE_SECURE` | Links in messages; secure cookies |
| `DB_PATH`, `PHOTO_DIR`, `BACKUP_DIR` | Storage locations (default `./data`) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Card payments. Add `https://YOUR-URL/api/stripe/webhook` in Stripe for `checkout.session.completed` |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email delivery |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | SMS delivery |

Without Stripe/Resend/Twilio keys the app still works: online payment is disabled and messages are logged in the Outbox.

## Honest limits

- **Integrations are tested against mocks, not live services.** Stripe, Resend, Twilio, OSRM routing and the street-map
  tiles need your real accounts/keys and a quick end-to-end check before you rely on them.
- **Single company per deployment** (no multi-tenant SaaS layer), and a **web app, not native iOS/Android** (it installs
  to the home screen and works offline, but has no push notifications or background sync on iOS).
- No live QuickBooks sync — use the CSV exports. Routing is distance-based (no live traffic or time windows).
- Dosing amounts are standard rules of thumb to guide a technician, not a substitute for judgement.
- Geocoding/lookups use OpenStreetMap's free service only when you click a lookup button.

## Layout

```
server.js         HTTP server, core API (customers, routes, visits, invoices, optimizer, dashboard)
lib/              auth, ops (audit/backup), payments, quotes, inventory, exports, notify, photos, portal, scheduling, reports
public/           SPA (app.js, ui.js, features*.js), customer pages (public.js), dosing.js + geo.js (shared with the server)
seed.js           demo data         test/      node:test suite
```
