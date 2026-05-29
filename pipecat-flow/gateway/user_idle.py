import asyncio
from collections.abc import Awaitable, Callable
from loguru import logger
from pipecat.frames.frames import Frame, StartFrame, UserStartedSpeakingFrame, AudioRawFrame
from pipecat.processors.frame_processor import FrameDirection
from pipecat.processors.idle_frame_processor import IdleFrameProcessor

class UserIdleProcessor(IdleFrameProcessor):
    """Custom wrapper around IdleFrameProcessor keeping the old UserIdleProcessor interface."""

    def __init__(
        self,
        *,
        callback: Callable[["UserIdleProcessor", int], Awaitable[bool]],
        timeout: float,
        **kwargs
    ):
        self.retry_count = 0
        super().__init__(callback=self._internal_callback, timeout=timeout, **kwargs)
        self._user_callback = callback

    async def _internal_callback(self, processor):
        should_continue = await self._user_callback(self, self.retry_count)
        if should_continue:
            self.retry_count += 1
        else:
            # If the callback says we shouldn't continue, we stop/reset
            self.retry_count = 0

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        # Reset retry count if we receive user speech/input
        if isinstance(frame, (UserStartedSpeakingFrame, AudioRawFrame)):
            if self.retry_count > 0:
                logger.debug("User input detected; resetting user idle retry count")
            self.retry_count = 0
        await super().process_frame(frame, direction)
