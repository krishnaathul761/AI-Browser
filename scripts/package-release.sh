#!/usr/bin/env bash
# scripts/package-release.sh
# Packages the Sahayak Chrome extension into a production-ready ZIP archive
# with manifest.json at the archive root.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_FILE="${1:-sahayak-extension.zip}"
TARGET_PATH="${ROOT_DIR}/${OUTPUT_FILE}"

echo "==> Packaging Sahayak Extension..."
echo "    Source: ${ROOT_DIR}"
echo "    Target: ${TARGET_PATH}"

STAGE_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t 'sahayak-stage')"
trap 'rm -rf "${STAGE_DIR}"' EXIT

INCLUDE_ITEMS=(
  "manifest.json"
  "LICENSE"
  "README.md"
  "assets"
  "background"
  "content"
  "lib"
  "options"
  "pages"
  "sidepanel"
)

for item in "${INCLUDE_ITEMS[@]}"; do
  if [ -e "${ROOT_DIR}/${item}" ]; then
    cp -R "${ROOT_DIR}/${item}" "${STAGE_DIR}/"
    echo "    [+] Included: ${item}"
  else
    echo "    [-] Missing expected: ${item}"
  fi
done

if [ ! -f "${STAGE_DIR}/manifest.json" ]; then
  echo "Error: manifest.json missing from staging root!" >&2
  exit 1
fi

# Clean up unwanted files
find "${STAGE_DIR}" -name "*.git*" -o -name "*.env*" -o -name ".DS_Store" -o -name "*.log" -delete 2>/dev/null || true

# Remove old target
rm -f "${TARGET_PATH}"

# Create ZIP archive from root of stage dir
(cd "${STAGE_DIR}" && zip -r -q "${TARGET_PATH}" .)

# Copy to pages directory for direct 1-click landing page download
cp -f "${TARGET_PATH}" "${ROOT_DIR}/pages/sahayak-extension.zip"

echo "==> Success! Release package created:"
echo "    Archive: ${TARGET_PATH} ($(du -h "${TARGET_PATH}" | cut -f1))"
echo "    Manifest at root: verified."

