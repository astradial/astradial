const fs = require('fs').promises;
const path = require('path');
const { CallRecord, CallRecording, Organization, User } = require('../../models');

class CallRecordingService {
  constructor() {
    this.recordingsPath = process.env.ASTERISK_RECORDINGS_PATH || '/var/spool/asterisk/monitor';
    this.baseUrl = process.env.RECORDINGS_BASE_URL || 'https://your-domain.com/recordings';
    this.formats = ['wav', 'mp3', 'gsm'];
    this.ariClient = null; // Will be injected
  }

  setAriClient(ariClient) {
    this.ariClient = ariClient;
  }

  async startRecording(channelId, callId, options = {}) {
    try {
      console.log(`🎙️ Starting recording for call ${callId}, channel ${channelId}`);

      const callRecord = await CallRecord.findOne({ where: { call_id: callId } });
      if (!callRecord) {
        throw new Error('Call record not found');
      }

      // Generate unique recording filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const recordingName = `${callId}_${timestamp}`;
      const format = options.format || 'wav';

      // Check recording permissions for organization
      const org = await Organization.findByPk(callRecord.org_id);
      if (!org || !org.recording_enabled) {
        throw new Error('Recording not enabled for this organization');
      }

      // Check per-user recording preferences if applicable
      if (callRecord.direction === 'outbound') {
        const fromUser = await User.findOne({
          where: {
            extension: callRecord.from_number,
            org_id: callRecord.org_id
          }
        });

        if (fromUser && !fromUser.recording_enabled) {
          console.log(`📵 Recording disabled for user ${fromUser.extension}`);
          return null;
        }
      }

      // Create recording directory structure
      const orgPath = path.join(this.recordingsPath, org.id.toString());
      const datePath = path.join(orgPath, new Date().toISOString().split('T')[0]);
      await this.ensureDirectoryExists(datePath);

      const filePath = path.join(datePath, `${recordingName}.${format}`);

      // Start recording via ARI
      if (this.ariClient) {
        const recordingOptions = {
          name: recordingName,
          format: format,
          maxDurationSeconds: options.maxDuration || 7200, // 2 hours default
          maxSilenceSeconds: options.maxSilence || 300,     // 5 minutes default
          ifExists: 'overwrite',
          beep: options.beep !== false,
          terminateOn: options.terminateOn || 'none'
        };

        await this.ariClient.channels.record({
          channelId,
          ...recordingOptions
        });
      }

      // Create recording record in database
      const recording = await CallRecording.create({
        call_record_id: callRecord.id,
        org_id: callRecord.org_id,
        filename: `${recordingName}.${format}`,
        file_path: filePath,
        format: format,
        status: 'recording',
        started_at: new Date(),
        channel_id: channelId,
        recording_type: options.type || 'call',
        metadata: {
          channel_id: channelId,
          call_direction: callRecord.direction,
          from_number: callRecord.from_number,
          to_number: callRecord.to_number,
          recording_options: recordingOptions
        }
      });

      console.log(`✅ Recording started: ${recording.filename}`);
      return recording;

    } catch (error) {
      console.error('❌ Error starting recording:', error);
      throw error;
    }
  }

  async stopRecording(recordingId) {
    try {
      console.log(`🛑 Stopping recording: ${recordingId}`);

      const recording = await CallRecording.findByPk(recordingId);
      if (!recording) {
        throw new Error('Recording not found');
      }

      if (recording.status !== 'recording') {
        throw new Error('Recording is not active');
      }

      // Stop recording via ARI
      if (this.ariClient && recording.metadata?.recording_options?.name) {
        try {
          await this.ariClient.recordings.stop({
            recordingName: recording.metadata.recording_options.name
          });
        } catch (ariError) {
          console.warn('⚠️ ARI stop recording warning:', ariError.message);
        }
      }

      // Update recording status and calculate duration
      const endedAt = new Date();
      const duration = Math.floor((endedAt - new Date(recording.started_at)) / 1000);

      await recording.update({
        status: 'completed',
        ended_at: endedAt,
        duration: duration
      });

      // Check if file exists and get file size
      try {
        const stats = await fs.stat(recording.file_path);
        await recording.update({
          file_size: stats.size,
          metadata: {
            ...recording.metadata,
            file_stats: {
              size: stats.size,
              created: stats.birthtime,
              modified: stats.mtime
            }
          }
        });
      } catch (fileError) {
        console.warn('⚠️ Could not get file stats:', fileError.message);
        await recording.update({ status: 'file_missing' });
      }

      console.log(`✅ Recording stopped: ${recording.filename} (${duration}s)`);
      return recording;

    } catch (error) {
      console.error('❌ Error stopping recording:', error);
      throw error;
    }
  }

