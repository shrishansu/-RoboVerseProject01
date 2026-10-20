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
#include <sys/time.h>
#include <math.h>
#include <esp_system.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>
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
// Fast ECG packets stream independently; clinical/vital summary uploads stay slow.
static constexpr uint32_t UPLOAD_MS = 5000, WIFI_RETRY_MS = 10000;
static constexpr uint32_t HTTP_TIMEOUT_MS = 10000;
static constexpr uint32_t STREAM_HTTP_TIMEOUT_MS = 1200;
static constexpr uint32_t ECG_STREAM_MAX_QUEUE_AGE_MS = 500;
static constexpr uint16_t ECG_SAMPLE_RATE_HZ = 250;
static constexpr uint16_t ECG_BATCH_SAMPLES = ECG_SAMPLE_RATE_HZ;
static constexpr uint8_t ECG_PACKET_SAMPLES = 20; // 80 ms at 250 Hz
static constexpr uint32_t ECG_SAMPLE_PERIOD_MS = 1000 / ECG_SAMPLE_RATE_HZ;
// Moderate LED drive improves fingertip optical signal while staying well
// below the MAX30102's configured maximum current.
static constexpr uint8_t MAX30102_LED_CURRENT = 0x5F;
// Keep short network/Edge Function delays from discarding otherwise valid
// raw batches. Timestamps remain the original capture times; they are never
// rewritten to make delayed samples appear live.
static constexpr uint32_t ECG_MAX_QUEUE_AGE_MS = 10000;
static constexpr UBaseType_t ECG_QUEUE_BATCHES = 20;
static constexpr UBaseType_t ECG_STREAM_QUEUE_PACKETS = 20;
static const String INGEST_URL = String(SUPABASE_PROJECT_URL) + "/functions/v1/device-ingest";

MAX30105 max30102;
Adafruit_MPU6050 mpu6050;
Adafruit_VL53L0X vl53l0x;
bool maxReady=false, mpuReady=false, vl53Ready=false;
uint32_t lastWifiTry=0, lastSensorRetry=0, lastUpload=0;
uint64_t redSum=0, irSum=0;
uint32_t opticalSamples=0;
uint32_t redLatest=0, irLatest=0;
volatile int ecgLatest=0;
float accelX=NAN, accelY=NAN, accelZ=NAN;
int distanceMm=-1;
volatile bool leadOffPlus=false, leadOffMinus=false;
struct EcgBatch {
  uint16_t samples[ECG_BATCH_SAMPLES];
  uint16_t sampleCount;
  bool leadOffPositive;
  bool leadOffNegative;
  bool saturated;
  uint16_t minimumSample;
  uint16_t maximumSample;
  uint32_t startedAtMillis;
  uint64_t startedEpochMs;
  char batchId[37];
};
struct EcgPacket {
  uint16_t samples[ECG_PACKET_SAMPLES];
  uint8_t sampleCount;
  bool leadOffPositive;
  bool leadOffNegative;
  uint8_t leadOffPositiveCount;
  uint8_t leadOffNegativeCount;
  uint32_t packetSequence;
  uint32_t startedAtMillis;
  uint64_t startedEpochMs;
};
QueueHandle_t ecgBatchQueue=nullptr;
QueueHandle_t ecgStreamQueue=nullptr;
uint32_t ecgPacketSequence=0;
volatile uint32_t ecgStreamDropped=0;
SemaphoreHandle_t sensorI2cMutex=nullptr;
portMUX_TYPE opticalMux = portMUX_INITIALIZER_UNLOCKED;

struct OpticalSnapshot {
  uint64_t redSum;
  uint64_t irSum;
  uint32_t samples;
  float pulseBpm;
  bool pulseValid;
};

// Small, non-clinical peak interval estimator. A reading is omitted until at
// least two plausible, recent beat intervals have been detected.
float irBaseline=0, irFiltered=0, previousFiltered=0, peakValue=0;
bool peakRising=false;
uint32_t lastPeakAt=0;
uint16_t beatIntervals[4]={0}; uint8_t beatCount=0, beatIndex=0;
float pulseEstimate= NAN;

