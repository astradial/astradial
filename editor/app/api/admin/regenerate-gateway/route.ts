import { NextResponse } from "next/server";

const PBX_URL = process.env.NEXT_PUBLIC_PBX_URL || "http://localhost:8000";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

export async function POST() {
  if (!INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Internal API key not configured" }, { status: 500 });
  }
  try {
    const res = await fetch(`${PBX_URL}/api/v1/admin/regenerate-gateway`, {
      method: "POST",
      headers: { "X-Internal-Key": INTERNAL_API_KEY },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
