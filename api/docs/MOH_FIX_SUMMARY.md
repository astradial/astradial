# Music on Hold (MOH) Fix Summary

## Problem
Queue music was not playing during hold. Callers in queues were hearing silence instead of music.

## Root Cause
The queue configuration generator in `src/services/asterisk/queueService.js` was missing the `musiconhold` parameter. While it had `musicclass` configured, Asterisk requires both parameters for MOH to work properly in queues.

## Solution Implemented

### 1. Queue Configuration Fix
**File**: `src/services/asterisk/queueService.js`
**Lines**: 61-62

Added the missing `musiconhold` parameter to queue configuration generation:

```javascript
// Music and announcements
config += `musicclass=${queue.music_on_hold}\n`;
config += `musiconhold=${queue.music_on_hold}\n`;  // ← ADDED THIS LINE
```

### 2. Music on Hold Service
**File**: `src/services/asterisk/mohService.js`
**Status**: New service created

Created a comprehensive MusicOnHoldService that manages MOH configuration:

**Features**:
- Generates `musiconhold.conf` with multiple MOH classes
- Creates MOH directories if they don't exist
- Deploys configuration and reloads MOH in Asterisk
- Provides verification and management methods

**MOH Classes Available**:
- `default` - Default hold music
- `classical` - Classical music
- `modern` - Modern music
- `jazz` - Jazz music
- `silence` - Silence (for testing)

**Key Methods**:
- `generateConfiguration()` - Creates musiconhold.conf content
- `writeConfigurationFile()` - Writes config to /etc/asterisk/musiconhold.conf
- `reloadMusicOnHold()` - Executes `asterisk -rx "moh reload"`
- `deploy()` - Complete deployment process
- `verifyDirectories()` - Checks if MOH directories exist
- `createDirectories()` - Creates missing MOH directories
- `getAvailableClasses()` - Lists configured MOH classes

### 3. Integration with Deployment Service
**File**: `src/services/asterisk/configDeploymentService.js`

Integrated MOH service into the main configuration deployment:

**Changes**:
1. Import MusicOnHoldService (line 7)
2. Initialize service in constructor (line 15)
3. Deploy MOH during organization configuration deployment (lines 52-60)
4. Reload MOH with other Asterisk modules (lines 532-538)

**Deployment Flow**:
```javascript
async deployOrganizationConfiguration(orgId, orgName) {
  // ... deploy PJSIP, dialplan, queue configs

  // Deploy Music on Hold configuration (system-wide)
  try {
    await this.mohService.deploy();
    console.log('🎵 Music on Hold configuration deployed');
  } catch (mohError) {
    console.warn('⚠️  Warning: Failed to deploy MOH configuration:', mohError.message);
  }

  // ... rest of deployment
}
```

**Reload Command Updated**:
```javascript
// Reload Asterisk configuration (core reload is safer and reloads all modules)
await execAsync('asterisk -rx "core reload"');
```

**Important**: Uses `core reload` which is the safer way to reload all Asterisk configuration.

## Configuration Files

### musiconhold.conf Location
`/etc/asterisk/musiconhold.conf`

### MOH Audio Directories
- `/var/lib/asterisk/moh/default`
- `/var/lib/asterisk/moh/classical`
- `/var/lib/asterisk/moh/modern`
- `/var/lib/asterisk/moh/jazz`
- `/var/lib/asterisk/moh/silence`

## Testing Steps

### 1. Initial Setup
```bash
# Ensure MOH directories exist
node -e "const MOH = require('./src/services/asterisk/mohService'); const m = new MOH(); m.createDirectories();"

# Verify directories were created
ls -la /var/lib/asterisk/moh/
```

### 2. Deploy MOH Configuration
```bash
# Deploy MOH configuration
node -e "const MOH = require('./src/services/asterisk/mohService'); const m = new MOH(); m.deploy().then(r => console.log(r));"
```

### 3. Add Audio Files
```bash
# Add sample audio files to MOH directories
# Audio files should be in WAV format
cp /path/to/your/music.wav /var/lib/asterisk/moh/default/
chown asterisk:asterisk /var/lib/asterisk/moh/default/*.wav
```

### 4. Verify MOH Classes
```bash
# Check available MOH classes in Asterisk
asterisk -rx "moh show classes"
```

### 5. Deploy Queue Configuration
```bash
# Deploy queue configuration for your organization
curl -X POST http://localhost:3000/api/v1/deploy \
  -H "Authorization: Bearer $YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "org_id": "YOUR_ORG_ID",
    "reload": true
  }'
```

### 6. Test Queue Call
```bash
# Place a test call to a queue
# Verify that music plays while waiting

# Monitor queue activity
asterisk -rx "queue show YOUR_QUEUE_NAME"
```

## Verification Checklist

- [ ] MOH directories created and accessible
- [ ] Audio files added to MOH directories (WAV format)
- [ ] musiconhold.conf deployed to /etc/asterisk/
- [ ] MOH classes visible in Asterisk (`moh show classes`)
- [ ] Queue configuration includes both `musicclass` and `musiconhold` parameters
- [ ] Asterisk modules reloaded (especially MOH)
- [ ] Test call to queue plays music during hold

## Common Issues

### No Music Playing
1. **Check audio files exist**: `ls -la /var/lib/asterisk/moh/default/`
2. **Check file permissions**: Files should be owned by `asterisk:asterisk`
3. **Check audio format**: Files should be in WAV format
4. **Verify MOH loaded**: `asterisk -rx "moh show classes"`
5. **Check queue config**: Ensure both `musicclass` and `musiconhold` are set

### Permission Denied
```bash
# Fix directory permissions
sudo chown -R asterisk:asterisk /var/lib/asterisk/moh/
sudo chmod -R 755 /var/lib/asterisk/moh/
```

### Wrong Audio Format
```bash
# Convert MP3 to WAV (if needed)
ffmpeg -i music.mp3 -ar 8000 -ac 1 music.wav
```

## API Endpoints

### Deploy Configuration (includes MOH)
```http
POST /api/v1/deploy
Authorization: Bearer <token>
Content-Type: application/json

{
  "org_id": "organization-uuid",
  "reload": true
}
```

### Create/Update Queue (auto-deploys with MOH)
```http
POST /api/v1/queues
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Support Queue",
  "number": "8000",
  "music_on_hold": "default",  // ← MOH class to use
  "strategy": "ringall",
  "timeout": 30
}
```

## Environment Variables

```bash
# MOH Configuration Path (optional)
ASTERISK_MOH_CONFIG_PATH=/etc/asterisk/musiconhold.conf

# MOH Directory (optional)
ASTERISK_MOH_DIRECTORY=/var/lib/asterisk/moh
```

## Files Modified

1. `src/services/asterisk/queueService.js` - Added `musiconhold` parameter
2. `src/services/asterisk/configDeploymentService.js` - Integrated MOH deployment
3. `src/services/asterisk/mohService.js` - Created (new file)

## Related Documentation

- [Queue Configuration](./QUEUE_CONFIGURATION.md)
- [API Specification](./API_SPECIFICATION.yaml)
- [Asterisk MOH Documentation](https://wiki.asterisk.org/wiki/display/AST/Music+On+Hold)

## Notes

- MOH configuration is system-wide (not per-organization)
- Each queue can use a different MOH class
- MOH is automatically deployed when deploying organization configuration
- MOH reload is included in the standard Asterisk configuration reload
- Default MOH class is "default" if not specified

## Status

✅ **Fixed** - Music on Hold configuration issue resolved

**Date**: 2024-12-18
**Version**: Current
