import { Link } from "react-router-dom";

const securityAreas = [
  {
    title: "Role and hospital access",
    status: "Server enforced",
    description: "Protected routes and database functions check the signed-in role and hospital scope.",
    link: "/admin/users",
    linkLabel: "Review users",
  },
  {
    title: "Device credentials",
    status: "Managed in Devices",
    description: "Provisioning and revocation are handled from the device inventory.",
    link: "/admin/devices",
    linkLabel: "Open devices",
  },
  {
    title: "Administrative audit trail",
    status: "Available",
    description: "Review recorded administrative actions without exposing patient details.",
    link: "/admin/audit-logs",
    linkLabel: "Open audit logs",
  },
];

export default function Security() {
  return (
    <div className="admin-page security-page">
      <div className="admin-page-header">
        <div>
          <h2>Security</h2>
          <p>
            Review the safeguards implemented in RoboVerse and open the screens where they are managed.
          </p>
        </div>
        <Link className="secondary-action security-header-link" to="/admin/audit-logs">Review audit logs</Link>
      </div>

      <div className="security-scope-note" role="note">
        This page is an overview, not a live policy editor. Multi-factor authentication must be verified in the Supabase Auth configuration.
      </div>

      <div className="security-summary-grid">
        {securityAreas.map((area) => (
          <article className="security-summary-card" key={area.title}>
            <span>{area.title}</span>
            <strong>{area.status}</strong>
            <p>{area.description}</p>
            <Link to={area.link}>{area.linkLabel}</Link>
          </article>
        ))}
      </div>

      <section className="panel-card security-checklist">
        <div className="security-checklist-heading">
          <h3>Security review checklist</h3>
          <p>Complete these checks before treating the platform as production-ready.</p>
        </div>
        <ul className="security-checklist-items">
          <li>Confirm MFA requirements and recovery policy in Supabase Auth.</li>
          <li>Review role and hospital access with test accounts for each role.</li>
          <li>Verify device credential rotation and ingest using approved hardware.</li>
        </ul>
      </section>
    </div>
  );
}
