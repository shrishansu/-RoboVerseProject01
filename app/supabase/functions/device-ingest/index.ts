import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-device-id, x-device-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL: string = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY: string = Deno.env.get(
  "SUPABASE_SERVICE_ROLE_KEY",
)!;

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
);

interface VitalPayload {
  device_id: number;

  recorded_at?: string;

  heart_rate?: number | null;
  spo2?: number | null;
  temperature?: number | null;
  respiratory_rate?: number | null;

  systolic_bp?: number | null;
  diastolic_bp?: number | null;

  blood_glucose?: number | null;
  weight_kg?: number | null;

  ecg_value?: number | null;
  object_temperature_c?: number | null;
  pulse_rate_estimate_bpm?: number | null;
  distance_mm?: number | null;
  ecg_lead_off_positive?: boolean | null;
  ecg_lead_off_negative?: boolean | null;
  sensor_status?: Record<string, string> | null;
  sensor_errors?: Record<string, string> | null;

  motion_x?: number | null;
  motion_y?: number | null;
  motion_z?: number | null;
  red_raw?: number | null;
  ir_raw?: number | null;
  signal_quality?: number | null;
  signal_valid?: boolean | null;
  configuration_version?: number | null;
  ingestion_id?: string | null;
}

function jsonResponse(
  data: unknown,
  status = 200,
) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    },
  );
}

function isValidNumber(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (
      typeof value === "number" &&
      Number.isFinite(value)
    )
  );
}

