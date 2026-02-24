import fs from 'fs';
import xxhash from 'xxhash-wasm';
import { initDb } from '../db.js';
import { hashFile } from '../hash.js';
import { getAllImageFiles } from '../media.js';
import { logInfo, renderProgress } from '../utils/progress.js';
import { nowIso } from '../utils/time.js';

export async function runUpdate(targetFolder: string, dbPath: string) {
  if (!fs.existsSync(targetFolder) || !fs.statSync(targetFolder).isDirectory()) {
    throw new Error(`Target folder is not found or not directory: ${targetFolder}`);
  }

  const db = initDb(dbPath);
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO images(path, hash, size, status, updated_at)
    VALUES (?, ?, ?, 'pending', ?)
  `);

  let inserted = 0;
  let skipped = 0;
  const files = getAllImageFiles(targetFolder);
  const xxhashApi = await xxhash();
  logInfo(`Found ${files.length} image(s).`);

  try {
    let index = 0;
    for (const filePath of files) {
      index += 1;
      const size = fs.statSync(filePath).size;
      const hash = await hashFile(filePath, xxhashApi);
      const result = insertStmt.run(filePath, hash, size, nowIso());
      if (result.changes > 0) {
        inserted += 1;
      } else {
        skipped += 1;
      }
      renderProgress('update', index, files.length);
    }
  } finally {
    db.close();
  }

  logInfo(`Update completed. inserted=${inserted}, skipped=${skipped}, db=${dbPath}`);
}
