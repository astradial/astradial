from unittest.mock import AsyncMock, Mock


def assert_tts_speak_frames_queued(mock_task, expected_texts):
    """Assert that TTSSpeakFrames with expected texts were queued."""
    from pipecat.frames.frames import TTSSpeakFrame

    tts_calls = [
        call
        for call in mock_task.queue_frame.call_args_list
        if isinstance(call[0][0], TTSSpeakFrame)
    ]
    assert len(tts_calls) == len(expected_texts), (
        f"Expected {len(expected_texts)} TTS calls, got {len(tts_calls)}"
    )
    for text in expected_texts:
        assert any(text in getattr(call[0][0], "text", "") for call in tts_calls), (
            f"{text} TTS call not found"
        )


def assert_end_frame_queued(mock_task):
    """Assert that an EndFrame was queued."""
    from pipecat.frames.frames import EndFrame

    end_calls = [
        call for call in mock_task.queue_frame.call_args_list if isinstance(call[0][0], EndFrame)
    ]
    assert len(end_calls) == 1, "EndFrame not queued"


def make_mock_task():
    """Create a mock PipelineTask wired up so that actions don't hang."""
    mock_task = AsyncMock()

    # Mock queue_frame method that simulates queued frames reaching all the way downstream.
    # This is necessary for action execution to not hang, waiting.
    async def queue_frame(frame):
        handler = getattr(mock_task, "on_frame_reached_downstream", None)
        if handler:
            await handler(mock_task, frame)

    mock_task.queue_frame = AsyncMock(side_effect=queue_frame)

    # Mock stuff necessary for registering on_frame_reached_downstream handler.
    mock_task.set_reached_downstream_filter = Mock()

    def mock_event_handler(event_name):
        def decorator(func):
            setattr(mock_task, event_name, func)
            return func

        return decorator

    mock_task.event_handler = mock_event_handler

    return mock_task
