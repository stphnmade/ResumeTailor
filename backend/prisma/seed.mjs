import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const sampleUserProfile = {
  name: "Stephen Syl-Akinwale",
  email: "stephensylak@gmail.com",
  phone: "+1 (716)-292-5784",
  linkedin: "https://linkedin.com/in/stephen-syl-akinwale",
  github: "https://github.com/stphnmade",
};

const sampleJobs = [
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

async function main() {
  const existingProfile = await prisma.userProfile.findFirst({
    where: { email: sampleUserProfile.email },
  });

  if (!existingProfile) {
    await prisma.userProfile.create({
      data: sampleUserProfile,
    });
  }

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
