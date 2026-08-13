# Deploying Mosc-tools — Ontime Show Flow Sync

This package contains a **pre-built** app: `dist/index.cjs` (server, bundled) and `dist/public/`
(client). Nothing is compiled at deploy time, but **`npm install` is still required** because
`better-sqlite3` is a native module that must be built/downloaded for the target machine's Node
version and architecture.

Contents:

| Path                | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `dist/index.cjs`    | Express server (API + static client), bundled for Node 20+      |
| `dist/public/`      | Built front-end assets                                          |
| `package.json`      | Runtime dependencies only (`better-sqlite3`, `dotenv`)          |
| `package-lock.json` | Lockfile for `npm ci`                                           |
| `Dockerfile`        | Container build (option B)                                      |
| `README.md`         | What the app does and how to use it                             |

Environment variables:

| Variable      | Default              | Notes                                                    |
| ------------- | -------------------- | -------------------------------------------------------- |
| `PORT`        | `5000`               | HTTP port the app listens on (all interfaces)            |
| `NODE_ENV`    | —                    | Set to `production`                                      |
| `SHOWFLOW_DB` | `./data.db` (cwd)    | SQLite file holding settings, Ontime targets, sync log    |

---

## Option A — bare Node behind a reverse proxy (ontime-sync.example.com)

On the server (Node 20+, plus `python3 make g++` for the native build):

```bash
mkdir -p /opt/ontimesync && cd /opt/ontimesync
unzip ~/mosc-tools-ontime-sync.zip
npm ci --omit=dev
NODE_ENV=production PORT=5000 node dist/index.cjs
```

Keep it running with systemd — `/etc/systemd/system/ontimesync.service`:

```ini
[Unit]
Description=Mosc-tools Ontime Show Flow Sync
After=network.target

[Service]
WorkingDirectory=/opt/ontimesync
Environment=NODE_ENV=production
Environment=PORT=5000
Environment=SHOWFLOW_DB=/opt/ontimesync/data.db
ExecStart=/usr/bin/node dist/index.cjs
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now ontimesync
```

### Caddy (HTTPS is automatic)

```
ontime-sync.example.com {
    reverse_proxy 127.0.0.1:5000
}
```

### nginx + certbot

```nginx
server {
    server_name ontime-sync.example.com;

    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo certbot --nginx -d ontime-sync.example.com
```

The app has no login of its own — put it behind HTTP basic auth in the proxy (or restrict by IP) if
the host is publicly reachable, because it stores Ontime tokens/passwords for your instances.

---

## Option B — Docker

```bash
docker build -t mosc-tools-ontime-sync .
docker volume create ontimesync-data
docker run -d --name ontimesync \
  -p 5000:5000 \
  -e PORT=5000 \
  -v ontimesync-data:/app/data \
  --restart unless-stopped \
  mosc-tools-ontime-sync
```

The image sets `SHOWFLOW_DB=/app/data/data.db`, so the volume preserves your settings, Ontime
targets (including saved passwords) and sync history across image rebuilds. Put the same
Caddy/nginx block in front of port 5000 for `ontime-sync.example.com`.

To upgrade: rebuild the image with a newer `dist/`, then `docker rm -f ontimesync` and `docker run`
again with the same volume.

---

## Important caveat: server-hosted vs. venue-LAN Ontime

All Ontime calls are made **by this app's backend**, not by the browser. That means the app can only
reach Ontime instances that are reachable *from the machine it runs on*:

- A server at `ontime-sync.example.com` can reach **Ontime Cloud** (`https://cloud.getontime.no/...`)
  and any Ontime exposed on the public internet.
- It **cannot** reach an Ontime running on the venue LAN (`http://localhost:4001`,
  `http://192.168.x.x:4001`) — those addresses do not exist from the server's point of view.

For show days, run this same package **on the show laptop** (`npm ci --omit=dev`, then
`PORT=5000 node dist/index.cjs`, open `http://localhost:5000`) and point a target at the local
Ontime. Both instances can use the same sheet; the local one keeps its own `data.db`.

Alternative for a hosted instance: expose the venue Ontime through a tunnel (Tailscale, WireGuard,
Cloudflare Tunnel) and use that hostname as the target base URL.

---

## Health check

```bash
curl -fsS http://127.0.0.1:5000/api/settings
```

Returns the stored sheet settings as JSON once the app is up.
