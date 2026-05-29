import { describe, expect, it } from "vitest";

import minimal from "@/lib/examples/minimal.json";
import { FlowJson } from "@/lib/schema/flow.schema";
import { customGraphChecks, validateFlowJson } from "@/lib/validation/validator";

describe("validator", () => {
  it("validates minimal example", () => {
    const r = validateFlowJson(minimal);
    expect(r.valid).toBe(true);
    const custom = customGraphChecks(minimal as FlowJson);
    expect(custom.length).toBe(0);
  });

  it("detects duplicate node id", () => {
    const dup = JSON.parse(JSON.stringify(minimal));
    dup.nodes.push({ ...dup.nodes[0] });
    validateFlowJson(dup);
    // schema may still be valid; custom should catch duplicate id
    const custom = customGraphChecks(dup as FlowJson);
    expect(custom.some((e) => String(e.message).includes("Duplicate node id"))).toBe(true);
  });
});
