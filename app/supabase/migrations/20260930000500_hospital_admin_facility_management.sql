-- Hospital-scoped facility management. These RPCs expose no patient records.

CREATE OR REPLACE FUNCTION public.get_hospital_admin_facilities()
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
    SELECT up.hospital_id
    INTO v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.role = 'hospital_admin'
      AND up.status = 'active';

    IF v_hospital_id IS NULL THEN
        RAISE EXCEPTION 'An active hospital administrator profile is required.';
    END IF;

    SELECT jsonb_build_object(
        'departments', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', d.id,
                'department_code', d.department_code,
                'name', d.name,
                'description', d.description,
                'phone', d.phone,
                'status', d.status
            ) ORDER BY d.name)
            FROM public.departments d
            WHERE d.hospital_id = v_hospital_id
        ), '[]'::jsonb),
        'wards', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', w.id,
                'department_id', d.id,
                'department_name', d.name,
                'department_status', d.status,
                'ward_code', w.ward_code,
                'name', w.name,
                'ward_type', w.ward_type,
                'floor', w.floor,
                'capacity', w.capacity,
                'status', w.status
            ) ORDER BY d.name, w.name)
            FROM public.wards w
            JOIN public.departments d ON d.id = w.department_id
            WHERE d.hospital_id = v_hospital_id
        ), '[]'::jsonb),
        'beds', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', b.id,
                'ward_id', w.id,
                'department_name', d.name,
                'ward_name', w.name,
                'bed_number', b.bed_number,
                'bed_type', b.bed_type,
                'status', b.status
            ) ORDER BY d.name, w.name, b.bed_number)
            FROM public.beds b
            JOIN public.wards w ON w.id = b.ward_id
            JOIN public.departments d ON d.id = w.department_id
            WHERE d.hospital_id = v_hospital_id
        ), '[]'::jsonb)
    )
    INTO v_result;

    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_hospital_admin_facilities() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hospital_admin_facilities() TO authenticated;


