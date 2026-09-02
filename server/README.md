# Vulsor Ubuntu server — update host + always-on hub

This Ubuntu x64 box does two jobs:

1. **Update server** — serves `version.json` + build archives that every Vulsor
   app downloads updates from.
2. **Always-on hub** — runs Vulsor 24/7 as a shared "server" node others join
   for group chat + file sharing.

Below, replace `USER` with your Ubuntu username everywhere.

---

## 0. Prerequisites

```bash
sudo apt update
sudo apt install -y nodejs unzip xvfb libgtk-3-0 libnss3 libasound2t64
```
(If `libasound2t64` isn't found on your Ubuntu version, use `libasound2`.)

---

## 1. Update server

```bash
mkdir -p ~/vulsor-server/files
# copy update-server.js into ~/vulsor-server/  and the build archives into ~/vulsor-server/files/
```

Put these in `~/vulsor-server/files/`:
- `version.json`
- `Vulsor-darwin-arm64.zip`
- `Vulsor-darwin-x64.zip`     (build with `npm run build` on an Intel Mac, or skip)
- `Vulsor-win32-x64.zip`
- `Vulsor-linux-x64.tar.gz`

Run it as a service:
```bash
sudo cp vulsor-update.service /etc/systemd/system/
sudoedit /etc/systemd/system/vulsor-update.service   # set User + paths
sudo systemctl daemon-reload
sudo systemctl enable --now vulsor-update
systemctl status vulsor-update
```
Test:  `curl http://localhost:8479/version.json`

### Make it reachable by all apps
- **Same LAN only:** apps use `http://<ubuntu-LAN-ip>:8479/version.json`.
- **Over the internet:** forward port 8479 on your router to this box (or run it
  on a cloud VM with a public IP / domain). Then apps use that public address.
  Tell me the final address and I'll bake it into the app builds.

---

## 2. Always-on hub

```bash
# copy Vulsor-linux-x64.tar.gz to the home dir, then:
tar -xzf Vulsor-linux-x64.tar.gz        # -> ~/Vulsor-linux-x64/
chmod +x ~/Vulsor-linux-x64/Vulsor
```

Run it once to create your hub server:
```bash
xvfb-run -a ~/Vulsor-linux-x64/Vulsor --no-sandbox --disable-gpu
```
…but it's headless, so easier: run it once on a machine **with a screen**, open the
**Network** tab, create a server (e.g. "Main"), then quit. That server now
auto-advertises on every launch. (Its data lives in
`~/Documents/Vulsor_Memories/network.json`, which you can copy to the Ubuntu box.)

Install as a service so it starts on boot and restarts if it crashes:
```bash
sudo cp vulsor-hub.service /etc/systemd/system/
sudoedit /etc/systemd/system/vulsor-hub.service     # set User + path
sudo systemctl daemon-reload
sudo systemctl enable --now vulsor-hub
systemctl status vulsor-hub
```

> Note: the hub only reaches other devices on the **same local network** (UDP
> discovery is LAN-scoped). For internet-wide hubs you'd need a relay/VPN —
> ask if you want that.

---

## 3. Publishing a new version (your release flow)

1. Bump `"version"` in the project `package.json`.
2. Build each platform:
   - macOS:  `npm run build`        → zip `Vulsor-darwin-arm64`
   - Windows:`npm run build-win`    → zip `Vulsor-win32-x64`
   - Linux:  `npm run build-linux`  → `tar -czf Vulsor-linux-x64.tar.gz Vulsor-linux-x64`
3. `scp` the archives into `~/vulsor-server/files/` on the Ubuntu box.
4. Edit `~/vulsor-server/files/version.json`: set the new `version` and confirm URLs.

Within 6 hours (or on next launch) every app downloads it and silently applies it
on the next restart.
