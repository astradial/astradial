import { NextRequest, NextResponse } from "next/server";

const PBX_URL = process.env.NEXT_PUBLIC_PBX_URL || "http://localhost:8000";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  const { callId } = await params;

  // Get auth from query param, request header, or cookie
  const token = req.nextUrl.searchParams.get("token") || req.headers.get("authorization")?.replace("Bearer ", "") || "";
  const apiKey = req.nextUrl.searchParams.get("key") || req.headers.get("x-api-key") || "";

  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  else if (apiKey) headers["X-API-Key"] = apiKey;

  if (!token && !apiKey) {
    return NextResponse.json({ error: "Auth required" }, { status: 401 });
  }

  try {
    const res = await fetch(`${PBX_URL}/api/v1/calls/${callId}/recording`, { headers });

    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json({ error: body }, { status: res.status });
    }

    const data = await res.arrayBuffer();
    const filename = res.headers.get("content-disposition")?.match(/filename="(.+)"/)?.[1] || "recording.wav";

    return new NextResponse(data, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(data.byteLength),
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "PBX unreachable" }, { status: 502 });
  }
}
