-- Hospital-scoped clinical staff directory and professional profile maintenance.

CREATE OR REPLACE FUNCTION public.get_hospital_admin_staff_directory()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_hospital_id bigint;
    v_result jsonb;
BEGIN
    SELECT up.hospital_id INTO v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'hospital_admin' AND up.status = 'active';
    IF v_hospital_id IS NULL THEN RAISE EXCEPTION 'An active hospital administrator profile is required.'; END IF;

    SELECT jsonb_build_object(
        'doctors', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'staff_id', d.id, 'staff_code', d.doctor_code, 'user_id', up.id,
                'name', up.full_name, 'email', up.email, 'account_status', up.status,
                'staff_status', d.status, 'department_id', d.department_id,
                'department_name', dep.name, 'specialization', d.specialization,
                'qualification', d.qualification, 'license_number', d.license_number,
                'phone', d.phone, 'experience_years', d.experience_years
            ) ORDER BY up.full_name)
            FROM public.doctors d
            JOIN public.user_profiles up ON up.id = d.user_id AND up.role = 'doctor'
            LEFT JOIN public.departments dep ON dep.id = d.department_id
            WHERE d.hospital_id = v_hospital_id
        ), '[]'::jsonb),
        'nurses', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'staff_id', n.id, 'staff_code', n.nurse_code, 'user_id', up.id,
                'name', up.full_name, 'email', up.email, 'account_status', up.status,
                'staff_status', n.status, 'department_id', n.department_id,
                'department_name', dep.name, 'specialization', n.specialization,
                'qualification', n.qualification, 'license_number', n.license_number,
                'phone', n.phone, 'experience_years', n.experience_years
            ) ORDER BY up.full_name)
            FROM public.nurses n
            JOIN public.user_profiles up ON up.id = n.user_id AND up.role = 'nurse'
            LEFT JOIN public.departments dep ON dep.id = n.department_id
            WHERE n.hospital_id = v_hospital_id
        ), '[]'::jsonb),
        'departments', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', dep.id, 'name', dep.name) ORDER BY dep.name)
            FROM public.departments dep
            WHERE dep.hospital_id = v_hospital_id AND dep.status = 'active'
        ), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_hospital_admin_staff_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hospital_admin_staff_directory() TO authenticated;


CREATE OR REPLACE FUNCTION public.update_hospital_staff_profile(
    p_role text,
    p_staff_id bigint,
    p_department_id bigint DEFAULT NULL,
    p_specialization text DEFAULT NULL,
    p_license_number text DEFAULT NULL,
    p_qualification text DEFAULT NULL,
    p_phone text DEFAULT NULL,
    p_experience_years integer DEFAULT NULL,
    p_staff_status text DEFAULT 'active'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_hospital_id bigint;
    v_user_id uuid;
    v_old_status text;
    v_specialization text := NULLIF(btrim(COALESCE(p_specialization, '')), '');
BEGIN
    SELECT up.hospital_id INTO v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'hospital_admin' AND up.status = 'active';
    IF v_hospital_id IS NULL THEN RAISE EXCEPTION 'An active hospital administrator profile is required.'; END IF;
    IF p_role IS NULL OR p_role NOT IN ('doctor', 'nurse')
       OR p_staff_status IS NULL OR p_staff_status NOT IN ('active', 'inactive')
       OR (p_role = 'doctor' AND v_specialization IS NULL)
       OR (p_specialization IS NOT NULL AND length(btrim(p_specialization)) > 120)
       OR (p_license_number IS NOT NULL AND length(btrim(p_license_number)) > 100)
       OR (p_qualification IS NOT NULL AND length(btrim(p_qualification)) > 200)
       OR (p_phone IS NOT NULL AND length(btrim(p_phone)) > 40)
       OR p_experience_years IS NULL OR p_experience_years < 0 OR p_experience_years > 80 THEN
        RAISE EXCEPTION 'Enter valid staff profile details.';
    END IF;
    IF p_department_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.departments dep
        WHERE dep.id = p_department_id AND dep.hospital_id = v_hospital_id AND dep.status = 'active'
    ) THEN RAISE EXCEPTION 'Department must be active and belong to your hospital.'; END IF;

    IF p_role = 'doctor' THEN
        SELECT d.user_id, d.status INTO v_user_id, v_old_status
        FROM public.doctors d
        WHERE d.id = p_staff_id AND d.hospital_id = v_hospital_id
        FOR UPDATE;
        IF NOT FOUND OR NOT EXISTS (
            SELECT 1 FROM public.user_profiles up
            WHERE up.id = v_user_id AND up.role = 'doctor'
        ) THEN RAISE EXCEPTION 'Doctor profile was not found in your hospital.'; END IF;
        UPDATE public.doctors
        SET department_id = p_department_id,
            specialization = v_specialization,
            license_number = NULLIF(btrim(COALESCE(p_license_number, '')), ''),
            qualification = NULLIF(btrim(COALESCE(p_qualification, '')), ''),
            phone = NULLIF(btrim(COALESCE(p_phone, '')), ''),
            experience_years = p_experience_years,
            status = p_staff_status,
            updated_at = now()
        WHERE id = p_staff_id;
    ELSE
        SELECT n.user_id, n.status INTO v_user_id, v_old_status
        FROM public.nurses n
        WHERE n.id = p_staff_id AND n.hospital_id = v_hospital_id
        FOR UPDATE;
        IF NOT FOUND OR NOT EXISTS (
            SELECT 1 FROM public.user_profiles up
            WHERE up.id = v_user_id AND up.role = 'nurse'
        ) THEN RAISE EXCEPTION 'Nurse profile was not found in your hospital.'; END IF;
        UPDATE public.nurses
        SET department_id = p_department_id,
            specialization = v_specialization,
            license_number = NULLIF(btrim(COALESCE(p_license_number, '')), ''),
            qualification = NULLIF(btrim(COALESCE(p_qualification, '')), ''),
            phone = NULLIF(btrim(COALESCE(p_phone, '')), ''),
            experience_years = p_experience_years,
            status = p_staff_status,
            updated_at = now()
        WHERE id = p_staff_id;
    END IF;

    INSERT INTO public.audit_logs (user_id, hospital_id, action, table_name, record_id, description, metadata)
    VALUES (auth.uid(), v_hospital_id, 'staff_profile_updated', CASE WHEN p_role = 'doctor' THEN 'doctors' ELSE 'nurses' END,
        p_staff_id, 'Clinical staff profile updated.',
        jsonb_build_object('role', p_role, 'old_status', v_old_status, 'new_status', p_staff_status,
            'department_id', p_department_id));
    RETURN TRUE;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_hospital_staff_profile(text, bigint, bigint, text, text, text, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_hospital_staff_profile(text, bigint, bigint, text, text, text, text, integer, text) TO authenticated;
