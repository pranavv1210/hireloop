import { config } from './config.js';

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
};

export type GoogleUserInfo = {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
};

export function buildGoogleAuthUrl(state: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.googleClientId);
  url.searchParams.set('redirect_uri', config.googleRedirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export async function exchangeCodeForGoogleUser(code: string): Promise<GoogleUserInfo> {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: config.googleRedirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`Google token exchange failed with ${tokenResponse.status}`);
  }

  const token = (await tokenResponse.json()) as GoogleTokenResponse;
  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });

  if (!userInfoResponse.ok) {
    throw new Error(`Google userinfo request failed with ${userInfoResponse.status}`);
  }

  return (await userInfoResponse.json()) as GoogleUserInfo;
}
