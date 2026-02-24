import fs from 'fs';
import xxhash from 'xxhash-wasm';
import { initDb } from '../db.js';
import { hashFile } from '../hash.js';
import { parseCompletedEntriesFromLog } from '../log-parser.js';
import { logError, logInfo, renderProgress } from '../utils/progress.js';
import { nowIso } from '../utils/time.js';

export async function runImportLog(logPath: string, dbPath: string) {
  const db = initDb(dbPath);
  const entries = parseCompletedEntriesFromLog(logPath);
  const xxhashApi = await xxhash();

  const markUploadedStmt = db.prepare(`
    UPDATE images
    SET status = 'uploaded', status_code = COALESCE(?, status_code), uploaded_at = ?, last_error = NULL, updated_at = ?
    WHERE path = ?
  `);

  const insertUploadedStmt = db.prepare(`
    INSERT OR IGNORE INTO images(path, hash, size, status, status_code, uploaded_at, updated_at)
    VALUES (?, ?, ?, 'uploaded', ?, ?, ?)
  `);

  let marked = 0;
  let inserted = 0;
  let missing = 0;
  const maxMissingLog = 20;

  try {
    let processed = 0;
    for (const entry of entries) {
      processed += 1;
      const timestamp = nowIso();
      const updateResult = markUploadedStmt.run(entry.statusCode, timestamp, timestamp, entry.path);
      if (updateResult.changes > 0) {
        marked += 1;
        renderProgress('import-log', processed, entries.length);
        continue;
      }

      if (!fs.existsSync(entry.path)) {
        missing += 1;
        if (missing <= maxMissingLog) {
          logError(`Skip import (file not found): ${entry.path}`);
        } else if (missing === maxMissingLog + 1) {
          logError(`Skip import logs are suppressed after ${maxMissingLog} missing files.`);
        }
        renderProgress('import-log', processed, entries.length);
        continue;
      }

      const stat = fs.statSync(entry.path);
      const size = stat.size;
      const hash = await hashFile(entry.path, xxhashApi);
      const insertResult = insertUploadedStmt.run(entry.path, hash, size, entry.statusCode, timestamp, timestamp);
      if (insertResult.changes > 0) {
        inserted += 1;
      }
      renderProgress('import-log', processed, entries.length);
    }
  } finally {
    db.close();
  }

  logInfo(`Import-log completed. parsed=${entries.length}, marked=${marked}, inserted=${inserted}, missing=${missing}, db=${dbPath}`);
}
