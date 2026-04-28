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
