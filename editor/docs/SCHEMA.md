# Pipecat Flows Schema

This document mirrors the authoritative TypeBox schema located at `lib/schema/flow.schema.ts`. All flows imported/exported by the editor must follow this structure.

> Schema ID: `https://flows.pipecat.ai/schema/flow.json`

## Top-Level Shape (`FlowSchema`)

```ts
type FlowSchema = {
  $schema?: string;
  $id?: string;
  meta: FlowMeta;
  context?: Record<string, unknown>;
  global_functions?: GlobalFunction[];
  nodes: FlowNode[]; // min 1
  edges: FlowEdge[]; // visualization only (derived from routing)
};
```

- `meta` – Display information (`name`, optional `version`, optional `description`)
- `context` – Arbitrary metadata carried with the flow (not interpreted by the editor)
- `global_functions` – Functions registered on every node in Pipecat
- `nodes` – Canvas nodes that map 1:1 to Pipecat `NodeConfig`
- `edges` – Computed from function routing so the canvas can visualize connections. Routing logic lives on functions (`next_node_id` / `decision`), not on edges.

## Nodes

```ts
type FlowNode = {
  id: string;
  type: "initial" | "node" | "end";
  position: { x: number; y: number };
  data: CommonNodeData & Record<string, unknown>;
};
```

- `initial` – Entry point: must contain `role_messages` (Pipecat expects an initial persona)
- `node` – Standard conversational step
- `end` – Usually contains a `post_actions` item with `{ type: "end_conversation" }`

### Common Node Data

```ts
type CommonNodeData = {
  label?: string;
  role_messages?: Message[];
  task_messages?: Message[];
  functions?: FlowFunction[];
  pre_actions?: Action[];
  post_actions?: Action[];
  context_strategy?: ContextStrategyConfig;
  respond_immediately?: boolean; // defaults to true
};
```

- `label` – Display name used in the canvas/palette
- `role_messages` – Pipecat role messages (`role` = `system` | `user` | `assistant`, `content` = string)
- `task_messages` – Step-specific instructions
- `functions` – Available `FlowsFunctionSchema` entries for this node
- `pre_actions` / `post_actions` – Pipecat actions executed before/after the node
- `context_strategy` – Controls Pipecat context accumulation (`APPEND`, `RESET`, `RESET_WITH_SUMMARY`)
- `respond_immediately` – Set to `false` if the node should wait before responding

### Functions

```ts
type FlowFunction = {
  name: string;
  description: string;
  properties?: Record<string, FunctionProperty>;
  required?: string[];
  next_node_id?: string;
  decision?: Decision;
};
```

`properties` and `required` follow JSON Schema semantics and become the arguments that Pipecat hands to the function handler.

#### FunctionProperty

```ts
type FunctionProperty = {
  type: string; // e.g., "string", "number", "boolean", "integer"
  description?: string;
  enum?: Array<string | number>;
  minimum?: number;
  maximum?: number;
  pattern?: string;
};
```

### Decisions

Functions optionally include a `decision` block to express conditional routing without creating extra nodes.

```ts
type Decision = {
  action: string; // Python code snippet (must set `result`)
  conditions: DecisionCondition[];
  default_next_node_id: string;
  decision_node_position?: { x: number; y: number }; // for canvas layout fidelity
};

type DecisionCondition = {
  operator: "<" | "<=" | "==" | ">=" | ">" | "!=" | "not" | "in" | "not in";
  value: string;
  next_node_id: string;
};
```

- During export, `action` is inserted verbatim into the generated Python handler.
- Conditions convert into `if/elif` statements.
- The optional `decision_node_position` ensures that re-importing JSON preserves the helper decision node position shown in the UI.

### Actions

```ts
type Action = {
  type: string; // e.g., "function", "end_conversation", "tts_say"
  handler?: string; // reference to the Python handler for "function"
  text?: string; // spoken text for "tts_say"
};
```

### Context Strategy

```ts
type ContextStrategyConfig = {
  strategy: "APPEND" | "RESET" | "RESET_WITH_SUMMARY";
  summary_prompt?: string; // only for RESET_WITH_SUMMARY
};
```

## Global Functions

Global functions share the same structure as node functions minus routing fields:

```ts
type GlobalFunction = {
  name: string;
  description: string;
  properties?: Record<string, FunctionProperty>;
  required?: string[];
};
```

They become `FlowsFunctionSchema` instances registered on the `FlowManager` itself (available to every node).

## Edges

```ts
type FlowEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  priority?: number; // >= 0
  condition?: {
    expression?: string;
    language?: "python" | "jinja" | "dsl";
  };
};
```

Edges are generated from `functions[].next_node_id` and `functions[].decision` metadata when exporting React Flow state. They ensure the canvas keeps meaningful lines between nodes but **do not control routing**—the routing data always lives in the function definitions.

## Validation

Validation happens in two layers (`lib/validation/validator.ts`):

1. **Ajv / TypeBox schema** – Enforces structural correctness.
2. **Custom graph checks** – Guarantees:
   - Node IDs are unique.
   - All edge endpoints point to existing nodes.

The export flow blocks downloads until both layers pass. Errors are surfaced in the UI via toasts and console logs.

## Example

See `lib/examples/` for complete JSON samples (`minimal.json`, `food_ordering.json`). They are guaranteed to match the schema and serve as good references for new flows.
