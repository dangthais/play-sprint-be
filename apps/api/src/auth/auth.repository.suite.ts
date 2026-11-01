import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashToken } from '../sessions/token.ts';
import { AuthConflictError, type AuthRepository, type AuthSessionInput } from './auth.types.ts';

const T0 = new Date(Date.UTC(2026, 9, 24, 8, 0, 0));
const DAY = 24 * 60 * 60 * 1000;
const HASH =
  'scrypt$v=1$n=32768,r=8,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';

let counter = 0;
function session(tag: string, at = T0, ttl = 30 * DAY): AuthSessionInput {
  return {
    id: randomUUID(),
    tokenHash: hashToken(`${tag}-${++counter}-${randomUUID()}`),
    createdAt: at,
    expiresAt: new Date(at.getTime() + ttl),
  };
}

function reg(
  repo: AuthRepository,
  over: Partial<{ email: string; name: string; session: AuthSessionInput; replace: Buffer }> = {},
) {
  const name = over.name ?? `N${++counter}`;
  const s = over.session ?? session('reg');
  return {
    s,
    p: repo.register({
      id: randomUUID(),
      email: over.email ?? `u${++counter}@example.com`,
      passwordHash: HASH,
      displayName: name,
      displayNameKey: name.toLowerCase(),
      now: T0,
      session: s,
      replaceTokenHash: over.replace ?? null,
    }),
  };
}

