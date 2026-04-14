"""Template engine for resolving variables in flow JSON.

Supports template patterns:
  {args.department}                              → function argument value
  {state.queue_number}                           → flow_manager.state value
  {call.channel_id}                              → call_metadata value
  {value_map.department_queues.restaurant}        → static lookup
  {value_map.department_queues.{args.department}} → dynamic lookup (nested resolution)
"""

import re
from typing import Any, Dict, Optional

from loguru import logger

# Matches {args.x}, {state.x}, {call.x}, {value_map.x.y}, including nested {value_map.x.{args.y}}
# Uses a pattern that handles one level of nesting: matches innermost braces first
_TEMPLATE_PATTERN = re.compile(r"\{([^{}]*)\}")


def resolve_template(
    template: Any,
    *,
    args: Optional[Dict[str, Any]] = None,
    state: Optional[Dict[str, Any]] = None,
    call: Optional[Dict[str, Any]] = None,
    value_maps: Optional[Dict[str, Dict[str, str]]] = None,
) -> Any:
    """Resolve template variables in a string, dict, or list.

    For strings: replaces {args.x}, {state.x}, {call.x}, {value_map.name.key} patterns.
    For dicts: recursively resolves all string values.
    For lists: recursively resolves all items.
    Other types are returned as-is.
    """
    if isinstance(template, str):
        return _resolve_string(template, args=args, state=state, call=call, value_maps=value_maps)
    elif isinstance(template, dict):
        return {
            k: resolve_template(v, args=args, state=state, call=call, value_maps=value_maps)
            for k, v in template.items()
        }
    elif isinstance(template, list):
        return [
            resolve_template(item, args=args, state=state, call=call, value_maps=value_maps)
            for item in template
        ]
    return template


def _resolve_string(
    text: str,
    *,
    args: Optional[Dict[str, Any]] = None,
    state: Optional[Dict[str, Any]] = None,
    call: Optional[Dict[str, Any]] = None,
    value_maps: Optional[Dict[str, Dict[str, str]]] = None,
) -> str:
    """Resolve all template variables in a single string.

    Handles nested templates like {value_map.x.{args.y}} by resolving
    innermost braces first, then repeating until no templates remain.
    """
    args = args or {}
    state = state or {}
    call = call or {}
    value_maps = value_maps or {}

    def replacer(match: re.Match) -> str:
        expr = match.group(1)
        try:
            return _resolve_expression(expr, args=args, state=state, call=call, value_maps=value_maps)
        except Exception as e:
            logger.warning(f"Template resolution failed for '{{{expr}}}': {e}")
            return ""

    # Loop to handle nested templates — inner braces resolve first, then outer
    max_passes = 5
    for _ in range(max_passes):
        resolved = _TEMPLATE_PATTERN.sub(replacer, text)
        if resolved == text:
            break
        text = resolved
    return text


def _resolve_expression(
    expr: str,
    *,
    args: Dict[str, Any],
    state: Dict[str, Any],
    call: Dict[str, Any],
    value_maps: Dict[str, Dict[str, str]],
) -> str:
    """Resolve a single template expression like 'args.department' or 'value_map.depts.{args.department}'."""

    parts = expr.split(".", 1)
    if len(parts) < 2:
        return ""

    namespace, key = parts

    if namespace == "args":
        return str(args.get(key, ""))

    elif namespace == "state":
        return str(state.get(key, ""))

    elif namespace == "call":
        return str(call.get(key, ""))

    elif namespace == "value_map":
        # key is "map_name.lookup_key" e.g., "department_queues.restaurant"
        map_parts = key.split(".", 1)
        if len(map_parts) < 2:
            logger.warning(f"Invalid value_map reference: {expr}")
            return ""
        map_name, lookup_key = map_parts
        vmap = value_maps.get(map_name, {})
        result = vmap.get(lookup_key, "")
        if not result:
            logger.warning(f"Value map lookup miss: {map_name}[{lookup_key}]")
        return str(result)

    else:
        logger.warning(f"Unknown template namespace: {namespace}")
        return ""
