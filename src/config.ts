import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

/**
 * 環境変数から読み込む Immich サーバーのベース URL。
 */
export const IMMICH_BASE_URL = process.env.IMMICH_BASE_URL;
/**
 * Immich API の認証に使用する API キー。
 */
export const IMMICH_API_KEY = process.env.IMMICH_API_KEY;
/**
 * このツールで使用する SQLite データベースのデフォルトパス。
 */
export const DEFAULT_DB_PATH = path.resolve('immich_toys.db');
