import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'editor',
    timestamp: new Date().toISOString(),
  });
}