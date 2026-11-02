#!/usr/bin/env bash
# One backup: database dump + uploaded files, named by date. Usage (inside the backup container or any host with mongodump):
#   MONGO_URL=... DB_NAME=... ./backup.sh /backups
set -euo pipefail
OUT=${1:-/backups}
STAMP=$(date -u +%Y-%m-%d_%H%M)
mkdir -p "$OUT"
mongodump --uri "$MONGO_URL" --db "$DB_NAME" --archive="$OUT/db-$STAMP.gz" --gzip --quiet
tar czf "$OUT/uploads-$STAMP.tgz" -C /data uploads 2>/dev/null || tar czf "$OUT/uploads-$STAMP.tgz" --files-from /dev/null
find "$OUT" -name 'db-*.gz' -mtime +"${KEEP_DAYS:-30}" -delete
find "$OUT" -name 'uploads-*.tgz' -mtime +"${KEEP_DAYS:-30}" -delete
echo "Backup written: $OUT/db-$STAMP.gz and uploads-$STAMP.tgz"
