// Next.js acts as (1) the static host for the original React SPA (src/) and
// (2) a same-origin reverse proxy in front of the FastAPI backend (backend/),
// which is spawned by instrumentation.js on the port below.
const BACKEND_PORT = process.env.BACKEND_PORT || '8001';

const nextConfig = {
  images: { unoptimized: true },
  // The original CRA code reads REACT_APP_BACKEND_URL. Empty string => relative
  // '/api/...' calls, i.e. same origin, so no CORS surface at all.
  env: {
    REACT_APP_BACKEND_URL: '',
  },
  experimental: {
    // Excel/PDF exports can take a while; don't cut the proxied request short.
    proxyTimeout: 300_000,
  },
  webpack(config, { dev }) {
    if (dev) {
      config.watchOptions = {
        poll: 2000,
        aggregateTimeout: 300,
        ignored: ['**/node_modules', '**/backend/**'],
      };
    }
    return config;
  },
  onDemandEntries: { maxInactiveAge: 10000, pagesBufferLength: 2 },
  async rewrites() {
    return {
      // beforeFiles: takes precedence over the SPA catch-all route.
      beforeFiles: [
        { source: '/api/:path*', destination: `http://127.0.0.1:${BACKEND_PORT}/api/:path*` },
      ],
    };
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'ALLOWALL' },
          { key: 'Content-Security-Policy', value: 'frame-ancestors *;' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
