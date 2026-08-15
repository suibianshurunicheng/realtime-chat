import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { INestApplication } from '@nestjs/common';
import { createApp } from './setup-e2e';

/**
 * End-to-end coverage of the Phase 3.4 `read receipt` feature.
 *
 * Reuses the realtime e2e harness (full Nest app on an ephemeral port + real
 * MySQL/Redis). Validates the read-receipt loop:
 *  - B opens A's messages -> emits `read_messages` -> A receives `messages_read`
 *    (only A, never B's own echo) -> A's messages get `readAt` (verifiable via REST).
 *  - Both directions work; only the OTHER party's messages are ever marked.
 *  - A user can NEVER mark their OWN messages read (direction enforced server-side).
 *  - Malformed payloads are dropped; a non-member gets 403 (membership enforced).
 *  - REST `POST /read` fallback marks read (no socket broadcast by design).
 *
 * Requires a running MySQL (`realtime_chat_test`) and Redis.
 */
describe('ReadReceiptGateway (e2e)', () => {
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

  /** Resolves with the first messages_read payload (fails on timeout). */
  function onceRead(socket: Socket, timeout = 3000): Promise<any> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting messages_read')), timeout);
      socket.once('messages_read', (p: any) => {
        clearTimeout(t);
        resolve(p);
      });
    });
  }

  /** Resolves with the payload if one arrives within `timeout`, else null. */
  function readGuard(socket: Socket, timeout = 1500): Promise<any> {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), timeout);
      socket.once('messages_read', (p: any) => {
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

  it('1) B reads A’s messages -> A receives messages_read (not B) -> A’s messages get readAt', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    // A sends two messages.
    const m1 = await request(baseURL)
      .post(`/api/conversations/${cid}/messages`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ content: 'hi B 1' });
    const m2 = await request(baseURL)
      .post(`/api/conversations/${cid}/messages`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ content: 'hi B 2' });
    const lastId = m2.body.data.id as string;

    const sa = await connect(a.accessToken);
    const sb = await connect(b.accessToken);
    await sleep(150);

    const aReceipt = onceRead(sa);
    const bGuard = readGuard(sb); // B must NOT receive its own echo
    sb.emit('read_messages', { conversationId: cid, upToMessageId: lastId });
    const p = await aReceipt;

    expect(p.conversationId).toBe(cid);
    expect(p.byUserId).toBe(b.id);
    expect(p.upToMessageId).toBe(lastId);
    expect(typeof p.readAt).toBe('string');
    expect(await bGuard).toBeNull();

    // A's messages now carry readAt (verified via REST).
    const hist = await request(baseURL)
      .get(`/api/conversations/${cid}/messages`)
      .set('Authorization', `Bearer ${a.accessToken}`);
    const byContent = (c: string) => (hist.body.data as { content: string; readAt: string | null }[]).find((m) => m.content === c)!;
    expect(byContent('hi B 1').readAt).not.toBeNull();
    expect(byContent('hi B 2').readAt).not.toBeNull();

    sa.close();
    sb.close();
  });

  it('2) both directions: only the OTHER party’s messages are ever marked', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const aMsg = await request(baseURL)
      .post(`/api/conversations/${cid}/messages`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ content: 'from A' });
    const bMsg = await request(baseURL)
      .post(`/api/conversations/${cid}/messages`)
      .set('Authorization', `Bearer ${b.accessToken}`)
      .send({ content: 'from B' });

    const sa = await connect(a.accessToken);
    const sb = await connect(b.accessToken);
    await sleep(150);

    // A reads -> B's message (senderId=B) gets readAt.
    const aReceipt = onceRead(sa);
    sb.emit('read_messages', { conversationId: cid, upToMessageId: bMsg.body.data.id });
    await aReceipt;

    // A reads B's message -> B's message (senderId=B) gets readAt.
    // A must emit the id of the message it is actually reading (B's, the
    // higher id); emitting A's own id would exclude "from B" via `id <= upTo`.
    const bReceipt = onceRead(sb);
    sa.emit('read_messages', { conversationId: cid, upToMessageId: bMsg.body.data.id });
    await bReceipt;

    const histA = await request(baseURL)
      .get(`/api/conversations/${cid}/messages`)
      .set('Authorization', `Bearer ${a.accessToken}`);
    const fromA = (histA.body.data as { content: string; readAt: string | null }[]).find((m) => m.content === 'from A')!;
    const fromB = (histA.body.data as { content: string; readAt: string | null }[]).find((m) => m.content === 'from B')!;
    // A sees: its own "from A" read by B; B's "from B" read by A.
    expect(fromA.readAt).not.toBeNull();
    expect(fromB.readAt).not.toBeNull();

    sa.close();
    sb.close();
  });

  it('3) a user can NEVER mark their OWN messages read', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    // A (sender) posts, then A itself "reads" — only other-party messages are
    // eligible (senderId != me), so A's own message must stay unread.
    const sent = await request(baseURL)
      .post(`/api/conversations/${cid}/messages`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ content: 'mine' });

    const sa = await connect(a.accessToken);
    await sleep(150);
    sa.emit('read_messages', { conversationId: cid, upToMessageId: sent.body.data.id });
    await sleep(300);

    const hist = await request(baseURL)
      .get(`/api/conversations/${cid}/messages`)
      .set('Authorization', `Bearer ${a.accessToken}`);
    const m = (hist.body.data as { content: string; readAt: string | null }[]).find((x) => x.content === 'mine')!;
    expect(m.readAt).toBeNull();
    sa.close();
  });

  it('4) malformed payload (missing conversationId) is dropped', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const sa = await connect(a.accessToken);
    const sb = await connect(b.accessToken);
    await sleep(150);

    const aGuard = readGuard(sa);
    sb.emit('read_messages', { upToMessageId: '999' }); // missing conversationId -> 400, no broadcast
    expect(await aGuard).toBeNull();
    sa.close();
    sb.close();
  });

  it('5) a non-member cannot read messages in a conversation they’re not in (403)', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const sc = await connect((await register('C')).accessToken);
    await sleep(150);
    sc.emit('read_messages', { conversationId: cid, upToMessageId: '999' });
    const err = await new Promise<any>((resolve) => {
      const t = setTimeout(() => resolve(null), 2000);
      sc.once('message_error', (e: any) => {
        clearTimeout(t);
        resolve(e);
      });
    });
    expect(err).not.toBeNull();
    expect(err.code).toBe(403);
    sc.close();
  });

  it('6) REST POST /read fallback marks read (no socket broadcast)', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    await request(baseURL)
      .post(`/api/conversations/${cid}/messages`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ content: 'rest read' });

    const res = await request(baseURL)
      .post(`/api/conversations/${cid}/read`)
      .set('Authorization', `Bearer ${b.accessToken}`);
    expect(res.status).toBe(201);
    expect(typeof res.body.data.readAt).toBe('string');

    // A (sender) sees its message readAt populated after B's REST read.
    const hist = await request(baseURL)
      .get(`/api/conversations/${cid}/messages`)
      .set('Authorization', `Bearer ${a.accessToken}`);
    const m = (hist.body.data as { content: string; readAt: string | null }[]).find((x) => x.content === 'rest read')!;
    expect(m.readAt).not.toBeNull();
  });
});
