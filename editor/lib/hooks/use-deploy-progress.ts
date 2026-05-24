"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Visual progress for "save → Asterisk reload" UX. Background: after PR
 * #295 the API actively waits for Asterisk's `module reload` to actually
 * complete before responding (3 sequential reloads × 2-5s each = 6-15s
 * per save). Without progress feedback the UI feels frozen.
 *
 * Strategy: time-based linear ramp toward `softCap` (default 95%) over
 * `expectedMs` (default 8s — measured average on staging). When the
 * actual API response lands, caller calls `finish()` to snap to 100%
 * then auto-hide after `holdMs`. On error, `abort()` hides immediately.
 *
 * The bar is "real" in the sense that it reflects elapsed time vs.
 * expected duration — not lying about server state, just smoothly
 * showing the wait. If the API takes longer than expectedMs, the bar
 * sits at softCap until the response arrives (honest signal that
 * something's running longer than usual).
 *
 *   const dp = useDeployProgress();
 *   async function save() {
 *     dp.start();
 *     try { await api.update(...); dp.finish(); }
 *     catch (e) { dp.abort(); throw e; }
 *   }
 *   return <>{dp.isDeploying && <Progress value={dp.progress} />}</>;
 */
export function useDeployProgress(opts?: {
  expectedMs?: number;
  softCap?: number;
  holdMs?: number;
}) {
  const expectedMs = opts?.expectedMs ?? 8000;
  const softCap = opts?.softCap ?? 95;
  const holdMs = opts?.holdMs ?? 600;

  const [progress, setProgress] = useState(0);
  const [isDeploying, setIsDeploying] = useState(false);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<number>(0);

  const clearTicker = useCallback(() => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  }, []);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    clearTicker();
    clearHideTimer();
    startedAtRef.current = Date.now();
    setProgress(2); // tiny initial value so the bar is visible immediately
    setIsDeploying(true);
    tickerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      // Linear ramp from 0 → softCap over expectedMs. After expectedMs,
      // stay pinned at softCap (the API is taking longer than expected;
      // honest signal not a lie).
      const next = Math.min(softCap, Math.round((elapsed / expectedMs) * softCap));
      setProgress(next);
    }, 100);
  }, [expectedMs, softCap, clearTicker, clearHideTimer]);

  const finish = useCallback(() => {
    clearTicker();
    setProgress(100);
    hideTimerRef.current = setTimeout(() => {
      setIsDeploying(false);
      setProgress(0);
      hideTimerRef.current = null;
    }, holdMs);
  }, [clearTicker, holdMs]);

  const abort = useCallback(() => {
    clearTicker();
    clearHideTimer();
    setIsDeploying(false);
    setProgress(0);
  }, [clearTicker, clearHideTimer]);

  // Cleanup on unmount — otherwise the interval keeps running after the
  // user navigates away.
  useEffect(() => {
    return () => {
      clearTicker();
      clearHideTimer();
    };
  }, [clearTicker, clearHideTimer]);

  return { progress, isDeploying, start, finish, abort };
}
