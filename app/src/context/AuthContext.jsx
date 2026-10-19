import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

import { supabase } from "../lib/supabaseClient";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // ==========================================
  // LOAD CURRENT USER PROFILE
  // ==========================================
  const loadProfile = async () => {
    const {
      data,
      error,
    } = await supabase.rpc("get_my_profile");

    if (error) {
      console.error(
        "PROFILE RPC ERROR:",
        error
      );

      setProfile(null);

      throw new Error(
        `Profile loading failed: ${error.message}`
      );
    }

    if (!data) {
      console.error(
        "No RoboVerse profile found."
      );

      setProfile(null);

      throw new Error(
        "No active RoboVerse profile was found for this account."
      );
    }

    // Check profile status
    if (data.status !== "active") {
      console.error(
        "Inactive RoboVerse profile:",
        data.status
      );

      setProfile(null);

      throw new Error(
        "Your RoboVerse account is not active. Please contact an administrator."
      );
    }

    setProfile(data);

    return data;
  };

  // ==========================================
  // INITIALIZE AUTHENTICATION
  // ==========================================
  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        const {
          data: {
            session: currentSession,
          },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          throw error;
        }

        if (!mounted) {
          return;
        }

        setSession(currentSession);

        // Load profile if already logged in
        if (currentSession?.user) {
          try {
            await loadProfile();
          } catch (profileError) {
            console.error(
              "INITIAL PROFILE ERROR:",
              profileError
            );

            if (mounted) {
              setProfile(null);
            }
          }
        } else {
          setProfile(null);
        }
      } catch (error) {
        console.error(
          "AUTH INITIALIZATION ERROR:",
          error
        );

        if (mounted) {
          setSession(null);
          setProfile(null);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initializeAuth();

    // ==========================================
    // AUTH STATE LISTENER
    // ==========================================
    const {
      data: {
        subscription,
      },
    } = supabase.auth.onAuthStateChange(
      (event, newSession) => {
        if (!mounted) {
          return;
        }

        setSession(newSession);

        // User logged out
        if (event === "SIGNED_OUT") {
          setProfile(null);
          setLoading(false);
          return;
        }

        // User logged in
        if (
          event === "SIGNED_IN" &&
          newSession?.user
        ) {
          setLoading(true);

          // Delay profile loading so we don't
          // perform another Supabase request
          // inside the auth callback.
          setTimeout(async () => {
            if (!mounted) {
              return;
            }

            try {
              await loadProfile();
            } catch (error) {
              console.error(
                "AUTH STATE PROFILE ERROR:",
                error
              );

              if (mounted) {
                setProfile(null);
              }
            } finally {
              if (mounted) {
                setLoading(false);
              }
            }
          }, 0);

          return;
        }

        // Token refreshed
        if (
          event === "TOKEN_REFRESHED" &&
          newSession?.user
        ) {
          setSession(newSession);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // ==========================================
  // LOGIN
  // ==========================================
  const login = async (
    email,
    password
  ) => {
    const {
      data,
      error,
    } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error(
        "SUPABASE LOGIN ERROR:",
        error
      );

      throw error;
    }

    if (!data.user) {
      throw new Error(
        "Authentication succeeded but no user was returned."
      );
    }

    if (!data.session) {
      throw new Error(
        "Authentication succeeded but no session was created."
      );
    }

    setSession(data.session);

    // Get the user's RoboVerse profile
    const userProfile =
      await loadProfile();

    return {
      user: data.user,
      session: data.session,
      profile: userProfile,
    };
  };

  // ==========================================
  // LOGOUT
  // ==========================================
  const logout = async () => {
    try {
      const {
        error,
      } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      setSession(null);
      setProfile(null);
    } catch (error) {
      console.error(
        "LOGOUT ERROR:",
        error
      );

      throw error;
    }
  };

  // ==========================================
  // CONTEXT
  // ==========================================
  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user || null,
        profile,
        loading,
        login,
        logout,
        loadProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ==========================================
// USE AUTH HOOK
// ==========================================
// Provider and hook intentionally share this context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context =
    useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used inside AuthProvider"
    );
  }

  return context;
}