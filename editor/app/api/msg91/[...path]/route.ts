import { NextRequest, NextResponse } from "next/server";

const PBX_URL = process.env.NEXT_PUBLIC_PBX_URL || "http://localhost:8000";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";
const MSG91_BASE = "https://control.msg91.com/api/v5";

// Get MSG91 authkey from AstraPBX org settings
async function getAuthkey(orgId: string): Promise<string> {
  const res = await fetch(`${PBX_URL}/api/v1/settings/msg91/key`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Key": INTERNAL_API_KEY },
    body: JSON.stringify({ org_id: orgId }),
  });
  if (!res.ok) return "";
  const data = await res.json();
  return data.authkey || "";
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const action = path[0];
  const orgId = req.nextUrl.searchParams.get("org_id") || "";
  const authkey = await getAuthkey(orgId);
  if (!authkey) return NextResponse.json({ error: "MSG91 not configured" }, { status: 400 });

  const headers: Record<string, string> = { authkey, accept: "application/json", "content-type": "application/json" };

  if (action === "numbers") {
    const res = await fetch(`${MSG91_BASE}/whatsapp/whatsapp-activation/`, { headers });
    return NextResponse.json(await res.json());
  }

  if (action === "templates") {
    const number = path[1] || req.nextUrl.searchParams.get("number") || "";
    const res = await fetch(`${MSG91_BASE}/whatsapp/get-template-client/${number}`, { headers });
    return NextResponse.json(await res.json());
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 404 });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const action = path[0];
  const body = await req.json();
  const orgId = body.org_id || "";
  const authkey = await getAuthkey(orgId);
  if (!authkey) return NextResponse.json({ error: "MSG91 not configured" }, { status: 400 });

  const headers: Record<string, string> = { authkey, accept: "application/json", "content-type": "application/json" };

  if (action === "send") {
    const res = await fetch(`${MSG91_BASE}/whatsapp/whatsapp-outbound-message/bulk/`, {
      method: "POST", headers, body: JSON.stringify(body.payload),
    });
    return NextResponse.json(await res.json());
  }

  if (action === "logs") {
    const startDate = body.startDate || new Date().toISOString().split("T")[0];
    const endDate = body.endDate || startDate;
    const res = await fetch(`${MSG91_BASE}/report/logs/wa?startDate=${startDate}&endDate=${endDate}`, {
      method: "POST", headers,
    });
    return NextResponse.json(await res.json());
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 404 });
}
