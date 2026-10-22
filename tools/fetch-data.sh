#!/usr/bin/env bash
# Downloads the Z-Anatomy source models (CC BY-SA 4.0) and structure descriptions
# used by tools/build-models.mjs. Output goes to $ZA_DIR (default /tmp/za).
set -euo pipefail
ZA_DIR="${ZA_DIR:-/tmp/za}"
mkdir -p "$ZA_DIR/desc"
cd "$ZA_DIR"
if [ ! -d repo ]; then
  git clone --depth 1 --filter=blob:none --no-checkout https://github.com/LluisV/Z-Anatomy repo
fi
cd repo
git checkout HEAD -- Resources/Models/FBX
git ls-tree -r --name-only HEAD | grep '^Resources/Descriptions/OriginalDescriptions/.*\.txt$' > "$ZA_DIR/desc-files.txt"
cd "$ZA_DIR"
python3 - "$ZA_DIR/desc-files.txt" > "$ZA_DIR/desc-urls.txt" <<'PY'
import sys, urllib.parse
for line in open(sys.argv[1]):
    p = line.rstrip('\n')
    print('https://raw.githubusercontent.com/LluisV/Z-Anatomy/PC-Version/' + urllib.parse.quote(p))
    print(p.split('/')[-1])
PY
tr '\n' '\0' < "$ZA_DIR/desc-urls.txt" | xargs -0 -n 2 -P 32 sh -c '[ -s "$0/desc/$2" ] || curl -sSf --retry 3 -o "$0/desc/$2" "$1"' "$ZA_DIR"
echo "Done. Run: ZA_FBX=$ZA_DIR/repo/Resources/Models/FBX ZA_DESC=$ZA_DIR/desc npm run build:data"