bool sensorHasCert() {
  const char* pem = SUPABASE_ROOT_CA;
  while (*pem == '\r' || *pem == '\n' || *pem == ' ' || *pem == '\t') ++pem;
  return strlen(pem) > 100 && strncmp(pem, "-----BEGIN CERTIFICATE-----", 27) == 0;
}
bool tlsClockReady() { return time(nullptr) > 1700000000; }
bool hasTrustedBatchTimestamp(const EcgBatch* batch) {
  if (!batch || !batch->startedEpochMs) return false;
  const time_t nowSeconds = time(nullptr);
  if (nowSeconds <= 1700000000) return false;
  const uint64_t nowEpochMs = static_cast<uint64_t>(nowSeconds) * 1000ULL;
  const uint64_t differenceMs = batch->startedEpochMs > nowEpochMs
    ? batch->startedEpochMs - nowEpochMs
    : nowEpochMs - batch->startedEpochMs;
  return differenceMs <= 30000;
}
bool epochMillisToIso(uint64_t epochMs, char* out, size_t capacity) {
  if (!epochMs || !out || capacity < 25) return false;
  const time_t seconds = static_cast<time_t>(epochMs / 1000ULL);
  struct tm utc{};
  if (!gmtime_r(&seconds, &utc)) return false;
  snprintf(out, capacity, "%04d-%02d-%02dT%02d:%02d:%02d.%03uZ",
    utc.tm_year + 1900, utc.tm_mon + 1, utc.tm_mday, utc.tm_hour, utc.tm_min, utc.tm_sec,
    static_cast<unsigned int>(epochMs % 1000ULL));
  return true;
}
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
    // Use a small threshold relative to the current IR level so ordinary
    // MAX30102 signal amplitudes are not rejected by a fixed 250-count gate.
    // This remains an experimental estimate; implausible intervals reset it.
    const float minimumPulseAmplitude = max(12.0f, irBaseline * 0.015f);
    if (amplitude >= minimumPulseAmplitude) {
      if (lastPeakAt != 0) {
        const uint32_t interval = now - lastPeakAt;
        if (interval >= 300 && interval <= 2000) {
          beatIntervals[beatIndex++ % 4] = static_cast<uint16_t>(interval);
          if (beatCount < 4) beatCount++;
          uint32_t sum=0; for (uint8_t i=0;i<beatCount;i++) sum += beatIntervals[i];
          pulseEstimate = 60000.0f * beatCount / sum;
        } else {
          beatCount = 0;
          pulseEstimate = NAN;
        }
      }
      // Always move the peak reference forward, including after a missed or
      // implausible beat, so the estimator can recover instead of staying blank.
      lastPeakAt = now;
    }
    peakValue = 0;
  }
  previousFiltered = irFiltered;
}
bool pulseEstimateValid() {
  return beatCount >= 2 && !isnan(pulseEstimate) && millis()-lastPeakAt < 10000 && pulseEstimate >= 30 && pulseEstimate <= 200;
}
OpticalSnapshot takeOpticalSnapshot(bool resetWindow) {
  OpticalSnapshot snapshot{};
  portENTER_CRITICAL(&opticalMux);
  snapshot.redSum = redSum;
  snapshot.irSum = irSum;
  snapshot.samples = opticalSamples;
  snapshot.pulseBpm = pulseEstimate;
  snapshot.pulseValid = pulseEstimateValid();
  if (resetWindow) {
    redSum = 0;
    irSum = 0;
    opticalSamples = 0;
  }
  portEXIT_CRITICAL(&opticalMux);
  return snapshot;
}

