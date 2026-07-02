const {
  ActivityEntityType,
  PrismaClient,
} = require("@prisma/client");
const {
  CURRENT_PROFILE_CONTEXT,
  parseStoredScoreRecord,
  scoreJob,
} = require("./scoring");

declareGlobal();

function declareGlobal() {
  if (typeof global.__resumeTailorScoringPrisma === "undefined") {
    global.__resumeTailorScoringPrisma = undefined;
  }
}

const prisma = global.__resumeTailorScoringPrisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") {
  global.__resumeTailorScoringPrisma = prisma;
}

async function getPrimaryUserProfile() {
  return prisma.userProfile.findFirst({
    orderBy: { createdAt: "asc" },
  });
}

async function getProfileContext() {
  const primaryProfile = await getPrimaryUserProfile();
  return {
    ...CURRENT_PROFILE_CONTEXT,
    identity: {
      ...CURRENT_PROFILE_CONTEXT.identity,
      name: primaryProfile?.name || CURRENT_PROFILE_CONTEXT.identity.name,
      email: primaryProfile?.email || CURRENT_PROFILE_CONTEXT.identity.email,
      phone: primaryProfile?.phone || null,
      github: primaryProfile?.github || CURRENT_PROFILE_CONTEXT.identity.github,
      linkedin: primaryProfile?.linkedin || CURRENT_PROFILE_CONTEXT.identity.linkedin,
    },
  };
}

async function createScoreRecord(job, scoringResult) {
  const record = await prisma.jobScore.create({
    data: {
      jobId: job.id,
      score: scoringResult.totalScore,
      explanation: JSON.stringify({
        ...scoringResult,
        scoredAt: new Date().toISOString(),
      }),
    },
  });

  await prisma.activityLog.create({
    data: {
      entityType: ActivityEntityType.job,
      entityId: job.id,
      action: "scored",
      metadata: JSON.stringify({
        jobScoreId: record.id,
        score: scoringResult.totalScore,
        scoreBand: scoringResult.scoreBand,
        archiveByDefault: scoringResult.archiveByDefault,
        resumeMode: scoringResult.resumeMode,
      }),
    },
  });

  return record;
}

async function scoreSingleJob({ jobId, resumeMode }) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
  });
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const profileContext = await getProfileContext();
  const scoringResult = scoreJob(job, resumeMode, profileContext);
  const persisted = await createScoreRecord(job, scoringResult);

  return {
    job,
    latestScore: parseStoredScoreRecord(persisted),
  };
}

async function scoreAllJobs({ resumeMode }) {
  const jobs = await prisma.job.findMany({
    orderBy: [{ createdAt: "desc" }],
  });
  const profileContext = await getProfileContext();
  const results = [];

  for (const job of jobs) {
    const scoringResult = scoreJob(job, resumeMode, profileContext);
    const persisted = await createScoreRecord(job, scoringResult);
    results.push({
      job,
      latestScore: parseStoredScoreRecord(persisted),
    });
  }

  return results;
}

module.exports = {
  getProfileContext,
  parseStoredScoreRecord,
  prisma,
  scoreAllJobs,
  scoreSingleJob,
};
