# RoboVerse implementation status

This is a staged implementation audit against `RoboVerse_System_README.pdf` and the linked Supabase schema snapshot provided for this review. It describes what is in the repository now; it does not claim the complete product is finished.

## Working in the repository

- React 19 / Vite app with login, Supabase session loading, active-profile validation, role-aware routes, and lazy-loaded pages.
- Main administrator dashboard and user-management screen use existing Supabase RPCs / Edge Function.
- Hospital-admin dashboard now loads hospital name and aggregate patient, admission, staff, bed, and active-alert counts through a role-checked summary RPC; it no longer shows sample values or a fabricated hospital name.
- Hospital admins can locally list departments, wards, and beds; create new departments/wards/beds; and change a non-occupied bed to available, reserved, maintenance, or inactive. Every RPC checks the admin's hospital, omits patient identities, and audits mutations. These actions depend on migration 005 and are not deployed.
- Doctor and nurse screens share an assignment-scoped monitoring dashboard. It shows patient identity, latest vital reading, active alerts, and acknowledge/resolve actions. It calls the new `get_my_clinical_dashboard` RPC and refreshes every 30 seconds.
- Main administrator alert and audit screens use privacy-limited `get_main_admin_alert_overview` and `get_main_admin_audit_logs` RPCs. The alert list omits patient identifiers and clinical values.
- Reception now has hospital-scoped patient search, identity registration, available-bed lookup, admission, and bed-transfer actions. The admission RPC rechecks hospital ownership and bed availability under row locks, then updates admission, patient, bed, and audit records in one transaction. The transfer RPC locks the patient, current admission, and both beds, then records the old and new admission and updates bed occupancy atomically. These RPCs are in the second local migration and do not expose clinical notes or diagnosis fields.
- Account creation assigns the selected hospital inside the server-side profile insert. Active hospital admins can create same-hospital doctor/nurse/receptionist accounts through the hospital dashboard; main admins can create accounts through the user-management page. Doctor/nurse creation also creates an active staff row with generated staff code, required doctor specialization, optional department, and professional details. Department ownership is checked server-side.
- Hospital admins can locally list active staff and hospital patients, create doctor or nurse assignments with an assignment type and optional end time, reject overlapping assignments for the same staff/patient pair, and end or cancel active/future assignments. Mutation RPCs validate hospital membership and staff status and create audit entries. The workflow is in local migration 006 and is not deployed.
- The main-admin device page has a locally implemented inventory, device registration, status changes, and patient assignment/unassignment by patient number. Database functions enforce administrator/hospital scope, return only whether a device is assigned (no patient name or readings), and audit mutations. Device inventory depends on local migration 007. Credentials are not provisioned or shown in this page.
- The main-admin hospital page has a locally implemented hospital directory, registration, and metadata/status editing through main-admin-only RPCs. Mutations are audited; the view contains hospital contact/location metadata only. It depends on local migration 008.
- Main-admin doctor and nurse pages now show separate professional staff directories with role, hospital, department, account/staff status, and professional profile fields. They omit all patient data and depend on local migration 009.
- Hospital admins can view and edit same-hospital doctor/nurse professional profile fields, department, and staff-record status. The directory does not change account credentials or roles; edits are hospital-scoped and audited by migration 010.
- A third local migration applies the specification's default-deny clinical-access decisions: it removes broad admin clinical, appointment, discharge, access-request, and notification policies; removes receptionist direct access to admissions/appointments/discharges; limits alert notifications to actively assigned doctors/nurses; and restricts the shared patient-access helper to active clinical staff with a current assignment. It is not deployed.
- Three RPC definitions are in `supabase/migrations/20260930000100_add_dashboard_read_rpcs.sql`.
- `device-ingest` rejects payload-supplied patient IDs and resolves the target patient from the device assignment. `create-user` avoids returning internal database/auth errors.
- Database types are a generated snapshot of the linked project's public schema; this does not capture policies or function bodies.

## Deployment state and verification

All ten migrations are local only. They have **not** been applied to Supabase. The updated dashboard, facility-management, assignment, device, hospital, staff-directory, alert, audit, doctor, nurse, and receptionist screens depend on the RPC migrations, so those data flows will report an error until reviewed and deployed. The modified `create-user` Edge Function also must be deployed for staff provisioning and hospital-ID validation to take effect. The policy hardening migration needs database-level authorization verification before deployment. No remote database changes have been made.