void initSensors() {
  maxReady = max30102.begin(Wire, I2C_SPEED_FAST);
  if (maxReady) {
    max30102.setup(0x1F, 4, 2, 100, 411, 4096);
    max30102.setPulseAmplitudeRed(MAX30102_LED_CURRENT); max30102.setPulseAmplitudeIR(MAX30102_LED_CURRENT); max30102.setPulseAmplitudeGreen(0);
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
  uint16_t checkMin = 4095, checkMax = 0;
  uint32_t checkSum = 0;
  for (uint8_t i = 0; i < 32; ++i) {
    const uint16_t sample = static_cast<uint16_t>(analogRead(PIN_ECG));
    checkMin = min(checkMin, sample);
    checkMax = max(checkMax, sample);
    checkSum += sample;
    delay(4);
  }
  ecgLatest = static_cast<int>(checkSum / 32);
  Serial.printf("[CHECK RESULT] AD8232 ADC range: min=%u max=%u mean=%u; LO+=%s, LO-=%s. Lead-off pins do not validate the analog signal.\n",
    static_cast<unsigned int>(checkMin), static_cast<unsigned int>(checkMax), static_cast<unsigned int>(ecgLatest),
    leadOffPlus ? "OFF" : "ON", leadOffMinus ? "OFF" : "ON");

  Serial.println("[CHECK 5/5] Buzzer: output is disabled in this firmware; no sound test was sent.");
  Serial.println("[CHECK] Sequential checks complete. Starting normal sensor collection and uploads.");
}

void retryMissingSensors() {
  if (millis()-lastSensorRetry < 10000) return;
  lastSensorRetry=millis();
  if (sensorI2cMutex) xSemaphoreTake(sensorI2cMutex, portMAX_DELAY);
  if (!maxReady) {
    maxReady=max30102.begin(Wire,I2C_SPEED_FAST);
    if (maxReady) { max30102.setup(0x1F,4,2,100,411,4096); max30102.setPulseAmplitudeRed(MAX30102_LED_CURRENT); max30102.setPulseAmplitudeIR(MAX30102_LED_CURRENT); max30102.setPulseAmplitudeGreen(0); }
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
  if (sensorI2cMutex) xSemaphoreGive(sensorI2cMutex);
}

void maintainWifi() {
  if (WiFi.status()==WL_CONNECTED) return;
  if (millis()-lastWifiTry < WIFI_RETRY_MS) return;
  lastWifiTry=millis(); WiFi.reconnect();
  Serial.println("[Wi-Fi] Reconnecting.");
}
void collectOptical() {
  if (sensorI2cMutex && xSemaphoreTake(sensorI2cMutex, pdMS_TO_TICKS(10)) != pdTRUE) return;
  if (!maxReady) {
    if (sensorI2cMutex) xSemaphoreGive(sensorI2cMutex);
    return;
  }
  max30102.check();
  while (max30102.available()) {
    const uint32_t red = max30102.getFIFORed();
    const uint32_t ir = max30102.getFIFOIR();
    max30102.nextSample();
    portENTER_CRITICAL(&opticalMux);
    redLatest=red; irLatest=ir;
    redSum+=red; irSum+=ir; opticalSamples++;
    detectPulse(ir);
    portEXIT_CRITICAL(&opticalMux);
  }
  if (sensorI2cMutex) xSemaphoreGive(sensorI2cMutex);
}
void opticalSamplerTask(void*) {
  for (;;) {
    collectOptical();
    vTaskDelay(pdMS_TO_TICKS(2));
  }
}
void makeBatchId(char* out, size_t capacity) {
  uint8_t bytes[16]; esp_fill_random(bytes, sizeof(bytes));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // UUID version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  snprintf(out, capacity,
    "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
    bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],
    bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]);
}

