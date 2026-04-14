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
