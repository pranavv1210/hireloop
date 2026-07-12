# HireLoop Phase 5

## What was built

- Dashboard search and filters:
  - Search by company or role.
  - Filter by source.
  - Filter by status.
  - Filter by date range.
- Dashboard stats:
  - Total applications.
  - Submitted applications.
  - Skipped applications.
  - Applications this week.
- Detail view polish:
  - Role.
  - Company.
  - Location.
  - Salary.
  - Date.
  - Status.
  - Source.
  - Role category.
  - Fit score, scoring model, and rationale.
  - Resume used.
  - Posting link.
  - Skip reason.
  - Exact stored answers.

## How to run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## How to test

```bash
npm run lint
npm run test
npm run build
```

Manual verification:

1. Start the app.
2. Create or import application records through LinkedIn or external dry runs.
3. Search for a company or role.
4. Filter by source, status, and date range.
5. Open a detail view and confirm all audit fields and exact answers are visible.

## Decisions and assumptions

- Dashboard filtering is client-side for v1 because this is a single-user personal tool.
- Stats are derived from the loaded application list.
- No Phase 6 email/inbox tracking was added.

## Intentionally deferred

- Email-based status tracking.
- Outcome-based answer learning.
- Advanced charts beyond simple summary stats.
