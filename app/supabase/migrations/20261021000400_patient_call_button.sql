-- Private Telegram contact registration and patient call alert support.
-- This migration adds objects only, except for safely widening relevant
-- existing CHECK constraints when those constraints reject the new values.

CREATE TABLE IF NOT EXISTS public.staff_telegram_contacts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_chat_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_telegram_contacts_chat_id_format
    CHECK (telegram_chat_id ~ '^-?[0-9]{5,20}$')
);

ALTER TABLE public.staff_telegram_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staff_telegram_contacts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staff_telegram_contacts TO service_role;

CREATE OR REPLACE FUNCTION public.set_my_telegram_chat_id(p_chat_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;
  IF p_chat_id IS NULL OR p_chat_id !~ '^-?[0-9]{5,20}$' THEN
    RAISE EXCEPTION 'Telegram chat ID must be 5 to 20 digits, optionally prefixed by a minus sign.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = v_user_id AND up.status = 'active'
      AND up.role IN ('doctor', 'nurse')
      AND (
        (up.role = 'doctor' AND EXISTS (
          SELECT 1 FROM public.doctors d WHERE d.user_id = v_user_id AND d.status = 'active'
        ))
        OR (up.role = 'nurse' AND EXISTS (
          SELECT 1 FROM public.nurses n WHERE n.user_id = v_user_id AND n.status = 'active'
        ))
      )
  ) THEN
    RAISE EXCEPTION 'An active doctor or nurse profile is required.';
  END IF;

  INSERT INTO public.staff_telegram_contacts (user_id, telegram_chat_id, updated_at)
  VALUES (v_user_id, p_chat_id, now())
  ON CONFLICT (user_id) DO UPDATE
    SET telegram_chat_id = EXCLUDED.telegram_chat_id,
        updated_at = EXCLUDED.updated_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_my_telegram_chat_id(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_my_telegram_chat_id(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_telegram_chat_id()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_chat_id text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = v_user_id AND up.status = 'active'
      AND up.role IN ('doctor', 'nurse')
      AND (
        (up.role = 'doctor' AND EXISTS (
          SELECT 1 FROM public.doctors d WHERE d.user_id = v_user_id AND d.status = 'active'
        ))
        OR (up.role = 'nurse' AND EXISTS (
          SELECT 1 FROM public.nurses n WHERE n.user_id = v_user_id AND n.status = 'active'
        ))
      )
  ) THEN
    RAISE EXCEPTION 'An active doctor or nurse profile is required.';
  END IF;

  SELECT contact.telegram_chat_id INTO v_chat_id
  FROM public.staff_telegram_contacts contact
  WHERE contact.user_id = v_user_id;
  RETURN v_chat_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_telegram_chat_id() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_telegram_chat_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_patient_alert_recipients(p_patient_id bigint)
RETURNS TABLE(user_id uuid, role text, full_name text, telegram_chat_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT DISTINCT recipient.user_id, recipient.role, recipient.full_name, recipient.telegram_chat_id
  FROM (
    SELECT d.user_id, 'doctor'::text AS role, up.full_name, contact.telegram_chat_id
    FROM public.patient_assignments pa
    JOIN public.patients p ON p.id = pa.patient_id
    JOIN public.doctors d ON d.id = pa.doctor_id
    JOIN public.user_profiles up ON up.id = d.user_id
    LEFT JOIN public.staff_telegram_contacts contact ON contact.user_id = d.user_id
    WHERE pa.patient_id = p_patient_id AND pa.status = 'active'
      AND pa.start_date <= current_date
      AND (pa.end_date IS NULL OR pa.end_date >= current_date)
      AND d.status = 'active' AND up.status = 'active' AND up.role = 'doctor'
      AND d.hospital_id = p.hospital_id AND up.hospital_id = p.hospital_id

    UNION ALL

    SELECT n.user_id, 'nurse'::text AS role, up.full_name, contact.telegram_chat_id
    FROM public.patient_assignments pa
    JOIN public.patients p ON p.id = pa.patient_id
    JOIN public.nurses n ON n.id = pa.nurse_id
    JOIN public.user_profiles up ON up.id = n.user_id
    LEFT JOIN public.staff_telegram_contacts contact ON contact.user_id = n.user_id
    WHERE pa.patient_id = p_patient_id AND pa.status = 'active'
      AND pa.start_date <= current_date
      AND (pa.end_date IS NULL OR pa.end_date >= current_date)
      AND n.status = 'active' AND up.status = 'active' AND up.role = 'nurse'
      AND n.hospital_id = p.hospital_id AND up.hospital_id = p.hospital_id
  ) recipient;
$function$;

REVOKE ALL ON FUNCTION public.get_patient_alert_recipients(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_patient_alert_recipients(bigint) TO service_role;

-- Preserve each existing CHECK expression and widen only checks that involve
-- the event/severity columns. Refuse unusual mixed-column checks rather than
-- silently weakening an unrelated constraint.
DO $constraints$
DECLARE
  v_check record;
  v_predicate text;
  v_target_names text[];
  v_referenced_names text[];
  v_expression text;
  v_needs_extension boolean;
  v_constraint_definition text;
BEGIN
  FOR v_check IN
    SELECT c.oid, c.conrelid, c.conname, c.conkey,
           n.nspname, r.relname,
           pg_catalog.pg_get_constraintdef(c.oid, true) AS definition
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class r ON r.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
    WHERE c.contype = 'c'
      AND n.nspname = 'public'
      AND r.relname IN ('alerts', 'notifications')
  LOOP
    SELECT array_agg(a.attname::text ORDER BY a.attname::text)
      INTO v_referenced_names
    FROM unnest(v_check.conkey) AS key(attnum)
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = v_check.conrelid AND a.attnum = key.attnum;

    IF v_check.relname = 'alerts' THEN
      v_target_names := ARRAY['alert_type', 'severity']::text[];
    ELSE
      v_target_names := ARRAY['notification_type', 'severity']::text[];
    END IF;
    IF NOT (v_referenced_names && v_target_names) THEN
      CONTINUE;
    END IF;
    IF NOT (v_referenced_names <@ v_target_names) THEN
      RAISE EXCEPTION 'Cannot safely extend CHECK constraint %.%: it also covers unrelated columns.',
        v_check.relname, v_check.conname;
    END IF;

    v_predicate := NULL;
    IF v_check.relname = 'alerts' THEN
      IF 'alert_type' = ANY(v_referenced_names) THEN
        v_predicate := 'alert_type = ''patient_call''';
      END IF;
      IF 'severity' = ANY(v_referenced_names) THEN
        v_predicate := concat_ws(' AND ', v_predicate, 'severity = ''critical''');
      END IF;
    ELSE
      IF 'notification_type' = ANY(v_referenced_names) THEN
        v_predicate := 'notification_type = ''alert''';
      END IF;
      IF 'severity' = ANY(v_referenced_names) THEN
        v_predicate := concat_ws(' AND ', v_predicate, 'severity = ''critical''');
      END IF;
    END IF;

    v_needs_extension := false;
    IF v_check.relname = 'alerts' THEN
      IF 'alert_type' = ANY(v_referenced_names) AND position('patient_call' IN lower(v_check.definition)) = 0 THEN
        v_needs_extension := true;
      END IF;
      IF 'severity' = ANY(v_referenced_names) AND position('critical' IN lower(v_check.definition)) = 0 THEN
        v_needs_extension := true;
      END IF;
    ELSE
      IF 'severity' = ANY(v_referenced_names) AND position('critical' IN lower(v_check.definition)) = 0 THEN
        v_needs_extension := true;
      END IF;
    END IF;
    IF NOT v_needs_extension THEN
      CONTINUE;
    END IF;

    v_expression := regexp_replace(v_check.definition, '^CHECK\s*\((.*)\)$', '\1', 'i');
    IF v_expression = v_check.definition THEN
      RAISE EXCEPTION 'Cannot parse CHECK constraint %.%.', v_check.relname, v_check.conname;
    END IF;
    v_constraint_definition := format('CHECK ((%s) OR (%s))', v_expression, v_predicate);
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', v_check.nspname, v_check.relname, v_check.conname);
    EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s',
      v_check.nspname, v_check.relname, v_check.conname, v_constraint_definition);
  END LOOP;
END;
$constraints$;

NOTIFY pgrst, 'reload schema';
