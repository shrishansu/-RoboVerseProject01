import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

function formatDate(value) {
  if (!value) return "Not provided";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "Not provided" : date.toLocaleDateString();
}

function ReceptionistDashboard() {
  const { profile, logout } = useAuth();
  const [patients, setPatients] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showRegistration, setShowRegistration] = useState(false);
  const [patientToAdmit, setPatientToAdmit] = useState(null);
  const [admissionMode, setAdmissionMode] = useState("admit");
  const [availableBeds, setAvailableBeds] = useState([]);
  const [availableDevices, setAvailableDevices] = useState([]);
  const [selectedBedId, setSelectedBedId] = useState("");
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [admissionType, setAdmissionType] = useState("routine");
  const [loadingBeds, setLoadingBeds] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const patientSearchRequest = useRef(0);

  const loadPatients = useCallback(async (searchTerm = search) => {
    const requestId = patientSearchRequest.current + 1;
    patientSearchRequest.current = requestId;
    setLoading(true);
    setError("");

    try {
      const { data, error: queryError } = await supabase.rpc(
        "search_receptionist_patients",
        { p_search: searchTerm.trim(), p_limit: 100 },
      );

      if (requestId !== patientSearchRequest.current) return;
      if (queryError) {
        console.error("Receptionist patient registry could not be loaded.");
        setPatients([]);
        setError("The patient registry could not be loaded. Confirm that the required database migration is deployed.");
      } else {
        setPatients(data || []);
      }
    } catch {
      if (requestId === patientSearchRequest.current) {
        setPatients([]);
        setError("The patient registry could not be loaded. Check your connection and try again.");
      }
    } finally {
      if (requestId === patientSearchRequest.current) setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timer = window.setTimeout(() => loadPatients(search), 250);
    return () => window.clearTimeout(timer);
  }, [loadPatients, search]);

  const handleRegisterPatient = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setSaving(true);
    setError("");
    setNotice("");

    try {
      const { data, error: registerError } = await supabase.rpc(
        "register_receptionist_patient",
        {
          p_first_name: String(values.get("first_name") || "").trim(),
          p_middle_name: String(values.get("middle_name") || "").trim() || null,
          p_last_name: String(values.get("last_name") || "").trim(),
          p_date_of_birth: String(values.get("date_of_birth") || "") || null,
          p_phone: String(values.get("phone") || "").trim() || null,
        },
      );

      if (registerError || !data?.patient_number) {
        console.error("Patient registration was rejected by the database.");
        setError("Patient registration failed. Check the required fields and try again.");
        return;
      }

      setNotice(`Patient registered with number ${data.patient_number}.`);
      setShowRegistration(false);
      form.reset();
      setSearch(data.patient_number);
      await loadPatients(data.patient_number);
    } catch {
      setError("Patient registration failed. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const openAdmissionForm = async (patient, mode = "admit") => {
    setError("");
    setNotice("");
    setAvailableBeds([]);
    setAvailableDevices([]);
    setSelectedBedId("");
    setSelectedDeviceId("");
    setPatientToAdmit(patient);
    setAdmissionMode(mode);
    setLoadingBeds(true);

    try {
      const [bedsResult, devicesResult] = await Promise.all([
        supabase.rpc("list_receptionist_available_beds"),
        mode === "admit"
          ? supabase.rpc("list_receptionist_available_devices")
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (bedsResult.error) throw bedsResult.error;
      if (devicesResult.error) throw devicesResult.error;
      setAvailableBeds(bedsResult.data || []);
      setAvailableDevices(devicesResult.data || []);
    } catch (loadError) {
      setPatientToAdmit(null);
      setError(loadError?.message || "Beds and available devices could not be loaded. Check the connection and database migration.");
    } finally {
      setLoadingBeds(false);
    }
  };

  const handleAdmitPatient = async (event) => {
    event.preventDefault();
    if (!patientToAdmit || !selectedBedId) return;
    setSaving(true);
    setError("");
    setNotice("");

    try {
      const { data, error: admissionError } = admissionMode === "transfer"
        ? await supabase.rpc("transfer_receptionist_patient", {
          p_patient_id: patientToAdmit.patient_id,
          p_new_bed_id: Number(selectedBedId),
        })
        : await supabase.rpc("admit_receptionist_patient", {
          p_patient_id: patientToAdmit.patient_id,
          p_bed_id: Number(selectedBedId),
          p_admission_type: admissionType,
          p_device_id: selectedDeviceId ? Number(selectedDeviceId) : null,
        });
      if (admissionError || !data?.admission_number) {
        console.error("Patient admission was rejected by the database.");
        setError("Admission failed. The patient or bed may have changed; refresh and try again.");
        return;
      }

      setNotice(admissionMode === "transfer"
        ? `Patient transferred to bed ${data.bed_number}.`
        : `Admission ${data.admission_number} created for bed ${data.bed_number}${data.device_code ? ` with device ${data.device_code}` : ""}.`);
      setPatientToAdmit(null);
      setSelectedDeviceId("");
      await loadPatients(search);
    } catch {
      setError("Admission failed. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="reception-dashboard">
      <header className="reception-header">
        <div>
          <div className="clinical-brand">RoboVerse</div>
          <p>Reception and patient identity</p>
        </div>
        <div className="reception-header-actions">
          <span>{profile?.full_name || "Receptionist"}</span>
          <button type="button" className="clinical-logout" onClick={logout}>Logout</button>
        </div>
      </header>

      <main className="reception-main">
        <section className="reception-title-row">
          <div>
            <h1>Patient registry</h1>
            <p>Search and register patient identity records for your hospital. Clinical notes and diagnoses are not shown here.</p>
          </div>
          <button type="button" onClick={() => setShowRegistration((shown) => !shown)}>
            {showRegistration ? "Close form" : "Register patient"}
          </button>
        </section>

        {error && !patientToAdmit && <div className="clinical-message clinical-error" role="alert">{error}</div>}
        {notice && <div className="clinical-message clinical-success" role="status">{notice}</div>}

        {showRegistration && (
          <form className="reception-registration" onSubmit={handleRegisterPatient}>
            <h2>New patient identity</h2>
            <div className="reception-form-grid">
              <label>First name<input name="first_name" maxLength={100} autoComplete="given-name" required /></label>
              <label>Middle name<input name="middle_name" maxLength={100} autoComplete="additional-name" /></label>
              <label>Last name<input name="last_name" maxLength={100} autoComplete="family-name" required /></label>
              <label>Date of birth<input name="date_of_birth" type="date" max={new Date().toISOString().slice(0, 10)} /></label>
              <label>Phone<input name="phone" type="tel" maxLength={40} autoComplete="tel" /></label>
            </div>
            <p>A patient number is generated automatically. Avoid entering clinical details in reception.</p>
            <button type="submit" disabled={saving}>{saving ? "Registering..." : "Save patient"}</button>
          </form>
        )}

        {patientToAdmit && (
          <form className="reception-registration" onSubmit={handleAdmitPatient}>
            <h2>{admissionMode === "transfer" ? "Transfer patient" : "Admit patient"}</h2>
            {error && <div className="clinical-message clinical-error" role="alert">{error}</div>}
            <p>{patientToAdmit.patient_number} - {[patientToAdmit.first_name, patientToAdmit.middle_name, patientToAdmit.last_name].filter(Boolean).join(" ")}</p>
            {admissionMode === "transfer" && <p>Current bed: {patientToAdmit.bed_number || "Unavailable"}</p>}
            {loadingBeds ? (
              <div className="clinical-empty" role="status">Loading available beds and devices...</div>
            ) : availableBeds.length === 0 ? (
              <div className="clinical-empty">No available beds were found in your hospital.</div>
            ) : (
              <div className="reception-form-grid">
                <label>
                  Bed
                  <select value={selectedBedId} onChange={(event) => setSelectedBedId(event.target.value)} required>
                    <option value="">Select an available bed</option>
                    {availableBeds.map((bed) => (
                      <option key={bed.bed_id} value={bed.bed_id}>
                        {bed.ward_name} / {bed.bed_number} - {bed.department_name}
                      </option>
                    ))}
                  </select>
                </label>
                {admissionMode === "admit" && (
                  <>
                    <label>
                      Admission type
                      <select value={admissionType} onChange={(event) => setAdmissionType(event.target.value)}>
                        <option value="routine">Routine</option>
                        <option value="emergency">Emergency</option>
                        <option value="observation">Observation</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label>
                      Device (optional)
                      <select value={selectedDeviceId} onChange={(event) => setSelectedDeviceId(event.target.value)}>
                        <option value="">No device</option>
                        {availableDevices.map((device) => (
                          <option key={device.device_id} value={device.device_id}>
                            {device.device_code} — {device.device_name} ({device.device_type}, {device.status})
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </div>
            )}
            <p>The database rechecks bed availability and hospital ownership when you save.</p>
            <div className="reception-modal-actions">
              <button type="button" className="secondary-action" onClick={() => {
                setPatientToAdmit(null);
                setError("");
                setSelectedDeviceId("");
              }}>Cancel</button>
              <button type="submit" disabled={saving || loadingBeds || !selectedBedId}>
                {saving ? "Saving..." : admissionMode === "transfer" ? "Confirm transfer" : "Confirm admission"}
              </button>
            </div>
          </form>
        )}

        <section className="reception-registry-card" aria-labelledby="patient-registry-heading">
          <div className="reception-registry-toolbar">
            <div>
              <h2 id="patient-registry-heading">Patients</h2>
              <p>Results are limited to the hospital assigned to your account.</p>
            </div>
            <label>
              <span className="visually-hidden">Search by patient name, number, or phone</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, patient number, or phone"
              />
            </label>
          </div>

          {loading ? (
            <div className="clinical-empty" role="status">Loading patient registry...</div>
          ) : patients.length === 0 ? (
            <div className="clinical-empty">{search ? "No patients match this search." : "No patients are registered for this hospital yet."}</div>
          ) : (
            <div className="reception-table-wrap">
              <table className="reception-table">
                <thead><tr><th>Patient number</th><th>Name</th><th>Date of birth</th><th>Phone</th><th>Admission</th><th>Bed</th><th>Ward</th><th>Device</th><th>Action</th></tr></thead>
                <tbody>
                  {patients.map((patient) => (
                    <tr key={patient.patient_id}>
                      <td>{patient.patient_number}</td>
                      <td>{[patient.first_name, patient.middle_name, patient.last_name].filter(Boolean).join(" ")}</td>
                      <td>{formatDate(patient.date_of_birth)}</td>
                      <td>{patient.phone || "Not provided"}</td>
                      <td>{patient.admission_status === "not_admitted" ? "Not admitted" : patient.admission_status}</td>
                      <td>{patient.bed_number || "-"}</td>
                      <td>{patient.ward_name || "-"}</td>
                      <td>{patient.device_name || "-"}</td>
                      <td>
                        {patient.admission_status === "admitted" ? (
                          <button type="button" className="reception-table-action" onClick={() => openAdmissionForm(patient, "transfer")}>
                            Transfer bed
                          </button>
                        ) : ["inactive", "deceased"].includes(patient.patient_status) ? "Unavailable" : (
                          <button type="button" className="reception-table-action" onClick={() => openAdmissionForm(patient)}>
                            Admit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default ReceptionistDashboard;
