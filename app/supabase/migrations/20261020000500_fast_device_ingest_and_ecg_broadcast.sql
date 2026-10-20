-- Collapse authenticated device ingestion into one transactional database
-- round trip, then broadcast each committed ECG batch to authorized admins.

CREATE OR REPLACE FUNCTION public.ingest_device_vitals(
  p_device_id bigint,
  p_device_secret text,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_credential_id bigint;
  v_secret_hash text;
  v_device record;
  v_patient_id bigint;
  v_patient_hospital_id bigint;
  v_reading_id bigint;
  v_recorded_at timestamptz;
  v_ecg_samples smallint[];
BEGIN
  IF p_device_id IS NULL OR p_device_id <= 0 OR p_device_secret IS NULL OR length(p_device_secret) < 32 OR
     jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('error', 'invalid_request', 'status', 400);
  END IF;
  IF NULLIF(p_payload->>'device_id', '')::bigint IS DISTINCT FROM p_device_id THEN
    RETURN jsonb_build_object('error', 'device_id_mismatch', 'status', 403);
  END IF;

  SELECT c.id, c.secret_hash INTO v_credential_id, v_secret_hash
  FROM public.device_credentials c
  WHERE c.device_id = p_device_id AND c.status = 'active'
  ORDER BY c.id DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND OR NOT public.verify_device_secret(p_device_secret, v_secret_hash) THEN
    RETURN jsonb_build_object('error', 'invalid_device_credentials', 'status', 401);
  END IF;

  SELECT d.id, d.hospital_id, d.assigned_patient_id, d.status
  INTO v_device
  FROM public.devices d
  WHERE d.id = p_device_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'device_not_found', 'status', 404);
  END IF;
  IF v_device.status IN ('inactive', 'maintenance') THEN
    RETURN jsonb_build_object('error', 'device_not_active', 'status', 403);
  END IF;

  v_patient_id := v_device.assigned_patient_id;
  IF v_patient_id IS NULL OR v_patient_id <= 0 THEN
    RETURN jsonb_build_object('error', 'device_unassigned', 'status', 409);
  END IF;
  SELECT p.hospital_id INTO v_patient_hospital_id
  FROM public.patients p WHERE p.id = v_patient_id
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'patient_not_found', 'status', 404);
  END IF;
  IF v_patient_hospital_id IS DISTINCT FROM v_device.hospital_id THEN
    RETURN jsonb_build_object('error', 'device_patient_hospital_mismatch', 'status', 403);
  END IF;

  v_recorded_at := COALESCE(NULLIF(p_payload->>'recorded_at', '')::timestamptz, clock_timestamp());
  v_reading_id := public.record_vital_reading(
    v_patient_id, p_device_id, v_recorded_at,
    NULLIF(p_payload->>'heart_rate', '')::numeric,
    NULLIF(p_payload->>'spo2', '')::numeric,
    NULLIF(p_payload->>'temperature', '')::numeric,
    NULLIF(p_payload->>'respiratory_rate', '')::numeric,
    NULLIF(p_payload->>'systolic_bp', '')::numeric,
    NULLIF(p_payload->>'diastolic_bp', '')::numeric,
    NULLIF(p_payload->>'blood_glucose', '')::numeric,
    NULLIF(p_payload->>'weight_kg', '')::numeric,
    NULLIF(p_payload->>'ecg_value', '')::numeric,
    NULLIF(p_payload->>'motion_x', '')::numeric,
    NULLIF(p_payload->>'motion_y', '')::numeric,
    NULLIF(p_payload->>'motion_z', '')::numeric,
    'iot'
  );

  IF p_payload ?| ARRAY[
    'red_raw', 'ir_raw', 'signal_quality', 'signal_valid', 'configuration_version', 'ingestion_id',
    'object_temperature_c', 'pulse_rate_estimate_bpm', 'distance_mm',
    'ecg_lead_off_positive', 'ecg_lead_off_negative', 'sensor_status', 'sensor_errors'
  ] THEN
    UPDATE public.vital_readings SET
      red_raw = NULLIF(p_payload->>'red_raw', '')::bigint,
      ir_raw = NULLIF(p_payload->>'ir_raw', '')::bigint,
      signal_quality = NULLIF(p_payload->>'signal_quality', '')::numeric,
      signal_valid = NULLIF(p_payload->>'signal_valid', '')::boolean,
      configuration_version = NULLIF(p_payload->>'configuration_version', '')::integer,
      ingestion_id = NULLIF(p_payload->>'ingestion_id', '')::uuid,
      object_temperature_c = CASE WHEN p_payload ? 'object_temperature_c' THEN NULLIF(p_payload->>'object_temperature_c', '')::numeric ELSE object_temperature_c END,
      pulse_rate_estimate_bpm = CASE WHEN p_payload ? 'pulse_rate_estimate_bpm' THEN NULLIF(p_payload->>'pulse_rate_estimate_bpm', '')::numeric ELSE pulse_rate_estimate_bpm END,
      distance_mm = CASE WHEN p_payload ? 'distance_mm' THEN NULLIF(p_payload->>'distance_mm', '')::integer ELSE distance_mm END,
      ecg_lead_off_positive = CASE WHEN p_payload ? 'ecg_lead_off_positive' THEN NULLIF(p_payload->>'ecg_lead_off_positive', '')::boolean ELSE ecg_lead_off_positive END,
      ecg_lead_off_negative = CASE WHEN p_payload ? 'ecg_lead_off_negative' THEN NULLIF(p_payload->>'ecg_lead_off_negative', '')::boolean ELSE ecg_lead_off_negative END,
      sensor_status = CASE WHEN p_payload ? 'sensor_status' THEN p_payload->'sensor_status' ELSE sensor_status END,
      sensor_errors = CASE WHEN p_payload ? 'sensor_errors' THEN p_payload->'sensor_errors' ELSE sensor_errors END
    WHERE id = v_reading_id AND device_id = p_device_id AND patient_id = v_patient_id;
  END IF;

  IF p_payload ?| ARRAY['ecg_samples', 'ecg_batch_id', 'ecg_sample_rate_hz', 'ecg_batch_started_at'] THEN
    IF jsonb_typeof(p_payload->'ecg_samples') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid ECG batch';
    END IF;
    IF jsonb_array_length(p_payload->'ecg_samples') NOT BETWEEN 200 AND 300 OR
       (p_payload->>'ecg_sample_rate_hz')::integer <> 250 OR
       p_payload->>'ecg_batch_id' IS NULL OR
       p_payload->>'ecg_lead_off_positive' IS NULL OR p_payload->>'ecg_lead_off_negative' IS NULL THEN
      RAISE EXCEPTION 'Invalid ECG batch';
    END IF;
    SELECT array_agg(sample_value::smallint ORDER BY sample_order)
    INTO v_ecg_samples
    FROM jsonb_array_elements_text(p_payload->'ecg_samples') WITH ORDINALITY AS sample(sample_value, sample_order);

    INSERT INTO public.device_ecg_batches (
      batch_id, device_id, patient_id, batch_started_at, sample_rate_hz, samples,
      lead_off_positive, lead_off_negative, signal_saturated
    ) VALUES (
      (p_payload->>'ecg_batch_id')::uuid,
      p_device_id,
      v_patient_id,
      COALESCE(NULLIF(p_payload->>'ecg_batch_started_at', '')::timestamptz, v_recorded_at - interval '1 second'),
      250,
      v_ecg_samples,
      (p_payload->>'ecg_lead_off_positive')::boolean,
      (p_payload->>'ecg_lead_off_negative')::boolean,
      0 = ANY(v_ecg_samples) OR 4095 = ANY(v_ecg_samples)
    ) ON CONFLICT (device_id, batch_id) DO NOTHING;
  END IF;

  UPDATE public.devices SET last_seen_at = clock_timestamp(), status = 'online'
  WHERE id = p_device_id AND status IN ('offline', 'online');
  UPDATE public.device_credentials SET last_used_at = clock_timestamp()
  WHERE id = v_credential_id;

  RETURN jsonb_build_object(
    'success', true,
    'reading_id', v_reading_id,
    'device_id', p_device_id,
    'patient_id', v_patient_id,
    'recorded_at', v_recorded_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ingest_device_vitals(bigint, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_device_vitals(bigint, text, jsonb) TO service_role;

-- Private per-device Broadcast channel. Authorization is checked against the
-- same active administrator and hospital scope used by the ECG read RPC.
CREATE OR REPLACE FUNCTION public.can_receive_device_ecg_broadcast(p_topic text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    JOIN public.devices d ON d.id = CASE
      WHEN p_topic ~ '^device-ecg:[0-9]+$' THEN substring(p_topic FROM '^device-ecg:([0-9]+)$')::bigint
      ELSE NULL
    END
    WHERE up.id = auth.uid()
      AND up.status = 'active'
      AND up.role IN ('main_admin', 'hospital_admin')
      AND d.assigned_patient_id IS NOT NULL
      AND (up.role = 'main_admin' OR d.hospital_id = up.hospital_id)
  );
$function$;

REVOKE ALL ON FUNCTION public.can_receive_device_ecg_broadcast(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_receive_device_ecg_broadcast(text) TO authenticated;

DROP POLICY IF EXISTS device_ecg_batches_admin_broadcast_read ON realtime.messages;
CREATE POLICY device_ecg_batches_admin_broadcast_read
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    extension = 'broadcast'
    AND public.can_receive_device_ecg_broadcast(realtime.topic())
  );

CREATE OR REPLACE FUNCTION public.broadcast_device_ecg_batch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  BEGIN
    PERFORM realtime.send(
      jsonb_build_object('batch', jsonb_build_object(
        'batch_id', NEW.batch_id,
        'device_id', NEW.device_id,
        'recorded_at', NEW.recorded_at,
        'batch_started_at', NEW.batch_started_at,
        'sample_rate_hz', NEW.sample_rate_hz,
        'samples', NEW.samples,
        'lead_off_positive', NEW.lead_off_positive,
        'lead_off_negative', NEW.lead_off_negative,
        'signal_saturated', NEW.signal_saturated
      )),
      'ecg_batch',
      'device-ecg:' || NEW.device_id::text,
      true
    );
  EXCEPTION WHEN OTHERS THEN
    -- A Realtime outage must not roll back a valid sensor reading.
    RAISE WARNING 'ECG batch broadcast failed for device %', NEW.device_id;
  END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS device_ecg_batch_broadcast ON public.device_ecg_batches;
CREATE TRIGGER device_ecg_batch_broadcast
  AFTER INSERT ON public.device_ecg_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_device_ecg_batch();

REVOKE ALL ON FUNCTION public.broadcast_device_ecg_batch() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
