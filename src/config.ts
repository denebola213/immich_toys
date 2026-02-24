import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export const IMMICH_BASE_URL = process.env.IMMICH_BASE_URL;
export const IMMICH_API_KEY = process.env.IMMICH_API_KEY;
export const DEFAULT_DB_PATH = path.resolve('immich_toys.db');
