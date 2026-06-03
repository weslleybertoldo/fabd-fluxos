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
  is_discoverable: boolean;
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
  google_email: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MemberDirectoryAccessRow = {
  workspace_member_id: string;
  directory_id: string;
  granted_at: string;
  granted_by: string;
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
  show_reports: boolean;
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
  note: string | null;
  reminder_recurrence: ReminderRecurrence | null;
  reminder_at: string | null;
  reminder_notified_at: string | null;
  reminder_last_on: string | null;
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
  phase_id: string | null;
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

export type ReminderRecurrence = "once" | "daily";

export type ReminderRow = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  due_date: string | null;
  completed_at: string | null;
  recurrence: ReminderRecurrence;
  notified_at: string | null;
  last_notified_on: string | null;
  order_index: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ChecklistKind = "flow" | "simple";

export type ChecklistRow = {
  id: string;
  project_id: string;
  name: string;
  kind: ChecklistKind;
  order_index: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ChecklistSectionRow = {
  id: string;
  checklist_id: string;
  title: string;
  description: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
};

export type ChecklistItemRow = {
  id: string;
  section_id: string;
  text: string;
  completed_at: string | null;
  note: string | null;
  reminder_recurrence: ReminderRecurrence | null;
  reminder_at: string | null;
  reminder_notified_at: string | null;
  reminder_last_on: string | null;
  order_index: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type NotificationType =
  | "phase_due_soon"
  | "phase_overdue"
  | "flow_completed"
  | "mention"
  | "member_request"
  | "member_approved"
  | "responsible_assigned";

export type NotificationRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  entity: EntityType | null;
  entity_id: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export type PhaseResponsibleRow = {
  phase_id: string;
  user_id: string;
  assigned_by: string;
  assigned_at: string;
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
