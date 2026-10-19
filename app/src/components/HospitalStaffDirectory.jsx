import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const EMPTY = { doctors: [], nurses: [], departments: [] };
const EMPTY_FORM = {
  role: "doctor", staff_id: null, staff_code: "", name: "", email: "",
  department_id: "", specialization: "", license_number: "", qualification: "",
  phone: "", experience_years: "0", staff_status: "active",
};

export default function HospitalStaffDirectory() {
  const [directory, setDirectory] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null);

  const loadDirectory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: rpcError } = await supabase.rpc("get_hospital_admin_staff_directory");
      if (rpcError) throw rpcError;
      if (!data || !Array.isArray(data.doctors) || !Array.isArray(data.nurses) || !Array.isArray(data.departments)) {
        throw new Error("Invalid staff directory response");
      }
      setDirectory(data);
    } catch {
      setDirectory(EMPTY);
      setError("Staff directory could not be loaded. Confirm migration 010 is deployed and your hospital assignment is active.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial loading is an intentional asynchronous effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDirectory();
  }, [loadDirectory]);

  const startEdit = (role, staff) => {
    setEditing({
      ...EMPTY_FORM,
      role,
      staff_id: staff.staff_id,
      staff_code: staff.staff_code,
      name: staff.name || "",
      email: staff.email || "",
      department_id: staff.department_id == null ? "" : String(staff.department_id),
      specialization: staff.specialization || "",
      license_number: staff.license_number || "",
      qualification: staff.qualification || "",
      phone: staff.phone || "",
      experience_years: String(staff.experience_years ?? 0),
      staff_status: staff.staff_status,
    });
    setError("");
    setNotice("");
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { error: rpcError } = await supabase.rpc("update_hospital_staff_profile", {
        p_role: editing.role,
        p_staff_id: editing.staff_id,
        p_department_id: editing.department_id ? Number(editing.department_id) : null,
        p_specialization: editing.specialization.trim() || null,
        p_license_number: editing.license_number.trim() || null,
        p_qualification: editing.qualification.trim() || null,
        p_phone: editing.phone.trim() || null,
        p_experience_years: Number(editing.experience_years),
        p_staff_status: editing.staff_status,
      });
      if (rpcError) throw rpcError;
      setNotice(`${editing.role === "doctor" ? "Doctor" : "Nurse"} profile updated.`);
      setEditing(null);
      await loadDirectory();
    } catch {
      setError("Staff profile could not be updated. Check the details and department selection.");
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field) => (event) => setEditing((current) => ({ ...current, [field]: event.target.value }));

  return (
    <section className="hospital-facilities">
      <div className="hospital-facilities-heading">
        <div><h2>Clinical staff directory</h2><p>Maintain doctor and nurse professional details and staff-record status for this hospital.</p></div>
        <button type="button" className="secondary-action" onClick={loadDirectory} disabled={loading}>{loading ? "Refreshing..." : "Refresh staff"}</button>
      </div>
      {error && <div className="clinical-message clinical-error" role="alert">{error}</div>}
      {notice && <div className="clinical-message clinical-success" role="status">{notice}</div>}

      {editing && (
        <form className="hospital-facility-form" onSubmit={saveProfile}>
          <h3>Edit {editing.role} profile — {editing.name} ({editing.staff_code})</h3>
          <div className="hospital-facility-form-grid">
            <label>Department<select value={editing.department_id} onChange={updateField("department_id")}>
              <option value="">No department</option>
              {directory.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select></label>
            <label>Specialization<input value={editing.specialization} onChange={updateField("specialization")} maxLength={120} required={editing.role === "doctor"} /></label>
            <label>License number<input value={editing.license_number} onChange={updateField("license_number")} maxLength={100} /></label>
            <label>Qualification<input value={editing.qualification} onChange={updateField("qualification")} maxLength={200} /></label>
            <label>Phone<input value={editing.phone} onChange={updateField("phone")} maxLength={40} /></label>
            <label>Experience years<input type="number" min="0" max="80" value={editing.experience_years} onChange={updateField("experience_years")} required /></label>
            <label>Staff record status<select value={editing.staff_status} onChange={updateField("staff_status")}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select></label>
          </div>
          <p className="hospital-staff-note">This only changes the staff record. It does not change the login account, password, email, or role.</p>
          <div className="hospital-facility-form-actions">
            <button type="button" className="secondary-action" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
            <button type="submit" disabled={saving}>{saving ? "Saving..." : "Save staff profile"}</button>
          </div>
        </form>
      )}

      {loading ? <div className="clinical-empty" role="status">Loading staff directory...</div> : (
        <div className="hospital-facility-tables">
          {[["doctor", "Doctors", directory.doctors], ["nurse", "Nurses", directory.nurses]].map(([role, title, rows]) => (
            <div className="hospital-facility-table-card" key={role}>
              <h3>{title} ({rows.length})</h3>
              {rows.length === 0 ? <p className="clinical-empty">No {title.toLowerCase()} registered.</p> : (
                <div className="reception-table-wrap"><table className="reception-table">
                  <thead><tr><th>Staff member</th><th>Department</th><th>Professional details</th><th>Account / staff</th><th>Action</th></tr></thead>
                  <tbody>{rows.map((staff) => (
                    <tr key={staff.staff_id}>
                      <td><strong>{staff.name}</strong><br /><span>{staff.staff_code} · {staff.email}</span></td>
                      <td>{staff.department_name || "No department"}</td>
                      <td>{staff.specialization || "—"}<br /><span>{[staff.qualification, staff.experience_years != null && `${staff.experience_years} years`].filter(Boolean).join(" · ")}</span></td>
                      <td>{staff.account_status} / {staff.staff_status}</td>
                      <td><button type="button" className="secondary-action" onClick={() => startEdit(role, staff)}>Edit profile</button></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
