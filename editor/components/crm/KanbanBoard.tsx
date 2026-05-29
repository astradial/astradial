"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface KanbanItem {
  id: string;
  stage: string;
  [key: string]: unknown;
}

interface KanbanBoardProps<T extends KanbanItem> {
  stages: readonly string[];
  stageLabels: Record<string, string>;
  items: T[];
  onStageChange: (itemId: string, newStage: string) => void;
  renderCard: (item: T) => React.ReactNode;
}

function DraggableCard<T extends KanbanItem>({ item, renderCard }: { item: T; renderCard: (item: T) => React.ReactNode }) {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div
      data-card-id={item.id}
      style={{ opacity: isDragging ? 0.5 : 1 }}
    >
      {renderCard(item)}
    </div>
  );
}

function DroppableColumn({ id, label, count, children }: { id: string; label: string; count: number; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id });

  return (
    <div className="flex-shrink-0 w-72">
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="text-sm font-medium">{label}</h3>
        <Badge variant="secondary" className="text-xs">{count}</Badge>
      </div>
      <div
        ref={setNodeRef}
        className={`space-y-2 min-h-[200px] p-2 rounded-lg border border-dashed transition-colors ${
          isOver ? "bg-accent/60 border-primary" : "bg-accent/30 border-border"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export function KanbanBoard<T extends KanbanItem>({ stages, stageLabels, items, onStageChange, renderCard }: KanbanBoardProps<T>) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const activeItem = activeId ? items.find(i => i.id === activeId) : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const itemId = String(active.id);
    const overId = String(over.id);

    // Dropped on a stage column
    if (stages.includes(overId)) {
      const item = items.find(i => i.id === itemId);
      if (item && item.stage !== overId) {
        onStageChange(itemId, overId);
      }
      return;
    }

    // Dropped on another card — move to that card's stage
    const overItem = items.find(i => i.id === overId);
    if (overItem) {
      const item = items.find(i => i.id === itemId);
      if (item && item.stage !== overItem.stage) {
        onStageChange(itemId, overItem.stage);
      }
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map(stage => {
          const stageItems = items.filter(i => i.stage === stage);

          return (
            <DroppableColumn key={stage} id={stage} label={stageLabels[stage] || stage} count={stageItems.length}>
              {stageItems.map(item => (
                <DraggableItem key={item.id} id={item.id}>
                  {renderCard(item)}
                </DraggableItem>
              ))}
              {stageItems.length === 0 && (
                <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
                  Drop here
                </div>
              )}
            </DroppableColumn>
          );
        })}
      </div>
      <DragOverlay>
        {activeItem ? <div className="rotate-2 shadow-lg">{renderCard(activeItem)}</div> : null}
      </DragOverlay>
    </DndContext>
  );
}

// Separate draggable item using the core useDraggable
import { useDraggable } from "@dnd-kit/core";

function DraggableItem({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });

  const style = {
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
    opacity: isDragging ? 0.5 : 1,
    cursor: "grab",
  };

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      {children}
    </div>
  );
}
