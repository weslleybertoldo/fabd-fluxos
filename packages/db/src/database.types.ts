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
          changes: Json | null
          context: Json | null
          created_at: string
          entity: Database["public"]["Enums"]["entity_type"]
          entity_id: string
          id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          action: string
          changes?: Json | null
          context?: Json | null
          created_at?: string
          entity: Database["public"]["Enums"]["entity_type"]
          entity_id: string
          id?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          action?: string
          changes?: Json | null
          context?: Json | null
          created_at?: string
          entity?: Database["public"]["Enums"]["entity_type"]
          entity_id?: string
          id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      directories: {
        Row: {
          color: string | null
          created_at: string
          created_by: string
          description: string | null
          icon: string | null
          id: string
          name: string
          order_index: number
          responsible_user_id: string | null
          slug: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          icon?: string | null
          id?: string
          name: string
          order_index?: number
          responsible_user_id?: string | null
          slug: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          icon?: string | null
          id?: string
          name?: string
          order_index?: number
          responsible_user_id?: string | null
          slug?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "directories_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_comments: {
        Row: {
          author_id: string
          content: string
          context_phase_id: string | null
          created_at: string
          deleted_at: string | null
          flow_id: string
          id: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          author_id: string
          content: string
          context_phase_id?: string | null
          created_at?: string
          deleted_at?: string | null
          flow_id: string
          id?: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          author_id?: string
          content?: string
          context_phase_id?: string | null
          created_at?: string
          deleted_at?: string | null
          flow_id?: string
          id?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_comments_context_phase_id_fkey"
            columns: ["context_phase_id"]
            isOneToOne: false
            referencedRelation: "phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_comments_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "flow_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_tags: {
        Row: {
          added_at: string
          added_by: string
          flow_id: string
          tag_id: string
        }
        Insert: {
          added_at?: string
          added_by: string
          flow_id: string
          tag_id: string
        }
        Update: {
          added_at?: string
          added_by?: string
          flow_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_tags_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      flows: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          name: string
          order_index: number
          project_id: string
          status: Database["public"]["Enums"]["flow_status"]
          type: Database["public"]["Enums"]["flow_type"]
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          name: string
          order_index?: number
          project_id: string
          status?: Database["public"]["Enums"]["flow_status"]
          type?: Database["public"]["Enums"]["flow_type"]
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          name?: string
          order_index?: number
          project_id?: string
          status?: Database["public"]["Enums"]["flow_status"]
          type?: Database["public"]["Enums"]["flow_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flows_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          entity: Database["public"]["Enums"]["entity_type"] | null
          entity_id: string | null
          id: string
          link: string | null
          read_at: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          entity?: Database["public"]["Enums"]["entity_type"] | null
          entity_id?: string | null
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
          workspace_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          entity?: Database["public"]["Enums"]["entity_type"] | null
          entity_id?: string | null
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      phase_attachments: {
        Row: {
          created_at: string
          deleted_at: string | null
          file_name: string
          file_size: number
          id: string
          mime_type: string
          phase_id: string
          storage_bucket: string
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          file_name: string
          file_size: number
          id?: string
          mime_type: string
          phase_id: string
          storage_bucket?: string
          storage_path: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          file_name?: string
          file_size?: number
          id?: string
          mime_type?: string
          phase_id?: string
          storage_bucket?: string
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "phase_attachments_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "phases"
            referencedColumns: ["id"]
          },
        ]
      }
      phase_field_values: {
        Row: {
          current_phase_id: string
          id: string
          phase_field_id: string
          updated_at: string
          updated_by: string
          value_bool: boolean | null
          value_date: string | null
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          current_phase_id: string
          id?: string
          phase_field_id: string
          updated_at?: string
          updated_by: string
          value_bool?: boolean | null
          value_date?: string | null
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          current_phase_id?: string
          id?: string
          phase_field_id?: string
          updated_at?: string
          updated_by?: string
          value_bool?: boolean | null
          value_date?: string | null
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "phase_field_values_current_phase_id_fkey"
            columns: ["current_phase_id"]
            isOneToOne: false
            referencedRelation: "phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phase_field_values_phase_field_id_fkey"
            columns: ["phase_field_id"]
            isOneToOne: false
            referencedRelation: "phase_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      phase_fields: {
        Row: {
          created_at: string
          created_by: string
          id: string
          label: string
          mode: Database["public"]["Enums"]["field_mode"]
          order_index: number
          phase_id: string
          required: boolean
          type: Database["public"]["Enums"]["field_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          label: string
          mode?: Database["public"]["Enums"]["field_mode"]
          order_index?: number
          phase_id: string
          required?: boolean
          type: Database["public"]["Enums"]["field_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          label?: string
          mode?: Database["public"]["Enums"]["field_mode"]
          order_index?: number
          phase_id?: string
          required?: boolean
          type?: Database["public"]["Enums"]["field_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phase_fields_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "phases"
            referencedColumns: ["id"]
          },
        ]
      }
      phase_responsibles: {
        Row: {
          assigned_at: string
          assigned_by: string
          phase_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          phase_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          phase_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "phase_responsibles_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "phases"
            referencedColumns: ["id"]
          },
        ]
      }
      phases: {
        Row: {
          color: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          flow_id: string
          id: string
          name: string
          order_index: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          flow_id: string
          id?: string
          name: string
          order_index?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          flow_id?: string
          id?: string
          name?: string
          order_index?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phases_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          directory_id: string
          id: string
          name: string
          order_index: number
          responsible_user_id: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          directory_id: string
          id?: string
          name: string
          order_index?: number
          responsible_user_id?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          directory_id?: string
          id?: string
          name?: string
          order_index?: number
          responsible_user_id?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_directory_id_fkey"
            columns: ["directory_id"]
            isOneToOne: false
            referencedRelation: "directories"
            referencedColumns: ["id"]
          },
        ]
      }
      reminders: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          id: string
          name: string
          order_index: number
          project_id: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          id?: string
          name: string
          order_index?: number
          project_id: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          id?: string
          name?: string
          order_index?: number
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      simple_list_items: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string
          id: string
          list_id: string
          order_index: number
          text: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          list_id: string
          order_index?: number
          text: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          list_id?: string
          order_index?: number
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "simple_list_items_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "simple_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      simple_lists: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          order_index: number
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          order_index?: number
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          order_index?: number
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "simple_lists_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string
          created_at: string
          created_by: string
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by: string
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          google_avatar_url: string | null
          google_full_name: string | null
          id: string
          role: Database["public"]["Enums"]["workspace_role"]
          status: Database["public"]["Enums"]["member_status"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          google_avatar_url?: string | null
          google_full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          google_avatar_url?: string | null
          google_full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          status?: Database["public"]["Enums"]["member_status"]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_edit_flow: { Args: { f_id: string; uid?: string }; Returns: boolean }
      can_edit_phase: {
        Args: { ph_id: string; uid?: string }
        Returns: boolean
      }
      is_workspace_admin: {
        Args: { uid?: string; ws_id: string }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { uid?: string; ws_id: string }
        Returns: boolean
      }
      log_audit: {
        Args: {
          p_action: string
          p_changes?: Json
          p_context?: Json
          p_entity: Database["public"]["Enums"]["entity_type"]
          p_entity_id: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      storage_workspace_from_path: { Args: { name: string }; Returns: string }
      workspace_of_directory: { Args: { d_id: string }; Returns: string }
      workspace_of_flow: { Args: { f_id: string }; Returns: string }
      workspace_of_phase: { Args: { ph_id: string }; Returns: string }
      workspace_of_project: { Args: { p_id: string }; Returns: string }
      workspace_role_of: {
        Args: { uid?: string; ws_id: string }
        Returns: Database["public"]["Enums"]["workspace_role"]
      }
    }
    Enums: {
      entity_type:
        | "workspace"
        | "directory"
        | "project"
        | "flow"
        | "phase"
        | "comment"
        | "attachment"
        | "field"
        | "field_value"
        | "tag"
        | "member"
        | "reminder"
        | "list_item"
      field_mode: "fixed" | "mobile"
      field_type: "text" | "textarea" | "checkbox" | "number" | "date"
      flow_status: "active" | "completed" | "archived"
      flow_type: "continuous" | "non_continuous"
      member_status: "pending" | "active" | "blocked"
      notification_type:
        | "phase_due_soon"
        | "phase_overdue"
        | "flow_completed"
        | "mention"
        | "member_request"
        | "member_approved"
        | "responsible_assigned"
      project_status: "active" | "archived" | "completed"
      workspace_role: "admin" | "diretor" | "membro"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      entity_type: [
        "workspace",
        "directory",
        "project",
        "flow",
        "phase",
        "comment",
        "attachment",
        "field",
        "field_value",
        "tag",
        "member",
        "reminder",
        "list_item",
      ],
      field_mode: ["fixed", "mobile"],
      field_type: ["text", "textarea", "checkbox", "number", "date"],
      flow_status: ["active", "completed", "archived"],
      flow_type: ["continuous", "non_continuous"],
      member_status: ["pending", "active", "blocked"],
      notification_type: [
        "phase_due_soon",
        "phase_overdue",
        "flow_completed",
        "mention",
        "member_request",
        "member_approved",
        "responsible_assigned",
      ],
      project_status: ["active", "archived", "completed"],
      workspace_role: ["admin", "diretor", "membro"],
    },
  },
} as const
