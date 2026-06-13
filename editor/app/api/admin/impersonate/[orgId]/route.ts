import { NextRequest, NextResponse } from "next/server";

const PBX_URL = process.env.NEXT_PUBLIC_PBX_URL || "http://localhost:8000";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

let cachedAdminToken: { token: string; expiresAt: number } | null = null;

async function getAdminJwt(): Promise<string> {
  if (cachedAdminToken && cachedAdminToken.expiresAt > Date.now() + 60_000) {
    return cachedAdminToken.token;
  }
  const res = await fetch(`${PBX_URL}/api/v1/admin/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ admin_username: ADMIN_USERNAME, admin_password: ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`admin/auth failed (${res.status})`);
  const { token } = await res.json();
  cachedAdminToken = { token, expiresAt: Date.now() + 23 * 60 * 60 * 1000 };
  return token;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  if (!ADMIN_PASSWORD) {
    return NextResponse.json(
      { error: "Admin credentials not configured on server" },
      { status: 500 }
    );
  }
  try {
    const adminJwt = await getAdminJwt();
    const res = await fetch(`${PBX_URL}/api/v1/admin/impersonate/${orgId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminJwt}`,
      },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Impersonation failed" },
      { status: 500 }
    );
  }
}
