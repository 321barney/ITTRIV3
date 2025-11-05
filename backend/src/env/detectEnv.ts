// src/utils/env.ts
type AppEnv = 'production' | 'staging' | 'preview' | 'test' | 'ci' | 'development';

function truthy(v: any) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export function detectEnvironment(): AppEnv {
  const {
    NODE_ENV,
    // CI/Tests
    CI,
    GITHUB_ACTIONS,
    JEST_WORKER_ID,
    VITEST,
    // Vercel
    VERCEL,
    VERCEL_ENV,
    // Netlify
    NETLIFY,
    CONTEXT,
    // Render
    RENDER,
    RENDER_SERVICE_ID,
    // Railway
    RAILWAY_STATIC_URL,
    // Fly.io
    FLY_APP_NAME,
    // Heroku
    DYNO,
    // Docker / K8s
    KUBERNETES_SERVICE_HOST,
    CONTAINER,
  } = process.env;

  // Explicit test first
  if (NODE_ENV === 'test' || JEST_WORKER_ID != null || VITEST != null) return 'test';
  // Generic CI
  if (truthy(CI) || truthy(GITHUB_ACTIONS)) return 'ci';

  // --- Platform-specific previews/staging/prod ---
  // Vercel
  if (truthy(VERCEL)) {
    if (VERCEL_ENV === 'production') return 'production';
    if (VERCEL_ENV === 'preview') return 'preview';
    if (VERCEL_ENV === 'development') return 'development';
  }
  // Netlify
  if (truthy(NETLIFY)) {
    if (CONTEXT === 'production') return 'production';
    if (CONTEXT === 'deploy-preview') return 'preview';
    if (CONTEXT === 'branch-deploy') return 'staging';
  }
  // Render
  if (truthy(RENDER) || RENDER_SERVICE_ID) {
    // Render doesn’t differentiate well; fall back to NODE_ENV
    if (NODE_ENV === 'production') return 'production';
    if (NODE_ENV === 'staging') return 'staging';
  }
  // Railway
  if (RAILWAY_STATIC_URL) {
    if (NODE_ENV === 'production') return 'production';
    if (NODE_ENV === 'staging') return 'staging';
  }
  // Fly / Heroku ~ server runtimes
  if (FLY_APP_NAME || DYNO) {
    if (NODE_ENV === 'production') return 'production';
    if (NODE_ENV === 'staging') return 'staging';
  }
  // Containers: treat as prod/staging depending on NODE_ENV
  if (KUBERNETES_SERVICE_HOST || CONTAINER) {
    if (NODE_ENV === 'production') return 'production';
    if (NODE_ENV === 'staging') return 'staging';
  }

  // Fallbacks
  if (NODE_ENV === 'production') return 'production';
  if (NODE_ENV === 'staging') return 'staging';
  if (NODE_ENV === 'preview') return 'preview';

  return 'development';
}

// Convenience guards
export const isProd   = () => detectEnvironment() === 'production';
export const isStaging= () => detectEnvironment() === 'staging';
export const isPreview= () => detectEnvironment() === 'preview';
export const isTest   = () => detectEnvironment() === 'test';
export const isCI     = () => detectEnvironment() === 'ci';
export const isDev    = () => detectEnvironment() === 'development';

// Optional metadata helpers (nice for logs/metrics)
export function currentRuntime() {
  return {
    env: detectEnvironment(),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    platform: (
      truthy(process.env.VERCEL) ? 'vercel' :
      truthy(process.env.NETLIFY) ? 'netlify' :
      process.env.FLY_APP_NAME ? 'fly' :
      process.env.RENDER ? 'render' :
      process.env.RAILWAY_STATIC_URL ? 'railway' :
      process.env.DYNO ? 'heroku' :
      process.env.KUBERNETES_SERVICE_HOST ? 'kubernetes' :
      'generic'
    ),
    ci: truthy(process.env.CI) || truthy(process.env.GITHUB_ACTIONS),
    region:
      process.env.VERCEL_REGION ||
      process.env.FLY_REGION ||
      process.env.AWS_REGION ||
      process.env.GOOGLE_CLOUD_REGION ||
      process.env.RENDER_REGION ||
      '',
    service:
      process.env.FLY_APP_NAME ||
      process.env.RENDER_SERVICE_NAME ||
      process.env.K_SERVICE || // Cloud Run
      process.env.SERVICE_NAME ||
      '',
  };
}
