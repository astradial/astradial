import { NextRequest, NextResponse } from "next/server";

const PBX_URL = process.env.NEXT_PUBLIC_PBX_URL || "http://localhost:8000";
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "";

// Bridge for admin DID actions: approve, reject, assign, release, bulk
// POST /api/admin/dids/{action} → PBX API /api/v1/did-pool/admin/{action}

export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await params;
    const body = await req.json().catch(() => ({}));

    // Map action to PBX endpoint
    let pxbPath = "";
    if (action === "bulk") {
      pxbPath = `/api/v1/did-pool/admin/bulk`;
    } else if (body.did_id) {
      // Actions on specific DID: approve, reject, assign, release
      pxbPath = `/api/v1/did-pool/admin/${body.did_id}/${action}`;
    } else {
      return NextResponse.json({ error: "did_id required" }, { status: 400 });
    }

    const res = await fetch(`${PBX_URL}${pxbPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": INTERNAL_KEY,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
