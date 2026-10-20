# RoboVerse ESP32 sensor prototype

This sketch targets an ESP32 DevKit V1 and uploads readings to the existing
`device-ingest` Edge Function. It is an educational prototype, not a medical
device. Do not use it for diagnosis or treatment.

## Wiring

| Board/module | ESP32 DevKit V1 |
| --- | --- |
| Shared I2C SDA (MAX30102, MPU6050, VL53L0X) | GPIO 21 |
| Shared I2C SCL (MAX30102, MPU6050, VL53L0X) | GPIO 22 |
| AD8232 OUTPUT | GPIO 34 |
| AD8232 LO+ | GPIO 25 |
| AD8232 LO- | GPIO 26 |
| Optional active-high buzzer signal | GPIO 27 |
| All module grounds | ESP32 GND |

Use module supply voltages compatible with the ESP32's 3.3 V I/O. Check each
breakout board's specifications before connecting power. The buzzer is disabled
by default in the sketch. Enable it only if the module is confirmed active-high;
it only makes a short startup/status chirp and never signals a medical threshold.

Do not attach ECG electrodes to a person while the ESP32 is connected to a
laptop, USB charger, or other non-isolated mains-powered equipment. Test ECG
inputs with no person attached or with a properly isolated setup.

## Arduino IDE setup

1. Install Arduino IDE and add the Espressif ESP32 board support package.
2. Select an ESP32 Dev Module board and the serial port for your DevKit V1.
3. In Library Manager, install **SparkFun MAX3010x Pulse and Proximity Sensor Library**, **Adafruit MPU6050**, and **Adafruit VL53L0X**. Install dependencies offered by the IDE, including **Adafruit Unified Sensor** and **Adafruit BusIO**.
4. Open `RoboVerseESP32.ino` from this folder.
5. Copy `secrets.example.h` in this folder to a new file named `secrets.h` in the same folder. Edit only that local file with the Wi-Fi network, a newly provisioned device secret, the numeric database device ID, and the verified HTTPS root CA PEM. `secrets.h` is ignored by Git.
6. For device 17, keep the numeric ID as `17`; do not use the `RV-...` device code. Provision a fresh secret in the existing RoboVerse administrator Devices page and paste it only into the local `secrets.h`. The secret is shown once. Revoke the previously exposed credential before provisioning its replacement.
7. Use the trusted CA for the Supabase HTTPS hostname in `SUPABASE_ROOT_CA`. Do not paste the function URL or the PostgreSQL `prod-ca-2021.crt` filename. The sketch refuses to upload until a certificate PEM is configured and the ESP32 obtains network time.
8. Verify, then upload. Open Serial Monitor at **115200 baud**. Check startup messages for each module, then the HTTP status. The Edge Function is already deployed separately; firmware changes do not deploy the server function.

## Readings and limitations

- MAX30102 RED/IR values are raw optical samples. The simple pulse interval detector reports a separate experimental pulse-rate estimate only after it sees recent plausible intervals. It is not clinically validated. This sketch does not calculate or upload SpO2.
- MPU6050 acceleration is converted to g for the existing movement fields.
- VL53L0X sends distance in millimetres when a range is available.
- AD8232 sends an unfiltered raw ADC sample (0–4095) and LO+/LO− lead-off flags. It is not a diagnostic ECG.
- Missing hardware yields null measurements and a sensor status/error entry. Missing readings are not replaced with made-up values.

The request uses `apikey`, `x-device-id`, and `x-device-secret` headers. Its JSON `device_id` is the same numeric ID as the header. The secret is never printed by the sketch or saved by the frontend.
