-- ============================================================================
-- Phase Detail Modal: comentarios podem ser do FLUXO (phase_id NULL) ou de
-- uma FASE especifica (phase_id setado).
-- ============================================================================

alter table flow_comments
  add column if not exists phase_id uuid references phases(id) on delete cascade;

create index if not exists idx_fcom_phase on flow_comments(phase_id)
  where phase_id is not null;

-- nada a mudar nas policies — flow_comments ja usa workspace_of_flow(flow_id)
-- como gate, e qualquer fase sempre pertence ao mesmo flow do comentario.
