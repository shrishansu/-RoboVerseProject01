import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";

const EMPTY_COMPLETION_FORM = {
  hospital_id: "",
  specialization: "",
  license_number: "",
  qualification: "",
  phone: "",
  experience_years: "0",
};

function StaffDirectory({ role }) {
  const [staff, setStaff] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [selectedHospital, setSelectedHospital] = useState("all");
  const [completionTarget, setCompletionTarget] = useState(null);
  const [completionForm, setCompletionForm] = useState(EMPTY_COMPLETION_FORM);
  const heading = role === "doctor" ? "Doctor Management" : "Nurse Management";

  const loadStaff = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [staffResult, hospitalResult] = await Promise.all([
        supabase.rpc("get_main_admin_staff_directory", { p_role: role }),
        supabase.rpc("get_main_admin_hospital_directory"),
      ]);
      if (staffResult.error) throw staffResult.error;
      if (hospitalResult.error) throw hospitalResult.error;
      if (!Array.isArray(staffResult.data) || !Array.isArray(hospitalResult.data)) {
        throw new Error("Invalid directory response");
      }
      setStaff(staffResult.data);
      setHospitals(hospitalResult.data);
    } catch {
      setStaff([]);
      setHospitals([]);
      setError(`The ${role} directory could not be loaded. Check the directory migrations and your administrator access.`);
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    // Initial loading is an intentional asynchronous effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStaff();
  }, [loadStaff]);

  const filteredStaff = useMemo(() => {
    const term = search.trim().toLowerCase();
    return staff.filter((person) => {
      const matchesHospital = selectedHospital === "all"
        || (selectedHospital === "unassigned" && !person.hospital_id)
        || String(person.hospital_id) === selectedHospital;
      const matchesSearch = !term || [
        person.name,
        person.email,
        person.staff_code,
        person.hospital_name,
        person.hospital_code,
        person.department_name,
        person.specialization,
        person.license_number,
      ].some((value) => String(value || "").toLowerCase().includes(term));
      return matchesHospital && matchesSearch;
    });
  }, [search, selectedHospital, staff]);

  const openCompletionForm = (person) => {
    setCompletionTarget(person);
    setCompletionForm({
      ...EMPTY_COMPLETION_FORM,
      hospital_id: person.hospital_id ? String(person.hospital_id) : "",
      specialization: person.specialization || "",
      license_number: person.license_number || "",
      qualification: person.qualification || "",
      phone: person.phone || "",
      experience_years: String(person.experience_years ?? 0),
    });
    setError("");
    setNotice("");
  };

  const completeStaffProfile = async (event) => {
    event.preventDefault();
    if (!completionTarget) return;

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { error: rpcError } = await supabase.rpc("complete_missing_clinical_staff_profile", {
        p_user_id: completionTarget.profile_id,
        p_hospital_id: Number(completionForm.hospital_id),
        p_specialization: completionForm.specialization.trim() || null,
        p_license_number: completionForm.license_number.trim() || null,
        p_qualification: completionForm.qualification.trim() || null,
        p_phone: completionForm.phone.trim() || null,
        p_experience_years: Number(completionForm.experience_years),
        p_department_id: null,
      });
      if (rpcError) throw rpcError;

      setNotice(`${role === "doctor" ? "Doctor" : "Nurse"} staff profile completed.`);
      setCompletionTarget(null);
      setCompletionForm(EMPTY_COMPLETION_FORM);
      await loadStaff();
    } catch (completionError) {
      console.error("Clinical staff profile completion failed:", completionError);
      setError("The staff profile could not be completed. Verify the hospital and professional details, then try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="hospital-facilities">
      <div className="hospital-facilities-heading">
        <div>
          <h2>{heading}</h2>
          <p>Professional staff directory across hospitals. Patient assignments and clinical records are not included.</p>
        </div>
        <button type="button" className="secondary-action" onClick={loadStaff} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      {error && <div className="clinical-message clinical-error" role="alert">{error}</div>}
      {notice && <div className="clinical-message clinical-success" role="status">{notice}</div>}
      {completionTarget && (
        <form className="hospital-facility-form" onSubmit={completeStaffProfile}>
          <h3>Complete {role} profile for {completionTarget.name || completionTarget.email}</h3>
          <p className="hospital-staff-note">This links the existing login account to its clinical staff record. It does not create or change login credentials.</p>
          <div className="hospital-facility-form-grid">
            <label>Hospital<select
              value={completionForm.hospital_id}
              onChange={(event) => setCompletionForm((current) => ({ ...current, hospital_id: event.target.value }))}
              required
            >
              <option value="">Select active hospital</option>
              {hospitals.filter((hospital) => hospital.status === "active").map((hospital) => <option key={hospital.id} value={hospital.id}>{hospital.name} ({hospital.hospital_code})</option>)}
            </select></label>
            <label>Specialization<input
              value={completionForm.specialization}
              onChange={(event) => setCompletionForm((current) => ({ ...current, specialization: event.target.value }))}
              maxLength={120}
              required={role === "doctor"}
            /></label>
            <label>License number<input
              value={completionForm.license_number}
              onChange={(event) => setCompletionForm((current) => ({ ...current, license_number: event.target.value }))}
              maxLength={100}
            /></label>
            <label>Qualification<input
              value={completionForm.qualification}
              onChange={(event) => setCompletionForm((current) => ({ ...current, qualification: event.target.value }))}
              maxLength={200}
            /></label>
            <label>Phone<input
              type="tel"
              value={completionForm.phone}
              onChange={(event) => setCompletionForm((current) => ({ ...current, phone: event.target.value }))}
              maxLength={40}
            /></label>
            <label>Experience years<input
              type="number"
              min="0"
              max="80"
              value={completionForm.experience_years}
              onChange={(event) => setCompletionForm((current) => ({ ...current, experience_years: event.target.value }))}
              required
            /></label>
          </div>
          <div className="hospital-facility-form-actions">
            <button type="button" className="secondary-action" onClick={() => setCompletionTarget(null)} disabled={saving}>Cancel</button>
            <button type="submit" disabled={saving || hospitals.length === 0}>{saving ? "Saving..." : "Complete staff profile"}</button>
          </div>
          {hospitals.length === 0 && <p className="hospital-staff-note">Register an active hospital before completing this profile.</p>}
        </form>
      )}
      <div className="hospital-facility-table-card">
        <div className="hospital-facilities-heading">
          <div><h3>{heading} ({filteredStaff.length})</h3><p>Filter by hospital or search staff details.</p></div>
          <div className="staff-directory-filters">
            <label>
              <span className="visually-hidden">Filter by hospital</span>
              <select value={selectedHospital} onChange={(event) => setSelectedHospital(event.target.value)}>
                <option value="all">All hospitals</option>
                {hospitals.map((hospital) => (
                  <option key={hospital.id} value={hospital.id}>
                    {hospital.name} ({hospital.hospital_code}){hospital.status === "active" ? "" : " - inactive"}
                  </option>
                ))}
                <option value="unassigned">No hospital assigned</option>
              </select>
            </label>
            <label>
              <span className="visually-hidden">Search staff directory</span>
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search directory" />
            </label>
          </div>
        </div>
        {loading ? <div className="clinical-empty" role="status">Loading staff directory...</div> : filteredStaff.length === 0 ? (
          <div className="clinical-empty staff-directory-empty">
            {error ? "Staff directory is unavailable." : search.trim() ? `No ${role} records match this search.` : (
              <>
                <p>No {role} accounts are registered yet.</p>
                <Link className="secondary-action" to="/admin/users">Open user management</Link>
              </>
            )}
          </div>
        ) : (
          <div className="reception-table-wrap"><table className="reception-table">
            <thead><tr><th>Staff member</th><th>Hospital / department</th><th>Specialty / qualifications</th><th>Experience</th><th>Account / staff status</th><th>Action</th></tr></thead>
            <tbody>{filteredStaff.map((person) => (
              <tr key={person.staff_id || person.profile_id}>
                <td><strong>{person.name || "Unnamed"}</strong><br /><span>{person.staff_code || "Staff profile missing"} · {person.email || "No email"}</span></td>
                <td>{person.hospital_name}{person.hospital_code ? ` (${person.hospital_code})` : ""}<br /><span>{person.department_name || "No department"}</span></td>
                <td>{person.specialization || "—"}<br /><span>{[person.qualification, person.license_number && `License ${person.license_number}`].filter(Boolean).join(" · ") || "No qualification details"}</span></td>
                <td>{person.experience_years == null ? "—" : `${person.experience_years} years`}</td>
                <td>{person.account_status} / {person.profile_complete ? person.staff_status : "staff profile incomplete"}</td>
                <td>{person.profile_complete ? "—" : <button type="button" className="secondary-action" onClick={() => openCompletionForm(person)}>Complete profile</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </section>
  );
}

export default StaffDirectory;
