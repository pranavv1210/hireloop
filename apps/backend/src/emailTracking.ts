import crypto from 'node:crypto';
import type { AppDatabase } from './db/database.js';
import { refreshGoogleAccessToken } from './google.js';
import { decryptCredential } from './security/credentialCrypto.js';

type EmailConnectionRow = {
  encrypted_refresh_token_json: string;
  gmail_email: string | null;
};

type GmailListResponse = {
  messages?: Array<{ id: string; threadId: string }>;
};

type GmailMessageResponse = {
  id: string;
  threadId: string;
  internalDate?: string;
  snippet?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
};

type ApplicationMatchRow = {
  id: string;
  title: string;
  company: string;
};

type EmailEventRow = {
  id: string;
  application_id: string | null;
  gmail_message_id: string;
  from_email: string | null;
  subject: string | null;
  snippet: string | null;
  detected_status: string;
  confidence: number;
  received_at: string | null;
  created_at: string;
};

type SyncResult = {
  scanned: number;
  detected: number;
  updatedApplications: number;
};

export function getEmailTrackingStatus(db: AppDatabase, userProfileId: string) {
  const connection = db
    .prepare(
      `SELECT gmail_email, connected_at, last_sync_at
       FROM google_email_connections
       WHERE user_profile_id = ?`,
    )
    .get(userProfileId) as
    | { gmail_email: string | null; connected_at: string; last_sync_at: string | null }
    | undefined;
  const recentEvents = db
    .prepare(
      `SELECT id, application_id, gmail_message_id, from_email, subject, snippet, detected_status,
        confidence, received_at, created_at
       FROM email_events
       WHERE user_profile_id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
    )
    .all(userProfileId) as EmailEventRow[];

  return {
    connected: Boolean(connection),
    gmailEmail: connection?.gmail_email ?? null,
    connectedAt: connection?.connected_at ?? null,
    lastSyncAt: connection?.last_sync_at ?? null,
    recentEvents: recentEvents.map((event) => ({
      id: event.id,
      applicationId: event.application_id,
      gmailMessageId: event.gmail_message_id,
      fromEmail: event.from_email,
      subject: event.subject,
      snippet: event.snippet,
      detectedStatus: event.detected_status,
      confidence: event.confidence,
      receivedAt: event.received_at,
      createdAt: event.created_at,
    })),
  };
}

export async function syncEmailOutcomes(
  db: AppDatabase,
  userProfileId: string,
): Promise<SyncResult> {
  const connection = db
    .prepare(
      `SELECT encrypted_refresh_token_json, gmail_email
       FROM google_email_connections
       WHERE user_profile_id = ?`,
    )
    .get(userProfileId) as EmailConnectionRow | undefined;

  if (!connection) {
    throw new Error('Connect Gmail before syncing email outcomes');
  }

  const refreshToken = decryptCredential(connection.encrypted_refresh_token_json);
  const token = await refreshGoogleAccessToken(refreshToken);
  const messages = await listRecentGmailMessages(token.access_token);

  let detected = 0;
  let updatedApplications = 0;

  for (const messageRef of messages) {
    const message = await getGmailMessage(token.access_token, messageRef.id);
    const headers = getHeaders(message);
    const subject = headers.subject ?? '';
    const fromEmail = headers.from ?? '';
    const snippet = message.snippet ?? '';
    const classified = classifyOutcome(`${subject}\n${fromEmail}\n${snippet}`);

    if (!classified) {
      continue;
    }

    detected += 1;
    const application = findMatchingApplication(db, userProfileId, subject, fromEmail, snippet);
    const receivedAt = message.internalDate
      ? new Date(Number(message.internalDate)).toISOString()
      : null;

    const inserted = insertEmailEvent(db, {
      userProfileId,
      applicationId: application?.id ?? null,
      gmailMessageId: message.id,
      threadId: message.threadId,
      fromEmail,
      subject,
      snippet,
      detectedStatus: classified.status,
      confidence: classified.confidence,
      receivedAt,
    });

    if (inserted && application) {
      updateApplicationOutcome(
        db,
        application.id,
        classified.status,
        classified.confidence,
        message.id,
      );
      updatedApplications += 1;
    }
  }

  db.prepare(
    `UPDATE google_email_connections
     SET last_sync_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE user_profile_id = ?`,
  ).run(userProfileId);

  return { scanned: messages.length, detected, updatedApplications };
}

async function listRecentGmailMessages(accessToken: string) {
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  url.searchParams.set(
    'q',
    'newer_than:90d (interview OR rejected OR rejection OR selected OR shortlisted OR application OR assessment OR next steps)',
  );
  url.searchParams.set('maxResults', '25');

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Gmail message list failed with ${response.status}`);
  }

  const data = (await response.json()) as GmailListResponse;
  return data.messages ?? [];
}

