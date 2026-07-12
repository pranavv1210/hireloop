import crypto from 'node:crypto';
import type { AppDatabase } from '../db/database.js';

export type CompanyResearch = {
  summary: string;
  sourceUrl: string | null;
};

type ResearchRow = {
  summary: string;
  source_url: string | null;
  researched_at: string;
};

type WikipediaSearchResponse = [string, string[], string[], string[]];
type WikipediaSummaryResponse = {
  extract?: string;
  content_urls?: {
    desktop?: {
      page?: string;
    };
  };
};

export async function getCompanyResearch(
  db: AppDatabase,
  company: string,
): Promise<CompanyResearch | null> {
  const normalizedCompany = normalizeCompany(company);
  if (!normalizedCompany) {
    return null;
  }

  const cached = db
    .prepare(
      `SELECT summary, source_url, researched_at
       FROM company_research
       WHERE company = ?`,
    )
    .get(normalizedCompany) as ResearchRow | undefined;

  if (cached && isFresh(cached.researched_at)) {
    return { summary: cached.summary, sourceUrl: cached.source_url };
  }

  const researched = await researchViaWikipedia(normalizedCompany);
  if (!researched) {
    return null;
  }

  db.prepare(
    `INSERT INTO company_research (id, company, summary, source_url, researched_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(company) DO UPDATE SET
       summary = excluded.summary,
       source_url = excluded.source_url,
       researched_at = CURRENT_TIMESTAMP`,
  ).run(crypto.randomUUID(), normalizedCompany, researched.summary, researched.sourceUrl);

  return researched;
}

async function researchViaWikipedia(company: string): Promise<CompanyResearch | null> {
  const searchUrl = new URL('https://en.wikipedia.org/w/api.php');
  searchUrl.searchParams.set('action', 'opensearch');
  searchUrl.searchParams.set('search', company);
  searchUrl.searchParams.set('limit', '1');
  searchUrl.searchParams.set('namespace', '0');
  searchUrl.searchParams.set('format', 'json');
  searchUrl.searchParams.set('origin', '*');

  const searchResponse = await fetch(searchUrl, { signal: AbortSignal.timeout(6000) });
  if (!searchResponse.ok) {
    return null;
  }

  const search = (await searchResponse.json()) as WikipediaSearchResponse;
  const title = search[1][0];
  if (!title) {
    return null;
  }

  const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const summaryResponse = await fetch(summaryUrl, { signal: AbortSignal.timeout(6000) });
  if (!summaryResponse.ok) {
    return null;
  }

  const summary = (await summaryResponse.json()) as WikipediaSummaryResponse;
  const extract = cleanText(summary.extract ?? '');
  if (!extract) {
    return null;
  }

  return {
    summary: extract.slice(0, 700),
    sourceUrl: summary.content_urls?.desktop?.page ?? search[3][0] ?? null,
  };
}

function normalizeCompany(company: string): string {
  return company.replace(/\s+/g, ' ').trim();
}

function isFresh(value: string): boolean {
  const ageMs = Date.now() - new Date(value).getTime();
  return ageMs < 30 * 24 * 60 * 60 * 1000;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
