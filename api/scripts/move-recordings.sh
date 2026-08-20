#!/bin/bash
# Move call recordings to Firebase Storage and delete local copies.
# Runs via cron every hour. Order matters:
#   1. Pre-stitch multi-leg calls while their source WAVs are still local
#      (stitch-recordings.js is a no-op when there's nothing to stitch).
#   2. Sync stitched/ → firebase:<bucket>/astra_pbx/recordings/stitched/
#      using `rclone copy` so the single stitched file ALSO stays on disk
#      as a cache for the playback endpoint.
#   3. Sync the flat monitor dir (individual per-leg WAVs) using `rclone move`
#      as before — these are superseded by the stitched file for multi-leg
#      calls but are still kept in Firebase for archival / debugging.

export GOOGLE_APPLICATION_CREDENTIALS=/root/.config/gcloud/application_default_credentials.json

RECORDING_DIR=/var/spool/asterisk/monitor
# Cloud archival is OPT-IN. There is deliberately no default bucket: a default
# means every self-hosted install writes its customers' call recordings into
# whichever bucket happens to be baked into the source — and bills its owner for
# them. Set GCS_BUCKET (and a credential) to enable archival.
BUCKET="${GCS_BUCKET:-}"
BUCKET_PATH="${GCS_BUCKET_PATH:-astra_pbx/recordings}"
LOG=/var/log/rclone-recordings.log

if [ -z "$BUCKET" ]; then
  echo "[$(date -Iseconds)] GCS_BUCKET unset — cloud archival disabled, recordings stay in $RECORDING_DIR. Set GCS_BUCKET to enable." >> "$LOG"
  exit 0
fi

echo "[$(date -Iseconds)] Starting recording sync" >> $LOG

# 1. Pre-stitch any multi-leg calls from the last 24h that haven't been
#    stitched yet. Runs from /app so it picks up the live API config.
if [ -f /app/scripts/stitch-recordings.js ]; then
  cd /app && node scripts/stitch-recordings.js >> $LOG 2>&1 || true
fi

# 2. Copy stitched/ (one file per multi-leg call) to Firebase. Using `copy`
#    so the local file remains as a cache for the /recording endpoint.
if [ -d "$RECORDING_DIR/stitched" ]; then
  rclone copy "$RECORDING_DIR/stitched" "firebase:$BUCKET/$BUCKET_PATH/stitched/" \
    --include "*.wav" \
    --min-age 5m \
    --log-file $LOG \
    --log-level INFO \
    --stats-one-line 2>&1
fi

# 3. Move individual per-leg WAVs (flat layout, unchanged behaviour).
#    --max-depth 1 keeps rclone out of stitched/ so it can't drag stitched
#    files or src cache into firebase root.
rclone move $RECORDING_DIR firebase:$BUCKET/$BUCKET_PATH/ \
  --include "*.wav" \
  --max-depth 1 \
  --min-age 5m \
  --log-file $LOG \
  --log-level INFO \
  --stats-one-line 2>&1

echo "[$(date -Iseconds)] Sync complete" >> $LOG

# Also sync ARI bridge recordings (bot calls)
rclone move /var/spool/asterisk/recording "firebase:$BUCKET/$BUCKET_PATH/" \
  --include "*.wav" \
  --min-age 5m \
  --log-file $LOG \
  --log-level INFO \
  --stats-one-line 2>&1

echo "[$(date -Iseconds)] ARI recordings sync complete" >> $LOG
