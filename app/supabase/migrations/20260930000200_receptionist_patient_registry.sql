-- Receptionists receive an identity-only patient registry scoped to their hospital.
-- Sensitive clinical fields remain behind separately authorized clinical APIs.

CREATE SEQUENCE IF NOT EXISTS public.patient_number_seq AS bigint;
CREATE SEQUENCE IF NOT EXISTS public.admission_number_seq AS bigint;
REVOKE ALL ON SEQUENCE public.patient_number_seq, public.admission_number_seq FROM PUBLIC, anon, authenticated;

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
    admission_status text
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
    SELECT up.hospital_id
    INTO v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role = 'receptionist'
      AND up.status = 'active';

    IF v_hospital_id IS NULL THEN
        RAISE EXCEPTION 'An active receptionist profile with a hospital is required.';
    END IF;

    RETURN QUERY
    SELECT
        p.id,
        p.patient_number,
        p.first_name,
        p.middle_name,
        p.last_name,
        p.date_of_birth,
        p.phone,
        p.status,
        COALESCE(b.bed_number, ''),
        COALESCE(w.name, ''),
        COALESCE(current_admission.status, 'not_admitted')
    FROM public.patients p
    LEFT JOIN LATERAL (
        SELECT ad.status, ad.bed_id, ad.ward_id
        FROM public.admissions ad
        WHERE ad.patient_id = p.id
          AND ad.hospital_id = v_hospital_id
          AND ad.status = 'admitted'
        ORDER BY ad.admission_date DESC, ad.id DESC
        LIMIT 1
    ) current_admission ON true
    LEFT JOIN public.beds b ON b.id = current_admission.bed_id
    LEFT JOIN public.wards w
      ON w.id = COALESCE(current_admission.ward_id, b.ward_id)
    WHERE p.hospital_id = v_hospital_id
      AND (
          v_search = ''
          OR p.patient_number ILIKE '%' || v_search || '%'
          OR p.phone ILIKE '%' || v_search || '%'
          OR concat_ws(' ', p.first_name, p.middle_name, p.last_name)
             ILIKE '%' || v_search || '%'
      )
    ORDER BY p.last_name, p.first_name, p.id
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
END;
$function$;

