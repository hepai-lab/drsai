#!/usr/bin/env bash
# Build a complete PyPI wheel that includes the pre-built ui-tui bundle.
#
# Output: cores/python/packages/drsai/dist/drsai-X.Y.Z-py3-none-any.whl
#
# Run from repo root:
#   ./scripts/build-wheel.sh
#
# Prerequisites:
#   - pnpm (or npm) for the JS build
#   - python -m build (pip install build)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> 1/3 Building ui-tui bundle (esbuild)..."
cd apps/ui-tui
if [ ! -d node_modules ]; then
  pnpm install
fi
pnpm build
cd "$REPO_ROOT"

echo ""
echo "==> 2/3 Building Python wheel (hatch)..."
cd cores/python/packages/drsai
rm -rf dist build
python -m build --wheel

echo ""
echo "==> 3/3 Verifying wheel contents..."
WHEEL=$(ls dist/*.whl | head -n1)
echo "Wheel: $WHEEL"
echo ""
echo "Bundle inside wheel:"
python -m zipfile -l "$WHEEL" | grep -E "ui_tui|entry\.mjs" || {
  echo "ERROR: ui_tui/ not found in wheel!"
  exit 1
}

SIZE=$(du -h "$WHEEL" | cut -f1)
echo ""
echo "✓ Wheel built: $WHEEL ($SIZE)"
echo ""
echo "Install locally:"
echo "  pip install $WHEEL"
echo ""
echo "Upload to PyPI:"
echo "  python -m twine upload $WHEEL"
