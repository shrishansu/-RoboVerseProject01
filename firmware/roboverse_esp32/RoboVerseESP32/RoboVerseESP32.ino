/*
 * RoboVerse educational prototype firmware for ESP32 DevKit V1.
 * Connected: MAX30102, MPU6050, VL53L0X, AD8232, optional buzzer.
 * This is not a medical device. It does not calculate SpO2 or raise clinical alarms.
 * Put per-device credentials in a local secrets.h copied from secrets.example.h.
 */
#include "secrets.h"
#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>
#include <math.h>
#include "MAX30105.h"              // SparkFun MAX3010x Sensor Library
#include <Adafruit_MPU6050.h>      // Adafruit MPU6050 + Adafruit Unified Sensor
#include <Adafruit_Sensor.h>
#include <Adafruit_VL53L0X.h>      // Adafruit VL53L0X

#if ROBO_VERSE_DEVICE_ID <= 0
#error "ROBO_VERSE_DEVICE_ID must be the numeric public.devices ID"
#endif

// Only enable this for a confirmed active-high buzzer module. This is a quiet
// startup/status chirp only; there are no patient thresholds or medical alarms.
#define BUZZER_ENABLED 0
#define BUZZER_ACTIVE_HIGH 1

static constexpr int PIN_SDA = 21, PIN_SCL = 22;
static constexpr int PIN_ECG = 34, PIN_ECG_LO_PLUS = 25, PIN_ECG_LO_MINUS = 26;
static constexpr int PIN_BUZZER = 27;
// Upload a one-second sensor window so the live dashboard receives fresh
// persisted values each second. ECG is still one window average, not a waveform.
static constexpr uint32_t UPLOAD_MS = 1000, WIFI_RETRY_MS = 10000;
static constexpr uint32_t HTTP_TIMEOUT_MS = 10000;
static const String INGEST_URL = String(SUPABASE_PROJECT_URL) + "/functions/v1/device-ingest";

MAX30105 max30102;
Adafruit_MPU6050 mpu6050;
Adafruit_VL53L0X vl53l0x;
bool maxReady=false, mpuReady=false, vl53Ready=false;
uint32_t lastWifiTry=0, lastSensorRetry=0, lastUpload=0, lastEcgSample=0;
uint64_t redSum=0, irSum=0;
uint32_t opticalSamples=0;
uint32_t redLatest=0, irLatest=0;
double ecgSum=0; uint32_t ecgCount=0; int ecgLatest=0;
float accelX=NAN, accelY=NAN, accelZ=NAN;
int distanceMm=-1;
bool leadOffPlus=false, leadOffMinus=false;
bool ecgSaturatedWindow=false;

// Small, non-clinical peak interval estimator. A reading is omitted until at
// least two plausible, recent beat intervals have been detected.
float irBaseline=0, irFiltered=0, previousFiltered=0, peakValue=0;
bool peakRising=false;
uint32_t lastPeakAt=0;
uint16_t beatIntervals[4]={0}; uint8_t beatCount=0, beatIndex=0;
float pulseEstimate= NAN;

bool sensorHasCert() {
  return strlen(SUPABASE_ROOT_CA) > 100 && strstr(SUPABASE_ROOT_CA, "BEGIN CERTIFICATE") != nullptr;
}
bool tlsClockReady() { return time(nullptr) > 1700000000; }
void buzzerSet(bool on) {
#if BUZZER_ENABLED
  digitalWrite(PIN_BUZZER, (on == (BUZZER_ACTIVE_HIGH != 0)) ? HIGH : LOW);
#else
  (void)on;
#endif
}
void statusChirp() {
#if BUZZER_ENABLED
  buzzerSet(true); delay(35); buzzerSet(false);
#endif
}

