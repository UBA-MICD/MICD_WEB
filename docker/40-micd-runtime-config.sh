#!/bin/sh
# Writes /usr/share/nginx/html/runtime-config.js from the container environment.
# Run by the nginx image's entrypoint (/docker-entrypoint.d/) before nginx
# starts, so one image can be pointed at a different anonymizer per deployment
# without a rebuild.
#
#   MICD_ANONYMIZER_URL  where the viewer sends DICOM to be anonymized
#                        (e.g. /anonymizer on staging). Unset/empty: keep the
#                        built-in default, http://127.0.0.1:8000.
set -eu

OUT=/usr/share/nginx/html/runtime-config.js
url="${MICD_ANONYMIZER_URL:-}"

if [ -z "$url" ]; then
  echo "$0: MICD_ANONYMIZER_URL not set, keeping the default anonymizer URL"
  exit 0
fi

# The value is written into a JS string literal: only allow plain URL
# characters so it can never break out of the quotes.
case "$url" in
  *[!A-Za-z0-9:/._~%-]*)
    echo "$0: MICD_ANONYMIZER_URL has characters outside a plain URL: $url" >&2
    exit 1
    ;;
esac

printf '// Generated at container start by 40-micd-runtime-config.sh. Do not edit.\nwindow.MICD_ANONYMIZER_URL = "%s";\n' "$url" > "$OUT"
echo "$0: MICD_ANONYMIZER_URL=$url"
