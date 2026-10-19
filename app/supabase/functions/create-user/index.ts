import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
};

const supabaseUrl =
  Deno.env.get("SUPABASE_URL")!;

const serviceRoleKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabaseAdmin = createClient(
  supabaseUrl,
  serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

const allowedRoles = [
  "main_admin",
  "hospital_admin",
  "doctor",
  "nurse",
  "receptionist",
];

function jsonResponse(
  body: Record<string, unknown>,
  status = 200
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type":
          "application/json",
      },
    }
  );
}

Deno.serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      {
        error: "Method not allowed.",
      },
      405
    );
  }

  try {
    // ==================================================
    // 1. Get authorization token
    // ==================================================

    const authorization =
      req.headers.get("Authorization");

    if (!authorization) {
      return jsonResponse(
        {
          error:
            "Missing authorization header.",
        },
        401
      );
    }

    const accessToken =
      authorization.replace(
        /^Bearer\s+/i,
        ""
      );

    if (!accessToken) {
      return jsonResponse(
        {
          error:
            "Invalid authorization token.",
        },
        401
      );
    }

    // ==================================================
    // 2. Verify logged-in Supabase user
    // ==================================================

    const {
      data: authData,
      error: authError,
    } =
      await supabaseAdmin.auth.getUser(
        accessToken
      );

    if (
      authError ||
      !authData.user
    ) {
      console.error(
        "Auth verification error:",
        authError
      );

      return jsonResponse(
        {
          error:
            "Your session is invalid or expired.",
        },
        401
      );
    }

    const requestingUser =
      authData.user;

    // ==================================================
    // 3. Get requesting user's RoboVerse profile
    // ==================================================

    const {
      data: requesterProfile,
      error: profileError,
    } =
      await supabaseAdmin
        .from("user_profiles")
        .select(
          "id, full_name, email, role, status, hospital_id"
        )
        .eq("id", requestingUser.id)
        .maybeSingle();

    if (profileError) {
      console.error(
        "Requester profile error:",
        profileError
      );

      return jsonResponse(
        {
          error:
            "Unable to verify your RoboVerse profile.",
        },
        500
      );
    }

    if (!requesterProfile) {
      return jsonResponse(
        {
          error:
            "Your Supabase account does not have a RoboVerse user profile.",
        },
        403
      );
    }

    // The service-role client bypasses RLS, so authorization is checked here
    // before any account or profile is created.
    if (
      !["main_admin", "hospital_admin"].includes(requesterProfile.role) ||
      requesterProfile.status !== "active"
    ) {
      return jsonResponse(
        {
          error:
            "Only an active administrator can create users.",
        },
        403
      );
    }

    // ==================================================
    // 5. Read request body
    // ==================================================

    let body: Record<
      string,
      unknown
    >;

    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        {
          error:
            "Invalid JSON request body.",
        },
        400
      );
    }

    const email = String(
      body.email || ""
    )
      .trim()
      .toLowerCase();

    const password = String(
      body.password || ""
    );

    const fullName = String(
      body.full_name || ""
    ).trim();

    const role = String(
      body.role || ""
    ).trim();
    const requestedHospitalId = String(
      body.hospital_id ?? "",
    ).trim();
    const requestedDepartmentId = String(
      body.department_id ?? "",
    ).trim();
    const specialization = String(body.specialization ?? "").trim();
    const licenseNumber = String(body.license_number ?? "").trim() || null;
    const staffPhone = String(body.phone ?? "").trim() || null;
    const qualification = String(body.qualification ?? "").trim() || null;
    const experienceYears = Number(body.experience_years ?? 0);

    // ==================================================
    // 6. Validate input
    // ==================================================

    if (!fullName) {
      return jsonResponse(
        {
          error:
            "Full name is required.",
        },
        400
      );
    }

    if (!email) {
      return jsonResponse(
        {
          error:
            "Email address is required.",
        },
        400
      );
    }

    if (password.length < 8) {
      return jsonResponse(
        {
          error:
            "Password must contain at least 8 characters.",
        },
        400
      );
    }

    if (
      !allowedRoles.includes(role)
    ) {
      return jsonResponse(
        {
          error:
            "Invalid RoboVerse user role.",
        },
        400
      );
    }

    if (
      requesterProfile.role === "hospital_admin" &&
      !["doctor", "nurse", "receptionist"].includes(role)
    ) {
      return jsonResponse(
        {
          error:
            "Hospital administrators can create doctor, nurse, or receptionist accounts only.",
        },
        403,
      );
    }

    let hospitalId: number | null = null;
    let departmentId: number | null = null;
    if (role !== "main_admin") {
      if (!/^\d+$/.test(requestedHospitalId)) {
        return jsonResponse(
          { error: "A valid hospital is required for this role." },
          400,
        );
      }

      hospitalId = Number(requestedHospitalId);
      if (!Number.isSafeInteger(hospitalId) || hospitalId <= 0) {
        return jsonResponse(
          { error: "A valid hospital is required for this role." },
          400,
        );
      }

      if (
        requesterProfile.role === "hospital_admin" &&
        hospitalId !== requesterProfile.hospital_id
      ) {
        return jsonResponse(
          { error: "You can only create accounts for your own hospital." },
          403,
        );
      }

      const {
        data: hospital,
        error: hospitalError,
      } = await supabaseAdmin
        .from("hospitals")
        .select("id")
        .eq("id", hospitalId)
        .maybeSingle();

      if (hospitalError) {
        console.error("Hospital validation failed:", hospitalError);
        return jsonResponse(
          { error: "Unable to validate the selected hospital." },
          500,
        );
      }

      if (!hospital) {
        return jsonResponse(
          { error: "The selected hospital was not found." },
          400,
        );
      }

      if (role === "doctor" || role === "nurse") {
        if (role === "doctor" && !specialization) {
          return jsonResponse(
            { error: "Doctor specialization is required." },
            400,
          );
        }
        if (
          specialization.length > 120 ||
          (licenseNumber && licenseNumber.length > 100) ||
          (staffPhone && staffPhone.length > 40) ||
          (qualification && qualification.length > 200) ||
          !Number.isInteger(experienceYears) ||
          experienceYears < 0 ||
          experienceYears > 80
        ) {
          return jsonResponse(
            { error: "One or more staff details are invalid." },
            400,
          );
        }

        if (requestedDepartmentId) {
          departmentId = Number(requestedDepartmentId);
          if (!Number.isSafeInteger(departmentId) || departmentId <= 0) {
            return jsonResponse(
              { error: "Select a valid department." },
              400,
            );
          }
          const { data: department, error: departmentError } = await supabaseAdmin
            .from("departments")
            .select("id")
            .eq("id", departmentId)
            .eq("hospital_id", hospitalId)
            .eq("status", "active")
            .maybeSingle();
          if (departmentError) {
            console.error("Staff department validation failed:", departmentError);
            return jsonResponse(
              { error: "Unable to validate the selected department." },
              500,
            );
          }
          if (!department) {
            return jsonResponse(
              { error: "Select an active department in the assigned hospital." },
              400,
            );
          }
        }
      }
    }

    // ==================================================
    // 7. Check existing Auth account
    // ==================================================

    let existingUser = null;

    for (
      let page = 1;
      page <= 10;
      page++
    ) {
      const {
        data: usersPage,
        error: usersError,
      } =
        await supabaseAdmin.auth.admin.listUsers(
          {
            page,
            perPage: 1000,
          }
        );

      if (usersError) {
        console.error(
          "List users error:",
          usersError
        );

        return jsonResponse(
          {
            error:
              "Unable to check existing users.",
          },
          500
        );
      }

      const found =
        usersPage.users.find(
          (user: { email?: string | null }) =>
            user.email?.toLowerCase() ===
            email
        );

      if (found) {
        existingUser = found;
        break;
      }

      if (
        usersPage.users.length < 1000
      ) {
        break;
      }
    }

    if (existingUser) {
      return jsonResponse(
        {
          error:
            "A user with this email address already exists.",
        },
        409
      );
    }

    // ==================================================
    // 8. Create Auth account
    // ==================================================

    const {
      data: createdAuth,
      error: createAuthError,
    } =
      await supabaseAdmin.auth.admin.createUser(
        {
          email,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: fullName,
            role,
          },
        }
      );

    if (
      createAuthError ||
      !createdAuth.user
    ) {
      console.error(
        "Create Auth user error:",
        createAuthError
      );

      return jsonResponse(
        {
          error:
            "Unable to create authentication account.",
        },
        400
      );
    }

    const newUser =
      createdAuth.user;

    const rollbackCreatedAccount = async () => {
      if (role === "doctor") {
        const { error } = await supabaseAdmin.from("doctors").delete().eq("user_id", newUser.id);
        if (error) console.error("Doctor staff rollback failed:", error);
      } else if (role === "nurse") {
        const { error } = await supabaseAdmin.from("nurses").delete().eq("user_id", newUser.id);
        if (error) console.error("Nurse staff rollback failed:", error);
      }
      const { error: profileRollbackError } = await supabaseAdmin
        .from("user_profiles")
        .delete()
        .eq("id", newUser.id);
      if (profileRollbackError) {
        console.error("Account profile rollback failed:", profileRollbackError);
      }
      const { error: authRollbackError } = await supabaseAdmin.auth.admin.deleteUser(newUser.id);
      if (authRollbackError) {
        console.error("Authentication account rollback failed:", authRollbackError);
      }
    };

    // ==================================================
    // 9. Create RoboVerse profile
    // ==================================================

    const {
      data: profile,
      error: createProfileError,
    } =
      await supabaseAdmin
        .from("user_profiles")
        .insert({
          id: newUser.id,
          full_name: fullName,
          email,
          role,
          status: "active",
          hospital_id: hospitalId,
        })
        .select(
          "id, full_name, email, role, status, hospital_id"
        )
        .single();

    if (createProfileError) {
      console.error(
        "Create profile error:",
        createProfileError
      );

      await rollbackCreatedAccount();

      return jsonResponse(
        {
          error:
            "Authentication account was created, but the RoboVerse profile could not be created.",
        },
        500
      );
    }

    if (role === "doctor" || role === "nurse") {
      const staffProfile = role === "doctor"
        ? await supabaseAdmin.from("doctors").insert({
          user_id: newUser.id,
          hospital_id: hospitalId,
          department_id: departmentId,
          doctor_code: `DR-${newUser.id}`,
          specialization,
          license_number: licenseNumber,
          phone: staffPhone,
          qualification,
          experience_years: experienceYears,
          status: "active",
        })
        : await supabaseAdmin.from("nurses").insert({
          user_id: newUser.id,
          hospital_id: hospitalId,
          department_id: departmentId,
          nurse_code: `NR-${newUser.id}`,
          specialization: specialization || null,
          license_number: licenseNumber,
          phone: staffPhone,
          qualification,
          experience_years: experienceYears,
          status: "active",
        });

      if (staffProfile.error) {
        console.error("Clinical staff profile could not be created:", staffProfile.error);
        await rollbackCreatedAccount();
        const staffErrorDetails: Record<string, string> = {
          "22001": "A professional detail is longer than allowed.",
          "23502": "A required staff detail is missing.",
          "23503": "The selected hospital or department is no longer valid.",
          "23505": "A staff profile with these details already exists.",
          "23514": "One or more professional details do not meet the database requirements.",
          "PGRST204": "The database schema is out of date. Apply the latest migrations and deploy the updated create-user function.",
        };
        return jsonResponse(
          {
            error: "The staff profile could not be created.",
            details: staffErrorDetails[staffProfile.error.code || ""] || "Check the selected hospital and professional details, then contact an administrator if the problem continues.",
          },
          500,
        );
      }
    }

    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      user_id: requestingUser.id,
      hospital_id: hospitalId,
      action: "user_created",
      table_name: "user_profiles",
      description: `Created ${role} account.`,
      metadata: {
        target_user_id: newUser.id,
        role,
        department_id: departmentId,
      },
    });

    if (auditError) {
      console.error("User creation audit write failed:", auditError);
      await rollbackCreatedAccount();
      return jsonResponse(
        { error: "The account could not be recorded in the audit log." },
        500,
      );
    }

    // ==================================================
    // 10. Success
    // ==================================================

    return jsonResponse(
      {
        success: true,
        message:
          "RoboVerse user created successfully.",
        user: {
          id: newUser.id,
          email: newUser.email,
        },
        profile,
      },
      200
    );
  } catch (error) {
    console.error(
      "Unexpected create-user error:",
      error
    );

    return jsonResponse(
      {
        error:
          "Unexpected server error.",
      },
      500
    );
  }
});
