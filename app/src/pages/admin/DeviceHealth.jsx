import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";

const INVENTORY_REFRESH_MS = 30_000;
const HISTORY_REFRESH_MS = 30_000;
const LIVE_REFRESH_MS = 1_000;
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

function EcgTrendChart({ readings, latest }) {
  const latestAgeMs = latest?.recorded_at ? Date.now() - new Date(latest.recorded_at).getTime() : Infinity;
  const latestIsUsable = latest?.sensor_status?.ecg_sensor === "ok" && latest?.ecg_value != null && Number.isFinite(Number(latest.ecg_value)) && latestAgeMs <= 3_000;
  const cutoff = Date.now() - 60_000;
  const points = [...readings]
    .filter((reading) => {
      const time = new Date(reading.recorded_at).getTime();
      return reading.ecg_value != null && Number.isFinite(Number(reading.ecg_value)) && Number.isFinite(time) && time >= cutoff;
    })
    .reverse();

  return (
    <article className="panel-card device-health-panel ecg-trend-card">
      <div className="device-health-section-heading">
        <div><h3>Heart electrical activity · last minute</h3><p>Saved raw ADC window averages, with their recorded times</p></div>
        <span className="ecg-live-indicator" role="status"><i aria-hidden="true" />Live · refreshes every second</span>
        <span className={`ecg-signal-state${latestIsUsable ? " is-usable" : ""}`}>{latestIsUsable ? "Signal present" : "No usable current signal"}</span>
      </div>
      <>
        <svg className="ecg-trend-svg" viewBox="0 0 720 240" role="img" aria-label={latestIsUsable ? `Recorded ECG ADC trend with ${points.length} real samples from the last minute` : "ECG monitor grid; no valid samples because the current signal is unavailable"}>
          <defs><pattern id="ecg-small-grid" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M 12 0 L 0 0 0 12" fill="none" stroke="#f3caca" strokeWidth="0.6" /></pattern><pattern id="ecg-large-grid" width="60" height="60" patternUnits="userSpaceOnUse"><rect width="60" height="60" fill="url(#ecg-small-grid)"/><path d="M 60 0 L 0 0 0 60" fill="none" stroke="#e7a9a9" strokeWidth="1" /></pattern></defs>
          <rect width="720" height="240" fill="url(#ecg-large-grid)" />
          {latestIsUsable && points.length >= 2 ? (() => {
              const values = points.map((point) => Number(point.ecg_value));
              const min = Math.min(...values); const max = Math.max(...values); const spread = max - min || 1;
              const coords = values.map((value, index) => `${24 + index * 672 / (values.length - 1)},${214 - ((value - min) / spread) * 188}`).join(" ");
              return <polyline points={coords} fill="none" stroke="#087f63" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />;
            })() : <text x="360" y="125" textAnchor="middle" fill="#a52b2b" fontSize="18" fontWeight="600">{latestIsUsable ? "Waiting for valid saved samples" : "NO VALID ECG SIGNAL · CHECK LEADS"}</text>}
        </svg>
        {latestIsUsable && points.length >= 2 ? (
          <>
            <div className="ecg-trend-times"><span>{new Date(points[0].recorded_at).toLocaleTimeString()}</span><span>{new Date(points.at(-1).recorded_at).toLocaleTimeString()}</span></div>
            <small>{points.length} saved points · newest sample {new Date(points.at(-1).recorded_at).toLocaleTimeString()}. The firmware stores one one-second window average per upload; this monitor-style trend is not a clinical ECG waveform or diagnostic display.</small>
          </>
        ) : <small>No trace is drawn unless recent, real samples are valid. Current firmware reports lead-off or no valid samples.</small>}
      </>
    </article>
  );
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
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);
  const [readingRefresh, setReadingRefresh] = useState(0);
  const [configuration, setConfiguration] = useState(DEFAULT_CONFIG);
  const [configVersion, setConfigVersion] = useState(0);
  const [configSaving, setConfigSaving] = useState(false);
  const [configMessage, setConfigMessage] = useState("");
  const [periodHours, setPeriodHours] = useState(24);
  const initialLoadStartedForRef = useRef(null);

  const loadDevices = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    setError("");
    try {
      const { data, error: rpcError } = await supabase.rpc("get_device_management_data");
      if (rpcError) throw rpcError;
      if (!Array.isArray(data?.devices)) throw new Error("Device inventory returned an unexpected response.");
      setDevices(data.devices);
      setLastRefresh(new Date());
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
          p_from: new Date(Date.now() - periodHours * 60 * 60 * 1000).toISOString(),
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
  }, [selectedId, readingRefresh, periodHours]);

  useEffect(() => {
    if (!selectedId) return undefined;
    let current = true;
    let requestInFlight = false;
    const loadLiveWindow = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const to = new Date();
        const from = new Date(to.getTime() - 60_000);
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
              <div><dt>Pulse-rate estimate (prototype)</dt><dd>{display(latest.pulse_rate_estimate_bpm, " bpm")}</dd></div>
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
          <div className="device-health-details"><ReadingChart readings={readings} field="pulse_rate_estimate_bpm" title="Pulse-rate estimate (prototype)" unit="bpm"/><EcgTrendChart readings={liveReadings} latest={latest}/></div>
        </>}

        <section className="panel-card device-health-panel">
          <div className="device-health-section-heading"><div><h3>Recent readings</h3><p>Newest first · filtered by device ID, current patient assignment, and selected time period</p></div><select aria-label="Reading time period" value={periodHours} onChange={(e) => setPeriodHours(Number(e.target.value))}><option value={1}>Last hour</option><option value={24}>Last 24 hours</option><option value={168}>Last 7 days</option></select><button type="button" className="secondary-action" onClick={() => {
            setReadingRefresh((value) => value + 1);
          }}>Refresh readings</button></div>
          {!device.has_patient_assignment ? <div className="clinical-empty">No patient is assigned to this device.</div> : readings.length === 0 ? <div className="clinical-empty">No readings are available for this device yet.</div> : (
            <div className="device-health-table-wrap"><table className="device-health-table"><thead><tr><th>Recorded at</th><th>Pulse estimate</th><th>Raw RED</th><th>Raw IR</th><th>Distance</th><th>Raw ECG ADC</th><th>Lead status</th><th>Movement X / Y / Z (g)</th><th>Sensor status</th></tr></thead>
              <tbody>{readings.map((reading) => <tr key={reading.id}><td>{formatDate(reading.recorded_at)}</td><td>{display(reading.pulse_rate_estimate_bpm, " bpm")}</td><td>{display(reading.red_raw)}</td><td>{display(reading.ir_raw)}</td><td>{display(reading.distance_mm, " mm")}</td><td>{reading.sensor_status?.ecg_sensor === "ok" ? display(reading.ecg_value) : "Unavailable"}</td><td>{reading.ecg_lead_off_positive == null && reading.ecg_lead_off_negative == null ? "—" : `${reading.ecg_lead_off_positive ? "LO+ off" : "LO+ on"} / ${reading.ecg_lead_off_negative ? "LO− off" : "LO− on"}`}</td><td>{[reading.motion_x, reading.motion_y, reading.motion_z].map((value) => display(value, " g")).join(" / ")}</td><td>{reading.sensor_status ? visibleSensorEntries(reading.sensor_status).map(([, status]) => status).join(", ") || "Unavailable" : "Unavailable"}</td></tr>)}</tbody>
            </table></div>
          )}
          <p className="device-health-footnote">Readings update automatically every 5 seconds. Inventory checked {lastRefresh ? lastRefresh.toLocaleString() : "—"}.</p>
        </section>
      </>}
    </div>
  );
}
