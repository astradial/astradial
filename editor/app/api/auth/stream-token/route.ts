import { NextResponse } from "next/server";

// Returns the gateway admin key for authenticated SSE log streams
// The frontend uses this to build the EventSource URL
const GATEWAY_ADMIN_KEY = process.env.GATEWAY_ADMIN_KEY || "";

export async function GET() {
  if (!GATEWAY_ADMIN_KEY) {
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  return NextResponse.json({ token: GATEWAY_ADMIN_KEY });
}
