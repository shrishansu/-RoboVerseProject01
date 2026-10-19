-- Include clinical user accounts even when their staff row is missing, and provide an audited repair path.

CREATE OR REPLACE FUNCTION public.get_main_admin_staff_directory(p_role text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_result jsonb;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.id = auth.uid()
          AND up.role = 'main_admin'
          AND up.status = 'active'
    ) THEN
        RAISE EXCEPTION 'An active main administrator profile is required.';
    END IF;

    IF p_role IS NULL OR p_role NOT IN ('doctor', 'nurse') THEN
        RAISE EXCEPTION 'Choose a doctor or nurse directory.';
    END IF;

    IF p_role = 'doctor' THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'profile_id', up.id,
            'staff_id', d.id,
            'profile_complete', d.id IS NOT NULL,
            'staff_code', d.doctor_code,
            'name', up.full_name,
            'email', up.email,
            'account_status', up.status,
            'staff_status', COALESCE(d.status, 'profile_missing'),
            'hospital_id', COALESCE(d.hospital_id, up.hospital_id),
            'hospital_name', COALESCE(h.name, 'Not assigned'),
            'hospital_code', h.hospital_code,
            'department_name', dep.name,
            'specialization', d.specialization,
            'qualification', d.qualification,
            'license_number', d.license_number,
            'phone', d.phone,
            'experience_years', d.experience_years,
            'created_at', COALESCE(d.created_at, up.created_at)
        ) ORDER BY h.name NULLS LAST, up.full_name), '[]'::jsonb)
        INTO v_result
        FROM public.user_profiles up
        LEFT JOIN public.doctors d ON d.user_id = up.id
        LEFT JOIN public.hospitals h ON h.id = COALESCE(d.hospital_id, up.hospital_id)
        LEFT JOIN public.departments dep ON dep.id = d.department_id
        WHERE up.role = 'doctor'
          AND up.status <> 'deleted';
    ELSE
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'profile_id', up.id,
            'staff_id', n.id,
            'profile_complete', n.id IS NOT NULL,
            'staff_code', n.nurse_code,
            'name', up.full_name,
            'email', up.email,
            'account_status', up.status,
            'staff_status', COALESCE(n.status, 'profile_missing'),
            'hospital_id', COALESCE(n.hospital_id, up.hospital_id),
            'hospital_name', COALESCE(h.name, 'Not assigned'),
            'hospital_code', h.hospital_code,
            'department_name', dep.name,
            'specialization', n.specialization,
            'qualification', n.qualification,
            'license_number', n.license_number,
            'phone', n.phone,
            'experience_years', n.experience_years,
            'created_at', COALESCE(n.created_at, up.created_at)
        ) ORDER BY h.name NULLS LAST, up.full_name), '[]'::jsonb)
        INTO v_result
        FROM public.user_profiles up
        LEFT JOIN public.nurses n ON n.user_id = up.id
        LEFT JOIN public.hospitals h ON h.id = COALESCE(n.hospital_id, up.hospital_id)
        LEFT JOIN public.departments dep ON dep.id = n.department_id
        WHERE up.role = 'nurse'
          AND up.status <> 'deleted';
    END IF;

    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_main_admin_staff_directory(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_main_admin_staff_directory(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_missing_clinical_staff_profile(
    p_user_id uuid,
    p_hospital_id bigint,
    p_specialization text DEFAULT NULL,
    p_license_number text DEFAULT NULL,
    p_qualification text DEFAULT NULL,
    p_phone text DEFAULT NULL,
    p_experience_years integer DEFAULT 0,
    p_department_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role text;
    v_profile_hospital_id bigint;
    v_staff_id bigint;
    v_staff_table text;
    v_staff_code text;
    v_specialization text := NULLIF(btrim(COALESCE(p_specialization, '')), '');
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.user_profiles admin_profile
        WHERE admin_profile.id = auth.uid()
          AND admin_profile.role = 'main_admin'
          AND admin_profile.status = 'active'
    ) THEN
        RAISE EXCEPTION 'An active main administrator profile is required.';
    END IF;

    SELECT up.role, up.hospital_id
    INTO v_role, v_profile_hospital_id
    FROM public.user_profiles up
    WHERE up.id = p_user_id
      AND up.status = 'active'
      AND up.role IN ('doctor', 'nurse')
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'An active doctor or nurse account was not found.';
    END IF;

    IF p_hospital_id IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.hospitals h
        WHERE h.id = p_hospital_id
          AND h.status = 'active'
    ) THEN
        RAISE EXCEPTION 'Choose an active hospital.';
    END IF;

    IF p_department_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM public.departments d
        WHERE d.id = p_department_id
          AND d.hospital_id = p_hospital_id
          AND d.status = 'active'
    ) THEN
        RAISE EXCEPTION 'Choose an active department in the selected hospital.';
    END IF;

    IF p_experience_years IS NULL OR p_experience_years < 0 OR p_experience_years > 80
       OR (p_license_number IS NOT NULL AND length(btrim(p_license_number)) > 100)
       OR (p_qualification IS NOT NULL AND length(btrim(p_qualification)) > 200)
       OR (p_phone IS NOT NULL AND length(btrim(p_phone)) > 40) THEN
        RAISE EXCEPTION 'One or more professional details are invalid.';
    END IF;

    IF v_role = 'doctor' THEN
        IF v_specialization IS NULL OR length(v_specialization) > 120 THEN
            RAISE EXCEPTION 'Doctor specialization is required.';
        END IF;
        IF EXISTS (SELECT 1 FROM public.doctors d WHERE d.user_id = p_user_id) THEN
            RAISE EXCEPTION 'This account already has a doctor staff profile.';
        END IF;

        INSERT INTO public.doctors (
            user_id, hospital_id, department_id, doctor_code, specialization,
            license_number, phone, qualification, experience_years, status
        ) VALUES (
            p_user_id, p_hospital_id, p_department_id,
            'DR-' || p_user_id::text, v_specialization,
            NULLIF(btrim(COALESCE(p_license_number, '')), ''),
            NULLIF(btrim(COALESCE(p_phone, '')), ''),
            NULLIF(btrim(COALESCE(p_qualification, '')), ''),
            p_experience_years, 'active'
        ) RETURNING id INTO v_staff_id;
        v_staff_table := 'doctors';
        v_staff_code := 'DR-' || p_user_id::text;
    ELSE
        IF v_specialization IS NOT NULL AND length(v_specialization) > 120 THEN
            RAISE EXCEPTION 'Specialization must not exceed 120 characters.';
        END IF;
        IF EXISTS (SELECT 1 FROM public.nurses n WHERE n.user_id = p_user_id) THEN
            RAISE EXCEPTION 'This account already has a nurse staff profile.';
        END IF;

        INSERT INTO public.nurses (
            user_id, hospital_id, department_id, nurse_code, specialization,
            license_number, phone, qualification, experience_years, status
        ) VALUES (
            p_user_id, p_hospital_id, p_department_id,
            'NR-' || p_user_id::text, v_specialization,
            NULLIF(btrim(COALESCE(p_license_number, '')), ''),
            NULLIF(btrim(COALESCE(p_phone, '')), ''),
            NULLIF(btrim(COALESCE(p_qualification, '')), ''),
            p_experience_years, 'active'
        ) RETURNING id INTO v_staff_id;
        v_staff_table := 'nurses';
        v_staff_code := 'NR-' || p_user_id::text;
    END IF;

    UPDATE public.user_profiles
    SET hospital_id = p_hospital_id,
        updated_at = now()
    WHERE id = p_user_id;

    PERFORM public.create_audit_log(
        'clinical_staff_profile_completed',
        v_staff_table,
        v_staff_id,
        'Clinical staff profile completed by a main administrator.',
        auth.uid(),
        jsonb_build_object(
            'profile_id', p_user_id,
            'role', v_role,
            'previous_hospital_id', v_profile_hospital_id,
            'hospital_id', p_hospital_id,
            'department_id', p_department_id
        )
    );

    RETURN jsonb_build_object(
        'profile_id', p_user_id,
        'staff_id', v_staff_id,
        'staff_code', v_staff_code,
        'hospital_id', p_hospital_id,
        'role', v_role
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_missing_clinical_staff_profile(uuid, bigint, text, text, text, text, integer, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_missing_clinical_staff_profile(uuid, bigint, text, text, text, text, integer, bigint) TO authenticated;
