CREATE TABLE IF NOT EXISTS capability_builtin_package_sources (
  package_hash TEXT NOT NULL REFERENCES capability_packages(package_hash) ON DELETE RESTRICT,
  source_index_hash TEXT NOT NULL,
  source_index_json TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  PRIMARY KEY(package_hash,source_index_hash)
);
