import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { INestApplication } from '@nestjs/common';
import { createApp } from './setup-e2e';

/**
 * End-to-end coverage of Phase 2.3B: logout actively revokes the Socket.IO
 * connections authenticated with the logged-out access token's jti.
 *
 * Requires MySQL (`realtime_chat_test`) + Redis (same as the other e2e suites,
 * run together with `--runInBand`). Covers: single-socket revoke, blacklist
 * rejects reconnection, multi-device isolation (PC jti revoked, phone jti alive),
 * same-jti multi-socket revoke, presence flip (single socket → offline; one of
 * two devices → still online; last device → offline), and registry cleanup /
 * no-throw on plain network disconnect.
 */
describe('Logout revokes sockets (e2e)', () => {
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

  /** A second access token for the same user (new sid + jti) via login. */
  async function relogin(username: string) {
    const res = await request(baseURL)
      .post('/api/auth/login')
      .send({ username, password: 'secret123' });
    return res.body.data.accessToken as string;
  }

  async function conversation(a: { accessToken: string }, b: { id: string }): Promise<string> {
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

  /** Resolves with the disconnect reason, or rejects on timeout. */
  function onceDisconnect(socket: Socket, timeout = 3000): Promise<string> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting disconnect')), timeout);
      socket.once('disconnect', (reason: string) => {
        clearTimeout(t);
        resolve(reason);
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

  function oncePresence(socket: Socket, timeout = 3000): Promise<any> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting presence_changed')), timeout);
      socket.once('presence_changed', (p: any) => {
        clearTimeout(t);
        resolve(p);
      });
    });
  }

  function collectPresence(socket: Socket) {
    const events: any[] = [];
    socket.on('presence_changed', (p: any) => events.push(p));
    return events;
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

  async function logout(token: string) {
    return request(baseURL).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
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

  it('1) logout revokes the connected socket (AAA) and it can no longer reconnect', async () => {
    const a = await register('A');
    const sa = await connect(a.accessToken);
    const disc = onceDisconnect(sa);
    const res = await logout(a.accessToken);
    expect(res.status).toBe(201);
    expect(res.body.data.success).toBe(true);
    await disc;
    expect(sa.connected).toBe(false);
    // Blacklisted token is rejected on a fresh connection attempt.
    await expect(connect(a.accessToken)).rejects.toBeTruthy();
    sa.close();
  });

  it('2) multi-device: logout PC(AAA) leaves phone(BBB) connected and able to message', async () => {
    const { a, b } = await friends();
    // Create the conversation BEFORE connecting — rooms are joined at connect time,
    // so the phone socket must exist after the conversation does.
    const cid = await conversation(a, b);
    const aaa = a.accessToken; // PC token
    const bbb = await relogin(a.username); // phone token (new sid/jti) — still user A
    const saaa = await connect(aaa);
    const sbbb = await connect(bbb);
    await sleep(200);

    const disc = onceDisconnect(saaa);
    await logout(aaa); // only PC's jti
    await disc;
    // Phone socket must survive — different jti/sid.
    expect(saaa.connected).toBe(false);
    expect(sbbb.connected).toBe(true);

    // Phone (user A) can still send a message in the A↔B conversation.
    const bMsg = onceMessage(sbbb);
    sbbb.emit('send_message', { conversationId: cid, content: 'still here' });
    const m = await bMsg;
    expect(m.senderId).toBe(a.id);

    saaa.close();
    sbbb.close();
  });

  it('3) same jti with two sockets: both revoked on logout', async () => {
    const a = await register('A');
    const s1 = await connect(a.accessToken);
    const s2 = await connect(a.accessToken);
    await sleep(200);
    const d1 = onceDisconnect(s1);
    const d2 = onceDisconnect(s2);
    await logout(a.accessToken);
    await Promise.all([d1, d2]);
    expect(s1.connected).toBe(false);
    expect(s2.connected).toBe(false);
    s1.close();
    s2.close();
  });

  it('4) presence: logout the only socket → friend sees offline', async () => {
    const { a, b } = await friends();
    const sb = await connect(b.accessToken);
    const collected = collectPresence(sb);
    const sa = await connect(a.accessToken);
    await oncePresence(sb); // online
    const disc = onceDisconnect(sa);
    await logout(a.accessToken);
    await disc;
    await sleep(400);
    const offline = collected.find((e) => e.online === false);
    expect(offline).toBeDefined();
    expect(offline!.userId).toBe(a.id);
    expect(onlineOf(await friendPresence(b.accessToken), a.id)).toBe(false);
    sa.close();
    sb.close();
  });

  it('5) presence: logout one of two devices (different jti) → no offline; last device → offline', async () => {
    const { a, b } = await friends();
    const aaa = a.accessToken;
    const bbb = await relogin(a.username);
    const sb = await connect(b.accessToken);
    const collected = collectPresence(sb);
    const sa1 = await connect(aaa);
    await oncePresence(sb); // online (0→1)
    const sa2 = await connect(bbb);
    await sleep(300);
    expect(onlineOf(await friendPresence(b.accessToken), a.id)).toBe(true);

    // Disconnect PC (AAA) — BBB still alive, so NO offline broadcast.
    const d1 = onceDisconnect(sa1);
    await logout(aaa);
    await d1;
    await sleep(500);
    expect(collected.filter((e) => e.online === false).length).toBe(0);
    expect(onlineOf(await friendPresence(b.accessToken), a.id)).toBe(true);

    // Disconnect phone (BBB) — last socket, flips offline.
    const d2 = onceDisconnect(sa2);
    await logout(bbb);
    await d2;
    await sleep(500);
    const off = collected.find((e) => e.online === false);
    expect(off).toBeDefined();
    expect(off!.userId).toBe(a.id);
    expect(onlineOf(await friendPresence(b.accessToken), a.id)).toBe(false);

    sa1.close();
    sa2.close();
    sb.close();
  });

  it('6) registry cleanup: plain network disconnect then logout must not throw; new token still connects', async () => {
    const a = await register('A');
    const sa = await connect(a.accessToken);
    await sleep(200);
    sa.close(); // normal network disconnect → handleDisconnect cleans the registry
    await sleep(400);
    // Logout now: registry is empty for this jti → revoke is a no-op, no 500.
    const res = await logout(a.accessToken);
    expect(res.status).toBe(201);
    expect(res.body.data.success).toBe(true);
    // The user can still log in fresh and open a new socket.
    const bbb = await relogin(a.username);
    const sa2 = await connect(bbb);
    expect(sa2.connected).toBe(true);
    sa2.close();
  });
});
