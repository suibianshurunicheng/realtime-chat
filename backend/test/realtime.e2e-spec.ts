import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { INestApplication } from '@nestjs/common';
import { createApp } from './setup-e2e';

/**
 * End-to-end coverage of the Phase 2.2B Socket.IO realtime layer.
 *
 * Spins up the full Nest app on an ephemeral port (so the WS server is actually
 * listening) and drives it with socket.io-client. Requires a running MySQL
 * (`realtime_chat_test`) and Redis. Covers: connection auth (valid / none /
 * invalid / blacklisted), room + membership authorization, the minimal message
 * loop (send → room broadcast → both peers receive), senderId trust boundary,
 * content validation, 404 on missing conversation, and REST↔Socket consistency.
 *
 * The auth/friends/conversations suites run alongside this file; together they
 * must be all-green with no regression.
 */
describe('RealtimeGateway (e2e)', () => {
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

  function onceMessage(socket: Socket, timeout = 3000): Promise<any> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting message_created')), timeout);
      socket.once('message_created', (p: any) => {
        clearTimeout(t);
        resolve(p);
      });
    });
  }

  /** Resolves with the error envelope, or null if none arrives within `timeout`. */
  function onceError(socket: Socket, timeout = 2000): Promise<any> {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), timeout);
      socket.once('message_error', (e: any) => {
        clearTimeout(t);
        resolve(e);
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

  // ---- Connection auth ----------------------------------------------------
  it('1) a valid access token establishes a Socket connection', async () => {
    const a = await register('A');
    const sock = await connect(a.accessToken);
    expect(sock.connected).toBe(true);
    sock.close();
  });

  it('2) a connection with no token is rejected', async () => {
    await expect(connect()).rejects.toBeTruthy();
  });

  it('3) a connection with an invalid token is rejected', async () => {
    await expect(connect('garbage-token')).rejects.toBeTruthy();
  });

  it('4) a blacklisted (logged-out) token is rejected', async () => {
    const a = await register('A');
    await request(baseURL)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${a.accessToken}`);
    await expect(connect(a.accessToken)).rejects.toBeTruthy();
  });

  // ---- Rooms & membership authorization ----------------------------------
  it('5) a member is auto-joined; a non-member cannot send and never receives', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const sa = await connect(a.accessToken);
    const sb = await connect(b.accessToken);
    const sc = await connect((await register('C')).accessToken);
    await sleep(120);

    const bReceived = onceMessage(sb);
    const cGuard: Promise<string> = new Promise((resolve) => {
      const t = setTimeout(() => resolve('no-message'), 1500);
      sc.once('message_created', () => {
        clearTimeout(t);
        resolve('got-message');
      });
    });

    sa.emit('send_message', { conversationId: cid, content: 'hello' });
    const bMsg = await bReceived;
    expect(bMsg.conversationId).toBe(cid);
    expect(bMsg.senderId).toBe(a.id);
    expect(await cGuard).toBe('no-message');

    // C tries to post into A↔B's conversation → 403 (not a member).
    sc.emit('send_message', { conversationId: cid, content: 'intrude' });
    const err = await onceError(sc);
    expect(err).not.toBeNull();
    expect(err.code).toBe(403);

    sa.close();
    sb.close();
    sc.close();
  });

  it('6) a non-member cannot use another conversation (message_error 403)', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const sc = await connect((await register('C')).accessToken);
    await sleep(120);
    sc.emit('send_message', { conversationId: cid, content: 'nope' });
    const got = await onceError(sc);
    expect(got).not.toBeNull();
    expect(got.code).toBe(403);
    sc.close();
  });

  // ---- Message loop ------------------------------------------------------
  it('7-11) A sends; B receives; A also receives via room; senderId === A', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const sa = await connect(a.accessToken);
    const sb = await connect(b.accessToken);
    await sleep(120);

    const bMsg = onceMessage(sb);
    const aMsg = onceMessage(sa);
    sa.emit('send_message', { conversationId: cid, content: 'hi B' });
    const [bReceived, aReceived] = await Promise.all([bMsg, aMsg]);

    expect(bReceived.content).toBe('hi B');
    expect(bReceived.senderId).toBe(a.id);
    expect(aReceived.senderId).toBe(a.id);
    expect(aReceived.id).toBe(bReceived.id);
    sa.close();
    sb.close();
  });

  it('12-13) forged senderId is ignored; empty & overlong content rejected', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const sa = await connect(a.accessToken);
    const sb = await connect(b.accessToken);
    await sleep(120);

    const bMsg = onceMessage(sb);
    // Client tries to spoof the sender — must be ignored.
    sa.emit('send_message', { conversationId: cid, content: 'hi', senderId: b.id, fake: '999' });
    const m = await bMsg;
    expect(m.senderId).toBe(a.id);

    sa.emit('send_message', { conversationId: cid, content: '   ' });
    const e1 = await onceError(sa);
    expect(e1).not.toBeNull();
    expect(e1.code).toBe(400);

    sa.emit('send_message', { conversationId: cid, content: 'x'.repeat(2001) });
    const e2 = await onceError(sa);
    expect(e2).not.toBeNull();
    expect(e2.code).toBe(400);
    sa.close();
    sb.close();
  });

  it('14) missing conversation → message_error 404', async () => {
    const a = await register('A');
    const sa = await connect(a.accessToken);
    await sleep(120);
    sa.emit('send_message', { conversationId: '999999999', content: 'ghost' });
    const err = await onceError(sa);
    expect(err).not.toBeNull();
    expect(err.code).toBe(404);
    sa.close();
  });

  it('15-17) B replies and A receives it', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const sa = await connect(a.accessToken);
    const sb = await connect(b.accessToken);
    await sleep(120);

    const aMsg = onceMessage(sa);
    sb.emit('send_message', { conversationId: cid, content: 'hi A back' });
    const m = await aMsg;
    expect(m.senderId).toBe(b.id);
    expect(m.content).toBe('hi A back');
    sa.close();
    sb.close();
  });

  // ---- Persistence & REST ↔ Socket consistency ---------------------------
  it('18-20) socket message persists and is queryable via REST history', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const sa = await connect(a.accessToken);
    await sleep(120);

    sa.emit('send_message', { conversationId: cid, content: 'persist me' });
    await sleep(400);

    const hist = await request(baseURL)
      .get(`/api/conversations/${cid}/messages`)
      .set('Authorization', `Bearer ${b.accessToken}`);
    expect(hist.status).toBe(200);
    const contents = (hist.body.data as { content: string }[]).map((x) => x.content);
    expect(contents).toContain('persist me');
    sa.close();
  });

  it('21-23) REST-created message is visible to a socket-connected client via REST', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const sa = await connect(a.accessToken);
    await sleep(120);

    const created = await request(baseURL)
      .post(`/api/conversations/${cid}/messages`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ content: 'from rest' });
    expect(created.status).toBe(201);
    expect(created.body.data.senderId).toBe(a.id);

    const hist = await request(baseURL)
      .get(`/api/conversations/${cid}/messages`)
      .set('Authorization', `Bearer ${a.accessToken}`);
    const contents = (hist.body.data as { content: string }[]).map((x) => x.content);
    expect(contents).toContain('from rest');
    sa.close();
  });
});
