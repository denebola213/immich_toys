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

const IMAGE_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic',
  '.cr2', '.cr3', '.crw',
  '.fit', '.fits', '.fts', '.dcm', '.nii', '.nii.gz', '.tif', '.tiff',
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.m4v', '.3gp', '.mts', '.ts', '.m2ts', '.mpeg', '.mpg',
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

function printUsage() {
  console.error('Usage:');
  console.error('  yarn start update <TARGET_FOLDER> [DB_PATH]');
  console.error('  yarn start post [DB_PATH]');
}

function nowIso(): string {
  return new Date().toISOString();
}

function isMediaFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
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

async function uploadImage(filePath: string, hash: string, size: number, msg: string): Promise<UploadResult> {
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

    console.log(`Uploaded: ${filePath} -> ${response.status}  : ${msg}`);
    return {
      success: true,
      statusCode: response.status,
      errorMessage: null,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const statusCode = error.response?.status ?? null;
      const message = error.message;
      console.error(`Failed: ${filePath} -> ${message}  : ${msg}`);
      return {
        success: false,
        statusCode,
        errorMessage: message,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed: ${filePath} -> ${message}  : ${msg}`);
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
  console.log(`Found ${files.length} image(s).`);

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
      if (index % 100 === 0 || index === files.length) {
        console.log(`Indexed ${index}/${files.length} files.`);
      }
    }
  } finally {
    db.close();
  }

  console.log(`Update completed. inserted=${inserted}, skipped=${skipped}, db=${dbPath}`);
}

async function runPost(dbPath: string) {
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
  console.log(`Found ${rows.length} image(s) to upload.`);

  try {
    let count = 0;
    for (const row of rows) {
      count += 1;
      if (!fs.existsSync(row.path)) {
        const message = 'File not found';
        console.error(`Failed: ${row.path} -> ${message}  : ${count}/${rows.length}`);
        updateFailStmt.run(null, message, nowIso(), row.id);
        continue;
      }

      const result = await uploadImage(row.path, row.hash, row.size, `${count}/${rows.length}`);
      if (result.success) {
        updateSuccessStmt.run(result.statusCode, nowIso(), nowIso(), row.id);
      } else {
        updateFailStmt.run(result.statusCode, result.errorMessage ?? 'unknown error', nowIso(), row.id);
      }
    }
  } finally {
    db.close();
  }
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
    const dbPath = path.resolve(process.argv[3] ?? DEFAULT_DB_PATH);
    await runPost(dbPath);
    return;
  }

  printUsage();
  process.exit(1);
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
