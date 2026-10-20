-- Requires 20261019000400_device_reading_metadata.sql. The ingest function
-- inserts the base row through record_vital_reading, then writes only sensor
-- metadata through PostgREST using service_role.
GRANT SELECT (id, device_id)
  ON TABLE public.vital_readings TO service_role;

GRANT UPDATE (red_raw, ir_raw, signal_quality, signal_valid, configuration_version, ingestion_id)
  ON TABLE public.vital_readings TO service_role;
