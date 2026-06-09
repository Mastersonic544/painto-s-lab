// Painto's Lab — Supabase schema types.
// Hand-written to mirror supabase/migrations/. Regenerate later with
// `supabase gen types typescript --linked > src/types/db.ts` once the
// project is linked. Shape matches what supabase-js expects so the
// generic param on createClient<Database>() lights up everywhere.

export type UserRole = 'operator';
export type PieceStatus = 'queued' | 'ready' | 'approved' | 'archived' | 'error';
export type PieceMode = 'auto' | 'manual';
export type PieceComplexity = 'simple' | 'normal' | 'complex';
export type CartStatus = 'open' | 'checked_out';
export type MixTaskStatus = 'todo' | 'done';

export interface PaletteEntry {
  index: number;
  color: string; // "#rrggbb"
  areaPercentage: number; // 0..1
  frequency: number;
  label?: string;
}

export type PaletteJson = PaletteEntry[];

export interface RecipeStep {
  base_paint_id: string;
  parts?: number;
  ml?: number;
}
export type RecipeJson = RecipeStep[];

type Json =
  | string
  | number
  | boolean
  | null
  | { [k: string]: Json | undefined }
  | Json[];

type Timestamp = string;
type UUID = string;

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: UUID;
          display_name: string | null;
          role: UserRole;
          created_at: Timestamp;
        };
        Insert: {
          id: UUID;
          display_name?: string | null;
          role?: UserRole;
          created_at?: Timestamp;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
        Relationships: [];
      };
      source_images: {
        Row: {
          id: UUID;
          storage_path: string;
          original_filename: string;
          uploaded_by: UUID;
          created_at: Timestamp;
        };
        Insert: {
          id?: UUID;
          storage_path: string;
          original_filename: string;
          uploaded_by: UUID;
          created_at?: Timestamp;
        };
        Update: Partial<Database['public']['Tables']['source_images']['Insert']>;
        Relationships: [];
      };
      pieces: {
        Row: {
          id: UUID;
          source_image_id: UUID;
          title: string;
          status: PieceStatus;
          mode: PieceMode;
          complexity: PieceComplexity;
          color_count: number;
          canvas_width_cm: number;
          canvas_height_cm: number;
          coats: number;
          preview_svg_path: string | null;
          outline_svg_path: string | null;
          palette_json: PaletteJson | null;
          created_at: Timestamp;
          approved_at: Timestamp | null;
          error_message: string | null;
        };
        Insert: {
          id?: UUID;
          source_image_id: UUID;
          title: string;
          status?: PieceStatus;
          mode?: PieceMode;
          complexity?: PieceComplexity;
          color_count: number;
          canvas_width_cm?: number;
          canvas_height_cm?: number;
          coats?: number;
          preview_svg_path?: string | null;
          outline_svg_path?: string | null;
          palette_json?: PaletteJson | null;
          created_at?: Timestamp;
          approved_at?: Timestamp | null;
          error_message?: string | null;
        };
        Update: Partial<Database['public']['Tables']['pieces']['Insert']>;
        Relationships: [];
      };
      piece_colors: {
        Row: {
          id: UUID;
          piece_id: UUID;
          color_index: number;
          label: string | null;
          rgb_hex: string;
          area_percentage: number;
          estimated_volume_ml: number;
        };
        Insert: {
          id?: UUID;
          piece_id: UUID;
          color_index: number;
          label?: string | null;
          rgb_hex: string;
          area_percentage: number;
          estimated_volume_ml: number;
        };
        Update: Partial<Database['public']['Tables']['piece_colors']['Insert']>;
        Relationships: [];
      };
      base_paints: {
        Row: {
          id: UUID;
          name: string;
          rgb_hex: string;
          container_capacity_ml: number;
          current_level_ml: number;
          reorder_threshold_ml: number;
          created_at: Timestamp;
        };
        Insert: {
          id?: UUID;
          name: string;
          rgb_hex: string;
          container_capacity_ml: number;
          current_level_ml?: number;
          reorder_threshold_ml?: number;
          created_at?: Timestamp;
        };
        Update: Partial<Database['public']['Tables']['base_paints']['Insert']>;
        Relationships: [];
      };
      color_recipes: {
        Row: {
          id: UUID;
          target_rgb_hex: string;
          recipe_json: RecipeJson;
          is_verified: boolean;
          notes: string | null;
          updated_at: Timestamp;
        };
        Insert: {
          id?: UUID;
          target_rgb_hex: string;
          recipe_json: RecipeJson;
          is_verified?: boolean;
          notes?: string | null;
          updated_at?: Timestamp;
        };
        Update: Partial<Database['public']['Tables']['color_recipes']['Insert']>;
        Relationships: [];
      };
      carts: {
        Row: {
          id: UUID;
          name: string;
          status: CartStatus;
          created_at: Timestamp;
          checked_out_at: Timestamp | null;
        };
        Insert: {
          id?: UUID;
          name: string;
          status?: CartStatus;
          created_at?: Timestamp;
          checked_out_at?: Timestamp | null;
        };
        Update: Partial<Database['public']['Tables']['carts']['Insert']>;
        Relationships: [];
      };
      cart_items: {
        Row: {
          id: UUID;
          cart_id: UUID;
          piece_id: UUID;
          quantity: number;
        };
        Insert: {
          id?: UUID;
          cart_id: UUID;
          piece_id: UUID;
          quantity?: number;
        };
        Update: Partial<Database['public']['Tables']['cart_items']['Insert']>;
        Relationships: [];
      };
      mix_tasks: {
        Row: {
          id: UUID;
          cart_id: UUID;
          target_rgb_hex: string;
          target_volume_ml: number;
          recipe_id: UUID | null;
          status: MixTaskStatus;
          created_at: Timestamp;
          completed_at: Timestamp | null;
        };
        Insert: {
          id?: UUID;
          cart_id: UUID;
          target_rgb_hex: string;
          target_volume_ml: number;
          recipe_id?: UUID | null;
          status?: MixTaskStatus;
          created_at?: Timestamp;
          completed_at?: Timestamp | null;
        };
        Update: Partial<Database['public']['Tables']['mix_tasks']['Insert']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_operator: { Args: Record<string, never>; Returns: boolean };
    };
    Enums: {
      user_role: UserRole;
      piece_status: PieceStatus;
      piece_mode: PieceMode;
      piece_complexity: PieceComplexity;
      cart_status: CartStatus;
      mix_task_status: MixTaskStatus;
    };
  };
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];

export type { Json };
