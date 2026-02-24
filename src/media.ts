import fs from 'fs';
import path from 'path';
import { MEDIA_EXTENSIONS, VIDEO_EXTENSIONS } from './constants.js';

/**
 * 指定したパスが対応メディア拡張子を持つ場合に true を返します。
 *
 * @param filePath 絶対パスまたは相対パス。
 * @returns メディアとして扱うかどうか。
 */
export function isMediaFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return MEDIA_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * 指定したパスが対応動画拡張子を持つ場合に true を返します。
 *
 * @param filePath 絶対パスまたは相対パス。
 * @returns 動画として扱うかどうか。
 */
export function isVideoFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * ディレクトリを再帰的に走査し、対応メディアファイルをすべて返します。
 *
 * @param dir 走査対象のルートディレクトリ。
 * @returns 解決済みメディアファイルパスの配列。
 */
export function getAllImageFiles(dir: string): string[] {
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
