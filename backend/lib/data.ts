import {
  ActivityEntityType,
  ApplicationStatus,
  PrismaClient,
} from "@prisma/client";
const { parseStoredScoreRecord } = require("./scoring.js");

declare global {
  var __resumeTailorPrisma: PrismaClient | undefined;
}

const prisma = globalThis.__resumeTailorPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__resumeTailorPrisma = prisma;
}

type JobInput = {
  title: string;
  company: string;
  location?: string | null;
  description?: string | null;
  url: string;
  source: string;
};

type ApplicationInput = {
  jobId: string;
  status?: ApplicationStatus;
  resumeId?: string | null;
};

const SAMPLE_USER_PROFILE = {
  name: "Stephen Syl-Akinwale",
  email: "stephensylak@gmail.com",
  phone: "+1 (716)-292-5784",
  linkedin: "https://linkedin.com/in/stephen-syl-akinwale",
  github: "https://github.com/stphnmade",
};

const SAMPLE_JOBS: JobInput[] = [
  {
    title: "IT Support Specialist",
    company: "Northwind Health",
    location: "Buffalo, NY",
    description:
      "Hands-on support role covering desktop support, Jamf, Google Admin, printer troubleshooting, device imaging, Office 365 support, ticket queue ownership, and SLA-driven end-user support in a healthcare setting.",
    url: "https://jobs.example.com/northwind-health/it-support-specialist",
    source: "linkedin",
  },
  {
    title: "Systems Automation Analyst",
    company: "HarborOps",
    location: "Remote",
    description:
      "Operational tooling role focused on Python scripting, SQL reporting, workflow automation, endpoint operations, and process improvement across support and infrastructure teams.",
    url: "https://jobs.example.com/harborops/systems-automation-analyst",
    source: "greenhouse",
  },
  {
    title: "Junior Software Engineer",
    company: "SignalForge",
    location: "Brooklyn, NY",
    description:
      "Entry software engineering role working with React, TypeScript, Node, PostgreSQL, and Docker to build product features across frontend and backend systems.",
    url: "https://jobs.example.com/signalforge/junior-software-engineer",
    source: "lever",
  },
  {
    title: "Senior Staff Platform Engineer",
    company: "Atlas Runtime",
    location: "San Francisco, CA",
    description:
      "Senior platform role requiring 8+ years of experience building Kubernetes control planes, large-scale distributed systems, SRE processes, and principal-level technical leadership.",
    url: "https://jobs.example.com/atlas-runtime/senior-staff-platform-engineer",
    source: "linkedin",
  },
  {
    title: "SAP ABAP Technical Lead",
    company: "BlueRidge ERP",
    location: "Chicago, IL",
    description:
      "Lead enterprise ERP role requiring SAP, ABAP, HANA, FICO integrations, and hands-on ownership of ABAP customization in a large manufacturing environment.",
    url: "https://jobs.example.com/blueridge-erp/sap-abap-technical-lead",
    source: "linkedin",
  },
];

function attachLatestScore(record: any) {
  const latest = Array.isArray(record?.scores) ? record.scores[0] : null;
  return {
    ...record,
    latestScore: parseStoredScoreRecord(latest),
    scores: undefined,
  };
}

export async function createJob(input: JobInput) {
  const created = await prisma.job.create({
    data: {
      title: input.title,
      company: input.company,
      location: input.location ?? null,
      description: input.description ?? null,
      url: input.url,
      source: input.source,
    },
  });

  await prisma.activityLog.create({
    data: {
      entityType: ActivityEntityType.job,
      entityId: created.id,
      action: "created",
      metadata: JSON.stringify({ source: created.source, url: created.url }),
    },
  });

  return created;
}

export async function upsertJob(input: JobInput) {
  const existing = await prisma.job.findUnique({
    where: { url: input.url },
    select: { id: true },
  });

  const job = await prisma.job.upsert({
    where: { url: input.url },
    create: {
      title: input.title,
      company: input.company,
      location: input.location ?? null,
      description: input.description ?? null,
      url: input.url,
      source: input.source,
    },
    update: {
      title: input.title,
      company: input.company,
      location: input.location ?? null,
      description: input.description ?? null,
      source: input.source,
    },
  });

  await prisma.activityLog.create({
    data: {
      entityType: ActivityEntityType.job,
      entityId: job.id,
      action: existing ? "deduped_update" : "upsert_created",
      metadata: JSON.stringify({ source: job.source, url: job.url }),
    },
  });

  return job;
}

export async function getJobs() {
  const jobs = await prisma.job.findMany({
    include: {
      scores: {
        orderBy: [{ createdAt: "desc" }],
        take: 1,
      },
    },
    orderBy: [{ createdAt: "desc" }],
  });
  return jobs.map(attachLatestScore);
}

export async function createApplication(input: ApplicationInput) {
  const application = await prisma.application.create({
    data: {
      jobId: input.jobId,
      status: input.status ?? ApplicationStatus.captured,
      resumeId: input.resumeId ?? null,
    },
    include: {
      job: true,
      resume: true,
    },
  });

  await prisma.activityLog.create({
    data: {
      entityType: ActivityEntityType.application,
      entityId: application.id,
      action: "created",
      metadata: JSON.stringify({
        jobId: application.jobId,
        status: application.status,
      }),
    },
  });

  return application;
}

export async function getApplications() {
  const applications = await prisma.application.findMany({
    include: {
      job: {
        include: {
          scores: {
            orderBy: [{ createdAt: "desc" }],
            take: 1,
          },
        },
      },
      resume: true,
    },
    orderBy: [{ createdAt: "desc" }],
  });
  return applications.map((application: any) => ({
    ...application,
    job: attachLatestScore(application.job),
  }));
}

export async function ensureSeedData() {
  const existingProfile = await prisma.userProfile.count();
  if (existingProfile === 0) {
    await prisma.userProfile.create({
      data: SAMPLE_USER_PROFILE,
    });
  }

  const jobs = [];
  for (const sampleJob of SAMPLE_JOBS) {
    const existingJob = await prisma.job.findUnique({
      where: { url: sampleJob.url },
    });

    if (existingJob) {
      jobs.push(existingJob);
      continue;
    }

    jobs.push(await createJob(sampleJob));
  }

  const existingApplications = await prisma.application.count();
  if (existingApplications === 0 && jobs[0]) {
    await createApplication({
      jobId: jobs[0].id,
      status: ApplicationStatus.captured,
    });
  }
}

export { ApplicationStatus, prisma };
