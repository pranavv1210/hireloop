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
  const haystack = [
    job.title,
    job.description,
    job.roleCategory,
    profile.career_goals,
    profile.strengths,
    profile.additional_context,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  let score = 45;
  const boosts = [
    ['machine learning', 12],
    ['ml ', 8],
    ['ai', 8],
    ['data scientist', 12],
    ['data science', 10],
    ['generative', 10],
    ['gen-ai', 10],
    ['full stack', 10],
    ['full-stack', 10],
    ['remote', 8],
    ['india', 5],
    ['python', 5],
    ['react', 4],
    ['node', 4],
  ] as const;

  for (const [term, boost] of boosts) {
    if (haystack.includes(term)) {
      score += boost;
    }
  }

  return {
    score: clampScore(score),
    rationale:
      'Fallback score based on role keywords, remote/India signals, and overlap with profile context.',
    modelName: 'heuristic-fallback',
  };
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 50;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}
