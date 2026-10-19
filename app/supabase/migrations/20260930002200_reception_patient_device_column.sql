DROP FUNCTION public.search_receptionist_patients(text, integer);

CREATE FUNCTION public.search_receptionist_patients(
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
        COALESCE(current_admission.status, 'not_admitted'),
        COALESCE(assigned_devices.device_name, '')
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
    LEFT JOIN LATERAL (
        SELECT string_agg(
            d.device_name || ' (' || d.device_code || ')',
            ', ' ORDER BY d.device_name, d.device_code
        ) AS device_name
        FROM public.devices d
        WHERE d.assigned_patient_id = p.id
          AND d.hospital_id = v_hospital_id
    ) assigned_devices ON true
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