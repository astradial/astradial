import asyncio

from fastapi import WebSocket
from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import EndFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.turns.user_mute import (
    MuteUntilFirstBotCompleteUserMuteStrategy,
    FunctionCallUserMuteStrategy,
)
from pipecat.processors.user_idle_processor import UserIdleProcessor
from pipecat.runner.utils import parse_telephony_websocket
from pipecat.serializers.twilio import TwilioFrameSerializer
from pipecat.services.google.gemini_live.llm import GeminiLiveLLMService
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)

from gateway.astrapbx_serializer import AstraPBXSerializer
from gateway.webhook_action import handle_webhook_action

from pipecat_flows import FlowManager


async def run_bot_pipeline(
    websocket: WebSocket,
    bot_module,
    google_api_key: str,
    gemini_model: str = "gemini-3.1-flash-live-preview",
    gemini_voice_id: str = "Kore",
    flow_json: dict | None = None,
    extra_metadata: dict | None = None,
):
    """Create transport, pipeline, FlowManager, and run for a single call."""
    transport_type, call_data = await parse_telephony_websocket(websocket)
    logger.info(f"Call connected: type={transport_type}, stream={call_data.get('stream_id', '?')}")

    body = call_data.get("body", {})
    # Pass all custom parameters as call metadata (includes workflow variables like name, city, etc.)
    call_metadata = {**body}
    # Merge extra metadata from WebSocket URL query params (outbound bot calls)
    if extra_metadata:
        call_metadata.update(extra_metadata)
    # Ensure standard fields always exist
    call_metadata.setdefault("channel_id", "")
    call_metadata.setdefault("org_id", "")
    call_metadata.setdefault("endpoint", "")
    call_metadata.setdefault("provider", "")
    logger.info(f"Call metadata: {call_metadata}")

    is_astrapbx = body.get("provider") == "astrapbx"
    if is_astrapbx:
        logger.info("Using AstraPBX serializer (raw PCM)")
        serializer = AstraPBXSerializer()
    else:
        serializer = TwilioFrameSerializer(
            stream_sid=call_data.get("stream_id", ""),
            call_sid=call_data.get("call_id", ""),
            params=TwilioFrameSerializer.InputParams(auto_hang_up=False),
        )

    params = FastAPIWebsocketParams(
        audio_in_enabled=True,
        audio_out_enabled=True,
        add_wav_header=False,
        serializer=serializer,
    )
    transport = FastAPIWebsocketTransport(websocket=websocket, params=params)

    llm = GeminiLiveLLMService(
        api_key=google_api_key,
        model=gemini_model,
        voice_id=gemini_voice_id,
    )

    # Read idle config from flow JSON
    idle_cfg = (flow_json or {}).get("idle_config", {})
    idle_timeout = idle_cfg.get("timeout_secs", 8.0)
    idle_max_retries = idle_cfg.get("max_retries", 2)
    idle_prompt = idle_cfg.get("prompt_message", "Are you still there?")
    idle_goodbye = idle_cfg.get("goodbye_message",
                                "I haven't heard from you. Thank you for calling. Goodbye.")

    # User idle processor — triggers when user is silent
    # Uses send_realtime_input(text=...) which is the documented Gemini Live API
    # for injecting text as user input (synchronized with audio stream)
    async def handle_user_idle(processor: UserIdleProcessor, retry_count: int) -> bool:
        if retry_count < idle_max_retries:
            logger.info(f"User idle: prompt {retry_count + 1}/{idle_max_retries}")
            if llm._session and llm._ready_for_realtime_input:
                try:
                    await llm._session.send_realtime_input(
                        text=f"(The caller has been silent. Say: {idle_prompt})"
                    )
                except Exception as e:
                    logger.error(f"Idle prompt failed: {e}")
            return True
        else:
            logger.info("User idle: max retries, ending call")
            if llm._session and llm._ready_for_realtime_input:
                try:
                    await llm._session.send_realtime_input(
                        text=f"(The caller is not responding. Say: {idle_goodbye})"
                    )
                except Exception as e:
                    logger.error(f"Idle goodbye failed: {e}")
            await asyncio.sleep(6)
            await task.queue_frame(EndFrame())
            return False

    idle_processor = UserIdleProcessor(callback=handle_user_idle, timeout=idle_timeout)

    context = LLMContext()
    context_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(),
            user_mute_strategies=[
                MuteUntilFirstBotCompleteUserMuteStrategy(),
                FunctionCallUserMuteStrategy(),
            ],
        ),
    )

    pipeline = Pipeline([
        transport.input(),
        idle_processor,
        context_aggregator.user(),
        llm,
        transport.output(),
        context_aggregator.assistant(),
    ])

    task = PipelineTask(pipeline, params=PipelineParams(allow_interruptions=True))

    flow_manager = FlowManager(
        task=task,
        llm=llm,
        context_aggregator=context_aggregator,
        transport=transport,
    )

    flow_manager.call_metadata = call_metadata
    flow_manager.register_action("webhook", handle_webhook_action)

    # Pass call metadata to flow converter for initial node template resolution
    if hasattr(bot_module, "set_call_metadata"):
        bot_module.set_call_metadata(call_metadata)

    @transport.event_handler("on_client_connected")
    async def on_connected(transport, client):
        logger.info("Client connected, initializing flow")
        await flow_manager.initialize(bot_module.create_welcome_node())

    @transport.event_handler("on_client_disconnected")
    async def on_disconnected(transport, client):
        logger.info("Client disconnected")
        await task.cancel()

    runner = PipelineRunner(handle_sigint=False)
    await runner.run(task)
