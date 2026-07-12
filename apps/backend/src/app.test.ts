import { describe, expect, it } from 'vitest';
import { schemaSql } from './db/schema.js';

describe('database schema', () => {
  it('defines all Phase 0 tables', () => {
    for (const table of [
      'user_profiles',
      'resumes',
      'job_postings',
      'match_scores',
      'applications',
      'answer_memory',
      'agent_runs',
      'auth_sessions',
      'linkedin_credentials',
      'linkedin_run_events',
      'company_research',
    ]) {
      expect(schemaSql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });
});