  async pauseRecording(recordingId) {
    try {
      const recording = await CallRecording.findByPk(recordingId);
      if (!recording || recording.status !== 'recording') {
        throw new Error('Cannot pause recording');
      }

      // Pause via ARI
      if (this.ariClient && recording.metadata?.recording_options?.name) {
        await this.ariClient.recordings.pause({
          recordingName: recording.metadata.recording_options.name
        });
      }

      await recording.update({ status: 'paused' });
      console.log(`⏸️ Recording paused: ${recording.filename}`);
      return recording;

    } catch (error) {
      console.error('❌ Error pausing recording:', error);
      throw error;
    }
  }

  async resumeRecording(recordingId) {
    try {
      const recording = await CallRecording.findByPk(recordingId);
      if (!recording || recording.status !== 'paused') {
        throw new Error('Cannot resume recording');
      }

      // Resume via ARI
      if (this.ariClient && recording.metadata?.recording_options?.name) {
        await this.ariClient.recordings.unpause({
          recordingName: recording.metadata.recording_options.name
        });
      }

      await recording.update({ status: 'recording' });
      console.log(`▶️ Recording resumed: ${recording.filename}`);
      return recording;

    } catch (error) {
      console.error('❌ Error resuming recording:', error);
      throw error;
    }
  }

  async getRecording(recordingId) {
    try {
      const recording = await CallRecording.findByPk(recordingId, {
        include: [
          {
            model: CallRecord,
            as: 'callRecord',
            attributes: ['call_id', 'from_number', 'to_number', 'direction', 'started_at']
          }
        ]
      });

      if (!recording) {
        throw new Error('Recording not found');
      }

      // Check if file exists
      let fileExists = false;
      let fileSize = recording.file_size;

      try {
        const stats = await fs.stat(recording.file_path);
        fileExists = true;
        fileSize = stats.size;
      } catch (error) {
        console.warn(`⚠️ Recording file not found: ${recording.file_path}`);
      }

      return {
        ...recording.toJSON(),
        file_exists: fileExists,
        file_size: fileSize,
        download_url: fileExists ? this.generateDownloadUrl(recording) : null,
        stream_url: fileExists ? this.generateStreamUrl(recording) : null
      };

    } catch (error) {
      console.error('❌ Error getting recording:', error);
      throw error;
    }
  }

  async listRecordings(orgId, filters = {}) {
    try {
      const whereClause = { org_id: orgId };

      // Apply filters
      if (filters.status) {
        whereClause.status = filters.status;
      }

      if (filters.dateFrom) {
        whereClause.started_at = whereClause.started_at || {};
        whereClause.started_at[Op.gte] = new Date(filters.dateFrom);
      }

      if (filters.dateTo) {
        whereClause.started_at = whereClause.started_at || {};
        whereClause.started_at[Op.lte] = new Date(filters.dateTo);
      }

      if (filters.callId) {
        const callRecord = await CallRecord.findOne({
          where: { call_id: filters.callId, org_id: orgId }
        });
        if (callRecord) {
          whereClause.call_record_id = callRecord.id;
        }
      }

      const recordings = await CallRecording.findAll({
        where: whereClause,
        include: [
          {
            model: CallRecord,
            as: 'callRecord',
            attributes: ['call_id', 'from_number', 'to_number', 'direction', 'started_at', 'ended_at']
          }
        ],
        order: [['started_at', 'DESC']],
        limit: filters.limit || 100,
        offset: filters.offset || 0
      });

      // Enhance recordings with file existence and URLs
      const enhancedRecordings = await Promise.all(
        recordings.map(async (recording) => {
          let fileExists = false;
          try {
            await fs.access(recording.file_path);
            fileExists = true;
          } catch (error) {
            // File doesn't exist
          }

          return {
            ...recording.toJSON(),
            file_exists: fileExists,
            download_url: fileExists ? this.generateDownloadUrl(recording) : null,
            stream_url: fileExists ? this.generateStreamUrl(recording) : null
          };
        })
      );

      return enhancedRecordings;

    } catch (error) {
      console.error('❌ Error listing recordings:', error);
      throw error;
    }
  }

