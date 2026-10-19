# Linked Supabase security audit

Reviewed the linked project's public schema metadata, RLS policies, access-helper function definitions, and effective table privileges on 2026-09-29. Queries read catalog metadata only; no patient rows were queried and no remote database objects were changed. The attached schema export was also used to check column shapes.

## Positive findings

- RLS is enabled on all 22 public base tables observed.
- Authenticated direct table privileges are absent for core tables including patients, assignments, vital readings, alerts, and audit logs. UI data access should use narrowly scoped RPCs rather than broad table grants.
- `device_credentials` has RLS enabled and no authenticated policies, keeping credentials unavailable through ordinary authenticated table access.
- Audit logs deny authenticated direct inserts, updates, and deletes. Main administrators and hospital administrators can read system-wide or own-hospital audit rows respectively.
- Doctor and nurse patient policies call `can_access_patient`; that helper checks the user's active staff record, hospital boundary, and assignment/access grant.

## Policy conflicts with the product specification

1. **Receptionist admissions are not hospital-scoped.** The `Receptionists can manage admissions` policy permits all admission rows when the caller's role is `receptionist`, without checking `hospital_id`. The `admissions` table includes `diagnosis`, `reason`, and `notes`, so this exposes cross-hospital records and clinical fields to receptionists.
2. **Admin clinical access is currently enabled.** `can_access_patient` returns true for main administrators and for hospital administrators for every patient in their hospital. Separate `ALL` policies also grant those roles access to `clinical_records`, `medical_reports`, `vital_readings`, and `alerts`. The PDF marks admin clinical access as undecided and gives “no” as its default.
3. **Access-request grants bypass normal assignment.** For doctors and nurses, `can_access_patient` accepts either an active assignment or an approved patient access request. The PDF says break-glass/covering access defaults to no until decided. Confirm whether existing approved requests are intended to remain.
4. **Hospital isolation varies by table.** Some policies compare a row's `hospital_id` to the signed-in user's hospital; others call `get_patient_hospital_id`. The receptionist admissions policy does neither. Each affected policy needs tests for cross-hospital reads and writes.

## Required next work

- Resolve admin access and break-glass/access-request decisions before changing clinical RLS.
- Replace receptionist admissions access with a hospital-scoped, identity-only interface. Row filters alone are not enough while clinical columns remain directly selectable.
- Export and commit the existing SQL definitions before making policy changes. The generated TypeScript snapshot contains column and RPC signatures, not grants, RLS, triggers, or function bodies.
- Add automated SQL/RLS tests for every role and hospital boundary, then deploy reviewed migrations through a controlled database workflow.

## Local remediation draft

`supabase/migrations/20260930000300_harden_patient_access_policies.sql` drafts the default-deny changes: it removes broad administrator access to patient/appointment/discharge/access-request data, removes the receptionist's unscoped admissions/appointment/discharge policies, limits alert notifications to active assigned doctors/nurses, and removes administrator / approved-request bypasses from `can_access_patient`. It is local only and has not been SQL-linted or deployed because local Postgres is unavailable and linked lint returned a transport error. Treat the findings above as the current live state until a reviewed migration is applied and verified.

No patient or account data is included in this report.
