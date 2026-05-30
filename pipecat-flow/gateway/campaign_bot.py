import asyncio
import io
import os
import re
import time
import aiohttp
from pathlib import Path
from loguru import logger
from pydub import AudioSegment
import httpx

from datetime import datetime, timezone
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import Frame, TranscriptionFrame, OutputAudioRawFrame, EndFrame, InputAudioRawFrame, StartFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
import json
import wave
from pipecat.frames.frames import StartFrame
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
        asterisk_channel_id: str,
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
        self.asterisk_channel_id = asterisk_channel_id
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
                logger.info(f"[CampaignBot] Keyword matched: '{detected_word}' | Sending callback then ending call in 3s.")
                # Stop STT from processing any further audio immediately
                self.ended = True
                self.call_status["matched"] = True   # stops BufferedSTT
                self.call_status["ended"] = True

                # Send callback exactly once
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

                # Wait 3 seconds so the caller hears any pending TTS, then disconnect
                asyncio.create_task(self._end_after_keyword_delay())

    async def _end_after_keyword_delay(self):
        """Wait 3 seconds after keyword match, then end the pipeline session."""
        await asyncio.sleep(3)
        # Perform hard hangup via API before ending the pipeline
        try:
            await self._hard_hangup()
        except Exception as e:
            logger.error(f"[CampaignBot] Hard hangup failed: {e}")
        if self.task:
            logger.info("[CampaignBot] 3s post-keyword delay elapsed, queuing EndFrame.")
            await self.task.queue_frame(EndFrame())

    async def _hard_hangup(self):
        """Call the internal API to hang up the Asterisk channel."""
        channel_id = self.asterisk_channel_id
        if not channel_id:
            logger.warning("[CampaignBot] Hard hangup skipped: no asterisk_channel_id set")
            return
        hangup_url = "http://api:3000/api/v1/calls/hangup"
        headers = {
            "Content-Type": "application/json",
            "X-Internal-Key": os.getenv("INTERNAL_API_KEY", "internal-dev-key")
        }
        payload = {"channel_id": channel_id}
        logger.info(f"[CampaignBot] Hard hangup requested channel_id={channel_id}")
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(hangup_url, json=payload, headers=headers)
                if resp.status_code in (200, 204):
                    logger.info(f"[CampaignBot] Hard hangup success channel_id={channel_id}")
                else:
                    logger.warning(f"[CampaignBot] Hard hangup failed status={resp.status_code} body={resp.text[:300]}")
        except Exception as e:
            logger.error(f"[CampaignBot] Hard hangup exception channel_id={channel_id}: {e}")

class AudioProbeProcessor(FrameProcessor):
    def __init__(self):
        super().__init__()
        self.count = 0

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, InputAudioRawFrame):
            self.count += 1

            if self.count <= 10 or self.count % 100 == 0:
                import struct

                samples = struct.unpack(f"<{len(frame.audio) // 2}h", frame.audio)

                if samples:
                    peak = max(abs(s) for s in samples)
                    avg = sum(abs(s) for s in samples) // len(samples)
                else:
                    peak = 0
                    avg = 0

                logger.info(
                    f"[AudioProbe] frame #{self.count}: bytes={len(frame.audio)} "
                    f"sample_rate={frame.sample_rate} peak={peak} avg={avg}"
                )

        await self.push_frame(frame, direction)

