#!/usr/bin/env bash
set -euo pipefail

MODELS_DIR="$(dirname "$0")/../models"
mkdir -p "$MODELS_DIR"

echo "Fetching model artifacts (placeholders)..."
# Example:
# curl -L -o "$MODELS_DIR/superpoint.onnx" "https://example.com/superpoint.onnx"
# curl -L -o "$MODELS_DIR/lightglue.onnx"  "https://example.com/lightglue.onnx"
echo "Done. (Configure real URLs in scripts/fetch-models.sh)"
