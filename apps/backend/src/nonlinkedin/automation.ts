import crypto from 'node:crypto';
import path from 'node:path';
import type { Page } from 'playwright';
import { chromium } from 'playwright';
import type { AppDatabase } from '../db/database.js';
import { generateAnswerWithMemory } from '../intelligence/answerMemory.js';
import { getCompanyResearch, type CompanyResearch } from '../intelligence/companyResearch.js';
import { persistMatchScore, scoreJobFit, type MatchScore } from '../intelligence/scoring.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

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
  email: string | null;
  display_name: string | null;
};

type ResumeRow = {
  id: string;
  storage_path: string;
};

type JobCandidate = {
  title: string;
  company: string;
  location: string | null;
  salaryText: string | null;
  url: string;
  source: string;
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

type RemotiveJob = {
  id: number;
  title: string;
  company_name: string;
  candidate_required_location: string;
  salary: string;
  url: string;
  description: string;
};

type RemotiveResponse = {
  jobs: RemotiveJob[];
};

export async function runNonLinkedInAgent(
  db: AppDatabase,
  userProfileId: string,
  options: RunOptions = {},
) {
  const runId = crypto.randomUUID();
  const maxApplications = Math.max(1, Math.min(options.maxApplications ?? 10, 50));
  const resume = getSelectedResume(db, userProfileId);

  db.prepare(
    `INSERT INTO agent_runs (id, user_profile_id, resume_id, status, source_scope, started_at, config_json)
     VALUES (?, ?, ?, 'running', 'non_linkedin', CURRENT_TIMESTAMP, ?)`,
  ).run(runId, userProfileId, resume?.id ?? null, JSON.stringify({ maxApplications, dryRun: !!options.dryRun }));

  let browser;
  let submitted = 0;
  let skipped = 0;

  try {
    if (!resume) {
      throw new Error('Select a resume before starting a non-LinkedIn run');
    }

    const sourced = await sourceRemoteJobs();
    const prioritized = await scoreAndPrioritizeCandidates(db, userProfileId, sourced);
    browser = await chromium.launch({ headless: config.linkedinHeadless });
    const page = await browser.newPage();

    for (const candidate of prioritized.slice(0, maxApplications)) {
      try {
        const result = await applyToExternalJob(
          db,
          page,
          userProfileId,
          resume,
          candidate,
          Boolean(options.dryRun),
        );

        if (result === 'submitted') {
          submitted += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        skipped += 1;
        logApplication(db, userProfileId, resume.id, candidate, 'skipped', {
          skipReason: error instanceof Error ? error.message : 'Unknown external application error',
        });
      }
    }

    finishRun(db, runId, 'completed');
    return { runId, status: 'completed' as const, submitted, skipped };
  } catch (error) {
    finishRun(db, runId, 'failed', error instanceof Error ? error.message : 'Unknown run error');
    throw error;
  } finally {
    await browser?.close();
  }
}

async function sourceRemoteJobs(): Promise<JobCandidate[]> {
  const queries = ['machine learning', 'data scientist', 'generative ai', 'full stack'];
  const candidates: JobCandidate[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    const url = new URL('https://remotive.com/api/remote-jobs');
    url.searchParams.set('search', query);
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      continue;
    }

    const data = (await response.json()) as RemotiveResponse;
    for (const job of data.jobs.slice(0, 15)) {
      if (seen.has(job.url) || !isIndiaRemoteFriendly(job.candidate_required_location)) {
        continue;
      }

      seen.add(job.url);
      candidates.push({
        title: cleanText(job.title),
        company: cleanText(job.company_name),
        location: cleanTextOrNull(job.candidate_required_location),
        salaryText: cleanTextOrNull(job.salary),
        url: job.url,
        source: 'remotive',
        sourceJobId: String(job.id),
        description: stripHtml(job.description).slice(0, 2000),
        roleCategory: inferRoleCategory(`${job.title} ${query}`),
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
  const scored: JobCandidate[] = [];

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
    scored.push({ ...candidate, jobPostingId, matchScore });
  }

  return scored.sort((a, b) => (b.matchScore?.score ?? 0) - (a.matchScore?.score ?? 0));
}

async function applyToExternalJob(
  db: AppDatabase,
  page: Page,
  userProfileId: string,
  resume: ResumeRow,
  candidate: JobCandidate,
  dryRun: boolean,
): Promise<'submitted' | 'skipped'> {
  await page.goto(candidate.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const finalUrl = page.url();
  if (!isSupportedApplicationHost(finalUrl)) {
    logApplication(db, userProfileId, resume.id, candidate, 'skipped', {
      skipReason: `Unsupported or unrecognized application host: ${new URL(finalUrl).hostname}`,
    });
    return 'skipped';
  }

  const profile = getProfile(db, userProfileId);
  const companyResearch = await getCompanyResearch(db, candidate.company).catch(() => null);
  const answers = await fillRecognizedForm(db, page, userProfileId, resume, candidate, profile, companyResearch);

  if (dryRun) {
    logApplication(db, userProfileId, resume.id, candidate, 'skipped', {
      skipReason: 'Dry run reached external submit step',
      answers,
    });
    return 'skipped';
  }

  const submitButton = page
    .locator('button[type="submit"], input[type="submit"], button:has-text("Submit application"), button:has-text("Apply")')
    .last();
  if (!(await submitButton.count()) || !(await submitButton.isEnabled())) {
    logApplication(db, userProfileId, resume.id, candidate, 'skipped', {
      skipReason: 'Could not confidently find enabled submit control',
      answers,
    });
    return 'skipped';
  }

  await submitButton.click();
  await page.waitForTimeout(1500);
  logApplication(db, userProfileId, resume.id, candidate, 'submitted', { answers });
  return 'submitted';
}

async function fillRecognizedForm(
  db: AppDatabase,
  page: Page,
  userProfileId: string,
  resume: ResumeRow,
  candidate: JobCandidate,
  profile: ProfileRow,
  companyResearch: CompanyResearch | null,
): Promise<SubmittedAnswer[]> {
  const answers: SubmittedAnswer[] = [];

  await fillKnownIdentityFields(page, profile);
  const fileInputs = page.locator('input[type="file"]:visible');
  for (let index = 0; index < (await fileInputs.count()); index += 1) {
    await fileInputs.nth(index).setInputFiles(path.resolve(resume.storage_path)).catch(() => undefined);
  }

  const textControls = page.locator('textarea:visible, input[type="text"]:visible');
  for (let index = 0; index < (await textControls.count()); index += 1) {
    const control = textControls.nth(index);
    if ((await control.inputValue().catch(() => '')).trim()) {
      continue;
    }

    const question = await inferQuestionText(control);
    if (!question || isIdentityQuestion(question)) {
      continue;
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
    await control.fill(generated.answer);
    answers.push({
      question,
      answer: generated.answer,
      reusedFromMemory: generated.reused,
      matchedQuestion: generated.matchedQuestion,
    });
  }

  return answers;
}

async function fillKnownIdentityFields(page: Page, profile: ProfileRow): Promise<void> {
  const name = profile.display_name ?? '';
  const email = profile.email ?? '';
  const fields = [
    { selector: 'input[name*="name" i], input[aria-label*="name" i]', value: name },
    { selector: 'input[type="email"], input[name*="email" i], input[aria-label*="email" i]', value: email },
  ];

  for (const field of fields) {
    if (!field.value) {
      continue;
    }

    const locator = page.locator(field.selector);
    for (let index = 0; index < Math.min(await locator.count(), 3); index += 1) {
      const input = locator.nth(index);
      if (!(await input.inputValue().catch(() => '')).trim()) {
        await input.fill(field.value).catch(() => undefined);
      }
    }
  }
}

function getProfile(db: AppDatabase, userProfileId: string): ProfileRow {
  return db
    .prepare(
      `SELECT email, display_name, career_goals, job_hunt_reason, strengths,
        salary_flexibility, notice_period, additional_context
       FROM user_profiles
       WHERE id = ?`,
    )
    .get(userProfileId) as ProfileRow;
}

function getSelectedResume(db: AppDatabase, userProfileId: string): ResumeRow | null {
  return (
    (db
      .prepare('SELECT id, storage_path FROM resumes WHERE user_profile_id = ? AND is_selected = 1')
      .get(userProfileId) as ResumeRow | undefined) ?? null
  );
}

function logApplication(
  db: AppDatabase,
  userProfileId: string,
  resumeId: string,
  candidate: JobCandidate,
  status: 'submitted' | 'skipped',
  options: { skipReason?: string; answers?: SubmittedAnswer[] },
): void {
  const jobPostingId = upsertJobPosting(db, candidate);
  db.prepare(
    `INSERT INTO applications (
      id, user_profile_id, job_posting_id, resume_id, source, status, submitted_at,
      skipped_at, skip_reason, answers_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    userProfileId,
    jobPostingId,
    resumeId,
    candidate.source,
    status,
    status === 'submitted' ? new Date().toISOString() : null,
    status === 'skipped' ? new Date().toISOString() : null,
    options.skipReason ?? null,
    JSON.stringify(options.answers ?? []),
  );

  if (status === 'skipped') {
    logger.warn({ candidate, reason: options.skipReason }, 'Non-LinkedIn application skipped');
  }
}

function upsertJobPosting(db: AppDatabase, candidate: JobCandidate): string {
  if (candidate.jobPostingId) {
    return candidate.jobPostingId;
  }

  const existing = db
    .prepare('SELECT id FROM job_postings WHERE source = ? AND source_job_id = ?')
    .get(candidate.source, candidate.sourceJobId) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE job_postings
       SET title = ?, company = ?, location = ?, salary_text = ?, posting_url = ?,
         description = ?, role_category = ?, last_seen_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(
      candidate.title,
      candidate.company,
      candidate.location,
      candidate.salaryText,
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
      id, source, source_job_id, title, company, location, salary_text, posting_url,
      description, role_category
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    candidate.source,
    candidate.sourceJobId,
    candidate.title,
    candidate.company,
    candidate.location,
    candidate.salaryText,
    candidate.url,
    candidate.description,
    candidate.roleCategory,
  );
  return id;
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

  return cleanTextOrNull(await input.locator('xpath=ancestor::*[self::label or self::div][1]').textContent().catch(() => null));
}

function isSupportedApplicationHost(value: string): boolean {
  const hostname = new URL(value).hostname.toLowerCase();
  return hostname.includes('lever.co') || hostname.includes('greenhouse.io') || hostname.includes('ashbyhq.com');
}

function isIdentityQuestion(question: string): boolean {
  const normalized = question.toLowerCase();
  return ['name', 'email', 'phone', 'linkedin', 'website', 'location'].some((term) =>
    normalized.includes(term),
  );
}

function isIndiaRemoteFriendly(location: string): boolean {
  const normalized = location.toLowerCase();
  return (
    normalized.includes('india') ||
    normalized.includes('worldwide') ||
    normalized.includes('anywhere') ||
    normalized.includes('asia') ||
    normalized.includes('remote')
  );
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

  if (
    normalized.includes('machine learning') ||
    normalized.includes('ml engineer') ||
    normalized.includes(' ai ') ||
    normalized.includes('artificial intelligence') ||
    normalized.includes('python') ||
    normalized.includes('llm')
  ) {
    return 'ML/AI Engineering';
  }

  return 'Unclassified';
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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