class BufferedElevenLabsSTTProcessor(FrameProcessor):
    """Collects short PCM chunks, sends WAV to ElevenLabs STT, and emits TranscriptionFrame."""

    def __init__(
        self,
        api_key: str,
        aiohttp_session,
        language_code: str = "en",
        sample_rate: int = 8000,
        chunk_seconds: float = 4.0,
        min_avg_level: int = 80,
        call_status: dict | None = None
    ):
        super().__init__()
        self.api_key = api_key
        self.session = aiohttp_session
        self.language_code = language_code
        self.sample_rate = sample_rate
        self.chunk_seconds = chunk_seconds
        self.min_avg_level = min_avg_level
        self.call_status = call_status or {}
        self.buffer = bytearray()
        self.chunk_bytes = int(sample_rate * 2 * chunk_seconds)  # 16-bit mono PCM
        self.processing = False
        self.chunk_index = 0

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if self.call_status.get("webhook_sent") or self.call_status.get("ended") or self.call_status.get("matched"):
            return

        if isinstance(frame, InputAudioRawFrame):
            self.buffer.extend(frame.audio)

            if len(self.buffer) >= self.chunk_bytes and not self.processing:
                audio_chunk = bytes(self.buffer[:self.chunk_bytes])
                self.buffer = self.buffer[self.chunk_bytes:]
                self.chunk_index += 1
                asyncio.create_task(self._transcribe_chunk(audio_chunk, self.chunk_index))

            return

        await self.push_frame(frame, direction)

    async def _transcribe_chunk(self, pcm_audio: bytes, chunk_index: int):
        if self.call_status.get("webhook_sent") or self.call_status.get("ended") or self.call_status.get("matched"):
            return
            
        self.processing = True
        try:
            avg_level = self._avg_level(pcm_audio)
            peak_level = self._peak_level(pcm_audio)

            logger.info(
                f"[BufferedSTT] chunk #{chunk_index}: bytes={len(pcm_audio)} "
                f"avg={avg_level} peak={peak_level}"
            )

            if avg_level < self.min_avg_level and peak_level < 1000:
                logger.info(f"[BufferedSTT] chunk #{chunk_index}: skipped low audio level")
                return

            wav_bytes = self._pcm_to_wav(pcm_audio)

            url = "https://api.elevenlabs.io/v1/speech-to-text"
            headers = {
                "xi-api-key": self.api_key,
            }

            data = aiohttp.FormData()
            data.add_field(
                "file",
                wav_bytes,
                filename=f"chunk-{chunk_index}.wav",
                content_type="audio/wav",
            )
            data.add_field("model_id", "scribe_v1")
            data.add_field("language_code", self.language_code)

            logger.info(f"[BufferedSTT] chunk #{chunk_index}: sending to ElevenLabs")

            async with self.session.post(url, headers=headers, data=data, timeout=20) as resp:
                response_text = await resp.text()

                if resp.status >= 400:
                    logger.error(
                        f"[BufferedSTT] chunk #{chunk_index}: ElevenLabs error "
                        f"status={resp.status} body={response_text[:300]}"
                    )
                    return

                try:
                    result = json.loads(response_text)
                except Exception:
                    logger.error(
                        f"[BufferedSTT] chunk #{chunk_index}: invalid JSON response "
                        f"{response_text[:300]}"
                    )
                    return

                transcript = (
                    result.get("text")
                    or result.get("transcript")
                    or ""
                ).strip()

                logger.info(f"[BufferedSTT] chunk #{chunk_index}: transcript='{transcript}'")

                if transcript:
                    if self.call_status.get("webhook_sent") or self.call_status.get("ended") or self.call_status.get("matched"):
                        return
                    await self.push_frame(
                        TranscriptionFrame(
                            text=transcript,
                            user_id="caller",
                            timestamp=datetime.now(timezone.utc).isoformat(),
                        )
                    )

        except Exception as e:
            logger.error(f"[BufferedSTT] chunk #{chunk_index}: failed: {e}")
        finally:
            self.processing = False

    def _pcm_to_wav(self, pcm_audio: bytes) -> bytes:
        wav_io = io.BytesIO()
        with wave.open(wav_io, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(self.sample_rate)
            wav_file.writeframes(pcm_audio)
        return wav_io.getvalue()

    def _avg_level(self, pcm_audio: bytes) -> int:
        import struct
        if len(pcm_audio) < 2:
            return 0
        samples = struct.unpack(f"<{len(pcm_audio) // 2}h", pcm_audio[: len(pcm_audio) - (len(pcm_audio) % 2)])
        if not samples:
            return 0
        return sum(abs(s) for s in samples) // len(samples)

    def _peak_level(self, pcm_audio: bytes) -> int:
        import struct
        if len(pcm_audio) < 2:
            return 0
        samples = struct.unpack(f"<{len(pcm_audio) // 2}h", pcm_audio[: len(pcm_audio) - (len(pcm_audio) % 2)])
        if not samples:
            return 0
        return max(abs(s) for s in samples)

async def run_campaign_bot(
    websocket,
    bot_id: str,
    org_id: str,
    campaign_id: str,
    campaign_lead_id: str,
    call_id: str,
    asterisk_channel_id: str,
    keywords: list[str],
    language_code: str,
    call_timeout: int,
    webhook_url: str,
    serializer
):
    """Construct and execute the Pipecat voice bot pipeline."""
    intro_frame, audio_duration = await load_audio_from_id(bot_id)

    # Combined timeout duration
    listening_window = call_timeout or 20
    total_timeout = audio_duration + listening_window
    logger.info(f"[CampaignBot] Session timeouts: intro={audio_duration:.1f}s | listening={listening_window}s | total={total_timeout:.1f}s")
    logger.info(f"[CampaignBot] Asterisk channel_id={asterisk_channel_id!r}")

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
    async with aiohttp.ClientSession() as session:
        buffered_stt = BufferedElevenLabsSTTProcessor(
            api_key=api_key,
            aiohttp_session=session,
            language_code=language_code,
            sample_rate=8000,
            chunk_seconds=4.0,
            min_avg_level=80,
            call_status=call_status,
        )

        # Create custom frame processor (task will be set after task initialization)
        processor = CampaignBotFrameProcessor(
            call_id=call_id,
            asterisk_channel_id=asterisk_channel_id,
            org_id=org_id,
            campaign_id=campaign_id,
            campaign_lead_id=campaign_lead_id,
            keywords=keywords,
            audio_duration=audio_duration,
            webhook_url=webhook_url,
            call_status=call_status,
            task=None
        )

        audio_probe = AudioProbeProcessor()

        pipeline = Pipeline([
            transport.input(),
            audio_probe,
            buffered_stt,
            processor,
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

        # Inject task into processor
        processor.task = task

        @transport.event_handler("on_client_connected")
        async def on_connected(transport, client):
            logger.info(f"[CampaignBot] Voice call answered: {call_id}")
            if intro_frame:
                processor.start_time = time.monotonic()
                await task.queue_frame(intro_frame)

            async def handle_timeout():
                await asyncio.sleep(total_timeout)
                if call_status.get("webhook_sent") or call_status.get("ended"):
                    logger.info("[CampaignBot] Timeout skipped because call already completed")
                    return
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

                # Hard hangup the actual Asterisk channel before ending the pipeline
                try:
                    await processor._hard_hangup()
                except Exception as e:
                    logger.error(f"[CampaignBot] Hard hangup error on timeout: {e}")

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
