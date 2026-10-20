-- Device configuration is only available through administrator RPCs and the
-- authenticated device-config Edge Function. Browser table access stays closed.
CREATE TABLE IF NOT EXISTS public.device_measurement_configs (
  device_id bigint PRIMARY KEY REFERENCES public.devices(id) ON DELETE CASCADE,
  configuration jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE public.device_measurement_configs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_measurement_configs FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_device_measurement_config(p_device_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_role text; v_hospital_id bigint; v_config jsonb; v_version integer;
BEGIN
  SELECT role, hospital_id INTO v_role, v_hospital_id FROM public.user_profiles
  WHERE id = auth.uid() AND status = 'active' AND role IN ('main_admin','hospital_admin');
  IF v_role IS NULL THEN RAISE EXCEPTION 'An active administrator profile is required.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.devices d WHERE d.id = p_device_id
      AND (v_role = 'main_admin' OR d.hospital_id = v_hospital_id)) THEN
    RAISE EXCEPTION 'Device was not found in your permitted scope.';
  END IF;
  SELECT configuration, version INTO v_config, v_version
  FROM public.device_measurement_configs WHERE device_id = p_device_id;
  RETURN jsonb_build_object('device_id',p_device_id,'version',COALESCE(v_version,0),
    'configuration',COALESCE(v_config,'{"configurationEnabled":false,"measurementDurationSeconds":15,"measurementIntervalSeconds":60,"calculationWindowSeconds":10,"uploadIntervalSeconds":60,"automaticUpload":true,"modules":{"MAX30102":{"enabled":false,"samplingRateHz":100,"sampleAverage":4},"AD8232":{"enabled":false,"samplingRateHz":250},"MLX90614":{"enabled":false,"measurementIntervalSeconds":60},"HX711":{"enabled":false,"measurementIntervalSeconds":60,"calibrationStatus":"uncalibrated","calibrationFactor":null},"MPU6050":{"enabled":false,"samplingRateHz":100,"accelerationEnabled":true,"gyroscopeEnabled":true}}}'::jsonb));
END; $function$;

CREATE OR REPLACE FUNCTION public.save_device_measurement_config(p_device_id bigint,p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_role text; v_hospital_id bigint; v_version integer;
BEGIN
  SELECT role, hospital_id INTO v_role, v_hospital_id FROM public.user_profiles
  WHERE id = auth.uid() AND status = 'active' AND role IN ('main_admin','hospital_admin');
  IF v_role IS NULL THEN RAISE EXCEPTION 'An active administrator profile is required.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.devices d WHERE d.id = p_device_id
      AND (v_role = 'main_admin' OR d.hospital_id = v_hospital_id)) THEN
    RAISE EXCEPTION 'Device was not found in your permitted scope.';
  END IF;
  IF jsonb_typeof(p_config) IS DISTINCT FROM 'object'
    OR NOT (p_config ?& ARRAY['configurationEnabled','measurementDurationSeconds','measurementIntervalSeconds','calculationWindowSeconds','uploadIntervalSeconds','automaticUpload','modules'])
    OR jsonb_typeof(p_config->'modules') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_config->'configurationEnabled') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_config->'automaticUpload') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_config->'measurementDurationSeconds') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_config->'measurementIntervalSeconds') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_config->'calculationWindowSeconds') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_config->'uploadIntervalSeconds') IS DISTINCT FROM 'number'
    OR (p_config->>'measurementDurationSeconds')::integer NOT BETWEEN 1 AND 300
    OR (p_config->>'measurementIntervalSeconds')::integer NOT BETWEEN 1 AND 86400
    OR (p_config->>'calculationWindowSeconds')::integer NOT BETWEEN 1 AND 300
    OR (p_config->>'uploadIntervalSeconds')::integer NOT BETWEEN 1 AND 86400
    OR (p_config->>'calculationWindowSeconds')::integer > (p_config->>'measurementDurationSeconds')::integer
    OR (p_config->>'measurementDurationSeconds')::integer > (p_config->>'measurementIntervalSeconds')::integer
  THEN RAISE EXCEPTION 'Invalid device measurement configuration.'; END IF;
  INSERT INTO public.device_measurement_configs(device_id,configuration,version,updated_at,updated_by)
  VALUES(p_device_id,p_config,1,now(),auth.uid())
  ON CONFLICT(device_id) DO UPDATE SET configuration=excluded.configuration,
    version=public.device_measurement_configs.version+1,updated_at=now(),updated_by=auth.uid()
  RETURNING version INTO v_version;
  RETURN jsonb_build_object('device_id',p_device_id,'version',v_version,'configuration',p_config);
END; $function$;

REVOKE ALL ON FUNCTION public.get_device_measurement_config(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_device_measurement_config(bigint,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_device_measurement_config(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_device_measurement_config(bigint,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
