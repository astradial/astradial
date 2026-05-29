import { NextRequest, NextResponse } from "next/server";

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:7860";
const GATEWAY_ADMIN_KEY = process.env.GATEWAY_ADMIN_KEY || "";

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, await params);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, await params);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, await params);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, await params);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return proxy(req, await params);
}

async function proxy(req: NextRequest, params: { path: string[] }) {
  if (!GATEWAY_ADMIN_KEY) {
    return NextResponse.json({ error: "Gateway not configured" }, { status: 500 });
  }

  const path = params.path.join("/");
  const url = `${GATEWAY_URL}/admin/${path}`;

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${GATEWAY_ADMIN_KEY}`,
    "Content-Type": "application/json",
  };

  const opts: RequestInit = {
    method: req.method,
    headers,
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      opts.body = await req.text();
    } catch {}
  }

  try {
    const res = await fetch(url, opts);
    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
    });
  } catch (err) {
    return NextResponse.json({ error: "Gateway unreachable" }, { status: 502 });
  }
}
