# Vulsor workout server — offline workout pages

Hosts the daily workout page on a public HTTPS origin so your phone can install it
and read it with no connection at all.

## Why it has to be HTTPS

A page can only store itself offline via a **service worker**, and browsers refuse to
register one unless the origin is secure. `http://192.168.1.5:8477` is not secure, so
the old local-Wi-Fi page could never survive going out of range — the browser simply
would not let it save itself. AppCache, which used to work over plain HTTP, has been
removed from every browser. A real HTTPS host is the only way, and it has a bonus: the
phone works on cellular anywhere, not just on your home Wi-Fi.

## What runs where

| Piece | Where | What it does |
|---|---|---|
| Vulsor (Workouts → To phone) | your Mac | renders the day's page, `PUT`s it to the box, shows the QR |
| `workout-server.js` | the Ubuntu box | stores the page, serves it + the service worker over HTTPS |
| the page | your phone | installs itself on first visit, then needs no network ever again |

## 1. Copy the files to the box

```bash
scp server/workout-server.js server/vulsor-workout.service USER@YOUR-SERVER-HERE.example.com:~/vulsor-server/
```

## 2. Get a certificate

`workout-server.js` reads a cert and key from `TLS_CERT` / `TLS_KEY`. Let's Encrypt via
certbot, using the DuckDNS name that's already in `vulsor-config.json`:

```bash
sudo certbot certonly --standalone -d YOUR-SERVER-HERE.example.com
```

Standalone needs port 80 reachable from the internet for the challenge — forward it on
the router for the duration, or use certbot's DNS plugin instead if you'd rather not.

`/etc/letsencrypt/live/` is root-only, and this service should not run as root. Have
certbot copy the cert somewhere the service user can read it, on issue and on every
renewal:

```bash
sudo certbot certonly --standalone -d YOUR-SERVER-HERE.example.com \
  --deploy-hook 'install -o USER -g USER -m 600 \
    /etc/letsencrypt/live/YOUR-SERVER-HERE.example.com/fullchain.pem /home/USER/vulsor-server/cert.pem && \
  install -o USER -g USER -m 600 \
    /etc/letsencrypt/live/YOUR-SERVER-HERE.example.com/privkey.pem /home/USER/vulsor-server/key.pem && \
  systemctl restart vulsor-workout'
```

Then point the unit at those copies:

```
Environment=TLS_CERT=/home/USER/vulsor-server/cert.pem
Environment=TLS_KEY=/home/USER/vulsor-server/key.pem
```

## 3. Set the token

Open **Workouts → To phone** in Vulsor once. It generates a publish token and shows it
to you (it's also saved in `~/Documents/Vulsor_Memories/workout_share.json`). Put the
same value in the unit:

```
Environment=TOKEN=<the token Vulsor showed you>
```

The server refuses to start without it — without a token anyone could overwrite your
workout page.

## 4. Start it

```bash
sudo cp ~/vulsor-server/vulsor-workout.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now vulsor-workout
systemctl status vulsor-workout
```

Forward TCP **8478** to the box on your router so the phone can reach it from outside.

## 5. Turn it on and use it

Offline publishing is **off by default**, so that scanning always opens a tab
immediately rather than waiting on the box. Once the service is running, switch it on
in `~/Documents/Vulsor_Memories/workout_share.json`:

```json
{ "enabled": true }
```

Then in Vulsor: **Workouts → To phone**. It publishes the day and shows a QR for
`https://YOUR-SERVER-HERE.example.com:8478/w/<slug>/`. Scan it once while you have a
connection — the page installs itself — and from then on it opens instantly with no
Wi-Fi and no signal, through refreshes and reboots, with Vulsor closed. The same QR
keeps working every day; re-running "To phone" replaces what it shows.

## How offline actually works

The service worker is **network-first with a 2.5 second timeout, falling back to
cache**. With a connection you get the freshly published day; without one the fetch
fails fast and the stored copy renders. Every successful load refreshes the stored
copy, so what you hold offline is always the last version you managed to fetch.

## Security notes

- **The URL is unlisted, not authenticated.** Anyone who has the `/w/<slug>/` link can
  read that page. The slug is 32 random hex characters so it won't be found by
  guessing, but treat the link like a password and don't paste it anywhere public.
- **Publishing is authenticated** by the bearer token, compared in constant time.
- Your workout list is stored on the box in `DATA_DIR` as plain HTML. That is the
  trade-off you accepted by hosting it: the data leaves the Mac.
- The server only ever answers `/w/<slug>/`, `/w/<slug>/sw.js` and
  `/w/<slug>/app.webmanifest`. Slugs are format-checked, so nothing can escape
  `DATA_DIR`, and uploads are capped at 8 MB.
- To rotate either secret, delete `workout_share.json` on the Mac and re-open
  **To phone** — you'll get a new token and a new URL, then update the unit and
  re-scan on the phone.

## If it isn't set up

Vulsor falls back to the old local-Wi-Fi page automatically, and the QR dialog tells you
why publishing failed. That fallback shows the list but cannot install itself offline.