void detectPulse(uint32_t ir) {
  if (irBaseline == 0) irBaseline = static_cast<float>(ir);
  irBaseline = 0.98f * irBaseline + 0.02f * static_cast<float>(ir);
  const float centered = static_cast<float>(ir) - irBaseline;
  irFiltered = 0.65f * irFiltered + 0.35f * centered;
  const uint32_t now = millis();
  if (irFiltered > previousFiltered) {
    peakRising = true;
    if (irFiltered > peakValue) peakValue = irFiltered;
  } else if (peakRising) {
    peakRising = false;
    const float amplitude = peakValue;
    const uint32_t interval = now - lastPeakAt;
    if (amplitude > 250.0f && lastPeakAt != 0 && interval >= 300 && interval <= 2000) {
      beatIntervals[beatIndex++ % 4] = static_cast<uint16_t>(interval);
      if (beatCount < 4) beatCount++;
      uint32_t sum=0; for (uint8_t i=0;i<beatCount;i++) sum += beatIntervals[i];
      pulseEstimate = 60000.0f * beatCount / sum;
      lastPeakAt = now;
    } else if (amplitude > 250.0f && lastPeakAt == 0) {
      lastPeakAt = now;
    }
    peakValue = 0;
  }
  previousFiltered = irFiltered;
}
bool pulseEstimateValid() {
  return beatCount >= 2 && !isnan(pulseEstimate) && millis()-lastPeakAt < 10000 && pulseEstimate >= 30 && pulseEstimate <= 200;
}

void initSensors() {
  maxReady = max30102.begin(Wire, I2C_SPEED_FAST);
  if (maxReady) {
    max30102.setup(0x1F, 4, 2, 100, 411, 4096);
    max30102.setPulseAmplitudeRed(0x1F); max30102.setPulseAmplitudeIR(0x1F); max30102.setPulseAmplitudeGreen(0);
    Serial.println("[SENSOR] MAX30102 ready; RED/IR sampling enabled (SpO2 not measured).");
  } else Serial.println("[SENSOR] MAX30102 unavailable.");
  mpuReady = mpu6050.begin();
  if (mpuReady) {
    mpu6050.setAccelerometerRange(MPU6050_RANGE_4_G);
    mpu6050.setGyroRange(MPU6050_RANGE_500_DEG);
    mpu6050.setFilterBandwidth(MPU6050_BAND_21_HZ);
  }
  Serial.printf("[SENSOR] MPU6050 %s.\n", mpuReady ? "ready" : "unavailable");
  vl53Ready = vl53l0x.begin();
  Serial.printf("[SENSOR] VL53L0X %s.\n", vl53Ready ? "ready" : "unavailable");
}

void scanI2cBus() {
  bool found[128] = {};
  Serial.println("[I2C] Scanning addresses 0x08-0x77...");
  for (uint8_t address = 0x08; address <= 0x77; address++) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      found[address] = true;
      Serial.printf("[I2C] Found device at 0x%02X.\n", address);
    }
  }
  Serial.printf("[I2C] MAX30102 0x57: %s; MPU6050 0x68/0x69: %s; VL53L0X 0x29: %s.\n",
    found[0x57] ? "found" : "not found",
    (found[0x68] || found[0x69]) ? "found" : "not found",
    found[0x29] ? "found" : "not found");
}

