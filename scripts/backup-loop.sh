#!/usr/bin/env bash
# Runs scripts/backup.sh every night at 02:30 IST (21:00 UTC). Copy /backups off the server regularly (see DEPLOYMENT.md).
set -uo pipefail
echo "Backup service started; first backup now, then nightly at 02:30 IST."
bash /scripts/backup.sh /backups || echo "Backup failed"
while true; do
  now=$(date -u +%s)
  next=$(date -u -d "today 21:00" +%s)
  [ "$next" -le "$now" ] && next=$(date -u -d "tomorrow 21:00" +%s)
  sleep $((next - now))
  bash /scripts/backup.sh /backups || echo "Backup failed $(date -u)"
done
