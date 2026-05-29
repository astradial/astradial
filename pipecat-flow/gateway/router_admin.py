import asyncio
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from loguru import logger

from gateway.auth import generate_api_key, require_admin
from gateway.config import ADMIN_KEY
from gateway.database import execute, fetchall, fetchone
from gateway.models import (
    BotCreate, BotResponse, BotUpdate,
    KeyCreate, KeyCreateResponse, KeyResponse,
    OrgResponse,
)

router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])


def _bot_row_to_dict(row: dict) -> dict:
    """Convert a bot DB row to a response dict, parsing flow_json from TEXT."""
    d = dict(row)
    fj = d.get("flow_json", "")
    d["flow_json"] = json.loads(fj) if fj else None
    for key in ("created_at", "updated_at"):
        if key in d and d[key] is not None:
            d[key] = str(d[key])
    return d


async def _enrich_bots_with_extensions(bot_dicts: list[dict]) -> list[dict]:
    """Look up AstraPBX extensions linked to each bot via routing_destination."""
    if not bot_dicts:
        return bot_dicts
    org_id = bot_dicts[0].get("org_id", "")
    ext_rows = await fetchall(
        "SELECT extension, routing_destination FROM users WHERE org_id = %s AND routing_type = 'ai_agent'",
        (org_id,),
    )
    # Build bot_id -> extension lookup from routing_destination URLs
    bot_ext_map: dict[str, str] = {}
    for row in ext_rows:
        dest = row.get("routing_destination", "") or ""
        for bd in bot_dicts:
            if bd["id"] in dest:
                bot_ext_map[bd["id"]] = row["extension"]
    for bd in bot_dicts:
        bd["extension"] = bot_ext_map.get(bd["id"])
    return bot_dicts


# ─── Orgs (read-only from AstraPBX organizations table) ───

@router.get("/orgs", response_model=list[OrgResponse])
async def list_orgs():
    """List all organizations from AstraPBX (read-only)."""
    rows = await fetchall(
        "SELECT id, name, status, created_at, updated_at FROM organizations ORDER BY created_at DESC"
    )
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "is_active": r["status"] == "active",
            "created_at": str(r["created_at"]),
            "updated_at": str(r["updated_at"]),
        }
        for r in rows
    ]


@router.get("/orgs/{org_id}", response_model=OrgResponse)
async def get_org(org_id: str):
    """Get a single organization from AstraPBX (read-only)."""
    row = await fetchone("SELECT id, name, status, created_at, updated_at FROM organizations WHERE id = %s", (org_id,))
    if not row:
        raise HTTPException(404, "Org not found")
    return {
        "id": row["id"],
        "name": row["name"],
        "is_active": row["status"] == "active",
        "created_at": str(row["created_at"]),
        "updated_at": str(row["updated_at"]),
    }


@router.get("/orgs/{org_id}/credentials")
async def get_org_credentials(org_id: str):
    """Get org API key for PBX API access (admin only)."""
    row = await fetchone("SELECT api_key FROM organizations WHERE id = %s", (org_id,))
    if not row:
        raise HTTPException(404, "Org not found")
    return {"api_key": row["api_key"]}


# ─── Org Config (pipecat-owned, per-org settings like google_api_key) ───

@router.put("/orgs/{org_id}/config")
async def upsert_org_config(org_id: str, body: dict):
    """Set pipecat-specific config for an org (google_api_key, etc.)."""
    org = await fetchone("SELECT id FROM organizations WHERE id = %s", (org_id,))
    if not org:
        raise HTTPException(404, "Org not found")
    google_api_key = body.get("google_api_key", "")
    await execute(
        """
        INSERT INTO pipecat_org_config (org_id, google_api_key)
        VALUES (%s, %s)
        ON DUPLICATE KEY UPDATE google_api_key = VALUES(google_api_key)
        """,
        (org_id, google_api_key),
    )
    return {"org_id": org_id, "google_api_key": google_api_key}


@router.get("/orgs/{org_id}/config")
async def get_org_config(org_id: str):
    """Get pipecat-specific config for an org."""
    row = await fetchone("SELECT * FROM pipecat_org_config WHERE org_id = %s", (org_id,))
    if not row:
        raise HTTPException(404, "No config found for this org")
    return {"org_id": row["org_id"], "google_api_key": row["google_api_key"]}


# ─── API Keys (pipecat-owned) ───

