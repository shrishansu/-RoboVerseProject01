-- Preserve full, unfiltered ECG ADC samples as one-second device batches.
-- Access is server-only for writes and through an administrator-scoped RPC for reads.
CREATE TABLE IF NOT EXISTS public.device_ecg_batches (
  batch_id uuid NOT NULL,
  device_id bigint NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  patient_id bigint NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  batch_started_at timestamptz NOT NULL,
  sample_rate_hz integer NOT NULL CHECK (sample_rate_hz = 250),
  samples smallint[] NOT NULL,
  lead_off_positive boolean NOT NULL,
  lead_off_negative boolean NOT NULL,
  signal_saturated boolean NOT NULL DEFAULT false,
  PRIMARY KEY (device_id, batch_id),
  CHECK (cardinality(samples) BETWEEN 200 AND 300)
);

CREATE INDEX IF NOT EXISTS device_ecg_batches_patient_time_idx
  ON public.device_ecg_batches (device_id, patient_id, recorded_at DESC);

ALTER TABLE public.device_ecg_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.device_ecg_batches FROM PUBLIC, anon, authenticated;
GRANT INSERT ON TABLE public.device_ecg_batches TO service_role;

CREATE OR REPLACE FUNCTION public.get_device_ecg_batches(
  p_device_id bigint,
  p_seconds integer DEFAULT 10,
  p_since timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_role text;
  v_hospital_id bigint;
  v_patient_id bigint;
  v_result jsonb;
BEGIN
  SELECT up.role, up.hospital_id INTO v_role, v_hospital_id
  FROM public.user_profiles up
  WHERE up.id = auth.uid() AND up.status = 'active'
    AND up.role IN ('main_admin', 'hospital_admin');
  IF v_role IS NULL THEN RAISE EXCEPTION 'An active administrator profile is required.'; END IF;

  SELECT d.assigned_patient_id INTO v_patient_id
  FROM public.devices d
  WHERE d.id = p_device_id
    AND (v_role = 'main_admin' OR d.hospital_id = v_hospital_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Device was not found in your permitted scope.'; END IF;

  SELECT jsonb_build_object('batches', COALESCE(jsonb_agg(batch_json ORDER BY recorded_at, batch_id), '[]'::jsonb))
  INTO v_result
  FROM (
    SELECT b.recorded_at, b.batch_id,
      jsonb_build_object(
        'batch_id', b.batch_id,
        'device_id', b.device_id,
        'recorded_at', b.recorded_at,
        'batch_started_at', b.batch_started_at,
        'sample_rate_hz', b.sample_rate_hz,
        'samples', b.samples,
        'lead_off_positive', b.lead_off_positive,
        'lead_off_negative', b.lead_off_negative,
        'signal_saturated', b.signal_saturated
      ) AS batch_json
    FROM public.device_ecg_batches b
    WHERE b.device_id = p_device_id
      AND b.patient_id = v_patient_id
      AND (p_since IS NULL AND b.recorded_at >= now() - make_interval(secs => greatest(1, least(COALESCE(p_seconds, 10), 30)))
        OR p_since IS NOT NULL AND b.recorded_at > p_since)
    ORDER BY b.recorded_at DESC, b.batch_id DESC
    LIMIT 60
  ) batches;
  RETURN COALESCE(v_result, jsonb_build_object('batches', '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.get_device_ecg_batches(bigint, integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_device_ecg_batches(bigint, integer, timestamptz) TO authenticated;
NOTIFY pgrst, 'reload schema';
