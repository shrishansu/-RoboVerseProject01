import { useState } from "react";

const SETTINGS_STORAGE_KEY = "roboverse-admin-settings";

const initialSettings = {
  organizationName: "RoboVerse Health",
  timezone: "UTC",
  sessionTimeout: "30",
  alertThreshold: "medium",
  devicePolling: "30",
  retentionDays: "365",
  emailAlerts: true,
  smsAlerts: false,
};

function readSettings() {
  try {
    const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    return stored
      ? { ...initialSettings, ...JSON.parse(stored) }
      : { ...initialSettings };
  } catch {
    return { ...initialSettings };
  }
}

export default function Settings() {
  const [settings, setSettings] = useState(readSettings);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const handleFieldChange = (field, value) => {
    setSettings((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const saveSettings = (event) => {
    event.preventDefault();
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      setError("");
      setNotice("Settings saved in this browser only. They are not applied to live platform services.");
    } catch {
      setNotice("");
      setError("Settings could not be saved in this browser.");
    }
  };

  const resetSettings = () => {
    setSettings({ ...initialSettings });
    setNotice("");
    try {
      window.localStorage.removeItem(SETTINGS_STORAGE_KEY);
      setError("");
      setNotice("Settings restored to defaults for this browser.");
    } catch {
      setError("Defaults are shown, but this browser could not clear the saved settings.");
    }
  };

  return (
    <div className="admin-page settings-page">
      <div className="admin-page-header">
        <div>
          <h2>System settings</h2>
          <p>
            Configure the operational defaults for governance, alerts, and device monitoring.
          </p>
        </div>
        <button type="button" className="secondary-action" onClick={resetSettings}>
          Reset to defaults
        </button>
      </div>

      <p className="settings-scope-note">
        These preferences are saved in this browser and do not change live platform services.
      </p>

      {error && <div className="clinical-message clinical-error" role="alert">{error}</div>}
      {notice && <div className="clinical-message clinical-success" role="status">{notice}</div>}

      <form className="settings-form" onSubmit={saveSettings}>
        <section className="panel-card settings-panel">
          <h3>Organization</h3>
          <div className="settings-grid">
            <label className="settings-field">
              <span>Organization name</span>
              <input
                type="text"
                value={settings.organizationName}
                onChange={(event) => handleFieldChange("organizationName", event.target.value)}
              />
            </label>

            <label className="settings-field">
              <span>Timezone</span>
              <select value={settings.timezone} onChange={(event) => handleFieldChange("timezone", event.target.value)}>
                <option value="UTC">UTC</option>
                <option value="America/New_York">America/New_York</option>
                <option value="Europe/London">Europe/London</option>
                <option value="Asia/Dubai">Asia/Dubai</option>
              </select>
            </label>
          </div>
        </section>

        <section className="panel-card settings-panel">
          <h3>Operational defaults</h3>
          <div className="settings-grid">
            <label className="settings-field">
              <span>Session timeout (minutes)</span>
              <input
                type="number"
                min="10"
                max="180"
                value={settings.sessionTimeout}
                onChange={(event) => handleFieldChange("sessionTimeout", event.target.value)}
              />
            </label>

            <label className="settings-field">
              <span>Alert threshold</span>
              <select value={settings.alertThreshold} onChange={(event) => handleFieldChange("alertThreshold", event.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>

            <label className="settings-field">
              <span>Device polling (seconds)</span>
              <input
                type="number"
                min="15"
                max="300"
                value={settings.devicePolling}
                onChange={(event) => handleFieldChange("devicePolling", event.target.value)}
              />
            </label>

            <label className="settings-field">
              <span>Data retention (days)</span>
              <input
                type="number"
                min="30"
                max="3650"
                value={settings.retentionDays}
                onChange={(event) => handleFieldChange("retentionDays", event.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="panel-card settings-panel">
          <h3>Notifications</h3>
          <div className="settings-toggle-list">
            <label className="settings-toggle-row">
              <span>Email alerts</span>
              <input
                type="checkbox"
                checked={settings.emailAlerts}
                onChange={(event) => handleFieldChange("emailAlerts", event.target.checked)}
              />
            </label>

            <label className="settings-toggle-row">
              <span>SMS alerts</span>
              <input
                type="checkbox"
                checked={settings.smsAlerts}
                onChange={(event) => handleFieldChange("smsAlerts", event.target.checked)}
              />
            </label>
          </div>
        </section>

        <div className="settings-actions">
          <button type="submit" className="primary-action">Save settings</button>
        </div>
      </form>
    </div>
  );
}