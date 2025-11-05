-- =========================================================
-- PRODUCTION-READY SCHEMA v2.2 (PostgreSQL 14+, idempotent)
-- Multi-tenant SaaS platform with Sheets-only integration
-- Notes:
--  - Google Sheets is the only integration (no channels table, no WhatsApp)
--  - Store can be 'active' only with 1 enabled sheet + valid gsheet_url
--  - Includes legacy-safe backfills, pgvector version check, RLS, triggers
--  - CI-friendly: no explicit BEGIN/COMMIT wrappers
-- =========================================================

-- =========================================================
-- 1. ENVIRONMENT SETUP
-- =========================================================

SET lock_timeout = '10s';
SET statement_timeout = '120s';
SET client_min_messages = WARNING;

CREATE SCHEMA IF NOT EXISTS app;
SET search_path = app, public;

-- Ensure privileges (best-effort)
DO $privileges$
BEGIN
  IF NOT has_schema_privilege(current_user, 'app', 'CREATE') THEN
    EXECUTE format('GRANT USAGE, CREATE ON SCHEMA app TO %I', current_user);
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Cannot grant schema privileges (current_user: %)', current_user;
END;
$privileges$;

-- Extensions (best-effort). Avoid forcing a schema if already installed elsewhere.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify pgvector extension version (numeric compare)
DO $vector_check$
DECLARE
  v_version TEXT;
  v_parts   TEXT[];
  v_major   INT; v_minor INT; v_patch INT;
  need_major INT := 0; need_minor INT := 5; need_patch INT := 0; -- 0.5.0
BEGIN
  SELECT extversion INTO v_version
  FROM pg_extension
  WHERE extname = 'vector';

  IF v_version IS NULL THEN
    RAISE EXCEPTION 'pgvector extension not installed';
  END IF;

  v_parts := regexp_split_to_array(v_version, '\.');
  v_major := COALESCE((v_parts)[1]::INT, 0);
  v_minor := COALESCE((v_parts)[2]::INT, 0);
  v_patch := COALESCE((v_parts)[3]::INT, 0);

  IF (v_major, v_minor, v_patch) < (need_major, need_minor, need_patch) THEN
    RAISE WARNING 'pgvector version % may not support all features (need >= 0.5.0)', v_version;
  END IF;
END;
$vector_check$;

-- =========================================================
-- 2. CORE DOMAIN TYPES
-- =========================================================

DO $et$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status') THEN
    CREATE TYPE subscription_status AS ENUM ('active', 'past_due', 'canceled', 'trialing');
  END IF;
END; $et$;

DO $et$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'store_status') THEN
    CREATE TYPE store_status AS ENUM ('active', 'inactive', 'suspended');
  END IF;
END; $et$;

DO $et$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_status') THEN
    CREATE TYPE product_status AS ENUM ('active', 'inactive', 'discontinued');
  END IF;
END; $et$;

DO $et$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE order_status AS ENUM ('new', 'processing', 'completed', 'cancelled', 'refunded');
  END IF;
END; $et$;

DO $et$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'conversation_status') THEN
    CREATE TYPE conversation_status AS ENUM ('open', 'closed', 'archived');
  END IF;
END; $et$;

DO $et$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_role') THEN
    CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system', 'agent', 'tool');
  END IF;
END; $et$;

DO $et$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'model_status') THEN
    CREATE TYPE model_status AS ENUM ('base', 'training', 'deployed', 'failed');
  END IF;
END; $et$;

DO $et$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'training_job_status') THEN
    CREATE TYPE training_job_status AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');
  END IF;
END; $et$;

-- =========================================================
-- 3. SUBSCRIPTION & BILLING TABLES
-- =========================================================

CREATE TABLE IF NOT EXISTS plans (
  id             SERIAL PRIMARY KEY,
  code           TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  monthly_price  NUMERIC(10,2) NOT NULL DEFAULT 0,
  yearly_price   NUMERIC(10,2),
  store_limit    INTEGER NOT NULL,
  product_limit  INTEGER NOT NULL,
  confirm_limit  INTEGER NOT NULL,
  features       JSONB DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT check_positive_limits 
    CHECK (store_limit > 0 AND product_limit > 0 AND confirm_limit > 0),
  CONSTRAINT check_valid_prices 
    CHECK (monthly_price >= 0 AND (yearly_price IS NULL OR yearly_price >= 0))
);

-- Safe backfill in case of older shape
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS yearly_price NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS confirm_limit INTEGER,
  ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DO $$ BEGIN
  UPDATE plans SET confirm_limit = COALESCE(confirm_limit, 0) WHERE confirm_limit IS NULL;
  UPDATE plans SET features = '{}'::jsonb WHERE features IS NULL;
END $$;

CREATE TABLE IF NOT EXISTS sellers (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email              TEXT NOT NULL UNIQUE,
  password_hash           TEXT NOT NULL,
  company_name            TEXT,
  plan_code               TEXT NOT NULL DEFAULT 'basic',
  subscription_status     subscription_status NOT NULL DEFAULT 'active',
  billing_cycle_start     DATE NOT NULL DEFAULT CURRENT_DATE,
  billing_period          TEXT NOT NULL DEFAULT 'monthly',
  trial_ends_at           TIMESTAMPTZ,
  payment_method_id       TEXT,
  stripe_customer_id      TEXT,
  locked_at               TIMESTAMPTZ,
  lock_reason             TEXT,
  metadata                JSONB DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_sellers_plan_code
    FOREIGN KEY (plan_code) REFERENCES plans(code),
  CONSTRAINT check_valid_email
    CHECK (user_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT check_password_format
    CHECK (password_hash LIKE 'scrypt$%$%'),
  CONSTRAINT check_billing_period
    CHECK (billing_period IN ('monthly', 'yearly'))
);

-- Conservative backfill for legacy columns
ALTER TABLE sellers
  ADD COLUMN IF NOT EXISTS subscription_status subscription_status DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lock_reason TEXT,
  ADD COLUMN IF NOT EXISTS billing_cycle_start DATE DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS billing_period TEXT DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_method_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

UPDATE sellers SET subscription_status = 'active' WHERE subscription_status IS NULL;
DO $$ BEGIN
  BEGIN
    ALTER TABLE sellers ALTER COLUMN subscription_status SET NOT NULL;
  EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

CREATE TABLE IF NOT EXISTS billing_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id       UUID NOT NULL,
  amount          NUMERIC(10,2) NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  status          TEXT NOT NULL,
  invoice_id      TEXT,
  stripe_invoice  TEXT,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_billing_seller
    FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE,
  CONSTRAINT check_amount CHECK (amount >= 0),
  CONSTRAINT check_period CHECK (period_end >= period_start),
  CONSTRAINT check_billing_status 
    CHECK (status IN ('pending', 'paid', 'failed', 'refunded'))
);

-- =========================================================
-- 4. STORES & SHEETS (Sheets-only integration)
-- =========================================================

