-- Hospital-scoped staff assignment management. No clinical notes are returned.

CREATE OR REPLACE FUNCTION public.get_hospital_admin_assignment_data()
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
    IF v_hospital_id IS NULL THEN
        RAISE EXCEPTION 'An active hospital administrator profile is required.';
    END IF;

    SELECT jsonb_build_object(
        'doctors', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', d.id,
                'doctor_code', d.doctor_code,
                'name', up.full_name,
                'specialization', d.specialization,
                'department_id', d.department_id
            ) ORDER BY up.full_name)
            FROM public.doctors d
            JOIN public.user_profiles up ON up.id = d.user_id
            WHERE d.hospital_id = v_hospital_id
              AND d.status = 'active' AND up.status = 'active' AND up.role = 'doctor'
        ), '[]'::jsonb),
        'nurses', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', n.id,
                'nurse_code', n.nurse_code,
                'name', up.full_name,
                'specialization', n.specialization,
                'department_id', n.department_id
            ) ORDER BY up.full_name)
            FROM public.nurses n
            JOIN public.user_profiles up ON up.id = n.user_id
            WHERE n.hospital_id = v_hospital_id
              AND n.status = 'active' AND up.status = 'active' AND up.role = 'nurse'
        ), '[]'::jsonb),
        'patients', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', p.id,
                'patient_number', p.patient_number,
                'name', concat_ws(' ', p.first_name, p.middle_name, p.last_name),
                'status', p.status
            ) ORDER BY p.last_name, p.first_name)
            FROM public.patients p
            WHERE p.hospital_id = v_hospital_id
              AND p.status IN ('active', 'admitted', 'discharged', 'transferred')
        ), '[]'::jsonb),
        'assignments', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', assignment_rows.id,
                'patient_id', assignment_rows.patient_id,
                'patient_number', assignment_rows.patient_number,
                'patient_name', assignment_rows.patient_name,
                'doctor_id', assignment_rows.doctor_id,
                'nurse_id', assignment_rows.nurse_id,
                'staff_name', assignment_rows.staff_name,
                'staff_code', assignment_rows.staff_code,
                'assignment_type', assignment_rows.assignment_type,
                'start_date', assignment_rows.start_date,
                'end_date', assignment_rows.end_date
            ) ORDER BY assignment_rows.start_date DESC, assignment_rows.id DESC)
            FROM (
                SELECT pa.id, p.id AS patient_id, p.patient_number,
                    concat_ws(' ', p.first_name, p.middle_name, p.last_name) AS patient_name,
                    d.id AS doctor_id, n.id AS nurse_id,
                    COALESCE(doctor_profile.full_name, nurse_profile.full_name) AS staff_name,
                    COALESCE(d.doctor_code, n.nurse_code) AS staff_code,
                    pa.assignment_type, pa.start_date, pa.end_date
                FROM public.patient_assignments pa
                JOIN public.patients p ON p.id = pa.patient_id
                LEFT JOIN public.doctors d ON d.id = pa.doctor_id
                LEFT JOIN public.user_profiles doctor_profile ON doctor_profile.id = d.user_id
                LEFT JOIN public.nurses n ON n.id = pa.nurse_id
                LEFT JOIN public.user_profiles nurse_profile ON nurse_profile.id = n.user_id
                WHERE p.hospital_id = v_hospital_id AND pa.status = 'active'
                ORDER BY pa.start_date DESC, pa.id DESC
                LIMIT 200
            ) assignment_rows
        ), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_hospital_admin_assignment_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hospital_admin_assignment_data() TO authenticated;


