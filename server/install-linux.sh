#!/bin/bash
# ════════════════════════════════════════════════════════════════
#  Vulsor — Ubuntu installer
#  Makes Vulsor a clickable app (shows in your Applications menu).
#
#  Usage:
#    1. Put Vulsor-linux-x64.tar.gz in your home folder.
#    2. Run:  bash install-linux.sh
# ════════════════════════════════════════════════════════════════
set -e

HOME_DIR="$HOME"
TARBALL="$HOME_DIR/Vulsor-linux-x64.tar.gz"
APP_DIR="$HOME_DIR/Vulsor-linux-x64"

echo "==> Installing runtime libraries (needs sudo)…"
sudo apt update -y
sudo apt install -y libgtk-3-0 libnss3 libgbm1 || true
sudo apt install -y libasound2t64 2>/dev/null || sudo apt install -y libasound2 || true

if [ -f "$TARBALL" ]; then
    echo "==> Unpacking $TARBALL …"
    tar -xzf "$TARBALL" -C "$HOME_DIR"
fi

if [ ! -x "$APP_DIR/Vulsor" ]; then
    echo "ERROR: $APP_DIR/Vulsor not found. Put Vulsor-linux-x64.tar.gz in $HOME_DIR and re-run."
    exit 1
fi
chmod +x "$APP_DIR/Vulsor"

echo "==> Creating the clickable launcher…"
mkdir -p "$HOME_DIR/.local/share/applications"
cat > "$HOME_DIR/.local/share/applications/Vulsor.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Vulsor
Comment=My Private Local AI
Exec=$APP_DIR/Vulsor --no-sandbox
Icon=$APP_DIR/icon.png
Terminal=false
Categories=Utility;Network;
StartupWMClass=Vulsor
EOF
chmod +x "$HOME_DIR/.local/share/applications/Vulsor.desktop"
update-desktop-database "$HOME_DIR/.local/share/applications" 2>/dev/null || true

echo ""
echo "✅ Done. Open your app menu and search 'Vulsor' — click to launch."
echo "   (Right-click its icon to pin it to the dock / favorites.)"
