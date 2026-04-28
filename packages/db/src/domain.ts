// Tipos de dominio espelhando os enums do Postgres.
// Manter sincronizado com supabase/migrations/20260428000000_initial_schema.sql

export type WorkspaceRole = "admin" | "diretor" | "membro";
export type MemberStatus = "pending" | "active" | "blocked";
export type ProjectStatus = "active" | "archived" | "completed";
export type FlowType = "continuous" | "non_continuous";
export type FlowStatus = "active" | "completed" | "archived";
export type FieldType = "text" | "textarea" | "checkbox" | "number" | "date";
export type FieldMode = "fixed" | "mobile";
export type EntityType =
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
  | "list_item";
export type NotificationType =
  | "phase_due_soon"
  | "phase_overdue"
  | "flow_completed"
  | "mention"
  | "member_request"
  | "member_approved"
  | "responsible_assigned";
