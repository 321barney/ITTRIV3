-- 2025-10-16 editor files + versions (idempotent, standalone; FIXED)
-- Safe to append to existing schema without edits.
SET lock_timeout = '10s';
SET statement_timeout = '120s';
SET client_min_messages = WARNING;

CREATE SCHEMA IF NOT EXISTS app;
SET search_path = app, public;

-- Ensure UUIDs
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enum for editor file kind
DO $$BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'editor_file_kind') THEN
    CREATE TYPE editor_file_kind AS ENUM ('code','document','asset','prompt');
  END IF;
END$$;

-- Files table
CREATE TABLE IF NOT EXISTS editor_files (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id         UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  store_id          UUID REFERENCES stores(id) ON DELETE SET NULL,
  name              TEXT NOT NULL CHECK (btrim(name) <> ''),
  path              TEXT, -- optional virtual path/slug
  kind              editor_file_kind NOT NULL DEFAULT 'code',
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  latest_version_id UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Versions table
CREATE TABLE IF NOT EXISTS editor_file_versions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id    UUID NOT NULL REFERENCES editor_files(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  content    TEXT NOT NULL,
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (file_id, version)
);

-- Auto-increment version number on insert
CREATE OR REPLACE FUNCTION _next_editor_version() RETURNS TRIGGER AS $$
DECLARE
  v INTEGER;
BEGIN
  SELECT COALESCE(MAX(version), 0) + 1 INTO v
  FROM editor_file_versions WHERE file_id = NEW.file_id;
  NEW.version := v;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'tg_editor_version_auto'
      AND tgrelid = 'editor_file_versions'::regclass
  ) THEN
    CREATE TRIGGER tg_editor_version_auto
      BEFORE INSERT ON editor_file_versions
      FOR EACH ROW EXECUTE FUNCTION _next_editor_version();
  END IF;
END$$;

-- Maintain latest_version_id
CREATE OR REPLACE FUNCTION _set_latest_editor_version() RETURNS TRIGGER AS $$
BEGIN
  UPDATE editor_files
  SET latest_version_id = NEW.id,
      updated_at = NOW()
  WHERE id = NEW.file_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'tg_editor_latest_version'
      AND tgrelid = 'editor_file_versions'::regclass
  ) THEN
    CREATE TRIGGER tg_editor_latest_version
      AFTER INSERT ON editor_file_versions
      FOR EACH ROW EXECUTE FUNCTION _set_latest_editor_version();
  END IF;
END$$;

-- Indexes
-- Use an expression unique index (table-level UNIQUE cannot contain expressions)
CREATE UNIQUE INDEX IF NOT EXISTS idx_editor_files_seller_name_or_path
  ON editor_files (seller_id, COALESCE(path, name));

CREATE INDEX IF NOT EXISTS idx_editor_files_seller  ON editor_files(seller_id);
CREATE INDEX IF NOT EXISTS idx_editor_files_store   ON editor_files(store_id);
CREATE INDEX IF NOT EXISTS idx_editor_versions_file ON editor_file_versions(file_id, version DESC);
