-- Return actual device telemetry to clinicians only for their currently
-- assigned patients. This preserves the existing staff, hospital and patient
-- assignment checks in get_my_assigned_device_health().
CREATE OR REPLACE FUNCTION public.get_my_assigned_device_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role text;
    v_hospital_id bigint;
    v_staff_exists boolean;
    v_result jsonb;
BEGIN
    SELECT up.role, up.hospital_id INTO v_role, v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.status = 'active'
      AND up.role IN ('doctor', 'nurse');
    IF v_role IS NULL OR v_hospital_id IS NULL THEN
        RAISE EXCEPTION 'An active doctor or nurse profile is required.';
    END IF;

    IF v_role = 'doctor' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.doctors d
            WHERE d.user_id = auth.uid() AND d.hospital_id = v_hospital_id AND d.status = 'active'
        ) INTO v_staff_exists;
    ELSE
        SELECT EXISTS (
            SELECT 1 FROM public.nurses n
            WHERE n.user_id = auth.uid() AND n.hospital_id = v_hospital_id AND n.status = 'active'
        ) INTO v_staff_exists;
    END IF;
    IF NOT v_staff_exists THEN RETURN '[]'::jsonb; END IF;

    WITH my_patients AS (
        SELECT DISTINCT pa.patient_id
        FROM public.patient_assignments pa
        JOIN public.patients p ON p.id = pa.patient_id
        WHERE pa.status = 'active'
          AND pa.start_date <= now()
          AND (pa.end_date IS NULL OR pa.end_date >= now())
          AND p.hospital_id = v_hospital_id
          AND ((v_role = 'doctor' AND EXISTS (
                    SELECT 1 FROM public.doctors d WHERE d.id = pa.doctor_id
                      AND d.user_id = auth.uid() AND d.hospital_id = v_hospital_id AND d.status = 'active'))
            OR (v_role = 'nurse' AND EXISTS (
                    SELECT 1 FROM public.nurses n WHERE n.id = pa.nurse_id
                      AND n.user_id = auth.uid() AND n.hospital_id = v_hospital_id AND n.status = 'active')))
    ), device_rows AS (
        SELECT p.id AS patient_id, d.id AS device_id, d.device_code, d.device_name,
               d.status, d.last_seen_at,
               CASE WHEN d.status IN ('maintenance', 'inactive') THEN d.status
                    WHEN d.last_seen_at IS NULL THEN 'unknown'
                    WHEN d.last_seen_at >= now() - interval '90 seconds' THEN 'online'
                    ELSE 'offline' END AS health_status,
               latest.reading
        FROM my_patients mp
        JOIN public.patients p ON p.id = mp.patient_id
        JOIN public.devices d ON d.assigned_patient_id = p.id AND d.hospital_id = v_hospital_id
        LEFT JOIN LATERAL (
            SELECT jsonb_build_object(
                'id', vr.id, 'device_id', vr.device_id, 'recorded_at', vr.recorded_at,
                'source', vr.source, 'heart_rate', vr.heart_rate, 'spo2', vr.spo2,
                'temperature', vr.temperature, 'respiratory_rate', vr.respiratory_rate,
                'systolic_bp', vr.systolic_bp, 'diastolic_bp', vr.diastolic_bp,
                'ecg_value', vr.ecg_value, 'red_raw', vr.red_raw, 'ir_raw', vr.ir_raw,
                'signal_quality', vr.signal_quality, 'signal_valid', vr.signal_valid,
                'pulse_rate_estimate_bpm', vr.pulse_rate_estimate_bpm,
                'distance_mm', vr.distance_mm,
                'motion_x', vr.motion_x, 'motion_y', vr.motion_y, 'motion_z', vr.motion_z,
                'ecg_lead_off_positive', vr.ecg_lead_off_positive,
                'ecg_lead_off_negative', vr.ecg_lead_off_negative,
                'sensor_status', vr.sensor_status, 'sensor_errors', vr.sensor_errors
            ) AS reading
            FROM public.vital_readings vr
            WHERE vr.patient_id = p.id AND vr.device_id = d.id
            ORDER BY vr.recorded_at DESC, vr.id DESC
            LIMIT 1
        ) latest ON true
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'patient_id', dr.patient_id,
        'device_id', dr.device_id,
        'device_code', dr.device_code,
        'device_name', dr.device_name,
        'status', dr.health_status,
        'last_seen_at', dr.last_seen_at,
        'latest_reading', dr.reading
    ) ORDER BY dr.patient_id, dr.device_id), '[]'::jsonb)
    INTO v_result FROM device_rows dr;
    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_assigned_device_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_assigned_device_health() TO authenticated;
NOTIFY pgrst, 'reload schema';
