# Deploying the JARVIS API

The API is a single Node process: HTTP + WebSocket + SQLite. It is designed to run
behind a reverse proxy that terminates TLS, with a persistent volume for the
database. One process is the whole backend — no Redis, no message broker, no
separate worker. (See [Scaling](#scaling-and-its-limits) for the one honest limit
of this design.)

---

## 1. Prerequisites

| Requirement | Notes |
| --- | --- |
| Node.js ≥ 20.11 | `node -v`; the repo pins it via `engines` |
| A Linux host or container platform | Fly.io, Railway, Render, Hetzner, a VPS — anything that can run Node |
| A persistent volume | For `JARVIS_DATA_DIR` (the SQLite file lives here) |
| A domain with HTTPS | e.g. `api.example.com`; the mobile app refuses plain HTTP in release builds |
| An SMTP provider *(for password reset)* | Any mail server, or Resend/SendGrid/Postmark |

TLS is **not** terminated by this process. Put Caddy, nginx, Cloudflare, or your
platform's load balancer in front of it. The API speaks HTTP on the private
network only.

---

## 2. Build and run

```bash
git clone https://github.com/<you>/JARVIS.git
cd JARVIS
npm ci                        # installs every workspace
npm run build:web -w @jarvis/mobile   # optional: serve the web app from the API too
npm run start -w @jarvis/api          # node --import tsx src/index.ts
```

`npm run start -w @jarvis/api` runs TypeScript directly through `tsx`. There is no
separate build artefact to keep in sync — the same code that runs in development
runs in production, which removes an entire class of "works locally, fails in
prod" bugs.

### Process managers

**systemd** (`/etc/systemd/system/jarvis-api.service`):

```ini
[Unit]
Description=JARVIS API
After=network-online.target

[Service]
WorkingDirectory=/opt/JARVIS
EnvironmentFile=/etc/jarvis/api.env      # the variables from .env.example
ExecStart=/usr/bin/npm run start -w @jarvis/api
Restart=always
RestartSec=3
User=jarvis
# SQLite writes must survive; nothing else needs write access.
ReadWritePaths=/var/lib/jarvis

[Install]
WantedBy=multi-user.target
```

**Docker** (the volume mount is the important line):

```dockerfile
FROM node:20-bookworm-slim
WORKDIR /app
COPY package*.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci --omit=dev
ENV NODE_ENV=production JARVIS_DATA_DIR=/data
VOLUME /data
EXPOSE 4000
CMD ["npm", "run", "start", "-w", "@jarvis/api"]
```

```bash
docker build -t jarvis-api .
docker run -d --name jarvis-api -p 4000:4000 \
  --env-file /etc/jarvis/api.env \
  -v jarvis-data:/data \
  --restart unless-stopped \
  jarvis-api
```

**Fly.io** shape: `fly volumes create jarvis_data --size 1`, mount it at `/data`,
set `JARVIS_DATA_DIR=/data` and the secrets from `.env.example`, then
`fly deploy`.

---

## 3. Required environment

Everything is documented in [`.env.example`](../.env.example). The ones that
matter most:

| Variable | Why |
| --- | --- |
| `JARVIS_JWT_SECRET` | **Required.** ≥ 32 chars or the process exits at boot. Changing it signs everybody out. |
| `JARVIS_DATA_DIR` | Persistent directory for `jarvis.sqlite` + `backups/`. Point it at your volume. |
| `JARVIS_PUBLIC_URL` | `https://api.example.com` — used to build password-reset links. |
| `JARVIS_ALLOWED_ORIGINS` | Exact web origins allowed to call the API from a browser. Empty = same-origin only. |
| `JARVIS_TRUST_PROXY=true` | Only with a trusted reverse proxy in front — otherwise IP-based rate limiting sees the proxy. |
| `JARVIS_EMAIL_*` | Without these, password-reset mail cannot be delivered (the API still answers identically). |
| `JARVIS_GOOGLE_CLIENT_IDS` | Optional. Comma-separated Google OAuth client ids (public identifiers). Empty = `POST /api/auth/google` returns `503` and the app hides the Google button. Client ids are bound to the app's package name and signing certificate, so a build signed with an unregistered SHA-1 fails at Google's end, not here. |
| `JARVIS_PUSH_ENABLED` / `JARVIS_PUSH_*` | Optional. Remote push through Expo's relay; the server holds no Firebase credential (that lives in EAS, see RELEASE.md). |

Generate a secret:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

---

## 4. TLS termination (reverse proxy)

**Caddy** — automatic certificates, two lines:

```caddy
api.example.com {
    reverse_proxy 127.0.0.1:4000
}
```

Caddy passes `X-Forwarded-*` automatically; set `JARVIS_TRUST_PROXY=true`.

**nginx**:

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;
    ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        # WebSocket support for /realtime (gang timer sync)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;   # above the 15 s heartbeat interval
    }
}

