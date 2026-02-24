import fs from 'fs';
import path from 'path';
import { MEDIA_EXTENSIONS, VIDEO_EXTENSIONS } from './constants.js';

export function isMediaFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return MEDIA_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export function isVideoFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext));
}

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
