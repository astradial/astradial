import { NextRequest, NextResponse } from "next/server";

const PBX_URL = process.env.NEXT_PUBLIC_PBX_URL || "http://localhost:8000";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "";

async function forward(req: NextRequest, params: Promise<{ path: string[] }>) {
  if (!INTERNAL_API_KEY) {
    return NextResponse.json({ error: "Internal API key not configured" }, { status: 500 });
  }
  const { path } = await params;
  const subpath = (path || []).join("/");
  const search = req.nextUrl.search;
  const url = `${PBX_URL}/api/v1/did-pool/${subpath}${search}`;

  const init: RequestInit = {
    method: req.method,
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Key": INTERNAL_API_KEY,
    },
  };
  if (req.method !== "GET" && req.method !== "DELETE") {
    init.body = await req.text();
  }

  try {
    const res = await fetch(url, init);
    const text = await res.text();
    try {
      return NextResponse.json(text ? JSON.parse(text) : {}, { status: res.status });
    } catch {
      return new NextResponse(text, { status: res.status });
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Proxy failed" },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) { return forward(req, ctx.params); }
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) { return forward(req, ctx.params); }
export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) { return forward(req, ctx.params); }
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) { return forward(req, ctx.params); }
