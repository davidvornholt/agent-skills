#!/usr/bin/env bash
# Like isolated.sh, but podman calls go to the host podman service, so repository scripts that manage containers see the real container state.
set -euo pipefail
SCRIPTS=$(cd "$(dirname "$0")" && pwd)
export PATH="$SCRIPTS/podman-remote-shim:$PATH"
exec "$SCRIPTS/isolated.sh" "$@"
