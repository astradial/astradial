import aiomysql

from gateway.config import DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER

_pool: aiomysql.Pool | None = None

# Tables owned by pipecat-flow (created in AstraPBX's MySQL database)
PIPECAT_SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS pipecat_org_config (
        org_id VARCHAR(36) PRIMARY KEY,
        google_api_key VARCHAR(255) NOT NULL DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS pipecat_api_keys (
        id VARCHAR(36) PRIMARY KEY,
        org_id VARCHAR(36) NOT NULL,
        key_hash VARCHAR(64) NOT NULL UNIQUE,
        key_prefix VARCHAR(16) NOT NULL,
        label VARCHAR(255) DEFAULT '',
        is_active TINYINT(1) DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used_at DATETIME NULL,
        INDEX idx_org_id (org_id),
        INDEX idx_key_hash (key_hash)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS pipecat_bots (
        id VARCHAR(36) PRIMARY KEY,
        org_id VARCHAR(36) NOT NULL,
        name VARCHAR(255) NOT NULL,
        module_path VARCHAR(512) DEFAULT '',
        flow_json LONGTEXT DEFAULT '',
        gemini_model VARCHAR(100) DEFAULT 'gemini-3.1-flash-live-preview',
        gemini_voice_id VARCHAR(50) DEFAULT 'Kore',
        is_active TINYINT(1) DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_org_bot_name (org_id, name),
        INDEX idx_org_id (org_id)
    )
    """,
]


async def init_db():
    """Create connection pool and ensure pipecat tables exist."""
    global _pool
    _pool = await aiomysql.create_pool(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        db=DB_NAME,
        autocommit=True,
        charset="utf8mb4",
        minsize=2,
        maxsize=10,
    )
    # Create pipecat-owned tables (does not touch AstraPBX tables)
    async with _pool.acquire() as conn:
        async with conn.cursor() as cur:
            for ddl in PIPECAT_SCHEMA:
                await cur.execute(ddl)


async def close_db():
    global _pool
    if _pool:
        _pool.close()
        await _pool.wait_closed()
        _pool = None


def get_pool() -> aiomysql.Pool:
    if _pool is None:
        raise RuntimeError("Database not initialized")
    return _pool


async def fetchall(query: str, args: tuple = ()) -> list[dict]:
    """Execute a query and return all rows as dicts."""
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(query, args)
            return await cur.fetchall()


async def fetchone(query: str, args: tuple = ()) -> dict | None:
    """Execute a query and return the first row as a dict, or None."""
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(query, args)
            return await cur.fetchone()


async def execute(query: str, args: tuple = ()) -> int:
    """Execute a write query and return rows affected."""
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(query, args)
            return cur.rowcount
