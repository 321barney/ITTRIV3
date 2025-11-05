// backend/src/api/utils/plan.ts

// Accept multiple field styles from DB rows (snake/camel/legacy)
type PlanRow = {
  code?: string;
  max_stores?: number | null;      // legacy
  store_limit?: number | null;
  storeLimit?: number | null;
  product_limit?: number | null;
  productLimit?: number | null;
  confirm_limit?: number | null;
  confirmLimit?: number | null;
};

export type PlanCaps = {
  canEditStore: boolean;
  canManageProducts: boolean;
  maxProducts: number | null; // null = unlimited
};

function normPlan(p?: string | null) {
  return String(p ?? '').trim().toLowerCase() || 'basic';
}

function parsePosInt(x: unknown): number | undefined {
  const n = typeof x === 'string' ? Number(x) : (x as number);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

// ------------ ENV OVERRIDES ------------
function envStoreLimit(plan: string): number | undefined {
  const key = {
    basic: process.env.PLAN_LIMIT_STORES_BASIC,
    starter: process.env.PLAN_LIMIT_STORES_STARTER,
    pro: process.env.PLAN_LIMIT_STORES_PRO,
    enterprise: process.env.PLAN_LIMIT_STORES_ENTERPRISE,
  }[normPlan(plan) as 'basic'|'starter'|'pro'|'enterprise'];
  return parsePosInt(key);
}

function envProductLimit(plan: string): number | null | undefined {
  const key = {
    basic: process.env.PLAN_LIMIT_PRODUCTS_BASIC,
    starter: process.env.PLAN_LIMIT_PRODUCTS_STARTER,
    pro: process.env.PLAN_LIMIT_PRODUCTS_PRO,
    enterprise: process.env.PLAN_LIMIT_PRODUCTS_ENTERPRISE,
  }[normPlan(plan) as 'basic'|'starter'|'pro'|'enterprise'];

  if (!key) return undefined;
  if (String(key).toLowerCase() === 'unlimited') return null;
  return parsePosInt(key);
}

function envConfirmLimit(plan: string): number | undefined {
  const key = {
    basic: process.env.PLAN_LIMIT_CONFIRMS_BASIC,
    starter: process.env.PLAN_LIMIT_CONFIRMS_STARTER,
    pro: process.env.PLAN_LIMIT_CONFIRMS_PRO,
    enterprise: process.env.PLAN_LIMIT_CONFIRMS_ENTERPRISE,
  }[normPlan(plan) as 'basic'|'starter'|'pro'|'enterprise'];
  return parsePosInt(key);
}

// ------------ DEFAULTS ------------
function defaultStoreLimit(plan: string): number {
  switch (normPlan(plan)) {
    case 'enterprise': return 10;
    case 'pro':        return 3;
    case 'starter':
    case 'basic':
    default:           return 1;
  }
}

function defaultProductLimit(plan: string): number | null {
  switch (normPlan(plan)) {
    case 'enterprise':
    case 'pro':        return null; // unlimited
    case 'starter':    return 200;
    case 'basic':
    default:           return 50;
  }
}

function defaultConfirmLimit(plan: string): number {
  switch (normPlan(plan)) {
    case 'enterprise': return 10000;
    case 'pro':        return 1000;
    case 'starter':    return 500;
    case 'basic':
    default:           return 100;
  }
}

// ------------ DB-ROW EXTRACTORS ------------
function fromRowStoreLimit(row?: PlanRow | null): number | undefined {
  return parsePosInt(
    row?.max_stores ?? row?.store_limit ?? (row as any)?.storeLimit
  );
}

function fromRowProductLimit(row?: PlanRow | null): number | null | undefined {
  const val =
    row?.product_limit ?? (row as any)?.productLimit;
  if (val == null) return undefined;
  // Interpret <=0 as unlimited (common convention)
  const n = Number(val);
  if (!Number.isFinite(n)) return undefined;
  return n > 0 ? Math.floor(n) : null;
}

function fromRowConfirmLimit(row?: PlanRow | null): number | undefined {
  return parsePosInt(row?.confirm_limit ?? (row as any)?.confirmLimit);
}

// ------------ PUBLIC API ------------
export function resolveStoreLimit(planCode: string, planRow?: PlanRow): number {
  return (
    fromRowStoreLimit(planRow) ??
    envStoreLimit(planCode) ??
    defaultStoreLimit(planCode)
  );
}

export function resolveProductLimit(planCode: string, planRow?: PlanRow): number | null {
  const rowVal = fromRowProductLimit(planRow);
  if (rowVal !== undefined) return rowVal;
  const envVal = envProductLimit(planCode);
  if (envVal !== undefined) return envVal;
  return defaultProductLimit(planCode);
}

export function resolveConfirmLimit(planCode: string, planRow?: PlanRow): number {
  return (
    fromRowConfirmLimit(planRow) ??
    envConfirmLimit(planCode) ??
    defaultConfirmLimit(planCode)
  );
}

/**
 * Build the caps object used by seller/product routes.
 * Honors DB plan row first, then ENV overrides, then defaults.
 */
export function capsForPlan(planCode: string, planRow?: PlanRow): PlanCaps {
  const maxProducts = resolveProductLimit(planCode, planRow);
  return {
    canEditStore: true,
    canManageProducts: true,
    maxProducts, // null = unlimited
  };
}
