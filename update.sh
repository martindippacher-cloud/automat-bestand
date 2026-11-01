#!/usr/bin/env bash
# Bestand ändern (lokal in DIESEM Repo) und optional direkt veröffentlichen.
#   ./update.sh restock "Wasser" 5
#   ./update.sh sold 14 2
#   ./update.sh empty "Klöße" --publish
#   ./update.sh refill-next "2026-11-04 08:00" --note "Frische Braten" --publish
# Alle Befehle von manage.js funktionieren (set/restock/sold/empty/remove/rename/list/clear-examples/meta/refill-done/refill-next).
set -euo pipefail
cd "$(dirname "$0")"
PUBLISH=0; ARGS=()
for a in "$@"; do if [ "$a" = "--publish" ]; then PUBLISH=1; else ARGS+=("$a"); fi; done
if [ ${#ARGS[@]} -eq 0 ]; then node manage.js; exit 0; fi
node manage.js "${ARGS[@]}"
if [ "$PUBLISH" = 1 ]; then ./publish.sh; fi
