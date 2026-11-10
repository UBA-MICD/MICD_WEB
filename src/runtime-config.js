// runtime-config.js — per-deployment settings, loaded before main.js.
//
// This committed copy sets nothing, so every build keeps its defaults (the
// anonymizer at http://127.0.0.1:8000, US-16). The staging image overwrites it
// at container start from its environment (docker/40-micd-runtime-config.sh),
// e.g. window.MICD_ANONYMIZER_URL = "/anonymizer".
