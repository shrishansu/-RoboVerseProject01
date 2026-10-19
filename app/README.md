# RoboVerse

RoboVerse is a student prototype for hospital ward and patient monitoring. It combines a React web app, Supabase authentication/database functions, and an intended ESP32 device that sends vital readings. It is not a certified medical device and must not be used to diagnose patients or direct treatment.

## How the project fits together

```text
Browser (React + Vite)
  ├─ Supabase Auth: sign in and maintain a session
  ├─ Supabase RPCs: load profile, dashboards, and authorized actions
  └─ Supabase Edge Functions: create accounts and accept device readings
          └─ Supabase Postgres: hospital data, assignments, readings, alerts, audit
```

The browser UI is not the security boundary. Database policies and server functions must enforce every role and hospital boundary. The linked database currently has access-policy issues documented in [`LIVE_DATABASE_SECURITY_AUDIT.md`](../docs/LIVE_DATABASE_SECURITY_AUDIT.md). Do not connect this prototype to real patient data until those are fixed and reviewed.

## Roles in the intended system

| Role | Intended responsibility |
| --- | --- |
| Main administrator | Platform-level hospitals, accounts, devices, configuration, and audit |
| Hospital administrator | Manage one hospital's staff, wards, beds, assignments, and operations |
| Doctor | View assigned patients, readings, and clinical workflow |
| Nurse | View assigned ward/bed patients, readings, alerts, and medication workflow |
| Receptionist | Patient identity and admission/bed workflow without clinical data |

Some routes currently exist as placeholders. See [`IMPLEMENTATION_STATUS.md`](../docs/IMPLEMENTATION_STATUS.md) for what is built and what remains.

## Get started

Install Node.js, then open a terminal in this `app` directory:

```sh
npm install
npm run dev
```

Vite prints the local URL. To create a production bundle or check code style:

```sh
npm run build
npm run lint
```

## Supabase setup

Create `app/.env.local` with browser-safe Supabase credentials:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

Never put the Supabase service-role key in a `VITE_` variable or browser code. Edge Function secrets belong in the Supabase server environment.

The app expects database functions including `get_my_profile`, `get_main_admin_dashboard_stats`, and `get_main_admin_users`. Doctor/nurse dashboards and main-admin alert/audit lists depend on `20260930000100_add_dashboard_read_rpcs.sql`; receptionist registry/admission/transfer depends on `20260930000200_receptionist_patient_registry.sql`; hospital-admin aggregate counts depend on `20260930000400_hospital_admin_dashboard_summary.sql`; facility management depends on `20260930000500_hospital_admin_facility_management.sql`; staff assignment depends on `20260930000600_hospital_admin_patient_assignments.sql`; device management depends on `20260930000700_device_registry_management.sql`; hospital management depends on `20260930000800_main_admin_hospital_management.sql`; doctor/nurse directories depend on `20260930000900_main_admin_clinical_staff_directories.sql`; and hospital staff maintenance depends on `20260930001000_hospital_admin_staff_maintenance.sql`. These migrations are local only, so the related screens will not load live data until the SQL is reviewed and applied. `20260930000300_harden_patient_access_policies.sql` contains separate role-policy changes that also need database authorization verification.

## Important folders

- `src/App.jsx` — route definitions and role checks.
- `src/context/AuthContext.jsx` — signed-in session and profile state.
- `src/lib/supabaseClient.ts` — browser Supabase client.
- `src/lib/database.types.ts` — generated snapshot of the linked database's table and RPC types; it does not include policies or function implementation.
- `src/pages/` — login and role dashboards.
- `src/pages/ReceptionistDashboard.jsx` — hospital-scoped identity registry and patient registration UI.
- `src/pages/admin/` — main-admin pages; several are placeholders.
- `src/components/ClinicalDashboard.jsx` — shared doctor/nurse monitoring UI.
- `supabase/functions/` — Edge Functions for account creation and device ingest.
- `supabase/migrations/` — versioned SQL changes. Local migrations must be reviewed and deployed separately.
- `../docs/IMPLEMENTATION_STATUS.md` — beginner-friendly implementation audit and remaining work.

## Current limitations

- The doctor/nurse dashboard, receptionist registry, hospital-admin overview, and main-admin alert/audit views depend on unapplied migrations.
- Main-admin and hospital-admin account creation assigns the hospital in the server-side profile insert. Creating a doctor/nurse also creates an active staff record; the Edge Function enforces same-hospital department scope. Deploy the updated `create-user` function for these changes to take effect. Staff profile editing and credential delivery remain unfinished.
- The linked database has no direct authenticated table grants for the core tables; data access is through RPCs. The existing linked policies still have security conflicts documented in the audit.
- Main-admin hospital directory, registration, and metadata/status updates are implemented locally through migration 008; doctor/nurse staff directories are implemented locally through migration 009. Hospital-admin staff profile maintenance is implemented locally through migration 010. These migrations are not deployed. Hospital administration also has aggregate overview, department/ward/bed management, staff account creation, and audited patient assignment actions. The main-admin device directory and current patient assignment actions are implemented locally in migration 007 but are not deployed. Reception registration, identity search, transactional admission/bed allocation, and bed transfer are implemented locally; discharge is not.
- Medication orders, scheduled doses, and administration are not implemented in the database or UI.
- The app polls the doctor/nurse dashboard every 30 seconds. Realtime tables are not configured in the linked project.
- In-app alert generation exists in the linked database, but phone notification delivery and escalation are not implemented.
- No ESP32 firmware, automated test suite, deployment pipeline, or demo seed data is included.

The project specification also leaves security and clinical decisions open. Do not invent administrator clinical access, break-glass access, alert thresholds, escalation rules, or retention periods; resolve those with the project owner and clinical supervisor before implementing them.
