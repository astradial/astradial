import json
import traceback

from fastapi import APIRouter, WebSocket, WebSocketException
from loguru import logger

from gateway.auth import validate_api_key
from gateway.bot_loader import load_bot_module
from gateway.database import fetchone
from gateway.flow_converter import editor_json_to_dynamic_flow
from gateway.pipeline import run_bot_pipeline

router = APIRouter()


@router.websocket("/ws/{org_id}/{bot_id}")
async def websocket_endpoint(websocket: WebSocket, org_id: str, bot_id: str, key: str = ""):
    """Accept a WebSocket connection, authenticate, load the bot, and run the pipeline."""
    logger.info(f"[WS] Connection attempt: org={org_id} bot={bot_id} key={'yes' if key else 'no'}")

    # Validate API key, or allow keyless access for internal AstraPBX connections
    org = None
    if key:
        org = await validate_api_key(key, org_id)
    if not org:
        # Keyless — look up org config directly (AstraPBX connects without a key)
        org_row = await fetchone(
            "SELECT o.id, o.name, c.google_api_key FROM organizations o LEFT JOIN pipecat_org_config c ON c.org_id = o.id WHERE o.id = %s AND o.status = 'active'",
            (org_id,),
        )
        if org_row:
            org = {"id": org_row["id"], "name": org_row["name"], "google_api_key": org_row["google_api_key"] or ""}
            logger.info(f"[WS] Org found via direct lookup: {org['name']}, api_key={'yes' if org['google_api_key'] else 'NO'}")
        else:
            logger.error(f"[WS] Org not found: {org_id}")
    if not org:
        logger.error(f"[WS] Auth failed for org={org_id}")
        raise WebSocketException(code=4001, reason="Invalid org or API key")

    # Look up bot
    bot = await fetchone(
        "SELECT * FROM pipecat_bots WHERE id = %s AND org_id = %s AND is_active = 1",
        (bot_id, org_id),
    )
    if not bot:
        logger.error(f"[WS] Bot not found: {bot_id}")
        raise WebSocketException(code=4004, reason="Bot not found or inactive")

    logger.info(f"[WS] Bot found: {bot['name']}, has flow_json={'yes' if bot.get('flow_json') else 'no'}")

    # Determine mode: JSON flow or Python module
    bot_module = None
    editor_json = None

    if bot["flow_json"]:
        editor_json = json.loads(bot["flow_json"]) if isinstance(bot["flow_json"], str) else bot["flow_json"]
        if editor_json.get("nodes"):
            bot_module = editor_json_to_dynamic_flow(editor_json)
            logger.info(f"[WS] Flow converted: {len(editor_json['nodes'])} nodes")

    if not bot_module and bot["module_path"]:
        try:
            bot_module = load_bot_module(bot["module_path"])
        except (FileNotFoundError, ValueError) as e:
            logger.error(f"[WS] Failed to load module: {e}")
            raise WebSocketException(code=4004, reason=str(e))

    if not bot_module:
        logger.error(f"[WS] No bot module or flow")
        raise WebSocketException(code=4004, reason="Bot has no flow_json or module_path configured")

    # Extract custom variables from WebSocket query params (set by originate-to-ai)
    extra_metadata = {}
    for k, v in websocket.query_params.items():
        if k != "key":
            extra_metadata[k] = v
    if extra_metadata:
        logger.info(f"[WS] Extra metadata from URL params: {extra_metadata}")

    # Accept WebSocket before handing off to pipeline
    await websocket.accept()
    logger.info(f"[WS] WebSocket accepted, starting pipeline")

    # Run pipeline (blocks until call ends)
    try:
        await run_bot_pipeline(
            websocket=websocket,
            google_api_key=org["google_api_key"],
            gemini_model=bot["gemini_model"],
            gemini_voice_id=bot["gemini_voice_id"],
            bot_module=bot_module,
            flow_json=editor_json,
            extra_metadata=extra_metadata,
        )
        logger.info(f"[WS] Pipeline completed normally")
    except Exception as e:
        logger.error(f"[WS] Pipeline crashed: {e}\n{traceback.format_exc()}")


@router.websocket("/campaign-bot/{bot_id}")
async def campaign_bot_endpoint(websocket: WebSocket, bot_id: str):
    """Accept a WebSocket connection from Node API for a campaign call run, authenticate bot, and execute pipeline."""
    logger.info(f"[WS] Campaign connection attempt: bot_id={bot_id}")

    # Validate that bot_id exists in the database
    bot = await fetchone("SELECT * FROM campaign_bots WHERE id = %s", (bot_id,))
    if not bot:
        logger.error(f"[WS] Campaign bot not found: {bot_id}")
        raise WebSocketException(code=4004, reason="Bot not found")

    # Accept WebSocket
    await websocket.accept()
    logger.info(f"[WS] Campaign WebSocket accepted for bot {bot['name']}")

    try:
        # Receive connected and start event messages
        conn_text = await websocket.receive_text()
        start_text = await websocket.receive_text()
        
        start_msg = json.loads(start_text)
        start_data = start_msg.get("start", {})
        custom_params = start_data.get("customParameters", {})

        # Extract values
        org_id = custom_params.get("org_id") or bot["org_id"]
        campaign_id = custom_params.get("CAMPAIGN_ID") or ""
        campaign_lead_id = custom_params.get("CAMPAIGN_LEAD_ID") or ""
        call_id = start_data.get("callSid") or ""
        webhook_url = custom_params.get("RESULT_WEBHOOK_URL") or bot.get("webhook_url") or ""
        
        # Load keywords
        interest_keywords_str = custom_params.get("INTEREST_KEYWORDS")
        if interest_keywords_str:
            try:
                keywords = json.loads(interest_keywords_str)
            except Exception:
                keywords = bot.get("keywords") or []
        else:
            keywords = bot.get("keywords") or []
            # Make sure it's a list (it might be a JSON string if the DB driver doesn't auto-deserialize)
            if isinstance(keywords, str):
                try:
                    keywords = json.loads(keywords)
                except Exception:
                    keywords = []

        language_code = bot.get("language") or "en"
        call_timeout = bot.get("call_timeout") or 8

        # Setup serializer: use raw PCM AstraPBXSerializer
        from gateway.astrapbx_serializer import AstraPBXSerializer
        serializer = AstraPBXSerializer()

        from gateway.campaign_bot import run_campaign_bot
        await run_campaign_bot(
            websocket=websocket,
            bot_id=bot_id,
            org_id=org_id,
            campaign_id=campaign_id,
            campaign_lead_id=campaign_lead_id,
            call_id=call_id,
            keywords=keywords,
            language_code=language_code,
            call_timeout=call_timeout,
            webhook_url=webhook_url,
            serializer=serializer
        )
        logger.info(f"[WS] Campaign bot pipeline completed normally")
    except Exception as e:
        logger.error(f"[WS] Campaign bot pipeline crashed: {e}\n{traceback.format_exc()}")

