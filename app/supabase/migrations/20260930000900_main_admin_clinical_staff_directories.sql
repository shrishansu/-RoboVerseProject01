-- Read-only main-administrator directories for doctor and nurse staff profiles.

CREATE OR REPLACE FUNCTION public.get_main_admin_staff_directory(p_role text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_is_main_admin boolean;
    v_result jsonb;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.id = auth.uid() AND up.role = 'main_admin' AND up.status = 'active'
    ) INTO v_is_main_admin;
    IF NOT v_is_main_admin THEN RAISE EXCEPTION 'An active main administrator profile is required.'; END IF;
    IF p_role IS NULL OR p_role NOT IN ('doctor', 'nurse') THEN
        RAISE EXCEPTION 'Choose a doctor or nurse directory.';
    END IF;

    IF p_role = 'doctor' THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'staff_id', d.id,
            'staff_code', d.doctor_code,
            'user_id', up.id,
            'name', up.full_name,
            'email', up.email,
            'account_status', up.status,
            'staff_status', d.status,
            'hospital_name', h.name,
            'hospital_code', h.hospital_code,
            'department_name', dep.name,
            'specialization', d.specialization,
            'qualification', d.qualification,
            'license_number', d.license_number,
            'phone', d.phone,
            'experience_years', d.experience_years,
            'created_at', d.created_at
        ) ORDER BY h.name, up.full_name), '[]'::jsonb)
        INTO v_result
        FROM public.doctors d
        JOIN public.user_profiles up ON up.id = d.user_id AND up.role = 'doctor'
        JOIN public.hospitals h ON h.id = d.hospital_id
        LEFT JOIN public.departments dep ON dep.id = d.department_id
        WHERE up.status <> 'deleted';
    ELSE
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'staff_id', n.id,
            'staff_code', n.nurse_code,
            'user_id', up.id,
            'name', up.full_name,
            'email', up.email,
            'account_status', up.status,
            'staff_status', n.status,
            'hospital_name', h.name,
            'hospital_code', h.hospital_code,
            'department_name', dep.name,
            'specialization', n.specialization,
            'qualification', n.qualification,
            'license_number', n.license_number,
            'phone', n.phone,
            'experience_years', n.experience_years,
            'created_at', n.created_at
        ) ORDER BY h.name, up.full_name), '[]'::jsonb)
        INTO v_result
        FROM public.nurses n
        JOIN public.user_profiles up ON up.id = n.user_id AND up.role = 'nurse'
        JOIN public.hospitals h ON h.id = n.hospital_id
        LEFT JOIN public.departments dep ON dep.id = n.department_id
        WHERE up.status <> 'deleted';
    END IF;
    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_main_admin_staff_directory(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_main_admin_staff_directory(text) TO authenticated;
