#!/usr/bin/env bash
set -euo pipefail

echo "=== FEAGLE Shell & Script Verification ==="
for script in scripts/*.sh; do
  if [ -f "$script" ]; then
    bash -n "$script"
    echo "[PASS] $script syntax valid"
  fi
done
echo "[SUCCESS] All shell scripts verified successfully."
