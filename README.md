# Kaizr Orders

Catering order tracker for Kaizr — Hyderabadi catering, seven days a week.

Orders still arrive over WhatsApp and the Google Form. This app is where they
get recorded, tracked through the kitchen, and closed out. Stage 1 of a wider
restaurant ops system; inventory, payroll and a Toast integration follow later.

## Stack

| | |
|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind v4, dark-only ops theme |
| Database | PostgreSQL, Drizzle ORM |
| Realtime | Postgres `LISTEN/NOTIFY` → Server-Sent Events |
| Notifications | Web Push (VAPID), installable PWA |
| Hosting | Railway (app + Postgres + cron), GitHub for source |

No third-party realtime or auth vendor: a persistent Node process on Railway
can hold SSE connections and a dedicated `LISTEN` session open, which is what
makes the whole live layer about eighty lines of code.

## Local setup

Requires Node 20.9+ and a local PostgreSQL 18.

```bash
npm install

# Creates the kaizr_dev database and a dedicated kaizr role.
# Prompts for your postgres superuser password.
psql -U postgres -h localhost -p 5432 -f scripts/setup-db.sql

npm run db:migrate     # apply schema
npm run db:seed        # owner account + the live menu
npm run dev            # http://localhost:3000
```

`.env.local` is created for you and gitignored. See `.env.example` for the
shape of it.

To test push notifications locally, run `npm run dev:https` — service workers
and the Push API require HTTPS or `localhost`, so a LAN IP will not work.

## Scripts

| | |
|---|---|
| `npm run dev` | Development server |
| `npm run dev:https` | Development over HTTPS, for push testing |
| `npm run build` / `start` | Production build and serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Seed owner + menu (idempotent) |
| `npm run db:studio` | Drizzle Studio |
| `npm run db:backup` | Timestamped `pg_dump` into `backups/` |
| `npm run icons` | Regenerate the PWA icon set |

`node scripts/seed-demo-orders.mjs` fills a local database with a realistic book
so the dashboard, kitchen and analytics have something to render; `--clear`
removes exactly what it created. Local only — never run it against production.

## Routes

| | |
|---|---|
| `/` | Dashboard — headline figures, plus Today / Upcoming / All in one list |
| `/upcoming` | Redirect to `/?view=upcoming`, kept for the installed PWA |
| `/prep` | Aggregated cook list for a chosen day, counting down as orders close |
| `/analytics` | Sales, items, days, payments and customers over a chosen range |
| `/orders/new` | Order entry |
| `/orders/[id]` | Order detail, payment, audit history |
| `/kitchen` | Wall-tablet display (no navigation, wake lock) |
| `/settings` | Notifications, menu editing, access status |
| `/api/stream` | SSE feed of order changes |
| `/api/cron` | Notification scheduler tick (needs `CRON_SECRET`) |
| `/api/health` | Health check, verifies database reachability |

## Design decisions worth knowing

**Money is integer cents everywhere.** Floating-point dollars accumulate
rounding error across line items.

**Line items snapshot their name, size and price.** Menu prices change; an
order must always total exactly as it did the day it was taken.

**Two representations of "when".** `service_date` and `service_time` are the
local calendar date and clock time the business thinks in, and are what
grouping and filtering use. `service_at` is the absolute instant, computed on
write, and is what sorting and prep alerts use — so a 6pm Saturday pickup stays
6pm across a DST transition.

**Auth is off but the seams are in.** `users` and `roles` exist, and every
write resolves an actor through `getCurrentActor()` and stamps it onto the
audit trail. Turning auth on means building a login screen and pointing that
one function at a session — no migration, no backfill, and no months of blank
history.

⚠️ **There is currently no login.** Anyone with the URL can read and edit every
order, including customer names and phone numbers.

**Booked and collected are reported separately.** A catering book runs on
deposits, so "we sold $4,000" and "we have $4,000" are rarely the same number.
Every revenue figure on `/analytics` says which one it is, and the gap between
them is surfaced as outstanding rather than averaged away. Cancelled orders
never count toward revenue — they are reported once, on their own.

**The cook list counts down.** `getPrepSummary` counts only orders that are not
yet completed, so a tray drops off the prep sheet, the kitchen wall and the
dashboard card the moment its order is closed out. The day's full production
stays alongside it ("6 of 11 left") so a line never appears to shrink for no
reason.

**The menu is edited in the app, not in the seed.** Items, sizes and prices are
managed from Settings. Anything already referenced by an order line can only be
turned off, never deleted — `order_items` points at `menu_variants` with
`ON DELETE RESTRICT` so the reporting join stays intact, and the interface says
so rather than letting the database raise it.

**Kitchen totals and kitchen cards come from one query.** The wall display rolls
its per-item totals up in JS from the same array of orders it renders below
them, so the number on the wall can never disagree with the cards under it.

**Notifications are deduplicated by key.** The scheduler re-evaluates the same
orders on every tick, so each alert is claimed via a unique `dedupe_key` before
sending. Ticks can overlap or be retried without the kitchen being pinged
twice.

## Deployment

Railway builds from GitHub on push. `railway.json` runs migrations as a
pre-deploy step and health-checks `/api/health` before cutting traffic over.

Environment variables to set in the Railway dashboard:

```
DATABASE_URL                    # from the Postgres service, private URL
NEXT_PUBLIC_VAPID_PUBLIC_KEY    # npx web-push generate-vapid-keys
VAPID_PRIVATE_KEY
VAPID_SUBJECT                   # mailto:...
CRON_SECRET                     # long random string
NEXT_PUBLIC_APP_URL             # https://...
```

Add a Railway cron service hitting `/api/cron` every 15 minutes with the
`CRON_SECRET` as a bearer token.

## Roadmap

- **1.5** Google Form auto-import — Apps Script webhook creates draft orders for
  one-tap approval
- **2** Customer CRM, quotes, deposits
- **3** Inventory, recipes, food cost
- **4** Staff, scheduling, payroll export
- **5** Toast integration (requires partner API approval — long lead time)
