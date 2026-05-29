"""WebRTC test endpoint — browser-based bot testing via Pipecat Playground.

Flow:
1. Editor calls POST /test/session (admin auth) with org_id + bot_id
2. Returns a temporary session_id (expires in 10 min)
3. Playground opens at /test/client/ and POSTs to /api/offer
4. /api/offer looks up session config, launches WebRTC bot pipeline

No API keys exposed in browser URLs.
"""

import json
import time
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from loguru import logger
from pydantic import BaseModel

from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.request_handler import (
    SmallWebRTCPatchRequest,
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)
from pipecat_ai_small_webrtc_prebuilt.frontend import SmallWebRTCPrebuiltUI

from gateway.auth import require_admin
from gateway.database import fetchone
from gateway.flow_converter import editor_json_to_dynamic_flow
from gateway.pipeline_webrtc import run_webrtc_bot_pipeline

router = APIRouter()

# Pipecat Playground UI (static files, mounted in main.py)
router_ui = SmallWebRTCPrebuiltUI

# WebRTC request handler
_handler = SmallWebRTCRequestHandler()

# In-memory session store: session_id -> {org_id, bot_id, created_at, config}
_sessions: dict[str, dict] = {}

SESSION_TTL_SECS = 600  # 10 minutes


class TestSessionRequest(BaseModel):
    org_id: str
    bot_id: str


def _cleanup_expired():
    """Remove expired sessions."""
    now = time.time()
    expired = [sid for sid, s in _sessions.items() if now - s["created_at"] > SESSION_TTL_SECS]
    for sid in expired:
        del _sessions[sid]


@router.post("/test/session", dependencies=[Depends(require_admin)])
async def create_test_session(body: TestSessionRequest):
    """Create a temporary test session (admin auth required).

    Returns a session_id that the Playground UI uses to connect.
    """
    _cleanup_expired()

    # Look up bot
    bot = await fetchone(
        "SELECT * FROM pipecat_bots WHERE id = %s AND org_id = %s AND is_active = 1",
        (body.bot_id, body.org_id),
    )
    if not bot:
        raise HTTPException(404, "Bot not found")

    # Look up org config for google_api_key
    org_config = await fetchone(
        "SELECT google_api_key FROM pipecat_org_config WHERE org_id = %s",
        (body.org_id,),
    )
    if not org_config or not org_config.get("google_api_key"):
        raise HTTPException(400, "Org has no Google API key configured")

    # Parse flow JSON
    editor_json = None
    if bot["flow_json"]:
        editor_json = json.loads(bot["flow_json"]) if isinstance(bot["flow_json"], str) else bot["flow_json"]
    if not editor_json or not editor_json.get("nodes"):
        raise HTTPException(400, "Bot has no flow configured")

    session_id = str(uuid.uuid4())
    _sessions[session_id] = {
        "org_id": body.org_id,
        "bot_id": body.bot_id,
        "google_api_key": org_config["google_api_key"],
        "gemini_model": bot["gemini_model"],
        "gemini_voice_id": bot["gemini_voice_id"],
        "flow_json": editor_json,
        "bot_module": editor_json_to_dynamic_flow(editor_json),
        "created_at": time.time(),
    }

    logger.info(f"Test session created: {session_id} for bot {bot['name']}")
    return {"session_id": session_id, "expires_in": SESSION_TTL_SECS}


@router.post("/api/offer")
async def offer(request: SmallWebRTCRequest, background_tasks: BackgroundTasks):
    """Handle WebRTC offer — uses session from request_data or default."""
    _cleanup_expired()

    # Try to get session_id from request_data (sent by Playground)
    session_id = None
    if request.request_data and isinstance(request.request_data, dict):
        session_id = request.request_data.get("session_id")

    if not session_id:
        # Check if there's only one active session (convenience for single-tester)
        if len(_sessions) == 1:
            session_id = next(iter(_sessions))
        else:
            raise HTTPException(400, "No session_id provided. Create a session first via POST /test/session")

    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(404, "Session expired or not found")

    async def on_connection(connection: SmallWebRTCConnection):
        await run_webrtc_bot_pipeline(
            connection=connection,
            bot_module=session["bot_module"],
            google_api_key=session["google_api_key"],
            gemini_model=session["gemini_model"],
            gemini_voice_id=session["gemini_voice_id"],
            flow_json=session["flow_json"],
        )

    answer = await _handler.handle_web_request(
        request=request,
        webrtc_connection_callback=on_connection,
    )
    return answer


@router.patch("/api/offer")
async def ice_candidate(request: SmallWebRTCPatchRequest):
    """Handle ICE candidate."""
    await _handler.handle_patch_request(request)
    return {"status": "success"}


@router.api_route("/sessions/{session_id}/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def session_proxy(session_id: str, path: str, request: Request, background_tasks: BackgroundTasks):
    """RTVI session proxy — routes /sessions/{id}/api/offer to the WebRTC handler."""
    _cleanup_expired()
    session = _sessions.get(session_id)
    if not session:
        raise HTTPException(404, "Session expired or not found")

    if path.endswith("api/offer"):
        try:
            data = await request.json()
            if request.method == "POST":
                webrtc_req = SmallWebRTCRequest(
                    sdp=data["sdp"],
                    type=data["type"],
                    pc_id=data.get("pc_id"),
                    restart_pc=data.get("restart_pc"),
                    request_data={"session_id": session_id},
                )
                return await offer(webrtc_req, background_tasks)
            elif request.method == "PATCH":
                from pipecat.transports.smallwebrtc.request_handler import IceCandidate
                patch_req = SmallWebRTCPatchRequest(
                    pc_id=data["pc_id"],
                    candidates=[IceCandidate(**c) for c in data.get("candidates", [])],
                )
                return await ice_candidate(patch_req)
        except Exception as e:
            logger.error(f"Session proxy error: {e}")
            raise HTTPException(400, f"WebRTC request failed: {e}")

    return {"status": "ok"}


@router.post("/start")
async def rtvi_start(request: Request):
    """RTVI /start endpoint — Playground calls this first to get a session ID."""
    _cleanup_expired()

    # If there are active sessions, use the most recent one
    if _sessions:
        latest_sid = max(_sessions, key=lambda s: _sessions[s]["created_at"])
        return {"sessionId": latest_sid}

    raise HTTPException(400, "No test session. Click 'Test' in the editor first.")


@router.get("/test/sessions")
async def list_sessions():
    """List active test sessions (for debugging)."""
    _cleanup_expired()
    return [
        {"session_id": sid, "bot_id": s["bot_id"], "age_secs": int(time.time() - s["created_at"])}
        for sid, s in _sessions.items()
    ]