/** Bộ test dùng chung cho repository pg và in-memory (cùng ngữ nghĩa). `setup` trả repo sạch. */
export function describeAuthRepository(
  label: string,
  setup: () => Promise<{ repo: AuthRepository }>,
): void {
  describe(`auth repository (${label})`, () => {
    it('register creates user + session; findSession resolves; findByEmail returns hash', async () => {
      const { repo } = await setup();
      const { s, p } = reg(repo, { email: 'lan@example.com', name: 'Lan' });
      const user = await p;
      expect(user).toMatchObject({
        email: 'lan@example.com',
        displayName: 'Lan',
        displayNameKey: 'lan',
        createdAt: T0,
      });
      expect(await repo.findSession(s.tokenHash, T0)).toEqual({
        user,
        authSessionId: s.id,
      });
      const found = await repo.findByEmail('lan@example.com');
      expect(found).toMatchObject({ id: user.id, passwordHash: HASH });
      expect(await repo.findByEmail('nobody@example.com')).toBeNull();
      expect(await repo.findPasswordHash(user.id)).toBe(HASH);
      expect(await repo.findPasswordHash(randomUUID())).toBeNull();
    });

    it('session valid until expires_at exclusive (30 days fixed)', async () => {
      const { repo } = await setup();
      const { s, p } = reg(repo);
      await p;
      expect(
        await repo.findSession(s.tokenHash, new Date(T0.getTime() + 30 * DAY - 1)),
      ).not.toBeNull();
      expect(await repo.findSession(s.tokenHash, new Date(T0.getTime() + 30 * DAY))).toBeNull();
      expect(await repo.findSession(hashToken('other'), T0)).toBeNull();
    });

    it('duplicate email (any case handled by caller) -> EMAIL; duplicate name key -> NAME', async () => {
      const { repo } = await setup();
      await reg(repo, { email: 'a@example.com', name: 'Lan' }).p;
      await expect(reg(repo, { email: 'a@example.com', name: 'Other' }).p).rejects.toMatchObject({
        name: 'AuthConflictError',
        field: 'EMAIL',
      });
      await expect(reg(repo, { email: 'b@example.com', name: 'LAN' }).p).rejects.toBeInstanceOf(
        AuthConflictError,
      );
      await expect(reg(repo, { email: 'b@example.com', name: 'LAN' }).p).rejects.toMatchObject({
        field: 'NAME',
      });
      // Cả hai trùng: EMAIL được báo trước (contract).
      await expect(reg(repo, { email: 'a@example.com', name: 'lan' }).p).rejects.toMatchObject({
        field: 'EMAIL',
      });
    });

    it('failed register leaves nothing behind (no session, replaced session kept)', async () => {
      const { repo } = await setup();
      const old = reg(repo, { name: 'Old' });
      await old.p;
      const s = session('x');
      await expect(
        reg(repo, { name: 'Old', session: s, replace: old.s.tokenHash }).p,
      ).rejects.toThrow();
      expect(await repo.findSession(s.tokenHash, T0)).toBeNull();
      expect(await repo.findSession(old.s.tokenHash, T0)).not.toBeNull();
    });

    it('register with replaceTokenHash deletes the old session', async () => {
      const { repo } = await setup();
      const first = reg(repo, { name: 'First' });
      await first.p;
      const second = reg(repo, { name: 'Second', replace: first.s.tokenHash });
      await second.p;
      expect(await repo.findSession(first.s.tokenHash, T0)).toBeNull();
      expect(await repo.findSession(second.s.tokenHash, T0)).not.toBeNull();
    });

    it('concurrent registers with the same email: exactly one wins', async () => {
      const { repo } = await setup();
      const results = await Promise.allSettled([
        reg(repo, { email: 'race@example.com', name: 'RaceA' }).p,
        reg(repo, { email: 'race@example.com', name: 'RaceB' }).p,
        reg(repo, { email: 'race@example.com', name: 'RaceC' }).p,
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of results) {
        if (r.status === 'rejected') expect(r.reason).toMatchObject({ field: 'EMAIL' });
      }
    });

    it('startSession: creates session, replaces old, cleans own expired sessions', async () => {
      const { repo } = await setup();
      const old = session('old', T0, 1000);
      const { s, p } = reg(repo, { session: old });
      const user = await p;
      const later = new Date(T0.getTime() + DAY);
      const newer = session('new', later);
      await repo.startSession({
        userId: user.id,
        verifiedPasswordHash: HASH,
        now: later,
        session: newer,
        replaceTokenHash: null,
        rehash: null,
      });
      expect(await repo.findSession(newer.tokenHash, later)).not.toBeNull();
      // Phiên đã hết hạn của chính user bị dọn: kể cả hỏi lại với thời điểm cũ cũng không thấy.
      expect(await repo.findSession(s.tokenHash, T0)).toBeNull();

      const third = session('third', later);
      await repo.startSession({
        userId: user.id,
        verifiedPasswordHash: HASH,
        now: later,
        session: third,
        replaceTokenHash: newer.tokenHash,
        rehash: null,
      });
      expect(await repo.findSession(newer.tokenHash, later)).toBeNull();
      expect(await repo.findSession(third.tokenHash, later)).not.toBeNull();
    });

    it('startSession with rehash replaces the verified hash', async () => {
      const { repo } = await setup();
      const { p } = reg(repo, { email: 'rh@example.com' });
      const user = await p;
      const newHash = HASH.replace('aGFz', 'bmV3');
      const s = session('b');
      expect(
        await repo.startSession({
          userId: user.id,
          verifiedPasswordHash: HASH,
          now: T0,
          session: s,
          replaceTokenHash: null,
          rehash: newHash,
        }),
      ).toBe(true);
      expect(await repo.findPasswordHash(user.id)).toBe(newHash);
      expect(await repo.findSession(s.tokenHash, T0)).not.toBeNull();
    });

    it('startSession refuses (no session, no rehash) when the verified hash is stale or the user is gone', async () => {
      const { repo } = await setup();
      const { p } = reg(repo, { email: 'stale@example.com' });
      const user = await p;
      const stale = session('stale');
      expect(
        await repo.startSession({
          userId: user.id,
          verifiedPasswordHash: 'scrypt$something-else',
          now: T0,
          session: stale,
          replaceTokenHash: null,
          rehash: 'scrypt$ignored',
        }),
      ).toBe(false);
      expect(await repo.findPasswordHash(user.id)).toBe(HASH);
      expect(await repo.findSession(stale.tokenHash, T0)).toBeNull();
      const ghost = session('ghost');
      expect(
        await repo.startSession({
          userId: randomUUID(),
          verifiedPasswordHash: HASH,
          now: T0,
          session: ghost,
          replaceTokenHash: null,
          rehash: null,
        }),
      ).toBe(false);
      expect(await repo.findSession(ghost.tokenHash, T0)).toBeNull();
    });

    it('race: startSession (old hash) vs changePassword -> the old-password session never survives', async () => {
      for (let i = 0; i < 10; i++) {
        const { repo } = await setup();
        const { p } = reg(repo, { email: `race${i}@example.com` });
        const user = await p;
        const attacker = session('attacker');
        const fresh = session('fresh');
        const [started] = await Promise.all([
          repo.startSession({
            userId: user.id,
            verifiedPasswordHash: HASH,
            now: T0,
            session: attacker,
            replaceTokenHash: null,
            rehash: null,
          }),
          repo.changePassword({
            verifiedPasswordHash: HASH,
            userId: user.id,
            passwordHash: 'scrypt$new',
            now: T0,
            session: fresh,
          }),
        ]);
        // Dù thứ tự nào: sau khi cả hai xong, chỉ phiên của changePassword còn hợp lệ.
        expect(await repo.findSession(attacker.tokenHash, T0)).toBeNull();
        expect(await repo.findSession(fresh.tokenHash, T0)).not.toBeNull();
        expect(typeof started).toBe('boolean');
      }
    });

    it('deleteSession is idempotent and only deletes that session', async () => {
      const { repo } = await setup();
      const a = reg(repo, { name: 'A' });
      await a.p;
      const b = reg(repo, { name: 'B' });
      await b.p;
      await repo.deleteSession(a.s.tokenHash);
      await repo.deleteSession(a.s.tokenHash);
      expect(await repo.findSession(a.s.tokenHash, T0)).toBeNull();
      expect(await repo.findSession(b.s.tokenHash, T0)).not.toBeNull();
    });

    it('race: two changePassword with the same verified hash -> exactly one wins, the loser changes nothing', async () => {
      for (let i = 0; i < 10; i++) {
        const { repo } = await setup();
        const { p } = reg(repo, { email: `cp${i}@example.com` });
        const user = await p;
        const sa = session('A');
        const sb = session('B');
        const [ra, rb] = await Promise.all([
          repo.changePassword({
            userId: user.id,
            verifiedPasswordHash: HASH,
            passwordHash: 'scrypt$A',
            now: T0,
            session: sa,
          }),
          repo.changePassword({
            userId: user.id,
            verifiedPasswordHash: HASH,
            passwordHash: 'scrypt$B',
            now: T0,
            session: sb,
          }),
        ]);
        expect([ra, rb].filter(Boolean)).toHaveLength(1);
        const [winner, loser] = ra ? [sa, sb] : [sb, sa];
        expect(await repo.findPasswordHash(user.id)).toBe(ra ? 'scrypt$A' : 'scrypt$B');
        expect(await repo.findSession(winner.tokenHash, T0)).not.toBeNull();
        expect(await repo.findSession(loser.tokenHash, T0)).toBeNull();
      }
    });

    it('changePassword with a stale verified hash returns false and keeps sessions', async () => {
      const { repo } = await setup();
      const a = reg(repo, { name: 'Stale' });
      const user = await a.p;
      const s = session('s');
      expect(
        await repo.changePassword({
          userId: user.id,
          verifiedPasswordHash: 'scrypt$other',
          passwordHash: 'scrypt$x',
          now: T0,
          session: s,
        }),
      ).toBe(false);
      expect(await repo.findPasswordHash(user.id)).toBe(HASH);
      expect(await repo.findSession(a.s.tokenHash, T0)).not.toBeNull();
      expect(await repo.findSession(s.tokenHash, T0)).toBeNull();
    });

    it('changePassword replaces hash, deletes ALL sessions of the user (not others), adds a new one', async () => {
      const { repo } = await setup();
      const a = reg(repo, { name: 'A' });
      const user = await a.p;
      const a2 = session('a2');
      await repo.startSession({
        userId: user.id,
        verifiedPasswordHash: HASH,
        now: T0,
        session: a2,
        replaceTokenHash: null,
        rehash: null,
      });
      const other = reg(repo, { name: 'Other' });
      await other.p;
      const fresh = session('fresh');
      const ok = await repo.changePassword({
        verifiedPasswordHash: HASH,
        userId: user.id,
        passwordHash: 'scrypt$new',
        now: T0,
        session: fresh,
      });
      expect(ok).toBe(true);
      expect(await repo.findPasswordHash(user.id)).toBe('scrypt$new');
      expect(await repo.findSession(a.s.tokenHash, T0)).toBeNull();
      expect(await repo.findSession(a2.tokenHash, T0)).toBeNull();
      expect(await repo.findSession(fresh.tokenHash, T0)).not.toBeNull();
      expect(await repo.findSession(other.s.tokenHash, T0)).not.toBeNull();
      expect(
        await repo.changePassword({
          verifiedPasswordHash: HASH,
          userId: randomUUID(),
          passwordHash: 'scrypt$x',
          now: T0,
          session: session('z'),
        }),
      ).toBe(false);
    });

    it('updateDisplayName: conflict with another user, case change of own name allowed', async () => {
      const { repo } = await setup();
      const lan = await reg(repo, { name: 'Lan' }).p;
      await reg(repo, { name: 'Minh' }).p;
      await expect(
        repo.updateDisplayName({
          userId: lan.id,
          displayName: 'MINH',
          displayNameKey: 'minh',
          now: T0,
        }),
      ).rejects.toMatchObject({ field: 'NAME' });
      const renamed = await repo.updateDisplayName({
        userId: lan.id,
        displayName: 'LAN',
        displayNameKey: 'lan',
        now: T0,
      });
      expect(renamed).toMatchObject({ displayName: 'LAN', displayNameKey: 'lan' });
      const again = await repo.updateDisplayName({
        userId: lan.id,
        displayName: 'Lan Anh',
        displayNameKey: 'lan anh',
        now: T0,
      });
      expect(again?.displayName).toBe('Lan Anh');
      expect(
        await repo.updateDisplayName({
          userId: randomUUID(),
          displayName: 'Zed',
          displayNameKey: 'zed',
          now: T0,
        }),
      ).toBeNull();
    });

    it('isDisplayNameKeyTaken', async () => {
      const { repo } = await setup();
      await reg(repo, { name: 'Lan' }).p;
      expect(await repo.isDisplayNameKeyTaken('lan')).toBe(true);
      expect(await repo.isDisplayNameKeyTaken('Lan')).toBe(false); // khoá là chữ thường
      expect(await repo.isDisplayNameKeyTaken('minh')).toBe(false);
    });
  });
}
