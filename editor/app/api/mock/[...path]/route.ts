// Dev-only catch-all. Reached via conditional rewrites in next.config.ts when
// NEXT_PUBLIC_USE_MOCK=1. In production the rewrites don't point here and this
// route is never hit; the runtime guard below is belt-and-suspenders.

import { NextRequest, NextResponse } from "next/server";
import { isMockMode } from "@/lib/mock/enabled";
import { dispatch } from "@/lib/mock/dispatcher";

type Upstream = "pbx" | "gateway" | "workflow";
const UPSTREAMS: Upstream[] = ["pbx", "gateway", "workflow"];

async function handle(req: NextRequest, params: Promise<{ path: string[] }>) {
  if (!isMockMode()) {
    return NextResponse.json({ error: "mock mode disabled" }, { status: 404 });
  }

  const { path } = await params;
  const [head, ...segments] = path || [];
  if (!UPSTREAMS.includes(head as Upstream)) {
    return NextResponse.json({ error: `unknown upstream: ${head}` }, { status: 404 });
  }

  const url = new URL(req.url);
  let body: unknown = undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    try { body = await req.json(); } catch { body = undefined; }
  }

  const res = await dispatch({
    upstream: head as Upstream,
    segments,
    method: req.method,
    url,
    body,
  });
  return res ?? NextResponse.json({ error: "no mock for " + req.method + " " + path.join("/") }, { status: 404 });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> })    { return handle(req, ctx.params); }
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> })   { return handle(req, ctx.params); }
export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> })    { return handle(req, ctx.params); }
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> })  { return handle(req, ctx.params); }
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) { return handle(req, ctx.params); }
