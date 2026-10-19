-- Report devices as offline when no valid reading has arrived within three polling intervals.

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
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'An active administrator profile is required.';
    END IF;

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
                'has_patient_assignment', rows.assigned_patient_id IS NOT NULL
            ) ORDER BY rows.device_name)
            FROM (
                SELECT d.id, d.device_code, d.device_name, d.device_type,
                    d.hospital_id, h.name AS hospital_name, d.model,
                    d.serial_number, d.firmware_version, d.status,
                    d.last_seen_at, d.assigned_patient_id,
                    dc.status AS credential_status
                FROM public.devices d
                LEFT JOIN public.hospitals h ON h.id = d.hospital_id
                LEFT JOIN public.device_credentials dc ON dc.device_id = d.id
                WHERE v_role = 'main_admin' OR d.hospital_id = v_hospital_id
                ORDER BY d.device_name, d.id
                LIMIT 300
            ) rows
        ), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_device_management_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_device_management_data() TO authenticated;