`npm.cmd run lint` and `npm.cmd run build` pass. The production build has no chunk-size warning, and both Edge Functions pass Node syntax checks. SQL lint could not run: the local Postgres service is unavailable, and the linked lint request returned a transport error. These checks do not validate deployed database behavior, user permissions, device hardware, or workflows in a browser. There is no checked-in automated test suite or firmware project.

## Major gaps against the specification

| Area | Current state | Remaining work |
| --- | --- | --- |
| Database access | RLS is enabled on 22 public tables, but authenticated direct table grants checked in the linked project are absent. The live project still has policy conflicts: receptionist admission access is not hospital-scoped and admin roles can access clinical data. A local hardening migration addresses these defaults but is not SQL-linted or deployed. | Verify the hardening migration and every role/hospital boundary on a local database, then deploy. Do not use with real patient data until fixed. |
| Hospital admin | Aggregate dashboard, department/ward/bed management, doctor/nurse/receptionist account creation, audited patient assignment actions, and doctor/nurse profile maintenance are implemented locally, pending migrations/function deployment. Alerts, reports, and audit workflows are still missing. | Add scoped alert/report/audit operations. |
| Main admin | Hospital directory/registration/editing, doctor/nurse directories, device inventory/current assignment, alerts, and audit are implemented locally but depend on unapplied RPC migrations. Security and settings remain placeholders. | Review/deploy the RPCs; resolve the security/settings workflows. |
| Account administration | Main-admin and hospital-admin account creation now provisions doctor/nurse rows. Staff profile updates, account invitations/password setup, and deactivation workflows are missing. Patient assignment management is implemented locally, pending migration deployment. | Add staff profile maintenance and verify role boundaries in Supabase. |
| Reception | Hospital-scoped patient search, identity registration, admission, and transactional bed transfer are implemented locally, pending RPC migration deployment. Discharge is still missing because the linked schema has no clinician authorization signal for a receptionist to complete it safely. | Add discharge only after defining how an authorized clinical discharge is represented and verified server-side. |
| Clinical monitoring | Doctor/nurse screen depends on the pending RPC. No reading history, charts, sensor-quality/fault display, or configured realtime feed. | Deploy and verify RPC; implement history and trustworthy device states. Linked Realtime publication has no public tables, so current screen polls. |
| Medication | No medication order, scheduled dose, or administration tables/RPCs. `clinical_records.medications` is free text. | Add versioned orders and atomic/idempotent nurse administration with audit records. |
| Alerts and notification | Linked DB has alert generation and in-app notification functions. No phone/SMS/push provider or escalation workflow is implemented. | Agree provider/recipients/timing, then implement delivery while preserving in-app alerts. Clinical thresholds require approved values. |
| Devices | Main-admin registry, registration, status controls, and current assignment actions are implemented locally in pending migration 007. Ingest function exists, but there is no assignment history, operational heartbeat/fault UI, credential provisioning workflow, or firmware. Device-to-active-admission mapping needs end-to-end verification. | Review/deploy migration and verify end-to-end ingest, credential rotation, device heartbeat, and hardware behavior. |
| Release operations | No automated tests, deployment workflow, seed/demo dataset, or operator runbook. | Add after database interfaces and access decisions are settled. |

## Decisions needed to complete safely

The system specification marks these as owner/clinical decisions: whether either administrator may view clinical data; break-glass/approved access requests; phone-notification provider; escalation timing and recipients; nurse assignment duration; ECG waveform versus summary; data retention; and clinical alert thresholds/severity rules. Current default is to avoid expanding access or inventing clinical thresholds. These decisions affect security and data design, so a “complete project” cannot responsibly be claimed until they are resolved.

## Suggested implementation sequence

1. Review and deploy the pending read RPC migration; verify its SQL on a disposable/local database and validate doctor/nurse assignment visibility.
2. Repair database policies, grants, and role/hospital isolation in versioned migrations; add database authorization tests.
3. Implement hospital, ward, bed, patient, admission, discharge/transfer, and staff/device assignment workflows.
4. Complete clinical monitoring, reading history, alert handling, sensor status, and notification delivery.
5. Add medication order and administration workflows.
6. Implement administration pages, firmware integration, deployment configuration, demo data, and operator documentation.
