import { NextRequest, NextResponse } from "next/server";

const PBX_URL = process.env.NEXT_PUBLIC_PBX_URL || "http://localhost:8000";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

// Bridge: /api/gateway/admin/orgs → PBX API /api/v1/organizations
// This replaces the gateway service for OSS self-hosted mode

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

export async function GET() {
  try {
    const token = await getAdminToken();
    if (!token) {
      if (process.env.NEXT_PUBLIC_DEV_UI === "true") {
        return NextResponse.json([{
          id: "demo-org-123",
          name: "UI Sandbox Organisation",
          is_active: true,
          created_at: new Date().toISOString()
        }]);
      }
      return NextResponse.json({ error: "Admin auth failed" }, { status: 401 });
    }

    const res = await fetch(`${PBX_URL}/api/v1/organizations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    const orgs = data.organizations || data || [];

    // Map to gateway format
    const mapped = (Array.isArray(orgs) ? orgs : []).map((o: Record<string, unknown>) => ({
      id: o.id,
      name: o.name,
      is_active: o.status === "active",
      contact_info: o.contact_info,
      settings: o.settings,
      created_at: o.createdAt || o.created_at,
    }));

    return NextResponse.json(mapped);
  } catch (e) {
    if (process.env.NEXT_PUBLIC_DEV_UI === "true") {
      return NextResponse.json([{
        id: "demo-org-123",
        name: "UI Sandbox Organisation",
        is_active: true,
        created_at: new Date().toISOString()
      }]);
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
