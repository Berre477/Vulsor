#!/bin/bash
# Install the freshly-built app into /Applications, where macOS will honor it as
# a default-web-browser candidate (an app in the iCloud-synced ~/Desktop is not
# listed). Run after `npm run build`. See memory: default-browser-setup.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/Vulsor Browser-darwin-arm64/Vulsor Browser.app"
DEST="/Applications/Vulsor Browser.app"
LSREG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

[ -d "$SRC" ] || { echo "Build not found at $SRC — run 'npm run build' first." >&2; exit 1; }

# Quit any running instance so we can replace it.
osascript -e 'quit app "Vulsor Browser"' 2>/dev/null || true
pkill -f "Vulsor Browser.app/Contents/MacOS/Vulsor Browser" 2>/dev/null || true
sleep 1

rm -rf "$DEST"
# --noextattr/--noqtn keep iCloud FinderInfo + quarantine xattrs out, which
# would otherwise break codesign.
ditto --noextattr --noqtn "$SRC" "$DEST"
xattr -cr "$DEST"

# ditto + xattr strip invalidates the ad-hoc signature; re-sign in place
# (works in /Applications, unlike the iCloud Desktop).
codesign --force --deep --sign - "$DEST"
codesign --verify --deep --strict "$DEST"

"$LSREG" -f "$DEST"

# Re-assert Vulsor as the default web browser — re-signing/re-registering can
# silently revert it to Safari, which would break Spotlight "Search Web" → Vulsor.
if [ -f "$ROOT/build-extras/set-default-browser.swift" ]; then
    swift "$ROOT/build-extras/set-default-browser.swift" 2>/dev/null || true
fi

# …and as the default .md handler, so notes keep opening in the Vault.
if [ -f "$ROOT/build-extras/set-default-markdown.swift" ]; then
    swift "$ROOT/build-extras/set-default-markdown.swift" "$DEST" 2>/dev/null || true
fi

echo "Deployed to $DEST, registered, and set as default browser + Markdown app."
