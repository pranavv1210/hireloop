import cors from 'cors';
import express from 'express';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { getDatabase } from './db/database.js';
import { logger } from './logger.js';
import { createApiRouter } from './routes.js';

const tables = [
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
] as const;

export function createApp() {
  const app = express();
  const db = getDatabase();

  app.use(pinoHttp({ logger }));
  app.use(cors({ origin: config.frontendOrigin, credentials: true }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    const result = db.prepare('SELECT 1 AS ok').get() as { ok: number };
    res.json({
      ok: result.ok === 1,
      service: 'hireloop-backend',
      database: 'connected',
    });
  });

  app.get('/api/schema-summary', (_req, res) => {
    const counts = tables.map((table) => {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
      return { table, count: row.count };
    });

    res.json({ tables: counts });
  });

  app.use('/api', createApiRouter(db));

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      void _next;
      const status =
        err.name === 'MulterError' || err.message === 'Only PDF resumes are allowed' ? 400 : 500;
      logger.error({ err }, 'Unhandled request error');
      res.status(status).json({ error: err.message || 'Internal server error' });
    },
  );

  return app;
}
