import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import Database from 'better-sqlite3';
import xxhash from 'xxhash-wasm';
import dotenv from 'dotenv';

dotenv.config();

const IMMICH_BASE_URL = process.env.IMMICH_BASE_URL;
const IMMICH_API_KEY = process.env.IMMICH_API_KEY;
const DEFAULT_DB_PATH = path.resolve('immich_toys.db');

const VIDEO_EXTENSIONS = [
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.m4v', '.3gp', '.mts', '.ts', '.m2ts', '.mpeg', '.mpg',
];

const MEDIA_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic',
  '.cr2', '.cr3', '.crw',
  '.fit', '.fits', '.fts', '.dcm', '.nii', '.nii.gz', '.tif', '.tiff',
  ...VIDEO_EXTENSIONS,
];

type UploadResult = {
  success: boolean;
  statusCode: number | null;
  errorMessage: string | null;
};

type ImageRow = {
  id: number;
  path: string;
  hash: string;
  size: number;
};

type CompletedLogEntry = {
  path: string;
  statusCode: number | null;
};

type ProgressState = {
  label: string;
  current: number;
  total: number;
  elapsedText: string;
  etaText: string;
};

let activeProgress: ProgressState | null = null;
const progressStartTimes = new Map<string, number>();

function printUsage() {
  console.error('Usage:');
  console.error('  yarn start update <TARGET_FOLDER> [DB_PATH]');
  console.error('  yarn start post [DB_PATH] [--exclude-videos] [--quiet-success]');
  console.error('  yarn start import-log <LOG_PATH> [DB_PATH]');
}

function nowIso(): string {
  return new Date().toISOString();
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return '--:--';
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function drawProgress(progress: ProgressState) {
  const ratio = Math.min(1, Math.max(0, progress.current / progress.total));
  const percent = (ratio * 100).toFixed(1);
  const width = 30;
  const filled = Math.round(ratio * width);
  const bar = `${'='.repeat(filled)}${'-'.repeat(Math.max(0, width - filled))}`;
  process.stdout.write(`\r${progress.label} [${bar}] ${percent}% (${progress.current}/${progress.total}) elapsed ${progress.elapsedText} eta ${progress.etaText}`);
}

function withProgressSafeLog(write: () => void) {
  const hasActiveProgress = process.stdout.isTTY && activeProgress !== null;

  if (hasActiveProgress) {
    process.stdout.write('\n');
  }

  write();

  if (hasActiveProgress && activeProgress !== null) {
    drawProgress(activeProgress);
  }
}

function logInfo(message: string) {
  withProgressSafeLog(() => {
    process.stdout.write(`${message}\n`);
  });
}

function logError(message: string) {
  withProgressSafeLog(() => {
    process.stderr.write(`${message}\n`);
  });
}

function renderProgress(label: string, current: number, total: number) {
  if (total <= 0) {
    return;
  }

  if (process.stdout.isTTY) {
    const now = Date.now();
    const startMs = progressStartTimes.get(label) ?? now;
    if (!progressStartTimes.has(label)) {
      progressStartTimes.set(label, startMs);
    }

    const elapsedMs = Math.max(0, now - startMs);
    const etaMs = current > 0
      ? (elapsedMs / current) * Math.max(0, total - current)
      : Number.NaN;

    activeProgress = {
      label,
      current,
      total,
      elapsedText: formatDuration(elapsedMs),
      etaText: current >= total ? '00:00' : formatDuration(etaMs),
    };
    drawProgress(activeProgress);
    if (current >= total) {
      process.stdout.write('\n');
      activeProgress = null;
      progressStartTimes.delete(label);
    }
    return;
  }

  const ratio = Math.min(1, Math.max(0, current / total));
  const percent = (ratio * 100).toFixed(1);
  if (current === 1 || current === total || current % 100 === 0) {
    logInfo(`${label}: ${current}/${total} (${percent}%)`);
  }
}

function isMediaFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return MEDIA_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function isVideoFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function getAllImageFiles(dir: string): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);

  for (const file of list) {
    const filePath = path.resolve(path.join(dir, file));
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      results = results.concat(getAllImageFiles(filePath));
    } else if (isMediaFile(filePath)) {
      results.push(filePath);
    }
  }

  return results;
}

function initDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      hash TEXT NOT NULL,
      size INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      status_code INTEGER,
      uploaded_at TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_images_hash_size
    ON images(hash, size);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_images_status
    ON images(status);
  `);

  return db;
}

async function hashFile(filePath: string, api: Awaited<ReturnType<typeof xxhash>>): Promise<string> {
  const hasher = api.create64(0n);

  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => {
      hasher.update(chunk as Buffer);
    });
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });

  return hasher.digest().toString(16).padStart(16, '0');
}

function parseCompletedEntriesFromLog(logPath: string): CompletedLogEntry[] {
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

async function uploadImage(filePath: string, hash: string, size: number, msg: string, quietSuccess: boolean): Promise<UploadResult> {
  if (!IMMICH_BASE_URL || !IMMICH_API_KEY) {
    throw new Error('IMMICH_BASE_URL or IMMICH_API_KEY is not set in .env');
  }

  const stat = fs.statSync(filePath);
  const createdAtMs = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs;

  const form = new FormData();
  form.append('assetData', fs.createReadStream(filePath), path.basename(filePath));
  form.append('deviceAssetId', `${hash}-${size}`);
  form.append('deviceId', 'immich_toys');
  form.append('fileCreatedAt', new Date(createdAtMs).toISOString());
  form.append('fileModifiedAt', new Date(stat.mtimeMs).toISOString());
  form.append('isFavorite', 'false');

  try {
    const response = await axios.post(`${IMMICH_BASE_URL}/assets`, form, {
      headers: {
        ...form.getHeaders(),
        'x-api-key': IMMICH_API_KEY,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    if (!quietSuccess) {
      logInfo(`Uploaded: ${filePath} -> ${response.status}  : ${msg}`);
    }
    return {
      success: true,
      statusCode: response.status,
      errorMessage: null,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const statusCode = error.response?.status ?? null;
      const message = error.message;
      logError(`Failed: ${filePath} -> ${message}  : ${msg}`);
      return {
        success: false,
        statusCode,
        errorMessage: message,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    logError(`Failed: ${filePath} -> ${message}  : ${msg}`);
    return {
      success: false,
      statusCode: null,
      errorMessage: message,
    };
  }
}

async function runUpdate(targetFolder: string, dbPath: string) {
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

type PostArgs = {
  dbPath: string;
  excludeVideos: boolean;
  quietSuccess: boolean;
};

function parsePostArgs(args: string[]): PostArgs {
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

async function runPost(dbPath: string, excludeVideos: boolean, quietSuccess: boolean) {
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

async function runImportLog(logPath: string, dbPath: string) {
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
    const { dbPath, excludeVideos, quietSuccess } = parsePostArgs(process.argv.slice(3));
    await runPost(dbPath, excludeVideos, quietSuccess);
    return;
  }

  if (command === 'import-log') {
    const logPath = process.argv[3];
    const dbPath = path.resolve(process.argv[4] ?? DEFAULT_DB_PATH);
    if (!logPath) {
      printUsage();
      process.exit(1);
    }
    await runImportLog(path.resolve(logPath), dbPath);
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
