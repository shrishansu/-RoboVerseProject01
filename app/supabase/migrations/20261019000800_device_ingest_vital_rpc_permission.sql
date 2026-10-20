-- The Edge Function calls this existing SECURITY DEFINER RPC with the
-- service-role client after authenticating the device and assigned patient.
-- Grant only execution on the existing function to the server-side role.
GRANT EXECUTE ON FUNCTION public.record_vital_reading(
  bigint,
  bigint,
  timestamptz,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  text
) TO service_role;
