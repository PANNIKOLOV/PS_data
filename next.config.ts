import type { NextConfig } from 'next';

/*
 * Serving from a sub-path (e.g. https://example.com/psdata) requires basePath.
 * Without it the app builds fine but every internal redirect drops the prefix:
 * a request to /psdata redirects to /login instead of /psdata/login, which is a
 * 404. It is baked in at build time, so changing it means rebuilding.
 *
 * Leave NEXT_PUBLIC_BASE_PATH unset when serving from the domain root.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, '') || '';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(basePath ? { basePath } : {}),
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
