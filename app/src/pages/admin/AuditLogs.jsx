import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadLogs = useCallback(async () => {
    setError("");

    const { data, error: queryError } = await supabase.rpc(
      "get_main_admin_audit_logs",
      { p_limit: 100 },
    );

    if (queryError) {
      console.error("Audit log list could not be loaded.");
      setError("Audit logs could not be loaded. Check the Supabase connection and access policies.");
      setLogs([]);
    } else {
      setLogs(data || []);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    // Initial data loading is an intentional async effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLogs();
  }, [loadLogs]);

  const searchTerm = search.trim().toLowerCase();
  const filteredLogs = logs.filter((log) => [
    log.action,
    log.table_name,
    log.record_id,
    log.user_id,
  ].some((value) => String(value ?? "").toLowerCase().includes(searchTerm)));

  return (
    <div className="audit-logs-page">
      <div className="system-alerts-heading">
        <div>
          <h2>Audit Logs</h2>
          <p>Recent recorded actions. Descriptions, metadata, network addresses, and clinical details are not shown here.</p>
        </div>
        <button
          type="button"
          className="secondary-action"
          onClick={loadLogs}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <div className="system-alerts-error" role="alert">{error}</div>}

      <section className="system-alerts-card" aria-labelledby="audit-log-title">
        <div className="system-alerts-toolbar">
          <div>
            <h3 id="audit-log-title">Recent actions</h3>
            <p>Showing up to 100 latest records</p>
          </div>
          <label>
            <span className="visually-hidden">Search audit logs</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search actions or IDs"
            />
          </label>
        </div>

        {loading ? (
          <div className="system-alerts-message" role="status">Loading audit activity…</div>
        ) : filteredLogs.length === 0 ? (
          <div className="system-alerts-message">
            {error ? "Audit activity is unavailable." : "No audit records match this search."}
          </div>
        ) : (
          <div className="system-alerts-table-wrap">
            <table className="system-alerts-table">
              <thead>
                <tr><th>Time</th><th>Action</th><th>Target</th><th>User ID</th></tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => (
                  <tr key={log.id}>
                    <td>{formatDate(log.created_at)}</td>
                    <td>{log.action}</td>
                    <td>{log.table_name ? `${log.table_name}${log.record_id ? ` #${log.record_id}` : ""}` : "—"}</td>
                    <td>{log.user_id || "System"}</td>
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
