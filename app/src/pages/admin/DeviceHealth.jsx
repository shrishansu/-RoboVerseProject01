import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import EcgMonitor from "../../components/EcgMonitor";

const INVENTORY_REFRESH_MS = 30_000;
const HISTORY_REFRESH_MS = 30_000;
const LIVE_REFRESH_MS = 1_000;
const HISTORY_WINDOW_MS = 10 * 60 * 1_000;
const LIVE_WINDOW_MS = 10_000;
const CONFIG_MODULE_KEYS = ["MAX30102", "AD8232", "MPU6050", "VL53L0X"];
const MODULE_LABELS = {
  MAX30102: { title: "Heart-rate optical reader", description: "Shows raw RED/IR samples and an experimental pulse-rate estimate. This firmware does not calculate SpO₂." },
  AD8232: { title: "Heart electrical activity reader", description: "Shows saved raw ADC samples and lead status only when the signal is usable." },
  MPU6050: { title: "Movement reader", description: "Shows the connected movement sensor's recorded axes." },
  VL53L0X: { title: "Distance reader", description: "Shows the connected distance sensor's measurements." },
};
const SENSOR_STATUS_LABELS = {
  heart_reader: "Heart-rate optical reader",
  movement_sensor: "Movement reader",
  distance_sensor: "Distance reader",
  ecg_sensor: "Heart electrical activity reader",
};
const DEFAULT_CONFIG = { configurationEnabled: false, measurementDurationSeconds: 15, measurementIntervalSeconds: 60, calculationWindowSeconds: 10, uploadIntervalSeconds: 60, automaticUpload: true, modules: { MAX30102: { enabled: false, samplingRateHz: 100, sampleAverage: 4 }, AD8232: { enabled: false, samplingRateHz: 100 }, MPU6050: { enabled: false, samplingRateHz: 100, accelerationEnabled: true, gyroscopeEnabled: true }, VL53L0X: { enabled: false, measurementIntervalSeconds: 5 } } };

function connectedSensorConfig(config) {
  const sourceModules = config?.modules || {};
  const modules = Object.fromEntries(CONFIG_MODULE_KEYS.map((key) => [
    key,
    { ...DEFAULT_CONFIG.modules[key], ...(sourceModules[key] || {}) },
  ]));
  return { ...DEFAULT_CONFIG, ...(config || {}), modules };
}

function visibleSensorEntries(values) {
  return Object.entries(values || {}).filter(([key]) => Object.hasOwn(SENSOR_STATUS_LABELS, key));
}

function formatDate(value) {
  if (!value) return "No successful data ingestion recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Timestamp unavailable" : date.toLocaleString();
}

function display(value, unit = "") {
  return value === null || value === undefined ? "—" : `${value}${unit}`;
}

function ReadingChart({ readings, field, title, unit }) {
  const points = [...readings].filter((r) => r[field] !== null && r[field] !== undefined && Number.isFinite(Number(r[field]))).reverse();
  if (!points.length) return <article className="panel-card device-health-panel"><h3>{title}</h3><p className="clinical-empty">No {title.toLowerCase()} readings in this period.</p></article>;
  const values = points.map((r) => Number(r[field]));
  const min = Math.min(...values); const max = Math.max(...values); const spread = max - min || 1;
  const coords = values.map((v, i) => `${20 + i * 560 / Math.max(1, values.length - 1)},${175 - (v - min) * 145 / spread}`).join(" ");
  return <article className="panel-card device-health-panel"><h3>{title}</h3><p>{min.toFixed(1)}–{max.toFixed(1)} {unit} · {points.length} readings</p><svg viewBox="0 0 600 200" role="img" aria-label={`${title} chart with ${points.length} recorded values`} style={{ width: "100%", height: 200 }}><line x1="20" y1="180" x2="580" y2="180" stroke="currentColor" opacity=".2"/><polyline points={coords} fill="none" stroke="#16845b" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/></svg><small>Recorded values; gaps between samples are not interpolated clinically.</small></article>;
}

function deviceHealthErrorMessage(error) {
  const message = error?.message || "This device's health data could not be loaded.";
  if (error?.code === "PGRST202" || message.includes("get_device_health_data")) {
    return "Supabase does not expose get_device_health_data(p_device_id) yet. Apply migration 20261019000200_device_health_rpc.sql; if it is already applied, reload the PostgREST schema cache with NOTIFY pgrst, 'reload schema'.";
  }
  return message;
}

