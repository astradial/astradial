import { NextRequest, NextResponse } from "next/server";

const PBX_URL = process.env.NEXT_PUBLIC_PBX_URL || "http://localhost:8000";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Server-side call to astrapbx with admin credentials
    const res = await fetch(`${PBX_URL}/api/v1/organizations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        admin_username: ADMIN_USERNAME,
        admin_password: ADMIN_PASSWORD,
        ...body,
      }),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create organisation" },
      { status: 500 }
    );
  }
}
