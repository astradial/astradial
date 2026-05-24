"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

/**
 * Floating-pill progress indicator pinned to the viewport bottom — same
 * geometry as the audio-preview pill on the Departments page so the
 * editor has one consistent transient-overlay pattern.
 *
 * Driven by `useDeployProgress` hook. Renders only while `isDeploying`
 * is true OR for the 600 ms post-completion hold (so the user sees the
 * "✓ Done" state before the pill slides away).
 *
 * The progress value is a time-based ramp (not a true server-state
 * percentage) — see the hook for trade-offs. Sit-at-95% behaviour when
 * the API takes longer than expected is intentional: the bar pins at
 * the soft cap until the response lands, which is an honest "this is
 * taking longer than usual" signal rather than a fake completion.
 *
 * Multi-stage messaging keeps the operator informed about what phase
 * the save is in, mapped to progress %:
 *   0-15%   → "Saving changes…"      (DB write in flight)
 *   15-90%  → "Applying to Asterisk…" (the slow reload wait)
 *   90-99%  → "Almost done…"
 *   100%    → "Done"                  (briefly, then hides)
 *
 * Color treatment shifts on completion: primary → green to reinforce
 * the success state visually.
 */
export function DeployProgressBar({
  isDeploying,
  progress,
}: {
  isDeploying: boolean;
  progress: number;
}) {
  if (!isDeploying) return null;

  const isComplete = progress >= 100;
  const label = isComplete
    ? "Done"
    : progress < 15
      ? "Saving changes…"
      : progress < 90
        ? "Applying to Asterisk…"
        : "Almost done…";

  return (
    // z-[100] so the pill stays ABOVE Dialog/Sheet overlays.
    // shadcn's DialogOverlay + DialogContent are both z-50 (verified in
    // components/ui/dialog.tsx lines 24 + 41). With the pill also at
    // z-50, render order is ambiguous and the modal overlay's
    // bg-black/80 ended up painting over the pill — visible-but-dimmed
    // symptom reported on the DIDs edit dialog during the staging UAT
    // on 2026-05-23. z-[100] is strictly higher than every other
    // overlay in the editor, matching the toast notification layer.
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 rounded-full border bg-background/95 backdrop-blur px-5 py-2.5 shadow-lg min-w-[340px] max-w-[440px] animate-in fade-in slide-in-from-bottom-2 duration-200"
      role="status"
      aria-live="polite"
    >
      <div className="shrink-0">
        {isComplete ? (
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500" />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={`text-xs font-medium leading-none mb-1.5 transition-colors duration-200 ${
            isComplete ? "text-green-700 dark:text-green-500" : "text-foreground"
          }`}
        >
          {label}
        </div>
        <Progress
          value={progress}
          className={`h-1.5 transition-colors duration-200 ${
            isComplete ? "[&>div]:bg-green-600 dark:[&>div]:bg-green-500" : ""
          }`}
        />
      </div>
      <div
        className={`text-[10px] tabular-nums w-9 text-right shrink-0 transition-colors duration-200 ${
          isComplete ? "text-green-700 dark:text-green-500" : "text-muted-foreground"
        }`}
      >
        {progress}%
      </div>
    </div>
  );
}
