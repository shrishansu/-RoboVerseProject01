import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../context/AuthContext";

export default function AdminDashboard() {
  const { profile } = useAuth();

  const [stats, setStats] = useState({
    hospitals: 0,
    users: 0,
    patients: 0,
    devices: 0,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [recentActivity, setRecentActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState("");

  const loadDashboardStats = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc(
        "get_main_admin_dashboard_stats"
      );

      setError("");

      if (error) {
        console.error(
          "Dashboard statistics error:",
          error
        );

        throw error;
      }

      if (!data) {
        throw new Error(
          "No dashboard statistics were returned."
        );
      }

      setStats({
        hospitals: Number(data.hospitals) || 0,
        users: Number(data.users) || 0,
        patients: Number(data.patients) || 0,
        devices: Number(data.devices) || 0,
      });
    } catch (err) {
      console.error(err);

      setError(
        err?.message ||
          "Dashboard statistics could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRecentActivity = useCallback(async () => {
    setActivityLoading(true);
    setActivityError("");
    try {
      const { data, error: queryError } = await supabase.rpc(
        "get_main_admin_audit_logs",
        { p_limit: 5 },
      );
      if (queryError) throw queryError;
      setRecentActivity(Array.isArray(data) ? data : []);
    } catch {
      setRecentActivity([]);
      setActivityError("Recent audit activity is unavailable.");
    } finally {
      setActivityLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDashboardStats();
    loadRecentActivity();
  }, [loadDashboardStats, loadRecentActivity]);

  return (
    <div className="admin-dashboard">

      <div className="page-heading">
        <div>
          <h2>Dashboard</h2>

          <p>
            Welcome back,{" "}
            <strong>
              {profile?.full_name || "Administrator"}
            </strong>
            .
          </p>
        </div>

        <div className="system-status">
          <span className="status-dot"></span>
          System Operational
        </div>
      </div>

      {error && (
        <div className="dashboard-error">
          {error}
        </div>
      )}

      <div className="stat-grid">

        <div className="stat-card">
          <div className="stat-icon">🏥</div>

          <div>
            <span>Hospitals</span>

            <strong>
              {loading ? "—" : stats.hospitals}
            </strong>

            <small>
              Registered hospitals
            </small>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">👥</div>

          <div>
            <span>Total Users</span>

            <strong>
              {loading ? "—" : stats.users}
            </strong>

            <small>
              Active system users
            </small>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">🩺</div>

          <div>
            <span>Patients</span>

            <strong>
              {loading ? "—" : stats.patients}
            </strong>

            <small>
              Registered patients
            </small>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">◈</div>

          <div>
            <span>IoT Devices</span>

            <strong>
              {loading ? "—" : stats.devices}
            </strong>

            <small>
              Registered devices
            </small>
          </div>
        </div>

      </div>

      <div className="dashboard-grid">

        <div className="dashboard-panel">

          <div className="panel-header">
            <div>
              <h3>System Overview</h3>

              <p>
                Current RoboVerse platform status
              </p>
            </div>
          </div>

          <div className="overview-list">

            <div className="overview-row">
              <span>Database</span>

              <strong className={error ? "status-unavailable" : "healthy"}>
                {loading ? "Checking" : error ? "Unavailable" : "Connected"}
              </strong>
            </div>

            <div className="overview-row">
              <span>Authentication</span>

              <strong className={profile ? "healthy" : "status-unavailable"}>
                {profile ? "Active" : "Unavailable"}
              </strong>
            </div>

            <div className="overview-row">
              <span>Registered devices</span>

              <strong className="healthy">
                {loading ? "—" : stats.devices}
              </strong>
            </div>

            <div className="overview-row">
              <span>Authorization</span>

              <strong className="healthy">
                Role-scoped
              </strong>
            </div>

          </div>

        </div>

        <div className="dashboard-panel">

          <div className="panel-header">
            <div>
              <h3>Quick Actions</h3>

              <p>
                Frequently used administration tools
              </p>
            </div>
          </div>

          <div className="quick-actions">

            <Link to="/admin/hospitals">
              <span>+</span>
              Manage hospitals
            </Link>

            <Link to="/admin/users">
              <span>+</span>
              Manage users
            </Link>

            <Link to="/admin/doctors">
              <span>⚕</span>
              Manage Doctors
            </Link>

            <Link to="/admin/audit-logs">
              <span>≡</span>
              View Audit Logs
            </Link>

          </div>

        </div>

      </div>

      <div className="dashboard-panel recent-panel">

        <div className="panel-header">

          <div>
            <h3>Recent System Activity</h3>

            <p>
              Latest administrative activity
            </p>
          </div>

          <Link className="view-all" to="/admin/audit-logs">View all</Link>

        </div>

        {activityLoading ? (
          <div className="empty-activity" role="status">Loading recent activity...</div>
        ) : activityError ? (
          <div className="empty-activity" role="alert">{activityError}</div>
        ) : recentActivity.length === 0 ? (
          <div className="empty-activity">No recorded administrative activity yet.</div>
        ) : (
          <ul className="recent-activity-list">
            {recentActivity.map((activity) => (
              <li key={activity.id}>
                <div>
                  <strong>{activity.action || "Administrative action"}</strong>
                  <span>{activity.table_name || "System"}{activity.record_id ? ` #${activity.record_id}` : ""}</span>
                </div>
                <time dateTime={activity.created_at}>{new Date(activity.created_at).toLocaleString()}</time>
              </li>
            ))}
          </ul>
        )}

      </div>

    </div>
  );
}