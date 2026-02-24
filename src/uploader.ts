import fs from 'fs';
import path from 'path';
import axios from 'axios';
import FormData from 'form-data';
import { IMMICH_API_KEY, IMMICH_BASE_URL } from './config.js';
import { UploadResult } from './types.js';
import { logError, logInfo } from './utils/progress.js';

/**
 * 単一のメディアファイルを Immich にアップロードします。
 *
 * @param filePath メディアファイルのパス。
 * @param hash 安定した device asset id を作るためのコンテンツハッシュ。
 * @param size ファイルサイズ（バイト）。
 * @param msg 進捗表示用メッセージ。
 * @param quietSuccess true の場合は成功ログを抑制します。
 * @returns ステータスコードとエラー詳細を含むアップロード結果。
 */
export async function uploadImage(filePath: string, hash: string, size: number, msg: string, quietSuccess: boolean): Promise<UploadResult> {
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