// Run one focused check per connected sensor before Wi-Fi uploads begin. These
// checks report communication and sample availability only; they do not
// validate medical measurements or prove that electrodes are safely attached.
void runSensorDiagnostics() {
  Serial.println("[CHECK] Starting sequential sensor checks; regular uploads start after this.");

  Serial.println("[CHECK 1/5] MAX30102 heart and optical sensor: checking RED/IR FIFO for 2 seconds...");
  uint32_t opticalTestCount = 0;
  uint32_t testRed = 0, testIr = 0;
  if (maxReady) {
    const uint32_t started = millis();
    while (millis() - started < 2000) {
      max30102.check();
      while (max30102.available()) {
        testRed = max30102.getFIFORed();
        testIr = max30102.getFIFOIR();
        opticalTestCount++;
        max30102.nextSample();
      }
      delay(1);
    }
  }
  if (!maxReady) {
    Serial.println("[CHECK RESULT] MAX30102 FAIL: sensor did not initialize on I2C.");
  } else if (opticalTestCount == 0) {
    Serial.println("[CHECK RESULT] MAX30102 FAIL: detected, but no RED/IR FIFO samples arrived.");
  } else {
    Serial.printf("[CHECK RESULT] MAX30102 PASS: %lu samples; last RED=%lu IR=%lu. This is raw optical data, not SpO2.\n",
      (unsigned long)opticalTestCount, (unsigned long)testRed, (unsigned long)testIr);
  }

  Serial.println("[CHECK 2/5] MPU6050 movement sensor: reading acceleration...");
  if (mpuReady) {
    sensors_event_t testAccel, testGyro, testTemp;
    mpu6050.getEvent(&testAccel, &testGyro, &testTemp);
    Serial.printf("[CHECK RESULT] MPU6050 PASS: acceleration %.2f, %.2f, %.2f m/s^2.\n",
      testAccel.acceleration.x, testAccel.acceleration.y, testAccel.acceleration.z);
  } else {
    Serial.println("[CHECK RESULT] MPU6050 FAIL: sensor did not initialize on I2C.");
  }

  Serial.println("[CHECK 3/5] VL53L0X distance sensor: taking one range measurement...");
  if (vl53Ready) {
    VL53L0X_RangingMeasurementData_t testRange;
    vl53l0x.rangingTest(&testRange, false);
    if (testRange.RangeStatus != 4 && testRange.RangeMilliMeter > 0) {
      Serial.printf("[CHECK RESULT] VL53L0X PASS: %u mm.\n", (unsigned int)testRange.RangeMilliMeter);
    } else {
      Serial.printf("[CHECK RESULT] VL53L0X detected, but no valid range (status %u).\n", (unsigned int)testRange.RangeStatus);
    }
  } else {
    Serial.println("[CHECK RESULT] VL53L0X FAIL: sensor did not initialize on I2C.");
  }

  Serial.println("[CHECK 4/5] AD8232 ECG front-end: sampling analog input and lead-off pins...");
  leadOffPlus = digitalRead(PIN_ECG_LO_PLUS) == HIGH;
  leadOffMinus = digitalRead(PIN_ECG_LO_MINUS) == HIGH;
  ecgLatest = analogRead(PIN_ECG);
  Serial.printf("[CHECK RESULT] AD8232 pins: ADC=%d, LO+=%s, LO-=%s. Lead-off is expected when leads are disconnected; this does not validate an ECG.\n",
    ecgLatest, leadOffPlus ? "OFF" : "ON", leadOffMinus ? "OFF" : "ON");

  Serial.println("[CHECK 5/5] Buzzer: output is disabled in this firmware; no sound test was sent.");
  Serial.println("[CHECK] Sequential checks complete. Starting normal sensor collection and uploads.");
}

void retryMissingSensors() {
  if (millis()-lastSensorRetry < 10000) return;
  lastSensorRetry=millis();
  if (!maxReady) {
    maxReady=max30102.begin(Wire,I2C_SPEED_FAST);
    if (maxReady) { max30102.setup(0x1F,4,2,100,411,4096); max30102.setPulseAmplitudeRed(0x1F); max30102.setPulseAmplitudeIR(0x1F); max30102.setPulseAmplitudeGreen(0); }
  }
  if (!mpuReady) {
    mpuReady=mpu6050.begin();
    if (mpuReady) {
      mpu6050.setAccelerometerRange(MPU6050_RANGE_4_G);
      mpu6050.setGyroRange(MPU6050_RANGE_500_DEG);
      mpu6050.setFilterBandwidth(MPU6050_BAND_21_HZ);
    }
  }
  if (!vl53Ready) vl53Ready=vl53l0x.begin();
}