@router.post("/orgs/{org_id}/keys", response_model=KeyCreateResponse, status_code=201)
async def create_key(org_id: str, body: KeyCreate = KeyCreate()):
    # Verify org exists in AstraPBX
    org = await fetchone("SELECT id FROM organizations WHERE id = %s", (org_id,))
    if not org:
        raise HTTPException(404, "Org not found")
    key_id = str(uuid.uuid4())
    plaintext, key_hash, key_prefix = generate_api_key()
    await execute(
        "INSERT INTO pipecat_api_keys (id, org_id, key_hash, key_prefix, label) VALUES (%s, %s, %s, %s, %s)",
        (key_id, org_id, key_hash, key_prefix, body.label),
    )
    row = await fetchone("SELECT * FROM pipecat_api_keys WHERE id = %s", (key_id,))
    return {"id": key_id, "key": plaintext, "key_prefix": key_prefix, "label": body.label, "created_at": str(row["created_at"])}


@router.get("/orgs/{org_id}/keys", response_model=list[KeyResponse])
async def list_keys(org_id: str):
    rows = await fetchall(
        "SELECT id, key_prefix, label, is_active, created_at, last_used_at FROM pipecat_api_keys WHERE org_id = %s ORDER BY created_at DESC",
        (org_id,),
    )
    return [
        {**r, "created_at": str(r["created_at"]), "last_used_at": str(r["last_used_at"]) if r["last_used_at"] else None}
        for r in rows
    ]


@router.delete("/orgs/{org_id}/keys/{key_id}")
async def revoke_key(org_id: str, key_id: str):
    await execute("UPDATE pipecat_api_keys SET is_active = 0 WHERE id = %s AND org_id = %s", (key_id, org_id))
    return {"status": "revoked"}


# ─── Bots (pipecat-owned) ───

@router.post("/orgs/{org_id}/bots", response_model=BotResponse, status_code=201)
async def create_bot(org_id: str, body: BotCreate):
    if not body.module_path and not body.flow_json:
        raise HTTPException(422, "Either module_path or flow_json is required")
    # Verify org exists in AstraPBX
    org = await fetchone("SELECT id FROM organizations WHERE id = %s", (org_id,))
    if not org:
        raise HTTPException(404, "Org not found")
    bot_id = str(uuid.uuid4())
    flow_json_str = json.dumps(body.flow_json) if body.flow_json else ""
    try:
        await execute(
            "INSERT INTO pipecat_bots (id, org_id, name, module_path, flow_json, gemini_model, gemini_voice_id) VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (bot_id, org_id, body.name, body.module_path, flow_json_str, body.gemini_model, body.gemini_voice_id),
        )
    except Exception:
        raise HTTPException(409, "Bot name already exists for this org")
    row = await fetchone("SELECT * FROM pipecat_bots WHERE id = %s", (bot_id,))
    return _bot_row_to_dict(row)


@router.get("/orgs/{org_id}/bots", response_model=list[BotResponse])
async def list_bots(org_id: str):
    rows = await fetchall(
        "SELECT * FROM pipecat_bots WHERE org_id = %s ORDER BY created_at DESC", (org_id,),
    )
    bot_dicts = [_bot_row_to_dict(r) for r in rows]
    return await _enrich_bots_with_extensions(bot_dicts)


@router.get("/orgs/{org_id}/bots/{bot_id}", response_model=BotResponse)
async def get_bot(org_id: str, bot_id: str):
    row = await fetchone("SELECT * FROM pipecat_bots WHERE id = %s AND org_id = %s", (bot_id, org_id))
    if not row:
        raise HTTPException(404, "Bot not found")
    bot_dicts = await _enrich_bots_with_extensions([_bot_row_to_dict(row)])
    return bot_dicts[0]


@router.patch("/orgs/{org_id}/bots/{bot_id}", response_model=BotResponse)
async def update_bot(org_id: str, bot_id: str, body: BotUpdate):
    updates, values = [], []
    for field in ["name", "module_path", "gemini_model", "gemini_voice_id"]:
        val = getattr(body, field)
        if val is not None:
            updates.append(f"{field} = %s")
            values.append(val)
    if body.flow_json is not None:
        updates.append("flow_json = %s")
        values.append(json.dumps(body.flow_json))
    if body.is_active is not None:
        updates.append("is_active = %s")
        values.append(int(body.is_active))
    if not updates:
        raise HTTPException(422, "No fields to update")
    values.extend([bot_id, org_id])
    await execute(f"UPDATE pipecat_bots SET {', '.join(updates)} WHERE id = %s AND org_id = %s", tuple(values))
    row = await fetchone("SELECT * FROM pipecat_bots WHERE id = %s AND org_id = %s", (bot_id, org_id))
    if not row:
        raise HTTPException(404, "Bot not found")
    return _bot_row_to_dict(row)


