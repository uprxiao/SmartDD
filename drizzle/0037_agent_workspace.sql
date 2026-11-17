-- @smartdd-foreign-key-rebuild
-- M14 统一 Agent 工作区（技术方案 T1.5 §2）。新任务在同一事务写 tasks 与 agent_tasks；旧 tasks 行不回填。
CREATE TABLE IF NOT EXISTS agent_tasks (
 task_id TEXT PRIMARY KEY NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
 parent_task_id TEXT REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
 selection_json TEXT NOT NULL,
 selection_revision INTEGER NOT NULL DEFAULT 1 CHECK(selection_revision>=1),
 mode TEXT NOT NULL DEFAULT 'single' CHECK(mode IN ('single','multi')),
 draft_json TEXT NOT NULL DEFAULT '{}',
 draft_revision INTEGER NOT NULL DEFAULT 0 CHECK(draft_revision>=0),
 archived_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_tasks_parent_idx ON agent_tasks(parent_task_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_bindings (
 binding_id TEXT PRIMARY KEY NOT NULL,
 task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
 driver_id TEXT NOT NULL CHECK(length(driver_id) BETWEEN 1 AND 64),
 profile_id TEXT NOT NULL,
 continuation_hash TEXT NOT NULL CHECK(length(continuation_hash)=64),
 state_root TEXT NOT NULL,
 cwd_identity TEXT NOT NULL,
 native_id TEXT,
 native_confirmed_at TEXT,
 created_at TEXT NOT NULL,
 CHECK(native_confirmed_at IS NULL OR native_id IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_bindings_task_idx ON agent_bindings(task_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS agent_bindings_native_key ON agent_bindings(driver_id,continuation_hash,state_root,native_id) WHERE native_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_capability_sessions (
 capability_session_id TEXT PRIMARY KEY NOT NULL,
 binding_id TEXT NOT NULL REFERENCES agent_bindings(binding_id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL CHECK(revision>=1),
 content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
 snapshot_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(binding_id,revision)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_driver_probes (
 probe_id TEXT PRIMARY KEY NOT NULL,
 driver_id TEXT NOT NULL,
 binary_path TEXT NOT NULL,
 realpath TEXT,
 version TEXT,
 capabilities_json TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('ready','limited','unsupported','missing','failed')),
 reason TEXT,
 probed_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_driver_probes_driver_idx ON agent_driver_probes(driver_id,probed_at);
--> statement-breakpoint
-- capability_runs：task_id 不再只指向旧单任务快照。旧行原值保留；新行必须带完整的绑定关系（触发器核验）。
-- @smartdd-rebuild-if-foreign-key capability_runs task_id
CREATE TABLE capability_runs_agent_next (
  run_id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  runner TEXT NOT NULL,
  pid INTEGER,
  process_started_at TEXT,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  error_code TEXT,
  snapshot_hash TEXT,
  owner_instance_id TEXT,
  owner_pid INTEGER,
  owner_started_at TEXT,
  bindings_json TEXT NOT NULL DEFAULT '[]',
  pty_id TEXT,
  revocation_state TEXT NOT NULL DEFAULT 'open',
  binding_mode TEXT NOT NULL DEFAULT 'current' CHECK(binding_mode IN ('current','run')),
  binding_id TEXT REFERENCES agent_bindings(binding_id) ON DELETE RESTRICT,
  capability_session_id TEXT REFERENCES agent_capability_sessions(capability_session_id) ON DELETE RESTRICT,
  generation INTEGER CHECK(generation IS NULL OR generation>=1),
  driver_id TEXT,
  launch_plan_hash TEXT,
  CHECK((binding_id IS NULL AND generation IS NULL AND driver_id IS NULL) OR (binding_id IS NOT NULL AND generation IS NOT NULL AND driver_id IS NOT NULL))
);
INSERT INTO capability_runs_agent_next(run_id,task_id,project_id,runner,pid,process_started_at,state,started_at,ended_at,error_code,snapshot_hash,owner_instance_id,owner_pid,owner_started_at,bindings_json,pty_id,revocation_state,binding_mode)
SELECT run_id,task_id,project_id,runner,pid,process_started_at,state,started_at,ended_at,error_code,snapshot_hash,owner_instance_id,owner_pid,owner_started_at,bindings_json,pty_id,revocation_state,binding_mode FROM capability_runs;
DROP TABLE capability_runs;
ALTER TABLE capability_runs_agent_next RENAME TO capability_runs;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS capability_runs_binding_generation ON capability_runs(binding_id,generation) WHERE binding_id IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS capability_runs_owner_insert BEFORE INSERT ON capability_runs
BEGIN
 SELECT RAISE(ABORT,'capability_runs: 旧运行须有单任务快照')
  WHERE NEW.binding_id IS NULL AND NOT EXISTS(SELECT 1 FROM capability_session_snapshots s WHERE s.task_id=NEW.task_id);
 SELECT RAISE(ABORT,'capability_runs: 新运行的任务与绑定不一致')
  WHERE NEW.binding_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM agent_bindings b WHERE b.binding_id=NEW.binding_id AND b.task_id=NEW.task_id AND b.driver_id=NEW.driver_id);
 SELECT RAISE(ABORT,'capability_runs: 能力会话不属于该绑定')
  WHERE NEW.capability_session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM agent_capability_sessions c WHERE c.capability_session_id=NEW.capability_session_id AND c.binding_id=NEW.binding_id);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS capability_runs_owner_update BEFORE UPDATE OF task_id,binding_id,capability_session_id,driver_id,generation ON capability_runs
BEGIN
 SELECT RAISE(ABORT,'capability_runs: 运行归属不可修改');
END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_turns (
 turn_id TEXT PRIMARY KEY NOT NULL,
 task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
 run_id TEXT REFERENCES capability_runs(run_id) ON DELETE RESTRICT,
 client_input_id TEXT NOT NULL,
 input_ref TEXT NOT NULL,
 source_kind TEXT NOT NULL CHECK(source_kind IN ('user','delegation','notification','system')),
 status TEXT NOT NULL CHECK(status IN ('accepted','dispatching','started','completed','failed','interrupted','unknown','canceled')),
 native_turn_id TEXT,
 accepted_at TEXT NOT NULL,
 started_at TEXT,
 ended_at TEXT,
 error_code TEXT,
 UNIQUE(task_id,client_input_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_turns_run_idx ON agent_turns(run_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_items (
 item_id TEXT PRIMARY KEY NOT NULL,
 task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
 turn_id TEXT REFERENCES agent_turns(turn_id) ON DELETE RESTRICT,
 run_id TEXT REFERENCES capability_runs(run_id) ON DELETE RESTRICT,
 node_id TEXT,
 type TEXT NOT NULL,
 ordinal INTEGER NOT NULL CHECK(ordinal>=1),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 native_key TEXT,
 payload_ref TEXT NOT NULL,
 terminal_state TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(task_id,ordinal),
 UNIQUE(task_id,native_key)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_events (
 task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
 seq INTEGER NOT NULL CHECK(seq>=1),
 event_type TEXT NOT NULL,
 item_id TEXT REFERENCES agent_items(item_id) ON DELETE RESTRICT,
 revision INTEGER,
 payload TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(task_id,seq)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_requests (
 request_id TEXT PRIMARY KEY NOT NULL,
 task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
 class TEXT NOT NULL CHECK(class IN ('native','host_business')),
 origin_json TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 kind TEXT NOT NULL,
 payload_ref TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','approved_pending_bind','resolved','retired')),
 decision_ref TEXT,
 operation_id TEXT,
 review_hash TEXT,
 account_identity TEXT,
 bound_run_id TEXT REFERENCES capability_runs(run_id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK(class='host_business' OR (operation_id IS NULL AND review_hash IS NULL AND bound_run_id IS NULL AND status<>'approved_pending_bind'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_requests_task_status_idx ON agent_requests(task_id,status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_transfers (
 transfer_id TEXT PRIMARY KEY NOT NULL,
 task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
 target_binding_id TEXT NOT NULL REFERENCES agent_bindings(binding_id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK(kind IN ('full','incremental')),
 through_seq INTEGER NOT NULL CHECK(through_seq>=0),
 covered_ids_json TEXT NOT NULL,
 omissions_json TEXT NOT NULL DEFAULT '[]',
 payload_hash TEXT NOT NULL,
 delivery_state TEXT NOT NULL CHECK(delivery_state IN ('pending','accepted','unsent','unknown')),
 created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_delegations (
 delegation_id TEXT PRIMARY KEY NOT NULL,
 parent_task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
 child_task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
 parent_run_id TEXT REFERENCES capability_runs(run_id) ON DELETE RESTRICT,
 target_json TEXT NOT NULL,
 access TEXT NOT NULL CHECK(access IN ('read','write')),
 request_key TEXT NOT NULL,
 result_revision INTEGER NOT NULL DEFAULT 0 CHECK(result_revision>=0),
 delivery_state TEXT NOT NULL CHECK(delivery_state IN ('queued','running','delivered','queued_for_parent','canceled','failed')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(parent_task_id,request_key),
 CHECK(parent_task_id<>child_task_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_delegation_attempts (
 attempt_id TEXT PRIMARY KEY NOT NULL,
 delegation_id TEXT NOT NULL REFERENCES agent_delegations(delegation_id) ON DELETE RESTRICT,
 ordinal INTEGER NOT NULL CHECK(ordinal>=1),
 kind TEXT NOT NULL CHECK(kind IN ('initial','rework')),
 input_ref TEXT NOT NULL,
 child_turn_id TEXT REFERENCES agent_turns(turn_id) ON DELETE RESTRICT,
 commit_range TEXT,
 notified_at TEXT,
 merge_check_json TEXT,
 created_at TEXT NOT NULL,
 UNIQUE(delegation_id,ordinal)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_directory_queue (
 queue_id TEXT PRIMARY KEY NOT NULL,
 directory_identity TEXT NOT NULL,
 task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
 run_id TEXT REFERENCES capability_runs(run_id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK(kind IN ('read','write')),
 state TEXT NOT NULL CHECK(state IN ('queued','active','released','canceled')),
 accepted_order INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 ended_at TEXT,
 UNIQUE(directory_identity,accepted_order)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_workspaces (
 workspace_id TEXT PRIMARY KEY NOT NULL,
 task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
 child_task_id TEXT REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK(kind IN ('main','git_worktree')),
 repo_root TEXT NOT NULL,
 path TEXT NOT NULL,
 branch TEXT,
 base_commit TEXT,
 auto_commit TEXT,
 state TEXT NOT NULL CHECK(state IN ('preparing','ready','failed','archived')),
 deps_result TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(path)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_intents (
 intent_id TEXT PRIMARY KEY NOT NULL,
 task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
 action TEXT NOT NULL CHECK(action IN ('auto_commit','worktree_add','child_result_commit','completion_notice','goal_pause','goal_resume')),
 target_ref TEXT,
 expected_parent TEXT,
 head_before TEXT,
 state TEXT NOT NULL CHECK(state IN ('intended','done','needs_review','abandoned')),
 result_json TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_commit_provenance (
 commit_sha TEXT PRIMARY KEY NOT NULL CHECK(length(commit_sha) BETWEEN 40 AND 64),
 workspace_id TEXT NOT NULL REFERENCES agent_workspaces(workspace_id) ON DELETE RESTRICT,
 attempt_id TEXT REFERENCES agent_delegation_attempts(attempt_id) ON DELETE RESTRICT,
 intent_id TEXT NOT NULL REFERENCES agent_intents(intent_id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK(kind IN ('auto_before_delegate','child_result')),
 message TEXT NOT NULL,
 created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_goals (
 task_id TEXT PRIMARY KEY NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
 binding_id TEXT NOT NULL REFERENCES agent_bindings(binding_id) ON DELETE RESTRICT,
 objective TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 status TEXT NOT NULL CHECK(status IN ('active','paused','complete','cleared')),
 paused_reason TEXT CHECK(paused_reason IS NULL OR paused_reason IN ('user','waiting_children','limit')),
 turns INTEGER NOT NULL DEFAULT 0,
 time_used_s INTEGER NOT NULL DEFAULT 0,
 native_updated_at TEXT,
 updated_at TEXT NOT NULL,
 CHECK(status='paused' OR paused_reason IS NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_turn_changes (
 turn_id TEXT PRIMARY KEY NOT NULL REFERENCES agent_turns(turn_id) ON DELETE RESTRICT,
 task_id TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE RESTRICT,
 run_id TEXT REFERENCES capability_runs(run_id) ON DELETE RESTRICT,
 before_ref TEXT,
 after_ref TEXT,
 changed_files_json TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL CHECK(status IN ('capturing','complete','incomplete','none')),
 incomplete_reason TEXT,
 retained_until TEXT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS agent_resource_refs (
 owner_kind TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 resource_kind TEXT NOT NULL,
 resource_id TEXT NOT NULL,
 hold_reason TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(owner_kind,owner_id,resource_kind,resource_id)
);
