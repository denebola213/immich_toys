/**
 * 動画アセットとして扱う拡張子一覧。
 */
export const VIDEO_EXTENSIONS = [
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.m4v', '.3gp', '.mts', '.ts', '.m2ts', '.mpeg', '.mpg',
];

/**
 * メディアアセット（画像 + 動画）として扱う拡張子一覧。
 */
export const MEDIA_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic',
  '.cr2', '.cr3', '.crw',
  '.fit', '.fits', '.fts', '.dcm', '.nii', '.nii.gz', '.tif', '.tiff',
  ...VIDEO_EXTENSIONS,
];

/**
 * アップロード失敗時のデフォルト最大リトライ回数。
 */
export const POST_MAX_RETRY_COUNT = 5;
