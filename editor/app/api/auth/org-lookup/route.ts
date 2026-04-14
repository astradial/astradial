import { NextRequest, NextResponse } from "next/server";

// Server-side org mapping — maps email to org credentials
// Add new orgs here as they onboard
const ORG_MAPPINGS: Record<string, { org_id: string; org_name: string; api_key: string; role: string }> = {
  "systems@grandestancia.com": {
    org_id: "ba50c665-7ab4-4f04-a301-eccc395dc42b",
    org_name: "GrandEstancia",
    api_key: process.env.GRANDESTANCIA_API_KEY || "",
    role: "admin",
  },
};

export async function POST(req: NextRequest) {
  const { email } = await req.json();

  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  const mapping = ORG_MAPPINGS[email.toLowerCase()];
  if (!mapping) {
    return NextResponse.json({ error: "No organisation access for this email" }, { status: 404 });
  }

  return NextResponse.json(mapping);
}
