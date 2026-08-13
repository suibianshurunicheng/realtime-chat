import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { INestApplication } from '@nestjs/common';
import { createApp } from './setup-e2e';

/**
 * End-to-end coverage of the Phase 2.3A presence layer (single-instance, in-memory).
 *
 * Reuses the full Nest app + MySQL (`realtime_chat_test`) + Redis. Covers the
 * multi-device aggregation (0↔1 socket transitions), friend-scoped broadcasts, a
 * friend presence snapshot, and the trust boundary (non-friends never learn another
 * user's presence; unauthenticated / blacklisted sockets create no presence). The
 * message-loop behaviour from Phase 2.2B is covered by realtime.e2e-spec.ts and must
 * stay green in the same `--runInBand` run.
 */
describe('PresenceGateway (e2e)', () => {
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let baseURL: string;

  const unique = () =>
    `u_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function register(nickname = 'Nick') {
    const username = unique();
    const res = await request(baseURL)
      .post('/api/auth/register')
      .send({ username, password: 'secret123', nickname });
    return {
      username,
      accessToken: res.body.data.accessToken as string,
      id: res.body.data.user.id as string,
    };
  }

  async function friends() {
    const a = await register('A');
    const b = await register('B');
    const sent = await request(baseURL)
      .post('/api/friends/requests')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ addresseeId: b.id });
    await request(baseURL)
      .post(`/api/friends/requests/${sent.body.data.id}/accept`)
      .set('Authorization', `Bearer ${b.accessToken}`);
    return { a, b };
  }

  function connect(token?: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(baseURL, {
        path: '/ws',
        auth: token ? { token } : {},
        transports: ['websocket'],
        forceNew: true,
      });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => {
        socket.close();
        reject(err);
      });
    });
  }

  /** Resolves with the next presence_changed payload, or rejects on timeout. */
  function oncePresence(socket: Socket, timeout = 3000): Promise<any> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting presence_changed')), timeout);
      socket.once('presence_changed', (p: any) => {
        clearTimeout(t);
        resolve(p);
      });
    });
  }

  /** Collects every presence_changed received during the window (for no-op assertions). */
  function collectPresence(socket: Socket) {
    const events: any[] = [];
    socket.on('presence_changed', (p: any) => events.push(p));
    return events;
  }

  function onceSnapshot(socket: Socket, timeout = 3000): Promise<any> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting snapshot')), timeout);
      socket.once('friend_presence_snapshot', (p: any) => {
        clearTimeout(t);
        resolve(p);
      });
    });
  }

  async function friendPresence(token: string): Promise<{ userId: string; online: boolean }[]> {
    const res = await request(baseURL)
      .get('/api/friends/presence')
      .set('Authorization', `Bearer ${token}`);
    return res.body.data as { userId: string; online: boolean }[];
  }

  const onlineOf = (
    arr: { userId: string; online: boolean }[],
    userId: string,
  ): boolean | undefined => arr.find((x) => x.userId === userId)?.online;

  beforeAll(async () => {
    process.env.DB_DATABASE = process.env.DB_DATABASE ?? 'realtime_chat_test';
    process.env.REDIS_DB = process.env.REDIS_DB ?? '1';
    process.env.NODE_ENV = 'test';
    app = await createApp();
    await app.listen(0);
    const addr = app.getHttpServer().address();
    const port = typeof addr === 'string' ? addr : (addr as { port: number }).port;
    baseURL = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('1-2) A first socket connects → A online; B (friend) receives presence_changed online', async () => {
    const { a, b } = await friends();
    const sb = await connect(b.accessToken);
    const onlineEvent = oncePresence(sb);
    const sa = await connect(a.accessToken);
    const ev = await onlineEvent;
    expect(ev.userId).toBe(a.id);
    expect(ev.online).toBe(true);
    // REST projection agrees.
    expect(onlineOf(await friendPresence(b.accessToken), a.id)).toBe(true);
    sa.close();
    sb.close();
  });

  it('3) A second socket connects → no duplicate presence_changed broadcast', async () => {
    const { a, b } = await friends();
    const sb = await connect(b.accessToken);
    const collected = collectPresence(sb);
    const sa1 = await connect(a.accessToken);
    await oncePresence(sb); // first online
    const sa2 = await connect(a.accessToken);
    await sleep(600);
    // Exactly one online transition; the 1→2 device addition is silent.
    expect(collected.filter((e) => e.online === true).length).toBe(1);
    expect(collected.filter((e) => e.online === false).length).toBe(0);
    sa1.close();
    sa2.close();
    sb.close();
  });

  it('4) A disconnects one of two sockets → no offline broadcast', async () => {
    const { a, b } = await friends();
    const sb = await connect(b.accessToken);
    const collected = collectPresence(sb);
    const sa1 = await connect(a.accessToken);
    await oncePresence(sb);
    const sa2 = await connect(a.accessToken);
    await sleep(300);
    sa1.close(); // drop one device
    await sleep(600);
    expect(collected.filter((e) => e.online === false).length).toBe(0);
    sa2.close();
    sb.close();
  });

  it('5-6) A last socket disconnects → exactly one offline (idempotent, no double flip)', async () => {
    const { a, b } = await friends();
    const sb = await connect(b.accessToken);
    const collected = collectPresence(sb);
    const sa1 = await connect(a.accessToken);
    await oncePresence(sb);
    const sa2 = await connect(a.accessToken);
    await sleep(300);
    sa1.close();
    await sleep(400);
    sa2.close();
    await sleep(800);
    // Set-based logic: one online (at 0→1) and exactly one offline (at 1→0).
    expect(collected.filter((e) => e.online === true).length).toBe(1);
    expect(collected.filter((e) => e.online === false).length).toBe(1);
    expect(onlineOf(await friendPresence(b.accessToken), a.id)).toBe(false);
    sb.close();
  });

  it('7) A receives a friend_presence_snapshot with B\'s current state', async () => {
    const { a, b } = await friends();
    const sb = await connect(b.accessToken); // B online
    const sa = await connect(a.accessToken);
    const snap = await onceSnapshot(sa);
    const bStatus = (snap.users as { userId: string; online: boolean }[]).find(
      (u) => u.userId === b.id,
    );
    expect(bStatus).toBeDefined();
    expect(bStatus!.online).toBe(true);
    sa.close();
    sb.close();
  });

  it('8) non-friends can never see each other\'s presence (snapshot + REST)', async () => {
    const { a, b } = await friends(); // A,B are friends
    const c = await register('C'); // C is a stranger to both
    const sa = await connect(a.accessToken);
    const snapA = await onceSnapshot(sa); // capture at connect time
    const sb = await connect(b.accessToken);
    await sleep(200);
    const sc = await connect(c.accessToken);
    const snapC = await onceSnapshot(sc);
    // C (not A's friend) must not appear in A's snapshot.
    expect(
      (snapA.users as { userId: string }[]).find((u) => u.userId === c.id),
    ).toBeUndefined();
    // A (not C's friend) must not appear in C's snapshot...
    expect(
      (snapC.users as { userId: string }[]).find((u) => u.userId === a.id),
    ).toBeUndefined();
    // ...nor via C's REST presence projection.
    const pc = await friendPresence(c.accessToken);
    expect(pc.find((u) => u.userId === a.id)).toBeUndefined();
    sa.close();
    sb.close();
    sc.close();
  });

  it('9) multi-device: A online with 2 sockets; losing one keeps A online; losing last flips offline', async () => {
    const { a, b } = await friends();
    const sb = await connect(b.accessToken);
    const sa1 = await connect(a.accessToken);
    await oncePresence(sb);
    const sa2 = await connect(a.accessToken);
    await sleep(300);
    expect(onlineOf(await friendPresence(b.accessToken), a.id)).toBe(true);
    sa1.close();
    await sleep(400);
    expect(onlineOf(await friendPresence(b.accessToken), a.id)).toBe(true); // still online
    sa2.close();
    const offline = await oncePresence(sb, 2000);
    expect(offline.online).toBe(false);
    sb.close();
  });

  it('10) an unauthenticated socket creates no presence', async () => {
    const { a, b } = await friends();
    const sb = await connect(b.accessToken);
    await sleep(200);
    await expect(connect()).rejects.toBeTruthy(); // no token → rejected
    await sleep(300);
    expect(onlineOf(await friendPresence(b.accessToken), a.id)).toBe(false);
    sb.close();
  });

  it('11) a blacklisted (logged-out) token creates no presence', async () => {
    const { a, b } = await friends();
    const sb = await connect(b.accessToken);
    await sleep(200);
    await request(baseURL)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${a.accessToken}`);
    await expect(connect(a.accessToken)).rejects.toBeTruthy(); // blacklisted → rejected
    await sleep(300);
    expect(onlineOf(await friendPresence(b.accessToken), a.id)).toBe(false);
    sb.close();
  });

  // 12) Phase 2.2B message-loop regression is covered by realtime.e2e-spec.ts in the
  //     same --runInBand run; no duplication here.
});
