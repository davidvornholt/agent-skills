#!/usr/bin/env bash
# Prints the HTTP status of each public endpoint, then the immich version.
# Exits 1 if any endpoint answers anything but 200 (000 means no connection) or the version request fails, after printing the whole report.
failed=0
for url in \
  https://david.vornholt.online/ \
  https://postlude.vornholt.online/api/healthz \
  https://punktlandung.vornholt.online/api/healthz \
  https://rota.vornholt.online/api/healthz \
  https://papersync.vornholt.online/api/health \
  https://wordhold.vornholt.online/api/health \
  https://fact-trainer.vornholt.online/ \
  https://app.prosabridge.com/health \
  https://addin.prosabridge.com/health \
  https://fes-kirchheim.de/ \
  https://cg-bibi.de/api/healthz \
  https://immich.vornholt.online/api/server/ping; do
  # curl prints 000 itself when it cannot connect, so its exit status adds nothing here.
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url") || true
  printf '%s %s\n' "${code:-000}" "$url"
  [ "$code" = 200 ] || failed=1
done
# -f makes an HTTP error status fail the request instead of printing the error page as a version.
version=$(curl -sf --max-time 20 https://immich.vornholt.online/api/server/version) || failed=1
printf 'immich version: %s\n' "$version"
exit "$failed"
