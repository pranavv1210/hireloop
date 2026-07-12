import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

const backendRoot = path.resolve(import.meta.dirname, '..');

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databasePath: path.resolve(
    backendRoot,
    process.env.DATABASE_PATH ?? '../../data/hireloop.sqlite',
  ),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  frontendOrigins: (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  sessionSecret: process.env.SESSION_SECRET ?? 'hireloop-dev-session-secret-change-me',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  googleRedirectUri:
    process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:4000/api/auth/google/callback',
  googleEmailRedirectUri:
    process.env.GOOGLE_EMAIL_REDIRECT_URI ?? 'http://localhost:4000/api/email/google/callback',
  uploadDir: path.resolve(backendRoot, process.env.UPLOAD_DIR ?? '../../uploads'),
  linkedinCredentialKey: process.env.LINKEDIN_CREDENTIAL_KEY ?? '',
  linkedinHeadless: (process.env.LINKEDIN_HEADLESS ?? 'true') !== 'false',
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
};
