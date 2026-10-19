CREATE OR REPLACE FUNCTION public.list_managed_device_assignment_patients(p_device_id bigint)
RETURNS TABLE (
    patient_number text,
    patient_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role text;
    v_user_hospital_id bigint;
    v_device_hospital_id bigint;
    v_device_status text;
    v_assigned_patient_id bigint;
BEGIN
    SELECT up.role, up.hospital_id
    INTO v_role, v_user_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.status = 'active'
      AND up.role IN ('main_admin', 'hospital_admin');

    IF v_role IS NULL THEN
        RAISE EXCEPTION 'An active administrator profile is required.';
    END IF;

    SELECT d.hospital_id, d.status, d.assigned_patient_id
    INTO v_device_hospital_id, v_device_status, v_assigned_patient_id
    FROM public.devices d
    WHERE d.id = p_device_id
      AND (v_role = 'main_admin' OR (v_user_hospital_id IS NOT NULL AND d.hospital_id = v_user_hospital_id));

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Device was not found in your permitted scope.';
    END IF;
    IF v_assigned_patient_id IS NOT NULL THEN
        RAISE EXCEPTION 'Unassign the current patient before selecting another.';
    END IF;
    IF v_device_status NOT IN ('online', 'offline') THEN
        RAISE EXCEPTION 'Only online or offline devices can be assigned.';
    END IF;

    RETURN QUERY
    SELECT p.patient_number, p.status
    FROM public.patients p
    WHERE p.hospital_id = v_device_hospital_id
      AND p.status IN ('active', 'admitted')
    ORDER BY p.patient_number;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_managed_device_assignment_patients(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_managed_device_assignment_patients(bigint) TO authenticated;