import OpenAI from 'openai';
import { config } from './config.js';

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

let client: OpenAI | null = null;

export async function generateApplicationAnswer(input: AnswerInput): Promise<string> {
  if (!config.openaiApiKey) {
    return fallbackAnswer(input);
  }

  client ??= new OpenAI({ apiKey: config.openaiApiKey });
  const response = await client.responses.create({
    model: config.openaiModel,
    input: [
      {
        role: 'system',
        content:
          'You write concise, truthful job application screening answers. Stay neutral about current employment status unless directly asked about it. Do not invent credentials, experience, salary, notice period, or availability.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          question: input.question,
          jobTitle: input.jobTitle,
          company: input.company,
          companyResearch: input.companyResearch,
          profile: input.profile,
          instruction: 'Return only the exact answer text to submit.',
        }),
      },
    ],
  });

  return response.output_text.trim();
}

function fallbackAnswer(input: AnswerInput): string {
  const lowerQuestion = input.question.toLowerCase();

  if (lowerQuestion.includes('notice')) {
    return input.profile.noticePeriod || 'My notice period is flexible and can be discussed.';
  }

  if (lowerQuestion.includes('salary') || lowerQuestion.includes('ctc')) {
    return input.profile.salaryFlexibility || 'I am flexible and open to discussing compensation.';
  }

  if (lowerQuestion.includes('why') && lowerQuestion.includes('company')) {
    if (input.companyResearch?.summary) {
      return `I am interested in ${input.company} because ${input.companyResearch.summary.slice(0, 180)} The ${input.jobTitle} role also aligns with my career goals and strengths.`;
    }

    return `I am interested in ${input.company} because the ${input.jobTitle} role aligns with my career goals and strengths.`;
  }

  if (input.profile.strengths) {
    return input.profile.strengths;
  }

  return 'This role aligns with my background, goals, and current job search preferences.';
}