CREATE OR REPLACE FUNCTION public.create_hospital_department(
    p_name text,
    p_department_code text,
    p_description text DEFAULT NULL,
    p_phone text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_hospital_id bigint;
    v_department_id bigint;
    v_name text := btrim(COALESCE(p_name, ''));
    v_code text := upper(btrim(COALESCE(p_department_code, '')));
BEGIN
    SELECT up.hospital_id INTO v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'hospital_admin' AND up.status = 'active';
    IF v_hospital_id IS NULL THEN
        RAISE EXCEPTION 'An active hospital administrator profile is required.';
    END IF;
    IF v_name = '' OR length(v_name) > 120 OR v_code !~ '^[A-Z0-9-]{2,20}$' THEN
        RAISE EXCEPTION 'Enter a valid department name and code.';
    END IF;

    INSERT INTO public.departments (hospital_id, department_code, name, description, phone)
    VALUES (
        v_hospital_id,
        v_code,
        v_name,
        NULLIF(btrim(COALESCE(p_description, '')), ''),
        NULLIF(btrim(COALESCE(p_phone, '')), '')
    )
    RETURNING id INTO v_department_id;

    INSERT INTO public.audit_logs (user_id, hospital_id, action, table_name, record_id, description, metadata)
    VALUES (auth.uid(), v_hospital_id, 'department_created', 'departments', v_department_id,
        'Department created.', jsonb_build_object('department_code', v_code));
    RETURN v_department_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_hospital_department(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_hospital_department(text, text, text, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.create_hospital_ward(
    p_department_id bigint,
    p_name text,
    p_ward_code text,
    p_ward_type text DEFAULT 'general',
    p_floor text DEFAULT NULL,
    p_capacity integer DEFAULT 0
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_hospital_id bigint;
    v_ward_id bigint;
    v_name text := btrim(COALESCE(p_name, ''));
    v_code text := upper(btrim(COALESCE(p_ward_code, '')));
BEGIN
    SELECT up.hospital_id INTO v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'hospital_admin' AND up.status = 'active';
    IF v_hospital_id IS NULL THEN
        RAISE EXCEPTION 'An active hospital administrator profile is required.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.departments d
        WHERE d.id = p_department_id AND d.hospital_id = v_hospital_id AND d.status = 'active'
    ) THEN
        RAISE EXCEPTION 'Select an active department in your hospital.';
    END IF;
    IF v_name = '' OR length(v_name) > 120
       OR v_code !~ '^[A-Z0-9-]{2,20}$'
       OR p_ward_type IS NULL
       OR p_ward_type NOT IN ('general', 'icu', 'emergency', 'maternity', 'pediatric', 'surgical', 'medical', 'isolation', 'other')
       OR p_capacity IS NULL OR p_capacity < 0 OR p_capacity > 10000 THEN
        RAISE EXCEPTION 'Enter valid ward details.';
    END IF;

    INSERT INTO public.wards (department_id, ward_code, name, ward_type, floor, capacity)
    VALUES (p_department_id, v_code, v_name, p_ward_type,
        NULLIF(btrim(COALESCE(p_floor, '')), ''), p_capacity)
    RETURNING id INTO v_ward_id;

    INSERT INTO public.audit_logs (user_id, hospital_id, action, table_name, record_id, description, metadata)
    VALUES (auth.uid(), v_hospital_id, 'ward_created', 'wards', v_ward_id,
        'Ward created.', jsonb_build_object('ward_code', v_code, 'department_id', p_department_id));
    RETURN v_ward_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_hospital_ward(bigint, text, text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_hospital_ward(bigint, text, text, text, text, integer) TO authenticated;


CREATE OR REPLACE FUNCTION public.create_hospital_bed(
    p_ward_id bigint,
    p_bed_number text,
    p_bed_type text DEFAULT 'standard'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_hospital_id bigint;
    v_bed_id bigint;
    v_bed_number text := btrim(COALESCE(p_bed_number, ''));
BEGIN
    SELECT up.hospital_id INTO v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'hospital_admin' AND up.status = 'active';
    IF v_hospital_id IS NULL THEN
        RAISE EXCEPTION 'An active hospital administrator profile is required.';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM public.wards w
        JOIN public.departments d ON d.id = w.department_id
        WHERE w.id = p_ward_id AND w.status = 'active'
          AND d.hospital_id = v_hospital_id AND d.status = 'active'
    ) THEN
        RAISE EXCEPTION 'Select an active ward in your hospital.';
    END IF;
    IF v_bed_number = '' OR length(v_bed_number) > 40
       OR p_bed_type IS NULL
       OR p_bed_type NOT IN ('standard', 'icu', 'electric', 'pediatric', 'maternity', 'other') THEN
        RAISE EXCEPTION 'Enter a valid bed number and type.';
    END IF;

    INSERT INTO public.beds (ward_id, bed_number, bed_type, status)
    VALUES (p_ward_id, v_bed_number, p_bed_type, 'available')
    RETURNING id INTO v_bed_id;

    INSERT INTO public.audit_logs (user_id, hospital_id, action, table_name, record_id, description, metadata)
    VALUES (auth.uid(), v_hospital_id, 'bed_created', 'beds', v_bed_id,
        'Bed created.', jsonb_build_object('bed_number', v_bed_number, 'ward_id', p_ward_id));
    RETURN v_bed_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_hospital_bed(bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_hospital_bed(bigint, text, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.set_hospital_bed_status(
    p_bed_id bigint,
    p_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_hospital_id bigint;
    v_rows integer;
BEGIN
    SELECT up.hospital_id INTO v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'hospital_admin' AND up.status = 'active';
    IF v_hospital_id IS NULL THEN
        RAISE EXCEPTION 'An active hospital administrator profile is required.';
    END IF;
    IF p_status IS NULL OR p_status NOT IN ('available', 'reserved', 'maintenance', 'inactive') THEN
        RAISE EXCEPTION 'Choose an allowed bed status.';
    END IF;

    PERFORM b.id
    FROM public.beds b
    JOIN public.wards w ON w.id = b.ward_id
    JOIN public.departments d ON d.id = w.department_id
    WHERE b.id = p_bed_id AND d.hospital_id = v_hospital_id
    FOR UPDATE OF b;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bed was not found in your hospital.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.admissions ad
        WHERE ad.bed_id = p_bed_id AND ad.status = 'admitted'
    ) THEN
        RAISE EXCEPTION 'An occupied bed cannot be changed while an active admission uses it.';
    END IF;

    UPDATE public.beds SET status = p_status WHERE id = p_bed_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Bed status was not updated.';
    END IF;

    INSERT INTO public.audit_logs (user_id, hospital_id, action, table_name, record_id, description, metadata)
    VALUES (auth.uid(), v_hospital_id, 'bed_status_changed', 'beds', p_bed_id,
        'Bed status changed.', jsonb_build_object('status', p_status));
    RETURN TRUE;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_hospital_bed_status(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_hospital_bed_status(bigint, text) TO authenticated;
