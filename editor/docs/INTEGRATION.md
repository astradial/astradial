# Pipecat Integration Guide

This document explains how to take a flow built in the visual editor and run it inside a Pipecat application.

## Flow Lifecycle

1. **Design** – Build and validate the flow inside the editor. Nodes map directly to Pipecat `NodeConfig` objects.
2. **Export** – Use the toolbar to export either:
   - `flow.json` (schema-compliant Pipecat Flow JSON)
   - `<flow_name>_flow.py` (generated Python scaffolding produced by `lib/codegen/pythonGenerator.ts`)
3. **Implement handlers** – Fill in the TODO sections in the generated Python file (or write your own implementation if consuming JSON manually).
4. **Run in Pipecat** – Load the generated node factories, instantiate a `FlowManager`, and call `initialize` with the initial node when your transport connects.

## Export Formats

### JSON

`flow.json` is the canonical data model used in the editor and contains:

- `meta`, `context`, `global_functions`
- `nodes[]` with Pipecat `NodeConfig` fields (messages, functions, actions, context strategy, respond_immediately)
- Function-level routing via `next_node_id` or `decision`
- Visualization edges derived from the routing data

Use JSON if you want to plug the editor into a custom runtime, build your own generator, or version the declarative representation of the flow.

### Generated Python

Selecting **Export → Export Python** downloads a ready-to-run scaffold:

- One `create_<node_id>_node()` function per node
- `FlowsFunctionSchema` definitions (including Field metadata) and async handler stubs
- Decision routing rendered as Python `if / elif / else` blocks
- Optional context strategy wiring (adds `ContextStrategyConfig` imports only when needed)
- Placeholder FlowManager setup showing where to plug in your Pipecat pipeline and transport events

Every handler contains TODOs for your business logic and already returns `(FlowResult | None, NodeConfig | None)` in the proper shape.

## Using the Generated Python

1. **Install Pipecat Flows** (and your preferred transports/services):

```bash
pip install pipecat pipecat-ai-flows
```

2. **Save the generated file** (e.g., `food_ordering_flow.py`) somewhere importable by your bot.

3. **Wire it into your Pipecat entrypoint**:

```python
from pipecat_flows import FlowManager
from pipecat_flows.transport import BaseTransport

from food_ordering_flow import (
    create_initial_node,
    # ...any other helpers you want to reference directly
)

flow_manager = FlowManager(
    task=task,
    llm=llm,
    context_aggregator=context_aggregator,
    transport=transport,
    # global_functions=[...],  # uncomment if your flow defines them
)

@transport.event_handler("on_client_connected")
async def on_client_connected(transport: BaseTransport, client):
    await flow_manager.initialize(create_initial_node())
```

4. **Implement the handlers** generated in the file. Each handler already receives `(args, flow_manager)` so you can:
   - Read user input or prior outputs from `args`
   - Store intermediate data in `flow_manager.state`
   - Decide what node to visit next (or rely on decisions/`next_node_id`)

### Decision Handling

If a function in the editor contains a decision:

- The generated handler includes the `action` block (your expression, evaluated server-side).
- Conditions become `if/elif` checks that route to `create_<node_id>_node()` functions.
- The editor also stores optional `decision_node_position` so re-importing Python-exported JSON maintains the layout of helper decision nodes in the UI.

## Using JSON Directly

If you prefer to consume the JSON yourself:

| JSON Field                               | Pipecat Usage                                        |
| ---------------------------------------- | ---------------------------------------------------- |
| `node.id`                                | `NodeConfig.name`                                    |
| `node.data.role_messages`                | `NodeConfig.role_messages`                           |
| `node.data.task_messages`                | `NodeConfig.task_messages`                           |
| `node.data.functions[]`                  | `FlowsFunctionSchema` definitions                    |
| `node.data.functions[].next_node_id`     | Return value `(…, create_<id>_node())`               |
| `node.data.functions[].decision`         | Custom logic that maps to handler code               |
| `node.data.pre_actions` / `post_actions` | Passed directly into `NodeConfig`                    |
| `node.data.context_strategy`             | Adds `ContextStrategyConfig`                         |
| `global_functions`                       | Optional functions registered on every node          |
| `edges`                                  | Visualization only (derived from the routing fields) |

The TypeBox schema is documented in [docs/SCHEMA.md](./SCHEMA.md).

## Validation & Tooling

- JSON exports are validated via Ajv and custom graph checks before they leave the editor.
- Python exports run the same validation first; generation is blocked until the flow passes.
- Re-importing either JSON or edited Python (converted back to JSON) keeps decision positions, function metadata, and context strategy aligned with the UI.

## References

- [Pipecat Flows API Reference](https://reference-flows.pipecat.ai/en/latest/)
- [Official Food Ordering Example](https://github.com/pipecat-ai/pipecat-flows/blob/main/examples/food_ordering.py)
- [Feature Guide](https://docs.pipecat.ai/guides/features/pipecat-flows)