CREATE TABLE IF NOT EXISTS stores (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id     UUID NOT NULL,
  name          TEXT NOT NULL,
  gsheet_url    TEXT,
  status        store_status NOT NULL DEFAULT 'inactive',
  has_gsheet    BOOLEAN NOT NULL DEFAULT FALSE,
  metadata      JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_stores_seller
    FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE,
  CONSTRAINT check_store_name
    CHECK (LENGTH(TRIM(name)) > 0),
  -- Active stores must rely on Google Sheets and have a concrete URL
  CONSTRAINT check_store_active_has_gsheet_url
    CHECK (status <> 'active' OR (has_gsheet = TRUE AND gsheet_url IS NOT NULL)),
  -- If a URL is provided, it must be a valid Google Sheet URL
  CONSTRAINT check_store_gsheet_url
    CHECK (gsheet_url IS NULL OR gsheet_url ~* '^https://docs\.google\.com/spreadsheets/')
);

CREATE TABLE IF NOT EXISTS store_sheets (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id           UUID NOT NULL,
  seller_id          UUID NOT NULL,
  gsheet_url         TEXT NOT NULL,
  sheet_tab          TEXT DEFAULT 'Sheet1',
  enabled            BOOLEAN NOT NULL DEFAULT TRUE,
  last_processed_row INTEGER NOT NULL DEFAULT 0,
  last_row_hash      TEXT,
  column_mapping     JSONB DEFAULT '{}'::jsonb,
  sync_frequency_min INTEGER DEFAULT 5,
  last_synced_at     TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_sheets_store
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_sheets_seller
    FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE,
  CONSTRAINT check_gsheet_url
    CHECK (gsheet_url ~* '^https://docs\.google\.com/spreadsheets/'),
  CONSTRAINT check_last_row CHECK (last_processed_row >= 0),
  CONSTRAINT check_sync_freq CHECK (sync_frequency_min IS NULL OR sync_frequency_min > 0)
);

ALTER TABLE store_sheets
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

-- Keep stores.has_gsheet in sync with store_sheets (sheets-only)
CREATE OR REPLACE FUNCTION refresh_store_integrations(p_store_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE stores
  SET has_gsheet = EXISTS(
        SELECT 1 FROM store_sheets 
        WHERE store_id = p_store_id AND enabled = TRUE
      ),
      updated_at = NOW()
  WHERE id = p_store_id;
END;
$$;

-- Auto-refresh on sheet changes (already idempotent in v2.1; re-create)
CREATE OR REPLACE FUNCTION trigger_refresh_store_integrations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_store_id UUID;
BEGIN
  v_store_id := COALESCE(NEW.store_id, OLD.store_id);

  BEGIN
    SET LOCAL lock_timeout = '2s';
    PERFORM refresh_store_integrations(v_store_id);
  EXCEPTION WHEN lock_not_available THEN
    INSERT INTO error_logs (error_message, context, severity)
    VALUES (
      'Lock timeout in refresh_store_integrations',
      jsonb_build_object('store_id', v_store_id, 'operation', TG_OP),
      'warning'
    );
  END;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sheets_refresh ON store_sheets;
CREATE TRIGGER trg_sheets_refresh
  AFTER INSERT OR UPDATE OR DELETE ON store_sheets
  FOR EACH ROW EXECUTE FUNCTION trigger_refresh_store_integrations();

-- Ensure store_sheets.seller_id always matches the parent store (defensive)
CREATE OR REPLACE FUNCTION _enforce_sheet_seller_match()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE v_store_seller UUID;
BEGIN
  SELECT seller_id INTO v_store_seller FROM stores WHERE id = NEW.store_id;
  IF v_store_seller IS NULL THEN
    RAISE EXCEPTION 'store_sheets.store_id % does not reference an existing store', NEW.store_id;
  END IF;
  IF NEW.seller_id IS DISTINCT FROM v_store_seller THEN
    NEW.seller_id := v_store_seller; -- auto-correct
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sheet_seller_match ON store_sheets;
CREATE TRIGGER trg_sheet_seller_match
  BEFORE INSERT OR UPDATE OF store_id, seller_id ON store_sheets
  FOR EACH ROW EXECUTE FUNCTION _enforce_sheet_seller_match();

-- Prevent ACTIVE stores without exactly one enabled sheet
CREATE OR REPLACE FUNCTION _validate_store_requires_single_enabled_sheet()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE v_enabled_count INTEGER;
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.status = 'active' THEN
    SELECT COUNT(*) INTO v_enabled_count
    FROM store_sheets
    WHERE store_id = COALESCE(NEW.id, OLD.id)
      AND enabled = TRUE;

    IF v_enabled_count <> 1 THEN
      RAISE EXCEPTION 'ACTIVE store requires exactly one enabled Google Sheet (store_id=%). Found: %', COALESCE(NEW.id, OLD.id), v_enabled_count;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_store_requires_sheet ON stores;
CREATE TRIGGER trg_store_requires_sheet
  BEFORE INSERT OR UPDATE OF status ON stores
  FOR EACH ROW EXECUTE FUNCTION _validate_store_requires_single_enabled_sheet();

-- =========================================================
-- 5. PRODUCTS & CATALOG
-- =========================================================

CREATE TABLE IF NOT EXISTS products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL,
  seller_id   UUID NOT NULL,
  sku         TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  price       NUMERIC(12,2) NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'USD',
  inventory   INTEGER,
  attributes  JSONB DEFAULT '{}'::jsonb,
  status      product_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_products_store
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_products_seller
    FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE,
  CONSTRAINT uk_products_store_sku UNIQUE(store_id, sku),
  CONSTRAINT check_price CHECK (price >= 0),
  CONSTRAINT check_inventory CHECK (inventory IS NULL OR inventory >= 0),
  CONSTRAINT check_title CHECK (LENGTH(TRIM(title)) > 0),
  CONSTRAINT check_sku CHECK (LENGTH(TRIM(sku)) > 0)
);

CREATE TABLE IF NOT EXISTS product_pages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL,
  landing_url     TEXT NOT NULL,
  html_snapshot   TEXT,
  last_fetched_at TIMESTAMPTZ,
  fetch_status    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_pages_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT uk_pages_product UNIQUE(product_id),
  CONSTRAINT check_url CHECK (landing_url ~* '^https?://')
);

-- =========================================================
-- 6. CUSTOMERS & ORDERS
-- =========================================================

CREATE TABLE IF NOT EXISTS customers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL,
  email      TEXT,
  phone      TEXT,
  name       TEXT,
  metadata   JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_customers_store
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT check_contact
    CHECK (email IS NOT NULL OR phone IS NOT NULL),
  CONSTRAINT check_email
    CHECK (email IS NULL OR email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

CREATE TABLE IF NOT EXISTS orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id            UUID NOT NULL,
  customer_id         UUID,
  external_id         TEXT NOT NULL,
  status              order_status NOT NULL DEFAULT 'new',
  raw_payload         JSONB NOT NULL,
  decision_result     JSONB,
  decision_by         TEXT,
  decision_confidence NUMERIC(5,4),
  decision_reason     TEXT,
  total_amount        NUMERIC(12,2),
  currency            TEXT DEFAULT 'USD',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_orders_store
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_orders_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  CONSTRAINT uk_orders_external UNIQUE(store_id, external_id),
  CONSTRAINT check_confidence
    CHECK (decision_confidence IS NULL OR (decision_confidence >= 0 AND decision_confidence <= 1)),
  CONSTRAINT check_external_id CHECK (LENGTH(TRIM(external_id)) > 0),
  CONSTRAINT check_total CHECK (total_amount IS NULL OR total_amount >= 0)
);

