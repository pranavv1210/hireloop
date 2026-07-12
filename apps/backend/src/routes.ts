import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Router } from 'express';
import express from 'express';
import multer from 'multer';
import {
  type AuthenticatedRequest,
  clearOauthStateCookie,
  clearSessionCookie,
  createSession,
  createSignedState,
  destroySession,
  findUserBySession,
  getOauthState,
  getSessionToken,
  googleAuthConfigured,
  requireAuth,
  setOauthStateCookie,
  setSessionCookie,
  verifySignedState,
} from './auth.js';
import { config } from './config.js';
import type { AppDatabase } from './db/database.js';
import { buildGoogleAuthUrl, exchangeCodeForGoogleUser, type GoogleUserInfo } from './google.js';
import { getLinkedInDailyStatus, runLinkedInAgent } from './linkedin/automation.js';
import { runNonLinkedInAgent } from './nonlinkedin/automation.js';
import {
  decryptCredential,
  encryptCredential,
  encryptionConfigured,
} from './security/credentialCrypto.js';

type UserProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  career_goals: string | null;
  job_hunt_reason: string | null;
  strengths: string | null;
  salary_flexibility: string | null;
  notice_period: string | null;
  additional_context: string | null;
};

type ResumeRow = {
  id: string;
  filename: string;
  mime_type: string;
  file_size_bytes: number;
  is_selected: number;
  uploaded_at: string;
};

type LinkedInCredentialRow = {
  encrypted_email_json: string;
  encrypted_password_json: string;
  updated_at: string;
};

