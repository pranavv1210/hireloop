# HireLoop Phase 1

## What was built

- Google Sign-In based authentication.
- HTTP-only session cookie storage backed by the `auth_sessions` table.
- Resume library:
  - Upload PDF resumes.
  - Store files under `uploads/resumes/<user_id>/`.
  - List uploaded resumes.
  - Select exactly one active resume for later agent runs.
- Q&A profile intake:
  - Career goals.
  - Job hunting context.
  - Strengths.
  - Salary flexibility.
  - Notice period.
  - Additional context.
- Dashboard shell:
  - Application list area.
  - Application detail area.
  - Empty state until Phase 2 creates real application records.
- Backend endpoints for profile, resumes, auth, and empty application retrieval.

## How to run locally

Install dependencies from the repository root:

```bash
npm install
```

Create `apps/backend/.env` from `apps/backend/.env.example` and fill in:

```bash
SESSION_SECRET=replace-with-a-long-random-string
GOOGLE_CLIENT_ID=<your-google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<your-google-oauth-client-secret>
GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/google/callback
FRONTEND_ORIGIN=http://localhost:5173
```

Create `apps/frontend/.env` from `apps/frontend/.env.example` if you need to override the default backend URL:

```bash
VITE_API_BASE_URL=http://localhost:4000
```

Start the app:

```bash
npm run dev
```

Open `http://localhost:5173` and sign in with Google.

## Google OAuth setup

In Google Cloud Console, create an OAuth web client and add this authorized redirect URI:

```text
http://localhost:4000/api/auth/google/callback
```

The app requests only `openid email profile`. It does not request Gmail, Drive, Calendar, or other sensitive scopes.

## How to test and verify

```bash
npm run lint
npm run test
npm run build
```

Manual verification:

1. Start `npm run dev`.
2. Sign in with Google.
3. Upload at least two PDF resumes.
4. Select a different active resume and confirm only one resume shows `Selected`.
5. Fill out and save the Q&A profile.
6. Reload the page and confirm the profile and resume list persist.
7. Confirm the dashboard shell loads with an empty application state.

## Decisions and assumptions

- Auth is single-user oriented but still keyed to the signed-in Google account.
- Sessions are stored server-side as SHA-256 token hashes; the raw token is only stored in an HTTP-only cookie.
- Resume files are stored on local disk for v1. The database stores metadata and the file path.
- PDF upload is capped at 8 MB.
- Google profile details are stored in `user_profiles`; Google access tokens are not stored.
- LinkedIn credentials are not touched in Phase 1, so the Phase 2 encryption requirement has not started yet.

## Intentionally deferred

- Starting agent runs.
- LinkedIn credential storage and encryption.
- LinkedIn job search and Easy Apply automation.
- Daily LinkedIn application cap enforcement.
- AI answer generation.
- AI matching and company research.
- Non-LinkedIn applications.
- Answer Memory behavior.
