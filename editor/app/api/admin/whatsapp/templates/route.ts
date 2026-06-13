/**
 * Editor server-side proxy for the admin MSG91 template list.
 *
 * Same auth-laundering pattern as ../route.ts: browser presents
 * `gateway_admin_key`, server forwards with INTERNAL_API_KEY.
 */

import { NextRequest, NextResponse } from "next/server";

const PBX_URL = process.env.NEXT_PUBLIC_PBX_URL || "http://localhost:8000";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";
const GATEWAY_ADMIN_KEY = process.env.GATEWAY_ADMIN_KEY || "";

export async function GET(req: NextRequest) {
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
    const res = await fetch(`${PBX_URL}/api/v1/admin/whatsapp/templates`, {
      headers: { Authorization: `Bearer ${INTERNAL_API_KEY}` },
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