  async deleteRecording(recordingId, deleteFile = false) {
    try {
      console.log(`🗑️ Deleting recording: ${recordingId}`);

      const recording = await CallRecording.findByPk(recordingId);
      if (!recording) {
        throw new Error('Recording not found');
      }

      // Stop recording if it's still active
      if (recording.status === 'recording' || recording.status === 'paused') {
        await this.stopRecording(recordingId);
      }

      // Delete physical file if requested
      if (deleteFile && recording.file_path) {
        try {
          await fs.unlink(recording.file_path);
          console.log(`🗂️ Deleted recording file: ${recording.file_path}`);
        } catch (fileError) {
          console.warn('⚠️ Could not delete recording file:', fileError.message);
        }
      }

      // Delete database record
      await recording.destroy();

      console.log(`✅ Recording deleted: ${recording.filename}`);
      return { success: true, deleted_file: deleteFile };

    } catch (error) {
      console.error('❌ Error deleting recording:', error);
      throw error;
    }
  }

  async convertRecording(recordingId, targetFormat) {
    try {
      if (!this.formats.includes(targetFormat)) {
        throw new Error(`Unsupported format: ${targetFormat}`);
      }

      const recording = await CallRecording.findByPk(recordingId);
      if (!recording) {
        throw new Error('Recording not found');
      }

      if (recording.format === targetFormat) {
        throw new Error('Recording is already in target format');
      }

      // Check if source file exists
      const sourceExists = await fs.access(recording.file_path).then(() => true).catch(() => false);
      if (!sourceExists) {
        throw new Error('Source recording file not found');
      }

      const sourcePath = recording.file_path;
      const targetPath = sourcePath.replace(`.${recording.format}`, `.${targetFormat}`);

      // Use ffmpeg for conversion (would need to be installed)
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const ffmpegCommand = `ffmpeg -i "${sourcePath}" -acodec ${this.getCodecForFormat(targetFormat)} "${targetPath}"`;

      console.log(`🔄 Converting ${recording.filename} to ${targetFormat}...`);
      await execAsync(ffmpegCommand);

      // Create new recording record for converted file
      const convertedRecording = await CallRecording.create({
        call_record_id: recording.call_record_id,
        org_id: recording.org_id,
        filename: path.basename(targetPath),
        file_path: targetPath,
        format: targetFormat,
        status: 'completed',
        started_at: recording.started_at,
        ended_at: recording.ended_at,
        duration: recording.duration,
        recording_type: recording.recording_type,
        metadata: {
          ...recording.metadata,
          converted_from: recording.id,
          conversion_date: new Date().toISOString()
        }
      });

      // Get file size for converted file
      try {
        const stats = await fs.stat(targetPath);
        await convertedRecording.update({ file_size: stats.size });
      } catch (error) {
        console.warn('⚠️ Could not get converted file stats:', error.message);
      }

      console.log(`✅ Recording converted: ${convertedRecording.filename}`);
      return convertedRecording;

    } catch (error) {
      console.error('❌ Error converting recording:', error);
      throw error;
    }
  }

  getCodecForFormat(format) {
    const codecMap = {
      'wav': 'pcm_s16le',
      'mp3': 'libmp3lame',
      'gsm': 'libgsm'
    };
    return codecMap[format] || 'pcm_s16le';
  }

