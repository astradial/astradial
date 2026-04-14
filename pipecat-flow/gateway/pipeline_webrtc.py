"""WebRTC pipeline for browser-based bot testing."""

import asyncio

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
from pipecat.processors.user_idle_processor import UserIdleProcessor
from pipecat.services.google.gemini_live.llm import GeminiLiveLLMService
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection

from gateway.webhook_action import handle_webhook_action
from pipecat_flows import FlowManager


async def run_webrtc_bot_pipeline(
    connection: SmallWebRTCConnection,
    bot_module,
    google_api_key: str,
    gemini_model: str = "gemini-3.1-flash-live-preview",
    gemini_voice_id: str = "Kore",
    flow_json: dict | None = None,
):
    """Run bot pipeline over WebRTC for browser testing."""
    logger.info("WebRTC test call connected")

    transport = SmallWebRTCTransport(
        webrtc_connection=connection,
        params=TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
        ),
    )

    llm = GeminiLiveLLMService(
        api_key=google_api_key,
        model=gemini_model,
        voice_id=gemini_voice_id,
    )

    # Idle config
    idle_cfg = (flow_json or {}).get("idle_config", {})
    idle_timeout = idle_cfg.get("timeout_secs", 8.0)
    idle_max_retries = idle_cfg.get("max_retries", 2)
    idle_prompt = idle_cfg.get("prompt_message", "Are you still there?")
    idle_goodbye = idle_cfg.get("goodbye_message",
                                "I haven't heard from you. Thank you for calling. Goodbye.")

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
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
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

    # For WebRTC test, set dummy call metadata
    flow_manager.call_metadata = {
        "channel_id": "webrtc-test",
        "org_id": "",
        "endpoint": "browser",
        "provider": "webrtc",
    }

    flow_manager.register_action("webhook", handle_webhook_action)

    @transport.event_handler("on_client_connected")
    async def on_connected(transport, client):
        logger.info("WebRTC client connected, initializing flow")
        await flow_manager.initialize(bot_module.create_welcome_node())

    @transport.event_handler("on_client_disconnected")
    async def on_disconnected(transport, client):
        logger.info("WebRTC client disconnected")
        await task.cancel()

    runner = PipelineRunner(handle_sigint=False)
    await runner.run(task)
