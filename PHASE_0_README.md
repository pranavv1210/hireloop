# HireLoop Phase 0

## What was built

- Monorepo structure with separate modules:
  - `apps/frontend`: Vite + React blank application shell.
  - `apps/backend`: Express API service.
  - `data`: local SQLite database directory created automatically at runtime.
- Environment-variable-based configuration with `.env.example` files for frontend and backend.
- SQLite relational database connection and schema initialization.
- Backend health endpoints:
  - `GET /api/health`
  - `GET /api/schema-summary`
- Initial empty data model tables:
  - `user_profiles`
  - `resumes`
  - `job_postings`
  - `match_scores`
  - `applications`
  - `answer_memory`
  - `agent_runs`
- Basic linting, formatting, build, and test scripts.

## How to run locally

From the repository root:

```bash
node --version
npm install
npm run dev
```

Then open:

- Frontend: `http://localhost:5173`
- Backend health check: `http://localhost:4000/api/health`
- Schema summary: `http://localhost:4000/api/schema-summary`

The backend creates `data/hireloop.sqlite` automatically if it does not exist.

Node.js `22.5.0` or newer is required because Phase 0 uses Node's built-in SQLite module. Current Node versions may print an experimental SQLite warning; the app still runs normally.

## Configuration

Backend configuration lives in `apps/backend/.env.example`:

```bash
PORT=4000
DATABASE_PATH=../../data/hireloop.sqlite
FRONTEND_ORIGIN=http://localhost:5173
LOG_LEVEL=info
```

Frontend configuration lives in `apps/frontend/.env.example`:

```bash
VITE_API_BASE_URL=http://localhost:4000
```

Copy either file to `.env` in the same directory when local overrides are needed.

## How to test and verify

```bash
npm run lint
npm run test
npm run build
```

Manual verification:

1. Run `npm run dev`.
2. Open `http://localhost:5173`.
3. Confirm the page reports frontend loaded, backend connected, and database connected.
4. Confirm all seven Phase 0 schema tables appear with count `0`.

## Decisions and assumptions

- SQLite is used for Phase 0 because it is a real relational database with minimal local setup. The implementation uses Node's built-in SQLite module to avoid native dependency compilation issues. The schema and data access layer can be migrated to Postgres later if needed.
- IDs are `TEXT` fields so later phases can use UUIDs without schema churn.
- Application answers are represented by `applications.answers_json` for exact submitted-answer transparency in later phases.
- The LinkedIn daily cap is not implemented in Phase 0 because there is no application automation yet. It must be enforced server-side when Phase 2 introduces LinkedIn submissions.

## Intentionally deferred

- Google authentication.
- Resume upload and storage.
- User profile intake.
- Dashboard application list/detail views.
- LinkedIn credential storage or automation.
- AI matching, answer generation, company research, and Answer Memory behavior.
- Non-LinkedIn sourcing and form filling.
