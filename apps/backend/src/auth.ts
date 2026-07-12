import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import type { AppDatabase } from './db/database.js';

const sessionCookieName = 'hl_session';
const oauthStateCookieName = 'hl_oauth_state';
const sessionDays = 14;
const productionCookie = config.frontendOrigins.some((origin) => origin.startsWith('https://'));

export type AuthenticatedRequest = Request & {
  user: {
    id: string;
    email: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
};

type SessionRow = {
  user_profile_id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

export function googleAuthConfigured(): boolean {
  return Boolean(config.googleClientId && config.googleClientSecret && config.googleRedirectUri);
}

export function createSignedState(): string {
  const nonce = crypto.randomBytes(24).toString('base64url');
  const signature = signValue(nonce);
  return `${nonce}.${signature}`;
}

export function verifySignedState(state: string | undefined): boolean {
  if (!state) {
    return false;
  }

  const [nonce, signature] = state.split('.');
  if (!nonce || !signature) {
    return false;
  }

  const expected = signValue(nonce);
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function createSession(db: AppDatabase, userProfileId: string): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    `INSERT INTO auth_sessions (id, user_profile_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), userProfileId, tokenHash, expiresAt);

  return token;
}

export function destroySession(db: AppDatabase, token: string | undefined): void {
  if (!token) {
    return;
  }

  db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hashToken(token));
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(sessionCookieName, token, {
    httpOnly: true,
    sameSite: productionCookie ? 'none' : 'lax',
    secure: productionCookie,
    maxAge: sessionDays * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(sessionCookieName, {
    path: '/',
    sameSite: productionCookie ? 'none' : 'lax',
    secure: productionCookie,
  });
}

export function setOauthStateCookie(res: Response, state: string): void {
  res.cookie(oauthStateCookieName, state, {
    httpOnly: true,
    sameSite: productionCookie ? 'none' : 'lax',
    secure: productionCookie,
    maxAge: 10 * 60 * 1000,
    path: '/',
  });
}

export function clearOauthStateCookie(res: Response): void {
  res.clearCookie(oauthStateCookieName, {
    path: '/',
    sameSite: productionCookie ? 'none' : 'lax',
    secure: productionCookie,
  });
}

export function getSessionToken(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[sessionCookieName];
}

export function getOauthState(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[oauthStateCookieName];
}

export function requireAuth(db: AppDatabase) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = getSessionToken(req);
    const user = token ? findUserBySession(db, token) : null;

    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    (req as AuthenticatedRequest).user = {
      id: user.user_profile_id,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
    };
    next();
  };
}

export function findUserBySession(db: AppDatabase, token: string): SessionRow | null {
  const row = db
    .prepare(
      `SELECT
        auth_sessions.user_profile_id,
        user_profiles.email,
        user_profiles.display_name,
        user_profiles.avatar_url
       FROM auth_sessions
       JOIN user_profiles ON user_profiles.id = auth_sessions.user_profile_id
       WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > CURRENT_TIMESTAMP`,
    )
    .get(hashToken(token)) as SessionRow | undefined;

  return row ?? null;
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return Object.fromEntries(
    cookieHeader.split(';').map((cookie) => {
      const [name, ...valueParts] = cookie.trim().split('=');
      return [name, decodeURIComponent(valueParts.join('='))];
    }),
  );
}

function signValue(value: string): string {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
