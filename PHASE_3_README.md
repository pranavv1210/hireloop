# HireLoop Phase 3

## What was built

- AI relevance scoring:
  - Each LinkedIn candidate found after Phase 2 hard filters is scored before application.
  - Scores are persisted in `match_scores`.
  - Runs apply to higher-scoring jobs first.
  - Dashboard details show latest fit score, model, and rationale.
- Company research:
  - Lightweight company lookup via Wikipedia public APIs.
  - Results are cached in `company_research` for 30 days.
  - Research includes a concise summary and source URL when available.
- Answer quality refinement:
  - Screening answers now receive resume/profile context, job context, and company research context.
  - "Why this company" fallback answers now include company-specific context when research is available.
  - Employment-status neutrality from the core rules is preserved.

## How scoring works

The LinkedIn automation pipeline now follows this order:

1. Apply Phase 2 hard filters through LinkedIn search: broad role categories, remote, India.
2. Upsert each discovered job into `job_postings`.
3. Score each job against the user's Q&A profile and job metadata.
4. Persist each score in `match_scores`.
5. Sort candidates by score descending.
6. Attempt Easy Apply in that priority order while still enforcing the 15/day LinkedIn cap before every submit.

If `OPENAI_API_KEY` is configured, scoring uses `OPENAI_MODEL`. If not, HireLoop falls back to a deterministic keyword heuristic so the pipeline remains usable without paid services.

## How company research works

Company research is intentionally lightweight:

- Search the company name on Wikipedia.
- Fetch the top page summary.
- Cache the result locally in `company_research`.
- Reuse cached research for 30 days.

This keeps Phase 3 simple and free-friendly while still improving "why this company" style answers.

## Configuration

Optional OpenAI configuration:

```bash
OPENAI_API_KEY=<your-api-key>
OPENAI_MODEL=gpt-4.1-mini
```

Without `OPENAI_API_KEY`, Phase 3 still works with fallback scoring and fallback answer generation.

## How to run locally

```bash
npm install
npx playwright install chromium
npm run dev
```

Open `http://localhost:5173`.

## How to test and verify

Automated checks:

```bash
npm run lint
npm run test
npm run build
```

Manual verification:

1. Sign in.
2. Ensure a resume is selected and the profile form has meaningful content.
3. Store LinkedIn credentials.
4. Start a dry run.
5. Confirm skipped dry-run application records appear in the dashboard.
6. Open an application detail and confirm fit score, model, rationale, role type, and exact answers are visible.
7. For "why company" questions, confirm generated answers can include company-specific context when research succeeds.

## Deployment notes for free tools

The current app can be prepared for free-tier deployment, but there are constraints:

- SQLite and local uploads require persistent disk. Many free app hosts have ephemeral filesystems.
- Playwright browser automation requires a host that allows browser binaries and enough memory.
- Long-running LinkedIn automation should not run inside serverless request time limits.

Free-friendly options to evaluate later:

- Backend + Playwright worker on a free VM/container platform that supports persistent storage.
- Frontend on a static host.
- SQLite file on persistent disk, or a free managed Postgres provider if SQLite persistence is not available.

Do not deploy LinkedIn credentials to any host until environment variables, persistent storage, and secret handling are reviewed.

## Intentionally deferred

- Non-LinkedIn sourcing and applications.
- Answer Memory.
- Dashboard filtering/stats polish.
- Email/inbox outcome tracking from Phase 6.
