# Guide to Run - Hotel Concierge Bot

## Prerequisites

- Python 3.10+
- [uv](https://docs.astral.sh/uv/) package manager
- A Google API key (for Gemini Live LLM)

## Setup

### 1. Install dependencies

```bash
uv sync --group dev
```

### 2. Configure environment variables

Create a `.env` file in the project root (or update the existing one):

```env
GOOGLE_API_KEY=your_google_api_key_here
```

## Running Locally

```bash
uv run python hotel_concierge.py -t webrtc
```

This starts a local FastAPI server on `http://localhost:7860` with a built-in WebRTC client UI.

Open your browser to:

```
http://localhost:7860
```

It auto-redirects to `/client/` where you can interact with the concierge bot using your microphone.

## How It Works

The bot is a luxury hotel concierge for "The Grand Astral" powered by Gemini Live (native voice — no separate STT/TTS needed).

### Conversation Flows

- **Check-in** — Collects guest name, confirmation number, guest count, and special requests
- **Check-out** — Collects room number, stay feedback, additional charges, and transport needs
- **Helpdesk** — Handles general enquiries about hotel amenities or raises issues/complaints

### Available CLI Options

| Flag | Description |
|------|-------------|
| `-t webrtc` | Use local WebRTC transport (no Daily API key needed) |
| `-t daily` | Use Daily transport (requires `DAILY_API_KEY` in `.env`) |
| `--host` | Server host address (default: `localhost`) |
| `--port` | Server port (default: `7860`) |
| `-v` | Increase logging verbosity |
