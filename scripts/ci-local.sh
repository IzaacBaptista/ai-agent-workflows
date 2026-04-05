#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> npm run lint"
npm run lint

echo "==> npm run test"
npm run test

echo "==> npm run evals:gate"
npm run evals:gate
