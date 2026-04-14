import importlib.util
import sys
from pathlib import Path
from types import ModuleType

from loguru import logger

from gateway.config import BOTS_DIR

# Cache: module_path -> (module, mtime)
_cache: dict[str, tuple[ModuleType, float]] = {}


def load_bot_module(module_path: str) -> ModuleType:
    """Load a bot module from bots/{module_path}/__init__.py.

    Hot-reloads if the file has been modified since last load.
    Validates the module exports create_welcome_node().
    """
    pkg_dir = BOTS_DIR / module_path
    init_file = pkg_dir / "__init__.py"

    if not init_file.exists():
        raise FileNotFoundError(f"Bot module not found: {init_file}")

    current_mtime = init_file.stat().st_mtime
    cached = _cache.get(module_path)
    if cached and cached[1] >= current_mtime:
        return cached[0]

    full_name = f"bots.{module_path}"
    if full_name in sys.modules:
        del sys.modules[full_name]

    spec = importlib.util.spec_from_file_location(full_name, init_file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[full_name] = module
    spec.loader.exec_module(module)

    if not hasattr(module, "create_welcome_node"):
        raise ValueError(f"Bot module '{module_path}' missing create_welcome_node()")

    _cache[module_path] = (module, current_mtime)
    logger.info(f"Loaded bot module: {module_path}")
    return module
