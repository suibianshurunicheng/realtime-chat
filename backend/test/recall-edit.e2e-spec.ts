import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { INestApplication } from '@nestjs/common';
import { createApp } from './setup-e2e';

/**
 * End-to-end coverage of the Phase 3.5 `message recall + edit` feature.
 *
 * Reuses the realtime e2e harness (full Nest app on an ephemeral port + real
 * MySQL/Redis). What is pinned down here:
 *  - recall/edit succeed for the SENDER only, and the broadcast reaches the whole
 *    conversation room INCLUDING the actor (both ends adopt the server result).
 *  - a recalled message's original text is unreachable: the socket payload AND the
 *    REST history both come back with an empty `content` + a non-null `recalledAt`.
 *  - guard matrix: other member -> 403, non-member -> 403, unknown id -> 404,
 *    id from another conversation -> 404, malformed payload -> 400 (no broadcast).
 *  - recall is idempotent (same `recalledAt`, still re-broadcast), a recalled
 *    message can never be edited, and edits are unbounded in count but bounded in
 *    size (empty / >2000 rejected).
 *  - neither operation disturbs `readAt` or the other messages in the thread.
 *
 * Requires a running MySQL (`realtime_chat_test`) and Redis.
 */
describe('RecallEditGateway (e2e)', () => {
  let app: INestApplication;
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

  async function befriend(
    a: { accessToken: string },
    b: { accessToken: string; id: string },
  ) {
    const sent = await request(baseURL)
      .post('/api/friends/requests')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ addresseeId: b.id });
    await request(baseURL)
      .post(`/api/friends/requests/${sent.body.data.id}/accept`)
      .set('Authorization', `Bearer ${b.accessToken}`);
  }

  async function friends() {
    const a = await register('A');
    const b = await register('B');
    await befriend(a, b);
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

  /** Post a message over REST and return its id. */
  async function post(
    sender: { accessToken: string },
    cid: string,
    content: string,
  ): Promise<string> {
    const res = await request(baseURL)
      .post(`/api/conversations/${cid}/messages`)
      .set('Authorization', `Bearer ${sender.accessToken}`)
      .send({ content });
    return res.body.data.id as string;
  }

  interface HistoryRow {
    id: string;
    content: string;
    readAt: string | null;
    recalledAt: string | null;
    editedAt: string | null;
    createdAt: string;
  }

  async function history(
    who: { accessToken: string },
    cid: string,
  ): Promise<HistoryRow[]> {
    const res = await request(baseURL)
      .get(`/api/conversations/${cid}/messages`)
      .set('Authorization', `Bearer ${who.accessToken}`);
    return res.body.data as HistoryRow[];
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

  /** Resolves with the first `event` payload, or null after `timeout`. */
  function once(socket: Socket, event: string, timeout = 3000): Promise<any> {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), timeout);
      socket.once(event, (p: any) => {
        clearTimeout(t);
        resolve(p);
      });
    });
  }

  const onceRecalled = (s: Socket, timeout = 3000) => once(s, 'message_recalled', timeout);
  const onceEdited = (s: Socket, timeout = 3000) => once(s, 'message_edited', timeout);
  const onceError = (s: Socket, timeout = 2500) => once(s, 'message_error', timeout);

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

  /* ------------------------------------------------------------------ *
   * Recall
   * ------------------------------------------------------------------ */

  it('1) sender recalls: BOTH ends (incl. the sender) get message_recalled with a blank content', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const mid = await post(a, cid, 'secret text');

    const sa = await connect(a.accessToken);
    const sb = await connect(b.accessToken);
    await sleep(150);

    const onA = onceRecalled(sa);
    const onB = onceRecalled(sb);
    sa.emit('recall_message', { conversationId: cid, messageId: mid });
    const [pa, pb] = await Promise.all([onA, onB]);

    expect(pa).not.toBeNull();
    expect(pb).not.toBeNull();
    for (const p of [pa, pb]) {
      expect(p.id).toBe(mid);
      expect(p.conversationId).toBe(cid);
      expect(p.senderId).toBe(a.id);
      expect(p.recalledAt).toBeTruthy();
      expect(p.content).toBe(''); // original text never leaves the server
      expect(p.content).not.toContain('secret');
    }

    sa.close();
    sb.close();
  });

  it('2) REST history hides the recalled original text for BOTH parties', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const mid = await post(a, cid, 'to be recalled');

    const sa = await connect(a.accessToken);
    await sleep(150);
    const done = onceRecalled(sa);
    sa.emit('recall_message', { conversationId: cid, messageId: mid });
    expect(await done).not.toBeNull();

    for (const who of [a, b]) {
      const rows = await history(who, cid);
      const row = rows.find((m) => m.id === mid)!;
      expect(row.recalledAt).toBeTruthy();
      expect(row.content).toBe('');
    }

    sa.close();
  });

  it('3) the OTHER member cannot recall someone else’s message (403, message stays intact)', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const mid = await post(a, cid, 'A owns this');

    const sb = await connect(b.accessToken);
    await sleep(150);
    sb.emit('recall_message', { conversationId: cid, messageId: mid });
    const err = await onceError(sb);
    expect(err).not.toBeNull();
    expect(err.code).toBe(403);

    const row = (await history(a, cid)).find((m) => m.id === mid)!;
    expect(row.recalledAt).toBeNull();
    expect(row.content).toBe('A owns this');
    sb.close();
  });

  it('4) a non-member cannot recall a message in that conversation (403)', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const mid = await post(a, cid, 'private');

    const c = await register('C');
    const sc = await connect(c.accessToken);
    await sleep(150);
    sc.emit('recall_message', { conversationId: cid, messageId: mid });
    const err = await onceError(sc);
    expect(err).not.toBeNull();
    expect(err.code).toBe(403);
    sc.close();
  });

  it('5) recalling an unknown message id -> 404', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const sa = await connect(a.accessToken);
    await sleep(150);
    sa.emit('recall_message', { conversationId: cid, messageId: '99999999' });
    const err = await onceError(sa);
    expect(err).not.toBeNull();
    expect(err.code).toBe(404);
    sa.close();
  });

  it('6) a message id from ANOTHER conversation -> 404 (no cross-conversation reach)', async () => {
    const a = await register('A');
    const b = await register('B');
    const c = await register('C');
    await befriend(a, b);
    await befriend(a, c);
    const cidAB = await conversation(a, b);
    const cidAC = await conversation(a, c);
    const midInAC = await post(a, cidAC, 'lives in A-C');

    const sa = await connect(a.accessToken);
    await sleep(150);
    // A is a member of BOTH, and owns the message — only the cid mismatch rejects it.
    sa.emit('recall_message', { conversationId: cidAB, messageId: midInAC });
    const err = await onceError(sa);
    expect(err).not.toBeNull();
    expect(err.code).toBe(404);

    const row = (await history(a, cidAC)).find((m) => m.id === midInAC)!;
    expect(row.recalledAt).toBeNull();
    sa.close();
  });

  it('7) recall is idempotent: a second recall re-broadcasts but keeps the first recalledAt', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const mid = await post(a, cid, 'twice');

    const sa = await connect(a.accessToken);
    await sleep(150);

    const first = onceRecalled(sa);
    sa.emit('recall_message', { conversationId: cid, messageId: mid });
    const p1 = await first;
    expect(p1).not.toBeNull();

    await sleep(50);
    const second = onceRecalled(sa);
    sa.emit('recall_message', { conversationId: cid, messageId: mid });
    const p2 = await second;
    expect(p2).not.toBeNull(); // still broadcast, so late clients converge
    expect(p2.recalledAt).toBe(p1.recalledAt); // no new timestamp written
    sa.close();
  });

  it('8) malformed recall payload (missing messageId) -> 400 and NO broadcast', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    await post(a, cid, 'intact');

    const sa = await connect(a.accessToken);
    const sb = await connect(b.accessToken);
    await sleep(150);

    const guard = onceRecalled(sb, 1200);
    sa.emit('recall_message', { conversationId: cid });
    const err = await onceError(sa);
    expect(err).not.toBeNull();
    expect(err.code).toBe(400);
    expect(await guard).toBeNull();
    sa.close();
    sb.close();
  });

  it('9) recall touches ONLY the target message', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const m1 = await post(a, cid, 'keep me 1');
    const m2 = await post(a, cid, 'recall me');
    const m3 = await post(a, cid, 'keep me 2');

    const sa = await connect(a.accessToken);
    await sleep(150);
    const done = onceRecalled(sa);
    sa.emit('recall_message', { conversationId: cid, messageId: m2 });
    expect(await done).not.toBeNull();

    const rows = await history(a, cid);
    expect(rows.find((m) => m.id === m1)!.content).toBe('keep me 1');
    expect(rows.find((m) => m.id === m1)!.recalledAt).toBeNull();
    expect(rows.find((m) => m.id === m2)!.content).toBe('');
    expect(rows.find((m) => m.id === m3)!.content).toBe('keep me 2');
    sa.close();
  });

  it('10) recall does not change readAt', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const mid = await post(a, cid, 'read then recalled');

    // B reads it over REST (no socket needed) -> readAt is set.
    await request(baseURL)
      .post(`/api/conversations/${cid}/read`)
      .set('Authorization', `Bearer ${b.accessToken}`);
    const before = (await history(a, cid)).find((m) => m.id === mid)!;
    expect(before.readAt).not.toBeNull();

    const sa = await connect(a.accessToken);
    await sleep(150);
    const done = onceRecalled(sa);
    sa.emit('recall_message', { conversationId: cid, messageId: mid });
    expect(await done).not.toBeNull();

    const after = (await history(a, cid)).find((m) => m.id === mid)!;
    expect(after.readAt).toBe(before.readAt);
    expect(after.createdAt).toBe(before.createdAt);
    sa.close();
  });

  /* ------------------------------------------------------------------ *
   * Edit
   * ------------------------------------------------------------------ */

  it('11) sender edits: BOTH ends (incl. the sender) get message_edited with the new content', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const mid = await post(a, cid, 'typo here');

    const sa = await connect(a.accessToken);
    const sb = await connect(b.accessToken);
    await sleep(150);

    const onA = onceEdited(sa);
    const onB = onceEdited(sb);
    sa.emit('edit_message', { conversationId: cid, messageId: mid, content: 'typo fixed' });
    const [pa, pb] = await Promise.all([onA, onB]);

    expect(pa).not.toBeNull();
    expect(pb).not.toBeNull();
    for (const p of [pa, pb]) {
      expect(p.id).toBe(mid);
      expect(p.content).toBe('typo fixed');
      expect(p.editedAt).toBeTruthy();
      expect(p.recalledAt).toBeFalsy();
    }
    sa.close();
    sb.close();
  });

  it('12) REST history returns the edited content + editedAt', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const mid = await post(a, cid, 'v1');

    const sa = await connect(a.accessToken);
    await sleep(150);
    const done = onceEdited(sa);
    sa.emit('edit_message', { conversationId: cid, messageId: mid, content: 'v2' });
    expect(await done).not.toBeNull();

    const row = (await history(b, cid)).find((m) => m.id === mid)!;
    expect(row.content).toBe('v2');
    expect(row.editedAt).toBeTruthy();
    sa.close();
  });

  it('13) the OTHER member cannot edit someone else’s message (403, content unchanged)', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const mid = await post(a, cid, 'A owns this');

    const sb = await connect(b.accessToken);
    await sleep(150);
    sb.emit('edit_message', { conversationId: cid, messageId: mid, content: 'hijacked' });
    const err = await onceError(sb);
    expect(err).not.toBeNull();
    expect(err.code).toBe(403);

    const row = (await history(a, cid)).find((m) => m.id === mid)!;
    expect(row.content).toBe('A owns this');
    expect(row.editedAt).toBeNull();
    sb.close();
  });

  it('14) a non-member cannot edit a message in that conversation (403)', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const mid = await post(a, cid, 'private');

    const c = await register('C');
    const sc = await connect(c.accessToken);
    await sleep(150);
    sc.emit('edit_message', { conversationId: cid, messageId: mid, content: 'nope' });
    const err = await onceError(sc);
    expect(err).not.toBeNull();
    expect(err.code).toBe(403);
    sc.close();
  });

  it('15) editing an unknown message id -> 404', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const sa = await connect(a.accessToken);
    await sleep(150);
    sa.emit('edit_message', { conversationId: cid, messageId: '99999999', content: 'x' });
    const err = await onceError(sa);
    expect(err).not.toBeNull();
    expect(err.code).toBe(404);
    sa.close();
  });

  it('16) a RECALLED message can never be edited (400, stays blank)', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const mid = await post(a, cid, 'gone');

    const sa = await connect(a.accessToken);
    await sleep(150);
    const recalled = onceRecalled(sa);
    sa.emit('recall_message', { conversationId: cid, messageId: mid });
    expect(await recalled).not.toBeNull();

    const guard = onceEdited(sa, 1200);
    sa.emit('edit_message', { conversationId: cid, messageId: mid, content: 'resurrect' });
    const err = await onceError(sa);
    expect(err).not.toBeNull();
    expect(err.code).toBe(400);
    expect(await guard).toBeNull();

    const row = (await history(a, cid)).find((m) => m.id === mid)!;
    expect(row.content).toBe('');
    expect(row.recalledAt).toBeTruthy();
    expect(row.editedAt).toBeNull();
    sa.close();
  });

  it('17) empty (whitespace-only) edit content -> 400 and NO broadcast', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const mid = await post(a, cid, 'keep');

    const sa = await connect(a.accessToken);
    const sb = await connect(b.accessToken);
    await sleep(150);

    const guard = onceEdited(sb, 1200);
    sa.emit('edit_message', { conversationId: cid, messageId: mid, content: '   ' });
    const err = await onceError(sa);
    expect(err).not.toBeNull();
    expect(err.code).toBe(400);
    expect(await guard).toBeNull();

    const row = (await history(a, cid)).find((m) => m.id === mid)!;
    expect(row.content).toBe('keep');
    sa.close();
    sb.close();
  });

  it('18) over-long edit content (2001 chars) -> 400 and NO broadcast', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const mid = await post(a, cid, 'short');

    const sa = await connect(a.accessToken);
    const sb = await connect(b.accessToken);
    await sleep(150);

    const guard = onceEdited(sb, 1200);
    sa.emit('edit_message', {
      conversationId: cid,
      messageId: mid,
      content: 'x'.repeat(2001),
    });
    const err = await onceError(sa);
    expect(err).not.toBeNull();
    expect(err.code).toBe(400);
    expect(await guard).toBeNull();

    const row = (await history(a, cid)).find((m) => m.id === mid)!;
    expect(row.content).toBe('short');
    sa.close();
  });

  it('19) re-editing is allowed: the latest content wins', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const mid = await post(a, cid, 'v1');

    const sa = await connect(a.accessToken);
    await sleep(150);

    const first = onceEdited(sa);
    sa.emit('edit_message', { conversationId: cid, messageId: mid, content: 'v2' });
    const p1 = await first;
    expect(p1).not.toBeNull();

    await sleep(50);
    const second = onceEdited(sa);
    sa.emit('edit_message', { conversationId: cid, messageId: mid, content: 'v3' });
    const p2 = await second;
    expect(p2).not.toBeNull();
    expect(p2.content).toBe('v3');

    const row = (await history(a, cid)).find((m) => m.id === mid)!;
    expect(row.content).toBe('v3');
    expect(row.editedAt).toBeTruthy();
    sa.close();
  });

  it('20) edit preserves readAt and createdAt', async () => {
    const { a, b } = await friends();
    const cid = await conversation(a, b);
    const mid = await post(a, cid, 'read then edited');

    await request(baseURL)
      .post(`/api/conversations/${cid}/read`)
      .set('Authorization', `Bearer ${b.accessToken}`);
    const before = (await history(a, cid)).find((m) => m.id === mid)!;
    expect(before.readAt).not.toBeNull();

    const sa = await connect(a.accessToken);
    await sleep(150);
    const done = onceEdited(sa);
    sa.emit('edit_message', { conversationId: cid, messageId: mid, content: 'edited body' });
    expect(await done).not.toBeNull();

    const after = (await history(a, cid)).find((m) => m.id === mid)!;
    expect(after.content).toBe('edited body');
    expect(after.readAt).toBe(before.readAt); // an edit never resets the read state
    expect(after.createdAt).toBe(before.createdAt); // nor the timeline position
    sa.close();
  });
});
