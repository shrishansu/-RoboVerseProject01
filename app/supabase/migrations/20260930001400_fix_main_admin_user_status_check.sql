-- Use an unambiguous PL/pgSQL variable so the authenticated profile role is checked.

CREATE OR REPLACE FUNCTION public.update_user_status(
    target_user_id uuid,
    new_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_actor_role text;
    v_target_role text;
    v_old_status text;
    v_target_email text;
    v_result jsonb;
BEGIN
    SELECT up.role
    INTO v_actor_role
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.status = 'active';

    IF v_actor_role IS DISTINCT FROM 'main_admin' THEN
        RAISE EXCEPTION 'Only an active Main Administrator can change user status.';
    END IF;

    IF new_status IS NULL OR new_status NOT IN (
        'active',
        'inactive',
        'suspended',
        'locked'
    ) THEN
        RAISE EXCEPTION 'Invalid user status.';
    END IF;

    SELECT up.role, up.status, up.email
    INTO v_target_role, v_old_status, v_target_email
    FROM public.user_profiles up
    WHERE up.id = target_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target user profile does not exist.';
    END IF;

    IF target_user_id = auth.uid() THEN
        RAISE EXCEPTION 'You cannot change the status of your own account.';
    END IF;

    UPDATE public.user_profiles
    SET status = new_status,
        updated_at = now()
    WHERE id = target_user_id;

    INSERT INTO public.audit_logs (
        user_id,
        action,
        table_name,
        record_id,
        description,
        metadata
    )
    VALUES (
        auth.uid(),
        'UPDATE_USER_STATUS',
        'user_profiles',
        NULL,
        'Main Administrator changed a user account status.',
        jsonb_build_object(
            'target_user_id', target_user_id,
            'target_email', v_target_email,
            'target_role', v_target_role,
            'old_status', v_old_status,
            'new_status', new_status
        )
    );

    v_result := jsonb_build_object(
        'success', true,
        'user_id', target_user_id,
        'email', v_target_email,
        'role', v_target_role,
        'old_status', v_old_status,
        'new_status', new_status
    );

    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_user_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_user_status(uuid, text) TO authenticated;
