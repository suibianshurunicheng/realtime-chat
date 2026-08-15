import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { INestApplication } from '@nestjs/common';
import { createApp } from './setup-e2e';

/**
 * End-to-end coverage of the Phase 3.3 `typing` realtime feature.
 *
 * Reuses the realtime e2e harness (full Nest app on an ephemeral port + real
 * MySQL/Redis). Validates the ephemeral "typing" loop: A starts/stops typing,
 * B receives `typing_changed`; A never receives its own echo (server `.except`);
 * a non-member is ignored and never leaks into the room; A's disconnect forces
 * a `typing:false` broadcast (third-layer cleanup); and malformed payloads are
 * silently dropped. Typing state is NEVER persisted — there is no DB assertion
 * here by design.
 *
 * Requires a running MySQL (`realtime_chat_test`) and Redis.
 */
describe('TypingGateway (e2e)', () => {
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

  async function conversation(
    a: { accessToken: string },
    b: { id: string },
  ): Promise<string> {
    const res = await request(baseURL)
      .post('/api/conversations/direct')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id });
    return res.body.data.id as string;
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

  /** Resolves with the first typing_changed payload (fails on timeout). */
  function onceTyping(socket: Socket, timeout = 3000): Promise<any> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting typing_changed')), timeout);
      socket.once('typing_changed', (p: any) => {
        clearTimeout(t);
        resolve(p);
      });
    });
  }

  /** Resolves with the payload if one arrives within `timeout`, else null. */
  function typingGuard(socket: Socket, timeout = 1500): Promise<any> {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), timeout);
      socket.once('typing_changed', (p: any) => {
        clearTimeout(t);
        resolve(p);
      });
    });
  }

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

  it('1) A start → B gets typing_changed(true); A never receives its own echo', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const sa = await connect(a.accessToken);
    const sb = await connect(b.accessToken);
    await sleep(150);

    const bTyping = onceTyping(sb);
    const aGuard = typingGuard(sa);
    sa.emit('typing_start', { conversationId: cid });

    const p = await bTyping;
    expect(p.conversationId).toBe(cid);
    expect(p.userId).toBe(a.id);
    expect(p.typing).toBe(true);
    expect(await aGuard).toBeNull();
    sa.close();
    sb.close();
  });

  it('2) A stop → B gets typing_changed(false)', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const sa = await connect(a.accessToken);
    const sb = await connect(b.accessToken);
    await sleep(150);

    const bStart = onceTyping(sb);
    sa.emit('typing_start', { conversationId: cid });
    await bStart;

    const bStop = onceTyping(sb);
    sa.emit('typing_stop', { conversationId: cid });
    const p = await bStop;
    expect(p.conversationId).toBe(cid);
    expect(p.userId).toBe(a.id);
    expect(p.typing).toBe(false);
    sa.close();
    sb.close();
  });

  it('3) non-member C is ignored; only A’s typing reaches B', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const sa = await connect(a.accessToken);
    const sb = await connect(b.accessToken);
    const sc = await connect((await register('C')).accessToken);
    await sleep(150);

    const cGuard = typingGuard(sc);
    sa.emit('typing_start', { conversationId: cid });
    // C is not a member of the conversation — its emit must be dropped server-side.
    sc.emit('typing_start', { conversationId: cid });

    const bTyping = await onceTyping(sb);
    expect(bTyping.userId).toBe(a.id);
    // C never receives a typing echo (it is not in the room; server excludes sender anyway).
    expect(await cGuard).toBeNull();
    sa.close();
    sb.close();
    sc.close();
  });

  it('4) A disconnects while typing → B gets typing_changed(false) (3rd-layer cleanup)', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const sa = await connect(a.accessToken);
    const sb = await connect(b.accessToken);
    await sleep(150);

    const bStart = onceTyping(sb);
    sa.emit('typing_start', { conversationId: cid });
    await bStart;

    const bStop = onceTyping(sb);
    sa.close(); // simulate tab close / network drop without a typing_stop
    const p = await bStop;
    expect(p.conversationId).toBe(cid);
    expect(p.userId).toBe(a.id);
    expect(p.typing).toBe(false);
    sb.close();
  });

  it('5) malformed payloads (empty / missing conversationId) are dropped', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const sa = await connect(a.accessToken);
    const sb = await connect(b.accessToken);
    await sleep(150);

    const bGuard = typingGuard(sb);
    sa.emit('typing_start', { conversationId: '' }); // fails @Length(1, 64)
    sa.emit('typing_start', {}); // missing field → fails @IsString
    expect(await bGuard).toBeNull();
    sa.close();
    sb.close();
  });
});
