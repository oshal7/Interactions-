#!/usr/bin/env bash
# Builds Paper Sky for macOS without Xcode projects: just swiftc + bundle folders.
#
#   dist/Paper Sky.saver   screen saver (double-click to install)
#   dist/Paper Sky.app     menu-bar app (live wallpaper, ambient mode, lock now)
#   dist/*.zip             the same, zipped for download
#
# Needs the Xcode command line tools (xcode-select --install). Runs on GitHub's macOS runners too.
# Universal binaries (Apple Silicon + Intel), ad-hoc signed (not notarized).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WEB="$HERE/../web"
BUILD="$HERE/build"
OUT="$HERE/dist"
VERSION="${VERSION:-1.0.0}"
BUILD_NO="${BUILD_NO:-1}"
MINOS="12.0"
ARCHS=(arm64 x86_64)

rm -rf "$BUILD" "$OUT"
mkdir -p "$BUILD" "$OUT"
swiftc --version

plist() { sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD_NO/" "$1" > "$2"; }

# ---------- screen saver (.saver = a bundle whose executable is a dynamic library) ----------
for arch in "${ARCHS[@]}"; do
  swiftc -O -module-name PaperSky -target "$arch-apple-macos$MINOS" \
    -emit-library -o "$BUILD/saver-$arch" \
    "$HERE/Saver/PaperSkyView.swift" \
    -framework ScreenSaver -framework WebKit -framework AppKit
done
SAVER="$OUT/Paper Sky.saver"
mkdir -p "$SAVER/Contents/MacOS" "$SAVER/Contents/Resources"
lipo -create "$BUILD"/saver-* -output "$SAVER/Contents/MacOS/PaperSky"
plist "$HERE/Saver/Info.plist" "$SAVER/Contents/Info.plist"
cp -R "$WEB" "$SAVER/Contents/Resources/web"

# ---------- menu-bar app ----------
for arch in "${ARCHS[@]}"; do
  swiftc -O -module-name PaperSkyApp -target "$arch-apple-macos$MINOS" \
    -o "$BUILD/app-$arch" \
    "$HERE/App/main.swift" \
    -framework AppKit -framework WebKit -framework ServiceManagement
done
APP="$OUT/Paper Sky.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
lipo -create "$BUILD"/app-* -output "$APP/Contents/MacOS/PaperSky"
plist "$HERE/App/Info.plist" "$APP/Contents/Info.plist"
cp -R "$WEB" "$APP/Contents/Resources/web"

# ---------- sign (ad-hoc) + zip ----------
codesign --force --deep --sign - "$SAVER"
codesign --force --deep --sign - "$APP"
codesign --verify --verbose "$SAVER" "$APP"

( cd "$OUT"
  ditto -c -k --keepParent "Paper Sky.saver" "PaperSky-ScreenSaver-$VERSION.zip"
  ditto -c -k --keepParent "Paper Sky.app" "PaperSky-App-$VERSION.zip"
  ls -la )
echo "Built Paper Sky $VERSION → $OUT"
