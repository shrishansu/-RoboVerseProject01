import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";

const ROLE_CONFIG = {
  doctor: { title: "Doctor Dashboard", patientHeading: "My assigned patients" },
  nurse: { title: "Nurse Dashboard", patientHeading: "My ward patients" },
};

const READING_FRESHNESS_WINDOW_MS = 90000;

function formatTimestamp(value) {
  if (!value) return "No reading received";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No reading received" : date.toLocaleString();
}

function getReadingStatus(reading) {
  if (!reading?.recorded_at) {
    return { label: "Waiting for device data", tone: "stale", isCurrentIoT: false };
  }

  const recordedAt = new Date(reading.recorded_at).getTime();
  if (Number.isNaN(recordedAt)) {
    return { label: "Reading timestamp unavailable", tone: "stale", isCurrentIoT: false };
  }

  const age = Date.now() - recordedAt;
  const isCurrent = age >= -READING_FRESHNESS_WINDOW_MS && age <= READING_FRESHNESS_WINDOW_MS;
  const source = reading.source === "iot"
    ? "IoT device"
    : reading.source === "manual"
      ? "Manual reading"
      : reading.source === "imported"
        ? "Imported reading"
        : "Unknown source";

  return {
    label: `${source} · ${isCurrent ? "Current" : "Stale"}`,
    tone: isCurrent && reading.source === "iot" ? "iot-current" : isCurrent ? "current" : "stale",
    isCurrentIoT: isCurrent && reading.source === "iot",
  };
}

function formatValue(value, unit = "") {
  if (value === null || value === undefined) return "Unavailable";
  return unit ? `${value} ${unit}` : String(value);
}

const SENSOR_LABELS = {
  heart_reader: "Heart and blood oxygen reader",
  distance_sensor: "Distance sensor",
  movement_sensor: "Movement sensor",
  ecg_sensor: "Heart electrical activity sensor",
};

function formatSensorStatus(value) {
  if (!value) return "Unavailable";
  return String(value).replaceAll("_", " ");
}

function getPatientName(patient) {
  return [patient.first_name, patient.middle_name, patient.last_name]
    .filter(Boolean)
    .join(" ") || "Patient";
}

