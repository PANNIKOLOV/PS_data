/**
 * Database types.
 *
 * Kept in step with supabase/migrations by hand. After changing a migration,
 * regenerate with:
 *   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/types.ts
 */

export type UserRole = 'admin' | 'marketer';
export type PsVersion = '1.7' | '8' | '9';
export type SyncStatus = 'pending' | 'running' | 'success' | 'partial' | 'failed';

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          role: UserRole;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          role?: UserRole;
          is_active?: boolean;
        };
        Update: {
          email?: string;
          full_name?: string | null;
          role?: UserRole;
          is_active?: boolean;
        };
        Relationships: [];
      };
      shops: {
        Row: {
          id: string;
          name: string;
          base_url: string;
          ps_version: PsVersion;
          detected_version: string | null;
          currency_code: string;
          timezone: string;
          is_active: boolean;
          last_sync_at: string | null;
          last_sync_status: SyncStatus | null;
          last_sync_error: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          base_url: string;
          ps_version?: PsVersion;
          detected_version?: string | null;
          currency_code?: string;
          timezone?: string;
          is_active?: boolean;
          created_by?: string | null;
        };
        Update: {
          name?: string;
          base_url?: string;
          ps_version?: PsVersion;
          detected_version?: string | null;
          currency_code?: string;
          timezone?: string;
          is_active?: boolean;
          last_sync_at?: string | null;
          last_sync_status?: SyncStatus | null;
          last_sync_error?: string | null;
        };
        Relationships: [];
      };
      shop_credentials: {
        Row: {
          shop_id: string;
          api_key_cipher: string;
          key_fingerprint: string;
          updated_at: string;
        };
        Insert: {
          shop_id: string;
          api_key_cipher: string;
          key_fingerprint: string;
        };
        Update: {
          api_key_cipher?: string;
          key_fingerprint?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      metric_keys: {
        Row: { key: string; label: string; description: string; sort_order: number };
        Insert: { key: string; label: string; description: string; sort_order?: number };
        Update: { label?: string; description?: string; sort_order?: number };
        Relationships: [];
      };
      shop_assignments: {
        Row: {
          id: string;
          shop_id: string;
          user_id: string;
          metrics: string[];
          granted_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          shop_id: string;
          user_id: string;
          metrics?: string[];
          granted_by?: string | null;
        };
        Update: { metrics?: string[] };
        Relationships: [];
      };
      ps_order_states: {
        Row: {
          shop_id: string;
          ps_state_id: number;
          name: string;
          color: string | null;
          is_paid: boolean;
          is_shipped: boolean;
          is_deleted: boolean;
          synced_at: string;
        };
        Insert: {
          shop_id: string;
          ps_state_id: number;
          name: string;
          color?: string | null;
          is_paid?: boolean;
          is_shipped?: boolean;
          is_deleted?: boolean;
          synced_at?: string;
        };
        Update: { name?: string; color?: string | null };
        Relationships: [];
      };
      ps_currencies: {
        Row: {
          shop_id: string;
          ps_currency_id: number;
          iso_code: string;
          conversion_rate: number;
          synced_at: string;
        };
        Insert: {
          shop_id: string;
          ps_currency_id: number;
          iso_code: string;
          conversion_rate?: number;
          synced_at?: string;
        };
        Update: { iso_code?: string; conversion_rate?: number };
        Relationships: [];
      };
      ps_orders: {
        Row: {
          id: number;
          shop_id: string;
          ps_order_id: number;
          reference: string | null;
          ps_customer_id: number | null;
          current_state: number | null;
          payment_method: string | null;
          module: string | null;
          is_valid: boolean;
          currency_code: string | null;
          conversion_rate: number;
          total_paid: number;
          total_paid_real: number;
          total_products: number;
          total_shipping: number;
          total_discounts: number;
          total_paid_base: number;
          date_add: string;
          date_upd: string | null;
          synced_at: string;
        };
        Insert: {
          shop_id: string;
          ps_order_id: number;
          reference?: string | null;
          ps_customer_id?: number | null;
          current_state?: number | null;
          payment_method?: string | null;
          module?: string | null;
          is_valid?: boolean;
          currency_code?: string | null;
          conversion_rate?: number;
          total_paid?: number;
          total_paid_real?: number;
          total_products?: number;
          total_shipping?: number;
          total_discounts?: number;
          total_paid_base?: number;
          date_add: string;
          date_upd?: string | null;
          synced_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      ps_customers: {
        Row: {
          id: number;
          shop_id: string;
          ps_customer_id: number;
          date_add: string;
          newsletter: boolean;
          optin: boolean;
          is_active: boolean;
          is_guest: boolean;
          synced_at: string;
        };
        Insert: {
          shop_id: string;
          ps_customer_id: number;
          date_add: string;
          newsletter?: boolean;
          optin?: boolean;
          is_active?: boolean;
          is_guest?: boolean;
          synced_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      sync_runs: {
        Row: {
          id: string;
          shop_id: string;
          status: SyncStatus;
          trigger_source: string;
          triggered_by: string | null;
          orders_synced: number;
          customers_synced: number;
          error_message: string | null;
          started_at: string;
          finished_at: string | null;
          duration_ms: number | null;
        };
        Insert: {
          id?: string;
          shop_id: string;
          status?: SyncStatus;
          trigger_source?: string;
          triggered_by?: string | null;
        };
        Update: {
          status?: SyncStatus;
          orders_synced?: number;
          customers_synced?: number;
          error_message?: string | null;
          finished_at?: string | null;
          duration_ms?: number | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
      has_shop_access: { Args: { p_shop_id: string }; Returns: boolean };
      can_view_metric: { Args: { p_shop_id: string; p_metric: string }; Returns: boolean };
      accessible_shop_ids: { Args: Record<string, never>; Returns: string[] };
      analytics_summary: {
        Args: { p_shop_ids: string[]; p_from: string; p_to: string; p_only_valid?: boolean };
        Returns: {
          orders_count: number;
          revenue: number;
          average_order_value: number;
          items_total: number;
          shipping_total: number;
          discounts_total: number;
          unique_customers: number;
          new_registrations: number;
          currency_count: number;
        }[];
      };
      analytics_timeseries: {
        Args: {
          p_shop_ids: string[];
          p_from: string;
          p_to: string;
          p_granularity?: string;
          p_timezone?: string;
          p_only_valid?: boolean;
        };
        Returns: {
          bucket: string;
          orders_count: number;
          revenue: number;
          new_registrations: number;
        }[];
      };
      analytics_status_breakdown: {
        Args: { p_shop_ids: string[]; p_from: string; p_to: string };
        Returns: {
          state_id: number;
          state_name: string;
          color: string | null;
          orders_count: number;
          revenue: number;
        }[];
      };
      analytics_payment_breakdown: {
        Args: { p_shop_ids: string[]; p_from: string; p_to: string; p_only_valid?: boolean };
        Returns: { payment_method: string; orders_count: number; revenue: number }[];
      };
      analytics_customer_mix: {
        Args: { p_shop_ids: string[]; p_from: string; p_to: string; p_only_valid?: boolean };
        Returns: { segment: string; orders_count: number; revenue: number }[];
      };
      analytics_shop_totals: {
        Args: { p_shop_ids: string[]; p_from: string; p_to: string; p_only_valid?: boolean };
        Returns: {
          shop_id: string;
          shop_name: string;
          currency_code: string;
          orders_count: number;
          revenue: number;
          new_registrations: number;
        }[];
      };
    };
    Enums: {
      user_role: UserRole;
      ps_version: PsVersion;
      sync_status: SyncStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type Profile = Tables<'profiles'>;
export type Shop = Tables<'shops'>;
export type ShopAssignment = Tables<'shop_assignments'>;
export type SyncRun = Tables<'sync_runs'>;
export type MetricKey = Tables<'metric_keys'>;
