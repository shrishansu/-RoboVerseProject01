-- Scoped device inventory and assignment. Device views omit patient identity and readings.

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
                'status', rows.status,
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


CREATE OR REPLACE FUNCTION public.create_managed_device(
    p_device_code text,
    p_device_name text,
    p_device_type text,
    p_hospital_id bigint,
    p_model text DEFAULT NULL,
    p_serial_number text DEFAULT NULL,
    p_mac_address text DEFAULT NULL,
    p_firmware_version text DEFAULT NULL,
    p_notes text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role text;
    v_user_hospital_id bigint;
    v_device_id bigint;
    v_code text := btrim(COALESCE(p_device_code, ''));
    v_name text := btrim(COALESCE(p_device_name, ''));
BEGIN
    SELECT up.role, up.hospital_id INTO v_role, v_user_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.status = 'active'
      AND up.role IN ('main_admin', 'hospital_admin');
    IF v_role IS NULL THEN RAISE EXCEPTION 'An active administrator profile is required.'; END IF;
    IF p_hospital_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.hospitals h WHERE h.id = p_hospital_id AND h.status = 'active'
    ) THEN RAISE EXCEPTION 'Choose an active hospital.'; END IF;
    IF v_role = 'hospital_admin'
       AND (v_user_hospital_id IS NULL OR p_hospital_id <> v_user_hospital_id) THEN
        RAISE EXCEPTION 'You can only manage devices at your hospital.';
    END IF;
    IF v_code = '' OR length(v_code) > 80 OR v_name = '' OR length(v_name) > 120
       OR p_device_type IS NULL OR p_device_type NOT IN ('patient_monitor', 'esp32', 'sensor_gateway', 'other')
       OR (p_serial_number IS NOT NULL AND length(btrim(p_serial_number)) > 120)
       OR (p_mac_address IS NOT NULL AND length(btrim(p_mac_address)) > 40)
       OR (p_model IS NOT NULL AND length(btrim(p_model)) > 120)
       OR (p_firmware_version IS NOT NULL AND length(btrim(p_firmware_version)) > 80)
       OR (p_notes IS NOT NULL AND length(btrim(p_notes)) > 1000) THEN
        RAISE EXCEPTION 'Enter valid device details.';
    END IF;

    INSERT INTO public.devices (
        device_code, device_name, device_type, hospital_id, status,
        model, serial_number, mac_address, firmware_version, notes
    ) VALUES (
        v_code, v_name, p_device_type, p_hospital_id, 'offline',
        NULLIF(btrim(COALESCE(p_model, '')), ''),
        NULLIF(btrim(COALESCE(p_serial_number, '')), ''),
        NULLIF(btrim(COALESCE(p_mac_address, '')), ''),
        NULLIF(btrim(COALESCE(p_firmware_version, '')), ''),
        NULLIF(btrim(COALESCE(p_notes, '')), '')
    ) RETURNING id INTO v_device_id;

    INSERT INTO public.audit_logs (user_id, hospital_id, action, table_name, record_id, description, metadata)
    VALUES (auth.uid(), p_hospital_id, 'device_created', 'devices', v_device_id,
        'Device registered.', jsonb_build_object('device_code', v_code, 'device_type', p_device_type));
    RETURN v_device_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_managed_device(text, text, text, bigint, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_managed_device(text, text, text, bigint, text, text, text, text, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.set_managed_device_status(p_device_id bigint, p_status text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role text;
    v_user_hospital_id bigint;
    v_device_hospital_id bigint;
BEGIN
    SELECT up.role, up.hospital_id INTO v_role, v_user_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.status = 'active'
      AND up.role IN ('main_admin', 'hospital_admin');
    IF v_role IS NULL THEN RAISE EXCEPTION 'An active administrator profile is required.'; END IF;
    IF p_status IS NULL OR p_status NOT IN ('offline', 'maintenance', 'inactive') THEN
        RAISE EXCEPTION 'Choose an allowed device status.';
    END IF;

    SELECT d.hospital_id INTO v_device_hospital_id
    FROM public.devices d
    WHERE d.id = p_device_id
      AND (v_role = 'main_admin' OR d.hospital_id = v_user_hospital_id)
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Device was not found in your permitted scope.'; END IF;

    UPDATE public.devices SET status = p_status, updated_at = now() WHERE id = p_device_id;
    INSERT INTO public.audit_logs (user_id, hospital_id, action, table_name, record_id, description, metadata)
    VALUES (auth.uid(), v_device_hospital_id, 'device_status_changed', 'devices', p_device_id,
        'Device status changed.', jsonb_build_object('status', p_status));
    RETURN TRUE;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_managed_device_status(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_managed_device_status(bigint, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.assign_device_by_patient_number(p_device_id bigint, p_patient_number text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role text;
    v_user_hospital_id bigint;
    v_device_hospital_id bigint;
    v_device_status text;
    v_current_patient_id bigint;
    v_patient_id bigint;
BEGIN
    SELECT up.role, up.hospital_id INTO v_role, v_user_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.status = 'active'
      AND up.role IN ('main_admin', 'hospital_admin');
    IF v_role IS NULL THEN RAISE EXCEPTION 'An active administrator profile is required.'; END IF;
    IF p_patient_number IS NULL OR btrim(p_patient_number) = '' THEN
        RAISE EXCEPTION 'Enter the patient''s number.';
    END IF;

    SELECT d.hospital_id, d.status, d.assigned_patient_id
    INTO v_device_hospital_id, v_device_status, v_current_patient_id
    FROM public.devices d
    WHERE d.id = p_device_id
      AND (v_role = 'main_admin' OR d.hospital_id = v_user_hospital_id)
    FOR UPDATE;
    IF NOT FOUND OR v_device_hospital_id IS NULL THEN
        RAISE EXCEPTION 'Device was not found or has no hospital assigned.';
    END IF;
    IF v_device_status IN ('maintenance', 'inactive') THEN
        RAISE EXCEPTION 'A device in maintenance or inactive status cannot be assigned.';
    END IF;
    IF v_current_patient_id IS NOT NULL THEN
        RAISE EXCEPTION 'Unassign the current patient before assigning a different patient.';
    END IF;

    SELECT p.id INTO v_patient_id
    FROM public.patients p
    WHERE p.hospital_id = v_device_hospital_id
      AND p.patient_number = btrim(p_patient_number)
      AND p.status IN ('active', 'admitted')
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'An active patient with that number was not found at this hospital.'; END IF;

    UPDATE public.devices
    SET assigned_patient_id = v_patient_id, updated_at = now()
    WHERE id = p_device_id;
    INSERT INTO public.audit_logs (user_id, hospital_id, action, table_name, record_id, description, metadata)
    VALUES (auth.uid(), v_device_hospital_id, 'device_patient_assigned', 'devices', p_device_id,
        'Device assignment changed.', jsonb_build_object('patient_id', v_patient_id));
    RETURN TRUE;
END;
$function$;

REVOKE ALL ON FUNCTION public.assign_device_by_patient_number(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_device_by_patient_number(bigint, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.unassign_managed_device(p_device_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role text;
    v_user_hospital_id bigint;
    v_device_hospital_id bigint;
BEGIN
    SELECT up.role, up.hospital_id INTO v_role, v_user_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.status = 'active'
      AND up.role IN ('main_admin', 'hospital_admin');
    IF v_role IS NULL THEN RAISE EXCEPTION 'An active administrator profile is required.'; END IF;

    SELECT d.hospital_id INTO v_device_hospital_id
    FROM public.devices d
    WHERE d.id = p_device_id
      AND d.assigned_patient_id IS NOT NULL
      AND (v_role = 'main_admin' OR d.hospital_id = v_user_hospital_id)
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Assigned device was not found in your permitted scope.'; END IF;

    UPDATE public.devices SET assigned_patient_id = NULL, updated_at = now() WHERE id = p_device_id;
    INSERT INTO public.audit_logs (user_id, hospital_id, action, table_name, record_id, description, metadata)
    VALUES (auth.uid(), v_device_hospital_id, 'device_patient_unassigned', 'devices', p_device_id,
        'Device assignment ended.', '{}'::jsonb);
    RETURN TRUE;
END;
$function$;

REVOKE ALL ON FUNCTION public.unassign_managed_device(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unassign_managed_device(bigint) TO authenticated;