void ecgSamplerTask(void*) {
  TickType_t nextWake = xTaskGetTickCount();
  for (;;) {
    EcgBatch batch{};
    EcgPacket packet{};
    batch.sampleCount = ECG_BATCH_SAMPLES;
    batch.minimumSample = 4095;
    batch.maximumSample = 0;
    batch.startedAtMillis = millis();
    timeval captureTime{};
    gettimeofday(&captureTime, nullptr);
    if (captureTime.tv_sec > 1700000000) {
      batch.startedEpochMs = static_cast<uint64_t>(captureTime.tv_sec) * 1000ULL +
        static_cast<uint64_t>(captureTime.tv_usec / 1000);
    }
    for (uint16_t i = 0; i < ECG_BATCH_SAMPLES; ++i) {
      const bool loPlus = digitalRead(PIN_ECG_LO_PLUS) == HIGH;
      const bool loMinus = digitalRead(PIN_ECG_LO_MINUS) == HIGH;
      if (i % ECG_PACKET_SAMPLES == 0) {
        packet = EcgPacket{};
        packet.packetSequence = ++ecgPacketSequence;
        packet.startedAtMillis = millis();
        packet.startedEpochMs = batch.startedEpochMs
          ? batch.startedEpochMs + static_cast<uint64_t>(i) * 1000ULL / ECG_SAMPLE_RATE_HZ
          : 0;
      }
      const int sample = analogRead(PIN_ECG);
      batch.samples[i] = static_cast<uint16_t>(sample);
      packet.samples[packet.sampleCount++] = static_cast<uint16_t>(sample);
      packet.leadOffPositiveCount += loPlus ? 1 : 0;
      packet.leadOffNegativeCount += loMinus ? 1 : 0;
      batch.minimumSample = min(batch.minimumSample, batch.samples[i]);
      batch.maximumSample = max(batch.maximumSample, batch.samples[i]);
      batch.leadOffPositive |= loPlus;
      batch.leadOffNegative |= loMinus;
      batch.saturated |= sample == 0 || sample == 4095;
      leadOffPlus = loPlus;
      leadOffMinus = loMinus;
      ecgLatest = sample;
      if ((packet.sampleCount == ECG_PACKET_SAMPLES || i == ECG_BATCH_SAMPLES - 1) && ecgStreamQueue) {
        // Ignore an isolated LO pin glitch, but treat a majority of asserted
        // samples as lead-off for this short packet.
        packet.leadOffPositive = packet.leadOffPositiveCount * 2 >= packet.sampleCount;
        packet.leadOffNegative = packet.leadOffNegativeCount * 2 >= packet.sampleCount;
        if (xQueueSend(ecgStreamQueue, &packet, 0) != pdTRUE) {
          EcgPacket discarded{};
          xQueueReceive(ecgStreamQueue, &discarded, 0);
          ecgStreamDropped++;
          xQueueSend(ecgStreamQueue, &packet, 0);
        }
      }
      vTaskDelayUntil(&nextWake, pdMS_TO_TICKS(ECG_SAMPLE_PERIOD_MS));
    }
    makeBatchId(batch.batchId, sizeof(batch.batchId));
    // A full queue means upload has been unavailable for several seconds.
    // Drop this completed batch rather than ever blocking the 250 Hz sampler.
    if (ecgBatchQueue && xQueueSend(ecgBatchQueue, &batch, 0) != pdTRUE) {
      Serial.println("[ECG] Queue full: newest batch discarded; check upload latency/Wi-Fi.");
    }
  }
}
void collectPeriodicSensors() {
  if (sensorI2cMutex) xSemaphoreTake(sensorI2cMutex, portMAX_DELAY);
  accelX=accelY=accelZ=NAN; distanceMm=-1;
  if (mpuReady) {
    sensors_event_t a,g,temp; mpu6050.getEvent(&a,&g,&temp);
    accelX=a.acceleration.x/9.80665f; accelY=a.acceleration.y/9.80665f; accelZ=a.acceleration.z/9.80665f;
  }
  if (vl53Ready) {
    VL53L0X_RangingMeasurementData_t measure; vl53l0x.rangingTest(&measure, false);
    distanceMm=(measure.RangeStatus != 4 && measure.RangeMilliMeter > 0) ? measure.RangeMilliMeter : -1;
  }
  if (sensorI2cMutex) xSemaphoreGive(sensorI2cMutex);
}
String jsonNumber(float value, unsigned int digits=2) {
  if (!isfinite(value)) return "null";
  return String(value, digits);
}
String buildPayload(const EcgBatch* batch, const OpticalSnapshot& optical) {
  String body; body.reserve(2600);
  body="{\"device_id\":"+String(ROBO_VERSE_DEVICE_ID);
  // Use the sample-time clock only when NTP is synchronized and the batch is
  // recent. Otherwise omit it and let the server apply its receive-time fallback.
  const bool pulseOk=optical.pulseValid;
  const String heartStatus=!maxReady ? "unavailable" : (!optical.samples ? "no_samples" : (pulseOk ? "pulse_estimate_available" : "raw_samples_only"));
  const String movementStatus=!mpuReady ? "unavailable" : (isfinite(accelX) ? "ok" : "no_measurement");
  const String distanceStatus=!vl53Ready ? "unavailable" : (distanceMm>=0 ? "ok" : "no_range");
  const bool ecgHasLeadOff = batch && (batch->leadOffPositive || batch->leadOffNegative);
  const bool ecgSaturated = batch && batch->saturated;
  const String ecgStatus=!batch ? "no_samples" : (ecgSaturated ? "signal_saturated" : (ecgHasLeadOff ? "lead_off" : "ok"));
  body+=",\"pulse_rate_estimate_bpm\":"+(pulseOk ? String(optical.pulseBpm,1) : "null");
  body+=",\"red_raw\":"+(optical.samples ? String((uint32_t)(optical.redSum/optical.samples)) : "null");
  body+=",\"ir_raw\":"+(optical.samples ? String((uint32_t)(optical.irSum/optical.samples)) : "null");
  body+=",\"signal_valid\":"+String(pulseOk ? "true" : "false");
  body+=",\"motion_x\":"+jsonNumber(accelX)+",\"motion_y\":"+jsonNumber(accelY)+",\"motion_z\":"+jsonNumber(accelZ);
  // Preserve the legacy table's single raw point using the final unfiltered
  // sample in the batch; the canvas receives and plots the complete array.
  body+=",\"ecg_value\":"+((!batch || ecgHasLeadOff || ecgSaturated) ? String("null") : String(batch->samples[batch->sampleCount-1]));
  body+=",\"ecg_lead_off_positive\":"+String(batch && batch->leadOffPositive ? "true" : "false");
  body+=",\"ecg_lead_off_negative\":"+String(batch && batch->leadOffNegative ? "true" : "false");
  if (batch) {
    body+=",\"ecg_batch_id\":\""+String(batch->batchId)+"\",\"ecg_sample_rate_hz\":"+String(ECG_SAMPLE_RATE_HZ);
    body+=",\"ecg_samples\":[";
    for (uint16_t i=0; i<batch->sampleCount; ++i) { if(i) body+=","; body+=String(batch->samples[i]); }
    body+="]";
    if (hasTrustedBatchTimestamp(batch)) {
      const time_t batchSeconds = static_cast<time_t>(batch->startedEpochMs / 1000ULL);
      struct tm utc{};
      gmtime_r(&batchSeconds, &utc);
      char timestamp[32];
      snprintf(timestamp, sizeof(timestamp), "%04d-%02d-%02dT%02d:%02d:%02d.%03uZ",
        utc.tm_year + 1900, utc.tm_mon + 1, utc.tm_mday, utc.tm_hour, utc.tm_min, utc.tm_sec,
        static_cast<unsigned int>(batch->startedEpochMs % 1000ULL));
      body+=",\"ecg_batch_started_at\":\""+String(timestamp)+"\"";
    }
  }
  body+=",\"distance_mm\":"+(distanceMm>=0 ? String(distanceMm) : "null");
  body+=",\"sensor_status\":{\"heart_reader\":\""+heartStatus+"\",\"movement_sensor\":\""+movementStatus+"\",\"distance_sensor\":\""+distanceStatus+"\",\"ecg_sensor\":\""+ecgStatus+"\"}";
  body+=",\"sensor_errors\":{";
  bool first=true;
  if (!maxReady || !optical.samples) { body+="\"heart_reader\":\""+String(maxReady?"No optical samples in this upload window":"MAX30102 not detected")+"\""; first=false; }
  if (!mpuReady || !isfinite(accelX)) { if(!first) body+=","; body+="\"movement_sensor\":\""+String(mpuReady?"No acceleration sample":"MPU6050 not detected")+"\""; first=false; }
  if (!vl53Ready || distanceMm<0) { if(!first) body+=","; body+="\"distance_sensor\":\""+String(vl53Ready?"No valid distance in this sample":"VL53L0X not detected")+"\""; first=false; }
  if (batch && (ecgHasLeadOff||ecgSaturated)) {
    if(!first) body+=",";
    if (ecgSaturated && ecgHasLeadOff) {
      body+="\"ecg_sensor\":\"AD8232 lead off and ADC saturated; check leads, 3.3V power, ground, OUT to GPIO34\"";
    } else if (ecgSaturated) {
      body+="\"ecg_sensor\":\"AD8232 ADC saturated; check 3.3V power, ground, OUT to GPIO34\"";
    } else {
      body+="\"ecg_sensor\":\"AD8232 lead off\"";
    }
  }
  body+="}}";
  return body;
}
String buildStreamPayload(const EcgPacket& packet) {
  char capturedAt[32];
  if (!packet.startedEpochMs || !epochMillisToIso(packet.startedEpochMs, capturedAt, sizeof(capturedAt))) return String();
  String body; body.reserve(320);
  body = "{\"mode\":\"ecg_stream\",\"device_id\":" + String(ROBO_VERSE_DEVICE_ID);
  body += ",\"packet_sequence\":" + String(packet.packetSequence);
  body += ",\"captured_at\":\"" + String(capturedAt) + "\",\"sample_rate_hz\":250,\"samples\":[";
  for (uint8_t i = 0; i < packet.sampleCount; ++i) { if (i) body += ","; body += String(packet.samples[i]); }
  body += "],\"lead_off_positive\":" + String(packet.leadOffPositive ? "true" : "false");
  body += ",\"lead_off_negative\":" + String(packet.leadOffNegative ? "true" : "false") + "}";
  return body;
}
void ecgStreamSenderTask(void*) {
  WiFiClientSecure tls;
  tls.setCACert(SUPABASE_ROOT_CA);
  HTTPClient http;
  http.setConnectTimeout(STREAM_HTTP_TIMEOUT_MS);
  http.setTimeout(STREAM_HTTP_TIMEOUT_MS);
  http.setReuse(true);
  for (;;) {
    EcgPacket packet{};
    if (!ecgStreamQueue || xQueueReceive(ecgStreamQueue, &packet, pdMS_TO_TICKS(250)) != pdTRUE) continue;
    if (static_cast<uint32_t>(millis() - packet.startedAtMillis) > ECG_STREAM_MAX_QUEUE_AGE_MS) {
      ecgStreamDropped++;
      continue;
    }
    if (WiFi.status() != WL_CONNECTED || !tlsClockReady() || !sensorHasCert()) continue;
    const String body = buildStreamPayload(packet);
    if (!body.length()) continue;
    if (!http.begin(tls, INGEST_URL)) continue;
    http.addHeader("Content-Type", "application/json");
    http.addHeader("apikey", SUPABASE_ANON_KEY);
    http.addHeader("x-device-id", String(ROBO_VERSE_DEVICE_ID));
    http.addHeader("x-device-secret", ROBO_VERSE_DEVICE_SECRET);
    const uint32_t started = millis();
    const int status = http.POST(body);
    const uint32_t duration = millis() - started;
    if (status < 200 || status >= 300) {
      Serial.printf("[ECG STREAM] Packet %lu rejected, HTTP %d, request %lu ms.\n",
        static_cast<unsigned long>(packet.packetSequence), status, static_cast<unsigned long>(duration));
    } else if (packet.packetSequence % 13 == 0) {
      Serial.printf("[ECG STREAM] HTTP %d, packet %lu (%u samples), request %lu ms, queue %u/%u, dropped %lu.\n",
        status, static_cast<unsigned long>(packet.packetSequence), static_cast<unsigned int>(packet.sampleCount),
        static_cast<unsigned long>(duration),
        static_cast<unsigned int>(uxQueueMessagesWaiting(ecgStreamQueue)),
        static_cast<unsigned int>(ECG_STREAM_QUEUE_PACKETS),
        static_cast<unsigned long>(ecgStreamDropped));
    }
    http.end();
  }
}
void uploadReading() {
  if (WiFi.status()!=WL_CONNECTED) { Serial.println("[UPLOAD] Waiting for Wi-Fi."); return; }
  if (!sensorHasCert()) { Serial.println("[TLS] secrets.h needs the HTTPS root CA PEM; no upload attempted."); return; }
  if (!tlsClockReady()) { Serial.println("[TLS] Waiting for network time."); return; }
  EcgBatch batch{};
  bool hasBatch = false;
  // The fast packet stream carries every ECG sample. Archive just the newest
  // complete one-second batch on the slower summary path; never build backlog.
  if (ecgBatchQueue) {
    EcgBatch candidate{};
    while (xQueueReceive(ecgBatchQueue, &candidate, 0) == pdTRUE) {
      if (!hasBatch || candidate.startedAtMillis > batch.startedAtMillis) batch = candidate;
      hasBatch = true;
    }
  }
  const OpticalSnapshot optical = takeOpticalSnapshot(true);
  String body=buildPayload(hasBatch ? &batch : nullptr, optical);
  if (hasBatch) {
    Serial.printf("[ECG] ADC batch range: min=%u max=%u; lead-off +/-%s/%s; sample timestamp: %s; payload bytes: %u\n",
      static_cast<unsigned int>(batch.minimumSample), static_cast<unsigned int>(batch.maximumSample),
      batch.leadOffPositive ? "OFF" : "ON", batch.leadOffNegative ? "OFF" : "ON",
      hasTrustedBatchTimestamp(&batch) ? "NTP synchronized" : "server fallback",
      (unsigned)body.length());
  } else {
    Serial.printf("[ECG] No ECG batch in payload; payload bytes: %u\n", (unsigned)body.length());
  }
  WiFiClientSecure tls; tls.setCACert(SUPABASE_ROOT_CA);
  HTTPClient http; http.setConnectTimeout(HTTP_TIMEOUT_MS); http.setTimeout(HTTP_TIMEOUT_MS); http.setReuse(false);
  if (!http.begin(tls,INGEST_URL)) { Serial.println("[UPLOAD] HTTPS initialization failed."); return; }
  http.addHeader("Content-Type","application/json");
  http.addHeader("apikey",SUPABASE_ANON_KEY);
  http.addHeader("x-device-id",String(ROBO_VERSE_DEVICE_ID));
  http.addHeader("x-device-secret",ROBO_VERSE_DEVICE_SECRET);
  const uint32_t uploadStartedAt = millis();
  int status=http.POST(body);
  const uint32_t uploadDurationMs = millis() - uploadStartedAt;
  Serial.printf("[UPLOAD] Request duration: %lu ms; ECG queue depth: %u/%u; oldest batch age: %lu ms.\n",
    static_cast<unsigned long>(uploadDurationMs),
    static_cast<unsigned int>(ecgBatchQueue ? uxQueueMessagesWaiting(ecgBatchQueue) : 0),
    static_cast<unsigned int>(ECG_QUEUE_BATCHES),
    static_cast<unsigned long>(hasBatch ? millis() - batch.startedAtMillis : 0));
  Serial.printf("[UPLOAD] Device ID %d, HTTP %d, RED/IR samples %lu, pulse estimate %s.\n", ROBO_VERSE_DEVICE_ID,status,(unsigned long)optical.samples,optical.pulseValid?"available":"unavailable");
  if (status<200 || status>=300) { String response=http.getString(); if(response.length()) Serial.printf("[UPLOAD] Server response: %s\n",response.c_str()); }
  http.end();
}

