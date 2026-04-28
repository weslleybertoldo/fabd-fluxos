import type {
  WorkspaceRole,
  MemberStatus,
  ProjectStatus,
  FlowType,
  FlowStatus,
  EntityType,
} from "@fabd-fluxos/db";

export type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type WorkspaceMemberRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  status: MemberStatus;
  google_full_name: string | null;
  google_avatar_url: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DirectoryRow = {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  image_url: string | null;
  order_index: number;
  responsible_user_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ProjectRow = {
  id: string;
  directory_id: string;
  name: string;
  description: string | null;
  responsible_user_id: string | null;
  status: ProjectStatus;
  order_index: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  completed_at: string | null;
};

export type FlowRow = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  type: FlowType;
  status: FlowStatus;
  order_index: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type PhaseRow = {
  id: string;
  flow_id: string;
  name: string;
  description: string | null;
  order_index: number;
  due_date: string | null;
  completed_at: string | null;
  color: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type FlowCommentRow = {
  id: string;
  flow_id: string;
  author_id: string;
  content: string;
  context_phase_id: string | null;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type PhaseAttachmentRow = {
  id: string;
  phase_id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  storage_path: string;
  storage_bucket: string;
  uploaded_by: string;
  created_at: string;
  deleted_at: string | null;
};

export type TagRow = {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  created_by: string;
  created_at: string;
};

export type FlowTagRow = {
  flow_id: string;
  tag_id: string;
  added_by: string;
  added_at: string;
};

export type FieldType = "text" | "textarea" | "checkbox" | "number" | "date";
export type FieldMode = "fixed" | "mobile";

export type PhaseFieldRow = {
  id: string;
  phase_id: string;
  type: FieldType;
  label: string;
  mode: FieldMode;
  order_index: number;
  required: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type PhaseFieldValueRow = {
  id: string;
  phase_field_id: string;
  current_phase_id: string;
  value_text: string | null;
  value_bool: boolean | null;
  value_number: number | null;
  value_date: string | null;
  updated_by: string;
  updated_at: string;
};

export type ReminderRow = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  due_date: string | null;
  completed_at: string | null;
  order_index: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type SimpleListRow = {
  id: string;
  project_id: string;
  name: string;
  order_index: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type SimpleListItemRow = {
  id: string;
  list_id: string;
  text: string;
  completed_at: string | null;
  order_index: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type AuditLogRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  entity: EntityType;
  entity_id: string;
  action: string;
  changes: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  created_at: string;
};

export type WorkspaceContext = {
  workspace: WorkspaceRow;
  member: WorkspaceMemberRow;
};
