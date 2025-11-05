#!/usr/bin/env bash
set -euo pipefail
OUT="envoy/envoy.pb"
mkdir -p envoy
if command -v protoc >/dev/null 2>&1; then
  echo "Generating descriptor -> $OUT"
  protoc -I proto --include_imports --include_source_info --descriptor_set_out="$OUT" $(find proto -name "*.proto")
  echo "Wrote $OUT"
else
  echo "protoc not found. Install protoc first."
  exit 1
fi
