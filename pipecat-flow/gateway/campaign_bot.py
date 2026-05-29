import asyncio
import io
import os
import re
import time
from pathlib import Path
from loguru import logger
from pydub import AudioSegment

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import Frame, TranscriptionFrame, OutputAudioRawFrame, EndFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.services.elevenlabs.stt import ElevenLabsSTTService
from pipecat.transports.websocket.fastapi import FastAPIWebsocketTransport, FastAPIWebsocketParams
from pipecat.transcriptions.language import Language


async def load_audio_from_id(bot_id: str) -> tuple[OutputAudioRawFrame | None, float]:
    """Load MP3 intro audio from shared storage, decode to 8kHz mono PCM, and return the frame and duration."""
    if not bot_id:
        return None, 0.0

    try:
        file_path = Path("/app/data/campaign-bot-audio") / f"{bot_id}.mp3"
        if not file_path.exists():
            logger.warning(f"[CampaignBot] Intro audio not found at: {file_path}")
            return None, 0.0

        logger.info(f"[CampaignBot] Loading intro audio from shared storage: {file_path}")

        # Non-blocking file read
        def read_file():
            with open(file_path, "rb") as f:
                return f.read()

        audio_bytes = await asyncio.to_thread(read_file)
        audio_data = io.BytesIO(audio_bytes)

        # Decode using pydub and convert to mono, 8000Hz PCM
        def decode_audio():
            audio = AudioSegment.from_file(audio_data, format="mp3")
            audio = audio.set_channels(1).set_frame_rate(8000)
            return audio

        audio_segment = await asyncio.to_thread(decode_audio)
        duration_secs = len(audio_segment) / 1000.0

        frame = OutputAudioRawFrame(
            audio_segment.raw_data,
            audio_segment.frame_rate,
            audio_segment.channels
        )

        logger.info(f"[CampaignBot] Successfully loaded intro audio: {bot_id}.mp3 ({duration_secs:.2f}s)")
        return frame, duration_secs

    except Exception as e:
        logger.error(f"[CampaignBot] Failed to decode/load intro audio for bot {bot_id}: {e}")
        return None, 0.0


async def post_call_result(webhook_url: str, payload: dict):
    """POST call result payload to the verified Node callback endpoint with API key authorization."""
    if not webhook_url:
        logger.warning("[CampaignBot] No webhook URL provided, skipping callback")
        return

    # In docker environment, map localhost/127.0.0.1 to 'api' hostname
    modified_url = re.sub(r'https?://localhost:\d+', 'http://api:3000', webhook_url)
    modified_url = re.sub(r'https?://127\.0\.0\.1:\d+', 'http://api:3000', modified_url)

    # Sanitize payload for logging (mask sensitive UUIDs and long transcripts)
    log_payload = {
        **payload,
        "transcript": (payload.get("transcript") or "")[:100] + "..." if payload.get("transcript") else ""
    }
    logger.info(f"[CampaignBot] Sending callback to: {modified_url} | Payload: {log_payload}")

    try:
        import httpx
        internal_key = os.getenv("INTERNAL_API_KEY", "internal-dev-key")
        headers = {
            "Content-Type": "application/json",
            "X-Internal-Key": internal_key
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(modified_url, json=payload, headers=headers)
            logger.info(f"[CampaignBot] Callback status: {resp.status_code}")
    except Exception as e:
        logger.error(f"[CampaignBot] Failed to POST callback: {e}")


class CampaignBotFrameProcessor(FrameProcessor):
    """Main campaign bot pipeline logic for transcript collection, keyword matching, and webhook delivery."""

    def __init__(
        self,
        call_id: str,
        org_id: str,
        campaign_id: str,
        campaign_lead_id: str,
        keywords: list[str],
        audio_duration: float,
        webhook_url: str,
        call_status: dict,
        task: PipelineTask
    ):
        super().__init__()
        self.call_id = call_id
        self.org_id = org_id
        self.campaign_id = campaign_id
        self.campaign_lead_id = campaign_lead_id
        self.keywords = [k.lower().strip() for k in keywords if k.strip()]
        self.audio_duration = audio_duration
        self.webhook_url = webhook_url
        self.call_status = call_status
        self.task = task

        self.transcript_parts = []
        self.start_time = time.monotonic()
        self.ended = False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame):
            if self.ended:
                return

            text = frame.text.strip()
            # Clean events tags like (laughter), (music)
            clean_text = re.sub(r'\([^)]*\)', '', text).strip()
            if len(clean_text) < 2:
                return

            # Check if speaking occurs during intro audio playback (if any)
            elapsed = time.monotonic() - self.start_time
            if self.audio_duration > 0 and elapsed < self.audio_duration:
                logger.debug(f"[CampaignBot] Ignoring transcription during intro playback: '{clean_text}'")
                return

            # Save to transcript
            self.transcript_parts.append(clean_text)
            logger.info(f"[CampaignBot] Received transcript: '{clean_text}'")

            # Node-like case-insensitive substring matching on punctuation-stripped transcript
            clean_text_lower = clean_text.lower()
            text_lower_stripped = re.sub(r'[^\w\s]', '', clean_text_lower)

            detected_word = next((kw for kw in self.keywords if kw in text_lower_stripped), None)
            if detected_word:
                logger.info(f"[CampaignBot] Keyword matched: '{detected_word}' | Ending call session.")
                self.ended = True
                
                # Mark as matched and trigger callback
                if not self.call_status.get("webhook_sent"):
                    self.call_status["webhook_sent"] = True
                    duration = int(time.monotonic() - self.start_time)
                    payload = {
                        "org_id": self.org_id,
                        "campaign_id": self.campaign_id,
                        "campaign_lead_id": self.campaign_lead_id,
                        "call_id": self.call_id,
                        "transcript": " ".join(self.transcript_parts),
                        "duration_seconds": duration,
                        "status": "completed",
                        "detected_keyword": detected_word
                    }
                    asyncio.create_task(post_call_result(self.webhook_url, payload))

                await self.task.queue_frame(EndFrame())


