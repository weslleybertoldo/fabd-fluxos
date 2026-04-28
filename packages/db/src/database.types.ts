// Tipos gerados manualmente no scaffold inicial.
// Para regenerar a partir do schema real, rodar (com supabase CLI logado):
//   pnpm -w db:gen-types
//
// Ate la, exportamos tipos minimos suficientes pra TS compilar e oferecer
// autocomplete basico. As tabelas estao representadas como `unknown` rows
// pra forcar narrowing manual onde for necessario na primeira versao.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      [K in
        | "workspaces"
        | "workspace_members"
        | "directories"
        | "projects"
        | "flows"
        | "phases"
        | "phase_responsibles"
        | "phase_fields"
        | "phase_field_values"
        | "flow_comments"
        | "phase_attachments"
        | "tags"
        | "flow_tags"
        | "audit_log"
        | "notifications"
        | "reminders"
        | "simple_lists"
        | "simple_list_items"]: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      log_audit: {
        Args: {
          p_workspace_id: string;
          p_entity: string;
          p_entity_id: string;
          p_action: string;
          p_changes?: Json;
          p_context?: Json;
        };
        Returns: void;
      };
    };
    Enums: {
      workspace_role: "admin" | "diretor" | "membro";
      member_status: "pending" | "active" | "blocked";
      project_status: "active" | "archived" | "completed";
      flow_type: "continuous" | "non_continuous";
      flow_status: "active" | "completed" | "archived";
      field_type: "text" | "textarea" | "checkbox" | "number" | "date";
      field_mode: "fixed" | "mobile";
    };
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];
