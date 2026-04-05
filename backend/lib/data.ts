import {
  ActivityEntityType,
  ApplicationStatus,
  PrismaClient,
} from "@prisma/client";

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

const SAMPLE_JOBS: JobInput[] = [
  {
    title: "IT Support Specialist",
    company: "Northwind Health",
    location: "New York, NY",
    description:
      "Hands-on support role covering device setup, ticket triage, and end-user troubleshooting.",
    url: "https://jobs.example.com/northwind-health/it-support-specialist",
    source: "linkedin",
  },
  {
    title: "Systems Automation Analyst",
    company: "HarborOps",
    location: "Remote",
    description:
      "Operational tooling role focused on scripting, workflow cleanup, and internal systems support.",
    url: "https://jobs.example.com/harborops/systems-automation-analyst",
    source: "greenhouse",
  },
  {
    title: "Junior Software Engineer",
    company: "SignalForge",
    location: "Brooklyn, NY",
    description:
      "Entry SWE role supporting product delivery across frontend and backend systems.",
    url: "https://jobs.example.com/signalforge/junior-software-engineer",
    source: "lever",
  },
];

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
  return prisma.job.findMany({
    orderBy: [{ createdAt: "desc" }],
  });
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
  return prisma.application.findMany({
    include: {
      job: true,
      resume: true,
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function ensureSeedData() {
  const existingJobs = await prisma.job.count();
  if (existingJobs > 0) {
    return;
  }

  const jobs = [];
  for (const sampleJob of SAMPLE_JOBS) {
    jobs.push(await upsertJob(sampleJob));
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