void setup() {
  Serial.begin(115200); delay(100);
  analogReadResolution(12);
  // GPIO34 is an ADC1 input. Explicit 11 dB attenuation provides the ESP32's
  // broadest supported input range; samples remain raw and unfiltered.
  pinMode(PIN_ECG, INPUT);
  analogSetPinAttenuation(PIN_ECG, ADC_11db);
  pinMode(PIN_ECG_LO_PLUS,INPUT); pinMode(PIN_ECG_LO_MINUS,INPUT);
#if BUZZER_ENABLED
  pinMode(PIN_BUZZER,OUTPUT); buzzerSet(false);
#else
  pinMode(PIN_BUZZER,INPUT); // High-impedance while the optional module is disabled.
#endif
  Wire.begin(PIN_SDA,PIN_SCL);
  sensorI2cMutex=xSemaphoreCreateMutex();
  scanI2cBus(); initSensors(); runSensorDiagnostics();
  ecgBatchQueue=xQueueCreate(ECG_QUEUE_BATCHES,sizeof(EcgBatch));
  ecgStreamQueue=xQueueCreate(ECG_STREAM_QUEUE_PACKETS,sizeof(EcgPacket));
  if (ecgBatchQueue && ecgStreamQueue) {
    xTaskCreatePinnedToCore(ecgSamplerTask,"ecg-sampler",4096,nullptr,3,nullptr,1);
    xTaskCreatePinnedToCore(ecgStreamSenderTask,"ecg-live-stream",12288,nullptr,2,nullptr,0);
    Serial.println("[ECG] Raw ADC acquisition: 250 Hz; live packets of 20 samples every 80 ms.");
  } else Serial.println("[ECG] ERROR: Could not create raw sample queue.");
  if (xTaskCreatePinnedToCore(opticalSamplerTask,"max30102-reader",4096,nullptr,2,nullptr,1) == pdPASS)
    Serial.println("[MAX30102] FIFO sampling runs independently of HTTPS uploads.");
  else Serial.println("[MAX30102] ERROR: Could not create independent optical sampler task.");
  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true); WiFi.begin(WIFI_SSID,WIFI_PASSWORD); lastWifiTry=millis();
  configTime(0,0,"pool.ntp.org","time.google.com"); lastUpload=millis(); statusChirp();
  Serial.printf("[DEVICE] Numeric database ID %d. Pulse estimate is educational; no SpO2 is sent.\n",ROBO_VERSE_DEVICE_ID);
}
void loop() {
  maintainWifi(); retryMissingSensors();
  if (millis()-lastUpload>=UPLOAD_MS) { lastUpload=millis(); collectPeriodicSensors(); uploadReading(); }
  delay(1);
}
