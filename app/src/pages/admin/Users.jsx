import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

const ROLE_LABELS = {
  main_admin: "Main Admin",
  hospital_admin: "Hospital Admin",
  doctor: "Doctor",
  nurse: "Nurse",
  receptionist: "Receptionist",
};

const STATUS_OPTIONS = [
  "active",
  "inactive",
  "suspended",
  "locked",
];

export default function Users() {
  const [users, setUsers] = useState([]);
  const [hospitals, setHospitals] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");
  const [createError, setCreateError] = useState("");
  const [success, setSuccess] = useState("");

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [showCreateModal, setShowCreateModal] =
    useState(false);

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    role: "receptionist",
    hospital_id: "",
    specialization: "",
    license_number: "",
    qualification: "",
    phone: "",
    experience_years: "0",
  });

  const loadData = async () => {
    try {
      const {
        data,
        error: rpcError,
      } = await supabase.rpc(
        "get_main_admin_users"
      );

      setError("");

      if (rpcError) {
        throw rpcError;
      }

      if (!data) {
        throw new Error(
          "No user management data was returned."
        );
      }

      setUsers(data.users || []);
      setHospitals(data.hospitals || []);
    } catch (err) {
      console.error(
        "User management error:",
        err
      );

      setError(
        err?.message ||
          "Unable to load user management data."
      );

      setUsers([]);
      setHospitals([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, []);

  const getHospitalName = (hospitalId) => {
    if (!hospitalId) {
      return "System-wide";
    }

    const hospital = hospitals.find(
      (item) =>
        String(item.id) ===
        String(hospitalId)
    );

    return hospital
      ? `${hospital.name} (${hospital.code})`
      : "Unknown Hospital";
  };

  const filteredUsers = useMemo(() => {
    const searchValue = search
      .trim()
      .toLowerCase();

    return users.filter((user) => {
      const matchesSearch =
        !searchValue ||
        user.full_name
          ?.toLowerCase()
          .includes(searchValue) ||
        user.email
          ?.toLowerCase()
          .includes(searchValue);

      const matchesRole =
        roleFilter === "all" ||
        user.role === roleFilter;

      const matchesStatus =
        statusFilter === "all" ||
        user.status === statusFilter;

      return (
        matchesSearch &&
        matchesRole &&
        matchesStatus
      );
    });
  }, [
    users,
    search,
    roleFilter,
    statusFilter,
  ]);

  const resetForm = () => {
    setForm({
      full_name: "",
      email: "",
      password: "",
      role: "receptionist",
      hospital_id: "",
      specialization: "",
      license_number: "",
      qualification: "",
      phone: "",
      experience_years: "0",
    });
  };

  const closeModal = () => {
    if (saving) return;

    setShowCreateModal(false);
    setCreateError("");
    resetForm();
  };

  const handleCreateUser = async (event) => {
    event.preventDefault();

    setSaving(true);
    setCreateError("");
    setSuccess("");

    try {
      if (!form.full_name.trim()) {
        throw new Error(
          "Full name is required."
        );
      }

      if (!form.email.trim()) {
        throw new Error(
          "Email address is required."
        );
      }

      if (form.password.length < 8) {
        throw new Error(
          "Password must contain at least 8 characters."
        );
      }

      if (
        form.role !== "main_admin" &&
        !form.hospital_id
      ) {
        throw new Error(
          "Please select a hospital for this user."
        );
      }

      const {
        data: functionData,
        error: functionError,
      } = await supabase.functions.invoke(
        "create-user",
        {
          body: {
            email: form.email.trim(),
            password: form.password,
            full_name:
              form.full_name.trim(),
            role: form.role,
            hospital_id:
              form.role === "main_admin" ? null : Number(form.hospital_id),
            specialization: form.specialization,
            license_number: form.license_number,
            qualification: form.qualification,
            phone: form.phone,
            experience_years: Number(form.experience_years || 0),
          },
        }
      );

      if (functionError) {
        throw functionError;
      }

      if (functionData?.error) {
        throw new Error(
          functionData.error
        );
      }

      const newUserId =
        functionData?.user?.id ||
        functionData?.id ||
        functionData?.user_id;

      if (!newUserId) {
        throw new Error(
          "User was created, but the new user ID was not returned."
        );
      }

      setSuccess(
        `${ROLE_LABELS[form.role]} created successfully.`
      );

      setShowCreateModal(false);
      resetForm();

      await loadData();
   } catch (err) {
  console.error(
    "Create user error:",
    err
  );

  let message =
    err?.message ||
    "Unable to create user.";

  // Supabase FunctionsHttpError contains
  // the actual Edge Function response.
  if (err?.context) {
    try {
      const response = err.context;

      if (
        response &&
        typeof response.json === "function"
      ) {
        const body =
          await response.json();

        console.error(
          "Edge Function response:",
          body
        );

        if (body?.error) {
          message = body.error;
        }

        if (body?.details) {
          message +=
            ` — ${body.details}`;
        }
      }
    } catch (responseError) {
      console.error(
        "Could not read Edge Function response:",
        responseError
      );
    }
  }

  setCreateError(message);
} finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (
    user,
    newStatus
  ) => {
    if (
      user.status === newStatus
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Change ${user.full_name}'s status to "${newStatus}"?`
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setSuccess("");

    try {
      const {
        error: statusError,
      } = await supabase.rpc(
        "update_user_status",
        {
          target_user_id: user.id,
          new_status: newStatus,
        }
      );

      if (statusError) {
        throw statusError;
      }

      setSuccess(
        `${user.full_name}'s status was changed to ${newStatus}.`
      );

      await loadData();
    } catch (err) {
      console.error(
        "Status update error:",
        err
      );

      setError(
        err?.message ||
          "Unable to update user status."
      );
    }
  };

  return (
    <div className="users-page">

      <div className="users-page-header">

        <div>
          <h2>User Management</h2>

          <p>
            Manage RoboVerse system users,
            roles and account status.
          </p>
        </div>

        <button
          className="primary-action"
          onClick={() => {
            setCreateError("");
            setShowCreateModal(true);
          }}
        >
          <span>+</span>
          Create User
        </button>

      </div>

      {error && (
        <div className="users-message error" role="alert">
          {error}
          <button
            type="button"
            className="users-message-dismiss"
            aria-label="Dismiss error message"
            onClick={() => setError("")}
          >
            ×
          </button>
        </div>
      )}

      {success && (
        <div className="users-message success">
          {success}
        </div>
      )}

      <div className="users-toolbar">

        <label className="user-search">
          <span aria-hidden="true">⌕</span>

          <input
            type="search"
            aria-label="Search user accounts by name or email"
            placeholder="Search accounts by name or email"
            value={search}
            onChange={(event) =>
              setSearch(
                event.target.value
              )
            }
          />
        </label>

        <select
          value={roleFilter}
          onChange={(event) =>
            setRoleFilter(
              event.target.value
            )
          }
        >
          <option value="all">
            All Roles
          </option>

          <option value="main_admin">
            Main Admin
          </option>

          <option value="hospital_admin">
            Hospital Admin
          </option>

          <option value="doctor">
            Doctor
          </option>

          <option value="nurse">
            Nurse
          </option>

          <option value="receptionist">
            Receptionist
          </option>
        </select>

        <select
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(
              event.target.value
            )
          }
        >
          <option value="all">
            All Statuses
          </option>

          {STATUS_OPTIONS.map(
            (status) => (
              <option
                key={status}
                value={status}
              >
                {status
                  .charAt(0)
                  .toUpperCase() +
                  status.slice(1)}
              </option>
            )
          )}
        </select>

      </div>

      <div className="users-summary">

        <div>
          <strong>
            {users.length}
          </strong>

          <span>
            Total Users
          </span>
        </div>

        <div>
          <strong>
            {
              users.filter(
                (user) =>
                  user.status ===
                  "active"
              ).length
            }
          </strong>

          <span>Active</span>
        </div>

        <div>
          <strong>
            {
              users.filter(
                (user) =>
                  user.role ===
                  "doctor"
              ).length
            }
          </strong>

          <span>Doctors</span>
        </div>

        <div>
          <strong>
            {
              users.filter(
                (user) =>
                  user.role ===
                  "nurse"
              ).length
            }
          </strong>

          <span>Nurses</span>
        </div>

      </div>

      <div className="users-table-card">

        <div className="table-heading">

          <div>
            <h3>System Users</h3>

            <p>
              {filteredUsers.length} user
              {filteredUsers.length !==
              1
                ? "s"
                : ""}{" "}
              displayed
            </p>
          </div>

        </div>

        {loading ? (
          <div className="users-loading">

            <div className="loader"></div>

            <p>
              Loading users...
            </p>

          </div>
        ) : filteredUsers.length ===
          0 ? (
          <div className="users-empty">

            <div>👥</div>

            <h4>
              No users found
            </h4>

            <p>
              Try changing your search
              or filters.
            </p>

          </div>
        ) : (
          <div className="users-table-wrapper">

            <table className="users-table">

              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Hospital</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>

                {filteredUsers.map(
                  (user) => (
                    <tr key={user.id}>

                      <td>
                        <div className="table-user">

                          <div className="table-avatar">
                            {user.full_name
                              ?.charAt(
                                0
                              )
                              ?.toUpperCase() ||
                              "U"}
                          </div>

                          <div>
                            <strong>
                              {user.full_name ||
                                "Unnamed User"}
                            </strong>

                            <span>
                              {user.email}
                            </span>
                          </div>

                        </div>
                      </td>

                      <td>
                        <span
                          className={`role-badge role-${user.role}`}
                        >
                          {
                            ROLE_LABELS[
                              user.role
                            ] ||
                              user.role
                          }
                        </span>
                      </td>

                      <td>
                        <span className="hospital-name">
                          {getHospitalName(
                            user.hospital_id
                          )}
                        </span>
                      </td>

                      <td>

                        <span
                          className={`status-badge status-${user.status}`}
                        >
                          <span></span>
                          {user.status}
                        </span>

                      </td>

                      <td>
                        <span className="created-date">
                          {user.created_at
                            ? new Date(
                                user.created_at
                              ).toLocaleDateString()
                            : "—"}
                        </span>
                      </td>

                      <td>

                        {user.role ===
                        "main_admin" ? (
                          <span className="protected-label">
                            Protected
                          </span>
                        ) : (
                          <select
                            className="status-select"
                            value={
                              user.status
                            }
                            onChange={(
                              event
                            ) =>
                              handleStatusChange(
                                user,
                                event
                                  .target
                                  .value
                              )
                            }
                          >

                            {STATUS_OPTIONS.map(
                              (
                                status
                              ) => (
                                <option
                                  key={
                                    status
                                  }
                                  value={
                                    status
                                  }
                                >
                                  {status
                                    .charAt(
                                      0
                                    )
                                    .toUpperCase() +
                                    status.slice(
                                      1
                                    )}
                                </option>
                              )
                            )}

                          </select>
                        )}

                      </td>

                    </tr>
                  )
                )}

              </tbody>

            </table>

          </div>
        )}

      </div>

      {showCreateModal && (
        <div
          className="modal-overlay"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeModal();
            }
          }}
        >

          <div className="create-user-modal">

            <div className="modal-header">

              <div>
                <h3>
                  Create New User
                </h3>

                <p>
                  Create a RoboVerse account
                  and assign its role.
                </p>
              </div>

              <button
                className="modal-close"
                onClick={closeModal}
                disabled={saving}
              >
                ×
              </button>

            </div>

            <form
              onSubmit={
                handleCreateUser
              }
            >

              {createError && (
                <div className="users-message error" role="alert">
                  {createError}
                </div>
              )}

              <div className="modal-form-grid">

                <div className="modal-field full-width">

                  <label>
                    Full Name
                  </label>

                  <input
                    type="text"
                    value={
                      form.full_name
                    }
                    onChange={(event) =>
                      setForm({
                        ...form,
                        full_name:
                          event.target
                            .value,
                      })
                    }
                    placeholder="Enter full name"
                    required
                  />

                </div>

                <div className="modal-field">

                  <label>
                    Email Address
                  </label>

                  <input
                    type="email"
                    value={
                      form.email
                    }
                    onChange={(event) =>
                      setForm({
                        ...form,
                        email:
                          event.target
                            .value,
                      })
                    }
                    placeholder="user@roboverse.com"
                    required
                  />

                </div>

                <div className="modal-field">

                  <label>
                    Temporary Password
                  </label>

                  <input
                    type="password"
                    value={
                      form.password
                    }
                    onChange={(event) =>
                      setForm({
                        ...form,
                        password:
                          event.target
                            .value,
                      })
                    }
                    placeholder="Minimum 8 characters"
                    minLength={8}
                    required
                  />

                </div>

                <div className="modal-field">

                  <label>
                    Role
                  </label>

                  <select
                    value={
                      form.role
                    }
                    onChange={(event) =>
                      setForm({
                        ...form,
                        role:
                          event.target
                            .value,
                      })
                    }
                  >
                    <option value="hospital_admin">
                      Hospital Admin
                    </option>

                    <option value="doctor">
                      Doctor
                    </option>

                    <option value="nurse">
                      Nurse
                    </option>

                    <option value="receptionist">
                      Receptionist
                    </option>

                    <option value="main_admin">
                      Main Admin
                    </option>
                  </select>

                </div>

                <div className="modal-field">

                  <label>
                    Hospital
                  </label>

                  <select
                    value={
                      form.hospital_id
                    }
                    onChange={(event) =>
                      setForm({
                        ...form,
                        hospital_id:
                          event.target
                            .value,
                      })
                    }
                    disabled={
                      form.role ===
                      "main_admin"
                    }
                    required={
                      form.role !==
                      "main_admin"
                    }
                  >
                    <option value="">
                      Select hospital
                    </option>

                    {hospitals.map(
                      (hospital) => (
                        <option
                          key={
                            hospital.id
                          }
                          value={
                            hospital.id
                          }
                        >
                          {hospital.name} (
                          {hospital.code})
                        </option>
                      )
                    )}

                  </select>

                </div>

                {(form.role === "doctor" || form.role === "nurse") && (
                  <>
                    <div className="modal-field">
                      <label htmlFor="staff-specialization">Specialization</label>
                      <input
                        id="staff-specialization"
                        value={form.specialization}
                        onChange={(event) => setForm({ ...form, specialization: event.target.value })}
                        maxLength={120}
                        required={form.role === "doctor"}
                      />
                    </div>
                    <div className="modal-field">
                      <label htmlFor="staff-license">License number</label>
                      <input
                        id="staff-license"
                        value={form.license_number}
                        onChange={(event) => setForm({ ...form, license_number: event.target.value })}
                        maxLength={100}
                      />
                    </div>
                    <div className="modal-field">
                      <label htmlFor="staff-qualification">Qualification</label>
                      <input
                        id="staff-qualification"
                        value={form.qualification}
                        onChange={(event) => setForm({ ...form, qualification: event.target.value })}
                        maxLength={200}
                      />
                    </div>
                    <div className="modal-field">
                      <label htmlFor="staff-phone">Staff phone</label>
                      <input
                        id="staff-phone"
                        value={form.phone}
                        onChange={(event) => setForm({ ...form, phone: event.target.value })}
                        maxLength={40}
                      />
                    </div>
                    <div className="modal-field">
                      <label htmlFor="staff-experience">Experience years</label>
                      <input
                        id="staff-experience"
                        type="number"
                        min="0"
                        max="80"
                        value={form.experience_years}
                        onChange={(event) => setForm({ ...form, experience_years: event.target.value })}
                      />
                    </div>
                  </>
                )}

              </div>

              <div className="modal-security-note">

                <strong>
                  🔐 Secure account creation
                </strong>

                <span>
                  The account is created
                  through the protected
                  RoboVerse backend.
                </span>

              </div>

              <div className="modal-actions">

                <button
                  type="button"
                  className="secondary-action"
                  onClick={closeModal}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="primary-action"
                  disabled={saving}
                >
                  {saving
                    ? "Creating..."
                    : "Create User"}
                </button>

              </div>

            </form>

          </div>

        </div>
      )}

    </div>
  );
}
