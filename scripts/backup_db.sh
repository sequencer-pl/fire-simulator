#!/usr/bin/env bash
# Automated SQLite backup for the FIRE simulator.
#
# Uses the SQLite online backup API (sqlite3 .backup) so it is safe to run
# against a live WAL-mode database. Rotates to keep BACKUP_KEEP most recent
# snapshots.
#
# Usage:
#   FIRE_DB=/var/data/fire.db BACKUP_DIR=/var/data/backups ./scripts/backup_db.sh
set -euo pipefail

: "${FIRE_DB:=./fire.db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"

if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "error: sqlite3 CLI not found" >&2
    exit 1
fi

if [ ! -f "$FIRE_DB" ]; then
    echo "info: no database at $FIRE_DB — nothing to back up"
    exit 0
fi

mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
dest="$BACKUP_DIR/fire-${stamp}.db"

sqlite3 "$FIRE_DB" ".backup '$dest'"
echo "backup written to $dest"

# Rotate: keep only the newest BACKUP_KEEP snapshots.
find "$BACKUP_DIR" -name 'fire-*.db' -type f | sort -r | tail -n +$((BACKUP_KEEP + 1)) \
    | xargs -r rm -f