export default function DeviceHealth() {
  const [devices, setDevices] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [health, setHealth] = useState(null);
  const [liveReadings, setLiveReadings] = useState([]);
  const [ecgBatches, setEcgBatches] = useState([]);
  const [ecgFeedError, setEcgFeedError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [configuration, setConfiguration] = useState(DEFAULT_CONFIG);
  const [configVersion, setConfigVersion] = useState(0);
  const [configSaving, setConfigSaving] = useState(false);
  const [configMessage, setConfigMessage] = useState("");
  const initialLoadStartedForRef = useRef(null);

  const loadDevices = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    setError("");
    try {
      const { data, error: rpcError } = await supabase.rpc("get_device_management_data");
      if (rpcError) throw rpcError;
      if (!Array.isArray(data?.devices)) throw new Error("Device inventory returned an unexpected response.");
      setDevices(data.devices);
    } catch (loadError) {
      setError(loadError?.message || "Registered devices could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial inventory fetch is an intentional asynchronous effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDevices(true);
    const timer = window.setInterval(() => loadDevices(false), INVENTORY_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadDevices]);

  useEffect(() => {
    if (!selectedId) return undefined;
    let current = true;
    let requestInFlight = false;
    const loadSelectedDevice = async (showInitialLoading = false) => {
      if (requestInFlight) return;
      requestInFlight = true;
      if (showInitialLoading && initialLoadStartedForRef.current !== selectedId) {
        initialLoadStartedForRef.current = selectedId;
        setDetailLoading(true);
      }
      setDetailError("");
      try {
        const { data, error: rpcError } = await supabase.rpc("get_device_health_data", {
          p_device_id: Number(selectedId),
          p_from: new Date(Date.now() - HISTORY_WINDOW_MS).toISOString(),
          p_to: new Date().toISOString(),
        });
        if (rpcError) throw rpcError;
        if (!data?.device || !Array.isArray(data.readings)) throw new Error("Device health returned an unexpected response.");
        if (current) setHealth(data);
      } catch (loadError) {
        if (current) {
          setDetailError(deviceHealthErrorMessage(loadError));
        }
      } finally {
        requestInFlight = false;
        if (current) setDetailLoading(false);
      }
    };
    loadSelectedDevice(true);
    const timer = window.setInterval(() => loadSelectedDevice(false), HISTORY_REFRESH_MS);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return undefined;
    let current = true;
    let requestInFlight = false;
    const loadLiveWindow = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const to = new Date();
        const from = new Date(to.getTime() - LIVE_WINDOW_MS);
        const { data, error: rpcError } = await supabase.rpc("get_device_health_data", {
          p_device_id: Number(selectedId),
          p_from: from.toISOString(),
          p_to: to.toISOString(),
        });
        if (rpcError) throw rpcError;
        if (current && Array.isArray(data?.readings)) setLiveReadings(data.readings);
      } catch {
        // Keep the last confirmed points on screen. The chart marks them stale
        // after three seconds rather than replacing them with invented data.
      } finally {
        requestInFlight = false;
      }
    };
    loadLiveWindow();
    const timer = window.setInterval(loadLiveWindow, LIVE_REFRESH_MS);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return undefined;
    let current = true;
    let inFlight = false;
    let since = null;
    let timer = null;
    let realtimeConnected = false;
    const setReconciliationRate = (milliseconds) => {
      if (timer) window.clearInterval(timer);
      timer = window.setInterval(fetchBatches, milliseconds);
    };
    const mergeBatches = (incoming) => {
      if (!incoming.length) return;
      const newest = incoming.reduce((latest, batch) => !latest || new Date(batch.recorded_at) > new Date(latest.recorded_at) ? batch : latest, null);
      if (newest && (!since || new Date(newest.recorded_at) > new Date(since))) since = newest.recorded_at;
      setEcgBatches((existing) => {
        const byId = new Map(existing.map((batch) => [batch.batch_id, batch]));
        incoming.forEach((batch) => byId.set(batch.batch_id, batch));
        return [...byId.values()].sort((a, b) => new Date(a.batch_started_at) - new Date(b.batch_started_at)).slice(-30);
      });
    };
    const fetchBatches = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const { data, error: batchError } = await supabase.rpc("get_device_ecg_batches", {
          p_device_id: Number(selectedId),
          p_seconds: 30,
          p_since: since,
        });
        if (batchError) throw batchError;
        const incoming = Array.isArray(data?.batches) ? data.batches : [];
        if (current) {
          mergeBatches(incoming);
          if (!realtimeConnected) setEcgFeedError(false);
        }
      } catch {
        if (current) {
          setEcgFeedError(true);
          setReconciliationRate(1_000);
        }
      } finally {
        inFlight = false;
      }
    };
    const channel = supabase
      .channel(`device-ecg:${selectedId}`, { config: { private: true } })
      .on("broadcast", { event: "ecg_batch" }, (message) => {
        if (!current) return;
        const batch = message?.payload?.batch;
        if (!batch || Number(batch.device_id) !== Number(selectedId)) return;
        setEcgFeedError(false);
        mergeBatches([batch]);
      })
      .subscribe((status) => {
        if (!current) return;
        if (status === "SUBSCRIBED") {
          realtimeConnected = true;
          setEcgFeedError(false);
          // Reconcile after joining so batches committed during the initial
          // fetch / WebSocket handshake are not missed.
          fetchBatches();
          // Continue a one-second reconciliation even after joining Realtime,
          // so silently missed broadcasts are recovered promptly.
          setReconciliationRate(1_000);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          realtimeConnected = false;
          setEcgFeedError(true);
          setReconciliationRate(1_000);
        }
      });
    fetchBatches();
    setReconciliationRate(1_000);
    return () => {
      current = false;
      if (timer) window.clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return undefined;
    let current = true;
    const loadConfiguration = async () => {
      try {
        const { data, error: configError } = await supabase.rpc("get_device_measurement_config", { p_device_id: Number(selectedId) });
        if (configError) throw configError;
        if (current) {
          setConfiguration(connectedSensorConfig(data?.configuration));
          setConfigVersion(data?.version || 0);
          setConfigMessage("");
        }
      } catch (configError) {
        if (current) setConfigMessage(`Configuration could not be loaded: ${configError.message || "RPC unavailable"}`);
      }
    };
    loadConfiguration();
    return () => { current = false; };
  }, [selectedId]);

  const saveConfiguration = async () => {
    setConfigSaving(true); setConfigMessage("");
    const { data, error: saveError } = await supabase.rpc("save_device_measurement_config", { p_device_id: Number(selectedId), p_config: connectedSensorConfig(configuration) });
    setConfigSaving(false);
    if (saveError) setConfigMessage(saveError.message || "Configuration could not be saved.");
    else {
      const { data: confirmation, error: readError } = await supabase.rpc("get_device_measurement_config", { p_device_id: Number(selectedId) });
      if (readError) setConfigMessage(`Save returned version ${data?.version ?? "unknown"}, but read-back failed: ${readError.message}`);
      else {
        const version = confirmation?.version || data?.version || configVersion + 1;
        setConfigVersion(version);
        setConfiguration(connectedSensorConfig(confirmation?.configuration || configuration));
        setConfigMessage(`Database confirmed configuration version ${version}. Device will receive it on its next configuration check.`);
      }
    }
  };

  const toggleModule = (key, enabled) => setConfiguration((current) => ({ ...current, modules: { ...current.modules, [key]: { ...current.modules[key], enabled } } }));

  const filteredDevices = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return devices;
    return devices.filter((device) => [device.id, device.device_code, device.device_name, device.assigned_patient_name]
      .filter(Boolean).some((field) => String(field).toLowerCase().includes(search)));
  }, [devices, query]);

  const selectDevice = (event) => {
    setSelectedId(event.target.value);
    initialLoadStartedForRef.current = null;
    setHealth(null);
    setLiveReadings([]);
    setEcgBatches([]);
    setEcgFeedError(false);
    setConfiguration(connectedSensorConfig(DEFAULT_CONFIG));
    setConfigVersion(0);
    setConfigMessage("");
    setDetailError("");
    setDetailLoading(Boolean(event.target.value));
  };

  const device = health?.device;
  const readings = health?.readings || [];
  const latest = liveReadings[0] || readings[0];

  return (
    <div className="admin-page device-health-page">
      <div className="admin-page-header">
        <div><h2>Device Health</h2><p>Check registered devices, assigned patients, and device specific sensor readings.</p></div>
        <button className="secondary-action" type="button" onClick={() => loadDevices(false)} disabled={loading}>Refresh devices</button>
      </div>

      <section className="panel-card device-health-panel device-health-selector">
        <label htmlFor="device-health-search">Search registered devices</label>
        <input id="device-health-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by ID, name, code, or patient" />
        <label htmlFor="device-health-select">Select Device</label>
        <select id="device-health-select" value={selectedId} onChange={selectDevice} disabled={loading || Boolean(error)}>
          <option value="">Choose a registered device</option>
          {filteredDevices.map((item) => (
            <option key={item.id} value={item.id}>ID {item.id} · {item.device_name || item.device_code}{item.has_patient_assignment ? ` · ${item.assigned_patient_name || "Assigned patient (identity hidden)"}` : " · Unassigned"}</option>
          ))}
        </select>
        {loading && <p role="status">Loading registered devices…</p>}
        {error && <div className="clinical-message clinical-error" role="alert">{error}</div>}
        {!loading && !error && devices.length === 0 && <p className="clinical-empty">No registered devices. Register devices at <Link to="/admin/devices">Devices</Link>.</p>}
        {!loading && !error && devices.length > 0 && filteredDevices.length === 0 && <p className="clinical-empty">No registered devices match this search.</p>}
      </section>

      {selectedId && detailLoading && <div className="clinical-empty" role="status">Loading selected device health…</div>}
      {selectedId && detailError && <div className="clinical-message clinical-error" role="alert">{detailError}</div>}
      {device && !detailLoading && <>
        <div className="device-health-summary">
          <article className="device-health-stat"><span>Registered device</span><strong>{device.device_name || device.device_code}</strong><small>ID {device.id} · {device.device_code}</small></article>
          <article className="device-health-stat"><span>Communication status</span><strong className={`health-${device.status}-text`}>{device.status[0].toUpperCase() + device.status.slice(1)}</strong><small>Based on last successful ingestion; stale after 90 seconds</small></article>
          <article className="device-health-stat"><span>Last successful ingestion</span><strong className="device-health-refresh">{formatDate(device.last_seen_at)}</strong><small>Updated by the authenticated device ingest function</small></article>
          <article className="device-health-stat"><span>Assigned patient</span><strong className="device-health-refresh">{device.assigned_patient_label || "No patient assigned"}</strong><small>{device.has_patient_assignment ? "Assignment from the registered device record" : "Assign this registered device in Devices"}</small></article>
        </div>

        <section className="panel-card device-health-panel">
          <h3>Connection diagnostics</h3>
          <ul className="device-health-diagnostics">
            <li><span>Device credential</span><strong>{device.credential_status || "Not provisioned"}</strong></li>
            <li><span>Recent database readings</span><strong>{readings.length ? `${readings.length} returned` : "None available"}</strong></li>
          </ul>
          <p className="device-health-note">For authentication errors, verify the device ID header matches the JSON device_id and use that device’s active credential. Confirm the device has an active patient assignment. Never share the credential secret.</p>
        </section>

        <section className="panel-card device-health-panel device-health-config">
          <div className="device-health-section-heading"><div><h3>Measurement configuration</h3><p>Saved version {configVersion}. Module settings describe desired configuration, not detected hardware.</p></div></div>
          <label><input type="checkbox" checked={configuration.configurationEnabled} onChange={(e) => setConfiguration({ ...configuration, configurationEnabled: e.target.checked })} /> Enable device configuration</label>
          <div className="device-health-config-grid">
            {[["measurementDurationSeconds", "Measurement duration (s)"], ["measurementIntervalSeconds", "Measurement interval (s)"], ["calculationWindowSeconds", "Calculation window (s)"], ["uploadIntervalSeconds", "Upload interval (s)"]].map(([key, label]) => <label key={key}>{label}<input type="number" min="1" max="86400" value={configuration[key]} onChange={(e) => setConfiguration({ ...configuration, [key]: Number(e.target.value) })} /></label>)}
          </div>
          <div className="device-health-module-grid">{Object.entries(configuration.modules || {}).map(([key, module]) => { const label = MODULE_LABELS[key]; return <div key={key} className="device-health-module-config"><label className="device-health-module-toggle"><input type="checkbox" checked={Boolean(module.enabled)} onChange={(e) => toggleModule(key, e.target.checked)} /> <strong>{label.title}</strong></label><p className="device-health-module-description">{label.description}</p>{module.samplingRateHz != null && <label>Sampling rate (Hz)<input type="number" min="1" max="3200" value={module.samplingRateHz} onChange={(e) => setConfiguration((c) => ({ ...c, modules: { ...c.modules, [key]: { ...c.modules[key], samplingRateHz: Number(e.target.value) } } }))} /></label>}{module.sampleAverage != null && <label>Sample average<input type="number" min="1" max="32" value={module.sampleAverage} onChange={(e) => setConfiguration((c) => ({ ...c, modules: { ...c.modules, [key]: { ...c.modules[key], sampleAverage: Number(e.target.value) } } }))} /></label>}</div>; })}</div>
          <label><input type="checkbox" checked={configuration.automaticUpload} onChange={(e) => setConfiguration({ ...configuration, automaticUpload: e.target.checked })} /> Automatic upload</label>
          <button className="secondary-action" type="button" disabled={configSaving} onClick={saveConfiguration}>{configSaving ? "Saving…" : "Save device configuration"}</button>
          {configMessage && <p role="status">{configMessage}</p>}
        </section>

        <section className="panel-card device-health-panel">
          <div className="device-health-section-heading"><div><h3>Latest device readings</h3><p>Persisted sensor readings received for device ID {device.id}; unavailable sensors remain blank.</p></div></div>
          {!device.has_patient_assignment ? <div className="clinical-empty">This device has no assigned patient. Assign it from Devices before uploading patient readings: device-ingest rejects unassigned devices, and this page only shows readings linked to the current assignment.</div> : !latest ? <div className="clinical-empty">No readings have been received for this device and its current patient in the selected time range. Check device connection, credential, ingest response, and whether the migrations and Edge Function are deployed.</div> : (
            <dl className="device-health-vitals">
              <div><dt>Recorded at</dt><dd>{formatDate(latest.recorded_at)}</dd></div>
              <div><dt>Pulse-rate estimate (prototype)</dt><dd>{latest.pulse_rate_estimate_bpm == null ? "Waiting for a stable optical pulse" : display(latest.pulse_rate_estimate_bpm, " bpm")}</dd></div>
              <div><dt>Raw RED (window average)</dt><dd>{display(latest.red_raw)}</dd></div>
              <div><dt>Raw IR (window average)</dt><dd>{display(latest.ir_raw)}</dd></div>
              <div><dt>Distance</dt><dd>{display(latest.distance_mm, " mm")}</dd></div>
              <div><dt>ECG raw ADC sample</dt><dd>{latest.sensor_status?.ecg_sensor === "ok" ? display(latest.ecg_value) : "Unavailable · check leads"}</dd></div>
              <div><dt>ECG leads</dt><dd>{latest.ecg_lead_off_positive == null && latest.ecg_lead_off_negative == null ? "Unavailable" : `${latest.ecg_lead_off_positive ? "LO+ off" : "LO+ connected"} · ${latest.ecg_lead_off_negative ? "LO− off" : "LO− connected"}`}</dd></div>
              <div><dt>Movement X / Y / Z</dt><dd>{[latest.motion_x, latest.motion_y, latest.motion_z].map((value) => display(value, " g")).join(" / ")}</dd></div>
            </dl>
          )}
        </section>

        {device.has_patient_assignment && <>
          {latest && <section className="panel-card device-health-panel"><h3>Sensor status</h3><ul className="device-health-diagnostics">{visibleSensorEntries(latest.sensor_status).map(([key, status]) => <li key={key}><span>{SENSOR_STATUS_LABELS[key] || key}</span><strong>{status.replaceAll("_", " ")}</strong></li>)}</ul>{visibleSensorEntries(latest.sensor_errors).length > 0 && <div className="clinical-message clinical-error" role="status">{visibleSensorEntries(latest.sensor_errors).map(([key, message]) => <div key={key}>{SENSOR_STATUS_LABELS[key] || key}: {message}</div>)}</div>}</section>}
          <div className="device-health-details"><ReadingChart readings={readings} field="pulse_rate_estimate_bpm" title="Pulse-rate estimate · last 10 minutes (prototype)" unit="bpm"/><EcgMonitor batches={ecgBatches} feedError={ecgFeedError}/></div>
        </>}
      </>}
    </div>
  );
}
