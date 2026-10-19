import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";

const Login = lazy(() => import("./pages/Login"));
const MainAdminLayout = lazy(() => import("./layouts/MainAdminLayout"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const Users = lazy(() => import("./pages/admin/Users"));
const Hospitals = lazy(() => import("./pages/admin/Hospitals"));
const Doctors = lazy(() => import("./pages/admin/Doctors"));
const Nurses = lazy(() => import("./pages/admin/Nurses"));
const Devices = lazy(() => import("./pages/admin/Devices"));
const Alerts = lazy(() => import("./pages/admin/Alerts"));
const AuditLogs = lazy(() => import("./pages/admin/AuditLogs"));
const Security = lazy(() => import("./pages/admin/Security"));
const Settings = lazy(() => import("./pages/admin/Settings"));
const DoctorDashboard = lazy(() => import("./pages/DoctorDashboard"));
const NurseDashboard = lazy(() => import("./pages/NurseDashboard"));
const HospitalAdminDashboard = lazy(() => import("./pages/HospitalAdminDashboard"));
const ReceptionistDashboard = lazy(() => import("./pages/ReceptionistDashboard"));

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loader"></div>
      <p>Loading RoboVerse...</p>
    </div>
  );
}

function ProtectedRoute({ children, allowedRoles }) {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!profile) {
    return <Navigate to="/unauthorized" replace />;
  }

  if (
    allowedRoles &&
    !allowedRoles.includes(profile.role)
  ) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
}

function Unauthorized() {
  const { logout } = useAuth();

  return (
    <div className="unauthorized-page">
      <div className="unauthorized-card">
        <h1>Access Denied</h1>

        <p>
          You do not have permission to access this page.
        </p>

        <button onClick={logout}>
          Logout
        </button>
      </div>
    </div>
  );
}

function App() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>

      {/* =========================
          LOGIN
      ========================== */}
      <Route
        path="/login"
        element={<Login />}
      />

      {/* =========================
          MAIN ADMIN
      ========================== */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute
            allowedRoles={["main_admin"]}
          >
            <MainAdminLayout />
          </ProtectedRoute>
        }
      >
        <Route
          index
          element={<AdminDashboard />}
        />

        <Route
          path="users"
          element={<Users />}
        />

        <Route
          path="hospitals"
          element={<Hospitals />}
        />

        <Route
          path="doctors"
          element={<Doctors />}
        />

        <Route
          path="nurses"
          element={<Nurses />}
        />

        <Route
          path="devices"
          element={<Devices />}
        />

        <Route
          path="alerts"
          element={<Alerts />}
        />

        <Route
          path="audit-logs"
          element={<AuditLogs />}
        />

        <Route
          path="security"
          element={<Security />}
        />

        <Route
          path="settings"
          element={<Settings />}
        />
      </Route>

      {/* =========================
          HOSPITAL ADMIN
      ========================== */}
      <Route
        path="/hospital-admin"
        element={
          <ProtectedRoute
            allowedRoles={["hospital_admin"]}
          >
            <HospitalAdminDashboard />
          </ProtectedRoute>
        }
      />

      {/* =========================
          RECEPTIONIST
      ========================== */}
      <Route
        path="/receptionist"
        element={
          <ProtectedRoute
            allowedRoles={["receptionist"]}
          >
            <ReceptionistDashboard />
          </ProtectedRoute>
        }
      />
      {/* =========================
    DOCTOR
========================= */}
<Route
  path="/doctor"
  element={
    <ProtectedRoute allowedRoles={["doctor"]}>
      <DoctorDashboard />
    </ProtectedRoute>
  }
/>

{/* =========================
    NURSE
========================= */}
<Route
  path="/nurse"
  element={
    <ProtectedRoute allowedRoles={["nurse"]}>
      <NurseDashboard />
    </ProtectedRoute>
  }
/>

      {/* =========================
          UNAUTHORIZED
      ========================== */}
      <Route
        path="/unauthorized"
        element={<Unauthorized />}
      />

      {/* =========================
          DEFAULT
      ========================== */}
      <Route
        path="/"
        element={
          <Navigate
            to="/login"
            replace
          />
        }
      />

      {/* =========================
          UNKNOWN URL
      ========================== */}
      <Route
        path="*"
        element={
          <Navigate
            to="/login"
            replace
          />
        }
      />

      </Routes>
    </Suspense>
  );
}

export default App;
