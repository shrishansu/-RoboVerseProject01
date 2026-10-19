import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const STATUSES = ["active", "acknowledged", "resolved", "dismissed"];

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadAlerts = useCallback(async () => {
    setError("");

    const { data, error: queryError } = await supabase.rpc(
      "get_main_admin_alert_overview",
      { p_limit: 100 },
    );

    if (queryError) {
      console.error("System alert overview could not be loaded.");
      setError("The alert overview could not be loaded. Check the Supabase connection and access policies.");
      setAlerts([]);
    } else {
      setAlerts(data || []);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    // Initial data loading is an intentional async effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAlerts();
  }, [loadAlerts]);

  const filteredAlerts = useMemo(
    () => statusFilter === "all"
      ? alerts
      : alerts.filter((alert) => alert.status === statusFilter),
    [alerts, statusFilter],
  );

  const counts = useMemo(() => ({
    active: alerts.filter((alert) => alert.status === "active").length,
    acknowledged: alerts.filter((alert) => alert.status === "acknowledged").length,
    resolved: alerts.filter((alert) => alert.status === "resolved").length,
    dismissed: alerts.filter((alert) => alert.status === "dismissed").length,
  }), [alerts]);

  return (
    <div className="system-alerts-page">
      <div className="system-alerts-heading">
        <div>
          <h2>System Alerts</h2>
          <p>Recent alert activity across RoboVerse. Patient details and clinical values are hidden in this view.</p>
        </div>
        <button
          type="button"
          className="secondary-action"
          onClick={loadAlerts}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="system-alerts-summary" aria-label="Status of the latest 100 alerts">
        <div><span>Open</span><strong>{counts.active}</strong></div>
        <div><span>Acknowledged</span><strong>{counts.acknowledged}</strong></div>
        <div><span>Resolved</span><strong>{counts.resolved}</strong></div>
        <div><span>Dismissed</span><strong>{counts.dismissed}</strong></div>
      </div>

      {error && <div className="system-alerts-error" role="alert">{error}</div>}

      <section className="system-alerts-card" aria-labelledby="recent-alerts-title">
        <div className="system-alerts-toolbar">
          <div>
            <h3 id="recent-alerts-title">Recent activity</h3>
            <p>Showing up to 100 latest alerts</p>
          </div>
          <label>
            <span className="visually-hidden">Filter alerts by status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status === "active" ? "Open" : status.charAt(0).toUpperCase() + status.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading ? (
          <div className="system-alerts-message" role="status">Loading alert activity…</div>
        ) : filteredAlerts.length === 0 ? (
          <div className="system-alerts-message">
            {error ? "Alert activity is unavailable." : "No alerts match this filter."}
          </div>
        ) : (
          <div className="system-alerts-table-wrap">
            <table className="system-alerts-table">
              <thead>
                <tr><th>Time</th><th>Category</th><th>Severity</th><th>Status</th></tr>
              </thead>
              <tbody>
                {filteredAlerts.map((alert) => (
                  <tr key={alert.id}>
                    <td>{formatDate(alert.created_at)}</td>
                    <td>{alert.alert_type.replaceAll("_", " ")}</td>
                    <td><span className={`system-alerts-severity severity-${alert.severity}`}>{alert.severity}</span></td>
                    <td><span className={`system-alerts-status status-${alert.status}`}>{alert.status === "active" ? "Open" : alert.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
