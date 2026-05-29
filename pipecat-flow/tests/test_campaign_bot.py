import pytest
import json
import asyncio
import time
import re
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock, AsyncMock
from gateway.main import app

def test_health():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_campaign_bot_route_registered():
    routes = [r.path for r in app.routes if hasattr(r, "path")]
    assert "/campaign-bot/{bot_id}" in routes


def test_keyword_match_parity():
    # Node case-insensitive substring matching parity tests
    keywords = ["yes", "buy now", "interested"]
    
    def check_match(text, kws):
        text_lower = text.lower()
        text_stripped = re.sub(r'[^\w\s]', '', text_lower)
        return next((kw for kw in kws if kw in text_stripped), None)

    # Keyword "yes", transcript "yes" => match
    assert check_match("yes", keywords) == "yes"
    assert check_match("YES", keywords) == "yes"
    
    # Keyword "buy now", transcript "I want to buy now" => match
    assert check_match("I want to buy now", keywords) == "buy now"
    
    # Keyword "interested", transcript "disinterested" => match
    # Note: Clearly labeled existing false-positive risk of substring matching.
    assert check_match("disinterested", keywords) == "interested"
    
    # No matching keyword => None
    assert check_match("no way", keywords) is None


@pytest.mark.asyncio
async def test_astrapbx_serializer_pcm_compatibility():
    from gateway.astrapbx_serializer import AstraPBXSerializer
    from pipecat.frames.frames import InputAudioRawFrame, AudioRawFrame, StartFrame
    
    serializer = AstraPBXSerializer()
    # Call setup to initialize sample rate
    await serializer.setup(StartFrame(audio_in_sample_rate=8000, audio_out_sample_rate=8000))
    
    # Test deserialize: 320 bytes of silence (8kHz 16-bit mono = 20ms)
    raw_pcm = b"\x00" * 320
    frame = await serializer.deserialize(raw_pcm)
    assert isinstance(frame, InputAudioRawFrame)
    assert frame.audio == raw_pcm
    assert frame.num_channels == 1
    assert frame.sample_rate == 8000
    
    # Test serialize
    output_frame = AudioRawFrame(audio=raw_pcm, sample_rate=8000, num_channels=1)
    serialized_bytes = await serializer.serialize(output_frame)
    assert serialized_bytes == raw_pcm


def test_campaign_bot_endpoint_missing_bot():
    with patch("gateway.router_ws.fetchone", return_value=None):
        client = TestClient(app)
        with pytest.raises(Exception):
            with client.websocket_connect("/campaign-bot/missing-bot-uuid") as websocket:
                pass


def test_campaign_bot_endpoint_start_and_custom_vars():
    # Verify that ariClient.js start message and customVariables are processed correctly
    with patch("gateway.router_ws.fetchone") as mock_fetch, \
         patch("gateway.campaign_bot.run_campaign_bot") as mock_run:
         
        mock_fetch.return_value = {
            "id": "test-bot-uuid",
            "org_id": "test-org-id",
            "name": "Test Bot",
            "language": "en",
            "call_timeout": 8,
            "keywords": '["yes"]',
            "intro_audio_path": "",
            "webhook_url": "http://localhost:3000/api/v1/webhooks/campaigns/call-result"
        }
        
        client = TestClient(app)
        with client.websocket_connect("/campaign-bot/test-bot-uuid") as websocket:
            # Send connected event
            websocket.send_text('{"event": "connected", "protocol": "Call", "version": "1.0.0"}')
            # Send start event mirroring ariClient.js output
            start_msg = {
                "event": "start",
                "start": {
                    "streamSid": "test-stream",
                    "callSid": "test-call-id",
                    "customParameters": {
                        "org_id": "test-org-id",
                        "CAMPAIGN_ID": "test-campaign-id",
                        "CAMPAIGN_LEAD_ID": "test-lead-id",
                        "INTEREST_KEYWORDS": '["yes", "buy now"]'
                    }
                }
            }
            websocket.send_text(json.dumps(start_msg))
            
        mock_run.assert_called_once()
        kwargs = mock_run.call_args.kwargs
        assert kwargs["bot_id"] == "test-bot-uuid"
        assert kwargs["org_id"] == "test-org-id"
        assert kwargs["campaign_id"] == "test-campaign-id"
        assert kwargs["campaign_lead_id"] == "test-lead-id"
        assert kwargs["call_id"] == "test-call-id"
        assert kwargs["keywords"] == ["yes", "buy now"]


@pytest.mark.asyncio
async def test_campaign_bot_frame_processor_keyword_match():
    # Test keyword match triggers callback with completed status
    from gateway.campaign_bot import CampaignBotFrameProcessor
    from pipecat.frames.frames import TranscriptionFrame
    
    call_status = {"webhook_sent": False}
    task = MagicMock()
    task.queue_frame = AsyncMock() # Fix mock type error
    
    processor = CampaignBotFrameProcessor(
        call_id="call-123",
        org_id="org-123",
        campaign_id="cam-123",
        campaign_lead_id="lead-123",
        keywords=["yes"],
        audio_duration=0.0,
        webhook_url="http://api:3000/api/v1/webhooks/campaigns/call-result",
        call_status=call_status,
        task=task
    )
    
    with patch("gateway.campaign_bot.post_call_result", new_callable=AsyncMock) as mock_post:
        await processor.process_frame(TranscriptionFrame(text="yes indeed", user_id="user", timestamp=time.time()), None)
        assert processor.ended is True
        assert call_status["webhook_sent"] is True
        mock_post.assert_called_once()
        payload = mock_post.call_args[0][1]
        assert payload["status"] == "completed"
        assert payload["detected_keyword"] == "yes"


@pytest.mark.asyncio
async def test_campaign_bot_missing_elevenlabs_key():
    from gateway.campaign_bot import run_campaign_bot
    from gateway.astrapbx_serializer import AstraPBXSerializer
    websocket = AsyncMock()
    serializer = AstraPBXSerializer()
    
    # Force unset ElevenLabs API key
    with patch.dict("os.environ", {}, clear=True), \
         patch("loguru.logger.error") as mock_logger:
        await run_campaign_bot(
            websocket=websocket,
            bot_id="bot-123",
            org_id="org-123",
            campaign_id="cam-123",
            campaign_lead_id="lead-123",
            call_id="call-123",
            keywords=[],
            language_code="en",
            call_timeout=8,
            webhook_url="http://api:3000/callback",
            serializer=serializer
        )
        mock_logger.assert_any_call("[CampaignBot] ELEVENLABS_API_KEY not configured. Transcription will fail.")


@pytest.mark.asyncio
async def test_campaign_bot_missing_intro_audio_fallback():
    # Missing intro audio should fallback to None and continue gracefully
    from gateway.campaign_bot import load_audio_from_id
    frame, duration = await load_audio_from_id("missing-bot-id")
    assert frame is None
    assert duration == 0.0
