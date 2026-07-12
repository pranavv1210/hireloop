import crypto from 'node:crypto';
import { generateApplicationAnswer } from '../answerGeneration.js';
import type { AppDatabase } from '../db/database.js';

type ProfileContext = {
  careerGoals: string | null;
  jobHuntReason: string | null;
  strengths: string | null;
  salaryFlexibility: string | null;
  noticePeriod: string | null;
  additionalContext: string | null;
};

type AnswerInput = {
  question: string;
  jobTitle: string;
  company: string;
  companyResearch?: {
    summary: string;
    sourceUrl: string | null;
  } | null;
  profile: ProfileContext;
};

type MemoryRow = {
  id: string;
  question_text: string;
  answer_text: string;
};

export async function generateAnswerWithMemory(
  db: AppDatabase,
  userProfileId: string,
  input: AnswerInput,
  sourceApplicationId: string | null = null,
): Promise<{ answer: string; reused: boolean; matchedQuestion: string | null }> {
  const memory = findSimilarAnswer(db, userProfileId, input.question);
  if (memory && memory.score >= 0.82) {
    return {
      answer: adaptStoredAnswer(memory.row.answer_text, input),
      reused: true,
      matchedQuestion: memory.row.question_text,
    };
  }

  const answer = await generateApplicationAnswer(input);
  rememberAnswer(db, userProfileId, input.question, answer, sourceApplicationId);
  return { answer, reused: false, matchedQuestion: null };
}

export function rememberAnswer(
  db: AppDatabase,
  userProfileId: string,
  question: string,
  answer: string,
  sourceApplicationId: string | null = null,
): void {
  const normalizedQuestion = question.trim();
  const normalizedAnswer = answer.trim();
  if (!normalizedQuestion || !normalizedAnswer) {
    return;
  }

  db.prepare(
    `INSERT INTO answer_memory (
      id, user_profile_id, question_text, answer_text, source_application_id
    ) VALUES (?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), userProfileId, normalizedQuestion, normalizedAnswer, sourceApplicationId);
}

function findSimilarAnswer(
  db: AppDatabase,
  userProfileId: string,
  question: string,
): { row: MemoryRow; score: number } | null {
  const rows = db
    .prepare(
      `SELECT id, question_text, answer_text
       FROM answer_memory
       WHERE user_profile_id = ?
       ORDER BY updated_at DESC
       LIMIT 100`,
    )
    .all(userProfileId) as MemoryRow[];

  let best: { row: MemoryRow; score: number } | null = null;
  for (const row of rows) {
    const score = similarity(question, row.question_text);
    if (!best || score > best.score) {
      best = { row, score };
    }
  }

  return best;
}

function adaptStoredAnswer(answer: string, input: AnswerInput): string {
  return answer
    .replace(/\bthis company\b/gi, input.company)
    .replace(/\bthis role\b/gi, `the ${input.jobTitle} role`)
    .trim();
}

function similarity(a: string, b: string): number {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  if (aTokens.size === 0 || bTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...aTokens, ...bTokens]).size;
  return intersection / union;
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );
}