async def run_campaign_bot(
    websocket,
    bot_id: str,
    org_id: str,
    campaign_id: str,
    campaign_lead_id: str,
    call_id: str,
    keywords: list[str],
    language_code: str,
    call_timeout: int,
    webhook_url: str,
    serializer
):
    """Construct and execute the Pipecat voice bot pipeline."""
    intro_frame, audio_duration = await load_audio_from_id(bot_id)

    # Combined timeout duration
    listening_window = call_timeout or 8
    total_timeout = audio_duration + listening_window
    logger.info(f"[CampaignBot] Session timeouts: intro={audio_duration:.1f}s | listening={listening_window}s | total={total_timeout:.1f}s")

    call_status = {"webhook_sent": False}
    end_call_task = None

    # Setup transport
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_out_enabled=True,
            audio_in_enabled=True,
            add_wav_header=False,
            vad_analyzer=SileroVADAnalyzer(),
            serializer=serializer,
        ),
    )

    try:
        stt_language = Language(language_code)
    except ValueError:
        logger.warning(f"[CampaignBot] Invalid language '{language_code}', defaulting to English")
        stt_language = Language.EN

    # Resolve dynamic ElevenLabs key: check custom org env key first, then global
    env_org_key = f"ELEVENLABS_API_KEY_{org_id.replace('-', '_').upper()}"
    api_key = os.getenv(env_org_key) or os.getenv("ELEVENLABS_API_KEY")

    if not api_key:
        logger.error("[CampaignBot] ELEVENLABS_API_KEY not configured. Transcription will fail.")
        return

    # Setup ElevenLabs STT
    import aiohttp
    async with aiohttp.ClientSession() as session:
        stt = ElevenLabsSTTService(
            api_key=api_key,
            aiohttp_session=session,
            params=ElevenLabsSTTService.InputParams(
                language=stt_language,
                tag_audio_events=True
            )
        )

        pipeline = Pipeline([
            transport.input(),
            stt,
            None, # Will inject the frame processor after creating task
            transport.output(),
        ])

        task = PipelineTask(
            pipeline,
            params=PipelineParams(
                allow_interruptions=False,
                enable_usage_metrics=False,
                audio_in_sample_rate=8000,
                audio_out_sample_rate=8000
            ),
        )

        # Create and inject custom frame processor
        processor = CampaignBotFrameProcessor(
            call_id=call_id,
            org_id=org_id,
            campaign_id=campaign_id,
            campaign_lead_id=campaign_lead_id,
            keywords=keywords,
            audio_duration=audio_duration,
            webhook_url=webhook_url,
            call_status=call_status,
            task=task
        )
        # Pipeline expects index 2 for the processor slot
        pipeline.processors[2] = processor

        @transport.event_handler("on_client_connected")
        async def on_connected(transport, client):
            logger.info(f"[CampaignBot] Voice call answered: {call_id}")
            if intro_frame:
                processor.start_time = time.monotonic()
                await task.queue_frame(intro_frame)

            async def handle_timeout():
                await asyncio.sleep(total_timeout)
                logger.info(f"[CampaignBot] Call timeout reached after {total_timeout:.1f}s")
                
                if not call_status["webhook_sent"]:
                    call_status["webhook_sent"] = True
                    duration = int(time.monotonic() - processor.start_time)
                    payload = {
                        "org_id": org_id,
                        "campaign_id": campaign_id,
                        "campaign_lead_id": campaign_lead_id,
                        "call_id": call_id,
                        "transcript": " ".join(processor.transcript_parts),
                        "duration_seconds": duration,
                        "status": "timeout",
                        "detected_keyword": None
                    }
                    await post_call_result(webhook_url, payload)

                await task.queue_frame(EndFrame())

            nonlocal end_call_task
            end_call_task = asyncio.create_task(handle_timeout())

        @transport.event_handler("on_client_disconnected")
        async def on_disconnected(transport, client):
            logger.info(f"[CampaignBot] Caller hung up: {call_id}")
            if end_call_task and not end_call_task.done():
                end_call_task.cancel()

            if not call_status["webhook_sent"]:
                call_status["webhook_sent"] = True
                duration = int(time.monotonic() - processor.start_time)
                payload = {
                    "org_id": org_id,
                    "campaign_id": campaign_id,
                    "campaign_lead_id": campaign_lead_id,
                    "call_id": call_id,
                    "transcript": " ".join(processor.transcript_parts),
                    "duration_seconds": duration,
                    "status": "hangup",
                    "detected_keyword": None
                }
                await post_call_result(webhook_url, payload)

            await task.cancel()

        runner = PipelineRunner(handle_sigint=False)
        await runner.run(task)
