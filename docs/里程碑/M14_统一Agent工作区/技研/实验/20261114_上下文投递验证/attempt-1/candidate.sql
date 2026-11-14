
CREATE TABLE IF NOT EXISTS binding(id TEXT PRIMARY KEY, task TEXT NOT NULL, native TEXT NOT NULL,
 config_revision INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, UNIQUE(task,native));
CREATE TABLE IF NOT EXISTS item(id TEXT PRIMARY KEY, task TEXT NOT NULL, seq INTEGER NOT NULL,
 origin TEXT NOT NULL CHECK(origin IN ('user','agent','tool','child')), body TEXT NOT NULL,
 hash TEXT NOT NULL, UNIQUE(task,seq));
CREATE TRIGGER IF NOT EXISTS immutable_item BEFORE UPDATE ON item BEGIN SELECT RAISE(ABORT,'immutable item'); END;
CREATE TABLE IF NOT EXISTS coverage(binding TEXT REFERENCES binding(id), item TEXT REFERENCES item(id),
 hash TEXT NOT NULL, method TEXT NOT NULL, PRIMARY KEY(binding,item));
CREATE TABLE IF NOT EXISTS transfer(id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL,
 request_hash TEXT NOT NULL, binding TEXT REFERENCES binding(id), config_revision INTEGER NOT NULL,
 native TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('prepared','sending','unknown','applied')),
 method TEXT NOT NULL CHECK(method IN ('inject','inline')), payload TEXT NOT NULL, payload_hash TEXT NOT NULL,
 generation INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS one_unresolved ON transfer(binding) WHERE state != 'applied';
