import { type FormEvent, useEffect, useMemo, useState } from 'react';

type View = 'landing' | 'dashboard' | 'settings';
type SettingsTab = 'profile' | 'resumes' | 'credentials' | 'preferences';

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
  outcome_status: string | null;
  outcome_detected_at: string | null;
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

type EmailTrackingStatus = {
  connected: boolean;
  gmailEmail: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  recentEvents: Array<{
    id: string;
    applicationId: string | null;
    gmailMessageId: string;
    fromEmail: string | null;
    subject: string | null;
    snippet: string | null;
    detectedStatus: string;
    confidence: number;
    receivedAt: string | null;
    createdAt: string;
  }>;
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
  const [emailStatus, setEmailStatus] = useState<EmailTrackingStatus | null>(null);
  const [view, setView] = useState<View>('landing');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('profile');
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkedinEmail, setLinkedinEmail] = useState('');
  const [linkedinPassword, setLinkedinPassword] = useState('');
  const [maxApplications, setMaxApplications] = useState(5);
  const [dryRun, setDryRun] = useState(true);
  const [nonLinkedInMaxApplications, setNonLinkedInMaxApplications] = useState(10);
  const [nonLinkedInDryRun, setNonLinkedInDryRun] = useState(true);
  const [runInProgress, setRunInProgress] = useState(false);
  const [emailSyncInProgress, setEmailSyncInProgress] = useState(false);
  const [companyFilter, setCompanyFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const selectedApplication = useMemo(
    () => applications.find((application) => application.id === selectedApplicationId) ?? null,
    [applications, selectedApplicationId],
  );
  const setupProgress = useMemo(
    () => ({
      profile: isProfileComplete(profile),
      resume: resumes.length > 0,
      linkedin: Boolean(linkedinStatus?.credentialsStored),
    }),
    [linkedinStatus?.credentialsStored, profile, resumes.length],
  );
  const needsSetup = user && (!setupProgress.profile || !setupProgress.resume);
  const dashboardStats = useMemo(() => buildStats(applications), [applications]);
  const filteredApplications = useMemo(
    () =>
      applications.filter((application) => {
        const search = companyFilter.toLowerCase().trim();
        const searchMatch = `${application.company} ${application.title}`.toLowerCase().includes(search);
        const sourceMatch = sourceFilter === 'all' || application.source === sourceFilter;
        const statusMatch = statusFilter === 'all' || application.status === statusFilter;
        return searchMatch && sourceMatch && statusMatch;
      }),
    [applications, companyFilter, sourceFilter, statusFilter],
  );

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
          setView('dashboard');
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
    setDataLoading(true);
    try {
      const [profileResponse, resumeResponse, applicationResponse, emailResponse, linkedinResponse] =
        await Promise.all([
          api<{ profile: Profile }>('/profile'),
          api<{ resumes: Resume[] }>('/resumes'),
          api<{ applications: Application[] }>('/applications'),
          api<EmailTrackingStatus>('/email/status'),
          api<LinkedInStatus>('/linkedin/status'),
        ]);

      setProfile(profileResponse.profile);
      setResumes(resumeResponse.resumes);
      setApplications(applicationResponse.applications);
      setEmailStatus(emailResponse);
      setLinkedinStatus(linkedinResponse);
      setSelectedApplicationId(applicationResponse.applications[0]?.id ?? null);
    } finally {
      setDataLoading(false);
    }
  }

  async function saveProfile(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
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
      await api<{ resume: Resume }>('/resumes', { method: 'POST', body: formData });
      form.reset();
      await refreshResumes();
      setNotice('Resume uploaded.');
    } catch (err) {
      setError(readError(err));
    }
  }

  async function refreshResumes() {
    const response = await api<{ resumes: Resume[] }>('/resumes');
    setResumes(response.resumes);
  }

  async function selectResume(id: string) {
    setNotice(null);
    setError(null);
    try {
      await api(`/resumes/${id}/select`, { method: 'POST' });
      await refreshResumes();
      setNotice('Default resume updated.');
    } catch (err) {
      setError(readError(err));
    }
  }

  async function deleteResume(id: string) {
    setNotice(null);
    setError(null);
    try {
      await api(`/resumes/${id}`, { method: 'DELETE' });
      await refreshResumes();
      setNotice('Resume deleted.');
    } catch (err) {
      setError(readError(err));
    }
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
    setRunInProgress(true);
    setNotice(null);
    setError(null);
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
    setRunInProgress(true);
    setNotice(null);
    setError(null);
    try {
      const response = await api<{ result: { submitted: number; skipped: number } }>(
        '/nonlinkedin/run',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            maxApplications: nonLinkedInMaxApplications,
            dryRun: nonLinkedInDryRun,
          }),
        },
      );
      await loadAuthedData();
      setNotice(
        `External run complete: ${response.result.submitted} submitted, ${response.result.skipped} skipped.`,
      );
    } catch (err) {
      setError(readError(err));
    } finally {
      setRunInProgress(false);
    }
  }

  async function syncEmailOutcomes() {
    setEmailSyncInProgress(true);
    setNotice(null);
    setError(null);
    try {
      const response = await api<{
        result: { scanned: number; detected: number; updatedApplications: number };
        status: EmailTrackingStatus;
      }>('/email/sync', { method: 'POST' });
      setEmailStatus(response.status);
      await loadAuthedData();
      setNotice(
        `Email sync complete: ${response.result.scanned} scanned, ${response.result.detected} outcomes detected.`,
      );
    } catch (err) {
      setError(readError(err));
    } finally {
      setEmailSyncInProgress(false);
    }
  }

  async function disconnectEmailTracking() {
    setNotice(null);
    setError(null);
    try {
      await api('/email/connection', { method: 'DELETE' });
      setEmailStatus(await api<EmailTrackingStatus>('/email/status'));
      setNotice('Gmail tracking disconnected.');
    } catch (err) {
      setError(readError(err));
    }
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    setUser(null);
    setView('landing');
    setProfile(emptyProfile);
    setResumes([]);
    setApplications([]);
    setLinkedinStatus(null);
    setEmailStatus(null);
  }

  if (loading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <LandingPage authConfig={authConfig} error={error} />;
  }

  return (
    <main className="product-shell">
      <AppNav
        user={user}
        view={view}
        onNavigate={setView}
        onLogout={() => void logout()}
      />
      <section className="app-surface">
        <Feedback notice={notice} error={error} />
        {needsSetup ? (
          <OnboardingCard
            progress={setupProgress}
            onOpenSettings={(tab) => {
              setSettingsTab(tab);
              setView('settings');
            }}
            onSkip={() => setNotice('You can finish setup any time from Settings.')}
          />
        ) : null}
        {view === 'dashboard' ? (
          <Dashboard
            applications={applications}
            dataLoading={dataLoading}
            filteredApplications={filteredApplications}
            selectedApplication={selectedApplication}
            selectedApplicationId={selectedApplicationId}
            stats={dashboardStats}
            companyFilter={companyFilter}
            sourceFilter={sourceFilter}
            statusFilter={statusFilter}
            linkedinStatus={linkedinStatus}
            maxApplications={maxApplications}
            dryRun={dryRun}
            nonLinkedInMaxApplications={nonLinkedInMaxApplications}
            nonLinkedInDryRun={nonLinkedInDryRun}
            runInProgress={runInProgress}
            onCompanyFilter={setCompanyFilter}
            onSourceFilter={setSourceFilter}
            onStatusFilter={setStatusFilter}
            onSelectApplication={setSelectedApplicationId}
            onMaxApplications={setMaxApplications}
            onDryRun={setDryRun}
            onNonLinkedInMaxApplications={setNonLinkedInMaxApplications}
            onNonLinkedInDryRun={setNonLinkedInDryRun}
            onStartLinkedIn={() => void startLinkedInRun()}
            onStartExternal={() => void startNonLinkedInRun()}
            onOpenSettings={(tab) => {
              setSettingsTab(tab);
              setView('settings');
            }}
          />
        ) : (
          <Settings
            activeTab={settingsTab}
            onTab={setSettingsTab}
            profile={profile}
            resumes={resumes}
            linkedinStatus={linkedinStatus}
            emailStatus={emailStatus}
            linkedinEmail={linkedinEmail}
            linkedinPassword={linkedinPassword}
            emailSyncInProgress={emailSyncInProgress}
            onProfile={setProfile}
            onSaveProfile={(event) => void saveProfile(event)}
            onUploadResume={(event) => void uploadResume(event)}
            onSelectResume={(id) => void selectResume(id)}
            onDeleteResume={(id) => void deleteResume(id)}
            onLinkedInEmail={setLinkedinEmail}
            onLinkedInPassword={setLinkedinPassword}
            onSaveLinkedIn={(event) => void saveLinkedInCredentials(event)}
            onDeleteLinkedIn={() => void deleteLinkedInCredentials()}
            onSyncEmail={() => void syncEmailOutcomes()}
            onDisconnectEmail={() => void disconnectEmailTracking()}
          />
        )}
      </section>
    </main>
  );
}

