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

  motion_x?: number | null;
  motion_y?: number | null;
  motion_z?: number | null;
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
      console.error(
        "Credential lookup failed:",
        credentialError,
      );

      return jsonResponse(
        {
          error:
            "Authentication service error",
        },
        500,
      );
    }

    if (!credential) {
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
      console.error(
        "Secret verification failed:",
        verifyError,
      );

      return jsonResponse(
        {
          error:
            "Authentication service error",
        },
        500,
      );
    }

    if (!secretMatch) {
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
      "motion_x",
      "motion_y",
      "motion_z",
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
      console.error(
        "Device lookup failed:",
        deviceError,
      );

      return jsonResponse(
        {
          error:
            "Device lookup failed",
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
      console.error(
        "Patient lookup failed:",
        patientError,
      );

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
      console.error(
        "Vital reading failed:",
        readingError,
      );

      return jsonResponse(
        {
          error:
            "Failed to record vital reading",
        },
        500,
      );
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

      recorded_at:
        body.recorded_at ??
        new Date().toISOString(),
    });

  } catch (error) {

    console.error(
      "Unexpected error:",
      error,
    );

    return jsonResponse(
      {
        error:
          "Internal server error",
      },
      500,
    );
  }
});
