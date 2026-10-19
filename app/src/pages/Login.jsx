import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function getDashboardPath(role) {
  switch (role) {
    case "main_admin":
      return "/admin";

    case "hospital_admin":
      return "/hospital-admin";

    case "doctor":
      return "/doctor";

    case "nurse":
      return "/nurse";

    case "receptionist":
      return "/receptionist";

    default:
      return "/unauthorized";
  }
}

export default function Login() {
  const navigate = useNavigate();

  const {
    login,
    user,
    profile,
    loading: authLoading,
  } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authLoading && user && profile) {
      navigate(getDashboardPath(profile.role), {
        replace: true,
      });
    }
  }, [authLoading, user, profile, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    setError("");

    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    if (!password) {
      setError("Please enter your password.");
      return;
    }

    try {
      setLoading(true);

      const result = await login(
        email.trim().toLowerCase(),
        password
      );

      if (!result?.profile) {
        throw new Error(
          "User profile could not be loaded."
        );
      }

      navigate(
        getDashboardPath(result.profile.role),
        {
          replace: true,
        }
      );
    } catch (err) {
      console.error("LOGIN FAILED:", err);

      setError(
        err?.message ||
          "Unable to sign in. Please check your credentials."
      );
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="loading-screen">
        <div className="loader"></div>
        <p>Loading RoboVerse...</p>
      </div>
    );
  }

  if (user && profile) {
    return <div className="loading-screen">Redirecting...</div>;
  }

  return (
    <div className="login-page">
      <div className="login-card">

        <div className="brand">
          <div className="brand-logo">RV</div>

          <h1>RoboVerse</h1>

          <p>
            Smart Hospital Management System
          </p>
        </div>

        <div className="login-header">
          <h2>Welcome Back</h2>

          <p>
            Sign in to continue to your dashboard
          </p>
        </div>

        <form onSubmit={handleSubmit}>

          <div className="form-group">
            <label htmlFor="login-email">Email Address</label>

            <input
              id="login-email"
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) =>
                setEmail(e.target.value)
              }
              autoComplete="email"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="login-password">Password</label>

            <input
              id="login-password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) =>
                setPassword(e.target.value)
              }
              autoComplete="current-password"
              disabled={loading}
            />
          </div>

          {error && (
            <div className="login-error">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="login-button"
            disabled={loading}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>

        </form>

        <div className="login-footer">
          RoboVerse Healthcare Platform
        </div>

      </div>
    </div>
  );
}