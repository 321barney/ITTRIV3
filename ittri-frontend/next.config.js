/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== 'production';
const apiBase = process.env.NEXT_PUBLIC_API_URL || '/api';

// Build a CSP that works with streamed preview content
// The Studio loads user-generated HTML that often references CDNs.
// We allow https: for scripts/styles/fonts in addition to 'self'.
// In dev we additionally allow 'unsafe-eval' for Next HMR.
const csp = [
  "default-src 'self'",
  // Tailwind/shadcn often require inline styles
  "style-src 'self' 'unsafe-inline' https:",
  // Permit external CDNs for generated pages (e.g., unpkg/jsdelivr/google fonts).
  // Keep 'unsafe-eval' only in dev so HMR works.
  `script-src 'self' ${isDev ? "'unsafe-inline' 'unsafe-eval' " : "'unsafe-inline' " }https: chrome-extension: moz-extension:`,
  // Images (self + data/blob + any https)
  "img-src 'self' data: blob: https:",
  // Fonts & media
  "font-src 'self' data: https:",
  "media-src 'self' blob:",
  // Workers
  "worker-src 'self' blob:",
  // XHR/fetch/websocket targets: self, your API base, and general https (OpenAI via server is fine; this is for client calls if any)
  `connect-src 'self' https: ${isDev ? "ws: wss:" : ""}`,
  // If the preview opens things in iframes later (e.g., embeds), allow https frames
  "frame-src 'self' https:",
  "frame-ancestors 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig = {
  reactStrictMode: true,

  // Allow cross-origin requests from Replit domains in development
  devIndicators: {
    buildActivityPosition: 'bottom-right',
  },
  
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
      allowedOrigins: ['*'],
    },
  },

  // Fix the webpack cache rename noise on ephemeral FS (Replit)
  webpack: (config, { dev, isServer }) => {
    if (dev) {
      // simplest: turn off persistent fs cache in dev
      config.cache = false;
      // or use memory cache instead:
      // config.cache = { type: 'memory' };
    }
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },

  // Next doesn't support wildcard strings in images.domains; use remotePatterns
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.replit.dev' },
      { protocol: 'https', hostname: '**.repl.co' },
      { protocol: 'https', hostname: '**.googleusercontent.com' },
      { protocol: 'https', hostname: '**.unpkg.com' },
      { protocol: 'https', hostname: '**.jsdelivr.net' },
      { protocol: 'https', hostname: '**.vercel.app' },
      { protocol: 'https', hostname: 'localhost' },
    ],
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
