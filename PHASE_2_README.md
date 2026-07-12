# HireLoop Phase 2

## What was built

- Secure LinkedIn credential storage:
  - Credentials are encrypted before writing to SQLite.
  - Raw LinkedIn credentials are never returned by any API.
  - Credentials can be deleted from the dashboard.
- LinkedIn automation run controls:
  - Store credentials.
  - View daily LinkedIn application usage.
  - Start a LinkedIn run.
  - Dry-run mode is available and enabled by default in the UI.
- LinkedIn job sourcing:
  - Searches Easy Apply jobs for broad Phase 2 role categories:
    - Machine Learning Engineer.
    - Data Scientist.
    - Generative AI Engineer.
    - Full Stack Engineer.
  - Uses India + remote search parameters.
- Easy Apply automation:
  - Logs in with the stored LinkedIn credentials.
  - Opens Easy Apply jobs.
  - Fills visible text questions conservatively.
  - Skips and logs forms it cannot confidently complete.
- Basic answer generation:
  - Uses `OPENAI_API_KEY` when configured.
  - Falls back to deterministic profile-based answers when no OpenAI key is configured.
  - Keeps employment status neutral unless directly asked.
- Application logging:
  - Submitted and skipped LinkedIn applications appear in the dashboard.
  - Exact answers submitted or prepared are stored in `applications.answers_json`.

## How encryption is implemented

LinkedIn credentials are encrypted at rest using AES-256-GCM in `apps/backend/src/security/credentialCrypto.ts`.

Each encrypted value stores:

- `version`
- `algorithm`
- random 12-byte IV
- authentication tag
- ciphertext

The encryption key comes from `LINKEDIN_CREDENTIAL_KEY`. It must decode to exactly 32 bytes and can be provided as either:

- 64 hex characters, or
- base64 for 32 random bytes.

Generate a local key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Set it in `apps/backend/.env`:

```bash
LINKEDIN_CREDENTIAL_KEY=<generated-key>
```

If `LINKEDIN_CREDENTIAL_KEY` is missing, the dashboard refuses to store LinkedIn credentials.

## How the 15/day LinkedIn cap is enforced

The LinkedIn cap is enforced server-side in `apps/backend/src/linkedin/automation.ts`.

Before every submit attempt, the backend counts persisted submitted LinkedIn applications:

```sql
SELECT COUNT(*)
FROM applications
WHERE user_profile_id = ?
  AND source = 'linkedin'
  AND status = 'submitted'
  AND substr(submitted_at, 1, 10) = ?
```

If the count is 15 or higher, the run is blocked or stopped before the next submit click. Restarting the server or starting a new run does not reset the cap because the source of truth is the persisted `applications` table.

Dry-run attempts do not count toward the cap because they do not click the final submit button and are logged as skipped.

## Configuration

Backend `.env` additions:

```bash
LINKEDIN_CREDENTIAL_KEY=<32-byte-key-as-base64-or-hex>
LINKEDIN_HEADLESS=true
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
```

`OPENAI_API_KEY` is optional. Without it, answers are generated from simple profile-based templates.

## How to run locally

```bash
npm install
npx playwright install chromium
npm run dev
```

Open `http://localhost:5173`, sign in, upload/select a resume, fill out the Q&A profile, store LinkedIn credentials, and start a LinkedIn run.

## How to test and verify

Automated checks:

```bash
npm run lint
npm run test
npm run build
```

Manual verification:

1. Configure Google OAuth and sign in.
2. Configure `LINKEDIN_CREDENTIAL_KEY`.
3. Upload and select a resume.
4. Save LinkedIn credentials.
5. Start a dry run and confirm skipped records appear in the dashboard.
6. Disable dry run only after reviewing behavior.
7. Confirm submitted records show exact answers in the detail view.
8. Confirm attempts beyond 15 LinkedIn submissions for the current day are blocked.

## Decisions and assumptions

- The automation intentionally does not try to bypass LinkedIn checkpoint, CAPTCHA, or additional verification. If LinkedIn asks for extra verification, the run fails safely.
- The automation only handles conservative Easy Apply flows. If it cannot identify questions or continue safely, it skips and logs the reason.
- Phase 2 uses the resume already attached to the user's LinkedIn profile, matching the masterplan. The local selected resume is recorded for audit linkage and future run selection.
- Salary remains a soft preference. Phase 2 uses broad search terms and does not reject jobs solely on salary.
- Remote India-wide roles are targeted through LinkedIn search parameters.

## Intentionally deferred

- AI relevance scoring and prioritization.
- Company research.
- Answer Memory.
- Non-LinkedIn job boards and company career sites.
- Dashboard analytics and filtering polish.

## Verification limitation

The automated test suite verifies the application build, schema, and route compilation. A real LinkedIn submission requires valid user credentials, current LinkedIn UI availability, and user-controlled dry-run/live-run choice, so it must be manually verified in the browser.
