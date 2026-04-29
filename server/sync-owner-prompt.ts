import { readFile } from 'node:fs/promises';
import { ENV } from './_core/env';
import { getUserByOpenId, savePromptForUser } from './db';

async function main() {
  const bundledPrompt = (await readFile(new URL('./prompt-assets/master-prompt.escaped', import.meta.url), 'utf8')).trim();
  const owner = await getUserByOpenId(ENV.ownerOpenId);

  if (!owner) {
    console.error('Owner user record was not found; prompt sync skipped.');
    process.exit(1);
  }

  const promptId = await savePromptForUser(owner.id, bundledPrompt);
  console.log(JSON.stringify({ ownerId: owner.id, promptId, synced: true }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
