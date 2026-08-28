import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Keeps server actions from accepting oversized payloads.
    serverActions: { bodySizeLimit: '1mb' },

    /*
     * Build with a single worker.
     *
     * Next fans page generation out across child processes. On shared hosting
     * with a per-user process cap (CloudLinux LVE) those spawns are refused
     * with EAGAIN, and the build dies after compiling successfully — which
     * reads as a mysterious crash rather than a quota.
     *
     * This app prerenders three routes, so the parallelism was buying nothing
     * anyway; serialising it costs a second or two and makes the build run
     * inside a tight process budget.
     */
    cpus: 1,
    workerThreads: false,
    webpackBuildWorker: false,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
