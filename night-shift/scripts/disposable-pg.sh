#!/usr/bin/env bash
# Usage: disposable-pg.sh <fresh directory> [database...]
# Starts a throwaway Postgres 18 on a unix socket in the directory, creates the named databases, and prints the socket directory.
# Keep the path short, because a unix socket path is limited to 107 bytes.
set -euo pipefail
dir="$1"; shift
mkdir -p "$dir"
# Resolve Postgres through nixpkgs on each run, because a pinned store path gets garbage-collected.
PG="$(nix build --no-link --print-out-paths "nixpkgs#postgresql_18^out")/bin"
"$PG/initdb" -D "$dir/data" -U postgres --auth=trust >/dev/null
"$PG/pg_ctl" -D "$dir/data" -o "-k $dir -c listen_addresses=''" -l "$dir/log" start >/dev/null
for db in "$@"; do "$PG/createdb" -h "$dir" -U postgres "$db"; done
echo "$dir"
