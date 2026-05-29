import { describe, expect, it } from "vitest";

import { flowJsonToReactFlow, reactFlowToFlowJson } from "@/lib/convert/flowAdapters";
import type { FlowFunctionJson } from "@/lib/schema/flow.schema";
import { FlowEdge, FlowNode } from "@/lib/types/flowTypes";

const simpleFunction: FlowFunctionJson = {
  name: "goToB",
  description: "Route to node B",
  next_node_id: "b",
};

describe("adapters", () => {
  it("derives edges from node functions and converts back", () => {
    const nodes = [
      {
        id: "a",
        type: "initial",
        position: { x: 0, y: 0 },
        data: { label: "A", functions: [simpleFunction] },
      },
      {
        id: "b",
        type: "end",
        position: { x: 100, y: 0 },
        data: { label: "B" },
      },
    ] as FlowNode[];
    const json = reactFlowToFlowJson(nodes, [] as FlowEdge[]);
    expect(json.nodes.length).toBe(2);
    expect(json.edges.length).toBe(1);
    expect(json.edges[0]).toMatchObject({ source: "a", target: "b", label: "goToB" });

    const rf = flowJsonToReactFlow(json);
    expect(rf.nodes.length).toBe(2);
    expect(rf.edges.length).toBe(1);
    expect(rf.edges[0]).toMatchObject({ source: "a", target: "b", label: "goToB" });
  });
});
