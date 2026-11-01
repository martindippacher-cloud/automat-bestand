#!/usr/bin/env bash
# inventory.json committen und zu GitHub pushen (GitHub Pages aktualisiert sich danach in ~1 Min.).
set -euo pipefail
cd "$(dirname "$0")"
git add inventory.json
if git diff --cached --quiet; then echo "Keine Bestandsänderung – nichts zu veröffentlichen."; exit 0; fi
TS="$(TZ=Europe/Berlin date '+%Y-%m-%d %H:%M:%S %Z')"
git commit -m "Bestand aktualisiert: $TS"
if git remote | grep -q .; then
  git push
else
  echo "Hinweis: Noch kein Remote eingerichtet – Commit ist nur lokal. Einrichten mit:"
  echo "  git remote add origin https://github.com/<user>/<repo>.git && git push -u origin main"
fi
