-- The provisioner stores bcrypt hashes using extensions.crypt(...,
-- extensions.gen_salt()). Do not replace an existing verifier body without
-- first reviewing it; create this implementation only if the RPC is absent.
DO $migration$
BEGIN
  IF to_regprocedure('extensions.crypt(text,text)') IS NULL THEN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pgcrypto') THEN
      RAISE EXCEPTION 'pgcrypto is installed outside the extensions schema; inspect the live extension location before changing it.';
    END IF;
    EXECUTE 'CREATE EXTENSION pgcrypto WITH SCHEMA extensions';
  END IF;

  IF to_regprocedure('public.verify_device_secret(text,text)') IS NULL THEN
    EXECUTE $definition$
      CREATE FUNCTION public.verify_device_secret(
        target_secret text,
        target_hash text
      )
      RETURNS boolean
      LANGUAGE sql
      IMMUTABLE
      SECURITY DEFINER
      SET search_path = ''
      AS $body$
        SELECT COALESCE(extensions.crypt(target_secret, target_hash) = target_hash, false)
      $body$
    $definition$;
  END IF;
END;
$migration$;

REVOKE ALL ON FUNCTION public.verify_device_secret(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_device_secret(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
