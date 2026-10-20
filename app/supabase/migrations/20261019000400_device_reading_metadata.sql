-- Extend the existing vital_readings row only with values the device actually
-- transmits. These columns are nullable so old readings remain honest.
ALTER TABLE public.vital_readings
  ADD COLUMN IF NOT EXISTS red_raw bigint,
  ADD COLUMN IF NOT EXISTS ir_raw bigint,
  ADD COLUMN IF NOT EXISTS signal_quality numeric,
  ADD COLUMN IF NOT EXISTS signal_valid boolean,
  ADD COLUMN IF NOT EXISTS configuration_version integer,
  ADD COLUMN IF NOT EXISTS ingestion_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS vital_readings_device_ingestion_id_uidx
  ON public.vital_readings(device_id, ingestion_id) WHERE ingestion_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.get_device_health_data(bigint);
CREATE FUNCTION public.get_device_health_data(
  p_device_id bigint, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_role text; v_hospital_id bigint; v_device record; v_result jsonb;
BEGIN
  SELECT up.role, up.hospital_id INTO v_role, v_hospital_id FROM public.user_profiles up
  WHERE up.id=auth.uid() AND up.status='active' AND up.role IN ('main_admin','hospital_admin');
  IF v_role IS NULL THEN RAISE EXCEPTION 'An active administrator profile is required.'; END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN RAISE EXCEPTION 'Invalid time range.'; END IF;
  SELECT d.id,d.device_code,d.device_name,d.device_type,d.hospital_id,d.status,d.last_seen_at,d.assigned_patient_id,
    concat_ws(' ',p.first_name,p.middle_name,p.last_name) AS patient_name,p.patient_number,dc.status AS credential_status
  INTO v_device FROM public.devices d
  LEFT JOIN public.patients p ON p.id=d.assigned_patient_id AND p.hospital_id=d.hospital_id
  LEFT JOIN public.device_credentials dc ON dc.device_id=d.id
  WHERE d.id=p_device_id AND (v_role='main_admin' OR d.hospital_id=v_hospital_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Device was not found in your permitted scope.'; END IF;
  SELECT jsonb_build_object('device',jsonb_build_object(
    'id',v_device.id,'device_code',v_device.device_code,'device_name',v_device.device_name,'device_type',v_device.device_type,
    'credential_status',v_device.credential_status,'status',CASE WHEN v_device.status IN ('maintenance','inactive') THEN v_device.status
      WHEN v_device.last_seen_at IS NULL THEN 'unknown' WHEN v_device.last_seen_at >= now()-interval '90 seconds' THEN 'online' ELSE 'offline' END,
    'last_seen_at',v_device.last_seen_at,'has_patient_assignment',v_device.assigned_patient_id IS NOT NULL,
    'assigned_patient_label',CASE WHEN v_device.assigned_patient_id IS NULL THEN NULL WHEN v_role='hospital_admin'
      THEN concat_ws(' · ',v_device.patient_name,v_device.patient_number) ELSE 'Assigned patient (identity hidden)' END),
    'readings',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',r.id,'device_id',r.device_id,'recorded_at',r.recorded_at,'source',r.source,'heart_rate',r.heart_rate,'spo2',r.spo2,
      'temperature',r.temperature,'respiratory_rate',r.respiratory_rate,'systolic_bp',r.systolic_bp,'diastolic_bp',r.diastolic_bp,
      'ecg_value',r.ecg_value,'motion_x',r.motion_x,'motion_y',r.motion_y,'motion_z',r.motion_z,'blood_glucose',r.blood_glucose,
      'weight_kg',r.weight_kg,'red_raw',r.red_raw,'ir_raw',r.ir_raw,'signal_quality',r.signal_quality,
      'signal_valid',r.signal_valid,'configuration_version',r.configuration_version)
      ORDER BY r.recorded_at DESC,r.id DESC) FROM (
        SELECT vr.* FROM public.vital_readings vr WHERE vr.device_id=v_device.id AND vr.patient_id=v_device.assigned_patient_id
          AND (p_from IS NULL OR vr.recorded_at>=p_from) AND (p_to IS NULL OR vr.recorded_at<=p_to)
        ORDER BY vr.recorded_at DESC,vr.id DESC LIMIT 3000) r),'[]'::jsonb)) INTO v_result;
  RETURN v_result;
END; $function$;
REVOKE ALL ON FUNCTION public.get_device_health_data(bigint,timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_device_health_data(bigint,timestamptz,timestamptz) TO authenticated;
NOTIFY pgrst,'reload schema';
