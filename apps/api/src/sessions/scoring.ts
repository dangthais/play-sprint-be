import type { ScoringRule } from './sessions.types.ts';

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export const MAX_SCORE = 1_000_000_000;

/**
 * Xác minh điểm theo luật của game (ADR-016). Hàm thuần; `durationMs` do server đo.
 * Bốn bước tuần tự, dừng ở lỗi đầu tiên. Phép tính rate dùng số nguyên.
 */
export function verifyScore(rule: ScoringRule, score: number, durationMs: number): VerifyResult {
  if (score < rule.minScore || score > rule.maxScore) {
    return { ok: false, reason: 'SCORE_OUT_OF_RANGE' };
  }
  if (durationMs < rule.minDurationMs) {
    return { ok: false, reason: 'DURATION_TOO_SHORT' };
  }
  if (rule.maxScorePerSec !== null) {
    const perSecMilli = Math.round(rule.maxScorePerSec * 1000);
    const product = perSecMilli * durationMs;
    // floor(product / 1_000_000) bằng số nguyên (product < 2^53 với trần 100000/s và < 2 giờ).
    const allowed = rule.scoreSlack + (product - (product % 1_000_000)) / 1_000_000;
    if (score > allowed) return { ok: false, reason: 'SCORE_RATE_EXCEEDED' };
  }
  if (rule.minMsPerScore !== null) {
    if (durationMs < rule.minDurationMs + rule.minMsPerScore * (score - rule.minScore)) {
      return { ok: false, reason: 'DURATION_TOO_SHORT' };
    }
  }
  return { ok: true };
}
