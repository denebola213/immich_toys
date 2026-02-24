import path from 'path';
import { parsePostArgs, runPost } from './commands/post.js';
import { runUpdate } from './commands/update.js';
import { DEFAULT_DB_PATH } from './config.js';
import { logError } from './utils/progress.js';

function printUsage() {
  console.error('Usage:');
  console.error('  yarn start update <TARGET_FOLDER> [DB_PATH]');
  console.error('  yarn start post [DB_PATH] [--exclude-videos] [--quiet-success] [--retry-count N]');
}

async function main() {
  const command = process.argv[2];

  if (command === 'update') {
    const targetFolder = process.argv[3];
    const dbPath = path.resolve(process.argv[4] ?? DEFAULT_DB_PATH);
    if (!targetFolder) {
      printUsage();
      process.exit(1);
    }
    await runUpdate(path.resolve(targetFolder), dbPath);
    return;
  }

  if (command === 'post') {
    const { dbPath, excludeVideos, quietSuccess, retryCount } = parsePostArgs(process.argv.slice(3));
    await runPost(dbPath, excludeVideos, quietSuccess, retryCount);
    return;
  }

  printUsage();
  process.exit(1);
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  logError(message);
  process.exit(1);
});
