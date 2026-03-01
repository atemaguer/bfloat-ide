#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATES_DIR="$ROOT_DIR/resources/templates"

echo "Checking template hygiene in $TEMPLATES_DIR"

if [ ! -d "$TEMPLATES_DIR" ]; then
  echo "Templates directory not found: $TEMPLATES_DIR" >&2
  exit 1
fi

if find "$TEMPLATES_DIR" -type d -name node_modules -print -quit | grep -q .; then
  echo "Template hygiene check failed: node_modules directory found under resources/templates" >&2
  find "$TEMPLATES_DIR" -type d -name node_modules
  exit 1
fi

if find "$TEMPLATES_DIR" -type d -name .bfloat -print -quit | grep -q .; then
  echo "Template hygiene check failed: .bfloat directory found (use .bfloat-ide in this repo)" >&2
  find "$TEMPLATES_DIR" -type d -name .bfloat
  exit 1
fi

echo "Template hygiene check passed."
