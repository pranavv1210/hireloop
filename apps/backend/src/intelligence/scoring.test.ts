import { describe, expect, it } from 'vitest';
import { scoreJobFit } from './scoring.js';

const profile = {
  career_goals: 'Build AI products and machine learning systems.',
  job_hunt_reason: 'Looking for remote AI engineering roles.',
  strengths: 'Python, machine learning, full-stack development, and data science.',
  salary_flexibility: 'Around 9-10 LPA',
  notice_period: 'Immediate',
  additional_context: 'Open to remote roles in India.',
};

describe('fallback fit scoring', () => {
  it('keeps unrelated financial sales roles low even when the profile is AI-heavy', async () => {
    const score = await scoreJobFit(profile, {
      title: 'High-Ticket Financial Sales Specialist & Team Lead Track',
      company: 'FSE LLC',
      location: 'Remote',
      description:
        'Commission sales closer role focused on high-ticket financial sales, cold calls, lead generation, and team leadership.',
      roleCategory: 'Unclassified',
    });

    expect(score.modelName).toBe('heuristic-fallback');
    expect(score.score).toBeLessThanOrEqual(25);
    expect(score.rationale).toContain('substantive');
  });

  it('scores clearly relevant AI engineering roles higher than unrelated sales roles', async () => {
    const score = await scoreJobFit(profile, {
      title: 'Machine Learning Engineer',
      company: 'Relevant AI Co',
      location: 'Remote, India',
      description:
        'Build machine learning models with Python, PyTorch, LLM systems, data pipelines, and MLOps for production AI applications.',
      roleCategory: 'ML/AI Engineering',
    });

    expect(score.modelName).toBe('heuristic-fallback');
    expect(score.score).toBeGreaterThanOrEqual(75);
  });
});
