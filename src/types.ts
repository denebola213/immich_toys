export type UploadResult = {
  success: boolean;
  statusCode: number | null;
  errorMessage: string | null;
};

export type ImageRow = {
  id: number;
  path: string;
  hash: string;
  size: number;
};

export type ProgressState = {
  label: string;
  current: number;
  total: number;
  elapsedText: string;
  etaText: string;
};

export type PostArgs = {
  dbPath: string;
  excludeVideos: boolean;
  quietSuccess: boolean;
  retryCount: number;
};
