-- Apply the specification's default-deny decisions for administrator clinical
-- access and break-glass access. Keep clinical access tied to an active assignment.

CREATE OR REPLACE FUNCTION public.can_access_patient(
    target_patient_id bigint,
    required_access_level text DEFAULT 'basic'::text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF required_access_level IS NULL
       OR required_access_level NOT IN ('basic', 'vitals', 'medical', 'reports') THEN
        RETURN FALSE;
    END IF;

    IF NOT (public.is_current_doctor() OR public.is_current_nurse()) THEN
        RETURN FALSE;
    END IF;

    -- has_active_patient_assignment verifies the active doctor/nurse profile,
    -- assignment dates, patient hospital, and the caller's hospital.
    -- Main/hospital admins and approved access requests receive no clinical access.
    RETURN public.has_active_patient_assignment(target_patient_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.can_access_patient(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_patient(bigint, text) TO authenticated;

-- Remove broad clinical-data access from administrators. Server-side RPCs must
-- expose only the fields each administrative screen requires.
DROP POLICY IF EXISTS "Main Admin can manage patients" ON public.patients;
DROP POLICY IF EXISTS "Hospital Admin can manage own patients" ON public.patients;

DROP POLICY IF EXISTS "Main Admin can manage admissions" ON public.admissions;
DROP POLICY IF EXISTS "Hospital Admin can manage own admissions" ON public.admissions;
DROP POLICY IF EXISTS "Receptionists can manage admissions" ON public.admissions;
DROP POLICY IF EXISTS "Main Admin can manage discharges" ON public.discharges;

DROP POLICY IF EXISTS "Main Admin can manage vital readings" ON public.vital_readings;
DROP POLICY IF EXISTS "Hospital Admin can manage own vital readings" ON public.vital_readings;

DROP POLICY IF EXISTS "Main Admin can manage alerts" ON public.alerts;
DROP POLICY IF EXISTS "Hospital Admin can manage own alerts" ON public.alerts;

DROP POLICY IF EXISTS "Main Admin can manage clinical records" ON public.clinical_records;
DROP POLICY IF EXISTS "Hospital Admin can manage own clinical records" ON public.clinical_records;

DROP POLICY IF EXISTS "Main Admin can manage medical reports" ON public.medical_reports;
DROP POLICY IF EXISTS "Hospital Admin can manage own medical reports" ON public.medical_reports;
DROP POLICY IF EXISTS "Hospital Admin can manage own discharges" ON public.discharges;

-- Appointment reason/notes and access-request justification may contain clinical
-- details. Provide restricted RPCs before restoring administrator access.
DROP POLICY IF EXISTS "Main Admin can manage appointments" ON public.appointments;
DROP POLICY IF EXISTS "Hospital Admin can manage own appointments" ON public.appointments;
DROP POLICY IF EXISTS "Receptionists can manage appointments" ON public.appointments;
DROP POLICY IF EXISTS "Main Admin can manage access requests" ON public.patient_access_requests;
DROP POLICY IF EXISTS "Hospital Admin can manage access requests" ON public.patient_access_requests;
DROP POLICY IF EXISTS "Hospital Admin can manage own patient access requests" ON public.patient_access_requests;
DROP POLICY IF EXISTS "Receptionists can manage discharges" ON public.discharges;

-- Alert notifications may include patient identifiers and clinical alert text.
-- Administrators receive no alert notification rows; only the assigned clinical team.
DROP POLICY IF EXISTS "Main admins can view all notifications" ON public.notifications;
DROP POLICY IF EXISTS "Hospital admins can view hospital notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Active clinical staff can view own notifications"
ON public.notifications
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
    AND EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.id = auth.uid()
          AND up.status = 'active'
          AND up.role IN ('doctor', 'nurse', 'receptionist')
    )
);

-- A historic admission policy used admitting_doctor_id alone, which could leave
-- access in place after an assignment ended. Require current patient assignment.
DROP POLICY IF EXISTS "Doctors can view assigned admissions" ON public.admissions;
CREATE POLICY "Assigned doctors can view patient admissions"
ON public.admissions
FOR SELECT
TO authenticated
USING (
    public.is_current_doctor()
    AND public.can_access_patient(patient_id, 'basic')
);

DROP POLICY IF EXISTS "Doctors can view assigned discharges" ON public.discharges;
CREATE POLICY "Assigned doctors can view patient discharges"
ON public.discharges
FOR SELECT
TO authenticated
USING (
    public.is_current_doctor()
    AND EXISTS (
        SELECT 1
        FROM public.admissions ad
        WHERE ad.id = discharges.admission_id
          AND public.can_access_patient(ad.patient_id, 'medical')
    )
);

DROP POLICY IF EXISTS "Doctors can view their appointments" ON public.appointments;
CREATE POLICY "Active doctors can view their appointments"
ON public.appointments
FOR SELECT
TO authenticated
USING (
    public.is_current_doctor()
    AND EXISTS (
        SELECT 1
        FROM public.doctors d
        WHERE d.id = appointments.doctor_id
          AND d.user_id = auth.uid()
          AND d.status = 'active'
          AND d.hospital_id = public.get_current_user_hospital_id()
          AND public.get_patient_hospital_id(appointments.patient_id) = d.hospital_id
    )
);

-- Do not include hospital administrators in patient alert delivery. The
-- previous trigger copied patient id, alert title, and message to admins.
CREATE OR REPLACE FUNCTION public.create_alert_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_patient_hospital_id bigint;
BEGIN
    SELECT p.hospital_id
    INTO v_patient_hospital_id
    FROM public.patients p
    WHERE p.id = NEW.patient_id;

    IF v_patient_hospital_id IS NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.notifications (
        user_id, patient_id, alert_id, notification_type, title, message, severity
    )
    SELECT DISTINCT
        d.user_id, NEW.patient_id, NEW.id, 'alert', NEW.title, NEW.message, NEW.severity
    FROM public.patient_assignments pa
    JOIN public.doctors d ON d.id = pa.doctor_id
    JOIN public.user_profiles up ON up.id = d.user_id
    WHERE pa.patient_id = NEW.patient_id
      AND pa.status = 'active'
      AND pa.start_date <= now()
      AND (pa.end_date IS NULL OR pa.end_date >= now())
      AND d.status = 'active'
      AND d.hospital_id = v_patient_hospital_id
      AND up.role = 'doctor'
      AND up.status = 'active'
      AND up.hospital_id = v_patient_hospital_id;

    INSERT INTO public.notifications (
        user_id, patient_id, alert_id, notification_type, title, message, severity
    )
    SELECT DISTINCT
        n.user_id, NEW.patient_id, NEW.id, 'alert', NEW.title, NEW.message, NEW.severity
    FROM public.patient_assignments pa
    JOIN public.nurses n ON n.id = pa.nurse_id
    JOIN public.user_profiles up ON up.id = n.user_id
    WHERE pa.patient_id = NEW.patient_id
      AND pa.status = 'active'
      AND pa.start_date <= now()
      AND (pa.end_date IS NULL OR pa.end_date >= now())
      AND n.status = 'active'
      AND n.hospital_id = v_patient_hospital_id
      AND up.role = 'nurse'
      AND up.status = 'active'
      AND up.hospital_id = v_patient_hospital_id;

    RETURN NEW;
END;
$function$;
