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
      audit_log: {
        Row: {
          action: string
          changes: Json
          created_at: string
          id: string
          organization_id: string
          record_id: string
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          changes: Json
          created_at?: string
          id?: string
          organization_id: string
          record_id: string
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          changes?: Json
          created_at?: string
          id?: string
          organization_id?: string
          record_id?: string
          table_name?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      business_metric_values: {
        Row: {
          as_of_date: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          metric_key: string
          notes: string | null
          organization_id: string
          reporting_year: number
          site_id: string | null
          value: number
        }
        Insert: {
          as_of_date?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          metric_key: string
          notes?: string | null
          organization_id?: string
          reporting_year: number
          site_id?: string | null
          value: number
        }
        Update: {
          as_of_date?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          metric_key?: string
          notes?: string | null
          organization_id?: string
          reporting_year?: number
          site_id?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "business_metric_values_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_metric_values_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_metric_values_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      business_metrics: {
        Row: {
          aggregation: string
          category: string
          created_at: string
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          is_denominator: boolean
          label: string
          metric_key: string
          organization_id: string | null
          unit: string
        }
        Insert: {
          aggregation?: string
          category?: string
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_denominator?: boolean
          label: string
          metric_key: string
          organization_id?: string | null
          unit: string
        }
        Update: {
          aggregation?: string
          category?: string
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          is_denominator?: boolean
          label?: string
          metric_key?: string
          organization_id?: string | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_metrics_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      business_units: {
        Row: {
          code: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          parent_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_units_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_units_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "business_units"
            referencedColumns: ["id"]
          },
        ]
      }
      cbam_calculations: {
        Row: {
          certificate_price_eur: number
          cn_code: string
          commodity_name: string
          country_of_origin: string
          created_at: string
          emission_factor: number
          estimated_cost_eur: number
          factor_source: string | null
          factor_type: string
          id: string
          mass_unit: string
          notes: string | null
          organization_id: string
          quantity: number
          quantity_tonnes: number
          sector: string | null
          supplier_id: string | null
          supplier_name: string | null
          total_tco2e: number
        }
        Insert: {
          certificate_price_eur: number
          cn_code: string
          commodity_name: string
          country_of_origin: string
          created_at?: string
          emission_factor: number
          estimated_cost_eur: number
          factor_source?: string | null
          factor_type: string
          id?: string
          mass_unit?: string
          notes?: string | null
          organization_id: string
          quantity: number
          quantity_tonnes: number
          sector?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          total_tco2e: number
        }
        Update: {
          certificate_price_eur?: number
          cn_code?: string
          commodity_name?: string
          country_of_origin?: string
          created_at?: string
          emission_factor?: number
          estimated_cost_eur?: number
          factor_source?: string | null
          factor_type?: string
          id?: string
          mass_unit?: string
          notes?: string | null
          organization_id?: string
          quantity?: number
          quantity_tonnes?: number
          sector?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          total_tco2e?: number
        }
        Relationships: [
          {
            foreignKeyName: "cbam_calculations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cbam_calculations_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      cbam_supplier_factors: {
        Row: {
          cn_code: string
          commodity_name: string
          created_at: string
          emission_factor: number
          factor_source: string | null
          factor_unit: string
          id: string
          notes: string | null
          organization_id: string
          supplier_id: string | null
          supplier_name: string
          updated_at: string
        }
        Insert: {
          cn_code: string
          commodity_name: string
          created_at?: string
          emission_factor: number
          factor_source?: string | null
          factor_unit?: string
          id?: string
          notes?: string | null
          organization_id: string
          supplier_id?: string | null
          supplier_name: string
          updated_at?: string
        }
        Update: {
          cn_code?: string
          commodity_name?: string
          created_at?: string
          emission_factor?: number
          factor_source?: string | null
          factor_unit?: string
          id?: string
          notes?: string | null
          organization_id?: string
          supplier_id?: string | null
          supplier_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cbam_supplier_factors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cbam_supplier_factors_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_emission_factors: {
        Row: {
          co2e_factor: number
          created_at: string
          created_by: string | null
          data_year: number
          effective_from: string
          effective_to: string | null
          factor_category: string
          factor_key: string
          factor_source: string
          id: string
          is_active: boolean
          label: string | null
          notes: string | null
          organization_id: string
          unit: string
          updated_at: string
        }
        Insert: {
          co2e_factor: number
          created_at?: string
          created_by?: string | null
          data_year: number
          effective_from?: string
          effective_to?: string | null
          factor_category: string
          factor_key: string
          factor_source: string
          id?: string
          is_active?: boolean
          label?: string | null
          notes?: string | null
          organization_id?: string
          unit: string
          updated_at?: string
        }
        Update: {
          co2e_factor?: number
          created_at?: string
          created_by?: string | null
          data_year?: number
          effective_from?: string
          effective_to?: string | null
          factor_category?: string
          factor_key?: string
          factor_source?: string
          id?: string
          is_active?: boolean
          label?: string | null
          notes?: string | null
          organization_id?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_emission_factors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      disclosure_frameworks: {
        Row: {
          code: string
          description: string | null
          is_active: boolean
          issuer: string
          name: string
          sort_order: number
          source_ref: string
          version: string | null
        }
        Insert: {
          code: string
          description?: string | null
          is_active?: boolean
          issuer: string
          name: string
          sort_order?: number
          source_ref: string
          version?: string | null
        }
        Update: {
          code?: string
          description?: string | null
          is_active?: boolean
          issuer?: string
          name?: string
          sort_order?: number
          source_ref?: string
          version?: string | null
        }
        Relationships: []
      }
      disclosure_requirements: {
        Row: {
          description: string | null
          framework_code: string
          id: string
          metric_key: string | null
          requirement_code: string
          response_type: string
          section: string | null
          sort_order: number
          title: string
        }
        Insert: {
          description?: string | null
          framework_code: string
          id?: string
          metric_key?: string | null
          requirement_code: string
          response_type?: string
          section?: string | null
          sort_order?: number
          title: string
        }
        Update: {
          description?: string | null
          framework_code?: string
          id?: string
          metric_key?: string | null
          requirement_code?: string
          response_type?: string
          section?: string | null
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "disclosure_requirements_framework_code_fkey"
            columns: ["framework_code"]
            isOneToOne: false
            referencedRelation: "disclosure_frameworks"
            referencedColumns: ["code"]
          },
        ]
      }
      disclosure_responses: {
        Row: {
          created_at: string
          id: string
          narrative: string | null
          organization_id: string
          reporting_year: number
          requirement_id: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          narrative?: string | null
          organization_id?: string
          reporting_year: number
          requirement_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          narrative?: string | null
          organization_id?: string
          reporting_year?: number
          requirement_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "disclosure_responses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disclosure_responses_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "disclosure_requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      ehs_entries: {
        Row: {
          created_at: string
          created_by: string | null
          data_quality: string
          deleted_at: string | null
          entry_date: string
          estimation_method: string | null
          id: string
          metric_type: string
          notes: string | null
          organization_id: string
          quantity: number
          quantity_normalized: number
          site_id: string | null
          source_type: string
          unit: string
          unit_normalized: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data_quality?: string
          deleted_at?: string | null
          entry_date: string
          estimation_method?: string | null
          id?: string
          metric_type: string
          notes?: string | null
          organization_id?: string
          quantity: number
          quantity_normalized: number
          site_id?: string | null
          source_type: string
          unit: string
          unit_normalized: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data_quality?: string
          deleted_at?: string | null
          entry_date?: string
          estimation_method?: string | null
          id?: string
          metric_type?: string
          notes?: string | null
          organization_id?: string
          quantity?: number
          quantity_normalized?: number
          site_id?: string | null
          source_type?: string
          unit?: string
          unit_normalized?: string
        }
        Relationships: [
          {
            foreignKeyName: "ehs_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ehs_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ehs_entries_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      emission_entries: {
        Row: {
          accounting_method: string
          co2e_kg: number
          co2e_kg_location_based: number | null
          co2e_kg_outside_scopes: number
          created_at: string
          created_by: string | null
          data_quality: string
          deleted_at: string | null
          emission_factor_source: string
          emission_factor_used: number
          entry_date: string
          estimation_method: string | null
          id: string
          instrument_type: string | null
          location_factor_source: string | null
          location_factor_used: number | null
          notes: string | null
          organization_id: string
          outside_scopes_basis: string | null
          quantity: number
          quantity_normalized: number
          scope: string
          scope1_category: string | null
          scope2_market_basis: string | null
          site_id: string
          source_detail: string | null
          source_type: string
          supplier_emission_factor: number | null
          unit: string
          unit_normalized: string
        }
        Insert: {
          accounting_method?: string
          co2e_kg: number
          co2e_kg_location_based?: number | null
          co2e_kg_outside_scopes?: number
          created_at?: string
          created_by?: string | null
          data_quality?: string
          deleted_at?: string | null
          emission_factor_source: string
          emission_factor_used: number
          entry_date: string
          estimation_method?: string | null
          id?: string
          instrument_type?: string | null
          location_factor_source?: string | null
          location_factor_used?: number | null
          notes?: string | null
          organization_id?: string
          outside_scopes_basis?: string | null
          quantity: number
          quantity_normalized: number
          scope: string
          scope1_category?: string | null
          scope2_market_basis?: string | null
          site_id: string
          source_detail?: string | null
          source_type: string
          supplier_emission_factor?: number | null
          unit: string
          unit_normalized: string
        }
        Update: {
          accounting_method?: string
          co2e_kg?: number
          co2e_kg_location_based?: number | null
          co2e_kg_outside_scopes?: number
          created_at?: string
          created_by?: string | null
          data_quality?: string
          deleted_at?: string | null
          emission_factor_source?: string
          emission_factor_used?: number
          entry_date?: string
          estimation_method?: string | null
          id?: string
          instrument_type?: string | null
          location_factor_source?: string | null
          location_factor_used?: number | null
          notes?: string | null
          organization_id?: string
          outside_scopes_basis?: string | null
          quantity?: number
          quantity_normalized?: number
          scope?: string
          scope1_category?: string | null
          scope2_market_basis?: string | null
          site_id?: string
          source_detail?: string | null
          source_type?: string
          supplier_emission_factor?: number | null
          unit?: string
          unit_normalized?: string
        }
        Relationships: [
          {
            foreignKeyName: "emission_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emission_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emission_entries_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_attachments: {
        Row: {
          content_type: string | null
          created_at: string
          description: string | null
          file_name: string
          id: string
          organization_id: string
          record_id: string
          record_type: string
          size_bytes: number | null
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          content_type?: string | null
          created_at?: string
          description?: string | null
          file_name: string
          id?: string
          organization_id?: string
          record_id: string
          record_type: string
          size_bytes?: number | null
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          content_type?: string | null
          created_at?: string
          description?: string | null
          file_name?: string
          id?: string
          organization_id?: string
          record_id?: string
          record_type?: string
          size_bytes?: number | null
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evidence_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batch_rows: {
        Row: {
          batch_id: string
          created_at: string
          created_entry_id: string | null
          created_entry_table: string | null
          error: string | null
          id: string
          line_number: number
          organization_id: string
          raw: Json
          resolved: Json
          status: string
          updated_at: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          created_entry_id?: string | null
          created_entry_table?: string | null
          error?: string | null
          id?: string
          line_number: number
          organization_id: string
          raw: Json
          resolved: Json
          status?: string
          updated_at?: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          created_entry_id?: string | null
          created_entry_table?: string | null
          error?: string | null
          id?: string
          line_number?: number
          organization_id?: string
          raw?: Json
          resolved?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_batch_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batch_rows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          committed_at: string | null
          committed_count: number
          created_at: string
          family: string
          filename: string | null
          id: string
          organization_id: string
          row_count: number
          status: string
          uploaded_by: string | null
        }
        Insert: {
          committed_at?: string | null
          committed_count?: number
          created_at?: string
          family: string
          filename?: string | null
          id?: string
          organization_id: string
          row_count?: number
          status?: string
          uploaded_by?: string | null
        }
        Update: {
          committed_at?: string | null
          committed_count?: number
          created_at?: string
          family?: string
          filename?: string | null
          id?: string
          organization_id?: string
          row_count?: number
          status?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      import_row_adjustments: {
        Row: {
          adjusted_at: string
          adjusted_by: string | null
          field: string
          id: string
          new_value: string | null
          old_value: string | null
          organization_id: string
          origin: string
          reason: string | null
          row_id: string
        }
        Insert: {
          adjusted_at?: string
          adjusted_by?: string | null
          field: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          organization_id: string
          origin: string
          reason?: string | null
          row_id: string
        }
        Update: {
          adjusted_at?: string
          adjusted_by?: string | null
          field?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          organization_id?: string
          origin?: string
          reason?: string | null
          row_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_row_adjustments_adjusted_by_fkey"
            columns: ["adjusted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_row_adjustments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_row_adjustments_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "import_batch_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          base_year: number
          base_year_emissions_kg: number | null
          base_year_value: number | null
          created_at: string
          current_value: number | null
          goal_type: string
          id: string
          metric: string
          name: string
          notes: string | null
          organization_id: string
          progress_pct: number | null
          scope: string | null
          scope_coverage: string[]
          scope2_accounting_method: string
          status: string
          target_emissions_kg: number | null
          target_reduction_pct: number | null
          target_unit: string | null
          target_value: number | null
          target_year: number
        }
        Insert: {
          base_year: number
          base_year_emissions_kg?: number | null
          base_year_value?: number | null
          created_at?: string
          current_value?: number | null
          goal_type: string
          id?: string
          metric?: string
          name: string
          notes?: string | null
          organization_id?: string
          progress_pct?: number | null
          scope?: string | null
          scope_coverage?: string[]
          scope2_accounting_method?: string
          status?: string
          target_emissions_kg?: number | null
          target_reduction_pct?: number | null
          target_unit?: string | null
          target_value?: number | null
          target_year: number
        }
        Update: {
          base_year?: number
          base_year_emissions_kg?: number | null
          base_year_value?: number | null
          created_at?: string
          current_value?: number | null
          goal_type?: string
          id?: string
          metric?: string
          name?: string
          notes?: string | null
          organization_id?: string
          progress_pct?: number | null
          scope?: string | null
          scope_coverage?: string[]
          scope2_accounting_method?: string
          status?: string
          target_emissions_kg?: number | null
          target_reduction_pct?: number | null
          target_unit?: string | null
          target_value?: number | null
          target_year?: number
        }
        Relationships: [
          {
            foreignKeyName: "goals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      material_topics: {
        Row: {
          category: string
          code: string
          description: string | null
          esrs_standard: string
          name: string
          sort_order: number
        }
        Insert: {
          category: string
          code: string
          description?: string | null
          esrs_standard: string
          name: string
          sort_order?: number
        }
        Update: {
          category?: string
          code?: string
          description?: string | null
          esrs_standard?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      materiality_assessments: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          methodology: string | null
          name: string
          organization_id: string
          reporting_year: number
          status: string
          threshold: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          methodology?: string | null
          name: string
          organization_id?: string
          reporting_year: number
          status?: string
          threshold?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          methodology?: string | null
          name?: string
          organization_id?: string
          reporting_year?: number
          status?: string
          threshold?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "materiality_assessments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          base_year: number | null
          consolidation_approach: string
          created_at: string
          hq_country: string
          id: string
          industry: string | null
          intensity_metric_key: string | null
          is_active: boolean
          name: string
          reporting_year_start: number
          sandbox_of: string | null
          sandbox_seeded_at: string | null
          subscription_tier: string
          updated_at: string
        }
        Insert: {
          base_year?: number | null
          consolidation_approach?: string
          created_at?: string
          hq_country?: string
          id?: string
          industry?: string | null
          intensity_metric_key?: string | null
          is_active?: boolean
          name: string
          reporting_year_start?: number
          sandbox_of?: string | null
          sandbox_seeded_at?: string | null
          subscription_tier?: string
          updated_at?: string
        }
        Update: {
          base_year?: number | null
          consolidation_approach?: string
          created_at?: string
          hq_country?: string
          id?: string
          industry?: string | null
          intensity_metric_key?: string | null
          is_active?: boolean
          name?: string
          reporting_year_start?: number
          sandbox_of?: string | null
          sandbox_seeded_at?: string | null
          subscription_tier?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_sandbox_of_fkey"
            columns: ["sandbox_of"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          actual_co2e_reduction_kg: number | null
          actual_co2e_reduction_kg_per_year: number | null
          actual_completion_date: string | null
          actual_waste_reduction_kg_per_year: number | null
          actual_water_reduction_gal_per_year: number | null
          category: string
          completion_date: string | null
          created_at: string
          created_by: string | null
          description: string | null
          estimated_co2e_reduction_kg: number | null
          estimated_co2e_reduction_kg_per_year: number | null
          estimated_cost_usd: number | null
          estimated_payback_months: number | null
          estimated_waste_reduction_kg_per_year: number | null
          estimated_water_reduction_gal_per_year: number | null
          goal_id: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          pipeline_inclusion_status: string
          project_inputs: Json | null
          site_id: string | null
          start_date: string | null
          status: string
          target_completion_date: string | null
          updated_at: string
        }
        Insert: {
          actual_co2e_reduction_kg?: number | null
          actual_co2e_reduction_kg_per_year?: number | null
          actual_completion_date?: string | null
          actual_waste_reduction_kg_per_year?: number | null
          actual_water_reduction_gal_per_year?: number | null
          category: string
          completion_date?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimated_co2e_reduction_kg?: number | null
          estimated_co2e_reduction_kg_per_year?: number | null
          estimated_cost_usd?: number | null
          estimated_payback_months?: number | null
          estimated_waste_reduction_kg_per_year?: number | null
          estimated_water_reduction_gal_per_year?: number | null
          goal_id?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_id?: string
          pipeline_inclusion_status?: string
          project_inputs?: Json | null
          site_id?: string | null
          start_date?: string | null
          status?: string
          target_completion_date?: string | null
          updated_at?: string
        }
        Update: {
          actual_co2e_reduction_kg?: number | null
          actual_co2e_reduction_kg_per_year?: number | null
          actual_completion_date?: string | null
          actual_waste_reduction_kg_per_year?: number | null
          actual_water_reduction_gal_per_year?: number | null
          category?: string
          completion_date?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimated_co2e_reduction_kg?: number | null
          estimated_co2e_reduction_kg_per_year?: number | null
          estimated_cost_usd?: number | null
          estimated_payback_months?: number | null
          estimated_waste_reduction_kg_per_year?: number | null
          estimated_water_reduction_gal_per_year?: number | null
          goal_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          pipeline_inclusion_status?: string
          project_inputs?: Json | null
          site_id?: string | null
          start_date?: string | null
          status?: string
          target_completion_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      refrigerant_factors: {
        Row: {
          is_montreal_protocol: boolean
          data_year: number
          factor_source: string
          gwp_100_year: number
          id: string
          refrigerant_code: string
          refrigerant_name: string
        }
        Insert: {
          is_montreal_protocol?: boolean
          data_year?: number
          factor_source?: string
          gwp_100_year: number
          id?: string
          refrigerant_code: string
          refrigerant_name: string
        }
        Update: {
          is_montreal_protocol?: boolean
          data_year?: number
          factor_source?: string
          gwp_100_year?: number
          id?: string
          refrigerant_code?: string
          refrigerant_name?: string
        }
        Relationships: []
      }
      regulatory_capabilities: {
        Row: {
          capability_key: string
          created_at: string
          description: string
          display_order: number
          id: string
          is_active: boolean
          item_code: string
          label: string | null
          necessity: string
          probe: string
          probe_arg: string | null
          route: string | null
        }
        Insert: {
          capability_key: string
          created_at?: string
          description: string
          display_order?: number
          id?: string
          is_active?: boolean
          item_code: string
          label?: string | null
          necessity?: string
          probe: string
          probe_arg?: string | null
          route?: string | null
        }
        Update: {
          capability_key?: string
          created_at?: string
          description?: string
          display_order?: number
          id?: string
          is_active?: boolean
          item_code?: string
          label?: string | null
          necessity?: string
          probe?: string
          probe_arg?: string | null
          route?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "regulatory_capabilities_item_code_fkey"
            columns: ["item_code"]
            isOneToOne: false
            referencedRelation: "regulatory_items"
            referencedColumns: ["code"]
          },
        ]
      }
      regulatory_change_proposals: {
        Row: {
          ai_model: string | null
          ai_provider: string | null
          ai_summary: string | null
          ai_ungrounded: Json
          change_kind: string
          created_at: string
          detected_summary: string
          diff_excerpt: string | null
          id: string
          item_code: string
          proposed_patch: Json
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          run_id: string
          source_url: string
          status: string
        }
        Insert: {
          ai_model?: string | null
          ai_provider?: string | null
          ai_summary?: string | null
          ai_ungrounded?: Json
          change_kind: string
          created_at?: string
          detected_summary: string
          diff_excerpt?: string | null
          id?: string
          item_code: string
          proposed_patch?: Json
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id: string
          source_url: string
          status?: string
        }
        Update: {
          ai_model?: string | null
          ai_provider?: string | null
          ai_summary?: string | null
          ai_ungrounded?: Json
          change_kind?: string
          created_at?: string
          detected_summary?: string
          diff_excerpt?: string | null
          id?: string
          item_code?: string
          proposed_patch?: Json
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string
          source_url?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "regulatory_change_proposals_item_code_fkey"
            columns: ["item_code"]
            isOneToOne: false
            referencedRelation: "regulatory_items"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "regulatory_change_proposals_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regulatory_change_proposals_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "regulatory_watch_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      regulatory_frameworks: {
        Row: {
          accent_color: string | null
          code: string
          created_at: string
          description: string | null
          display_order: number
          domain: string
          id: string
          is_active: boolean
          name: string
          publisher: string
          short_name: string | null
          status_headline: string | null
          tagline: string | null
          updated_at: string
        }
        Insert: {
          accent_color?: string | null
          code: string
          created_at?: string
          description?: string | null
          display_order?: number
          domain: string
          id?: string
          is_active?: boolean
          name: string
          publisher: string
          short_name?: string | null
          status_headline?: string | null
          tagline?: string | null
          updated_at?: string
        }
        Update: {
          accent_color?: string | null
          code?: string
          created_at?: string
          description?: string | null
          display_order?: number
          domain?: string
          id?: string
          is_active?: boolean
          name?: string
          publisher?: string
          short_name?: string | null
          status_headline?: string | null
          tagline?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      regulatory_glossary: {
        Row: {
          created_at: string
          definition: string
          expansion: string | null
          framework_code: string | null
          id: string
          is_acronym: boolean
          term: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          definition: string
          expansion?: string | null
          framework_code?: string | null
          id?: string
          is_acronym?: boolean
          term: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          definition?: string
          expansion?: string | null
          framework_code?: string | null
          id?: string
          is_acronym?: boolean
          term?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "regulatory_glossary_framework_code_fkey"
            columns: ["framework_code"]
            isOneToOne: false
            referencedRelation: "regulatory_frameworks"
            referencedColumns: ["code"]
          },
        ]
      }
      regulatory_items: {
        Row: {
          category: string
          code: string
          confidence: string
          confidence_note: string | null
          created_at: string
          display_order: number
          framework_code: string | null
          id: string
          is_active: boolean
          jurisdiction: string
          key_points: Json
          last_verified: string
          name: string
          next_milestone: string | null
          next_milestone_date: string | null
          next_milestone_note: string | null
          sources: Json
          stage: string
          status_summary: string
          topics: string[]
          updated_at: string
        }
        Insert: {
          category: string
          code: string
          confidence: string
          confidence_note?: string | null
          created_at?: string
          display_order?: number
          framework_code?: string | null
          id?: string
          is_active?: boolean
          jurisdiction: string
          key_points?: Json
          last_verified: string
          name: string
          next_milestone?: string | null
          next_milestone_date?: string | null
          next_milestone_note?: string | null
          sources: Json
          stage: string
          status_summary: string
          topics?: string[]
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          confidence?: string
          confidence_note?: string | null
          created_at?: string
          display_order?: number
          framework_code?: string | null
          id?: string
          is_active?: boolean
          jurisdiction?: string
          key_points?: Json
          last_verified?: string
          name?: string
          next_milestone?: string | null
          next_milestone_date?: string | null
          next_milestone_note?: string | null
          sources?: Json
          stage?: string
          status_summary?: string
          topics?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "regulatory_items_framework_code_fkey"
            columns: ["framework_code"]
            isOneToOne: false
            referencedRelation: "regulatory_frameworks"
            referencedColumns: ["code"]
          },
        ]
      }
      regulatory_relationships: {
        Row: {
          bullets: Json
          confidence: string
          created_at: string
          display_order: number
          from_code: string
          id: string
          is_active: boolean
          is_watchlist: boolean
          last_verified: string
          note: string
          relation: string
          sources: Json
          title: string
          to_code: string
          updated_at: string
          watchlist_detail: string | null
        }
        Insert: {
          bullets?: Json
          confidence: string
          created_at?: string
          display_order?: number
          from_code: string
          id?: string
          is_active?: boolean
          is_watchlist?: boolean
          last_verified: string
          note: string
          relation: string
          sources: Json
          title: string
          to_code: string
          updated_at?: string
          watchlist_detail?: string | null
        }
        Update: {
          bullets?: Json
          confidence?: string
          created_at?: string
          display_order?: number
          from_code?: string
          id?: string
          is_active?: boolean
          is_watchlist?: boolean
          last_verified?: string
          note?: string
          relation?: string
          sources?: Json
          title?: string
          to_code?: string
          updated_at?: string
          watchlist_detail?: string | null
        }
        Relationships: []
      }
      regulatory_source_snapshots: {
        Row: {
          content_hash: string
          content_length: number
          excerpt: string | null
          fetched_at: string
          id: string
          item_code: string
          source_url: string
        }
        Insert: {
          content_hash: string
          content_length?: number
          excerpt?: string | null
          fetched_at?: string
          id?: string
          item_code: string
          source_url: string
        }
        Update: {
          content_hash?: string
          content_length?: number
          excerpt?: string | null
          fetched_at?: string
          id?: string
          item_code?: string
          source_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "regulatory_source_snapshots_item_code_fkey"
            columns: ["item_code"]
            isOneToOne: false
            referencedRelation: "regulatory_items"
            referencedColumns: ["code"]
          },
        ]
      }
      regulatory_updates: {
        Row: {
          created_at: string
          detail: string | null
          headline: string
          id: string
          item_code: string
          significance: string | null
          so_what: string | null
          source_url: string
          update_date: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          headline: string
          id?: string
          item_code: string
          significance?: string | null
          so_what?: string | null
          source_url: string
          update_date: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          headline?: string
          id?: string
          item_code?: string
          significance?: string | null
          so_what?: string | null
          source_url?: string
          update_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "regulatory_updates_item_code_fkey"
            columns: ["item_code"]
            isOneToOne: false
            referencedRelation: "regulatory_items"
            referencedColumns: ["code"]
          },
        ]
      }
      regulatory_watch_runs: {
        Row: {
          ai_model: string | null
          ai_provider: string | null
          ai_used: boolean
          error: string | null
          finished_at: string | null
          id: string
          proposals_created: number
          sources_changed: number
          sources_checked: number
          sources_failed: number
          started_at: string
          status: string
          trigger_kind: string
          triggered_by: string | null
        }
        Insert: {
          ai_model?: string | null
          ai_provider?: string | null
          ai_used?: boolean
          error?: string | null
          finished_at?: string | null
          id?: string
          proposals_created?: number
          sources_changed?: number
          sources_checked?: number
          sources_failed?: number
          started_at?: string
          status?: string
          trigger_kind?: string
          triggered_by?: string | null
        }
        Update: {
          ai_model?: string | null
          ai_provider?: string | null
          ai_used?: boolean
          error?: string | null
          finished_at?: string | null
          id?: string
          proposals_created?: number
          sources_changed?: number
          sources_checked?: number
          sources_failed?: number
          started_at?: string
          status?: string
          trigger_kind?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "regulatory_watch_runs_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      requirement_topics: {
        Row: {
          requirement_id: string
          topic_code: string
        }
        Insert: {
          requirement_id: string
          topic_code: string
        }
        Update: {
          requirement_id?: string
          topic_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "requirement_topics_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "disclosure_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requirement_topics_topic_code_fkey"
            columns: ["topic_code"]
            isOneToOne: false
            referencedRelation: "material_topics"
            referencedColumns: ["code"]
          },
        ]
      }
      scope1_emission_factors: {
        Row: {
          biogenic_co2_factor: number | null
          co2e_factor: number
          data_year: number
          factor_source: string
          fuel_type: string
          id: string
          unit: string
        }
        Insert: {
          biogenic_co2_factor?: number | null
          co2e_factor: number
          data_year?: number
          factor_source?: string
          fuel_type: string
          id?: string
          unit: string
        }
        Update: {
          biogenic_co2_factor?: number | null
          co2e_factor?: number
          data_year?: number
          factor_source?: string
          fuel_type?: string
          id?: string
          unit?: string
        }
        Relationships: []
      }
      scope2_emission_factors: {
        Row: {
          co2e_factor: number
          data_year: number
          factor_source: string
          factor_type: string
          geographic_identifier: string
          geographic_scope: string
          id: string
        }
        Insert: {
          co2e_factor: number
          data_year?: number
          factor_source?: string
          factor_type: string
          geographic_identifier: string
          geographic_scope: string
          id?: string
        }
        Update: {
          co2e_factor?: number
          data_year?: number
          factor_source?: string
          factor_type?: string
          geographic_identifier?: string
          geographic_scope?: string
          id?: string
        }
        Relationships: []
      }
      scope3_categories: {
        Row: {
          category_number: number
          description: string
          name: string
          typical_methods: string[]
          value_chain: string
        }
        Insert: {
          category_number: number
          description: string
          name: string
          typical_methods?: string[]
          value_chain: string
        }
        Update: {
          category_number?: number
          description?: string
          name?: string
          typical_methods?: string[]
          value_chain?: string
        }
        Relationships: []
      }
      scope3_entries: {
        Row: {
          activity_unit: string
          activity_value: number
          calculation_method: string
          category_number: number
          co2e_kg: number
          created_at: string
          created_by: string | null
          data_quality: string
          deleted_at: string | null
          description: string | null
          entry_date: string
          factor_data_year: number | null
          factor_id: string | null
          factor_source: string
          factor_unit: string
          factor_value: number
          id: string
          notes: string | null
          organization_id: string
          site_id: string | null
          supplier_id: string | null
        }
        Insert: {
          activity_unit: string
          activity_value: number
          calculation_method: string
          category_number: number
          co2e_kg: number
          created_at?: string
          created_by?: string | null
          data_quality?: string
          deleted_at?: string | null
          description?: string | null
          entry_date: string
          factor_data_year?: number | null
          factor_id?: string | null
          factor_source: string
          factor_unit: string
          factor_value: number
          id?: string
          notes?: string | null
          organization_id?: string
          site_id?: string | null
          supplier_id?: string | null
        }
        Update: {
          activity_unit?: string
          activity_value?: number
          calculation_method?: string
          category_number?: number
          co2e_kg?: number
          created_at?: string
          created_by?: string | null
          data_quality?: string
          deleted_at?: string | null
          description?: string | null
          entry_date?: string
          factor_data_year?: number | null
          factor_id?: string | null
          factor_source?: string
          factor_unit?: string
          factor_value?: number
          id?: string
          notes?: string | null
          organization_id?: string
          site_id?: string | null
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scope3_entries_category_number_fkey"
            columns: ["category_number"]
            isOneToOne: false
            referencedRelation: "scope3_categories"
            referencedColumns: ["category_number"]
          },
          {
            foreignKeyName: "scope3_entries_factor_id_fkey"
            columns: ["factor_id"]
            isOneToOne: false
            referencedRelation: "scope3_factors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scope3_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scope3_entries_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scope3_entries_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      scope3_factors: {
        Row: {
          activity_key: string
          activity_unit: string
          category_number: number
          created_at: string
          created_by: string | null
          data_year: number
          effective_from: string
          effective_to: string | null
          factor_source: string
          factor_value: number
          id: string
          is_active: boolean
          label: string | null
          method: string
          notes: string | null
          organization_id: string
          region: string | null
          updated_at: string
        }
        Insert: {
          activity_key: string
          activity_unit: string
          category_number: number
          created_at?: string
          created_by?: string | null
          data_year: number
          effective_from?: string
          effective_to?: string | null
          factor_source: string
          factor_value: number
          id?: string
          is_active?: boolean
          label?: string | null
          method: string
          notes?: string | null
          organization_id?: string
          region?: string | null
          updated_at?: string
        }
        Update: {
          activity_key?: string
          activity_unit?: string
          category_number?: number
          created_at?: string
          created_by?: string | null
          data_year?: number
          effective_from?: string
          effective_to?: string | null
          factor_source?: string
          factor_value?: number
          id?: string
          is_active?: boolean
          label?: string | null
          method?: string
          notes?: string | null
          organization_id?: string
          region?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scope3_factors_category_number_fkey"
            columns: ["category_number"]
            isOneToOne: false
            referencedRelation: "scope3_categories"
            referencedColumns: ["category_number"]
          },
          {
            foreignKeyName: "scope3_factors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      site_equipment: {
        Row: {
          asset_tag: string | null
          capacity_unit: string | null
          created_at: string
          created_by: string | null
          energy_source: string | null
          equipment_type: string
          id: string
          install_year: number | null
          is_active: boolean
          manufacturer: string | null
          model: string | null
          name: string
          notes: string | null
          operating_hours_per_year: number | null
          organization_id: string
          quantity: number
          rated_capacity: number | null
          rated_power_kw: number | null
          refrigerant_charge_kg: number | null
          refrigerant_code: string | null
          site_id: string
          status: string
          updated_at: string
        }
        Insert: {
          asset_tag?: string | null
          capacity_unit?: string | null
          created_at?: string
          created_by?: string | null
          energy_source?: string | null
          equipment_type: string
          id?: string
          install_year?: number | null
          is_active?: boolean
          manufacturer?: string | null
          model?: string | null
          name: string
          notes?: string | null
          operating_hours_per_year?: number | null
          organization_id?: string
          quantity?: number
          rated_capacity?: number | null
          rated_power_kw?: number | null
          refrigerant_charge_kg?: number | null
          refrigerant_code?: string | null
          site_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          asset_tag?: string | null
          capacity_unit?: string | null
          created_at?: string
          created_by?: string | null
          energy_source?: string | null
          equipment_type?: string
          id?: string
          install_year?: number | null
          is_active?: boolean
          manufacturer?: string | null
          model?: string | null
          name?: string
          notes?: string | null
          operating_hours_per_year?: number | null
          organization_id?: string
          quantity?: number
          rated_capacity?: number | null
          rated_power_kw?: number | null
          refrigerant_charge_kg?: number | null
          refrigerant_code?: string | null
          site_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_equipment_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_equipment_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_equipment_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_group_members: {
        Row: {
          group_id: string
          site_id: string
        }
        Insert: {
          group_id: string
          site_id: string
        }
        Update: {
          group_id?: string
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "site_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_group_members_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_groups: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          address: string | null
          backup_generator_count: number | null
          backup_generator_fuel: string | null
          backup_generator_kw: number | null
          business_unit: string | null
          business_unit_id: string | null
          city: string | null
          country: string
          created_at: string
          electric_utility: string | null
          employee_count: number | null
          floor_area_sqft: number | null
          has_backup_generators: boolean | null
          id: string
          is_active: boolean
          is_controlled: boolean
          name: string
          natural_gas_utility: string | null
          operating_hours_per_week: number | null
          organization_id: string
          ownership_percent: number
          site_type: string
          state: string | null
          uses_natural_gas: boolean | null
          wastewater_discharge: string | null
          water_source: string | null
          water_source_notes: string | null
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          backup_generator_count?: number | null
          backup_generator_fuel?: string | null
          backup_generator_kw?: number | null
          business_unit?: string | null
          business_unit_id?: string | null
          city?: string | null
          country?: string
          created_at?: string
          electric_utility?: string | null
          employee_count?: number | null
          floor_area_sqft?: number | null
          has_backup_generators?: boolean | null
          id?: string
          is_active?: boolean
          is_controlled?: boolean
          name: string
          natural_gas_utility?: string | null
          operating_hours_per_week?: number | null
          organization_id: string
          ownership_percent?: number
          site_type?: string
          state?: string | null
          uses_natural_gas?: boolean | null
          wastewater_discharge?: string | null
          water_source?: string | null
          water_source_notes?: string | null
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          backup_generator_count?: number | null
          backup_generator_fuel?: string | null
          backup_generator_kw?: number | null
          business_unit?: string | null
          business_unit_id?: string | null
          city?: string | null
          country?: string
          created_at?: string
          electric_utility?: string | null
          employee_count?: number | null
          floor_area_sqft?: number | null
          has_backup_generators?: boolean | null
          id?: string
          is_active?: boolean
          is_controlled?: boolean
          name?: string
          natural_gas_utility?: string | null
          operating_hours_per_week?: number | null
          organization_id?: string
          ownership_percent?: number
          site_type?: string
          state?: string | null
          uses_natural_gas?: boolean | null
          wastewater_discharge?: string | null
          water_source?: string | null
          water_source_notes?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sites_business_unit_id_fkey"
            columns: ["business_unit_id"]
            isOneToOne: false
            referencedRelation: "business_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sso_domains: {
        Row: {
          created_at: string
          default_role: string
          domain: string
          id: string
          is_active: boolean
          notes: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_role?: string
          domain: string
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_role?: string
          domain?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sso_domains_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stakeholder_ratings: {
        Row: {
          assessment_id: string
          comment: string | null
          created_at: string
          id: string
          rating: number
          respondent_label: string | null
          stakeholder_group: string
          topic_code: string
          weight: number
        }
        Insert: {
          assessment_id: string
          comment?: string | null
          created_at?: string
          id?: string
          rating: number
          respondent_label?: string | null
          stakeholder_group: string
          topic_code: string
          weight?: number
        }
        Update: {
          assessment_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          rating?: number
          respondent_label?: string | null
          stakeholder_group?: string
          topic_code?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "stakeholder_ratings_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "materiality_assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stakeholder_ratings_topic_code_fkey"
            columns: ["topic_code"]
            isOneToOne: false
            referencedRelation: "material_topics"
            referencedColumns: ["code"]
          },
        ]
      }
      supplier_survey_invitations: {
        Row: {
          email: string | null
          id: string
          last_reminded_at: string | null
          reminder_count: number
          sent_at: string | null
          status: string
          submitted_at: string | null
          supplier_id: string | null
          supplier_name: string | null
          survey_id: string
          token: string
        }
        Insert: {
          email?: string | null
          id?: string
          last_reminded_at?: string | null
          reminder_count?: number
          sent_at?: string | null
          status?: string
          submitted_at?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          survey_id: string
          token?: string
        }
        Update: {
          email?: string | null
          id?: string
          last_reminded_at?: string | null
          reminder_count?: number
          sent_at?: string | null
          status?: string
          submitted_at?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          survey_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_survey_invitations_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_survey_invitations_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "supplier_surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_survey_question_responses: {
        Row: {
          answer: string | null
          created_at: string
          id: string
          invitation_id: string
          question_id: string
          updated_at: string
        }
        Insert: {
          answer?: string | null
          created_at?: string
          id?: string
          invitation_id: string
          question_id: string
          updated_at?: string
        }
        Update: {
          answer?: string | null
          created_at?: string
          id?: string
          invitation_id?: string
          question_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_survey_question_responses_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "supplier_survey_invitations"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_survey_questions: {
        Row: {
          created_at: string
          help_text: string | null
          id: string
          label: string
          options: Json
          position: number
          question_key: string
          question_type: string
          required: boolean
          show_when_answer: string | null
          show_when_question_key: string | null
          survey_id: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          help_text?: string | null
          id?: string
          label: string
          options?: Json
          position?: number
          question_key: string
          question_type?: string
          required?: boolean
          show_when_answer?: string | null
          show_when_question_key?: string | null
          survey_id: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          help_text?: string | null
          id?: string
          label?: string
          options?: Json
          position?: number
          question_key?: string
          question_type?: string
          required?: boolean
          show_when_answer?: string | null
          show_when_question_key?: string | null
          survey_id?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_survey_questions_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "supplier_surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_survey_responses: {
        Row: {
          co2e_intensity_kg_per_unit: number | null
          id: string
          invitation_id: string
          is_complete: boolean
          responses: Json
          submitted_at: string
          supplier_id: string
          survey_id: string
        }
        Insert: {
          co2e_intensity_kg_per_unit?: number | null
          id?: string
          invitation_id: string
          is_complete?: boolean
          responses?: Json
          submitted_at?: string
          supplier_id: string
          survey_id: string
        }
        Update: {
          co2e_intensity_kg_per_unit?: number | null
          id?: string
          invitation_id?: string
          is_complete?: boolean
          responses?: Json
          submitted_at?: string
          supplier_id?: string
          survey_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_survey_responses_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "supplier_survey_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_survey_responses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_survey_responses_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "supplier_surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_surveys: {
        Row: {
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          notes: string | null
          organization_id: string
          custom_regulation_name: string | null
          regulation_type: string
          status: string
          title: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          custom_regulation_name?: string | null
          regulation_type: string
          status?: string
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          custom_regulation_name?: string | null
          regulation_type?: string
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_surveys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_surveys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          country: string | null
          created_at: string
          id: string
          industry: string | null
          is_active: boolean
          name: string
          notes: string | null
          organization_id: string
          spend_usd: number | null
          tier: number | null
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          country?: string | null
          created_at?: string
          id?: string
          industry?: string | null
          is_active?: boolean
          name: string
          notes?: string | null
          organization_id?: string
          spend_usd?: number | null
          tier?: number | null
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          country?: string | null
          created_at?: string
          id?: string
          industry?: string | null
          is_active?: boolean
          name?: string
          notes?: string | null
          organization_id?: string
          spend_usd?: number | null
          tier?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sustainability_metrics: {
        Row: {
          aggregation: string
          canonical_unit: string
          created_at: string
          description: string | null
          display_order: number
          framework_reference: string | null
          id: string
          is_active: boolean
          is_rate_input: boolean
          label: string
          metric_type: string
          pillar: string
          source_type: string
        }
        Insert: {
          aggregation?: string
          canonical_unit: string
          created_at?: string
          description?: string | null
          display_order?: number
          framework_reference?: string | null
          id?: string
          is_active?: boolean
          is_rate_input?: boolean
          label: string
          metric_type: string
          pillar: string
          source_type: string
        }
        Update: {
          aggregation?: string
          canonical_unit?: string
          created_at?: string
          description?: string | null
          display_order?: number
          framework_reference?: string | null
          id?: string
          is_active?: boolean
          is_rate_input?: boolean
          label?: string
          metric_type?: string
          pillar?: string
          source_type?: string
        }
        Relationships: []
      }
      topic_assessments: {
        Row: {
          assessment_id: string
          created_at: string
          financial_likelihood: number
          financial_magnitude: number
          id: string
          impact_irremediability: number
          impact_is_actual: boolean
          impact_is_negative: boolean
          impact_likelihood: number
          impact_scale: number
          impact_scope: number
          rationale: string | null
          topic_code: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assessment_id: string
          created_at?: string
          financial_likelihood?: number
          financial_magnitude?: number
          id?: string
          impact_irremediability?: number
          impact_is_actual?: boolean
          impact_is_negative?: boolean
          impact_likelihood?: number
          impact_scale?: number
          impact_scope?: number
          rationale?: string | null
          topic_code: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assessment_id?: string
          created_at?: string
          financial_likelihood?: number
          financial_magnitude?: number
          id?: string
          impact_irremediability?: number
          impact_is_actual?: boolean
          impact_is_negative?: boolean
          impact_likelihood?: number
          impact_scale?: number
          impact_scope?: number
          rationale?: string | null
          topic_code?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "topic_assessments_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "materiality_assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "topic_assessments_topic_code_fkey"
            columns: ["topic_code"]
            isOneToOne: false
            referencedRelation: "material_topics"
            referencedColumns: ["code"]
          },
        ]
      }
      users: {
        Row: {
          active_organization_id: string | null
          auth_provider: string
          created_at: string
          email: string
          first_name: string | null
          id: string
          is_active: boolean
          last_name: string | null
          organization_id: string
          provisioned_at: string | null
          provisioned_via_domain: string | null
          role: string
        }
        Insert: {
          active_organization_id?: string | null
          auth_provider?: string
          created_at?: string
          email: string
          first_name?: string | null
          id?: string
          is_active?: boolean
          last_name?: string | null
          organization_id: string
          provisioned_at?: string | null
          provisioned_via_domain?: string | null
          role?: string
        }
        Update: {
          active_organization_id?: string | null
          auth_provider?: string
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          is_active?: boolean
          last_name?: string | null
          organization_id?: string
          provisioned_at?: string | null
          provisioned_via_domain?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_active_organization_id_fkey"
            columns: ["active_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auth_home_org_id: { Args: never; Returns: string }
      auth_in_sandbox: { Args: never; Returns: boolean }
      auth_org_id: { Args: never; Returns: string }
      auth_user_role: { Args: never; Returns: string }
      provision_sandbox: { Args: never; Returns: string }
      reset_sandbox: { Args: never; Returns: string }
      set_active_organization: { Args: { target: string }; Returns: string }
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

// ─── Convenience row types ──────────────────────────────
// HAND-MAINTAINED. `supabase gen types` does not emit these, so a regeneration
// overwrites the file and drops them — re-append this block afterwards, and add
// a line here when a new table gets a short name in application code.
export type Organization      = Database['public']['Tables']['organizations']['Row'];
export type AppUser           = Database['public']['Tables']['users']['Row'];
export type Site              = Database['public']['Tables']['sites']['Row'];
export type SiteEquipment     = Database['public']['Tables']['site_equipment']['Row'];
export type EmissionEntry     = Database['public']['Tables']['emission_entries']['Row'];
export type EhsEntry          = Database['public']['Tables']['ehs_entries']['Row'];
export type ImportBatch       = Database['public']['Tables']['import_batches']['Row'];
export type ImportBatchRow    = Database['public']['Tables']['import_batch_rows']['Row'];
export type ImportRowAdjustment = Database['public']['Tables']['import_row_adjustments']['Row'];
export type SustainabilityMetric = Database['public']['Tables']['sustainability_metrics']['Row'];
export type RegulatoryItemRow  = Database['public']['Tables']['regulatory_items']['Row'];
export type RegulatoryUpdateRow = Database['public']['Tables']['regulatory_updates']['Row'];
export type RegulatoryProposalRow = Database['public']['Tables']['regulatory_change_proposals']['Row'];
export type RegulatoryWatchRunRow = Database['public']['Tables']['regulatory_watch_runs']['Row'];
export type RegulatoryCapabilityRow = Database['public']['Tables']['regulatory_capabilities']['Row'];
export type RegulatoryFrameworkRow    = Database['public']['Tables']['regulatory_frameworks']['Row'];
export type RegulatoryRelationshipRow = Database['public']['Tables']['regulatory_relationships']['Row'];
export type RegulatoryGlossaryRow   = Database['public']['Tables']['regulatory_glossary']['Row'];
export type Goal              = Database['public']['Tables']['goals']['Row'];
export type Project           = Database['public']['Tables']['projects']['Row'];
export type Supplier          = Database['public']['Tables']['suppliers']['Row'];
export type SupplierSurvey    = Database['public']['Tables']['supplier_surveys']['Row'];
export type SurveyInvitation  = Database['public']['Tables']['supplier_survey_invitations']['Row'];
export type SurveyResponse    = Database['public']['Tables']['supplier_survey_responses']['Row'];
export type Scope1Factor      = Database['public']['Tables']['scope1_emission_factors']['Row'];
export type Scope2Factor      = Database['public']['Tables']['scope2_emission_factors']['Row'];
export type RefrigerantFactor = Database['public']['Tables']['refrigerant_factors']['Row'];
export type CBAMCalculation   = Database['public']['Tables']['cbam_calculations']['Row'];
export type CBAMSupplierFactor = Database['public']['Tables']['cbam_supplier_factors']['Row'];
export type AuditLogEntry      = Database['public']['Tables']['audit_log']['Row'];
export type CustomEmissionFactor = Database['public']['Tables']['custom_emission_factors']['Row'];
export type Scope3Category     = Database['public']['Tables']['scope3_categories']['Row'];
export type Scope3Entry        = Database['public']['Tables']['scope3_entries']['Row'];
export type Scope3Factor       = Database['public']['Tables']['scope3_factors']['Row'];
export type BusinessUnit       = Database['public']['Tables']['business_units']['Row'];
export type MaterialTopic      = Database['public']['Tables']['material_topics']['Row'];
export type SiteGroup          = Database['public']['Tables']['site_groups']['Row'];
export type DisclosureFramework   = Database['public']['Tables']['disclosure_frameworks']['Row'];
export type DisclosureRequirement = Database['public']['Tables']['disclosure_requirements']['Row'];
export type DisclosureResponse    = Database['public']['Tables']['disclosure_responses']['Row'];
export type RequirementTopic      = Database['public']['Tables']['requirement_topics']['Row'];
export type EvidenceAttachment    = Database['public']['Tables']['evidence_attachments']['Row'];
export type MaterialityAssessment = Database['public']['Tables']['materiality_assessments']['Row'];
export type TopicAssessment       = Database['public']['Tables']['topic_assessments']['Row'];
