# HireLoop Phase 4

## What was built

- Non-LinkedIn job sourcing:
  - Pulls remote-friendly jobs from Remotive's public API.
  - Searches broad role categories: ML/AI, Data Science, Gen-AI, and Full-Stack.
  - Keeps remote/India-friendly locations.
  - Uses the Phase 3 AI/heuristic scoring pipeline.
- Flexible external form filling:
  - Supports conservative attempts on recognized application hosts: Lever, Greenhouse, and Ashby.
  - Fills known identity fields where labels are clear.
  - Uploads the selected local resume where a file input is visible.
  - Generates answers for visible text questions.
  - Skips and logs unsupported or unclear forms instead of submitting bad data.
- Answer Memory:
  - Stores generated question/answer pairs in `answer_memory`.
  - Reuses a previous answer when a new question is highly similar.
  - Records whether an answer was reused and the matched prior question in `answers_json`.
- Dashboard:
  - Added a Non-LinkedIn run control.
  - Skipped external applications appear distinctly through `status = skipped` with `skip_reason`.

## Safety behavior

Non-LinkedIn applications have no daily cap, but they still use strict safety behavior:

- Unsupported hosts are skipped.
- Unclear forms are skipped.
- Dry-run mode is available and should be used first.
- The system does not try to bypass CAPTCHA, login walls, or ambiguous multi-step custom forms.

This preserves the core rule: never submit incomplete, garbled, or guessed information under the user's name.

## How Answer Memory works

Answer Memory uses token similarity over stored questions:

1. Normalize the new question.
2. Compare it to recent stored questions for the user.
3. If similarity is at least `0.82`, adapt the previous answer.
4. Otherwise generate a new answer and store it.

This keeps the implementation free-friendly and deterministic. Embedding-based semantic search can replace the similarity function later without changing the public behavior.

## How to run

```bash
npm install
npx playwright install chromium
npm run dev
```

Open `http://localhost:5173`, sign in, select a resume, and start an external run from the dashboard.

## How to test

```bash
npm run lint
npm run test
npm run build
```

Manual verification:

1. Start a non-LinkedIn dry run.
2. Confirm jobs are sourced and scored.
3. Confirm unsupported forms are logged as skipped with a visible reason.
4. Confirm generated answers are stored in `answers_json`.
5. Run a second dry run with similar questions and confirm `reusedFromMemory` can appear in stored answers.

## Intentionally deferred

- Wider job board coverage.
- Deep custom-site form reasoning.
- Outcome-based answer learning from email replies.
- Dashboard analytics polish, which is handled in Phase 5.
