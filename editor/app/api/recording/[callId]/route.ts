import { NextRequest, NextResponse } from "next/server";

const PBX_URL = process.env.NEXT_PUBLIC_PBX_URL || "http://localhost:8000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  const { callId } = await params;

  const token = req.nextUrl.searchParams.get("token") || req.headers.get("authorization")?.replace("Bearer ", "") || "";
  const apiKey = req.nextUrl.searchParams.get("key") || req.headers.get("x-api-key") || "";

  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  else if (apiKey) headers["X-API-Key"] = apiKey;

  // Pass-through the browser's Range header so the upstream PBX can
  // respond with 206 Partial Content. Without this, `<audio>` seek
  // resets to 0 — the browser asks for `bytes=N-` on every scrub,
  // and a 200 response (full body) makes it re-buffer from the start.
  const rangeHeader = req.headers.get("range");
  if (rangeHeader) headers["Range"] = rangeHeader;

  if (!token && !apiKey) {
    return NextResponse.json({ error: "Auth required" }, { status: 401 });
  }

  try {
    const upstream = await fetch(`${PBX_URL}/api/v1/calls/${callId}/recording`, { headers });

    if (!upstream.ok && upstream.status !== 206) {
      const body = await upstream.text();
      return NextResponse.json({ error: body }, { status: upstream.status });
    }

    // Stream the upstream body through without buffering — protects
    // server memory on long calls and preserves Range semantics.
    const respHeaders = new Headers({
      "Content-Type": upstream.headers.get("content-type") || "audio/wav",
      "Content-Disposition": upstream.headers.get("content-disposition") || `inline; filename="recording.wav"`,
      "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
      "Cache-Control": "private, max-age=3600",
    });
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) respHeaders.set("Content-Length", contentLength);
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) respHeaders.set("Content-Range", contentRange);

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch {
    return NextResponse.json({ error: "PBX unreachable" }, { status: 502 });
  }
}
