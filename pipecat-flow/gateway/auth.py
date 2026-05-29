import hashlib
import secrets
from typing import Optional

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from gateway.config import ADMIN_KEY
from gateway.database import execute, fetchone

_bearer_scheme = HTTPBearer()


def generate_api_key() -> tuple[str, str, str]:
    """Generate a new API key. Returns (plaintext, hash, prefix)."""
    raw = secrets.token_hex(32)
    plaintext = f"ak_{raw}"
    key_hash = hashlib.sha256(plaintext.encode()).hexdigest()
    key_prefix = plaintext[:11]  # "ak_" + first 8 hex chars
    return plaintext, key_hash, key_prefix


def hash_key(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode()).hexdigest()


async def validate_api_key(key: Optional[str], org_id: str) -> Optional[dict]:
    """Validate an API key against an org. Returns org row or None."""
    if not key:
        return None

    key_hash = hash_key(key)

    row = await fetchone(
        """
        SELECT o.id, o.name, o.status,
               c.google_api_key,
               k.id as key_id, k.is_active as key_active
        FROM pipecat_api_keys k
        JOIN organizations o ON o.id = k.org_id
        LEFT JOIN pipecat_org_config c ON c.org_id = o.id
        WHERE k.key_hash = %s AND k.org_id = %s
        """,
        (key_hash, org_id),
    )

    if not row:
        return None

    if row["status"] != "active" or not row["key_active"]:
        return None

    # Update last_used_at
    await execute(
        "UPDATE pipecat_api_keys SET last_used_at = NOW() WHERE id = %s",
        (row["key_id"],),
    )

    return {"id": row["id"], "name": row["name"], "google_api_key": row["google_api_key"] or ""}


async def require_admin(credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme)) -> None:
    """FastAPI dependency that checks the admin bearer token via Swagger-compatible HTTPBearer."""
    if not ADMIN_KEY:
        raise HTTPException(500, "GATEWAY_ADMIN_KEY not configured")

    if credentials.credentials != ADMIN_KEY:
        raise HTTPException(401, "Invalid admin token")
