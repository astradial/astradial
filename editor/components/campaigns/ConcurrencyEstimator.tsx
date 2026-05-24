"use client";

interface ConcurrencyEstimatorProps {
  totalLeads: number;
  maxConcurrentCalls: number | null;
  maxSendsPerMinute: number | null;
  avgCallSeconds: number;
  hasCallActions: boolean;
  hasWhatsappActions: boolean;
}

export function ConcurrencyEstimator({
  totalLeads,
  maxConcurrentCalls,
  maxSendsPerMinute,
  avgCallSeconds,
  hasCallActions,
  hasWhatsappActions,
}: ConcurrencyEstimatorProps) {
  if (totalLeads === 0) return null;

  const effectiveMaxConcurrent = maxConcurrentCalls ?? 10;
  const effectiveAvgCallSeconds = avgCallSeconds > 0 ? avgCallSeconds : 180;

  let label: string | null = null;

  if (hasCallActions && hasWhatsappActions) {
    const callHours = (totalLeads / effectiveMaxConcurrent) * (effectiveAvgCallSeconds / 3600);
    if (maxSendsPerMinute && maxSendsPerMinute > 0) {
      const waMinutes = totalLeads / maxSendsPerMinute;
      const waHours = waMinutes / 60;
      const dominant = callHours >= waHours ? `~${callHours.toFixed(1)} hours` : `~${waMinutes.toFixed(0)} minutes`;
      label = `Estimated completion: ${dominant}`;
    } else {
      label = `Estimated completion: ~${callHours.toFixed(1)} hours`;
    }
  } else if (hasCallActions) {
    const callHours = (totalLeads / effectiveMaxConcurrent) * (effectiveAvgCallSeconds / 3600);
    label = `Estimated completion: ~${callHours.toFixed(1)} hours`;
  } else if (hasWhatsappActions) {
    if (maxSendsPerMinute && maxSendsPerMinute > 0) {
      const waMinutes = totalLeads / maxSendsPerMinute;
      label = `Estimated completion: ~${waMinutes.toFixed(0)} minutes`;
    }
  }

  if (!label) return null;

  return (
    <span
      style={{
        fontSize: 12,
        color: "var(--muted-foreground)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {label}
    </span>
  );
}
