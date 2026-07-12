import { type FormEvent, useEffect, useMemo, useState } from 'react';

type User = {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

type AuthConfig = {
  googleConfigured: boolean;
};

type Profile = {
  careerGoals: string;
  jobHuntReason: string;
  strengths: string;
  salaryFlexibility: string;
  noticePeriod: string;
  additionalContext: string;
};

type Resume = {
  id: string;
  filename: string;
  fileSizeBytes: number;
  isSelected: boolean;
  uploadedAt: string;
};

type Application = {
  id: string;
  status: string;
  source: string;
  title: string;
  company: string;
  location: string | null;
  salary_text: string | null;
  submitted_at: string | null;
  skipped_at: string | null;
  skip_reason: string | null;
  answers_json: string;
  resume_filename: string | null;
  posting_url: string | null;
  role_category: string | null;
  match_score: number | null;
  match_rationale: string | null;
  match_model: string | null;
};

type LinkedInStatus = {
  encryptionConfigured: boolean;
  credentialsStored: boolean;
  credentialsUpdatedAt: string | null;
  daily: {
    cap: number;
    used: number;
    remaining: number;
    dayKey: string;
  };
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

const emptyProfile: Profile = {
  careerGoals: '',
  jobHuntReason: '',
  strengths: '',
  salaryFlexibility: '',
  noticePeriod: '',
  additionalContext: '',
};

export function App() {
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [linkedinStatus, setLinkedinStatus] = useState<LinkedInStatus | null>(null);
  const [linkedinEmail, setLinkedinEmail] = useState('');
  const [linkedinPassword, setLinkedinPassword] = useState('');
  const [maxApplications, setMaxApplications] = useState(5);
  const [dryRun, setDryRun] = useState(true);
  const [nonLinkedInMaxApplications, setNonLinkedInMaxApplications] = useState(10);
  const [nonLinkedInDryRun, setNonLinkedInDryRun] = useState(true);
  const [runInProgress, setRunInProgress] = useState(false);
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [companyFilter, setCompanyFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedApplication = useMemo(
    () => applications.find((application) => application.id === selectedApplicationId) ?? null,
    [applications, selectedApplicationId],
  );
  const filteredApplications = useMemo(
    () =>
      applications.filter((application) => {
        const companyMatch = `${application.company} ${application.title}`
          .toLowerCase()
          .includes(companyFilter.toLowerCase().trim());
        const sourceMatch = sourceFilter === 'all' || application.source === sourceFilter;
        const statusMatch = statusFilter === 'all' || application.status === statusFilter;
        const activityDate = getApplicationDate(application);
        const fromMatch = !dateFromFilter || !activityDate || activityDate >= dateFromFilter;
        const toMatch = !dateToFilter || !activityDate || activityDate <= dateToFilter;
        return companyMatch && sourceMatch && statusMatch && fromMatch && toMatch;
      }),
    [applications, companyFilter, dateFromFilter, dateToFilter, sourceFilter, statusFilter],
  );
  const dashboardStats = useMemo(() => buildStats(applications), [applications]);

  useEffect(() => {
    async function bootstrap() {
      try {
        const [configResponse, meResponse] = await Promise.all([
          api<AuthConfig>('/auth/config'),
          api<{ user: User | null }>('/me'),
        ]);

        setAuthConfig(configResponse);
        setUser(meResponse.user);

        if (meResponse.user) {
          await loadAuthedData();
        }
      } catch (err) {
        setError(readError(err));
      } finally {
        setLoading(false);
      }
    }

    void bootstrap();
  }, []);

  async function loadAuthedData() {
    const [profileResponse, resumeResponse, applicationResponse] = await Promise.all([
      api<{ profile: Profile }>('/profile'),
      api<{ resumes: Resume[] }>('/resumes'),
      api<{ applications: Application[] }>('/applications'),
    ]);
    const linkedinResponse = await api<LinkedInStatus>('/linkedin/status');

    setProfile(profileResponse.profile);
    setResumes(resumeResponse.resumes);
    setApplications(applicationResponse.applications);
    setLinkedinStatus(linkedinResponse);
    setSelectedApplicationId(applicationResponse.applications[0]?.id ?? null);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setError(null);

    try {
      const response = await api<{ profile: Profile }>('/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      setProfile(response.profile);
      setNotice('Profile saved.');
    } catch (err) {
      setError(readError(err));
    }
  }

  async function uploadResume(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setNotice(null);
    setError(null);

    try {
      await api<{ resume: Resume }>('/resumes', {
        method: 'POST',
        body: formData,
      });
      form.reset();
      const response = await api<{ resumes: Resume[] }>('/resumes');
      setResumes(response.resumes);
      setNotice('Resume uploaded.');
    } catch (err) {
      setError(readError(err));
    }
  }

  async function selectResume(id: string) {
    setNotice(null);
    setError(null);

    try {
      await api(`/resumes/${id}/select`, { method: 'POST' });
      const response = await api<{ resumes: Resume[] }>('/resumes');
      setResumes(response.resumes);
      setNotice('Selected resume updated.');
    } catch (err) {
      setError(readError(err));
    }
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    setUser(null);
    setProfile(emptyProfile);
    setResumes([]);
    setApplications([]);
    setLinkedinStatus(null);
  }

  async function saveLinkedInCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setError(null);

    try {
      await api('/linkedin/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: linkedinEmail, password: linkedinPassword }),
      });
      setLinkedinEmail('');
      setLinkedinPassword('');
      setLinkedinStatus(await api<LinkedInStatus>('/linkedin/status'));
      setNotice('LinkedIn credentials encrypted and saved.');
    } catch (err) {
      setError(readError(err));
    }
  }

  async function deleteLinkedInCredentials() {
    setNotice(null);
    setError(null);

    try {
      await api('/linkedin/credentials', { method: 'DELETE' });
      setLinkedinStatus(await api<LinkedInStatus>('/linkedin/status'));
      setNotice('LinkedIn credentials removed.');
    } catch (err) {
      setError(readError(err));
    }
  }

  async function startLinkedInRun() {
    setNotice(null);
    setError(null);
    setRunInProgress(true);

    try {
      const response = await api<{
        result: { submitted: number; skipped: number; remainingToday: number };
      }>('/linkedin/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxApplications, dryRun }),
      });
      await loadAuthedData();
      setNotice(
        `LinkedIn run complete: ${response.result.submitted} submitted, ${response.result.skipped} skipped, ${response.result.remainingToday} remaining today.`,
      );
    } catch (err) {
      setError(readError(err));
    } finally {
      setRunInProgress(false);
    }
  }

  async function startNonLinkedInRun() {
    setNotice(null);
    setError(null);
    setRunInProgress(true);

    try {
      const response = await api<{
        result: { submitted: number; skipped: number };
      }>('/nonlinkedin/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxApplications: nonLinkedInMaxApplications,
          dryRun: nonLinkedInDryRun,
        }),
      });
      await loadAuthedData();
      setNotice(
        `Non-LinkedIn run complete: ${response.result.submitted} submitted, ${response.result.skipped} skipped.`,
      );
    } catch (err) {
      setError(readError(err));
    } finally {
      setRunInProgress(false);
    }
  }

  if (loading) {
    return <main className="app-shell">Loading HireLoop...</main>;
  }

  if (!user) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <p className="eyebrow">HireLoop Phase 5</p>
          <h1>Set up your personal job application workspace</h1>
          <p className="summary">
            Sign in with Google to manage your resume library, answer profile, and application
            dashboard shell.
          </p>

          {authConfig?.googleConfigured ? (
            <a className="primary-link" href={`${apiBaseUrl}/api/auth/google/start`}>
              Continue with Google
            </a>
          ) : (
            <div className="setup-warning">
              Google OAuth is not configured. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
              `GOOGLE_REDIRECT_URI`, and `SESSION_SECRET` in `apps/backend/.env`.
            </div>
          )}

          {error ? <p className="error">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">HireLoop Phase 5</p>
          <h1>Agent dashboard</h1>
        </div>
        <div className="user-chip">
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : null}
          <span>{user.displayName ?? user.email}</span>
          <button onClick={logout} type="button">
            Sign out
          </button>
        </div>
      </header>

      {notice ? <p className="notice">{notice}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <section className="workspace-grid">
        <section className="panel">
          <h2>Resume library</h2>
          <form className="upload-row" onSubmit={uploadResume}>
            <input accept="application/pdf" name="resume" required type="file" />
            <button type="submit">Upload PDF</button>
          </form>

          <div className="resume-list">
            {resumes.length === 0 ? (
              <p className="muted">No resumes uploaded yet.</p>
            ) : (
              resumes.map((resume) => (
                <div className="resume-row" key={resume.id}>
                  <div>
                    <strong>{resume.filename}</strong>
                    <span>
                      {formatBytes(resume.fileSizeBytes)} / {formatDate(resume.uploadedAt)}
                    </span>
                  </div>
                  {resume.isSelected ? (
                    <span className="selected-badge">Selected</span>
                  ) : (
                    <button onClick={() => void selectResume(resume.id)} type="button">
                      Select
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <h2>Q&A profile</h2>
          <form className="profile-form" onSubmit={saveProfile}>
            <label>
              Career goals
              <textarea
                value={profile.careerGoals}
                onChange={(event) =>
                  setProfile({ ...profile, careerGoals: event.currentTarget.value })
                }
              />
            </label>
            <label>
              Why you are job hunting
              <textarea
                value={profile.jobHuntReason}
                onChange={(event) =>
                  setProfile({ ...profile, jobHuntReason: event.currentTarget.value })
                }
              />
            </label>
            <label>
              Strengths
              <textarea
                value={profile.strengths}
                onChange={(event) => setProfile({ ...profile, strengths: event.currentTarget.value })}
              />
            </label>
            <div className="two-column">
              <label>
                Salary flexibility
                <input
                  value={profile.salaryFlexibility}
                  onChange={(event) =>
                    setProfile({ ...profile, salaryFlexibility: event.currentTarget.value })
                  }
                />
              </label>
              <label>
                Notice period
                <input
                  value={profile.noticePeriod}
                  onChange={(event) =>
                    setProfile({ ...profile, noticePeriod: event.currentTarget.value })
                  }
                />
              </label>
            </div>
            <label>
              Additional context
              <textarea
                value={profile.additionalContext}
                onChange={(event) =>
                  setProfile({ ...profile, additionalContext: event.currentTarget.value })
                }
              />
            </label>
            <button type="submit">Save profile</button>
          </form>
        </section>
      </section>

      <section className="linkedin-panel">
        <div>
          <h2>LinkedIn automation</h2>
          <p className="muted">
            Server-side cap: {linkedinStatus?.daily.used ?? 0}/{linkedinStatus?.daily.cap ?? 15}{' '}
            submitted today. Remaining: {linkedinStatus?.daily.remaining ?? 0}.
          </p>
          {!linkedinStatus?.encryptionConfigured ? (
            <div className="setup-warning">
              Add `LINKEDIN_CREDENTIAL_KEY` to `apps/backend/.env` before storing LinkedIn
              credentials.
            </div>
          ) : null}
        </div>

        <form className="linkedin-credentials" onSubmit={saveLinkedInCredentials}>
          <label>
            LinkedIn email
            <input
              autoComplete="username"
              value={linkedinEmail}
              onChange={(event) => setLinkedinEmail(event.currentTarget.value)}
            />
          </label>
          <label>
            LinkedIn password
            <input
              autoComplete="current-password"
              type="password"
              value={linkedinPassword}
              onChange={(event) => setLinkedinPassword(event.currentTarget.value)}
            />
          </label>
          <button disabled={!linkedinStatus?.encryptionConfigured} type="submit">
            Save encrypted credentials
          </button>
          {linkedinStatus?.credentialsStored ? (
            <button
              className="secondary-button"
              onClick={() => void deleteLinkedInCredentials()}
              type="button"
            >
              Remove credentials
            </button>
          ) : null}
        </form>

        <div className="run-controls">
          <label>
            Max applications
            <input
              max={linkedinStatus?.daily.remaining ?? 15}
              min={1}
              type="number"
              value={maxApplications}
              onChange={(event) => setMaxApplications(Number(event.currentTarget.value))}
            />
          </label>
          <label className="checkbox-row">
            <input
              checked={dryRun}
              type="checkbox"
              onChange={(event) => setDryRun(event.currentTarget.checked)}
            />
            Dry run
          </label>
          <button
            disabled={
              runInProgress ||
              !linkedinStatus?.credentialsStored ||
              !linkedinStatus.encryptionConfigured ||
              linkedinStatus.daily.remaining <= 0
            }
            onClick={() => void startLinkedInRun()}
            type="button"
          >
            {runInProgress ? 'Running...' : 'Start LinkedIn run'}
          </button>
        </div>
      </section>

      <section className="linkedin-panel">
        <div>
          <h2>Non-LinkedIn automation</h2>
          <p className="muted">
            Sources remote-friendly external jobs, applies AI scoring, reuses Answer Memory, and
            skips unsupported forms with a visible reason. No daily cap applies.
          </p>
        </div>
        <div className="run-controls">
          <label>
            Max applications
            <input
              max={50}
              min={1}
              type="number"
              value={nonLinkedInMaxApplications}
              onChange={(event) => setNonLinkedInMaxApplications(Number(event.currentTarget.value))}
            />
          </label>
          <label className="checkbox-row">
            <input
              checked={nonLinkedInDryRun}
              type="checkbox"
              onChange={(event) => setNonLinkedInDryRun(event.currentTarget.checked)}
            />
            Dry run
          </label>
          <button disabled={runInProgress} onClick={() => void startNonLinkedInRun()} type="button">
            {runInProgress ? 'Running...' : 'Start external run'}
          </button>
        </div>
      </section>

      <section className="dashboard-shell">
        <div className="application-list">
          <h2>Applications</h2>
          <div className="stats-grid">
            <Stat label="Total" value={dashboardStats.total} />
            <Stat label="Submitted" value={dashboardStats.submitted} />
            <Stat label="Skipped" value={dashboardStats.skipped} />
            <Stat label="This week" value={dashboardStats.thisWeek} />
          </div>

          <div className="filters-grid">
            <label>
              Search
              <input
                placeholder="Company or role"
                value={companyFilter}
                onChange={(event) => setCompanyFilter(event.currentTarget.value)}
              />
            </label>
            <label>
              Source
              <select
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.currentTarget.value)}
              >
                <option value="all">All sources</option>
                {uniqueValues(applications.map((application) => application.source)).map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.currentTarget.value)}
              >
                <option value="all">All statuses</option>
                <option value="submitted">Submitted</option>
                <option value="skipped">Skipped</option>
                <option value="failed">Failed</option>
              </select>
            </label>
            <label>
              From
              <input
                type="date"
                value={dateFromFilter}
                onChange={(event) => setDateFromFilter(event.currentTarget.value)}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={dateToFilter}
                onChange={(event) => setDateToFilter(event.currentTarget.value)}
              />
            </label>
          </div>

          {applications.length === 0 ? (
            <div className="empty-state">
              No applications yet. Start a LinkedIn run to populate this dashboard.
            </div>
          ) : filteredApplications.length === 0 ? (
            <div className="empty-state">No applications match the current filters.</div>
          ) : (
            filteredApplications.map((application) => (
              <button
                className="application-row"
                key={application.id}
                onClick={() => setSelectedApplicationId(application.id)}
                type="button"
              >
                <strong>{application.title}</strong>
                <span>
                  {application.company} / {application.source} / {application.status}
                  {application.match_score !== null ? ` / ${application.match_score}% fit` : ''}
                </span>
                <small>{formatApplicationDate(application)}</small>
              </button>
            ))
          )}
        </div>

        <div className="application-detail">
          <h2>Application details</h2>
          {selectedApplication ? (
            <ApplicationDetail application={selectedApplication} />
          ) : (
            <div className="detail-placeholder">
              Select an application to review submitted details and exact answers. This view is
              intentionally empty until a run creates real application records.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function ApplicationDetail({ application }: { application: Application }) {
  return (
    <dl className="detail-grid">
      <dt>Role</dt>
      <dd>{application.title}</dd>
      <dt>Company</dt>
      <dd>{application.company}</dd>
      <dt>Location</dt>
      <dd>{application.location ?? 'None recorded'}</dd>
      <dt>Salary</dt>
      <dd>{application.salary_text ?? 'None recorded'}</dd>
      <dt>Date</dt>
      <dd>{formatApplicationDate(application)}</dd>
      <dt>Status</dt>
      <dd>{application.status}</dd>
      <dt>Source</dt>
      <dd>{application.source}</dd>
      <dt>Role type</dt>
      <dd>{application.role_category ?? 'None recorded'}</dd>
      <dt>Fit score</dt>
      <dd>
        {application.match_score !== null
          ? `${application.match_score}% (${application.match_model ?? 'unknown model'})`
          : 'None recorded'}
      </dd>
      <dt>Fit rationale</dt>
      <dd>{application.match_rationale ?? 'None recorded'}</dd>
      <dt>Resume</dt>
      <dd>{application.resume_filename ?? 'None recorded'}</dd>
      <dt>Posting</dt>
      <dd>
        {application.posting_url ? (
          <a href={application.posting_url} rel="noreferrer" target="_blank">
            Open posting
          </a>
        ) : (
          'None recorded'
        )}
      </dd>
      {application.skip_reason ? (
        <>
          <dt>Skip reason</dt>
          <dd>{application.skip_reason}</dd>
        </>
      ) : null}
      <dt>Answers</dt>
      <dd>
        <pre>{application.answers_json}</pre>
      </dd>
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/api${path}`, {
    ...init,
    credentials: 'include',
  });

  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error ?? message;
    } catch {
      // Keep the status-based message for non-JSON errors.
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function readError(err: unknown): string {
  return err instanceof Error ? err.message : 'Unexpected error';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function getApplicationDate(application: Application): string | null {
  const value = application.submitted_at ?? application.skipped_at;
  return value ? value.slice(0, 10) : null;
}

function formatApplicationDate(application: Application): string {
  const value = application.submitted_at ?? application.skipped_at;
  if (!value) {
    return 'No date recorded';
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function buildStats(applications: Application[]) {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  return {
    total: applications.length,
    submitted: applications.filter((application) => application.status === 'submitted').length,
    skipped: applications.filter((application) => application.status === 'skipped').length,
    thisWeek: applications.filter((application) => {
      const value = application.submitted_at ?? application.skipped_at;
      return value ? new Date(value) >= weekAgo : false;
    }).length,
  };
}
