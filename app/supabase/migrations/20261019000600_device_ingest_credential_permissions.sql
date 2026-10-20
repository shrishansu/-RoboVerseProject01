-- The device-ingest Edge Function uses the service role to authenticate a
-- device. Grant only the credential columns it reads and the timestamp it
-- updates; never grant access to anon or authenticated browser clients.
GRANT SELECT (id, device_id, secret_hash, status)
  ON TABLE public.device_credentials TO service_role;

GRANT UPDATE (last_used_at)
  ON TABLE public.device_credentials TO service_role;
