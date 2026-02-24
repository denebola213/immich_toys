/**
 * 現在時刻を ISO-8601 形式で返します。
 *
 * @returns 現在の UTC 日時文字列。
 */
export function nowIso(): string {
  return new Date().toISOString();
}
