export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admissions: {
        Row: {
          admission_date: string
          admission_number: string
          admission_type: string
          admitted_by: string | null
          admitting_doctor_id: number | null
          bed_id: number | null
          created_at: string
          department_id: number | null
          diagnosis: string | null
          hospital_id: number
          id: number
          notes: string | null
          patient_id: number
          reason: string | null
          status: string
          updated_at: string
          ward_id: number | null
        }
        Insert: {
          admission_date?: string
          admission_number: string
          admission_type?: string
          admitted_by?: string | null
          admitting_doctor_id?: number | null
          bed_id?: number | null
          created_at?: string
          department_id?: number | null
          diagnosis?: string | null
          hospital_id: number
          id?: number
          notes?: string | null
          patient_id: number
          reason?: string | null
          status?: string
          updated_at?: string
          ward_id?: number | null
        }
        Update: {
          admission_date?: string
          admission_number?: string
          admission_type?: string
          admitted_by?: string | null
          admitting_doctor_id?: number | null
          bed_id?: number | null
          created_at?: string
          department_id?: number | null
          diagnosis?: string | null
          hospital_id?: number
          id?: number
          notes?: string | null
          patient_id?: number
          reason?: string | null
          status?: string
          updated_at?: string
          ward_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "admissions_admitting_doctor_id_fkey"
            columns: ["admitting_doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admissions_bed_id_fkey"
            columns: ["bed_id"]
            isOneToOne: false
            referencedRelation: "beds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admissions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admissions_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admissions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admissions_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_rules: {
        Row: {
          condition: string
          created_at: string
          created_by: string | null
          hospital_id: number | null
          id: number
          is_active: boolean
          maximum_value: number | null
          message: string
          minimum_value: number | null
          name: string
          severity: string
          threshold_value: number | null
          updated_at: string
          vital_type: string
        }
        Insert: {
          condition: string
          created_at?: string
          created_by?: string | null
          hospital_id?: number | null
          id?: number
          is_active?: boolean
          maximum_value?: number | null
          message: string
          minimum_value?: number | null
          name: string
          severity?: string
          threshold_value?: number | null
          updated_at?: string
          vital_type: string
        }
        Update: {
          condition?: string
          created_at?: string
          created_by?: string | null
          hospital_id?: number | null
          id?: number
          is_active?: boolean
          maximum_value?: number | null
          message?: string
          minimum_value?: number | null
          name?: string
          severity?: string
          threshold_value?: number | null
          updated_at?: string
          vital_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_rules_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_rule_id: number | null
          alert_type: string
          created_at: string
          id: number
          message: string
          patient_id: number
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          title: string
          updated_at: string
          value: number | null
          vital_reading_id: number | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_rule_id?: number | null
          alert_type: string
          created_at?: string
          id?: number
          message: string
          patient_id: number
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          title: string
          updated_at?: string
          value?: number | null
          vital_reading_id?: number | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_rule_id?: number | null
          alert_type?: string
          created_at?: string
          id?: number
          message?: string
          patient_id?: number
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          title?: string
          updated_at?: string
          value?: number | null
          vital_reading_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "alerts_alert_rule_id_fkey"
            columns: ["alert_rule_id"]
            isOneToOne: false
            referencedRelation: "alert_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_vital_reading_id_fkey"
            columns: ["vital_reading_id"]
            isOneToOne: false
            referencedRelation: "vital_readings"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          appointment_date: string
          appointment_time: string
          appointment_type: string
          created_at: string
          created_by: string | null
          department_id: number | null
          doctor_id: number | null
          hospital_id: number
          id: number
          notes: string | null
          patient_id: number
          reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          appointment_date: string
          appointment_time: string
          appointment_type?: string
          created_at?: string
          created_by?: string | null
          department_id?: number | null
          doctor_id?: number | null
          hospital_id: number
          id?: number
          notes?: string | null
          patient_id: number
          reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          appointment_date?: string
          appointment_time?: string
          appointment_type?: string
          created_at?: string
          created_by?: string | null
          department_id?: number | null
          doctor_id?: number | null
          hospital_id?: number
          id?: number
          notes?: string | null
          patient_id?: number
          reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          description: string | null
          hospital_id: number | null
          id: number
          ip_address: unknown
          metadata: Json | null
          record_id: number | null
          table_name: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          description?: string | null
          hospital_id?: number | null
          id?: number
          ip_address?: unknown
          metadata?: Json | null
          record_id?: number | null
          table_name?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          description?: string | null
          hospital_id?: number | null
          id?: number
          ip_address?: unknown
          metadata?: Json | null
          record_id?: number | null
          table_name?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      beds: {
        Row: {
          bed_number: string
          bed_type: string
          created_at: string
          id: number
          notes: string | null
          status: string
          updated_at: string
          ward_id: number
        }
        Insert: {
          bed_number: string
          bed_type?: string
          created_at?: string
          id?: number
          notes?: string | null
          status?: string
          updated_at?: string
          ward_id: number
        }
        Update: {
          bed_number?: string
          bed_type?: string
          created_at?: string
          id?: number
          notes?: string | null
          status?: string
          updated_at?: string
          ward_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "beds_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_records: {
        Row: {
          appointment_id: number | null
          clinical_notes: string | null
          created_at: string
          created_by: string | null
          diagnosis: string | null
          doctor_id: number | null
          id: number
          medications: string | null
          patient_id: number
          record_date: string
          record_type: string
          symptoms: string | null
          treatment: string | null
          updated_at: string
        }
        Insert: {
          appointment_id?: number | null
          clinical_notes?: string | null
          created_at?: string
          created_by?: string | null
          diagnosis?: string | null
          doctor_id?: number | null
          id?: number
          medications?: string | null
          patient_id: number
          record_date?: string
          record_type?: string
          symptoms?: string | null
          treatment?: string | null
          updated_at?: string
        }
        Update: {
          appointment_id?: number | null
          clinical_notes?: string | null
          created_at?: string
          created_by?: string | null
          diagnosis?: string | null
          doctor_id?: number | null
          id?: number
          medications?: string | null
          patient_id?: number
          record_date?: string
          record_type?: string
          symptoms?: string | null
          treatment?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinical_records_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_records_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_records_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_tasks: {
        Row: {
          administration_notes: string | null
          created_at: string
          doctor_id: number
          dose: string
          id: number
          instructions: string | null
          medication_name: string
          nurse_id: number
          patient_id: number
          recorded_at: string | null
          recorded_by: string | null
          route: string
          scheduled_for: string
          status: string
          updated_at: string
        }
        Insert: {
          administration_notes?: string | null
          created_at?: string
          doctor_id: number
          dose: string
          id?: number
          instructions?: string | null
          medication_name: string
          nurse_id: number
          patient_id: number
          recorded_at?: string | null
          recorded_by?: string | null
          route: string
          scheduled_for: string
          status?: string
          updated_at?: string
        }
        Update: {
          administration_notes?: string | null
          created_at?: string
          doctor_id?: number
          dose?: string
          id?: number
          instructions?: string | null
          medication_name?: string
          nurse_id?: number
          patient_id?: number
          recorded_at?: string | null
          recorded_by?: string | null
          route?: string
          scheduled_for?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medication_tasks_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_tasks_nurse_id_fkey"
            columns: ["nurse_id"]
            isOneToOne: false
            referencedRelation: "nurses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_tasks_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_tasks_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          department_code: string
          description: string | null
          hospital_id: number
          id: number
          name: string
          phone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_code: string
          description?: string | null
          hospital_id: number
          id?: number
          name: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_code?: string
          description?: string | null
          hospital_id?: number
          id?: number
          name?: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      device_credentials: {
        Row: {
          created_at: string
          created_by: string | null
          device_id: number
          id: number
          last_used_at: string | null
          revoked_at: string | null
          secret_hash: string
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          device_id: number
          id?: never
          last_used_at?: string | null
          revoked_at?: string | null
          secret_hash: string
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          device_id?: number
          id?: never
          last_used_at?: string | null
          revoked_at?: string | null
          secret_hash?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_credentials_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: true
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          assigned_patient_id: number | null
          created_at: string
          device_code: string
          device_name: string
          device_type: string
          firmware_version: string | null
          hospital_id: number | null
          id: number
          last_seen_at: string | null
          mac_address: string | null
          model: string | null
          notes: string | null
          serial_number: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_patient_id?: number | null
          created_at?: string
          device_code: string
          device_name: string
          device_type?: string
          firmware_version?: string | null
          hospital_id?: number | null
          id?: number
          last_seen_at?: string | null
          mac_address?: string | null
          model?: string | null
          notes?: string | null
          serial_number?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_patient_id?: number | null
          created_at?: string
          device_code?: string
          device_name?: string
          device_type?: string
          firmware_version?: string | null
          hospital_id?: number | null
          id?: number
          last_seen_at?: string | null
          mac_address?: string | null
          model?: string | null
          notes?: string | null
          serial_number?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_assigned_patient_id_fkey"
            columns: ["assigned_patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      discharges: {
        Row: {
          admission_id: number
          created_at: string
          discharge_date: string
          discharge_summary: string | null
          discharge_type: string
          discharged_by: string | null
          final_diagnosis: string | null
          follow_up_instructions: string | null
          id: number
          patient_id: number
          updated_at: string
        }
        Insert: {
          admission_id: number
          created_at?: string
          discharge_date?: string
          discharge_summary?: string | null
          discharge_type?: string
          discharged_by?: string | null
          final_diagnosis?: string | null
          follow_up_instructions?: string | null
          id?: number
          patient_id: number
          updated_at?: string
        }
        Update: {
          admission_id?: number
          created_at?: string
          discharge_date?: string
          discharge_summary?: string | null
          discharge_type?: string
          discharged_by?: string | null
          final_diagnosis?: string | null
          follow_up_instructions?: string | null
          id?: number
          patient_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discharges_admission_id_fkey"
            columns: ["admission_id"]
            isOneToOne: true
            referencedRelation: "admissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discharges_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      doctors: {
        Row: {
          created_at: string
          department_id: number | null
          doctor_code: string
          experience_years: number | null
          hospital_id: number
          id: number
          license_number: string | null
          phone: string | null
          qualification: string | null
          specialization: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          department_id?: number | null
          doctor_code: string
          experience_years?: number | null
          hospital_id: number
          id?: number
          license_number?: string | null
          phone?: string | null
          qualification?: string | null
          specialization: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          department_id?: number | null
          doctor_code?: string
          experience_years?: number | null
          hospital_id?: number
          id?: number
          license_number?: string | null
          phone?: string | null
          qualification?: string | null
          specialization?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "doctors_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctors_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doctors_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hospitals: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          created_by: string | null
          email: string | null
          hospital_code: string
          id: number
          name: string
          phone: string | null
          postal_code: string | null
          province: string | null
          registration_number: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          hospital_code: string
          id?: number
          name: string
          phone?: string | null
          postal_code?: string | null
          province?: string | null
          registration_number?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          hospital_code?: string
          id?: number
          name?: string
          phone?: string | null
          postal_code?: string | null
          province?: string | null
          registration_number?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      medical_reports: {
        Row: {
          conclusion: string | null
          created_at: string
          created_by: string | null
          doctor_id: number | null
          file_name: string | null
          file_url: string | null
          findings: string | null
          id: number
          patient_id: number
          report_date: string
          report_type: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          conclusion?: string | null
          created_at?: string
          created_by?: string | null
          doctor_id?: number | null
          file_name?: string | null
          file_url?: string | null
          findings?: string | null
          id?: number
          patient_id: number
          report_date?: string
          report_type: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          conclusion?: string | null
          created_at?: string
          created_by?: string | null
          doctor_id?: number | null
          file_name?: string | null
          file_url?: string | null
          findings?: string | null
          id?: number
          patient_id?: number
          report_date?: string
          report_type?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medical_reports_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medical_reports_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          alert_id: number | null
          created_at: string
          id: number
          is_read: boolean
          message: string
          notification_type: string
          patient_id: number | null
          read_at: string | null
          severity: string | null
          title: string
          user_id: string
        }
        Insert: {
          alert_id?: number | null
          created_at?: string
          id?: never
          is_read?: boolean
          message: string
          notification_type: string
          patient_id?: number | null
          read_at?: string | null
          severity?: string | null
          title: string
          user_id: string
        }
        Update: {
          alert_id?: number | null
          created_at?: string
          id?: never
          is_read?: boolean
          message?: string
          notification_type?: string
          patient_id?: number | null
          read_at?: string | null
          severity?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      nurses: {
        Row: {
          created_at: string
          department_id: number | null
          experience_years: number | null
          hospital_id: number
          id: number
          license_number: string | null
          nurse_code: string
          phone: string | null
          qualification: string | null
          specialization: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          department_id?: number | null
          experience_years?: number | null
          hospital_id: number
          id?: number
          license_number?: string | null
          nurse_code: string
          phone?: string | null
          qualification?: string | null
          specialization?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          department_id?: number | null
          experience_years?: number | null
          hospital_id?: number
          id?: number
          license_number?: string | null
          nurse_code?: string
          phone?: string | null
          qualification?: string | null
          specialization?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nurses_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nurses_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nurses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_access_requests: {
        Row: {
          access_expires_at: string | null
          access_granted_at: string | null
          access_level: string
          created_at: string
          id: number
          patient_id: number
          reason: string
          requested_by: string
          review_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          access_expires_at?: string | null
          access_granted_at?: string | null
          access_level?: string
          created_at?: string
          id?: number
          patient_id: number
          reason: string
          requested_by: string
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          access_expires_at?: string | null
          access_granted_at?: string | null
          access_level?: string
          created_at?: string
          id?: number
          patient_id?: number
          reason?: string
          requested_by?: string
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_access_requests_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_assignments: {
        Row: {
          assigned_by: string | null
          assignment_type: string
          bed_id: number | null
          created_at: string
          department_id: number | null
          doctor_id: number | null
          end_date: string | null
          id: number
          notes: string | null
          nurse_id: number | null
          patient_id: number
          start_date: string
          status: string
          updated_at: string
          ward_id: number | null
        }
        Insert: {
          assigned_by?: string | null
          assignment_type?: string
          bed_id?: number | null
          created_at?: string
          department_id?: number | null
          doctor_id?: number | null
          end_date?: string | null
          id?: number
          notes?: string | null
          nurse_id?: number | null
          patient_id: number
          start_date?: string
          status?: string
          updated_at?: string
          ward_id?: number | null
        }
        Update: {
          assigned_by?: string | null
          assignment_type?: string
          bed_id?: number | null
          created_at?: string
          department_id?: number | null
          doctor_id?: number | null
          end_date?: string | null
          id?: number
          notes?: string | null
          nurse_id?: number | null
          patient_id?: number
          start_date?: string
          status?: string
          updated_at?: string
          ward_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_assignments_bed_id_fkey"
            columns: ["bed_id"]
            isOneToOne: false
            referencedRelation: "beds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_assignments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_assignments_doctor_id_fkey"
            columns: ["doctor_id"]
            isOneToOne: false
            referencedRelation: "doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_assignments_nurse_id_fkey"
            columns: ["nurse_id"]
            isOneToOne: false
            referencedRelation: "nurses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_assignments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_assignments_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          address: string | null
          allergies: string | null
          blood_group: string | null
          city: string | null
          created_at: string
          created_by: string | null
          date_of_birth: string | null
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relationship: string | null
          first_name: string
          gender: string | null
          hospital_id: number
          id: number
          last_name: string
          medical_notes: string | null
          middle_name: string | null
          national_id: string | null
          patient_number: string
          phone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          allergies?: string | null
          blood_group?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          first_name: string
          gender?: string | null
          hospital_id: number
          id?: number
          last_name: string
          medical_notes?: string | null
          middle_name?: string | null
          national_id?: string | null
          patient_number: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          allergies?: string | null
          blood_group?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          first_name?: string
          gender?: string | null
          hospital_id?: number
          id?: number
          last_name?: string
          medical_notes?: string | null
          middle_name?: string | null
          national_id?: string | null
          patient_number?: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          hospital_id: number | null
          id: string
          role: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          hospital_id?: number | null
          id: string
          role: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          hospital_id?: number | null
          id?: string
          role?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      vital_readings: {
        Row: {
          blood_glucose: number | null
          configuration_version: number | null
          created_at: string
          distance_mm: number | null
          device_id: number | null
          diastolic_bp: number | null
          ecg_value: number | null
          ecg_lead_off_negative: boolean | null
          ecg_lead_off_positive: boolean | null
          heart_rate: number | null
          id: number
          ingestion_id: string | null
          ir_raw: number | null
          motion_x: number | null
          motion_y: number | null
          motion_z: number | null
          object_temperature_c: number | null
          patient_id: number
          pulse_rate_estimate_bpm: number | null
          red_raw: number | null
          recorded_at: string
          recorded_by: string | null
          respiratory_rate: number | null
          sensor_errors: Json | null
          sensor_status: Json | null
          signal_quality: number | null
          signal_valid: boolean | null
          source: string
          spo2: number | null
          systolic_bp: number | null
          temperature: number | null
          weight_kg: number | null
        }
        Insert: {
          blood_glucose?: number | null
          configuration_version?: number | null
          created_at?: string
          distance_mm?: number | null
          device_id?: number | null
          diastolic_bp?: number | null
          ecg_value?: number | null
          ecg_lead_off_negative?: boolean | null
          ecg_lead_off_positive?: boolean | null
          heart_rate?: number | null
          id?: number
          ingestion_id?: string | null
          ir_raw?: number | null
          motion_x?: number | null
          motion_y?: number | null
          motion_z?: number | null
          object_temperature_c?: number | null
          patient_id: number
          pulse_rate_estimate_bpm?: number | null
          red_raw?: number | null
          recorded_at?: string
          recorded_by?: string | null
          respiratory_rate?: number | null
          sensor_errors?: Json | null
          sensor_status?: Json | null
          signal_quality?: number | null
          signal_valid?: boolean | null
          source?: string
          spo2?: number | null
          systolic_bp?: number | null
          temperature?: number | null
          weight_kg?: number | null
        }
        Update: {
          blood_glucose?: number | null
          configuration_version?: number | null
          created_at?: string
          distance_mm?: number | null
          device_id?: number | null
          diastolic_bp?: number | null
          ecg_value?: number | null
          ecg_lead_off_negative?: boolean | null
          ecg_lead_off_positive?: boolean | null
          heart_rate?: number | null
          id?: number
          ingestion_id?: string | null
          ir_raw?: number | null
          motion_x?: number | null
          motion_y?: number | null
          motion_z?: number | null
          object_temperature_c?: number | null
          patient_id?: number
          pulse_rate_estimate_bpm?: number | null
          red_raw?: number | null
          recorded_at?: string
          recorded_by?: string | null
          respiratory_rate?: number | null
          sensor_errors?: Json | null
          sensor_status?: Json | null
          signal_quality?: number | null
          signal_valid?: boolean | null
          source?: string
          spo2?: number | null
          systolic_bp?: number | null
          temperature?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vital_readings_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vital_readings_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      wards: {
        Row: {
          capacity: number
          created_at: string
          department_id: number
          floor: string | null
          id: number
          name: string
          phone: string | null
          status: string
          updated_at: string
          ward_code: string
          ward_type: string
        }
        Insert: {
          capacity?: number
          created_at?: string
          department_id: number
          floor?: string | null
          id?: number
          name: string
          phone?: string | null
          status?: string
          updated_at?: string
          ward_code: string
          ward_type?: string
        }
        Update: {
          capacity?: number
          created_at?: string
          department_id?: number
          floor?: string | null
          id?: number
          name?: string
          phone?: string | null
          status?: string
          updated_at?: string
          ward_code?: string
          ward_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "wards_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assign_user_to_hospital: {
        Args: { target_hospital_id: number; target_user_id: string }
        Returns: Json
      }
      can_access_patient: {
        Args: { required_access_level?: string; target_patient_id: number }
        Returns: boolean
      }
      create_audit_log: {
        Args: {
          target_action: string
          target_description: string
          target_metadata?: Json
          target_record_id: number
          target_table: string
        }
        Returns: number
      }
      assign_device_by_patient_number: {
        Args: { p_device_id: number; p_patient_number: string }
        Returns: boolean
      }
      create_managed_device: {
        Args: {
          p_device_code: string
          p_device_name: string
          p_device_type: string
          p_firmware_version?: string | null
          p_hospital_id: number
          p_mac_address?: string | null
          p_model?: string | null
          p_notes?: string | null
          p_serial_number?: string | null
        }
        Returns: number
      }
      create_main_admin_hospital: {
        Args: {
          p_address?: string | null
          p_city?: string | null
          p_email?: string | null
          p_hospital_code: string
          p_name: string
          p_phone?: string | null
          p_postal_code?: string | null
          p_province?: string | null
          p_registration_number?: string | null
        }
        Returns: number
      }
      create_medication_task: {
        Args: {
          p_dose: string
          p_instructions?: string | null
          p_medication_name: string
          p_nurse_id: number
          p_patient_id: number
          p_route: string
          p_scheduled_for: string
        }
        Returns: Json
      }
      expire_patient_access_requests: { Args: never; Returns: number }
      get_current_user_hospital_id: { Args: never; Returns: number }
      get_current_user_role: { Args: never; Returns: string }
      get_device_management_data: { Args: never; Returns: Json }
        get_device_health_data: { Args: { p_device_id: number; p_from?: string | null; p_to?: string | null }; Returns: Json }
        get_device_measurement_config: { Args: { p_device_id: number }; Returns: Json }
        save_device_measurement_config: { Args: { p_device_id: number; p_config: Json }; Returns: Json }
      get_my_assigned_device_health: { Args: never; Returns: Json }
      get_main_admin_dashboard_stats: { Args: never; Returns: Json }
      get_main_admin_hospital_directory: { Args: never; Returns: Json }
      get_main_admin_staff_directory: {
        Args: { p_role: string }
        Returns: Json
      }
      complete_missing_clinical_staff_profile: {
        Args: {
          p_user_id: string
          p_hospital_id: number
          p_specialization?: string | null
          p_license_number?: string | null
          p_qualification?: string | null
          p_phone?: string | null
          p_experience_years?: number
          p_department_id?: number | null
        }
        Returns: Json
      }
      get_hospital_admin_staff_directory: { Args: never; Returns: Json }
      get_main_admin_users: { Args: never; Returns: Json }
      get_my_profile: {
        Args: never
        Returns: {
          created_at: string
          email: string
          full_name: string
          hospital_id: number | null
          id: string
          role: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "user_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_my_medication_worklist: { Args: never; Returns: Json }
      get_patient_hospital_id: {
        Args: { target_patient_id: number }
        Returns: number
      }
      has_active_patient_assignment: {
        Args: { target_patient_id: number }
        Returns: boolean
      }
      has_approved_patient_access: {
        Args: { required_access_level: string; target_patient_id: number }
        Returns: boolean
      }
      is_current_doctor: { Args: never; Returns: boolean }
      is_current_nurse: { Args: never; Returns: boolean }
      is_hospital_admin: { Args: never; Returns: boolean }
      is_main_admin: { Args: never; Returns: boolean }
      mark_notification_read: {
        Args: { target_notification_id: number }
        Returns: boolean
      }
      provision_device_credential: {
        Args: { target_device_id: number }
        Returns: Json
      }
      record_vital_reading: {
        Args: {
          p_blood_glucose?: number
          p_device_id?: number
          p_diastolic_bp?: number
          p_ecg_value?: number
          p_heart_rate?: number
          p_motion_x?: number
          p_motion_y?: number
          p_motion_z?: number
          p_patient_id: number
          p_recorded_at?: string
          p_respiratory_rate?: number
          p_source?: string
          p_spo2?: number
          p_systolic_bp?: number
          p_temperature?: number
          p_weight_kg?: number
        }
        Returns: number
      }
      record_medication_task: {
        Args: { p_notes?: string | null; p_status: string; p_task_id: number }
        Returns: Json
      }
      revoke_device_credential: {
        Args: { target_device_id: number }
        Returns: boolean
      }
      set_managed_device_status: {
        Args: { p_device_id: number; p_status: string }
        Returns: boolean
      }
      update_alert_status: {
        Args: {
          new_resolution_notes?: string
          new_status: string
          target_alert_id: number
        }
        Returns: Json
      }
      update_main_admin_hospital: {
        Args: {
          p_address?: string | null
          p_city?: string | null
          p_email?: string | null
          p_hospital_code: string
          p_hospital_id: number
          p_name: string
          p_phone?: string | null
          p_postal_code?: string | null
          p_province?: string | null
          p_registration_number?: string | null
          p_status?: string
        }
        Returns: boolean
      }
      update_hospital_staff_profile: {
        Args: {
          p_department_id?: number | null
          p_experience_years: number
          p_license_number?: string | null
          p_phone?: string | null
          p_qualification?: string | null
          p_role: string
          p_specialization?: string | null
          p_staff_id: number
          p_staff_status?: string
        }
        Returns: boolean
      }
      unassign_managed_device: {
        Args: { p_device_id: number }
        Returns: boolean
      }
      update_user_status: {
        Args: { new_status: string; target_user_id: string }
        Returns: Json
      }
      user_belongs_to_hospital: {
        Args: { target_hospital_id: number }
        Returns: boolean
      }
      verify_device_secret: {
        Args: { target_hash: string; target_secret: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
