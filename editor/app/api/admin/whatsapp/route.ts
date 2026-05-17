/**
 * Editor server-side proxy for admin WhatsApp config (get + patch).
 *
 * Browser sends its locally-stored `gateway_admin_key` as the Bearer.
 * We verify it matches GATEWAY_ADMIN_KEY env, then call the PBX backend
 * with INTERNAL_API_KEY (which the backend's admin-whatsapp middleware
 * accepts). The browser never sees INTERNAL_API_KEY.
 *
 * This is the same auth-laundering pattern used elsewhere in
 * /api/admin/* — admin browser presents a key the editor knows about,
 * editor server makes the cross-service call with the real secret.
 */

import { NextRequest, NextResponse } from "next/server";

const PBX_URL = process.env.NEXT_PUBLIC_PBX_URL || "http://localhost:8000";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";
const GATEWAY_ADMIN_KEY = process.env.GATEWAY_ADMIN_KEY || "";

function guard(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token || !GATEWAY_ADMIN_KEY || token !== GATEWAY_ADMIN_KEY) {
    return NextResponse.json({ error: "Admin auth required" }, { status: 401 });
  }
  if (!INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Server misconfigured: INTERNAL_API_KEY missing" }, { status: 500 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const bad = guard(req);
  if (bad) return bad;
  try {
    const res = await fetch(`${PBX_URL}/api/v1/admin/whatsapp/config`, {
      headers: { Authorization: `Bearer ${INTERNAL_API_KEY}` },
    });
    const body = await res.text();
    return new NextResponse(body, { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "PBX unreachable" }, { status: 502 });
  }
}

export async function PATCH(req: NextRequest) {
  const bad = guard(req);
  if (bad) return bad;
  try {
    const incoming = await req.text();
    const res = await fetch(`${PBX_URL}/api/v1/admin/whatsapp/config`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${INTERNAL_API_KEY}`, "Content-Type": "application/json" },
      body: incoming,
    });
    const body = await res.text();
    return new NextResponse(body, { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "PBX unreachable" }, { status: 502 });
  }
}
