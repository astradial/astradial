from pydantic import BaseModel
from typing import Optional


# ─── Orgs (read-only from AstraPBX) ───

class OrgResponse(BaseModel):
    id: str
    name: str
    is_active: bool
    created_at: str
    updated_at: str


# ─── API Keys (pipecat-owned) ───

class KeyCreate(BaseModel):
    label: str = ""


class KeyCreateResponse(BaseModel):
    id: str
    key: str  # plaintext, shown only once
    key_prefix: str
    label: str
    created_at: str


class KeyResponse(BaseModel):
    id: str
    key_prefix: str
    label: str
    is_active: bool
    created_at: str
    last_used_at: Optional[str] = None


# ─── Bots (pipecat-owned) ───

class BotCreate(BaseModel):
    name: str
    module_path: str = ""
    flow_json: Optional[dict] = None
    gemini_model: str = "gemini-3.1-flash-live-preview"
    gemini_voice_id: str = "Kore"


class BotUpdate(BaseModel):
    name: Optional[str] = None
    module_path: Optional[str] = None
    flow_json: Optional[dict] = None
    gemini_model: Optional[str] = None
    gemini_voice_id: Optional[str] = None
    is_active: Optional[bool] = None


class BotResponse(BaseModel):
    id: str
    org_id: str
    name: str
    module_path: str
    flow_json: Optional[dict] = None
    gemini_model: str
    gemini_voice_id: str
    is_active: bool
    created_at: str
    updated_at: str
    extension: Optional[str] = None
