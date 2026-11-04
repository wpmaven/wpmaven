#!/bin/bash
#
# Builds dist/wpmaven.zip, the WPMaven plugin as WordPress.org ships it,
# from this repository:
#
#   bash build.sh                 installs the app's packages (npm ci), then builds
#   SKIP_INSTALL=1 bash build.sh  builds with the packages already installed
#
# plugin/                the plugin's PHP, copied as it is
# app/                   the admin app (React, TypeScript), built by webpack
#                        into the plugin's assets/
# packages/webmaven-ui/  the shared interface packages the app compiles
#                        from their source
#
# Needs Node.js 20 or later, npm, and zip.

set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(grep -E '^[[:space:]]*\*[[:space:]]*Version:' plugin/wpmaven.php | head -1 | sed -E 's/.*Version:[[:space:]]*//' | tr -d '\r')
if [ -z "$VERSION" ]; then
    echo "❌ Could not read Version from plugin/wpmaven.php"
    exit 1
fi
OUT="dist/wpmaven"

echo "🚀 Building WPMaven ${VERSION}..."
rm -rf dist
mkdir -p "$OUT/assets"

if [ -z "${SKIP_INSTALL:-}" ]; then
    echo "📦 Installing the app's packages..."
    (cd app && npm ci --no-audit --no-fund)
fi

echo "📦 Building the app..."
(cd app && npm run build)

# The app (dashboard.js and dashboard.css), every lazy chunk with its own
# stylesheet, and the license notes the minifier moves out of a chunk.
cp app/dist/*.js app/dist/*.css "$OUT/assets/"
for notes in app/dist/*.LICENSE.txt; do
    if [ -f "$notes" ]; then cp "$notes" "$OUT/assets/"; fi
done
# The app's static files: its fonts (served by the plugin itself), the
# visitor statistics script, and the Markdown library.
cp -r app/assets/* "$OUT/assets/"

echo "🔧 Copying the plugin..."
cp -r plugin/. "$OUT/"
# The directory reads the release from readme.txt's Stable tag.
sed -i -E "s/^(Stable tag:[[:space:]]*).*/\1${VERSION}/" "$OUT/readme.txt"

echo "📦 Creating the zip..."
(cd dist && zip -9 -X -r -q wpmaven.zip wpmaven -x "*.DS_Store" "*/README.md" "*/CHANGELOG.md")

echo "✅ dist/wpmaven.zip ($(wc -c < dist/wpmaven.zip | tr -d ' ') bytes)"
