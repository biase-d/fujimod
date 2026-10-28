-- Read-only links are separate capabilities from upload and resume IDs.
CREATE TABLE publications (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  files TEXT NOT NULL
);
