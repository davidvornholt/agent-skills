#!/usr/bin/env bash
# Prints the HTTP status of each public endpoint. Anything but 200 needs a look.
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
  printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url")" "$url"
done
printf 'immich version: %s\n' "$(curl -s --max-time 20 https://immich.vornholt.online/api/server/version)"
