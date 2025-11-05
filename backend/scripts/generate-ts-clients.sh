#!/bin/bash
set -e

# Script to generate TypeScript client code from proto files
# This generates grpc-web compatible TypeScript clients

PROTO_DIR="./proto"
OUT_DIR="../ittri-frontend/src/generated"

# Create output directory if it doesn't exist
mkdir -p "$OUT_DIR"

echo "Generating TypeScript clients from proto files..."

# Find all .proto files and generate TS code
npx protoc \
  --plugin=./node_modules/.bin/protoc-gen-ts_proto \
  --ts_proto_out="$OUT_DIR" \
  --ts_proto_opt=outputServices=grpc-web \
  --ts_proto_opt=esModuleInterop=true \
  --ts_proto_opt=env=browser \
  --proto_path="$PROTO_DIR" \
  --proto_path="$PROTO_DIR/google" \
  "$PROTO_DIR"/**/*.proto

echo "✅ TypeScript clients generated in $OUT_DIR"
