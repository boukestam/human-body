#!/usr/bin/env bash
# Downloads the source data used by tools/build-models.mjs:
#  - Z-Anatomy FBX models and structure descriptions (CC BY-SA 4.0) -> $ZA_DIR
#  - HuBMAP Human Reference Atlas united female / male bodies (CC BY 4.0) -> $HRA_DIR
set -euo pipefail
ZA_DIR="${ZA_DIR:-/tmp/za}"
HRA_DIR="${HRA_DIR:-/tmp/hra/united}"

# --- Z-Anatomy
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

# --- HuBMAP Human Reference Atlas (v1.3 united bodies)
mkdir -p "$HRA_DIR"
HRA_REPO="$(dirname "$HRA_DIR")/repo"
if [ ! -d "$HRA_REPO" ]; then
  git clone --depth 1 --filter=blob:none --no-checkout https://github.com/hubmapconsortium/ccf-releases "$HRA_REPO"
fi
git -C "$HRA_REPO" checkout HEAD -- v1.3/models/3d-vh-f-united.glb.zip v1.3/models/VH_M_United.glb.zip
unzip -o -q "$HRA_REPO/v1.3/models/3d-vh-f-united.glb.zip" -d "$HRA_DIR"
unzip -o -q "$HRA_REPO/v1.3/models/VH_M_United.glb.zip" -d "$HRA_DIR"

echo "Done. Run: npm run build:data"
