-- Repair device credential rotation while preserving one credential row per device.

CREATE OR REPLACE FUNCTION public.provision_device_credential(target_device_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role text;
    v_hospital_id bigint;
    v_device_hospital_id bigint;
    v_device_status text;
    v_credential_id bigint;
    v_credential_status text;
    v_secret text;
BEGIN
    SELECT up.role, up.hospital_id INTO v_role, v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.status = 'active'
      AND up.role IN ('main_admin', 'hospital_admin');
    IF v_role IS NULL THEN RAISE EXCEPTION 'An active administrator profile is required.'; END IF;

    SELECT d.hospital_id, d.status
    INTO v_device_hospital_id, v_device_status
    FROM public.devices d
    WHERE d.id = target_device_id
      AND (v_role = 'main_admin' OR (v_hospital_id IS NOT NULL AND d.hospital_id = v_hospital_id))
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Device was not found in your permitted scope.'; END IF;
    IF v_device_status IN ('maintenance', 'inactive') THEN
        RAISE EXCEPTION 'A device in maintenance or inactive status cannot receive a credential.';
    END IF;

    SELECT dc.id, dc.status INTO v_credential_id, v_credential_status
    FROM public.device_credentials dc
    WHERE dc.device_id = target_device_id
    FOR UPDATE;
    IF v_credential_status = 'active' THEN
        RAISE EXCEPTION 'Device already has an active credential. Revoke it before rotating.';
    END IF;

    v_secret := encode(extensions.gen_random_bytes(32), 'hex');
    IF v_credential_id IS NULL THEN
        INSERT INTO public.device_credentials (device_id, secret_hash, status, created_by)
        VALUES (
            target_device_id,
            extensions.crypt(v_secret, extensions.gen_salt('bf', 12)),
            'active',
            auth.uid()
        ) RETURNING id INTO v_credential_id;
    ELSE
        UPDATE public.device_credentials
        SET secret_hash = extensions.crypt(v_secret, extensions.gen_salt('bf', 12)),
            status = 'active',
            created_by = auth.uid(),
            created_at = now(),
            last_used_at = NULL,
            revoked_at = NULL
        WHERE id = v_credential_id;
    END IF;

    INSERT INTO public.audit_logs (user_id, hospital_id, action, table_name, record_id, description, metadata)
    VALUES (auth.uid(), v_device_hospital_id, 'device_credential_provisioned', 'device_credentials', v_credential_id,
        'Device credential provisioned or rotated.', jsonb_build_object('device_id', target_device_id));

    RETURN jsonb_build_object(
        'credential_id', v_credential_id,
        'device_id', target_device_id,
        'device_secret', v_secret,
        'warning', 'Store this secret securely. It cannot be retrieved again.'
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.provision_device_credential(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_device_credential(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_audit_log(
    p_action text,
    p_table_name text,
    p_record_id bigint,
    p_description text,
    p_user_id uuid DEFAULT auth.uid(),
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
BEGIN
    SELECT up.hospital_id INTO v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = COALESCE(p_user_id, auth.uid())
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
        COALESCE(p_user_id, auth.uid()),
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
