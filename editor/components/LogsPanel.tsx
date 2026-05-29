"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { bots } from "@/lib/gateway/client";

interface LogsPanelProps {
  orgId: string;
  botId: string;
  onClose?: () => void;
}

interface LogLine {
  id: number;
  text: string;
  category: "error" | "transcription" | "function" | "webhook" | "default";
}

const MAX_LINES = 500;

function categorize(line: string): LogLine["category"] {
  const lower = line.toLowerCase();
  if (lower.includes("error")) return "error";
  if (lower.includes("transcription")) return "transcription";
  if (lower.includes("function") || lower.includes("transition")) return "function";
  if (lower.includes("webhook")) return "webhook";
  return "default";
}

const categoryColors: Record<LogLine["category"], string> = {
  error: "text-red-400",
  transcription: "text-blue-400",
  function: "text-green-400",
  webhook: "text-yellow-400",
  default: "text-gray-300",
};

let lineIdCounter = 0;

export default function LogsPanel({ orgId, botId, onClose }: LogsPanelProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScroll.current = atBottom;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && autoScroll.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;

    async function connect() {
      const url = await bots.logStreamUrl(orgId, botId);
      if (cancelled) return;
      es = new EventSource(url);

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      const text = event.data;
      if (!text) return;
      const entry: LogLine = {
        id: ++lineIdCounter,
        text,
        category: categorize(text),
      };
      setLines((prev) => {
        const next = [...prev, entry];
        if (next.length > MAX_LINES) {
          return next.slice(next.length - MAX_LINES);
        }
        return next;
      });
    };

    es.onerror = () => setConnected(false);
    }

    connect();

    return () => {
      cancelled = true;
      es?.close();
      setConnected(false);
    };
  }, [orgId, botId]);

  const handleClear = () => setLines([]);

  return (
    <div className="flex flex-col h-full border-t border-border bg-[#0d1117]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-border bg-[#161b22]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-400">Live Logs</span>
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              connected ? "bg-green-500" : "bg-red-500"
            }`}
            title={connected ? "Connected" : "Disconnected"}
          />
          <span className="text-[10px] text-gray-500">
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            className="text-[10px] text-gray-500 hover:text-gray-300 px-2 py-0.5 rounded hover:bg-gray-800 transition-colors"
          >
            Clear
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-800 transition-colors text-sm font-medium"
            >
              &times;
            </button>
          )}
        </div>
      </div>

      {/* Log output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-1 font-mono text-xs leading-5"
      >
        {lines.length === 0 && (
          <div className="text-gray-600 py-2">Waiting for log entries...</div>
        )}
        {lines.map((line) => (
          <div key={line.id} className={`whitespace-pre-wrap break-all ${categoryColors[line.category]}`}>
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}
