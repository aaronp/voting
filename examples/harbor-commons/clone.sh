#!/usr/bin/env bash
# Copy this example into a new polls repo wired to a GitHub repo.
#   ./clone.sh [-r owner/repo | github-url] [-d dest-dir]
# Or set REPO / DEST env vars. Anything missing is prompted for.
set -euo pipefail

while getopts "r:d:h" opt; do
  case $opt in
    r) REPO=$OPTARG ;;
    d) DEST=$OPTARG ;;
    *) sed -n '2,4p' "$0"; exit 1 ;;
  esac
done

[ -n "${REPO:-}" ] || read -rp "GitHub repo (owner/repo or URL): " REPO
# Accepts owner/repo, https://github.com/owner/repo(.git), git@github.com:owner/repo.git
SLUG=$(echo "$REPO" | sed -E 's#^(https://github\.com/|git@github\.com:)##; s#\.git$##; s#/$##')
[[ $SLUG =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "Can't parse repo: $REPO" >&2; exit 1; }
OWNER=${SLUG%/*}
NAME=${SLUG#*/}

[ -n "${DEST:-}" ] || read -rp "Destination dir [../$NAME]: " DEST
DEST=${DEST:-../$NAME}
[ ! -e "$DEST" ] || [ -z "$(ls -A "$DEST")" ] || { echo "$DEST exists and is not empty" >&2; exit 1; }

OWNER_LC=$(echo "$OWNER" | tr '[:upper:]' '[:lower:]')
if [ "$(echo "$NAME" | tr '[:upper:]' '[:lower:]')" = "$OWNER_LC.github.io" ]; then
  PAGES="https://$OWNER_LC.github.io/"
else
  PAGES="https://$OWNER_LC.github.io/$NAME/"
fi

SRC=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$DEST"
cp -R "$SRC/.github" "$SRC/index.html" "$SRC/README.md" "$SRC/tally.json" "$DEST/"
sed -i.bak "s#https://aaronp.github.io/voting-example/#$PAGES#" "$DEST/README.md" && rm "$DEST/README.md.bak"

cd "$DEST"
git init -q -b main
git remote add origin "git@github.com:$SLUG.git"

cat <<MSG
Created $DEST  (remote: git@github.com:$SLUG.git)
Next:
  cd $DEST
  git add . && git commit -m "Initial polls" && git push -u origin main
  Then on GitHub: Settings → Pages → Source: GitHub Actions
Live at: $PAGES
MSG
