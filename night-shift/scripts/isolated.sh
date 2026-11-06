#!/usr/bin/env bash
# Usage: isolated.sh <comma-separated host ports, or none> <command...>
# Runs a command in a private network namespace with its own loopback, so ports such as 3000 are free, and forwards the listed host loopback TCP ports into it.
set -euo pipefail
ports="$1"; shift
# Resolve pasta through nixpkgs on each run, because a pinned store path gets garbage-collected.
exec "$(nix build --no-link --print-out-paths "nixpkgs#passt")/bin/pasta" --config-net -q -T "$ports" -t none -u none -U none -- "$@"