void maintainWifi() {
  if (WiFi.status()==WL_CONNECTED) return;
  if (millis()-lastWifiTry < WIFI_RETRY_MS) return;
  lastWifiTry=millis(); WiFi.reconnect();
  Serial.println("[Wi-Fi] Reconnecting.");
}
void collectOptical() {
  if (!maxReady) return;
  max30102.check();
  while (max30102.available()) {
    redLatest=max30102.getFIFORed(); irLatest=max30102.getFIFOIR();
    redSum+=redLatest; irSum+=irLatest; opticalSamples++;
    detectPulse(irLatest); max30102.nextSample();
  }
}
void collectEcg() {
  if (millis()-lastEcgSample < 10) return; // approximately 100 Hz
  lastEcgSample=millis();
  leadOffPlus=digitalRead(PIN_ECG_LO_PLUS)==HIGH;
  leadOffMinus=digitalRead(PIN_ECG_LO_MINUS)==HIGH;
  ecgLatest=analogRead(PIN_ECG);
  // ESP32 ADC saturation usually means a wiring, power, or signal problem.
  // Never persist a railed value as if it were a usable ECG sample.
  if (ecgLatest <= 8 || ecgLatest >= 4087) ecgSaturatedWindow=true;
  if (!leadOffPlus && !leadOffMinus && !ecgSaturatedWindow) { ecgSum+=ecgLatest; ecgCount++; }
}
void collectPeriodicSensors() {
  accelX=accelY=accelZ=NAN; distanceMm=-1;
  if (mpuReady) {
    sensors_event_t a,g,temp; mpu6050.getEvent(&a,&g,&temp);
    accelX=a.acceleration.x/9.80665f; accelY=a.acceleration.y/9.80665f; accelZ=a.acceleration.z/9.80665f;
  }
  if (vl53Ready) {
    VL53L0X_RangingMeasurementData_t measure; vl53l0x.rangingTest(&measure, false);
    distanceMm=(measure.RangeStatus != 4 && measure.RangeMilliMeter > 0) ? measure.RangeMilliMeter : -1;
  }
}
String jsonNumber(float value, unsigned int digits=2) {
  if (!isfinite(value)) return "null";
  return String(value, digits);
}
String buildPayload() {
  String body; body.reserve(800);
  body="{\"device_id\":"+String(ROBO_VERSE_DEVICE_ID);
  // The server records the accepted timestamp; firmware does not send an
  // unsynchronized local clock value.
  const bool pulseOk=pulseEstimateValid();
  const String heartStatus=!maxReady ? "unavailable" : (!opticalSamples ? "no_samples" : (pulseOk ? "pulse_estimate_available" : "raw_samples_only"));
  const String movementStatus=!mpuReady ? "unavailable" : (isfinite(accelX) ? "ok" : "no_measurement");
  const String distanceStatus=!vl53Ready ? "unavailable" : (distanceMm>=0 ? "ok" : "no_range");
  const String ecgStatus=ecgSaturatedWindow ? "signal_saturated" : ((leadOffPlus||leadOffMinus) ? "lead_off" : (ecgCount ? "ok" : "no_samples"));
  body+=",\"pulse_rate_estimate_bpm\":"+(pulseOk ? String(pulseEstimate,1) : "null");
  body+=",\"red_raw\":"+(opticalSamples ? String((uint32_t)(redSum/opticalSamples)) : "null");
  body+=",\"ir_raw\":"+(opticalSamples ? String((uint32_t)(irSum/opticalSamples)) : "null");
  body+=",\"signal_valid\":"+String(pulseOk ? "true" : "false");
  body+=",\"motion_x\":"+jsonNumber(accelX)+",\"motion_y\":"+jsonNumber(accelY)+",\"motion_z\":"+jsonNumber(accelZ);
  body+=",\"ecg_value\":"+((leadOffPlus||leadOffMinus||ecgSaturatedWindow||!ecgCount) ? String("null") : String((int)(ecgSum/ecgCount)));
  body+=",\"ecg_lead_off_positive\":"+String(leadOffPlus?"true":"false");
  body+=",\"ecg_lead_off_negative\":"+String(leadOffMinus?"true":"false");
  body+=",\"distance_mm\":"+(distanceMm>=0 ? String(distanceMm) : "null");
  body+=",\"sensor_status\":{\"heart_reader\":\""+heartStatus+"\",\"movement_sensor\":\""+movementStatus+"\",\"distance_sensor\":\""+distanceStatus+"\",\"ecg_sensor\":\""+ecgStatus+"\"}";
  body+=",\"sensor_errors\":{";
  bool first=true;
  if (!maxReady || !opticalSamples) { body+="\"heart_reader\":\""+String(maxReady?"No optical samples in this upload window":"MAX30102 not detected")+"\""; first=false; }
  if (!mpuReady || !isfinite(accelX)) { if(!first) body+=","; body+="\"movement_sensor\":\""+String(mpuReady?"No acceleration sample":"MPU6050 not detected")+"\""; first=false; }
  if (!vl53Ready || distanceMm<0) { if(!first) body+=","; body+="\"distance_sensor\":\""+String(vl53Ready?"No valid distance in this sample":"VL53L0X not detected")+"\""; first=false; }
  if (leadOffPlus||leadOffMinus||ecgSaturatedWindow) {
    if(!first) body+=",";
    if (ecgSaturatedWindow && (leadOffPlus||leadOffMinus)) {
      body+="\"ecg_sensor\":\"AD8232 lead off and ADC saturated; check leads, 3.3V power, ground, OUT to GPIO34\"";
    } else if (ecgSaturatedWindow) {
      body+="\"ecg_sensor\":\"AD8232 ADC saturated; check 3.3V power, ground, OUT to GPIO34\"";
    } else {
      body+="\"ecg_sensor\":\"AD8232 lead off\"";
    }
  }
  body+="}}";
  return body;
}
void uploadReading() {
  if (WiFi.status()!=WL_CONNECTED) { Serial.println("[UPLOAD] Waiting for Wi-Fi."); return; }
  if (!sensorHasCert()) { Serial.println("[TLS] secrets.h needs the HTTPS root CA PEM; no upload attempted."); return; }
  if (!tlsClockReady()) { Serial.println("[TLS] Waiting for network time."); return; }
  String body=buildPayload();
  WiFiClientSecure tls; tls.setCACert(SUPABASE_ROOT_CA);
  HTTPClient http; http.setConnectTimeout(HTTP_TIMEOUT_MS); http.setTimeout(HTTP_TIMEOUT_MS); http.setReuse(false);
  if (!http.begin(tls,INGEST_URL)) { Serial.println("[UPLOAD] HTTPS initialization failed."); return; }
  http.addHeader("Content-Type","application/json");
  http.addHeader("apikey",SUPABASE_ANON_KEY);
  http.addHeader("x-device-id",String(ROBO_VERSE_DEVICE_ID));
  http.addHeader("x-device-secret",ROBO_VERSE_DEVICE_SECRET);
  int status=http.POST(body);
  Serial.printf("[UPLOAD] Device ID %d, HTTP %d, RED/IR samples %lu, pulse estimate %s.\n", ROBO_VERSE_DEVICE_ID,status,(unsigned long)opticalSamples,pulseEstimateValid()?"available":"unavailable");
  if (status<200 || status>=300) { String response=http.getString(); if(response.length()) Serial.printf("[UPLOAD] Server response: %s\n",response.c_str()); }
  http.end();
  redSum=irSum=0; opticalSamples=0; ecgSum=0; ecgCount=0;
  ecgSaturatedWindow=false;
}

void setup() {
  Serial.begin(115200); delay(100);
  analogReadResolution(12); pinMode(PIN_ECG_LO_PLUS,INPUT); pinMode(PIN_ECG_LO_MINUS,INPUT);
#if BUZZER_ENABLED
  pinMode(PIN_BUZZER,OUTPUT); buzzerSet(false);
#else
  pinMode(PIN_BUZZER,INPUT); // High-impedance while the optional module is disabled.
#endif
  Wire.begin(PIN_SDA,PIN_SCL); scanI2cBus(); initSensors(); runSensorDiagnostics();
  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true); WiFi.begin(WIFI_SSID,WIFI_PASSWORD); lastWifiTry=millis();
  configTime(0,0,"pool.ntp.org","time.google.com"); lastUpload=millis(); statusChirp();
  Serial.printf("[DEVICE] Numeric database ID %d. Pulse estimate is educational; no SpO2 is sent.\n",ROBO_VERSE_DEVICE_ID);
}
void loop() {
  maintainWifi(); retryMissingSensors(); collectOptical(); collectEcg();
  if (millis()-lastUpload>=UPLOAD_MS) { lastUpload=millis(); collectPeriodicSensors(); uploadReading(); }
  delay(1);
}
