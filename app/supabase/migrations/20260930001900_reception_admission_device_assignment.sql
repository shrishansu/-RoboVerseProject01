-- Allow reception to optionally assign an unassigned device atomically with admission.

CREATE OR REPLACE FUNCTION public.list_receptionist_available_devices()
RETURNS TABLE (
    device_id bigint,
    device_code text,
    device_name text,
    device_type text,
    status text
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
    SELECT d.id, d.device_code, d.device_name, d.device_type, d.status
    FROM public.devices d
    WHERE d.hospital_id = v_hospital_id
      AND d.assigned_patient_id IS NULL
      AND d.status IN ('online', 'offline')
    ORDER BY d.device_name, d.device_code;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_receptionist_available_devices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_receptionist_available_devices() TO authenticated;

-- Some deployed databases no longer have the legacy three-argument overload.
-- The migration replaces it when present and can also create the new signature
-- on databases where that older overload was already removed.
DROP FUNCTION IF EXISTS public.admit_receptionist_patient(bigint, bigint, text);

CREATE OR REPLACE FUNCTION public.admit_receptionist_patient(
    p_patient_id bigint,
    p_bed_id bigint,
    p_admission_type text DEFAULT 'routine',
    p_device_id bigint DEFAULT NULL
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
    v_device_hospital_id bigint;
    v_device_status text;
    v_device_patient_id bigint;
    v_device_code text;
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

    IF p_device_id IS NOT NULL THEN
        SELECT d.hospital_id, d.status, d.assigned_patient_id, d.device_code
        INTO v_device_hospital_id, v_device_status, v_device_patient_id, v_device_code
        FROM public.devices d
        WHERE d.id = p_device_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'The selected device was not found.';
        END IF;
        IF v_device_hospital_id <> v_hospital_id THEN
            RAISE EXCEPTION 'The selected device belongs to another hospital.';
        END IF;
        IF v_device_status NOT IN ('online', 'offline') THEN
            RAISE EXCEPTION 'Only online or offline devices can be assigned.';
        END IF;
        IF v_device_patient_id IS NOT NULL THEN
            RAISE EXCEPTION 'The selected device is already assigned to a patient.';
        END IF;
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

    IF p_device_id IS NOT NULL THEN
        UPDATE public.devices
        SET assigned_patient_id = p_patient_id, updated_at = now()
        WHERE id = p_device_id AND assigned_patient_id IS NULL;
        GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
        IF v_updated_rows <> 1 THEN
            RAISE EXCEPTION 'The selected device is no longer available.';
        END IF;
    END IF;

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
        jsonb_build_object(
            'patient_id', p_patient_id,
            'bed_number', v_bed_number,
            'device_id', p_device_id,
            'device_code', v_device_code
        )
    );

    RETURN jsonb_build_object(
        'admission_id', v_admission_id,
        'admission_number', v_admission_number,
        'bed_number', v_bed_number,
        'device_code', v_device_code
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.admit_receptionist_patient(bigint, bigint, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admit_receptionist_patient(bigint, bigint, text, bigint) TO authenticated;
