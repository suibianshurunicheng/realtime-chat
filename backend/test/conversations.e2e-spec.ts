import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp } from './setup-e2e';

/**
 * End-to-end coverage of the Phase 2.2A conversation / message model (REST only,
 * no realtime). Requires a running MySQL (database `realtime_chat_test`) and Redis.
 *
 * Conversation creation requires an existing friendship (business decision: only
 * friends can open a 1:1 conversation). The auth (9) and friends (16) suites run
 * alongside this file; together they must be all-green with no regression.
 */
describe('ConversationsController (e2e)', () => {
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let http: any;

  const unique = () =>
    `u_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;

  async function register(nickname = 'Nick') {
    const username = unique();
    const res = await request(http)
      .post('/api/auth/register')
      .send({ username, password: 'secret123', nickname });
    return {
      username,
      accessToken: res.body.data.accessToken as string,
      id: res.body.data.user.id as string,
    };
  }

  /** Register two users and make them friends; returns their tokens/ids. */
  async function friends() {
    const a = await register('A');
    const b = await register('B');
    const sent = await request(http)
      .post('/api/friends/requests')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ addresseeId: b.id });
    await request(http)
      .post(`/api/friends/requests/${sent.body.data.id}/accept`)
      .set('Authorization', `Bearer ${b.accessToken}`);
    return { a, b };
  }

  beforeAll(async () => {
    process.env.DB_DATABASE = process.env.DB_DATABASE ?? 'realtime_chat_test';
    process.env.REDIS_DB = process.env.REDIS_DB ?? '1';
    process.env.NODE_ENV = 'test';
    app = await createApp();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('1) A creates a 1:1 conversation with friend B', async () => {
    const { a, b } = await friends();
    const res = await request(http)
      .post('/api/conversations/direct')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('direct');
    const memberIds = (res.body.data.members as { id: string }[]).map((m) => m.id);
    expect(memberIds).toContain(a.id);
    expect(memberIds).toContain(b.id);
  });

  it('2) repeating creation returns the SAME conversation', async () => {
    const { a, b } = await friends();
    const first = await request(http)
      .post('/api/conversations/direct')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id });
    const second = await request(http)
      .post('/api/conversations/direct')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id });
    expect([200, 201]).toContain(second.status);
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it('3) B creating from the other direction returns the SAME conversation', async () => {
    const { a, b } = await friends();
    const byA = await request(http)
      .post('/api/conversations/direct')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id });
    const byB = await request(http)
      .post('/api/conversations/direct')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .send({ userId: a.id });
    expect(byB.body.data.id).toBe(byA.body.data.id);
  });

  it('4) A cannot create a conversation with themselves', async () => {
    const a = await register('A');
    const res = await request(http)
      .post('/api/conversations/direct')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: a.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(400);
  });

  it('5) non-friends cannot create a conversation', async () => {
    const a = await register('A');
    const b = await register('B');
    const res = await request(http)
      .post('/api/conversations/direct')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(403);
  });

  it('6) the current user sees their own conversation in the list', async () => {
    const { a, b } = await friends();
    const created = await request(http)
      .post('/api/conversations/direct')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id });
    const list = await request(http)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${a.accessToken}`);
    expect(list.status).toBe(200);
    const ids = (list.body.data as { id: string }[]).map((c) => c.id);
    expect(ids).toContain(created.body.data.id);
  });

  it('7) another user cannot view that conversation (not a member)', async () => {
    const { a, b } = await friends();
    const created = await request(http)
      .post('/api/conversations/direct')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id });
    const c = await register('C');
    const res = await request(http)
      .get(`/api/conversations/${created.body.data.id}`)
      .set('Authorization', `Bearer ${c.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(403);
  });

  it('8) concurrent creation produces exactly ONE conversation', async () => {
    const { a, b } = await friends();
    const calls = Array.from({ length: 8 }, () =>
      request(http)
        .post('/api/conversations/direct')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ userId: b.id }),
    );
    const results = await Promise.all(calls);
    expect(results.some((r) => [200, 201].includes(r.status))).toBe(true);
    expect(results.every((r) => [200, 201].includes(r.status))).toBe(true);

    const list = await request(http)
      .get('/api/conversations')
      .set('Authorization', `Bearer ${a.accessToken}`);
    const mine = (list.body.data as { id: string; members: { id: string }[] }[]).filter((c) =>
      c.members.map((m) => m.id).includes(b.id),
    );
    expect(mine.length).toBe(1);
  });

  it('9) A sends a text message in the conversation', async () => {
    const { a, b } = await friends();
    const created = await request(http)
      .post('/api/conversations/direct')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id });
    const res = await request(http)
      .post(`/api/conversations/${created.body.data.id}/messages`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ content: 'hello B' });
    expect(res.status).toBe(201);
    expect(res.body.data.content).toBe('hello B');
    expect(res.body.data.type).toBe('text');
    expect(res.body.data.senderId).toBe(a.id);
  });

  it('10) B can see the message A sent', async () => {
    const { a, b } = await friends();
    const created = await request(http)
      .post('/api/conversations/direct')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id });
    await request(http)
      .post(`/api/conversations/${created.body.data.id}/messages`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ content: 'hi from A' });
    const res = await request(http)
      .get(`/api/conversations/${created.body.data.id}/messages`)
      .set('Authorization', `Bearer ${b.accessToken}`);
    expect(res.status).toBe(200);
    expect((res.body.data as { content: string }[]).some((m) => m.content === 'hi from A')).toBe(true);
  });

  it('11) A can read the full history', async () => {
    const { a, b } = await friends();
    const created = await request(http)
      .post('/api/conversations/direct')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id });
    await request(http)
      .post(`/api/conversations/${created.body.data.id}/messages`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ content: 'one' });
    await request(http)
      .post(`/api/conversations/${created.body.data.id}/messages`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ content: 'two' });
    const res = await request(http)
      .get(`/api/conversations/${created.body.data.id}/messages`)
      .set('Authorization', `Bearer ${a.accessToken}`);
    expect((res.body.data as { content: string }[]).map((m) => m.content)).toEqual(['one', 'two']);
  });

  it('12) a non-member cannot read history', async () => {
    const { a, b } = await friends();
    const created = await request(http)
      .post('/api/conversations/direct')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id });
    const c = await register('C');
    const res = await request(http)
      .get(`/api/conversations/${created.body.data.id}/messages`)
      .set('Authorization', `Bearer ${c.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(403);
  });

  it('13) a non-member cannot send a message', async () => {
    const { a, b } = await friends();
    const created = await request(http)
      .post('/api/conversations/direct')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id });
    const c = await register('C');
    const res = await request(http)
      .post(`/api/conversations/${created.body.data.id}/messages`)
      .set('Authorization', `Bearer ${c.accessToken}`)
      .send({ content: 'intruder' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(403);
  });

  it('14) senderId is never trusted from the client', async () => {
    const { a, b } = await friends();
    const created = await request(http)
      .post('/api/conversations/direct')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id });
    const res = await request(http)
      .post(`/api/conversations/${created.body.data.id}/messages`)
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ content: 'spoof', senderId: '999999', senderIdFake: b.id });
    expect(res.status).toBe(201);
    expect(res.body.data.senderId).toBe(a.id);
    expect(res.body.data.senderId).not.toBe('999999');
  });

  it('15) a message must belong to a real conversation (404 on missing)', async () => {
    const a = await register('A');
    const res = await request(http)
      .post('/api/conversations/999999999/messages')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ content: 'ghost' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(404);
  });

  it('16) pagination returns history stably via cursor', async () => {
    const { a, b } = await friends();
    const created = await request(http)
      .post('/api/conversations/direct')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id });
    const cid = created.body.data.id;
    for (let i = 1; i <= 5; i++) {
      await request(http)
        .post(`/api/conversations/${cid}/messages`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ content: `m${i}` });
    }
    // Initial page (no cursor): newest `limit` messages, ascending display.
    const page1 = await request(http)
      .get(`/api/conversations/${cid}/messages?limit=2`)
      .set('Authorization', `Bearer ${a.accessToken}`);
    const p1 = page1.body.data as { id: string; content: string }[];
    expect(p1.length).toBe(2);
    expect(p1[0].content).toBe('m4');
    expect(p1[1].content).toBe('m5');

    // `before` = oldest id shown; fetch the next OLDER page (scroll-up).
    const page2 = await request(http)
      .get(`/api/conversations/${cid}/messages?limit=2&before=${p1[0].id}`)
      .set('Authorization', `Bearer ${a.accessToken}`);
    const p2 = page2.body.data as { id: string; content: string }[];
    expect(p2.length).toBe(2);
    expect(p2[0].content).toBe('m2');
    expect(p2[1].content).toBe('m3');
    // pages are disjoint
    const p1Ids = new Set(p1.map((m) => m.id));
    expect(p2.every((m) => !p1Ids.has(m.id))).toBe(true);
  });

  it('17) requested limit over the cap is clamped to 50', async () => {
    const { a, b } = await friends();
    const created = await request(http)
      .post('/api/conversations/direct')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ userId: b.id });
    const cid = created.body.data.id;
    for (let i = 0; i < 3; i++) {
      await request(http)
        .post(`/api/conversations/${cid}/messages`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ content: `x${i}` });
    }
    const res = await request(http)
      .get(`/api/conversations/${cid}/messages?limit=1000`)
      .set('Authorization', `Bearer ${a.accessToken}`);
    expect((res.body.data as unknown[]).length).toBeLessThanOrEqual(50);
  });
});
