CREATE OR REPLACE FUNCTION public.set_audit_log_hospital()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_user_role text;
    v_user_hospital_id bigint;
BEGIN
    IF NEW.hospital_id IS NOT NULL THEN
        IF NEW.user_id IS NULL THEN
            RAISE EXCEPTION 'Hospital-specific audit logs require a user.';
        END IF;

        SELECT up.role, up.hospital_id
        INTO v_user_role, v_user_hospital_id
        FROM public.user_profiles up
        WHERE up.id = NEW.user_id;

        IF NOT FOUND OR (
            v_user_role <> 'main_admin'
            AND v_user_hospital_id IS DISTINCT FROM NEW.hospital_id
        ) THEN
            RAISE EXCEPTION 'Audit hospital does not match the user hospital.';
        END IF;
    ELSIF NEW.user_id IS NOT NULL THEN
        SELECT up.hospital_id
        INTO NEW.hospital_id
        FROM public.user_profiles up
        WHERE up.id = NEW.user_id;
    END IF;

    RETURN NEW;
END;
$function$;