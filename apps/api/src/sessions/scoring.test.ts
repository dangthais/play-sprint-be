import { describe, expect, it } from 'vitest';
import { SEED_RULES } from '../db/seed.ts';
import { verifyScore } from './scoring.ts';
import type { ScoringRule } from './sessions.types.ts';

const rule = (id: string): ScoringRule => {
  const r = SEED_RULES.find((x) => x.gameId === id);
  if (!r) throw new Error('rule');
  return r;
};

describe('verifyScore', () => {
  it('snake boundaries (AC11)', () => {
    const r = rule('snake');
    expect(verifyScore(r, 155, 60_000)).toEqual({ ok: true });
    expect(verifyScore(r, 156, 60_000)).toEqual({ ok: false, reason: 'SCORE_RATE_EXCEEDED' });
    expect(verifyScore(r, 5, 0)).toEqual({ ok: true });
    expect(verifyScore(r, 6, 0)).toEqual({ ok: false, reason: 'SCORE_RATE_EXCEEDED' });
    expect(verifyScore(r, 900, 3_600_000)).toEqual({ ok: true });
    expect(verifyScore(r, 901, 3_600_000)).toEqual({ ok: false, reason: 'SCORE_OUT_OF_RANGE' });
    // floor(2.5/s * 999ms) = 2, cộng slack 5
    expect(verifyScore(r, 7, 999)).toEqual({ ok: true });
    expect(verifyScore(r, 8, 999)).toEqual({ ok: false, reason: 'SCORE_RATE_EXCEEDED' });
  });

  it('brick-breaker and merge-2048 limits', () => {
    expect(verifyScore(rule('brick-breaker'), 45, 0)).toEqual({ ok: true });
    expect(verifyScore(rule('brick-breaker'), 46, 0).ok).toBe(false);
    expect(verifyScore(rule('merge-2048'), 250_000, 7_200_000)).toEqual({ ok: true });
    expect(verifyScore(rule('merge-2048'), 250_001, 7_200_000)).toEqual({
      ok: false,
      reason: 'SCORE_OUT_OF_RANGE',
    });
  });

  it('memory-match (AC10)', () => {
    const r = rule('memory-match');
    expect(verifyScore(r, 8, 2999)).toEqual({ ok: false, reason: 'DURATION_TOO_SHORT' });
    expect(verifyScore(r, 8, 3000)).toEqual({ ok: true });
    expect(verifyScore(r, 20, 14_999)).toEqual({ ok: false, reason: 'DURATION_TOO_SHORT' });
    expect(verifyScore(r, 20, 15_000)).toEqual({ ok: true });
    expect(verifyScore(r, 7, 60_000)).toEqual({ ok: false, reason: 'SCORE_OUT_OF_RANGE' });
    expect(verifyScore(r, 1001, 9_000_000)).toEqual({ ok: false, reason: 'SCORE_OUT_OF_RANGE' });
  });

  it('reasons always match ^[A-Z_]{1,40}$', () => {
    for (const r of SEED_RULES) {
      const v = verifyScore(r, r.maxScore + 1, 0);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.reason).toMatch(/^[A-Z_]{1,40}$/);
    }
  });

  it('does not overflow at the max rate and duration', () => {
    const r: ScoringRule = { ...rule('snake'), maxScorePerSec: 100000, maxScore: 1_000_000_000 };
    expect(verifyScore(r, 5 + 720_000_000, 7_200_000)).toEqual({ ok: true });
    expect(verifyScore(r, 5 + 720_000_001, 7_200_000).ok).toBe(false);
  });
});
