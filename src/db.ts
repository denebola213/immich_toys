import Database from 'better-sqlite3';

export function initDb(dbPath: string): Database.Database {
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
