-- Fast raw ECG transport. Packets are authenticated with the existing
-- per-device credential, then sent to private Realtime without writing a
-- vital_readings or device_ecg_batches row.
CREATE OR REPLACE FUNCTION public.broadcast_device_ecg_packet(
  p_device_id bigint,
  p_device_secret text,
  p_packet jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_secret_hash text;
  v_device record;
  v_patient_hospital_id bigint;
  v_captured_at timestamptz;
BEGIN
  IF p_device_id IS NULL OR p_device_id <= 0 OR p_device_secret IS NULL OR
     length(p_device_secret) < 32 OR jsonb_typeof(p_packet) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('error', 'invalid_request', 'status', 400);
  END IF;
  IF COALESCE(p_packet->>'device_id', '') !~ '^[0-9]{1,18}$' OR
     (p_packet->>'device_id')::bigint IS DISTINCT FROM p_device_id THEN
    RETURN jsonb_build_object('error', 'device_id_mismatch', 'status', 403);
  END IF;
  IF jsonb_typeof(p_packet->'samples') IS DISTINCT FROM 'array' OR
     jsonb_array_length(p_packet->'samples') NOT BETWEEN 10 AND 20 OR
     p_packet->>'sample_rate_hz' IS DISTINCT FROM '250' OR
     jsonb_typeof(p_packet->'lead_off_positive') IS DISTINCT FROM 'boolean' OR
     jsonb_typeof(p_packet->'lead_off_negative') IS DISTINCT FROM 'boolean' OR
     NULLIF(p_packet->>'captured_at', '') IS NULL THEN
    RETURN jsonb_build_object('error', 'invalid_packet', 'status', 400);
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(p_packet->'samples') AS sample(value)
    WHERE CASE WHEN value ~ '^[0-9]{1,4}$'
      THEN value::integer NOT BETWEEN 0 AND 4095
      ELSE true
    END
  ) THEN
    RETURN jsonb_build_object('error', 'invalid_samples', 'status', 400);
  END IF;

  BEGIN
    v_captured_at := (p_packet->>'captured_at')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('error', 'invalid_timestamp', 'status', 400);
  END;
  IF abs(extract(epoch FROM (clock_timestamp() - v_captured_at))) > 30 THEN
    RETURN jsonb_build_object('error', 'timestamp_outside_window', 'status', 400);
  END IF;

  SELECT c.secret_hash INTO v_secret_hash
  FROM public.device_credentials c
  WHERE c.device_id = p_device_id AND c.status = 'active'
  ORDER BY c.id DESC
  LIMIT 1;
  IF NOT FOUND OR NOT public.verify_device_secret(p_device_secret, v_secret_hash) THEN
    RETURN jsonb_build_object('error', 'invalid_device_credentials', 'status', 401);
  END IF;

  SELECT d.id, d.hospital_id, d.assigned_patient_id, d.status
  INTO v_device
  FROM public.devices d WHERE d.id = p_device_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'device_not_found', 'status', 404);
  END IF;
  IF v_device.status IN ('inactive', 'maintenance') THEN
    RETURN jsonb_build_object('error', 'device_not_active', 'status', 403);
  END IF;
  IF v_device.assigned_patient_id IS NULL THEN
    RETURN jsonb_build_object('error', 'device_unassigned', 'status', 409);
  END IF;
  SELECT p.hospital_id INTO v_patient_hospital_id
  FROM public.patients p WHERE p.id = v_device.assigned_patient_id;
  IF NOT FOUND OR v_patient_hospital_id IS DISTINCT FROM v_device.hospital_id THEN
    RETURN jsonb_build_object('error', 'device_patient_hospital_mismatch', 'status', 403);
  END IF;

  PERFORM realtime.send(
    p_packet,
    'ecg_packet',
    'device-ecg:' || p_device_id::text,
    true
  );
  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.broadcast_device_ecg_packet(bigint, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_device_ecg_packet(bigint, text, jsonb)
  TO service_role;

NOTIFY pgrst, 'reload schema';
