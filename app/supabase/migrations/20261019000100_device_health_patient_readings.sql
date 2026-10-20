-- Keep the existing device registry RPC as the source of truth while returning
-- every registered device to the health selector (the prior definition capped it at 300).
CREATE OR REPLACE FUNCTION public.get_device_management_data()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role text;
    v_hospital_id bigint;
    v_result jsonb;
BEGIN
    SELECT up.role, up.hospital_id INTO v_role, v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.status = 'active'
      AND up.role IN ('main_admin', 'hospital_admin');
    IF v_role IS NULL THEN RAISE EXCEPTION 'An active administrator profile is required.'; END IF;

    SELECT jsonb_build_object(
        'hospitals', CASE WHEN v_role = 'main_admin' THEN COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', h.id, 'name', h.name, 'hospital_code', h.hospital_code) ORDER BY h.name)
            FROM public.hospitals h WHERE h.status = 'active'
        ), '[]'::jsonb) ELSE '[]'::jsonb END,
        'devices', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', rows.id,
                'device_code', rows.device_code,
                'device_name', rows.device_name,
                'device_type', rows.device_type,
                'hospital_id', rows.hospital_id,
                'hospital_name', rows.hospital_name,
                'model', rows.model,
                'serial_number', rows.serial_number,
                'firmware_version', rows.firmware_version,
                'status', CASE
                    WHEN rows.status = 'online'
                     AND (rows.last_seen_at IS NULL OR rows.last_seen_at < now() - interval '90 seconds')
                    THEN 'offline'
                    ELSE rows.status
                END,
                'last_seen_at', rows.last_seen_at,
                'credential_status', rows.credential_status,
                'has_patient_assignment', rows.assigned_patient_id IS NOT NULL,
                'assigned_patient_name', CASE WHEN v_role = 'hospital_admin' THEN rows.assigned_patient_name ELSE NULL END
            ) ORDER BY rows.device_name, rows.id)
            FROM (
                SELECT d.id, d.device_code, d.device_name, d.device_type,
                    d.hospital_id, h.name AS hospital_name, d.model,
                    d.serial_number, d.firmware_version, d.status,
                    d.last_seen_at, d.assigned_patient_id,
                    dc.status AS credential_status,
                    concat_ws(' ', p.first_name, p.middle_name, p.last_name) AS assigned_patient_name
                FROM public.devices d
                LEFT JOIN public.hospitals h ON h.id = d.hospital_id
                LEFT JOIN public.device_credentials dc ON dc.device_id = d.id
                LEFT JOIN public.patients p
                  ON p.id = d.assigned_patient_id AND p.hospital_id = d.hospital_id
                WHERE v_role = 'main_admin' OR d.hospital_id = v_hospital_id
            ) rows
        ), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_device_management_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_device_management_data() TO authenticated;

-- Return only devices and their readings for patients assigned to the signed-in clinician.
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
        SELECT EXISTS (SELECT 1 FROM public.doctors d
            WHERE d.user_id = auth.uid() AND d.hospital_id = v_hospital_id AND d.status = 'active')
        INTO v_staff_exists;
    ELSE
        SELECT EXISTS (SELECT 1 FROM public.nurses n
            WHERE n.user_id = auth.uid() AND n.hospital_id = v_hospital_id AND n.status = 'active')
        INTO v_staff_exists;
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
                'ecg_value', vr.ecg_value
            ) AS reading
            FROM public.vital_readings vr
            WHERE vr.patient_id = p.id AND vr.device_id = d.id
            ORDER BY vr.recorded_at DESC, vr.id DESC LIMIT 1
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

-- Include the registered numeric device IDs in the existing receptionist patient registry.
CREATE OR REPLACE FUNCTION public.search_receptionist_patients(
    p_search text DEFAULT '',
    p_limit integer DEFAULT 50
)
RETURNS TABLE (
    patient_id bigint,
    patient_number text,
    first_name text,
    middle_name text,
    last_name text,
    date_of_birth date,
    phone text,
    patient_status text,
    bed_number text,
    ward_name text,
    admission_status text,
    device_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_hospital_id bigint;
    v_search text := btrim(COALESCE(p_search, ''));
BEGIN
    SELECT up.hospital_id INTO v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'receptionist' AND up.status = 'active';
    IF v_hospital_id IS NULL THEN
        RAISE EXCEPTION 'An active receptionist profile with a hospital is required.';
    END IF;

    RETURN QUERY
    SELECT p.id, p.patient_number, p.first_name, p.middle_name, p.last_name,
           p.date_of_birth, p.phone, p.status,
           COALESCE(b.bed_number, ''), COALESCE(w.name, ''),
           COALESCE(current_admission.status, 'not_admitted'),
           COALESCE(assigned_devices.device_name, '')
    FROM public.patients p
    LEFT JOIN LATERAL (
        SELECT ad.status, ad.bed_id, ad.ward_id
        FROM public.admissions ad
        WHERE ad.patient_id = p.id AND ad.hospital_id = v_hospital_id AND ad.status = 'admitted'
        ORDER BY ad.admission_date DESC, ad.id DESC LIMIT 1
    ) current_admission ON true
    LEFT JOIN public.beds b ON b.id = current_admission.bed_id
    LEFT JOIN public.wards w ON w.id = COALESCE(current_admission.ward_id, b.ward_id)
    LEFT JOIN LATERAL (
        SELECT string_agg(
            d.device_name || ' (ID ' || d.id::text || ', ' || d.device_code || ')',
            ', ' ORDER BY d.device_name, d.device_code
        ) AS device_name
        FROM public.devices d
        WHERE d.assigned_patient_id = p.id AND d.hospital_id = v_hospital_id
    ) assigned_devices ON true
    WHERE p.hospital_id = v_hospital_id
      AND (v_search = '' OR p.patient_number ILIKE '%' || v_search || '%'
        OR p.phone ILIKE '%' || v_search || '%'
        OR concat_ws(' ', p.first_name, p.middle_name, p.last_name) ILIKE '%' || v_search || '%')
    ORDER BY p.last_name, p.first_name, p.id
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
END;
$function$;

REVOKE ALL ON FUNCTION public.search_receptionist_patients(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_receptionist_patients(text, integer) TO authenticated;
