import { NextRequest, NextResponse } from "next/server";

// Server-side: get a JWT for an org by calling PBX internal API
const PBX_URL = process.env.NEXT_PUBLIC_PBX_URL || "http://localhost:8000";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

export async function POST(req: NextRequest) {
  const { org_id } = await req.json();

  if (!org_id) {
    return NextResponse.json({ error: "org_id required" }, { status: 400 });
  }

  if (!INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Internal API key not configured" }, { status: 500 });
  }

  try {
    // Call PBX email-login-like endpoint using internal key to get JWT for this org
    // We use the internal key to bypass normal auth
    const res = await fetch(`${PBX_URL}/api/v1/auth/admin-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": INTERNAL_API_KEY,
      },
      body: JSON.stringify({ org_id }),
    });

    if (!res.ok) {
      if (process.env.NEXT_PUBLIC_DEV_UI === "true") {
        return NextResponse.json({
          token: "demo.jwt.token",
          org_name: "UI Sandbox Organisation"
        });
      }
      return NextResponse.json({ error: "Failed to get org token" }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    if (process.env.NEXT_PUBLIC_DEV_UI === "true") {
      return NextResponse.json({
        token: "demo.jwt.token",
        org_name: "UI Sandbox Organisation"
      });
    }
    return NextResponse.json({ error: "PBX unreachable" }, { status: 502 });
  }
}
