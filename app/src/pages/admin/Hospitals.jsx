import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const BLANK_HOSPITAL = {
  id: null,
  hospital_code: "",
  name: "",
  email: "",
  phone: "",
  registration_number: "",
  address: "",
  city: "",
  province: "",
  postal_code: "",
  status: "active",
};

function locationLabel(hospital) {
  return [hospital.city, hospital.province].filter(Boolean).join(", ") || "—";
}

export default function Hospitals() {
  const [hospitals, setHospitals] = useState([]);
  const [hospitalForm, setHospitalForm] = useState(BLANK_HOSPITAL);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");

  const loadHospitals = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: rpcError } = await supabase.rpc("get_main_admin_hospital_directory");
      if (rpcError) throw rpcError;
      if (!Array.isArray(data)) throw new Error("Invalid hospital list response");
      setHospitals(data);
    } catch {
      setHospitals([]);
      setError("Hospital directory could not be loaded. Confirm migration 008 is deployed and your account is active.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial loading is an intentional asynchronous effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadHospitals();
  }, [loadHospitals]);

  const openCreate = () => {
    setHospitalForm(BLANK_HOSPITAL);
    setFormOpen(true);
    setError("");
    setNotice("");
  };

  const openEdit = (hospital) => {
    setHospitalForm({ ...BLANK_HOSPITAL, ...hospital });
    setFormOpen(true);
    setError("");
    setNotice("");
  };

  const saveHospital = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    const values = {
      p_hospital_code: hospitalForm.hospital_code.trim(),
      p_name: hospitalForm.name.trim(),
      p_email: hospitalForm.email.trim() || null,
      p_phone: hospitalForm.phone.trim() || null,
      p_registration_number: hospitalForm.registration_number.trim() || null,
      p_address: hospitalForm.address.trim() || null,
      p_city: hospitalForm.city.trim() || null,
      p_province: hospitalForm.province.trim() || null,
      p_postal_code: hospitalForm.postal_code.trim() || null,
    };

    try {
      let rpcError;
      if (hospitalForm.id) {
        ({ error: rpcError } = await supabase.rpc("update_main_admin_hospital", {
          p_hospital_id: hospitalForm.id,
          ...values,
          p_status: hospitalForm.status,
        }));
      } else {
        ({ error: rpcError } = await supabase.rpc("create_main_admin_hospital", values));
      }
      if (rpcError) throw rpcError;
      setNotice(hospitalForm.id ? "Hospital details updated." : "Hospital registered.");
      setFormOpen(false);
      setHospitalForm(BLANK_HOSPITAL);
      await loadHospitals();
    } catch {
      setError("Hospital could not be saved. Check the fields and confirm the hospital code is unique.");
    } finally {
      setSaving(false);
    }
  };

  const setField = (field) => (event) => {
    setHospitalForm((current) => ({ ...current, [field]: event.target.value }));
  };
  const normalizedSearch = search.trim().toLowerCase();
  const filteredHospitals = hospitals.filter((hospital) => [
    hospital.name,
    hospital.hospital_code,
    hospital.city,
    hospital.province,
    hospital.email,
  ].some((value) => String(value || "").toLowerCase().includes(normalizedSearch)));

  return (
    <section className="hospital-facilities">
      <div className="hospital-facilities-heading">
        <div>
          <h2>Hospital Management</h2>
          <p>Register hospitals and maintain their contact and location details.</p>
        </div>
        <div className="hospital-facility-actions">
          <button type="button" className="secondary-action" onClick={loadHospitals} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button type="button" className="secondary-action" onClick={openCreate}>Add hospital</button>
        </div>
      </div>

      {error && <div className="clinical-message clinical-error" role="alert">{error}</div>}
      {notice && <div className="clinical-message clinical-success" role="status">{notice}</div>}

      {formOpen && (
        <form className="hospital-facility-form" onSubmit={saveHospital}>
          <h3>{hospitalForm.id ? "Update hospital" : "Register hospital"}</h3>
          <div className="hospital-facility-form-grid">
            <label>Hospital name<input value={hospitalForm.name} onChange={setField("name")} maxLength={160} required /></label>
            <label>Hospital code<input value={hospitalForm.hospital_code} onChange={setField("hospital_code")} minLength={2} maxLength={30} pattern="[A-Za-z0-9-]+" required /></label>
            <label>Email<input type="email" value={hospitalForm.email || ""} onChange={setField("email")} maxLength={254} /></label>
            <label>Phone<input type="tel" value={hospitalForm.phone || ""} onChange={setField("phone")} maxLength={40} /></label>
            <label>Registration number<input value={hospitalForm.registration_number || ""} onChange={setField("registration_number")} maxLength={100} /></label>
            <label>Address<input value={hospitalForm.address || ""} onChange={setField("address")} maxLength={300} /></label>
            <label>City<input value={hospitalForm.city || ""} onChange={setField("city")} maxLength={100} /></label>
            <label>Province / region<input value={hospitalForm.province || ""} onChange={setField("province")} maxLength={100} /></label>
            <label>Postal code<input value={hospitalForm.postal_code || ""} onChange={setField("postal_code")} maxLength={30} /></label>
            {hospitalForm.id && <label>Status<select value={hospitalForm.status} onChange={setField("status")}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select></label>}
          </div>
          {hospitalForm.id && <p className="hospital-staff-note">Changing a hospital's status may affect staff workflows. Existing records are retained.</p>}
          <div className="hospital-facility-form-actions">
            <button type="button" className="secondary-action" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button>
            <button type="submit" disabled={saving}>{saving ? "Saving..." : hospitalForm.id ? "Save changes" : "Register hospital"}</button>
          </div>
        </form>
      )}

      <div className="hospital-facility-table-card">
        <div className="hospital-facilities-heading">
          <div><h3>Hospitals ({filteredHospitals.length})</h3><p>Search by name, code, email, or location.</p></div>
          <label><span className="visually-hidden">Search hospitals</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search hospitals" /></label>
        </div>
        {loading ? <div className="clinical-empty" role="status">Loading hospitals...</div> : filteredHospitals.length === 0 ? (
          <div className="clinical-empty">{error ? "Hospital directory is unavailable." : "No hospitals match this search."}</div>
        ) : (
          <div className="reception-table-wrap"><table className="reception-table">
            <thead><tr><th>Code</th><th>Hospital</th><th>Location</th><th>Contact</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>{filteredHospitals.map((hospital) => (
              <tr key={hospital.id}>
                <td>{hospital.hospital_code}</td>
                <td><strong>{hospital.name}</strong><br /><span>{hospital.registration_number || "No registration number"}</span></td>
                <td>{locationLabel(hospital)}</td>
                <td>{hospital.email || hospital.phone || "—"}</td>
                <td>{hospital.status}</td>
                <td><button type="button" className="secondary-action" onClick={() => openEdit(hospital)}>Edit</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </section>
  );
}