-- Backfill columns/constraints for legacy orders (MUST be before trigger creation)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS external_id         TEXT,
  ADD COLUMN IF NOT EXISTS total_amount        NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS currency            TEXT DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS created_at          TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS decision_result     JSONB,
  ADD COLUMN IF NOT EXISTS decision_by         TEXT,
  ADD COLUMN IF NOT EXISTS decision_confidence NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS decision_reason     TEXT;

DO $$ BEGIN
  BEGIN
    ALTER TABLE orders ALTER COLUMN created_at SET DEFAULT NOW();
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    ALTER TABLE orders ALTER COLUMN updated_at SET DEFAULT NOW();
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_orders_external') THEN
    ALTER TABLE orders ADD CONSTRAINT uk_orders_external UNIQUE(store_id, external_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_confidence') THEN
    ALTER TABLE orders ADD CONSTRAINT check_confidence
      CHECK (decision_confidence IS NULL OR (decision_confidence >= 0 AND decision_confidence <= 1));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS order_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   UUID NOT NULL,
  product_id UUID,
  sku        TEXT,
  quantity   INTEGER NOT NULL DEFAULT 1,
  price      NUMERIC(12,2),
  metadata   JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_items_order
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_items_product
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  CONSTRAINT check_qty CHECK (quantity > 0),
  CONSTRAINT check_price CHECK (price IS NULL OR price >= 0)
);

-- =========================================================
-- 7. CONVERSATIONS & MESSAGES
-- =========================================================

CREATE TABLE IF NOT EXISTS conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL,
  seller_id       UUID NOT NULL,
  customer_id     UUID,
  origin          TEXT NOT NULL,
  status          conversation_status NOT NULL DEFAULT 'open',
  awaiting_reply  BOOLEAN NOT NULL DEFAULT FALSE,
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_conversations_store
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_conversations_seller
    FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE,
  CONSTRAINT fk_conversations_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  CONSTRAINT check_origin CHECK (LENGTH(TRIM(origin)) > 0)
);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  role            message_role NOT NULL,
  content         TEXT NOT NULL,
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_messages_conversation
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT check_content CHECK (LENGTH(TRIM(content)) > 0)
);

-- =========================================================
-- 8. AI & TRAINING
-- =========================================================

CREATE TABLE IF NOT EXISTS ai_chat_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id  UUID NOT NULL,
  store_id   UUID,
  title      TEXT,
  model      TEXT DEFAULT 'gpt-4o-mini',
  metadata   JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_ai_sessions_seller
    FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_sessions_store
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL,
  role              message_role NOT NULL,
  content           TEXT NOT NULL,
  model             TEXT,
  tokens_prompt     INTEGER,
  tokens_completion INTEGER,
  latency_ms        INTEGER,
  metadata          JSONB DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_ai_messages_session
    FOREIGN KEY (session_id) REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
  CONSTRAINT check_content CHECK (LENGTH(TRIM(content)) > 0),
  CONSTRAINT check_tokens 
    CHECK ((tokens_prompt IS NULL OR tokens_prompt >= 0) 
       AND (tokens_completion IS NULL OR tokens_completion >= 0)),
  CONSTRAINT check_latency CHECK (latency_ms IS NULL OR latency_ms >= 0)
);

CREATE TABLE IF NOT EXISTS seller_models (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id      UUID NOT NULL,
  base_model     TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  deployed_model TEXT,
  status         model_status NOT NULL DEFAULT 'base',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_models_seller
    FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS training_datasets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id     UUID NOT NULL,
  example_count INTEGER NOT NULL DEFAULT 0,
  storage_uri   TEXT,
  metadata      JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_datasets_seller
    FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE,
  CONSTRAINT check_examples CHECK (example_count >= 0)
);

CREATE TABLE IF NOT EXISTS training_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id       UUID NOT NULL,
  dataset_id      UUID,
  provider        TEXT NOT NULL DEFAULT 'openai',
  external_job_id TEXT,
  status          training_job_status NOT NULL DEFAULT 'queued',
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  CONSTRAINT fk_jobs_seller
    FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE,
  CONSTRAINT fk_jobs_dataset
    FOREIGN KEY (dataset_id) REFERENCES training_datasets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS playbooks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id  UUID NOT NULL,
  name       TEXT NOT NULL,
  content    JSONB NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_playbooks_seller
    FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE,
  CONSTRAINT check_name CHECK (LENGTH(TRIM(name)) > 0),
  CONSTRAINT check_version CHECK (version > 0)
);

-- =========================================================
-- 9. EMBEDDINGS & SEARCH
-- =========================================================

CREATE TABLE IF NOT EXISTS embeddings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id       UUID NOT NULL,
  store_id        UUID,
  namespace       TEXT NOT NULL DEFAULT 'default',
  entity_type     TEXT NOT NULL,
  entity_id       UUID NOT NULL,
  text_content    TEXT NOT NULL,
  metadata        JSONB DEFAULT '{}'::jsonb,
  embedding       vector(1536) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_embeddings_seller
    FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE,
  CONSTRAINT fk_embeddings_store
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT check_namespace CHECK (LENGTH(TRIM(namespace)) > 0),
  CONSTRAINT check_entity_type 
    CHECK (entity_type IN ('product', 'conversation', 'message', 'playbook'))
);

-- Safe backfill in case of older shape
ALTER TABLE embeddings
  ADD COLUMN IF NOT EXISTS namespace    TEXT DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS entity_type  TEXT,
  ADD COLUMN IF NOT EXISTS entity_id    UUID,
  ADD COLUMN IF NOT EXISTS text_content TEXT,
  ADD COLUMN IF NOT EXISTS metadata     JSONB DEFAULT '{}'::jsonb;

DO $$ BEGIN
  BEGIN ALTER TABLE embeddings ALTER COLUMN namespace    SET NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE embeddings ALTER COLUMN entity_type  SET NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE embeddings ALTER COLUMN entity_id    SET NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE embeddings ALTER COLUMN text_content SET NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE embeddings ALTER COLUMN embedding    SET NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- =========================================================
-- 10. USAGE & METRICS
-- =========================================================

CREATE TABLE IF NOT EXISTS usage_counters (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id          UUID NOT NULL,
  period_start       DATE NOT NULL,
  period_end         DATE NOT NULL,
  stores_used        INTEGER NOT NULL DEFAULT 0,
  products_used      INTEGER NOT NULL DEFAULT 0,
  confirmations_used INTEGER NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_usage_seller
    FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE,
  CONSTRAINT uk_usage_period UNIQUE(seller_id, period_start, period_end),
  CONSTRAINT check_period CHECK (period_end >= period_start),
  CONSTRAINT check_counts 
    CHECK (stores_used >= 0 AND products_used >= 0 AND confirmations_used >= 0)
);

CREATE TABLE IF NOT EXISTS usage_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id  UUID NOT NULL,
  event_type TEXT NOT NULL,
  delta      INTEGER NOT NULL,
  context    JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_events_seller
    FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE,
  CONSTRAINT check_event_type 
    CHECK (event_type IN ('store_added', 'product_added', 'confirmation_sent',
                          'store_removed', 'product_removed'))
);