function toLocalDateTimeInput(value = new Date()) {
  const localDate = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

const MEDICATION_ROUTES = [
  "Oral",
  "Intravenous",
  "Intramuscular",
  "Subcutaneous",
  "Topical",
  "Inhaled",
  "Ophthalmic",
  "Otic",
  "Rectal",
  "Other",
];

export default function ClinicalDashboard({ role }) {
  const { profile, logout } = useAuth();
  const profileId = profile?.id;
  const config = ROLE_CONFIG[role];
  const [patients, setPatients] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyAlertId, setBusyAlertId] = useState(null);
  const [resolutionNotes, setResolutionNotes] = useState({});
  const [medicationTasks, setMedicationTasks] = useState([]);
  const [assignedNurses, setAssignedNurses] = useState([]);
  const [medicationLoading, setMedicationLoading] = useState(true);
  const [medicationError, setMedicationError] = useState("");
  const [medicationNotice, setMedicationNotice] = useState("");
  const [selectedMedicationPatient, setSelectedMedicationPatient] = useState("");
  const [savingMedication, setSavingMedication] = useState(false);
  const [busyMedicationTaskId, setBusyMedicationTaskId] = useState(null);
  const [administrationNotes, setAdministrationNotes] = useState({});
  const [currentTime, setCurrentTime] = useState(null);

  const loadMedicationWorklist = useCallback(async () => {
    if (!profileId || !config) return;
    setMedicationLoading(true);
    setMedicationError("");

    try {
      const { data, error: queryError } = await supabase.rpc("get_my_medication_worklist");
      if (queryError) throw queryError;
      if (!data || !Array.isArray(data.tasks) || !Array.isArray(data.nurses)) {
        throw new Error("The medication worklist response was invalid.");
      }
      setMedicationTasks(data.tasks);
      setAssignedNurses(data.nurses);
    } catch (worklistError) {
      console.error("Medication worklist request failed:", worklistError);
      setMedicationTasks([]);
      setAssignedNurses([]);
      setMedicationError("Medication tasks could not be loaded. Confirm the medication workflow migration is deployed, then refresh.");
    } finally {
      setMedicationLoading(false);
    }
  }, [config, profileId]);

  const loadDashboard = useCallback(async (isRefresh = false) => {
    if (!profileId || !config) return;
    if (isRefresh) setRefreshing(true);
    setError("");

    try {
      const [{ data, error: queryError }, { data: deviceHealth, error: deviceError }] = await Promise.all([
        supabase.rpc("get_my_clinical_dashboard", { p_limit: 200 }),
        supabase.rpc("get_my_assigned_device_health"),
      ]);

      if (queryError) throw queryError;
      if (deviceError) throw deviceError;

      if (data?.staff_profile_missing) {
        setPatients([]);
        setError("Your active clinical staff profile is not linked to this account. Ask your hospital administrator to check the account setup.");
      } else if (Array.isArray(data?.patients)) {
        const devicesByPatient = new Map();
        (Array.isArray(deviceHealth) ? deviceHealth : []).forEach((item) => {
          const rows = devicesByPatient.get(item.patient_id) || [];
          rows.push(item);
          devicesByPatient.set(item.patient_id, rows);
        });
        setPatients(data.patients.map((patient) => {
          const assignedDevices = devicesByPatient.get(patient.id) || [];
          const latestDeviceReading = assignedDevices
            .map((item) => item.latest_reading)
            .filter((reading) => reading?.recorded_at)
            .sort((left, right) => new Date(right.recorded_at) - new Date(left.recorded_at))[0] || null;
          const previousReading = patient.latest_reading?.source === "iot" ? null : patient.latest_reading;
          return {
            ...patient,
            assigned_devices: assignedDevices,
            latest_reading: assignedDevices.length ? latestDeviceReading : previousReading,
          };
        }));
      } else {
        throw new Error("The clinical dashboard response was invalid.");
      }
    } catch (dashboardError) {
      console.error("Clinical dashboard request failed:", dashboardError);
      setPatients([]);
      if (dashboardError?.message?.includes("active doctor or nurse profile")) {
        setError("This account needs an active hospital assignment. Ask an administrator to verify the hospital and clinical staff records, then refresh.");
      } else {
        setError("Patient monitoring data could not be loaded. Check your account assignment and connection.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLastCheckedAt(new Date().toISOString());
    }
  }, [config, profileId]);

  useEffect(() => {
    // Initial read uses a role-checked server RPC. This deployment has no
    // Realtime table publication, so refresh from the same RPC every 30 seconds.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDashboard();
    loadMedicationWorklist();
    const clockTimer = window.setTimeout(() => setCurrentTime(Date.now()), 0);
    const refreshTimer = window.setInterval(() => {
      setCurrentTime(Date.now());
      loadDashboard(true);
      loadMedicationWorklist();
    }, 30000);
    return () => {
      window.clearTimeout(clockTimer);
      window.clearInterval(refreshTimer);
    };
  }, [loadDashboard, loadMedicationWorklist]);

  const filteredPatients = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return patients;

    return patients.filter((patient) => (
      getPatientName(patient).toLowerCase().includes(term)
      || String(patient.bed_number || "").toLowerCase().includes(term)
      || String(patient.patient_number || "").toLowerCase().includes(term)
    ));
  }, [patients, search]);

  const hasCurrentIoTReading = patients.some(
    (patient) => getReadingStatus(patient.latest_reading).isCurrentIoT,
  );

  const handleAlertStatus = async (alert, status) => {
    setBusyAlertId(alert.id);
    setNotice("");
    setError("");

    try {
      const { error: updateError } = await supabase.rpc("update_alert_status", {
        target_alert_id: alert.id,
        new_status: status,
        new_resolution_notes: status === "resolved" ? resolutionNotes[alert.id] || null : null,
      });

      if (updateError) {
        setError("The alert could not be updated. It may have already changed or your assignment may have ended.");
        return;
      }

      setNotice(status === "resolved" ? "Alert resolved." : "Alert acknowledged.");
      await loadDashboard(true);
    } catch {
      setError("The alert could not be updated. Check the connection and try again.");
    } finally {
      setBusyAlertId(null);
    }
  };

  const handleCreateMedicationTask = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setSavingMedication(true);
    setMedicationError("");
    setMedicationNotice("");

    try {
      const { data, error: createError } = await supabase.rpc("create_medication_task", {
        p_patient_id: Number(values.get("patient_id")),
        p_nurse_id: Number(values.get("nurse_id")),
        p_medication_name: String(values.get("medication_name") || "").trim(),
        p_dose: String(values.get("dose") || "").trim(),
        p_route: String(values.get("route") || ""),
        p_scheduled_for: new Date(String(values.get("scheduled_for"))).toISOString(),
        p_instructions: String(values.get("instructions") || "").trim() || null,
      });
      if (createError || !data?.task_id) throw createError || new Error("Task was not created");

      setMedicationNotice("Medication task assigned to the nurse.");
      form.reset();
      setSelectedMedicationPatient("");
      await loadMedicationWorklist();
    } catch {
      setMedicationError("The medication task could not be created. Confirm the patient, assigned nurse, and schedule, then try again.");
    } finally {
      setSavingMedication(false);
    }
  };

  const handleMedicationTaskStatus = async (task, status) => {
    const notes = administrationNotes[task.id] || "";
    if (currentTime === null || new Date(task.scheduled_for).getTime() > currentTime) {
      setMedicationError("This dose task is not scheduled yet.");
      return;
    }
    if (status !== "administered" && !notes.trim()) {
      setMedicationError("Add a brief reason before marking a dose held or not given.");
      return;
    }

    setBusyMedicationTaskId(task.id);
    setMedicationError("");
    setMedicationNotice("");
    try {
      const { error: updateError } = await supabase.rpc("record_medication_task", {
        p_task_id: task.id,
        p_status: status,
        p_notes: notes.trim() || null,
      });
      if (updateError) throw updateError;

      setMedicationNotice(status === "administered" ? "Dose administration recorded." : "Medication task outcome recorded.");
      setAdministrationNotes((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });
      await loadMedicationWorklist();
    } catch {
      setMedicationError("The task could not be updated. It may have changed already, or your nurse assignment may have ended.");
    } finally {
      setBusyMedicationTaskId(null);
    }
  };

  const medicationPatientId = patients.some((patient) => String(patient.id) === selectedMedicationPatient)
    ? selectedMedicationPatient
    : String(patients[0]?.id || "");
  const nursesForSelectedPatient = assignedNurses.filter(
    (nurse) => String(nurse.patient_id) === medicationPatientId,
  );

  if (!config) return null;

  return (
    <div className="clinical-dashboard">
      <header className="clinical-dashboard-header">
        <div>
          <div className="clinical-brand">RoboVerse</div>
          <p>{config.title}</p>
        </div>
        <div className="clinical-header-actions">
          <span className="clinical-user">{profile?.full_name || role}</span>
          <button type="button" className="secondary-action" onClick={() => loadDashboard(true)} disabled={loading || refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <button type="button" className="clinical-logout" onClick={logout}>Logout</button>
        </div>
      </header>

      <main className="clinical-dashboard-main">
        <div className="clinical-dashboard-title">
          <div>
            <h1>{config.patientHeading}</h1>
            <p>Monitoring information is a prototype aid, not a diagnosis or treatment recommendation.</p>
          </div>
          <span className={`clinical-live-state${hasCurrentIoTReading ? " is-live" : ""}`} role="status">
            <span aria-hidden="true" />
            {refreshing
              ? "Refreshing device readings..."
              : lastCheckedAt
                ? `Database checked ${formatTimestamp(lastCheckedAt)} · refreshes every 30s`
                : "Checking device readings..."}
          </span>
        </div>

        {error && <div className="clinical-message clinical-error" role="alert">{error}</div>}
        {notice && <div className="clinical-message clinical-success" role="status">{notice}</div>}

        <section className="clinical-toolbar" aria-label="Patient list tools">
          <label>
            <span className="visually-hidden">Search by patient name, number, or bed</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search patient name, number, or bed"
              disabled={Boolean(error && patients.length === 0)}
            />
          </label>
          <span>
            {error && patients.length === 0
              ? "Patient count unavailable"
              : `${patients.length} assigned patient${patients.length === 1 ? "" : "s"}`}
          </span>
        </section>

        {loading ? (
          <div className="clinical-empty" role="status">Loading assigned patients...</div>
        ) : error && patients.length === 0 ? (
          <div className="clinical-empty" role="status">
            Patient assignments could not be displayed. Check the connection or ask an administrator to verify this account, then refresh.
          </div>
        ) : filteredPatients.length === 0 ? (
          <div className="clinical-empty">
            {patients.length === 0 ? "No active patient assignments were found for this account." : "No patients match this search."}
          </div>
        ) : (
          <div className="clinical-patient-grid">
            {filteredPatients.map((patient) => {
              const reading = patient.latest_reading;
              const readingStatus = getReadingStatus(reading);
              const patientAlerts = Array.isArray(patient.alerts) ? patient.alerts : [];

              return (
                <article className="clinical-patient-card" key={patient.id}>
                  <div className="clinical-patient-heading">
                    <div>
                      <h2>{getPatientName(patient)}</h2>
                      <p>{patient.patient_number || "Patient number unavailable"}</p>
                    </div>
                    <div className="clinical-bed-label">
                      <span>Bed</span>
                      <strong>{patient.bed_number || "Unassigned"}</strong>
                      {patient.ward_name && <small>{patient.ward_name}</small>}
                    </div>
                  </div>

                  <div className="clinical-assigned-device" aria-label="Assigned monitoring device">
                    <strong>Monitoring device</strong>
                    {patient.assigned_devices?.length ? patient.assigned_devices.map((assignedDevice) => (
                      <span key={assignedDevice.device_id}>
                        ID {assignedDevice.device_id} · {assignedDevice.device_name || assignedDevice.device_code}
                        <em className={`device-health-badge ${assignedDevice.status}`}>{assignedDevice.status}</em>
                        <small>Last successful ingestion: {formatTimestamp(assignedDevice.last_seen_at)}</small>
                      </span>
                    )) : <span>No device assigned to this patient.</span>}
                  </div>

                  <div className="clinical-vitals-heading">
                    <h3>Latest readings</h3>
                    <div className="clinical-reading-meta">
                      <time dateTime={reading?.recorded_at || undefined}>{formatTimestamp(reading?.recorded_at)}</time>
                      <span className={`clinical-reading-source ${readingStatus.tone}`} role="status">{readingStatus.label}</span>
                    </div>
                  </div>
                  <dl className="clinical-vitals-grid">
                    <div><dt>Pulse-rate estimate (prototype)</dt><dd>{formatValue(reading?.pulse_rate_estimate_bpm, "bpm")}</dd></div>
                    <div><dt>Distance</dt><dd>{formatValue(reading?.distance_mm, "mm")}</dd></div>
                    <div><dt>ECG raw ADC sample</dt><dd>{reading?.sensor_status?.ecg_sensor === "ok" ? formatValue(reading?.ecg_value) : "Unavailable · check leads"}</dd></div>
                    <div><dt>Movement X / Y / Z</dt><dd>{[reading?.motion_x, reading?.motion_y, reading?.motion_z].map((value) => formatValue(value, "g")).join(" / ")}</dd></div>
                    <div><dt>Raw optical RED</dt><dd>{formatValue(reading?.red_raw)}</dd></div>
                    <div><dt>Raw optical IR</dt><dd>{formatValue(reading?.ir_raw)}</dd></div>
                  </dl>

                  {reading?.source === "iot" && (
                    <section className="clinical-sensor-summary" aria-label="Device sensor status">
                      <h3>Device sensor status</h3>
                      {reading.sensor_status && typeof reading.sensor_status === "object" ? (
                        <ul>
                          {Object.entries(SENSOR_LABELS).map(([key, label]) => (
                            <li key={key}><span>{label}</span><strong>{formatSensorStatus(reading.sensor_status[key])}</strong></li>
                          ))}
                        </ul>
                      ) : <p>Sensor status was not included in this reading.</p>}
                      {reading.sensor_errors && typeof reading.sensor_errors === "object" && Object.entries(reading.sensor_errors).some(([key]) => Object.hasOwn(SENSOR_LABELS, key)) && (
                        <ul className="clinical-sensor-errors">
                          {Object.entries(reading.sensor_errors).filter(([key]) => Object.hasOwn(SENSOR_LABELS, key)).map(([key, message]) => (
                            <li key={key}>{SENSOR_LABELS[key] || key.replaceAll("_", " ")}: {String(message)}</li>
                          ))}
                        </ul>
                      )}
                      <small>Raw optical samples and prototype pulse estimates are informational device data, not confirmed clinical measurements. This firmware does not provide SpO₂.</small>
                    </section>
                  )}

                  <div className="clinical-alert-list">
                    <h3>Active alerts <span>{patientAlerts.length}</span></h3>
                    {patientAlerts.length === 0 ? (
                      <p className="clinical-no-alerts">No open alerts for this assigned patient.</p>
                    ) : patientAlerts.map((alert) => (
                      <div className="clinical-alert-item" key={alert.id}>
                        <div className="clinical-alert-copy">
                          <strong>{alert.title || String(alert.alert_type || "alert").replaceAll("_", " ")}</strong>
                          <span>{alert.severity} / {alert.status} / {formatTimestamp(alert.created_at)}</span>
                          {alert.value !== null && alert.value !== undefined && <small>Recorded value: {alert.value}</small>}
                        </div>
                        <div className="clinical-alert-actions">
                          {alert.status === "active" && (
                            <button type="button" onClick={() => handleAlertStatus(alert, "acknowledged")} disabled={busyAlertId === alert.id}>
                              {busyAlertId === alert.id ? "Saving..." : "Acknowledge"}
                            </button>
                          )}
                          {alert.status === "acknowledged" && (
                            <>
                              <label>
                                <span className="visually-hidden">Optional resolution note</span>
                                <input
                                  type="text"
                                  value={resolutionNotes[alert.id] || ""}
                                  onChange={(event) => setResolutionNotes((current) => ({ ...current, [alert.id]: event.target.value }))}
                                  placeholder="Resolution note (optional)"
                                />
                              </label>
                              <button type="button" onClick={() => handleAlertStatus(alert, "resolved")} disabled={busyAlertId === alert.id}>
                                {busyAlertId === alert.id ? "Saving..." : "Resolve"}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <section className="clinical-medication-workflow" aria-labelledby="clinical-medication-heading">
          <div className="clinical-medication-heading">
            <div>
              <h2 id="clinical-medication-heading">Medication tasks</h2>
              <p>Clinician-entered dose instructions and administration records.</p>
            </div>
            <button type="button" className="secondary-action" onClick={loadMedicationWorklist} disabled={medicationLoading}>
              {medicationLoading ? "Refreshing..." : "Refresh tasks"}
            </button>
          </div>

          {medicationError && <div className="clinical-message clinical-error" role="alert">{medicationError}</div>}
          {medicationNotice && <div className="clinical-message clinical-success" role="status">{medicationNotice}</div>}

          {role === "doctor" && (
            <form className="clinical-medication-form" onSubmit={handleCreateMedicationTask}>
              <h3>Assign a dose task</h3>
              <div className="clinical-medication-form-grid">
                <label>Assigned patient
                  <select
                    name="patient_id"
                    value={medicationPatientId}
                    onChange={(event) => setSelectedMedicationPatient(event.target.value)}
                    required
                    disabled={patients.length === 0}
                  >
                    {patients.length === 0 && <option value="">No assigned patients</option>}
                    {patients.map((patient) => <option key={patient.id} value={patient.id}>{getPatientName(patient)} · {patient.patient_number || "No number"}</option>)}
                  </select>
                </label>
                <label>Assigned nurse
                  <select name="nurse_id" required disabled={nursesForSelectedPatient.length === 0}>
                    {nursesForSelectedPatient.length === 0 ? <option value="">No active nurse assignment</option> : nursesForSelectedPatient.map((nurse) => <option key={nurse.id} value={nurse.id}>{nurse.name}</option>)}
                  </select>
                </label>
                <label>Medication<input name="medication_name" maxLength={160} required /></label>
                <label>Dose<input name="dose" maxLength={80} placeholder="As clinically ordered" required /></label>
                <label>Route
                  <select name="route" defaultValue="" required>
                    <option value="" disabled>Select route</option>
                    {MEDICATION_ROUTES.map((route) => <option key={route} value={route.toLowerCase()}>{route}</option>)}
                  </select>
                </label>
                <label>Scheduled for<input name="scheduled_for" type="datetime-local" defaultValue={toLocalDateTimeInput()} required /></label>
                <label className="clinical-medication-instructions">Instructions<input name="instructions" maxLength={500} placeholder="Optional clinician-entered instructions" /></label>
              </div>
              <div className="clinical-medication-form-footer">
                <p>Enter one scheduled dose per task. Verify the medication, dose, route, and timing against the authorized clinical order.</p>
                <button type="submit" disabled={savingMedication || patients.length === 0 || nursesForSelectedPatient.length === 0}>
                  {savingMedication ? "Assigning..." : "Assign dose task"}
                </button>
              </div>
            </form>
          )}

          {medicationLoading && medicationTasks.length === 0 ? (
            <div className="clinical-empty" role="status">Loading medication tasks...</div>
          ) : medicationTasks.length === 0 ? (
            <p className="clinical-medication-empty">No medication tasks are currently assigned to your patients.</p>
          ) : (
            <div className="clinical-medication-list">
              {medicationTasks.map((task) => (
                <article className="clinical-medication-task" key={task.id}>
                  <div className="clinical-medication-task-main">
                    <div className="clinical-medication-task-title">
                      <h3>{task.medication_name} <span>{task.dose}</span></h3>
                      <span className={`clinical-medication-status ${task.status}`}>{task.status.replaceAll("_", " ")}</span>
                    </div>
                    <p>{task.patient_name} · {task.patient_number} · Route: {task.route}</p>
                    <p>Scheduled {formatTimestamp(task.scheduled_for)} · Nurse: {task.nurse_name}</p>
                    {task.instructions && <p className="clinical-medication-instructions-text">Instructions: {task.instructions}</p>}
                    {task.recorded_at && <p>Recorded {formatTimestamp(task.recorded_at)}{task.administration_notes ? ` · ${task.administration_notes}` : ""}</p>}
                  </div>
                  {role === "nurse" && task.status === "pending" && (
                    <div className="clinical-medication-actions">
                      {(currentTime === null || new Date(task.scheduled_for).getTime() > currentTime) && <p className="clinical-medication-not-due">Not due yet</p>}
                      <label>
                        <span className="visually-hidden">Reason or administration note</span>
                        <input
                          type="text"
                          maxLength={500}
                          value={administrationNotes[task.id] || ""}
                          onChange={(event) => setAdministrationNotes((current) => ({ ...current, [task.id]: event.target.value }))}
                          placeholder="Optional note; required if held/not given"
                        />
                      </label>
                      <div>
                        <button type="button" onClick={() => handleMedicationTaskStatus(task, "administered")} disabled={busyMedicationTaskId === task.id || currentTime === null || new Date(task.scheduled_for).getTime() > currentTime}>{busyMedicationTaskId === task.id ? "Saving..." : "Administered"}</button>
                        <button type="button" className="secondary-action" onClick={() => handleMedicationTaskStatus(task, "held")} disabled={busyMedicationTaskId === task.id || currentTime === null || new Date(task.scheduled_for).getTime() > currentTime || !(administrationNotes[task.id] || "").trim()}>Held</button>
                        <button type="button" className="secondary-action" onClick={() => handleMedicationTaskStatus(task, "not_given")} disabled={busyMedicationTaskId === task.id || currentTime === null || new Date(task.scheduled_for).getTime() > currentTime || !(administrationNotes[task.id] || "").trim()}>Not given</button>
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
