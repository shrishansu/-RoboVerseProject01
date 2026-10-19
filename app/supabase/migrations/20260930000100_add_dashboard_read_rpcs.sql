-- Narrow, server-side read APIs for dashboards.
-- The linked project intentionally has no direct SELECT grants to authenticated;
-- keep data access behind role-checked functions instead of granting table access.

CREATE OR REPLACE FUNCTION public.get_main_admin_alert_overview(
    p_limit integer DEFAULT 100
)
RETURNS TABLE (
    id bigint,
    alert_type text,
    severity text,
    status text,
    created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.id = auth.uid()
          AND up.role = 'main_admin'
          AND up.status = 'active'
    ) THEN
        RAISE EXCEPTION 'Active main administrator access required.';
    END IF;

    RETURN QUERY
    SELECT a.id, a.alert_type, a.severity, a.status, a.created_at
    FROM public.alerts a
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 100));
END;
$function$;

REVOKE ALL ON FUNCTION public.get_main_admin_alert_overview(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_main_admin_alert_overview(integer) TO authenticated;


CREATE OR REPLACE FUNCTION public.get_main_admin_audit_logs(
    p_limit integer DEFAULT 100
)
RETURNS TABLE (
    id bigint,
    action text,
    table_name text,
    record_id bigint,
    user_id uuid,
    created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.id = auth.uid()
          AND up.role = 'main_admin'
          AND up.status = 'active'
    ) THEN
        RAISE EXCEPTION 'Active main administrator access required.';
    END IF;

    RETURN QUERY
    SELECT al.id, al.action, al.table_name, al.record_id, al.user_id, al.created_at
    FROM public.audit_logs al
    ORDER BY al.created_at DESC, al.id DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 100));
END;
$function$;

REVOKE ALL ON FUNCTION public.get_main_admin_audit_logs(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_main_admin_audit_logs(integer) TO authenticated;


CREATE OR REPLACE FUNCTION public.get_my_clinical_dashboard(
    p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_role text;
    v_hospital_id bigint;
    v_staff_exists boolean;
    v_patients jsonb;
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
        SELECT EXISTS (
            SELECT 1
            FROM public.doctors d
            WHERE d.user_id = auth.uid()
              AND d.hospital_id = v_hospital_id
              AND d.status = 'active'
        ) INTO v_staff_exists;
    ELSE
        SELECT EXISTS (
            SELECT 1
            FROM public.nurses n
            WHERE n.user_id = auth.uid()
              AND n.hospital_id = v_hospital_id
              AND n.status = 'active'
        ) INTO v_staff_exists;
    END IF;

    IF NOT v_staff_exists THEN
        RETURN jsonb_build_object(
            'patients', '[]'::jsonb,
            'staff_profile_missing', true
        );
    END IF;

    WITH my_assignments AS (
        SELECT DISTINCT ON (pa.patient_id)
            pa.patient_id,
            pa.bed_id,
            pa.ward_id,
            pa.start_date,
            pa.id
        FROM public.patient_assignments pa
        JOIN public.patients assigned_patient
          ON assigned_patient.id = pa.patient_id
        WHERE pa.status = 'active'
          AND pa.start_date <= now()
          AND (pa.end_date IS NULL OR pa.end_date >= now())
          AND assigned_patient.hospital_id = v_hospital_id
          AND (
              (v_role = 'doctor' AND EXISTS (
                  SELECT 1
                  FROM public.doctors d
                  WHERE d.id = pa.doctor_id
                    AND d.user_id = auth.uid()
                    AND d.hospital_id = v_hospital_id
                    AND d.status = 'active'
              ))
              OR
              (v_role = 'nurse' AND EXISTS (
                  SELECT 1
                  FROM public.nurses n
                  WHERE n.id = pa.nurse_id
                    AND n.user_id = auth.uid()
                    AND n.hospital_id = v_hospital_id
                    AND n.status = 'active'
              ))
          )
        ORDER BY pa.patient_id, pa.start_date DESC, pa.id DESC
    ), patient_rows AS (
        SELECT
            p.id,
            p.patient_number,
            p.first_name,
            p.middle_name,
            p.last_name,
            p.status,
            COALESCE(b.bed_number, '') AS bed_number,
            COALESCE(w.name, '') AS ward_name,
            latest_reading.reading AS latest_reading,
            active_alerts.alerts AS alerts,
            concat_ws(' ', p.first_name, p.middle_name, p.last_name) AS patient_name
        FROM my_assignments ma
        JOIN public.patients p ON p.id = ma.patient_id
        LEFT JOIN LATERAL (
            SELECT ad.bed_id, ad.ward_id
            FROM public.admissions ad
            WHERE ad.patient_id = p.id
              AND ad.status = 'admitted'
            ORDER BY ad.admission_date DESC, ad.id DESC
            LIMIT 1
        ) current_admission ON true
        LEFT JOIN public.beds b
          ON b.id = COALESCE(ma.bed_id, current_admission.bed_id)
        LEFT JOIN public.wards w
          ON w.id = COALESCE(ma.ward_id, current_admission.ward_id, b.ward_id)
        LEFT JOIN LATERAL (
            SELECT jsonb_build_object(
                'recorded_at', vr.recorded_at,
                'heart_rate', vr.heart_rate,
                'spo2', vr.spo2,
                'temperature', vr.temperature,
                'respiratory_rate', vr.respiratory_rate,
                'systolic_bp', vr.systolic_bp,
                'diastolic_bp', vr.diastolic_bp,
                'ecg_value', vr.ecg_value
            ) AS reading
            FROM public.vital_readings vr
            WHERE vr.patient_id = p.id
            ORDER BY vr.recorded_at DESC, vr.id DESC
            LIMIT 1
        ) latest_reading ON true
        LEFT JOIN LATERAL (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'id', alert_rows.id,
                        'title', alert_rows.title,
                        'alert_type', alert_rows.alert_type,
                        'severity', alert_rows.severity,
                        'status', alert_rows.status,
                        'created_at', alert_rows.created_at,
                        'value', alert_rows.value
                    ) ORDER BY alert_rows.created_at DESC
                ),
                '[]'::jsonb
            ) AS alerts
            FROM (
                SELECT a.id, a.title, a.alert_type, a.severity, a.status, a.created_at, a.value
                FROM public.alerts a
                WHERE a.patient_id = p.id
                  AND a.status IN ('active', 'acknowledged')
                ORDER BY a.created_at DESC, a.id DESC
                LIMIT 20
            ) alert_rows
        ) active_alerts ON true
        ORDER BY patient_name, p.id
        LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 200))
    )
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', pr.id,
                'patient_number', pr.patient_number,
                'first_name', pr.first_name,
                'middle_name', pr.middle_name,
                'last_name', pr.last_name,
                'status', pr.status,
                'bed_number', pr.bed_number,
                'ward_name', pr.ward_name,
                'latest_reading', pr.latest_reading,
                'alerts', pr.alerts
            ) ORDER BY pr.patient_name, pr.id
        ),
        '[]'::jsonb
    )
    INTO v_patients
    FROM patient_rows pr;

    RETURN jsonb_build_object(
        'patients', v_patients,
        'staff_profile_missing', false
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_clinical_dashboard(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_clinical_dashboard(integer) TO authenticated;
