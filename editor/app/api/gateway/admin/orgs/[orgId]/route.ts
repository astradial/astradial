import { NextRequest, NextResponse } from "next/server";

const PBX_URL = process.env.NEXT_PUBLIC_PBX_URL || "http://localhost:8000";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

async function getAdminToken() {
  const res = await fetch(`${PBX_URL}/api/v1/admin/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ admin_username: ADMIN_USERNAME, admin_password: ADMIN_PASSWORD }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.token;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const { orgId } = await params;
    const token = await getAdminToken();
    if (!token) return NextResponse.json({ error: "Admin auth failed" }, { status: 401 });

    const res = await fetch(`${PBX_URL}/api/v1/organizations/${orgId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return NextResponse.json({ error: "Org not found" }, { status: 404 });

    const o = await res.json();
    return NextResponse.json({
      id: o.id,
      name: o.name,
      is_active: o.status === "active",
      contact_info: o.contact_info,
      settings: o.settings,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
