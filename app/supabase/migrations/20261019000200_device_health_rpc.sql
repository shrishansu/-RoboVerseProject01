-- Device health data is accessed through this scoped RPC; browser clients retain
-- their normal RLS policies and receive no service-role access.
CREATE OR REPLACE FUNCTION public.get_device_health_data(p_device_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role text;
    v_hospital_id bigint;
    v_device record;
    v_result jsonb;
BEGIN
    SELECT up.role, up.hospital_id INTO v_role, v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.status = 'active'
      AND up.role IN ('main_admin', 'hospital_admin');

    IF v_role IS NULL THEN
        RAISE EXCEPTION 'An active administrator profile is required.';
    END IF;

    SELECT d.id, d.device_code, d.device_name, d.device_type, d.hospital_id,
           d.status, d.last_seen_at, d.assigned_patient_id,
           concat_ws(' ', p.first_name, p.middle_name, p.last_name) AS patient_name,
           p.patient_number, dc.status AS credential_status
    INTO v_device
    FROM public.devices d
    LEFT JOIN public.patients p
      ON p.id = d.assigned_patient_id
     AND p.hospital_id = d.hospital_id
    LEFT JOIN public.device_credentials dc ON dc.device_id = d.id
    WHERE d.id = p_device_id
      AND (v_role = 'main_admin' OR d.hospital_id = v_hospital_id);

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Device was not found in your permitted scope.';
    END IF;

    SELECT jsonb_build_object(
        'device', jsonb_build_object(
            'id', v_device.id,
            'device_code', v_device.device_code,
            'device_name', v_device.device_name,
            'device_type', v_device.device_type,
            'credential_status', v_device.credential_status,
            'status', CASE
                WHEN v_device.status IN ('maintenance', 'inactive') THEN v_device.status
                WHEN v_device.last_seen_at IS NULL THEN 'unknown'
                WHEN v_device.last_seen_at >= now() - interval '90 seconds' THEN 'online'
                ELSE 'offline'
            END,
            'last_seen_at', v_device.last_seen_at,
            'has_patient_assignment', v_device.assigned_patient_id IS NOT NULL,
            'assigned_patient_label', CASE
                WHEN v_device.assigned_patient_id IS NULL THEN NULL
                WHEN v_role = 'hospital_admin' THEN concat_ws(' · ', v_device.patient_name, v_device.patient_number)
                ELSE 'Assigned patient (identity hidden)'
            END
        ),
        'readings', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', rows.id,
                'device_id', rows.device_id,
                'recorded_at', rows.recorded_at,
                'source', rows.source,
                'heart_rate', rows.heart_rate,
                'spo2', rows.spo2,
                'temperature', rows.temperature,
                'respiratory_rate', rows.respiratory_rate,
                'systolic_bp', rows.systolic_bp,
                'diastolic_bp', rows.diastolic_bp,
                'ecg_value', rows.ecg_value,
                'motion_x', rows.motion_x,
                'motion_y', rows.motion_y,
                'motion_z', rows.motion_z,
                'blood_glucose', rows.blood_glucose,
                'weight_kg', rows.weight_kg
            ) ORDER BY rows.recorded_at DESC, rows.id DESC)
            FROM (
                SELECT vr.*
                FROM public.vital_readings vr
                WHERE vr.device_id = v_device.id
                  AND vr.patient_id = v_device.assigned_patient_id
                ORDER BY vr.recorded_at DESC, vr.id DESC
                LIMIT 100
            ) rows
        ), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_device_health_data(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_device_health_data(bigint) TO authenticated;

-- Make the new RPC visible promptly when this migration is run in SQL Editor.
NOTIFY pgrst, 'reload schema';