CREATE OR REPLACE FUNCTION public.create_hospital_patient_assignment(
    p_patient_id bigint,
    p_doctor_id bigint DEFAULT NULL,
    p_nurse_id bigint DEFAULT NULL,
    p_assignment_type text DEFAULT 'primary',
    p_start_date timestamp with time zone DEFAULT now(),
    p_end_date timestamp with time zone DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_hospital_id bigint;
    v_patient_hospital_id bigint;
    v_patient_status text;
    v_department_id bigint;
    v_ward_id bigint;
    v_bed_id bigint;
    v_assignment_id bigint;
    v_staff_exists boolean;
BEGIN
    SELECT up.hospital_id INTO v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'hospital_admin' AND up.status = 'active';
    IF v_hospital_id IS NULL THEN
        RAISE EXCEPTION 'An active hospital administrator profile is required.';
    END IF;

    IF (p_doctor_id IS NULL AND p_nurse_id IS NULL)
       OR (p_doctor_id IS NOT NULL AND p_nurse_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Choose exactly one doctor or nurse.';
    END IF;
    IF p_assignment_type IS NULL
       OR p_assignment_type NOT IN ('primary', 'supporting', 'temporary') THEN
        RAISE EXCEPTION 'Choose a valid assignment type.';
    END IF;
    IF p_start_date IS NULL OR (p_end_date IS NOT NULL AND p_end_date < p_start_date) THEN
        RAISE EXCEPTION 'Assignment dates are invalid.';
    END IF;

    SELECT p.hospital_id, p.status
    INTO v_patient_hospital_id, v_patient_status
    FROM public.patients p
    WHERE p.id = p_patient_id
    FOR UPDATE;
    IF v_patient_hospital_id IS NULL OR v_patient_hospital_id <> v_hospital_id THEN
        RAISE EXCEPTION 'Patient was not found in your hospital.';
    END IF;
    IF v_patient_status IN ('inactive', 'deceased') THEN
        RAISE EXCEPTION 'This patient cannot receive a new assignment.';
    END IF;

    IF p_doctor_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.doctors d
            JOIN public.user_profiles up ON up.id = d.user_id
            WHERE d.id = p_doctor_id AND d.hospital_id = v_hospital_id
              AND d.status = 'active' AND up.status = 'active' AND up.role = 'doctor'
        ) INTO v_staff_exists;
        IF NOT v_staff_exists THEN
            RAISE EXCEPTION 'Active doctor was not found in your hospital.';
        END IF;
        SELECT d.department_id INTO v_department_id
        FROM public.doctors d
        WHERE d.id = p_doctor_id;
    ELSE
        SELECT EXISTS (
            SELECT 1 FROM public.nurses n
            JOIN public.user_profiles up ON up.id = n.user_id
            WHERE n.id = p_nurse_id AND n.hospital_id = v_hospital_id
              AND n.status = 'active' AND up.status = 'active' AND up.role = 'nurse'
        ) INTO v_staff_exists;
        IF NOT v_staff_exists THEN
            RAISE EXCEPTION 'Active nurse was not found in your hospital.';
        END IF;
        SELECT n.department_id INTO v_department_id
        FROM public.nurses n
        WHERE n.id = p_nurse_id;

        SELECT ad.ward_id, ad.bed_id
        INTO v_ward_id, v_bed_id
        FROM public.admissions ad
        WHERE ad.patient_id = p_patient_id
          AND ad.hospital_id = v_hospital_id
          AND ad.status = 'admitted'
        ORDER BY ad.admission_date DESC, ad.id DESC
        LIMIT 1;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.patient_assignments pa
        WHERE pa.patient_id = p_patient_id
          AND pa.status = 'active'
          AND ((p_doctor_id IS NOT NULL AND pa.doctor_id = p_doctor_id)
               OR (p_nurse_id IS NOT NULL AND pa.nurse_id = p_nurse_id))
          AND pa.start_date <= COALESCE(p_end_date, 'infinity'::timestamptz)
          AND (pa.end_date IS NULL OR pa.end_date >= p_start_date)
    ) THEN
        RAISE EXCEPTION 'This staff member already has an overlapping patient assignment.';
    END IF;

    INSERT INTO public.patient_assignments (
        patient_id, doctor_id, nurse_id, department_id, ward_id, bed_id,
        assignment_type, assigned_by, start_date, end_date, status
    ) VALUES (
        p_patient_id, p_doctor_id, p_nurse_id, v_department_id, v_ward_id, v_bed_id,
        p_assignment_type, auth.uid(), p_start_date, p_end_date, 'active'
    )
    RETURNING id INTO v_assignment_id;

    INSERT INTO public.audit_logs (user_id, hospital_id, action, table_name, record_id, description, metadata)
    VALUES (auth.uid(), v_hospital_id, 'patient_assignment_created', 'patient_assignments', v_assignment_id,
        'Patient assigned to clinical staff.',
        jsonb_build_object('patient_id', p_patient_id, 'doctor_id', p_doctor_id, 'nurse_id', p_nurse_id,
            'assignment_type', p_assignment_type, 'start_date', p_start_date, 'end_date', p_end_date));

    RETURN jsonb_build_object('assignment_id', v_assignment_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_hospital_patient_assignment(bigint, bigint, bigint, text, timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_hospital_patient_assignment(bigint, bigint, bigint, text, timestamp with time zone, timestamp with time zone) TO authenticated;


CREATE OR REPLACE FUNCTION public.end_hospital_patient_assignment(
    p_assignment_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_hospital_id bigint;
    v_patient_id bigint;
    v_start_date timestamp with time zone;
    v_new_status text;
    v_end_date timestamp with time zone;
BEGIN
    SELECT up.hospital_id INTO v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'hospital_admin' AND up.status = 'active';
    IF v_hospital_id IS NULL THEN
        RAISE EXCEPTION 'An active hospital administrator profile is required.';
    END IF;

    SELECT pa.patient_id, pa.start_date
    INTO v_patient_id, v_start_date
    FROM public.patient_assignments pa
    JOIN public.patients p ON p.id = pa.patient_id
    WHERE pa.id = p_assignment_id
      AND p.hospital_id = v_hospital_id
      AND pa.status = 'active'
    FOR UPDATE OF pa;
    IF v_patient_id IS NULL THEN
        RAISE EXCEPTION 'Active patient assignment was not found in your hospital.';
    END IF;

    IF v_start_date > now() THEN
        v_new_status := 'cancelled';
        v_end_date := v_start_date;
    ELSE
        v_new_status := 'completed';
        v_end_date := now();
    END IF;

    UPDATE public.patient_assignments
    SET status = v_new_status, end_date = v_end_date
    WHERE id = p_assignment_id AND status = 'active';

    INSERT INTO public.audit_logs (user_id, hospital_id, action, table_name, record_id, description, metadata)
    VALUES (auth.uid(), v_hospital_id, 'patient_assignment_ended', 'patient_assignments', p_assignment_id,
        'Patient assignment ended by hospital administration.',
        jsonb_build_object('patient_id', v_patient_id, 'status', v_new_status, 'end_date', v_end_date));
    RETURN TRUE;
END;
$function$;

REVOKE ALL ON FUNCTION public.end_hospital_patient_assignment(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_hospital_patient_assignment(bigint) TO authenticated;
