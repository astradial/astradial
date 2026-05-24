import { NextRequest, NextResponse } from "next/server";

function loadAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAIL || process.env.ADMIN_EMAILS || "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const GATEWAY_ADMIN_KEY = process.env.GATEWAY_ADMIN_KEY || "";

export async function POST(req: NextRequest) {
  const { email } = await req.json();

  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  const allowed = loadAdminEmails();
  if (allowed.length === 0) {
    return NextResponse.json(
      { error: "Admin login disabled — set ADMIN_EMAIL in the server environment" },
      { status: 503 },
    );
  }

  if (!allowed.includes(email.toLowerCase())) {
    return NextResponse.json({ error: "Not an admin account" }, { status: 403 });
  }

  if (!GATEWAY_ADMIN_KEY) {
    return NextResponse.json({ error: "Gateway admin key not configured on server" }, { status: 500 });
  }

  return NextResponse.json({ admin_key: GATEWAY_ADMIN_KEY });
}
