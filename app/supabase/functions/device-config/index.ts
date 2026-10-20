import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-device-id, x-device-secret",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return reply({ error: "Method not allowed" }, 405);
  const id = Number(req.headers.get("x-device-id"));
  const secret = req.headers.get("x-device-secret") || "";
  if (!Number.isSafeInteger(id) || id <= 0 || secret.length < 32) return reply({ error: "Invalid device credentials" }, 401);
  const { data: credential, error } = await client.from("device_credentials")
    .select("id,secret_hash").eq("device_id", id).eq("status", "active").maybeSingle();
  if (error) return reply({ error: "Authentication service error" }, 500);
  if (!credential) return reply({ error: "Invalid device credentials" }, 401);
  const { data: valid, error: verifyError } = await client.rpc("verify_device_secret", {
    target_secret: secret, target_hash: credential.secret_hash,
  });
  if (verifyError) return reply({ error: "Authentication service error" }, 500);
  if (!valid) return reply({ error: "Invalid device credentials" }, 401);
  const { data: device, error: deviceError } = await client.from("devices")
    .select("id,status").eq("id", id).maybeSingle();
  if (deviceError) return reply({ error: "Device lookup failed" }, 500);
  if (!device) return reply({ error: "Device not found" }, 404);
  if (["inactive", "maintenance"].includes(device.status)) return reply({ error: "Device is not active" }, 403);
  const { data: config, error: configError } = await client.from("device_measurement_configs")
    .select("configuration,version").eq("device_id", id).maybeSingle();
  if (configError) return reply({ error: "Configuration lookup failed" }, 500);
  return reply({ device_id: id, version: config?.version ?? 0, configuration: config?.configuration ?? {
    configurationEnabled: false, measurementDurationSeconds: 15, measurementIntervalSeconds: 60,
    calculationWindowSeconds: 10, uploadIntervalSeconds: 60, automaticUpload: true,
    modules: { MAX30102: { enabled: false, samplingRateHz: 100, sampleAverage: 4 },
      AD8232: { enabled: false, samplingRateHz: 250 }, MLX90614: { enabled: false, measurementIntervalSeconds: 60 },
      HX711: { enabled: false, measurementIntervalSeconds: 60, calibrationStatus: "uncalibrated", calibrationFactor: null },
      MPU6050: { enabled: false, samplingRateHz: 100, accelerationEnabled: true, gyroscopeEnabled: true } },
  } });
});
