# Deployment

The app is one Docker image (the API serves the web screens) plus PostgreSQL 16. Any small Linux server with 1 GB of RAM is enough for one school.

## First start

1. Install Docker and Docker Compose on the server.
2. Copy the repository to the server and create `.env` next to `docker-compose.yml`:

   ```
   DB_PASSWORD=<a long random password>
   APP_ORIGIN=https://finance.<your-domain>
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=<a temporary password, 10+ characters with letters and numbers>
   ```

3. Run `docker compose up -d --build`. On start the app applies database migrations, loads the reference lists and creates the administrator if there are no users yet. The administrator must change the password at first sign-in. Remove `ADMIN_PASSWORD` from `.env` afterwards.
4. Put HTTPS in front of port 4000, for example with Caddy (`finance.example.ug { reverse_proxy localhost:4000 }`). Sign-in cookies are marked secure, so the app only works over HTTPS. For a short trial on a private network without HTTPS, set `COOKIE_SECURE=false`.
5. Sign in as the administrator and work through Setup: school details, years and terms, classes, fee items, users. Then the bursar enters the fee structure.

Do not run the demo seed on a real database; it refuses if any users or pupils exist.

## Another school

Each school runs its own copy of the app, with its own database, users and web address (decision 27/10/2026). Nothing is shared between copies, so one school's money and records can never show up in another's.

1. On the same server or a new one, copy the repository into a new folder, for example `/srv/finance-schoolb`. Docker Compose names the containers and the database volume after the folder, so the copies stay apart.
2. In that folder's `.env` use a different `DB_PASSWORD`, the new school's `APP_ORIGIN`, and its first administrator. If both copies share a server, change the published port in `docker-compose.yml` (for example `"4001:4000"`) and point the second web address at it.
3. Start it with `docker compose up -d --build`, then work through Setup for that school: school details, approval limit, years and terms, classes, fee items and users.
4. Back up each copy's database separately (see Backups).

Pupil IDs currently start with `STJA-` in every copy. Another school would need that prefix made a setting first.

## Updating

`git pull && docker compose up -d --build` in each school's folder. Migrations run automatically on start.


## Backups

Back up the database every night and keep copies off the server.

```bash
# nightly, e.g. from cron at 23:30
docker compose exec -T db pg_dump -U stja -Fc stja > /backups/stja-$(date +%F).dump
find /backups -name 'stja-*.dump' -mtime +30 -delete
```

Copy `/backups` somewhere else as well (another machine, or cloud storage).

## Restore

```bash
docker compose stop app
docker compose exec -T db dropdb -U stja stja
docker compose exec -T db createdb -U stja stja
docker compose exec -T db pg_restore -U stja -d stja < /backups/stja-YYYY-MM-DD.dump
docker compose start app
```

Test a restore on a spare machine once a term, so you know the backups work.

## Settings

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection |
| `APP_ORIGIN` | The address people use, e.g. `https://finance.example.ug` |
| `PORT` | Default 4000 |
| `SESSION_IDLE_MINUTES` | Sign out after this long idle (default 60) |
| `SESSION_HOURS` | Longest a session lasts (default 10) |
| `COOKIE_SECURE` | `true` by default in production; needs HTTPS |
