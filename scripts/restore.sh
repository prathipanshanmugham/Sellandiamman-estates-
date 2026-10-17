#!/usr/bin/env bash
# Restore a backup into the running stack. This REPLACES the current data.
#   ./scripts/restore.sh backups/db-2026-10-17_2100.gz [backups/uploads-2026-10-17_2100.tgz]
set -euo pipefail
DB_ARCHIVE=${1:?Give the db-*.gz file}
UPLOADS=${2:-}
read -r -p "This replaces the live database with $DB_ARCHIVE. Type RESTORE to continue: " ok
[ "$ok" = "RESTORE" ] || { echo "Cancelled"; exit 1; }
source .env
docker compose exec -T mongo mongorestore --uri "mongodb://estates:${MONGO_PASSWORD}@localhost:27017/?authSource=admin" \
  --archive --gzip --drop < "$DB_ARCHIVE"
if [ -n "$UPLOADS" ]; then
  docker compose cp "$UPLOADS" backend:/tmp/uploads.tgz
  docker compose exec -T backend sh -c "cd /data && tar xzf /tmp/uploads.tgz && rm /tmp/uploads.tgz"
fi
docker compose restart backend
echo "Restored. Sign in and check recent records."
