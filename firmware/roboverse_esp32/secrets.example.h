#pragma once
// Copy this file to secrets.h and fill values locally. Never commit secrets.h.
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define SUPABASE_PROJECT_URL "https://nysctahjomlnvincsvjg.supabase.co"
#define SUPABASE_ANON_KEY "sb_publishable_oetPofz2jIgryiNQXPYwFg_AbvUb70M"
// Numeric public.devices.id, not device_code. Provision the secret in Devices.
#define ROBO_VERSE_DEVICE_ID 17
#define ROBO_VERSE_DEVICE_SECRET "PASTE_FRESH_DEVICE_SECRET_LOCALLY"
// Put the trusted root CA PEM for the HTTPS hostname here, not the function URL
// or the Postgres prod-ca-2021.crt. Until supplied, TLS intentionally fails.
#define SUPABASE_ROOT_CA R"ROBO_CA(PASTE_VERIFIED_HTTPS_ROOT_CA_PEM_HERE)ROBO_CA"
