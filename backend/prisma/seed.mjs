import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const sampleJobs = [
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

async function main() {
  const jobs = [];

  for (const sampleJob of sampleJobs) {
    const job = await prisma.job.upsert({
      where: { url: sampleJob.url },
      create: sampleJob,
      update: {
        title: sampleJob.title,
        company: sampleJob.company,
        location: sampleJob.location,
        description: sampleJob.description,
        source: sampleJob.source,
      },
    });
    jobs.push(job);
  }

  if (jobs[0]) {
    const existing = await prisma.application.findFirst({
      where: { jobId: jobs[0].id },
    });

    if (!existing) {
      await prisma.application.create({
        data: {
          jobId: jobs[0].id,
          status: "captured",
        },
      });
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
