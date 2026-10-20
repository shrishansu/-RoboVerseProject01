-- Keep direct ECG access closed to browser roles while allowing the
-- device-ingest Edge Function's service_role client to persist raw batches.
-- The explicit policy also covers projects where the table uses FORCE RLS.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT INSERT ON TABLE public.device_ecg_batches TO service_role;

DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'device_ecg_batches'
      AND policyname = 'device_ecg_batches_service_insert'
  ) THEN
    CREATE POLICY device_ecg_batches_service_insert
      ON public.device_ecg_batches
      FOR INSERT
      TO service_role
      WITH CHECK (true);
  END IF;
END;
$policy$;

ALTER TABLE public.device_ecg_batches ENABLE ROW LEVEL SECURITY;
