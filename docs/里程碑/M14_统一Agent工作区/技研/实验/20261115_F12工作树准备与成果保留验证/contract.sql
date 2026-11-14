CREATE TABLE m14_worktree_intent(
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES m14_task_state(task_id),
 proposed_binding TEXT NOT NULL, expected_selection INTEGER NOT NULL,
 repo TEXT NOT NULL, common_identity TEXT NOT NULL, parent_identity TEXT NOT NULL,
 base_commit TEXT NOT NULL, branch TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
 phase TEXT NOT NULL CHECK(phase IN('reserved','executing','ready','bound','retained','removed')),
 observation_json TEXT, git_exit INTEGER, reason TEXT,
 FOREIGN KEY(proposed_binding,task_id) REFERENCES m14_binding(binding_id,task_id));
CREATE TABLE m14_worktree_binding(
 binding_id TEXT PRIMARY KEY, task_id TEXT NOT NULL,
 intent_id TEXT NOT NULL REFERENCES m14_worktree_intent(id),
 FOREIGN KEY(binding_id,task_id) REFERENCES m14_binding(binding_id,task_id));
