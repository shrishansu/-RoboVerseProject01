GRANT INSERT, DELETE ON TABLE public.doctors, public.nurses TO service_role;
GRANT INSERT ON TABLE public.audit_logs TO service_role;
GRANT USAGE ON SEQUENCE public.doctors_id_seq, public.nurses_id_seq, public.audit_logs_id_seq TO service_role;