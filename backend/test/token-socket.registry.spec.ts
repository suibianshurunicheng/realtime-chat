import { TokenSocketRegistry } from '../src/realtime/token-socket.registry';

/**
 * Unit coverage of the in-process TokenSocketRegistry (Phase 2.3B). Pure logic,
 * no DB / Redis / Socket.IO — safe to run anywhere via `npm run test:unit`.
 *
 * Focus: the jti → socketId index is correct, mutations are idempotent, repeated
 * unregister / clear never throw, the same jti can hold multiple sockets, and two
 * different jtis never bleed into each other.
 */
describe('TokenSocketRegistry (unit)', () => {
  let reg: TokenSocketRegistry;

  beforeEach(() => {
    reg = new TokenSocketRegistry();
  });

  it('register then getSocketIds returns the socket', () => {
    reg.register('jti-A', 'sock-1');
    expect(reg.getSocketIds('jti-A')).toEqual(['sock-1']);
  });

  it('re-registering the same socket is idempotent (no duplicate)', () => {
    reg.register('jti-A', 'sock-1');
    reg.register('jti-A', 'sock-1');
    expect(reg.getSocketIds('jti-A')).toEqual(['sock-1']);
  });

  it('unregister removes the socket; absent socket is a no-op', () => {
    reg.register('jti-A', 'sock-1');
    reg.unregister('jti-A', 'sock-1');
    expect(reg.getSocketIds('jti-A')).toEqual([]);
    // Removing again must not throw.
    expect(() => reg.unregister('jti-A', 'sock-1')).not.toThrow();
  });

  it('unregistering a different jti does not touch this one', () => {
    reg.register('jti-A', 'sock-1');
    reg.unregister('jti-B', 'sock-1');
    expect(reg.getSocketIds('jti-A')).toEqual(['sock-1']);
  });

  it('clear removes by socketId regardless of which jti it belonged to', () => {
    reg.register('jti-A', 'sock-1');
    reg.clear('sock-1');
    expect(reg.getSocketIds('jti-A')).toEqual([]);
    expect(() => reg.clear('sock-1')).not.toThrow();
  });

  it('the same jti can hold multiple sockets; revoke returns the count', () => {
    const revoked: string[][] = [];
    reg.setRevoker((ids) => revoked.push(ids));
    reg.register('jti-A', 'sock-1');
    reg.register('jti-A', 'sock-2');
    expect(reg.getSocketIds('jti-A').sort()).toEqual(['sock-1', 'sock-2']);
    const n = reg.revoke('jti-A');
    expect(n).toBe(2);
    expect(revoked).toEqual([['sock-1', 'sock-2']]);
  });

  it('different jtis stay isolated; revoking one does not affect the other', () => {
    const revoked: string[][] = [];
    reg.setRevoker((ids) => revoked.push(ids));
    reg.register('jti-A', 'sock-1');
    reg.register('jti-B', 'sock-2');
    expect(reg.revoke('jti-A')).toBe(1);
    expect(revoked).toEqual([['sock-1']]);
    expect(reg.getSocketIds('jti-B')).toEqual(['sock-2']);
  });

  it('revoke with no revoker installed and no sockets is safe', () => {
    expect(() => reg.revoke('jti-unknown')).not.toThrow();
    expect(reg.revoke('jti-unknown')).toBe(0);
  });

  it('revoke still reports the count even if the revoker throws', () => {
    reg.setRevoker(() => {
      throw new Error('boom');
    });
    reg.register('jti-A', 'sock-1');
    expect(() => reg.revoke('jti-A')).not.toThrow();
    expect(reg.getSocketIds('jti-A')).toEqual(['sock-1']);
  });
});
