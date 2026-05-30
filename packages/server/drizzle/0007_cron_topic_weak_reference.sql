PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS cron_jobs_next (
  id TEXT PRIMARY KEY,
  origin_topic_id TEXT,
  pi_cron_id TEXT NOT NULL,
  cron_expr TEXT NOT NULL,
  prompt TEXT NOT NULL,
  tags_json TEXT,
  status TEXT NOT NULL,
  next_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO cron_jobs_next (
  id,
  origin_topic_id,
  pi_cron_id,
  cron_expr,
  prompt,
  tags_json,
  status,
  next_run_at,
  created_at,
  updated_at
)
SELECT
  id,
  origin_topic_id,
  pi_cron_id,
  cron_expr,
  prompt,
  tags_json,
  status,
  next_run_at,
  created_at,
  updated_at
FROM cron_jobs;

DROP TABLE cron_jobs;
ALTER TABLE cron_jobs_next RENAME TO cron_jobs;

PRAGMA foreign_keys=ON;
