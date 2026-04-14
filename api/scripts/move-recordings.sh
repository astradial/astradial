#!/bin/bash
# Move call recordings to Firebase Storage and delete local copies
# Runs via cron every hour

export GOOGLE_APPLICATION_CREDENTIALS=/root/.config/gcloud/application_default_credentials.json

RECORDING_DIR=/var/spool/asterisk/monitor
BUCKET=misssellerai.firebasestorage.app
BUCKET_PATH=astra_pbx/recordings
LOG=/var/log/rclone-recordings.log

echo "[$(date -Iseconds)] Starting recording sync" >> $LOG

# Move .wav files older than 5 minutes (avoid in-progress recordings)
# rclone move uploads then deletes local file
rclone move $RECORDING_DIR firebase:$BUCKET/$BUCKET_PATH/   --include "*.wav"   --min-age 5m   --log-file $LOG   --log-level INFO   --stats-one-line   2>&1

echo "[$(date -Iseconds)] Sync complete" >> $LOG

# Also sync ARI bridge recordings (bot calls)
rclone move /var/spool/asterisk/recording firebase:misssellerai.firebasestorage.app/astra_pbx/recordings/   --include "*.wav"   --min-age 5m   --log-file $LOG   --log-level INFO   --stats-one-line   2>&1

echo "[$(date -Iseconds)] ARI recordings sync complete" >> $LOG
