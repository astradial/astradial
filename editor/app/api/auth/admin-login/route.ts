import { NextRequest, NextResponse } from "next/server";

// Admin emails allowed to access gateway admin panel
const ADMIN_EMAILS = ["admin@astradial.com"];

// Gateway admin key — stored server-side only
const GATEWAY_ADMIN_KEY = process.env.GATEWAY_ADMIN_KEY || "";

export async function POST(req: NextRequest) {
  const { email } = await req.json();

  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  if (!ADMIN_EMAILS.includes(email.toLowerCase())) {
    return NextResponse.json({ error: "Not an admin account" }, { status: 403 });
  }

  if (!GATEWAY_ADMIN_KEY) {
    return NextResponse.json({ error: "Gateway admin key not configured on server" }, { status: 500 });
  }

  return NextResponse.json({ admin_key: GATEWAY_ADMIN_KEY });
}