server {
    listen 80;
    server_name api.example.com;
    return 301 https://$host$request_uri;
}
```

Then verify:

```bash
curl -s https://api.example.com/health | jq
# → { "ok": true, "status": "healthy", "capabilities": { ... } }
```

`/health` reports liveness and *which optional capabilities are configured*. It
never returns a secret, a file path, or an environment dump.

> **Do not** disable Android cleartext traffic to make a plain-HTTP API work. A
> release build of the app requires `https://`. Fix the server, not the client.

---

## 5. First-run checklist

```bash
curl -s https://api.example.com/health | jq              # ok: true
curl -s -X POST https://api.example.com/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"choose-a-strong-one","name":"You","username":"you"}' | jq '.user.id'
```

1. Sign up through the app, confirm the row appears in `users`.
2. Request a password reset and confirm the email arrives (or that the logs show
   a delivery failure you can act on — never a token).
3. Start a focus session and a gang session from a second account; both should
   appear in the second client within seconds.
4. Restart the process (`systemctl restart jarvis-api`) and confirm nothing was
   lost.

---

## 6. Backups

SQLite in WAL mode can be backed up safely while the server runs:

```bash
# Consistent snapshot without stopping the API (recommended)
sqlite3 /var/lib/jarvis/jarvis.sqlite ".backup '/var/backups/jarvis-$(date +%F).sqlite'"

# Or a file copy after a WAL checkpoint (requires the API to be stopped)
sqlite3 /var/lib/jarvis/jarvis.sqlite "PRAGMA wal_checkpoint(TRUNCATE);"
cp /var/lib/jarvis/jarvis.sqlite /var/backups/jarvis-$(date +%F).sqlite
```

Restore = stop the service, replace the file (and delete any stale
`-wal`/`-shm` siblings), start the service.

Nightly with retention:

```bash
0 3 * * * sqlite3 /var/lib/jarvis/jarvis.sqlite ".backup '/var/backups/jarvis-$(date +\%F).sqlite'" \
          && find /var/backups -name 'jarvis-*.sqlite' -mtime +30 -delete
```

`JARVIS_BACKUP_DIR` defaults to `<JARVIS_DATA_DIR>/backups` and exists so backup
tooling has one obvious place to write.

---

## 7. Upgrades and migrations

Migrations are **additive and idempotent**: `migrate()` runs `CREATE TABLE IF NOT
EXISTS` / `CREATE INDEX IF NOT EXISTS` statements at every boot, and there is no
destructive step. That means:

- deploying new code over an existing database is safe;
- the old database file keeps working if you roll back;
- you never need a maintenance window for schema changes in this version.

Checklist for a deploy:

```bash
git pull
npm ci
sqlite3 "$JARVIS_DB_FILE" ".backup '/var/backups/pre-deploy-$(date +%F-%H%M).sqlite'"
systemctl restart jarvis-api
curl -s https://api.example.com/health | jq .status
```

Never delete the database file to "reset" production. `npm run reset:db` and
`npm run seed` are development tools; the seed script refuses to run against a
database that already has users for this reason.

---

## 8. Scaling and its limits

This deployment is deliberately **single-instance**.

- SQLite is a file database: many readers, one writer. That is comfortably enough
  for a self-hosted productivity app (thousands of reads/second, hundreds of
  writes/second with WAL), and it removes an entire tier of infrastructure.
- The rate limiter and the realtime hub keep state in process memory. **Running
  two API instances against one database would break both** (each instance would
  have its own counters and would not see the other's sockets).
- If you outgrow it: run exactly one API instance on a host with a persistent
  volume, scale vertically, and shard by deploying separate instances with
  separate databases if you ever need independent tenants. Moving to Postgres +
  Redis is a deliberate project, not a config flag — the repository structure
  (`apps/api/src/repo/*`) exists so that swap stays contained to one layer.

---

## 9. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Process exits immediately with "JARVIS_JWT_SECRET …" | Set a ≥ 32 char secret. |
| `email: "none"` in `/health` capabilities | No mail provider configured — password reset cannot deliver. Set `JARVIS_EMAIL_*`. |
| Password reset says "sent" but nothing arrives | Check the API logs for `[email] password reset delivery failed`. The user-facing response is intentionally identical either way. |
| Mobile app shows "Server not configured" | The APK was built without `EXPO_PUBLIC_API_URL`. Rebuild with it set. |
| Realtime updates never arrive | Proxy is not upgrading WebSockets (see §4), or `proxy_read_timeout` is below the heartbeat. |
| Everything is rate-limited | `JARVIS_TRUST_PROXY` is probably unset behind a proxy, so every request looks like one IP. |
| Data disappeared after a deploy | `JARVIS_DATA_DIR` was not a persistent volume. |