  async getRecordingStats(orgId, dateRange = {}) {
    try {
      const whereClause = { org_id: orgId };

      if (dateRange.from || dateRange.to) {
        whereClause.started_at = {};
        if (dateRange.from) {
          whereClause.started_at[Op.gte] = new Date(dateRange.from);
        }
        if (dateRange.to) {
          whereClause.started_at[Op.lte] = new Date(dateRange.to);
        }
      }

      const recordings = await CallRecording.findAll({
        where: whereClause,
        attributes: ['status', 'duration', 'file_size', 'format']
      });

      const stats = {
        total_recordings: recordings.length,
        by_status: {},
        by_format: {},
        total_duration: 0,
        total_size: 0,
        average_duration: 0
      };

      recordings.forEach(recording => {
        // Status stats
        stats.by_status[recording.status] = (stats.by_status[recording.status] || 0) + 1;

        // Format stats
        stats.by_format[recording.format] = (stats.by_format[recording.format] || 0) + 1;

        // Duration and size
        if (recording.duration) {
          stats.total_duration += recording.duration;
        }
        if (recording.file_size) {
          stats.total_size += recording.file_size;
        }
      });

      // Calculate average duration
      const completedRecordings = recordings.filter(r => r.duration > 0);
      if (completedRecordings.length > 0) {
        stats.average_duration = Math.round(
          stats.total_duration / completedRecordings.length
        );
      }

      return stats;

    } catch (error) {
      console.error('❌ Error getting recording stats:', error);
      throw error;
    }
  }

  generateDownloadUrl(recording) {
    const relativePath = recording.file_path.replace(this.recordingsPath, '');
    return `${this.baseUrl}/download${relativePath}`;
  }

  generateStreamUrl(recording) {
    const relativePath = recording.file_path.replace(this.recordingsPath, '');
    return `${this.baseUrl}/stream${relativePath}`;
  }

  async ensureDirectoryExists(dirPath) {
    try {
      await fs.access(dirPath);
    } catch (error) {
      await fs.mkdir(dirPath, { recursive: true });
      console.log(`📁 Created directory: ${dirPath}`);
    }
  }

  async cleanupOldRecordings(orgId, retentionDays = 90) {
    try {
      console.log(`🧹 Cleaning up recordings older than ${retentionDays} days for org ${orgId}`);

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const oldRecordings = await CallRecording.findAll({
        where: {
          org_id: orgId,
          started_at: { [Op.lt]: cutoffDate }
        }
      });

      let deletedFiles = 0;
      let deletedRecords = 0;

      for (const recording of oldRecordings) {
        try {
          // Delete physical file
          if (recording.file_path) {
            await fs.unlink(recording.file_path);
            deletedFiles++;
          }

          // Delete database record
          await recording.destroy();
          deletedRecords++;

        } catch (error) {
          console.warn(`⚠️ Failed to delete recording ${recording.id}:`, error.message);
        }
      }

      console.log(`✅ Cleanup completed: ${deletedRecords} records, ${deletedFiles} files deleted`);
      return { deleted_records: deletedRecords, deleted_files: deletedFiles };

    } catch (error) {
      console.error('❌ Error cleaning up recordings:', error);
      throw error;
    }
  }

  // Batch operations
  async startBulkRecording(orgId, callIds, options = {}) {
    const results = [];

    for (const callId of callIds) {
      try {
        const result = await this.startRecording(null, callId, options);
        results.push({ callId, success: true, recording: result });
      } catch (error) {
        results.push({ callId, success: false, error: error.message });
      }
    }

    return results;
  }

  async exportRecordings(orgId, filters = {}, format = 'json') {
    try {
      const recordings = await this.listRecordings(orgId, filters);

      if (format === 'csv') {
        return this.exportToCSV(recordings);
      }

      return {
        export_date: new Date().toISOString(),
        organization_id: orgId,
        filters: filters,
        total_recordings: recordings.length,
        recordings: recordings
      };

    } catch (error) {
      console.error('❌ Error exporting recordings:', error);
      throw error;
    }
  }

  exportToCSV(recordings) {
    const headers = [
      'Recording ID', 'Call ID', 'Filename', 'Status', 'Format',
      'Duration', 'File Size', 'Started At', 'Ended At',
      'From Number', 'To Number', 'Direction'
    ];

    const rows = recordings.map(recording => [
      recording.id,
      recording.callRecord?.call_id || '',
      recording.filename,
      recording.status,
      recording.format,
      recording.duration || '',
      recording.file_size || '',
      recording.started_at,
      recording.ended_at || '',
      recording.callRecord?.from_number || '',
      recording.callRecord?.to_number || '',
      recording.callRecord?.direction || ''
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }
}

module.exports = CallRecordingService;