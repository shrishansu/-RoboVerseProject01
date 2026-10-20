-- Grant device-ingest service access only to the columns used by its
-- authenticated device and assigned-patient checks and metadata writes.
GRANT SELECT (id, hospital_id, assigned_patient_id, status)
  ON TABLE public.devices TO service_role;
GRANT UPDATE (last_seen_at, status)
  ON TABLE public.devices TO service_role;

GRANT SELECT (id, hospital_id, status)
  ON TABLE public.patients TO service_role;
