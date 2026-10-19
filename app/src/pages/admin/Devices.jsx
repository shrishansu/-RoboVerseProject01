import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const EMPTY_DATA = { hospitals: [], devices: [] };
const DEVICE_TYPES = [
  ["patient_monitor", "Patient monitor"],
  ["esp32", "ESP32"],
  ["sensor_gateway", "Sensor gateway"],
  ["other", "Other"],
];

function dateLabel(value) {
  if (!value) return "Never seen";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function deviceErrorMessage(error, fallback) {
  if (error?.code === "23505") {
    return "A device with this code, serial number, or MAC address already exists.";
  }
  const message = [error?.message, error?.details].filter(Boolean).join(" — ");
  return message || fallback;
}

export default function Devices({ hospitalId = null, hospitalName = "" }) {
  const hospitalScoped = hospitalId !== null && hospitalId !== undefined;
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [assigningId, setAssigningId] = useState(null);
  const [assignmentPatients, setAssignmentPatients] = useState([]);
  const [loadingAssignmentPatients, setLoadingAssignmentPatients] = useState(false);
  const [provisionedSecret, setProvisionedSecret] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: result, error: rpcError } = await supabase.rpc("get_device_management_data");
      if (rpcError) throw rpcError;
      if (!result || !Array.isArray(result.devices) || !Array.isArray(result.hospitals)) {
        throw new Error("Invalid device inventory response");
      }
      setData(result);
    } catch (err) {
      setData(EMPTY_DATA);
      setError(deviceErrorMessage(err, "Device inventory could not be loaded. Confirm migration 007 is deployed and your account is active."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial loading is an intentional asynchronous effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const createDevice = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { error: rpcError } = await supabase.rpc("create_managed_device", {
        p_device_code: String(values.get("device_code")).trim(),
        p_device_name: String(values.get("device_name")).trim(),
        p_device_type: String(values.get("device_type")),
        p_hospital_id: Number(values.get("hospital_id")),
        p_model: String(values.get("model") || "").trim() || null,
        p_serial_number: String(values.get("serial_number") || "").trim() || null,
        p_mac_address: String(values.get("mac_address") || "").trim() || null,
        p_firmware_version: String(values.get("firmware_version") || "").trim() || null,
        p_notes: String(values.get("notes") || "").trim() || null,
      });
      if (rpcError) throw rpcError;
      setNotice("Device registered with offline status.");
      setShowCreateForm(false);
      form.reset();
      await loadData();
    } catch (err) {
      setError(deviceErrorMessage(err, "Device could not be registered. Check the hospital, required fields, and unique device code or serial number."));
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (deviceId, status) => {
    setError("");
    setNotice("");
    try {
      const { error: rpcError } = await supabase.rpc("set_managed_device_status", {
        p_device_id: deviceId,
        p_status: status,
      });
      if (rpcError) throw rpcError;
      setNotice("Device status updated.");
      await loadData();
    } catch (err) {
      await loadData();
      setError(deviceErrorMessage(err, "Device status could not be changed. The device may have changed or be outside your access scope."));
    }
  };

  const assignDevice = async (event, device) => {
    event.preventDefault();
    const patientNumber = String(new FormData(event.currentTarget).get("patient_number") || "").trim();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const { error: rpcError } = await supabase.rpc("assign_device_by_patient_number", {
        p_device_id: device.id,
        p_patient_number: patientNumber,
      });
      if (rpcError) throw rpcError;
      setNotice(`Device ${device.device_code} assigned. Patient identity is not shown in this inventory.`);
      setAssigningId(null);
      await loadData();
    } catch (err) {
      setError(deviceErrorMessage(err, "Assignment failed. Verify the patient number belongs to this device's hospital and the patient is active or admitted."));
    } finally {
      setSaving(false);
    }
  };

  const openAssignmentForm = async (device) => {
    setError("");
    setNotice("");
    setAssignmentPatients([]);
    setAssigningId(device.id);
    setLoadingAssignmentPatients(true);
    try {
      const { data: patients, error: rpcError } = await supabase.rpc(
        "list_managed_device_assignment_patients",
        { p_device_id: device.id },
      );
      if (rpcError) throw rpcError;
      setAssignmentPatients(patients || []);
    } catch (err) {
      setError(deviceErrorMessage(err, "Patients for this device's hospital could not be loaded."));
    } finally {
      setLoadingAssignmentPatients(false);
    }
  };

  const unassignDevice = async (device) => {
    setError("");
    setNotice("");
    try {
      const { error: rpcError } = await supabase.rpc("unassign_managed_device", { p_device_id: device.id });
      if (rpcError) throw rpcError;
      setNotice(`Device ${device.device_code} is no longer assigned to a patient.`);
      await loadData();
    } catch (err) {
      await loadData();
      setError(deviceErrorMessage(err, "Device assignment could not be removed."));
    }
  };

  const provisionCredential = async (device) => {
    setError("");
    setNotice("");
    setProvisionedSecret("");
    try {
      const { data: result, error: rpcError } = await supabase.rpc("provision_device_credential", {
        target_device_id: device.id,
      });
      if (rpcError) throw rpcError;
      if (!result?.device_secret) throw new Error("Credential secret was not returned");
      setProvisionedSecret(result.device_secret);
      setNotice(`Credential provisioned for ${device.device_code}. Copy it now; it cannot be retrieved later.`);
      await loadData();
    } catch (err) {
      setError(deviceErrorMessage(err, "Credential could not be provisioned. Revoke any active credential first and confirm the device is eligible."));
    }
  };

  const revokeCredential = async (device) => {
    if (!window.confirm(`Revoke the credential for ${device.device_code}? Device data ingest will stop until another credential is provisioned.`)) return;
    setError("");
    setNotice("");
    setProvisionedSecret("");
    try {
      const { error: rpcError } = await supabase.rpc("revoke_device_credential", {
        target_device_id: device.id,
      });
      if (rpcError) throw rpcError;
      setNotice(`Credential revoked for ${device.device_code}.`);
      await loadData();
    } catch (err) {
      setError(deviceErrorMessage(err, "Credential could not be revoked. Refresh the inventory and try again."));
    }
  };

  const copyProvisionedSecret = async () => {
    try {
      await navigator.clipboard.writeText(provisionedSecret);
      setNotice("Credential copied. Store it in your approved secret manager.");
    } catch {
      setError("Clipboard access was denied. Select and copy the credential manually.");
    }
  };

  const hospitalNames = new Map(data.hospitals.map((hospital) => [String(hospital.id), hospital.name]));

  return (
    <section className="hospital-facilities">
      <div className="hospital-facilities-heading">
        <div>
          <h2>IoT Devices</h2>
          <p>Register monitor hardware, check connection status, and manage a device’s current patient assignment.</p>
        </div>
        <div className="hospital-facility-actions">
          <button type="button" className="secondary-action" onClick={loadData} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button type="button" className="secondary-action" onClick={() => setShowCreateForm((shown) => !shown)}>
            {showCreateForm ? "Close form" : "Register device"}
          </button>
        </div>
      </div>

      {error && !showCreateForm && assigningId === null && <div className="clinical-message clinical-error" role="alert">{error}</div>}
      {notice && <div className="clinical-message clinical-success" role="status">{notice}</div>}
      {provisionedSecret && <div className="hospital-facility-form" role="region" aria-label="One-time device credential">
        <h3>Copy this device credential now</h3>
        <p>This secret is shown only in this provisioning response. Store it securely and configure the device before closing this page.</p>
        <div className="hospital-facility-actions">
          <code className="device-secret-value">{provisionedSecret}</code>
          <button type="button" className="secondary-action" onClick={copyProvisionedSecret}>Copy credential</button>
          <button type="button" className="secondary-action" onClick={() => setProvisionedSecret("")}>Hide credential</button>
        </div>
      </div>}

      {showCreateForm && (
        <form className="hospital-facility-form" onSubmit={createDevice}>
          <h3>Register a device</h3>
          {error && <div className="clinical-message clinical-error" role="alert">{error}</div>}
          <div className="hospital-facility-form-grid">
            {hospitalScoped ? (
              <label>Hospital<input value={hospitalName || "Your assigned hospital"} readOnly /><input type="hidden" name="hospital_id" value={hospitalId} /></label>
            ) : (
              <label>Hospital<select name="hospital_id" required defaultValue="">
                <option value="" disabled>Select hospital</option>
                {data.hospitals.map((hospital) => <option key={hospital.id} value={hospital.id}>{hospital.name} ({hospital.hospital_code})</option>)}
              </select></label>
            )}
            <label>Device code<input name="device_code" maxLength={80} required /></label>
            <label>Device name<input name="device_name" maxLength={120} required /></label>
            <label>Type<select name="device_type" defaultValue="esp32">
              {DEVICE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label>Model<input name="model" maxLength={120} /></label>
            <label>Serial number<input name="serial_number" maxLength={120} /></label>
            <label>MAC address<input name="mac_address" maxLength={40} /></label>
            <label>Firmware version<input name="firmware_version" maxLength={80} /></label>
            <label>Notes<input name="notes" maxLength={1000} /></label>
          </div>
          <p className="hospital-staff-note">New devices start offline. Patient identity and vital readings are not included in this inventory.</p>
          <div className="hospital-facility-form-actions">
            <button type="button" className="secondary-action" onClick={() => setShowCreateForm(false)}>Cancel</button>
            <button type="submit" disabled={saving || (hospitalScoped ? !hospitalId : data.hospitals.length === 0)}>{saving ? "Saving..." : "Register device"}</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="clinical-empty" role="status">Loading device inventory...</div>
      ) : data.devices.length === 0 ? (
        <div className="clinical-empty">No devices are registered in the available scope.</div>
      ) : (
        <div className="reception-table-wrap"><table className="reception-table">
          <thead><tr><th>Device</th><th>Hospital</th><th>Model / firmware</th><th>Last seen</th><th>Patient assignment</th><th>Credential</th><th>Status</th></tr></thead>
          <tbody>{data.devices.map((device) => (
            <tr key={device.id}>
              <td><strong>{device.device_name}</strong><br /><span>{device.device_code} · {device.device_type}</span></td>
              <td>{device.hospital_name || hospitalNames.get(String(device.hospital_id)) || "Unassigned"}</td>
              <td>{[device.model, device.firmware_version && `FW ${device.firmware_version}`].filter(Boolean).join(" · ") || "—"}</td>
              <td>{dateLabel(device.last_seen_at)}</td>
              <td>
                {device.has_patient_assignment ? (
                  <div className="hospital-facility-actions">
                    <span>{hospitalScoped ? device.assigned_patient_name || "Assigned" : "Assigned (identity hidden)"}</span>
                    <button type="button" className="secondary-action" onClick={() => unassignDevice(device)}>Unassign</button>
                  </div>
                ) : assigningId === device.id ? (
                  <form className="hospital-facility-actions" onSubmit={(event) => assignDevice(event, device)}>
                    {error && <div className="clinical-message clinical-error" role="alert">{error}</div>}
                    {loadingAssignmentPatients ? (
                      <span role="status">Loading patients...</span>
                    ) : assignmentPatients.length === 0 ? (
                      <span>No active or admitted patients at this hospital.</span>
                    ) : (
                      <label><span className="visually-hidden">Patient number</span>
                        <select name="patient_number" defaultValue="" required>
                          <option value="" disabled>Select patient</option>
                          {assignmentPatients.map((patient) => (
                            <option key={patient.patient_number} value={patient.patient_number}>
                              {patient.patient_number} ({patient.patient_status})
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button type="submit" disabled={saving || loadingAssignmentPatients || assignmentPatients.length === 0}>Assign</button>
                    <button type="button" className="secondary-action" onClick={() => {
                      setAssigningId(null);
                      setAssignmentPatients([]);
                      setError("");
                    }}>Cancel</button>
                  </form>
                ) : (
                  <button type="button" className="secondary-action" onClick={() => openAssignmentForm(device)}>Assign patient</button>
                )}
              </td>
              <td>{device.credential_status === "active" ? (
                <button type="button" className="secondary-action" onClick={() => revokeCredential(device)}>Revoke</button>
              ) : (
                <button type="button" className="secondary-action" onClick={() => provisionCredential(device)} disabled={device.status === "inactive" || device.status === "maintenance"}>
                  {device.credential_status === "revoked" ? "Rotate credential" : "Provision credential"}
                </button>
              )}</td>
              <td><label className="visually-hidden" htmlFor={`device-status-${device.id}`}>Status for {device.device_code}</label>
                <select id={`device-status-${device.id}`} value={device.status} onChange={(event) => changeStatus(device.id, event.target.value)}>
                  {device.status === "online" && <option value="online" disabled>Online (reported by device)</option>}
                  {["offline", "maintenance", "inactive"].map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="hospital-staff-note">Credential secrets are returned only during provisioning or rotation and are held only in this page's current memory. Firmware deployment and physical-device verification are still required.</p>
    </section>
  );
}
