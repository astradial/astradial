import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Directories
BASE_DIR = Path(__file__).resolve().parent.parent
BOTS_DIR = BASE_DIR / "bots"

# Server
HOST = os.getenv("GATEWAY_HOST", "0.0.0.0")
PORT = int(os.getenv("GATEWAY_PORT", "7860"))

# Admin auth
ADMIN_KEY = os.getenv("GATEWAY_ADMIN_KEY", "")

# MySQL (shared with AstraPBX)
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_USER = os.getenv("DB_USER", "pbx_user")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_NAME = os.getenv("DB_NAME", "pbx_api_db")

# Internal auth for localhost AstraPBX calls
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
ASTRAPBX_URL = os.getenv("ASTRAPBX_URL", "http://localhost:8000")
