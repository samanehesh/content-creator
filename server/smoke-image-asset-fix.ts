import { generateBrandedImage } from "./contentService";

async function main() {
  const rawAngleId = Number(process.argv[2] ?? "1");
  const angleId = rawAngleId === 2 || rawAngleId === 3 ? rawAngleId : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const result = await generateBrandedImage({
        userId: 1,
        runId: 999999,
        angleId,
        articleTitle: "How to Prepare for the TEF Exam in Canada",
        articleSummary:
          "A practical guide for French learners preparing for the TEF exam in Canada, covering section strategies, study timelines, and common mistakes.",
        mascotEnabled: true,
      });

      console.log(
        JSON.stringify(
          {
            angleId,
            attempt,
            imageUrl: result.imageUrl,
            fileName: result.fileName,
            fileSizeBytes: result.sizeBytes,
          },
          null,
          2,
        ),
      );
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`attempt ${attempt} failed: ${message}`);

      if (!/503|UNAVAILABLE|high demand/i.test(message) || attempt === 5) {
        throw error;
      }

      await new Promise(resolve => setTimeout(resolve, 3000 * attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
