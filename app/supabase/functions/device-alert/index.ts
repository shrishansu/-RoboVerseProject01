import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-device-id, x-device-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (data: unknown, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
);

const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

function configuredClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!url || !serviceKey || !botToken) return null;
  return { client: createClient(url, serviceKey), botToken };
}

async function sendTelegram(botToken: string, chatId: string, text: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    return response.ok && result?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const configured = configuredClient();
  if (!configured) return jsonResponse({ error: "server_not_configured" }, 500);
  const { client, botToken } = configured;

  try {
    const deviceIdHeader = req.headers.get("x-device-id");
    const deviceSecret = req.headers.get("x-device-secret") || "";
    const deviceId = Number(deviceIdHeader);
    if (!deviceIdHeader || !Number.isSafeInteger(deviceId) || deviceId <= 0 || deviceSecret.length < 32) {
      return jsonResponse({ error: "Invalid device credentials" }, 401);
    }

    const { data: credential, error: credentialError } = await client.from("device_credentials")
      .select("secret_hash,status,revoked_at")
      .eq("device_id", deviceId)
      .eq("status", "active")
      .is("revoked_at", null)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (credentialError) return jsonResponse({ error: "Authentication service error" }, 500);
    if (!credential) return jsonResponse({ error: "Invalid device credentials" }, 401);

    const { data: valid, error: verifyError } = await client.rpc("verify_device_secret", {
      target_secret: deviceSecret,
      target_hash: credential.secret_hash,
    });
    if (verifyError) return jsonResponse({ error: "Authentication service error" }, 500);
    if (!valid) return jsonResponse({ error: "Invalid device credentials" }, 401);

    let body: { event?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }
    if (body?.event !== "patient_call") return jsonResponse({ error: "Unknown event" }, 400);

    const { data: device, error: deviceError } = await client.from("devices")
      .select("id,status,assigned_patient_id")
      .eq("id", deviceId)
      .maybeSingle();
    if (deviceError) return jsonResponse({ error: "Device lookup failed" }, 500);
    if (!device) return jsonResponse({ error: "Device not found" }, 404);
    if (["inactive", "maintenance"].includes(device.status)) return jsonResponse({ error: "Device is not active" }, 403);
    if (!device.assigned_patient_id) return jsonResponse({ error: "device_not_assigned_to_patient" }, 409);

    const patientId = Number(device.assigned_patient_id);
    const { data: duplicate, error: duplicateError } = await client.from("alerts")
      .select("id")
      .eq("patient_id", patientId)
      .eq("alert_type", "patient_call")
      .gte("created_at", new Date(Date.now() - 30_000).toISOString())
      .limit(1)
      .maybeSingle();
    if (duplicateError) return jsonResponse({ error: "Alert lookup failed" }, 500);
    if (duplicate) return jsonResponse({ status: "duplicate" });

    const { data: patient, error: patientError } = await client.from("patients")
      .select("id,patient_number,first_name,middle_name,last_name,hospital_id")
      .eq("id", patientId)
      .maybeSingle();
    if (patientError) return jsonResponse({ error: "Patient lookup failed" }, 500);
    if (!patient) return jsonResponse({ error: "Patient not found" }, 404);

    const now = new Date();
    const recordedTime = new Intl.DateTimeFormat("en-LK", {
      timeZone: "Asia/Colombo", dateStyle: "medium", timeStyle: "medium",
    }).format(now);
    const patientName = [patient.first_name, patient.middle_name, patient.last_name]
      .filter(Boolean).join(" ");
    const alertMessage = `Patient call button pressed for ${patientName} (${patient.patient_number}) at ${recordedTime}.`;

    const { data: recipients, error: recipientsError } = await client.rpc("get_patient_alert_recipients", {
      p_patient_id: patientId,
    });
    if (recipientsError) {
      console.error(JSON.stringify({ event: "device_alert_recipient_lookup_failed", code: recipientsError.code || "unknown" }));
      return jsonResponse({ error: "Alert recipient lookup failed" }, 500);
    }
    const activeRecipients = Array.isArray(recipients) ? recipients : [];

    const { data: alert, error: insertError } = await client.from("alerts")
      .insert({
        patient_id: patientId,
        alert_type: "patient_call",
        severity: "critical",
        title: "Patient call button pressed",
        message: alertMessage,
      })
      .select("id,created_at")
      .single();
    if (insertError) {
      console.error(JSON.stringify({ event: "device_alert_insert_failed", code: insertError.code || "unknown" }));
      return jsonResponse({ error: "Failed to record patient call alert" }, 500);
    }

    const { data: assignment } = await client.from("patient_assignments")
      .select("bed_id,ward_id,start_date")
      .eq("patient_id", patientId)
      .eq("status", "active")
      .lte("start_date", now.toISOString())
      .or(`end_date.is.null,end_date.gte.${now.toISOString()}`)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    let location = "";
    if (assignment?.bed_id) {
      const { data: bed } = await client.from("beds").select("bed_number,ward_id").eq("id", assignment.bed_id).maybeSingle();
      if (bed?.bed_number) location = `Bed: ${escapeHtml(bed.bed_number)}`;
      if (bed?.ward_id) assignment.ward_id = bed.ward_id;
    }
    if (assignment?.ward_id) {
      const { data: ward } = await client.from("wards").select("name").eq("id", assignment.ward_id).maybeSingle();
      if (ward?.name) location = [location, `Ward: ${escapeHtml(ward.name)}`].filter(Boolean).join(" · ");
    }

    const recipientIds = [...new Set(activeRecipients.map((recipient: { user_id?: string }) => recipient.user_id).filter(Boolean))];
    if (recipientIds.length > 0) {
      const { data: existingNotifications, error: notificationLookupError } = await client.from("notifications")
        .select("user_id").eq("alert_id", alert.id).in("user_id", recipientIds);
      if (notificationLookupError) {
        console.error(JSON.stringify({ event: "device_alert_notification_lookup_failed", code: notificationLookupError.code || "unknown" }));
      } else {
        const notified = new Set((existingNotifications || []).map((row: { user_id: string }) => row.user_id));
        const missingNotifications = activeRecipients.filter((recipient: { user_id: string }) => !notified.has(recipient.user_id))
          .map((recipient: { user_id: string }) => ({
            user_id: recipient.user_id,
            patient_id: patientId,
            alert_id: alert.id,
            notification_type: "alert",
            title: "Patient call button pressed",
            message: alertMessage,
            severity: "critical",
          }));
        if (missingNotifications.length > 0) {
          const { error: notificationInsertError } = await client.from("notifications").insert(missingNotifications);
          if (notificationInsertError) {
            console.error(JSON.stringify({ event: "device_alert_notification_insert_failed", code: notificationInsertError.code || "unknown" }));
          }
        }
      }
    }

    const chats = activeRecipients.filter((recipient: { telegram_chat_id?: string | null }) => recipient.telegram_chat_id);
    const noChatId = activeRecipients.length - chats.length;
    if (noChatId > 0) console.warn(JSON.stringify({ event: "patient_call_recipients_without_telegram", count: noChatId }));
    const locationLine = location ? `\n${location}` : "";
    const text = `🚨 <b>PATIENT CALL</b>\nPatient: ${escapeHtml(patientName)} (${escapeHtml(patient.patient_number)})${locationLine}\nTime: ${escapeHtml(recordedTime)}\nThe patient pressed the call button. Please attend immediately.`;
    const settled = await Promise.allSettled(chats.map((recipient: { telegram_chat_id: string }) =>
      sendTelegram(botToken, recipient.telegram_chat_id, text)));
    const telegramSent = settled.filter((result) => result.status === "fulfilled" && result.value).length;
    const telegramFailed = chats.length - telegramSent;

    return jsonResponse({
      status: "sent",
      alert_id: alert.id,
      recipients: activeRecipients.length,
      telegram_sent: telegramSent,
      telegram_failed: telegramFailed,
      no_chat_id: noChatId,
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "device_alert_unexpected_failure",
      error_type: error instanceof Error ? error.name : "unknown",
    }));
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
