import { useEffect, useState } from "react";
import { getApplications, getJobs } from "../api";
import { withBase } from "../router";

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

function JobsTable({ jobs, loading, error }) {
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
          </div>
          <div className="dashboard-meta">{job.source}</div>
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
          </div>
          <div className="status-pill">{application.status}</div>
        </article>
      ))}
    </div>
  );
}

export function DashboardShell({ pathname, onNavigate }) {
  const [jobs, setJobs] = useState([]);
  const [applications, setApplications] = useState([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [applicationsLoading, setApplicationsLoading] = useState(true);
  const [jobsError, setJobsError] = useState("");
  const [applicationsError, setApplicationsError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadJobs() {
      setJobsLoading(true);
      setJobsError("");
      try {
        const nextJobs = await getJobs();
        if (!cancelled) {
          setJobs(nextJobs);
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
      setApplicationsLoading(true);
      setApplicationsError("");
      try {
        const nextApplications = await getApplications();
        if (!cancelled) {
          setApplications(nextApplications);
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

  let title = "Dashboard";
  let body = (
    <section className="dashboard-panel">
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
      </div>
      <p className="dashboard-copy">
        ResumeTailor v2 is initialized with a persistent inbox/tracker foundation. Scoring, review logic,
        extension capture, and resume generation reuse are intentionally out of scope in this pass.
      </p>
    </section>
  );

  if (pathname === "/dashboard/inbox") {
    title = "Inbox";
    body = (
      <section className="dashboard-panel">
        <h2>Jobs</h2>
        <JobsTable jobs={jobs} loading={jobsLoading} error={jobsError} />
      </section>
    );
  } else if (pathname === "/dashboard/review") {
    title = "Review";
    body = (
      <section className="dashboard-panel">
        <h2>Review queue</h2>
        <p className="dashboard-copy">
          This route is reserved for scored and approved job review. For now it shows the same captured jobs
          that will later feed the review stage.
        </p>
        <JobsTable jobs={jobs} loading={jobsLoading} error={jobsError} />
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
