-- Main-administrator hospital directory and metadata maintenance.

CREATE OR REPLACE FUNCTION public.get_main_admin_hospital_directory()
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

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', h.id,
        'hospital_code', h.hospital_code,
        'name', h.name,
        'email', h.email,
        'phone', h.phone,
        'registration_number', h.registration_number,
        'address', h.address,
        'city', h.city,
        'province', h.province,
        'postal_code', h.postal_code,
        'status', h.status,
        'created_at', h.created_at
    ) ORDER BY h.name), '[]'::jsonb)
    INTO v_result
    FROM public.hospitals h;
    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_main_admin_hospital_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_main_admin_hospital_directory() TO authenticated;


CREATE OR REPLACE FUNCTION public.create_main_admin_hospital(
    p_hospital_code text,
    p_name text,
    p_email text DEFAULT NULL,
    p_phone text DEFAULT NULL,
    p_registration_number text DEFAULT NULL,
    p_address text DEFAULT NULL,
    p_city text DEFAULT NULL,
    p_province text DEFAULT NULL,
    p_postal_code text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_hospital_id bigint;
    v_code text := upper(btrim(COALESCE(p_hospital_code, '')));
    v_name text := btrim(COALESCE(p_name, ''));
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.id = auth.uid() AND up.role = 'main_admin' AND up.status = 'active'
    ) THEN RAISE EXCEPTION 'An active main administrator profile is required.'; END IF;

    IF v_code !~ '^[A-Z0-9-]{2,30}$' OR v_name = '' OR length(v_name) > 160
       OR (p_email IS NOT NULL AND length(btrim(p_email)) > 254)
       OR (p_phone IS NOT NULL AND length(btrim(p_phone)) > 40)
       OR (p_registration_number IS NOT NULL AND length(btrim(p_registration_number)) > 100)
       OR (p_address IS NOT NULL AND length(btrim(p_address)) > 300)
       OR (p_city IS NOT NULL AND length(btrim(p_city)) > 100)
       OR (p_province IS NOT NULL AND length(btrim(p_province)) > 100)
       OR (p_postal_code IS NOT NULL AND length(btrim(p_postal_code)) > 30) THEN
        RAISE EXCEPTION 'Enter valid hospital details.';
    END IF;

    INSERT INTO public.hospitals (
        hospital_code, name, email, phone, registration_number,
        address, city, province, postal_code, status, created_by
    ) VALUES (
        v_code, v_name,
        NULLIF(btrim(COALESCE(p_email, '')), ''),
        NULLIF(btrim(COALESCE(p_phone, '')), ''),
        NULLIF(btrim(COALESCE(p_registration_number, '')), ''),
        NULLIF(btrim(COALESCE(p_address, '')), ''),
        NULLIF(btrim(COALESCE(p_city, '')), ''),
        NULLIF(btrim(COALESCE(p_province, '')), ''),
        NULLIF(btrim(COALESCE(p_postal_code, '')), ''),
        'active', auth.uid()
    ) RETURNING id INTO v_hospital_id;

    INSERT INTO public.audit_logs (user_id, hospital_id, action, table_name, record_id, description, metadata)
    VALUES (auth.uid(), v_hospital_id, 'hospital_created', 'hospitals', v_hospital_id,
        'Hospital registered.', jsonb_build_object('hospital_code', v_code, 'name', v_name));
    RETURN v_hospital_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_main_admin_hospital(text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_main_admin_hospital(text, text, text, text, text, text, text, text, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.update_main_admin_hospital(
    p_hospital_id bigint,
    p_hospital_code text,
    p_name text,
    p_email text DEFAULT NULL,
    p_phone text DEFAULT NULL,
    p_registration_number text DEFAULT NULL,
    p_address text DEFAULT NULL,
    p_city text DEFAULT NULL,
    p_province text DEFAULT NULL,
    p_postal_code text DEFAULT NULL,
    p_status text DEFAULT 'active'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_code text := upper(btrim(COALESCE(p_hospital_code, '')));
    v_name text := btrim(COALESCE(p_name, ''));
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.user_profiles up
        WHERE up.id = auth.uid() AND up.role = 'main_admin' AND up.status = 'active'
    ) THEN RAISE EXCEPTION 'An active main administrator profile is required.'; END IF;
    IF p_status IS NULL OR p_status NOT IN ('active', 'inactive')
       OR v_code !~ '^[A-Z0-9-]{2,30}$' OR v_name = '' OR length(v_name) > 160
       OR (p_email IS NOT NULL AND length(btrim(p_email)) > 254)
       OR (p_phone IS NOT NULL AND length(btrim(p_phone)) > 40)
       OR (p_registration_number IS NOT NULL AND length(btrim(p_registration_number)) > 100)
       OR (p_address IS NOT NULL AND length(btrim(p_address)) > 300)
       OR (p_city IS NOT NULL AND length(btrim(p_city)) > 100)
       OR (p_province IS NOT NULL AND length(btrim(p_province)) > 100)
       OR (p_postal_code IS NOT NULL AND length(btrim(p_postal_code)) > 30) THEN
        RAISE EXCEPTION 'Enter valid hospital details.';
    END IF;

    UPDATE public.hospitals
    SET hospital_code = v_code,
        name = v_name,
        email = NULLIF(btrim(COALESCE(p_email, '')), ''),
        phone = NULLIF(btrim(COALESCE(p_phone, '')), ''),
        registration_number = NULLIF(btrim(COALESCE(p_registration_number, '')), ''),
        address = NULLIF(btrim(COALESCE(p_address, '')), ''),
        city = NULLIF(btrim(COALESCE(p_city, '')), ''),
        province = NULLIF(btrim(COALESCE(p_province, '')), ''),
        postal_code = NULLIF(btrim(COALESCE(p_postal_code, '')), ''),
        status = p_status,
        updated_at = now()
    WHERE id = p_hospital_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Hospital was not found.'; END IF;

    INSERT INTO public.audit_logs (user_id, hospital_id, action, table_name, record_id, description, metadata)
    VALUES (auth.uid(), p_hospital_id, 'hospital_updated', 'hospitals', p_hospital_id,
        'Hospital details updated.', jsonb_build_object('hospital_code', v_code, 'status', p_status));
    RETURN TRUE;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_main_admin_hospital(bigint, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_main_admin_hospital(bigint, text, text, text, text, text, text, text, text, text, text) TO authenticated;
