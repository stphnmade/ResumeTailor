import { useEffect, useState } from "react";
import { getApplications, getJobs, scoreJobs } from "../api";
import { withBase } from "../router";

const RESUME_MODES = [
  "IT Support",
  "IT / Systems / Automation",
  "Entry SWE / Developer",
  "Alternate PM",
];

function NavLink({ label, to, active, onNavigate }) {
  return (
    <a
      href={withBase(to)}
      className={`dashboard-link ${active ? "active" : ""}`}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(to);
      }}
    >
      {label}
    </a>
  );
}

function EmptyState({ title, description }) {
  return (
    <div className="dashboard-empty">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function formatScore(job) {
  const score = job?.latestScore?.explanation?.totalScore ?? job?.latestScore?.score;
  if (typeof score !== "number") {
    return "Unscored";
  }
  return `${Math.round(score)}`;
}

function scoreBand(job) {
  return job?.latestScore?.explanation?.scoreBand || "Unscored";
}

function scoreExplanation(job) {
  return job?.latestScore?.explanation?.explanation || "Score this job to generate a transparent match explanation.";
}

function JobsTable({ jobs, loading, error, scoringJobId, onScoreJob }) {
  if (loading) {
    return <EmptyState title="Loading jobs" description="Fetching inbox records from the new v2 data layer." />;
  }
  if (error) {
    return <EmptyState title="Job load failed" description={error} />;
  }
  if (!jobs.length) {
    return <EmptyState title="No jobs yet" description="Seed data has not been created or the inbox is empty." />;
  }

  return (
    <div className="dashboard-list">
      {jobs.map((job) => (
        <article key={job.id} className="dashboard-row">
          <div>
            <strong>{job.title}</strong>
            <div className="dashboard-meta">{job.company}</div>
            <div className="dashboard-meta dashboard-explanation">{scoreExplanation(job)}</div>
          </div>
          <div className="dashboard-row-aside">
            <div className="dashboard-score">{formatScore(job)}</div>
            <div className="dashboard-meta">{scoreBand(job)}</div>
            <div className="dashboard-meta">{job.source}</div>
            {job?.latestScore?.explanation?.archiveByDefault ? <div className="archive-pill">Archive default</div> : null}
            <button type="button" className="secondary dashboard-action" onClick={() => onScoreJob(job.id)} disabled={scoringJobId === job.id}>
              {scoringJobId === job.id ? "Scoring..." : "Score"}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function ApplicationsTable({ applications, loading, error }) {
  if (loading) {
    return <EmptyState title="Loading applications" description="Fetching tracker records from the new v2 data layer." />;
  }
  if (error) {
    return <EmptyState title="Application load failed" description={error} />;
  }
  if (!applications.length) {
    return <EmptyState title="No applications yet" description="Create an application record to populate the tracker." />;
  }

  return (
    <div className="dashboard-list">
      {applications.map((application) => (
        <article key={application.id} className="dashboard-row">
          <div>
            <strong>{application.job?.company || "Unknown company"}</strong>
            <div className="dashboard-meta">{application.job?.title || "Unknown role"}</div>
            <div className="dashboard-meta dashboard-explanation">{scoreExplanation(application.job || {})}</div>
          </div>
          <div className="dashboard-row-aside">
            <div className="status-pill">{application.status}</div>
            <div className="dashboard-meta">Score {formatScore(application.job || {})}</div>
            <div className="dashboard-meta">{scoreBand(application.job || {})}</div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function DashboardShell({ pathname, onNavigate }) {
  const [jobs, setJobs] = useState([]);
  const [applications, setApplications] = useState([]);
  const [selectedResumeMode, setSelectedResumeMode] = useState("IT / Systems / Automation");
  const [jobsLoading, setJobsLoading] = useState(true);
  const [applicationsLoading, setApplicationsLoading] = useState(true);
  const [jobsError, setJobsError] = useState("");
  const [applicationsError, setApplicationsError] = useState("");
  const [scoreActionState, setScoreActionState] = useState({ target: "", loading: false, error: "" });

  async function refreshJobs() {
    setJobsLoading(true);
    setJobsError("");
    try {
      const nextJobs = await getJobs();
      setJobs(nextJobs);
    } catch (error) {
      setJobsError(String(error?.message || error || "Unable to load jobs."));
    } finally {
      setJobsLoading(false);
    }
  }

  async function refreshApplications() {
    setApplicationsLoading(true);
    setApplicationsError("");
    try {
      const nextApplications = await getApplications();
      setApplications(nextApplications);
    } catch (error) {
      setApplicationsError(String(error?.message || error || "Unable to load applications."));
    } finally {
      setApplicationsLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadJobs() {
      try {
        const nextJobs = await getJobs();
        if (!cancelled) {
          setJobs(nextJobs);
          setJobsError("");
        }
      } catch (error) {
        if (!cancelled) {
          setJobsError(String(error?.message || error || "Unable to load jobs."));
        }
      } finally {
        if (!cancelled) {
          setJobsLoading(false);
        }
      }
    }

    void loadJobs();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadApplications() {
      try {
        const nextApplications = await getApplications();
        if (!cancelled) {
          setApplications(nextApplications);
          setApplicationsError("");
        }
      } catch (error) {
        if (!cancelled) {
          setApplicationsError(String(error?.message || error || "Unable to load applications."));
        }
      } finally {
        if (!cancelled) {
          setApplicationsLoading(false);
        }
      }
    }

    void loadApplications();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalJobs = jobs.length;
  const totalApplications = applications.length;
  const totalApproved = applications.filter((application) => application.status === "approved").length;
  const priorityJobs = jobs.filter((job) => scoreBand(job) === "Priority review").length;

  async function handleScore(jobId) {
    setScoreActionState({ target: jobId || "all", loading: true, error: "" });
    try {
      await scoreJobs({
        resumeMode: selectedResumeMode,
        jobId: jobId || undefined,
      });
      await Promise.all([refreshJobs(), refreshApplications()]);
    } catch (error) {
      setScoreActionState({
        target: jobId || "all",
        loading: false,
        error: String(error?.message || error || "Unable to score jobs."),
      });
      return;
    }

    setScoreActionState({ target: "", loading: false, error: "" });
  }

  const reviewJobs = [...jobs].sort((left, right) => {
    const leftArchive = left?.latestScore?.explanation?.archiveByDefault ? 1 : 0;
    const rightArchive = right?.latestScore?.explanation?.archiveByDefault ? 1 : 0;
    if (leftArchive !== rightArchive) {
      return leftArchive - rightArchive;
    }
    const leftScore = left?.latestScore?.explanation?.totalScore ?? left?.latestScore?.score ?? -1;
    const rightScore = right?.latestScore?.explanation?.totalScore ?? right?.latestScore?.score ?? -1;
    return rightScore - leftScore;
  });

  let title = "Dashboard";
  let body = (
    <section className="dashboard-panel">
      <div className="dashboard-toolbar">
        <label className="dashboard-mode-picker">
          <span>Resume mode</span>
          <select value={selectedResumeMode} onChange={(event) => setSelectedResumeMode(event.target.value)}>
            {RESUME_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void handleScore("")} disabled={scoreActionState.loading && scoreActionState.target === "all"}>
          {scoreActionState.loading && scoreActionState.target === "all" ? "Scoring all..." : "Score all jobs"}
        </button>
      </div>
      <div className="dashboard-cards">
        <article className="dashboard-stat">
          <span>Inbox jobs</span>
          <strong>{totalJobs}</strong>
        </article>
        <article className="dashboard-stat">
          <span>Tracked applications</span>
          <strong>{totalApplications}</strong>
        </article>
        <article className="dashboard-stat">
          <span>Approved</span>
          <strong>{totalApproved}</strong>
        </article>
        <article className="dashboard-stat">
          <span>Priority review</span>
          <strong>{priorityJobs}</strong>
        </article>
      </div>
      <p className="dashboard-copy">
        ResumeTailor v2 now supports rules-based, inspectable scoring on top of the persistent inbox/tracker foundation.
      </p>
      {scoreActionState.error ? <div className="dashboard-error">{scoreActionState.error}</div> : null}
    </section>
  );

  if (pathname === "/dashboard/inbox") {
    title = "Inbox";
    body = (
      <section className="dashboard-panel">
        <h2>Jobs</h2>
        <JobsTable jobs={jobs} loading={jobsLoading} error={jobsError} scoringJobId={scoreActionState.target} onScoreJob={(jobId) => void handleScore(jobId)} />
      </section>
    );
  } else if (pathname === "/dashboard/review") {
    title = "Review";
    body = (
      <section className="dashboard-panel">
        <h2>Review queue</h2>
        <p className="dashboard-copy">
          Jobs are sorted by latest score, with archive-by-default roles pushed to the bottom but still visible.
        </p>
        <JobsTable jobs={reviewJobs} loading={jobsLoading} error={jobsError} scoringJobId={scoreActionState.target} onScoreJob={(jobId) => void handleScore(jobId)} />
      </section>
    );
  } else if (pathname === "/dashboard/tracker") {
    title = "Tracker";
    body = (
      <section className="dashboard-panel">
        <h2>Applications</h2>
        <ApplicationsTable applications={applications} loading={applicationsLoading} error={applicationsError} />
      </section>
    );
  }

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div>
          <div className="dashboard-kicker">ResumeTailor v2</div>
          <h1>Dashboard</h1>
        </div>
        <nav className="dashboard-nav">
          <NavLink label="Overview" to="/dashboard" active={pathname === "/dashboard"} onNavigate={onNavigate} />
          <NavLink label="Inbox" to="/dashboard/inbox" active={pathname === "/dashboard/inbox"} onNavigate={onNavigate} />
          <NavLink label="Review" to="/dashboard/review" active={pathname === "/dashboard/review"} onNavigate={onNavigate} />
          <NavLink label="Tracker" to="/dashboard/tracker" active={pathname === "/dashboard/tracker"} onNavigate={onNavigate} />
          <NavLink label="Manual Studio" to="/manual" active={pathname === "/manual"} onNavigate={onNavigate} />
        </nav>
      </aside>
      <main className="dashboard-main">
        <header className="dashboard-header">
          <h1>{title}</h1>
          <p>Persistent jobs, applications, and review-state scaffolding for v2 beta.</p>
        </header>
        {body}
      </main>
    </div>
  );
}