@router.delete("/orgs/{org_id}/bots/{bot_id}")
async def delete_bot(org_id: str, bot_id: str):
    await execute("UPDATE pipecat_bots SET is_active = 0 WHERE id = %s AND org_id = %s", (bot_id, org_id))
    return {"status": "deactivated"}


# ─── SIP Credentials (read directly from MySQL since AstraPBX API strips sip_password) ───

@router.get("/orgs/{org_id}/users/{user_id}/sip")
async def get_sip_credentials(org_id: str, user_id: str):
    """Get SIP credentials for a user (admin only). Returns sip_password from DB."""
    row = await fetchone(
        "SELECT extension, sip_password, asterisk_endpoint FROM users WHERE id = %s AND org_id = %s",
        (user_id, org_id),
    )
    if not row:
        raise HTTPException(404, "User not found")
    return {
        "extension": row["extension"],
        "sip_password": row["sip_password"],
        "asterisk_endpoint": row["asterisk_endpoint"],
    }


# ─── Call Actions (proxy to AstraPBX — avoids %2F encoding issues with Nginx) ───

@router.post("/calls/{action}")
async def call_action(action: str, body: dict):
    """Proxy call actions (transfer, hangup, hold, unhold) to AstraPBX."""
    import aiohttp
    from gateway.config import ASTRAPBX_URL, INTERNAL_API_KEY

    channel_id = body.get("channel_id", "")
    if not channel_id:
        raise HTTPException(400, "channel_id required")

    # Get org_id from the channel name (contains context_prefix)
    org = await fetchone(
        "SELECT id FROM organizations WHERE %s LIKE CONCAT('%%', context_prefix, '%%')",
        (channel_id,),
    )
    org_id = org["id"] if org else ""

    from urllib.parse import quote

    # Handle monitor_stop as DELETE /calls/:channelId/monitor
    http_method = "DELETE" if action == "monitor_stop" else "POST"
    actual_action = "monitor" if action == "monitor_stop" else action

    # Build AstraPBX URL with channel_id in path (URL-encode the slash in PJSIP/...)
    url = f"{ASTRAPBX_URL}/api/v1/calls/{quote(channel_id, safe='')}/{actual_action}"
    logger.info(f"Call action proxy: {http_method} {url} body={body}")
    headers = {"Content-Type": "application/json"}
    if INTERNAL_API_KEY:
        headers["X-Internal-Key"] = INTERNAL_API_KEY
        body["org_id"] = org_id

    try:
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.request(http_method, url, json=body, headers=headers) as resp:
                result = await resp.json()
                if resp.status >= 400:
                    raise HTTPException(resp.status, result)
                return result
    except aiohttp.ClientError as e:
        raise HTTPException(502, f"AstraPBX error: {e}")


# ─── Log streaming (separate router, auth via query param for SSE compatibility) ───

logs_router = APIRouter(prefix="/admin")


@logs_router.get("/logs/{bot_id}/stream")
async def stream_bot_logs(bot_id: str, request: Request, token: str = ""):
    """Stream live logs for a bot via SSE. Auth via ?token= query param."""
    # Manual admin auth (SSE/EventSource can't send Authorization headers)
    if not ADMIN_KEY:
        raise HTTPException(500, "GATEWAY_ADMIN_KEY not configured")
    if token != ADMIN_KEY:
        raise HTTPException(401, "Invalid admin token")

    # Verify bot exists
    row = await fetchone("SELECT id FROM pipecat_bots WHERE id = %s", (bot_id,))
    if not row:
        raise HTTPException(404, "Bot not found")

    LOG_KEYWORDS = [
        "Transcription", "function", "transition", "webhook",
        "error", "idle", "State after", "End of Turn",
        "Bot started speaking", "Bot stopped speaking",
        "Connected", "Disconnected",
    ]

    async def event_stream():
        proc = await asyncio.create_subprocess_exec(
            "journalctl", "-u", "pipecat-flow", "-f", "--since", "now",
            "--no-pager", "-o", "short-iso",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            while True:
                if await request.is_disconnected():
                    break
                line_bytes = await proc.stdout.readline()
                if not line_bytes:
                    break
                line = line_bytes.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                # Filter: must contain the bot_id OR one of the keywords
                if bot_id not in line:
                    if not any(kw.lower() in line.lower() for kw in LOG_KEYWORDS):
                        continue
                yield f"data: {line}\n\n"
        finally:
            proc.kill()
            await proc.wait()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
