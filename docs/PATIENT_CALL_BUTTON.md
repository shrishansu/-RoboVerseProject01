# Patient call button

Educational prototype workflow; it is not a guaranteed emergency service.

## Wiring

- Use a momentary normally-open push button.
- Connect one button terminal to ESP32 GPIO 32 and the other terminal to GND.
- Firmware configures GPIO 32 as `INPUT_PULLUP`: released is HIGH, pressed is LOW.
- Do not connect the button to 3.3 V or 5 V. The buzzer on GPIO 27 remains disabled by default.
- Do not attach ECG electrodes to a person while the ESP32 is connected to a laptop, USB charger, or other non-isolated mains-powered equipment.

## Flow

Patient presses and holds button >=300 ms
  -> ESP32 debounces input and sends HTTPS POST to device-alert
  -> Edge Function verifies x-device-id / x-device-secret against active, non-revoked device credential
  -> current assigned patient is resolved from devices.assigned_patient_id
  -> server suppresses duplicate patient-call alert for 30 seconds
  -> alert and in-app notifications are recorded
  -> active assigned doctors/nurses with registered Telegram chat IDs receive Telegram messages

The existing `device-ingest`, ECG sampling, and private ECG Realtime channel are unchanged. ECG is not used to send the alert.

## Create the Telegram bot and register staff chats

1. In Telegram, start a conversation with BotFather and create a bot. Keep the bot token private.
2. Set the token as a Supabase Edge Function secret named `TELEGRAM_BOT_TOKEN`; do not add it to the frontend environment, firmware secrets, or Git.
3. Each doctor or nurse opens the new bot, presses Start, and sends any message.
4. In PowerShell, set the token for the helper process and run it. The script reads only the current process environment and does not load `.env` files:

   `$env:TELEGRAM_BOT_TOKEN = '<TOKEN_FROM_BOTFATHER>'`

   `node .\scripts\get-telegram-chat-id.mjs`

5. Staff enter their own chat ID in the Telegram alerts card on their doctor/nurse dashboard. The RPC exposes only the signed-in staff member's own ID.
6. Remove the token from the PowerShell session when done: `Remove-Item Env:TELEGRAM_BOT_TOKEN`.

## Deploy from Windows PowerShell

If PowerShell blocks script shims, run once in that terminal session:

`Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

Then run:

```powershell
cd C:\Users\hp\Desktop\RoboVerse_New\app
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push --dry-run
npx supabase db push
npx supabase secrets set TELEGRAM_BOT_TOKEN=<TOKEN_FROM_BOTFATHER>
npx supabase functions deploy device-alert
```

`db push` applies every pending local migration, not only the patient-call migration. The pending list must be copied from the `db push --dry-run` output before running `db push`. It may include `20260930000300_harden_patient_access_policies.sql`, which the security audit says is local and not deployed. Review that migration and every other pending migration first. The linked dry run in this workspace failed with `DbConfigLoginRoleNetworkError` / `TransportError`, so the exact remote pending migration list is not established here. Do not run `db push` until your own linked dry run succeeds and you have reviewed every listed migration.

## Test plan

From the `app` directory, use placeholders only in local commands. Do not put a real device secret in a committed script or chat:

```powershell
$url = 'https://<PROJECT_REF>.supabase.co/functions/v1/device-alert'
$deviceId = '<DEVICE_ID>'
$deviceSecret = '<DEVICE_SECRET>'

# Valid request: expect HTTP 200 with status sent, unless a patient-call duplicate is in cooldown.
curl.exe -i -X POST $url -H "Content-Type: application/json" -H "x-device-id: $deviceId" -H "x-device-secret: $deviceSecret" --data '{"event":"patient_call"}'

# Wrong secret: expect HTTP 401.
curl.exe -i -X POST $url -H "Content-Type: application/json" -H "x-device-id: $deviceId" -H "x-device-secret: <WRONG_SECRET>" --data '{"event":"patient_call"}'

# Repeat within 30 seconds: expect HTTP 200 and {"status":"duplicate"}.
curl.exe -i -X POST $url -H "Content-Type: application/json" -H "x-device-id: $deviceId" -H "x-device-secret: $deviceSecret" --data '{"event":"patient_call"}'

# GET: expect HTTP 405.
curl.exe -i $url
```

Also test from the device: press and hold the button, verify an `alerts` row with `patient_call`, verify only the currently assigned active doctors/nurses receive Telegram, then test again within 30 seconds. Test with one unassigned staff account and confirm it receives no Telegram message. A duplicate response is not a second notification.

## Limitations

- Telegram delivery is not guaranteed. The in-app alert is retained as a backup.
- The feature has no acknowledgement or escalation workflow yet.
- GPIO button sends a device-authenticated request; it does not prove who pressed the button.
- The 30-second cooldown is patient-wide and Telegram errors are counted but not queued for retry after the request ends.
- ECG monitoring is an educational prototype, not a certified medical or emergency-care system.
