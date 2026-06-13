/**
 * Editor server-side proxy for the admin "Test Send" button.
 *
 * Fires a single MSG91 template message to the supplied phone with
 * sample variables, so an admin can verify config before the daily
 * 18:00 IST cron runs.
 */

import { NextRequest, NextResponse } from "next/server";

const PBX_URL = process.env.NEXT_PUBLIC_PBX_URL || "http://localhost:8000";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";
const GATEWAY_ADMIN_KEY = process.env.GATEWAY_ADMIN_KEY || "";

export async function POST(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token || !GATEWAY_ADMIN_KEY || token !== GATEWAY_ADMIN_KEY) {
    return NextResponse.json({ error: "Admin auth required" }, { status: 401 });
  }
  if (!INTERNAL_API_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured: INTERNAL_API_KEY missing" },
      { status: 500 }
    );
  }
  try {
    const incoming = await req.text();
    const res = await fetch(`${PBX_URL}/api/v1/admin/whatsapp/test-send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${INTERNAL_API_KEY}`, "Content-Type": "application/json" },
      body: incoming,
    });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "PBX unreachable" },
      { status: 502 }
    );
  }
}
