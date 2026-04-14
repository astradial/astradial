import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const MOH_DIR = "/var/lib/asterisk/moh";
const GREETINGS_DIR = "/var/lib/asterisk/sounds/greetings";

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;

  const type = segments[0]; // "moh", "moh-list", or "greetings"

  // Handle moh-list before length check (only 1 segment)
  if (type === "moh-list") {
    const { readdirSync } = require("fs");
    try {
      const files = readdirSync(MOH_DIR).filter((f: string) => f.endsWith(".wav") || f.endsWith(".mp3") || f.endsWith(".ogg"));
      return NextResponse.json({ files });
    } catch {
      return NextResponse.json({ files: [] });
    }
  }

  if (segments.length < 2) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  let filePath = "";

  if (type === "moh") {
    // /api/audio/moh/{class_or_file} or /api/audio/moh/{class_name}/{filename}
    if (segments.length === 2) {
      // Direct file from root MOH dir (system default files)
      filePath = path.join(MOH_DIR, segments[1]);
    } else {
      const className = segments[1];
      const filename = segments.slice(2).join("/");
      filePath = path.join(MOH_DIR, className, filename);
    }
  } else if (type === "greetings") {
    // /api/audio/greetings/{id}/audio → greeting_{id}.wav
    const greetingId = segments[1];
    filePath = path.join(GREETINGS_DIR, `greeting_${greetingId}.wav`);
  } else {
    return NextResponse.json({ error: "Unknown audio type" }, { status: 404 });
  }

  // Security: prevent directory traversal
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(MOH_DIR) && !resolved.startsWith(GREETINGS_DIR)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!existsSync(resolved)) {
    return NextResponse.json({ error: "File not found", path: resolved }, { status: 404 });
  }

  try {
    const data = await readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".wav": "audio/wav",
      ".mp3": "audio/mpeg",
      ".ogg": "audio/ogg",
      ".flac": "audio/flac",
    };

    return new NextResponse(data, {
      headers: {
        "Content-Type": mimeTypes[ext] || "audio/wav",
        "Content-Length": String(data.length),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Read error" }, { status: 500 });
  }
}
