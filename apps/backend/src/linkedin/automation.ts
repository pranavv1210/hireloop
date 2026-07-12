import crypto from 'node:crypto';
import type { Page } from 'playwright';
import { chromium } from 'playwright';
import { config } from '../config.js';
import type { AppDatabase } from '../db/database.js';
import { generateAnswerWithMemory } from '../intelligence/answerMemory.js';
import { getCompanyResearch, type CompanyResearch } from '../intelligence/companyResearch.js';
import {
  persistMatchScore,
  scoreJobFit,
  type MatchScore,
} from '../intelligence/scoring.js';
import { logger } from '../logger.js';

const linkedinDailyCap = 15;

type Credentials = {
  email: string;
  password: string;
};

type RunOptions = {
  maxApplications?: number;
  dryRun?: boolean;
};

type ProfileRow = {
  career_goals: string | null;
  job_hunt_reason: string | null;
  strengths: string | null;
  salary_flexibility: string | null;
  notice_period: string | null;
  additional_context: string | null;
};

type SelectedResumeRow = {
  id: string;
};

type JobCandidate = {
  title: string;
  company: string;
  location: string | null;
  url: string;
  sourceJobId: string | null;
  description: string | null;
  roleCategory: string | null;
  jobPostingId?: string;
  matchScore?: MatchScore;
};

type SubmittedAnswer = {
  question: string;
  answer: string;
  reusedFromMemory?: boolean;
  matchedQuestion?: string | null;
};

type RunResult = {
  runId: string;
  status: 'completed' | 'failed';
  submitted: number;
  skipped: number;
  remainingToday: number;
};

export function getLinkedInDailyStatus(db: AppDatabase, userProfileId: string) {
  const used = countLinkedInApplicationsToday(db, userProfileId);
  return {
    cap: linkedinDailyCap,
    used,
    remaining: Math.max(0, linkedinDailyCap - used),
    dayKey: getTodayKey(),
  };
}

export async function runLinkedInAgent(
  db: AppDatabase,
  userProfileId: string,
  credentials: Credentials,
  options: RunOptions = {},
): Promise<RunResult> {
  const runId = crypto.randomUUID();
  const maxApplications = Math.min(options.maxApplications ?? 5, linkedinDailyCap);
  const resume = getSelectedResume(db, userProfileId);

  db.prepare(
    `INSERT INTO agent_runs (id, user_profile_id, resume_id, status, source_scope, started_at, config_json)
     VALUES (?, ?, ?, 'running', 'linkedin', CURRENT_TIMESTAMP, ?)`,
  ).run(runId, userProfileId, resume?.id ?? null, JSON.stringify({ maxApplications, dryRun: !!options.dryRun }));

  let submitted = 0;
  let skipped = 0;
  let browser;

  try {
    if (!resume) {
      throw new Error('Select a resume before starting a LinkedIn run');
    }

    const dailyStatus = getLinkedInDailyStatus(db, userProfileId);
    if (dailyStatus.remaining <= 0) {
      addRunEvent(db, runId, 'cap_blocked', 'LinkedIn daily cap already reached');
      finishRun(db, runId, 'completed');
      return { runId, status: 'completed', submitted: 0, skipped: 0, remainingToday: 0 };
    }

    browser = await chromium.launch({ headless: config.linkedinHeadless });
    const page = await browser.newPage();
    await login(page, credentials);

    const candidates = await collectCandidates(page);
    const prioritizedCandidates = await scoreAndPrioritizeCandidates(db, userProfileId, candidates);
    addRunEvent(
      db,
      runId,
      'jobs_scored',
      `Found and scored ${prioritizedCandidates.length} LinkedIn Easy Apply candidates`,
      {
        count: prioritizedCandidates.length,
        topScore: prioritizedCandidates[0]?.matchScore?.score ?? null,
      },
    );

    for (const candidate of prioritizedCandidates) {
      if (submitted >= maxApplications) {
        break;
      }

      if (getLinkedInDailyStatus(db, userProfileId).remaining <= 0) {
        addRunEvent(db, runId, 'cap_blocked', 'Stopped before submission because daily cap was reached');
        break;
      }

      try {
        const result = await applyToCandidate(db, page, userProfileId, resume.id, candidate, options.dryRun);
        if (result === 'submitted') {
          submitted += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        skipped += 1;
        logSkippedApplication(
          db,
          userProfileId,
          resume.id,
          candidate,
          error instanceof Error ? error.message : 'Unknown LinkedIn automation error',
        );
      }
    }

    finishRun(db, runId, 'completed');
    return {
      runId,
      status: 'completed',
      submitted,
      skipped,
      remainingToday: getLinkedInDailyStatus(db, userProfileId).remaining,
    };
  } catch (error) {
    finishRun(db, runId, 'failed', error instanceof Error ? error.message : 'Unknown run error');
    throw error;
  } finally {
    await browser?.close();
  }
}

async function login(page: Page, credentials: Credentials): Promise<void> {
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input#username', credentials.email);
  await page.fill('input#password', credentials.password);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click('button[type="submit"]'),
  ]);

  if (page.url().includes('/checkpoint/') || (await page.locator('input#input__email_verification_pin').count())) {
    throw new Error('LinkedIn requires additional verification; run skipped');
  }

  await page.waitForTimeout(1500);
  if (page.url().includes('/login')) {
    throw new Error('LinkedIn login failed');
  }
}

