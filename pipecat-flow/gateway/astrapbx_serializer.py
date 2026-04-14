#
# AstraPBX AudioSocket Serializer for Pipecat
#
# Handles raw 16-bit signed linear PCM at 8kHz over binary WebSocket frames.
# No ulaw/base64/JSON overhead — direct PCM passthrough between Asterisk
# AudioSocket (via Node.js relay) and Pipecat pipeline.
#

from typing import Optional

from loguru import logger

from pipecat.frames.frames import (
    AudioRawFrame,
    Frame,
    InputAudioRawFrame,
    OutputTransportMessageFrame,
    OutputTransportMessageUrgentFrame,
    StartFrame,
)
from pipecat.serializers.base_serializer import FrameSerializer


class AstraPBXSerializer(FrameSerializer):
    """Serializer for AstraPBX AudioSocket protocol over WebSocket.

    Audio format: 16-bit signed linear PCM, 8kHz, mono.
    Transport: Binary WebSocket frames containing raw PCM bytes.

    This eliminates the ulaw/base64/JSON overhead of the Twilio serializer,
    providing lower latency for Asterisk AudioSocket connections.
    """

    ASTRAPBX_SAMPLE_RATE = 8000

    class InputParams(FrameSerializer.InputParams):
        sample_rate: Optional[int] = None

    def __init__(self, params: Optional[InputParams] = None):
        super().__init__(params or AstraPBXSerializer.InputParams())
        self._sample_rate = 0

    async def setup(self, frame: StartFrame):
        self._sample_rate = self._params.sample_rate or frame.audio_in_sample_rate
        logger.info(
            f"AstraPBXSerializer: pipeline sample_rate={self._sample_rate}, "
            f"astrapbx sample_rate={self.ASTRAPBX_SAMPLE_RATE}"
        )

    @property
    def type(self):
        from pipecat.serializers.base_serializer import FrameSerializerType
        return FrameSerializerType.BINARY

    async def serialize(self, frame: Frame) -> str | bytes | None:
        if isinstance(frame, AudioRawFrame):
            data = frame.audio

            # If pipeline sample rate differs from 8kHz, resample
            if frame.sample_rate != self.ASTRAPBX_SAMPLE_RATE:
                data = self._resample(data, frame.sample_rate, self.ASTRAPBX_SAMPLE_RATE)

            return bytes(data)

        elif isinstance(frame, (OutputTransportMessageFrame, OutputTransportMessageUrgentFrame)):
            if self.should_ignore_frame(frame):
                return None
            # Pass through any transport messages as-is
            import json
            return json.dumps(frame.message)

        return None

    async def deserialize(self, data: str | bytes) -> Frame | None:
        if isinstance(data, (bytes, bytearray)) and len(data) > 0:
            audio_data = bytes(data)

            # If pipeline expects a different sample rate, resample
            if self._sample_rate != self.ASTRAPBX_SAMPLE_RATE:
                audio_data = self._resample(
                    audio_data, self.ASTRAPBX_SAMPLE_RATE, self._sample_rate
                )

            return InputAudioRawFrame(
                audio=audio_data,
                num_channels=1,
                sample_rate=self._sample_rate or self.ASTRAPBX_SAMPLE_RATE,
            )

        return None

    def _resample(self, data: bytes, from_rate: int, to_rate: int) -> bytes:
        """Simple linear resampling for 16-bit PCM."""
        import struct

        if from_rate == to_rate:
            return data

        samples = struct.unpack(f"<{len(data) // 2}h", data)
        ratio = to_rate / from_rate
        new_length = int(len(samples) * ratio)
        resampled = []

        for i in range(new_length):
            src_idx = i / ratio
            idx = int(src_idx)
            frac = src_idx - idx

            if idx + 1 < len(samples):
                sample = int(samples[idx] * (1 - frac) + samples[idx + 1] * frac)
            else:
                sample = samples[idx] if idx < len(samples) else 0

            resampled.append(max(-32768, min(32767, sample)))

        return struct.pack(f"<{len(resampled)}h", *resampled)
