import { NextRequest, NextResponse } from "next/server";

const PBX_URL = process.env.NEXT_PUBLIC_PBX_URL || "http://localhost:8000";
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "";

async function pbxFetch(path: string, orgId: string, opts: RequestInit = {}) {
  const url = `${PBX_URL}/api/v1${path}`;
  return fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Key": INTERNAL_KEY,
      ...((opts.headers as Record<string, string>) || {}),
    },
  });
}

// GET org details + compliance + members
export async function GET(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  try {
    const [orgRes, compRes, usersRes] = await Promise.all([
      pbxFetch(`/organizations/${orgId}?org_id=${orgId}`, orgId),
      pbxFetch(`/compliance?org_id=${orgId}`, orgId),
      pbxFetch(`/org-users?org_id=${orgId}`, orgId),
    ]);

    const org = orgRes.ok ? await orgRes.json() : null;
    if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });

    const compliance = compRes.ok ? await compRes.json() : null;

    let owner = null;
    let members: Array<Record<string, unknown>> = [];
    if (usersRes.ok) {
      const userData = await usersRes.json();
      members = Array.isArray(userData?.data) ? userData.data : [];
      owner = members.find((u) => u.role === "owner") ?? null;
    }

    return NextResponse.json({ org, compliance, owner, members });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

// PUT update org + compliance
export async function PUT(req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  try {
    const body = await req.json();
    const { compliance: compData, ...orgData } = body;

    // Update org
    const orgRes = await pbxFetch(`/organizations/${orgId}?org_id=${orgId}`, orgId, {
      method: "PUT",
      body: JSON.stringify(orgData),
    });

    // Update compliance if provided + auto-deploy config
    if (compData) {
      await pbxFetch(`/compliance?org_id=${orgId}`, orgId, {
        method: "PUT",
        body: JSON.stringify(compData),
      });
    }

    // Auto-deploy config to Asterisk (so consent mode, recording settings take effect)
    try {
      await pbxFetch(`/config/deploy?org_id=${orgId}`, orgId, { method: "POST" });
    } catch {}

    const org = orgRes.ok ? await orgRes.json() : { error: await orgRes.text() };
    return NextResponse.json({ ...org, config_deployed: true }, { status: orgRes.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
