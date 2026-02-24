import { ProgressState } from '../types.js';

let activeProgress: ProgressState | null = null;
const progressStartTimes = new Map<string, number>();

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return '--:--';
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function drawProgress(progress: ProgressState) {
  const ratio = Math.min(1, Math.max(0, progress.current / progress.total));
  const percent = (ratio * 100).toFixed(1);
  const width = 30;
  const filled = Math.round(ratio * width);
  const bar = `${'='.repeat(filled)}${'-'.repeat(Math.max(0, width - filled))}`;
  process.stdout.write(`\r${progress.label} [${bar}] ${percent}% (${progress.current}/${progress.total}) elapsed ${progress.elapsedText} eta ${progress.etaText}`);
}

function withProgressSafeLog(write: () => void) {
  const hasActiveProgress = process.stdout.isTTY && activeProgress !== null;

  if (hasActiveProgress) {
    process.stdout.write('\n');
  }

  write();

  if (hasActiveProgress && activeProgress !== null) {
    drawProgress(activeProgress);
  }
}

/**
 * 進捗表示を崩さずに情報メッセージを出力します。
 *
 * @param message stdout に出力するメッセージ。
 */
export function logInfo(message: string) {
  withProgressSafeLog(() => {
    process.stdout.write(`${message}\n`);
  });
}

/**
 * 進捗表示を崩さずにエラーメッセージを出力します。
 *
 * @param message stderr に出力するメッセージ。
 */
export function logError(message: string) {
  withProgressSafeLog(() => {
    process.stderr.write(`${message}\n`);
  });
}

/**
 * TTY では進捗バーを更新し、非 TTY では定期的にテキスト進捗を出力します。
 *
 * @param label 進捗ラベル。
 * @param current 現在の処理済み件数。
 * @param total 全体件数。
 */
export function renderProgress(label: string, current: number, total: number) {
  if (total <= 0) {
    return;
  }

  if (process.stdout.isTTY) {
    const now = Date.now();
    const startMs = progressStartTimes.get(label) ?? now;
    if (!progressStartTimes.has(label)) {
      progressStartTimes.set(label, startMs);
    }

    const elapsedMs = Math.max(0, now - startMs);
    const etaMs = current > 0
      ? (elapsedMs / current) * Math.max(0, total - current)
      : Number.NaN;

    activeProgress = {
      label,
      current,
      total,
      elapsedText: formatDuration(elapsedMs),
      etaText: current >= total ? '00:00' : formatDuration(etaMs),
    };
    drawProgress(activeProgress);
    if (current >= total) {
      process.stdout.write('\n');
      activeProgress = null;
      progressStartTimes.delete(label);
    }
    return;
  }

  const ratio = Math.min(1, Math.max(0, current / total));
  const percent = (ratio * 100).toFixed(1);
  if (current === 1 || current === total || current % 100 === 0) {
    logInfo(`${label}: ${current}/${total} (${percent}%)`);
  }
}
