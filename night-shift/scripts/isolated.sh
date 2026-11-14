#!/usr/bin/env bash
# Usage: isolated.sh <comma-separated host ports, or none> <command...>
# Runs a command in a private network namespace with its own loopback, so ports such as 3000 are free, and forwards the listed host loopback TCP ports into it.
# pasta makes the command uid 0 and PID 1 of new namespaces, which breaks tools that read the user's home (Maven), tests that rely on file permissions, and tests that kill process trees. So tini becomes PID 1 and reaps orphans, and a nested user namespace maps the caller's own uid and gid back.
set -euo pipefail
ports="$1"; shift
# Resolve tools through nixpkgs on each run, because a pinned store path gets garbage-collected.
pasta="$(nix build --no-link --print-out-paths "nixpkgs#passt")/bin/pasta"
tini="$(nix build --no-link --print-out-paths "nixpkgs#tini")/bin/tini"
exec "$pasta" --config-net -q -T "$ports" -t none -u none -U none -- "$tini" -- unshare --user --map-user="$(id -u)" --map-group="$(id -g)" "$@"
