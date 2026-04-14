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

    // Auto-link admin email as org owner
    if (res.ok && data.id) {
      const adminEmail = process.env.ADMIN_EMAIL || "";
      if (adminEmail) {
        try {
          const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "";
          await fetch(`${PBX_URL}/api/v1/org-users/invite`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": data.api_key,
            },
            body: JSON.stringify({ email: adminEmail, name: "Admin", role: "owner", extension: "1001" }),
          });
          // Also link in org_users if admin exists without org
          await fetch(`${PBX_URL}/api/v1/auth/link-admin-org`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Internal-Key": INTERNAL_KEY },
            body: JSON.stringify({ email: adminEmail, org_id: data.id }),
          }).catch(() => {});
        } catch {}
      }
    }

    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create organisation" },
      { status: 500 }
    );
  }
}