function logDatabaseFailure(stage: string, diagnosticId: string, code?: string) {
  // Never log request headers, device secrets, password hashes, patient IDs,
  // or raw database error objects. The diagnostic ID joins this event to the
  // generic 500 response returned to the device.
  console.error(JSON.stringify({
    event: "device_ingest_database_failure",
    diagnostic_id: diagnosticId,
    stage,
    database_code: code || "unknown",
  }));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      {
        error: "Method not allowed",
      },
      405,
    );
  }

  const diagnosticId = crypto.randomUUID();

  try {
    // ========================================================
    // DEVICE AUTHENTICATION
    // ========================================================

    const deviceIdHeader =
      req.headers.get("x-device-id");

    const deviceSecret =
      req.headers.get("x-device-secret");

    if (!deviceIdHeader || !deviceSecret) {
      return jsonResponse(
        {
          error: "Missing device credentials",
        },
        401,
      );
    }

    const deviceId = Number(deviceIdHeader);

    if (
      !Number.isInteger(deviceId) ||
      deviceId <= 0
    ) {
      return jsonResponse(
        {
          error: "Invalid device ID",
        },
        400,
      );
    }

    if (
      typeof deviceSecret !== "string" ||
      deviceSecret.length < 32
    ) {
      return jsonResponse(
        {
          error: "Invalid device secret",
        },
        401,
      );
    }

    // ========================================================
    // FIND ACTIVE DEVICE CREDENTIAL
    // ========================================================

    const {
      data: credential,
      error: credentialError,
    } = await supabase
      .from("device_credentials")
      .select(`
        id,
        device_id,
        secret_hash,
        status
      `)
      .eq("device_id", deviceId)
      .eq("status", "active")
      .maybeSingle();

    if (credentialError) {
      logDatabaseFailure("credential_lookup", diagnosticId, credentialError.code);

      return jsonResponse(
        {
          error:
            "Authentication service error",
          diagnostic_id: diagnosticId,
        },
        500,
      );
    }

    if (!credential) {
      console.warn(JSON.stringify({
        event: "device_credential_rejected",
        diagnostic_id: diagnosticId,
        reason: "missing_or_inactive_credential",
      }));
      return jsonResponse(
        {
          error:
            "Invalid device credentials",
        },
        401,
      );
    }

    // ========================================================
    // VERIFY DEVICE SECRET
    // ========================================================

    const {
      data: secretMatch,
      error: verifyError,
    } = await supabase.rpc(
      "verify_device_secret",
      {
        target_secret: deviceSecret,
        target_hash: credential.secret_hash,
      },
    );

    if (verifyError) {
      logDatabaseFailure("secret_verification", diagnosticId, verifyError.code);

      return jsonResponse(
        {
          error:
            "Authentication service error",
          diagnostic_id: diagnosticId,
        },
        500,
      );
    }

    if (!secretMatch) {
      console.warn(JSON.stringify({
        event: "device_credential_rejected",
        diagnostic_id: diagnosticId,
        reason: "secret_mismatch",
      }));
      return jsonResponse(
        {
          error:
            "Invalid device credentials",
        },
        401,
      );
    }

    // ========================================================
    // READ REQUEST BODY
    // ========================================================

    let body: VitalPayload;

    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        {
          error: "Invalid JSON body",
        },
        400,
      );
    }

    // ========================================================
    // VALIDATE DEVICE ID
    // ========================================================

    if (
      !Number.isInteger(body.device_id) ||
      body.device_id <= 0
    ) {
      return jsonResponse(
        {
          error: "Invalid device_id",
        },
        400,
      );
    }

    if (body.device_id !== deviceId) {
      return jsonResponse(
        {
          error: "Device ID mismatch",
        },
        403,
      );
    }

    // ========================================================
    // VALIDATE NUMERIC VALUES
    // ========================================================

    const numericFields = [
      "heart_rate",
      "spo2",
      "temperature",
      "respiratory_rate",
      "systolic_bp",
      "diastolic_bp",
      "blood_glucose",
      "weight_kg",
      "ecg_value",
      "object_temperature_c",
      "pulse_rate_estimate_bpm",
      "distance_mm",
      "motion_x",
      "motion_y",
      "motion_z",
      "red_raw",
      "ir_raw",
      "signal_quality",
      "configuration_version",
    ] as const;

    for (const field of numericFields) {
      if (!isValidNumber(body[field])) {
        return jsonResponse(
          {
            error: `Invalid ${field}`,
          },
          400,
        );
      }
    }

    if (body.signal_valid != null && typeof body.signal_valid !== "boolean") {
      return jsonResponse({ error: "Invalid signal_valid" }, 400);
    }
    for (const field of ["ecg_lead_off_positive", "ecg_lead_off_negative"] as const) {
      if (body[field] != null && typeof body[field] !== "boolean") {
        return jsonResponse({ error: `Invalid ${field}` }, 400);
      }
    }
    const allowedSensorKeys = new Set([
      "heart_reader", "temperature_sensor", "movement_sensor", "distance_sensor", "ecg_sensor",
    ]);
    for (const [field, map] of [["sensor_status", body.sensor_status], ["sensor_errors", body.sensor_errors]] as const) {
      if (map == null) continue;
      if (typeof map !== "object" || Array.isArray(map) ||
        Object.entries(map).some(([key, value]) => !allowedSensorKeys.has(key) || typeof value !== "string" || value.length > 120)) {
        return jsonResponse({ error: `Invalid ${field}` }, 400);
      }
    }
    if (body.ingestion_id != null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.ingestion_id)) {
      return jsonResponse({ error: "Invalid ingestion_id" }, 400);
    }

    // ========================================================
    // RANGE VALIDATION
    // ========================================================

    if (
      body.heart_rate != null &&
      (
        body.heart_rate < 20 ||
        body.heart_rate > 300
      )
    ) {
      return jsonResponse(
        {
          error:
            "Heart rate must be between 20 and 300",
        },
        400,
      );
    }

    if (
      body.spo2 != null &&
      (
        body.spo2 < 0 ||
        body.spo2 > 100
      )
    ) {
      return jsonResponse(
        {
          error:
            "SpO2 must be between 0 and 100",
        },
        400,
      );
    }

    if (
      body.temperature != null &&
      (
        body.temperature < 20 ||
        body.temperature > 50
      )
    ) {
      return jsonResponse(
        {
          error:
            "Temperature must be between 20 and 50",
        },
        400,
      );
    }

    if (body.object_temperature_c != null &&
      (body.object_temperature_c < -70 || body.object_temperature_c > 380)) {
      return jsonResponse({ error: "Invalid infrared object temperature range" }, 400);
    }
    if (body.pulse_rate_estimate_bpm != null &&
      (body.pulse_rate_estimate_bpm < 30 || body.pulse_rate_estimate_bpm > 200)) {
      return jsonResponse({ error: "Invalid pulse rate estimate" }, 400);
    }
    if (body.distance_mm != null &&
      (!Number.isInteger(body.distance_mm) || body.distance_mm < 0 || body.distance_mm > 8190)) {
      return jsonResponse({ error: "Invalid distance_mm" }, 400);
    }
    if (body.ecg_value != null && (body.ecg_value < 0 || body.ecg_value > 4095)) {
      return jsonResponse({ error: "Invalid raw ECG ADC value" }, 400);
    }

    if (
      body.respiratory_rate != null &&
      (
        body.respiratory_rate < 1 ||
        body.respiratory_rate > 100
      )
    ) {
      return jsonResponse(
        {
          error:
            "Respiratory rate must be between 1 and 100",
        },
        400,
      );
    }

    if (
      body.systolic_bp != null &&
      (
        body.systolic_bp < 40 ||
        body.systolic_bp > 300
      )
    ) {
      return jsonResponse(
        {
          error:
            "Systolic blood pressure must be between 40 and 300",
        },
        400,
      );
    }

    if (
      body.diastolic_bp != null &&
      (
        body.diastolic_bp < 20 ||
        body.diastolic_bp > 200
      )
    ) {
      return jsonResponse(
        {
          error:
            "Diastolic blood pressure must be between 20 and 200",
        },
        400,
      );
    }

    if (
      body.blood_glucose != null &&
      (
        body.blood_glucose < 0 ||
        body.blood_glucose > 1000
      )
    ) {
      return jsonResponse(
        {
          error:
            "Blood glucose must be between 0 and 1000",
        },
        400,
      );
    }

    if (
      body.weight_kg != null &&
      (
        body.weight_kg <= 0 ||
        body.weight_kg > 500
      )
    ) {
      return jsonResponse(
        {
          error:
            "Weight must be between 0 and 500 kg",
        },
        400,
      );
    }

    // ========================================================
    // CHECK DEVICE
    // ========================================================

    const {
      data: device,
      error: deviceError,
    } = await supabase
      .from("devices")
      .select(`
        id,
        hospital_id,
        assigned_patient_id,
        status
      `)
      .eq("id", deviceId)
      .maybeSingle();

    if (deviceError) {
      logDatabaseFailure("device_lookup", diagnosticId, deviceError.code);

      return jsonResponse(
        {
          error: "Device lookup failed",
          diagnostic_id: diagnosticId,
        },
        500,
      );
    }

    if (!device) {
      return jsonResponse(
        {
          error: "Device not found",
        },
        404,
      );
    }

    if (
      device.status === "inactive" ||
      device.status === "maintenance"
    ) {
      return jsonResponse(
        {
          error:
            "Device is not active",
        },
        403,
      );
    }

    // ========================================================
    // CHECK DEVICE PATIENT ASSIGNMENT
    // ========================================================

    const assignedPatientId = device.assigned_patient_id;

    if (!Number.isInteger(assignedPatientId) || assignedPatientId <= 0) {
      return jsonResponse(
        {
          error: "Device has no active patient assignment",
        },
        409,
      );
    }

    // ========================================================
    // CHECK PATIENT
    // ========================================================

    const {
      data: patient,
      error: patientError,
    } = await supabase
      .from("patients")
      .select(`
        id,
        hospital_id,
        status
      `)
      .eq("id", assignedPatientId)
      .maybeSingle();

    if (patientError) {
      logDatabaseFailure("patient_lookup", diagnosticId, patientError.code);

      return jsonResponse(
        {
          error:
            "Patient lookup failed",
        },
        500,
      );
    }

    if (!patient) {
      return jsonResponse(
        {
          error: "Patient not found",
        },
        404,
      );
    }

    if (
      device.hospital_id !== patient.hospital_id
    ) {
      return jsonResponse(
        {
          error:
            "Device and patient belong to different hospitals",
        },
        403,
      );
    }

    // ========================================================
    // RECORD VITAL
    // ========================================================

    const {
      data: readingId,
      error: readingError,
    } = await supabase.rpc(
      "record_vital_reading",
      {
        p_patient_id:
          assignedPatientId,

        p_device_id:
          body.device_id,

        p_recorded_at:
          body.recorded_at ??
          new Date().toISOString(),

        p_heart_rate:
          body.heart_rate ?? null,

        p_spo2:
          body.spo2 ?? null,

        p_temperature:
          body.temperature ?? null,

        p_respiratory_rate:
          body.respiratory_rate ?? null,

        p_systolic_bp:
          body.systolic_bp ?? null,

        p_diastolic_bp:
          body.diastolic_bp ?? null,

        p_blood_glucose:
          body.blood_glucose ?? null,

        p_weight_kg:
          body.weight_kg ?? null,

        p_ecg_value:
          body.ecg_value ?? null,

        p_motion_x:
          body.motion_x ?? null,

        p_motion_y:
          body.motion_y ?? null,

        p_motion_z:
          body.motion_z ?? null,

        p_source:
          "iot",
      },
    );

    if (readingError) {
      logDatabaseFailure("record_vital_reading", diagnosticId, readingError.code);

      return jsonResponse(
        {
          error: "Failed to record vital reading",
          diagnostic_id: diagnosticId,
        },
        500,
      );
    }

    // These optional fields are written only when firmware actually supplies
    // them; the existing vital-reading RPC remains the source of clinical rows.
    if (body.red_raw != null || body.ir_raw != null || body.signal_quality != null ||
        body.signal_valid != null || body.configuration_version != null || body.ingestion_id != null ||
        body.object_temperature_c !== undefined || body.pulse_rate_estimate_bpm !== undefined ||
        body.distance_mm !== undefined || body.ecg_lead_off_positive !== undefined ||
        body.ecg_lead_off_negative !== undefined || body.sensor_status !== undefined ||
        body.sensor_errors !== undefined) {
      const metadataUpdate: Record<string, unknown> = {
        red_raw: body.red_raw ?? null,
        ir_raw: body.ir_raw ?? null,
        signal_quality: body.signal_quality ?? null,
        signal_valid: body.signal_valid ?? null,
        configuration_version: body.configuration_version ?? null,
        ingestion_id: body.ingestion_id ?? null,
      };
      // Keep legacy device payloads operational until the additive telemetry
      // migration is applied; new fields are written when the firmware sends them.
      if (body.object_temperature_c !== undefined) metadataUpdate.object_temperature_c = body.object_temperature_c;
      if (body.pulse_rate_estimate_bpm !== undefined) metadataUpdate.pulse_rate_estimate_bpm = body.pulse_rate_estimate_bpm;
      if (body.distance_mm !== undefined) metadataUpdate.distance_mm = body.distance_mm;
      if (body.ecg_lead_off_positive !== undefined) metadataUpdate.ecg_lead_off_positive = body.ecg_lead_off_positive;
      if (body.ecg_lead_off_negative !== undefined) metadataUpdate.ecg_lead_off_negative = body.ecg_lead_off_negative;
      if (body.sensor_status !== undefined) metadataUpdate.sensor_status = body.sensor_status;
      if (body.sensor_errors !== undefined) metadataUpdate.sensor_errors = body.sensor_errors;
      const { error: metadataError } = await supabase.from("vital_readings").update(metadataUpdate)
        .eq("id", readingId).eq("device_id", deviceId);
      if (metadataError) {
        logDatabaseFailure("reading_metadata_update", diagnosticId, metadataError.code);
        return jsonResponse({ error: "Failed to record sensor metadata", diagnostic_id: diagnosticId }, 500);
      }
    }

    // Record server-side communication time only after the reading was stored.
    const ingestionTimestamp = new Date().toISOString();
    const { data: deviceActivity, error: deviceActivityError } = await supabase
      .from("devices")
      .update({ last_seen_at: ingestionTimestamp, status: "online" })
      .eq("id", deviceId)
      .in("status", ["offline", "online"])
      .select("id")
      .maybeSingle();

    if (deviceActivityError) {
      // The reading is already stored; keep the successful ingest response while
      // reporting that the independent activity timestamp could not be updated.
      logDatabaseFailure("device_activity_update", diagnosticId, deviceActivityError.code);
    }

    // ========================================================
    // UPDATE LAST USED
    // ========================================================

    await supabase
      .from("device_credentials")
      .update({
        last_used_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        credential.id,
      );

    // ========================================================
    // SUCCESS
    // ========================================================

    return jsonResponse({
      success: true,

      message:
        "Vital reading recorded successfully",

      reading_id:
        readingId,

      device_id:
        deviceId,

      patient_id:
        assignedPatientId,

      last_seen_at_updated:
        Boolean(deviceActivity) && !deviceActivityError,

      ingested_at:
        ingestionTimestamp,

      recorded_at:
        body.recorded_at ??
        new Date().toISOString(),
    });

  } catch (error) {
    console.error(JSON.stringify({
      event: "device_ingest_unexpected_failure",
      diagnostic_id: diagnosticId,
      error_type: error instanceof Error ? error.name : "unknown",
    }));

    return jsonResponse(
      {
        error:
          "Internal server error",
          diagnostic_id: diagnosticId,
      },
      500,
    );
  }
});