async function collectCandidates(page: Page): Promise<JobCandidate[]> {
  const roleQueries = ['machine learning engineer', 'data scientist', 'generative ai engineer', 'full stack engineer'];
  const candidates: JobCandidate[] = [];
  const seen = new Set<string>();

  for (const query of roleQueries) {
    const url = new URL('https://www.linkedin.com/jobs/search/');
    url.searchParams.set('keywords', query);
    url.searchParams.set('location', 'India');
    url.searchParams.set('f_WT', '2');
    url.searchParams.set('f_AL', 'true');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const cards = page.locator('[data-job-id], .job-card-container, .jobs-search-results__list-item');
    const count = Math.min(await cards.count(), 12);

    for (let index = 0; index < count; index += 1) {
      const card = cards.nth(index);
      const link = card.locator('a[href*="/jobs/view/"]').first();
      if (!(await link.count())) {
        continue;
      }

      const href = await link.getAttribute('href');
      if (!href) {
        continue;
      }

      const candidateUrl = new URL(href, 'https://www.linkedin.com').toString();
      if (seen.has(candidateUrl)) {
        continue;
      }

      const title = cleanText((await card.locator('strong, .job-card-list__title, a[href*="/jobs/view/"]').first().textContent()) ?? 'LinkedIn role');
      const company = cleanText((await card.locator('.job-card-container__primary-description, .artdeco-entity-lockup__subtitle').first().textContent()) ?? 'Unknown company');
      const location = cleanTextOrNull(await card.locator('.job-card-container__metadata-item').first().textContent().catch(() => null));
      seen.add(candidateUrl);
      candidates.push({
        title,
        company,
        location,
        url: candidateUrl,
        sourceJobId: extractLinkedInJobId(candidateUrl),
        description: null,
        roleCategory: inferRoleCategory(`${title} ${query}`),
      });
    }
  }

  return candidates;
}

async function scoreAndPrioritizeCandidates(
  db: AppDatabase,
  userProfileId: string,
  candidates: JobCandidate[],
): Promise<JobCandidate[]> {
  const profile = getProfile(db, userProfileId);
  const scoredCandidates: JobCandidate[] = [];

  for (const candidate of candidates) {
    const jobPostingId = upsertJobPosting(db, candidate);
    const matchScore = await scoreJobFit(
      {
        career_goals: profile.career_goals,
        job_hunt_reason: profile.job_hunt_reason,
        strengths: profile.strengths,
        salary_flexibility: profile.salary_flexibility,
        notice_period: profile.notice_period,
        additional_context: profile.additional_context,
      },
      {
        id: jobPostingId,
        title: candidate.title,
        company: candidate.company,
        location: candidate.location,
        description: candidate.description,
        roleCategory: candidate.roleCategory,
      },
    );

    persistMatchScore(db, jobPostingId, userProfileId, matchScore);
    scoredCandidates.push({ ...candidate, jobPostingId, matchScore });
  }

  return scoredCandidates.sort((a, b) => (b.matchScore?.score ?? 0) - (a.matchScore?.score ?? 0));
}

