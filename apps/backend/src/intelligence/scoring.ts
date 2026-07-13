import crypto from 'node:crypto';
import OpenAI from 'openai';
import { config } from '../config.js';
import type { AppDatabase } from '../db/database.js';

type ProfileContext = {
  career_goals: string | null;
  job_hunt_reason: string | null;
  strengths: string | null;
  salary_flexibility: string | null;
  notice_period: string | null;
  additional_context: string | null;
};

export type ScoringJob = {
  id?: string;
  title: string;
  company: string;
  location: string | null;
  description: string | null;
  roleCategory: string | null;
};

export type MatchScore = {
  score: number;
  rationale: string;
  modelName: string;
};

let client: OpenAI | null = null;

export async function scoreJobFit(
  profile: ProfileContext,
  job: ScoringJob,
): Promise<MatchScore> {
  if (!config.openaiApiKey) {
    return fallbackScore(profile, job);
  }

  client ??= new OpenAI({ apiKey: config.openaiApiKey });
  const response = await client.responses.create({
    model: config.openaiModel,
    input: [
      {
        role: 'system',
        content:
          'Score job fit from 0 to 100 for a single user. Salary around 9-10 LPA is a soft preference, not a hard filter. Remote India is preferred. Role scope includes ML/AI, Data Science, Gen-AI, and Full-Stack. Return compact JSON only: {"score":number,"rationale":"..."}',
      },
      {
        role: 'user',
        content: JSON.stringify({ profile, job }),
      },
    ],
  });

  try {
    const parsed = JSON.parse(response.output_text) as { score: number; rationale: string };
    return {
      score: clampScore(parsed.score),
      rationale: parsed.rationale || 'AI fit score generated from job and profile context.',
      modelName: config.openaiModel,
    };
  } catch {
    return fallbackScore(profile, job);
  }
}

export function persistMatchScore(
  db: AppDatabase,
  jobPostingId: string,
  userProfileId: string,
  matchScore: MatchScore,
): void {
  db.prepare(
    `INSERT INTO match_scores (id, job_posting_id, user_profile_id, score, rationale, model_name)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    jobPostingId,
    userProfileId,
    matchScore.score,
    matchScore.rationale,
    matchScore.modelName,
  );
}

function fallbackScore(profile: ProfileContext, job: ScoringJob): MatchScore {
  const jobText = [
    job.title,
    job.description,
    job.roleCategory,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const profileText = [profile.career_goals, profile.strengths, profile.additional_context]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const technicalTerms = countMatches(jobText, [
    'machine learning',
    'deep learning',
    'artificial intelligence',
    'data scientist',
    'data science',
    'generative ai',
    'gen-ai',
    'llm',
    'python',
    'pytorch',
    'tensorflow',
    'model',
    'mlops',
    'computer vision',
    'nlp',
    'full stack',
    'full-stack',
    'react',
    'node',
    'typescript',
    'javascript',
    'backend',
    'frontend',
    'software engineer',
  ]);
  const logisticsTerms = countMatches(jobText, ['remote', 'india', 'asia', 'worldwide', 'anywhere']);
  const unrelatedTerms = countMatches(jobText, [
    'high-ticket',
    'sales',
    'closer',
    'lead generation',
    'cold call',
    'commission',
    'insurance',
    'financial advisor',
    'financial sales',
    'real estate',
    'hospitality',
    'restaurant',
    'retail',
    'customer support',
    'telemarketing',
  ]);
  const profileOverlap = countMatches(jobText, profileText.split(/\W+/).filter((word) => word.length > 4));

  let score = 25 + technicalTerms * 10 + Math.min(logisticsTerms * 3, 8) + Math.min(profileOverlap, 8);

  if (technicalTerms === 0) {
    score = Math.min(score, 38);
  }

  if (unrelatedTerms >= 2 && technicalTerms === 0) {
    score = Math.min(score, 18);
  } else if (unrelatedTerms > technicalTerms) {
    score -= Math.min(30, unrelatedTerms * 8);
  }

  const rationale =
    technicalTerms === 0
      ? 'Fallback score found no substantive ML/AI, data science, or full-stack role signals; logistics words alone were not treated as a strong match.'
      : `Fallback score used ${technicalTerms} substantive technical signal(s), ${logisticsTerms} logistics signal(s), and ${unrelatedTerms} unrelated-domain signal(s).`;

  return {
    score: clampScore(score),
    rationale,
    modelName: 'heuristic-fallback',
  };
}

function countMatches(haystack: string, terms: string[]): number {
  const seen = new Set<string>();
  for (const term of terms) {
    const normalized = term.toLowerCase().trim();
    if (normalized && haystack.includes(normalized)) {
      seen.add(normalized);
    }
  }

  return seen.size;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 50;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}