CREATE TABLE IF NOT EXISTS metrics_daily (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id        UUID NOT NULL,
  store_id         UUID,
  product_id       UUID,
  metric_date      DATE NOT NULL,
  impressions      INTEGER NOT NULL DEFAULT 0,
  conversations    INTEGER NOT NULL DEFAULT 0,
  ai_confirmations INTEGER NOT NULL DEFAULT 0,
  orders_count     INTEGER NOT NULL DEFAULT 0,
  revenue          NUMERIC(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_metrics_seller
    FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE,
  CONSTRAINT uk_metrics_daily UNIQUE(seller_id, store_id, product_id, metric_date),
  CONSTRAINT check_metrics 
    CHECK (impressions >= 0 AND conversations >= 0 AND ai_confirmations >= 0 
       AND orders_count >= 0 AND revenue >= 0)
);

ALTER TABLE metrics_daily
  ADD COLUMN IF NOT EXISTS metric_date      DATE,
  ADD COLUMN IF NOT EXISTS impressions      INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversations    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_confirmations INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS orders_count     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revenue          NUMERIC(12,2) DEFAULT 0;

DO $$ BEGIN
  UPDATE metrics_daily SET metric_date = CURRENT_DATE WHERE metric_date IS NULL;

  BEGIN ALTER TABLE metrics_daily ALTER COLUMN metric_date      SET NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE metrics_daily ALTER COLUMN impressions      SET NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE metrics_daily ALTER COLUMN conversations    SET NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE metrics_daily ALTER COLUMN ai_confirmations SET NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE metrics_daily ALTER COLUMN orders_count     SET NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE metrics_daily ALTER COLUMN revenue          SET NOT NULL; EXCEPTION WHEN OTHERS THEN NULL; END;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_metrics_daily') THEN
    ALTER TABLE metrics_daily
      ADD CONSTRAINT uk_metrics_daily UNIQUE(seller_id, store_id, product_id, metric_date);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ingestion_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_sheet_id  UUID NOT NULL,
  run_id          TEXT NOT NULL,
  row_number      INTEGER NOT NULL,
  external_row_id TEXT,
  status          TEXT NOT NULL,
  error_message   TEXT,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key TEXT NOT NULL UNIQUE,
  CONSTRAINT fk_audit_sheet
    FOREIGN KEY (store_sheet_id) REFERENCES store_sheets(id) ON DELETE CASCADE,
  CONSTRAINT check_status CHECK (status IN ('success', 'error', 'skipped')),
  CONSTRAINT check_row CHECK (row_number > 0)
);

-- =========================================================
-- 11. SYSTEM TABLES
-- =========================================================

CREATE TABLE IF NOT EXISTS app_kv (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS error_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id     UUID,
  error_message TEXT NOT NULL,
  error_stack   TEXT,
  context       JSONB DEFAULT '{}'::jsonb,
  severity      TEXT NOT NULL DEFAULT 'error',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_errors_seller
    FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE,
  CONSTRAINT check_severity 
    CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical'))
);

CREATE TABLE IF NOT EXISTS performance_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id   UUID,
  operation   TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  success     BOOLEAN NOT NULL DEFAULT TRUE,
  metadata    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_perf_seller
    FOREIGN KEY (seller_id) REFERENCES sellers(id) ON DELETE CASCADE,
  CONSTRAINT check_duration CHECK (duration_ms >= 0)
);

-- =========================================================
-- 12. INDEXES (Performance-optimized)
-- =========================================================

-- Sellers & Authentication
CREATE UNIQUE INDEX IF NOT EXISTS idx_sellers_email_lower ON sellers (LOWER(user_email));
CREATE INDEX IF NOT EXISTS idx_sellers_plan ON sellers(plan_code);
CREATE INDEX IF NOT EXISTS idx_sellers_subscription ON sellers(subscription_status) WHERE locked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sellers_locked ON sellers(id, locked_at) WHERE locked_at IS NOT NULL;

-- Stores
CREATE INDEX IF NOT EXISTS idx_stores_seller ON stores(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_stores_active ON stores(seller_id) WHERE status = 'active';

-- Store Sheets
CREATE INDEX IF NOT EXISTS idx_sheets_store ON store_sheets(store_id);
CREATE INDEX IF NOT EXISTS idx_sheets_seller ON store_sheets(seller_id);
CREATE INDEX IF NOT EXISTS idx_sheets_sync ON store_sheets(last_synced_at) WHERE enabled = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sheets_unique ON store_sheets(store_id, gsheet_url, COALESCE(sheet_tab, 'default'));
-- Exactly one enabled sheet per store
CREATE UNIQUE INDEX IF NOT EXISTS idx_sheets_one_enabled_per_store
  ON store_sheets(store_id) WHERE enabled IS TRUE;

-- Products
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id, status);
CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(store_id, sku);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(store_id, seller_id) WHERE status = 'active';

