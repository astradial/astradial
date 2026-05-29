// Pure reducer for the Studio workflow editor. No DOM, no fetch — safe
// to unit-test in isolation. Mirrors the actions the editor surface
// supports: add/edit/delete/reorder days and actions.

import type { ActionType, Workflow, WorkflowAction, WorkflowDay } from "./types";

let _idSeed = 0;
function nextId(prefix: string): string {
  _idSeed += 1;
  // Stable enough across a session; server doesn't care since these
  // ids are scoped to the workflow JSON and never leave the document.
  return `${prefix}_${Date.now().toString(36)}_${_idSeed}`;
}

export type WorkflowEvent =
  | { type: "ADD_DAY"; gap?: number }
  | { type: "DELETE_DAY"; dayId: string }
  | { type: "REORDER_DAYS"; from: number; to: number }
  | { type: "SET_DAY_GAP"; dayId: string; gap: number }
  | {
      type: "ADD_ACTION";
      dayId: string;
      action: Pick<WorkflowAction, "type"> & Partial<WorkflowAction>;
    }
  | { type: "DELETE_ACTION"; dayId: string; actionId: string }
  | { type: "REORDER_ACTIONS"; dayId: string; from: number; to: number }
  | { type: "UPDATE_ACTION"; dayId: string; actionId: string; patch: Partial<WorkflowAction> }
  | { type: "SET_META"; meta: Workflow["meta"] };

function replaceDay(
  days: WorkflowDay[],
  dayId: string,
  fn: (d: WorkflowDay) => WorkflowDay
): WorkflowDay[] {
  return days.map((d) => (d.id === dayId ? fn(d) : d));
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
  const next = arr.slice();
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

export function workflowReducer(state: Workflow, ev: WorkflowEvent): Workflow {
  switch (ev.type) {
    case "ADD_DAY": {
      const day: WorkflowDay = {
        id: nextId("d"),
        gap: ev.gap ?? (state.days.length === 0 ? 0 : 1),
        actions: [],
      };
      return { ...state, days: [...state.days, day] };
    }
    case "DELETE_DAY":
      return { ...state, days: state.days.filter((d) => d.id !== ev.dayId) };
    case "REORDER_DAYS":
      return { ...state, days: move(state.days, ev.from, ev.to) };
    case "SET_DAY_GAP":
      return {
        ...state,
        days: replaceDay(state.days, ev.dayId, (d) => ({
          ...d,
          gap: Math.max(0, Math.floor(ev.gap)),
        })),
      };
    case "ADD_ACTION": {
      const a: WorkflowAction = {
        id: nextId("a"),
        ...ev.action,
        type: ev.action.type as ActionType,
      };
      return {
        ...state,
        days: replaceDay(state.days, ev.dayId, (d) => ({ ...d, actions: [...d.actions, a] })),
      };
    }
    case "DELETE_ACTION":
      return {
        ...state,
        days: replaceDay(state.days, ev.dayId, (d) => ({
          ...d,
          actions: d.actions.filter((a) => a.id !== ev.actionId),
        })),
      };
    case "REORDER_ACTIONS":
      return {
        ...state,
        days: replaceDay(state.days, ev.dayId, (d) => ({
          ...d,
          actions: move(d.actions, ev.from, ev.to),
        })),
      };
    case "UPDATE_ACTION":
      return {
        ...state,
        days: replaceDay(state.days, ev.dayId, (d) => ({
          ...d,
          actions: d.actions.map((a) => (a.id === ev.actionId ? { ...a, ...ev.patch } : a)),
        })),
      };
    case "SET_META":
      return { ...state, meta: { ...(state.meta || {}), ...(ev.meta || {}) } };
    default:
      return state;
  }
}

export function emptyWorkflow(name?: string): Workflow {
  return { meta: { name, version: 1 }, days: [] };
}
