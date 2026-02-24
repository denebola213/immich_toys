import fs from 'fs';
import path from 'path';
import { CompletedLogEntry } from './types.js';

export function parseCompletedEntriesFromLog(logPath: string): CompletedLogEntry[] {
  if (!fs.existsSync(logPath) || !fs.statSync(logPath).isFile()) {
    throw new Error(`Log file is not found: ${logPath}`);
  }

  const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/);
  const dedup = new Map<string, number | null>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('Uploaded: ')) {
      const rest = line.substring('Uploaded: '.length);
      const [filePathPart, afterArrow] = rest.split(' -> ');
      if (!filePathPart) {
        continue;
      }

      let statusCode: number | null = null;
      if (afterArrow) {
        const match = afterArrow.match(/^(\d{3})\b/);
        if (match) {
          statusCode = Number.parseInt(match[1], 10);
        }
      }

      dedup.set(path.resolve(filePathPart.trim()), statusCode);
      continue;
    }

    if (line.startsWith('Skipping already uploaded file: ')) {
      const filePath = line.substring('Skipping already uploaded file: '.length).trim();
      if (filePath.length > 0) {
        dedup.set(path.resolve(filePath), dedup.get(path.resolve(filePath)) ?? null);
      }
    }
  }

  return Array.from(dedup.entries()).map(([entryPath, statusCode]) => ({
    path: entryPath,
    statusCode,
  }));
}
