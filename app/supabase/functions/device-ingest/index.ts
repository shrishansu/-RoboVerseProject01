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
  ecg_batch_id?: string;
  ecg_sample_rate_hz?: number;
  ecg_batch_started_at?: string;
  ecg_samples?: number[];
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

function classifyDatabaseFailure(error: { message?: string } | null | undefined): string {
  const message = error?.message?.toLowerCase() || "";
  if (message.includes("row-level security") || message.includes("row level security")) return "rls_policy";
  if (message.includes("permission denied for schema")) return "schema_privilege";
  if (message.includes("permission denied for table")) return "table_privilege";
  if (message.includes("permission denied for sequence")) return "sequence_privilege";
  if (message.includes("permission denied for function")) return "function_privilege";
  if (message.includes("permission denied")) return "object_privilege";
  return "other_database_error";
}

function logDatabaseFailure(
  stage: string,
  diagnosticId: string,
  error?: string | { code?: string; message?: string } | null,
) {
  // Never log request headers, device secrets, password hashes, patient IDs,
  // or raw database error objects. The diagnostic ID joins this event to the
  // generic 500 response returned to the device.
  console.error(JSON.stringify({
    event: "device_ingest_database_failure",
    diagnostic_id: diagnosticId,
    stage,
    database_code: typeof error === "string" ? error : error?.code || "unknown",
    database_error_kind: classifyDatabaseFailure(typeof error === "string" ? null : error),
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

    const hasEcgBatch = body.ecg_samples !== undefined || body.ecg_batch_id !== undefined ||
      body.ecg_sample_rate_hz !== undefined || body.ecg_batch_started_at !== undefined;
    if (hasEcgBatch) {
      if (!Array.isArray(body.ecg_samples) || body.ecg_samples.length < 200 || body.ecg_samples.length > 300 ||
        body.ecg_samples.some((sample) => !Number.isInteger(sample) || sample < 0 || sample > 4095) ||
        body.ecg_sample_rate_hz !== 250 ||
        typeof body.ecg_batch_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.ecg_batch_id) ||
        (body.ecg_batch_started_at !== undefined &&
          (typeof body.ecg_batch_started_at !== "string" || !Number.isFinite(Date.parse(body.ecg_batch_started_at))))) {
        return jsonResponse({ error: "Invalid raw ECG batch" }, 400);
      }
      if (body.ecg_lead_off_positive == null || body.ecg_lead_off_negative == null) {
        return jsonResponse({ error: "Raw ECG batches require lead-off state" }, 400);
      }
      if (body.ecg_batch_started_at !== undefined &&
        Math.abs(Date.now() - Date.parse(body.ecg_batch_started_at)) > 60_000) {
        return jsonResponse({ error: "ECG batch timestamp is outside the allowed clock-skew window" }, 400);
      }
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

    // One server-authorized transaction verifies the credential, resolves
    // the current assignment, writes the vital row/metadata/ECG batch, and
    // updates device activity. The database trigger broadcasts the committed
    // batch to the user's scoped private Realtime channel.
    const { data: ingestResult, error: ingestError } = await supabase.rpc(
      "ingest_device_vitals",
      { p_device_id: deviceId, p_device_secret: deviceSecret, p_payload: body },
    );
    if (ingestError) {
      logDatabaseFailure("transactional_ingest", diagnosticId, ingestError);
      return jsonResponse({ error: "Failed to record device reading", diagnostic_id: diagnosticId }, 500);
    }
    if (ingestResult?.error) {
      const status = Number(ingestResult.status) || 500;
      const messages: Record<string, string> = {
        invalid_request: "Invalid device request",
        device_id_mismatch: "Device ID mismatch",
        invalid_device_credentials: "Invalid device credentials",
        device_not_found: "Device not found",
        device_not_active: "Device is not active",
        device_unassigned: "Device has no active patient assignment",
        patient_not_found: "Patient not found",
        device_patient_hospital_mismatch: "Device and patient belong to different hospitals",
      };
      return jsonResponse({ error: messages[ingestResult.error] || "Device ingest was rejected" }, status);
    }

    return jsonResponse({
      success: true,
      message: "Vital reading recorded successfully",
      reading_id: ingestResult.reading_id,
      device_id: deviceId,
      patient_id: ingestResult.patient_id,
      last_seen_at_updated: true,
      ingested_at: new Date().toISOString(),
      recorded_at: ingestResult.recorded_at,
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