export function createApiRouter(db: AppDatabase): Router {
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 8 * 1024 * 1024,
      files: 1,
    },
    fileFilter: (_req, file, callback) => {
      if (file.mimetype !== 'application/pdf') {
        callback(new Error('Only PDF resumes are allowed'));
        return;
      }

      callback(null, true);
    },
  });

  router.get('/auth/config', (_req, res) => {
    res.json({ googleConfigured: googleAuthConfigured() });
  });

  router.get('/auth/google/start', (_req, res) => {
    if (!googleAuthConfigured()) {
      res.status(503).json({ error: 'Google OAuth is not configured' });
      return;
    }

    const state = createSignedState();
    setOauthStateCookie(res, state);
    res.redirect(buildGoogleAuthUrl(state));
  });

  router.get('/auth/google/callback', async (req, res, next) => {
    try {
      const code = typeof req.query.code === 'string' ? req.query.code : undefined;
      const state = typeof req.query.state === 'string' ? req.query.state : undefined;
      const cookieState = getOauthState(req);

      if (!code || !state || state !== cookieState || !verifySignedState(state)) {
        res.status(400).send('Invalid Google OAuth callback state');
        return;
      }

      const googleUser = await exchangeCodeForGoogleUser(code);
      const userProfileId = upsertGoogleUser(db, googleUser);
      const sessionToken = createSession(db, userProfileId);

      clearOauthStateCookie(res);
      setSessionCookie(res, sessionToken);
      res.redirect(config.frontendOrigin);
    } catch (error) {
      next(error);
    }
  });

  router.get('/me', (req, res) => {
    const token = getSessionToken(req);
    const user = token ? findUserBySession(db, token) : null;

    res.json({
      user: user
        ? {
            id: user.user_profile_id,
            email: user.email,
            displayName: user.display_name,
            avatarUrl: user.avatar_url,
          }
        : null,
    });
  });

  router.post('/auth/logout', (req, res) => {
    destroySession(db, getSessionToken(req));
    clearSessionCookie(res);
    res.status(204).send();
  });

  router.get('/profile', requireAuth(db), (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const profile = db
      .prepare(
        `SELECT id, email, display_name, avatar_url, career_goals, job_hunt_reason, strengths,
          salary_flexibility, notice_period, additional_context
         FROM user_profiles
         WHERE id = ?`,
      )
      .get(user.id) as UserProfileRow;

    res.json({ profile: toProfileResponse(profile) });
  });

  router.put('/profile', requireAuth(db), (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const body = req.body as Partial<Record<string, string>>;

    db.prepare(
      `UPDATE user_profiles
       SET career_goals = ?, job_hunt_reason = ?, strengths = ?, salary_flexibility = ?,
         notice_period = ?, additional_context = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(
      cleanText(body.careerGoals),
      cleanText(body.jobHuntReason),
      cleanText(body.strengths),
      cleanText(body.salaryFlexibility),
      cleanText(body.noticePeriod),
      cleanText(body.additionalContext),
      user.id,
    );

    const profile = db
      .prepare(
        `SELECT id, email, display_name, avatar_url, career_goals, job_hunt_reason, strengths,
          salary_flexibility, notice_period, additional_context
         FROM user_profiles
         WHERE id = ?`,
      )
      .get(user.id) as UserProfileRow;

    res.json({ profile: toProfileResponse(profile) });
  });

  router.get('/resumes', requireAuth(db), (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const resumes = db
      .prepare(
        `SELECT id, filename, mime_type, file_size_bytes, is_selected, uploaded_at
         FROM resumes
         WHERE user_profile_id = ?
         ORDER BY uploaded_at DESC`,
      )
      .all(user.id) as ResumeRow[];

    res.json({ resumes: resumes.map(toResumeResponse) });
  });

  router.post('/resumes', requireAuth(db), upload.single('resume'), (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const file = req.file;

    if (!file) {
      res.status(400).json({ error: 'Resume PDF is required' });
      return;
    }

    const id = crypto.randomUUID();
    const userDir = path.join(config.uploadDir, 'resumes', user.id);
    const storagePath = path.join(userDir, `${id}.pdf`);
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(storagePath, file.buffer);

    const existingCount = db
      .prepare('SELECT COUNT(*) AS count FROM resumes WHERE user_profile_id = ?')
      .get(user.id) as { count: number };
    const shouldSelect = existingCount.count === 0 ? 1 : 0;

    db.prepare(
      `INSERT INTO resumes (
        id, user_profile_id, filename, storage_path, mime_type, file_size_bytes, is_selected
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, user.id, file.originalname, storagePath, file.mimetype, file.size, shouldSelect);

    const resume = db
      .prepare(
        `SELECT id, filename, mime_type, file_size_bytes, is_selected, uploaded_at
         FROM resumes
         WHERE id = ?`,
      )
      .get(id) as ResumeRow;

    res.status(201).json({ resume: toResumeResponse(resume) });
  });

  router.post('/resumes/:id/select', requireAuth(db), (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const resume = db
      .prepare('SELECT id FROM resumes WHERE id = ? AND user_profile_id = ?')
      .get(req.params.id, user.id);

    if (!resume) {
      res.status(404).json({ error: 'Resume not found' });
      return;
    }

    try {
      db.exec('BEGIN');
      db.prepare('UPDATE resumes SET is_selected = 0 WHERE user_profile_id = ?').run(user.id);
      db.prepare('UPDATE resumes SET is_selected = 1 WHERE id = ? AND user_profile_id = ?').run(
        req.params.id,
        user.id,
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    res.status(204).send();
  });

  router.get('/applications', requireAuth(db), (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const applications = db
      .prepare(
        `SELECT
          applications.id,
          applications.status,
          applications.source,
          applications.submitted_at,
          applications.skipped_at,
          applications.skip_reason,
          applications.answers_json,
          job_postings.title,
          job_postings.company,
          job_postings.location,
          job_postings.salary_text,
          job_postings.posting_url,
          job_postings.role_category,
          latest_scores.score AS match_score,
          latest_scores.rationale AS match_rationale,
          latest_scores.model_name AS match_model,
          resumes.filename AS resume_filename
        FROM applications
        JOIN job_postings ON job_postings.id = applications.job_posting_id
        LEFT JOIN (
          SELECT match_scores.*
          FROM match_scores
          JOIN (
            SELECT job_posting_id, user_profile_id, MAX(scored_at) AS scored_at
            FROM match_scores
            GROUP BY job_posting_id, user_profile_id
          ) latest ON latest.job_posting_id = match_scores.job_posting_id
            AND latest.user_profile_id = match_scores.user_profile_id
            AND latest.scored_at = match_scores.scored_at
        ) latest_scores ON latest_scores.job_posting_id = applications.job_posting_id
          AND latest_scores.user_profile_id = applications.user_profile_id
        LEFT JOIN resumes ON resumes.id = applications.resume_id
        WHERE applications.user_profile_id = ?
        ORDER BY applications.created_at DESC`,
      )
      .all(user.id);

    res.json({ applications });
  });

  router.get('/linkedin/status', requireAuth(db), (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const credential = db
      .prepare('SELECT updated_at FROM linkedin_credentials WHERE user_profile_id = ?')
      .get(user.id) as { updated_at: string } | undefined;

    res.json({
      encryptionConfigured: encryptionConfigured(),
      credentialsStored: Boolean(credential),
      credentialsUpdatedAt: credential?.updated_at ?? null,
      daily: getLinkedInDailyStatus(db, user.id),
    });
  });

  router.post('/linkedin/credentials', requireAuth(db), (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const body = req.body as Partial<Record<string, string>>;
    const email = cleanText(body.email);
    const password = body.password ?? '';

    if (!email || !password) {
      res.status(400).json({ error: 'LinkedIn email and password are required' });
      return;
    }

    if (!encryptionConfigured()) {
      res.status(503).json({ error: 'LINKEDIN_CREDENTIAL_KEY is not configured' });
      return;
    }

    db.prepare(
      `INSERT INTO linkedin_credentials (
        user_profile_id, encrypted_email_json, encrypted_password_json
      ) VALUES (?, ?, ?)
      ON CONFLICT(user_profile_id) DO UPDATE SET
        encrypted_email_json = excluded.encrypted_email_json,
        encrypted_password_json = excluded.encrypted_password_json,
        updated_at = CURRENT_TIMESTAMP`,
    ).run(user.id, encryptCredential(email), encryptCredential(password));

    res.status(204).send();
  });

  router.delete('/linkedin/credentials', requireAuth(db), (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    db.prepare('DELETE FROM linkedin_credentials WHERE user_profile_id = ?').run(user.id);
    res.status(204).send();
  });

  router.post('/linkedin/run', requireAuth(db), async (req, res, next) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const body = req.body as { maxApplications?: number; dryRun?: boolean };
      const credential = db
        .prepare(
          `SELECT encrypted_email_json, encrypted_password_json, updated_at
           FROM linkedin_credentials
           WHERE user_profile_id = ?`,
        )
        .get(user.id) as LinkedInCredentialRow | undefined;

      if (!credential) {
        res.status(400).json({ error: 'Store LinkedIn credentials before starting a run' });
        return;
      }

      const daily = getLinkedInDailyStatus(db, user.id);
      if (daily.remaining <= 0) {
        res.status(429).json({ error: 'LinkedIn daily cap reached', daily });
        return;
      }

      const maxApplications =
        typeof body.maxApplications === 'number' && Number.isFinite(body.maxApplications)
          ? Math.max(1, Math.min(Math.floor(body.maxApplications), daily.remaining))
          : Math.min(5, daily.remaining);

      const result = await runLinkedInAgent(
        db,
        user.id,
        {
          email: decryptCredential(credential.encrypted_email_json),
          password: decryptCredential(credential.encrypted_password_json),
        },
        {
          maxApplications,
          dryRun: Boolean(body.dryRun),
        },
      );

      res.json({ result });
    } catch (error) {
      next(error);
    }
  });

  router.post('/nonlinkedin/run', requireAuth(db), async (req, res, next) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const body = req.body as { maxApplications?: number; dryRun?: boolean };
      const maxApplications =
        typeof body.maxApplications === 'number' && Number.isFinite(body.maxApplications)
          ? Math.max(1, Math.min(Math.floor(body.maxApplications), 50))
          : 10;

      const result = await runNonLinkedInAgent(db, user.id, {
        maxApplications,
        dryRun: Boolean(body.dryRun),
      });

      res.json({ result });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function upsertGoogleUser(db: AppDatabase, googleUser: GoogleUserInfo): string {
  const existing = db
    .prepare('SELECT id FROM user_profiles WHERE google_sub = ? OR email = ?')
    .get(googleUser.sub, googleUser.email) as { id: string } | undefined;
  const id = existing?.id ?? crypto.randomUUID();

  if (existing) {
    db.prepare(
      `UPDATE user_profiles
       SET google_sub = ?, email = ?, display_name = ?, avatar_url = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(googleUser.sub, googleUser.email, googleUser.name ?? null, googleUser.picture ?? null, id);
    return id;
  }

  db.prepare(
    `INSERT INTO user_profiles (id, google_sub, email, display_name, avatar_url)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, googleUser.sub, googleUser.email, googleUser.name ?? null, googleUser.picture ?? null);
  return id;
}

function toProfileResponse(profile: UserProfileRow) {
  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.display_name,
    avatarUrl: profile.avatar_url,
    careerGoals: profile.career_goals ?? '',
    jobHuntReason: profile.job_hunt_reason ?? '',
    strengths: profile.strengths ?? '',
    salaryFlexibility: profile.salary_flexibility ?? '',
    noticePeriod: profile.notice_period ?? '',
    additionalContext: profile.additional_context ?? '',
  };
}

function toResumeResponse(resume: ResumeRow) {
  return {
    id: resume.id,
    filename: resume.filename,
    mimeType: resume.mime_type,
    fileSizeBytes: resume.file_size_bytes,
    isSelected: resume.is_selected === 1,
    uploadedAt: resume.uploaded_at,
  };
}

function cleanText(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}
