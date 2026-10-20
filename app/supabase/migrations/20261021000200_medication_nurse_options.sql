-- List nurses from their own assignment rows for patients assigned to the doctor.
-- Hospital nurse and doctor assignments are separate rows in patient_assignments.
CREATE OR REPLACE FUNCTION public.get_my_medication_worklist()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role text;
    v_hospital_id bigint;
    v_doctor_id bigint;
    v_nurse_id bigint;
    v_tasks jsonb;
    v_nurses jsonb;
BEGIN
    SELECT up.role, up.hospital_id
    INTO v_role, v_hospital_id
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.status = 'active'
      AND up.role IN ('doctor', 'nurse');

    IF v_role IS NULL OR v_hospital_id IS NULL THEN
        RAISE EXCEPTION 'An active doctor or nurse profile is required.';
    END IF;

    IF v_role = 'doctor' THEN
        SELECT d.id INTO v_doctor_id
        FROM public.doctors d
        WHERE d.user_id = auth.uid()
          AND d.hospital_id = v_hospital_id
          AND d.status = 'active';
        IF v_doctor_id IS NULL THEN
            RAISE EXCEPTION 'An active doctor staff profile is required.';
        END IF;
    ELSE
        SELECT n.id INTO v_nurse_id
        FROM public.nurses n
        WHERE n.user_id = auth.uid()
          AND n.hospital_id = v_hospital_id
          AND n.status = 'active';
        IF v_nurse_id IS NULL THEN
            RAISE EXCEPTION 'An active nurse staff profile is required.';
        END IF;
    END IF;

    SELECT COALESCE(
        jsonb_agg(to_jsonb(task_rows) ORDER BY task_rows.is_pending DESC, task_rows.scheduled_for, task_rows.id),
        '[]'::jsonb
    )
    INTO v_tasks
    FROM (
        SELECT mt.id, mt.patient_id, p.patient_number,
            concat_ws(' ', p.first_name, p.middle_name, p.last_name) AS patient_name,
            mt.medication_name, mt.dose, mt.route, mt.scheduled_for,
            mt.instructions, mt.status, mt.recorded_at, mt.administration_notes,
            nurse_profile.full_name AS nurse_name,
            (mt.status = 'pending') AS is_pending
        FROM public.medication_tasks mt
        JOIN public.patients p ON p.id = mt.patient_id
        JOIN public.nurses n ON n.id = mt.nurse_id AND n.status = 'active'
        JOIN public.user_profiles nurse_profile
          ON nurse_profile.id = n.user_id AND nurse_profile.status = 'active'
        WHERE p.hospital_id = v_hospital_id
          AND (
              (v_role = 'doctor' AND EXISTS (
                  SELECT 1 FROM public.patient_assignments pa
                  WHERE pa.patient_id = mt.patient_id
                    AND pa.doctor_id = v_doctor_id
                    AND pa.status = 'active'
                    AND pa.start_date <= now()
                    AND (pa.end_date IS NULL OR pa.end_date >= now())
              ))
              OR
              (v_role = 'nurse' AND mt.nurse_id = v_nurse_id AND EXISTS (
                  SELECT 1 FROM public.patient_assignments pa
                  WHERE pa.patient_id = mt.patient_id
                    AND pa.nurse_id = v_nurse_id
                    AND pa.status = 'active'
                    AND pa.start_date <= now()
                    AND (pa.end_date IS NULL OR pa.end_date >= now())
              ))
          )
        ORDER BY (mt.status = 'pending') DESC, mt.scheduled_for, mt.id
        LIMIT 200
    ) task_rows;

    IF v_role = 'doctor' THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(nurse_rows) ORDER BY nurse_rows.patient_id, nurse_rows.name), '[]'::jsonb)
        INTO v_nurses
        FROM (
            SELECT DISTINCT doctor_assignment.patient_id, n.id, nurse_profile.full_name AS name
            FROM public.patient_assignments nurse_assignment
            JOIN public.patients p
              ON p.id = nurse_assignment.patient_id
             AND p.hospital_id = v_hospital_id
            JOIN public.nurses n
              ON n.id = nurse_assignment.nurse_id
             AND n.hospital_id = v_hospital_id
             AND n.status = 'active'
            JOIN public.user_profiles nurse_profile
              ON nurse_profile.id = n.user_id
             AND nurse_profile.status = 'active'
             AND nurse_profile.role = 'nurse'
            JOIN public.patient_assignments doctor_assignment
              ON doctor_assignment.patient_id = nurse_assignment.patient_id
             AND doctor_assignment.doctor_id = v_doctor_id
             AND doctor_assignment.status = 'active'
             AND doctor_assignment.start_date <= now()
             AND (doctor_assignment.end_date IS NULL OR doctor_assignment.end_date >= now())
            WHERE nurse_assignment.nurse_id IS NOT NULL
              AND nurse_assignment.status = 'active'
              AND nurse_assignment.start_date <= now()
              AND (nurse_assignment.end_date IS NULL OR nurse_assignment.end_date >= now())
        ) nurse_rows;
    ELSE
        v_nurses := '[]'::jsonb;
    END IF;

    RETURN jsonb_build_object('tasks', v_tasks, 'nurses', v_nurses);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_medication_worklist() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_medication_worklist() TO authenticated;
