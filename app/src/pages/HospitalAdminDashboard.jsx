import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import HospitalStaffDirectory from "../components/HospitalStaffDirectory";
import Devices from "./admin/Devices";

const SUMMARY_CARDS = [
  { key: "registered_patients", label: "Registered patients", detail: "Patient identities at this hospital" },
  { key: "admitted_patients", label: "Currently admitted", detail: "Active admissions" },
  { key: "active_doctors", label: "Active doctors", detail: "Clinical staff accounts" },
  { key: "active_nurses", label: "Active nurses", detail: "Nursing staff accounts" },
  { key: "available_beds", label: "Available beds", detail: "In active wards" },
  { key: "occupied_beds", label: "Occupied beds", detail: "In active wards" },
  { key: "active_alerts", label: "Active alerts", detail: "Aggregate count; no patient details" },
];

const EMPTY_FACILITIES = { departments: [], wards: [], beds: [] };
const EMPTY_ASSIGNMENTS = { doctors: [], nurses: [], patients: [], assignments: [] };

function toLocalDateTimeInput(value = new Date()) {
  const localDate = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function HospitalAdminDashboard() {
  const { profile, logout } = useAuth();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [facilities, setFacilities] = useState(EMPTY_FACILITIES);
  const [facilitiesLoading, setFacilitiesLoading] = useState(true);
  const [facilityError, setFacilityError] = useState("");
  const [facilityNotice, setFacilityNotice] = useState("");
  const [staffError, setStaffError] = useState("");
  const [formKind, setFormKind] = useState("");
  const [savingFacility, setSavingFacility] = useState(false);
  const [showStaffForm, setShowStaffForm] = useState(false);
  const [savingStaff, setSavingStaff] = useState(false);
  const [staffRole, setStaffRole] = useState("doctor");
  const [assignmentData, setAssignmentData] = useState(EMPTY_ASSIGNMENTS);
  const [assignmentLoading, setAssignmentLoading] = useState(true);
  const [assignmentError, setAssignmentError] = useState("");
  const [assignmentNotice, setAssignmentNotice] = useState("");
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [assignmentRole, setAssignmentRole] = useState("doctor");
  const [assignmentStart, setAssignmentStart] = useState(toLocalDateTimeInput());
  const [savingAssignment, setSavingAssignment] = useState(false);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: queryError } = await supabase.rpc(
        "get_hospital_admin_dashboard_summary",
      );
      if (queryError) throw queryError;
      if (!data || typeof data !== "object" || !data.hospital_name) {
        throw new Error("Invalid dashboard response");
      }
      setSummary(data);
    } catch {
      setSummary(null);
      setError("Hospital overview could not be loaded. Confirm the dashboard migration is deployed and your hospital assignment is active.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFacilities = useCallback(async () => {
    setFacilitiesLoading(true);
    setFacilityError("");
    try {
      const { data, error: queryError } = await supabase.rpc(
        "get_hospital_admin_facilities",
      );
      if (queryError) throw queryError;
      if (!data || !Array.isArray(data.departments) || !Array.isArray(data.wards) || !Array.isArray(data.beds)) {
        throw new Error("Invalid facility response");
      }
      setFacilities(data);
    } catch {
      setFacilities(EMPTY_FACILITIES);
      setFacilityError("Facility data could not be loaded. Confirm the facility-management migration is deployed.");
    } finally {
      setFacilitiesLoading(false);
    }
  }, []);

  const loadAssignments = useCallback(async () => {
    setAssignmentLoading(true);
    setAssignmentError("");
    try {
      const { data, error: queryError } = await supabase.rpc("get_hospital_admin_assignment_data");
      if (queryError) throw queryError;
      if (!data || !Array.isArray(data.doctors) || !Array.isArray(data.nurses)
          || !Array.isArray(data.patients) || !Array.isArray(data.assignments)) {
        throw new Error("Invalid assignment response");
      }
      setAssignmentData(data);
    } catch {
      setAssignmentData(EMPTY_ASSIGNMENTS);
      setAssignmentError("Staff and patient assignment data could not be loaded. Confirm the assignment migration is deployed.");
    } finally {
      setAssignmentLoading(false);
    }
  }, []);

  const createFacility = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const kind = String(values.get("kind"));
    setSavingFacility(true);
    setFacilityError("");
    setFacilityNotice("");

    try {
      let rpcName;
      let rpcArgs;
      if (kind === "department") {
        rpcName = "create_hospital_department";
        rpcArgs = {
          p_name: String(values.get("name")).trim(),
          p_department_code: String(values.get("code")).trim(),
          p_description: String(values.get("description") || "").trim() || null,
          p_phone: String(values.get("phone") || "").trim() || null,
        };
      } else if (kind === "ward") {
        rpcName = "create_hospital_ward";
        rpcArgs = {
          p_department_id: Number(values.get("department_id")),
          p_name: String(values.get("name")).trim(),
          p_ward_code: String(values.get("code")).trim(),
          p_ward_type: String(values.get("ward_type")),
          p_floor: String(values.get("floor") || "").trim() || null,
          p_capacity: Number(values.get("capacity")),
        };
      } else {
        rpcName = "create_hospital_bed";
        rpcArgs = {
          p_ward_id: Number(values.get("ward_id")),
          p_bed_number: String(values.get("bed_number")).trim(),
          p_bed_type: String(values.get("bed_type")),
        };
      }

      const { error: createError } = await supabase.rpc(rpcName, rpcArgs);
      if (createError) throw createError;
      setFacilityNotice(`${kind.charAt(0).toUpperCase()}${kind.slice(1)} created.`);
      setFormKind("");
      form.reset();
      await Promise.all([loadFacilities(), loadSummary()]);
    } catch {
      setFacilityError(`The ${kind} could not be created. Check the fields, uniqueness, and your hospital access.`);
    } finally {
      setSavingFacility(false);
    }
  };

  const updateBedStatus = async (bedId, status) => {
    setFacilityError("");
    setFacilityNotice("");
    try {
      const { error: updateError } = await supabase.rpc("set_hospital_bed_status", {
        p_bed_id: bedId,
        p_status: status,
      });
      if (updateError) throw updateError;
      setFacilityNotice("Bed status updated.");
      await Promise.all([loadFacilities(), loadSummary()]);
    } catch {
      setFacilityError("Bed status could not be changed. An active admission may be using this bed.");
      await loadFacilities();
    }
  };

  const createStaffAccount = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const role = String(values.get("role"));
    setSavingStaff(true);
    setStaffError("");
    setFacilityNotice("");
    try {
      const { data, error: functionError } = await supabase.functions.invoke("create-user", {
        body: {
          email: String(values.get("email")).trim(),
          password: String(values.get("password")),
          full_name: String(values.get("full_name")).trim(),
          role,
          hospital_id: profile?.hospital_id,
          department_id: values.get("department_id") ? Number(values.get("department_id")) : null,
          specialization: String(values.get("specialization") || "").trim(),
          license_number: String(values.get("license_number") || "").trim(),
          qualification: String(values.get("qualification") || "").trim(),
          phone: String(values.get("phone") || "").trim(),
          experience_years: Number(values.get("experience_years") || 0),
        },
      });
      if (functionError) throw functionError;
      if (data?.error) throw new Error(data.error);
      const roleLabel = role === "doctor" ? "Doctor" : role === "nurse" ? "Nurse" : "Receptionist";
      setFacilityNotice(`${roleLabel} account${role === "receptionist" ? "" : " and staff profile"} created.`);
      setShowStaffForm(false);
      setStaffRole("doctor");
      form.reset();
      await loadSummary();
    } catch (err) {
      let message = err?.message || "Staff account could not be created.";
      if (err?.context && typeof err.context.json === "function") {
        try {
          const response = await err.context.json();
          if (response?.error) {
            message = [response.error, response.details].filter(Boolean).join(" ");
          }
        } catch {
          // Keep the function error message when its response is not readable.
        }
      }
      setStaffError(message);
    } finally {
      setSavingStaff(false);
    }
  };

  const createAssignment = async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const startValue = String(values.get("start_date") || "");
    const endValue = String(values.get("end_date") || "");
    setSavingAssignment(true);
    setAssignmentError("");
    setAssignmentNotice("");
    try {
      const { data, error: createError } = await supabase.rpc("create_hospital_patient_assignment", {
        p_patient_id: Number(values.get("patient_id")),
        p_doctor_id: assignmentRole === "doctor" ? Number(values.get("staff_id")) : null,
        p_nurse_id: assignmentRole === "nurse" ? Number(values.get("staff_id")) : null,
        p_assignment_type: String(values.get("assignment_type")),
        p_start_date: new Date(startValue).toISOString(),
        p_end_date: endValue ? new Date(endValue).toISOString() : null,
      });
      if (createError || !data?.assignment_id) throw createError || new Error("Assignment was not created");
      setAssignmentNotice("Clinical staff assignment created.");
      setShowAssignmentForm(false);
      setAssignmentStart(toLocalDateTimeInput());
      await loadAssignments();
    } catch {
      setAssignmentError("Assignment could not be created. Check the patient, staff member, dates, and overlapping assignments.");
    } finally {
      setSavingAssignment(false);
    }
  };

  const endAssignment = async (assignmentId) => {
    setAssignmentError("");
    setAssignmentNotice("");
    try {
      const { error: endError } = await supabase.rpc("end_hospital_patient_assignment", {
        p_assignment_id: assignmentId,
      });
      if (endError) throw endError;
      setAssignmentNotice("Assignment ended.");
      await loadAssignments();
    } catch {
      setAssignmentError("The assignment could not be ended. Refresh the page and try again.");
    }
  };

  useEffect(() => {
    // Initial loading is an intentional asynchronous effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSummary();
    loadFacilities();
    loadAssignments();
  }, [loadAssignments, loadFacilities, loadSummary]);

  return (
    <div className="hospital-admin-dashboard">
      <header className="hospital-admin-header">
        <div>
          <div className="clinical-brand">RoboVerse</div>
          <p>Hospital administration</p>
        </div>
        <div className="hospital-admin-header-actions">
          <span>{profile?.full_name || "Hospital administrator"}</span>
          <button type="button" className="secondary-action" onClick={loadSummary} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button type="button" className="clinical-logout" onClick={logout}>Logout</button>
        </div>
      </header>

      <main className="hospital-admin-main">
        <div className="hospital-admin-title">
          <div>
            <h1>Hospital overview</h1>
            <p>Aggregate operational totals for your assigned hospital.</p>
          </div>
          {summary && <span className="hospital-admin-name">{summary.hospital_name}</span>}
        </div>

        {error && <div className="clinical-message clinical-error" role="alert">{error}</div>}

        {loading && !summary ? (
          <div className="clinical-empty" role="status">Loading hospital overview...</div>
        ) : summary ? (
          <section className="hospital-admin-summary-grid" aria-label="Hospital operational summary">
            {SUMMARY_CARDS.map((card) => (
              <article className="hospital-admin-summary-card" key={card.key}>
                <span>{card.label}</span>
                <strong>{Number(summary[card.key] || 0).toLocaleString()}</strong>
                <small>{card.detail}</small>
              </article>
            ))}
          </section>
        ) : !error ? (
          <div className="clinical-empty">No hospital overview is available.</div>
        ) : null}

        <section className="hospital-facilities">
          <div className="hospital-facilities-heading">
            <div>
              <h2>Departments, wards, and beds</h2>
              <p>Manage the hospital structure used by admissions. Changes are restricted to your hospital and audited.</p>
            </div>
            <div className="hospital-facility-actions">
              <button type="button" className="secondary-action" onClick={() => setFormKind("department")}>Add department</button>
              <button type="button" className="secondary-action" onClick={() => setFormKind("ward")} disabled={!facilities.departments.some((department) => department.status === "active")}>Add ward</button>
              <button type="button" className="secondary-action" onClick={() => setFormKind("bed")} disabled={!facilities.wards.some((ward) => ward.status === "active" && ward.department_status === "active")}>Add bed</button>
              <button type="button" className="secondary-action" onClick={() => {
                setShowStaffForm((shown) => !shown);
                setStaffError("");
              }}>
                {showStaffForm ? "Close staff form" : "Add doctor or nurse"}
              </button>
            </div>
          </div>

          {facilityError && <div className="clinical-message clinical-error" role="alert">{facilityError}</div>}
          {facilityNotice && <div className="clinical-message clinical-success" role="status">{facilityNotice}</div>}

          {formKind && (
            <form className="hospital-facility-form" onSubmit={createFacility}>
              <input type="hidden" name="kind" value={formKind} />
              <h3>Add {formKind}</h3>
              {formKind === "department" && (
                <div className="hospital-facility-form-grid">
                  <label>Name<input name="name" maxLength={120} required /></label>
                  <label>Code<input name="code" minLength={2} maxLength={20} pattern="[A-Za-z0-9-]+" required /></label>
                  <label>Phone<input name="phone" maxLength={40} /></label>
                  <label>Description<input name="description" maxLength={300} /></label>
                </div>
              )}
              {formKind === "ward" && (
                <div className="hospital-facility-form-grid">
                  <label>Department<select name="department_id" required defaultValue="">
                    <option value="" disabled>Select department</option>
                    {facilities.departments.filter((department) => department.status === "active").map((department) => (
                      <option key={department.id} value={department.id}>{department.name}</option>
                    ))}
                  </select></label>
                  <label>Name<input name="name" maxLength={120} required /></label>
                  <label>Code<input name="code" minLength={2} maxLength={20} pattern="[A-Za-z0-9-]+" required /></label>
                  <label>Ward type<select name="ward_type" defaultValue="general">
                    {[["general", "General"], ["icu", "ICU"], ["emergency", "Emergency"], ["maternity", "Maternity"], ["pediatric", "Pediatric"], ["surgical", "Surgical"], ["medical", "Medical"], ["isolation", "Isolation"], ["other", "Other"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select></label>
                  <label>Floor<input name="floor" maxLength={40} /></label>
                  <label>Capacity<input name="capacity" type="number" min="0" max="10000" defaultValue="0" required /></label>
                </div>
              )}
              {formKind === "bed" && (
                <div className="hospital-facility-form-grid">
                  <label>Ward<select name="ward_id" required defaultValue="">
                    <option value="" disabled>Select ward</option>
                    {facilities.wards.filter((ward) => ward.status === "active" && ward.department_status === "active").map((ward) => (
                      <option key={ward.id} value={ward.id}>{ward.department_name} / {ward.name}</option>
                    ))}
                  </select></label>
                  <label>Bed number<input name="bed_number" maxLength={40} required /></label>
                  <label>Bed type<select name="bed_type" defaultValue="standard">
                    {[["standard", "Standard"], ["icu", "ICU"], ["electric", "Electric"], ["pediatric", "Pediatric"], ["maternity", "Maternity"], ["other", "Other"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select></label>
                </div>
              )}
              <div className="hospital-facility-form-actions">
                <button type="button" className="secondary-action" onClick={() => setFormKind("")}>Cancel</button>
                <button type="submit" disabled={savingFacility}>{savingFacility ? "Saving..." : `Save ${formKind}`}</button>
              </div>
            </form>
          )}

          {showStaffForm && (
            <form className="hospital-facility-form" onSubmit={createStaffAccount}>
              <h3>Create clinical staff account</h3>
              {staffError && <div className="clinical-message clinical-error" role="alert">{staffError}</div>}
              <div className="hospital-facility-form-grid">
                <label>Role<select name="role" value={staffRole} onChange={(event) => setStaffRole(event.target.value)}>
                  <option value="doctor">Doctor</option>
                  <option value="nurse">Nurse</option>
                  <option value="receptionist">Receptionist</option>
                </select></label>
                <label>Full name<input name="full_name" maxLength={160} autoComplete="name" required /></label>
                <label>Email<input name="email" type="email" autoComplete="email" required /></label>
                <label>Temporary password<input name="password" type="password" minLength={8} autoComplete="new-password" required /></label>
                {staffRole !== "receptionist" && (
                  <>
                    <label>Department<select name="department_id" defaultValue="">
                      <option value="">No department assigned</option>
                      {facilities.departments.filter((department) => department.status === "active").map((department) => (
                        <option key={department.id} value={department.id}>{department.name}</option>
                      ))}
                    </select></label>
                    <label>Specialization<input name="specialization" maxLength={120} required={staffRole === "doctor"} /></label>
                    <label>License number<input name="license_number" maxLength={100} /></label>
                    <label>Qualification<input name="qualification" maxLength={200} /></label>
                    <label>Phone<input name="phone" type="tel" maxLength={40} autoComplete="tel" /></label>
                    <label>Experience years<input name="experience_years" type="number" min="0" max="80" defaultValue="0" required /></label>
                  </>
                )}
              </div>
              <p className="hospital-staff-note">Doctor specialization is required. Doctor/nurse staff codes are generated by the server. Share temporary credentials through your hospital's approved process.</p>
              <div className="hospital-facility-form-actions">
                <button type="button" className="secondary-action" onClick={() => {
                  setShowStaffForm(false);
                  setStaffError("");
                }}>Cancel</button>
                <button type="submit" disabled={savingStaff}>{savingStaff ? "Creating..." : "Create staff account"}</button>
              </div>
            </form>
          )}

          {facilitiesLoading ? (
            <div className="clinical-empty" role="status">Loading facility directory...</div>
          ) : (
            <div className="hospital-facility-tables">
              <div className="hospital-facility-table-card">
                <h3>Departments ({facilities.departments.length})</h3>
                {facilities.departments.length === 0 ? <p className="clinical-empty">No departments yet.</p> : (
                  <div className="reception-table-wrap"><table className="reception-table">
                    <thead><tr><th>Code</th><th>Name</th><th>Status</th></tr></thead>
                    <tbody>{facilities.departments.map((department) => <tr key={department.id}><td>{department.department_code}</td><td>{department.name}</td><td>{department.status}</td></tr>)}</tbody>
                  </table></div>
                )}
              </div>
              <div className="hospital-facility-table-card">
                <h3>Wards ({facilities.wards.length})</h3>
                {facilities.wards.length === 0 ? <p className="clinical-empty">No wards yet.</p> : (
                  <div className="reception-table-wrap"><table className="reception-table">
                    <thead><tr><th>Department</th><th>Code</th><th>Name</th><th>Type</th><th>Capacity</th><th>Status</th></tr></thead>
                    <tbody>{facilities.wards.map((ward) => <tr key={ward.id}><td>{ward.department_name}</td><td>{ward.ward_code}</td><td>{ward.name}</td><td>{ward.ward_type}</td><td>{ward.capacity}</td><td>{ward.status}</td></tr>)}</tbody>
                  </table></div>
                )}
              </div>
              <div className="hospital-facility-table-card">
                <h3>Beds ({facilities.beds.length})</h3>
                {facilities.beds.length === 0 ? <p className="clinical-empty">No beds yet.</p> : (
                  <div className="reception-table-wrap"><table className="reception-table">
                    <thead><tr><th>Department</th><th>Ward</th><th>Number</th><th>Type</th><th>Status</th></tr></thead>
                    <tbody>{facilities.beds.map((bed) => <tr key={bed.id}>
                      <td>{bed.department_name}</td><td>{bed.ward_name}</td><td>{bed.bed_number}</td><td>{bed.bed_type}</td>
                      <td>{bed.status === "occupied" ? <span>Occupied</span> : (
                        <label className="visually-hidden" htmlFor={`bed-status-${bed.id}`}>Status for bed {bed.bed_number}</label>
                      )}{bed.status !== "occupied" && <select id={`bed-status-${bed.id}`} value={bed.status} onChange={(event) => updateBedStatus(bed.id, event.target.value)}>
                        {["available", "reserved", "maintenance", "inactive"].map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>}</td>
                    </tr>)}</tbody>
                  </table></div>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="hospital-facilities">
          <div className="hospital-facilities-heading">
            <div>
              <h2>Patient assignments</h2>
              <p>Assign active doctors or nurses to patients in this hospital. Assignment changes are audited.</p>
            </div>
            <div className="hospital-facility-actions">
              <button type="button" className="secondary-action" onClick={loadAssignments} disabled={assignmentLoading}>
                {assignmentLoading ? "Refreshing..." : "Refresh assignments"}
              </button>
              <button type="button" className="secondary-action" onClick={() => setShowAssignmentForm((shown) => !shown)}>
                {showAssignmentForm ? "Close assignment form" : "Add patient assignment"}
              </button>
            </div>
          </div>

          {assignmentError && <div className="clinical-message clinical-error" role="alert">{assignmentError}</div>}
          {assignmentNotice && <div className="clinical-message clinical-success" role="status">{assignmentNotice}</div>}

          {showAssignmentForm && (
            <form className="hospital-facility-form" onSubmit={createAssignment}>
              <h3>Assign clinical staff</h3>
              <div className="hospital-facility-form-grid">
                <label>Patient<select name="patient_id" required defaultValue="">
                  <option value="" disabled>Select patient</option>
                  {assignmentData.patients.map((patient) => (
                    <option key={patient.id} value={patient.id}>{patient.patient_number} — {patient.name} ({patient.status})</option>
                  ))}
                </select></label>
                <label>Staff role<select value={assignmentRole} onChange={(event) => setAssignmentRole(event.target.value)}>
                  <option value="doctor">Doctor</option>
                  <option value="nurse">Nurse</option>
                </select></label>
                <label>{assignmentRole === "doctor" ? "Doctor" : "Nurse"}<select name="staff_id" required defaultValue="">
                  <option value="" disabled>Select {assignmentRole}</option>
                  {(assignmentRole === "doctor" ? assignmentData.doctors : assignmentData.nurses).map((staff) => (
                    <option key={staff.id} value={staff.id}>{staff.name} — {staff[assignmentRole === "doctor" ? "doctor_code" : "nurse_code"]}</option>
                  ))}
                </select></label>
                <label>Assignment type<select name="assignment_type" defaultValue="primary">
                  <option value="primary">Primary</option>
                  <option value="supporting">Supporting</option>
                  <option value="temporary">Temporary</option>
                </select></label>
                <label>Starts at<input name="start_date" type="datetime-local" value={assignmentStart} onChange={(event) => setAssignmentStart(event.target.value)} required /></label>
                <label>Ends at (optional)<input name="end_date" type="datetime-local" min={assignmentStart} /></label>
              </div>
              <p className="hospital-staff-note">An empty end time keeps the assignment active until an administrator ends it. Overlapping assignments for the same patient and staff member are rejected.</p>
              <div className="hospital-facility-form-actions">
                <button type="button" className="secondary-action" onClick={() => setShowAssignmentForm(false)}>Cancel</button>
                <button type="submit" disabled={savingAssignment || assignmentData.patients.length === 0 || (assignmentRole === "doctor" ? assignmentData.doctors.length === 0 : assignmentData.nurses.length === 0)}>
                  {savingAssignment ? "Saving..." : "Create assignment"}
                </button>
              </div>
            </form>
          )}

          {assignmentLoading ? (
            <div className="clinical-empty" role="status">Loading assignments...</div>
          ) : assignmentData.assignments.length === 0 ? (
            <div className="clinical-empty">There are no active patient assignments.</div>
          ) : (
            <div className="reception-table-wrap"><table className="reception-table">
              <thead><tr><th>Patient</th><th>Staff</th><th>Type</th><th>Starts</th><th>Ends</th><th>Action</th></tr></thead>
              <tbody>{assignmentData.assignments.map((assignment) => (
                <tr key={assignment.id}>
                  <td>{assignment.patient_number} — {assignment.patient_name}</td>
                  <td>{assignment.staff_name} ({assignment.staff_code})</td>
                  <td>{assignment.assignment_type}</td>
                  <td>{new Date(assignment.start_date).toLocaleString()}</td>
                  <td>{assignment.end_date ? new Date(assignment.end_date).toLocaleString() : "Open ended"}</td>
                  <td><button type="button" className="secondary-action" onClick={() => endAssignment(assignment.id)}>End assignment</button></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
        <Devices hospitalId={profile?.hospital_id} hospitalName={summary?.hospital_name} />
        <HospitalStaffDirectory />
      </main>
    </div>
  );
}

export default HospitalAdminDashboard;