function LandingPage({ authConfig, error }: { authConfig: AuthConfig | null; error: string | null }) {
  return (
    <main className="landing-shell">
      <nav className="landing-nav glass">
        <Brand />
        {authConfig?.googleConfigured ? (
          <a className="ghost-link" href={`${apiBaseUrl}/api/auth/google/start`}>
            Sign in
          </a>
        ) : null}
      </nav>
      <section className="hero">
        <div className="hero-copy">
          <div className="orb-label">Autonomous job search agent</div>
          <h1>HireLoop applies to the right jobs while you stay focused.</h1>
          <p>
            Upload your resume, set your story and preferences, then let HireLoop find roles,
            answer screening questions, and log every action with full transparency.
          </p>
          <div className="hero-actions">
            {authConfig?.googleConfigured ? (
              <a className="primary-link" href={`${apiBaseUrl}/api/auth/google/start`}>
                Sign in with Google
              </a>
            ) : (
              <div className="setup-warning">Google OAuth is not configured yet.</div>
            )}
            <a className="ghost-link" href="#how-it-works">
              See how it works
            </a>
          </div>
          {error ? <div className="inline-error">{error}</div> : null}
        </div>
        <div className="hero-preview glass">
          <div className="preview-header">
            <span />
            <span />
            <span />
          </div>
          <div className="agent-pulse">
            <strong>Loop running</strong>
            <p>Finding remote AI, data, and full-stack roles across India.</p>
          </div>
          <div className="preview-row">
            <span>LinkedIn cap</span>
            <strong>15/day</strong>
          </div>
          <div className="preview-row">
            <span>Answers logged</span>
            <strong>Exact text</strong>
          </div>
          <div className="preview-row">
            <span>Skipped forms</span>
            <strong>Flagged</strong>
          </div>
        </div>
      </section>
      <section className="landing-section" id="how-it-works">
        <SectionHeading eyebrow="Setup in minutes" title="A simple loop from profile to applications." />
        <div className="step-grid">
          {[
            ['01', 'Upload resume', 'Keep multiple PDFs and choose the default for agent runs.'],
            ['02', 'Set context', 'Tell HireLoop your goals, strengths, salary flexibility, and notice period.'],
            ['03', 'Let it apply', 'Run LinkedIn or external sourcing while the cap and skip rules stay enforced.'],
            ['04', 'Review everything', 'See jobs, answers, skips, outcomes, and source links in one place.'],
          ].map(([number, title, body]) => (
            <article className="glass step-card" key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="landing-section">
        <SectionHeading eyebrow="Highlights" title="Autonomy with an audit trail." />
        <div className="feature-grid">
          {[
            ['Autonomous applying', 'Runs without per-application approval while respecting source-specific rules.'],
            ['AI answers', 'Generates screening responses from your profile, resume context, and company research.'],
            ['LinkedIn + beyond', 'Handles LinkedIn Easy Apply plus conservative external form attempts.'],
            ['Full transparency', 'Every submitted answer is stored exactly, never summarized away.'],
          ].map(([title, body]) => (
            <article className="glass feature-card" key={title}>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function AppNav({
  user,
  view,
  onNavigate,
  onLogout,
}: {
  user: User;
  view: View;
  onNavigate: (view: View) => void;
  onLogout: () => void;
}) {
  return (
    <aside className="side-nav glass">
      <Brand />
      <div className="nav-stack">
        <button className={view === 'dashboard' ? 'active' : ''} onClick={() => onNavigate('dashboard')} type="button">
          Dashboard
        </button>
        <button className={view === 'settings' ? 'active' : ''} onClick={() => onNavigate('settings')} type="button">
          Settings
        </button>
      </div>
      <div className="nav-user">
        {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <div className="avatar-fallback" />}
        <div>
          <strong>{user.displayName ?? 'HireLoop user'}</strong>
          <span>{user.email}</span>
        </div>
      </div>
      <button className="secondary-button" onClick={onLogout} type="button">
        Sign out
      </button>
    </aside>
  );
}

function OnboardingCard({
  progress,
  onOpenSettings,
  onSkip,
}: {
  progress: { profile: boolean; resume: boolean; linkedin: boolean };
  onOpenSettings: (tab: SettingsTab) => void;
  onSkip: () => void;
}) {
  return (
    <section className="glass onboarding-card">
      <div>
        <span className="orb-label">First-time setup</span>
        <h2>Finish the essentials before your first run.</h2>
        <p>HireLoop needs your profile and a resume to apply reliably. LinkedIn credentials can be added when you are ready to run automation.</p>
      </div>
      <div className="setup-checks">
        <SetupCheck done={progress.profile} label="Q&A profile" onClick={() => onOpenSettings('profile')} />
        <SetupCheck done={progress.resume} label="Resume uploaded" onClick={() => onOpenSettings('resumes')} />
        <SetupCheck done={progress.linkedin} label="LinkedIn credentials" onClick={() => onOpenSettings('credentials')} />
      </div>
      <button className="ghost-button" onClick={onSkip} type="button">
        Explore first
      </button>
    </section>
  );
}

function Dashboard(props: {
  applications: Application[];
  dataLoading: boolean;
  filteredApplications: Application[];
  selectedApplication: Application | null;
  selectedApplicationId: string | null;
  stats: ReturnType<typeof buildStats>;
  companyFilter: string;
  sourceFilter: string;
  statusFilter: string;
  linkedinStatus: LinkedInStatus | null;
  maxApplications: number;
  dryRun: boolean;
  nonLinkedInMaxApplications: number;
  nonLinkedInDryRun: boolean;
  runInProgress: boolean;
  onCompanyFilter: (value: string) => void;
  onSourceFilter: (value: string) => void;
  onStatusFilter: (value: string) => void;
  onSelectApplication: (id: string) => void;
  onMaxApplications: (value: number) => void;
  onDryRun: (value: boolean) => void;
  onNonLinkedInMaxApplications: (value: number) => void;
  onNonLinkedInDryRun: (value: boolean) => void;
  onStartLinkedIn: () => void;
  onStartExternal: () => void;
  onOpenSettings: (tab: SettingsTab) => void;
}) {
  return (
    <div className="view-stack fade-in">
      <header className="view-header">
        <div>
          <span className="orb-label">Home</span>
          <h1>What HireLoop did for you</h1>
        </div>
        <button className="primary-link" onClick={() => props.onOpenSettings('profile')} type="button">
          Complete setup
        </button>
      </header>
      <div className="stats-grid">
        <Stat label="This week" value={props.stats.thisWeek} />
        <Stat label="Total" value={props.stats.total} />
        <Stat label="LinkedIn" value={props.stats.linkedin} />
        <Stat label="Other sources" value={props.stats.external} />
      </div>
      <section className="glass run-panel">
        <RunControl
          title="LinkedIn loop"
          body={`${props.linkedinStatus?.daily.remaining ?? 0} of ${props.linkedinStatus?.daily.cap ?? 15} remaining today.`}
          max={props.maxApplications}
          dryRun={props.dryRun}
          disabled={props.runInProgress || !props.linkedinStatus?.credentialsStored || props.linkedinStatus.daily.remaining <= 0}
          onMax={props.onMaxApplications}
          onDryRun={props.onDryRun}
          onStart={props.onStartLinkedIn}
        />
        <RunControl
          title="External loop"
          body="Uncapped sourcing with skip-and-flag for uncertain forms."
          max={props.nonLinkedInMaxApplications}
          dryRun={props.nonLinkedInDryRun}
          disabled={props.runInProgress}
          onMax={props.onNonLinkedInMaxApplications}
          onDryRun={props.onNonLinkedInDryRun}
          onStart={props.onStartExternal}
        />
      </section>
      <section className="dashboard-grid">
        <div className="glass list-panel">
          <div className="panel-heading">
            <h2>Applications</h2>
            <span>{props.filteredApplications.length} shown</span>
          </div>
          <div className="filters-grid">
            <input
              placeholder="Search company or role"
              value={props.companyFilter}
              onChange={(event) => props.onCompanyFilter(event.currentTarget.value)}
            />
            <select value={props.sourceFilter} onChange={(event) => props.onSourceFilter(event.currentTarget.value)}>
              <option value="all">All sources</option>
              {uniqueValues(props.applications.map((application) => application.source)).map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
            <select value={props.statusFilter} onChange={(event) => props.onStatusFilter(event.currentTarget.value)}>
              <option value="all">All statuses</option>
              <option value="submitted">Applied</option>
              <option value="skipped">Skipped</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          {props.dataLoading ? <SkeletonList /> : null}
          {!props.dataLoading && props.applications.length === 0 ? (
            <EmptyState
              title="No applications yet"
              body="Complete setup, then start a dry run to see how HireLoop logs applications and skips."
              action="Open settings"
              onAction={() => props.onOpenSettings('profile')}
            />
          ) : null}
          {!props.dataLoading && props.filteredApplications.length > 0 ? (
            <div className="application-list">
              {props.filteredApplications.map((application) => (
                <button
                  className={`application-row ${props.selectedApplicationId === application.id ? 'selected' : ''}`}
                  key={application.id}
                  onClick={() => props.onSelectApplication(application.id)}
                  type="button"
                >
                  <div>
                    <strong>{application.company}</strong>
                    <span>{application.title}</span>
                  </div>
                  <div className="row-meta">
                    <Badge tone={application.status === 'submitted' ? 'green' : 'amber'}>
                      {application.status === 'submitted' ? 'Applied' : application.status}
                    </Badge>
                    <small>{formatApplicationDate(application)}</small>
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="glass detail-panel">
          {props.selectedApplication ? (
            <ApplicationDetail application={props.selectedApplication} />
          ) : (
            <EmptyState
              title="Select an application"
              body="Every submitted answer, posting link, skip reason, and outcome appears here."
            />
          )}
        </div>
      </section>
    </div>
  );
}

function Settings(props: {
  activeTab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  profile: Profile;
  resumes: Resume[];
  linkedinStatus: LinkedInStatus | null;
  emailStatus: EmailTrackingStatus | null;
  linkedinEmail: string;
  linkedinPassword: string;
  emailSyncInProgress: boolean;
  onProfile: (profile: Profile) => void;
  onSaveProfile: (event: FormEvent<HTMLFormElement>) => void;
  onUploadResume: (event: FormEvent<HTMLFormElement>) => void;
  onSelectResume: (id: string) => void;
  onDeleteResume: (id: string) => void;
  onLinkedInEmail: (value: string) => void;
  onLinkedInPassword: (value: string) => void;
  onSaveLinkedIn: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteLinkedIn: () => void;
  onSyncEmail: () => void;
  onDisconnectEmail: () => void;
}) {
  return (
    <div className="view-stack fade-in">
      <header className="view-header">
        <div>
          <span className="orb-label">Settings</span>
          <h1>Agent setup</h1>
        </div>
      </header>
      <section className="glass settings-shell">
        <div className="segmented-tabs">
          {[
            ['profile', 'Q&A Profile'],
            ['resumes', 'Resumes'],
            ['credentials', 'Credentials'],
            ['preferences', 'Preferences'],
          ].map(([tab, label]) => (
            <button
              className={props.activeTab === tab ? 'active' : ''}
              key={tab}
              onClick={() => props.onTab(tab as SettingsTab)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        {props.activeTab === 'profile' ? <ProfileSettings {...props} /> : null}
        {props.activeTab === 'resumes' ? <ResumeSettings {...props} /> : null}
        {props.activeTab === 'credentials' ? <CredentialSettings {...props} /> : null}
        {props.activeTab === 'preferences' ? <PreferenceSettings /> : null}
      </section>
    </div>
  );
}

function ProfileSettings(props: Pick<Parameters<typeof Settings>[0], 'profile' | 'onProfile' | 'onSaveProfile'>) {
  const { profile, onProfile } = props;
  return (
    <form className="settings-form" onSubmit={props.onSaveProfile}>
      <TextArea label="Career goals" value={profile.careerGoals} onChange={(value) => onProfile({ ...profile, careerGoals: value })} />
      <TextArea label="Why you are job hunting" value={profile.jobHuntReason} onChange={(value) => onProfile({ ...profile, jobHuntReason: value })} />
      <TextArea label="Strengths" value={profile.strengths} onChange={(value) => onProfile({ ...profile, strengths: value })} />
      <div className="two-column">
        <TextInput label="Salary flexibility" value={profile.salaryFlexibility} onChange={(value) => onProfile({ ...profile, salaryFlexibility: value })} />
        <TextInput label="Notice period" value={profile.noticePeriod} onChange={(value) => onProfile({ ...profile, noticePeriod: value })} />
      </div>
      <TextArea label="Additional context" value={profile.additionalContext} onChange={(value) => onProfile({ ...profile, additionalContext: value })} />
      <button className="primary-link" type="submit">Save Q&A profile</button>
    </form>
  );
}

function ResumeSettings(props: Pick<Parameters<typeof Settings>[0], 'resumes' | 'onUploadResume' | 'onSelectResume' | 'onDeleteResume'>) {
  return (
    <div className="settings-form">
      <form className="upload-strip" onSubmit={props.onUploadResume}>
        <input accept="application/pdf" name="resume" required type="file" />
        <button className="primary-link" type="submit">Upload PDF</button>
      </form>
      <div className="resume-list">
        {props.resumes.length === 0 ? (
          <EmptyState title="No resumes uploaded" body="Upload a PDF resume so HireLoop can associate runs and application logs with it." />
        ) : (
          props.resumes.map((resume) => (
            <div className="resume-row glass-soft" key={resume.id}>
              <div>
                <strong>{resume.filename}</strong>
                <span>{formatBytes(resume.fileSizeBytes)} / {formatDate(resume.uploadedAt)}</span>
              </div>
              <div className="row-actions">
                {resume.isSelected ? <Badge tone="blue">Default</Badge> : <button className="ghost-button" onClick={() => props.onSelectResume(resume.id)} type="button">Make default</button>}
                <button className="danger-button" onClick={() => props.onDeleteResume(resume.id)} type="button">Delete</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function CredentialSettings(props: Pick<Parameters<typeof Settings>[0], 'linkedinStatus' | 'emailStatus' | 'linkedinEmail' | 'linkedinPassword' | 'emailSyncInProgress' | 'onLinkedInEmail' | 'onLinkedInPassword' | 'onSaveLinkedIn' | 'onDeleteLinkedIn' | 'onSyncEmail' | 'onDisconnectEmail'>) {
  return (
    <div className="settings-form">
      <form className="credential-card glass-soft" onSubmit={props.onSaveLinkedIn}>
        <div>
          <h3>LinkedIn credentials</h3>
          <p>Credentials are encrypted at rest. Stored passwords are never shown again.</p>
          {props.linkedinStatus?.credentialsStored ? <Badge tone="green">•••••••• saved</Badge> : <Badge tone="amber">Not connected</Badge>}
        </div>
        <TextInput label="LinkedIn email" value={props.linkedinEmail} onChange={props.onLinkedInEmail} />
        <TextInput label="LinkedIn password" type="password" value={props.linkedinPassword} onChange={props.onLinkedInPassword} />
        <div className="row-actions">
          <button className="primary-link" disabled={!props.linkedinStatus?.encryptionConfigured} type="submit">Save encrypted credentials</button>
          {props.linkedinStatus?.credentialsStored ? <button className="danger-button" onClick={props.onDeleteLinkedIn} type="button">Remove</button> : null}
        </div>
      </form>
      <div className="credential-card glass-soft">
        <div>
          <h3>Gmail outcome tracking</h3>
          <p>Optional read-only sync detects interviews, rejections, and assessments from recent job emails.</p>
          {props.emailStatus?.connected ? <Badge tone="green">{props.emailStatus.gmailEmail ?? 'Connected'}</Badge> : <Badge tone="amber">Not connected</Badge>}
        </div>
        <div className="row-actions">
          {props.emailStatus?.connected ? (
            <>
              <button className="primary-link" disabled={props.emailSyncInProgress} onClick={props.onSyncEmail} type="button">{props.emailSyncInProgress ? 'Syncing...' : 'Sync outcomes'}</button>
              <button className="danger-button" onClick={props.onDisconnectEmail} type="button">Disconnect</button>
            </>
          ) : (
            <a className="primary-link" href={`${apiBaseUrl}/api/email/google/start`}>Connect Gmail</a>
          )}
        </div>
      </div>
    </div>
  );
}

function PreferenceSettings() {
  return (
    <div className="preference-grid">
      <PreferenceItem label="Role scope" value="ML/AI, Data Science, Gen-AI, Full-Stack" />
      <PreferenceItem label="Location" value="Remote roles anywhere in India" />
      <PreferenceItem label="Salary target" value="9-10 LPA soft preference" />
      <PreferenceItem label="LinkedIn cap" value="15 applications/day, enforced server-side" />
      <p className="settings-note">These defaults are enforced by the current backend. Editable preference persistence is a follow-up backend enhancement.</p>
    </div>
  );
}

function ApplicationDetail({ application }: { application: Application }) {
  return (
    <div className="detail-content">
      <div className="detail-hero">
        <Badge tone={application.status === 'submitted' ? 'green' : 'amber'}>{application.status}</Badge>
        <h2>{application.title}</h2>
        <p>{application.company}</p>
      </div>
      <div className="detail-grid">
        <Detail label="Date" value={formatApplicationDate(application)} />
        <Detail label="Source" value={application.source} />
        <Detail label="Outcome" value={application.outcome_status ?? 'None detected'} />
        <Detail label="Location" value={application.location ?? 'None recorded'} />
        <Detail label="Salary" value={application.salary_text ?? 'None recorded'} />
        <Detail label="Resume" value={application.resume_filename ?? 'None recorded'} />
        <Detail label="Role type" value={application.role_category ?? 'None recorded'} />
        <Detail label="Fit score" value={application.match_score !== null ? `${application.match_score}%` : 'None recorded'} />
      </div>
      {application.skip_reason ? <div className="callout amber">Skipped: {application.skip_reason}</div> : null}
      {application.match_rationale ? <div className="callout">Fit rationale: {application.match_rationale}</div> : null}
      {application.posting_url ? <a className="ghost-link" href={application.posting_url} rel="noreferrer" target="_blank">Open original posting</a> : null}
      <div>
        <h3>Exact submitted answers</h3>
        <pre>{formatAnswers(application.answers_json)}</pre>
      </div>
    </div>
  );
}

function RunControl(props: {
  title: string;
  body: string;
  max: number;
  dryRun: boolean;
  disabled: boolean;
  onMax: (value: number) => void;
  onDryRun: (value: boolean) => void;
  onStart: () => void;
}) {
  return (
    <div className="run-card glass-soft">
      <div>
        <h3>{props.title}</h3>
        <p>{props.body}</p>
      </div>
      <div className="run-fields">
        <input min={1} type="number" value={props.max} onChange={(event) => props.onMax(Number(event.currentTarget.value))} />
        <label className="checkbox-row"><input checked={props.dryRun} type="checkbox" onChange={(event) => props.onDryRun(event.currentTarget.checked)} /> Dry run</label>
        <button className="primary-link" disabled={props.disabled} onClick={props.onStart} type="button">Start</button>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">HL</div>
      <span>HireLoop</span>
    </div>
  );
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="section-heading">
      <span className="orb-label">{eyebrow}</span>
      <h2>{title}</h2>
    </div>
  );
}

function SetupCheck({ done, label, onClick }: { done: boolean; label: string; onClick: () => void }) {
  return (
    <button className="setup-check" onClick={onClick} type="button">
      <span>{done ? 'Done' : 'Todo'}</span>
      <strong>{label}</strong>
    </button>
  );
}

function TextInput({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label>
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <textarea value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  );
}

function PreferenceItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-soft preference-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Badge({ children, tone }: { children: string | number; tone: 'green' | 'amber' | 'blue' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function EmptyState({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{body}</p>
      {action && onAction ? <button className="ghost-button" onClick={onAction} type="button">{action}</button> : null}
    </div>
  );
}

function Feedback({ notice, error }: { notice: string | null; error: string | null }) {
  return (
    <>
      {notice ? <div className="toast success">{notice}</div> : null}
      {error ? <div className="toast error">{error}</div> : null}
    </>
  );
}

function SkeletonList() {
  return (
    <div className="skeleton-list">
      <div />
      <div />
      <div />
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="landing-shell loading-screen">
      <Brand />
      <div className="loader" />
    </main>
  );
}

async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/api${path}`, { ...init, credentials: 'include' });
  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error ?? message;
    } catch {
      // Keep status message for non-JSON failures.
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function isProfileComplete(profile: Profile): boolean {
  return Boolean(profile.careerGoals && profile.jobHuntReason && profile.strengths);
}

function readError(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value));
}

function formatApplicationDate(application: Application): string {
  const value = application.submitted_at ?? application.skipped_at;
  return value ? formatDate(value) : 'No date recorded';
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function buildStats(applications: Application[]) {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  return {
    total: applications.length,
    thisWeek: applications.filter((application) => {
      const value = application.submitted_at ?? application.skipped_at;
      return value ? new Date(value) >= weekAgo : false;
    }).length,
    linkedin: applications.filter((application) => application.source === 'linkedin').length,
    external: applications.filter((application) => application.source !== 'linkedin').length,
  };
}

function formatAnswers(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value || 'No answers recorded.';
  }
}
