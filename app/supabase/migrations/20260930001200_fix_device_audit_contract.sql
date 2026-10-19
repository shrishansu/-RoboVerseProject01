-- Fix the remote audit-log contract used by device credential rotation.

CREATE OR REPLACE FUNCTION public.create_audit_log(
    p_action text,
    p_table_name text,
    p_record_id bigint DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_user_id uuid DEFAULT NULL,
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_hospital_id bigint;
    v_log_id bigint;
    v_effective_user_id uuid;
BEGIN
    v_effective_user_id := COALESCE(p_user_id, auth.uid());

    SELECT up.hospital_id INTO v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = v_effective_user_id
      AND up.status = 'active';

    IF p_table_name = 'device_credentials' AND p_record_id IS NOT NULL THEN
        SELECT d.hospital_id INTO v_hospital_id
        FROM public.device_credentials dc
        JOIN public.devices d ON d.id = dc.device_id
        WHERE dc.id = p_record_id;
    ELSIF p_table_name = 'devices' AND p_record_id IS NOT NULL THEN
        SELECT d.hospital_id INTO v_hospital_id
        FROM public.devices d
        WHERE d.id = p_record_id;
    ELSIF p_table_name = 'patients' AND p_record_id IS NOT NULL THEN
        SELECT p.hospital_id INTO v_hospital_id
        FROM public.patients p
        WHERE p.id = p_record_id;
    END IF;

    INSERT INTO public.audit_logs (
        user_id,
        hospital_id,
        action,
        table_name,
        record_id,
        description,
        metadata
    )
    VALUES (
        v_effective_user_id,
        v_hospital_id,
        p_action,
        p_table_name,
        p_record_id,
        p_description,
        COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING id INTO v_log_id;

    RETURN v_log_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_audit_log(text, text, bigint, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_audit_log(text, text, bigint, text, uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_device_credential(target_device_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role text;
    v_hospital_id bigint;
    v_device_hospital_id bigint;
    v_credential_id bigint;
BEGIN
    SELECT up.role, up.hospital_id INTO v_role, v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.status = 'active'
      AND up.role IN ('main_admin', 'hospital_admin');

    IF v_role IS NULL THEN
        RAISE EXCEPTION 'An active administrator profile is required.';
    END IF;

    SELECT d.hospital_id INTO v_device_hospital_id
    FROM public.devices d
    WHERE d.id = target_device_id
      AND (v_role = 'main_admin' OR d.hospital_id = v_hospital_id)
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Device was not found in your permitted scope.';
    END IF;

    SELECT dc.id INTO v_credential_id
    FROM public.device_credentials dc
    WHERE dc.device_id = target_device_id
    FOR UPDATE;

    IF v_credential_id IS NULL THEN
        RAISE EXCEPTION 'This device has no credential to revoke.';
    END IF;

    UPDATE public.device_credentials
    SET status = 'revoked', revoked_at = now(), last_used_at = NULL
    WHERE id = v_credential_id;

    PERFORM public.create_audit_log(
        'REVOKE_DEVICE_CREDENTIAL',
        'device_credentials',
        v_credential_id,
        'Device credential revoked',
        auth.uid(),
        jsonb_build_object('device_id', target_device_id)
    );

    RETURN TRUE;
END;
$function$;

REVOKE ALL ON FUNCTION public.revoke_device_credential(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_device_credential(bigint) TO authenticated;
