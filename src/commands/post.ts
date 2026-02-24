import fs from 'fs';
import path from 'path';
import { DEFAULT_DB_PATH } from '../config.js';
import { initDb } from '../db.js';
import { isVideoFile } from '../media.js';
import { PostArgs, ImageRow } from '../types.js';
import { uploadImage } from '../uploader.js';
import { logError, logInfo, renderProgress } from '../utils/progress.js';
import { nowIso } from '../utils/time.js';

export function parsePostArgs(args: string[]): PostArgs {
  let dbPathArg: string | null = null;
  let excludeVideos = false;
  let quietSuccess = false;

  for (const arg of args) {
    if (arg === '--exclude-videos') {
      excludeVideos = true;
      continue;
    }

    if (arg === '--quiet-success') {
      quietSuccess = true;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option for post: ${arg}`);
    }

    if (dbPathArg !== null) {
      throw new Error('Too many arguments for post command.');
    }
    dbPathArg = arg;
  }

  return {
    dbPath: path.resolve(dbPathArg ?? DEFAULT_DB_PATH),
    excludeVideos,
    quietSuccess,
  };
}

export async function runPost(dbPath: string, excludeVideos: boolean, quietSuccess: boolean) {
  const db = initDb(dbPath);

  const selectStmt = db.prepare(`
    SELECT id, path, hash, size
    FROM images
    WHERE status IS NULL OR status != 'uploaded'
    ORDER BY id
  `);

  const updateSuccessStmt = db.prepare(`
    UPDATE images
    SET status = 'uploaded', status_code = ?, uploaded_at = ?, last_error = NULL, updated_at = ?
    WHERE id = ?
  `);

  const updateFailStmt = db.prepare(`
    UPDATE images
    SET status = 'failed', status_code = ?, last_error = ?, updated_at = ?
    WHERE id = ?
  `);

  const rows = selectStmt.all() as ImageRow[];
  logInfo(`Found ${rows.length} image(s) to upload.`);
  let uploaded = 0;
  let failed = 0;
  let skippedVideo = 0;

  try {
    let count = 0;
    for (const row of rows) {
      count += 1;
      if (excludeVideos && isVideoFile(row.path)) {
        skippedVideo += 1;
        logInfo(`Skipping video file (exclude-videos): ${row.path}  : ${count}/${rows.length}`);
        renderProgress('post', count, rows.length);
        continue;
      }

      if (!fs.existsSync(row.path)) {
        const message = 'File not found';
        logError(`Failed: ${row.path} -> ${message}  : ${count}/${rows.length}`);
        updateFailStmt.run(null, message, nowIso(), row.id);
        failed += 1;
        renderProgress('post', count, rows.length);
        continue;
      }

      const result = await uploadImage(row.path, row.hash, row.size, `${count}/${rows.length}`, quietSuccess);
      if (result.success) {
        updateSuccessStmt.run(result.statusCode, nowIso(), nowIso(), row.id);
        uploaded += 1;
      } else {
        updateFailStmt.run(result.statusCode, result.errorMessage ?? 'unknown error', nowIso(), row.id);
        failed += 1;
      }
      renderProgress('post', count, rows.length);
    }
  } finally {
    db.close();
  }

  logInfo(`Post completed. uploaded=${uploaded}, failed=${failed}, skipped_video=${skippedVideo}, db=${dbPath}`);
}