async function applyToCandidate(
  db: AppDatabase,
  page: Page,
  userProfileId: string,
  resumeId: string,
  candidate: JobCandidate,
  dryRun = false,
): Promise<'submitted' | 'skipped'> {
  await page.goto(candidate.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const easyApplyButton = page
    .locator('button[aria-label*="Easy Apply"], button:has-text("Easy Apply")')
    .first();
  if (!(await easyApplyButton.count())) {
    logSkippedApplication(db, userProfileId, resumeId, candidate, 'Easy Apply button not found');
    return 'skipped';
  }

  await easyApplyButton.click();
  await page.waitForTimeout(1000);

  const answers: SubmittedAnswer[] = [];
  const profile = getProfile(db, userProfileId);
  const companyResearch = await getCompanyResearch(db, candidate.company).catch(() => null);

  for (let step = 0; step < 8; step += 1) {
    await answerVisibleQuestions(db, page, userProfileId, candidate, profile, companyResearch, answers);

    const submitButton = page
      .locator('button[aria-label*="Submit application"], button:has-text("Submit application")')
      .last();
    if (await submitButton.count()) {
      if (dryRun) {
        logSkippedApplication(db, userProfileId, resumeId, candidate, 'Dry run reached submit step', answers);
        await closeModal(page);
        return 'skipped';
      }

      if (getLinkedInDailyStatus(db, userProfileId).remaining <= 0) {
        logSkippedApplication(db, userProfileId, resumeId, candidate, 'Daily cap reached before submit', answers);
        await closeModal(page);
        return 'skipped';
      }

      await submitButton.click();
      await page.waitForTimeout(1500);
      logSubmittedApplication(db, userProfileId, resumeId, candidate, answers);
      return 'submitted';
    }

    const nextButton = page
      .locator('button[aria-label*="Continue"], button[aria-label*="Next"], button:has-text("Next"), button:has-text("Review")')
      .last();
    if (!(await nextButton.count()) || !(await nextButton.isEnabled())) {
      logSkippedApplication(db, userProfileId, resumeId, candidate, 'Could not confidently continue Easy Apply form', answers);
      await closeModal(page);
      return 'skipped';
    }

    await nextButton.click();
    await page.waitForTimeout(900);
  }

  logSkippedApplication(db, userProfileId, resumeId, candidate, 'Easy Apply form exceeded supported step count', answers);
  await closeModal(page);
  return 'skipped';
}

async function answerVisibleQuestions(
  db: AppDatabase,
  page: Page,
  userProfileId: string,
  candidate: JobCandidate,
  profile: ProfileRow,
  companyResearch: CompanyResearch | null,
  answers: SubmittedAnswer[],
): Promise<void> {
  const textInputs = page.locator('input[type="text"]:visible, textarea:visible');
  const inputCount = await textInputs.count();

  for (let index = 0; index < inputCount; index += 1) {
    const input = textInputs.nth(index);
    const currentValue = await input.inputValue().catch(() => '');
    if (currentValue.trim()) {
      continue;
    }

    const question = await inferQuestionText(input);
    if (!question) {
      throw new Error('Unlabeled text input encountered');
    }

    const generated = await generateAnswerWithMemory(db, userProfileId, {
      question,
      jobTitle: candidate.title,
      company: candidate.company,
      companyResearch,
      profile: {
        careerGoals: profile.career_goals,
        jobHuntReason: profile.job_hunt_reason,
        strengths: profile.strengths,
        salaryFlexibility: profile.salary_flexibility,
        noticePeriod: profile.notice_period,
        additionalContext: profile.additional_context,
      },
    });
    const answer = generated.answer;
    await input.fill(answer);
    answers.push({
      question,
      answer,
      reusedFromMemory: generated.reused,
      matchedQuestion: generated.matchedQuestion,
    });
  }
}

async function inferQuestionText(input: ReturnType<Page['locator']>): Promise<string | null> {
  const ariaLabel = await input.getAttribute('aria-label');
  if (ariaLabel) {
    return cleanText(ariaLabel);
  }

  const id = await input.getAttribute('id');
  if (id) {
    const label = input.page().locator(`label[for="${cssEscape(id)}"]`).first();
    if (await label.count()) {
      return cleanText((await label.textContent()) ?? '');
    }
  }

  const ancestorText = await input.locator('xpath=ancestor::*[self::label or self::div][1]').textContent().catch(() => null);
  return cleanTextOrNull(ancestorText);
}

async function closeModal(page: Page): Promise<void> {
  const discardButton = page.locator('button[aria-label*="Dismiss"], button[aria-label*="Close"]').first();
  if (await discardButton.count()) {
    await discardButton.click().catch(() => undefined);
  }

  const confirmDiscard = page.locator('button:has-text("Discard"), button:has-text("Discard application")').last();
  if (await confirmDiscard.count()) {
    await confirmDiscard.click().catch(() => undefined);
  }
}

function getSelectedResume(db: AppDatabase, userProfileId: string): SelectedResumeRow | null {
  return (
    (db
      .prepare('SELECT id FROM resumes WHERE user_profile_id = ? AND is_selected = 1')
      .get(userProfileId) as SelectedResumeRow | undefined) ?? null
  );
}

function getProfile(db: AppDatabase, userProfileId: string): ProfileRow {
  return db
    .prepare(
      `SELECT career_goals, job_hunt_reason, strengths, salary_flexibility, notice_period, additional_context
       FROM user_profiles
       WHERE id = ?`,
    )
    .get(userProfileId) as ProfileRow;
}

function countLinkedInApplicationsToday(db: AppDatabase, userProfileId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM applications
       WHERE user_profile_id = ?
         AND source = 'linkedin'
         AND status = 'submitted'
         AND substr(submitted_at, 1, 10) = ?`,
    )
    .get(userProfileId, getTodayKey()) as { count: number };

  return row.count;
}

function logSubmittedApplication(
  db: AppDatabase,
  userProfileId: string,
  resumeId: string,
  candidate: JobCandidate,
  answers: SubmittedAnswer[],
): void {
  const jobPostingId = upsertJobPosting(db, candidate);
  db.prepare(
    `INSERT INTO applications (
      id, user_profile_id, job_posting_id, resume_id, source, status, submitted_at, answers_json
    ) VALUES (?, ?, ?, ?, 'linkedin', 'submitted', CURRENT_TIMESTAMP, ?)`,
  ).run(crypto.randomUUID(), userProfileId, jobPostingId, resumeId, JSON.stringify(answers));
}

function logSkippedApplication(
  db: AppDatabase,
  userProfileId: string,
  resumeId: string,
  candidate: JobCandidate,
  reason: string,
  answers: SubmittedAnswer[] = [],
): void {
  const jobPostingId = upsertJobPosting(db, candidate);
  db.prepare(
    `INSERT INTO applications (
      id, user_profile_id, job_posting_id, resume_id, source, status, skipped_at, skip_reason, answers_json
    ) VALUES (?, ?, ?, ?, 'linkedin', 'skipped', CURRENT_TIMESTAMP, ?, ?)`,
  ).run(crypto.randomUUID(), userProfileId, jobPostingId, resumeId, reason, JSON.stringify(answers));
  logger.warn({ candidate, reason }, 'LinkedIn application skipped');
}

function upsertJobPosting(db: AppDatabase, candidate: JobCandidate): string {
  if (candidate.jobPostingId) {
    return candidate.jobPostingId;
  }

  const existing = db
    .prepare('SELECT id FROM job_postings WHERE source = ? AND source_job_id = ?')
    .get('linkedin', candidate.sourceJobId) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE job_postings
       SET title = ?, company = ?, location = ?, posting_url = ?, description = ?,
         role_category = ?, last_seen_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(
      candidate.title,
      candidate.company,
      candidate.location,
      candidate.url,
      candidate.description,
      candidate.roleCategory,
      existing.id,
    );
    return existing.id;
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO job_postings (
      id, source, source_job_id, title, company, location, posting_url, description, role_category
    ) VALUES (?, 'linkedin', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    candidate.sourceJobId,
    candidate.title,
    candidate.company,
    candidate.location,
    candidate.url,
    candidate.description,
    candidate.roleCategory,
  );
  return id;
}

function addRunEvent(
  db: AppDatabase,
  runId: string,
  eventType: string,
  message: string,
  metadata: Record<string, unknown> = {},
): void {
  db.prepare(
    `INSERT INTO linkedin_run_events (id, agent_run_id, event_type, message, metadata_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), runId, eventType, message, JSON.stringify(metadata));
}

function finishRun(
  db: AppDatabase,
  runId: string,
  status: 'completed' | 'failed',
  errorMessage: string | null = null,
): void {
  db.prepare(
    `UPDATE agent_runs
     SET status = ?, completed_at = CURRENT_TIMESTAMP, error_message = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(status, errorMessage, runId);
}

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function extractLinkedInJobId(url: string): string | null {
  return /\/jobs\/view\/(\d+)/.exec(url)?.[1] ?? null;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function cleanTextOrNull(value: string | null): string | null {
  const cleaned = value ? cleanText(value) : '';
  return cleaned || null;
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function inferRoleCategory(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes('data scientist') || normalized.includes('data science')) {
    return 'Data Science';
  }

  if (normalized.includes('generative') || normalized.includes('gen-ai') || normalized.includes('gen ai')) {
    return 'Gen-AI Engineering';
  }

  if (normalized.includes('full stack') || normalized.includes('full-stack')) {
    return 'Full-Stack';
  }

  return 'ML/AI Engineering';
}
