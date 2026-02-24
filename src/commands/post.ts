import fs from 'fs';
import path from 'path';
import { DEFAULT_DB_PATH } from '../config.js';
import { POST_MAX_RETRY_COUNT } from '../constants.js';
import { initDb } from '../db.js';
import { isVideoFile } from '../media.js';
import { PostArgs, ImageRow } from '../types.js';
import { uploadImage } from '../uploader.js';
import { logError, logInfo, renderProgress } from '../utils/progress.js';
import { nowIso } from '../utils/time.js';

/**
 * post コマンド用の CLI 引数をパースします。
 *
 * @param args コマンド名以降の生の CLI 引数。
 * @returns 正規化した post コマンドオプション。
 */
export function parsePostArgs(args: string[]): PostArgs {
  let dbPathArg: string | null = null;
  let excludeVideos = false;
  let quietSuccess = false;
  let retryCount = POST_MAX_RETRY_COUNT;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--exclude-videos') {
      excludeVideos = true;
      continue;
    }

    if (arg === '--quiet-success') {
      quietSuccess = true;
      continue;
    }

    if (arg === '--retry-count') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('--retry-count requires a number.');
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`Invalid --retry-count value: ${value}`);
      }
      retryCount = parsed;
      index += 1;
      continue;
    }

    if (arg.startsWith('--retry-count=')) {
      const value = arg.slice('--retry-count='.length);
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`Invalid --retry-count value: ${value}`);
      }
      retryCount = parsed;
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
    retryCount,
  };
}

/**
 * ローカル DB の未送信メディア行を Immich へアップロードします。
 *
 * @param dbPath SQLite データベースファイルのパス。
 * @param excludeVideos true の場合は動画をスキップします。
 * @param quietSuccess true の場合は成功ログを抑制します。
 * @param retryCount アップロード失敗時の最大リトライ回数。
 */
export async function runPost(dbPath: string, excludeVideos: boolean, quietSuccess: boolean, retryCount: number = POST_MAX_RETRY_COUNT) {
  const db = initDb(dbPath);

  const selectStmt = db.prepare(`
    SELECT id, path, hash, size
    FROM images
    WHERE status IS NULL OR status != 'uploaded'
    ORDER BY CASE WHEN status = 'failed' THEN 1 ELSE 0 END, id
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
    const queue = [...rows];
    const retryCounts = new Map<number, number>();

    while (queue.length > 0) {
      const row = queue.shift();
      if (!row) {
        continue;
      }

      count += 1;
      const total = count + queue.length;

      if (excludeVideos && isVideoFile(row.path)) {
        skippedVideo += 1;
        logInfo(`Skipping video file (exclude-videos): ${row.path}  : ${count}/${total}`);
        renderProgress('post', count, total);
        continue;
      }

      if (!fs.existsSync(row.path)) {
        const message = 'File not found';
        logError(`Failed: ${row.path} -> ${message}  : ${count}/${total}`);
        updateFailStmt.run(null, message, nowIso(), row.id);

        const retried = retryCounts.get(row.id) ?? 0;
        if (retried < retryCount) {
          const nextRetry = retried + 1;
          retryCounts.set(row.id, nextRetry);
          queue.push(row);
          logInfo(`Retrying later (${nextRetry}/${retryCount}): ${row.path}`);
        } else {
          failed += 1;
        }

        renderProgress('post', count, count + queue.length);
        continue;
      }

      const result = await uploadImage(row.path, row.hash, row.size, `${count}/${total}`, quietSuccess);
      if (result.success) {
        updateSuccessStmt.run(result.statusCode, nowIso(), nowIso(), row.id);
        uploaded += 1;
      } else {
        updateFailStmt.run(result.statusCode, result.errorMessage ?? 'unknown error', nowIso(), row.id);

        const retried = retryCounts.get(row.id) ?? 0;
        if (retried < retryCount) {
          const nextRetry = retried + 1;
          retryCounts.set(row.id, nextRetry);
          queue.push(row);
          logInfo(`Retrying later (${nextRetry}/${retryCount}): ${row.path}`);
        } else {
          failed += 1;
        }
      }
      renderProgress('post', count, count + queue.length);
    }
  } finally {
    db.close();
  }

  logInfo(`Post completed. uploaded=${uploaded}, failed=${failed}, skipped_video=${skippedVideo}, db=${dbPath}`);
}
