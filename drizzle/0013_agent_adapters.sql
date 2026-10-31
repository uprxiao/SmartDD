CREATE TABLE IF NOT EXISTS capability_agent_adapters (
  agent_id TEXT NOT NULL,
  version TEXT NOT NULL,
  adapter_hash TEXT NOT NULL UNIQUE,
  resource_id TEXT NOT NULL REFERENCES capability_resources(resource_id) ON DELETE RESTRICT,
  manifest_json TEXT NOT NULL,
  PRIMARY KEY(agent_id,version)
);
