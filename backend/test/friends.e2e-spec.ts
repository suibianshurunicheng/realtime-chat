import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp } from './setup-e2e';

/**
 * End-to-end coverage of the Phase 2.1 friend system.
 * Requires a running MySQL (database `realtime_chat_test`) and Redis.
 *
 * User ids are strings (bigint). All friend endpoints read the caller id from
 * the JWT (`req.user.sub`) and never trust a client-supplied id.
 */
describe('FriendsController (e2e)', () => {
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

  it('1) user A can search for user B (and not themselves)', async () => {
    const a = await register('A');
    const b = await register('B');
    const res = await request(http)
      .get(`/api/users/search?q=${b.username}`)
      .set('Authorization', `Bearer ${a.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    const ids = (res.body.data as { id: string }[]).map((u) => u.id);
    expect(ids).toContain(b.id);
    expect(ids).not.toContain(a.id);
  });

  it('2) user A sends a friend request to B', async () => {
    const a = await register('A');
    const b = await register('B');
    const res = await request(http)
      .post('/api/friends/requests')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ addresseeId: b.id });
    expect(res.status).toBe(201);
    expect(res.body.data.requesterId).toBe(a.id);
    expect(res.body.data.addresseeId).toBe(b.id);
    expect(res.body.data.status).toBe('pending');
  });

  it('3) user B sees the pending request from A', async () => {
    const a = await register('A');
    const b = await register('B');
    await request(http)
      .post('/api/friends/requests')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ addresseeId: b.id });
    const res = await request(http)
      .get('/api/friends/requests')
      .set('Authorization', `Bearer ${b.accessToken}`);
    expect(res.status).toBe(200);
    const received = res.body.data as { id: string; requester: { id: string } }[];
    expect(received.some((r) => r.requester.id === a.id)).toBe(true);
  });

  it('4-6) B accepts; both friend lists show each other', async () => {
    const a = await register('A');
    const b = await register('B');
    const sent = await request(http)
      .post('/api/friends/requests')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ addresseeId: b.id });
    const requestId = sent.body.data.id;

    const accept = await request(http)
      .post(`/api/friends/requests/${requestId}/accept`)
      .set('Authorization', `Bearer ${b.accessToken}`);
    expect(accept.status).toBe(201);
    expect(accept.body.data.request.status).toBe('accepted');

    const listA = await request(http)
      .get('/api/friends')
      .set('Authorization', `Bearer ${a.accessToken}`);
    const listB = await request(http)
      .get('/api/friends')
      .set('Authorization', `Bearer ${b.accessToken}`);
    expect((listA.body.data as { id: string }[]).map((u) => u.id)).toContain(b.id);
    expect((listB.body.data as { id: string }[]).map((u) => u.id)).toContain(a.id);
  });

  it('7) A cannot send a duplicate friend request to B', async () => {
    const a = await register('A');
    const b = await register('B');
    await request(http)
      .post('/api/friends/requests')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ addresseeId: b.id });
    const dup = await request(http)
      .post('/api/friends/requests')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ addresseeId: b.id });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe(409);
  });

  it('8) A cannot add themselves as a friend', async () => {
    const a = await register('A');
    const res = await request(http)
      .post('/api/friends/requests')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ addresseeId: a.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(400);
  });

  it('9) B rejects a friend request from C', async () => {
    const c = await register('C');
    const d = await register('D');
    const sent = await request(http)
      .post('/api/friends/requests')
      .set('Authorization', `Bearer ${c.accessToken}`)
      .send({ addresseeId: d.id });
    const reject = await request(http)
      .post(`/api/friends/requests/${sent.body.data.id}/reject`)
      .set('Authorization', `Bearer ${d.accessToken}`);
    expect(reject.status).toBe(201);
    expect(reject.body.data.request.status).toBe('rejected');

    const listD = await request(http)
      .get('/api/friends')
      .set('Authorization', `Bearer ${d.accessToken}`);
    expect((listD.body.data as { id: string }[]).map((u) => u.id)).not.toContain(c.id);
  });

  it('10) a non-addressee cannot accept a request', async () => {
    const e = await register('E');
    const f = await register('F');
    const g = await register('G');
    const sent = await request(http)
      .post('/api/friends/requests')
      .set('Authorization', `Bearer ${e.accessToken}`)
      .send({ addresseeId: f.id });
    const hijack = await request(http)
      .post(`/api/friends/requests/${sent.body.data.id}/accept`)
      .set('Authorization', `Bearer ${g.accessToken}`);
    expect(hijack.status).toBe(403);
    expect(hijack.body.code).toBe(403);
  });

  it('11) a non-addressee cannot reject a request', async () => {
    const e = await register('E');
    const f = await register('F');
    const g = await register('G');
    const sent = await request(http)
      .post('/api/friends/requests')
      .set('Authorization', `Bearer ${e.accessToken}`)
      .send({ addresseeId: f.id });
    const hijack = await request(http)
      .post(`/api/friends/requests/${sent.body.data.id}/reject`)
      .set('Authorization', `Bearer ${g.accessToken}`);
    expect(hijack.status).toBe(403);
    expect(hijack.body.code).toBe(403);
  });

  it('12-13) delete friend removes it from both sides', async () => {
    const a = await register('A');
    const b = await register('B');
    const sent = await request(http)
      .post('/api/friends/requests')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .send({ addresseeId: b.id });
    await request(http)
      .post(`/api/friends/requests/${sent.body.data.id}/accept`)
      .set('Authorization', `Bearer ${b.accessToken}`);

    const del = await request(http)
      .delete(`/api/friends/${b.id}`)
      .set('Authorization', `Bearer ${a.accessToken}`);
    expect(del.status).toBe(200);

    const listA = await request(http)
      .get('/api/friends')
      .set('Authorization', `Bearer ${a.accessToken}`);
    const listB = await request(http)
      .get('/api/friends')
      .set('Authorization', `Bearer ${b.accessToken}`);
    expect((listA.body.data as { id: string }[]).map((u) => u.id)).not.toContain(b.id);
    expect((listB.body.data as { id: string }[]).map((u) => u.id)).not.toContain(a.id);
  });

  it('14) concurrent duplicate requests produce exactly one pending + one friendship', async () => {
    const h = await register('H');
    const i = await register('I');
    const calls = Array.from({ length: 8 }, () =>
      request(http)
        .post('/api/friends/requests')
        .set('Authorization', `Bearer ${h.accessToken}`)
        .send({ addresseeId: i.id }),
    );
    const results = await Promise.all(calls);
    // At least one succeeded; the rest are 409 (no 500 from unique violation).
    expect(results.some((r) => r.status === 201)).toBe(true);
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);

    const inbox = await request(http)
      .get('/api/friends/requests')
      .set('Authorization', `Bearer ${i.accessToken}`);
    const pending = (
      inbox.body.data as { id: string; requester: { id: string } }[]
    ).filter((r) => r.requester.id === h.id);
    expect(pending.length).toBe(1);

    const accept = await request(http)
      .post(`/api/friends/requests/${pending[0].id}/accept`)
      .set('Authorization', `Bearer ${i.accessToken}`);
    expect(accept.status).toBe(201);

    const listH = await request(http)
      .get('/api/friends')
      .set('Authorization', `Bearer ${h.accessToken}`);
    const listI = await request(http)
      .get('/api/friends')
      .set('Authorization', `Bearer ${i.accessToken}`);
    expect((listH.body.data as { id: string }[]).length).toBe(1);
    expect((listI.body.data as { id: string }[]).length).toBe(1);
  });

  it('15) requester can cancel a pending request; then re-send is allowed', async () => {
    const j = await register('J');
    const k = await register('K');
    const sent = await request(http)
      .post('/api/friends/requests')
      .set('Authorization', `Bearer ${j.accessToken}`)
      .send({ addresseeId: k.id });
    const cancel = await request(http)
      .delete(`/api/friends/requests/${sent.body.data.id}`)
      .set('Authorization', `Bearer ${j.accessToken}`);
    expect(cancel.status).toBe(200);

    const inbox = await request(http)
      .get('/api/friends/requests')
      .set('Authorization', `Bearer ${k.accessToken}`);
    expect(
      (
        inbox.body.data as { id: string; requester: { id: string } }[]
      ).some((r) => r.requester.id === j.id),
    ).toBe(false);

    const resend = await request(http)
      .post('/api/friends/requests')
      .set('Authorization', `Bearer ${j.accessToken}`)
      .send({ addresseeId: k.id });
    expect(resend.status).toBe(201);
  });

  it('16) friend endpoints reject an unauthenticated request', async () => {
    const res = await request(http).get('/api/friends');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(401);
  });
});
