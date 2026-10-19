-- Hospital administrators receive only aggregate operational counts.
CREATE OR REPLACE FUNCTION public.get_hospital_admin_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_hospital_id bigint;
    v_hospital_name text;
BEGIN
    SELECT up.hospital_id
    INTO v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role = 'hospital_admin'
      AND up.status = 'active';

    IF v_hospital_id IS NULL THEN
        RAISE EXCEPTION 'An active hospital administrator profile is required.';
    END IF;

    SELECT h.name
    INTO v_hospital_name
    FROM public.hospitals h
    WHERE h.id = v_hospital_id;

    IF v_hospital_name IS NULL THEN
        RAISE EXCEPTION 'The administrator hospital was not found.';
    END IF;

    RETURN jsonb_build_object(
        'hospital_name', v_hospital_name,
        'registered_patients', (
            SELECT count(*) FROM public.patients p
            WHERE p.hospital_id = v_hospital_id
        ),
        'admitted_patients', (
            SELECT count(*) FROM public.admissions ad
            WHERE ad.hospital_id = v_hospital_id AND ad.status = 'admitted'
        ),
        'active_doctors', (
            SELECT count(*) FROM public.doctors d
            WHERE d.hospital_id = v_hospital_id AND d.status = 'active'
        ),
        'active_nurses', (
            SELECT count(*) FROM public.nurses n
            WHERE n.hospital_id = v_hospital_id AND n.status = 'active'
        ),
        'available_beds', (
            SELECT count(*)
            FROM public.beds b
            JOIN public.wards w ON w.id = b.ward_id
            JOIN public.departments d ON d.id = w.department_id
            WHERE d.hospital_id = v_hospital_id
              AND d.status = 'active'
              AND w.status = 'active'
              AND b.status = 'available'
        ),
        'occupied_beds', (
            SELECT count(*)
            FROM public.beds b
            JOIN public.wards w ON w.id = b.ward_id
            JOIN public.departments d ON d.id = w.department_id
            WHERE d.hospital_id = v_hospital_id
              AND d.status = 'active'
              AND w.status = 'active'
              AND b.status = 'occupied'
        ),
        'active_alerts', (
            SELECT count(*)
            FROM public.alerts a
            JOIN public.patients p ON p.id = a.patient_id
            WHERE p.hospital_id = v_hospital_id
              AND a.status = 'active'
        )
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_hospital_admin_dashboard_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hospital_admin_dashboard_summary() TO authenticated;
