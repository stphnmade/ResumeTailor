const { RESUME_MODES } = require("../lib/scoring.js");
const { prisma, scoreAllJobs, scoreSingleJob } = require("../lib/scoring-runner.js");

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function main() {
  const resumeMode = getArg("--mode");
  const jobId = getArg("--job-id");
  const scoreAll = hasFlag("--all");

  if (!RESUME_MODES.includes(resumeMode)) {
    throw new Error(`--mode is required and must be one of: ${RESUME_MODES.join(", ")}`);
  }

  if (!scoreAll && !jobId) {
    throw new Error("Pass either --all or --job-id <id>.");
  }

  if (scoreAll) {
    const results = await scoreAllJobs({ resumeMode });
    console.log(`Scored ${results.length} jobs using mode: ${resumeMode}`);
    for (const result of results) {
      console.log(
        `${result.job.company} | ${result.job.title} | ${result.latestScore?.score ?? "n/a"} | ${result.latestScore?.explanation?.scoreBand ?? "unbanded"}`
      );
    }
    return;
  }

  const result = await scoreSingleJob({ jobId, resumeMode });
  console.log(
    `${result.job.company} | ${result.job.title} | ${result.latestScore?.score ?? "n/a"} | ${result.latestScore?.explanation?.scoreBand ?? "unbanded"}`
  );
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
