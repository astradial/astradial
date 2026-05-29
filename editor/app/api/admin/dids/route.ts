import { NextRequest, NextResponse } from "next/server";

const PBX_URL = process.env.NEXT_PUBLIC_PBX_URL || "http://localhost:8000";
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

async function getAdminToken() {
  const res = await fetch(`${PBX_URL}/api/v1/admin/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ admin_username: ADMIN_USERNAME, admin_password: ADMIN_PASSWORD }),
  });
  if (!res.ok) return null;
  return (await res.json()).token;
}

// GET /api/admin/dids → list all DIDs (admin)
export async function GET() {
  try {
    const token = await getAdminToken();
    if (!token) return NextResponse.json({ error: "Admin auth failed" }, { status: 401 });

    // Get all DIDs with org info via a direct DB query through the did-pool admin endpoint
    // We need to call as an org to use did-pool, so we'll query organizations first
    const orgsRes = await fetch(`${PBX_URL}/api/v1/organizations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const orgsData = await orgsRes.json();
    const orgsList = orgsData.organizations || [];

    // Collect all DIDs from all orgs + unassigned
    const allDids: Record<string, unknown>[] = [];

    for (const org of orgsList) {
      try {
        // Get org JWT
        const orgTokenRes = await fetch(`${PBX_URL}/api/v1/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: org.api_key, api_secret: "dummy" }),
        });

        // Use internal key instead
        const didRes = await fetch(`${PBX_URL}/api/v1/dids?org_id=${org.id}`, {
          headers: { "X-Internal-Key": INTERNAL_KEY, "Content-Type": "application/json" },
        });
        if (didRes.ok) {
          const dids = await didRes.json();
          for (const d of (Array.isArray(dids) ? dids : [])) {
            allDids.push({ ...d, organization: { id: org.id, name: org.name } });
          }
        }
      } catch {}
    }

    const counts = {
      total: allDids.length,
      available: allDids.filter((d: Record<string, unknown>) => d.pool_status === "available").length,
      pending: allDids.filter((d: Record<string, unknown>) => d.pool_status === "pending").length,
      assigned: allDids.filter((d: Record<string, unknown>) => d.pool_status === "assigned").length,
      reserved: allDids.filter((d: Record<string, unknown>) => d.pool_status === "reserved").length,
    };

    return NextResponse.json({ dids: allDids, counts });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
