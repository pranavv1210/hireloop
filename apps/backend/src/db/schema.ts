export const schemaSql = `
CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE,
  email TEXT UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  career_goals TEXT,
  job_hunt_reason TEXT,
  strengths TEXT,
  salary_flexibility TEXT,
  notice_period TEXT,
  additional_context TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS resumes (
  id TEXT PRIMARY KEY,
  user_profile_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  is_selected INTEGER NOT NULL DEFAULT 0 CHECK (is_selected IN (0, 1)),
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS job_postings (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_job_id TEXT,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT,
  salary_text TEXT,
  posting_url TEXT,
  description TEXT,
  role_category TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source, source_job_id)
);

CREATE TABLE IF NOT EXISTS match_scores (
  id TEXT PRIMARY KEY,
  job_posting_id TEXT NOT NULL,
  user_profile_id TEXT NOT NULL,
  score REAL NOT NULL CHECK (score >= 0 AND score <= 100),
  rationale TEXT,
  model_name TEXT,
  scored_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_posting_id) REFERENCES job_postings(id) ON DELETE CASCADE,
  FOREIGN KEY (user_profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  user_profile_id TEXT NOT NULL,
  job_posting_id TEXT NOT NULL,
  resume_id TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted', 'skipped', 'failed')),
  outcome_status TEXT,
  outcome_detected_at TEXT,
  outcome_source_message_id TEXT,
  submitted_at TEXT,
  skipped_at TEXT,
  skip_reason TEXT,
  answers_json TEXT NOT NULL DEFAULT '[]',
  external_application_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (job_posting_id) REFERENCES job_postings(id) ON DELETE CASCADE,
  FOREIGN KEY (resume_id) REFERENCES resumes(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS answer_memory (
  id TEXT PRIMARY KEY,
  user_profile_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  source_application_id TEXT,
  embedding_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (source_application_id) REFERENCES applications(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  user_profile_id TEXT NOT NULL,
  resume_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  source_scope TEXT NOT NULL DEFAULT 'linkedin',
  started_at TEXT,
  completed_at TEXT,
  error_message TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (resume_id) REFERENCES resumes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_resumes_user_profile_id ON resumes(user_profile_id);
CREATE INDEX IF NOT EXISTS idx_job_postings_source ON job_postings(source);
CREATE INDEX IF NOT EXISTS idx_match_scores_job_posting_id ON match_scores(job_posting_id);
CREATE INDEX IF NOT EXISTS idx_applications_user_status ON applications(user_profile_id, status);
CREATE INDEX IF NOT EXISTS idx_answer_memory_user_profile_id ON answer_memory(user_profile_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_user_status ON agent_runs(user_profile_id, status);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_profile_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions(token_hash);

CREATE TABLE IF NOT EXISTS linkedin_credentials (
  user_profile_id TEXT PRIMARY KEY,
  encrypted_email_json TEXT NOT NULL,
  encrypted_password_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS linkedin_run_events (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_linkedin_run_events_agent_run_id ON linkedin_run_events(agent_run_id);

CREATE TABLE IF NOT EXISTS company_research (
  id TEXT PRIMARY KEY,
  company TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  source_url TEXT,
  researched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS google_email_connections (
  user_profile_id TEXT PRIMARY KEY,
  encrypted_refresh_token_json TEXT NOT NULL,
  gmail_email TEXT,
  history_id TEXT,
  connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_sync_at TEXT,
  FOREIGN KEY (user_profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS email_events (
  id TEXT PRIMARY KEY,
  user_profile_id TEXT NOT NULL,
  application_id TEXT,
  gmail_message_id TEXT NOT NULL,
  thread_id TEXT,
  from_email TEXT,
  subject TEXT,
  snippet TEXT,
  detected_status TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  received_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL,
  UNIQUE (user_profile_id, gmail_message_id)
);

CREATE INDEX IF NOT EXISTS idx_email_events_user_profile_id ON email_events(user_profile_id);
CREATE INDEX IF NOT EXISTS idx_email_events_application_id ON email_events(application_id);
`;
