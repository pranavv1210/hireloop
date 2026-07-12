# HireLoop Phase 6

## What was built

- Gmail outcome tracking:
  - Separate Gmail read-only OAuth connection.
  - Does not expand the base Google login scope.
  - Stores Gmail refresh tokens encrypted at rest.
  - Can disconnect Gmail tracking from the dashboard.
- Email sync:
  - Reads recent Gmail messages using `gmail.readonly`.
  - Searches for likely job-response messages from the last 90 days.
  - Classifies outcomes as `viewed`, `assessment`, `interview`, or `rejected`.
  - Matches messages to submitted applications by company/title context.
  - Stores evidence in `email_events`.
  - Updates application `outcome_status`, `outcome_detected_at`, and `outcome_source_message_id`.
- Dashboard:
  - Connect Gmail.
  - Sync outcomes.
  - See recent detected email events.
  - See detected outcome in application list and detail view.

## Privacy and security behavior

- Gmail access is opt-in and separate from sign-in.
- Scope requested: `https://www.googleapis.com/auth/gmail.readonly`.
- HireLoop does not send, delete, archive, or modify email.
- Refresh tokens are encrypted with the same AES-256-GCM credential encryption layer used for LinkedIn credentials.
- Email sync stores only message metadata needed for audit: sender, subject, snippet, detected status, confidence, and message id.

## Google Cloud setup

Add this redirect URI to the same OAuth client:

```text
http://localhost:4000/api/email/google/callback
```

For deployment, add:

```text
https://<your-domain>/api/email/google/callback
```

Set:

```bash
GOOGLE_EMAIL_REDIRECT_URI=http://localhost:4000/api/email/google/callback
```

For production, replace it with the HTTPS URL.

## How to run

```bash
npm install
npm run dev
```

Open `http://localhost:5173`, sign in, then connect Gmail from the Email outcome tracking panel.

## How to test

```bash
npm run lint
npm run test
npm run build
```

Manual verification:

1. Sign in.
2. Connect Gmail.
3. Click `Sync outcomes`.
4. Confirm recent detected events appear.
5. Confirm matching submitted applications show an outcome when a high-confidence message is found.

## Decisions and assumptions

- Phase 6 uses a conservative heuristic classifier rather than fully automated outcome learning.
- The sync is manual from the dashboard. Scheduled background sync can be added later when the deployment host supports workers or cron.
- The system records detected outcomes but does not yet retrain Answer Memory from them.

## Intentionally deferred

- Scheduled email sync.
- Gmail push notifications.
- Outcome-based automatic answer improvement.
- Multi-account or multi-inbox support.
