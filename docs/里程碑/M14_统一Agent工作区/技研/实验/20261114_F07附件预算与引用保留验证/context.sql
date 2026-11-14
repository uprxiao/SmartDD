CREATE TABLE m14_context_object(
 content_hash TEXT PRIMARY KEY CHECK(length(content_hash)=64),byte_size INTEGER NOT NULL CHECK(byte_size>=0),mime_type TEXT NOT NULL,relative_path TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN('staged','ready','missing','invalid')));
CREATE TABLE m14_context_transfer(
 transfer_id TEXT PRIMARY KEY,input_id TEXT NOT NULL REFERENCES m14_submission(input_id),plan_json TEXT NOT NULL CHECK(json_valid(plan_json)),payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
 state TEXT NOT NULL CHECK(state IN('prepared','dispatching','unknown','accepted','not-sent')),evidence_json TEXT CHECK(evidence_json IS NULL OR json_valid(evidence_json)),
 CHECK(state<>'accepted' OR evidence_json IS NOT NULL));
CREATE TABLE m14_context_object_ref(
 transfer_id TEXT NOT NULL REFERENCES m14_context_transfer(transfer_id),content_hash TEXT NOT NULL REFERENCES m14_context_object(content_hash),PRIMARY KEY(transfer_id,content_hash));
