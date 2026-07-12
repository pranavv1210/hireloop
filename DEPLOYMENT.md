# HireLoop Deployment

## Recommended shape

HireLoop is easiest to deploy as one Docker web service:

- Backend serves `/api/*`.
- Backend also serves the built frontend from `apps/frontend/dist`.
- SQLite and uploads are expected under `/data`.

You can also deploy the frontend separately on Vercel and the backend on Render/Railway/Fly. In that setup:

- Vercel serves the Vite frontend.
- The backend host serves only the API and automation.
- `VITE_API_BASE_URL` in Vercel must point to the backend URL.
- `FRONTEND_ORIGIN` in the backend must include the Vercel URL.

The included `Dockerfile` builds both apps and runs:

```bash
node apps/backend/dist/server.js
```

## Required environment variables

Set these in the hosting provider dashboard:

```bash
SESSION_SECRET=<long-random-string>
GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
GOOGLE_REDIRECT_URI=https://<your-domain>/api/auth/google/callback
GOOGLE_EMAIL_REDIRECT_URI=https://<your-domain>/api/email/google/callback
FRONTEND_ORIGIN=https://<your-domain>
LINKEDIN_CREDENTIAL_KEY=<32-byte-base64-or-hex-key>
LINKEDIN_HEADLESS=true
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
DATABASE_PATH=/data/hireloop.sqlite
UPLOAD_DIR=/data/uploads
```

Update Google Cloud OAuth authorized redirect URIs to include both production callbacks.

## Vercel frontend + separate backend

Use this when deploying the frontend to Vercel.

### Vercel settings

Import the GitHub repo in Vercel and keep the project root as the repository root. The included `vercel.json` sets:

```bash
npm install
npm run build -w apps/frontend
apps/frontend/dist
```

Set this Vercel environment variable:

```bash
VITE_API_BASE_URL=https://<your-backend-domain>
```

Examples:

```bash
VITE_API_BASE_URL=https://hireloop-api.onrender.com
VITE_API_BASE_URL=https://hireloop-production.up.railway.app
```

### Backend settings

Set the backend `FRONTEND_ORIGIN` to your Vercel URL:

```bash
FRONTEND_ORIGIN=https://<your-vercel-app>.vercel.app
```

For local + production together, comma-separate allowed origins:

```bash
FRONTEND_ORIGIN=http://localhost:5173,https://<your-vercel-app>.vercel.app
```

If you want Vercel preview deployments to call the backend, add those preview URLs too.

### Google OAuth callbacks

Google redirects to the backend, not Vercel. Use backend URLs:

```text
https://<your-backend-domain>/api/auth/google/callback
https://<your-backend-domain>/api/email/google/callback
```

Set backend env vars to match:

```bash
GOOGLE_REDIRECT_URI=https://<your-backend-domain>/api/auth/google/callback
GOOGLE_EMAIL_REDIRECT_URI=https://<your-backend-domain>/api/email/google/callback
```

## Free-friendly provider notes

Free hosting is possible for demos, but this app has two requirements that many free tiers handle poorly:

- Persistent storage for SQLite and uploaded resumes.
- Browser automation support for Playwright.

### Render

`render.yaml` is included for a Docker web service preview. Render free web services are useful for testing, but free service filesystems are ephemeral. Without a paid persistent disk or external database/storage, SQLite and uploads can be lost on restart/redeploy.

Quick Render demo deploy:

1. Push this repo to GitHub.
2. In Render, create a new Blueprint or Docker web service from the GitHub repo.
3. Use the root `Dockerfile`.
4. Add the required environment variables from this file.
5. Deploy.
6. Copy the Render URL, then update these variables:

```bash
FRONTEND_ORIGIN=https://<your-render-service>.onrender.com
GOOGLE_REDIRECT_URI=https://<your-render-service>.onrender.com/api/auth/google/callback
GOOGLE_EMAIL_REDIRECT_URI=https://<your-render-service>.onrender.com/api/email/google/callback
```

7. Add both callback URLs to Google Cloud OAuth.

For real use, add persistent storage or move the database/uploads to managed services before storing production credentials or resumes.

### Railway

Railway can run Docker services and has free/trial credits. Use a volume mounted at `/data` if you want SQLite/uploads to persist.

Railway is the better free/trial path for a real personal test because it supports attached volumes:

1. Create a Railway project from the GitHub repo.
2. Railway should detect the `Dockerfile`.
3. Add a volume mounted at `/data`.
4. Set `DATABASE_PATH=/data/hireloop.sqlite`.
5. Set `UPLOAD_DIR=/data/uploads`.
6. Add the required secrets.
7. Deploy and copy the generated Railway domain.
8. Update Google OAuth redirect URLs to the Railway domain.

### Fly.io

Fly supports Docker apps and persistent volumes. It is a good technical fit, but budget controls need care because free allowances are not a hard spending cap.

## Local Docker test

```bash
docker build -t hireloop .
docker run --rm -p 4000:4000 --env-file apps/backend/.env -v hireloop-data:/data hireloop
```

Open:

```text
http://localhost:4000
```

For local Docker, set these callback URIs in Google Cloud:

```text
http://localhost:4000/api/auth/google/callback
http://localhost:4000/api/email/google/callback
```

## Security checklist before public deployment

- Do not commit `.env`.
- Use HTTPS callback URLs in Google Cloud.
- Use strong random values for `SESSION_SECRET` and `LINKEDIN_CREDENTIAL_KEY`.
- Confirm persistent storage is enabled before storing real resumes or credentials.
- Test Gmail sync with a low-volume account first.
- Keep LinkedIn dry-run enabled until you review behavior on the deployed host.
