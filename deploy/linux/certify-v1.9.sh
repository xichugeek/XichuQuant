#!/usr/bin/env bash
set -euo pipefail
# Compatibility entry point uses the current isolated acceptance procedure.
echo 'V1.9 entry delegates to Phase C; no active business database is selected.'
exec bash "$(dirname "$0")/certify-phase-c.sh" "$@"