-- Customers
CREATE INDEX IF NOT EXISTS idx_customers_store ON customers(store_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_contact ON customers(store_id, COALESCE(email, ''), COALESCE(phone, ''));

-- Orders
CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_external ON orders(store_id, external_id);
CREATE INDEX IF NOT EXISTS idx_orders_processing ON orders(store_id, created_at DESC) 
  WHERE status IN ('new', 'processing');

-- Order Items
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_product ON order_items(product_id);

-- Conversations & Messages
CREATE INDEX IF NOT EXISTS idx_conversations_store ON conversations(store_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_seller ON conversations(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_customer ON conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_open ON conversations(store_id, updated_at DESC) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_conversations_awaiting ON conversations(store_id, updated_at DESC) WHERE awaiting_reply = TRUE;

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);

-- AI Chat
CREATE INDEX IF NOT EXISTS idx_ai_sessions_seller ON ai_chat_sessions(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_store ON ai_chat_sessions(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_chat_messages(session_id, created_at);

-- Embeddings
CREATE INDEX IF NOT EXISTS idx_embeddings_seller ON embeddings(seller_id, namespace);
CREATE INDEX IF NOT EXISTS idx_embeddings_store ON embeddings(store_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_entity ON embeddings(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON embeddings 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Usage & Metrics
CREATE INDEX IF NOT EXISTS idx_usage_seller ON usage_counters(seller_id, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_usage_current ON usage_counters(seller_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_events_seller ON usage_events(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_seller ON metrics_daily(seller_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_store ON metrics_daily(store_id, metric_date DESC);

-- Audit
CREATE INDEX IF NOT EXISTS idx_audit_sheet ON ingestion_audit(store_sheet_id, processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_run ON ingestion_audit(run_id, status);

-- System Logs
CREATE INDEX IF NOT EXISTS idx_errors_seller ON error_logs(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_errors_severity ON error_logs(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_perf_operation ON performance_logs(operation, created_at DESC);

-- =========================================================
-- 13. FUNCTIONS
-- =========================================================

-- Atomic additive UPSERT for metrics
CREATE OR REPLACE FUNCTION app.upsert_metrics_day(
  p_seller_id        UUID,
  p_store_id         UUID,
  p_metric_date      DATE,
  p_impressions      INTEGER DEFAULT 0,
  p_conversations    INTEGER DEFAULT 0,
  p_ai_confirmations INTEGER DEFAULT 0,
  p_orders_count     INTEGER DEFAULT 0,
  p_revenue          NUMERIC(12,2) DEFAULT 0
)
RETURNS VOID
LANGUAGE sql
AS $$
  INSERT INTO app.metrics_daily AS md (
    seller_id, store_id, product_id, metric_date,
    impressions, conversations, ai_confirmations, orders_count, revenue
  )
  VALUES (
    p_seller_id, p_store_id, NULL, p_metric_date,
    GREATEST(p_impressions,0),
    GREATEST(p_conversations,0),
    GREATEST(p_ai_confirmations,0),
    GREATEST(p_orders_count,0),
    GREATEST(p_revenue,0)
  )
  ON CONFLICT (seller_id, store_id, product_id, metric_date)
  DO UPDATE SET
    impressions      = md.impressions      + GREATEST(EXCLUDED.impressions,0),
    conversations    = md.conversations    + GREATEST(EXCLUDED.conversations,0),
    ai_confirmations = md.ai_confirmations + GREATEST(EXCLUDED.ai_confirmations,0),
    orders_count     = md.orders_count     + GREATEST(EXCLUDED.orders_count,0),
    revenue          = md.revenue          + GREATEST(EXCLUDED.revenue,0);
$$;

-- Detect AI-confirmed order
CREATE OR REPLACE FUNCTION app._order_is_ai_confirmed(
  p_decision_by TEXT,
  p_decision_result JSONB
)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT (COALESCE(p_decision_by, '') = 'ai')
         AND (
           (p_decision_result ? 'status'   AND p_decision_result->>'status'   ILIKE 'confirmed')
        OR (p_decision_result ? 'decision' AND p_decision_result->>'decision' ILIKE 'confirm%')
         );
$$;

-- Fix: rebuild_metrics_range typo on decision_result
SET search_path = app, public;

CREATE OR REPLACE FUNCTION app.rebuild_metrics_range(
  p_seller_id UUID,
  p_from DATE,
  p_to   DATE
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_upserts INTEGER := 0;
BEGIN
  -- Remove existing daily aggregates for this window (store-level rows only)
  DELETE FROM app.metrics_daily md
  WHERE md.seller_id = p_seller_id
    AND md.metric_date BETWEEN p_from AND p_to
    AND md.product_id IS NULL;

  WITH o AS (
    SELECT
      s.seller_id,
      o.store_id,
      DATE(o.created_at) AS d,
      COUNT(*)                        AS orders_count,
      COALESCE(SUM(o.total_amount),0) AS revenue,
      COALESCE(SUM(CASE
        WHEN app._order_is_ai_confirmed(o.decision_by, o.decision_result) THEN 1 ELSE 0
      END), 0)                        AS ai_confirmations
    FROM app.orders o
    JOIN app.stores s ON s.id = o.store_id
    WHERE s.seller_id = p_seller_id
      AND o.created_at::date BETWEEN p_from AND p_to
    GROUP BY s.seller_id, o.store_id, DATE(o.created_at)
  ),
  c AS (
    SELECT
      seller_id,
      store_id,
      DATE(created_at) AS d,
      COUNT(*) AS conversations
    FROM app.conversations
    WHERE seller_id = p_seller_id
      AND created_at::date BETWEEN p_from AND p_to
    GROUP BY seller_id, store_id, DATE(created_at)
  ),
  j AS (
    SELECT
      COALESCE(o.seller_id, c.seller_id) AS seller_id,
      COALESCE(o.store_id,  c.store_id ) AS store_id,
      COALESCE(o.d, c.d)                 AS d,
      COALESCE(o.orders_count, 0)        AS orders_count,
      COALESCE(o.revenue, 0)             AS revenue,
      COALESCE(o.ai_confirmations, 0)    AS ai_confirmations,
      COALESCE(c.conversations, 0)       AS conversations
    FROM o
    FULL OUTER JOIN c
      ON o.seller_id = c.seller_id
     AND o.store_id  = c.store_id
     AND o.d         = c.d
  )
  INSERT INTO app.metrics_daily (
    seller_id, store_id, product_id, metric_date,
    impressions, conversations, ai_confirmations, orders_count, revenue
  )
  SELECT
    j.seller_id, j.store_id, NULL, j.d,
    0, j.conversations, j.ai_confirmations, j.orders_count, j.revenue
  FROM j;

  GET DIAGNOSTICS v_upserts = ROW_COUNT;
  RETURN COALESCE(v_upserts, 0);
END;
$$;

-- Impressions bump
CREATE OR REPLACE FUNCTION app.bump_impressions(
  p_seller_id UUID,
  p_store_id  UUID,
  p_at        TIMESTAMPTZ,
  p_count     INTEGER
) RETURNS VOID
LANGUAGE sql
AS $$
  SELECT app.upsert_metrics_day(
    p_seller_id, p_store_id, DATE(p_at),
    COALESCE(p_count,0), 0, 0, 0, 0
  );
$$;

-- Seller lock check
CREATE OR REPLACE FUNCTION is_seller_locked(p_seller_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE PARALLEL SAFE
AS $$
DECLARE
  v_locked_at TIMESTAMPTZ;
  v_status subscription_status;
  v_plan_code TEXT;
BEGIN
  SELECT locked_at, subscription_status, plan_code
  INTO v_locked_at, v_status, v_plan_code
  FROM sellers
  WHERE id = p_seller_id;

  IF NOT FOUND THEN
    RETURN TRUE;
  END IF;

  IF v_locked_at IS NOT NULL THEN
    RETURN TRUE;
  END IF;

  IF v_plan_code = 'basic' THEN
    RETURN FALSE;
  END IF;

  IF v_status IN ('canceled', 'past_due') THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- Flip expired trials
CREATE OR REPLACE FUNCTION flip_expired_trials()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE sellers
  SET subscription_status = 'past_due',
      updated_at = NOW()
  WHERE subscription_status = 'trialing'
    AND trial_ends_at IS NOT NULL
    AND trial_ends_at < NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count > 0 THEN
    INSERT INTO error_logs (error_message, context, severity)
    VALUES ('Auto-flipped expired trials to past_due',
            jsonb_build_object('count', v_count, 'timestamp', NOW()),
            'info');
  END IF;

  RETURN v_count;
END;
$$;

-- Vector similarity search
CREATE OR REPLACE FUNCTION search_embeddings(
  p_seller_id UUID,
  p_namespace TEXT,
  p_query_vector vector(1536),
  p_limit INTEGER DEFAULT 10,
  p_store_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  entity_type TEXT,
  entity_id UUID,
  text_content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT 
    e.id,
    e.entity_type,
    e.entity_id,
    e.text_content,
    e.metadata,
    1 - (e.embedding <=> p_query_vector) AS similarity
  FROM embeddings e
  WHERE e.seller_id = p_seller_id
    AND e.namespace = p_namespace
    AND (p_store_id IS NULL OR e.store_id = p_store_id)
  ORDER BY e.embedding <=> p_query_vector
  LIMIT p_limit;
$$;

-- Usage helpers
CREATE OR REPLACE FUNCTION get_seller_usage(p_seller_id UUID)
RETURNS TABLE (
  stores_used INTEGER,
  products_used INTEGER,
  confirmations_used INTEGER,
  stores_limit INTEGER,
  products_limit INTEGER,
  confirmations_limit INTEGER,
  stores_available INTEGER,
  products_available INTEGER,
  confirmations_available INTEGER
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_plan plans%ROWTYPE;
BEGIN
  SELECT p.* INTO v_plan
  FROM sellers s
  JOIN plans p ON p.code = s.plan_code
  WHERE s.id = p_seller_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller % not found', p_seller_id;
  END IF;

  RETURN QUERY
  SELECT 
    COALESCE(uc.stores_used, 0)::INTEGER,
    COALESCE(uc.products_used, 0)::INTEGER,
    COALESCE(uc.confirmations_used, 0)::INTEGER,
    v_plan.store_limit,
    v_plan.product_limit,
    v_plan.confirm_limit,
    GREATEST(0, v_plan.store_limit - COALESCE(uc.stores_used, 0))::INTEGER,
    GREATEST(0, v_plan.product_limit - COALESCE(uc.products_used, 0))::INTEGER,
    GREATEST(0, v_plan.confirm_limit - COALESCE(uc.confirmations_used, 0))::INTEGER
  FROM usage_counters uc
  WHERE uc.seller_id = p_seller_id
    AND uc.period_start <= CURRENT_DATE
    AND uc.period_end >= CURRENT_DATE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT 0, 0, 0,
           v_plan.store_limit,
           v_plan.product_limit,
           v_plan.confirm_limit,
           v_plan.store_limit,
           v_plan.product_limit,
           v_plan.confirm_limit;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION increment_usage(
  p_seller_id UUID,
  p_event_type TEXT,
  p_delta INTEGER DEFAULT 1
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_period_start DATE;
  v_period_end DATE;
BEGIN
  SELECT 
    billing_cycle_start,
    CASE 
      WHEN billing_period = 'monthly' THEN billing_cycle_start + INTERVAL '1 month' - INTERVAL '1 day'
      WHEN billing_period = 'yearly' THEN billing_cycle_start + INTERVAL '1 year' - INTERVAL '1 day'
    END::DATE
  INTO v_period_start, v_period_end
  FROM sellers
  WHERE id = p_seller_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller % not found', p_seller_id;
  END IF;

  INSERT INTO usage_counters (seller_id, period_start, period_end, stores_used, products_used, confirmations_used)
  VALUES (
    p_seller_id, 
    v_period_start, 
    v_period_end,
    CASE WHEN p_event_type IN ('store_added') THEN p_delta ELSE 0 END,
    CASE WHEN p_event_type IN ('product_added') THEN p_delta ELSE 0 END,
    CASE WHEN p_event_type IN ('confirmation_sent') THEN p_delta ELSE 0 END
  )
  ON CONFLICT (seller_id, period_start, period_end) DO UPDATE
  SET stores_used = usage_counters.stores_used + 
        CASE WHEN p_event_type IN ('store_added') THEN p_delta 
             WHEN p_event_type IN ('store_removed') THEN -p_delta 
             ELSE 0 END,
      products_used = usage_counters.products_used + 
        CASE WHEN p_event_type IN ('product_added') THEN p_delta 
             WHEN p_event_type IN ('product_removed') THEN -p_delta 
             ELSE 0 END,
      confirmations_used = usage_counters.confirmations_used + 
        CASE WHEN p_event_type IN ('confirmation_sent') THEN p_delta ELSE 0 END,
      updated_at = NOW();

  INSERT INTO usage_events (seller_id, event_type, delta)
  VALUES (p_seller_id, p_event_type, p_delta);
END;
$$;

CREATE OR REPLACE FUNCTION check_usage_limit(
  p_seller_id UUID,
  p_limit_type TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_usage RECORD;
BEGIN
  SELECT * INTO v_usage FROM get_seller_usage(p_seller_id);

  RETURN CASE p_limit_type
    WHEN 'stores' THEN v_usage.stores_available > 0
    WHEN 'products' THEN v_usage.products_available > 0
    WHEN 'confirmations' THEN v_usage.confirmations_available > 0
    ELSE FALSE
  END;
END;
$$;

-- =========================================================
-- 14. TRIGGERS
-- =========================================================

-- Orders → metrics_daily
CREATE OR REPLACE FUNCTION app.trg_orders_to_metrics()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_seller_id UUID;
  v_day       DATE;
  v_now       BOOLEAN;
  v_prev      BOOLEAN;
  v_amount    NUMERIC(12,2);
BEGIN
  SELECT s.seller_id INTO v_seller_id
  FROM app.stores s
  WHERE s.id = COALESCE(NEW.store_id, OLD.store_id);

  IF v_seller_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_day    := DATE(NEW.created_at);
    v_now    := app._order_is_ai_confirmed(NEW.decision_by, NEW.decision_result);
    v_amount := COALESCE(NEW.total_amount, 0);

    PERFORM app.upsert_metrics_day(
      v_seller_id, NEW.store_id, v_day,
      0, 0,
      CASE WHEN v_now THEN 1 ELSE 0 END,
      1,
      v_amount
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_day  := DATE(COALESCE(NEW.created_at, OLD.created_at));
    v_now  := app._order_is_ai_confirmed(NEW.decision_by, NEW.decision_result);
    v_prev := app._order_is_ai_confirmed(OLD.decision_by, OLD.decision_result);

    IF v_now AND NOT v_prev THEN
      PERFORM app.upsert_metrics_day(v_seller_id, COALESCE(NEW.store_id, OLD.store_id), v_day, 0, 0, 1, 0, 0);
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_metrics ON app.orders;
CREATE TRIGGER trg_orders_metrics
  AFTER INSERT OR UPDATE OF decision_by, decision_result, created_at, store_id, total_amount
  ON app.orders
  FOR EACH ROW
  EXECUTE FUNCTION app.trg_orders_to_metrics();

-- Conversations → metrics_daily
CREATE OR REPLACE FUNCTION app.trg_conversations_to_metrics()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM app.upsert_metrics_day(
    NEW.seller_id,
    NEW.store_id,
    DATE(NEW.created_at),
    0, 1, 0, 0, 0
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversations_metrics ON app.conversations;
CREATE TRIGGER trg_conversations_metrics
  AFTER INSERT ON app.conversations
  FOR EACH ROW
  EXECUTE FUNCTION app.trg_conversations_to_metrics();

-- Auto-sync conversation seller_id from store
CREATE OR REPLACE FUNCTION sync_conversation_seller()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.store_id IS DISTINCT FROM OLD.store_id) THEN
    SELECT seller_id INTO NEW.seller_id
    FROM stores
    WHERE id = NEW.store_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversation_sync_seller ON conversations;
CREATE TRIGGER trg_conversation_sync_seller
  BEFORE INSERT OR UPDATE OF store_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION sync_conversation_seller();

-- Manage conversation awaiting_reply status
CREATE OR REPLACE FUNCTION manage_conversation_awaiting()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_has_user_message BOOLEAN;
BEGIN
  IF NEW.role IN ('assistant', 'agent') THEN
    SELECT EXISTS(
      SELECT 1 FROM messages
      WHERE conversation_id = NEW.conversation_id
        AND role = 'user'
      LIMIT 1
    ) INTO v_has_user_message;

    IF NOT v_has_user_message THEN
      UPDATE conversations
      SET awaiting_reply = TRUE,
          status = 'open',
          updated_at = NOW()
      WHERE id = NEW.conversation_id;
    END IF;
  END IF;

  IF NEW.role = 'user' THEN
    UPDATE conversations
    SET awaiting_reply = FALSE,
        updated_at = NOW()
    WHERE id = NEW.conversation_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_message_awaiting ON messages;
CREATE TRIGGER trg_message_awaiting
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION manage_conversation_awaiting();

-- Auto-update timestamps (generic)
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN 
    SELECT table_name 
    FROM information_schema.columns 
    WHERE table_schema = 'app' 
      AND column_name = 'updated_at'
      AND table_name NOT IN ('app_kv')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_timestamp ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_timestamp 
                    BEFORE UPDATE ON %I 
                    FOR EACH ROW EXECUTE FUNCTION update_timestamp()', t, t);
  END LOOP;
END;
$$;

-- =========================================================
-- 15. ROW-LEVEL SECURITY (RLS)
-- =========================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
    CREATE ROLE app_admin NOLOGIN BYPASSRLS;
  END IF;
END $$;

-- Best-effort: grant role memberships; ignore if lacking privilege
DO $$ BEGIN
  BEGIN EXECUTE format('GRANT app_user  TO %I', current_user);  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN EXECUTE format('GRANT app_admin TO %I', current_user);  EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- Helper for current seller
CREATE OR REPLACE FUNCTION current_seller_id()
RETURNS UUID
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT NULLIF(current_setting('app.current_seller', true), '')::UUID; $$;

DROP FUNCTION IF EXISTS set_current_seller(uuid);
CREATE OR REPLACE FUNCTION set_current_seller(p_seller_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$ BEGIN
  PERFORM set_config('app.current_seller', COALESCE(p_seller_id::TEXT, ''), false);
END $$;

-- Enable RLS on user tables
DO $$ DECLARE t TEXT;
BEGIN
  FOR t IN 
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'app'
      AND tablename NOT IN ('plans', 'app_kv', 'error_logs', 'performance_logs')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Seller policy
DROP POLICY IF EXISTS sellers_policy ON sellers;
CREATE POLICY sellers_policy ON sellers
  FOR ALL TO app_user
  USING (id = current_seller_id())
  WITH CHECK (id = current_seller_id());

-- Direct seller_id tables (no seller_channels here)
DO $$ DECLARE t TEXT;
  tables TEXT[] := ARRAY[
    'stores', 'store_sheets', 'products',
    'seller_models', 'training_datasets', 'training_jobs', 'playbooks',
    'embeddings', 'usage_counters', 'usage_events', 'metrics_daily',
    'ai_chat_sessions', 'billing_history'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_policy ON %I', t, t);
    EXECUTE format('
      CREATE POLICY %I_policy ON %I
        FOR ALL TO app_user
        USING (seller_id = current_seller_id())
        WITH CHECK (seller_id = current_seller_id())', t, t);
  END LOOP;
END $$;

-- Store-related
DROP POLICY IF EXISTS customers_policy ON customers;
CREATE POLICY customers_policy ON customers
  FOR ALL TO app_user
  USING (EXISTS (
    SELECT 1 FROM stores 
    WHERE stores.id = customers.store_id 
      AND stores.seller_id = current_seller_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM stores 
    WHERE stores.id = customers.store_id 
      AND stores.seller_id = current_seller_id()
  ));

DROP POLICY IF EXISTS orders_policy ON orders;
CREATE POLICY orders_policy ON orders
  FOR ALL TO app_user
  USING (EXISTS (
    SELECT 1 FROM stores 
    WHERE stores.id = orders.store_id 
      AND stores.seller_id = current_seller_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM stores 
    WHERE stores.id = orders.store_id 
      AND stores.seller_id = current_seller_id()
  ));

DROP POLICY IF EXISTS order_items_policy ON order_items;
CREATE POLICY order_items_policy ON order_items
  FOR ALL TO app_user
  USING (EXISTS (
    SELECT 1 FROM orders 
    JOIN stores ON stores.id = orders.store_id
    WHERE orders.id = order_items.order_id 
      AND stores.seller_id = current_seller_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM orders 
    JOIN stores ON stores.id = orders.store_id
    WHERE orders.id = order_items.order_id 
      AND stores.seller_id = current_seller_id()
  ));

DROP POLICY IF EXISTS product_pages_policy ON product_pages;
CREATE POLICY product_pages_policy ON product_pages
  FOR ALL TO app_user
  USING (EXISTS (
    SELECT 1 FROM products 
    WHERE products.id = product_pages.product_id 
      AND products.seller_id = current_seller_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM products 
    WHERE products.id = product_pages.product_id 
      AND products.seller_id = current_seller_id()
  ));

-- Conversations/messages
DROP POLICY IF EXISTS conversations_policy ON conversations;
CREATE POLICY conversations_policy ON conversations
  FOR ALL TO app_user
  USING (seller_id = current_seller_id())
  WITH CHECK (seller_id = current_seller_id());

DROP POLICY IF EXISTS messages_policy ON messages;
CREATE POLICY messages_policy ON messages
  FOR ALL TO app_user
  USING (EXISTS (
    SELECT 1 FROM conversations 
    WHERE conversations.id = messages.conversation_id 
      AND conversations.seller_id = current_seller_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM conversations 
    WHERE conversations.id = messages.conversation_id 
      AND conversations.seller_id = current_seller_id()
  ));

-- Ingestion audit
DROP POLICY IF EXISTS ingestion_audit_policy ON ingestion_audit;
CREATE POLICY ingestion_audit_policy ON ingestion_audit
  FOR ALL TO app_user
  USING (EXISTS (
    SELECT 1 FROM store_sheets 
    WHERE store_sheets.id = ingestion_audit.store_sheet_id 
      AND store_sheets.seller_id = current_seller_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM store_sheets 
    WHERE store_sheets.id = ingestion_audit.store_sheet_id 
      AND store_sheets.seller_id = current_seller_id()
  ));

-- =========================================================
-- 16. PRIVILEGES
-- =========================================================

-- Schema privileges
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO app_user, app_admin;

DO $$ BEGIN
  BEGIN
    EXECUTE format('GRANT USAGE, CREATE ON SCHEMA app TO %I', current_user);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping GRANT on schema app to % due to insufficient privilege', current_user;
  END;
END $$;

-- Table privileges
DO $$ DECLARE t TEXT;
BEGIN
  FOR t IN 
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'app'
  LOOP
    BEGIN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO app_user, app_admin', t);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipping GRANT on table %', t;
    END;
  END LOOP;
END $$;

-- Sequence privileges
DO $$ DECLARE s TEXT;
BEGIN
  FOR s IN 
    SELECT sequencename 
    FROM pg_sequences 
    WHERE schemaname = 'app'
  LOOP
    BEGIN
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I TO app_user, app_admin', s);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipping GRANT on sequence %', s;
    END;
  END LOOP;
END $$;

-- Function privileges
DO $$ BEGIN
  BEGIN GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_user, app_admin; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- Default privileges (future tables)
ALTER DEFAULT PRIVILEGES IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user, app_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
  GRANT USAGE, SELECT ON SEQUENCES TO app_user, app_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
  GRANT EXECUTE ON FUNCTIONS TO app_user, app_admin;

-- =========================================================
-- 17. VIEWS
-- =========================================================

CREATE OR REPLACE VIEW v_seller_dashboard AS
SELECT 
  s.id,
  s.user_email,
  s.company_name,
  s.plan_code,
  s.subscription_status,
  COUNT(DISTINCT st.id) FILTER (WHERE st.status = 'active') AS active_stores,
  COUNT(DISTINCT p.id)  FILTER (WHERE p.status  = 'active') AS active_products,
  COUNT(DISTINCT o.id)  FILTER (WHERE o.created_at >= CURRENT_DATE - 30) AS orders_30d,
  COALESCE(SUM(o.total_amount) FILTER (WHERE o.created_at >= CURRENT_DATE - 30), 0) AS revenue_30d,
  COUNT(DISTINCT c.id)  FILTER (WHERE c.status = 'open') AS open_conversations,
  COUNT(DISTINCT c.id)  FILTER (WHERE c.awaiting_reply)   AS awaiting_reply
FROM sellers s
LEFT JOIN stores        st ON st.seller_id = s.id
LEFT JOIN products      p  ON p.seller_id  = s.id
LEFT JOIN orders        o  ON o.store_id   = st.id
LEFT JOIN conversations c  ON c.seller_id  = s.id
GROUP BY s.id, s.user_email, s.company_name, s.plan_code, s.subscription_status;

CREATE OR REPLACE VIEW v_seller_subscription_status AS
SELECT
  s.id AS seller_id,
  s.user_email,
  s.company_name,
  s.plan_code,
  s.billing_period,
  CASE
    WHEN s.locked_at IS NOT NULL THEN 'locked'
    WHEN is_seller_locked(s.id) THEN 'locked'
    WHEN s.subscription_status IN ('canceled', 'past_due') THEN 'expired'
    WHEN s.subscription_status = 'trialing' 
         AND s.trial_ends_at IS NOT NULL 
         AND s.trial_ends_at < NOW() THEN 'expired'
    WHEN s.subscription_status = 'trialing' THEN 'grace'
    ELSE 'active'
  END AS effective_status,
  s.subscription_status AS raw_status,
  s.trial_ends_at,
  s.locked_at,
  s.lock_reason,
  s.billing_cycle_start,
  (s.locked_at IS NOT NULL OR is_seller_locked(s.id)) AS is_locked,
  (s.subscription_status = 'trialing' 
   AND s.trial_ends_at IS NOT NULL 
   AND s.trial_ends_at > NOW()) AS is_in_trial,
  CASE 
    WHEN s.trial_ends_at IS NOT NULL AND s.trial_ends_at > NOW() 
    THEN EXTRACT(EPOCH FROM (s.trial_ends_at - NOW()))::INTEGER
    ELSE 0
  END AS trial_seconds_remaining
FROM sellers s;

-- =========================================================
-- 18. SEED DATA (idempotent)
-- =========================================================

INSERT INTO plans (code, name, monthly_price, yearly_price, store_limit, product_limit, confirm_limit, features) VALUES
  ('basic',      'Basic Plan',      0,     NULL,  1,    10,     100,    '{"support": "community"}'::jsonb),
  ('starter',    'Starter Plan',    9.99,  99,    3,    50,     500,    '{"support": "email", "analytics": true}'::jsonb),
  ('pro',        'Pro Plan',        29.99, 299,   10,   200,    2000,   '{"support": "priority", "analytics": true, "custom_models": true}'::jsonb),
  ('enterprise', 'Enterprise Plan', 99.99, 999,   50,   10000,  100000, '{"support": "dedicated", "analytics": true, "custom_models": true, "sla": true}'::jsonb)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  monthly_price = EXCLUDED.monthly_price,
  yearly_price = EXCLUDED.yearly_price,
  store_limit = EXCLUDED.store_limit,
  product_limit = EXCLUDED.product_limit,
  confirm_limit = EXCLUDED.confirm_limit,
  features = EXCLUDED.features,
  updated_at = NOW();

INSERT INTO sellers (user_email, password_hash, company_name, plan_code)
VALUES ('test@example.com', 'scrypt$dummy$hash', 'Test Company', 'basic')
ON CONFLICT (user_email) DO NOTHING;

INSERT INTO app_kv (key, value) VALUES
  ('app_version',       '{"version": "2.2.0", "updated_at": "2025-10-05"}'::jsonb),
  ('maintenance_mode',  '{"enabled": false, "message": ""}'::jsonb),
  ('feature_flags',     '{"ai_chat": true, "embeddings": true, "analytics": true, "sheets_only": true}'::jsonb)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = NOW();

-- =========================================================
-- 19. POST-DEPLOYMENT VERIFICATION (critical + non-blocking)
-- =========================================================
-- 000xx_backfill_store_sheets.sql
BEGIN;

-- Make sure UUID generator exists (gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET LOCAL search_path = app, public;

-- 1) Create one enabled row per store that has a gsheet_url but no store_sheets
WITH to_fix AS (
  SELECT s.id AS store_id, s.seller_id, s.gsheet_url
  FROM app.stores s
  WHERE s.gsheet_url IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM app.store_sheets ss
      WHERE ss.store_id = s.id
    )
)
INSERT INTO app.store_sheets (
  id, store_id, seller_id, gsheet_url, sheet_tab, enabled,
  last_processed_row, created_at, updated_at
)
SELECT
  gen_random_uuid(), tf.store_id, tf.seller_id, tf.gsheet_url,
  'Sheet1', TRUE, 0, NOW(), NOW()
FROM to_fix tf;

-- 2) Collapse to exactly one enabled sheet per store (keep the newest)
WITH ranked AS (
  SELECT id, store_id,
         ROW_NUMBER() OVER (
           PARTITION BY store_id
           ORDER BY updated_at DESC, created_at DESC, id DESC
         ) AS rn
  FROM app.store_sheets
  WHERE enabled IS TRUE
)
UPDATE app.store_sheets ss
SET enabled = FALSE, updated_at = NOW()
FROM ranked r
WHERE ss.id = r.id AND r.rn > 1;

-- 3) Refresh store-level convenience flags
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT store_id FROM app.store_sheets LOOP
    PERFORM app.refresh_store_integrations(r.store_id);
  END LOOP;
END$$;

COMMIT;



DO $$
BEGIN
  -- Call is_seller_locked() explicitly in app schema
  PERFORM app.is_seller_locked('00000000-0000-0000-0000-000000000000'::UUID);
  RAISE NOTICE 'Function is_seller_locked() verified';
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Critical function is_seller_locked() failed: %', SQLERRM;
END;
$$;

-- Non-fatal checks (return rows to help visibility in dev)
SELECT schemaname, tablename, COUNT(*) AS policy_count
FROM pg_policies 
WHERE schemaname = 'app'
GROUP BY schemaname, tablename
HAVING COUNT(*) = 0;

SELECT schemaname, tablename, COUNT(*) AS index_count
FROM pg_indexes
WHERE schemaname = 'app'
  AND indexname LIKE 'idx_%'
GROUP BY schemaname, tablename
ORDER BY index_count DESC;

-- Helpful notice if any ACTIVE store violates "single enabled sheet + url"
DO $$
DECLARE
  bad_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO bad_count
  FROM app.stores s
  LEFT JOIN LATERAL (
    SELECT COUNT(*) FILTER (WHERE enabled) AS enabled_cnt
    FROM app.store_sheets ss
    WHERE ss.store_id = s.id
  ) x ON TRUE
  WHERE s.status='active'
    AND (x.enabled_cnt IS DISTINCT FROM 1 OR s.gsheet_url IS NULL);

  IF bad_count > 0 THEN
    RAISE WARNING 'Some ACTIVE stores are missing a single enabled Sheet or gsheet_url (violations=%)', bad_count;
  ELSE
    RAISE NOTICE 'Google Sheet Only checks passed';
  END IF;
END;
$$;
