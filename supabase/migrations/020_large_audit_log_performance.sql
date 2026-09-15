-- AssetLens AI R22.1.4 — keep administration responsive after large imports.
-- Apply after migration 019. Safe to run more than once.

begin;

-- The administration screen reads the newest 100 entries without filtering
-- by project or actor. The older indexes start with project_id/actor_user_id
-- and cannot efficiently serve this ordering after a 50k-row import.
create index if not exists audit_logs_recent_idx
  on public.audit_logs(created_at desc, id desc);

-- Refresh planner statistics after large batch imports and index creation.
analyze public.audit_logs;

commit;

notify pgrst, 'reload schema';
