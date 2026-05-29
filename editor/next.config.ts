import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: [
      '@xyflow/react'
    ]
  },
  async rewrites() {
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

