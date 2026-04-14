import { NextRequest, NextResponse } from "next/server";

// Admin credentials from environment
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const GATEWAY_ADMIN_KEY = process.env.GATEWAY_ADMIN_KEY || process.env.INTERNAL_API_KEY || "astradial-admin-key";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  // Check admin credentials
  const adminEmails = ADMIN_EMAIL.split(",").map(e => e.trim().toLowerCase());
  if (!adminEmails.includes(email.toLowerCase())) {
    return NextResponse.json({ error: "Not an admin account" }, { status: 403 });
  }

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  return NextResponse.json({ admin_key: GATEWAY_ADMIN_KEY });
}
