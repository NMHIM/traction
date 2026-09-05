#!/usr/bin/env bash
# Traction — build the zip you upload to the Chrome Web Store.
#
#   bash pack.sh
#
# Asks for three values, writes them into extension/config.js, and produces
# traction-upload.zip in this folder. Run it again any time you change something.

set -euo pipefail
cd "$(dirname "$0")"

BOLD=$'\033[1m'; DIM=$'\033[2m'; OFF=$'\033[0m'

echo
echo "${BOLD}Traction — package for the Chrome Web Store${OFF}"
echo "${DIM}Three values. Press Ctrl-C to bail out at any point.${OFF}"
echo

read -r -p "1/3  GitHub username             : " GH_USER
read -r -p "2/3  GitHub repo name            : " GH_REPO
read -r -p "3/3  Supabase project URL        : " SB_URL
read -r -p "     Supabase anon key           : " SB_KEY

# tidy up common paste mistakes
SB_URL="${SB_URL%/}"
GH_USER="$(echo "$GH_USER" | tr -d ' ')"
GH_REPO="$(echo "$GH_REPO" | tr -d ' ')"

for v in GH_USER GH_REPO SB_URL SB_KEY; do
  if [[ -z "${!v}" ]]; then echo "  ✗ $v is empty. Nothing written."; exit 1; fi
done

if [[ "$SB_URL" != https://*.supabase.co ]]; then
  echo "  ! Expected something like https://abcdefgh.supabase.co — got $SB_URL"
  read -r -p "    Continue anyway? [y/N] " ok
  [[ "$ok" == "y" || "$ok" == "Y" ]] || exit 1
fi

CFG=extension/config.js
[[ -f "$CFG.bak" ]] || cp "$CFG" "$CFG.bak"   # keep a pristine copy
cp "$CFG.bak" "$CFG"

FEED="https://cdn.jsdelivr.net/gh/${GH_USER}/${GH_REPO}@main/feed/feed.json"

python3 - "$CFG" "$FEED" "$SB_URL" "$SB_KEY" <<'PY'
import sys
path, feed, url, key = sys.argv[1:5]
s = open(path).read()
s = s.replace("https://cdn.jsdelivr.net/gh/GH_USER/GH_REPO@main/feed/feed.json", feed)
s = s.replace("https://YOUR_PROJECT.supabase.co", url)
s = s.replace("YOUR_ANON_KEY", key)
open(path, "w").write(s)
PY

# the zip must contain manifest.json at its root, not a folder
rm -f traction-upload.zip
( cd extension && zip -q -r -X ../traction-upload.zip . -x '*.bak' '.DS_Store' '__MACOSX/*' )

echo
echo "  ✓ config.js written"
echo "  ✓ ${BOLD}traction-upload.zip${OFF} ready  ($(du -h traction-upload.zip | cut -f1))"
echo
echo "  Feed:     $FEED"
echo "  Supabase: $SB_URL"
echo
echo "  Test it first: chrome://extensions → Developer mode → Load unpacked → pick the 'extension' folder."
echo "  Then upload traction-upload.zip at https://chrome.google.com/webstore/devconsole"
echo
