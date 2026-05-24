"use client";

interface ThrottleIndicatorProps {
  maxConcurrent: number | null;
  avgCallSeconds: number;
}

export function ThrottleIndicator({ maxConcurrent }: ThrottleIndicatorProps) {
  if (maxConcurrent === null) return null;

  return (
    <span className="cmp-chip" style={{ fontSize: 12 }}>
      Max {maxConcurrent} concurrent
    </span>
  );
}
