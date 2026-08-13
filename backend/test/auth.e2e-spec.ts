import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp } from './setup-e2e';

/**
 * End-to-end coverage of the Phase 1 auth flow.
 *
 * Requires a running MySQL (database `realtime_chat_test`) and Redis. Point them via env:
 *   DB_DATABASE=realtime_chat_test REDIS_DB=1 npm run test:e2e
 */
describe('AuthController (e2e)', () => {
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let http: any;

  const unique = () =>
    `u_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;

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

  it('1) registers a new user and returns tokens + sets refresh cookie', async () => {
    const username = unique();
    const res = await request(http)
      .post('/api/auth/register')
      .send({ username, password: 'secret123', nickname: 'Nick' });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.username).toBe(username);
    expect(res.body.data.user.passwordHash).toBeUndefined();
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
    expect(cookieStr).toContain('rtc_refresh');
    expect(cookieStr).toContain('HttpOnly');
  });

  it('2) rejects duplicate username with 409', async () => {
    const username = unique();
    await request(http)
      .post('/api/auth/register')
      .send({ username, password: 'secret123', nickname: 'Nick' });

    const res = await request(http)
      .post('/api/auth/register')
      .send({ username, password: 'secret123', nickname: 'Nick' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(409);
  });

  it('3) logs in and returns tokens', async () => {
    const username = unique();
    await request(http)
      .post('/api/auth/register')
      .send({ username, password: 'secret123', nickname: 'Nick' });

    const res = await request(http)
      .post('/api/auth/login')
      .send({ username, password: 'secret123' });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.username).toBe(username);
  });

  it('4) rejects wrong password with 401', async () => {
    const username = unique();
    await request(http)
      .post('/api/auth/register')
      .send({ username, password: 'secret123', nickname: 'Nick' });

    const res = await request(http)
      .post('/api/auth/login')
      .send({ username, password: 'wrong-pw' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe(401);
  });

  it('5) refreshes the access token using the httpOnly refresh cookie', async () => {
    const username = unique();
    const agent = request.agent(http);

    const reg = await agent
      .post('/api/auth/register')
      .send({ username, password: 'secret123', nickname: 'Nick' });
    const accessToken = reg.body.data.accessToken;

    const refresh = await agent
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(refresh.status).toBe(201);
    expect(refresh.body.code).toBe(0);
    expect(refresh.body.data.accessToken).toBeDefined();
    expect(refresh.body.data.accessToken).not.toBe(accessToken);
  });

  it('6) invalidates the refresh token after logout (refresh then 401s)', async () => {
    const username = unique();
    const agent = request.agent(http);

    await agent.post('/api/auth/register').send({ username, password: 'secret123', nickname: 'Nick' });
    const login = await agent.post('/api/auth/login').send({ username, password: 'secret123' });
    const accessToken = login.body.data.accessToken;

    const logout = await agent
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(logout.status).toBe(201);
    expect(logout.body.data.success).toBe(true);

    const refresh = await agent
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(refresh.status).toBe(401);
    expect(refresh.body.code).toBe(401);
  });

  it('7) rejects GET /api/users/me without a valid access token', async () => {
    const res = await request(http).get('/api/users/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(401);
  });

  it('8) multi-device: each session independent; logout one keeps the other alive', async () => {
    const username = unique();
    const password = 'secret123';
    await request(http)
      .post('/api/auth/register')
      .send({ username, password, nickname: 'Nick' });

    const agentA = request.agent(http);
    const agentB = request.agent(http);
    const loginA = await agentA.post('/api/auth/login').send({ username, password });
    const loginB = await agentB.post('/api/auth/login').send({ username, password });
    const accessA = loginA.body.data.accessToken;
    const accessB = loginB.body.data.accessToken;
    expect(accessA).toBeDefined();
    expect(accessB).toBeDefined();

    // Both sessions can refresh independently.
    const refreshA = await agentA
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${accessA}`);
    const refreshB = await agentB
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${accessB}`);
    expect(refreshA.status).toBe(201);
    expect(refreshB.status).toBe(201);

    // Logout device A only.
    const logoutA = await agentA
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessA}`);
    expect(logoutA.status).toBe(201);
    expect(logoutA.body.data.success).toBe(true);

    // Device A's refresh is now rejected, but device B still works (multi-device).
    const refreshAAgain = await agentA
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${accessA}`);
    expect(refreshAAgain.status).toBe(401);

    const refreshBAgain = await agentB
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${accessB}`);
    expect(refreshBAgain.status).toBe(201);
  });

  it('9) access blacklist: a logged-out token is rejected before it expires', async () => {
    const username = unique();
    const password = 'secret123';
    const agent = request.agent(http);
    await agent.post('/api/auth/register').send({ username, password, nickname: 'Nick' });
    const login = await agent.post('/api/auth/login').send({ username, password });
    const accessToken = login.body.data.accessToken;

    // Token valid before logout.
    const meBefore = await request(http)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(meBefore.status).toBe(200);

    // Logout revokes the access token (blacklist) even though it has not expired.
    const logout = await agent
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(logout.status).toBe(201);

    const meAfter = await request(http)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(meAfter.status).toBe(401);
    expect(meAfter.body.code).toBe(401);
  });
});
