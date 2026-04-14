# Hotel Concierge Bot - Guide to Run

## Overview

The Hotel Concierge bot ("The Grand Astral") uses **Gemini Live** (native voice) across all transports. No separate STT or TTS services needed -- Gemini Live handles speech recognition and voice synthesis natively.

| Mode | Transport | LLM | Use Case |
|------|-----------|-----|----------|
| **WebRTC** | `-t webrtc` | Gemini Live | Browser / mobile clients |
| **WebSocket** | `-t twilio` | Gemini Live | AstraPBX / Asterisk telephony |

Both modes use the same Gemini Live pipeline. The transport layer handles audio format conversion automatically:
- **WebRTC**: Raw audio streams directly to/from Gemini Live
- **WebSocket**: Twilio serializer converts `ulaw 8kHz <-> PCM` transparently

## Prerequisites

- Python 3.10+
- [uv](https://docs.astral.sh/uv/) package manager
- Google API key (Gemini Live)

## 1. Install Dependencies

```bash
cd /path/to/pipecat-flow
uv sync --group dev
```

## 2. Configure Environment

Create/update `.env` in the project root:

```env
GOOGLE_API_KEY=your_google_api_key
```

That's it. No Deepgram or Cartesia keys needed.

---

## Running Locally

### Option A: WebRTC Mode (Browser / AstraVoiceTest)

```bash
uv run python hotel_concierge.py -t webrtc
```

- Server starts at `http://localhost:7860`
- Built-in client UI at `http://localhost:7860/client/`
- Or connect AstraVoiceTest to `http://localhost:7860`

**Endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /start` | HTTP | Create session, get ICE config |
| `POST /sessions/{id}/api/offer` | HTTP | WebRTC SDP offer/answer |
| `PATCH /sessions/{id}/api/offer` | HTTP | ICE candidate exchange |
| `/client/` | HTTP | Built-in browser UI |

### Option B: WebSocket Mode (AstraPBX / Asterisk)

```bash
uv run python hotel_concierge.py -t twilio
```

- Server starts at `http://localhost:7860`
- WebSocket endpoint at `ws://localhost:7860/ws`
- Speaks Twilio-compatible protocol (connected, start, media, stop events)
- Works with AstraPBX (auto-detected as Twilio-compatible, `auto_hang_up=False`)

**Connecting from AstraPBX:**

Set the WSS URL in AstraPBX to point to this server:
```
ws://your-server-ip:7860/ws
```

Or via the AstraPBX API:
```bash
curl -X POST http://your-pbx/calls/originate-to-ai \
  -H "Content-Type: application/json" \
  -d '{
    "to": "12025551234",
    "caller_id": "5555551111",
    "ai_agent_app": "ai_agent",
    "wss_url": "ws://your-pipecat-server:7860/ws"
  }'
```

Or configure a user/DID in AstraPBX with:
- `routing_type: "ai_agent"`
- `routing_destination: "ws://your-pipecat-server:7860/ws"`

### CLI Options

| Flag | Description | Default |
|------|-------------|---------|
| `-t webrtc` | WebRTC transport | - |
| `-t twilio` | WebSocket transport (Twilio protocol) | - |
| `--host` | Server bind address | `localhost` |
| `--port` | Server port | `7860` |
| `-v` | Verbose logging | off |

---

## How It Works (Audio Pipeline)

```
┌──────────────────────────────────────────────────────────────────┐
│                       Pipecat Server                             │
│                                                                  │
│  WebRTC path:                                                    │
│    Browser audio ──► SmallWebRTCTransport ──┐                    │
│                                             │                    │
│  WebSocket path:                            ├──► Gemini Live ──► │ ──► Audio Out
│    Asterisk (ulaw 8kHz)                     │   (native voice)   │
│      ──► TwilioSerializer (ulaw->PCM) ──────┘                   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

The `TwilioFrameSerializer` handles all audio conversion:
- **Inbound**: base64 ulaw 8kHz -> PCM at pipeline sample rate (via `ulaw_to_pcm`)
- **Outbound**: PCM from Gemini Live -> ulaw 8kHz -> base64 JSON (via `pcm_to_ulaw`)

Gemini Live receives PCM audio frames regardless of transport. It doesn't know or care whether the audio came from a browser or a phone call.

---

## Custom Serializers

If you need to support a non-Twilio provider (e.g., Tata Smartflo, Exotel), you can create a custom serializer. See `/Users/hari/StudioProjects/Taknetics Codebase/AstraDial/serializers/` for examples:

```python
from pipecat.serializers.twilio import TwilioFrameSerializer

class SmartfloFrameSerializer(TwilioFrameSerializer):
    """Override media message format for Smartflo (adds chunk field)."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._chunk = 0

    def _build_media_message(self, b64_payload: str) -> str:
        self._chunk += 1
        return json.dumps({
            "event": "media",
            "streamSid": self.stream_sid,
            "media": {"payload": b64_payload, "chunk": self._chunk}
        })
```

For provider auto-detection, see `serializers/provider.py` in the AstraDial project.

---

## VPS Deployment

### Server Setup

```bash
# 1. Install Python 3.10+ and uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. Clone the project
git clone <your-repo-url> /opt/pipecat-flow
cd /opt/pipecat-flow

# 3. Install dependencies
uv sync --group dev

# 4. Create .env
echo "GOOGLE_API_KEY=your_key" > .env

# 5. Run (bind to all interfaces)
uv run python hotel_concierge.py -t twilio --host 0.0.0.0 --port 7860
```

### Nginx Reverse Proxy (recommended for production)

```nginx
server {
    listen 443 ssl;
    server_name voice.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/voice.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/voice.yourdomain.com/privkey.pem;

    # WebSocket endpoint (for AstraPBX / telephony)
    location /ws {
        proxy_pass http://127.0.0.1:7860/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }

    # WebRTC signaling endpoints (for browser/mobile)
    location /start {
        proxy_pass http://127.0.0.1:7860/start;
        proxy_set_header Host $host;
    }

    location /sessions/ {
        proxy_pass http://127.0.0.1:7860/sessions/;
        proxy_set_header Host $host;
    }

    location /api/offer {
        proxy_pass http://127.0.0.1:7860/api/offer;
        proxy_set_header Host $host;
    }

    # Built-in client UI
    location /client/ {
        proxy_pass http://127.0.0.1:7860/client/;
        proxy_set_header Host $host;
    }

    location / {
        proxy_pass http://127.0.0.1:7860/;
        proxy_set_header Host $host;
    }
}
```

### Systemd Service

```ini
# /etc/systemd/system/pipecat-concierge.service
[Unit]
Description=Pipecat Hotel Concierge Bot
After=network.target

[Service]
Type=simple
User=pipecat
WorkingDirectory=/opt/pipecat-flow
ExecStart=/home/pipecat/.local/bin/uv run python hotel_concierge.py -t twilio --host 0.0.0.0 --port 7860
Restart=always
RestartSec=5
EnvironmentFile=/opt/pipecat-flow/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable pipecat-concierge
sudo systemctl start pipecat-concierge
sudo journalctl -u pipecat-concierge -f  # view logs
```

### Connecting AstraPBX on VPS

Once deployed, update AstraPBX to point to the pipecat server:

```
# With nginx + SSL
wss://voice.yourdomain.com/ws

# Direct (no SSL)
ws://your-vps-ip:7860/ws
```

Set this as the `routing_destination` for any user or DID in AstraPBX.

---

## Conversation Flow

The bot handles three main paths:

- **Check-in** -- Collects guest name, confirmation number, guest count, special requests
- **Check-out** -- Collects room number, stay feedback, additional charges, transport needs
- **Helpdesk** -- General enquiries about hotel amenities, or raise issues/complaints

Each path ends with a confirmation node that offers further help or a graceful farewell.