async function getGmailMessage(accessToken: string, id: string): Promise<GmailMessageResponse> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
  url.searchParams.set('format', 'metadata');
  url.searchParams.append('metadataHeaders', 'Subject');
  url.searchParams.append('metadataHeaders', 'From');
  url.searchParams.append('metadataHeaders', 'Date');

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Gmail message fetch failed with ${response.status}`);
  }

  return (await response.json()) as GmailMessageResponse;
}

function classifyOutcome(text: string): { status: string; confidence: number } | null {
  const normalized = text.toLowerCase();
  const patterns: Array<[string, RegExp[], number]> = [
    ['interview', [/\binterview\b/, /\bschedule\b/, /\bavailability\b/, /\bnext round\b/], 0.9],
    ['assessment', [/\bassessment\b/, /\bcoding test\b/, /\btake.home\b/, /\bassignment\b/], 0.82],
    ['rejected', [/\bunfortunately\b/, /\bnot moving forward\b/, /\bnot selected\b/, /\breject/], 0.88],
    ['viewed', [/\bviewed\b/, /\breviewed\b/, /\bapplication received\b/, /\bwe received\b/], 0.68],
  ];

  for (const [status, regexes, confidence] of patterns) {
    if (regexes.some((regex) => regex.test(normalized))) {
      return { status, confidence };
    }
  }

  return null;
}

function findMatchingApplication(
  db: AppDatabase,
  userProfileId: string,
  subject: string,
  fromEmail: string,
  snippet: string,
): ApplicationMatchRow | null {
  const applications = db
    .prepare(
      `SELECT applications.id, job_postings.title, job_postings.company
       FROM applications
       JOIN job_postings ON job_postings.id = applications.job_posting_id
       WHERE applications.user_profile_id = ?
         AND applications.status = 'submitted'
       ORDER BY applications.submitted_at DESC
       LIMIT 200`,
    )
    .all(userProfileId) as ApplicationMatchRow[];
  const haystack = `${subject} ${fromEmail} ${snippet}`.toLowerCase();

  return (
    applications.find((application) => {
      const company = application.company.toLowerCase();
      const titleTokens = tokenize(application.title);
      const companyMatch = company && haystack.includes(company);
      const titleMatch = [...titleTokens].some((token) => haystack.includes(token));
      return companyMatch || (titleMatch && titleTokens.size > 0);
    }) ?? null
  );
}

function insertEmailEvent(
  db: AppDatabase,
  event: {
    userProfileId: string;
    applicationId: string | null;
    gmailMessageId: string;
    threadId: string;
    fromEmail: string | null;
    subject: string | null;
    snippet: string | null;
    detectedStatus: string;
    confidence: number;
    receivedAt: string | null;
  },
): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO email_events (
        id, user_profile_id, application_id, gmail_message_id, thread_id, from_email,
        subject, snippet, detected_status, confidence, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      event.userProfileId,
      event.applicationId,
      event.gmailMessageId,
      event.threadId,
      event.fromEmail,
      event.subject,
      event.snippet,
      event.detectedStatus,
      event.confidence,
      event.receivedAt,
    );

  return result.changes > 0;
}

function updateApplicationOutcome(
  db: AppDatabase,
  applicationId: string,
  detectedStatus: string,
  confidence: number,
  gmailMessageId: string,
): void {
  if (confidence < 0.65) {
    return;
  }

  db.prepare(
    `UPDATE applications
     SET outcome_status = ?, outcome_detected_at = CURRENT_TIMESTAMP,
       outcome_source_message_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(detectedStatus, gmailMessageId, applicationId);
}

function getHeaders(message: GmailMessageResponse): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const header of message.payload?.headers ?? []) {
    headers[header.name.toLowerCase()] = header.value;
  }
  return headers;
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 3),
  );
}