REVOKE ALL ON FUNCTION public.search_receptionist_patients(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_receptionist_patients(text, integer) TO authenticated;


CREATE OR REPLACE FUNCTION public.register_receptionist_patient(
    p_first_name text,
    p_middle_name text DEFAULT NULL,
    p_last_name text DEFAULT NULL,
    p_date_of_birth date DEFAULT NULL,
    p_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_hospital_id bigint;
    v_patient_id bigint;
    v_patient_number text;
    v_first_name text := btrim(COALESCE(p_first_name, ''));
    v_middle_name text := NULLIF(btrim(COALESCE(p_middle_name, '')), '');
    v_last_name text := btrim(COALESCE(p_last_name, ''));
    v_phone text := NULLIF(btrim(COALESCE(p_phone, '')), '');
BEGIN
    SELECT up.hospital_id
    INTO v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role = 'receptionist'
      AND up.status = 'active';

    IF v_hospital_id IS NULL THEN
        RAISE EXCEPTION 'An active receptionist profile with a hospital is required.';
    END IF;

    IF v_first_name = '' OR v_last_name = '' THEN
        RAISE EXCEPTION 'First and last name are required.';
    END IF;

    IF length(v_first_name) > 100 OR length(v_last_name) > 100
       OR length(COALESCE(v_middle_name, '')) > 100
       OR length(COALESCE(v_phone, '')) > 40 THEN
        RAISE EXCEPTION 'One or more patient identity fields are too long.';
    END IF;

    LOOP
        v_patient_number := 'RV-' || lpad(nextval('public.patient_number_seq')::text, 8, '0');
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.patients p WHERE p.patient_number = v_patient_number
        );
    END LOOP;

    INSERT INTO public.patients (
        patient_number,
        first_name,
        middle_name,
        last_name,
        date_of_birth,
        phone,
        hospital_id,
        status,
        created_by
    ) VALUES (
        v_patient_number,
        v_first_name,
        v_middle_name,
        v_last_name,
        p_date_of_birth,
        v_phone,
        v_hospital_id,
        'active',
        auth.uid()
    )
    RETURNING id INTO v_patient_id;

    INSERT INTO public.audit_logs (
        user_id,
        hospital_id,
        action,
        table_name,
        record_id,
        description,
        metadata
    ) VALUES (
        auth.uid(),
        v_hospital_id,
        'patient_registered',
        'patients',
        v_patient_id,
        'Patient identity registered by reception.',
        jsonb_build_object('patient_number', v_patient_number)
    );

    RETURN jsonb_build_object(
        'patient_id', v_patient_id,
        'patient_number', v_patient_number
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.register_receptionist_patient(text, text, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_receptionist_patient(text, text, text, date, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.list_receptionist_available_beds()
RETURNS TABLE (
    bed_id bigint,
    bed_number text,
    ward_name text,
    department_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_hospital_id bigint;
BEGIN
    SELECT up.hospital_id
    INTO v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role = 'receptionist'
      AND up.status = 'active';

    IF v_hospital_id IS NULL THEN
        RAISE EXCEPTION 'An active receptionist profile with a hospital is required.';
    END IF;

    RETURN QUERY
    SELECT b.id, b.bed_number, w.name, d.name
    FROM public.beds b
    JOIN public.wards w ON w.id = b.ward_id
    JOIN public.departments d ON d.id = w.department_id
    WHERE d.hospital_id = v_hospital_id
      AND b.status = 'available'
      AND w.status = 'active'
      AND d.status = 'active'
    ORDER BY w.name, b.bed_number;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_receptionist_available_beds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_receptionist_available_beds() TO authenticated;


CREATE OR REPLACE FUNCTION public.admit_receptionist_patient(
    p_patient_id bigint,
    p_bed_id bigint,
    p_admission_type text DEFAULT 'routine'
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
    v_bed_number text;
    v_bed_hospital_id bigint;
    v_bed_ward_id bigint;
    v_department_id bigint;
    v_admission_id bigint;
    v_admission_number text;
    v_updated_rows integer;
BEGIN
    SELECT up.hospital_id
    INTO v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role = 'receptionist'
      AND up.status = 'active';

    IF v_hospital_id IS NULL THEN
        RAISE EXCEPTION 'An active receptionist profile with a hospital is required.';
    END IF;

    IF p_admission_type IS NULL
       OR p_admission_type NOT IN ('routine', 'emergency', 'transfer', 'observation', 'other') THEN
        RAISE EXCEPTION 'Invalid admission type.';
    END IF;

    SELECT p.hospital_id, p.status
    INTO v_patient_hospital_id, v_patient_status
    FROM public.patients p
    WHERE p.id = p_patient_id
    FOR UPDATE;

    IF v_patient_hospital_id IS NULL THEN
        RAISE EXCEPTION 'Patient was not found.';
    END IF;
    IF v_patient_hospital_id <> v_hospital_id THEN
        RAISE EXCEPTION 'Patient belongs to another hospital.';
    END IF;
    IF v_patient_status IN ('inactive', 'deceased') THEN
        RAISE EXCEPTION 'This patient cannot be admitted in their current status.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.admissions ad
        WHERE ad.patient_id = p_patient_id
          AND ad.hospital_id = v_hospital_id
          AND ad.status = 'admitted'
    ) THEN
        RAISE EXCEPTION 'Patient already has an active admission.';
    END IF;

    SELECT b.bed_number, d.hospital_id, w.id, d.id
    INTO v_bed_number, v_bed_hospital_id, v_bed_ward_id, v_department_id
    FROM public.beds b
    JOIN public.wards w ON w.id = b.ward_id
    JOIN public.departments d ON d.id = w.department_id
    WHERE b.id = p_bed_id
      AND b.status = 'available'
      AND w.status = 'active'
      AND d.status = 'active'
    FOR UPDATE OF b;

    IF v_bed_number IS NULL THEN
        RAISE EXCEPTION 'The selected bed is no longer available.';
    END IF;
    IF v_bed_hospital_id <> v_hospital_id THEN
        RAISE EXCEPTION 'Bed belongs to another hospital.';
    END IF;

    UPDATE public.beds
    SET status = 'occupied'
    WHERE id = p_bed_id AND status = 'available';
    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows <> 1 THEN
        RAISE EXCEPTION 'The selected bed is no longer available.';
    END IF;

    LOOP
        v_admission_number := 'RV-ADM-' || lpad(nextval('public.admission_number_seq')::text, 8, '0');
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.admissions ad WHERE ad.admission_number = v_admission_number
        );
    END LOOP;

    INSERT INTO public.admissions (
        patient_id,
        hospital_id,
        department_id,
        ward_id,
        bed_id,
        admission_number,
        admission_type,
        status,
        admitted_by
    ) VALUES (
        p_patient_id,
        v_hospital_id,
        v_department_id,
        v_bed_ward_id,
        p_bed_id,
        v_admission_number,
        p_admission_type,
        'admitted',
        auth.uid()
    )
    RETURNING id INTO v_admission_id;

    UPDATE public.patients
    SET status = 'admitted'
    WHERE id = p_patient_id;

    INSERT INTO public.audit_logs (
        user_id,
        hospital_id,
        action,
        table_name,
        record_id,
        description,
        metadata
    ) VALUES (
        auth.uid(),
        v_hospital_id,
        'patient_admitted',
        'admissions',
        v_admission_id,
        'Patient admitted to an available bed by reception.',
        jsonb_build_object('patient_id', p_patient_id, 'bed_number', v_bed_number)
    );

    RETURN jsonb_build_object(
        'admission_id', v_admission_id,
        'admission_number', v_admission_number,
        'bed_number', v_bed_number
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.admit_receptionist_patient(bigint, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admit_receptionist_patient(bigint, bigint, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.transfer_receptionist_patient(
    p_patient_id bigint,
    p_new_bed_id bigint
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
    v_current_admission_id bigint;
    v_current_bed_id bigint;
    v_current_bed_status text;
    v_new_bed_number text;
    v_new_bed_hospital_id bigint;
    v_new_ward_id bigint;
    v_new_department_id bigint;
    v_new_admission_id bigint;
    v_admission_number text;
    v_updated_rows integer;
BEGIN
    SELECT up.hospital_id
    INTO v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role = 'receptionist'
      AND up.status = 'active';

    IF v_hospital_id IS NULL THEN
        RAISE EXCEPTION 'An active receptionist profile with a hospital is required.';
    END IF;

    SELECT p.hospital_id, p.status
    INTO v_patient_hospital_id, v_patient_status
    FROM public.patients p
    WHERE p.id = p_patient_id
    FOR UPDATE;

    IF v_patient_hospital_id IS NULL OR v_patient_hospital_id <> v_hospital_id THEN
        RAISE EXCEPTION 'Patient was not found in your hospital.';
    END IF;
    IF v_patient_status <> 'admitted' THEN
        RAISE EXCEPTION 'Only an admitted patient can be transferred.';
    END IF;

    SELECT ad.id, ad.bed_id
    INTO v_current_admission_id, v_current_bed_id
    FROM public.admissions ad
    WHERE ad.patient_id = p_patient_id
      AND ad.hospital_id = v_hospital_id
      AND ad.status = 'admitted'
    ORDER BY ad.admission_date DESC, ad.id DESC
    LIMIT 1
    FOR UPDATE;

    IF v_current_admission_id IS NULL OR v_current_bed_id IS NULL THEN
        RAISE EXCEPTION 'An active bed assignment was not found for this patient.';
    END IF;
    IF p_new_bed_id = v_current_bed_id THEN
        RAISE EXCEPTION 'Choose a different bed for the transfer.';
    END IF;

    -- Lock both beds in a stable order so concurrent transfers do not reserve
    -- the same destination or deadlock while swapping beds.
    PERFORM b.id
    FROM public.beds b
    WHERE b.id IN (v_current_bed_id, p_new_bed_id)
    ORDER BY b.id
    FOR UPDATE;

    SELECT b.status
    INTO v_current_bed_status
    FROM public.beds b
    WHERE b.id = v_current_bed_id;
    IF v_current_bed_status IS DISTINCT FROM 'occupied' THEN
        RAISE EXCEPTION 'The current bed is not marked occupied.';
    END IF;

    SELECT b.bed_number, d.hospital_id, w.id, d.id
    INTO v_new_bed_number, v_new_bed_hospital_id, v_new_ward_id, v_new_department_id
    FROM public.beds b
    JOIN public.wards w ON w.id = b.ward_id
    JOIN public.departments d ON d.id = w.department_id
    WHERE b.id = p_new_bed_id
      AND b.status = 'available'
      AND w.status = 'active'
      AND d.status = 'active';

    IF v_new_bed_number IS NULL THEN
        RAISE EXCEPTION 'The selected bed is no longer available.';
    END IF;
    IF v_new_bed_hospital_id <> v_hospital_id THEN
        RAISE EXCEPTION 'The selected bed belongs to another hospital.';
    END IF;

    UPDATE public.admissions
    SET status = 'transferred'
    WHERE id = v_current_admission_id AND status = 'admitted';
    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows <> 1 THEN
        RAISE EXCEPTION 'The active admission changed; refresh and try again.';
    END IF;

    UPDATE public.beds
    SET status = 'available'
    WHERE id = v_current_bed_id AND status = 'occupied';
    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows <> 1 THEN
        RAISE EXCEPTION 'The current bed state changed; refresh and try again.';
    END IF;

    UPDATE public.beds
    SET status = 'occupied'
    WHERE id = p_new_bed_id AND status = 'available';
    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows <> 1 THEN
        RAISE EXCEPTION 'The selected bed is no longer available.';
    END IF;

    LOOP
        v_admission_number := 'RV-ADM-' || lpad(nextval('public.admission_number_seq')::text, 8, '0');
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.admissions ad WHERE ad.admission_number = v_admission_number
        );
    END LOOP;

    INSERT INTO public.admissions (
        patient_id,
        hospital_id,
        department_id,
        ward_id,
        bed_id,
        admission_number,
        admission_type,
        status,
        admitted_by
    ) VALUES (
        p_patient_id,
        v_hospital_id,
        v_new_department_id,
        v_new_ward_id,
        p_new_bed_id,
        v_admission_number,
        'transfer',
        'admitted',
        auth.uid()
    )
    RETURNING id INTO v_new_admission_id;

    INSERT INTO public.audit_logs (
        user_id,
        hospital_id,
        action,
        table_name,
        record_id,
        description,
        metadata
    ) VALUES (
        auth.uid(),
        v_hospital_id,
        'patient_transferred',
        'admissions',
        v_new_admission_id,
        'Patient transferred to another bed by reception.',
        jsonb_build_object(
            'patient_id', p_patient_id,
            'from_bed_id', v_current_bed_id,
            'to_bed_number', v_new_bed_number
        )
    );

    RETURN jsonb_build_object(
        'admission_id', v_new_admission_id,
        'admission_number', v_admission_number,
        'bed_number', v_new_bed_number
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_receptionist_patient(bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_receptionist_patient(bigint, bigint) TO authenticated;
