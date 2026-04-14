"""Webhook action handler for pipecat flow actions.

Registers a "webhook" action type that makes HTTP requests with template
variable substitution from call_metadata and flow state.

Supports:
  - Template variables in URL and body: {call.x}, {state.x}
  - auth: "internal" for localhost AstraPBX calls (X-Internal-Key header)
  - Error handling: logs and continues (never crashes the bot)
"""

import aiohttp
from loguru import logger

from gateway.config import ASTRAPBX_URL, INTERNAL_API_KEY
from gateway.template_engine import resolve_template


async def handle_webhook_action(action: dict, flow_manager) -> None:
    """Execute a webhook action with template substitution.

    Action config example:
        {
            "type": "webhook",
            "url": "http://localhost:3000/api/v1/calls/{call.channel_id}/transfer",
            "auth": "internal",
            "body": {
                "destination": "{state.queue_number}",
                "destination_type": "queue"
            }
        }
    """
    url_template = action.get("url", "")
    body_template = action.get("body", {})
    auth_mode = action.get("auth", "")
    method = action.get("method", "POST").upper()

    if not url_template:
        logger.error("Webhook action missing 'url' field")
        return

    # Get state and metadata for template resolution
    state = getattr(flow_manager, "state", {})
    call_meta = getattr(flow_manager, "call_metadata", {})

    # Resolve templates in URL and body
    url = resolve_template(url_template, state=state, call=call_meta)
    body = resolve_template(body_template, state=state, call=call_meta)

    # Build headers
    headers = {"Content-Type": "application/json"}

    if auth_mode == "internal":
        if INTERNAL_API_KEY:
            headers["X-Internal-Key"] = INTERNAL_API_KEY
            # Also inject org_id for AstraPBX internal auth
            if isinstance(body, dict) and call_meta.get("org_id"):
                body.setdefault("org_id", call_meta["org_id"])
        else:
            logger.warning("Webhook auth: 'internal' but INTERNAL_API_KEY not configured")

    logger.info(f"Webhook: {method} {url}")
    logger.debug(f"Webhook body: {body}")

    try:
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.request(method, url, json=body, headers=headers) as resp:
                resp_text = await resp.text()
                if resp.status < 400:
                    logger.info(f"Webhook success: {resp.status}")
                else:
                    logger.error(f"Webhook error: {resp.status} — {resp_text[:200]}")
    except aiohttp.ClientError as e:
        logger.error(f"Webhook network error: {e}")
    except Exception as e:
        logger.error(f"Webhook unexpected error: {e}")
