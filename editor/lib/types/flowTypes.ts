import type { Edge, Node, ReactFlowInstance as RFInstance } from "@xyflow/react";

import type {
  ActionJson,
  ContextStrategyConfigJson,
  FlowFunctionJson,
  MessageJson,
} from "@/lib/schema/flow.schema";

// Node data type that extends CommonNodeData
export interface FlowNodeData {
  label?: string;
  type?: "initial" | "node" | "end" | "decision";
  role_messages?: MessageJson[];
  task_messages?: MessageJson[];
  functions?: FlowFunctionJson[];
  pre_actions?: ActionJson[];
  post_actions?: ActionJson[];
  context_strategy?: ContextStrategyConfigJson;
  respond_immediately?: boolean;
  // Decision node specific fields
  action?: string;
  conditionCount?: number;
  sourceNodeId?: string;
  functionName?: string;
  // Allow additional properties
  [key: string]: unknown;
}

// Decision node data type
export interface DecisionNodeData extends FlowNodeData {
  label: string;
  action: string;
  conditionCount: number;
  sourceNodeId?: string;
  functionName?: string;
}

// React Flow node type with our data
export type FlowNode = Node<FlowNodeData, "initial" | "node" | "end" | "decision">;

// React Flow edge type
export type FlowEdge = Edge;

// React Flow instance type
export type ReactFlowInstance = RFInstance<FlowNode, FlowEdge>;
