#!/usr/bin/env bash
set -euo pipefail
# Daily backup for Lander SQLite DB. Keeps last 7 backups.
# DB path respects LANDER_DB_PATH, defaults to ./lander.db next to script.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_PATH="${LANDER_DB_PATH:-$PROJECT_DIR/lander.db}"
BACKUP_DIR="${LANDER_BACKUP_DIR:-$HOME/lander-backups}"
KEEP_DAYS=7

if [[ ! -f "$DB_PATH" ]]; then
  echo "No DB found at $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%F-%H%M)"
DEST="$BACKUP_DIR/lander-$STAMP.db"

# Use sqlite3 backup API if available (safe while app is running), else plain copy.
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".backup '$DEST'"
else
  cp "$DB_PATH" "$DEST"
fi

# Verify file is non-empty
if [[ ! -s "$DEST" ]]; then
  echo "Backup failed: $DEST is empty" >&2
  exit 1
fi

# Prune old backups
find "$BACKUP_DIR" -name 'lander-*.db' -type f -mtime +"$KEEP_DAYS" -delete

echo "Backup done: $DEST ($(du -h "$DEST" | cut -f1))"
ls -lt "$BACKUP_DIR" | head -n 10
