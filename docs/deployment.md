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

## Updating

`git pull && docker compose up -d --build`. Migrations run automatically on start.

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
