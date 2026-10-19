import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function MainAdminLayout() {
  const { profile, logout } = useAuth();

  const menuItems = [
    {
      label: "Dashboard",
      path: "/admin",
      icon: "⌂",
    },
    {
      label: "User Management",
      path: "/admin/users",
      icon: "◉",
    },
    {
      label: "Hospitals",
      path: "/admin/hospitals",
      icon: "▣",
    },
    {
      label: "Doctors",
      path: "/admin/doctors",
      icon: "⚕",
    },
    {
      label: "Nurses",
      path: "/admin/nurses",
      icon: "♙",
    },
    {
      label: "Devices",
      path: "/admin/devices",
      icon: "◈",
    },
    {
      label: "Alerts",
      path: "/admin/alerts",
      icon: "!",
    },
    {
      label: "Audit Logs",
      path: "/admin/audit-logs",
      icon: "≡",
    },
    {
      label: "Security",
      path: "/admin/security",
      icon: "◆",
    },
    {
      label: "Settings",
      path: "/admin/settings",
      icon: "⚙",
    },
  ];

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  return (
    <div className="admin-shell">

      {/* =========================
          SIDEBAR
      ========================== */}

      <aside className="admin-sidebar">

        {/* BRAND */}

        <div className="admin-brand">
          <div className="admin-logo">
            RV
          </div>

          <div>
            <h2>RoboVerse</h2>
            <span>Main Administration</span>
          </div>
        </div>

        {/* MENU TITLE */}

        <div className="sidebar-section">
          <span>MAIN MENU</span>
        </div>

        {/* NAVIGATION */}

        <nav className="admin-navigation">

          {menuItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/admin"}
              className={({ isActive }) =>
                `admin-nav-item ${
                  isActive ? "active" : ""
                }`
              }
            >
              <span className="nav-icon">
                {item.icon}
              </span>

              <span>{item.label}</span>
            </NavLink>
          ))}

        </nav>

        {/* =========================
            SIDEBAR BOTTOM
        ========================== */}

        <div className="sidebar-bottom">

          {/* USER */}

          <div className="admin-user">

            <div className="user-avatar">
              {profile?.full_name
                ?.charAt(0)
                ?.toUpperCase() || "A"}
            </div>

            <div className="user-details">

              <strong>
                {profile?.full_name ||
                  "Administrator"}
              </strong>

              <span>
                Main Administrator
              </span>

            </div>

          </div>

          {/* LOGOUT */}

          <button
            type="button"
            className="sidebar-logout"
            onClick={handleLogout}
          >
            <span>↪</span>
            <span>Logout</span>
          </button>

        </div>

      </aside>

      {/* =========================
          MAIN CONTENT
      ========================== */}

      <main className="admin-main">

        {/* TOP BAR */}

        <header className="admin-topbar">

          <div>
            <h1>
              System Administration
            </h1>

            <p>
              Manage the RoboVerse healthcare
              platform
            </p>
          </div>

          <div className="topbar-right">

            <NavLink
              to="/admin/alerts"
              className="notification-button"
              aria-label="Open system alerts"
              title="Open system alerts"
            >
              Alerts
            </NavLink>

            <div className="topbar-profile">

              <div className="topbar-avatar">
                {profile?.full_name
                  ?.charAt(0)
                  ?.toUpperCase() || "A"}
              </div>

              <div>
                <strong>
                  {profile?.full_name ||
                    "Administrator"}
                </strong>

                <small>
                  Main Administrator
                </small>
              </div>

            </div>

          </div>

        </header>

        {/* PAGE */}

        <section className="admin-content">
          <Outlet />
        </section>

      </main>

    </div>
  );
}
