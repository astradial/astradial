import type { NextConfig } from 'next';

// Dev-only seed-data mode. Strict opt-in via NEXT_PUBLIC_USE_MOCK=1 AND
// NODE_ENV !== "production". When on, /api/{pbx,gateway,workflow}/* is routed
// internally to /api/mock/<upstream>/* instead of the real backend.
const USE_MOCK =
  process.env.NODE_ENV !== 'production' &&
  process.env.NEXT_PUBLIC_USE_MOCK === '1';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: [
      '@xyflow/react'
    ]
  },
  async rewrites() {
    if (USE_MOCK) {
      return [
        { source: '/api/gateway/:path*',  destination: '/api/mock/gateway/:path*'  },
        { source: '/api/pbx/:path*',      destination: '/api/mock/pbx/:path*'      },
        { source: '/api/workflow/:path*', destination: '/api/mock/workflow/:path*' },
      ];
    }
    return [
      {
        source: '/api/gateway/:path*',
        destination: `${process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:7860'}/:path*`,
      },
      {
        source: '/api/pbx/:path*',
        destination: `${process.env.NEXT_PUBLIC_PBX_URL || 'http://localhost:8000'}/api/v1/:path*`,
      },
      {
        source: '/api/workflow/:path*',
        destination: `${process.env.NEXT_PUBLIC_WORKFLOW_URL || 'http://localhost:3002'}/:path*`,
      },
    ];
  },
};

export default nextConfig;

