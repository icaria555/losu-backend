# tally-api

Express + TypeScript + Prisma/Postgres backend for Tally. Same stack and
conventions as `saticore-api` (MeditationProject): JWT access/refresh auth,
Zod-validated routes, a centralized error handler, and Jest + Supertest
route tests with a mocked Prisma client.

## Local setup

```
docker compose up -d               # Postgres on :5432
cp .env.example .env
npm install
npx prisma db push                 # sync the schema (no migrations dir yet)
npm run dev                        # API on :8000
```

`npm test` runs the route test suite (Prisma is mocked — no database needed).

Expose it publicly with a Cloudflare tunnel, from the repo root:

```
../start-api.sh
```

That script starts Postgres, the API, and `cloudflared tunnel run
saticore-api` together. It rides the **same** named tunnel as
`saticore-api` (MeditationProject) rather than a separate one — Cloudflare
tunnels route by hostname, so one tunnel process serves both
`saticore-api.iceeworld.com` → `:8080` and `tally-api.iceeworld.com` →
`:8000` via two `hostname:`/`service:` entries in
`~/.cloudflared/config.yml`. The DNS route (`cloudflared tunnel route dns
saticore-api tally-api.iceeworld.com`) and that config edit are already
done; nothing further to set up. The live URL is
**https://tally-api.iceeworld.com**.

## API

| Route                | Auth | Notes                                   |
|-----------------------|------|------------------------------------------|
| `GET  /health`         | no   | liveness check                            |
| `POST /auth/register`  | no   | creates the user + a default profile      |
| `POST /auth/login`     | no   |                                            |
| `POST /auth/refresh`   | no   | exchanges a refresh token for a new pair  |
| `GET  /profile`        | yes  | auto-creates a default profile if missing |
| `PUT  /profile`        | yes  | partial update                            |
| `GET  /meals?date=`    | yes  | defaults to today (UTC)                   |
| `POST /meals`          | yes  |                                            |
| `DELETE /meals/:id`    | yes  |                                            |
| `GET  /sets?exercise=` | yes  | most recent first, for progress/"last time" |
| `GET  /sets/last`      | yes  | most recent set per distinct exercise (Prisma `distinct`) |
| `POST /sets`           | yes  |                                            |
| `GET  /routine`        | yes  | auto-creates a default routine if missing; `lastDone` is computed from `LoggedSet` history, not stored |
| `PUT  /routine`        | yes  | partial update (name and/or exercise list) |

All authenticated routes take `Authorization: Bearer <accessToken>`.

## What's wired up, what's not

The frontend (`../frontend`) is fully wired to this API: auth, profile,
meals, sets, and the Train page's routine are real and persist across
sign-out/sign-in. See
`../frontend/README.md`'s "What's real vs. simulated" section for the
current, accurate breakdown — notably:

- **No `WeightLog` model** — `Profile.weightKg` is a single current value,
  so the Progress screen's body-weight trend is still a simulated series on
  the frontend. Add a model + `GET/POST /weight` if that's wanted for real.
- **No real meal-photo/NLP estimation** — `POST /meals` just stores whatever
  the client sends; the frontend's `analyzeMeal()` still fabricates the
  itemized macros before calling it.
- **No `prisma migrate` history yet** — `db push` is enough for solo local
  dev on a schema that's still moving; switch to real migrations once it
  settles (and definitely before this ever runs against data worth keeping
  through a schema change).
