/**
 * Immich への単一アップロードリクエスト結果。
 */
export type UploadResult = {
  success: boolean;
  statusCode: number | null;
  errorMessage: string | null;
};

/**
 * ローカル SQLite データベースに保存する画像レコード。
 */
export type ImageRow = {
  id: number;
  path: string;
  hash: string;
  size: number;
};

/**
 * CLI の進捗表示レンダリングで使用する進捗状態。
 */
export type ProgressState = {
  label: string;
  current: number;
  total: number;
  elapsedText: string;
  etaText: string;
};

/**
 * post コマンド用にパース済みの CLI 引数。
 */
export type PostArgs = {
  dbPath: string;
  excludeVideos: boolean;
  quietSuccess: boolean;
  retryCount: number;
};
