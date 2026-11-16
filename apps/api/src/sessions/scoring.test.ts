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

  describe('F5 rules (AC9, table-driven)', () => {
    const F5 = [
      'maze-chomp',
      'sky-hop',
      'block-drop',
      'space-shooter',
      'asteroid-blaster',
      'frog-crossing',
      'bubble-pop',
      'mole-smash',
      'typing-race',
      'simon-says',
      'minesweeper',
      'sliding-puzzle',
      'code-breaker',
      'word-guess',
      'reversi',
    ];
    // Thời lượng dư để không dính ràng buộc thời lượng/tốc độ khi kiểm ranh giới điểm.
    const LONG = 100_000_000;

    it.each(F5)('%s: max + 1 is out of range, max is ok with ample duration', (id) => {
      const r = rule(id);
      expect(verifyScore(r, r.maxScore + 1, LONG)).toEqual({
        ok: false,
        reason: 'SCORE_OUT_OF_RANGE',
      });
      expect(verifyScore(r, r.maxScore, LONG)).toEqual({ ok: true });
    });

    it.each(F5.filter((id) => rule(id).minScore > 0))('%s: min - 1 is out of range', (id) => {
      const r = rule(id);
      expect(verifyScore(r, r.minScore - 1, LONG)).toEqual({
        ok: false,
        reason: 'SCORE_OUT_OF_RANGE',
      });
      expect(verifyScore(r, r.minScore, LONG)).toEqual({ ok: true });
    });

    it.each(F5.filter((id) => rule(id).minDurationMs > 0))(
      '%s: min_duration_ms - 1 is too short, exactly min is ok',
      (id) => {
        const r = rule(id);
        const score = r.minScore;
        expect(verifyScore(r, score, r.minDurationMs - 1)).toEqual({
          ok: false,
          reason: 'DURATION_TOO_SHORT',
        });
        expect(verifyScore(r, score, r.minDurationMs)).toEqual({ ok: true });
      },
    );

    it.each(F5.filter((id) => rule(id).maxScorePerSec !== null))(
      '%s: rate ceiling at 10 s',
      (id) => {
        const r = rule(id);
        const ceiling = Math.min(
          r.maxScore,
          r.scoreSlack + Math.floor((r.maxScorePerSec ?? 0) * 10),
        );
        expect(verifyScore(r, ceiling, 10_000)).toEqual({ ok: true });
        if (ceiling < r.maxScore) {
          expect(verifyScore(r, ceiling + 1, 10_000)).toEqual({
            ok: false,
            reason: 'SCORE_RATE_EXCEEDED',
          });
        }
      },
    );

    it.each(F5.filter((id) => rule(id).minMsPerScore !== null))(
      '%s: min_ms_per_score boundary',
      (id) => {
        const r = rule(id);
        const per = r.minMsPerScore ?? 0;
        const score = Math.min(r.minScore + 10, r.maxScore);
        const need = r.minDurationMs + per * (score - r.minScore);
        expect(verifyScore(r, score, need - 1).ok).toBe(false);
        expect(verifyScore(r, score, need)).toEqual({ ok: true });
      },
    );

    it('documented examples', () => {
      const typing = rule('typing-race');
      expect(verifyScore(typing, 30, 65_999)).toEqual({ ok: false, reason: 'DURATION_TOO_SHORT' });
      expect(verifyScore(typing, 30, 66_000)).toEqual({ ok: true });
      const simon = rule('simon-says');
      expect(verifyScore(simon, 10, 29_999).ok).toBe(false);
      expect(verifyScore(simon, 10, 30_000)).toEqual({ ok: true });
      const mole = rule('mole-smash');
      expect(verifyScore(mole, 20, 9_499).ok).toBe(false);
      expect(verifyScore(mole, 20, 9_500)).toEqual({ ok: true });
    });
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
