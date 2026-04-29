import { createContentRun, getContentRunById, updateContentRunStage } from "./db";

async function main() {
  const userId = 1;
  const runId = await createContentRun({
    userId,
    topic: `Run ID smoke test ${Date.now()}`,
    primaryKeyword: "run id smoke test",
    mascotEnabled: false,
    promptSnapshot: "Smoke verification prompt",
  });

  if (!Number.isInteger(runId) || runId <= 0) {
    throw new Error(`Invalid runId returned from createContentRun: ${String(runId)}`);
  }

  await updateContentRunStage({
    runId,
    userId,
    currentStage: "article",
    status: "running",
    lastError: null,
  });

  const run = await getContentRunById(runId, userId);
  if (!run) {
    throw new Error(`Smoke-created run ${runId} could not be read back.`);
  }

  console.log(JSON.stringify({
    ok: true,
    runId,
    currentStage: run.currentStage,
    status: run.status,
  }));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
